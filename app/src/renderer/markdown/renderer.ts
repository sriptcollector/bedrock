// Markdown -> DOM for reading view, embeds and plugins (MarkdownRenderer.render), plus the
// post-processing pass: internal links, embeds (notes, headings, blocks, images, audio, video,
// pdf), callout icons/folding, code highlighting, mermaid, plugin post processors.
import { Component } from "../api/events";
import { createMarkdownIt, escapeHtml } from "./parser";
import { getFrontMatterInfo } from "../../core/parse";
import { parseLinktext } from "../../core/links";
import { resolveSubpath } from "../metadata/cache";
import { setIcon } from "../dom/icons";
import { highlightCodeInto } from "./highlight";
import { IMAGE_EXTS, AUDIO_EXTS, VIDEO_EXTS } from "../views/simple-views";
import { Keymap } from "../commands/keymap";
import type { TFile } from "../vault/files";

export interface MarkdownPostProcessorContext {
  docId: string;
  sourcePath: string;
  frontmatter: any;
  addChild(child: Component): void;
  getSectionInfo(el: HTMLElement): { text: string; lineStart: number; lineEnd: number } | null;
}

export type MarkdownPostProcessor = ((el: HTMLElement, ctx: MarkdownPostProcessorContext) => Promise<any> | void) & { sortOrder?: number };

export class MarkdownRenderChild extends Component {
  containerEl: HTMLElement;
  constructor(containerEl: HTMLElement) {
    super();
    this.containerEl = containerEl;
  }
}

export const postProcessors: MarkdownPostProcessor[] = [];
export const codeBlockProcessors: Record<string, (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => any> = {};

let mdCache: { strict: boolean; md: ReturnType<typeof createMarkdownIt> } | null = null;
function getMd(app: any) {
  const strict = !!app?.vault?.getConfig?.("strictLineBreaks");
  if (!mdCache || mdCache.strict !== strict) mdCache = { strict, md: createMarkdownIt({ strictLineBreaks: strict }) };
  return mdCache.md;
}

/** Render markdown to an HTML string (no DOM work). Exposed for tests. */
export function renderHtml(markdown: string, opts: { strictLineBreaks?: boolean; lineOffset?: number } = {}): string {
  const md = opts.strictLineBreaks ? createMarkdownIt({ strictLineBreaks: true }) : getMd(null);
  return md.render(markdown, { lineOffset: opts.lineOffset ?? 0, codeBlockProcessors });
}

const SAFE_URL = /^(https?:|mailto:|file:|data:image\/|blob:|obsidian:|#|[^:]*$)/i;

/** Strip scripts, event handlers and javascript: URLs (vault notes can contain raw HTML). */
export function sanitize(root: HTMLElement | DocumentFragment): void {
  root.querySelectorAll("script, iframe[srcdoc], object, base, meta").forEach((e) => e.remove());
  const all = root.querySelectorAll("*");
  for (const el of Array.from(all)) {
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on")) el.removeAttribute(a.name);
      else if ((n === "href" || n === "src" || n === "xlink:href" || n === "action" || n === "formaction") && !SAFE_URL.test(a.value.trim())) el.removeAttribute(a.name);
    }
  }
}

let docCounter = 0;

export class MarkdownRenderer extends MarkdownRenderChild {
  app: any;
  constructor(app: any, containerEl: HTMLElement) {
    super(containerEl);
    this.app = app;
  }

  /** obsidian API: render markdown into `el`. */
  static async render(app: any, markdown: string, el: HTMLElement, sourcePath: string, component: Component): Promise<void> {
    await renderMarkdownInto(app, markdown, el, sourcePath, component, { embedDepth: 0 });
  }

  static async renderMarkdown(markdown: string, el: HTMLElement, sourcePath: string, component: Component): Promise<void> {
    await renderMarkdownInto((window as any).app, markdown, el, sourcePath, component, { embedDepth: 0 });
  }
}

/** Render one line of inline Markdown (a table cell) into `el`, with working links and embeds. */
export function renderInlineMarkdown(app: any, text: string, el: HTMLElement, sourcePath: string): void {
  const tpl = document.createElement("template");
  tpl.innerHTML = getMd(app).renderInline(text, { codeBlockProcessors });
  sanitize(tpl.content);
  el.appendChild(tpl.content);
  el.querySelectorAll<HTMLAnchorElement>("a.internal-link").forEach((a) => {
    const href = a.getAttribute("data-href") ?? "";
    const { path } = parseLinktext(href);
    if (path && !app?.metadataCache?.getFirstLinkpathDest(path, sourcePath)) a.addClass("is-unresolved");
    a.addEventListener("click", (e) => {
      e.preventDefault();
      app?.workspace?.openLinkText(href, sourcePath, Keymap.isModEvent(e));
    });
  });
  el.querySelectorAll<HTMLAnchorElement>("a.external-link").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      app?.openExternal?.(a.href);
    }),
  );
  const comp = new Component();
  comp.load();
  for (const span of Array.from(el.querySelectorAll<HTMLElement>("span.internal-embed"))) void renderEmbed(app, span, sourcePath, comp, 1);
}

