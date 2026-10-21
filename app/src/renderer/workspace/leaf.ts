// WorkspaceLeaf (obsidian API): one tab. Holds a View, its tab header, pin state, link group,
// and per-leaf back/forward history.
import { setIcon } from "../dom/icons";
import { Menu } from "../ui/menu";
import { TFile } from "../vault/files";
import { WorkspaceItem, type WorkspaceTabs } from "./items";
import type { View, ViewState } from "./view";
import type { Workspace } from "./workspace";

export interface HistoryEntry {
  state: ViewState;
  eState?: any;
  title: string;
  icon: string;
}

export class LeafHistory {
  backHistory: HistoryEntry[] = [];
  forwardHistory: HistoryEntry[] = [];
  constructor(private leaf: WorkspaceLeaf) {}

  async back(): Promise<void> {
    const e = this.backHistory.pop();
    if (!e) return;
    this.forwardHistory.push(this.leaf.historyEntry());
    await this.leaf.setViewState({ ...e.state, active: true }, e.eState, true);
  }

  async forward(): Promise<void> {
    const e = this.forwardHistory.pop();
    if (!e) return;
    this.backHistory.push(this.leaf.historyEntry());
    await this.leaf.setViewState({ ...e.state, active: true }, e.eState, true);
  }

  serialize(): any {
    return { backHistory: this.backHistory.slice(-50), forwardHistory: this.forwardHistory.slice(-50) };
  }
}

export class WorkspaceLeaf extends WorkspaceItem {
  type = "leaf";
  declare parent: WorkspaceTabs | null;
  view: View;
  pinned = false;
  group: string | null = null;
  working = false;
  history = new LeafHistory(this);
  tabHeaderEl: HTMLElement;
  tabHeaderInnerIconEl: HTMLElement;
  tabHeaderInnerTitleEl: HTMLElement;
  tabHeaderStatusContainerEl: HTMLElement;
  tabHeaderCloseEl: HTMLElement;
  activeTime = 0;
  private pendingState: Promise<void> = Promise.resolve();

