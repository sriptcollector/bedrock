// Canvas cards (text, file, link, group) and edges: their DOM (Obsidian's class names, so themes and
// plugins can style them) and content rendering. The Canvas controller (canvas.ts) owns layout,
// selection and input; these classes only draw.
import { Component } from "../../api/events";
import { setIcon } from "../../dom/icons";
import { Keymap } from "../../commands/keymap";
import { renderMarkdownInto } from "../../markdown/renderer";
import { getFrontMatterInfo, parseYaml } from "../../../core/parse";
import { PropertiesEditor } from "../../editor/properties";
import { resolveSubpath } from "../../metadata/cache";
import { buildEditorExtensions, configFromVault } from "../../editor/extensions";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { bboxOf, edgeGeometry, autoSide, bezierPoint, END_ROTATION, type BBox } from "./geometry";
import { normalizeColor, type CanvasEdgeData, type CanvasNodeData, type EdgeEnd, type Side } from "./format";
import type { Canvas } from "./canvas";

export const IMAGE_EXTS = ["bmp", "png", "jpg", "jpeg", "gif", "svg", "webp", "avif"];
export const AUDIO_EXTS = ["mp3", "wav", "m4a", "3gp", "flac", "ogg", "oga", "opus"];
export const VIDEO_EXTS = ["mp4", "webm", "ogv", "mov", "mkv"];

export function applyColor(el: Element, color: string | undefined): void {
  const c = normalizeColor(color);
  for (let i = 1; i <= 6; i++) el.classList.remove(`mod-canvas-color-${i}`);
  (el as HTMLElement).style?.removeProperty?.("--canvas-color");
  el.classList.toggle("is-themed", !!c);
  if (!c) return;
  if (/^[1-6]$/.test(c)) el.classList.add(`mod-canvas-color-${c}`);
  else (el as HTMLElement).style.setProperty("--canvas-color", c);
}

export abstract class CanvasNode extends Component {
  canvas: Canvas;
  data: CanvasNodeData;
  nodeEl: HTMLElement;
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  placeholderEl: HTMLElement;
  blockerEl: HTMLElement | null = null;
  labelEl: HTMLElement | null = null;
  zIndex = 0;
  isEditing = false;
  initialized = false;
  protected renderComp: Component | null = null;

  constructor(canvas: Canvas, data: CanvasNodeData) {
    super();
    this.canvas = canvas;
    this.data = data;
    this.nodeEl = createDiv("canvas-node");
    this.containerEl = this.nodeEl.createDiv("canvas-node-container");
    this.contentEl = this.containerEl.createDiv("canvas-node-content");
    this.placeholderEl = this.containerEl.createDiv("canvas-node-placeholder");
    (this.nodeEl as any).__canvasNode = this;
  }

  get id(): string {
    return this.data.id;
  }
  get app(): any {
    return this.canvas.app;
  }
  get x(): number {
    return this.data.x;
  }
  get y(): number {
    return this.data.y;
  }
  get width(): number {
    return this.data.width;
  }
  get height(): number {
    return this.data.height;
  }
  getBBox(): BBox {
    return bboxOf(this.data);
  }

  /** Position, size, colour and stacking. Cheap; called whenever the node moves. */
  renderFrame(): void {
    const s = this.nodeEl.style;
    s.transform = `translate(${this.x}px, ${this.y}px)`;
    s.width = this.width + "px";
    s.height = this.height + "px";
    s.setProperty("--canvas-node-width", this.width + "px");
    s.setProperty("--canvas-node-height", this.height + "px");
    s.zIndex = String(this.renderZ());
    applyColor(this.nodeEl, this.data.color);
  }

  renderZ(): number {
    return this.zIndex;
  }

  /** Build the content (first render) or refresh it after the data changed. */
  abstract renderContent(): void | Promise<void>;

  isEditable(): boolean {
    return false;
  }
  startEditing(): void {}
  stopEditing(): void {}
  /** Label shown above the card (file name, web address), or null. */
  getLabel(): string | null {
    return null;
  }

