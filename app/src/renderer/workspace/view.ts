// View base classes (obsidian API): View, ItemView, FileView, EditableFileView, TextFileView.
import { Component } from "../api/events";
import { Scope } from "../commands/keymap";
import { setIcon } from "../dom/icons";
import { Menu } from "../ui/menu";
import { TFile } from "../vault/files";
import { Notice } from "../ui/notice";
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
    // "More options" and the tab header menu have no Close item here; file views list file actions instead.
    if (source === "more-options" || source === "tab-header" || (this as any).file) return;
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
    // Right-click (or long press) lists that direction's history, nearest first.
    const historyMenu = (e: MouseEvent, dir: -1 | 1) => {
      e.preventDefault();
      const list = dir < 0 ? this.leaf.history.backHistory : this.leaf.history.forwardHistory;
      if (!list.length) return;
      const m = new Menu();
      list
        .slice()
        .reverse()
        .forEach((h, i) => m.addItem((it) => it.setTitle(h.title).setIcon(h.icon).onClick(() => this.leaf.history.go(dir * (i + 1)))));
      m.showAtMouseEvent(e);
    };
    this.backButtonEl.addEventListener("contextmenu", (e) => historyMenu(e, -1));
    this.forwardButtonEl.addEventListener("contextmenu", (e) => historyMenu(e, 1));
    this.titleContainerEl = this.headerEl.createDiv("view-header-title-container mod-at-start");
    this.titleParentEl = this.titleContainerEl.createDiv("view-header-title-parent");
    this.titleEl = this.titleContainerEl.createDiv("view-header-title");
    this.actionsEl = this.headerEl.createDiv("view-actions");
    this.moreOptionsButtonEl = this.actionsEl.createEl("button", { cls: "clickable-icon view-action", attr: { "aria-label": "More options" } });
    setIcon(this.moreOptionsButtonEl, "more-vertical");
    this.moreOptionsButtonEl.addEventListener("click", (e) => {
      const m = new Menu();
      if (this.app.shell?.fillMoreOptionsMenu) this.app.shell.fillMoreOptionsMenu(m, this.leaf);
      else this.onPaneMenu(m, "more-options");
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
    try {
      await this.onLoadFile(file);
    } catch (e: any) {
      console.error(e);
      new Notice(`Couldn't open "${file.name}": ${friendlyError(e)}`);
    }
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
      const segs = parent.path.split("/");
      segs.forEach((seg, i) => {
        const crumb = this.titleParentEl.createSpan({ cls: "view-header-breadcrumb", text: seg });
        // Clicking a folder in the path reveals it in the file explorer.
        const folderPath = segs.slice(0, i + 1).join("/");
        crumb.addEventListener("click", async () => {
          const folder = this.app.vault.getAbstractFileByPath(folderPath);
          if (!folder) return;
          const ws = this.app.workspace;
          const leaf = ws.getLeavesOfType("file-explorer")[0] ?? (await ws.ensureSideLeaf("file-explorer", "left", { reveal: true }));
          await ws.revealLeaf(leaf);
          (leaf.view as any)?.revealInFolder?.(folder);
        });
        this.titleParentEl.createSpan({ cls: "view-header-breadcrumb-separator", text: "/" });
      });
    }
    // Clicking the name renames the file.
    if (!this.titleEl.hasAttribute("data-rename-hooked")) {
      this.titleEl.setAttribute("data-rename-hooked", "");
      this.titleEl.addEventListener("click", () => {
        if (!this.file) return;
        if (typeof (this as any).focusInlineTitle === "function" && (this as any).getMode?.() !== "preview" && this.app.vault.getConfig("showInlineTitle") !== false) (this as any).focusInlineTitle(true);
        else void this.app.shell?.renameFilePrompt?.(this.file);
      });
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
    try {
      await this.app.vault.modify(this.file, data);
    } catch (e: any) {
      // Keep the text in the editor and try again on the next change.
      this.lastSavedData = null;
      this.dirty = true;
      console.error(e);
      new Notice(`Couldn't save "${this.file.name}": ${friendlyError(e)} Your changes are still in the editor.`, 10000);
      return;
    }
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

/** A plain-language reason for a file system error. */
export function friendlyError(e: any): string {
  const code = e?.code;
  if (code === "EACCES" || code === "EPERM") return "the app isn't allowed to write there (the file may be read-only or open in another program).";
  if (code === "ENOSPC") return "the disk is full.";
  if (code === "ENOENT") return "the file no longer exists.";
  if (code === "EBUSY") return "another program is using the file.";
  return String(e?.message ?? e);
}
