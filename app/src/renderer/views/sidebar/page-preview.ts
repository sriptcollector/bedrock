// Page preview: hovering an internal link (with Ctrl/Cmd, per source as set in page-preview.json)
// shows a popover with the linked note rendered (properties collapsed, heading/block subpaths
// scrolled into view) and an "Open link" button. Listens to the workspace "hover-link" event,
// which reading view, the sidebar panes and plugins trigger; live preview links are wired here.
import { Component } from "../../api/events";
import { setIcon } from "../../dom/icons";
import { Keymap } from "../../commands/keymap";
import { TFile } from "../../vault/files";
import { renderMarkdownInto } from "../../markdown/renderer";
import { resolveSubpath } from "../../metadata/cache";
import { parseLinktext, getLinkpath } from "../../../core/links";
import { getFrontMatterInfo, parseYaml } from "../../../core/parse";
import { PropertiesEditor } from "../../editor/properties";
import { IMAGE_EXTS } from "../simple-views";

/** Hover sources and whether they need Ctrl by default (setting "Require Ctrl ..."). */
export const HOVER_SOURCES: Record<string, { display: string; defaultMod: boolean }> = {
  search: { display: "Search, Backlinks, and Outgoing links", defaultMod: true },
  preview: { display: "Reading view", defaultMod: false },
  editor: { display: "Editing view", defaultMod: true },
  "tab-header": { display: "Tab header", defaultMod: true },
  "file-explorer": { display: "Files", defaultMod: true },
  properties: { display: "Properties view", defaultMod: true },
  bookmarks: { display: "Bookmarks", defaultMod: true },
  outline: { display: "Outline", defaultMod: true },
  bases: { display: "Bases", defaultMod: true },
  graph: { display: "Graph view", defaultMod: true },
};
const ALIAS: Record<string, string> = { backlink: "search", "outgoing-link": "search", "tag-pane": "search" };

interface HoverInfo {
  event: MouseEvent;
  source: string;
  hoverParent: any;
  targetEl: HTMLElement | null;
  linktext: string;
  sourcePath?: string;
  state?: any;
}

const SHOW_DELAY = 300;
const HIDE_DELAY = 300;

export class PagePreview extends Component {
  settings: Record<string, boolean> = {};
  private popover: HTMLElement | null = null;
  private popComp: Component | null = null;
  private showTimer: any = null;
  private hideTimer: any = null;
  private pending: HoverInfo | null = null;
  private currentTarget: HTMLElement | null = null;
  private lastMouse: MouseEvent | null = null;

  constructor(private app: any) {
    super();
  }

  async onload(): Promise<void> {
    try {
      this.settings = JSON.parse(await this.app.vault.adapter.read(this.app.vault.configDir + "/page-preview.json")) ?? {};
    } catch {
      this.settings = {};
    }
    const ws = this.app.workspace;
    ws.hoverLinkSources = { ...HOVER_SOURCES, ...(ws.hoverLinkSources ?? {}) };
    this.registerEvent(ws.on("hover-link", (info: HoverInfo) => this.onHover(info)));
    // A Ctrl press while already hovering shows the preview.
    this.registerDomEvent(window, "keydown", (e: KeyboardEvent) => {
      if ((e.key === "Control" || e.key === "Meta") && this.pending) this.schedule(this.pending, true);
    });
    this.registerDomEvent(document, "mousemove", (e: MouseEvent) => (this.lastMouse = e));
    // Internal links in the editor (live preview / source) have no hover event of their own.
    this.registerDomEvent(document, "mouseover", (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      const link = t.closest?.(".cm-hmd-internal-link, .cm-underline.cm-hmd-internal-link") as HTMLElement | null;
      if (!link) return;
      let v: any = null;
      ws.iterateAllLeaves((l: any) => {
        if (!v && l.view?.containerEl?.contains(link)) v = l.view;
      });
      const linktext = editorLinktextAt(v, link);
      if (!linktext) return;
      ws.trigger("hover-link", { event: e, source: "editor", hoverParent: v, targetEl: link, linktext, sourcePath: v?.file?.path ?? "" });
    });
    this.register(() => this.hide(true));
  }

  requiresMod(source: string): boolean {
    const key = ALIAS[source] ?? source;
    if (typeof this.settings[key] === "boolean") return this.settings[key];
    const info = this.app.workspace.hoverLinkSources?.[key] ?? HOVER_SOURCES[key];
    return info ? !!info.defaultMod : true;
  }

  async setRequiresMod(source: string, v: boolean): Promise<void> {
    this.settings[source] = v;
    await this.app.vault.adapter.write(this.app.vault.configDir + "/page-preview.json", JSON.stringify(this.settings, null, 2));
  }

  private onHover(info: HoverInfo): void {
    if (!info?.linktext || !info.event) return;
    if (this.popover && info.targetEl && info.targetEl === this.currentTarget) {
      clearTimeout(this.hideTimer);
      return;
    }
    this.pending = info;
    info.targetEl?.addEventListener(
      "mouseleave",
      () => {
        if (this.pending === info) this.pending = null;
        clearTimeout(this.showTimer);
        this.scheduleHide();
      },
      { once: true },
    );
    this.schedule(info, false);
  }

  private schedule(info: HoverInfo, fromKey: boolean): void {
    const needMod = this.requiresMod(info.source);
    const modDown = fromKey || Keymap.isModEvent(this.lastMouse ?? info.event) || info.event.ctrlKey || info.event.metaKey;
    if (needMod && !modDown) return;
    clearTimeout(this.showTimer);
    this.showTimer = setTimeout(() => this.show(info), fromKey ? 0 : SHOW_DELAY);
  }

