// Search pane ("search" view): query box with match-case, search settings (collapse results,
// more context, explain search terms), result count menu (copy results, bookmark search), sort
// order, results grouped per file with highlighted matches. Searches as you type (debounced).
import { ItemView } from "../../workspace/view";
import type { WorkspaceLeaf } from "../../workspace/leaf";
import { setIcon } from "../../dom/icons";
import { Menu } from "../../ui/menu";
import { Notice } from "../../ui/notice";
import { Setting } from "../../ui/setting";
import { explain, parseQuery, type ExplainLine } from "./search-query";
import { getSearchIndex } from "./search-index";
import { ResultList } from "./results";
import { countResults, runSearch, SORT_OPTIONS, type SearchRun, type SortOrder } from "./search-engine";

export const SEARCH_VIEW = "search";

export class SearchView extends ItemView {
  icon = "search";
  private query = "";
  matchingCase = false;
  explainSearch = false;
  collapseAll = false;
  extraContext = false;
  sortOrder: SortOrder = "alphabetical";
  private inputEl: HTMLInputElement;
  private clearEl: HTMLElement;
  private caseEl: HTMLElement;
  private settingsBtn: HTMLElement;
  private infoEl: HTMLElement;
  private paramsEl: HTMLElement;
  private countEl: HTMLElement;
  private sortEl: HTMLSelectElement;
  private results: ResultList;
  private run: SearchRun | null = null;
  private timer: any = null;
  private toggles: Record<string, (v: boolean) => void> = {};
  lastMs = 0;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.headerEl.detach();
    this.contentEl.detach();
    const c = this.containerEl;
    const row = c.createDiv("search-row");
    const box = row.createDiv("search-input-container global-search-input-container");
    this.inputEl = box.createEl("input", { attr: { enterkeyhint: "search", type: "search", spellcheck: "false", placeholder: "Search..." } }) as HTMLInputElement;
    this.clearEl = box.createDiv({ cls: "search-input-clear-button", attr: { "aria-label": "Clear search" } });
    this.caseEl = box.createDiv({ cls: "input-right-decorator clickable-icon", attr: { "aria-label": "Match case" } });
    setIcon(this.caseEl, "uppercase-lowercase-a");
    this.settingsBtn = row.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Search settings" } });
    setIcon(this.settingsBtn, "sliders-horizontal");

    this.infoEl = c.createDiv("search-info-container");
    this.infoEl.hide();
    this.paramsEl = c.createDiv("search-params");
    this.paramsEl.hide();
    const toggle = (name: string, get: () => boolean, set: (v: boolean) => void) => {
      const s = new Setting(this.paramsEl).setName(name).setClass("mod-toggle");
      s.settingEl.setAttr("tabindex", "-1");
      s.addToggle((t: any) => {
        t.setValue(get()).onChange((v: boolean) => set(v));
        this.toggles[name] = (v) => t.setValue(v);
      });
    };
    toggle("Collapse results", () => this.collapseAll, (v) => this.setCollapseAll(v));
    toggle("Show more context", () => this.extraContext, (v) => this.setExtraContext(v));
    toggle("Explain search terms", () => this.explainSearch, (v) => this.setExplainSearch(v));

    const info = c.createDiv("search-results-info");
    this.countEl = info.createDiv("clickable-icon search-results-result-count");
    this.countEl.createSpan({ text: "0 results" });
    setIcon(this.countEl.createDiv("more-options-icon"), "more-horizontal");
    this.countEl.addEventListener("click", (e) => this.countMenu(e));
    this.sortEl = info.createEl("select", { cls: "dropdown" }) as HTMLSelectElement;
    for (const [k, label] of SORT_OPTIONS) this.sortEl.createEl("option", { value: k, text: label });
    this.sortEl.addEventListener("change", () => this.setSortOrder(this.sortEl.value as SortOrder));

    this.results = new ResultList(
      c,
      {
        app: this.app,
        hoverSource: "search",
        hoverParent: this,
        collapseAll: () => this.collapseAll,
        extraContext: () => this.extraContext,
        emptyText: "No matches found.",
      },
      "mod-global-search",
    );

