// Graph view (`graph`) and local graph (`localgraph`): wires the metadata cache to the graph data
// builder, the settings panel, the WebGL renderer and the layout worker. Global options live in
// `.obsidian/graph.json`; the local graph keeps its options in its leaf state.
import { ItemView } from "../../workspace/view";
import type { WorkspaceLeaf } from "../../workspace/leaf";
import { Menu } from "../../ui/menu";
import { Keymap } from "../../commands/keymap";
import { getAllTags } from "../../../core/parse";
import { GraphRenderer } from "./renderer";
import { GraphControls, type ControlsHost } from "./controls";
import { buildGraphData, localGraph, markFocused, removeOrphans, isAttachmentPath, extensionOf, type FilterType, type GraphSource, type NodeType } from "./data";
import { GraphQuery } from "./query";
import { graphJsonText, mergeOptions, serializeOptions, sliderToStrength, type GraphColor, type GraphOptions } from "./options";
import { installGraphStyles } from "./styles";

const GRAPH_JSON = "graph.json";

/** Files the graph knows about: notes, canvases, bases and the attachment types the app can show. */
const KNOWN_EXTS = new Set(["md", "canvas", "base", "bmp", "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "mp3", "wav", "m4a", "3gp", "flac", "ogg", "oga", "opus", "mp4", "webm", "ogv", "mov", "mkv", "pdf"]);

export function graphSourceFromApp(app: any): GraphSource {
  const mc = app.metadataCache;
  return {
    files: app.vault.getFiles().filter((f: any) => KNOWN_EXTS.has(f.extension)).map((f: any) => f.path),
    resolvedLinks: mc.resolvedLinks,
    unresolvedLinks: mc.unresolvedLinks,
    fileTags: (p: string) => {
      const c = mc.getCache(p);
      return c ? getAllTags(c) : null;
    },
    vaultTags: () => Object.keys(mc.getTags()),
    isUserIgnored: (p: string) => mc.isUserIgnored(p),
    fileTime: (p: string) => {
      const f = app.vault.getFileByPath(p);
      return f ? Math.min(f.stat.ctime || Infinity, f.stat.mtime || Infinity) : Infinity;
    },
  };
}

/** Shared engine behind both views. */
class GraphEngine implements ControlsHost {
  options: GraphOptions;
  renderer: GraphRenderer;
  controls: GraphControls;
  private queries: { query: GraphQuery; color: GraphColor | null }[] | null = null;
  private fileFilter: Record<string, boolean | GraphColor> = {};
  private hasFilter = false;
  private searchToken = 0;
  progression = 0;
  currentFocusFile = "";
  private renderTimer: any = null;
  private saveTimer: any = null;

  constructor(public app: any, public view: GraphView | LocalGraphView, public local: boolean, initial: any) {
    this.options = mergeOptions(initial, local);
    this.renderer = new GraphRenderer(view.contentEl);
    this.renderer.hooks = {
      onNodeClick: (e, id, type) => this.onNodeClick(e, id, type),
      onNodeRightClick: (e, id, type) => this.onNodeRightClick(e, id, type),
      onNodeHover: (e, id, type) => this.onNodeHover(e, id, type),
    };
    this.controls = new GraphControls(view.contentEl, this);
    this.applyOptions(this.options, true);
  }

  isDark(): boolean {
    return !!this.app.isDarkMode?.();
  }

  // ---------- options ----------
  applyOptions(o: GraphOptions, initial = false): void {
    this.options = o;
    this.controls.setOptions(o);
    this.renderer.setRenderOptions(o);
    this.renderer.setForces(this.forcesFrom(o));
    if (initial || o.scale) {
      this.renderer.setScale(o.scale || 1);
      this.renderer.targetScale = o.scale || 1;
    }
    this.updateSearch();
  }

  forcesFrom(o: GraphOptions) {
    return {
      center: sliderToStrength(o.centerStrength),
      repel: Math.pow(o.repelStrength, 3),
      link: sliderToStrength(o.linkStrength),
      distance: o.linkDistance,
    };
  }

  getOptions(): GraphOptions {
    const o: any = { ...this.options };
    o.close = this.controls.el.hasClass("is-close");
    o.scale = this.renderer.targetScale;
    return o;
  }

  onOption(key: string, value: any, kind: "data" | "render" | "forces" | "search" | "none"): void {
    this.options[key] = value;
    if (kind === "data") this.requestRender();
    else if (kind === "render") this.renderer.setRenderOptions({ [key]: value } as any);
    else if (kind === "forces") this.renderer.setForces(this.forcesFrom(this.options));
    else if (kind === "search") this.updateSearch();
    this.onSave();
  }

  onReset(): void {
    const defaults = GraphControls.resetValues(this.local);
    Object.assign(this.options, defaults);
    this.controls.setOptions(defaults);
    this.renderer.setRenderOptions(this.options);
    this.renderer.setForces(this.forcesFrom(this.options));
    this.updateSearch();
    this.onSave();
  }

  onSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.view.onOptionsChange(), 100);
  }

  onAnimate(): void {
    void this.renderProgression();
  }

  // ---------- search filter / colour groups ----------
  updateSearch(): void {
    const token = ++this.searchToken;
    const list: { query: GraphQuery; color: GraphColor | null }[] = [];
    if (this.options.search) list.push({ query: new GraphQuery(this.options.search), color: null });
    for (const g of this.options.colorGroups ?? []) if (g.query) list.push({ query: new GraphQuery(g.query), color: g.color });
    const queries = list.filter((q) => !q.query.empty);
    this.hasFilter = queries.some((q) => !q.color);
    if (!queries.length) {
      this.queries = null;
      this.fileFilter = {};
      this.requestRender();
      return;
    }
    this.queries = queries;
    const filter: Record<string, boolean | GraphColor> = {};
    this.fileFilter = filter;
    const needsContent = queries.some((q) => q.query.needsContent);
    const files = this.app.vault.getFiles();
    const mc = this.app.metadataCache;
    this.controls.setSearching(true);
    let i = 0;
    let last = performance.now();
    const step = async () => {
      const end = Math.min(files.length, i + 200);
      for (; i < end; i++) {
        if (token !== this.searchToken) return;
        const f = files[i];
        const cache = mc.getFileCache(f);
        let content: string | null = null;
        if (needsContent && (f.extension === "md" || f.extension === "canvas")) {
          try {
            content = await this.app.vault.cachedRead(f);
          } catch {
            content = null;
          }
        }
        const target = { path: f.path, name: f.name, tags: (cache && getAllTags(cache)) || [], content };
        let ok = true;
        let color: GraphColor | null = null;
        for (const q of queries) {
          const m = q.query.match(target);
          if (!m && !q.color) {
            ok = false;
            break;
          }
          if (m && q.color) {
            color = q.color;
            break;
          }
        }
        filter[f.path] = ok ? color ?? true : false;
      }
      if (token !== this.searchToken) return;
      if (performance.now() - last > 333) {
        last = performance.now();
        this.render();
      }
      if (i < files.length) setTimeout(step, 0);
      else {
        this.controls.setSearching(false);
        this.render();
      }
    };
    void step();
  }

  private nodeFilter = (id: string, type: FilterType): boolean | GraphColor => {
    const q = this.queries;
    if (!q) return true;
    if (type === "") {
      if (id === this.localFile()) return true;
      return id in this.fileFilter ? this.fileFilter[id] : !this.hasFilter;
    }
    if (type === "tag") return q.every((x) => !!x.color || x.query.matchTag(id));
    if (type === "attachment") return q.every((x) => !!x.color || x.query.matchFilename(id));
    return true;
  };

  localFile(): string {
    return this.local ? (this.view as LocalGraphView).file ?? "" : "";
  }

  // ---------- data ----------
  requestRender(): void {
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      this.render();
    }, 50);
  }

  render(): number {
    const o = this.options;
    const local = this.local;
    if (local && !this.localFile()) {
      this.renderer.setData({ nodes: {} });
      return 0;
    }
    if (local) this.progression = 0;
    let data = buildGraphData(graphSourceFromApp(this.app), o, this.nodeFilter, this.progression);
    const steps = data.numLinks ?? 0;
    if (local) data = localGraph(data, { localFile: this.localFile(), localJumps: o.localJumps, localInterlinks: o.localInterlinks, localForelinks: o.localForelinks, localBacklinks: o.localBacklinks });
    if (!local && !o.showOrphans) removeOrphans(data);
    if (this.currentFocusFile) markFocused(data, this.currentFocusFile);
    this.renderer.setData(data);
    return steps;
  }

  async renderProgression(): Promise<void> {
    this.progression = 1;
    const total = this.render();
    const speed = Math.min(100, Math.max(5, 0.5 * Math.sqrt(total)));
    const t0 = Date.now();
    while (this.progression > 0) {
      const cur = this.progression;
      await new Promise((r) => setTimeout(r, 0));
      if (cur !== this.progression) break;
      const next = 1 + Math.floor((speed * (Date.now() - t0)) / 1000);
      if (next === this.progression) continue;
      this.progression = next;
      if (next > total) {
        this.progression = 0;
        this.render();
        break;
      }
      this.render();
      await new Promise((r) => setTimeout(r, 16));
    }
  }

  onFileOpen(path: string): void {
    if (path === this.currentFocusFile) return;
    this.currentFocusFile = path;
    this.requestRender();
  }

  // ---------- node interaction ----------
  private onNodeClick(e: MouseEvent, id: string, type: NodeType): void {
    if (type === "tag") {
      this.openTagSearch(id);
      return;
    }
    const mod = Keymap.isModEvent(e) || (e.button === 1 ? "tab" : false);
    void this.app.workspace.openLinkText(id, "", mod);
  }

  private openTagSearch(tag: string): void {
    const search = this.app.internalPlugins?.getEnabledPluginById?.("global-search");
    if (search?.openGlobalSearch) search.openGlobalSearch("tag:" + tag);
  }

  private onNodeRightClick(e: MouseEvent, id: string, type: NodeType): void {
    if (type === "tag") {
      this.openTagSearch(id);
      return;
    }
    const file = this.app.metadataCache.getFirstLinkpathDest(id, "");
    if (!file) return;
    const menu = new Menu();
    menu.addItem((i: any) => i.setTitle(file.basename).setIsLabel(true));
    menu.addItem((i: any) =>
      i
        .setTitle("Open in new tab")
        .setIcon("file-plus")
        .onClick(() => this.app.workspace.getLeaf("tab").openFile(file)),
    );
    this.app.workspace.trigger("file-menu", menu, file, "graph-context-menu", this.view.leaf);
    menu.addItem((i: any) =>
      i
        .setTitle("Delete file")
        .setIcon("trash-2")
        .setWarning(true)
        .onClick(() => this.app.fileManager.promptForDeletion?.(file)),
    );
    menu.showAtMouseEvent(e);
  }

  private onNodeHover(e: MouseEvent, id: string, type: NodeType): void {
    if (type === "" || type === "focused" || type === "attachment") {
      this.app.workspace.trigger("hover-link", { event: e, source: "graph", hoverParent: this.view, targetEl: null, linktext: id });
    }
  }

  destroy(): void {
    clearTimeout(this.renderTimer);
    clearTimeout(this.saveTimer);
    this.searchToken++;
    this.renderer.destroy();
  }
}

