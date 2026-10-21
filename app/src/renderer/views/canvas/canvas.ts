// The canvas controller: viewport (pan/zoom with easing), cards and edges, selection, dragging with
// grid/object snapping, resizing, connecting, the selection menu, the controls, history (undo/redo),
// clipboard and keyboard shortcuts. Coordinates: canvas units; the `.canvas` element is transformed
// by translate(center) scale(2^zoom) translate(-x, -y), so (x, y) is the canvas point at the centre.
import { setIcon } from "../../dom/icons";
import { Menu } from "../../ui/menu";
import { Notice } from "../../ui/notice";
import { FuzzySuggestModal, Modal } from "../../ui/modal";
import { Keymap } from "../../commands/keymap";
import * as G from "./geometry";
import { normalizeColor, orderNodes, randomId, type CanvasData, type CanvasEdgeData, type CanvasNodeData, type EdgeEnd, type Side } from "./format";
import { CanvasEdge, CanvasNode, FileNode, GroupNode, IMAGE_EXTS, AUDIO_EXTS, VIDEO_EXTS, TextNode, createNode } from "./nodes";

export interface CanvasOptions {
  snapToGrid: boolean;
  snapToObjects: boolean;
  defaultWheelBehavior?: "pan" | "zoom";
  defaultModDragBehavior?: "menu" | "card" | "note" | "media" | "webpage" | "group";
  cardLabelVisibility?: "always" | "hover" | "never";
  zoomBreakpoint?: number;
  newFileLocation?: "root" | "current" | "folder";
  newFileFolderPath?: string;
  [k: string]: any;
}

export interface CanvasHost {
  app: any;
  file: any;
  options: CanvasOptions;
  saveOptions(): void;
  requestSave(): void;
  onReadonlyChange?(ro: boolean): void;
  /** shown inside a note: the page scrolls normally unless Ctrl is held */
  embedded?: boolean;
}

const ZOOM_MIN = -4;
const ZOOM_MAX = 1;
const ZOOM_BREAKPOINT = -1.7;
const WHEEL_PAN = 0.93;
const SNAP_DISTANCE = 15;
const MIN_SIZE = 50;
const TEXT_SIZE = { width: 250, height: 60 };
const FILE_SIZE = { width: 400, height: 400 };
export const MEDIA_EXTS = [...IMAGE_EXTS, ...AUDIO_EXTS, ...VIDEO_EXTS, "pdf"];

type Selectable = CanvasNode | CanvasEdge;

export class Canvas {
  host: CanvasHost;
  app: any;
  wrapperEl: HTMLElement;
  backgroundEl: SVGSVGElement;
  patternEl: SVGPatternElement;
  cardMenuEl: HTMLElement;
  controlsEl: HTMLElement;
  canvasEl: HTMLElement;
  edgeContainerEl: SVGSVGElement;
  edgeEndContainerEl: SVGSVGElement;
  snapEl: SVGSVGElement;
  menuContainerEl: HTMLElement;
  menuEl: HTMLElement;
  interactionLayerEl: HTMLElement;
  undoBtnEl: HTMLElement;
  redoBtnEl: HTMLElement;
  // model
  data: Record<string, any> = {};
  nodes = new Map<string, CanvasNode>();
  edges = new Map<string, CanvasEdge>();
  selection = new Set<Selectable>();
  zIndexCounter = 1;
  readonly = false;
  // viewport
  x = 0;
  y = 0;
  zoom = 0;
  scale = 1;
  tx = 0;
  ty = 0;
  tZoom = 0;
  zoomCenter: { x: number; y: number } | null = null;
  width = 0;
  height = 0;
  private frame = 0;
  private lastFrameTime = 0;
  private viewportDirty = true;
  zoomToFitQueued = false;
  private pauseAnimationUntil = 0;
  // history
  private history: string[] = [];
  private historyIndex = -1;
  private historyTimer: any = null;
  // interaction
  isHoldingSpace = false;
  isDragging = false;
  private hoverNode: CanvasNode | null = null;
  private pointer = { x: 0, y: 0 };
  private resizeObs: ResizeObserver;
  private destroyed = false;
  private cleanup: (() => void)[] = [];

  constructor(host: CanvasHost, parent: HTMLElement) {
    this.host = host;
    this.app = host.app;
    const w = (this.wrapperEl = parent.createDiv({ cls: "canvas-wrapper node-insert-event", attr: { tabindex: "-1", "data-ignore-swipe": "true" } }));
    const svgNs = "http://www.w3.org/2000/svg";
    this.backgroundEl = document.createElementNS(svgNs, "svg") as SVGSVGElement;
    this.backgroundEl.setAttribute("class", "canvas-background");
    const pid = "canvas-dots-" + randomId();
    this.patternEl = document.createElementNS(svgNs, "pattern") as SVGPatternElement;
    this.patternEl.setAttribute("id", pid);
    this.patternEl.setAttribute("patternUnits", "userSpaceOnUse");
    const dot = document.createElementNS(svgNs, "circle");
    dot.setAttribute("cx", "0.7");
    dot.setAttribute("cy", "0.7");
    dot.setAttribute("r", "0.7");
    this.patternEl.appendChild(dot);
    const rect = document.createElementNS(svgNs, "rect");
    for (const [k, v] of Object.entries({ x: "0", y: "0", width: "100%", height: "100%", fill: `url(#${pid})` })) rect.setAttribute(k, v);
    this.backgroundEl.append(this.patternEl, rect);
    w.appendChild(this.backgroundEl);
    this.cardMenuEl = w.createDiv("canvas-card-menu");
    this.controlsEl = w.createDiv("canvas-controls");
    this.canvasEl = w.createDiv("canvas");
    this.edgeContainerEl = document.createElementNS(svgNs, "svg") as SVGSVGElement;
    this.edgeContainerEl.setAttribute("class", "canvas-edges");
    this.edgeEndContainerEl = document.createElementNS(svgNs, "svg") as SVGSVGElement;
    this.edgeEndContainerEl.setAttribute("class", "canvas-edges");
    this.canvasEl.append(this.edgeContainerEl, this.edgeEndContainerEl);
    this.snapEl = document.createElementNS(svgNs, "svg") as SVGSVGElement;
    this.snapEl.setAttribute("class", "canvas-snaps");
    this.interactionLayerEl = this.canvasEl.createDiv("canvas-node-interaction-layer is-hidden");
    for (const d of ["top", "right", "bottom", "left", "topright", "bottomright", "bottomleft", "topleft"]) {
      this.interactionLayerEl.createDiv({ cls: "canvas-node-resizer", attr: { "data-resize": d } });
      if (!d.startsWith("top") || d === "top") if (["top", "right", "bottom", "left"].includes(d)) this.interactionLayerEl.createDiv({ cls: "canvas-node-connection-point", attr: { "data-side": d } });
    }
    this.menuContainerEl = w.createDiv("canvas-menu-container is-hidden");
    this.menuEl = this.menuContainerEl.createDiv("canvas-menu");
    this.buildCardMenu();
    const ctl = this.buildControls();
    this.undoBtnEl = ctl.undo;
    this.redoBtnEl = ctl.redo;
    this.bindEvents();
    this.resizeObs = new ResizeObserver(() => this.onResize());
    this.resizeObs.observe(w);
    this.applyOptions();
    this.onResize();
  }

  get file(): any {
    return this.host.file;
  }
  get filePath(): string {
    return this.host.file?.path ?? "";
  }
  get options(): CanvasOptions {
    return this.host.options;
  }

  applyOptions(): void {
    const v = this.options.cardLabelVisibility ?? "always";
    this.wrapperEl.toggleClass("mod-card-labels-hover", v === "hover");
    this.wrapperEl.toggleClass("mod-card-labels-never", v === "never");
    this.markViewportChanged();
  }

  get zoomBreakpoint(): number {
    return ZOOM_BREAKPOINT - (this.options.zoomBreakpoint || 0);
  }

  get gridSpacing(): number {
    return G.gridSpacing(this.zoom);
  }

  // ---------- data ----------
  setData(data: CanvasData, keepView = true): void {
    this.stopEditingAll();
    const selectedIds = new Set([...this.selection].map((s) => s.id));
    for (const n of this.nodes.values()) n.destroy();
    for (const e of this.edges.values()) e.destroy();
    this.nodes.clear();
    this.edges.clear();
    this.selection.clear();
    const { nodes, edges, ...rest } = data;
    this.data = { ...data };
    void rest;
    this.zIndexCounter = 1;
    for (const nd of nodes) this.addNodeData(nd, false);
    for (const ed of edges) this.addEdgeData(ed, false);
    for (const id of selectedIds) {
      const s = this.nodes.get(id) ?? this.edges.get(id);
      if (s) this.selection.add(s);
    }
    this.renderAll();
    if (!keepView) this.zoomToFitQueued = true;
    this.updateSelection();
  }

  getData(): CanvasData {
    const nodes = [...this.nodes.values()]
      .sort((a, b) => a.renderZ() - b.renderZ())
      .map((n) => n.data);
    for (const e of this.edges.values()) e.syncData();
    const out: CanvasData = { ...this.data, nodes, edges: [...this.edges.values()].map((e) => e.data) };
    out.nodes = orderNodes(out.nodes);
    return out;
  }

  private addNodeData(nd: CanvasNodeData, render = true): CanvasNode {
    const n = createNode(this, nd);
    n.zIndex = n instanceof GroupNode ? n.renderZ() : this.zIndexCounter++;
    this.nodes.set(nd.id, n);
    this.canvasEl.appendChild(n.nodeEl);
    n.load();
    if (render) {
      n.renderFrame();
      void n.renderContent();
      n.renderLabel();
    }
    return n;
  }

