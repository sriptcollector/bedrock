// Reading view renderer with virtualised sections: the note is parsed once into top-level
// sections; only the sections near the viewport are in the DOM (like the original: a
// .markdown-preview-pusher spacer above, an estimated min-height on the sizer). Sections are
// post-processed when they first appear. Also: foldable headings and lists, task checkboxes that
// write back, footnote hover previews and the copy button on code blocks (via postProcess).
import { Component } from "../api/events";
import { createMarkdownIt } from "./parser";
import { postProcess, sanitize, codeBlockProcessors, type MarkdownPostProcessorContext } from "./renderer";
import { setIcon } from "../dom/icons";

export interface ReadingSection {
  html: string;
  cls: string;
  /** First source line (absolute, including the frontmatter offset). */
  line: number;
  /** Line after the section (exclusive). */
  end: number;
  heading: number; // heading level, 0 when not a heading
  el: HTMLElement | null;
  height: number;
  measured: boolean;
  hidden: boolean;
}

const VIRTUALISE_FROM = 60; // sections; smaller notes render fully
const BUFFER_PX = 1200;

let mdCache: { strict: boolean; md: ReturnType<typeof createMarkdownIt> } | null = null;
function md(strict: boolean) {
  if (!mdCache || mdCache.strict !== strict) mdCache = { strict, md: createMarkdownIt({ strictLineBreaks: strict }) };
  return mdCache.md;
}

/** Split rendered HTML into top-level sections (one per block), with their source lines. */
export function splitSections(html: string, totalLines: number, lineOffset: number): ReadingSection[] {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  sanitize(tpl.content);
  const out: ReadingSection[] = [];
  for (const node of Array.from(tpl.content.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && !node.textContent!.trim()) continue;
    const el = node as HTMLElement;
    const tag = node.nodeType === Node.ELEMENT_NODE ? el.tagName.toLowerCase() : "p";
    const cls = el.classList?.contains("callout") ? "el-div" : el.classList?.contains("footnotes") ? "el-section mod-footnotes" : `el-${tag}`;
    const lineAttr = el.getAttribute?.("data-line") ?? el.querySelector?.("[data-line]")?.getAttribute("data-line");
    const line = lineAttr != null && Number(lineAttr) >= 0 ? Number(lineAttr) : out.length ? out[out.length - 1].line : lineOffset;
    const heading = /^h[1-6]$/.test(tag) ? Number(tag[1]) : 0;
    const htmlText = node.nodeType === Node.ELEMENT_NODE ? el.outerHTML : `<p>${node.textContent}</p>`;
    out.push({ html: htmlText, cls, line, end: line + 1, heading, el: null, height: 0, measured: false, hidden: false });
  }
  for (let i = 0; i < out.length; i++) out[i].end = i + 1 < out.length ? Math.max(out[i].line + 1, out[i + 1].line) : totalLines + lineOffset;
  for (const s of out) s.height = estimateHeight(s);
  return out;
}

function estimateHeight(s: ReadingSection): number {
  const lines = Math.max(1, s.end - s.line);
  if (s.heading) return 48;
  if (/^<(pre|table)/.test(s.html)) return 26 * lines + 32;
  return Math.min(4000, 24 * lines + 16);
}

export interface ReadingHost {
  app: any;
  sourcePath: string;
  previewEl: HTMLElement;
  sizerEl: HTMLElement;
  headerEl: HTMLElement;
  /** Toggle the task at an absolute source line. */
  toggleTask(line: number): void;
  /** Persist which headings are folded (absolute line numbers). */
  saveFolds(lines: number[]): void;
  loadFolds(): number[];
}

export class ReadingRenderer extends Component {
  sections: ReadingSection[] = [];
  private pusher: HTMLElement;
  private footer: HTMLElement;
  private renderComp: Component | null = null;
  private first = 0;
  private last = -1;
  private raf = 0;
  private folded = new Set<number>();
  private ctx: MarkdownPostProcessorContext | null = null;
  private text = "";
  private frontmatter: any = null;
  virtual = false;

  constructor(private host: ReadingHost) {
    super();
    this.pusher = createDiv("markdown-preview-pusher");
    this.pusher.style.width = "1px";
    this.pusher.style.height = "0.1px";
    this.footer = createDiv("mod-footer mod-ui");
    host.previewEl.addEventListener("scroll", () => this.queueUpdate(), { passive: true });
  }

