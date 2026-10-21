// Outline view ("outline"): heading tree of the active note. Click to jump, collapse, filter,
// follow the cursor ("Auto-scroll to current section"), drag a heading to move its section.
import { ItemView } from "../../workspace/view";
import type { WorkspaceLeaf } from "../../workspace/leaf";
import { TFile } from "../../vault/files";
import { setIcon } from "../../dom/icons";
import { Keymap } from "../../commands/keymap";
import { buildOutline, moveSection, type HeadingInfo, type OutlineNode } from "./outline-model";
import { collapseIcon, navButton, searchBox, setCollapsed, type SearchBox } from "./tree";

export const OUTLINE_VIEW = "outline";

export class OutlineView extends ItemView {
  icon = "list";
  file: TFile | null = null;
  followCursor = false;
  showSearch = false;
  searchQuery = "";
  private collapsed = new Set<number>();
  private allCollapsed = false;
  private listEl: HTMLElement;
  private followBtn: HTMLElement;
  private collapseBtn: HTMLElement;
  private searchBtn: HTMLElement;
  private filter: SearchBox;
  private headings: HeadingInfo[] = [];
  private rows: HTMLElement[] = [];
  private activeIndex = -1;
  private timer: any = null;
  private dragFrom = -1;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    const nav = createDiv("nav-header");
    this.containerEl.prepend(nav);
    const btns = nav.createDiv("nav-buttons-container");
    this.searchBtn = navButton(btns, "search", "Show search filter", () => {
      this.showSearch = !this.showSearch;
      this.syncUi();
      if (this.showSearch) this.filter.inputEl.focus();
      this.app.workspace.requestSaveLayout();
    });
    this.followBtn = navButton(btns, "gallery-vertical", "Auto-scroll to current section", () => {
      this.followCursor = !this.followCursor;
      this.syncUi();
      this.app.workspace.requestSaveLayout();
    });
    this.collapseBtn = navButton(btns, "chevrons-down-up", "Collapse all", () => {
      this.allCollapsed = !this.allCollapsed;
      this.collapsed.clear();
      if (this.allCollapsed) this.headings.forEach((_, i) => this.collapsed.add(i));
      this.render();
    });
    this.filter = searchBox(nav, (v) => {
      this.searchQuery = v;
      this.render();
    });
    this.contentEl.addClass("node-insert-event");
    this.contentEl.style.position = "relative";
    this.listEl = this.contentEl.createDiv();
  }

  getViewType(): string {
    return OUTLINE_VIEW;
  }
  getDisplayText(): string {
    return this.file ? `Outline of ${this.file.basename}` : "Outline";
  }
  getState(): any {
    return { file: this.file?.path, followCursor: this.followCursor, showSearch: this.showSearch, searchQuery: this.searchQuery };
  }
  async setState(s: any): Promise<void> {
    if (typeof s?.followCursor === "boolean") this.followCursor = s.followCursor;
    if (typeof s?.showSearch === "boolean") this.showSearch = s.showSearch;
    if (typeof s?.searchQuery === "string") this.searchQuery = s.searchQuery;
    this.filter.setValue(this.searchQuery);
    this.render();
  }

  protected async onOpen(): Promise<void> {
    const follow = () => {
      const f = this.app.workspace.getActiveFile();
      if (f && f.extension !== "md") return;
      if (f !== this.file) {
        this.file = f;
        this.collapsed.clear();
        this.allCollapsed = false;
        this.render();
        this.leaf.updateHeader?.();
      }
    };
    this.registerEvent(this.app.workspace.on("file-open", follow));
    this.registerEvent(this.app.workspace.on("active-leaf-change", follow));
    this.registerEvent(this.app.metadataCache.on("changed", (f: TFile) => f === this.file && this.schedule()));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.schedule()));
    this.registerInterval(window.setInterval(() => this.trackCursor(), 400));
    follow();
    this.render();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.render(), 200);
  }

  private syncUi(): void {
    this.followBtn.toggleClass("is-active", this.followCursor);
    this.searchBtn.toggleClass("is-active", this.showSearch);
    this.filter.containerEl.toggle(this.showSearch);
    this.collapseBtn.setAttr("aria-label", this.allCollapsed ? "Expand all" : "Collapse all");
    setIcon(this.collapseBtn, this.allCollapsed ? "chevrons-up-down" : "chevrons-down-up");
  }

  private loadHeadings(): void {
    const meta = this.file ? this.app.metadataCache.getFileCache(this.file) : null;
    this.headings = (meta?.headings ?? []).map((h: any) => ({ heading: h.heading, level: h.level, line: h.position.start.line, start: h.position.start.offset, end: h.position.end.offset }));
  }

  render(): void {
    if (!this.listEl) return;
    this.syncUi();
    this.loadHeadings();
    this.listEl.empty();
    this.rows = [];
    this.listEl.createDiv({ attr: { style: "width: 1px; height: 0.1px; margin-bottom: 0px;" } });
    if (!this.file) {
      this.listEl.createDiv({ cls: "pane-empty", text: "No file is open." });
      return;
    }
    if (!this.headings.length) {
      this.listEl.createDiv({ cls: "pane-empty", text: "No headings found." });
      return;
    }
    const q = this.searchQuery.trim().toLowerCase();
    let nodes = buildOutline(this.headings);
    if (q) nodes = filterOutline(nodes, q);
    for (const n of nodes) this.listEl.appendChild(this.renderNode(n, 0));
    this.activeIndex = -1;
    this.trackCursor(true);
  }

  private renderNode(n: OutlineNode, depth: number): HTMLElement {
    const item = createDiv("tree-item");
    const self = item.createDiv({ cls: "tree-item-self is-clickable", attr: { draggable: "true" } });
    self.setAttr("style", `margin-inline-start: ${-17 * depth}px !important; padding-inline-start: ${24 + 17 * depth}px !important;`);
    this.rows[n.index] = self;
    if (n.children.length) {
      self.addClass("mod-collapsible");
      const icon = collapseIcon(self);
      icon.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.collapsed.has(n.index)) this.collapsed.delete(n.index);
        else this.collapsed.add(n.index);
        setCollapsed(item, this.collapsed.has(n.index));
      });
    }
    self.createDiv({ cls: "tree-item-inner", text: n.h.heading });
    self.addEventListener("click", (e) => this.jump(n.h, e));
    self.addEventListener("mouseover", (e) => {
      if (!this.file) return;
      this.app.workspace.trigger("hover-link", { event: e, source: "outline", hoverParent: this, targetEl: self, linktext: this.file.path + "#" + n.h.heading, sourcePath: this.file.path });
    });
    this.bindDrag(self, n);
    const kids = item.createDiv("tree-item-children");
    if (n.children.length) {
      kids.createDiv({ attr: { style: "width: 1px; height: 0.1px; margin-bottom: 0px;" } });
      for (const c of n.children) kids.appendChild(this.renderNode(c, depth + 1));
      setCollapsed(item, this.collapsed.has(n.index));
    } else kids.style.minHeight = "0px";
    return item;
  }

  private markdownLeaf(): any {
    let found: any = null;
    const active = this.app.workspace.getMostRecentLeaf?.();
    if (active?.view?.file === this.file && active.view.getViewType() === "markdown") return active;
    this.app.workspace.iterateRootLeaves((l: any) => {
      if (!found && l.view?.file === this.file && l.view.getViewType() === "markdown") found = l;
    });
    return found;
  }

  private async jump(h: HeadingInfo, e: MouseEvent): Promise<void> {
    if (!this.file) return;
    let leaf = this.markdownLeaf();
    if (!leaf || Keymap.isModEvent(e)) {
      leaf = this.app.workspace.getLeaf(Keymap.isModEvent(e));
      await leaf.openFile(this.file);
    }
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    leaf.view.setEphemeralState({ line: h.line });
  }

  /** Highlight the section the cursor (or the top of the reading view) is in. */
  private trackCursor(force = false): void {
    if (!this.headings.length || !this.containerEl.isShown()) return;
    const leaf = this.markdownLeaf();
    const v = leaf?.view;
    if (!v) return;
    let line = 0;
    try {
      if (v.getMode?.() === "preview") {
        const els = Array.from(v.previewMode.sizerEl.querySelectorAll("[data-line]")) as HTMLElement[];
        const top = v.previewMode.previewEl.getBoundingClientRect().top;
        const first = els.find((el) => el.getBoundingClientRect().bottom > top + 4);
        line = Number(first?.getAttribute("data-line") ?? 0);
      } else line = v.editor.getCursor().line;
    } catch {
      return;
    }
    let idx = -1;
    for (let i = 0; i < this.headings.length; i++) if (this.headings[i].line <= line) idx = i;
    if (idx < 0) idx = 0;
    if (idx === this.activeIndex && !force) return;
    this.rows[this.activeIndex]?.removeClass("is-active");
    this.activeIndex = idx;
    const row = this.rows[idx];
    row?.addClass("is-active");
    if (row && this.followCursor) row.scrollIntoView({ block: "nearest" });
  }

  private bindDrag(self: HTMLElement, n: OutlineNode): void {
    const clear = () => this.listEl.querySelectorAll(".is-drop-target-above, .is-drop-target-below").forEach((e) => e.removeClass("is-drop-target-above", "is-drop-target-below"));
    self.addEventListener("dragstart", (e) => {
      this.dragFrom = n.index;
      self.addClass("is-being-dragged");
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("text/plain", "#".repeat(n.h.level) + " " + n.h.heading);
    });
    self.addEventListener("dragend", () => {
      self.removeClass("is-being-dragged");
      this.dragFrom = -1;
      clear();
    });
    self.addEventListener("dragover", (e) => {
      if (this.dragFrom < 0 || this.dragFrom === n.index) return;
      e.preventDefault();
      const r = self.getBoundingClientRect();
      const above = e.clientY < r.top + r.height / 2;
      clear();
      self.addClass(above ? "is-drop-target-above" : "is-drop-target-below");
    });
    self.addEventListener("dragleave", () => self.removeClass("is-drop-target-above", "is-drop-target-below"));
    self.addEventListener("drop", (e) => {
      if (this.dragFrom < 0) return;
      e.preventDefault();
      const r = self.getBoundingClientRect();
      const where = e.clientY < r.top + r.height / 2 ? "before" : "after";
      const from = this.dragFrom;
      this.dragFrom = -1;
      clear();
      this.move(from, n.index, where);
    });
  }

  private async move(from: number, to: number, where: "before" | "after"): Promise<void> {
    if (!this.file) return;
    const leaf = this.markdownLeaf();
    const v = leaf?.view;
    if (v?.editor && v.getMode?.() !== "preview") {
      const text: string = v.editor.getValue();
      const next = moveSection(text, this.headings, from, to, where);
      if (next === null) return;
      // One undoable change: replace the span that differs.
      let a = 0;
      while (a < text.length && text[a] === next[a]) a++;
      let b = 0;
      while (b < text.length - a && text[text.length - 1 - b] === next[next.length - 1 - b]) b++;
      v.editor.replaceRange(next.slice(a, next.length - b), v.editor.offsetToPos(a), v.editor.offsetToPos(text.length - b));
    } else {
      await this.app.vault.process(this.file, (text: string) => moveSection(text, this.headings, from, to, where) ?? text);
    }
  }
}

function filterOutline(nodes: OutlineNode[], q: string): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (const n of nodes) {
    const kids = filterOutline(n.children, q);
    if (n.h.heading.toLowerCase().includes(q) || kids.length) out.push({ ...n, children: kids });
  }
  return out;
}