export interface RenderOptions {
  embedDepth: number;
  lineOffset?: number;
  frontmatter?: any;
  sourceText?: string;
}

/** Render `markdown` into `el` as Obsidian-style sections and run post processors. */
export async function renderMarkdownInto(app: any, markdown: string, el: HTMLElement, sourcePath: string, component: Component, opts: RenderOptions): Promise<void> {
  const md = getMd(app);
  const html = md.render(markdown, { lineOffset: opts.lineOffset ?? 0, codeBlockProcessors });
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const frag = tpl.content;
  sanitize(frag);
  // One section div per top-level block, like Obsidian's reading view (themes style .el-*).
  const sections: HTMLElement[] = [];
  for (const node of Array.from(frag.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && !node.textContent!.trim()) continue;
    const tag = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement).tagName.toLowerCase() : "p";
    const cls = (node as HTMLElement).classList?.contains("callout") ? "el-div" : (node as HTMLElement).classList?.contains("footnotes") ? "el-section mod-footnotes" : `el-${tag}`;
    const sec = createDiv(cls);
    sec.appendChild(node);
    sections.push(sec);
  }
  for (const s of sections) el.appendChild(s);
  const docId = String(++docCounter);
  const lines = (opts.sourceText ?? markdown).split("\n");
  const ctx: MarkdownPostProcessorContext = {
    docId,
    sourcePath,
    frontmatter: opts.frontmatter ?? null,
    addChild: (c) => component.addChild(c),
    getSectionInfo: (target) => {
      const withLine = target.closest("[data-line]") ?? target.querySelector("[data-line]");
      const start = Number(withLine?.getAttribute("data-line"));
      if (!Number.isFinite(start)) return null;
      const sec = target.closest("[class^='el-']") ?? target;
      const nextSec = sec.nextElementSibling?.querySelector("[data-line]") ?? (sec.nextElementSibling as HTMLElement | null);
      const nextLine = Number(nextSec?.getAttribute?.("data-line"));
      const end = Number.isFinite(nextLine) ? Math.max(start, nextLine - 1) : lines.length - 1;
      return { text: opts.sourceText ?? markdown, lineStart: start, lineEnd: end };
    },
  };
  await postProcess(app, el, sourcePath, component, opts, ctx);
}