  onunload(): void {
    cancelAnimationFrame(this.raf);
  }

  /** Parse and lay out the note. `body` excludes frontmatter; lineOffset = its line count. */
  render(fullText: string, body: string, lineOffset: number, frontmatter: any): void {
    this.text = fullText;
    this.frontmatter = frontmatter;
    if (this.renderComp) this.removeChild(this.renderComp);
    this.renderComp = this.addChild(new Component());
    const app = this.host.app;
    const html = md(!!app?.vault?.getConfig?.("strictLineBreaks")).render(body, { lineOffset, codeBlockProcessors, mermaid: app?.vault?.getConfig?.("mermaid") === true });
    const totalLines = body.split("\n").length;
    this.sections = splitSections(html, totalLines, lineOffset);
    this.virtual = this.sections.length >= VIRTUALISE_FROM;
    this.folded = new Set(this.host.loadFolds());
    this.applyFolds();
    const lines = fullText.split("\n");
    this.ctx = {
      docId: String(Math.random()).slice(2),
      sourcePath: this.host.sourcePath,
      frontmatter,
      addChild: (c) => this.renderComp!.addChild(c),
      getSectionInfo: (target) => {
        const sec = this.sections.find((s) => s.el && (s.el === target || s.el.contains(target)));
        if (!sec) return null;
        return { text: this.text, lineStart: sec.line, lineEnd: Math.max(sec.line, sec.end - 1) };
      },
    };
    void lines;
    const sizer = this.host.sizerEl;
    sizer.empty();
    sizer.append(this.pusher, this.host.headerEl);
    this.first = 0;
    this.last = -1;
    this.update(true);
  }

  private applyFolds(): void {
    let hideUntil = -1;
    let level = 7;
    for (let i = 0; i < this.sections.length; i++) {
      const s = this.sections[i];
      if (hideUntil >= 0) {
        if (s.heading && s.heading <= level) hideUntil = -1;
        else {
          s.hidden = true;
          continue;
        }
      }
      s.hidden = false;
      if (s.heading && this.folded.has(s.line)) {
        hideUntil = i;
        level = s.heading;
      }
    }
  }