  renderLabel(): void {
    const label = this.getLabel();
    if (label === null) {
      this.labelEl?.remove();
      this.labelEl = null;
      return;
    }
    if (!this.labelEl) this.labelEl = this.nodeEl.createDiv("canvas-node-label");
    this.labelEl.setText(label);
  }

  protected ensureBlocker(): void {
    if (!this.blockerEl) this.blockerEl = this.containerEl.createDiv("canvas-node-content-blocker");
  }

  protected freshRenderComponent(): Component {
    if (this.renderComp) this.removeChild(this.renderComp);
    this.renderComp = this.addChild(new Component());
    return this.renderComp;
  }

  destroy(): void {
    this.stopEditing();
    this.unload();
    this.nodeEl.remove();
  }
}

/** Markdown text card. Double click edits it in place with the note editor. */
export class TextNode extends CanvasNode {
  editor: EditorView | null = null;
  private previewEl: HTMLElement | null = null;
  private renderedText: string | null = null;

  constructor(canvas: Canvas, data: CanvasNodeData) {
    super(canvas, data);
    this.contentEl.addClass("markdown-embed");
    setIcon(this.placeholderEl.createDiv("canvas-icon-placeholder"), "align-left");
    this.ensureBlocker();
  }

  isEditable(): boolean {
    return true;
  }

  async renderContent(): Promise<void> {
    if (this.isEditing) return;
    const text = this.data.text ?? "";
    if (this.renderedText === text && this.previewEl) return;
    this.renderedText = text;
    this.contentEl.empty();
    const embed = this.contentEl.createDiv("markdown-embed-content node-insert-event");
    const pv = (this.previewEl = embed.createDiv("markdown-preview-view markdown-rendered node-insert-event show-indentation-guide allow-fold-headings allow-fold-lists"));
    const sizer = pv.createDiv("markdown-preview-sizer markdown-preview-section");
    const comp = this.freshRenderComponent();
    await renderMarkdownInto(this.app, text, sizer, this.canvas.filePath, comp, { embedDepth: 1, sourceText: text });
    wireLinks(this.canvas, sizer);
  }

  startEditing(): void {
    if (this.isEditing || this.canvas.readonly) return;
    this.isEditing = true;
    this.nodeEl.addClass("is-editing");
    this.contentEl.empty();
    this.previewEl = null;
    this.renderedText = null;
    const host = this.contentEl.createDiv("markdown-source-view cm-s-obsidian mod-cm6 node-insert-event is-live-preview is-readable-line-width");
    const owner = { app: this.app, file: this.canvas.file, canvasNode: this };
    const exts = buildEditorExtensions(owner, configFromVault(this.app.vault), !!this.app.vault.getConfig?.("livePreview") || this.app.vault.getConfig?.("livePreview") === undefined, []);
    exts.push(
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          this.data.text = u.state.doc.toString();
          this.canvas.requestSave();
        }
      }),
    );
    this.editor = new EditorView({ parent: host, state: EditorState.create({ doc: this.data.text ?? "", extensions: exts }) });
    // Obsidian-shaped DOM for themes: .cm-scroller > .cm-sizer > .cm-contentContainer > .cm-content
    const sizer = createDiv("cm-sizer");
    const cc = sizer.createDiv("cm-contentContainer");
    this.editor.scrollDOM.insertBefore(sizer, this.editor.contentDOM);
    cc.appendChild(this.editor.contentDOM);
    this.editor.focus();
    const end = this.editor.state.doc.length;
    this.editor.dispatch({ selection: { anchor: end } });
  }

  stopEditing(): void {
    if (!this.isEditing) return;
    this.isEditing = false;
    this.nodeEl.removeClass("is-editing");
    if (this.editor) {
      this.data.text = this.editor.state.doc.toString();
      this.editor.destroy();
      this.editor = null;
    }
    this.canvas.pushHistorySoon();
    void this.renderContent();
  }
}

/** A vault file: notes render (and edit on double click), images/audio/video/PDF embed. */
export class FileNode extends CanvasNode {
  file: any = null;
  editor: EditorView | null = null;
  private renderedKey = "";
  private props: PropertiesEditor | null = null;
  private saveTimer: any = null;

  constructor(canvas: Canvas, data: CanvasNodeData) {
    super(canvas, data);
    this.resolve();
  }

