// Bases core plugin: opens .base files (YAML: filters, formulas, properties, views) as live table
// or card views over the vault's files and their properties; also ```base code blocks in notes.
// Toolbar: views, result count, sort, group, filter, properties, search, new note.
import { TextFileView } from "../../workspace/view";
import { Menu } from "../../ui/menu";
import { Notice } from "../../ui/notice";
import { promptDialog } from "../../ui/modal";
import { setIcon } from "../../dom/icons";
import { getAllTags, stringifyYaml } from "../../../core/parse";
import { codeBlockProcessors } from "../../markdown/renderer";
import { parseBase, runView, columnLabel, fmt, type BaseFile, type BaseView, type FileLike, type QueryResult } from "./expr";
import type { CorePluginImpl } from "../manager";

export const BASES_VIEW = "bases";

export function fileLike(app: any, f: any): FileLike {
  const cache = app.metadataCache.getFileCache?.(f) ?? null;
  const tags = cache ? (getAllTags(cache) ?? []).map((t: string) => t.replace(/^#/, "")) : [];
  const links = Object.keys(app.metadataCache.resolvedLinks?.[f.path] ?? {});
  const parent = f.parent && !f.parent.isRoot?.() ? f.parent.path : "";
  return {
    name: f.name,
    basename: f.basename,
    path: f.path,
    extension: f.extension,
    parentPath: parent,
    size: f.stat?.size ?? 0,
    ctime: f.stat?.ctime ?? 0,
    mtime: f.stat?.mtime ?? 0,
    tags,
    links,
    properties: { ...(cache?.frontmatter ?? {}) },
  };
}

function allFileLikes(app: any): FileLike[] {
  return app.vault.getFiles().map((f: any) => fileLike(app, f));
}

/** Render one cell value: file links clickable, lists as chips, booleans as check boxes. */
function renderValue(app: any, el: HTMLElement, id: string, v: any, row: FileLike, sourcePath: string): void {
  el.addClass("bases-rendered-value", "markdown-rendered");
  if (id === "file.name" || id === "file.basename") {
    const a = el.createSpan({ cls: "internal-link", text: row.extension === "md" ? row.basename : row.name });
    a.addEventListener("click", (e) => app.workspace.openLinkText(row.path, sourcePath, (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey));
    return;
  }
  if (typeof v === "boolean") {
    const cb = el.createEl("input", { type: "checkbox" });
    cb.checked = v;
    cb.disabled = true;
    return;
  }
  const items = Array.isArray(v) ? v : [v];
  items.forEach((x, i) => {
    const s = fmt(x);
    if (!s) return;
    const link = /^\[\[([^\]|]+)(\|([^\]]+))?\]\]$/.exec(s);
    if (link) {
      const a = el.createSpan({ cls: "internal-link", text: link[3] ?? link[1] });
      a.addEventListener("click", () => app.workspace.openLinkText(link[1], sourcePath));
    } else if (/^https?:\/\//.test(s)) {
      const a = el.createEl("a", { cls: "external-link", text: s, href: s });
      a.addEventListener("click", (e) => {
        e.preventDefault();
        app.openExternal(s);
      });
    } else if (Array.isArray(v)) el.createSpan({ cls: "value-list-element", text: s });
    else el.appendText(s);
    if (Array.isArray(v) && i < items.length - 1 && !el.lastElementChild?.hasClass("value-list-element")) el.appendText(", ");
  });
}

export function renderTable(app: any, el: HTMLElement, base: BaseFile, view: BaseView, res: QueryResult, sourcePath: string, onSort?: (id: string) => void): void {
  const wrap = el.createDiv("bases-view bases-table-view");
  const thead = wrap.createDiv("bases-thead");
  const htr = thead.createDiv("bases-tr");
  for (const c of res.columns) {
    const td = htr.createDiv({ cls: "bases-td" + (c === "file.name" ? " mod-implicit" : "") });
    const h = td.createDiv("bases-table-header");
    const lab = h.createDiv("bases-table-header-label");
    setIcon(lab.createDiv("bases-table-header-icon"), c.startsWith("formula.") ? "function-square" : c.startsWith("file.") ? "info" : "text");
    lab.createDiv({ cls: "bases-table-header-name", text: columnLabel(base, c) });
    const s = (view.sort ?? []).find((x) => x?.property === c);
    const sortEl = h.createDiv("bases-table-header-sort");
    if (s) setIcon(sortEl, String(s.direction ?? "ASC").toUpperCase() === "DESC" ? "arrow-down" : "arrow-up");
    if (onSort) h.addEventListener("click", () => onSort(c));
  }
  const container = wrap.createDiv("bases-table-container");
  const table = container.createDiv("bases-table");
  const body = (rows: QueryResult["rows"], parent: HTMLElement) => {
    const tb = parent.createDiv("bases-tbody");
    for (const r of rows) {
      const tr = tb.createDiv("bases-tr");
      for (const c of res.columns) renderValue(app, tr.createDiv("bases-td").createDiv("bases-table-cell"), c, r.values[c], r.file, sourcePath);
    }
  };
  if (res.groups) {
    for (const g of res.groups) {
      const gh = table.createDiv("bases-group-heading");
      gh.createSpan({ cls: "bases-group-heading-property", text: columnLabel(base, view.groupBy!.property) + " " });
      gh.createSpan({ cls: "bases-group-heading-value", text: g.key || "(empty)" });
      gh.createSpan({ cls: "bases-group-count", text: ` ${g.rows.length}` });
      body(g.rows, table);
    }
  } else body(res.rows, table);
}

export function renderCards(app: any, el: HTMLElement, base: BaseFile, view: BaseView, res: QueryResult, sourcePath: string): void {
  const wrap = el.createDiv("bases-view bases-cards-container");
  const imgProp = view.image ? String(view.image) : null;
  const group = (rows: QueryResult["rows"], parent: HTMLElement) => {
    const grid = parent.createDiv("bases-cards-group");
    for (const r of rows) {
      const card = grid.createDiv("bases-cards-item");
      const cover = card.createDiv("bases-cards-cover");
      const iv = imgProp ? r.values[imgProp] ?? null : null;
      const src = iv ? imageSrc(app, fmt(Array.isArray(iv) ? iv[0] : iv), sourcePath) : null;
      if (src) cover.createEl("img", { attr: { src, loading: "lazy", alt: "" } });
      else cover.addClass("mod-empty");
      const props = card.createDiv("bases-cards-properties");
      for (const c of res.columns) {
        if (c === imgProp) continue;
        const line = props.createDiv("bases-cards-property" + (c === "file.name" ? " mod-title" : ""));
        if (c !== "file.name") line.createDiv({ cls: "bases-cards-label", text: columnLabel(base, c) });
        renderValue(app, line.createDiv("bases-cards-line"), c, r.values[c], r.file, sourcePath);
      }
      card.addEventListener("dblclick", () => app.workspace.openLinkText(r.file.path, sourcePath));
    }
  };
  if (res.groups) for (const g of res.groups) {
    wrap.createDiv({ cls: "bases-group-heading", text: `${columnLabel(base, view.groupBy!.property)}: ${g.key || "(empty)"}` });
    group(g.rows, wrap);
  }
  else group(res.rows, wrap);
}

function imageSrc(app: any, v: string, sourcePath: string): string | null {
  const m = /^!?\[\[([^\]|#]+)/.exec(v);
  const target = m ? m[1] : v;
  if (/^https?:\/\//.test(target)) return target; // the note's own image link, like a Markdown image
  const f = app.metadataCache.getFirstLinkpathDest?.(target, sourcePath) ?? app.vault.getFileByPath(target);
  return f ? app.vault.getResourcePath(f) : null;
}

export class BasesView extends TextFileView {
  base: BaseFile | null = null;
  viewIndex = 0;
  error = "";
  search = "";
  private timer: any = null;
  private bodyEl!: HTMLElement;
  private countEl!: HTMLElement;
  private viewNameEl!: HTMLElement;
  private searchRow!: HTMLElement;
  private errorEl!: HTMLElement;

  getViewType(): string {
    return BASES_VIEW;
  }
  getIcon(): string {
    return "layout-list";
  }
  getDisplayText(): string {
    return this.file?.basename ?? "Base";
  }
  canAcceptExtension(ext: string): boolean {
    return ext === "base";
  }
  async onOpen(): Promise<void> {
    this.contentEl.addClass("bases-view-content");
    const refresh = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.renderBody(), 250);
    };
    this.registerEvent(this.app.metadataCache.on("resolved", refresh));
    this.registerEvent(this.app.metadataCache.on("changed", refresh));
    this.registerEvent(this.app.vault.on("create", refresh));
    this.registerEvent(this.app.vault.on("delete", refresh));
    this.registerEvent(this.app.vault.on("rename", refresh));
  }
  getViewData(): string {
    return this.data;
  }
  setViewData(data: string): void {
    this.data = data;
    try {
      this.base = parseBase(data);
      this.error = "";
    } catch (e: any) {
      this.base = null;
      this.error = e?.message ?? String(e);
    }
    if (this.base && this.viewIndex >= this.base.views.length) this.viewIndex = 0;
    this.render();
  }
  clear(): void {
    this.contentEl.empty();
  }
  getState(): any {
    return { ...super.getState(), viewName: this.base?.views[this.viewIndex]?.name };
  }
  async setState(state: any, result: any): Promise<void> {
    await super.setState(state, result);
    if (state?.viewName && this.base) {
      const i = this.base.views.findIndex((v) => v.name === state.viewName);
      if (i >= 0) {
        this.viewIndex = i;
        this.render();
      }
    }
  }

  /** Write the base back to the file (after a toolbar change). */
  private persist(): void {
    if (!this.base) return;
    const { extra, filters, formulas, properties, views } = this.base;
    const out: any = { ...extra };
    if (filters !== undefined) out.filters = filters;
    if (Object.keys(formulas).length) out.formulas = formulas;
    if (Object.keys(properties).length) out.properties = properties;
    out.views = views;
    this.data = stringifyYaml(out);
    this.requestSave();
    this.renderBody();
  }

  private get view(): BaseView | null {
    return this.base?.views[this.viewIndex] ?? null;
  }

  private toolbarButton(parent: HTMLElement, cls: string, icon: string, label: string, onClick: (e: MouseEvent) => void, aux = false): HTMLElement {
    const item = parent.createDiv(`bases-toolbar-item ${cls}`);
    const b = item.createDiv("text-icon-button tappable");
    setIcon(b.createSpan("text-button-icon"), icon);
    const lab = b.createSpan({ cls: "text-button-label", text: label });
    if (aux) setIcon(b.createSpan("text-button-icon mod-aux"), "chevrons-up-down");
    b.addEventListener("click", onClick);
    return lab;
  }

  render(): void {
    const c = this.contentEl;
    c.empty();
    const header = c.createDiv("bases-header");
    const tb = header.createDiv("bases-toolbar");
    this.viewNameEl = this.toolbarButton(tb, "bases-toolbar-views-menu", this.view?.type === "cards" ? "layout-grid" : "table", this.view?.name ?? "View", (e) => this.viewsMenu(e), true);
    this.countEl = this.toolbarButton(tb, "bases-toolbar-results-menu bases-toolbar-result-count", "list", "", () => undefined);
    tb.createDiv("bases-toolbar-spacer");
    this.toolbarButton(tb, "bases-toolbar-sort-menu", "arrow-up-down", "Sort", (e) => this.sortMenu(e));
    this.toolbarButton(tb, "bases-toolbar-group-menu", "rows-3", "Group", (e) => this.groupMenu(e));
    this.toolbarButton(tb, "bases-toolbar-filter-menu", "list-filter", "Filter", () => this.editFilter());
    this.toolbarButton(tb, "bases-toolbar-properties-menu", "list", "Properties", (e) => this.propertiesMenu(e));
    this.toolbarButton(tb, "bases-toolbar-search", "search", "Search", () => {
      this.searchRow.toggle(!this.searchRow.isShown());
      (this.searchRow.querySelector("input") as HTMLInputElement | null)?.focus();
    });
    this.toolbarButton(tb, "bases-toolbar-new-item-menu", "plus", "New", () => this.newItem());
    this.searchRow = c.createDiv("bases-search-row");
    const sc = this.searchRow.createDiv("search-input-container document-search-input");
    const input = sc.createEl("input", { type: "search", attr: { placeholder: "Search..." } });
    input.value = this.search;
    input.addEventListener("input", () => {
      this.search = input.value;
      this.renderBody();
    });
    this.searchRow.toggle(!!this.search);
    this.errorEl = c.createDiv("bases-error");
    this.bodyEl = c.createDiv("bases-body");
    this.renderBody();
  }

  renderBody(): void {
    if (!this.bodyEl) return;
    this.bodyEl.empty();
    this.errorEl.empty();
    if (this.error || !this.base || !this.view) {
      this.errorEl.setText(`This base couldn't be read: ${this.error}`);
      return;
    }
    const files = allFileLikes(this.app);
    const thisFile = this.file ? fileLike(this.app, this.file) : null;
    const res = runView(this.base, this.view, files, thisFile);
    if (this.search.trim()) {
      const q = this.search.toLowerCase();
      const keep = (r: QueryResult["rows"][number]) => res.columns.some((c) => fmt(c === "file.name" ? r.file.basename : r.values[c]).toLowerCase().includes(q));
      res.rows = res.rows.filter(keep);
      if (res.groups) res.groups = res.groups.map((g) => ({ ...g, rows: g.rows.filter(keep) })).filter((g) => g.rows.length);
    }
    this.countEl.setText(`${res.rows.length} ${res.rows.length === 1 ? "result" : "results"}`);
    if (res.errors.length) this.errorEl.setText(res.errors.slice(0, 3).join(" "));
    const src = this.file?.path ?? "";
    if (this.view.type === "cards") renderCards(this.app, this.bodyEl, this.base, this.view, res, src);
    else {
      if (this.view.type !== "table") this.errorEl.setText(`The “${this.view.type}” view type isn't supported yet, so it's shown as a table.`);
      renderTable(this.app, this.bodyEl, this.base, this.view, res, src, (id) => this.toggleSort(id));
    }
  }

  private toggleSort(id: string): void {
    const v = this.view!;
    const cur = (v.sort ?? []).find((s) => s.property === id);
    if (!cur) v.sort = [{ property: id, direction: "ASC" }];
    else if (String(cur.direction ?? "ASC").toUpperCase() === "ASC") v.sort = [{ property: id, direction: "DESC" }];
    else v.sort = [];
    if (!v.sort.length) delete v.sort;
    this.persist();
    this.render();
  }

  private knownProperties(): string[] {
    const set = new Set<string>(["file.name", "file.path", "file.folder", "file.ext", "file.size", "file.ctime", "file.mtime", "file.tags", "file.links"]);
    const types = this.app.metadataCache.getAllPropertyInfos?.() ?? {};
    for (const k of Object.keys(types)) set.add("note." + k);
    for (const f of this.app.vault.getMarkdownFiles().slice(0, 3000)) for (const k of Object.keys(this.app.metadataCache.getFileCache(f)?.frontmatter ?? {})) set.add("note." + k);
    for (const k of Object.keys(this.base?.formulas ?? {})) set.add("formula." + k);
    return [...set];
  }

  private viewsMenu(e: MouseEvent): void {
    const m = new Menu();
    this.base?.views.forEach((v, i) =>
      m.addItem((it) =>
        it
          .setTitle(v.name)
          .setIcon(v.type === "cards" ? "layout-grid" : "table")
          .setChecked(i === this.viewIndex)
          .onClick(() => {
            this.viewIndex = i;
            this.render();
          }),
      ),
    );
    m.addSeparator();
    for (const type of ["table", "cards"])
      m.addItem((it) =>
        it.setTitle(`Add ${type} view`).setIcon("plus").onClick(() => {
          const n = this.base!.views.length + 1;
          this.base!.views.push({ type, name: `${type === "table" ? "Table" : "Cards"} ${n}`, order: this.view?.order ? [...this.view.order] : undefined });
          this.viewIndex = this.base!.views.length - 1;
          this.persist();
          this.render();
        }),
      );
    if (this.view)
      m.addItem((it) =>
        it.setTitle(this.view!.type === "cards" ? "Show as table" : "Show as cards").setIcon("repeat").onClick(() => {
          this.view!.type = this.view!.type === "cards" ? "table" : "cards";
          this.persist();
          this.render();
        }),
      );
    if (this.base && this.base.views.length > 1)
      m.addItem((it) =>
        it
          .setTitle("Delete this view")
          .setIcon("trash-2")
          .setWarning(true)
          .onClick(() => {
            this.base!.views.splice(this.viewIndex, 1);
            this.viewIndex = 0;
            this.persist();
            this.render();
          }),
      );
    m.showAtMouseEvent(e);
  }
  private sortMenu(e: MouseEvent): void {
    const m = new Menu();
    const v = this.view!;
    for (const s of v.sort ?? []) m.addItem((it) => it.setTitle(`${columnLabel(this.base!, s.property)} (${String(s.direction ?? "ASC").toUpperCase() === "DESC" ? "Z to A" : "A to Z"})`).setIcon("check").setIsLabel(true));
    for (const p of this.knownProperties())
      m.addItem((it) =>
        it.setTitle(`Sort by ${columnLabel(this.base!, p)}`).onClick(() => {
          v.sort = [{ property: p, direction: "ASC" }];
          this.persist();
          this.render();
        }),
      );
    if (v.sort?.length)
      m.addItem((it) =>
        it.setTitle("Clear sort").setIcon("x").onClick(() => {
          delete v.sort;
          this.persist();
          this.render();
        }),
      );
    m.showAtMouseEvent(e);
  }
  private groupMenu(e: MouseEvent): void {
    const m = new Menu();
    const v = this.view!;
    m.addItem((it) =>
      it
        .setTitle("No grouping")
        .setChecked(!v.groupBy)
        .onClick(() => {
          delete v.groupBy;
          this.persist();
          this.render();
        }),
    );
    for (const p of this.knownProperties())
      m.addItem((it) =>
        it
          .setTitle(columnLabel(this.base!, p))
          .setChecked(v.groupBy?.property === p)
          .onClick(() => {
            v.groupBy = { property: p, direction: "ASC" };
            this.persist();
            this.render();
          }),
      );
    m.showAtMouseEvent(e);
  }
  private propertiesMenu(e: MouseEvent): void {
    const m = new Menu();
    const v = this.view!;
    const order = v.order?.length ? v.order : ["file.name"];
    for (const p of this.knownProperties())
      m.addItem((it) =>
        it
          .setTitle(columnLabel(this.base!, p))
          .setChecked(order.includes(p))
          .onClick(() => {
            v.order = order.includes(p) ? order.filter((x) => x !== p) : [...order, p];
            this.persist();
            this.render();
          }),
      );
    m.showAtMouseEvent(e);
  }
  private async editFilter(): Promise<void> {
    const v = this.view!;
    const cur = typeof v.filters === "string" ? v.filters : v.filters ? JSON.stringify(v.filters) : "";
    const text = await promptDialog(this.app, {
      title: "Filter this view (e.g. file.hasTag(\"book\") && status != \"done\"; empty shows everything)",
      value: cur,
      placeholder: 'file.inFolder("Projects")',
      cta: "Apply",
    });
    if (text === null || text === undefined) return;
    if (!String(text).trim()) delete v.filters;
    else {
      try {
        v.filters = String(text).trim().startsWith("{") ? JSON.parse(text) : String(text).trim();
      } catch {
        new Notice("That filter couldn't be read.");
        return;
      }
    }
    this.persist();
    this.render();
  }
  private async newItem(): Promise<void> {
    const parent = this.app.fileManager.getNewFileParent(this.file?.path ?? "");
    const f = await this.app.fileManager.createNewMarkdownFile(parent, "Untitled");
    await this.app.workspace.getLeaf("tab").openFile(f);
  }
}

export const basesPlugin: CorePluginImpl = {
  id: "bases",
  onEnable(p) {
    const app = p.app;
    p.registerView(BASES_VIEW, (leaf: any) => new BasesView(leaf));
    p.registerExtensions(["base"], BASES_VIEW);
    const create = async (embed: boolean) => {
      const active = app.workspace.getActiveFile();
      const parent = app.fileManager.getNewFileParent(active?.path ?? "");
      const path = app.vault.getAvailablePath(parent.isRoot() ? "Untitled" : parent.path + "/Untitled", "base");
      const f = await app.vault.create(path, "");
      if (embed && app.workspace.activeEditor?.editor) app.workspace.activeEditor.editor.replaceSelection(`![[${f.name}]]`);
      else await app.workspace.getLeaf(false).openFile(f);
    };
    p.addCommand({ id: "bases:new-file", name: "Bases: Create new base", icon: "layout-list", callback: () => create(false) });
    p.addCommand({ id: "bases:insert", name: "Bases: Insert new base", icon: "layout-list", editorCallback: () => create(true) });
    const activeBase = (): BasesView | null => app.workspace.getActiveViewOfType?.(BasesView) ?? null;
    p.addCommand({
      id: "bases:change-view",
      name: "Bases: Switch view...",
      checkCallback: (c: boolean) => {
        const v = activeBase();
        if (!v) return false;
        if (!c) (v as any).viewsMenu(new MouseEvent("click", { clientX: 200, clientY: 120 }));
        return true;
      },
    });
    p.addCommand({
      id: "bases:copy-table",
      name: "Bases: Copy table to clipboard",
      checkCallback: (c: boolean) => {
        const v = activeBase();
        if (!v) return false;
        if (!c) {
          const rows = Array.from(v.contentEl.querySelectorAll(".bases-tr")).map((tr) => Array.from(tr.querySelectorAll(".bases-td")).map((td) => (td.textContent ?? "").trim()).join("\t"));
          navigator.clipboard.writeText(rows.join("\n"));
          new Notice("Table copied.");
        }
        return true;
      },
    });
    p.addCommand({ id: "bases:add-item", name: "Bases: Add item", checkCallback: (c: boolean) => !!activeBase() && (c || (activeBase() as any).newItem(), true) });
    p.addCommand({ id: "bases:add-view", name: "Bases: Add view", checkCallback: (c: boolean) => !!activeBase() && (c || (activeBase() as any).viewsMenu(new MouseEvent("click", { clientX: 200, clientY: 120 })), true) });
    p.addRibbonIcon("layout-list", "Create new base", () => create(false));
    // ```base code blocks render a read-only view.
    codeBlockProcessors.base = (source: string, el: HTMLElement, ctx: any) => {
      try {
        const base = parseBase(source);
        const view = base.views[0];
        const thisFile = ctx?.sourcePath ? app.vault.getFileByPath(ctx.sourcePath) : null;
        const res = runView(base, view, allFileLikes(app), thisFile ? fileLike(app, thisFile) : null);
        el.addClass("bases-embed");
        if (view.type === "cards") renderCards(app, el, base, view, res, ctx?.sourcePath ?? "");
        else renderTable(app, el, base, view, res, ctx?.sourcePath ?? "");
      } catch (e: any) {
        el.createDiv({ cls: "bases-error", text: `This base couldn't be read: ${e?.message ?? e}` });
      }
    };
    p.register(() => delete codeBlockProcessors.base);
  },
  onDisable(p) {
    p.app.workspace.detachLeavesOfType?.(BASES_VIEW);
  },
};