  constructor(workspace: Workspace) {
    super(workspace);
    this.containerEl = createDiv("workspace-leaf");
    this.tabHeaderEl = createDiv({ cls: "workspace-tab-header tappable", attr: { draggable: "true", "aria-label": "" } });
    const inner = this.tabHeaderEl.createDiv("workspace-tab-header-inner");
    this.tabHeaderInnerIconEl = inner.createDiv("workspace-tab-header-inner-icon");
    this.tabHeaderInnerTitleEl = inner.createDiv("workspace-tab-header-inner-title");
    this.tabHeaderStatusContainerEl = inner.createDiv("workspace-tab-header-status-container");
    this.tabHeaderCloseEl = inner.createDiv({ cls: "workspace-tab-header-inner-close-button", attr: { "aria-label": "Close" } });
    setIcon(this.tabHeaderCloseEl, "x");
    this.tabHeaderCloseEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.detach();
    });
    this.tabHeaderEl.addEventListener("mousedown", (e) => {
      if (e.button === 0 && !(e.target as HTMLElement).closest(".workspace-tab-header-inner-close-button")) {
        this.workspace.setActiveLeaf(this, { focus: true });
      }
    });
    this.tabHeaderEl.addEventListener("auxclick", (e) => {
      if (e.button === 1) this.detach();
    });
    this.tabHeaderEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const m = new Menu();
      this.populateTabMenu(m);
      m.showAtMouseEvent(e);
    });
    this.containerEl.addEventListener("mousedown", () => {
      if (this.workspace.activeLeaf !== this) this.workspace.setActiveLeaf(this, { focus: false });
    }, true);
    this.workspace.dnd.attachLeaf(this);
  }

  populateTabMenu(m: Menu): void {
    m.addItem((i) => i.setTitle("Close").setIcon("x").setSection("close").onClick(() => this.detach()));
    m.addItem((i) =>
      i
        .setTitle("Close others")
        .setSection("close")
        .onClick(() => {
          for (const l of this.parent?.children.slice() ?? []) if (l !== this && !l.pinned) l.detach();
        }),
    );
    m.addItem((i) =>
      i
        .setTitle("Close tabs to the right")
        .setSection("close")
        .onClick(() => {
          const sib = this.parent?.children ?? [];
          for (const l of sib.slice(sib.indexOf(this) + 1)) if (!l.pinned) l.detach();
        }),
    );
    m.addItem((i) => i.setTitle(this.pinned ? "Unpin" : "Pin").setIcon("pin").setSection("action").onClick(() => this.togglePinned()));
    m.addItem((i) =>
      i
        .setTitle("Split right")
        .setIcon("columns-2")
        .setSection("action")
        .onClick(() => this.workspace.duplicateLeaf(this, "split", "vertical")),
    );
    m.addItem((i) =>
      i
        .setTitle("Split down")
        .setIcon("rows-2")
        .setSection("action")
        .onClick(() => this.workspace.duplicateLeaf(this, "split", "horizontal")),
    );
    this.view?.onTabMenu?.(m);
    if (this.view instanceof Object && (this.view as any).file instanceof TFile) {
      this.app.workspace.trigger("file-menu", m, (this.view as any).file, "tab-header", this);
    }
  }

  serialize(): any {
    const vs = this.getViewState();
    const o: any = { id: this.id, type: "leaf", state: { type: vs.type, state: vs.state ?? {}, icon: this.view ? "lucide-" + this.getIcon().replace(/^lucide-/, "") : undefined, title: this.getDisplayText() } };
    if (this.pinned) o.pinned = true;
    if (this.group) o.group = this.group;
    if (this.dimension !== null) o.dimension = this.dimension;
    return o;
  }

  historyEntry(): HistoryEntry {
    return { state: this.getViewState(), eState: this.getEphemeralState(), title: this.getDisplayText(), icon: this.getIcon() };
  }

  getViewState(): ViewState {
    if (!this.view) return { type: "empty", state: {} };
    const st: ViewState = { type: this.view.getViewType(), state: this.view.getState() };
    if (this.pinned) st.pinned = true;
    return st;
  }

  getEphemeralState(): any {
    return this.view?.getEphemeralState() ?? {};
  }

  setEphemeralState(s: any): void {
    this.view?.setEphemeralState(s);
  }

  /** Open a view state. Navigations push history unless `fromHistory`. */
  setViewState(vs: ViewState, eState?: any, fromHistory = false): Promise<void> {
    const run = this.pendingState.then(() => this.applyViewState(vs, eState, fromHistory));
    this.pendingState = run.catch((e) => console.error(e));
    return run;
  }

  private async applyViewState(vs: ViewState, eState: any, fromHistory: boolean): Promise<void> {
    const ws = this.workspace;
    if (vs.pinned !== undefined) this.setPinned(!!vs.pinned);
    if (vs.group) this.setGroup((vs.group as any).id ?? String(vs.group));
    const cur = this.view;
    const sameType = cur && cur.getViewType() === vs.type;
    const prevEntry = cur && cur.navigation ? this.historyEntry() : null;
    const changing = !cur || !sameType || JSON.stringify(cur.getState()) !== JSON.stringify(vs.state ?? {});
    if (!fromHistory && prevEntry && changing && prevEntry.state.type !== "empty") {
      this.history.backHistory.push(prevEntry);
      if (this.history.backHistory.length > 50) this.history.backHistory.shift();
      this.history.forwardHistory = [];
    } else if (!fromHistory && prevEntry && changing && prevEntry.state.type === "empty") {
      this.history.forwardHistory = [];
    }
    if (sameType) {
      await cur!.setState(vs.state ?? {}, { history: !fromHistory });
    } else {
      const view = ws.createView(this, vs.type);
      if (cur) await this.closeView(cur);
      this.view = view;
      await view.open(this.containerEl);
      await view.setState(vs.state ?? {}, { history: !fromHistory });
    }
    if (eState) this.view.setEphemeralState(eState);
    this.updateHeader();
    if (vs.active) ws.setActiveLeaf(this, { focus: true });
    ws.onLeafStateChanged(this);
  }

  private async closeView(v: View): Promise<void> {
    try {
      await v.close();
    } catch (e) {
      console.error(e);
    }
  }

  /** Open a view object directly (obsidian API leaf.open). */
  async open(view: View): Promise<View> {
    if (this.view) await this.closeView(this.view);
    this.view = view;
    await view.open(this.containerEl);
    this.updateHeader();
    this.workspace.onLeafStateChanged(this);
    return view;
  }

  async openFile(file: TFile, openState?: { state?: any; eState?: any; active?: boolean; group?: any }): Promise<void> {
    const type = this.workspace.viewRegistry.getTypeByExtension(file.extension) ?? "unknown-file";
    await this.setViewState({ type, state: { ...(openState?.state ?? {}), file: file.path }, active: openState?.active ?? true }, openState?.eState);
  }

  async loadIfDeferred(): Promise<void> {}
  get isDeferred(): boolean {
    return false;
  }

  getDisplayText(): string {
    return this.view?.getDisplayText() ?? "New tab";
  }

  getIcon(): string {
    return this.view?.getIcon() ?? "file";
  }

  updateHeader(): void {
    const title = this.getDisplayText();
    this.tabHeaderInnerTitleEl.setText(title);
    this.tabHeaderEl.setAttr("aria-label", title);
    this.tabHeaderEl.setAttr("data-type", this.view?.getViewType() ?? "empty");
    setIcon(this.tabHeaderInnerIconEl, this.getIcon());
    (this.view as any)?.updateHeader?.();
    if (this.workspace.activeLeaf === this) this.workspace.updateTitle();
  }

  setPinned(p: boolean): void {
    this.pinned = p;
    this.tabHeaderEl.toggleClass("is-pinned", p);
    this.tabHeaderStatusContainerEl.empty();
    if (p) {
      const pin = this.tabHeaderStatusContainerEl.createDiv({ cls: "workspace-tab-header-status-icon mod-pinned", attr: { "aria-label": "Unpin" } });
      setIcon(pin, "pin");
      pin.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setPinned(false);
      });
    }
    this.trigger("pinned-change", p);
    this.workspace.requestSaveLayout();
  }

  togglePinned(): void {
    this.setPinned(!this.pinned);
  }

  setGroup(group: string | null): void {
    this.group = group;
    this.trigger("group-change", group);
    this.workspace.requestSaveLayout();
  }

  setGroupMember(other: WorkspaceLeaf): void {
    this.setGroup(other.group ?? other.id);
    if (!other.group) other.setGroup(other.id);
  }

  onResize(): void {
    this.view?.onResize();
  }

  detach(): void {
    this.workspace.detachLeaf(this);
  }

  /** Called by the workspace when the leaf is removed for good. */
  async destroy(): Promise<void> {
    if (this.view) await this.closeView(this.view);
    this.tabHeaderEl.detach();
    this.containerEl.detach();
  }

  setDimension(d: number | null): void {
    super.setDimension(d);
  }
}