  resolve(): void {
    this.file = this.data.file ? this.app.vault.getFileByPath(this.data.file) : null;
  }

  get ext(): string {
    const p = this.data.file ?? "";
    return p.slice(p.lastIndexOf(".") + 1).toLowerCase();
  }

  isEditable(): boolean {
    return !!this.file && this.file.extension === "md";
  }

  isMedia(): boolean {
    return IMAGE_EXTS.includes(this.ext);
  }

  getLabel(): string | null {
    if (!this.data.file) return null;
    const name = this.data.file.split("/").pop()!;
    const base = name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
    return base + (this.data.subpath ?? "");
  }

  async renderContent(force = false): Promise<void> {
    if (this.isEditing) return;
    this.resolve();
    const key = `${this.data.file}|${this.data.subpath ?? ""}|${this.file?.stat?.mtime ?? 0}`;
    if (!force && key === this.renderedKey) return;
    this.renderedKey = key;
    this.renderLabel();
    const c = this.contentEl;
    c.empty();
    c.className = "canvas-node-content";
    this.placeholderEl.empty();
    this.placeholderEl.setText(this.getLabel() ?? "");
    this.nodeEl.toggleClass("mod-media", this.isMedia());
    const f = this.file;
    if (!f) {
      c.addClass("file-embed", "mod-empty");
      c.createDiv({ cls: "file-embed-title", text: `"${this.data.file}" could not be found.` });
      this.ensureBlocker();
      return;
    }
    const src = this.app.vault.getResourcePath(f);
    const ext = f.extension.toLowerCase();
    if (IMAGE_EXTS.includes(ext)) {
      c.addClass("media-embed", "image-embed", "is-loaded");
      c.createEl("img", { attr: { src, draggable: "false" } });
    } else if (AUDIO_EXTS.includes(ext)) {
      c.addClass("media-embed", "is-loaded");
      c.createEl("audio", { attr: { src, controls: true } });
    } else if (VIDEO_EXTS.includes(ext)) {
      c.addClass("media-embed", "is-loaded");
      c.createEl("video", { attr: { src, controls: true } });
    } else if (ext === "pdf") {
      c.addClass("pdf-embed", "is-loaded");
      c.createEl("iframe", { attr: { src: src.split("?")[0] + (this.data.subpath ?? "") } });
    } else if (ext === "md") {
      await this.renderNote();
    } else {
      c.addClass("file-embed", "is-loaded");
      const t = c.createDiv("file-embed-title");
      setIcon(t.createSpan("file-embed-icon"), "file");
      t.appendText(" " + f.name);
    }
    this.ensureBlocker();
  }

