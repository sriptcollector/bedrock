// Workspace (obsidian API): root split + left/right sidedocks + ribbon, tab groups, splits,
// leaves, active leaf tracking, layout save/restore in .obsidian/workspace.json.
import { Events } from "../api/events";
import { TFile, TAbstractFile } from "../vault/files";
import { WorkspaceLeaf } from "./leaf";
import { TabDnd } from "./dnd";
import {
  WorkspaceItem,
  WorkspaceParent,
  WorkspaceRibbon,
  WorkspaceRoot,
  WorkspaceSidedock,
  WorkspaceSplit,
  WorkspaceTabs,
  type SplitDirection,
} from "./items";
import type { ViewRegistry } from "./registry";
import type { View, ViewState } from "./view";
import { PlaceholderView } from "../views/placeholder";
import { WorkspaceFloating, WorkspaceWindow, type WindowGeometry } from "./popout";
import { parseLinktext } from "../../core/links";

export type PaneType = "tab" | "split" | "window";

export class Workspace extends Events {
  app: any;
  containerEl: HTMLElement;
  leftRibbon: WorkspaceRibbon;
  rightRibbon: WorkspaceRibbon;
  leftSplit: WorkspaceSidedock;
  rightSplit: WorkspaceSidedock;
  rootSplit: WorkspaceRoot;
  floatingSplit: WorkspaceFloating;
  activeLeaf: WorkspaceLeaf | null = null;
  layoutReady = false;
  requestSaveLayout: () => void;
  dnd: TabDnd;
  lastOpenFiles: string[] = [];
  editorExtensions: any[] = [];
  private layoutReadyCbs: (() => any)[] = [];
  private saveTimer: any = null;
  private lastActiveFile: TFile | null = null;
  private saving = false;
  private loadingLayout = false;
  disableSave = false;

