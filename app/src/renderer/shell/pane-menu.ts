// The tab header context menu and the view header "More options" menu, with the original's
// items, order and groups: close / pane (pin, link, backlinks in document, reading view, source
// mode) / open (move to window, split right, split down, open in new window) / file actions /
// find / copy path / version history + linked views / system / delete. File items come through
// the "file-menu" event so plugins can add theirs in the same places.
import nodePath from "node:path";
import { BRAND } from "../../shared/brand";
import { Menu } from "../ui/menu";
import { TFile } from "../vault/files";
import { moveToFolder, revealInExplorer } from "../views/sidebar/file-menu";
import { fileUrl } from "./uri";
import { writeClipboard } from "./clipboard";
import { Notice } from "../ui/notice";

export const PANE_MENU_SECTIONS = ["close", "pane", "view", "open", "action", "find", "info", "view.linked", "system", "", "danger"];

/** Views that can follow another tab (linked views). */
export const LINKABLE_VIEWS: Record<string, { title: string; icon: string }> = {
  localgraph: { title: "Open local graph", icon: "git-fork" },
  backlink: { title: "Open backlinks", icon: "links-coming-in" },
  "outgoing-link": { title: "Open outgoing links", icon: "links-going-out" },
  "file-properties": { title: "Open file properties", icon: "info" },
  outline: { title: "Open outline", icon: "list" },
};

const SOURCES = new Set(["tab-header", "more-options", "pane-more-options"]);

function isMarkdown(leaf: any): boolean {
  return leaf?.view?.getViewType?.() === "markdown" && !!leaf.view.file;
}

/** "Backlinks in document" (checked when shown for this tab). */
function backlinksInDocumentItem(app: any, m: Menu, leaf: any): void {
  const eb = app.embeddedBacklinks;
  if (!isMarkdown(leaf) || !eb || app.internalPlugins?.plugins?.backlink?.enabled === false) return;
  m.addItem((i) =>
    i
      .setTitle("Backlinks in document")
      .setIcon("links-coming-in")
      .setSection("view")
      .setChecked(!!eb.isShownFor?.(leaf))
      .onClick(() => eb.toggleFor?.(leaf)),
  );
}

function openSection(app: any, m: Menu, leaf: any): void {
  const ws = app.workspace;
  m.addItem((i) => i.setTitle("Split right").setIcon("separator-vertical").setSection("open").onClick(() => ws.duplicateLeaf(leaf, "split", "vertical")));
  m.addItem((i) => i.setTitle("Split down").setIcon("separator-horizontal").setSection("open").onClick(() => ws.duplicateLeaf(leaf, "split", "horizontal")));
  if (ws.isRootLeaf(leaf))
    m.addItem((i) =>
      i
        .setTitle("Open in new window")
        .setIcon("picture-in-picture-2")
        .setSection("open")
        .onClick(() => {
          const nl = ws.openPopoutLeaf();
          void nl.setViewState({ ...leaf.getViewState(), active: true }, leaf.getEphemeralState());
        }),
    );
}

/** Link this tab with another one so linked views follow it. */
function linkSubmenu(app: any, m: Menu, leaf: any): void {
  const ws = app.workspace;
  const others: any[] = [];
  ws.iterateAllLeaves((l: any) => l !== leaf && l.view && others.push(l));
  m.addItem((i) => {
    i.setTitle(leaf.group ? "Unlink tab" : "Link with tab...").setIcon(leaf.group ? "unlink" : "link").setSection("view");
    if (leaf.group) {
      i.onClick(() => leaf.setGroup(null));
      return;
    }
    const sub = i.setSubmenu();
    if (!others.length) sub.addItem((s) => s.setTitle("No other tabs").setDisabled(true));
    for (const o of others) sub.addItem((s) => s.setTitle(o.getDisplayText()).setIcon(o.getIcon()).onClick(() => leaf.setGroupMember(o)));
  });
}

