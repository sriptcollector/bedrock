// File explorer ("file-explorer" view): lazy tree (only expanded folders render), sort orders,
// new note/folder, auto-reveal, collapse/expand all, filter box, inline rename (F2), multi-select
// (Ctrl/Cmd and Shift click), drag to move (several at once), files dropped from the OS are copied
// in, page preview on hover, and the original's context menus plus the "file-menu" event.
import { ItemView } from "../workspace/view";
import type { WorkspaceLeaf } from "../workspace/leaf";
import { TAbstractFile, TFile, TFolder } from "../vault/files";
import { setIcon } from "../dom/icons";
import { Menu } from "../ui/menu";
import { Keymap } from "../commands/keymap";
import { FILE_DRAG_TYPE } from "../workspace/dnd";
import { Notice } from "../ui/notice";
import { fillFileMenu, fillFolderMenu, FolderSuggestModal } from "./sidebar/file-menu";
import nodeFs from "node:fs";

type SortOrder = "alphabetical" | "alphabeticalReverse" | "byModifiedTime" | "byModifiedTimeReverse" | "byCreatedTime" | "byCreatedTimeReverse";

const SORT_LABELS: [SortOrder, string, string][] = [
  ["alphabetical", "File name (A to Z)", "name"],
  ["alphabeticalReverse", "File name (Z to A)", "name"],
  ["byModifiedTime", "Modified time (new to old)", "mtime"],
  ["byModifiedTimeReverse", "Modified time (old to new)", "mtime"],
  ["byCreatedTime", "Created time (new to old)", "ctime"],
  ["byCreatedTimeReverse", "Created time (old to new)", "ctime"],
];

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const MULTI_DRAG_TYPE = "application/x-bedrock-files";

interface NodeEls {
  el: HTMLElement;
  selfEl: HTMLElement;
  childrenEl?: HTMLElement;
}