  private async renderNote(): Promise<void> {
    const c = this.contentEl;
    c.addClass("markdown-embed", "is-loaded");
    const embed = c.createDiv("markdown-embed-content node-insert-event");
    const pv = embed.createDiv("markdown-preview-view markdown-rendered node-insert-event show-indentation-guide allow-fold-headings allow-fold-lists");
    const link = c.createDiv({ cls: "markdown-embed-link", attr: { "aria-label": "Open link" } });
    setIcon(link, "maximize-2");
    link.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.app.workspace.openLinkText(this.data.file + (this.data.subpath ?? ""), this.canvas.filePath, Keymap.isModEvent(e));
    });
    const sizer = pv.createDiv("markdown-preview-sizer markdown-preview-section");
    let text: string = await this.app.vault.cachedRead(this.file);
    const comp = this.freshRenderComponent();
    const subpath = this.data.subpath;
    if (subpath) {
      const cache = this.app.metadataCache.getFileCache(this.file);
      const r = cache ? resolveSubpath(cache, subpath) : null;
      if (r) {
        const start = r.type === "block" ? (r.list ? r.list.position.start.offset : r.block.position.start.offset) : r.start.offset;
        const end = r.type === "block" ? (r.list ? r.list.position.end.offset : r.block.position.end.offset) : r.end ? r.end.offset : text.length;
        text = text.slice(start, end);
      }
      await renderMarkdownInto(this.app, text, sizer, this.file.path, comp, { embedDepth: 1, sourceText: text });
    } else {
      pv.addClass("show-properties");
      sizer.createDiv({ cls: "inline-title", text: this.file.basename });
      const fm = getFrontMatterInfo(text);
      let frontmatter: any = null;
      try {
        frontmatter = fm.exists ? parseYaml(fm.frontmatter) : null;
      } catch {
        frontmatter = null;
      }
      if (frontmatter && typeof frontmatter === "object" && Object.keys(frontmatter).length && this.app.vault.getConfig?.("propertiesInDocument") !== "hidden") {
        const file = this.file;
        this.props = new PropertiesEditor(this.app, (next) => {
          void this.app.fileManager.processFrontMatter(file, (cur: any) => {
            for (const k of Object.keys(cur)) delete cur[k];
            Object.assign(cur, next);
          });
        });
        this.props.setFrontmatter(frontmatter);
        sizer.createDiv("metadata-container-wrapper").appendChild(this.props.el);
      }
      const body = fm.exists ? text.slice(fm.contentStart) : text;
      const holder = createDiv();
      await renderMarkdownInto(this.app, body, holder, this.file.path, comp, { embedDepth: 1, frontmatter, sourceText: text });
      while (holder.firstChild) sizer.appendChild(holder.firstChild);
    }
    wireLinks(this.canvas, sizer, this.file.path);
  }

  startEditing(): void {
    if (this.isEditing || this.canvas.readonly || !this.isEditable()) return;
    this.isEditing = true;
    this.nodeEl.addClass("is-editing");
    const file = this.file;
    void (async () => {
      const text: string = await this.app.vault.read(file);
      if (!this.isEditing) return;
      this.contentEl.empty();
      this.contentEl.className = "canvas-node-content markdown-embed";
      const host = this.contentEl.createDiv("markdown-source-view cm-s-obsidian mod-cm6 node-insert-event is-live-preview");
      const owner = { app: this.app, file, canvasNode: this };
      const exts = buildEditorExtensions(owner, configFromVault(this.app.vault), true, []);
      exts.push(
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          clearTimeout(this.saveTimer);
          const doc = u.state.doc.toString();
          this.saveTimer = setTimeout(() => this.app.vault.modify(file, doc), 400);
        }),
      );
      this.editor = new EditorView({ parent: host, state: EditorState.create({ doc: text, extensions: exts }) });
      const sizer = createDiv("cm-sizer");
      const cc = sizer.createDiv("cm-contentContainer");
      this.editor.scrollDOM.insertBefore(sizer, this.editor.contentDOM);
      cc.appendChild(this.editor.contentDOM);
      this.editor.focus();
    })();
  }

  stopEditing(): void {
    if (!this.isEditing) return;
    this.isEditing = false;
    this.nodeEl.removeClass("is-editing");
    if (this.editor) {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
        void this.app.vault.modify(this.file, this.editor.state.doc.toString());
      }
      this.editor.destroy();
      this.editor = null;
    }
    this.renderedKey = "";
    void this.renderContent(true);
  }
}

/** A web page card (iframe; the page is sandboxed and can't reach the app). */
export class LinkNode extends CanvasNode {
  frameEl: HTMLIFrameElement | null = null;
  private renderedUrl = "";
  title = "";

  constructor(canvas: Canvas, data: CanvasNodeData) {
    super(canvas, data);
    setIcon(this.placeholderEl.createDiv("canvas-icon-placeholder"), "globe");
    this.ensureBlocker();
  }

  getLabel(): string | null {
    return this.title || this.data.url || "";
  }

  renderContent(): void {
    const url = this.data.url ?? "";
    this.renderLabel();
    if (url === this.renderedUrl && this.frameEl) return;
    this.renderedUrl = url;
    this.contentEl.empty();
    if (!/^https?:\/\//i.test(url)) {
      this.contentEl.addClass("file-embed", "mod-empty");
      this.contentEl.createDiv({ cls: "file-embed-title", text: url ? `Can't show "${url}"` : "No web address" });
      return;
    }
    const f = (this.frameEl = this.contentEl.createEl("iframe", {
      cls: "canvas-link",
      attr: { src: url, sandbox: "allow-scripts allow-same-origin allow-forms allow-popups", referrerpolicy: "no-referrer", loading: "lazy", allow: "fullscreen" },
    }));
    void pageTitle(url).then((t) => {
      if (t && this.renderedUrl === url) {
        this.title = t;
        this.renderLabel();
      }
    });
  }
}

