// View base classes (obsidian API): View, ItemView, FileView, EditableFileView, TextFileView.
import { Component } from "../api/events";
import { Scope } from "../commands/keymap";
import { setIcon } from "../dom/icons";
import { Menu } from "../ui/menu";
import { TFile } from "../vault/files";
import type { WorkspaceLeaf } from "./leaf";

export interface ViewState {
  type: string;
  state?: Record<string, any>;
  active?: boolean;
  pinned?: boolean;
  group?: WorkspaceLeaf;
}

export abstract class View extends Component {
  app: any;
  icon = "file";
  navigation = false;
  leaf: WorkspaceLeaf;
  containerEl: HTMLElement;
  scope: Scope | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super();
    this.leaf = leaf;
    this.app = leaf.app;
    this.containerEl = createDiv("workspace-leaf-content");
  }

  async open(containerEl: HTMLElement): Promise<void> {
    this.containerEl.setAttr("data-type", this.getViewType());
    containerEl.appendChild(this.containerEl);
    this.load();
    await this.onOpen();
  }

  async close(): Promise<void> {
    await this.onClose();
    this.unload();
    this.containerEl.detach();
  }

  protected async onOpen(): Promise<void> {}
  protected async onClose(): Promise<void> {}

  abstract getViewType(): string;
  getState(): Record<string, any> {
    return {};
  }
  async setState(_state: any, _result: { history: boolean }): Promise<void> {}
  getEphemeralState(): Record<string, any> {
    return {};
  }
  setEphemeralState(_state: any): void {}
  getIcon(): string {
    return this.icon;
  }
  onResize(): void {}
  abstract getDisplayText(): string;
  onPaneMenu(menu: Menu, source: string): void {
    // "More options" has no Close item in the original (the tab menu does).
    if (source === "more-options") return;
    menu.addItem((i) =>
      i
        .setTitle("Close")
        .setIcon("x")
        .setSection("close")
        .onClick(() => this.leaf.detach()),
    );
  }
  onTabMenu(_menu: Menu): void {}
}

export abstract class ItemView extends View {
  headerEl: HTMLElement;
  titleContainerEl: HTMLElement;
  titleEl: HTMLElement;
  titleParentEl: HTMLElement;
  contentEl: HTMLElement;
  actionsEl: HTMLElement;
  backButtonEl: HTMLElement;
  forwardButtonEl: HTMLElement;
  moreOptionsButtonEl: HTMLElement;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.headerEl = this.containerEl.createDiv("view-header");
    const left = this.headerEl.createDiv("view-header-left");
    const nav = left.createDiv("view-header-nav-buttons");
    this.backButtonEl = nav.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Navigate back" } });
    setIcon(this.backButtonEl, "arrow-left");
    this.forwardButtonEl = nav.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Navigate forward" } });
    setIcon(this.forwardButtonEl, "arrow-right");
    this.backButtonEl.addEventListener("click", () => this.leaf.history.back());
    this.forwardButtonEl.addEventListener("click", () => this.leaf.history.forward());
    this.titleContainerEl = this.headerEl.createDiv("view-header-title-container mod-at-start");
    this.titleParentEl = this.titleContainerEl.createDiv("view-header-title-parent");
    this.titleEl = this.titleContainerEl.createDiv("view-header-title");
    this.actionsEl = this.headerEl.createDiv("view-actions");
    this.moreOptionsButtonEl = this.actionsEl.createEl("button", { cls: "clickable-icon view-action", attr: { "aria-label": "More options" } });
    setIcon(this.moreOptionsButtonEl, "more-vertical");
    this.moreOptionsButtonEl.addEventListener("click", (e) => {
      const m = new Menu();
      this.onPaneMenu(m, "more-options");
      this.app.workspace.trigger("leaf-menu", m, this.leaf);
      const r = this.moreOptionsButtonEl.getBoundingClientRect();
      m.showAtPosition({ x: r.right, y: r.bottom + 4, left: true });
      e.stopPropagation();
    });
    this.contentEl = this.containerEl.createDiv("view-content");
  }

  addAction(icon: string, title: string, callback: (evt: MouseEvent) => any): HTMLElement {
    const b = createEl("button", { cls: "clickable-icon view-action", attr: { "aria-label": title } });
    setIcon(b, icon);
    b.addEventListener("click", callback);
    this.actionsEl.insertBefore(b, this.moreOptionsButtonEl);
    return b;
  }

  updateHeader(): void {
    this.titleEl.setText(this.getDisplayText());
    this.backButtonEl.toggleClass("mod-disabled", !this.leaf.history.backHistory.length);
    this.forwardButtonEl.toggleClass("mod-disabled", !this.leaf.history.forwardHistory.length);
  }
}

