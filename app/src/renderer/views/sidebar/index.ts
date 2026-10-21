// Sidebar features: Search, Backlinks, Outgoing links, Tags, Outline, Bookmarks, All/File
// properties, page preview, query blocks, status bar counts. One entry point the App calls.
import css from "./sidebar.css" with { type: "text" };
import { Notice } from "../../ui/notice";
import { TFile } from "../../vault/files";
import { registerSidebarIcons } from "./icons";
import { getSearchIndex } from "./search-index";
import { SearchView, SEARCH_VIEW } from "./search-view";
import { BacklinkView, BACKLINK_VIEW, EmbeddedBacklinks } from "./backlinks";
import { OutgoingLinkView, OUTGOING_VIEW } from "./outgoing";
import { TagView, TAG_VIEW } from "./tags";
import { OutlineView, OUTLINE_VIEW } from "./outline";
import { BookmarksStore, BookmarksView, BOOKMARKS_VIEW, syncHeaderBookmarkButtons } from "./bookmarks";
import { AllPropertiesView, FilePropertiesView, ALL_PROPERTIES_VIEW, FILE_PROPERTIES_VIEW } from "./properties-views";
import { PagePreview } from "./page-preview";
import { SidebarStatus } from "./status";
import { registerQueryCodeBlock, queryBlockField } from "./query-block";

const CORE_IDS = ["global-search", "backlink", "outgoing-link", "tag-pane", "properties", "page-preview", "bookmarks", "outline", "word-count"];

function injectCss(): void {
  if (document.getElementById("bedrock-sidebar-css")) return;
  const style = document.createElement("style");
  style.id = "bedrock-sidebar-css";
  style.textContent = css;
  // After app.css so equal-specificity rules here win; themes/snippets are appended later still.
  const appCss = document.querySelector('link[href$="app.css"]');
  if (appCss?.nextSibling) appCss.parentNode!.insertBefore(style, appCss.nextSibling);
  else document.head.appendChild(style);
}

/** Mark our core plugins as available/enabled so Settings › Core plugins and plugins see them. */
function enableCorePlugins(app: any): void {
  const plugins = app.internalPlugins?.plugins;
  if (!plugins) return;
  for (const id of CORE_IDS) {
    const p = plugins[id];
    if (!p) continue;
    p.available = true;
    if (p.enabled === false && p._loaded === false) p.enabled = true;
    p._loaded = true;
  }
  const gs = plugins["global-search"];
  if (gs) gs.instance = Object.assign(gs.instance ?? {}, app.globalSearch);
}