export async function postProcess(app: any, el: HTMLElement, sourcePath: string, component: Component, opts: RenderOptions, ctx: MarkdownPostProcessorContext, sections?: HTMLElement[]): Promise<void> {
  // Internal links
  el.querySelectorAll<HTMLAnchorElement>("a.internal-link").forEach((a) => {
    const href = a.getAttribute("data-href") ?? "";
    const { path } = parseLinktext(href);
    if (path && !app?.metadataCache?.getFirstLinkpathDest(path, sourcePath)) a.addClass("is-unresolved");
    a.addEventListener("click", (e) => {
      e.preventDefault();
      app?.workspace?.openLinkText(href, sourcePath, Keymap.isModEvent(e));
    });
    a.addEventListener("auxclick", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        app?.workspace?.openLinkText(href, sourcePath, "tab");
      }
    });
    a.addEventListener("mouseover", (e) => app?.workspace?.trigger("hover-link", { event: e, source: "preview", hoverParent: component, targetEl: a, linktext: href, sourcePath }));
  });
  el.querySelectorAll<HTMLAnchorElement>("a.external-link").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      app?.openExternal?.(a.href);
    });
  });
  el.querySelectorAll<HTMLAnchorElement>("a.tag").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      app?.commands?.executeCommandById?.("global-search:open");
      app?.workspace?.trigger("search:tag", a.getText());
    });
  });
  // Callouts: icon + folding
  el.querySelectorAll<HTMLElement>(".callout").forEach((c) => decorateCallout(c));
  // Code blocks
  el.querySelectorAll<HTMLElement>("pre > code").forEach((code) => {
    const pre = code.parentElement!;
    const lang = (code.className.match(/language-([\w+#-]+)/) ?? [])[1];
    if (lang) highlightCodeInto(code, code.textContent ?? "", lang);
    const btn = pre.createEl("button", { cls: "copy-code-button", text: "Copy" });
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(code.textContent ?? "");
      btn.setText("Copied!");
      setTimeout(() => btn.setText("Copy"), 1200);
    });
  });
  // Plugin code block processors
  for (const div of Array.from(el.querySelectorAll<HTMLElement>("[data-codeblock-lang]"))) {
    const lang = div.getAttribute("data-codeblock-lang")!;
    const src = div.getAttribute("data-source") ?? "";
    div.removeAttribute("data-source");
    try {
      await codeBlockProcessors[lang]?.(src, div, ctx);
    } catch (e) {
      console.error(e);
    }
  }
  // Mermaid
  const mer = el.querySelectorAll<HTMLElement>(".mermaid-pending");
  if (mer.length) renderMermaid(Array.from(mer));
  // Embeds
  for (const span of Array.from(el.querySelectorAll<HTMLElement>("span.internal-embed"))) {
    await renderEmbed(app, span, sourcePath, component, opts.embedDepth);
  }
  // Plugin post processors
  const sorted = postProcessors.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  for (const sec of sections ?? (Array.from(el.children) as HTMLElement[])) {
    for (const pp of sorted) {
      try {
        await pp(sec, ctx);
      } catch (e) {
        console.error("Markdown post processor failed", e);
      }
    }
  }
}

const CALLOUT_ICONS: Record<string, string> = {
  note: "pencil",
  abstract: "clipboard-list",
  summary: "clipboard-list",
  tldr: "clipboard-list",
  info: "info",
  todo: "circle-check",
  tip: "flame",
  hint: "flame",
  important: "flame",
  success: "check",
  check: "check",
  done: "check",
  question: "circle-help",
  help: "circle-help",
  faq: "circle-help",
  warning: "triangle-alert",
  caution: "triangle-alert",
  attention: "triangle-alert",
  failure: "x",
  fail: "x",
  missing: "x",
  danger: "zap",
  error: "zap",
  bug: "bug",
  example: "list",
  quote: "quote",
  cite: "quote",
};

export function decorateCallout(c: HTMLElement): void {
  const type = c.getAttribute("data-callout") ?? "note";
  const icon = c.querySelector<HTMLElement>(":scope > .callout-title > .callout-icon");
  if (icon && !icon.firstChild) setIcon(icon, CALLOUT_ICONS[type] ?? "pencil");
  const fold = c.querySelector<HTMLElement>(":scope > .callout-title > .callout-fold");
  if (fold && !fold.firstChild) setIcon(fold, "chevron-down");
  if (c.hasClass("is-collapsible")) {
    const title = c.querySelector<HTMLElement>(":scope > .callout-title")!;
    title.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("a")) return;
      const content = c.querySelector<HTMLElement>(":scope > .callout-content");
      const collapsed = !c.hasClass("is-collapsed");
      c.toggleClass("is-collapsed", collapsed);
      fold?.toggleClass("is-collapsed", collapsed);
      if (content) content.style.display = collapsed ? "none" : "";
    });
  }
}