function bindEngineEvents(view: GraphView | LocalGraphView, getEngine: () => GraphEngine | null): void {
  const app = view.app;
  const rerender = () => getEngine()?.requestRender();
  view.registerEvent(app.metadataCache.on("resolved", rerender));
  view.registerEvent(app.metadataCache.on("resolve", rerender));
  view.registerEvent(app.vault.on("create", rerender));
  view.registerEvent(app.vault.on("delete", rerender));
  view.registerEvent(app.vault.on("rename", rerender));
  view.registerEvent(app.workspace.on("css-change", () => getEngine()?.renderer.testCSS()));
  // keyboard: arrows pan, +/- zoom, while this leaf is active and nothing else has focus
  const keyMap: Record<string, string> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", "=": "zoomin", "+": "zoomin", "-": "zoomout" };
  const onKey = (e: KeyboardEvent) => {
    const eng = getEngine();
    if (!eng) return;
    const r = eng.renderer;
    r.keyboardActions.shift = e.shiftKey;
    const down = e.type === "keydown";
    const action = keyMap[e.key];
    if (!action) return;
    if (down) {
      if (e.repeat || e.defaultPrevented || app.workspace.activeLeaf !== view.leaf || document.activeElement !== document.body) return;
    }
    r.keyboardActions[action] = down;
    r.changed();
  };
  view.registerDomEvent(window, "keydown", onKey);
  view.registerDomEvent(window, "keyup", onKey);
}