export class FileExplorerView extends ItemView {
  icon = "folder-closed";
  sortOrder: SortOrder = "alphabetical";
  autoReveal = false;
  showSearch = false;
  searchQuery = "";
  private expanded = new Set<string>();
  private nodes = new Map<string, NodeEls>();
  private dirty = new Set<string>();
  private renderTimer: any = null;
  private filesEl: HTMLElement;
  private activePath: string | null = null;
  private selected = new Set<string>();
  private anchorPath: string | null = null;
  private revealBtn: HTMLElement;
  private collapseBtn: HTMLElement;
  private searchBtn: HTMLElement;
  private searchWrap: HTMLElement;
  private searchInput: HTMLInputElement;

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
  /** Obsidian's `view.fileItems` (path -> {el, selfEl, innerEl, file}), read by plugins such as Iconize. */
  get fileItems(): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [path, n] of this.nodes) {
      const innerEl = n.selfEl.querySelector(".tree-item-inner") ?? n.selfEl;
      out[path] = { el: n.el, selfEl: n.selfEl, titleEl: n.selfEl, innerEl, titleInnerEl: innerEl, childrenEl: n.childrenEl, file: this.app.vault.getAbstractFileByPath(path) };
    }
    return out;
  }
  getState(): any {
    return { sortOrder: this.sortOrder, autoReveal: this.autoReveal, showSearch: this.showSearch, searchQuery: this.searchQuery };
  }
  async setState(state: any): Promise<void> {
    if (state?.sortOrder && SORT_LABELS.some(([k]) => k === state.sortOrder)) this.sortOrder = state.sortOrder;
    if (typeof state?.autoReveal === "boolean") this.autoReveal = state.autoReveal;
    if (typeof state?.showSearch === "boolean") this.showSearch = state.showSearch;
    if (typeof state?.searchQuery === "string") this.searchQuery = state.searchQuery;
    this.syncHeader();
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
    btn("edit", "New note", () => this.createNote(this.app.vault.getRoot()));
    btn("folder-plus", "New folder", () => this.createFolder(this.app.vault.getRoot()));
    btn("sort-asc", "Change sort order", (e) => {
      const m = new Menu();
      for (const [k, label, sec] of SORT_LABELS)
        m.addItem((i) =>
          i
            .setTitle(label)
            .setChecked(this.sortOrder === k)
            .setSection(sec)
            .onClick(() => {
              this.sortOrder = k;
              this.rebuild();
              this.app.workspace.requestSaveLayout();
            }),
        );
      m.showAtMouseEvent(e);
    });
    this.revealBtn = btn("gallery-vertical", "Auto-reveal current file", () => {
      this.autoReveal = !this.autoReveal;
      this.syncHeader();
      const f = this.app.workspace.getActiveFile();
      if (this.autoReveal && f) this.revealInFolder(f);
      this.app.workspace.requestSaveLayout();
    });
    this.collapseBtn = btn("chevrons-down-up", "Collapse all", () => {
      if (this.expanded.size) this.expanded.clear();
      else for (const f of this.app.vault.getAllFolders(false)) this.expanded.add(f.path);
      this.saveExpanded();
      this.rebuild();
    });
    this.searchBtn = btn("search", "Show search filter", () => {
      this.showSearch = !this.showSearch;
      this.syncHeader();
      if (this.showSearch) this.searchInput.focus();
      else if (this.searchQuery) {
        this.searchQuery = "";
        this.rebuild();
      }
    });
    this.searchBtn.hide();
    this.searchWrap = nav.createDiv("search-input-container");
    this.searchInput = this.searchWrap.createEl("input", { attr: { enterkeyhint: "search", type: "search", spellcheck: "false", placeholder: "Search..." } }) as HTMLInputElement;
    const clear = this.searchWrap.createDiv({ cls: "search-input-clear-button", attr: { "aria-label": "Clear search" } });
    this.searchInput.addEventListener("input", () => {
      this.searchQuery = this.searchInput.value;
      clear.toggle(!!this.searchQuery);
      this.rebuild();
    });
    clear.addEventListener("click", () => {
      this.searchInput.value = "";
      this.searchQuery = "";
      clear.hide();
      this.rebuild();
    });
    clear.hide();

    this.filesEl = this.contentEl.createDiv({ cls: "nav-files-container node-insert-event", attr: { tabindex: "-1" } });
    this.filesEl.addEventListener("contextmenu", (e) => {
      if ((e.target as HTMLElement).closest(".tree-item-self")) return;
      e.preventDefault();
      const m = new Menu();
      fillFolderMenu(this.app, m, this.app.vault.getRoot(), this.hooks());
      this.app.workspace.trigger("file-menu", m, this.app.vault.getRoot(), "file-explorer-context-menu", this.leaf);
      m.showAtMouseEvent(e);
    });
    this.filesEl.addEventListener("click", (e) => {
      if (!(e.target as HTMLElement).closest(".tree-item-self")) this.clearSelection();
    });
    this.filesEl.addEventListener("keydown", (e) => this.onKey(e));
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
        if (this.selected.delete(old)) this.selected.add(f.path);
      }),
    );
    this.registerEvent(v.on("modify", (f: TAbstractFile) => this.sortOrder !== "alphabetical" && this.sortOrder !== "alphabeticalReverse" && this.markDirty(f.parent)));
    this.registerEvent(this.app.workspace.on("file-open", (f: TFile | null) => this.setActive(f)));
    this.registerEvent(v.on("config-changed", (k: string) => k === "showUnsupportedFiles" && this.rebuild()));
    this.syncHeader();
    this.rebuild();
  }

  private hooks() {
    return {
      explorer: true,
      rename: (f: TAbstractFile) => this.startRename(f),
      newNote: (folder: TFolder) => this.createNote(folder),
      newFolder: (folder: TFolder) => this.createFolder(folder),
    };
  }

  private syncHeader(): void {
    if (!this.revealBtn) return;
    this.revealBtn.toggleClass("is-active", this.autoReveal);
    const anyOpen = this.expanded.size > 0;
    this.collapseBtn.setAttr("aria-label", anyOpen ? "Collapse all" : "Expand all");
    setIcon(this.collapseBtn, anyOpen ? "chevrons-down-up" : "chevrons-up-down");
    this.searchBtn.toggleClass("is-active", this.showSearch);
    this.searchWrap.toggle(this.showSearch);
    if (this.searchInput.value !== this.searchQuery) this.searchInput.value = this.searchQuery;
  }

  private saveExpanded(): void {
    this.app.saveLocalStorage(this.storageKey(), JSON.stringify([...this.expanded]));
    this.syncHeader();
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
    this.renderChildren(root, childrenEl, 0);
    this.setActive(this.app.workspace.getActiveFile());
    this.syncHeader();
  }

  private isVisible(f: TAbstractFile): boolean {
    if (f instanceof TFolder) return !this.searchQuery || this.folderMatches(f);
    const file = f as TFile;
    if (this.searchQuery && !file.path.toLowerCase().includes(this.searchQuery.toLowerCase())) return false;
    if (this.app.vault.getConfig("showUnsupportedFiles")) return true;
    return file.extension === "md" || file.extension === "canvas" || file.extension === "base" || this.app.viewRegistry.isExtensionRegistered(file.extension);
  }

  private folderMatches(folder: TFolder): boolean {
    const q = this.searchQuery.toLowerCase();
    if (folder.path.toLowerCase().includes(q)) return true;
    return folder.children.some((c) => (c instanceof TFolder ? this.folderMatches(c) : c.path.toLowerCase().includes(q)));
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

  private renderChildren(folder: TFolder, childrenEl: HTMLElement, depth: number): void {
    childrenEl.empty();
    for (const c of this.sorted(folder)) childrenEl.appendChild(this.renderItem(c, depth));
  }

  private isOpen(f: TFolder): boolean {
    return this.expanded.has(f.path) || (!!this.searchQuery && this.folderMatches(f));
  }

  private renderItem(f: TAbstractFile, depth: number): HTMLElement {
    const indent = `margin-inline-start: ${-17 * depth}px !important; padding-inline-start: ${24 + 17 * depth}px !important;`;
    if (f instanceof TFolder) {
      const el = createDiv("tree-item nav-folder");
      const self = el.createDiv({ cls: "tree-item-self nav-folder-title is-clickable mod-collapsible", attr: { "data-path": f.path, draggable: "true", style: indent } });
      const icon = self.createDiv("tree-item-icon collapse-icon nav-folder-collapse-indicator");
      setIcon(icon, "right-triangle");
      self.createDiv({ cls: "tree-item-inner nav-folder-title-content", text: f.name });
      const childrenEl = el.createDiv("tree-item-children nav-folder-children");
      const open = this.isOpen(f);
      el.toggleClass("is-collapsed", !open);
      icon.toggleClass("is-collapsed", !open);
      if (open) this.renderChildren(f, childrenEl, depth + 1);
      self.addEventListener("click", (e) => {
        if (this.handleSelectClick(e, f)) return;
        this.clearSelection();
        this.anchorPath = f.path;
        this.toggleFolder(f);
      });
      this.bindCommon(self, f);
      if (this.selected.has(f.path)) self.addClass("is-selected");
      this.nodes.set(f.path, { el, selfEl: self, childrenEl });
      return el;
    }
    const file = f as TFile;
    const el = createDiv("tree-item nav-file");
    const self = el.createDiv({ cls: "tree-item-self nav-file-title tappable is-clickable", attr: { "data-path": file.path, draggable: "true", style: indent } });
    self.createDiv({ cls: "tree-item-inner nav-file-title-content", text: file.basename });
    if (file.extension !== "md") self.createDiv({ cls: "nav-file-tag", text: file.extension });
    self.addEventListener("click", (e) => {
      if (this.handleSelectClick(e, file)) return;
      this.clearSelection();
      this.anchorPath = file.path;
      this.openFile(file, e);
    });
    self.addEventListener("auxclick", (e) => e.button === 1 && this.openFile(file, e));
    self.addEventListener("mouseover", (e) =>
      this.app.workspace.trigger("hover-link", { event: e, source: "file-explorer", hoverParent: this, targetEl: self, linktext: file.path, sourcePath: "" }),
    );
    this.bindCommon(self, file);
    if (file.path === this.activePath) self.addClass("is-active");
    if (this.selected.has(file.path)) self.addClass("is-selected");
    this.nodes.set(file.path, { el, selfEl: self });
    return el;
  }

  // ---------- selection ----------
  /** Alt-click toggles an item in the selection, Shift-click selects a range (as observed in the original). */
  private handleSelectClick(e: MouseEvent, f: TAbstractFile): boolean {
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      if (!this.selected.size && this.activePath && this.activePath !== f.path) this.select(this.activePath, true);
      this.select(f.path, !this.selected.has(f.path));
      this.anchorPath = f.path;
      return true;
    }
    if (e.shiftKey) {
      e.preventDefault();
      const order = this.visiblePaths();
      const a = order.indexOf(this.anchorPath ?? this.activePath ?? f.path);
      const b = order.indexOf(f.path);
      if (a < 0 || b < 0) return false;
      this.clearSelection();
      for (const p of order.slice(Math.min(a, b), Math.max(a, b) + 1)) this.select(p, true);
      return true;
    }
    return false;
  }

  private visiblePaths(): string[] {
    return Array.from(this.filesEl.querySelectorAll<HTMLElement>(".tree-item-self[data-path]"))
      .map((e) => e.dataset.path!)
      .filter((p) => p !== "/");
  }

  private select(path: string, on: boolean): void {
    if (on) this.selected.add(path);
    else this.selected.delete(path);
    this.nodes.get(path)?.selfEl.toggleClass("is-selected", on);
  }

  clearSelection(): void {
    for (const p of this.selected) this.nodes.get(p)?.selfEl.removeClass("is-selected");
    this.selected.clear();
  }

  private selectedFiles(): TAbstractFile[] {
    return [...this.selected].map((p) => this.app.vault.getAbstractFileByPath(p)).filter(Boolean) as TAbstractFile[];
  }

  private onKey(e: KeyboardEvent): void {
    const target = this.selectedFiles()[0] ?? (this.activePath ? this.app.vault.getAbstractFileByPath(this.activePath) : null);
    if (!target || (e.target as HTMLElement).isContentEditable) return;
    if (e.key === "F2") {
      e.preventDefault();
      this.startRename(target);
    } else if (e.key === "Delete" || (e.key === "Backspace" && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      const many = this.selectedFiles();
      if (many.length > 1) this.deleteMany(many);
      else this.app.fileManager.promptForDeletion(target);
    } else if (e.key === "Escape") this.clearSelection();
  }

  private async deleteMany(files: TAbstractFile[]): Promise<void> {
    const ok = await this.app.ui.confirm({ title: `Delete ${files.length} files`, body: `Are you sure you want to delete these ${files.length} files?`, cta: "Delete", danger: true });
    if (!ok) return;
    for (const f of files) await this.app.fileManager.trashFile(f);
    this.clearSelection();
  }

  private multiMenu(m: Menu, files: TAbstractFile[]): void {
    m.addItem((i) =>
      i
        .setTitle(`Move ${files.length} items to...`)
        .setIcon("folder-tree")
        .setSection("action")
        .onClick(() => new FolderSuggestModal(this.app, (folder) => files.forEach((f) => this.moveInto(f.path, folder))).open()),
    );
    m.addItem((i) =>
      i
        .setTitle("Bookmark...")
        .setIcon("bookmark")
        .setSection("action")
        .onClick(() => {
          const bm = (this.app as any).bookmarks;
          if (!bm) return;
          bm.add({ type: "group", title: `${files.length} items`, items: files.map((f, n) => ({ type: f instanceof TFolder ? "folder" : "file", path: f.path, ctime: Date.now() + n })) });
        }),
    );
    m.addItem((i) => i.setTitle(`Delete ${files.length} items`).setIcon("trash-2").setWarning(true).setSection("danger").onClick(() => this.deleteMany(files)));
  }

  // ---------- drag and drop, menus ----------
  private bindCommon(self: HTMLElement, f: TAbstractFile): void {
    self.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const m = new Menu();
      if (this.selected.size > 1 && this.selected.has(f.path)) {
        const files = this.selectedFiles();
        this.multiMenu(m, files);
        this.app.workspace.trigger("files-menu", m, files, "file-explorer-context-menu", this.leaf);
      } else {
        if (!this.selected.has(f.path)) this.clearSelection();
        if (f instanceof TFolder) fillFolderMenu(this.app, m, f, this.hooks());
        else fillFileMenu(this.app, m, f as TFile, this.hooks());
        this.app.workspace.trigger("file-menu", m, f, "file-explorer-context-menu", this.leaf);
      }
      self.addClass("has-focus");
      m.onHide(() => self.removeClass("has-focus"));
      m.showAtMouseEvent(e);
    });
    self.addEventListener("dragstart", (e) => {
      const group = this.selected.has(f.path) && this.selected.size > 1 ? [...this.selected] : [f.path];
      e.dataTransfer!.setData(FILE_DRAG_TYPE, f.path);
      e.dataTransfer!.setData(MULTI_DRAG_TYPE, JSON.stringify(group));
      if (f instanceof TFile) {
        e.dataTransfer!.setData("text/plain", this.app.fileManager.generateMarkdownLink(f, this.app.workspace.getActiveFile()?.path ?? ""));
      }
      e.dataTransfer!.effectAllowed = "all";
    });
    if (f instanceof TFolder) {
      self.addEventListener("dragover", (e) => {
        const types = e.dataTransfer?.types ?? [];
        if (!types.includes(FILE_DRAG_TYPE) && !types.includes("Files")) return;
        e.preventDefault();
        self.addClass("is-being-dragged-over");
      });
      self.addEventListener("dragleave", () => self.removeClass("is-being-dragged-over"));
      self.addEventListener("drop", (e) => {
        self.removeClass("is-being-dragged-over");
        if (this.handleDrop(e, f)) {
          e.preventDefault();
          e.stopPropagation();
        }
      });
    }
  }

  /** Move dragged vault items, or copy files dropped from the OS, into `folder`. */
  private handleDrop(e: DragEvent, folder: TFolder): boolean {
    const multi = e.dataTransfer?.getData(MULTI_DRAG_TYPE);
    const single = e.dataTransfer?.getData(FILE_DRAG_TYPE);
    if (multi || single) {
      let paths: string[] = [];
      try {
        paths = multi ? JSON.parse(multi) : [single!];
      } catch {
        paths = single ? [single] : [];
      }
      for (const p of paths) this.moveInto(p, folder);
      return true;
    }
    const osFiles = Array.from(e.dataTransfer?.files ?? []);
    if (!osFiles.length) return false;
    (async () => {
      for (const file of osFiles) {
        const src = (file as any).path as string | undefined;
        try {
          const data = src ? nodeFs.readFileSync(src) : Buffer.from(await file.arrayBuffer());
          const dot = file.name.lastIndexOf(".");
          const base = folder.getParentPrefix() + (dot > 0 ? file.name.slice(0, dot) : file.name);
          const ext = dot > 0 ? file.name.slice(dot + 1) : "";
          const target = this.app.vault.getAvailablePath(base, ext);
          await this.app.vault.createBinary(target, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
        } catch (err: any) {
          new Notice(`Couldn't copy "${file.name}" into the vault: ${err?.message ?? err}`);
        }
      }
      if (!folder.isRoot()) this.toggleFolder(folder, true);
    })();
    return true;
  }

  private setupRootDrop(): void {
    this.filesEl.addEventListener("dragover", (e) => {
      const types = e.dataTransfer?.types ?? [];
      if (types.includes(FILE_DRAG_TYPE) || types.includes("Files")) e.preventDefault();
    });
    this.filesEl.addEventListener("drop", (e) => {
      if (this.handleDrop(e, this.app.vault.getRoot())) e.preventDefault();
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

  private depthOf(path: string): number {
    return path === "/" ? 0 : path.split("/").length;
  }

  private flush(): void {
    for (const p of this.dirty) {
      const folder = this.app.vault.getFolderByPath(p) ?? (p === "/" ? this.app.vault.getRoot() : null);
      const node = this.nodes.get(p);
      if (!folder || !node?.childrenEl) continue;
      if (p !== "/" && !this.isOpen(folder)) continue;
      this.renderChildren(folder, node.childrenEl, this.depthOf(p === "/" ? "/" : p));
    }
    this.dirty.clear();
    if (this.activePath) this.nodes.get(this.activePath)?.selfEl.addClass("is-active");
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
    if (willOpen && node.childrenEl) this.renderChildren(f, node.childrenEl, this.depthOf(f.path));
    else node.childrenEl?.empty();
  }

  private setActive(file: TFile | null): void {
    if (this.activePath) this.nodes.get(this.activePath)?.selfEl.removeClass("is-active");
    this.activePath = file?.path ?? null;
    if (!file) return;
    if (this.autoReveal) this.revealInFolder(file, false);
    this.nodes.get(file.path)?.selfEl.addClass("is-active");
  }

  revealInFolder(f: TAbstractFile, flash = true): void {
    const parts = f.path.split("/");
    let p = "";
    for (const seg of parts.slice(0, -1)) {
      p = p ? p + "/" + seg : seg;
      const folder = this.app.vault.getFolderByPath(p);
      if (folder && !this.expanded.has(p)) this.toggleFolder(folder, true);
    }
    const n = this.nodes.get(f.path);
    n?.selfEl.scrollIntoView({ block: "nearest" });
    if (n && flash) {
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
    this.revealInFolder(f, false);
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
      e.stopPropagation();
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
}