// ---------- mermaid ----------
let mermaidPromise: Promise<any> | null = null;
export function loadMermaid(): Promise<any> {
  if ((window as any).mermaid) return Promise.resolve((window as any).mermaid);
  mermaidPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "vendor/mermaid.min.js";
    s.onload = () => {
      const m = (window as any).mermaid;
      const dark = document.body.hasClass("theme-dark");
      m.initialize({ startOnLoad: false, theme: dark ? "dark" : "default", securityLevel: "strict" });
      resolve(m);
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return mermaidPromise;
}

let mermaidId = 0;
async function renderMermaid(els: HTMLElement[]): Promise<void> {
  try {
    const m = await loadMermaid();
    for (const el of els) {
      const src = el.getAttribute("data-source") ?? "";
      el.className = "mermaid";
      try {
        const { svg } = await m.render("bedrock-mermaid-" + ++mermaidId, src);
        el.innerHTML = svg;
      } catch (e: any) {
        el.addClass("mermaid-error");
        el.setText(String(e?.message ?? e));
      }
    }
  } catch (e) {
    for (const el of els) el.setText("Mermaid failed to load.");
  }
}

// ---------- embeds ----------
const MAX_EMBED_DEPTH = 5;

export async function renderEmbed(app: any, span: HTMLElement, sourcePath: string, component: Component, depth: number): Promise<void> {
  const src = span.getAttribute("src") ?? "";
  const alt = span.getAttribute("alt") ?? "";
  const { path, subpath } = parseLinktext(src);
  const file: TFile | null = app?.metadataCache?.getFirstLinkpathDest(path, sourcePath) ?? null;
  span.empty();
  if (!file) {
    span.addClass("file-embed", "mod-empty");
    span.createDiv({ cls: "file-embed-title", text: `"${path || src}" could not be found.` });
    if (path) {
      span.addEventListener("click", () => app.workspace.openLinkText(src, sourcePath));
    }
    return;
  }
  const ext = file.extension;
  const sizeM = alt.match(/(?:^|\|)(\d+)(?:x(\d+))?$/);
  if (IMAGE_EXTS.includes(ext)) {
    span.addClass("media-embed", "image-embed", "is-loaded");
    const img = span.createEl("img", { attr: { src: app.vault.getResourcePath(file), alt: sizeM ? alt.replace(/\|?\d+(x\d+)?$/, "") || file.name : alt || file.name } });
    if (sizeM) {
      img.setAttr("width", sizeM[1]);
      if (sizeM[2]) img.setAttr("height", sizeM[2]);
    }
    return;
  }
  if (AUDIO_EXTS.includes(ext)) {
    span.addClass("media-embed", "is-loaded");
    span.createEl("audio", { attr: { controls: true, src: app.vault.getResourcePath(file) } });
    return;
  }
  if (VIDEO_EXTS.includes(ext)) {
    span.addClass("media-embed", "is-loaded");
    span.createEl("video", { attr: { controls: true, src: app.vault.getResourcePath(file) } });
    return;
  }
  if (ext === "pdf") {
    span.addClass("pdf-embed", "is-loaded");
    span.createEl("iframe", { attr: { src: app.vault.getResourcePath(file).split("?")[0] + (subpath ? subpath.replace(/^#/, "#") : ""), style: "width:100%;height:600px;border:0" } });
    return;
  }
  if (ext !== "md") {
    span.addClass("file-embed", "is-loaded");
    const t = span.createDiv("file-embed-title");
    setIcon(t.createSpan("file-embed-icon"), "file");
    t.appendText(" " + file.name);
    span.addEventListener("click", () => app.workspace.getLeaf(false).openFile(file));
    return;
  }
  // Note embed (whole note, heading section or block).
  span.addClass("markdown-embed", "inline-embed", "is-loaded");
  if (depth >= MAX_EMBED_DEPTH) {
    span.createDiv({ cls: "markdown-embed-content", text: "(embed depth limit reached)" });
    return;
  }
  const link = span.createDiv({ cls: "markdown-embed-link", attr: { "aria-label": "Open link" } });
  setIcon(link, "link");
  link.addEventListener("click", (e) => {
    e.stopPropagation();
    app.workspace.openLinkText(src, sourcePath, Keymap.isModEvent(e));
  });
  const content = span.createDiv("markdown-embed-content");
  const preview = content.createDiv("markdown-preview-view markdown-rendered");
  let text: string = await app.vault.cachedRead(file);
  const cache = app.metadataCache.getFileCache(file);
  let lineOffset = 0;
  if (subpath && cache) {
    const r = resolveSubpath(cache, subpath);
    if (!r) {
      preview.createDiv({ cls: "markdown-embed-empty", text: `Unable to find section ${subpath} in ${file.basename}` });
      return;
    }
    const start = r.type === "block" ? (r.list ? r.list.position.start.offset : r.block.position.start.offset) : r.start.offset;
    const end = r.type === "block" ? (r.list ? r.list.position.end.offset : r.block.position.end.offset) : r.end ? r.end.offset : text.length;
    lineOffset = r.start.line;
    text = text.slice(start, end);
    if (r.type === "block") text = text.replace(/\s\^[A-Za-z0-9-]+\s*$/, "");
  } else {
    const fm = getFrontMatterInfo(text);
    if (fm.exists) {
      lineOffset = text.slice(0, fm.contentStart).split("\n").length - 1;
      text = text.slice(fm.contentStart);
    }
    preview.createDiv({ cls: "embed-title markdown-embed-title", text: "" });
  }
  // Guard against an embed including itself.
  if (file.path === sourcePath && !subpath) {
    preview.createDiv({ text: "(a note can't embed itself)" });
    return;
  }
  const inner = preview.createDiv("markdown-preview-sizer markdown-preview-section");
  await renderMarkdownInto(app, text, inner, file.path, component, { embedDepth: depth + 1, lineOffset, sourceText: text });
}

export { escapeHtml };