const titleCache = new Map<string, Promise<string>>();

/** The <title> of a web page (fetched with Node so cross-origin pages work), cached per address. */
export function pageTitle(url: string): Promise<string> {
  let p = titleCache.get(url);
  if (!p) {
    p = fetchTitle(url, 3).catch(() => "");
    titleCache.set(url, p);
  }
  return p;
}

function fetchTitle(url: string, redirects: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let mod: any;
    try {
      mod = url.startsWith("https:") ? require("node:https") : require("node:http");
    } catch {
      return resolve("");
    }
    const req = mod.get(url, { headers: { "user-agent": "Mozilla/5.0", accept: "text/html" }, timeout: 6000 }, (res: any) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(fetchTitle(new URL(res.headers.location, url).toString(), redirects - 1));
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => {
        body += c;
        const m = /<title[^>]*>([^<]*)<\/title>/i.exec(body);
        if (m || body.length > 300000) {
          res.destroy();
          resolve(m ? decodeEntities(m[1].trim()) : "");
        }
      });
      res.on("end", () => {
        const m = /<title[^>]*>([^<]*)<\/title>/i.exec(body);
        resolve(m ? decodeEntities(m[1].trim()) : "");
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

function decodeEntities(s: string): string {
  const t = document.createElement("textarea");
  t.innerHTML = s;
  return t.value.replace(/\s+/g, " ");
}

/** A group: a labelled, tinted area that carries the cards inside it when moved. */
export class GroupNode extends CanvasNode {
  groupLabelEl: HTMLElement;

  constructor(canvas: Canvas, data: CanvasNodeData) {
    super(canvas, data);
    this.nodeEl.addClass("canvas-node-group");
    this.placeholderEl.remove();
    this.groupLabelEl = this.nodeEl.createDiv({ cls: "canvas-group-label", attr: { spellcheck: "false", "data-placeholder": "Untitled group" } });
    this.groupLabelEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        this.canvas.stopEditingAll();
      }
      e.stopPropagation();
    });
    this.groupLabelEl.addEventListener("input", () => {
      this.data.label = this.groupLabelEl.innerText.replace(/\n/g, " ");
    });
  }

  renderZ(): number {
    return Math.round(-this.width * this.height);
  }

  isEditable(): boolean {
    return true;
  }

  renderContent(): void {
    if (!this.isEditing) this.groupLabelEl.setText(this.data.label ?? "");
    const bg = this.data.background;
    const c = this.contentEl;
    c.toggleClass("mod-background-ratio", this.data.backgroundStyle === "ratio");
    c.toggleClass("mod-background-repeat", this.data.backgroundStyle === "repeat");
    if (bg) {
      const f = this.app.vault.getFileByPath(bg);
      c.style.backgroundImage = f ? `url("${this.app.vault.getResourcePath(f)}")` : "";
    } else c.style.backgroundImage = "";
  }

  startEditing(): void {
    if (this.canvas.readonly) return;
    this.isEditing = true;
    this.nodeEl.addClass("is-editing");
    const el = this.groupLabelEl;
    el.addClass("is-editing");
    el.setAttr("contenteditable", "true");
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  }

  stopEditing(): void {
    if (!this.isEditing) return;
    this.isEditing = false;
    this.nodeEl.removeClass("is-editing");
    const el = this.groupLabelEl;
    el.removeClass("is-editing");
    el.setAttr("contenteditable", "false");
    el.blur();
    const label = el.innerText.trim();
    if (label !== (this.data.label ?? "")) {
      if (label) this.data.label = label;
      else delete this.data.label;
      this.canvas.requestSave();
    }
    this.renderContent();
  }
}

/** Cards of a type this app doesn't know: kept and drawn as an empty box so nothing is lost. */
export class UnknownNode extends CanvasNode {
  renderContent(): void {
    this.contentEl.empty();
    this.contentEl.addClass("file-embed", "mod-empty");
    this.contentEl.createDiv({ cls: "file-embed-title", text: `Unsupported card type "${this.data.type}"` });
    this.ensureBlocker();
  }
}