export class GraphView extends ItemView {
  engine: GraphEngine | null = null;
  icon = "git-fork";
  navigation = false;
  private loadedOptions: any = null;
  private lastSaved = "";

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    installGraphStyles();
  }

  getViewType(): string {
    return "graph";
  }
  getDisplayText(): string {
    return "Graph view";
  }

  protected async onOpen(): Promise<void> {
    this.contentEl.empty();
    let stored: any = null;
    try {
      const path = `${this.app.vault.configDir}/${GRAPH_JSON}`;
      if (await this.app.vault.adapter.exists(path)) {
        stored = JSON.parse(await this.app.vault.adapter.read(path));
        this.lastSaved = graphJsonText(mergeOptions(stored, false));
      }
    } catch {
      stored = null;
    }
    this.loadedOptions = stored;
    this.engine = new GraphEngine(this.app, this, false, stored);
    bindEngineEvents(this, () => this.engine);
    this.registerEvent(
      this.app.workspace.on("file-open", (f: any) => {
        // the open note is highlighted only when the graph isn't the active tab (it has no file itself)
        this.engine?.onFileOpen(f?.path ?? "");
      }),
    );
    // save the zoom level every couple of seconds if it changed (like the options)
    let lastScale = this.engine.renderer.targetScale;
    this.registerInterval(
      window.setInterval(() => {
        const s = this.engine?.renderer.targetScale;
        if (s !== undefined && s !== lastScale) {
          lastScale = s;
          this.onOptionsChange();
        }
      }, 2000),
    );
    this.engine.render();
  }

  /** Persist options to graph.json, only when something actually changed. */
  onOptionsChange(): void {
    if (!this.engine) return;
    const text = graphJsonText(this.engine.getOptions());
    if (text === this.lastSaved) return;
    this.lastSaved = text;
    const path = `${this.app.vault.configDir}/${GRAPH_JSON}`;
    this.app.vault.adapter.write(path, text).catch((e: any) => console.error("[graph] could not save graph.json", e));
  }

  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
  }

  onResize(): void {
    this.engine?.renderer.onResize();
  }

  protected async onClose(): Promise<void> {
    this.onOptionsChange();
    this.engine?.destroy();
    this.engine = null;
  }
}