  private addEdgeData(ed: CanvasEdgeData, render = true): CanvasEdge | null {
    const from = this.nodes.get(ed.fromNode);
    const to = this.nodes.get(ed.toNode);
    if (!from || !to) return null;
    const e = new CanvasEdge(this, ed, from, to);
    this.edges.set(ed.id, e);
    e.attach();
    if (render) e.render();
    return e;
  }

  renderAll(): void {
    for (const n of this.nodes.values()) {
      n.renderFrame();
      n.renderLabel();
      void n.renderContent();
    }
    for (const e of this.edges.values()) e.render();
    this.updateInteractionLayer();
  }

  /** A file changed on disk: refresh file cards showing it. */
  onFileModified(file: any): void {
    for (const n of this.nodes.values()) if (n instanceof FileNode && n.data.file === file.path && !n.isEditing) void n.renderContent(true);
  }

  onFileRenamed(file: any, oldPath: string): void {
    let changed = false;
    for (const n of this.nodes.values()) {
      if (n instanceof FileNode && n.data.file === oldPath) {
        n.data.file = file.path;
        void n.renderContent(true);
        changed = true;
      }
      if (n instanceof GroupNode && n.data.background === oldPath) {
        n.data.background = file.path;
        n.renderContent();
        changed = true;
      }
    }
    if (changed) this.requestSave();
  }

  getEdgesForNode(n: CanvasNode): CanvasEdge[] {
    return [...this.edges.values()].filter((e) => e.from.node === n || e.to.node === n);
  }

  // ---------- creating ----------
  private nextZ(): number {
    return this.zIndexCounter++;
  }

  createNode(nd: CanvasNodeData, opts: { select?: boolean; edit?: boolean } = {}): CanvasNode {
    const n = this.addNodeData(nd, true);
    if (!(n instanceof GroupNode)) n.zIndex = this.nextZ();
    n.renderFrame();
    if (opts.select !== false) this.selectOnly(n);
    if (opts.edit) setTimeout(() => n.startEditing(), 0);
    this.requestSave();
    return n;
  }

  private rectAt(pos: G.Point, size: { width: number; height: number }, centered: boolean): { x: number; y: number; width: number; height: number } {
    let x = centered ? pos.x - size.width / 2 : pos.x;
    let y = centered ? pos.y - size.height / 2 : pos.y;
    if (this.options.snapToGrid) {
      x = G.snapToGrid(x, 20);
      y = G.snapToGrid(y, 20);
    }
    return { x: Math.round(x), y: Math.round(y), width: size.width, height: size.height };
  }

  createTextNode(pos: G.Point, text = "", centered = true, size = TEXT_SIZE, edit = true): CanvasNode {
    const r = this.rectAt(pos, size, centered);
    return this.createNode({ id: randomId(), ...r, type: "text", text } as CanvasNodeData, { edit });
  }

  createFileNode(pos: G.Point, file: any, centered = true, subpath = "", size?: { width: number; height: number }): CanvasNode {
    let sz = size ?? FILE_SIZE;
    if (!size && IMAGE_EXTS.includes(file.extension)) sz = { width: 400, height: 400 };
    const r = this.rectAt(pos, sz, centered);
    const nd: CanvasNodeData = { id: randomId(), ...r, type: "file", file: file.path } as CanvasNodeData;
    if (subpath) nd.subpath = subpath;
    const n = this.createNode(nd);
    if (IMAGE_EXTS.includes(file.extension)) this.fitImageNode(n);
    return n;
  }