export function createNode(canvas: Canvas, data: CanvasNodeData): CanvasNode {
  switch (data.type) {
    case "text":
      return new TextNode(canvas, data);
    case "file":
      return new FileNode(canvas, data);
    case "link":
      return new LinkNode(canvas, data);
    case "group":
      return new GroupNode(canvas, data);
    default:
      return new UnknownNode(canvas, data);
  }
}

/** Open internal links in rendered card text (clicks reach them once the card is selected). */
function wireLinks(canvas: Canvas, root: HTMLElement, sourcePath = canvas.filePath): void {
  root.querySelectorAll<HTMLAnchorElement>("a.internal-link").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void canvas.app.workspace.openLinkText(a.getAttribute("data-href") ?? a.getAttribute("href") ?? "", sourcePath, Keymap.isModEvent(e));
    });
  });
  root.querySelectorAll<HTMLAnchorElement>("a.external-link").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      canvas.app.openExternal?.(a.href);
    });
  });
}

// ---------- edges ----------

const SVG = "http://www.w3.org/2000/svg";

export interface EdgeEndpoint {
  node: CanvasNode;
  side: Side;
  end: EdgeEnd;
}

export class CanvasEdge {
  canvas: Canvas;
  data: CanvasEdgeData;
  from: EdgeEndpoint;
  to: EdgeEndpoint;
  lineGroupEl: SVGGElement;
  lineEndGroupEl: SVGGElement;
  displayPath: SVGPathElement;
  interactionPath: SVGPathElement;
  fromEndEl: SVGGElement | null = null;
  toEndEl: SVGGElement | null = null;
  labelWrapperEl: HTMLElement | null = null;
  labelEl: HTMLElement | null = null;
  isEditingLabel = false;
  /** a dangling end while the user drags a new connection */
  floatingTo: { x: number; y: number } | null = null;
  bezier: ReturnType<typeof edgeGeometry>["bezier"] | null = null;

  constructor(canvas: Canvas, data: CanvasEdgeData, from: CanvasNode, to: CanvasNode) {
    this.canvas = canvas;
    this.data = data;
    this.from = { node: from, side: (data.fromSide as Side) ?? autoSide(from.getBBox(), to.getBBox()), end: (data.fromEnd as EdgeEnd) ?? "none" };
    this.to = { node: to, side: (data.toSide as Side) ?? autoSide(to.getBBox(), from.getBBox()), end: (data.toEnd as EdgeEnd) ?? "arrow" };
    this.lineGroupEl = document.createElementNS(SVG, "g") as SVGGElement;
    this.lineEndGroupEl = document.createElementNS(SVG, "g") as SVGGElement;
    this.interactionPath = document.createElementNS(SVG, "path") as SVGPathElement;
    this.interactionPath.setAttribute("class", "canvas-interaction-path");
    this.displayPath = document.createElementNS(SVG, "path") as SVGPathElement;
    this.displayPath.setAttribute("class", "canvas-display-path");
    this.lineGroupEl.append(this.interactionPath, this.displayPath);
    (this.lineGroupEl as any).__canvasEdge = this;
    (this.lineEndGroupEl as any).__canvasEdge = this;
  }

  get id(): string {
    return this.data.id;
  }

  syncData(): void {
    this.data.fromNode = this.from.node.id;
    this.data.fromSide = this.from.side;
    this.data.toNode = this.to.node.id;
    this.data.toSide = this.to.side;
    if (this.from.end === "none") delete this.data.fromEnd;
    else this.data.fromEnd = this.from.end;
    if (this.to.end === "arrow") delete this.data.toEnd;
    else this.data.toEnd = this.to.end;
  }

  getBBox(): BBox {
    const g = this.geometry();
    return { minX: Math.min(g.fromPoint.x, g.toPoint.x), minY: Math.min(g.fromPoint.y, g.toPoint.y), maxX: Math.max(g.fromPoint.x, g.toPoint.x), maxY: Math.max(g.fromPoint.y, g.toPoint.y) };
  }