  private scheduleHide(): void {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (this.popover?.matches(":hover")) return this.scheduleHide();
      if (this.currentTarget?.matches(":hover")) return this.scheduleHide();
      this.hide();
    }, HIDE_DELAY);
  }

  hide(now = false): void {
    clearTimeout(this.showTimer);
    clearTimeout(this.hideTimer);
    if (this.popComp) {
      this.popComp.unload();
      this.popComp = null;
    }
    this.popover?.remove();
    this.popover = null;
    this.currentTarget = null;
    void now;
  }

  async show(info: HoverInfo): Promise<void> {
    const { path, subpath } = parseLinktext(info.linktext);
    const file: TFile | null = path ? this.app.metadataCache.getFirstLinkpathDest(getLinkpath(path), info.sourcePath ?? "") : this.app.vault.getFileByPath(info.sourcePath ?? "");
    if (!file) return;
    if (info.targetEl && !info.targetEl.isConnected) return;
    this.hide(true);
    const pop = document.body.createDiv("popover hover-popover");
    this.popover = pop;
    this.currentTarget = info.targetEl;
    const comp = new Component();
    comp.load();
    this.popComp = comp;
    const embed = pop.createDiv("markdown-embed");
    const content = embed.createDiv("markdown-embed-content node-insert-event");
    const linkBtn = embed.createDiv({ cls: "markdown-embed-link", attr: { "aria-label": "Open link" } });
    setIcon(linkBtn, "maximize-2");
    linkBtn.addEventListener("click", (e) => {
      this.hide(true);
      this.app.workspace.openLinkText(info.linktext, info.sourcePath ?? "", Keymap.isModEvent(e) ? "tab" : false);
    });
    pop.addEventListener("mouseleave", () => this.scheduleHide());
    pop.addEventListener("mouseenter", () => clearTimeout(this.hideTimer));
    this.position(pop, info);
    if (IMAGE_EXTS.includes(file.extension)) {
      content.createEl("img", { cls: "popover-image", attr: { src: this.app.vault.getResourcePath(file) } });
      embed.addClass("is-loaded");
      return;
    }
    if (file.extension !== "md") {
      content.createDiv({ cls: "popover-empty", text: file.name });
      embed.addClass("is-loaded");
      return;
    }
    const text: string = await this.app.vault.cachedRead(file);
    if (this.popover !== pop) return;
    const view = content.createDiv("markdown-preview-view markdown-rendered node-insert-event show-indentation-guide allow-fold-headings allow-fold-lists show-properties");
    const sizer = view.createDiv("markdown-preview-sizer markdown-preview-section");
    sizer.createDiv({ cls: "markdown-preview-pusher", attr: { style: "width: 1px; height: 0.1px; margin-bottom: 0px;" } });
    const header = sizer.createDiv("mod-header mod-ui");
    header.createDiv({ cls: "inline-title", text: file.basename });
    const fmInfo = getFrontMatterInfo(text);
    let fm: any = null;
    try {
      fm = fmInfo.exists ? parseYaml(fmInfo.frontmatter) : null;
    } catch {
      fm = null;
    }
    let body = fmInfo.exists ? text.slice(fmInfo.contentStart) : text;
    let lineOffset = fmInfo.exists ? text.slice(0, fmInfo.contentStart).split("\n").length - 1 : 0;
    if (subpath) {
      const cache = this.app.metadataCache.getFileCache(file);
      const r = cache ? resolveSubpath(cache, subpath) : null;
      if (r) {
        const start = r.start.offset;
        const end = r.end ? (typeof r.end === "number" ? r.end : r.end.offset) : text.length;
        body = text.slice(start, end);
        lineOffset = r.start.line;
        fm = null;
      }
    }
    if (fm && typeof fm === "object" && Object.keys(fm).length && this.app.vault.getConfig("propertiesInDocument") !== "hidden") {
      const pe = new PropertiesEditor(this.app, (next) => this.app.fileManager.processFrontMatter(file, (front: any) => {
        for (const k of Object.keys(front)) delete front[k];
        Object.assign(front, next);
      }));
      pe.setFrontmatter(fm);
      pe.collapsed = true;
      pe.el.addClass("is-collapsed");
      pe.el.setAttr("data-property-count", String(Object.keys(fm).length));
      header.appendChild(pe.el);
    }
    await renderMarkdownInto(this.app, body, sizer, file.path, comp, { embedDepth: 1, lineOffset, frontmatter: fm, sourceText: text });
    if (this.popover !== pop) return;
    embed.addClass("is-loaded");
    this.position(pop, info);
  }

  private position(pop: HTMLElement, info: HoverInfo): void {
    const r = (info.targetEl ?? (info.event.target as HTMLElement)).getBoundingClientRect();
    const W = window.innerWidth;
    const H = window.innerHeight;
    const w = pop.offsetWidth || 452;
    const h = pop.offsetHeight || 402;
    let left = r.left - 80;
    left = Math.max(8, Math.min(left, W - w - 8));
    pop.style.left = `${left}px`;
    if (r.top - 10 >= h || r.top > H - r.bottom) {
      pop.style.bottom = `${H - r.top + 10}px`;
      pop.style.top = "";
    } else {
      pop.style.top = `${r.bottom + 10}px`;
      pop.style.bottom = "";
    }
  }
}

/** Recover the [[link]] text under an editor link element from the document. */
function editorLinktextAt(view: any, el: HTMLElement): string | null {
  const cm = view?.cm ?? view?.editor?.cm;
  if (!cm) return null;
  let pos: number;
  try {
    pos = cm.posAtDOM(el, 0);
  } catch {
    return null;
  }
  const line = cm.state.doc.lineAt(pos);
  const text: string = line.text;
  const at = pos - line.from;
  const re = /!?\[\[([^\]]+?)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (at >= m.index && at <= m.index + m[0].length) return m[1].split("|")[0];
  }
  return null;
}
