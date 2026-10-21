// Tags view ("tag"): every tag in the vault with occurrence counts, as a nested tree
// (#parent/child) or a flat list, sorted by name or frequency. Clicking a tag searches for it.
import { ItemView } from "../../workspace/view";
import type { WorkspaceLeaf } from "../../workspace/leaf";
import { Menu } from "../../ui/menu";
import { setIcon } from "../../dom/icons";
import { getAllTags } from "../../../core/parse";
import { buildTagTree, sortTagTree, type TagNode, type TagSort } from "./tag-tree";
import { collapseIcon, navButton, searchBox, setCollapsed, type SearchBox } from "./tree";

export const TAG_VIEW = "tag";

const TAG_SORTS: [TagSort, string][] = [
  ["alphabetical", "Tag name (A to Z)"],
  ["alphabeticalReverse", "Tag name (Z to A)"],
  ["frequency", "Frequency (high to low)"],
  ["frequencyReverse", "Frequency (low to high)"],
];

export class TagView extends ItemView {
  icon = "tags";
  sortOrder: TagSort = "frequency";
  useHierarchy = true;
  showSearch = false;
  searchQuery = "";
  private collapsed = new Set<string>();
  private listEl: HTMLElement;
  private hierBtn: HTMLElement;
  private expandBtn: HTMLElement;
  private searchBtn: HTMLElement;
  private filter: SearchBox;
  private timer: any = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.headerEl.detach();
    this.contentEl.detach();
    const nav = this.containerEl.createDiv("nav-header");
    const btns = nav.createDiv("nav-buttons-container");
    navButton(btns, "sort-asc", "Change sort order", (e) => {
      const m = new Menu();
      for (const [k, label] of TAG_SORTS)
        m.addItem((i) =>
          i
            .setTitle(label)
            .setChecked(this.sortOrder === k)
            .onClick(() => {
              this.sortOrder = k;
              this.saveAndRender();
            }),
        );
      m.showAtMouseEvent(e);
    });
    this.hierBtn = navButton(btns, "folder-tree", "Show nested tags", () => {
      this.useHierarchy = !this.useHierarchy;
      this.saveAndRender();
    });
    this.expandBtn = navButton(btns, "chevrons-up-down", "Expand all", () => {
      if (this.collapsed.size) this.collapsed.clear();
      else this.collectParents(this.tree()).forEach((t) => this.collapsed.add(t));
      this.render();
    });
    this.searchBtn = navButton(btns, "search", "Show search filter", () => {
      this.showSearch = !this.showSearch;
      this.syncUi();
      if (this.showSearch) this.filter.inputEl.focus();
      this.app.workspace.requestSaveLayout();
    });
    this.filter = searchBox(nav, (v) => {
      this.searchQuery = v;
      this.render();
      this.app.workspace.requestSaveLayout();
    });
    this.listEl = this.containerEl.createDiv("tag-container node-insert-event").createDiv();
    this.listEl.parentElement!.style.position = "relative";
  }

  getViewType(): string {
    return TAG_VIEW;
  }
  getDisplayText(): string {
    return "Tags";
  }
  getState(): any {
    return { sortOrder: this.sortOrder, useHierarchy: this.useHierarchy, showSearch: this.showSearch, searchQuery: this.searchQuery };
  }
  async setState(s: any): Promise<void> {
    if (TAG_SORTS.some(([k]) => k === s?.sortOrder)) this.sortOrder = s.sortOrder;
    if (typeof s?.useHierarchy === "boolean") this.useHierarchy = s.useHierarchy;
    if (typeof s?.showSearch === "boolean") this.showSearch = s.showSearch;
    if (typeof s?.searchQuery === "string") this.searchQuery = s.searchQuery;
    this.filter.setValue(this.searchQuery);
    this.render();
  }

  protected async onOpen(): Promise<void> {
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.schedule()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.schedule()));
    this.render();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.render(), 300);
  }

  private saveAndRender(): void {
    this.render();
    this.app.workspace.requestSaveLayout();
  }

  private tree(): TagNode[] {
    const lists: string[][] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      const c = this.app.metadataCache.getFileCache(f);
      const t = c ? getAllTags(c) : null;
      if (t) lists.push(t);
    }
    return sortTagTree(buildTagTree(lists, this.useHierarchy), this.sortOrder);
  }

  private collectParents(nodes: TagNode[], out: string[] = []): string[] {
    for (const n of nodes)
      if (n.children.length) {
        out.push(n.tag.toLowerCase());
        this.collectParents(n.children, out);
      }
    return out;
  }

  private syncUi(): void {
    this.hierBtn.toggleClass("is-active", this.useHierarchy);
    this.searchBtn.toggleClass("is-active", this.showSearch);
    this.filter.containerEl.toggle(this.showSearch);
    const anyCollapsed = this.collapsed.size > 0;
    this.expandBtn.toggle(this.useHierarchy);
    this.expandBtn.setAttr("aria-label", anyCollapsed ? "Expand all" : "Collapse all");
    this.expandBtn.empty();
    setIcon(this.expandBtn, anyCollapsed ? "chevrons-up-down" : "chevrons-down-up");
  }

  render(): void {
    if (!this.listEl) return;
    this.syncUi();
    this.listEl.empty();
    this.listEl.createDiv({ attr: { style: "width: 1px; height: 0.1px; margin-bottom: 0px;" } });
    let nodes = this.tree();
    const q = this.searchQuery.trim().toLowerCase().replace(/^#/, "");
    if (q) nodes = filterTree(nodes, q);
    if (!nodes.length) {
      this.listEl.createDiv({ cls: "pane-empty", text: q ? "No tags match your search." : "No tags found." });
      return;
    }
    for (const n of nodes) this.listEl.appendChild(this.renderNode(n, 0, ""));
  }

  private renderNode(n: TagNode, depth: number, parentPrefix: string): HTMLElement {
    const item = createDiv("tree-item");
    const self = item.createDiv({ cls: "tree-item-self tag-pane-tag is-clickable" });
    self.setAttr("style", `margin-inline-start: ${-17 * depth}px !important; padding-inline-start: ${24 + 17 * depth}px !important;`);
    const hasKids = n.children.length > 0;
    if (hasKids) {
      self.addClass("mod-collapsible");
      const icon = collapseIcon(self);
      icon.addEventListener("click", (e) => {
        e.stopPropagation();
        const k = n.tag.toLowerCase();
        if (this.collapsed.has(k)) this.collapsed.delete(k);
        else this.collapsed.add(k);
        setCollapsed(item, this.collapsed.has(k));
        this.syncUi();
      });
    }
    const textWrap = self.createDiv("tree-item-inner").createDiv("tree-item-inner-text");
    const parentEl = textWrap.createSpan({ cls: "tag-pane-tag-parent", text: this.useHierarchy ? parentPrefix : "" });
    if (this.useHierarchy) parentEl.style.display = "none";
    textWrap.createSpan({ cls: "tree-item-inner-text", text: n.name });
    self.createDiv("tree-item-flair-outer").createSpan({ cls: "tag-pane-tag-count tree-item-flair", text: String(n.count) });
    self.addEventListener("click", (e) => this.openTag(n.tag, e));
    if (hasKids) {
      const kids = item.createDiv("tree-item-children");
      kids.createDiv({ attr: { style: "width: 1px; height: 0.1px; margin-bottom: 0px;" } });
      for (const c of n.children) kids.appendChild(this.renderNode(c, depth + 1, n.tag + "/"));
      setCollapsed(item, this.collapsed.has(n.tag.toLowerCase()));
    }
    return item;
  }

  private async openTag(tag: string, e: MouseEvent): Promise<void> {
    const gs = (this.app as any).globalSearch;
    const q = `tag:#${tag}`;
    if (!gs) return;
    const view = await gs.revealView();
    if (!view) return;
    const cur = view.getQuery();
    if ((e.shiftKey || e.ctrlKey || e.metaKey) && cur.trim()) view.setQuery(e.altKey ? `${cur} -${q}` : `${cur} ${q}`);
    else view.setQuery(q);
  }
}

function filterTree(nodes: TagNode[], q: string): TagNode[] {
  const out: TagNode[] = [];
  for (const n of nodes) {
    if (n.tag.toLowerCase().includes(q)) out.push(n);
    else {
      const kids = filterTree(n.children, q);
      if (kids.length) out.push({ ...n, children: kids });
    }
  }
  return out;
}
