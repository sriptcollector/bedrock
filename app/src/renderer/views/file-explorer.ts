// File explorer ("file-explorer" view): lazy tree (only expanded folders render), sort orders,
// new note/folder, inline rename, drag to move, context menu with the "file-menu" event.
import { ItemView } from "../workspace/view";
import type { WorkspaceLeaf } from "../workspace/leaf";
import { TAbstractFile, TFile, TFolder } from "../vault/files";
import { setIcon } from "../dom/icons";
import { Menu } from "../ui/menu";
import { Keymap } from "../commands/keymap";
import { FILE_DRAG_TYPE } from "../workspace/dnd";
import { Notice } from "../ui/notice";

type SortOrder = "alphabetical" | "alphabeticalReverse" | "byModifiedTime" | "byModifiedTimeReverse" | "byCreatedTime" | "byCreatedTimeReverse";

const SORT_LABELS: [SortOrder, string][] = [
  ["alphabetical", "File name (A to Z)"],
  ["alphabeticalReverse", "File name (Z to A)"],
  ["byModifiedTime", "Modified time (new to old)"],
  ["byModifiedTimeReverse", "Modified time (old to new)"],
  ["byCreatedTime", "Created time (new to old)"],
  ["byCreatedTimeReverse", "Created time (old to new)"],
];

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

interface NodeEls {
  el: HTMLElement;
  selfEl: HTMLElement;
  childrenEl?: HTMLElement;
}