/** Tab header context menu. */
export function fillTabMenu(app: any, m: Menu, leaf: any): void {
  const ws = app.workspace;
  (m as any).sectionOrder = PANE_MENU_SECTIONS;
  m.addItem((i) => i.setTitle("Close").setIcon("x").setSection("close").onClick(() => leaf.detach()));
  m.addItem((i) =>
    i
      .setTitle("Close others")
      .setIcon("x")
      .setSection("close")
      .onClick(() => {
        for (const l of leaf.parent?.children.slice() ?? []) if (l !== leaf && !l.pinned) l.detach();
      }),
  );
  m.addItem((i) =>
    i
      .setTitle("Close all")
      .setIcon("x")
      .setSection("close")
      .onClick(() => {
        for (const l of leaf.parent?.children.slice() ?? []) if (!l.pinned) l.detach();
      }),
  );
  m.addItem((i) => i.setTitle(leaf.pinned ? "Unpin" : "Pin").setIcon(leaf.pinned ? "pin-off" : "pin").setSection("view").onClick(() => leaf.togglePinned()));
  linkSubmenu(app, m, leaf);
  backlinksInDocumentItem(app, m, leaf);
  if (ws.isRootLeaf(leaf)) m.addItem((i) => i.setTitle("Move to new window").setIcon("picture-in-picture-2").setSection("open").onClick(() => ws.moveLeafToPopout(leaf)));
  openSection(app, m, leaf);
  runPaneMenu(app, m, leaf, "tab-header");
}

/** View header "More options" menu. */
export function fillMoreOptionsMenu(app: any, m: Menu, leaf: any): void {
  (m as any).sectionOrder = PANE_MENU_SECTIONS;
  backlinksInDocumentItem(app, m, leaf);
  if (leaf.view?.file) openSection(app, m, leaf);
  runPaneMenu(app, m, leaf, "more-options");
}

/** Let the view add its own items; make sure file views always fire "file-menu" once. */
function runPaneMenu(app: any, m: Menu, leaf: any, source: string): void {
  const view = leaf.view;
  const before = (m as any).__fileMenuFired;
  (m as any).__fileMenuFired = false;
  view?.onPaneMenu?.(m, source);
  const f = view?.file;
  if (f instanceof TFile && !(m as any).__fileMenuFired) app.workspace.trigger("file-menu", m, f, source, leaf);
  (m as any).__fileMenuFired = before;
  // "Open linked view" goes last in its group (after "Open version history").
  const i = m.items.findIndex((x: any) => x !== "separator" && x.__linkedView);
  if (i >= 0) m.items.push(...m.items.splice(i, 1));
}