  private geometry() {
    const fromBox = this.from.node.getBBox();
    const toBox = this.floatingTo ? { minX: this.floatingTo.x, minY: this.floatingTo.y, maxX: this.floatingTo.x, maxY: this.floatingTo.y } : this.to.node.getBBox();
    return edgeGeometry(fromBox, this.from.side, toBox, this.to.side, this.from.end === "arrow", this.to.end === "arrow" && !this.floatingTo);
  }

  render(): void {
    const g = this.geometry();
    this.bezier = g.bezier;
    this.displayPath.setAttribute("d", g.path);
    this.interactionPath.setAttribute("d", g.path);
    this.fromEndEl = this.renderEnd(this.fromEndEl, this.from.end, g.fromPoint, this.from.side);
    this.toEndEl = this.renderEnd(this.toEndEl, this.floatingTo ? "none" : this.to.end, g.toPoint, this.to.side);
    applyColor(this.lineGroupEl, this.data.color);
    applyColor(this.lineEndGroupEl, this.data.color);
    this.renderLabel();
  }

  private renderEnd(el: SVGGElement | null, end: EdgeEnd, p: { x: number; y: number }, side: Side): SVGGElement | null {
    if (end !== "arrow") {
      el?.remove();
      return null;
    }
    if (!el) {
      el = document.createElementNS(SVG, "g") as SVGGElement;
      const poly = document.createElementNS(SVG, "polygon");
      poly.setAttribute("class", "canvas-path-end");
      poly.setAttribute("points", "0,0 6.5,10.4 -6.5,10.4");
      el.appendChild(poly);
      this.lineEndGroupEl.appendChild(el);
    }
    el.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${END_ROTATION[side]}deg)`;
    return el;
  }

  renderLabel(): void {
    const label = this.data.label ?? "";
    if (!label && !this.isEditingLabel) {
      this.labelWrapperEl?.remove();
      this.labelWrapperEl = this.labelEl = null;
      return;
    }
    if (!this.labelWrapperEl) {
      this.labelWrapperEl = this.canvas.canvasEl.createDiv("canvas-path-label-wrapper");
      (this.labelWrapperEl as any).__canvasEdge = this;
      this.labelEl = this.labelWrapperEl.createDiv({ cls: "canvas-path-label", attr: { contenteditable: "false", "data-placeholder": "Add text..." } });
      this.labelEl.addEventListener("input", () => {
        this.data.label = this.labelEl!.innerText;
      });
      this.labelEl.addEventListener("keydown", (e) => {
        if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          this.stopEditingLabel();
        }
        e.stopPropagation();
      });
      this.labelEl.addEventListener("blur", () => this.stopEditingLabel());
    }
    if (!this.isEditingLabel) this.labelEl!.setText(label);
    const c = this.bezier ? bezierPoint(this.bezier, 0.5) : { x: 0, y: 0 };
    this.labelWrapperEl.style.transform = `translate(${c.x}px, ${c.y}px)`;
    applyColor(this.labelWrapperEl, this.data.color);
  }

  editLabel(): void {
    if (this.canvas.readonly) return;
    this.isEditingLabel = true;
    this.renderLabel();
    const el = this.labelEl!;
    el.addClass("is-editing");
    el.setAttr("contenteditable", "true");
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  }

  stopEditingLabel(): void {
    if (!this.isEditingLabel) return;
    this.isEditingLabel = false;
    const el = this.labelEl;
    if (el) {
      el.removeClass("is-editing");
      el.setAttr("contenteditable", "false");
      const text = el.innerText.trim();
      if (text) this.data.label = text;
      else delete this.data.label;
    }
    this.renderLabel();
    this.canvas.requestSave();
  }

  attach(): void {
    this.canvas.edgeContainerEl.appendChild(this.lineGroupEl);
    this.canvas.edgeEndContainerEl.appendChild(this.lineEndGroupEl);
  }

  destroy(): void {
    this.lineGroupEl.remove();
    this.lineEndGroupEl.remove();
    this.labelWrapperEl?.remove();
  }

  select(on: boolean): void {
    this.lineGroupEl.classList.toggle("is-focused", on);
    this.lineEndGroupEl.classList.toggle("is-focused", on);
  }
}