export class FileExplorerView extends ItemView {
  icon = "folder-closed";
  sortOrder: SortOrder = "alphabetical";
  autoReveal = false;
  private expanded = new Set<string>();
  private nodes = new Map<string, NodeEls>();
  private dirty = new Set<string>();
  private renderTimer: any = null;
  private filesEl: HTMLElement;
  private activePath: string | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.containerEl.addClass("mod-file-explorer");
  }

  getViewType(): string {
    return "file-explorer";
  }
  getDisplayText(): string {
    return "Files";
  }
  getState(): any {
    return { sortOrder: this.sortOrder, autoReveal: this.autoReveal };
  }
  async setState(state: any): Promise<void> {
    if (state?.sortOrder && SORT_LABELS.some(([k]) => k === state.sortOrder)) this.sortOrder = state.sortOrder;
    if (typeof state?.autoReveal === "boolean") this.autoReveal = state.autoReveal;
    this.rebuild();
  }

  private storageKey(): string {
    return "file-explorer-expanded";
  }

  protected async onOpen(): Promise<void> {
    this.headerEl.hide();
    const nav = this.contentEl.createDiv("nav-header");
    const btns = nav.createDiv("nav-buttons-container");
    const btn = (icon: string, label: string, cb: (e: MouseEvent) => any) => {
      const b = btns.createDiv({ cls: "clickable-icon nav-action-button", attr: { "aria-label": label } });
      setIcon(b, icon);
      b.addEventListener("click", cb);
      return b;
    };
    btn("square-pen", "New note", () => this.createNote(this.app.vault.getRoot()));
    btn("folder-plus", "New folder", () => this.createFolder(this.app.vault.getRoot()));
    btn("arrow-up-narrow-wide", "Change sort order", (e) => {
      const m = new Menu();
      for (const [k, label] of SORT_LABELS)
        m.addItem((i) =>
          i
            .setTitle(label)
            .setChecked(this.sortOrder === k)
            .onClick(() => {
              this.sortOrder = k;
              this.rebuild();
              this.app.workspace.requestSaveLayout();
            }),
        );
      m.showAtMouseEvent(e);
    });
    btn("chevrons-down-up", "Collapse all", () => {
      this.expanded.clear();
      this.saveExpanded();
      this.rebuild();
    });
    this.filesEl = this.contentEl.createDiv("nav-files-container node-insert-event");
    this.filesEl.addEventListener("contextmenu", (e) => {
      if ((e.target as HTMLElement).closest(".tree-item-self")) return;
      e.preventDefault();
      const m = new Menu();
      this.fillFolderMenu(m, this.app.vault.getRoot());
      m.showAtMouseEvent(e);
    });
    this.setupRootDrop();
    try {
      const saved = JSON.parse(this.app.loadLocalStorage(this.storageKey()) ?? "[]");
      if (Array.isArray(saved)) saved.forEach((p) => this.expanded.add(p));
    } catch {
      /* none */
    }

    const v = this.app.vault;
    this.registerEvent(v.on("create", (f: TAbstractFile) => this.markDirty(f.parent)));
    this.registerEvent(v.on("delete", (f: TAbstractFile) => this.markDirty(f.parent ?? v.getRoot(), f.path)));
    this.registerEvent(
      v.on("rename", (f: TAbstractFile, old: string) => {
        const oldParent = old.includes("/") ? v.getFolderByPath(old.slice(0, old.lastIndexOf("/"))) : v.getRoot();
        this.markDirty(oldParent ?? v.getRoot(), old);
        this.markDirty(f.parent);
        if (this.expanded.delete(old)) this.expanded.add(f.path);
      }),
    );
    this.registerEvent(v.on("modify", (f: TAbstractFile) => this.sortOrder !== "alphabetical" && this.sortOrder !== "alphabeticalReverse" && this.markDirty(f.parent)));
    this.registerEvent(this.app.workspace.on("file-open", (f: TFile | null) => this.setActive(f)));
    this.registerEvent(v.on("config-changed", (k: string) => k === "showUnsupportedFiles" && this.rebuild()));
    this.rebuild();
  }

  private saveExpanded(): void {
    this.app.saveLocalStorage(this.storageKey(), JSON.stringify([...this.expanded]));
  }

  // ---------- rendering ----------
  private rebuild(): void {
    if (!this.filesEl) return;
    this.filesEl.empty();
    this.nodes.clear();
    const root = this.app.vault.getRoot();
    const rootEl = this.filesEl.createDiv("tree-item nav-folder mod-root");
    const rootSelf = rootEl.createDiv({ cls: "tree-item-self nav-folder-title", attr: { "data-path": "/" } });
    rootSelf.createDiv({ cls: "tree-item-inner nav-folder-title-content", text: this.app.vault.getName() });
    const childrenEl = rootEl.createDiv("tree-item-children nav-folder-children");
    this.nodes.set("/", { el: rootEl, selfEl: rootSelf, childrenEl });
    this.renderChildren(root, childrenEl);
    this.setActive(this.app.workspace.getActiveFile());
  }

  private isVisible(f: TAbstractFile): boolean {
    if (f instanceof TFolder) return true;
    const file = f as TFile;
    if (this.app.vault.getConfig("showUnsupportedFiles")) return true;
    return file.extension === "md" || file.extension === "canvas" || file.extension === "base" || this.app.viewRegistry.isExtensionRegistered(file.extension);
  }

  private sorted(folder: TFolder): TAbstractFile[] {
    const items = folder.children.filter((c) => this.isVisible(c));
    const folders = items.filter((c) => c instanceof TFolder);
    const files = items.filter((c) => c instanceof TFile) as TFile[];
    const byName = (a: TAbstractFile, b: TAbstractFile) => collator.compare(a.name, b.name);
    folders.sort(byName);
    switch (this.sortOrder) {
      case "alphabetical":
        files.sort(byName);
        break;
      case "alphabeticalReverse":
        files.sort((a, b) => -byName(a, b));
        folders.reverse();
        break;
      case "byModifiedTime":
        files.sort((a, b) => b.stat.mtime - a.stat.mtime);
        break;
      case "byModifiedTimeReverse":
        files.sort((a, b) => a.stat.mtime - b.stat.mtime);
        break;
      case "byCreatedTime":
        files.sort((a, b) => b.stat.ctime - a.stat.ctime);
        break;
      case "byCreatedTimeReverse":
        files.sort((a, b) => a.stat.ctime - b.stat.ctime);
        break;
    }
    return [...folders, ...files];
  }

  private renderChildren(folder: TFolder, childrenEl: HTMLElement): void {
    childrenEl.empty();
    for (const c of this.sorted(folder)) childrenEl.appendChild(this.renderItem(c));
  }

  private renderItem(f: TAbstractFile): HTMLElement {
    if (f instanceof TFolder) {
      const el = createDiv("tree-item nav-folder");
      const self = el.createDiv({ cls: "tree-item-self nav-folder-title is-clickable mod-collapsible", attr: { "data-path": f.path, draggable: "true" } });
      const icon = self.createDiv("tree-item-icon collapse-icon");
      setIcon(icon, "chevron-right");
      self.createDiv({ cls: "tree-item-inner nav-folder-title-content", text: f.name });
      const childrenEl = el.createDiv("tree-item-children nav-folder-children");
      const open = this.expanded.has(f.path);
      el.toggleClass("is-collapsed", !open);
      icon.toggleClass("is-collapsed", !open);
      if (open) this.renderChildren(f, childrenEl);
      self.addEventListener("click", () => this.toggleFolder(f));
      this.bindCommon(self, f);
      this.nodes.set(f.path, { el, selfEl: self, childrenEl });
      return el;
    }
    const file = f as TFile;
    const el = createDiv("tree-item nav-file");
    const self = el.createDiv({ cls: "tree-item-self nav-file-title is-clickable", attr: { "data-path": file.path, draggable: "true" } });
    self.createDiv({ cls: "tree-item-inner nav-file-title-content", text: file.extension === "md" ? file.basename : file.basename });
    if (file.extension !== "md") self.createDiv({ cls: "nav-file-tag", text: file.extension });
    self.addEventListener("click", (e) => this.openFile(file, e));
    self.addEventListener("auxclick", (e) => e.button === 1 && this.openFile(file, e));
    this.bindCommon(self, file);
    if (file.path === this.activePath) self.addClass("is-active");
    this.nodes.set(file.path, { el, selfEl: self });
    return el;
  }

  private bindCommon(self: HTMLElement, f: TAbstractFile): void {
    self.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const m = new Menu();
      if (f instanceof TFolder) this.fillFolderMenu(m, f);
      else this.fillFileMenu(m, f as TFile);
      this.app.workspace.trigger("file-menu", m, f, "file-explorer-context-menu", this.leaf);
      m.showAtMouseEvent(e);
    });
    self.addEventListener("dragstart", (e) => {
      e.dataTransfer!.setData(FILE_DRAG_TYPE, f.path);
      if (f instanceof TFile) {
        e.dataTransfer!.setData("text/plain", this.app.fileManager.generateMarkdownLink(f, this.app.workspace.getActiveFile()?.path ?? ""));
      }
      e.dataTransfer!.effectAllowed = "all";
    });
    if (f instanceof TFolder) {
      self.addEventListener("dragover", (e) => {
        if (!e.dataTransfer?.types.includes(FILE_DRAG_TYPE)) return;
        e.preventDefault();
        self.addClass("is-being-dragged-over");
      });
      self.addEventListener("dragleave", () => self.removeClass("is-being-dragged-over"));
      self.addEventListener("drop", (e) => {
        self.removeClass("is-being-dragged-over");
        const p = e.dataTransfer?.getData(FILE_DRAG_TYPE);
        if (!p) return;
        e.preventDefault();
        e.stopPropagation();
        this.moveInto(p, f);
      });
    }
  }

  private setupRootDrop(): void {
    this.filesEl.addEventListener("dragover", (e) => {
      if (e.dataTransfer?.types.includes(FILE_DRAG_TYPE)) e.preventDefault();
    });
    this.filesEl.addEventListener("drop", (e) => {
      const p = e.dataTransfer?.getData(FILE_DRAG_TYPE);
      if (!p) return;
      e.preventDefault();
      this.moveInto(p, this.app.vault.getRoot());
    });
  }

  private async moveInto(path: string, folder: TFolder): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!f || f === folder || f.parent === folder) return;
    if (f instanceof TFolder && (folder.path + "/").startsWith(f.path + "/")) return;
    try {
      await this.app.fileManager.renameFile(f, folder.getParentPrefix() + f.name);
    } catch (e: any) {
      new Notice(`Couldn't move "${f.name}": ${e.message ?? e}`);
    }
  }

  private markDirty(folder: TFolder | null, removedPath?: string): void {
    if (removedPath) {
      this.nodes.delete(removedPath);
      for (const k of [...this.nodes.keys()]) if (k.startsWith(removedPath + "/")) this.nodes.delete(k);
    }
    if (!folder) return;
    this.dirty.add(folder.path);
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => this.flush(), 30);
  }

  private flush(): void {
    for (const p of this.dirty) {
      const folder = this.app.vault.getFolderByPath(p) ?? (p === "/" ? this.app.vault.getRoot() : null);
      const node = this.nodes.get(p);
      if (!folder || !node?.childrenEl) continue;
      if (p !== "/" && !this.expanded.has(p)) continue;
      this.renderChildren(folder, node.childrenEl);
    }
    this.dirty.clear();
  }

  private toggleFolder(f: TFolder, open?: boolean): void {
    const node = this.nodes.get(f.path);
    const willOpen = open ?? !this.expanded.has(f.path);
    if (willOpen) this.expanded.add(f.path);
    else this.expanded.delete(f.path);
    this.saveExpanded();
    if (!node) return;
    node.el.toggleClass("is-collapsed", !willOpen);
    node.selfEl.querySelector(".collapse-icon")?.toggleClass("is-collapsed", !willOpen);
    if (willOpen && node.childrenEl) this.renderChildren(f, node.childrenEl);
    else node.childrenEl?.empty();
  }

  private setActive(file: TFile | null): void {
    if (this.activePath) this.nodes.get(this.activePath)?.selfEl.removeClass("is-active");
    this.activePath = file?.path ?? null;
    if (!file) return;
    if (this.autoReveal) this.revealInFolder(file);
    this.nodes.get(file.path)?.selfEl.addClass("is-active");
  }

  revealInFolder(f: TAbstractFile): void {
    const parts = f.path.split("/");
    let p = "";
    for (const seg of parts.slice(0, -1)) {
      p = p ? p + "/" + seg : seg;
      const folder = this.app.vault.getFolderByPath(p);
      if (folder && !this.expanded.has(p)) this.toggleFolder(folder, true);
    }
    const n = this.nodes.get(f.path);
    n?.selfEl.scrollIntoView({ block: "center" });
    if (n) {
      n.selfEl.addClass("has-focus");
      setTimeout(() => n.selfEl.removeClass("has-focus"), 1200);
    }
  }

  // ---------- actions ----------
  private openFile(file: TFile, e: MouseEvent): void {
    const type = this.app.viewRegistry.getTypeByExtension(file.extension);
    if (!type && file.extension !== "md") {
      this.app.openWithDefaultApp(file.path);
      return;
    }
    const leaf = this.app.workspace.getLeaf(Keymap.isModEvent(e));
    leaf.openFile(file, { active: true });
  }

  async createNote(folder: TFolder): Promise<void> {
    const f = await this.app.fileManager.createNewMarkdownFile(folder, "Untitled");
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(f, { active: true, state: { mode: "source" }, eState: { rename: "all" } });
  }

  async createFolder(parent: TFolder): Promise<void> {
    const p = this.app.vault.getAvailablePath(parent.getParentPrefix() + "Untitled", "");
    const folder = await this.app.vault.createFolder(p);
    if (!parent.isRoot()) this.toggleFolder(parent, true);
    setTimeout(() => this.startRename(folder), 50);
  }

  startRename(f: TAbstractFile): void {
    this.revealInFolder(f);
    const node = this.nodes.get(f.path);
    if (!node) return;
    const title = node.selfEl.querySelector<HTMLElement>(".tree-item-inner")!;
    const original = f instanceof TFile ? f.basename : f.name;
    title.contentEditable = "true";
    title.addClass("is-being-renamed");
    title.setText(original);
    title.focus();
    const range = document.createRange();
    range.selectNodeContents(title);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    let done = false;
    const finish = async (commit: boolean) => {
      if (done) return;
      done = true;
      title.contentEditable = "false";
      title.removeClass("is-being-renamed");
      const name = title.getText().trim().replace(/[\\/:]/g, "");
      title.setText(original);
      if (!commit || !name || name === original) return;
      const newName = f instanceof TFile && f.extension ? `${name}.${f.extension}` : name;
      try {
        await this.app.fileManager.renameFile(f, f.parent && !f.parent.isRoot() ? f.parent.path + "/" + newName : newName);
      } catch (e: any) {
        new Notice(`Couldn't rename: ${e.message ?? e}`);
      }
    };
    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    });
    title.addEventListener("blur", () => finish(true), { once: true });
  }

  private fillFolderMenu(m: Menu, folder: TFolder): void {
    m.addItem((i) => i.setTitle("New note").setIcon("square-pen").setSection("new").onClick(() => this.createNote(folder)));
    m.addItem((i) => i.setTitle("New folder").setIcon("folder-plus").setSection("new").onClick(() => this.createFolder(folder)));
    if (!folder.isRoot()) {
      m.addItem((i) => i.setTitle("Rename...").setIcon("pencil").setSection("action").onClick(() => this.startRename(folder)));
      m.addItem((i) =>
        i
          .setTitle("Delete")
          .setIcon("trash-2")
          .setWarning(true)
          .setSection("danger")
          .onClick(() => this.app.fileManager.promptForDeletion(folder)),
      );
    }
    m.addItem((i) => i.setTitle("Reveal in system explorer").setIcon("folder-open").setSection("system").onClick(() => this.app.showInFolder(folder.path)));
  }

  private fillFileMenu(m: Menu, file: TFile): void {
    m.addItem((i) => i.setTitle("Open in new tab").setIcon("file-plus").setSection("open").onClick(() => this.app.workspace.getLeaf("tab").openFile(file)));
    m.addItem((i) => i.setTitle("Open to the right").setIcon("columns-2").setSection("open").onClick(() => this.app.workspace.getLeaf("split").openFile(file)));
    m.addItem((i) =>
      i
        .setTitle("Make a copy")
        .setIcon("copy")
        .setSection("action")
        .onClick(async () => {
          const base = file.parent && !file.parent.isRoot() ? file.parent.path + "/" + file.basename : file.basename;
          await this.app.vault.copy(file, this.app.vault.getAvailablePath(base, file.extension));
        }),
    );
    m.addItem((i) => i.setTitle("Rename...").setIcon("pencil").setSection("action").onClick(() => this.startRename(file)));
    m.addItem((i) =>
      i
        .setTitle("Copy path")
        .setIcon("clipboard-copy")
        .setSection("info")
        .onClick(() => navigator.clipboard.writeText(file.path)),
    );
    m.addItem((i) => i.setTitle("Reveal in system explorer").setIcon("folder-open").setSection("system").onClick(() => this.app.showInFolder(file.path)));
    m.addItem((i) =>
      i
        .setTitle("Delete")
        .setIcon("trash-2")
        .setWarning(true)
        .setSection("danger")
        .onClick(() => this.app.fileManager.promptForDeletion(file)),
    );
  }
}
