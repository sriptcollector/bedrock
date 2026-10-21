// Bookmarks: the store (.obsidian/bookmarks.json, same shape as the original: {items:[...]} with
// file, folder, search, heading, block, graph, url and group items), the "bookmarks" view with
// drag-to-reorder and groups, the add/edit modal, and the bookmark button in note headers.
import { Events } from "../../api/events";
import { ItemView } from "../../workspace/view";
import type { WorkspaceLeaf } from "../../workspace/leaf";
import { TFile, TFolder, type TAbstractFile } from "../../vault/files";
import { setIcon } from "../../dom/icons";
import { Menu } from "../../ui/menu";
import { Modal } from "../../ui/modal";
import { Notice } from "../../ui/notice";
import { Keymap } from "../../commands/keymap";
import { FILE_DRAG_TYPE } from "../../workspace/dnd";
import { collapseIcon, navButton, searchBox, setCollapsed, type SearchBox } from "./tree";
import { showFileMenu } from "./file-menu";
import { moveBookmark, removeBookmark, walkBookmarks, type BookmarkItem } from "./bookmark-model";
export type { BookmarkItem };

export const BOOKMARKS_VIEW = "bookmarks";

const ICONS: Record<string, string> = { file: "file", folder: "folder", search: "search", heading: "heading", block: "box", graph: "git-fork", url: "globe" };

export function bookmarkTitle(app: any, it: BookmarkItem): string {
  if (it.title) return it.title;
  switch (it.type) {
    case "file":
    case "folder": {
      const p = it.path ?? "";
      const name = p.split("/").pop() ?? p;
      return it.type === "file" && name.endsWith(".md") ? name.slice(0, -3) : name || "/";
    }
    case "heading":
    case "block": {
      const base = (it.path ?? "").split("/").pop()!.replace(/\.md$/, "");
      return `${base} > ${(it.subpath ?? "").replace(/^#\^?/, "")}`;
    }
    case "search":
      return it.query ?? "";
    case "url":
      return it.url ?? "";
    case "graph":
      return "Graph view";
    case "group":
      return "Untitled group";
  }
  void app;
  return it.type;
}

export class BookmarksStore extends Events {
  items: BookmarkItem[] = [];
  private loaded = false;
  private saveTimer: any = null;
  private extra: Record<string, any> = {};

  constructor(private app: any) {
    super();
    app.vault.on("rename", (f: TAbstractFile, old: string) => {
      let changed = false;
      walkBookmarks(this.items, (it) => {
        if (!it.path) return;
        if (it.path === old) {
          it.path = f.path;
          changed = true;
        } else if (f instanceof TFolder && it.path.startsWith(old + "/")) {
          it.path = f.path + it.path.slice(old.length);
          changed = true;
        }
      });
      if (changed) this.changed();
    });
  }

  private get filePath(): string {
    return this.app.vault.configDir + "/bookmarks.json";
  }

  async load(): Promise<void> {
    try {
      const j = JSON.parse(await this.app.vault.adapter.read(this.filePath));
      this.items = Array.isArray(j?.items) ? j.items : [];
      const { items: _items, ...rest } = j ?? {};
      this.extra = rest;
    } catch {
      this.items = [];
    }
    this.loaded = true;
    this.trigger("changed");
  }

