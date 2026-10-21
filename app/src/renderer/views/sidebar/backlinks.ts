// Backlinks: linked mentions (notes and canvases that link here) and unlinked mentions (the
// note's name or aliases as plain text, with a "Link" button), with collapse results, more
// context, sort order and a filter. Used by the "backlink" view and by "backlinks in document".
import { Component } from "../../api/events";
import { ItemView } from "../../workspace/view";
import type { WorkspaceLeaf } from "../../workspace/leaf";
import { TFile } from "../../vault/files";
import { Menu } from "../../ui/menu";
import { Notice } from "../../ui/notice";
import { parseFrontMatterAliases } from "../../../core/parse";
import { getLinkpath } from "../../../core/links";
import { getSearchIndex, canvasFileRefs } from "./search-index";
import { linkedRanges, findUnlinkedMentions, mentionToLink } from "./mentions";
import { ResultList, type ResultEntry } from "./results";
import { SORT_OPTIONS, sortEntries, type SortOrder } from "./search-engine";
import { matchDoc, parseQuery, type Range } from "./search-query";
import { navButton, searchBox, sectionHeader, type SearchBox } from "./tree";

export const BACKLINK_VIEW = "backlink";

export interface BacklinkState {
  collapseAll: boolean;
  extraContext: boolean;
  sortOrder: SortOrder;
  showSearch: boolean;
  searchQuery: string;
  backlinkCollapsed: boolean;
  unlinkedCollapsed: boolean;
}

/** Linked + unlinked mentions of one file, rendered into `parent`. */
export class BacklinkComponent extends Component {
  file: TFile | null = null;
  state: BacklinkState = { collapseAll: false, extraContext: false, sortOrder: "alphabetical", showSearch: false, searchQuery: "", backlinkCollapsed: false, unlinkedCollapsed: true };
  navEl: HTMLElement;
  paneEl: HTMLElement;
  private btns: Record<string, HTMLElement> = {};
  private filter: SearchBox;
  private linked: ResultList;
  private unlinked: ResultList;
  private linkedHeader: { el: HTMLElement; flair: HTMLElement };
  private unlinkedHeader: { el: HTMLElement; flair: HTMLElement };
  private timer: any = null;
  private gen = 0;
  onStateChange: () => void = () => {};
  /** Count of linked mentions after the last update. */
  linkedCount = 0;

  constructor(private app: any, parent: HTMLElement, private hoverParent: any) {
    super();
    this.navEl = parent.createDiv("nav-header");
    const btns = this.navEl.createDiv("nav-buttons-container");
    this.btns.collapse = navButton(btns, "list", "Collapse results", () => this.set({ collapseAll: !this.state.collapseAll }, true));
    this.btns.context = navButton(btns, "move-vertical", "Show more context", () => this.set({ extraContext: !this.state.extraContext }, true));
    navButton(btns, "sort-asc", "Change sort order", (e) => this.sortMenu(e));
    this.btns.search = navButton(btns, "search", "Show search filter", () => {
      this.set({ showSearch: !this.state.showSearch });
      if (this.state.showSearch) this.filter.inputEl.focus();
    });
    this.filter = searchBox(this.navEl, (v) => {
      this.state.searchQuery = v;
      this.onStateChange();
      this.schedule(150);
    });
    this.paneEl = parent.createDiv("backlink-pane node-insert-event");
    this.linkedHeader = sectionHeader(this.paneEl, "Linked mentions", () => this.set({ backlinkCollapsed: !this.state.backlinkCollapsed }));
    const opts = (empty: string) => ({
      app,
      hoverSource: "backlink",
      hoverParent,
      collapseAll: () => this.state.collapseAll,
      extraContext: () => this.state.extraContext,
      emptyText: empty,
    });
    this.linked = new ResultList(this.paneEl, opts("No backlinks found."));
    this.unlinkedHeader = sectionHeader(this.paneEl, "Unlinked mentions", () => this.set({ unlinkedCollapsed: !this.state.unlinkedCollapsed }));
    this.unlinked = new ResultList(this.paneEl, opts("No unlinked mentions found."));
    this.applyUi();
  }