export class LocalGraphView extends ItemView {
  engine: GraphEngine | null = null;
  icon = "git-fork";
  navigation = false;
  file: string | null = null;
  private pendingOptions: any = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    installGraphStyles();
  }

  getViewType(): string {
    return "localgraph";
  }

  getDisplayText(): string {
    if (!this.file) return "Graph";
    const f = this.app.vault.getFileByPath(this.file);
    const name = f ? f.basename : this.file.split("/").pop()!.replace(/\.md$/i, "");
    return `Graph of ${name}`;
  }

  getState(): Record<string, any> {
    const st: Record<string, any> = {};
    if (this.file) st.file = this.file;
    st.options = serializeOptions(this.engine ? this.engine.getOptions() : mergeOptions(this.pendingOptions, true), true);
    return st;
  }

  async setState(state: any, _r: { history: boolean }): Promise<void> {
    if (state?.options) {
      if (this.engine) this.engine.applyOptions(mergeOptions(state.options, true));
      else this.pendingOptions = state.options;
    }
    if (typeof state?.file === "string") this.setFile(state.file);
  }

  setFile(path: string | null): void {
    if (path === this.file) return;
    this.file = path;
    if (this.engine) this.engine.render();
    this.updateHeader();
    this.leaf.updateHeader();
    this.app.workspace.requestSaveLayout?.();
  }

  updateHeader(): void {
    super.updateHeader();
    const f = this.file ? this.app.vault.getFileByPath(this.file) : null;
    this.titleParentEl.empty();
    const parent = f?.parent;
    if (parent && !parent.isRoot()) {
      for (const seg of parent.path.split("/")) {
        this.titleParentEl.createSpan({ cls: "view-header-breadcrumb", text: seg });
        this.titleParentEl.createSpan({ cls: "view-header-breadcrumb-separator", text: "/" });
      }
    }
    this.titleEl.setText("Local graph");
  }

  protected async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.engine = new GraphEngine(this.app, this, true, this.pendingOptions);
    bindEngineEvents(this, () => this.engine);
    this.registerEvent(
      this.app.workspace.on("file-open", (f: any) => {
        this.followFile(f);
        // the active note is drawn in the focus colour (none while the graph itself is active)
        this.engine?.onFileOpen(f?.path ?? "");
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (f: any, old: string) => {
        if (old === this.file) this.setFile(f.path);
      }),
    );
    if (!this.file) {
      const active = this.app.workspace.getActiveFile?.();
      if (active) this.file = active.path;
    }
    const act = this.app.workspace.activeLeaf;
    this.engine.currentFocusFile = act && act !== this.leaf ? (act.view as any)?.file?.path ?? "" : "";
    this.engine.render();
  }

  /** Follow the open note: the linked tab's note when linked, otherwise the active note (unless pinned). */
  private followFile(f: any): void {
    if (!f || this.leaf.pinned) return;
    const group = this.leaf.group;
    const active = this.app.workspace.activeLeaf;
    if (group) {
      if (!active || active === this.leaf || active.group !== group) return;
    } else if (active === this.leaf) return;
    this.setFile(f.path);
  }

  onOptionsChange(): void {
    this.app.workspace.requestSaveLayout?.();
  }

  onResize(): void {
    this.engine?.renderer.onResize();
  }

  protected async onClose(): Promise<void> {
    this.engine?.destroy();
    this.engine = null;
  }
}