  constructor(app: any, public viewRegistry: ViewRegistry) {
    super();
    this.app = app;
    this.dnd = new TabDnd(this);
    this.containerEl = createDiv("workspace");
    this.leftSplit = new WorkspaceSidedock(this, "left");
    this.rightSplit = new WorkspaceSidedock(this, "right");
    this.rootSplit = new WorkspaceRoot(this);
    this.floatingSplit = new WorkspaceFloating(this);
    this.leftRibbon = new WorkspaceRibbon(this, "left");
    this.rightRibbon = new WorkspaceRibbon(this, "right");
    this.containerEl.append(this.leftRibbon.containerEl, this.leftSplit.containerEl, this.rootSplit.containerEl, this.rightSplit.containerEl, this.rightRibbon.containerEl);
    this.rightRibbon.containerEl.addClass("is-empty");
    this.on("layout-change", () => this.updateFrameCorners());
    this.requestSaveLayout = () => {
      if (!this.layoutReady || this.disableSave) return;
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.saveLayout(), 1000);
    };
    // Re-create placeholder leaves once a plugin registers their view type.
    viewRegistry.on("view-registered", (type: string) => {
      this.iterateAllLeaves((leaf) => {
        if (leaf.view instanceof PlaceholderView && leaf.view.placeholderType === type) {
          const st = leaf.view.getState();
          leaf.setViewState({ type, state: st });
        }
      });
    });
    viewRegistry.on("view-unregistered", (type: string) => {
      this.iterateAllLeaves((leaf) => {
        if (leaf.view?.getViewType() === type) leaf.setViewState({ type, state: leaf.view.getState() });
      });
    });
    window.addEventListener("resize", () => this.onResize());
  }

  // ---------- vault hooks ----------
  bindVault(vault: any): void {
    vault.on("rename", (file: TAbstractFile, oldPath: string) => {
      this.iterateAllLeaves((leaf) => {
        const v: any = leaf.view;
        if (v?.file === file) v.onRename?.(file);
      });
      this.lastOpenFiles = this.lastOpenFiles.map((p) => (p === oldPath ? file.path : p));
      this.requestSaveLayout();
    });
    vault.on("delete", (file: TAbstractFile) => {
      this.iterateAllLeaves((leaf) => {
        const v: any = leaf.view;
        if (v?.file === file) {
          if (this.isLastRootLeaf(leaf)) leaf.setViewState({ type: "empty", state: {} });
          else leaf.detach();
        }
      });
      this.lastOpenFiles = this.lastOpenFiles.filter((p) => p !== file.path);
    });
    vault.on("modify", (file: TAbstractFile) => {
      this.iterateAllLeaves((leaf) => {
        const v: any = leaf.view;
        if (v?.file === file && typeof v.onExternalModify === "function") v.onExternalModify(file);
      });
    });
  }

  // ---------- views ----------
  createView(leaf: WorkspaceLeaf, type: string): View {
    const creator = this.viewRegistry.getViewCreatorByType(type);
    if (!creator) return new PlaceholderView(leaf, type);
    try {
      return creator(leaf);
    } catch (e) {
      console.error(`Failed to create view "${type}"`, e);
      return new PlaceholderView(leaf, type);
    }
  }

  // ---------- leaves ----------
  private newLeaf(): WorkspaceLeaf {
    return new WorkspaceLeaf(this);
  }

  /** A fresh leaf (empty view) in a tab group, right after its current tab. */
  createLeafInTabs(tabs: WorkspaceTabs, index?: number): WorkspaceLeaf {
    const leaf = this.newLeaf();
    tabs.insertChild(index ?? tabs.currentTab + 1, leaf);
    leaf.setViewState({ type: "empty", state: {} });
    return leaf;
  }

  createLeafInParent(parent: WorkspaceSplit, index: number): WorkspaceLeaf {
    const tabs = new WorkspaceTabs(this);
    parent.insertChild(index, tabs);
    return this.createLeafInTabs(tabs, 0);
  }

  ensureRootLeaf(): void {
    if (this.rootSplit.children.length) return;
    const tabs = new WorkspaceTabs(this);
    this.rootSplit.insertChild(0, tabs);
    this.createLeafInTabs(tabs, 0);
  }

  /** Leaves in the main area or in a popout window (not the sidebars). */
  isRootLeaf(leaf: WorkspaceLeaf): boolean {
    const r = leaf.getRoot();
    return r === this.rootSplit || r === this.floatingSplit;
  }

  private isLastRootLeaf(leaf: WorkspaceLeaf): boolean {
    if (leaf.getRoot() !== this.rootSplit) return false;
    let n = 0;
    this.iterateLeaves(this.rootSplit, () => void n++);
    return n <= 1;
  }

  getMostRecentLeaf(root: WorkspaceParent = this.rootSplit): WorkspaceLeaf | null {
    let best: WorkspaceLeaf | null = null;
    this.iterateLeaves(root, (l) => {
      if (!best || l.activeTime > best.activeTime) best = l;
    });
    return best;
  }

  getUnpinnedLeaf(): WorkspaceLeaf {
    const a = this.activeLeaf && this.isRootLeaf(this.activeLeaf) ? this.activeLeaf : this.getMostRecentLeaf();
    if (a && !a.pinned) return a;
    const tabs = (a?.parent as WorkspaceTabs) ?? this.firstRootTabs();
    return this.createLeafInTabs(tabs);
  }

  private firstRootTabs(): WorkspaceTabs {
    this.ensureRootLeaf();
    let x: WorkspaceItem = this.rootSplit;
    while (x instanceof WorkspaceSplit) x = x.children[0];
    return x as WorkspaceTabs;
  }

  getLeaf(newLeaf?: PaneType | boolean, direction: SplitDirection = "vertical"): WorkspaceLeaf {
    if (!newLeaf) return this.getUnpinnedLeaf();
    if (newLeaf === "window") return this.openPopoutLeaf();
    const recent = (this.activeLeaf && this.isRootLeaf(this.activeLeaf) ? this.activeLeaf : this.getMostRecentLeaf()) ?? null;
    if (newLeaf === "split") return recent ? this.createLeafBySplit(recent, direction) : this.getUnpinnedLeaf();
    const tabs = (recent?.parent as WorkspaceTabs) ?? this.firstRootTabs();
    return this.createLeafInTabs(tabs, recent ? tabs.children.indexOf(recent) + 1 : undefined);
  }

  /** Split `leaf`'s tab group: new group to the right (vertical) or below (horizontal). */
  createLeafBySplit(leaf: WorkspaceLeaf, direction: SplitDirection = "vertical", before = false): WorkspaceLeaf {
    const tabs = new WorkspaceTabs(this);
    this.insertTabsBeside(leaf.parent as WorkspaceTabs, tabs, direction, before);
    return this.createLeafInTabs(tabs, 0);
  }

  private insertTabsBeside(target: WorkspaceTabs, tabs: WorkspaceTabs, direction: SplitDirection, before: boolean): void {
    const parent = target.parent as WorkspaceSplit;
    const idx = parent.children.indexOf(target);
    if (parent.direction === direction) {
      const d = target.dimension ?? 50;
      target.setDimension(d / 2);
      tabs.setDimension(d / 2);
      parent.insertChild(before ? idx : idx + 1, tabs);
    } else {
      const split = new WorkspaceSplit(this, direction);
      parent.replaceChild(idx, split);
      target.setDimension(50);
      tabs.setDimension(50);
      split.insertChild(0, target);
      split.insertChild(before ? 0 : 1, tabs);
    }
  }

  splitActiveLeaf(direction: SplitDirection = "vertical"): WorkspaceLeaf {
    const leaf = this.activeLeaf ?? this.getUnpinnedLeaf();
    return this.createLeafBySplit(leaf, direction);
  }

  async duplicateLeaf(leaf: WorkspaceLeaf, type: PaneType | boolean = "tab", direction: SplitDirection = "vertical"): Promise<WorkspaceLeaf> {
    const nl = type === "split" ? this.createLeafBySplit(leaf, direction) : this.createLeafInTabs(leaf.parent as WorkspaceTabs);
    await nl.setViewState({ ...leaf.getViewState(), active: true }, leaf.getEphemeralState());
    return nl;
  }

  private sideLeaf(dock: WorkspaceSidedock, split: boolean): WorkspaceLeaf {
    if (split || !dock.children.length) {
      const tabs = new WorkspaceTabs(this);
      dock.insertChild(dock.children.length, tabs);
      return this.createLeafInTabs(tabs, 0);
    }
    const tabs = dock.children[0] as WorkspaceTabs;
    return this.createLeafInTabs(tabs, tabs.children.length);
  }

  getLeftLeaf(split: boolean): WorkspaceLeaf {
    return this.sideLeaf(this.leftSplit, split);
  }
  getRightLeaf(split: boolean): WorkspaceLeaf {
    return this.sideLeaf(this.rightSplit, split);
  }

  async ensureSideLeaf(type: string, side: "left" | "right", o: { active?: boolean; split?: boolean; reveal?: boolean; state?: any } = {}): Promise<WorkspaceLeaf> {
    const existing = this.getLeavesOfType(type)[0];
    if (existing) {
      if (o.reveal ?? true) await this.revealLeaf(existing);
      return existing;
    }
    const leaf = side === "left" ? this.getLeftLeaf(!!o.split) : this.getRightLeaf(!!o.split);
    await leaf.setViewState({ type, state: o.state ?? {}, active: o.active });
    if (o.reveal ?? true) await this.revealLeaf(leaf);
    return leaf;
  }

  async revealLeaf(leaf: WorkspaceLeaf): Promise<void> {
    const root = leaf.getRoot();
    if (root instanceof WorkspaceSidedock && root.collapsed) root.expand();
    (leaf.parent as WorkspaceTabs)?.selectTab(leaf);
  }

  moveLeafToTabs(leaf: WorkspaceLeaf, tabs: WorkspaceTabs, index: number): void {
    const from = leaf.parent as WorkspaceTabs;
    if (from === tabs) {
      const cur = tabs.children.indexOf(leaf);
      if (cur === index) return;
      tabs.removeChild(leaf, true);
      tabs.insertChild(index, leaf);
    } else {
      from.removeChild(leaf, true);
      tabs.insertChild(index, leaf);
      from.cleanupIfEmpty();
    }
    tabs.selectTab(leaf);
    this.setActiveLeaf(leaf, { focus: true });
    this.trigger("layout-change");
    this.requestSaveLayout();
  }

  moveLeafToSplit(leaf: WorkspaceLeaf, target: WorkspaceTabs, zone: "left" | "right" | "top" | "bottom"): void {
    const from = leaf.parent as WorkspaceTabs;
    if (from === target && from.children.length === 1) return;
    from.removeChild(leaf, true);
    const tabs = new WorkspaceTabs(this);
    const direction: SplitDirection = zone === "left" || zone === "right" ? "vertical" : "horizontal";
    this.insertTabsBeside(target, tabs, direction, zone === "left" || zone === "top");
    tabs.insertChild(0, leaf);
    from.cleanupIfEmpty();
    this.setActiveLeaf(leaf, { focus: true });
    this.trigger("layout-change");
    this.requestSaveLayout();
  }

  detachLeaf(leaf: WorkspaceLeaf): void {
    if (this.isLastRootLeaf(leaf)) {
      leaf.setPinned(false);
      leaf.setViewState({ type: "empty", state: {} });
      leaf.history.backHistory = [];
      leaf.history.forwardHistory = [];
      return;
    }
    const tabs = leaf.parent as WorkspaceTabs | null;
    const wasActive = this.activeLeaf === leaf;
    tabs?.removeChild(leaf);
    leaf.destroy();
    if (wasActive) {
      this.activeLeaf = null;
      const next = tabs && tabs.children.length ? tabs.children[tabs.currentTab] : this.getMostRecentLeaf();
      if (next) this.setActiveLeaf(next, { focus: true });
    }
    this.trigger("layout-change");
    this.requestSaveLayout();
  }

  detachLeavesOfType(type: string): void {
    for (const l of this.getLeavesOfType(type)) l.detach();
  }

  setActiveLeaf(leaf: WorkspaceLeaf, params?: { focus?: boolean } | boolean, _focus?: boolean): void {
    const focus = typeof params === "boolean" ? params : params?.focus ?? false;
    if (!leaf.parent) return;
    const tabs = leaf.parent as WorkspaceTabs;
    if (tabs.children[tabs.currentTab] !== leaf) tabs.selectTab(leaf);
    if (this.activeLeaf !== leaf) {
      this.activeLeaf?.containerEl.removeClass("mod-active");
      this.activeLeaf?.tabHeaderEl.removeClass("is-active-leaf");
      this.activeLeaf = leaf;
      leaf.containerEl.addClass("mod-active");
      leaf.tabHeaderEl.addClass("is-active-leaf");
      leaf.activeTime = Date.now();
      for (const d of this.allDocuments()) d.querySelectorAll(".workspace-tabs.mod-active").forEach((e) => e.removeClass("mod-active"));
      tabs.containerEl.addClass("mod-active");
      this.trigger("active-leaf-change", leaf);
      this.checkFileOpen();
      this.updateTitle();
      this.requestSaveLayout();
    } else leaf.activeTime = Date.now();
    if (focus) (leaf.view as any)?.focus?.();
  }

  onLeafStateChanged(leaf: WorkspaceLeaf): void {
    if (leaf === this.activeLeaf) this.checkFileOpen();
    this.syncLinkedLeaves(leaf);
    this.trigger("layout-change");
    this.requestSaveLayout();
  }

  private checkFileOpen(): void {
    const leaf = this.activeLeaf;
    if (!leaf || !this.isRootLeaf(leaf)) return;
    const file = (leaf.view as any)?.file ?? null;
    if (file !== this.lastActiveFile) {
      this.lastActiveFile = file;
      if (file) {
        this.lastOpenFiles = [file.path, ...this.lastOpenFiles.filter((p) => p !== file.path)].slice(0, 10);
      }
      this.trigger("file-open", file);
    }
  }

  get activeEditor(): any {
    const leaf = this.activeLeaf && this.isRootLeaf(this.activeLeaf) ? this.activeLeaf : this.getMostRecentLeaf();
    const v: any = leaf?.view;
    return v && v.editor ? v : null;
  }

  getActiveViewOfType<T>(type: abstract new (...a: any[]) => T): T | null {
    const v = this.activeLeaf?.view;
    return v instanceof (type as any) ? (v as T) : null;
  }

  getActiveFile(): TFile | null {
    const leaf = this.activeLeaf && this.isRootLeaf(this.activeLeaf) ? this.activeLeaf : this.getMostRecentLeaf();
    return ((leaf?.view as any)?.file as TFile) ?? null;
  }

  getLastOpenFiles(): string[] {
    return this.lastOpenFiles.slice();
  }

  // ---------- iteration ----------
  /** Iterate the leaves under any workspace item. */
  iterateLeavesOf(item: WorkspaceItem, cb: (l: WorkspaceLeaf) => any): void {
    this.iterateLeaves(item, cb);
  }
  private iterateLeaves(item: WorkspaceItem, cb: (l: WorkspaceLeaf) => any): boolean {
    if (item instanceof WorkspaceLeaf) return cb(item) === true;
    if (item instanceof WorkspaceParent) for (const c of item.children.slice()) if (this.iterateLeaves(c, cb)) return true;
    return false;
  }
  iterateRootLeaves(cb: (l: WorkspaceLeaf) => any): void {
    if (this.iterateLeaves(this.rootSplit, cb)) return;
    this.iterateLeaves(this.floatingSplit, cb);
  }
  iterateAllLeaves(cb: (l: WorkspaceLeaf) => any): void {
    this.iterateLeaves(this.rootSplit, cb);
    this.iterateLeaves(this.leftSplit, cb);
    this.iterateLeaves(this.rightSplit, cb);
    this.iterateLeaves(this.floatingSplit, cb);
  }
  getLeavesOfType(type: string): WorkspaceLeaf[] {
    const out: WorkspaceLeaf[] = [];
    this.iterateAllLeaves((l) => {
      if (l.view?.getViewType() === type) out.push(l);
    });
    return out;
  }
  getLeafById(id: string): WorkspaceLeaf | null {
    let found: WorkspaceLeaf | null = null;
    this.iterateAllLeaves((l) => {
      if (l.id === id) found = l;
    });
    return found;
  }
  getGroupLeaves(group: string): WorkspaceLeaf[] {
    const out: WorkspaceLeaf[] = [];
    this.iterateAllLeaves((l) => l.group === group && out.push(l));
    return out;
  }

  // ---------- opening ----------
  async openLinkText(linktext: string, sourcePath: string, newLeaf?: PaneType | boolean, openViewState?: any): Promise<void> {
    const { path, subpath } = parseLinktext(linktext);
    let file = path ? this.app.metadataCache.getFirstLinkpathDest(path, sourcePath) : this.app.vault.getFileByPath(sourcePath);
    if (!file) {
      // Clicking an unresolved link creates the note (like Obsidian).
      const parent = this.app.fileManager.getNewFileParent(sourcePath);
      const name = path.split("/").pop()!.replace(/\.md$/i, "");
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : parent.isRoot() ? "" : parent.path;
      file = await this.app.vault.create((dir ? dir + "/" : "") + name + ".md", "");
    }
    const leaf = this.getLeaf(newLeaf);
    const eState = subpath ? { subpath, ...(openViewState?.eState ?? {}) } : openViewState?.eState;
    await leaf.openFile(file, { ...(openViewState ?? {}), eState, active: openViewState?.active ?? true });
  }

  // ---------- layout persistence ----------
  getLayout(): any {
    const o: any = {
      main: this.rootSplit.serialize(),
      left: this.leftSplit.serialize(),
      right: this.rightSplit.serialize(),
      "left-ribbon": this.leftRibbon.serialize(),
    };
    if (this.floatingSplit.children.length) o.floating = this.floatingSplit.serialize();
    o.active = this.activeLeaf?.id;
    o.lastOpenFiles = this.lastOpenFiles;
    return o;
  }

  private layoutPath(): string {
    return this.app.vault.configDir + "/workspace.json";
  }

  async saveLayout(): Promise<void> {
    if (this.saving || this.disableSave || !this.layoutReady) return;
    this.saving = true;
    try {
      await this.app.vault.adapter.write(this.layoutPath(), JSON.stringify(this.getLayout(), null, 2));
    } catch (e) {
      console.error("Could not save workspace layout", e);
    } finally {
      this.saving = false;
    }
  }

  async loadLayout(): Promise<void> {
    let layout: any = null;
    try {
      layout = JSON.parse(await this.app.vault.adapter.read(this.layoutPath()));
    } catch {
      layout = null;
    }
    await this.changeLayout(layout ?? this.defaultLayout());
  }

  defaultLayout(): any {
    const welcome = this.app.vault.getFileByPath("Welcome.md");
    return {
      main: {
        type: "split",
        direction: "vertical",
        children: [{ type: "tabs", children: [{ type: "leaf", state: welcome ? { type: "markdown", state: { file: welcome.path, mode: "source" } } : { type: "empty", state: {} } }] }],
      },
      left: {
        type: "split",
        direction: "horizontal",
        width: 300,
        children: [
          {
            type: "tabs",
            children: [
              { type: "leaf", state: { type: "file-explorer", state: {} } },
              { type: "leaf", state: { type: "search", state: {} } },
              { type: "leaf", state: { type: "bookmarks", state: {} } },
            ],
          },
        ],
      },
      right: {
        type: "split",
        direction: "horizontal",
        width: 300,
        collapsed: true,
        children: [
          {
            type: "tabs",
            children: [
              { type: "leaf", state: { type: "backlink", state: {} } },
              { type: "leaf", state: { type: "outgoing-link", state: {} } },
              { type: "leaf", state: { type: "tag", state: {} } },
              { type: "leaf", state: { type: "all-properties", state: {} } },
              { type: "leaf", state: { type: "outline", state: {} } },
            ],
          },
        ],
      },
    };
  }

  async changeLayout(layout: any): Promise<void> {
    this.loadingLayout = true;
    const pending: Promise<any>[] = [];
    const clear = (p: WorkspaceParent) => {
      for (const c of p.children.slice()) {
        this.iterateLeaves(c, (l) => {
          l.destroy();
        });
        p.removeChild(c, true);
      }
    };
    clear(this.rootSplit);
    clear(this.leftSplit);
    clear(this.rightSplit);
    for (const w of this.floatingSplit.children.slice()) {
      this.iterateLeaves(w, (l) => void l.destroy());
      this.floatingSplit.removeChild(w, true);
      w.close();
    }
    this.activeLeaf = null;

    const build = (data: any, parent: WorkspaceParent): void => {
      if (!data || typeof data !== "object") return;
      if (data.type === "leaf") {
        const leaf = this.newLeaf();
        if (data.id) leaf.id = data.id;
        parent.insertChild(parent.children.length, leaf);
        if (typeof data.dimension === "number") leaf.setDimension(data.dimension);
        const st = data.state ?? { type: "empty", state: {} };
        if (typeof st.state?.backlinks === "boolean") leaf.backlinksInDocument = st.state.backlinks;
        if (data.pinned) leaf.setPinned(true);
        if (data.group) leaf.group = data.group;
        pending.push(leaf.setViewState({ type: st.type ?? "empty", state: st.state ?? {} }).catch((e) => console.error(e)));
        return;
      }
      if (data.type === "tabs") {
        if (!(parent instanceof WorkspaceSplit)) return;
        const tabs = new WorkspaceTabs(this);
        if (data.id) tabs.id = data.id;
        parent.insertChild(parent.children.length, tabs);
        if (typeof data.dimension === "number") tabs.setDimension(data.dimension);
        for (const c of data.children ?? []) if (c.type === "leaf") build(c, tabs);
        if (!tabs.children.length) {
          parent.removeChild(tabs, true);
          return;
        }
        tabs.currentTab = Math.min(data.currentTab ?? 0, tabs.children.length - 1);
        if (data.stacked) tabs.setStacked(true);
        tabs.updateTabDisplay();
        return;
      }
      if (data.type === "split") {
        let target: WorkspaceParent = parent;
        if (!(parent instanceof WorkspaceTabs)) {
          const split = new WorkspaceSplit(this, data.direction === "horizontal" ? "horizontal" : "vertical");
          if (data.id) split.id = data.id;
          parent.insertChild(parent.children.length, split);
          if (typeof data.dimension === "number") split.setDimension(data.dimension);
          target = split;
        }
        for (const c of data.children ?? []) {
          if (c.type === "leaf" && target instanceof WorkspaceSplit) {
            // A bare leaf inside a split: wrap it in a tab group.
            const tabs = new WorkspaceTabs(this);
            target.insertChild(target.children.length, tabs);
            build(c, tabs);
          } else build(c, target);
        }
      }
    };
    const fillDock = (dock: WorkspaceSplit, data: any) => {
      if (!data) return;
      if (data.id) dock.id = data.id;
      for (const c of data.children ?? []) {
        if (c.type === "leaf") {
          const tabs = new WorkspaceTabs(this);
          dock.insertChild(dock.children.length, tabs);
          build(c, tabs);
        } else build(c, dock);
      }
    };
    fillDock(this.rootSplit, layout.main);
    if (layout.main?.direction) this.rootSplit.setDirection(layout.main.direction);
    fillDock(this.leftSplit, layout.left);
    fillDock(this.rightSplit, layout.right);
    // Popout windows ("floating").
    for (const wd of Array.isArray(layout.floating?.children) ? layout.floating.children : []) {
      if (wd?.type !== "window") continue;
      const win = this.createPopoutWindow({ x: wd.x, y: wd.y, width: wd.width, height: wd.height, maximize: wd.maximize });
      if (!win) continue;
      if (wd.id) win.id = wd.id;
      fillDock(win, { ...wd, id: undefined });
      if (!win.children.length) win.close();
    }
    // Flatten single-child nested splits created from older layouts.
    for (const dock of [this.rootSplit, this.leftSplit, this.rightSplit, ...this.floatingSplit.children]) {
      for (const c of dock.children.slice()) if (c instanceof WorkspaceSplit) c.cleanupIfEmpty();
    }
    this.leftSplit.setSize(layout.left?.width ?? 300);
    this.rightSplit.setSize(layout.right?.width ?? 300);
    layout.left?.collapsed ? this.leftSplit.collapse() : this.leftSplit.expand();
    layout.right?.collapsed ? this.rightSplit.collapse() : this.rightSplit.expand();
    this.leftRibbon.load(layout["left-ribbon"]);
    this.lastOpenFiles = Array.isArray(layout.lastOpenFiles) ? layout.lastOpenFiles.filter((p: any) => typeof p === "string") : [];
    this.ensureRootLeaf();
    await Promise.all(pending);
    for (const w of this.floatingSplit.children) w.adoptEditors();
    const active = (layout.active && this.getLeafById(layout.active)) || this.getMostRecentLeaf() || null;
    const rootActive = active && this.isRootLeaf(active) ? active : this.firstRootTabs().children[0];
    if (rootActive) this.setActiveLeaf(rootActive, { focus: false });
    if (active && active !== rootActive) this.setActiveLeaf(active, { focus: false });
    this.loadingLayout = false;
    this.trigger("layout-change");
  }

  // ---------- misc ----------
  onLayoutReady(cb: () => any): void {
    if (this.layoutReady) setTimeout(cb, 0);
    else this.layoutReadyCbs.push(cb);
  }

  markLayoutReady(): void {
    this.layoutReady = true;
    for (const cb of this.layoutReadyCbs.splice(0)) {
      try {
        cb();
      } catch (e) {
        console.error(e);
      }
    }
    this.trigger("layout-ready");
  }

  /** Mark the tab group under the window buttons so its tab bar leaves room for them. */
  updateFrameCorners(): void {
    for (const w of this.floatingSplit.children) w.markTopRight();
    document.querySelectorAll(".workspace-tabs.is-top-right").forEach((e) => e.removeClass("is-top-right"));
    let item: WorkspaceItem | undefined;
    if (!this.rightSplit.collapsed && this.rightSplit.children.length) item = this.rightSplit.children[0];
    else {
      item = this.rootSplit;
      while (item instanceof WorkspaceSplit) item = item.direction === "vertical" ? item.children[item.children.length - 1] : item.children[0];
    }
    while (item instanceof WorkspaceSplit) item = item.children[0];
    if (item instanceof WorkspaceTabs) item.containerEl.addClass("is-top-right");
  }

  onSidedockToggled(dock: WorkspaceSidedock): void {
    this.containerEl.toggleClass(`is-${dock.side}-sidedock-open`, !dock.collapsed);
    document.body.toggleClass(`is-${dock.side}-sidedock-collapsed`, dock.collapsed);
    this.trigger("layout-change");
    this.requestSaveLayout();
    this.onResize();
  }

  onResize(): void {
    this.iterateAllLeaves((l) => l.onResize());
    this.trigger("resize");
  }

  updateTitle(): void {
    const file = this.getActiveFile();
    const vault = this.app.vault.getName();
    const title = [file?.basename, vault, this.app.brand.displayName].filter(Boolean).join(" - ");
    document.title = title;
    this.app.native?.setTitle?.(title);
  }

  updateOptions(): void {
    this.iterateAllLeaves((l) => (l.view as any)?.editMode?.updateOptions?.() ?? (l.view as any)?.updateOptions?.());
  }

  /** Linked tabs: views in the same group follow the file shown by a navigating member. */
  private syncingGroup = false;
  private syncLinkedLeaves(leaf: WorkspaceLeaf): void {
    if (!leaf.group || this.syncingGroup) return;
    const v: any = leaf.view;
    if (!v?.navigation || !v.file) return; // only file tabs drive their group
    const path = v.file.path;
    this.syncingGroup = true;
    try {
      for (const other of this.getGroupLeaves(leaf.group)) {
        if (other === leaf) continue;
        const ov: any = other.view;
        if (!ov || ov.navigation) continue; // linked views (outline, backlinks, local graph...) follow
        const st = ov.getState?.() ?? {};
        if (st.file === path) continue;
        void other.setViewState({ type: ov.getViewType(), state: { ...st, file: path, fixed: true } });
      }
    } finally {
      this.syncingGroup = false;
    }
  }

  // ---------- popout windows ----------
  /** Main document plus every popout window's document. */
  allDocuments(): Document[] {
    return [document, ...this.floatingSplit.children.map((w) => w.doc).filter(Boolean)];
  }

  private createPopoutWindow(geometry?: WindowGeometry): WorkspaceWindow | null {
    const win = new WorkspaceWindow(this, geometry);
    this.floatingSplit.insertChild(this.floatingSplit.children.length, win);
    if (!win.openWindow()) {
      this.floatingSplit.removeChild(win, true);
      return null;
    }
    this.trigger("window-open", win, win.win);
    return win;
  }

  /** A new window with one empty tab (obsidian API). Falls back to a tab if windows can't open. */
  openPopoutLeaf(data?: WindowGeometry): WorkspaceLeaf {
    const win = this.createPopoutWindow(data);
    if (!win) return this.getLeaf("tab");
    const tabs = new WorkspaceTabs(this);
    win.insertChild(0, tabs);
    const leaf = this.createLeafInTabs(tabs, 0);
    this.trigger("layout-change");
    this.requestSaveLayout();
    return leaf;
  }

  /** Move a tab into a new window (obsidian API). */
  moveLeafToPopout(leaf: WorkspaceLeaf, data?: WindowGeometry): WorkspaceLeaf {
    const from = leaf.parent as WorkspaceTabs | null;
    if (!from) return leaf;
    if (this.isLastRootLeaf(leaf)) {
      // Keep an empty tab in the main window.
      const st = leaf.getViewState();
      const es = leaf.getEphemeralState();
      const nl = this.openPopoutLeaf(data);
      void nl.setViewState({ ...st, active: true }, es);
      void leaf.setViewState({ type: "empty", state: {} });
      return nl;
    }
    const win = this.createPopoutWindow(data);
    if (!win) return leaf;
    const tabs = new WorkspaceTabs(this);
    win.insertChild(0, tabs);
    from.removeChild(leaf, true);
    tabs.insertChild(0, leaf);
    from.cleanupIfEmpty();
    win.adoptEditors();
    leaf.onResize();
    this.setActiveLeaf(leaf, { focus: true });
    this.trigger("layout-change");
    this.requestSaveLayout();
    return leaf;
  }
}