  onload(): void {
    const idx = getSearchIndex(this.app);
    this.register(idx.onChange(() => this.schedule(300)));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.schedule(300)));
  }

  set(p: Partial<BacklinkState>, rerender = false): void {
    const prevUnlinked = this.state.unlinkedCollapsed;
    Object.assign(this.state, p);
    this.applyUi();
    if (rerender) {
      if (p.collapseAll !== undefined) {
        this.linked.resetCollapse();
        this.unlinked.resetCollapse();
      }
      this.linked.rerender();
      this.unlinked.rerender();
    }
    if (p.sortOrder || (prevUnlinked && !this.state.unlinkedCollapsed)) this.schedule(0);
    this.onStateChange();
  }

  private applyUi(): void {
    const s = this.state;
    this.btns.collapse.toggleClass("is-active", s.collapseAll);
    this.btns.context.toggleClass("is-active", s.extraContext);
    this.btns.search.toggleClass("is-active", s.showSearch);
    this.filter.containerEl.toggle(s.showSearch);
    if (this.filter.getValue() !== s.searchQuery) this.filter.setValue(s.searchQuery);
    for (const [h, list, collapsed] of [
      [this.linkedHeader, this.linked, s.backlinkCollapsed],
      [this.unlinkedHeader, this.unlinked, s.unlinkedCollapsed],
    ] as const) {
      h.el.toggleClass("is-collapsed", collapsed);
      h.el.querySelector(".collapse-icon")?.toggleClass("is-collapsed", collapsed);
      h.el.setAttr("aria-label", collapsed ? "Click to expand" : "Click to collapse");
      list.containerEl.toggleClass("is-collapsed", collapsed);
    }
  }

  private sortMenu(e: MouseEvent): void {
    const m = new Menu();
    for (const [k, label] of SORT_OPTIONS) m.addItem((i) => i.setTitle(label).setChecked(this.state.sortOrder === k).onClick(() => this.set({ sortOrder: k })));
    m.showAtMouseEvent(e);
  }

  setFile(file: TFile | null): void {
    if (file === this.file) return;
    this.file = file;
    this.update();
  }

  schedule(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.update(), ms);
  }

  async update(): Promise<void> {
    clearTimeout(this.timer);
    const gen = ++this.gen;
    const file = this.file;
    if (!file) {
      this.linked.setEntries([]);
      this.unlinked.setEntries([]);
      this.linkedHeader.flair.setText("0");
      this.unlinkedHeader.flair.setText("0");
      this.linkedCount = 0;
      return;
    }
    const idx = getSearchIndex(this.app);
    await idx.ensureLoaded();
    if (gen !== this.gen) return;
    const linked = await computeLinked(this.app, file);
    if (gen !== this.gen) return;
    const filterNode = this.state.searchQuery.trim() ? parseQuery(this.state.searchQuery) : null;
    const keep = (e: ResultEntry) => {
      if (!filterNode) return true;
      const d = idx.get(e.file.path);
      return !!(d && matchDoc(filterNode, d));
    };
    const l = sortEntries(linked.filter(keep), this.state.sortOrder);
    this.linkedCount = linked.length;
    this.linked.setEntries(l);
    this.linkedHeader.flair.setText(String(l.filter((e) => e.file.extension === "md").length));
    const u = sortEntries(computeUnlinked(this.app, file, (path, range, mention) => this.linkMention(path, range, mention)).filter(keep), this.state.sortOrder);
    if (gen !== this.gen) return;
    this.unlinked.setEntries(u);
    this.unlinkedHeader.flair.setText(String(u.length));
  }

  private async linkMention(path: string, range: Range, mention: string): Promise<void> {
    const src = this.app.vault.getFileByPath(path);
    const target = this.file;
    if (!src || !target) return;
    const linktext = this.app.metadataCache.fileToLinktext(target, path, true);
    const replacement = mentionToLink(mention, linktext);
    let done = false;
    await this.app.vault.process(src, (text: string) => {
      if (text.slice(range[0], range[1]) !== mention) return text;
      done = true;
      return text.slice(0, range[0]) + replacement + text.slice(range[1]);
    });
    if (!done) new Notice("That text changed since the list was made. Try again.");
  }

  getState(): BacklinkState {
    return { ...this.state };
  }
}

export async function computeLinked(app: any, file: TFile): Promise<ResultEntry[]> {
  const idx = getSearchIndex(app);
  await idx.ensureLoaded();
  const out: ResultEntry[] = [];
  const bl = app.metadataCache.getBacklinksForFile(file);
  for (const src of bl.keys()) {
    if (src === file.path) continue;
    const sf = app.vault.getFileByPath(src);
    const d = idx.get(src);
    if (!sf || !d) continue;
    const resolve = (lp: string) => app.metadataCache.getFirstLinkpathDest(getLinkpath(lp), src)?.path ?? null;
    let ranges = linkedRanges(d.meta, file.path, resolve);
    if (!ranges.length) {
      // Frontmatter links: highlight the property line.
      for (const fl of (d.meta as any)?.frontmatterLinks ?? []) {
        if (resolve(fl.link) !== file.path) continue;
        const i = d.content.indexOf(fl.original ?? fl.link);
        if (i >= 0) ranges.push([i, i + (fl.original ?? fl.link).length]);
      }
      ranges = ranges.sort((a, b) => a[0] - b[0]);
    }
    out.push({ file: sf, text: d.content, ranges });
  }
  // Canvas files with a card for this file.
  // (canvas links are also merged into resolvedLinks, so skip canvases already listed above.)
  const listed = new Set(out.map((e) => e.file.path));
  for (const cf of app.vault.getFiles().filter((f: TFile) => f.extension === "canvas")) {
    if (listed.has(cf.path)) continue;
    try {
      const raw = await app.vault.cachedRead(cf);
      if (canvasFileRefs(raw).includes(file.path)) out.push({ file: cf, text: "", ranges: [] });
    } catch {
      /* unreadable */
    }
  }
  return out;
}