  queueUpdate(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.update(false);
    });
  }

  /** Render the sections that intersect the viewport (all of them for short notes). */
  update(force: boolean): void {
    const visible = this.sections.map((s, i) => ({ s, i })).filter((x) => !x.s.hidden);
    let first = 0;
    let last = visible.length - 1;
    if (this.virtual) {
      const top = this.host.previewEl.scrollTop - this.headerHeight() - BUFFER_PX;
      const bottom = this.host.previewEl.scrollTop + this.host.previewEl.clientHeight - this.headerHeight() + BUFFER_PX;
      let y = 0;
      first = -1;
      for (let k = 0; k < visible.length; k++) {
        const h = visible[k].s.height;
        if (first < 0 && y + h >= top) first = k;
        if (y > bottom) {
          last = k - 1;
          break;
        }
        y += h;
      }
      if (first < 0) first = Math.max(0, visible.length - 1);
      last = Math.max(first, last);
    }
    if (!force && first === this.first && last === this.last) return;
    this.first = first;
    this.last = last;
    const want = visible.slice(first, last + 1).map((x) => x.s);
    const wantSet = new Set(want);
    for (const s of this.sections) if (s.el && !wantSet.has(s)) s.el.remove();
    let before = 0;
    for (let k = 0; k < first; k++) before += visible[k].s.height;
    this.pusher.style.marginBottom = before + "px";
    const sizer = this.host.sizerEl;
    let anchor: Node = this.host.headerEl;
    for (const s of want) {
      if (!s.el) this.materialise(s);
      if (anchor.nextSibling !== s.el) anchor.parentNode!.insertBefore(s.el!, anchor.nextSibling);
      anchor = s.el!;
    }
    // Remove stray children (old sections) after the window.
    for (const child of Array.from(sizer.children)) {
      if (child === this.pusher || child === this.host.headerEl || child === this.footer) continue;
      if (!want.some((s) => s.el === child)) child.remove();
    }
    if (last >= visible.length - 1) sizer.appendChild(this.footer);
    else this.footer.remove();
    // Measure what is in the DOM and estimate the total height.
    requestAnimationFrame(() => this.measure(want));
  }

  private headerHeight(): number {
    return this.host.headerEl.offsetHeight || 0;
  }

  private measure(rendered: ReadingSection[]): void {
    for (let i = 0; i < rendered.length; i++) {
      const s = rendered[i];
      if (!s.el?.isConnected) continue;
      const next = rendered[i + 1]?.el;
      const h = next?.isConnected ? next.offsetTop - s.el.offsetTop : s.el.offsetHeight;
      if (h > 0) {
        s.height = h;
        s.measured = true;
      }
    }
    const total = this.sections.reduce((a, s) => a + (s.hidden ? 0 : s.height), 0);
    this.host.sizerEl.style.minHeight = this.virtual ? total + this.headerHeight() + "px" : "";
  }

  private materialise(s: ReadingSection): void {
    const el = createDiv(s.cls);
    el.innerHTML = s.html;
    s.el = el;
    this.decorate(s, el);
    void postProcess(this.host.app, el, this.host.sourcePath, this.renderComp!, { embedDepth: 0, frontmatter: this.frontmatter, sourceText: this.text }, this.ctx!, [el]).then(() => {
      this.afterPostProcess(el);
      if (!s.measured) this.queueUpdate();
    });
  }

  /** Our own reading-view details: fold indicators, bullets, task checkboxes, highlight colours, footnotes. */
  private decorate(s: ReadingSection, el: HTMLElement): void {
    const app = this.host.app;
    // Headings: fold indicator (when "Fold heading" is on).
    if (s.heading && app?.vault?.getConfig?.("foldHeading") !== false) {
      const h = el.firstElementChild as HTMLElement | null;
      if (h) {
        const ind = createSpan({ cls: "heading-collapse-indicator collapse-indicator collapse-icon" + (this.folded.has(s.line) ? " is-collapsed" : "") });
        setIcon(ind, "right-triangle");
        h.prepend(ind);
        if (this.folded.has(s.line)) el.addClass("is-collapsed");
        ind.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.toggleFold(s.line);
        });
      }
    }
    // Lists: bullets and collapse indicators.
    el.querySelectorAll<HTMLElement>("ul").forEach((ul) => ul.addClass("has-list-bullet"));
    el.querySelectorAll<HTMLLIElement>("li").forEach((li) => {
      if (li.closest("section.footnotes")) return;
      if (li.parentElement?.tagName === "UL" && !li.querySelector(":scope > .list-bullet")) li.prepend(createSpan("list-bullet"));
      const sub = li.querySelector(":scope > ul, :scope > ol");
      if (sub && app?.vault?.getConfig?.("foldIndent") !== false) {
        const ind = createSpan("list-collapse-indicator collapse-indicator collapse-icon");
        setIcon(ind, "right-triangle");
        const bullet = li.querySelector(":scope > .list-bullet");
        if (bullet) bullet.after(ind);
        else li.prepend(ind);
        ind.addEventListener("click", (e) => {
          e.preventDefault();
          const c = !li.hasClass("is-collapsed");
          li.toggleClass("is-collapsed", c);
          ind.toggleClass("is-collapsed", c);
          (sub as HTMLElement).style.display = c ? "none" : "";
          this.queueUpdate();
        });
      }
      if (li.hasClass("task-list-item")) {
        const t = li.getAttribute("data-task");
        if (t === " ") li.setAttribute("data-task", "");
      }
    });
    // Task checkboxes write back to the file (absolute line from the list item).
    el.querySelectorAll<HTMLInputElement>("input.task-list-item-checkbox").forEach((cb) => {
      const li = cb.closest<HTMLElement>("li[data-line]");
      const line = Number(li?.getAttribute("data-line"));
      cb.addEventListener("click", (e) => {
        e.preventDefault();
        if (Number.isFinite(line)) this.host.toggleTask(line);
      });
    });
    // ==🔴text== colours.
    el.querySelectorAll<HTMLElement>("mark").forEach((m) => {
      const first = m.firstChild;
      if (first?.nodeType !== Node.TEXT_NODE) return;
      const t = first.textContent ?? "";
      const map: Record<string, string> = { "🔴": "red", "🟠": "orange", "🟡": "yellow", "🟢": "green", "🔵": "blue", "🟣": "purple" };
      for (const [e, c] of Object.entries(map))
        if (t.startsWith(e)) {
          first.textContent = t.slice(e.length);
          m.setAttribute("data-highlight", c);
        }
    });
    // Footnotes: original-style ids and hover previews.
    el.querySelectorAll<HTMLElement>("sup.footnote-ref").forEach((sup) => {
      const a = sup.querySelector("a");
      if (!a) return;
      a.addClass("footnote-link");
      const label = (a.textContent ?? "").replace(/^\[|\]$/g, "");
      a.setAttribute("data-footref", label);
      a.addEventListener("mouseenter", () => this.showFootnote(a));
      a.addEventListener("click", (e) => {
        e.preventDefault();
        this.scrollToFootnote(a.getAttribute("href") ?? "");
      });
    });
    el.querySelectorAll<HTMLAnchorElement>("a.footnote-backref").forEach((a) => {
      a.addClass("footnote-link");
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const id = (a.getAttribute("href") ?? "").slice(1);
        const target = this.host.sizerEl.querySelector(`[id="${CSS.escape(id)}"]`);
        target?.scrollIntoView({ block: "center" });
      });
    });
  }

  private afterPostProcess(el: HTMLElement): void {
    // Link hovers go through the page-preview event (source "preview").
    void el;
  }

  private popover: HTMLElement | null = null;
  private showFootnote(a: HTMLElement): void {
    const id = (a.getAttribute("href") ?? "").slice(1);
    const section = this.sections.find((s) => s.html.includes(`id="${id}"`));
    if (!section) return;
    const tpl = document.createElement("template");
    tpl.innerHTML = section.html;
    const li = tpl.content.querySelector(`[id="${CSS.escape(id)}"]`);
    if (!li) return;
    li.querySelectorAll(".footnote-backref").forEach((b) => b.remove());
    this.popover?.remove();
    const pop = createDiv("popover hover-popover footnote-popover");
    const inner = pop.createDiv("markdown-embed markdown-preview-view markdown-rendered");
    inner.innerHTML = li.innerHTML;
    document.body.appendChild(pop);
    const r = a.getBoundingClientRect();
    pop.style.position = "fixed";
    pop.style.left = Math.min(r.left, window.innerWidth - 420) + "px";
    pop.style.top = r.bottom + 6 + "px";
    this.popover = pop;
    const hide = () => {
      setTimeout(() => {
        if (!pop.matches(":hover") && !a.matches(":hover")) {
          pop.remove();
          if (this.popover === pop) this.popover = null;
        } else hide();
      }, 300);
    };
    a.addEventListener("mouseleave", hide, { once: true });
  }

  private scrollToFootnote(href: string): void {
    const id = href.slice(1);
    const idx = this.sections.findIndex((s) => s.html.includes(`id="${id}"`));
    if (idx < 0) return;
    this.scrollToSection(idx);
    requestAnimationFrame(() => this.host.sizerEl.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "center" }));
  }

  toggleFold(line: number): void {
    if (this.folded.has(line)) this.folded.delete(line);
    else this.folded.add(line);
    this.host.saveFolds([...this.folded]);
    // Re-decorate the heading's indicator and re-layout.
    const s = this.sections.find((x) => x.line === line);
    if (s?.el) {
      s.el.toggleClass("is-collapsed", this.folded.has(line));
      s.el.querySelector(".heading-collapse-indicator")?.toggleClass("is-collapsed", this.folded.has(line));
    }
    this.applyFolds();
    this.update(true);
  }

  /** Scroll so the section containing `line` is at the top. */
  scrollToLine(line: number): void {
    let idx = 0;
    for (let i = 0; i < this.sections.length; i++) if (this.sections[i].line <= line) idx = i;
    this.scrollToSection(idx);
  }

  private scrollToSection(idx: number): void {
    let y = this.headerHeight();
    for (let i = 0; i < idx; i++) if (!this.sections[i].hidden) y += this.sections[i].height;
    this.host.previewEl.scrollTop = y;
    this.update(true);
    // Correct after measuring.
    requestAnimationFrame(() => {
      const el = this.sections[idx]?.el;
      if (el?.isConnected) el.scrollIntoView({ block: "start" });
    });
  }

  /** The source line at the top of the viewport. */
  topLine(): number {
    const top = this.host.previewEl.getBoundingClientRect().top;
    for (const s of this.sections) if (s.el?.isConnected && s.el.getBoundingClientRect().bottom > top) return s.line;
    return this.sections[0]?.line ?? 0;
  }
}