  changed(): void {
    this.trigger("changed");
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 200);
  }

  async save(): Promise<void> {
    if (!this.loaded) return;
    await this.app.vault.adapter.write(this.filePath, JSON.stringify({ ...this.extra, items: this.items }, null, 2));
  }

  add(item: Omit<BookmarkItem, "ctime"> & { ctime?: number }, group?: BookmarkItem | null): BookmarkItem {
    const it: BookmarkItem = { ...item, ctime: item.ctime ?? Date.now() } as BookmarkItem;
    if (group && group.type === "group") (group.items ??= []).push(it);
    else this.items.push(it);
    this.changed();
    return it;
  }

  remove(it: BookmarkItem): void {
    if (removeBookmark(this.items, it)) this.changed();
  }

  find(pred: (it: BookmarkItem) => boolean): BookmarkItem | null {
    let found: BookmarkItem | null = null;
    walkBookmarks(this.items, (it) => {
      if (pred(it)) {
        found = it;
        return true;
      }
    });
    return found;
  }

  findFileBookmark(path: string): BookmarkItem | null {
    return this.find((it) => (it.type === "file" || it.type === "folder") && it.path === path && !it.subpath);
  }

  groups(): BookmarkItem[] {
    const out: BookmarkItem[] = [];
    walkBookmarks(this.items, (it) => {
      if (it.type === "group") out.push(it);
    });
    return out;
  }

  // ----- interactive helpers used by menus and commands -----
  bookmarkFileInteractive(f: TAbstractFile, subpath?: string): void {
    const type = f instanceof TFolder ? "folder" : subpath ? (subpath.startsWith("#^") ? "block" : "heading") : "file";
    new BookmarkModal(this.app, this, { type, path: f.path, subpath } as BookmarkItem, true).open();
  }

  bookmarkSearchInteractive(query: string): void {
    if (!query.trim()) {
      new Notice("Type a search first.");
      return;
    }
    new BookmarkModal(this.app, this, { type: "search", query } as BookmarkItem, true).open();
  }

  editBookmark(it: BookmarkItem): void {
    new BookmarkModal(this.app, this, it, false).open();
  }

  async openBookmark(it: BookmarkItem, newLeaf: any = false): Promise<void> {
    const app = this.app;
    switch (it.type) {
      case "file": {
        const f = app.vault.getFileByPath(it.path ?? "");
        if (!f) return void new Notice(`"${it.path}" doesn't exist anymore.`);
        await app.workspace.getLeaf(newLeaf).openFile(f, { active: true });
        if (it.subpath) app.workspace.getLeaf(false).setEphemeralState({ subpath: it.subpath });
        return;
      }
      case "heading":
      case "block":
        return app.workspace.openLinkText((it.path ?? "") + (it.subpath ?? ""), "", newLeaf);
      case "folder": {
        const f = app.vault.getAbstractFileByPath(it.path ?? "");
        if (f) (await import("./file-menu")).revealInExplorer(app, f);
        return;
      }
      case "search":
        return (app as any).globalSearch?.openGlobalSearch(it.query ?? "");
      case "url":
        return app.openExternal(it.url);
      case "graph":
        app.commands.executeCommandById("graph:open");
        return;
    }
  }
}

export class BookmarkModal extends Modal {
  constructor(app: any, private store: BookmarksStore, private item: BookmarkItem, private isNew: boolean) {
    super(app);
  }

  onOpen(): void {
    const it = this.item;
    this.setTitle(this.isNew ? "Add bookmark" : "Edit bookmark");
    this.modalEl.addClass("mod-bookmark");
    const c = this.contentEl;
    const row = (label: string) => {
      const s = c.createDiv("setting-item");
      s.createDiv("setting-item-info").createDiv({ cls: "setting-item-name", text: label });
      return s.createDiv("setting-item-control");
    };
    const titleInput = row("Title").createEl("input", { type: "text", attr: { placeholder: bookmarkTitle(this.app, { ...it, title: "" }) } }) as HTMLInputElement;
    titleInput.value = it.title ?? "";
    let groupSel: HTMLSelectElement | null = null;
    const groups = this.store.groups().filter((g) => g !== it);
    if (groups.length) {
      groupSel = row("Bookmark group").createEl("select", { cls: "dropdown" }) as HTMLSelectElement;
      groupSel.createEl("option", { value: "", text: "None" });
      groups.forEach((g, i) => groupSel!.createEl("option", { value: String(i), text: bookmarkTitle(this.app, g) }));
      const cur = groups.findIndex((g) => g.items?.includes(it));
      if (cur >= 0) groupSel.value = String(cur);
    }
    const btns = this.modalEl.createDiv("modal-button-container");
    const save = btns.createEl("button", { cls: "mod-cta", text: this.isNew ? "Save" : "Save" });
    if (!this.isNew) {
      const del = btns.createEl("button", { cls: "mod-warning", text: "Remove" });
      del.addEventListener("click", () => {
        this.store.remove(it);
        this.close();
      });
    }
    const cancel = btns.createEl("button", { text: "Cancel" });
    const submit = () => {
      const title = titleInput.value.trim();
      if (title) it.title = title;
      else delete it.title;
      const g = groupSel && groupSel.value !== "" ? groups[Number(groupSel.value)] : null;
      if (this.isNew) this.store.add(it, g);
      else {
        if (g !== undefined) moveBookmark(this.store.items, it, g, "inside");
        if (!g) {
          removeBookmark(this.store.items, it);
          this.store.items.push(it);
        }
        this.store.changed();
      }
      this.close();
    };
    save.addEventListener("click", submit);
    cancel.addEventListener("click", () => this.close());
    titleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    setTimeout(() => titleInput.focus(), 0);
  }
}