export abstract class FileView extends ItemView {
  allowNoFile = false;
  file: TFile | null = null;
  navigation = true;

  getDisplayText(): string {
    return this.file ? this.file.basename : "No file";
  }

  getState(): Record<string, any> {
    return this.file ? { file: this.file.path } : {};
  }

  async setState(state: any, result: { history: boolean }): Promise<void> {
    const path = state?.file;
    if (typeof path === "string") {
      const f = this.app.vault.getFileByPath(path);
      if (f && f !== this.file) await this.loadFile(f);
      else if (!f && !this.allowNoFile) {
        this.file = null;
      }
    }
    void result;
  }

  async loadFile(file: TFile): Promise<void> {
    if (this.file) await this.onUnloadFile(this.file);
    this.file = file;
    this.updateHeader();
    await this.onLoadFile(file);
    this.leaf.updateHeader();
  }

  async onLoadFile(_file: TFile): Promise<void> {}
  async onUnloadFile(_file: TFile): Promise<void> {}

  async onRename(_file: TFile): Promise<void> {
    this.updateHeader();
    this.leaf.updateHeader();
  }

  canAcceptExtension(_ext: string): boolean {
    return false;
  }

  onPaneMenu(menu: Menu, source: string): void {
    // File views offer the file's actions (plugins add theirs through "file-menu").
    if (this.file && !(menu as any).__fileMenuFired) {
      (menu as any).__fileMenuFired = true;
      this.app.workspace.trigger("file-menu", menu, this.file, source, this.leaf);
    }
    super.onPaneMenu(menu, source);
  }

  updateHeader(): void {
    super.updateHeader();
    const parent = this.file?.parent;
    this.titleParentEl.empty();
    if (parent && !parent.isRoot()) {
      for (const seg of parent.path.split("/")) {
        this.titleParentEl.createSpan({ cls: "view-header-breadcrumb", text: seg });
        this.titleParentEl.createSpan({ cls: "view-header-breadcrumb-separator", text: "/" });
      }
    }
  }
}

export abstract class EditableFileView extends FileView {}

export abstract class TextFileView extends EditableFileView {
  data = "";
  requestSave: () => void;
  private saveTimer: any = null;
  private dirty = false;
  lastSavedData: string | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.requestSave = () => {
      this.dirty = true;
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.save(), 2000);
    };
  }

  async onLoadFile(file: TFile): Promise<void> {
    const data = await this.app.vault.read(file);
    this.data = data;
    this.lastSavedData = data;
    this.setViewData(data, true);
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    if (this.dirty) await this.save();
    this.clear();
  }

  async save(clear = false): Promise<void> {
    clearTimeout(this.saveTimer);
    if (!this.file) return;
    const data = this.getViewData();
    this.dirty = false;
    if (data === this.lastSavedData) return;
    this.data = data;
    this.lastSavedData = data;
    await this.app.vault.modify(this.file, data);
    if (clear) this.clear();
  }

  async onClose(): Promise<void> {
    if (this.dirty) await this.save();
  }

  /** The file changed on disk (sync, another editor): reload unless we have unsaved edits. */
  async onExternalModify(file: TFile): Promise<void> {
    if (file !== this.file) return;
    const text = await this.app.vault.read(file);
    if (text === this.lastSavedData || text === this.getViewData()) return;
    if (this.dirty) return; // our pending save wins; the sync engine merges conflicts
    this.data = text;
    this.lastSavedData = text;
    this.setViewData(text, false);
  }

  abstract getViewData(): string;
  abstract setViewData(data: string, clear: boolean): void;
  abstract clear(): void;
}