export function computeUnlinked(app: any, file: TFile, link: (path: string, r: Range, mention: string) => void): ResultEntry[] {
  const idx = getSearchIndex(app);
  const names = [file.basename, ...(parseFrontMatterAliases(app.metadataCache.getFileCache(file)?.frontmatter) ?? [])].filter((n) => n && n.trim().length > 0);
  const lowerNames = names.map((n) => n.toLowerCase());
  const out: ResultEntry[] = [];
  for (const d of idx.all()) {
    if (d.extension !== "md" || d.path === file.path) continue;
    if (!lowerNames.some((n) => d.lower.includes(n))) continue;
    const meta = d.meta ?? app.metadataCache.getCache(d.path);
    const ranges = findUnlinkedMentions(d.content, meta, names);
    if (!ranges.length) continue;
    const sf = app.vault.getFileByPath(d.path);
    if (!sf) continue;
    const text = d.content;
    out.push({ file: sf, text, ranges, onLink: (r) => link(d.path, r, text.slice(r[0], r[1])) });
  }
  return out;
}

export class BacklinkView extends ItemView {
  icon = "links-coming-in";
  backlink: BacklinkComponent;
  /** Set when the view shows one specific file ("Open backlinks for the current note"). */
  private fixedFile: string | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.backlink = new BacklinkComponent(this.app, this.contentEl, this);
    this.backlink.onStateChange = () => this.app.workspace.requestSaveLayout();
  }

  getViewType(): string {
    return BACKLINK_VIEW;
  }
  getDisplayText(): string {
    return this.fixedFile && this.backlink.file ? `Backlinks for ${this.backlink.file.basename}` : "Backlinks";
  }
  getIcon(): string {
    return "links-coming-in";
  }

  getState(): any {
    return { file: this.backlink.file?.path ?? this.fixedFile ?? undefined, ...this.backlink.getState() };
  }

  async setState(s: any): Promise<void> {
    if (!s) return;
    const p: Partial<BacklinkState> = {};
    for (const k of ["collapseAll", "extraContext", "showSearch", "backlinkCollapsed", "unlinkedCollapsed"] as const) if (typeof s[k] === "boolean") p[k] = s[k];
    if (typeof s.searchQuery === "string") p.searchQuery = s.searchQuery;
    if (typeof s.sortOrder === "string" && SORT_OPTIONS.some(([k]) => k === s.sortOrder)) p.sortOrder = s.sortOrder;
    this.backlink.set(p, true);
    if (s.fixed && typeof s.file === "string") this.fixedFile = s.file;
    if (this.fixedFile) this.backlink.setFile(this.app.vault.getFileByPath(this.fixedFile));
    this.leaf.updateHeader?.();
  }

  protected async onOpen(): Promise<void> {
    this.addChild(this.backlink);
    const follow = () => {
      if (this.fixedFile) return;
      const f = this.app.workspace.getActiveFile();
      this.backlink.setFile(f && f.extension === "md" ? f : f ?? null);
    };
    this.registerEvent(this.app.workspace.on("file-open", follow));
    this.registerEvent(this.app.workspace.on("active-leaf-change", follow));
    this.registerEvent(
      this.app.vault.on("rename", (f: any) => {
        if (f === this.backlink.file) this.backlink.schedule(100);
      }),
    );
    follow();
  }

  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
  }
}

// ---------------------------------------------------------------- backlinks in document
/** Keeps a BacklinkComponent at the bottom of every open note when the setting is on. */
export class EmbeddedBacklinks {
  private comps = new Map<any, { comp: BacklinkComponent; el: HTMLElement; observer: MutationObserver }>();
  enabled = false;

  constructor(private app: any) {}

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.refresh();
  }

  refresh(): void {
    const seen = new Set<any>();
    if (this.enabled)
      this.app.workspace.iterateAllLeaves((leaf: any) => {
        const v = leaf.view;
        if (v?.getViewType?.() !== "markdown" || !v.file) return;
        seen.add(v);
        this.attach(v);
      });
    for (const [v, c] of this.comps)
      if (!seen.has(v)) {
        c.observer.disconnect();
        c.comp.unload();
        c.el.remove();
        this.comps.delete(v);
      }
  }

  private attach(view: any): void {
    let c = this.comps.get(view);
    if (!c) {
      const el = createDiv("embedded-backlinks");
      const comp = new BacklinkComponent(this.app, el, view);
      comp.load();
      const observer = new MutationObserver(() => this.place(view, el));
      observer.observe(view.previewMode.sizerEl, { childList: true });
      c = { comp, el, observer };
      this.comps.set(view, c);
    }
    c.comp.setFile(view.file);
    this.place(view, c.el);
  }

  private place(view: any, el: HTMLElement): void {
    const target: HTMLElement | null = view.getMode?.() === "preview" ? view.previewMode.sizerEl.querySelector(".mod-footer") ?? view.previewMode.sizerEl : view.sizerEl;
    if (target && el.parentElement !== target) target.appendChild(el);
  }
}