export function registerSidebar(app: any): void {
  injectCss();
  registerSidebarIcons();
  const r = app.viewRegistry;
  const ws = app.workspace;

  // ---------- stores and services
  const bookmarks = new BookmarksStore(app);
  app.bookmarks = bookmarks;
  bookmarks.load();
  const index = getSearchIndex(app);
  app.searchIndex = index;
  app.metadataCache.on("resolved", () => index.ensureLoaded());

  app.globalSearch = {
    async revealView(): Promise<SearchView | null> {
      const leaf = await ws.ensureSideLeaf(SEARCH_VIEW, "left", { reveal: true });
      if (ws.leftSplit.collapsed) ws.leftSplit.expand();
      return (leaf?.view as SearchView) ?? null;
    },
    async openGlobalSearch(query: string): Promise<void> {
      const v = await this.revealView();
      if (!v) return;
      v.setQuery(query);
      v.focusInput();
    },
    getGlobalSearchQuery(): string {
      return (ws.getLeavesOfType(SEARCH_VIEW)[0]?.view as SearchView | undefined)?.getQuery() ?? "";
    },
  };
  enableCorePlugins(app);

  // ---------- views
  r.registerView(SEARCH_VIEW, (leaf: any) => new SearchView(leaf));
  r.registerView(BACKLINK_VIEW, (leaf: any) => new BacklinkView(leaf));
  r.registerView(OUTGOING_VIEW, (leaf: any) => new OutgoingLinkView(leaf));
  r.registerView(TAG_VIEW, (leaf: any) => new TagView(leaf));
  r.registerView(OUTLINE_VIEW, (leaf: any) => new OutlineView(leaf));
  r.registerView(BOOKMARKS_VIEW, (leaf: any) => new BookmarksView(leaf));
  r.registerView(ALL_PROPERTIES_VIEW, (leaf: any) => new AllPropertiesView(leaf));
  r.registerView(FILE_PROPERTIES_VIEW, (leaf: any) => new FilePropertiesView(leaf));

  // ---------- page preview, query blocks, status bar
  const preview = new PagePreview(app);
  preview.load();
  app.pagePreview = preview;
  registerQueryCodeBlock(app);
  ws.editorExtensions.push(queryBlockField);
  ws.onLayoutReady(() => ws.updateOptions());
  const status = new SidebarStatus(app);
  status.load();

  // ---------- backlinks at the bottom of notes (backlink.json › backlinkInDocument)
  const embedded = new EmbeddedBacklinks(app);
  app.embeddedBacklinks = embedded;
  const backlinkCfg = app.vault.configDir + "/backlink.json";
  let backlinkOpts: any = {};
  app.vault.adapter
    .read(backlinkCfg)
    .then((t: string) => {
      backlinkOpts = JSON.parse(t) ?? {};
      embedded.setEnabled(!!backlinkOpts.backlinkInDocument);
    })
    .catch(() => undefined);
  const setBacklinksInDocument = async (on: boolean) => {
    backlinkOpts.backlinkInDocument = on;
    embedded.setEnabled(on);
    const bp = app.internalPlugins?.plugins?.backlink;
    if (bp?.impl) return bp.setOption("backlinkInDocument", on);
    await app.vault.adapter.write(backlinkCfg, JSON.stringify(backlinkOpts, null, 2));
  };
  (embedded as any).setOption = setBacklinksInDocument;
  const refreshAll = () => {
    embedded.refresh();
    syncHeaderBookmarkButtons(app);
  };
  ws.on("layout-change", refreshAll);
  ws.on("file-open", refreshAll);
  ws.on("active-leaf-change", refreshAll);
  bookmarks.on("changed", () => syncHeaderBookmarkButtons(app));
  ws.onLayoutReady(refreshAll);

  // ---------- commands
  const C = app.commands;
  const add = (c: any) => C.addCommand(c);
  const activeMd = (): TFile | null => {
    const f = ws.getActiveFile();
    return f && f.extension === "md" ? f : null;
  };
  const openFor = async (type: string, file: TFile) => {
    const leaf = ws.getLeaf("split");
    await leaf.setViewState({ type, state: { file: file.path, fixed: true }, active: true });
  };

  add({
    id: "global-search:open",
    name: "Search: Search in all files",
    icon: "search",
    hotkeys: [{ modifiers: ["Mod", "Shift"], key: "F" }],
    callback: async () => {
      const sel = ws.activeEditor?.editor?.getSelection?.() ?? "";
      const v = await app.globalSearch.revealView();
      if (!v) return;
      if (sel && !sel.includes("\n")) v.setQuery(sel);
      v.focusInput();
    },
  });
  add({ id: "backlink:open", name: "Backlinks: Show backlinks", icon: "links-coming-in", callback: () => ws.ensureSideLeaf(BACKLINK_VIEW, "right", { reveal: true }).then(() => ws.rightSplit.expand()) });
  add({
    id: "backlink:open-backlinks",
    name: "Backlinks: Open backlinks for the current note",
    icon: "links-coming-in",
    checkCallback: (checking: boolean) => {
      const f = activeMd();
      if (!f) return false;
      if (!checking) openFor(BACKLINK_VIEW, f);
      return true;
    },
  });
  add({
    id: "backlink:toggle-backlinks-in-document",
    name: "Backlinks: Toggle backlinks in document",
    icon: "links-coming-in",
    // Per tab, like the "Backlinks in document" item of the tab's More options menu.
    checkCallback: (checking: boolean) => {
      const leaf = ws.activeLeaf;
      if (leaf?.view?.getViewType?.() !== "markdown" || !(leaf.view as any).file) return false;
      if (!checking) embedded.toggleFor(leaf);
      return true;
    },
  });
  void setBacklinksInDocument;
  add({ id: "outgoing-links:open", name: "Outgoing links: Show outgoing links", icon: "links-going-out", callback: () => ws.ensureSideLeaf(OUTGOING_VIEW, "right", { reveal: true }).then(() => ws.rightSplit.expand()) });
  add({
    id: "outgoing-links:open-for-current",
    name: "Outgoing links: Open outgoing links for the current file",
    icon: "links-going-out",
    checkCallback: (checking: boolean) => {
      const f = activeMd();
      if (!f) return false;
      if (!checking) openFor(OUTGOING_VIEW, f);
      return true;
    },
  });
  add({ id: "tag-pane:open", name: "Tags view: Show tags", icon: "tags", callback: () => ws.ensureSideLeaf(TAG_VIEW, "right", { reveal: true }).then(() => ws.rightSplit.expand()) });
  add({ id: "outline:open", name: "Outline: Show outline", icon: "list", callback: () => ws.ensureSideLeaf(OUTLINE_VIEW, "right", { reveal: true }).then(() => ws.rightSplit.expand()) });
  add({
    id: "outline:open-for-current",
    name: "Outline: Open outline of the current file",
    icon: "list",
    checkCallback: (checking: boolean) => {
      const f = activeMd();
      if (!f) return false;
      if (!checking) openFor(OUTLINE_VIEW, f);
      return true;
    },
  });
  add({ id: "properties:open", name: "Properties view: Show all properties", icon: "archive", callback: () => ws.ensureSideLeaf(ALL_PROPERTIES_VIEW, "right", { reveal: true }).then(() => ws.rightSplit.expand()) });
  add({ id: "properties:open-local", name: "Properties view: Show file properties", icon: "info", callback: () => ws.ensureSideLeaf(FILE_PROPERTIES_VIEW, "right", { reveal: true }).then(() => ws.rightSplit.expand()) });

  // bookmarks
  add({ id: "bookmarks:open", name: "Bookmarks: Show bookmarks", icon: "bookmark", callback: () => ws.ensureSideLeaf(BOOKMARKS_VIEW, "left", { reveal: true }).then(() => ws.leftSplit.expand()) });
  add({
    id: "bookmarks:bookmark-current-view",
    name: "Bookmarks: Bookmark...",
    icon: "bookmark",
    checkCallback: (checking: boolean) => {
      const leaf = ws.activeLeaf;
      const v: any = leaf?.view;
      const f: TFile | null = v?.file ?? null;
      const type = v?.getViewType?.();
      if (!f && type !== "search" && type !== "graph") return false;
      if (checking) return true;
      if (type === "search") bookmarks.bookmarkSearchInteractive(v.getQuery());
      else if (type === "graph") bookmarks.add({ type: "graph", title: "Graph view", options: v.getState?.()?.options });
      else if (f) bookmarks.bookmarkFileInteractive(f);
      return true;
    },
  });
  add({
    id: "bookmarks:bookmark-all-tabs",
    name: "Bookmarks: Bookmark all tabs...",
    icon: "bookmark",
    callback: async () => {
      const files: TFile[] = [];
      ws.iterateRootLeaves((l: any) => l.view?.file && !files.includes(l.view.file) && files.push(l.view.file));
      if (!files.length) return void new Notice("No open tabs to bookmark.");
      const title = await app.ui.prompt({ title: "Bookmark all tabs", value: "Tabs " + new Date().toLocaleDateString(), cta: "Save" });
      if (title === null) return;
      bookmarks.add({ type: "group", title: title || "Untitled group", items: files.map((f, i) => ({ type: "file", path: f.path, ctime: Date.now() + i })) });
    },
  });
  add({
    id: "bookmarks:bookmark-current-search",
    name: "Bookmarks: Bookmark current search...",
    icon: "bookmark",
    checkCallback: (checking: boolean) => {
      const q = app.globalSearch.getGlobalSearchQuery();
      if (!q) return false;
      if (!checking) bookmarks.bookmarkSearchInteractive(q);
      return true;
    },
  });
  add({
    id: "bookmarks:bookmark-current-heading",
    name: "Bookmarks: Bookmark heading under cursor...",
    icon: "bookmark",
    editorCheckCallback: (checking: boolean, editor: any, view: any) => {
      const f = view?.file;
      const cache = f ? app.metadataCache.getFileCache(f) : null;
      const line = editor.getCursor().line;
      const h = [...(cache?.headings ?? [])].reverse().find((x: any) => x.position.start.line <= line);
      if (!f || !h) return false;
      if (!checking) bookmarks.bookmarkFileInteractive(f, "#" + h.heading);
      return true;
    },
  });
  add({
    id: "bookmarks:bookmark-current-section",
    name: "Bookmarks: Bookmark block under cursor...",
    icon: "bookmark",
    editorCheckCallback: (checking: boolean, editor: any, view: any) => {
      const f = view?.file;
      if (!f) return false;
      if (checking) return true;
      const line = editor.getCursor().line;
      const cache = app.metadataCache.getFileCache(f);
      const sec = cache?.sections?.find((s: any) => s.position.start.line <= line && s.position.end.line >= line);
      let id = sec?.id;
      if (!id && sec) {
        id = Math.random().toString(36).slice(2, 8);
        const endLine = sec.position.end.line;
        editor.replaceRange(` ^${id}`, { line: endLine, ch: editor.getLine(endLine).length });
      }
      if (id) bookmarks.bookmarkFileInteractive(f, "#^" + id);
      return true;
    },
  });
  add({
    id: "bookmarks:unbookmark-current-view",
    name: "Bookmarks: Remove bookmark for the current file",
    icon: "bookmark-minus",
    checkCallback: (checking: boolean) => {
      const f = ws.getActiveFile();
      const b = f ? bookmarks.findFileBookmark(f.path) : null;
      if (!b) return false;
      if (!checking) bookmarks.remove(b);
      return true;
    },
  });

  // Tag clicks anywhere (reading view, live preview) open search.
  ws.on("search:tag", (tag: string) => app.globalSearch.openGlobalSearch(`tag:${tag.startsWith("#") ? tag : "#" + tag}`));
}
