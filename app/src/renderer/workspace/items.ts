// Workspace tree items (obsidian API): WorkspaceItem, WorkspaceParent, WorkspaceSplit,
// WorkspaceTabs, WorkspaceSidedock, WorkspaceRoot, WorkspaceRibbon. Leaves live in leaf.ts.
// DOM class names match Obsidian's public ones so themes and CSS snippets apply.
import { Events } from "../api/events";
import { setIcon } from "../dom/icons";
import { Menu } from "../ui/menu";
import type { WorkspaceLeaf } from "./leaf";
import type { Workspace } from "./workspace";

export function randomId(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export abstract class WorkspaceItem extends Events {
  id = randomId();
  parent: WorkspaceParent | null = null;
  containerEl: HTMLElement;
  /** Relative size inside the parent split (flex-grow, percent-ish). */
  dimension: number | null = null;
  resizeHandleEl: HTMLElement;
  abstract type: string;

  constructor(public workspace: Workspace) {
    super();
  }

  get app(): any {
    return this.workspace.app;
  }

  getRoot(): WorkspaceItem {
    let x: WorkspaceItem = this;
    while (x.parent) x = x.parent;
    return x;
  }

  /** The main root split, or the popout window this item lives in. */
  getContainer(): WorkspaceParent {
    let x: WorkspaceItem = this;
    while (x.parent && x.type !== "window") x = x.parent;
    return x as WorkspaceParent;
  }

  setDimension(d: number | null): void {
    this.dimension = d;
    this.containerEl.style.flexGrow = d === null ? "" : String(d);
  }

  abstract serialize(): any;
}

export abstract class WorkspaceParent extends WorkspaceItem {
  children: WorkspaceItem[] = [];

  insertChild(index: number, child: WorkspaceItem): void {
    if (child.parent) child.parent.removeChild(child, true);
    child.parent = this;
    index = Math.max(0, Math.min(index, this.children.length));
    this.children.splice(index, 0, child);
    this.attachChildEl(index, child);
    this.onChildrenChanged();
  }

  removeChild(child: WorkspaceItem, keepEmpty = false): void {
    const i = this.children.indexOf(child);
    if (i < 0) return;
    this.children.splice(i, 1);
    child.containerEl.detach();
    child.parent = null;
    this.onChildrenChanged();
    if (!keepEmpty) this.cleanupIfEmpty();
  }

  replaceChild(index: number, child: WorkspaceItem): void {
    const old = this.children[index];
    if (!old) return;
    if (child.parent) child.parent.removeChild(child, true);
    child.parent = this;
    this.children[index] = child;
    old.containerEl.replaceWith(child.containerEl);
    old.parent = null;
    child.setDimension(old.dimension);
    this.onChildrenChanged();
  }

  protected abstract attachChildEl(index: number, child: WorkspaceItem): void;
  protected onChildrenChanged(): void {}
  /** Remove ourselves when we become empty (or collapse a one-child split). */
  cleanupIfEmpty(): void {}
}

// ---------------- Split ----------------
export type SplitDirection = "vertical" | "horizontal";

export class WorkspaceSplit extends WorkspaceParent {
  type = "split";
  direction: SplitDirection;

  constructor(workspace: Workspace, direction: SplitDirection) {
    super(workspace);
    this.direction = direction;
    this.containerEl = createDiv(`workspace-split mod-${direction}`);
  }

  setDirection(d: SplitDirection): void {
    this.containerEl.removeClass("mod-" + this.direction);
    this.direction = d;
    this.containerEl.addClass("mod-" + d);
  }

  protected attachChildEl(index: number, child: WorkspaceItem): void {
    const before = this.children[index + 1]?.containerEl ?? null;
    this.containerEl.insertBefore(child.containerEl, before && before.parentElement === this.containerEl ? before : null);
  }

  protected onChildrenChanged(): void {
    // One resize handle at the end of every child but the last.
    this.children.forEach((c, i) => {
      if (!c.resizeHandleEl) {
        c.resizeHandleEl = createEl("hr", "workspace-leaf-resize-handle");
        c.resizeHandleEl.addEventListener("mousedown", (e) => this.startResize(e, c));
      }
      if (i < this.children.length - 1) c.containerEl.appendChild(c.resizeHandleEl);
      else c.resizeHandleEl.detach();
    });
  }

  private startResize(e: MouseEvent, child: WorkspaceItem): void {
    e.preventDefault();
    const i = this.children.indexOf(child);
    const next = this.children[i + 1];
    if (!next) return;
    const horiz = this.direction === "vertical";
    const a = child.containerEl.getBoundingClientRect();
    const b = next.containerEl.getBoundingClientRect();
    const total = horiz ? a.width + b.width : a.height + b.height;
    const start = horiz ? e.clientX : e.clientY;
    const startA = horiz ? a.width : a.height;
    const growSum = (child.dimension ?? 50) + (next.dimension ?? 50);
    document.body.addClass("is-grabbing");
    const move = (ev: MouseEvent) => {
      const d = (horiz ? ev.clientX : ev.clientY) - start;
      const na = Math.max(60, Math.min(total - 60, startA + d));
      child.setDimension((na / total) * growSum);
      next.setDimension(((total - na) / total) * growSum);
      this.workspace.onResize();
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.removeClass("is-grabbing");
      this.workspace.requestSaveLayout();
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  cleanupIfEmpty(): void {
    const p = this.parent;
    if (!p || this instanceof WorkspaceSidedock || this instanceof WorkspaceRoot) {
      if (this instanceof WorkspaceRoot && this.children.length === 0) this.workspace.ensureRootLeaf();
      return;
    }
    if (this.children.length === 0) p.removeChild(this);
    else if (this.children.length === 1) {
      const only = this.children[0];
      const idx = p.children.indexOf(this);
      p.replaceChild(idx, only);
    }
  }

  serialize(): any {
    const o: any = { id: this.id, type: "split", children: this.children.map((c) => c.serialize()), direction: this.direction };
    if (this.dimension !== null) o.dimension = this.dimension;
    return o;
  }
}

export class WorkspaceRoot extends WorkspaceSplit {
  constructor(workspace: Workspace) {
    super(workspace, "vertical");
    this.containerEl.addClass("mod-root");
  }
}

export class WorkspaceSidedock extends WorkspaceSplit {
  side: "left" | "right";
  collapsed = false;
  size = 300;
  private edgeHandle: HTMLElement;

  constructor(workspace: Workspace, side: "left" | "right") {
    super(workspace, "horizontal");
    this.side = side;
    this.containerEl.addClass("mod-sidedock", `mod-${side}-split`);
    this.edgeHandle = createEl("hr", "workspace-leaf-resize-handle mod-sidedock-handle");
    this.edgeHandle.addEventListener("mousedown", (e) => this.startEdgeResize(e));
    this.containerEl.appendChild(this.edgeHandle);
    this.setSize(this.size);
  }

  protected attachChildEl(index: number, child: WorkspaceItem): void {
    const before = this.children[index + 1]?.containerEl ?? this.edgeHandle;
    this.containerEl.insertBefore(child.containerEl, before.parentElement === this.containerEl ? before : this.edgeHandle);
  }

  setSize(px: number): void {
    this.size = Math.max(150, Math.min(px, 1200));
    this.containerEl.style.width = this.collapsed ? "0px" : this.size + "px";
  }

  private startEdgeResize(e: MouseEvent): void {
    e.preventDefault();
    const start = e.clientX;
    const startSize = this.size;
    document.body.addClass("is-grabbing");
    const move = (ev: MouseEvent) => {
      const d = ev.clientX - start;
      this.setSize(this.side === "left" ? startSize + d : startSize - d);
      this.workspace.onResize();
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.removeClass("is-grabbing");
      this.workspace.requestSaveLayout();
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  collapse(): void {
    this.collapsed = true;
    this.containerEl.addClass("is-sidedock-collapsed");
    this.setSize(this.size);
    this.workspace.onSidedockToggled(this);
  }
  expand(): void {
    this.collapsed = false;
    this.containerEl.removeClass("is-sidedock-collapsed");
    this.setSize(this.size);
    this.workspace.onSidedockToggled(this);
  }
  toggle(): void {
    this.collapsed ? this.expand() : this.collapse();
  }

  serialize(): any {
    const o = super.serialize();
    o.width = this.size;
    if (this.collapsed) o.collapsed = true;
    delete o.dimension;
    return o;
  }
}

// ---------------- Tabs ----------------
export class WorkspaceTabs extends WorkspaceParent {
  type = "tabs";
  declare children: WorkspaceLeaf[];
  currentTab = 0;
  isStacked = false;
  tabHeaderContainerEl: HTMLElement;
  tabHeaderContainerInnerEl: HTMLElement;
  tabsContainerEl: HTMLElement;
  newTabButtonEl: HTMLElement;
  tabListButtonEl: HTMLElement;
  spacerEl: HTMLElement;

  constructor(workspace: Workspace) {
    super(workspace);
    this.containerEl = createDiv("workspace-tabs mod-top");
    this.tabHeaderContainerEl = this.containerEl.createDiv("workspace-tab-header-container");
    this.tabHeaderContainerInnerEl = this.tabHeaderContainerEl.createDiv("workspace-tab-header-container-inner");
    this.newTabButtonEl = this.tabHeaderContainerEl.createDiv({ cls: "workspace-tab-header-new-tab", attr: { "aria-label": "New tab" } });
    const nb = this.newTabButtonEl.createSpan("clickable-icon");
    setIcon(nb, "plus");
    nb.addEventListener("click", () => {
      const leaf = this.workspace.createLeafInTabs(this);
      this.workspace.setActiveLeaf(leaf, { focus: true });
    });
    this.spacerEl = this.tabHeaderContainerEl.createDiv("workspace-tab-header-spacer");
    this.tabListButtonEl = this.tabHeaderContainerEl.createDiv({ cls: "workspace-tab-header-tab-list", attr: { "aria-label": "Show tab list" } });
    const lb = this.tabListButtonEl.createSpan("clickable-icon");
    setIcon(lb, "chevron-down");
    lb.addEventListener("click", (e) => this.showTabList(e));
    this.tabsContainerEl = this.containerEl.createDiv("workspace-tab-container");
    this.tabHeaderContainerEl.addEventListener("dblclick", (e) => {
      if (e.target === this.tabHeaderContainerEl || e.target === this.spacerEl || e.target === this.tabHeaderContainerInnerEl) {
        const leaf = this.workspace.createLeafInTabs(this);
        this.workspace.setActiveLeaf(leaf, { focus: true });
      }
    });
    workspace.dnd.attachTabs(this);
  }

  get isSidebar(): boolean {
    let p = this.parent;
    while (p) {
      if (p instanceof WorkspaceSidedock) return true;
      p = p.parent;
    }
    return false;
  }

  protected attachChildEl(index: number, child: WorkspaceItem): void {
    const leaf = child as WorkspaceLeaf;
    const nextLeaf = this.children[index + 1];
    this.tabHeaderContainerInnerEl.insertBefore(leaf.tabHeaderEl, nextLeaf?.tabHeaderEl ?? null);
    this.tabsContainerEl.insertBefore(leaf.containerEl, nextLeaf?.containerEl ?? null);
    if (this.isStacked) leaf.containerEl.prepend(leaf.tabHeaderEl);
  }

  insertChild(index: number, child: WorkspaceItem): void {
    const cur = this.children[this.currentTab];
    super.insertChild(index, child);
    this.currentTab = cur ? this.children.indexOf(cur) : 0;
    this.updateTabDisplay();
  }

  removeChild(child: WorkspaceItem, keepEmpty = false): void {
    const leaf = child as WorkspaceLeaf;
    const i = this.children.indexOf(leaf);
    if (i < 0) return;
    const wasCurrent = i === this.currentTab;
    leaf.tabHeaderEl.detach();
    super.removeChild(child, true);
    if (this.children.length) {
      if (wasCurrent) this.currentTab = Math.min(i, this.children.length - 1);
      else if (i < this.currentTab) this.currentTab--;
      this.updateTabDisplay();
    }
    if (!keepEmpty) this.cleanupIfEmpty();
  }

  cleanupIfEmpty(): void {
    if (this.children.length === 0 && this.parent) this.parent.removeChild(this);
  }

  selectTab(leaf: WorkspaceLeaf): void {
    const i = this.children.indexOf(leaf);
    if (i >= 0) this.selectTabIndex(i);
  }

  selectTabIndex(i: number): void {
    if (i < 0 || i >= this.children.length) return;
    this.currentTab = i;
    this.updateTabDisplay();
    const leaf = this.children[i];
    if (this.isStacked) leaf.containerEl.scrollIntoView({ block: "nearest", inline: "nearest" });
    leaf.onResize();
    this.workspace.requestSaveLayout();
  }

  updateTabDisplay(): void {
    this.children.forEach((leaf, i) => {
      const cur = i === this.currentTab;
      leaf.tabHeaderEl.toggleClass("is-active", cur);
      leaf.containerEl.style.display = cur || this.isStacked ? "" : "none";
    });
    this.containerEl.toggleClass("mod-stacked", this.isStacked);
  }

  setStacked(stacked: boolean): void {
    this.isStacked = stacked;
    for (const leaf of this.children) {
      if (stacked) leaf.containerEl.prepend(leaf.tabHeaderEl);
      else this.tabHeaderContainerInnerEl.appendChild(leaf.tabHeaderEl);
    }
    this.updateTabDisplay();
    this.workspace.requestSaveLayout();
  }

  private showTabList(e: MouseEvent): void {
    const m = new Menu();
    m.addItem((it) =>
      it
        .setTitle(this.isStacked ? "Unstack tabs" : "Stack tabs")
        .setIcon("layers")
        .setSection("view")
        .onClick(() => this.setStacked(!this.isStacked)),
    );
    const files = this.children.map((l) => (l.view as any)?.file).filter(Boolean);
    const bm = this.app.bookmarks;
    if (bm && files.length)
      m.addItem((it) =>
        it
          .setTitle(`Bookmark ${files.length} ${files.length === 1 ? "tab" : "tabs"}...`)
          .setIcon("bookmark")
          .setSection("view")
          .onClick(async () => {
            const title = await this.app.ui.prompt({ title: "Bookmark tabs", value: "Tabs", cta: "Save" });
            if (title === null) return;
            bm.add({ type: "group", title: title || "Untitled group", items: files.map((f: any, i: number) => ({ type: "file", path: f.path, ctime: Date.now() + i })) });
          }),
      );
    m.addItem((it) =>
      it
        .setTitle("Close all")
        .setIcon("x")
        .setSection("close")
        .onClick(() => {
          for (const l of this.children.slice()) if (!l.pinned) l.detach();
        }),
    );
    for (const leaf of this.children) {
      m.addItem((it) =>
        it
          .setTitle(leaf.getDisplayText())
          .setIcon(leaf.getIcon())
          .setSection("tabs")
          .setChecked(leaf === this.children[this.currentTab])
          .onClick(() => this.workspace.setActiveLeaf(leaf, { focus: true })),
      );
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    m.showAtPosition({ x: r.left, y: r.bottom + 4 });
  }

  serialize(): any {
    const o: any = { id: this.id, type: "tabs", children: this.children.map((c) => c.serialize()) };
    if (this.currentTab) o.currentTab = this.currentTab;
    if (this.isStacked) o.stacked = true;
    if (this.dimension !== null) o.dimension = this.dimension;
    return o;
  }
}

// ---------------- Ribbon ----------------
/** Default order of the core plugins' ribbon buttons (ids as in workspace.json hiddenItems). */
export const DEFAULT_RIBBON_ORDER = [
  "switcher:Open quick switcher",
  "graph:Open graph view",
  "canvas:Create new canvas",
  "daily-notes:Open today's daily note",
  "templates:Insert template",
  "command-palette:Open command palette",
  "bases:Create new base",
  "random-note:Open random note",
  "zk-prefixer:Create new unique note",
  "workspaces:Manage workspace layouts",
  "audio-recorder:Start/stop recording",
];
export interface RibbonItem {
  id: string;
  icon: string;
  title: string;
  callback: (evt: MouseEvent) => any;
  buttonEl: HTMLElement;
  hidden: boolean;
}

export class WorkspaceRibbon {
  containerEl: HTMLElement;
  actionsEl: HTMLElement;
  settingsEl: HTMLElement;
  items: RibbonItem[] = [];
  hiddenItems: Record<string, boolean> = {};

  constructor(public workspace: Workspace, side: "left" | "right") {
    this.containerEl = createDiv(`workspace-ribbon side-dock-ribbon mod-${side}`);
    if (side === "left") {
      const top = this.containerEl.createDiv("sidebar-toggle-button mod-left");
      const btn = top.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Toggle left sidebar" } });
      setIcon(btn, "panel-left");
      btn.addEventListener("click", () => workspace.leftSplit.toggle());
    }
    this.actionsEl = this.containerEl.createDiv("side-dock-actions");
    this.settingsEl = this.containerEl.createDiv("side-dock-settings");
    this.containerEl.addEventListener("contextmenu", (e) => {
      if ((e.target as HTMLElement).closest(".side-dock-settings")) return;
      e.preventDefault();
      const m = new Menu();
      for (const it of this.items)
        m.addItem((mi) =>
          mi
            .setTitle(it.title)
            .setIcon(it.icon)
            .setChecked(!it.hidden)
            .onClick(() => {
              it.hidden = !it.hidden;
              this.hiddenItems[it.id] = it.hidden;
              it.buttonEl.toggle(!it.hidden);
              workspace.requestSaveLayout();
            }),
        );
      m.showAtMouseEvent(e);
    });
  }

  addRibbonItemButton(id: string, icon: string, title: string, callback: (evt: MouseEvent) => any): HTMLElement {
    const el = this.actionsEl.createDiv({ cls: "clickable-icon side-dock-ribbon-action", attr: { "aria-label": title, "data-tooltip-position": "right" } });
    setIcon(el, icon);
    el.addEventListener("click", callback);
    const item: RibbonItem = { id, icon, title, callback, buttonEl: el, hidden: !!this.hiddenItems[id] };
    if (item.hidden) el.hide();
    this.items.push(item);
    this.applyOrder();
    return el;
  }

  addSettingsButton(icon: string, title: string, cb: (evt: MouseEvent) => any): HTMLElement {
    const el = this.settingsEl.createDiv({ cls: "clickable-icon side-dock-ribbon-action", attr: { "aria-label": title } });
    setIcon(el, icon);
    el.addEventListener("click", cb);
    return el;
  }

  removeRibbonAction(id: string): void {
    const i = this.items.findIndex((x) => x.id === id);
    if (i >= 0) {
      this.items[i].buttonEl.remove();
      this.items.splice(i, 1);
    }
  }

  serialize(): any {
    return { hiddenItems: { ...this.hiddenItems } };
  }

  load(data: any): void {
    this.hiddenItems = { ...(data?.hiddenItems ?? {}) };
    for (const it of this.items) {
      it.hidden = !!this.hiddenItems[it.id];
      it.buttonEl.toggle(!it.hidden);
    }
    this.applyOrder();
  }

  /** Order follows the key order of hiddenItems (Settings › Interface › Ribbon menu configuration). */
  applyOrder(): void {
    // Saved order first, then the core plugins' default order, then everything else as added.
    const order = [...Object.keys(this.hiddenItems), ...DEFAULT_RIBBON_ORDER.filter((id) => !(id in this.hiddenItems))];
    const added = this.items.slice();
    const rank = (id: string) => {
      const i = order.indexOf(id);
      return i < 0 ? order.length + added.findIndex((x) => x.id === id) : i;
    };
    this.items.sort((a, b) => rank(a.id) - rank(b.id));
    for (const it of this.items) this.actionsEl.appendChild(it.buttonEl);
  }
}
