// Properties views: "all-properties" (every property key in the vault with its type icon and the
// number of notes using it; sort, filter, rename across the vault, change type) and
// "file-properties" (the active note's properties, editable, in the sidebar).
import { ItemView } from "../../workspace/view";
import type { WorkspaceLeaf } from "../../workspace/leaf";
import { TFile } from "../../vault/files";
import { setIcon } from "../../dom/icons";
import { Menu } from "../../ui/menu";
import { Notice } from "../../ui/notice";
import { PropertiesEditor, type PropertyType } from "../../editor/properties";
import { navButton, searchBox, type SearchBox } from "./tree";

export const ALL_PROPERTIES_VIEW = "all-properties";
export const FILE_PROPERTIES_VIEW = "file-properties";

const TYPES: [PropertyType, string, string][] = [
  ["text", "Text", "text"],
  ["multitext", "List", "list"],
  ["number", "Number", "binary"],
  ["checkbox", "Checkbox", "check-square"],
  ["date", "Date", "calendar"],
  ["datetime", "Date & time", "clock"],
];

export function propertyTypeIcon(t: string): string {
  if (t === "tags") return "tags";
  if (t === "aliases") return "forward";
  return TYPES.find((x) => x[0] === t)?.[2] ?? "text";
}

export type PropSort = "alphabetical" | "alphabeticalReverse" | "frequency" | "frequencyReverse";
const PROP_SORTS: [PropSort, string][] = [
  ["alphabetical", "Property name (A to Z)"],
  ["alphabeticalReverse", "Property name (Z to A)"],
  ["frequency", "Frequency (high to low)"],
  ["frequencyReverse", "Frequency (low to high)"],
];

export interface PropInfo {
  name: string;
  type: string;
  count: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Every property key: from notes' frontmatter plus keys registered in types.json (count 0). */
export function collectProperties(app: any): PropInfo[] {
  const map = new Map<string, PropInfo>();
  for (const f of app.vault.getMarkdownFiles() as TFile[]) {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    if (!fm) continue;
    for (const k of Object.keys(fm)) {
      if (k === "position") continue;
      const lk = k.toLowerCase();
      const e = map.get(lk);
      if (e) e.count++;
      else map.set(lk, { name: k, type: app.propertyTypes?.get(k, fm[k]) ?? "text", count: 1 });
    }
  }
  const builtins: Record<string, string> = { tags: "tags", aliases: "aliases", cssclasses: "multitext" };
  for (const [k, t] of Object.entries({ ...builtins, ...(app.propertyTypes?.types ?? {}) })) {
    if (!map.has(k.toLowerCase())) map.set(k.toLowerCase(), { name: k, type: builtins[k] ?? String(t), count: 0 });
  }
  return [...map.values()];
}

export function sortProperties(list: PropInfo[], order: PropSort): PropInfo[] {
  return list.sort((a, b) => {
    switch (order) {
      case "alphabetical":
        return collator.compare(a.name, b.name);
      case "alphabeticalReverse":
        return collator.compare(b.name, a.name);
      case "frequency":
        return b.count - a.count || collator.compare(a.name, b.name);
      case "frequencyReverse":
        return a.count - b.count || collator.compare(a.name, b.name);
    }
  });
}

export class AllPropertiesView extends ItemView {
  icon = "archive";
  sortOrder: PropSort = "frequency";
  showSearch = false;
  searchQuery = "";
  private listEl: HTMLElement;
  private searchBtn: HTMLElement;
  private filter: SearchBox;
  private timer: any = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    const nav = createDiv("nav-header");
    this.containerEl.prepend(nav);
    const btns = nav.createDiv("nav-buttons-container");
    navButton(btns, "sort-asc", "Change sort order", (e) => {
      const m = new Menu();
      for (const [k, label] of PROP_SORTS)
        m.addItem((i) =>
          i
            .setTitle(label)
            .setChecked(this.sortOrder === k)
            .onClick(() => {
              this.sortOrder = k;
              this.render();
              this.app.workspace.requestSaveLayout();
            }),
        );
      m.showAtMouseEvent(e);
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
    });
    this.contentEl.addClass("node-insert-event");
    this.contentEl.style.position = "relative";
    this.listEl = this.contentEl.createDiv();
  }

  getViewType(): string {
    return ALL_PROPERTIES_VIEW;
  }
  getDisplayText(): string {
    return "All properties";
  }
  getState(): any {
    return { sortOrder: this.sortOrder, showSearch: this.showSearch, searchQuery: this.searchQuery };
  }
  async setState(s: any): Promise<void> {
    if (PROP_SORTS.some(([k]) => k === s?.sortOrder)) this.sortOrder = s.sortOrder;
    if (typeof s?.showSearch === "boolean") this.showSearch = s.showSearch;
    if (typeof s?.searchQuery === "string") this.searchQuery = s.searchQuery;
    this.filter.setValue(this.searchQuery);
    this.render();
  }