    this.inputEl.addEventListener("input", () => {
      this.query = this.inputEl.value;
      this.syncClear();
      this.scheduleSearch(250);
    });
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.startSearch();
      }
    });
    this.clearEl.addEventListener("click", () => this.setQuery(""));
    this.caseEl.addEventListener("click", () => this.setMatchingCase(!this.matchingCase));
    this.settingsBtn.addEventListener("click", () => {
      const show = !this.paramsEl.isShown();
      this.paramsEl.toggle(show);
      this.settingsBtn.toggleClass("is-active", show);
    });
    this.syncClear();
  }

  getViewType(): string {
    return SEARCH_VIEW;
  }
  getDisplayText(): string {
    return "Search";
  }

  getState(): any {
    return { query: this.query, matchingCase: this.matchingCase, explainSearch: this.explainSearch, collapseAll: this.collapseAll, extraContext: this.extraContext, sortOrder: this.sortOrder };
  }

  async setState(s: any): Promise<void> {
    if (!s) return;
    if (typeof s.matchingCase === "boolean") this.matchingCase = s.matchingCase;
    if (typeof s.explainSearch === "boolean") this.explainSearch = s.explainSearch;
    if (typeof s.collapseAll === "boolean") this.collapseAll = s.collapseAll;
    if (typeof s.extraContext === "boolean") this.extraContext = s.extraContext;
    if (typeof s.sortOrder === "string" && SORT_OPTIONS.some(([k]) => k === s.sortOrder)) this.sortOrder = s.sortOrder;
    this.syncControls();
    if (typeof s.query === "string" && s.query !== this.query) this.setQuery(s.query);
  }

  protected async onOpen(): Promise<void> {
    this.syncControls();
    const idx = getSearchIndex(this.app);
    const off = idx.onChange(() => this.query.trim() && this.startSearch(true));
    this.register(off);
    if (this.query) this.startSearch();
    else this.renderInfo();
  }

  protected async onClose(): Promise<void> {
    if (this.run) this.run.cancelled = true;
  }

  private syncClear(): void {
    this.clearEl.toggle(!!this.inputEl.value);
  }

  private syncControls(): void {
    this.caseEl.toggleClass("is-active", this.matchingCase);
    this.sortEl.value = this.sortOrder;
    this.toggles["Collapse results"]?.(this.collapseAll);
    this.toggles["Show more context"]?.(this.extraContext);
    this.toggles["Explain search terms"]?.(this.explainSearch);
  }

  // ----- public API (same names plugins use) -----
  getQuery(): string {
    return this.query;
  }

  setQuery(q: string): void {
    this.query = q;
    this.inputEl.value = q;
    this.syncClear();
    this.startSearch();
    this.app.workspace.requestSaveLayout();
  }

  setMatchingCase(v: boolean): void {
    this.matchingCase = v;
    this.syncControls();
    this.startSearch();
    this.app.workspace.requestSaveLayout();
  }

  setExplainSearch(v: boolean): void {
    this.explainSearch = v;
    this.syncControls();
    this.renderInfo();
    this.app.workspace.requestSaveLayout();
  }

  setCollapseAll(v: boolean): void {
    this.collapseAll = v;
    this.syncControls();
    this.results.resetCollapse();
    this.results.rerender();
    this.app.workspace.requestSaveLayout();
  }

  setExtraContext(v: boolean): void {
    this.extraContext = v;
    this.syncControls();
    this.results.rerender();
    this.app.workspace.requestSaveLayout();
  }

  setSortOrder(v: SortOrder): void {
    this.sortOrder = v;
    this.syncControls();
    this.startSearch(true);
    this.app.workspace.requestSaveLayout();
  }

  focusInput(): void {
    this.inputEl.focus();
    this.inputEl.select();
  }

  private scheduleSearch(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.startSearch(), ms);
  }

  stopSearch(): void {
    if (this.run) this.run.cancelled = true;
    this.run = null;
  }

  async startSearch(keepScroll = false): Promise<void> {
    clearTimeout(this.timer);
    this.stopSearch();
    const run: SearchRun = { cancelled: false };
    this.run = run;
    this.renderInfo();
    const q = this.query;
    if (!q.trim()) {
      this.results.setEntries([]);
      this.setCount(0);
      return;
    }
    this.containerEl.addClass("is-loading");
    const out = await runSearch(this.app, getSearchIndex(this.app), q, { matchCase: this.matchingCase, sort: this.sortOrder }, run);
    if (!out || run.cancelled) return;
    this.containerEl.removeClass("is-loading");
    this.lastMs = out.ms;
    const sc = this.results.containerEl.scrollTop;
    this.results.setEntries(out.entries);
    if (keepScroll) this.results.containerEl.scrollTop = sc;
    let n = 0;
    n = countResults(out.entries);
    this.setCount(n);
    this.run = null;
  }

  private setCount(n: number): void {
    this.countEl.querySelector("span")!.setText(`${n.toLocaleString()} ${n === 1 ? "result" : "results"}`);
  }

  private renderInfo(): void {
    this.infoEl.empty();
    const node = this.query.trim() ? parseQuery(this.query) : null;
    if (!this.explainSearch || !node) {
      this.infoEl.hide();
      return;
    }
    this.infoEl.show();
    const draw = (parent: HTMLElement, line: ExplainLine) => {
      parent.createDiv({ text: line.text + (line.children.length ? " " : "") });
      if (line.children.length) {
        const kids = parent.createDiv("search-info-children");
        for (const c of line.children) draw(kids, c);
      }
    };
    let root = explain(node);
    if (this.matchingCase) root = { text: "Case sensitive", children: [root] };
    draw(this.infoEl, root);
  }

  private countMenu(e: MouseEvent): void {
    const m = new Menu();
    m.addItem((i) => i.setTitle("Copy search results").setIcon("copy").onClick(() => this.onCopyResultsClick()));
    m.addItem((i) =>
      i
        .setTitle("Bookmark...")
        .setIcon("bookmark")
        .onClick(() => (this.app as any).bookmarks?.bookmarkSearchInteractive(this.query)),
    );
    m.showAtMouseEvent(e);
  }

  onCopyResultsClick(): void {
    navigator.clipboard.writeText(this.results.toText());
    new Notice("Search results copied to clipboard.");
  }
}