  /** Images keep their aspect ratio inside a 400px box. */
  private fitImageNode(n: CanvasNode): void {
    const img = new Image();
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) return;
      const ratio = img.naturalWidth / img.naturalHeight;
      const w = n.data.width;
      n.data.height = Math.max(MIN_SIZE, Math.round(w / ratio));
      n.renderFrame();
      for (const e of this.getEdgesForNode(n)) e.render();
      this.requestSave();
    };
    img.src = this.app.vault.getResourcePath((n as FileNode).file);
  }

  createLinkNode(pos: G.Point, url: string, centered = true): CanvasNode {
    const r = this.rectAt(pos, { width: 400, height: 400 }, centered);
    return this.createNode({ id: randomId(), ...r, type: "link", url } as CanvasNodeData);
  }

  createGroupNode(rect: { x: number; y: number; width: number; height: number }, label = "Untitled group"): CanvasNode {
    const nd = { id: randomId(), x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), type: "group", label } as CanvasNodeData;
    const n = this.createNode(nd);
    return n;
  }

  addEdge(from: CanvasNode, fromSide: Side, to: CanvasNode, toSide: Side, extra: Partial<CanvasEdgeData> = {}): CanvasEdge | null {
    const ed: CanvasEdgeData = { id: randomId(), fromNode: from.id, fromSide, toNode: to.id, toSide, ...extra };
    const e = this.addEdgeData(ed, true);
    this.requestSave();
    return e;
  }

  removeNode(n: CanvasNode): void {
    for (const e of this.getEdgesForNode(n)) this.removeEdge(e);
    this.selection.delete(n);
    n.destroy();
    this.nodes.delete(n.id);
    if (this.hoverNode === n) this.hoverNode = null;
  }

  removeEdge(e: CanvasEdge): void {
    this.selection.delete(e);
    e.destroy();
    this.edges.delete(e.id);
  }

  deleteSelection(): void {
    if (this.readonly || !this.selection.size) return;
    for (const s of [...this.selection]) {
      if (s instanceof CanvasEdge) this.removeEdge(s);
      else this.removeNode(s);
    }
    this.selection.clear();
    this.updateSelection();
    this.requestSave();
  }

  // ---------- saving & history ----------
  requestSave(): void {
    if (this.readonly) return;
    this.host.requestSave();
    this.pushHistorySoon();
  }

  pushHistorySoon(): void {
    clearTimeout(this.historyTimer);
    this.historyTimer = setTimeout(() => this.pushHistory(), 250);
  }

  pushHistory(): void {
    const snap = JSON.stringify(this.getData());
    if (this.history[this.historyIndex] === snap) return;
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(snap);
    if (this.history.length > 100) this.history.shift();
    this.historyIndex = this.history.length - 1;
    this.updateHistoryUI();
  }

  resetHistory(): void {
    this.history = [JSON.stringify(this.getData())];
    this.historyIndex = 0;
    this.updateHistoryUI();
  }

  canUndo(): boolean {
    return this.historyIndex > 0;
  }
  canRedo(): boolean {
    return this.historyIndex < this.history.length - 1;
  }

  undo(): void {
    if (this.readonly) return;
    clearTimeout(this.historyTimer);
    this.pushHistory();
    if (!this.canUndo()) return;
    this.historyIndex--;
    this.applyHistory();
  }

  redo(): void {
    if (this.readonly || !this.canRedo()) return;
    this.historyIndex++;
    this.applyHistory();
  }

  private applyHistory(): void {
    this.setData(JSON.parse(this.history[this.historyIndex]), true);
    this.host.requestSave();
    this.updateHistoryUI();
  }

  updateHistoryUI(): void {
    this.undoBtnEl?.toggleClass("is-disabled", !this.canUndo() || this.readonly);
    this.redoBtnEl?.toggleClass("is-disabled", !this.canRedo() || this.readonly);
  }

  setReadonly(ro: boolean): void {
    this.readonly = ro;
    this.wrapperEl.toggleClass("is-readonly", ro);
    if (ro) this.stopEditingAll();
    this.updateHistoryUI();
    this.updateSelection();
    this.host.onReadonlyChange?.(ro);
  }

  // ---------- viewport ----------
  onResize(): void {
    const r = this.wrapperEl.getBoundingClientRect();
    if (r.width === this.width && r.height === this.height) return;
    this.width = r.width;
    this.height = r.height;
    if (this.zoomToFitQueued && this.width && this.height) {
      this.zoomToFitQueued = false;
      this.zoomToFit(true);
    }
    this.markViewportChanged();
  }

  setViewport(x: number, y: number, zoom: number): void {
    this.x = this.tx = x;
    this.y = this.ty = y;
    this.zoom = this.tZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
    this.scale = Math.pow(2, this.zoom);
    this.markViewportChanged();
  }

  zoomBy(delta: number, center?: G.Point | null): void {
    this.tZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.tZoom + delta));
    this.zoomCenter = center ?? { x: 0, y: 0 };
    this.markViewportChanged();
  }

  zoomToBbox(b: G.BBox, instant = false): void {
    if (!this.width || !this.height) {
      this.zoomToFitQueued = true;
      return;
    }
    const w = Math.max(1, b.maxX - b.minX), h = Math.max(1, b.maxY - b.minY);
    const s = Math.min(this.width / (1.1 * w), this.height / (1.1 * h));
    const z = Math.log2(Math.min(1, Math.max(Math.pow(2, ZOOM_MIN), s)));
    const c = G.center(b);
    this.tx = c.x;
    this.ty = c.y;
    this.tZoom = z;
    this.zoomCenter = null;
    if (instant) this.setViewport(c.x, c.y, z);
    this.markViewportChanged();
  }

  zoomToFit(instant = false): void {
    if (!this.nodes.size) {
      if (instant) this.setViewport(0, 0, 0);
      return;
    }
    this.zoomToBbox(G.unionBBox([...this.nodes.values()].map((n) => n.getBBox())), instant);
  }

  zoomToSelection(): void {
    if (!this.selection.size) return;
    this.zoomToBbox(G.unionBBox([...this.selection].map((s) => s.getBBox())));
  }

  /** Canvas point under a client (screen) point. */
  posFromClient(cx: number, cy: number): G.Point {
    const r = this.wrapperEl.getBoundingClientRect();
    return { x: (cx - r.left - this.width / 2) / this.scale + this.x, y: (cy - r.top - this.height / 2) / this.scale + this.y };
  }

  posFromEvt(e: { clientX: number; clientY: number }): G.Point {
    return this.posFromClient(e.clientX, e.clientY);
  }

  /** Client point of a canvas point. */
  clientFromPos(p: G.Point): G.Point {
    const r = this.wrapperEl.getBoundingClientRect();
    return { x: (p.x - this.x) * this.scale + this.width / 2 + r.left, y: (p.y - this.y) * this.scale + this.height / 2 + r.top };
  }

  getViewportBBox(): G.BBox {
    const hw = this.width / 2 / this.scale, hh = this.height / 2 / this.scale;
    return { minX: this.x - hw, minY: this.y - hh, maxX: this.x + hw, maxY: this.y + hh };
  }

  posCenter(): G.Point {
    return { x: this.x, y: this.y };
  }

  markViewportChanged(): void {
    this.viewportDirty = true;
    this.requestFrame();
  }

  requestFrame(): void {
    if (this.frame || this.destroyed) return;
    this.frame = requestAnimationFrame((t) => this.onFrame(t));
  }

  private onFrame(now: number): void {
    this.frame = 0;
    const dt = this.lastFrameTime ? Math.min(100, now - this.lastFrameTime) : 16;
    this.lastFrameTime = now;
    if (!this.viewportDirty) {
      this.lastFrameTime = 0;
      return;
    }
    const keep = Math.pow(0.984, dt);
    const a = 1 - keep;
    let { x, y, zoom } = this;
    const dz = this.tZoom - zoom;
    if (Math.abs(dz) < 0.01) zoom = this.tZoom;
    else if (this.zoomCenter) {
      const c = this.zoomCenter;
      const prevScale = Math.pow(2, zoom);
      zoom += dz * a;
      const s = Math.pow(2, zoom);
      x -= c.x / s - c.x / prevScale;
      y -= c.y / s - c.y / prevScale;
      this.tx = x;
      this.ty = y;
    } else zoom += dz * a;
    const dx = this.tx - x;
    x += dx * a;
    if (Math.abs(this.tx - x) < 0.01) x = this.tx;
    const dy = this.ty - y;
    y += dy * a;
    if (Math.abs(this.ty - y) < 0.01) y = this.ty;
    this.x = x;
    this.y = y;
    this.zoom = zoom;
    this.scale = Math.pow(2, zoom);
    this.applyTransform();
    const animating = this.x !== this.tx || this.y !== this.ty || this.zoom !== this.tZoom || Date.now() < this.pauseAnimationUntil;
    this.wrapperEl.toggleClass("mod-animating", animating);
    if (animating) this.requestFrame();
    else {
      this.viewportDirty = false;
      this.lastFrameTime = 0;
      this.host.app.workspace.requestSaveLayout?.();
    }
  }

  private applyTransform(): void {
    const s = this.scale;
    this.wrapperEl.toggleClass("mod-zoomed-out", this.zoom <= this.zoomBreakpoint);
    this.canvasEl.style.transform = `translate(${this.width / 2}px, ${this.height / 2}px) scale(${s}) translate(${-this.x}px, ${-this.y}px)`;
    const grid = this.gridSpacing;
    const mod = (a: number, b: number) => ((a % b) + b) % b;
    this.patternEl.setAttribute("x", String(this.width / 2 - mod(this.x, grid) * s));
    this.patternEl.setAttribute("y", String(this.height / 2 - mod(this.y, grid) * s));
    this.patternEl.setAttribute("width", String(grid * s));
    this.patternEl.setAttribute("height", String(grid * s));
    this.wrapperEl.style.setProperty("--zoom-multiplier", String(Math.sqrt(1 / s)));
    this.positionMenu();
  }

  // ---------- selection ----------
  select(s: Selectable): void {
    this.selection.add(s);
    this.updateSelection();
  }
  deselect(s: Selectable): void {
    this.selection.delete(s);
    this.updateSelection();
  }
  toggleSelect(s: Selectable): void {
    if (this.selection.has(s)) this.selection.delete(s);
    else this.selection.add(s);
    this.updateSelection();
  }
  selectOnly(s: Selectable): void {
    this.selection.clear();
    this.selection.add(s);
    this.updateSelection();
  }
  selectAll(): void {
    for (const n of this.nodes.values()) this.selection.add(n);
    for (const e of this.edges.values()) this.selection.add(e);
    this.updateSelection();
  }
  deselectAll(): void {
    if (!this.selection.size) return;
    this.selection.clear();
    this.updateSelection();
  }

  updateSelection(): void {
    const single = this.selection.size === 1;
    for (const n of this.nodes.values()) {
      const sel = this.selection.has(n);
      n.nodeEl.toggleClass("is-focused", sel && single);
      n.nodeEl.toggleClass("is-selected", sel && !single);
      if (!sel && n.isEditing) n.stopEditing();
      n.renderFrame();
    }
    for (const e of this.edges.values()) e.select(this.selection.has(e));
    for (const n of this.nodes.values()) {
      if (single && this.selection.has(n)) n.nodeEl.style.zIndex = String(this.zIndexCounter + 1);
    }
    this.updateInteractionLayer();
    this.renderMenu();
  }

  stopEditingAll(): void {
    for (const n of this.nodes.values()) if (n.isEditing) n.stopEditing();
    for (const e of this.edges.values()) if (e.isEditingLabel) e.stopEditingLabel();
  }

  /** Resize handles and connection points follow the single focused (or hovered) card. */
  updateInteractionLayer(): void {
    const target = this.interactionTarget();
    const el = this.interactionLayerEl;
    if (!target || this.readonly || this.isDragging) {
      el.addClass("is-hidden");
      return;
    }
    el.removeClass("is-hidden");
    el.style.transform = `translate(${target.x}px, ${target.y}px)`;
    el.style.width = target.width + "px";
    el.style.height = target.height + "px";
    el.style.zIndex = String(this.zIndexCounter + 2);
    el.toggleClass("is-hovered", target === this.hoverNode);
    const showResize = this.selection.size === 1 && this.selection.has(target);
    el.querySelectorAll<HTMLElement>(".canvas-node-resizer").forEach((r) => r.toggle(showResize));
  }

  private interactionTarget(): CanvasNode | null {
    if (this.selection.size === 1) {
      const [s] = this.selection;
      if (s instanceof CanvasNode && !s.isEditing) return s;
    }
    return this.hoverNode && !this.hoverNode.isEditing ? this.hoverNode : null;
  }

  // ---------- selection menu ----------
  renderMenu(): void {
    const menu = this.menuEl;
    menu.empty();
    if (!this.selection.size || this.readonly || this.isDragging) {
      this.menuContainerEl.addClass("is-hidden");
      return;
    }
    const btn = (icon: string, label: string, cb: (b: HTMLElement) => void) => {
      const b = menu.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label, "data-tooltip-position": "top" } });
      setIcon(b, icon);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        cb(b);
      });
      return b;
    };
    btn("trash-2", "Remove", () => this.deleteSelection());
    btn("palette", "Set color", (b) => this.toggleColorPicker(b));
    btn("scan", "Zoom to selection\n(Shift + 2)", () => this.zoomToSelection());
    const items = [...this.selection];
    if (items.length === 1) {
      const s = items[0];
      if (s instanceof CanvasNode && s.isEditable()) btn("pencil", "Edit", () => this.startEditing(s));
      if (s instanceof CanvasEdge) {
        btn("arrow-right-left", "Line direction", (b) => this.showDirectionMenu(s, b));
        btn("pencil", "Edit label", () => s.editLabel());
      }
    } else if (items.every((s) => s instanceof CanvasNode)) {
      btn("group", "Create group", () => this.groupSelection());
    }
    this.menuContainerEl.removeClass("is-hidden");
    this.positionMenu();
  }

  private positionMenu(): void {
    if (this.menuContainerEl.hasClass("is-hidden") || !this.selection.size) return;
    const b = G.unionBBox([...this.selection].map((s) => s.getBBox()));
    const r = this.wrapperEl.getBoundingClientRect();
    const top = this.clientFromPos({ x: (b.minX + b.maxX) / 2, y: b.minY });
    const mw = this.menuEl.offsetWidth || 137;
    const mh = this.menuEl.offsetHeight || 34;
    let left = top.x - r.left - mw / 2;
    left = Math.max(10, Math.min(this.width - mw - 10, left));
    let y = top.y - r.top - mh - 10;
    y = Math.max(10, Math.min(this.height - mh - 10, y));
    this.menuContainerEl.style.left = left + "px";
    this.menuContainerEl.style.top = y + "px";
  }

  private toggleColorPicker(btn: HTMLElement): void {
    const existing = this.menuEl.querySelector(".canvas-submenu");
    if (existing) {
      existing.remove();
      btn.removeClass("is-active");
      return;
    }
    btn.addClass("is-active");
    const sub = this.menuEl.createDiv("canvas-submenu");
    const items = [...this.selection];
    const current = items.length ? normalizeColor((items[0] as any).data.color) : "";
    const set = (c: string) => {
      for (const s of items) {
        if (c) (s as any).data.color = c;
        else delete (s as any).data.color;
        if (s instanceof CanvasNode) s.renderFrame();
        else s.render();
      }
      this.requestSave();
      sub.querySelectorAll(".canvas-color-picker-item").forEach((el) => el.removeClass("is-active"));
    };
    const none = sub.createDiv({ cls: "canvas-color-picker-item", attr: { "aria-label": "No color" } });
    none.toggleClass("is-active", !current);
    none.addEventListener("click", () => {
      set("");
      none.addClass("is-active");
    });
    const names = ["Red", "Orange", "Yellow", "Green", "Cyan", "Purple"];
    for (let i = 1; i <= 6; i++) {
      const el = sub.createDiv({ cls: `canvas-color-picker-item mod-canvas-color-${i}`, attr: { "aria-label": names[i - 1] } });
      el.toggleClass("is-active", current === String(i));
      el.addEventListener("click", () => {
        set(String(i));
        el.addClass("is-active");
      });
    }
    const custom = sub.createDiv({ cls: "canvas-color-picker-item canvas-color-picker-custom", attr: { "aria-label": "Custom color" } });
    custom.style.setProperty("--canvas-color", current.startsWith("#") ? current : "#000000");
    const input = custom.createEl("input", { type: "color" });
    input.value = current.startsWith("#") ? current : "#000000";
    custom.toggleClass("is-active", current.startsWith("#"));
    input.addEventListener("input", () => {
      set(input.value.toLowerCase());
      custom.addClass("is-active");
    });
  }

  private showDirectionMenu(edge: CanvasEdge, btn: HTMLElement): void {
    const m = new Menu();
    const opt = (title: string, from: EdgeEnd, to: EdgeEnd) =>
      m.addItem((i: any) =>
        i
          .setTitle(title)
          .setChecked(edge.from.end === from && edge.to.end === to)
          .onClick(() => {
            edge.from.end = from;
            edge.to.end = to;
            edge.syncData();
            edge.render();
            this.requestSave();
          }),
      );
    opt("Nondirectional", "none", "none");
    opt("Unidirectional", "none", "arrow");
    opt("Bidirectional", "arrow", "arrow");
    const r = btn.getBoundingClientRect();
    m.showAtPosition({ x: r.left, y: r.bottom + 4 });
  }

  groupSelection(): void {
    const nodes = [...this.selection].filter((s): s is CanvasNode => s instanceof CanvasNode);
    if (!nodes.length) return;
    const b = G.expandBBox(G.unionBBox(nodes.map((n) => n.getBBox())), 20);
    const g = this.createGroupNode(G.rectOf(b));
    this.selectOnly(g);
  }

  startEditing(n: CanvasNode): void {
    if (this.readonly || !n.isEditable()) return;
    this.selectOnly(n);
    if (this.zoom < this.zoomBreakpoint + 0.1) this.zoomToBbox(n.getBBox());
    n.startEditing();
    this.updateInteractionLayer();
  }

  // ---------- card menu and controls ----------
  private buildCardMenu(): void {
    const m = this.cardMenuEl;
    const item = (icon: string, label: string, create: (pos: G.Point, centered: boolean) => void) => {
      const b = m.createDiv({ cls: "canvas-card-menu-button mod-draggable", attr: { "aria-label": label, "data-tooltip-position": "top" } });
      setIcon(b, icon);
      b.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || this.readonly) return;
        e.preventDefault();
        e.stopPropagation();
        const start = { x: e.clientX, y: e.clientY };
        let ghost: HTMLElement | null = null;
        const move = (ev: PointerEvent) => {
          if (!ghost && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 5) {
            ghost = document.body.createDiv("canvas-card-menu-ghost");
            ghost.style.cssText = "position:fixed;pointer-events:none;z-index:1000;opacity:0.7;width:48px;height:48px;display:flex;align-items:center;justify-content:center;color:var(--icon-color)";
            setIcon(ghost, icon);
          }
          if (ghost) {
            ghost.style.left = ev.clientX - 24 + "px";
            ghost.style.top = ev.clientY - 24 + "px";
          }
        };
        const up = (ev: PointerEvent) => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          if (ghost) {
            ghost.remove();
            const r = this.wrapperEl.getBoundingClientRect();
            const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom && !this.cardMenuEl.contains(ev.target as Node);
            if (inside) create(this.posFromEvt(ev), false);
          } else create(this.posCenter(), true);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      });
    };
    item("sticky-note", "Drag to add card", (pos, centered) => this.createTextNode(pos, "", centered));
    item("file-text", "Drag to add note from vault", (pos, centered) => this.pickFile(false, (f) => this.createFileNode(pos, f, centered)));
    item("file-image", "Drag to add media from vault", (pos, centered) => this.pickFile(true, (f) => this.createFileNode(pos, f, centered)));
  }

  pickFile(media: boolean, cb: (f: any) => void): void {
    const app = this.app;
    const files = app.vault.getFiles().filter((f: any) => (media ? MEDIA_EXTS.includes(f.extension) : f.extension === "md" || f.extension === "canvas"));
    class Picker extends FuzzySuggestModal<any> {
      getItems() {
        return files;
      }
      getItemText(f: any) {
        return f.path;
      }
      onChooseItem(f: any) {
        cb(f);
      }
    }
    const p = new Picker(app);
    p.setPlaceholder?.(media ? "Find a media file..." : "Find a note...");
    p.open();
  }

  private buildControls(): { undo: HTMLElement; redo: HTMLElement } {
    const group = () => this.controlsEl.createDiv("canvas-control-group mod-raised");
    const item = (g: HTMLElement, icon: string, label: string, cb: (e: MouseEvent) => void) => {
      const b = g.createDiv({ cls: "canvas-control-item", attr: { "aria-label": label, "data-tooltip-position": "left" } });
      setIcon(b, icon);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        cb(e);
      });
      return b;
    };
    item(group(), "settings", "Canvas settings", (e) => this.showQuickSettings(e.currentTarget as HTMLElement));
    const zoom = group();
    item(zoom, "plus", "Zoom in", () => this.zoomBy(0.5, null));
    item(zoom, "rotate-cw", "Reset zoom", () => {
      this.tZoom = 0;
      this.zoomCenter = null;
      this.markViewportChanged();
    });
    item(zoom, "maximize", "Zoom to fit\n(Shift + 1)", () => this.zoomToFit());
    item(zoom, "minus", "Zoom out", () => this.zoomBy(-0.5, null));
    const hist = group();
    const undo = item(hist, "undo-2", "Undo", () => this.undo());
    const redo = item(hist, "redo-2", "Redo", () => this.redo());
    item(group(), "help-circle", "Canvas help", () => new CanvasHelpModal(this.app).open());
    return { undo, redo };
  }

  private showQuickSettings(anchor: HTMLElement): void {
    const m = new Menu();
    const o = this.options;
    m.addItem((i: any) =>
      i
        .setTitle("Snap to grid")
        .setIcon("grid")
        .setChecked(!!o.snapToGrid)
        .onClick(() => {
          o.snapToGrid = !o.snapToGrid;
          this.host.saveOptions();
        }),
    );
    m.addItem((i: any) =>
      i
        .setTitle("Snap to objects")
        .setIcon("magnet")
        .setChecked(!!o.snapToObjects)
        .onClick(() => {
          o.snapToObjects = !o.snapToObjects;
          this.host.saveOptions();
        }),
    );
    m.addItem((i: any) =>
      i
        .setTitle("Read-only")
        .setIcon("lock")
        .setChecked(this.readonly)
        .onClick(() => this.setReadonly(!this.readonly)),
    );
    const r = anchor.getBoundingClientRect();
    m.showAtPosition({ x: r.left - 4, y: r.top, left: true } as any);
  }

  // ---------- input ----------
  private on<K extends keyof HTMLElementEventMap>(el: HTMLElement | Window | Document, type: K | string, fn: (e: any) => void, opts?: AddEventListenerOptions): void {
    el.addEventListener(type, fn, opts);
    this.cleanup.push(() => el.removeEventListener(type, fn, opts));
  }

  private bindEvents(): void {
    const w = this.wrapperEl;
    this.on(w, "wheel", (e: WheelEvent) => this.onWheel(e), { passive: false });
    this.on(w, "pointerdown", (e: PointerEvent) => this.onPointerDown(e));
    this.on(w, "pointermove", (e: PointerEvent) => this.onPointerMove(e));
    this.on(w, "dblclick", (e: MouseEvent) => this.onDoubleClick(e));
    this.on(w, "contextmenu", (e: MouseEvent) => this.onContextMenu(e));
    this.on(w, "keydown", (e: KeyboardEvent) => this.onKeyDown(e));
    this.on(w, "dragover", (e: DragEvent) => {
      if (this.readonly) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });
    this.on(w, "drop", (e: DragEvent) => this.onDrop(e));
    this.on(window, "keydown", (e: KeyboardEvent) => {
      if (e.key === " " && this.isActive() && !this.isTyping()) {
        this.isHoldingSpace = true;
        w.addClass("is-holding-space");
      }
    });
    this.on(window, "keyup", (e: KeyboardEvent) => {
      if (e.key === " ") {
        this.isHoldingSpace = false;
        w.removeClass("is-holding-space");
      }
    });
  }

  private isActive(): boolean {
    const leaf = this.app.workspace.activeLeaf;
    return !!leaf && leaf.view?.canvas === this;
  }

  private isTyping(): boolean {
    const a = document.activeElement as HTMLElement | null;
    return !!a && (a.isContentEditable || a.tagName === "INPUT" || a.tagName === "TEXTAREA" || !!a.closest?.(".cm-editor"));
  }

  private isScrollableInside(e: WheelEvent): boolean {
    let el = e.target as HTMLElement | null;
    while (el && el !== this.wrapperEl) {
      if (el.scrollHeight > el.clientHeight + 1) {
        const st = getComputedStyle(el).overflowY;
        if (st === "auto" || st === "scroll") {
          const node = el.closest(".canvas-node");
          if (node && (node.hasClass("is-focused") || node.hasClass("is-editing"))) return true;
        }
      }
      el = el.parentElement;
    }
    return false;
  }

  private onWheel(e: WheelEvent): void {
    if (this.isDragging) return;
    const mod = e.ctrlKey || e.metaKey;
    if (this.host.embedded && !mod) return;
    let zoom = mod || this.isHoldingSpace;
    if (this.options.defaultWheelBehavior === "zoom") zoom = !zoom;
    if (!mod && this.isScrollableInside(e)) return;
    e.preventDefault();
    let dx = e.deltaX, dy = e.deltaY;
    if (e.deltaMode === 1) {
      dx *= 40;
      dy *= 40;
    } else if (e.deltaMode === 2) {
      dx *= 800;
      dy *= 800;
    }
    if (zoom) {
      const r = this.wrapperEl.getBoundingClientRect();
      const c = { x: e.clientX - r.left - this.width / 2, y: e.clientY - r.top - this.height / 2 };
      this.zoomBy(-dy / 300, dy < 0 ? c : null);
      this.pauseAnimationUntil = Date.now() + 200;
    } else if (e.shiftKey && dx === 0) {
      this.tx += (dy / this.scale) * WHEEL_PAN;
      this.markViewportChanged();
    } else {
      this.tx += (dx / this.scale) * WHEEL_PAN;
      this.ty += (dy / this.scale) * WHEEL_PAN;
      this.markViewportChanged();
    }
  }

  private nodeFromTarget(t: EventTarget | null): CanvasNode | null {
    let el = t as HTMLElement | null;
    while (el && el !== this.wrapperEl) {
      const n = (el as any).__canvasNode as CanvasNode | undefined;
      if (n) return n;
      el = el.parentElement;
    }
    return null;
  }

  private edgeFromTarget(t: EventTarget | null): CanvasEdge | null {
    let el = t as any;
    while (el && el !== this.wrapperEl) {
      if (el.__canvasEdge) return el.__canvasEdge;
      el = el.parentElement ?? el.parentNode;
    }
    return null;
  }

  private onPointerMove(e: PointerEvent): void {
    this.pointer = this.posFromEvt(e);
    if (this.isDragging) return;
    const n = this.nodeFromTarget(e.target);
    const onLayer = (e.target as HTMLElement)?.closest?.(".canvas-node-interaction-layer");
    const next = onLayer ? this.hoverNode : n;
    if (next !== this.hoverNode) {
      this.hoverNode = next;
      this.updateInteractionLayer();
    }
  }

  private onPointerDown(e: PointerEvent): void {
    const t = e.target as HTMLElement;
    if (t.closest(".canvas-controls, .canvas-card-menu, .canvas-menu-container")) return;
    this.pointer = this.posFromEvt(e);
    if (e.button === 1 || (e.button === 0 && this.isHoldingSpace)) {
      e.preventDefault();
      this.dragPan(e);
      return;
    }
    if (e.button !== 0) return;
    const conn = t.closest<HTMLElement>(".canvas-node-connection-point");
    const resizer = t.closest<HTMLElement>(".canvas-node-resizer");
    const target = this.interactionTarget();
    if (conn && target && !this.readonly) {
      e.preventDefault();
      this.dragConnect(e, target, conn.dataset.side as Side);
      return;
    }
    if (resizer && target && !this.readonly) {
      e.preventDefault();
      this.dragResize(e, target, resizer.dataset.resize!);
      return;
    }
    const edge = this.edgeFromTarget(t);
    if (edge) {
      if (edge.isEditingLabel && t.closest(".canvas-path-label")) return;
      e.preventDefault();
      this.stopEditingAll();
      if (e.shiftKey) this.toggleSelect(edge);
      else if (this.selection.size === 1 && this.selection.has(edge) && t.closest(".canvas-path-label") && !this.readonly) edge.editLabel();
      else this.selectOnly(edge);
      if (!this.readonly && !t.closest(".canvas-path-label")) this.dragEdgeEnd(e, edge);
      this.wrapperEl.focus({ preventScroll: true });
      return;
    }
    const node = this.nodeFromTarget(t);
    if (node) {
      if (node.isEditing && (t.closest(".canvas-node-content") || t.closest(".canvas-group-label"))) return;
      // let clicks reach links and controls inside a focused card
      const inContent = !!t.closest(".canvas-node-content");
      const interactive = inContent && node.nodeEl.hasClass("is-focused") && !!t.closest("a, button, input, video, audio, .metadata-container, .markdown-embed-link, iframe");
      if (interactive) return;
      if (!inContent || !node.nodeEl.hasClass("is-focused")) e.preventDefault();
      this.stopEditingAll();
      if (e.shiftKey) {
        this.toggleSelect(node);
        return;
      }
      if (!this.selection.has(node)) this.selectOnly(node);
      this.wrapperEl.focus({ preventScroll: true });
      if (!this.readonly) this.dragNodes(e, node);
      return;
    }
    // empty canvas
    e.preventDefault();
    this.stopEditingAll();
    this.wrapperEl.focus({ preventScroll: true });
    if (Keymap.isModifier?.(e, "Mod") || e.ctrlKey || e.metaKey) this.dragCreate(e);
    else this.dragSelect(e);
  }

  /** Track a pointer drag on window; callbacks get client coordinates. */
  private track(e: PointerEvent, h: { move(ev: PointerEvent): void; end?(ev: PointerEvent, moved: boolean): void }, threshold = 5): void {
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < threshold) return;
      moved = true;
      h.move(ev);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      h.end?.(ev, moved);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  private dragPan(e: PointerEvent): void {
    const start = this.posFromEvt(e);
    this.wrapperEl.addClass("is-panning");
    this.track(
      e,
      {
        move: (ev) => {
          const p = this.posFromEvt(ev);
          this.x = this.tx = this.x + (start.x - p.x);
          this.y = this.ty = this.y + (start.y - p.y);
          this.markViewportChanged();
        },
        end: () => this.wrapperEl.removeClass("is-panning"),
      },
      0,
    );
  }

  private setDragging(on: boolean): void {
    this.isDragging = on;
    this.wrapperEl.toggleClass("is-dragging", on);
    this.updateInteractionLayer();
    this.renderMenu();
  }

  /** Nodes that move with the selection: selected cards plus cards inside selected groups. */
  private movingSet(): CanvasNode[] {
    const set = new Set<CanvasNode>();
    for (const s of this.selection) if (s instanceof CanvasNode) set.add(s);
    for (const s of [...set]) {
      if (!(s instanceof GroupNode)) continue;
      const gb = s.getBBox();
      for (const n of this.nodes.values()) if (n !== s && G.contains(gb, n.getBBox())) set.add(n);
    }
    return [...set];
  }

  private dragNodes(e: PointerEvent, _node: CanvasNode): void {
    const start = this.posFromEvt(e);
    let moving: CanvasNode[] = [];
    let origin = new Map<CanvasNode, { x: number; y: number }>();
    let startBox: G.BBox | null = null;
    let others: G.BBox[] = [];
    this.track(e, {
      move: (ev) => {
        if (!this.isDragging) {
          moving = this.movingSet();
          origin = new Map(moving.map((n) => [n, { x: n.x, y: n.y }] as const));
          startBox = G.unionBBox(moving.map((n) => n.getBBox()));
          const vb = G.expandBBox(this.getViewportBBox(), 200);
          others = [...this.nodes.values()].filter((n) => !origin.has(n) && G.intersects(vb, n.getBBox())).map((n) => n.getBBox());
          this.setDragging(true);
        }
        const p = this.posFromEvt(ev);
        let dx = p.x - start.x, dy = p.y - start.y;
        if (startBox && !ev.altKey) {
          const moved = { minX: startBox.minX + dx, minY: startBox.minY + dy, maxX: startBox.maxX + dx, maxY: startBox.maxY + dy };
          const snap = G.snapBox(moved, others, Math.ceil(SNAP_DISTANCE / this.scale), this.options.snapToGrid ? this.gridSpacing : null, !!this.options.snapToObjects);
          dx += snap.dx;
          dy += snap.dy;
          this.renderSnaps(snap, { minX: moved.minX + snap.dx, minY: moved.minY + snap.dy, maxX: moved.maxX + snap.dx, maxY: moved.maxY + snap.dy });
        }
        for (const n of moving) {
          const o = origin.get(n)!;
          n.data.x = Math.round(o.x + dx);
          n.data.y = Math.round(o.y + dy);
          n.renderFrame();
        }
        this.renderEdgesFor(moving);
        this.updateInteractionLayer();
      },
      end: (_ev, moved) => {
        this.clearSnaps();
        if (moved && this.isDragging) {
          this.setDragging(false);
          this.requestSave();
        }
      },
    });
  }

  private renderEdgesFor(nodes: CanvasNode[]): void {
    const set = new Set(nodes);
    for (const e of this.edges.values()) if (set.has(e.from.node) || set.has(e.to.node)) e.render();
  }

  private renderSnaps(s: G.SnapResult, b: G.BBox): void {
    if (!this.snapEl.parentNode) this.canvasEl.appendChild(this.snapEl);
    this.snapEl.style.zIndex = String(this.zIndexCounter + 3);
    this.snapEl.innerHTML = "";
    const ns = "http://www.w3.org/2000/svg";
    const line = (x1: number, y1: number, x2: number, y2: number) => {
      const l = document.createElementNS(ns, "line");
      l.setAttribute("x1", String(x1));
      l.setAttribute("y1", String(y1));
      l.setAttribute("x2", String(x2));
      l.setAttribute("y2", String(y2));
      this.snapEl.appendChild(l);
    };
    for (const gx of s.guidesX) line(gx, b.minY - 200, gx, b.maxY + 200);
    for (const gy of s.guidesY) line(b.minX - 200, gy, b.maxX + 200, gy);
  }

  private clearSnaps(): void {
    this.snapEl.innerHTML = "";
    this.snapEl.remove();
  }

  private dragResize(e: PointerEvent, node: CanvasNode, dir: string): void {
    const start = this.posFromEvt(e);
    const o = { x: node.x, y: node.y, w: node.width, h: node.height };
    const grid = () => (this.options.snapToGrid ? this.gridSpacing : 0);
    this.track(
      e,
      {
        move: (ev) => {
          if (!this.isDragging) this.setDragging(true);
          const p = this.posFromEvt(ev);
          const dx = p.x - start.x, dy = p.y - start.y;
          let x = o.x, y = o.y, r = o.x + o.w, b = o.y + o.h;
          const snap = (v: number) => (grid() && !ev.altKey ? G.snapToGrid(v, grid()) : v);
          if (dir.includes("left")) x = Math.min(snap(o.x + dx), r - MIN_SIZE);
          if (dir.includes("right")) r = Math.max(snap(o.x + o.w + dx), x + MIN_SIZE);
          if (dir.includes("top")) y = Math.min(snap(o.y + dy), b - MIN_SIZE);
          if (dir.includes("bottom")) b = Math.max(snap(o.y + o.h + dy), y + MIN_SIZE);
          node.data.x = Math.round(x);
          node.data.y = Math.round(y);
          node.data.width = Math.round(r - x);
          node.data.height = Math.round(b - y);
          node.renderFrame();
          this.renderEdgesFor([node]);
          this.updateInteractionLayer();
        },
        end: (_ev, moved) => {
          if (moved) {
            this.setDragging(false);
            this.requestSave();
          }
        },
      },
      0,
    );
  }

  /** Drag from a card's side to connect it to another card (or drop on empty space to add one). */
  private dragConnect(e: PointerEvent, from: CanvasNode, side: Side): void {
    const temp: CanvasEdgeData = { id: randomId(), fromNode: from.id, fromSide: side, toNode: from.id, toSide: side };
    const edge = new CanvasEdge(this, temp, from, from);
    edge.floatingTo = this.posFromEvt(e);
    edge.attach();
    edge.render();
    let target: CanvasNode | null = null;
    let targetSide: Side = "left";
    this.wrapperEl.addClass("is-connecting");
    this.track(
      e,
      {
        move: (ev) => {
          if (!this.isDragging) this.setDragging(true);
          const p = this.posFromEvt(ev);
          target = this.nodeAt(p, from);
          if (target) {
            targetSide = G.nearestSide(target.getBBox(), p);
            edge.floatingTo = null;
            edge.to = { node: target, side: targetSide, end: "arrow" };
          } else {
            edge.floatingTo = p;
            edge.to = { node: from, side: oppositeSideTowards(from.getBBox(), p), end: "arrow" };
          }
          edge.render();
        },
        end: (ev, moved) => {
          this.wrapperEl.removeClass("is-connecting");
          edge.destroy();
          this.setDragging(false);
          if (!moved) return;
          if (target) {
            const created = this.addEdge(from, side, target, targetSide);
            if (created) this.selectOnly(created);
            return;
          }
          const p = this.posFromEvt(ev);
          this.showCreateMenu(ev, p, (n) => {
            const s = oppositeSide(side);
            const e2 = this.addEdge(from, side, n, s);
            if (e2) e2.render();
          });
        },
      },
      0,
    );
  }

  private nodeAt(p: G.Point, exclude?: CanvasNode): CanvasNode | null {
    let best: CanvasNode | null = null;
    for (const n of this.nodes.values()) {
      if (n === exclude) continue;
      const b = G.expandBBox(n.getBBox(), SNAP_DISTANCE / this.scale);
      if (p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY) {
        if (!best || n.renderZ() > best.renderZ()) best = n;
      }
    }
    return best;
  }

  /** Drag an edge's end to another card. */
  private dragEdgeEnd(e: PointerEvent, edge: CanvasEdge): void {
    const p0 = this.posFromEvt(e);
    const g = edge.getBBox();
    void g;
    const fromPt = G.sidePoint(edge.from.node.getBBox(), edge.from.side);
    const toPt = G.sidePoint(edge.to.node.getBBox(), edge.to.side);
    const nearTo = G.distance(p0, toPt) <= G.distance(p0, fromPt);
    const fixed = nearTo ? edge.from : edge.to;
    const original = { from: { ...edge.from }, to: { ...edge.to } };
    let changed = false;
    this.track(e, {
      move: (ev) => {
        if (!this.isDragging) this.setDragging(true);
        const p = this.posFromEvt(ev);
        const t = this.nodeAt(p, fixed.node);
        if (!t) return;
        const s = G.nearestSide(t.getBBox(), p);
        if (nearTo) edge.to = { node: t, side: s, end: edge.to.end };
        else edge.from = { node: t, side: s, end: edge.from.end };
        changed = true;
        edge.render();
      },
      end: (_ev, moved) => {
        this.setDragging(false);
        if (!moved) return;
        if (changed && (edge.from.node !== original.from.node || edge.to.node !== original.to.node || edge.from.side !== original.from.side || edge.to.side !== original.to.side)) {
          edge.syncData();
          this.requestSave();
        }
      },
    });
  }

  private dragSelect(e: PointerEvent): void {
    const start = this.posFromEvt(e);
    const before = new Set(this.selection);
    const shift = e.shiftKey;
    let box: HTMLElement | null = null;
    this.track(e, {
      move: (ev) => {
        const p = this.posFromEvt(ev);
        if (!box) box = this.canvasEl.createDiv("canvas-selection");
        const b = { minX: Math.min(start.x, p.x), minY: Math.min(start.y, p.y), maxX: Math.max(start.x, p.x), maxY: Math.max(start.y, p.y) };
        box.style.transform = `translate(${b.minX}px, ${b.minY}px)`;
        box.style.width = b.maxX - b.minX + "px";
        box.style.height = b.maxY - b.minY + "px";
        box.style.zIndex = String(this.zIndexCounter + 3);
        const hit = new Set<Selectable>([...this.nodes.values()].filter((n) => G.intersects(b, n.getBBox())));
        let next = hit;
        if (shift) {
          next = new Set(before);
          for (const h of hit) {
            if (next.has(h)) next.delete(h);
            else next.add(h);
          }
        }
        this.selection = next;
        this.updateSelection();
      },
      end: (_ev, moved) => {
        (box as HTMLElement | null)?.remove();
        if (!moved && !shift) this.deselectAll();
      },
    });
  }

  /** Ctrl/Cmd + drag on empty space: create something the size of the box (setting). */
  private dragCreate(e: PointerEvent): void {
    if (this.readonly) return this.dragSelect(e);
    const start = this.posFromEvt(e);
    let box: HTMLElement | null = null;
    let rect = { x: start.x, y: start.y, width: 0, height: 0 };
    this.track(e, {
      move: (ev) => {
        const p = this.posFromEvt(ev);
        if (!box) box = this.canvasEl.createDiv("canvas-selection");
        rect = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) };
        box.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
        box.style.width = rect.width + "px";
        box.style.height = rect.height + "px";
        box.style.zIndex = String(this.zIndexCounter + 3);
      },
      end: (ev, moved) => {
        const done = () => (box as HTMLElement | null)?.remove();
        if (!moved || rect.width < 20 || rect.height < 20) return done();
        const size = { width: Math.max(MIN_SIZE, Math.round(rect.width)), height: Math.max(MIN_SIZE, Math.round(rect.height)) };
        const pos = { x: rect.x, y: rect.y };
        const behavior = this.options.defaultModDragBehavior ?? "menu";
        const run = (kind: string) => {
          done();
          if (kind === "card") this.createTextNode(pos, "", false, size);
          else if (kind === "note") this.pickFile(false, (f) => this.createFileNode(pos, f, false, "", size));
          else if (kind === "media") this.pickFile(true, (f) => this.createFileNode(pos, f, false, "", size));
          else if (kind === "webpage") this.promptUrl((url) => this.createNode({ id: randomId(), ...this.rectAt(pos, size, false), type: "link", url } as CanvasNodeData));
          else if (kind === "group") this.createGroupNode({ ...pos, ...size });
        };
        if (behavior !== "menu") return run(behavior);
        const m = new Menu();
        m.addItem((i: any) => i.setTitle("Add card").setIcon("sticky-note").onClick(() => run("card")));
        m.addItem((i: any) => i.setTitle("Add note from vault").setIcon("file-text").onClick(() => run("note")));
        m.addItem((i: any) => i.setTitle("Add media from vault").setIcon("file-image").onClick(() => run("media")));
        m.addItem((i: any) => i.setTitle("Add web page").setIcon("globe").onClick(() => run("webpage")));
        m.addItem((i: any) => i.setTitle("Create group").setIcon("group").onClick(() => run("group")));
        (m as any).onHide?.(() => done());
        m.showAtMouseEvent(ev);
        setTimeout(() => {
          if (!document.querySelector(".menu")) done();
        }, 4000);
      },
    });
  }

  private showCreateMenu(ev: MouseEvent, p: G.Point, then: (n: CanvasNode) => void): void {
    const m = new Menu();
    m.addItem((i: any) =>
      i
        .setTitle("Add card")
        .setIcon("sticky-note")
        .onClick(() => then(this.createTextNode(p, "", true))),
    );
    m.addItem((i: any) =>
      i
        .setTitle("Add note from vault")
        .setIcon("file-text")
        .onClick(() => this.pickFile(false, (f) => then(this.createFileNode(p, f, true)))),
    );
    m.addItem((i: any) =>
      i
        .setTitle("Add media from vault")
        .setIcon("file-image")
        .onClick(() => this.pickFile(true, (f) => then(this.createFileNode(p, f, true)))),
    );
    m.showAtMouseEvent(ev);
  }

  promptUrl(cb: (url: string) => void): void {
    void this.app.ui
      ?.prompt({ title: "Add web page", placeholder: "https://example.com", cta: "Add" })
      .then((v: string | null) => {
        if (!v) return;
        let url = v.trim();
        if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = "https://" + url;
        try {
          new URL(url);
        } catch {
          new Notice("That doesn't look like a web address.");
          return;
        }
        cb(url);
      });
  }

  private onDoubleClick(e: MouseEvent): void {
    if (this.readonly) return;
    const t = e.target as HTMLElement;
    if (t.closest(".canvas-controls, .canvas-card-menu, .canvas-menu-container")) return;
    const edge = this.edgeFromTarget(t);
    if (edge) {
      this.selectOnly(edge);
      edge.editLabel();
      return;
    }
    const node = this.nodeFromTarget(t);
    if (node) {
      if (node.isEditing) return;
      if (node instanceof GroupNode && !t.closest(".canvas-group-label")) {
        // double click inside a group's empty area adds a card there
        this.createTextNode(this.posFromEvt(e), "", true);
        return;
      }
      this.startEditing(node);
      return;
    }
    if (t.closest(".canvas-node-interaction-layer")) return;
    this.createTextNode(this.posFromEvt(e), "", true);
  }

  private onContextMenu(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    if (t.closest(".canvas-controls, .canvas-card-menu, .canvas-menu-container")) return;
    if (this.isTyping() && t.closest(".cm-editor, .canvas-path-label, .canvas-group-label")) return;
    e.preventDefault();
    const m = new Menu();
    const edge = this.edgeFromTarget(t);
    const node = this.nodeFromTarget(t);
    const p = this.posFromEvt(e);
    if (edge) {
      if (!this.selection.has(edge)) this.selectOnly(edge);
      if (!this.readonly) {
        m.addItem((i: any) => i.setTitle("Edit label").setIcon("pencil").onClick(() => edge.editLabel()));
        m.addItem((i: any) => i.setTitle("Remove").setIcon("trash-2").setWarning(true).onClick(() => this.deleteSelection()));
      }
      m.addItem((i: any) =>
        i
          .setTitle("Go to the other end")
          .setIcon("corner-down-right")
          .onClick(() => {
            const a = G.sidePoint(edge.from.node.getBBox(), edge.from.side);
            const b = G.sidePoint(edge.to.node.getBBox(), edge.to.side);
            const far = G.distance(p, a) > G.distance(p, b) ? edge.from.node : edge.to.node;
            this.zoomToBbox(far.getBBox());
          }),
      );
      this.app.workspace.trigger("canvas:edge-menu", m, edge);
    } else if (node) {
      if (!this.selection.has(node)) this.selectOnly(node);
      if (this.selection.size > 1) this.selectionMenu(m);
      else this.nodeMenu(m, node);
      this.app.workspace.trigger("canvas:node-menu", m, node);
    } else {
      if (!this.readonly) {
        m.addItem((i: any) => i.setTitle("Add card").setIcon("sticky-note").onClick(() => this.createTextNode(p, "", true)));
        m.addItem((i: any) => i.setTitle("Add note from vault").setIcon("file-text").onClick(() => this.pickFile(false, (f) => this.createFileNode(p, f, true))));
        m.addItem((i: any) => i.setTitle("Add media from vault").setIcon("file-image").onClick(() => this.pickFile(true, (f) => this.createFileNode(p, f, true))));
        m.addItem((i: any) => i.setTitle("Add web page").setIcon("globe").onClick(() => this.promptUrl((url) => this.createLinkNode(p, url, true))));
        m.addSeparator();
        m.addItem((i: any) =>
          i
            .setTitle("Paste")
            .setIcon("clipboard-paste")
            .onClick(() => void this.pasteFromClipboard(p)),
        );
      }
      m.addItem((i: any) => i.setTitle("Select all").setIcon("box-select").onClick(() => this.selectAll()));
      this.app.workspace.trigger("canvas:menu", m, this);
    }
    m.showAtMouseEvent(e);
  }

  private selectionMenu(m: Menu): void {
    if (!this.readonly) m.addItem((i: any) => i.setTitle("Remove").setIcon("trash-2").setWarning(true).onClick(() => this.deleteSelection()));
    m.addItem((i: any) => i.setTitle("Zoom to selection").setIcon("scan").onClick(() => this.zoomToSelection()));
    if (!this.readonly) m.addItem((i: any) => i.setTitle("Create group").setIcon("group").onClick(() => this.groupSelection()));
  }

  private nodeMenu(m: Menu, node: CanvasNode): void {
    if (node instanceof FileNode && node.file) {
      const f = node.file;
      m.addItem((i: any) => i.setTitle("Open in new tab").setIcon("file-plus").onClick(() => this.app.workspace.getLeaf("tab").openFile(f, { eState: node.data.subpath ? { subpath: node.data.subpath } : undefined })));
      m.addItem((i: any) => i.setTitle("Open to the right").setIcon("separator-vertical").onClick(() => this.app.workspace.getLeaf("split").openFile(f)));
      this.app.workspace.trigger("file-menu", m, f, "canvas-menu", this.host);
    }
    if (node.data.type === "link" && node.data.url) m.addItem((i: any) => i.setTitle("Open in browser").setIcon("globe").onClick(() => this.app.openExternal?.(node.data.url)));
    if (!this.readonly) {
      if (node.isEditable()) m.addItem((i: any) => i.setTitle("Edit").setIcon("pencil").onClick(() => this.startEditing(node)));
      if (node instanceof TextNode) m.addItem((i: any) => i.setTitle("Convert to file...").setIcon("file-plus-2").onClick(() => void this.convertToFile(node)));
      m.addItem((i: any) => i.setTitle("Remove").setIcon("trash-2").setWarning(true).onClick(() => this.deleteSelection()));
    }
    m.addItem((i: any) => i.setTitle("Zoom to selection").setIcon("scan").onClick(() => this.zoomToSelection()));
  }

  /** Turn a text card into a note and show that note in its place. */
  async convertToFile(node: TextNode): Promise<void> {
    const text = node.data.text ?? "";
    const first = text.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "").replace(/[\\/:*?"<>|#^[\]]/g, "").trim().slice(0, 60) || "Untitled";
    const name: string | null = await this.app.ui?.prompt({ title: "Convert to file", value: first, cta: "Convert" });
    if (!name) return;
    const parent = this.app.fileManager.getNewFileParent(this.filePath);
    const base = (parent && !parent.isRoot?.() ? parent.path + "/" : "") + name.replace(/\.md$/i, "");
    const path = this.app.vault.getAvailablePath(base, "md");
    const file = await this.app.vault.create(path, text);
    const nd: CanvasNodeData = { ...node.data, type: "file", file: file.path };
    delete nd.text;
    const edges = this.getEdgesForNode(node).map((e) => {
      e.syncData();
      return { ...e.data };
    });
    this.removeNode(node);
    const n = this.addNodeData(nd, true);
    for (const ed of edges) this.addEdgeData(ed, true);
    this.selectOnly(n);
    this.requestSave();
  }

  // ---------- keyboard & clipboard ----------
  private onKeyDown(e: KeyboardEvent): void {
    if (this.isTyping()) {
      if (e.key === "Escape") {
        e.preventDefault();
        this.stopEditingAll();
        this.wrapperEl.focus({ preventScroll: true });
      }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if ((k === "Delete" || k === "Backspace") && !mod) {
      e.preventDefault();
      this.deleteSelection();
    } else if (k === "Escape") {
      this.deselectAll();
    } else if (mod && k.toLowerCase() === "a") {
      e.preventDefault();
      this.selectAll();
    } else if (mod && k.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    } else if (mod && (k.toLowerCase() === "y" || (k.toLowerCase() === "z" && e.shiftKey))) {
      e.preventDefault();
      this.redo();
    } else if (e.shiftKey && (k === "!" || e.code === "Digit1")) {
      e.preventDefault();
      this.zoomToFit();
    } else if (e.shiftKey && (k === "@" || e.code === "Digit2")) {
      e.preventDefault();
      this.zoomToSelection();
    } else if (k === "Enter" && this.selection.size === 1) {
      const [s] = this.selection;
      e.preventDefault();
      if (s instanceof CanvasNode) this.startEditing(s);
      else s.editLabel();
    } else if (k.startsWith("Arrow") && this.selection.size && !this.readonly) {
      e.preventDefault();
      this.nudge(k.slice(5).toLowerCase(), e.shiftKey);
    } else if (mod && (k === "=" || k === "+")) {
      e.preventDefault();
      this.zoomBy(0.5, null);
    } else if (mod && k === "-") {
      e.preventDefault();
      this.zoomBy(-0.5, null);
    } else if (mod && k === "0") {
      e.preventDefault();
      this.tZoom = 0;
      this.zoomCenter = null;
      this.markViewportChanged();
    }
  }

  private nudge(dir: string, big: boolean): void {
    const nodes = this.movingSet();
    if (!nodes.length) return;
    const step = (big ? 5 : 1) * this.gridSpacing;
    let dx = dir === "left" ? -step : dir === "right" ? step : 0;
    let dy = dir === "up" ? -step : dir === "down" ? step : 0;
    if (this.options.snapToGrid) {
      const g = this.gridSpacing;
      const b = G.unionBBox(nodes.map((n) => n.getBBox()));
      const offX = ((Math.round(b.minX) % g) + g) % g, offY = ((Math.round(b.minY) % g) + g) % g;
      if (dx && offX) dx = dx < 0 ? -offX : g - offX;
      if (dy && offY) dy = dy < 0 ? -offY : g - offY;
    }
    for (const n of nodes) {
      n.data.x += dx;
      n.data.y += dy;
      n.renderFrame();
    }
    this.renderEdgesFor(nodes);
    this.updateInteractionLayer();
    this.positionMenu();
    this.requestSave();
  }

  /** Selected cards and the edges between them, for copy/cut. */
  getSelectionData(): { nodes: CanvasNodeData[]; edges: CanvasEdgeData[]; center: G.Point } | null {
    const nodes = [...this.selection].filter((s): s is CanvasNode => s instanceof CanvasNode);
    if (!nodes.length) return null;
    const ids = new Set(nodes.map((n) => n.id));
    const edges = [...this.edges.values()]
      .filter((e) => ids.has(e.from.node.id) && ids.has(e.to.node.id))
      .map((e) => {
        e.syncData();
        return JSON.parse(JSON.stringify(e.data));
      });
    return { nodes: nodes.map((n) => JSON.parse(JSON.stringify(n.data))), edges, center: G.center(G.unionBBox(nodes.map((n) => n.getBBox()))) };
  }

  handleCopy(e: ClipboardEvent, cut = false): boolean {
    if (this.isTyping()) return false;
    const d = this.getSelectionData();
    if (!d) return false;
    e.preventDefault();
    const text = d.nodes
      .map((n) => (n.type === "text" ? n.text : n.type === "file" ? `![[${n.file}${n.subpath ?? ""}]]` : n.type === "link" ? n.url : n.label ?? ""))
      .filter(Boolean)
      .join("\n\n");
    e.clipboardData?.setData("text/plain", text ?? "");
    e.clipboardData?.setData("application/x-canvas-selection", JSON.stringify(d));
    if (cut && !this.readonly) this.deleteSelection();
    return true;
  }

  handlePaste(e: ClipboardEvent): boolean {
    if (this.isTyping() || this.readonly) return false;
    const dt = e.clipboardData;
    if (!dt) return false;
    e.preventDefault();
    const p = this.isPointerInside() ? this.pointer : this.posCenter();
    const json = dt.getData("application/x-canvas-selection");
    if (json) {
      try {
        this.importData(JSON.parse(json), p);
        return true;
      } catch {
        /* fall through */
      }
    }
    const files = Array.from(dt.files ?? []);
    if (files.length) {
      void this.addDroppedFiles(files, p);
      return true;
    }
    const text = dt.getData("text/plain");
    if (text) this.pasteText(text, p);
    return true;
  }

  private async pasteFromClipboard(p: G.Point): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      if (text) this.pasteText(text, p);
    } catch {
      new Notice("Couldn't read the clipboard.");
    }
  }

  private pasteText(text: string, p: G.Point): void {
    const t = text.trim();
    if (/^https?:\/\/\S+$/i.test(t)) {
      this.createLinkNode(p, t, true);
      return;
    }
    const embed = /^!?\[\[([^\]|#]+)(#[^\]|]*)?(?:\|[^\]]*)?\]\]$/.exec(t);
    if (embed) {
      const f = this.app.metadataCache.getFirstLinkpathDest(embed[1], this.filePath);
      if (f) {
        this.createFileNode(p, f, true, embed[2] ?? "");
        return;
      }
    }
    this.createTextNode(p, text, true, TEXT_SIZE, false);
  }

  private isPointerInside(): boolean {
    const v = this.getViewportBBox();
    return this.pointer.x >= v.minX && this.pointer.x <= v.maxX && this.pointer.y >= v.minY && this.pointer.y <= v.maxY;
  }

  /** Add copied cards/edges with new ids, centred on `at`. */
  importData(d: { nodes: CanvasNodeData[]; edges: CanvasEdgeData[]; center?: G.Point }, at: G.Point): void {
    const map = new Map<string, string>();
    const c = d.center ?? G.center(G.unionBBox(d.nodes.map((n) => G.bboxOf(n))));
    const added: CanvasNode[] = [];
    for (const n of d.nodes) {
      const id = randomId();
      map.set(n.id, id);
      const nd = { ...n, id, x: Math.round(n.x - c.x + at.x), y: Math.round(n.y - c.y + at.y) };
      const node = this.addNodeData(nd, true);
      if (!(node instanceof GroupNode)) node.zIndex = this.nextZ();
      node.renderFrame();
      added.push(node);
    }
    for (const ed of d.edges) {
      const from = map.get(ed.fromNode), to = map.get(ed.toNode);
      if (from && to) this.addEdgeData({ ...ed, id: randomId(), fromNode: from, toNode: to }, true);
    }
    this.selection = new Set(added);
    this.updateSelection();
    this.requestSave();
  }

  private onDrop(e: DragEvent): void {
    if (this.readonly) return;
    const dt = e.dataTransfer;
    if (!dt) return;
    e.preventDefault();
    e.stopPropagation(); // don't let the tab area open the dropped file instead
    const p = this.posFromEvt(e);
    const vaultPath = dt.getData("application/x-bedrock-file");
    if (vaultPath) {
      const f = this.app.vault.getAbstractFileByPath(vaultPath);
      if (f && f.extension) this.createFileNode(p, f, true);
      else if (f && f.children) {
        // a folder: add every note in it, side by side
        let i = 0;
        for (const child of f.children) if (child.extension) this.createFileNode({ x: p.x + i++ * 420, y: p.y }, child, true);
      }
      return;
    }
    const files = Array.from(dt.files ?? []);
    if (files.length) {
      void this.addDroppedFiles(files, p);
      return;
    }
    const url = dt.getData("text/uri-list") || dt.getData("text/plain");
    if (url) this.pasteText(url, p);
  }

  private async addDroppedFiles(files: File[], p: G.Point): Promise<void> {
    let i = 0;
    for (const file of files) {
      const abs = (file as any).path as string | undefined;
      const base = this.app.vault.adapter.getBasePath?.() ?? this.app.vault.adapter.basePath;
      let tf: any = null;
      if (abs && base && abs.replace(/\\/g, "/").toLowerCase().startsWith(String(base).replace(/\\/g, "/").toLowerCase() + "/")) {
        tf = this.app.vault.getAbstractFileByPath(abs.replace(/\\/g, "/").slice(String(base).length + 1));
      }
      if (!tf) {
        let name = file.name || "Pasted image";
        if (!file.name && file.type.startsWith("image/")) {
          const d = new Date();
          const pad = (n: number) => String(n).padStart(2, "0");
          name = `Pasted image ${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${file.type.split("/")[1]}`;
        }
        const path = await this.app.fileManager.getAvailablePathForAttachment(name, this.filePath);
        tf = await this.app.vault.createBinary(path, await file.arrayBuffer());
      }
      if (tf) this.createFileNode({ x: p.x + i++ * 420, y: p.y }, tf, true);
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    clearTimeout(this.historyTimer);
    this.resizeObs.disconnect();
    for (const c of this.cleanup) c();
    for (const n of this.nodes.values()) n.destroy();
    this.wrapperEl.remove();
  }
}

function oppositeSide(s: Side): Side {
  return s === "top" ? "bottom" : s === "bottom" ? "top" : s === "left" ? "right" : "left";
}

function oppositeSideTowards(from: G.BBox, p: G.Point): Side {
  const c = G.center(from);
  const dx = p.x - c.x, dy = p.y - c.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "left" : "right";
  return dy > 0 ? "top" : "bottom";
}

class CanvasHelpModal extends Modal {
  onOpen(): void {
    this.titleEl.setText("Canvas help");
    this.modalEl.addClass("canvas-help");
    const rows: [string, string][] = [
      ["Add a card", "Double click empty space, or drag from the bar at the bottom"],
      ["Edit a card", "Double click it, or select it and press Enter"],
      ["Select several", "Drag a box on empty space, or Shift + click"],
      ["Connect cards", "Drag from the dot on a card's edge to another card"],
      ["Pan", "Scroll, Space + drag, or drag with the middle button"],
      ["Zoom", "Ctrl + scroll"],
      ["Zoom to fit", "Shift + 1"],
      ["Zoom to selection", "Shift + 2"],
      ["Move a little", "Arrow keys (Shift for bigger steps)"],
      ["Undo / redo", "Ctrl + Z / Ctrl + Shift + Z"],
      ["Create by drawing", "Ctrl + drag on empty space"],
      ["Ignore snapping", "Hold Alt while dragging"],
    ];
    for (const [a, b] of rows) {
      const r = this.contentEl.createDiv("canvas-help-row");
      r.createSpan({ text: a });
      r.createSpan({ text: b });
    }
  }
}