  protected async onOpen(): Promise<void> {
    const sched = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.render(), 300);
    };
    this.registerEvent(this.app.metadataCache.on("resolved", sched));
    this.registerEvent(this.app.metadataCache.on("changed", sched));
    this.render();
  }

  private syncUi(): void {
    this.searchBtn.toggleClass("is-active", this.showSearch);
    this.filter.containerEl.toggle(this.showSearch);
  }

  render(): void {
    if (!this.listEl) return;
    this.syncUi();
    this.listEl.empty();
    this.listEl.createDiv({ attr: { style: "width: 1px; height: 0.1px; margin-bottom: 0px;" } });
    const q = this.searchQuery.trim().toLowerCase();
    const props = sortProperties(collectProperties(this.app), this.sortOrder).filter((p) => !q || p.name.toLowerCase().includes(q));
    if (!props.length) {
      this.listEl.createDiv({ cls: "pane-empty", text: "No properties found." });
      return;
    }
    for (const p of props) {
      const item = this.listEl.createDiv("tree-item");
      const self = item.createDiv("tree-item-self tappable is-clickable");
      self.setAttr("style", "margin-inline-start: 0px !important; padding-inline-start: 24px !important;");
      setIcon(self.createDiv("tree-item-icon"), propertyTypeIcon(p.type));
      self.createDiv("tree-item-inner").createDiv({ cls: "tree-item-inner-text", text: p.name });
      self.createDiv("tree-item-flair-outer").createSpan({ cls: "tree-item-flair", text: String(p.count) });
      self.addEventListener("click", () => (this.app as any).globalSearch?.openGlobalSearch(`[${p.name}]`));
      self.addEventListener("contextmenu", (e) => this.menu(e, p));
    }
  }

  private menu(e: MouseEvent, p: PropInfo): void {
    e.preventDefault();
    const m = new Menu();
    const builtin = ["tags", "aliases", "cssclasses"].includes(p.name.toLowerCase());
    if (!builtin)
      m.addItem((i) => {
        i.setTitle("Property type").setIcon(propertyTypeIcon(p.type)).setSection("type");
        const sub = i.setSubmenu();
        for (const [t, label, icon] of TYPES)
          sub.addItem((s) =>
            s
              .setTitle(label)
              .setIcon(icon)
              .setChecked(p.type === t)
              .onClick(() => {
                this.app.propertyTypes.set(p.name, t);
                this.render();
                this.app.workspace.iterateAllLeaves((l: any) => l.view?.syncPropertiesFromText?.());
              }),
          );
      });
    m.addItem((i) => i.setTitle("Rename...").setIcon("edit-3").setSection("action").onClick(() => this.rename(p)));
    m.addItem((i) => i.setTitle("Search").setIcon("search").setSection("action").onClick(() => (this.app as any).globalSearch?.openGlobalSearch(`[${p.name}]`)));
    m.showAtMouseEvent(e);
  }

  private async rename(p: PropInfo): Promise<void> {
    const v = await this.app.ui.prompt({ title: "Rename property", value: p.name, cta: "Rename" });
    const name = v?.trim();
    if (!name || name === p.name) return;
    let n = 0;
    for (const f of this.app.vault.getMarkdownFiles() as TFile[]) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (!fm || !Object.keys(fm).some((k) => k.toLowerCase() === p.name.toLowerCase())) continue;
      await this.app.fileManager.processFrontMatter(f, (front: any) => {
        const key = Object.keys(front).find((k) => k.toLowerCase() === p.name.toLowerCase());
        if (!key) return;
        const entries = Object.entries(front);
        for (const k of Object.keys(front)) delete front[k];
        for (const [k, val] of entries) {
          if (k === key) {
            if (front[name] === undefined) front[name] = val;
          } else front[k] = val;
        }
      });
      n++;
    }
    const t = this.app.propertyTypes?.types?.[p.name];
    if (t) this.app.propertyTypes.set(name, t);
    new Notice(`Renamed "${p.name}" to "${name}" in ${n} ${n === 1 ? "note" : "notes"}.`);
  }
}

export class FilePropertiesView extends ItemView {
  icon = "info";
  file: TFile | null = null;
  private editor: PropertiesEditor;
  private emptyEl: HTMLElement;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.editor = new PropertiesEditor(this.app, (fm) => this.write(fm));
    this.contentEl.appendChild(this.editor.el);
    this.emptyEl = this.contentEl.createDiv({ cls: "pane-empty", text: "No properties found." });
  }

  getViewType(): string {
    return FILE_PROPERTIES_VIEW;
  }
  getDisplayText(): string {
    return "File properties";
  }
  getState(): any {
    return this.file ? { file: this.file.path } : {};
  }

  protected async onOpen(): Promise<void> {
    const follow = () => {
      const f = this.app.workspace.getActiveFile();
      if (f !== this.file) {
        this.file = f;
        this.refresh();
      }
    };
    this.registerEvent(this.app.workspace.on("file-open", follow));
    this.registerEvent(this.app.workspace.on("active-leaf-change", follow));
    this.registerEvent(this.app.metadataCache.on("changed", (f: TFile) => f === this.file && this.refresh()));
    follow();
    this.refresh();
  }

  private refresh(): void {
    const f = this.file;
    const fm = f && f.extension === "md" ? this.app.metadataCache.getFileCache(f)?.frontmatter : null;
    const clean = fm ? Object.fromEntries(Object.entries(fm).filter(([k]) => k !== "position")) : null;
    const isMd = !!f && f.extension === "md";
    this.editor.el.toggle(isMd);
    this.editor.setFrontmatter(clean);
    this.editor.el.setAttr("data-property-count", String(clean ? Object.keys(clean).length : 0));
    this.emptyEl.toggle(!isMd);
  }

  private async write(fm: Record<string, any>): Promise<void> {
    const f = this.file;
    if (!f) return;
    await this.app.fileManager.processFrontMatter(f, (front: any) => {
      for (const k of Object.keys(front)) delete front[k];
      Object.assign(front, fm);
    });
  }
}