const BOOKMARK_DRAG = "application/x-bedrock-bookmark";

export class BookmarksView extends ItemView {
  icon = "bookmark";
  showSearch = false;
  searchQuery = "";
  private listEl: HTMLElement;
  private searchBtn: HTMLElement;
  private filter: SearchBox;
  private collapsed = new Set<BookmarkItem>();
  private dragItem: BookmarkItem | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    const nav = createDiv("nav-header");
    this.containerEl.prepend(nav);
    const btns = nav.createDiv("nav-buttons-container");
    navButton(btns, "bookmark-plus", "Bookmark the active tab...", () => this.app.commands.executeCommandById("bookmarks:bookmark-current-view"));
    navButton(btns, "folder-plus", "New group", () => this.newGroup());
    navButton(btns, "chevrons-down-up", "Collapse all", () => {
      if (this.collapsed.size) this.collapsed.clear();
      else walkBookmarks(this.store.items, (it) => void (it.type === "group" && this.collapsed.add(it)));
      this.render();
    });
    this.searchBtn = navButton(btns, "search", "Show search filter", () => {
      this.showSearch = !this.showSearch;
      this.syncUi();
      if (this.showSearch) this.filter.inputEl.focus();
    });
    this.filter = searchBox(nav, (v) => {
      this.searchQuery = v;
      this.render();
    });
    this.contentEl.addClass("node-insert-event");
    this.contentEl.style.position = "relative";
    this.listEl = this.contentEl.createDiv();
    this.contentEl.addEventListener("dragover", (e) => {
      if (e.dataTransfer?.types.includes(FILE_DRAG_TYPE) || this.dragItem) e.preventDefault();
    });
    this.contentEl.addEventListener("drop", (e) => {
      if ((e.target as HTMLElement).closest(".tree-item-self")) return;
      e.preventDefault();
      if (this.dragItem) {
        moveBookmark(this.store.items, this.dragItem, null, "after");
        this.dragItem = null;
        this.store.changed();
        return;
      }
      const p = e.dataTransfer?.getData(FILE_DRAG_TYPE);
      const f = p ? this.app.vault.getAbstractFileByPath(p) : null;
      if (f && !this.store.findFileBookmark(f.path)) this.store.add({ type: f instanceof TFolder ? "folder" : "file", path: f.path });
    });
    this.contentEl.addEventListener("contextmenu", (e) => {
      if ((e.target as HTMLElement).closest(".tree-item-self")) return;
      e.preventDefault();
      const m = new Menu();
      m.addItem((i) => i.setTitle("New group").setIcon("folder-plus").onClick(() => this.newGroup()));
      m.showAtMouseEvent(e);
    });
  }

  get store(): BookmarksStore {
    return (this.app as any).bookmarks;
  }

  getViewType(): string {
    return BOOKMARKS_VIEW;
  }
  getDisplayText(): string {
    return "Bookmarks";
  }
  getState(): any {
    return {};
  }

  protected async onOpen(): Promise<void> {
    this.registerEvent(this.store.on("changed", () => this.render()));
    this.registerEvent(this.app.vault.on("delete", () => this.render()));
    this.registerEvent(this.app.vault.on("create", () => this.render()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.markActive()));
    this.render();
  }

  private syncUi(): void {
    this.searchBtn.toggleClass("is-active", this.showSearch);
    this.filter.containerEl.toggle(this.showSearch);
  }

  private newGroup(): void {
    const g = this.store.add({ type: "group", title: "", items: [] } as any);
    this.render();
    const row = this.listEl.querySelector(`.tree-item-self[data-ctime="${g.ctime}"] .tree-item-inner-text`) as HTMLElement | null;
    if (row) this.inlineRename(row, g);
  }

  render(): void {
    if (!this.listEl || !this.store) return;
    this.syncUi();
    this.listEl.empty();
    this.listEl.createDiv({ attr: { style: "width: 1px; height: 0.1px; margin-bottom: 0px;" } });
    const q = this.searchQuery.trim().toLowerCase();
    const matches = (it: BookmarkItem): boolean => !q || bookmarkTitle(this.app, it).toLowerCase().includes(q) || (it.type === "group" && (it.items ?? []).some(matches));
    const items = this.store.items.filter(matches);
    if (!items.length) {
      this.listEl.createDiv({ cls: "pane-empty", text: q ? "No bookmarks match your search." : "No bookmarks yet." });
      return;
    }
    for (const it of items) this.listEl.appendChild(this.renderItem(it, 0, matches));
    this.markActive();
  }

  private markActive(): void {
    const f = this.app.workspace.getActiveFile();
    this.listEl.querySelectorAll(".tree-item-self.is-active").forEach((e) => e.removeClass("is-active"));
    if (!f) return;
    this.listEl.querySelectorAll<HTMLElement>(".tree-item-self.bookmark").forEach((el) => {
      if (el.dataset.path === f.path && el.dataset.type === "file") el.addClass("is-active");
    });
  }

  private renderItem(it: BookmarkItem, depth: number, matches: (it: BookmarkItem) => boolean): HTMLElement {
    const title = bookmarkTitle(this.app, it);
    const item = createDiv({ cls: "tree-item", attr: { "data-path": depth && it.title === undefined ? title : title } });
    const self = item.createDiv({ cls: "tree-item-self bookmark is-clickable", attr: { draggable: "true", "data-ctime": String(it.ctime), "data-type": it.type } });
    if (it.path) self.dataset.path = it.path;
    self.setAttr("style", `margin-inline-start: ${-17 * depth}px !important; padding-inline-start: ${24 + 17 * depth}px !important;`);
    if (it.type === "group") {
      self.addClass("mod-collapsible");
      collapseIcon(self);
    } else setIcon(self.createDiv("tree-item-icon"), ICONS[it.type] ?? "bookmark");
    const textEl = self.createDiv("tree-item-inner").createSpan({ cls: "tree-item-inner-text", text: title });
    if ((it.type === "file" || it.type === "folder" || it.type === "heading" || it.type === "block") && !this.app.vault.getAbstractFileByPath(it.path ?? "")) self.addClass("is-missing");
    self.addEventListener("click", (e) => {
      if (it.type === "group") {
        if (this.collapsed.has(it)) this.collapsed.delete(it);
        else this.collapsed.add(it);
        setCollapsed(item, this.collapsed.has(it));
        return;
      }
      this.store.openBookmark(it, Keymap.isModEvent(e));
    });
    self.addEventListener("mouseover", (e) => {
      if (it.type === "file" || it.type === "heading" || it.type === "block")
        this.app.workspace.trigger("hover-link", { event: e, source: "bookmarks", hoverParent: this, targetEl: self, linktext: (it.path ?? "") + (it.subpath ?? ""), sourcePath: "" });
    });
    self.addEventListener("contextmenu", (e) => this.itemMenu(e, it, textEl));
    this.bindDrag(self, it);
    if (it.type === "group") {
      const kids = item.createDiv("tree-item-children");
      kids.createDiv({ attr: { style: "width: 1px; height: 0.1px; margin-bottom: 0px;" } });
      for (const c of (it.items ?? []).filter(matches)) kids.appendChild(this.renderItem(c, depth + 1, matches));
      setCollapsed(item, this.collapsed.has(it));
    }
    return item;
  }

  private itemMenu(e: MouseEvent, it: BookmarkItem, textEl: HTMLElement): void {
    const f = it.path ? this.app.vault.getAbstractFileByPath(it.path) : null;
    if (f && (it.type === "file" || it.type === "folder")) {
      showFileMenu(this.app, e, f, "bookmarks", this.leaf);
      return;
    }
    e.preventDefault();
    const m = new Menu();
    if (it.type !== "group") m.addItem((i) => i.setTitle("Open in new tab").setIcon("file-plus").setSection("open").onClick(() => this.store.openBookmark(it, "tab")));
    m.addItem((i) => i.setTitle("Rename...").setIcon("edit-3").setSection("action").onClick(() => this.inlineRename(textEl, it)));
    if (it.type !== "group") m.addItem((i) => i.setTitle("Edit bookmark").setIcon("bookmark").setSection("action").onClick(() => this.store.editBookmark(it)));
    m.addItem((i) =>
      i
        .setTitle(it.type === "group" ? "Delete group" : "Remove bookmark")
        .setIcon("trash-2")
        .setWarning(true)
        .setSection("danger")
        .onClick(() => this.store.remove(it)),
    );
    m.showAtMouseEvent(e);
  }

  private inlineRename(el: HTMLElement, it: BookmarkItem): void {
    el.contentEditable = "true";
    el.addClass("is-being-renamed");
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(r);
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      el.contentEditable = "false";
      el.removeClass("is-being-renamed");
      const v = el.getText().trim();
      if (commit && v) it.title = v;
      this.store.changed();
    };
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    });
    el.addEventListener("blur", () => finish(true), { once: true });
  }

  private bindDrag(self: HTMLElement, it: BookmarkItem): void {
    const clear = () => this.listEl.querySelectorAll(".is-drop-target-above, .is-drop-target-below, .is-drop-target-inside").forEach((e) => e.removeClass("is-drop-target-above", "is-drop-target-below", "is-drop-target-inside"));
    const zone = (e: DragEvent): "before" | "after" | "inside" => {
      const r = self.getBoundingClientRect();
      const y = e.clientY - r.top;
      if (it.type === "group" && y > r.height * 0.25 && y < r.height * 0.75) return "inside";
      return y < r.height / 2 ? "before" : "after";
    };
    self.addEventListener("dragstart", (e) => {
      this.dragItem = it;
      self.addClass("is-being-dragged");
      e.dataTransfer!.setData(BOOKMARK_DRAG, String(it.ctime));
      if (it.path) {
        const f = this.app.vault.getAbstractFileByPath(it.path);
        if (f instanceof TFile) e.dataTransfer!.setData("text/plain", this.app.fileManager.generateMarkdownLink(f, this.app.workspace.getActiveFile()?.path ?? "", it.subpath ?? ""));
      }
      e.dataTransfer!.effectAllowed = "copyMove";
    });
    self.addEventListener("dragend", () => {
      self.removeClass("is-being-dragged");
      this.dragItem = null;
      clear();
    });
    self.addEventListener("dragover", (e) => {
      const fileDrag = e.dataTransfer?.types.includes(FILE_DRAG_TYPE);
      if (!this.dragItem && !fileDrag) return;
      e.preventDefault();
      e.stopPropagation();
      clear();
      const z = zone(e);
      self.addClass(z === "inside" ? "is-drop-target-inside" : z === "before" ? "is-drop-target-above" : "is-drop-target-below");
    });
    self.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      clear();
      const z = zone(e);
      if (this.dragItem) {
        if (moveBookmark(this.store.items, this.dragItem, it, z)) this.store.changed();
        this.dragItem = null;
        return;
      }
      const p = e.dataTransfer?.getData(FILE_DRAG_TYPE);
      const f = p ? this.app.vault.getAbstractFileByPath(p) : null;
      if (!f) return;
      const nb: BookmarkItem = { type: f instanceof TFolder ? "folder" : "file", path: f.path, ctime: Date.now() };
      this.store.items.push(nb);
      moveBookmark(this.store.items, nb, it, z);
      this.store.changed();
    });
  }
}