/** File items for the tab header / more-options menus (registered once on the "file-menu" event). */
export function installPaneMenus(app: any): void {
  const ws = app.workspace;
  ws.on("file-menu", (m: Menu, file: any, source: string, leaf: any) => {
    (m as any).__fileMenuFired = true;
    if (!SOURCES.has(source) || !(file instanceof TFile) || (m as any).__paneFileItems) return;
    (m as any).__paneFileItems = true;
    (m as any).sectionOrder ??= PANE_MENU_SECTIONS;
    const md = file.extension === "md";
    const has = (id: string) => !!app.commands.findCommand(id);
    const run = (id: string) => {
      if (leaf && ws.activeLeaf !== leaf) ws.setActiveLeaf(leaf, { focus: true });
      app.commands.executeCommandById(id);
    };
    m.addItem((i) => i.setTitle("Rename...").setIcon("pencil").setSection("action").onClick(() => {
      if (leaf && ws.activeLeaf !== leaf) ws.setActiveLeaf(leaf, { focus: true });
      if (leaf?.view?.focusInlineTitle && leaf.view.getMode?.() !== "preview" && app.vault.getConfig("showInlineTitle") !== false) leaf.view.focusInlineTitle(true);
      else void app.shell.renameFilePrompt(file);
    }));
    m.addItem((i) => i.setTitle("Move file to...").setIcon("folder-tree").setSection("action").onClick(() => moveToFolder(app, file)));
    if (app.bookmarks) {
      const existing = app.bookmarks.findFileBookmark?.(file.path);
      m.addItem((i) => i.setTitle(existing ? "Edit bookmark..." : "Bookmark...").setIcon("bookmark").setSection("action").onClick(() => (existing ? app.bookmarks.editBookmark(existing) : app.bookmarks.bookmarkFileInteractive(file))));
    }
    if (md && has("note-composer:merge-file")) m.addItem((i) => i.setTitle("Merge entire file with...").setIcon("git-merge").setSection("action").onClick(() => run("note-composer:merge-file")));
    if (md && leaf?.view?.getViewType?.() === "markdown") {
      m.addItem((i) => i.setTitle("Add file property").setIcon("plus-circle").setSection("action").onClick(() => run("markdown:add-metadata-property")));
      m.addItem((i) => i.setTitle("Export to PDF...").setIcon("file-output").setSection("action").onClick(() => run("workspace:export-pdf")));
      if (has("editor:open-search")) m.addItem((i) => i.setTitle("Find...").setIcon("search").setSection("find").onClick(() => run("editor:open-search")));
      if (has("editor:open-search-replace")) m.addItem((i) => i.setTitle("Replace...").setIcon("replace").setSection("find").onClick(() => run("editor:open-search-replace")));
    }
    m.addItem((i) => {
      i.setTitle("Copy path").setIcon("clipboard-copy").setSection("info");
      const sub = i.setSubmenu();
      const copy = (t: string) => void writeClipboard(t).then(() => new Notice("Copied to your clipboard"));
      sub.addItem((s) => s.setTitle(`as ${BRAND.displayName} URL`).setIcon("link").onClick(() => copy(fileUrl(app, file))));
      sub.addItem((s) => s.setTitle("from vault folder").setIcon("vault").onClick(() => copy(file.path)));
      sub.addItem((s) => s.setTitle("from system root").setIcon("hard-drive").onClick(() => copy(nodePath.normalize(app.vault.adapter.getFullPath(file.path)))));
    });
    if (leaf) {
      m.addItem((i) => {
        i.setTitle("Open linked view").setIcon("lucide-link").setSection("view.linked");
        (i as any).__linkedView = true;
        const sub = i.setSubmenu();
        for (const [type, info] of Object.entries(LINKABLE_VIEWS)) {
          if (!app.viewRegistry.getViewCreatorByType(type)) continue;
          sub.addItem((s) => s.setTitle(info.title).setIcon(info.icon).onClick(() => openLinkedView(app, leaf, type)));
        }
      });
    }
    m.addItem((i) => i.setTitle("Open in default app").setIcon("arrow-up-right").setSection("system").onClick(() => app.openWithDefaultApp(file.path)));
    m.addItem((i) => i.setTitle("Show in system explorer").setIcon("arrow-up-right").setSection("system").onClick(() => app.showInFolder(file.path)));
    m.addItem((i) => i.setTitle("Reveal file in navigation").setIcon("folder-open").setSection("system").onClick(() => {
      if (!ws.getLeavesOfType("file-explorer").length) void ws.ensureSideLeaf("file-explorer", "left", { reveal: true }).then(() => revealInExplorer(app, file));
      else revealInExplorer(app, file);
    }));
    m.addItem((i) => i.setTitle("Delete file").setIcon("trash-2").setWarning(true).setSection("danger").onClick(() => app.fileManager.promptForDeletion(file)));
  });
}

/** Open a sidebar-style view in a split next to `leaf`, linked so it follows that tab. */
export async function openLinkedView(app: any, leaf: any, type: string): Promise<any> {
  const ws = app.workspace;
  const f = leaf.view?.file;
  const nl = ws.createLeafBySplit(leaf, "vertical");
  nl.setGroupMember(leaf);
  await nl.setViewState({ type, state: f ? { file: f.path, fixed: true } : {}, active: false });
  return nl;
}