/** Register both views and the graph commands. */
export function registerGraph(app: any): void {
  installGraphStyles();
  app.viewRegistry.registerView("graph", (leaf: WorkspaceLeaf) => new GraphView(leaf));
  app.viewRegistry.registerView("localgraph", (leaf: WorkspaceLeaf) => new LocalGraphView(leaf));
  app.commands.addCommand({
    id: "graph:open",
    name: "Graph view: Open graph view",
    icon: "git-fork",
    hotkeys: [{ modifiers: ["Mod"], key: "G" }],
    callback: () => openGraph(app),
  });
  app.commands.addCommand({
    id: "graph:open-local",
    name: "Graph view: Open local graph",
    icon: "git-fork",
    checkCallback: (checking: boolean) => {
      const f = app.workspace.getActiveFile?.();
      if (!f) return false;
      if (!checking) void openLocalGraph(app, f.path);
      return true;
    },
  });
  app.commands.addCommand({
    id: "graph:animate",
    name: "Graph view: Start graph timelapse animation",
    icon: "wand-2",
    checkCallback: (checking: boolean) => {
      const leaf = app.workspace.activeLeaf;
      const v = leaf?.view;
      if (!(v instanceof GraphView)) return false;
      if (!checking) v.engine?.onAnimate();
      return true;
    },
  });
}

export async function openGraph(app: any): Promise<void> {
  const existing = app.workspace.getLeavesOfType("graph")[0];
  if (existing) {
    app.workspace.setActiveLeaf(existing, { focus: true });
    return;
  }
  // reuse an empty tab (like Obsidian), otherwise open a new one
  const active = app.workspace.activeLeaf;
  const reuse = active && active.view?.getViewType?.() === "empty" && app.workspace.isRootLeaf?.(active);
  const leaf = reuse ? active : app.workspace.getLeaf("tab");
  await leaf.setViewState({ type: "graph", state: {}, active: true });
}

export async function openLocalGraph(app: any, path: string): Promise<void> {
  const ws = app.workspace;
  const source = ws.activeLeaf;
  const leaf = source ? ws.createLeafBySplit(source, "vertical") : ws.getLeaf("split");
  if (source) leaf.setGroupMember(source);
  await leaf.setViewState({ type: "localgraph", state: { file: path }, active: true });
}

export { isAttachmentPath, extensionOf };