/** Bookmark button in the header of file views: filled when the file is bookmarked. */
export function syncHeaderBookmarkButtons(app: any): void {
  const store: BookmarksStore = (app as any).bookmarks;
  app.workspace.iterateAllLeaves((leaf: any) => {
    const v = leaf.view;
    if (!v?.actionsEl || !("file" in v)) return;
    let btn: HTMLElement | null = v.actionsEl.querySelector(".view-action.mod-bookmark");
    if (!v.file) {
      btn?.remove();
      return;
    }
    if (!btn) {
      btn = createEl("button", { cls: "clickable-icon view-action mod-bookmark" });
      setIcon(btn, "bookmark");
      v.actionsEl.prepend(btn);
      btn.addEventListener("click", (e) => {
        const f = v.file;
        if (!f) return;
        const ex = store.findFileBookmark(f.path);
        if (ex) store.editBookmark(ex);
        else if (Keymap.isModEvent(e)) store.add({ type: "file", path: f.path });
        else store.bookmarkFileInteractive(f);
      });
    }
    const on = !!store.findFileBookmark(v.file.path);
    btn.toggleClass("mod-bookmarked", on);
    btn.toggleClass("mod-filled", on);
    btn.setAttr("aria-label", on ? "Bookmarked" : "Bookmark");
  });
}
