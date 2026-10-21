// The file / folder context menu used by the file explorer and every sidebar pane, with the same
// items, groups and icons as the original. Plugins add items through the "file-menu" event.
import { Menu } from "../../ui/menu";
import { Notice } from "../../ui/notice";
import { FuzzySuggestModal } from "../../ui/modal";
import { TFile, TFolder, type TAbstractFile } from "../../vault/files";
import { BRAND } from "../../../shared/brand";
import nodePath from "node:path";

export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  constructor(app: any, private onChoose: (f: TFolder) => void, private exclude?: TAbstractFile) {
    super(app);
    this.setPlaceholder("Type a folder");
    this.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "↵", purpose: "to move" },
      { command: "esc", purpose: "to dismiss" },
    ]);
  }
  getItems(): TFolder[] {
    const all: TFolder[] = this.app.vault.getAllFolders(true);
    const ex = this.exclude;
    return all.filter((f) => !(ex instanceof TFolder && (f === ex || f.path.startsWith(ex.path + "/"))) && f !== ex?.parent);
  }
  getItemText(f: TFolder): string {
    return f.isRoot() ? "/" : f.path;
  }
  onChooseItem(f: TFolder): void {
    this.onChoose(f);
  }
}

export function moveToFolder(app: any, f: TAbstractFile): void {
  new FolderSuggestModal(
    app,
    async (folder) => {
      try {
        await app.fileManager.renameFile(f, folder.getParentPrefix() + f.name);
      } catch (e: any) {
        new Notice(`Couldn't move "${f.name}": ${e?.message ?? e}`);
      }
    },
    f,
  ).open();
}

export async function makeCopy(app: any, f: TAbstractFile): Promise<TAbstractFile | null> {
  if (f instanceof TFile) {
    const base = f.parent && !f.parent.isRoot() ? f.parent.path + "/" + f.basename : f.basename;
    return app.vault.copy(f, app.vault.getAvailablePath(base, f.extension));
  }
  if (f instanceof TFolder && !f.isRoot()) {
    const target = app.vault.getAvailablePath(f.path, "");
    await app.vault.createFolder(target);
    const walk = async (src: TFolder, dst: string) => {
      for (const c of src.children) {
        if (c instanceof TFolder) {
          await app.vault.createFolder(dst + "/" + c.name);
          await walk(c, dst + "/" + c.name);
        } else await app.vault.copy(c, dst + "/" + c.name);
      }
    };
    await walk(f, target);
    return app.vault.getAbstractFileByPath(target);
  }
  return null;
}

export function fileUrl(app: any, f: TAbstractFile): string {
  const scheme = BRAND.protocol || "obsidian";
  return `${scheme}://open?vault=${encodeURIComponent(app.vault.getName())}&file=${encodeURIComponent(f.path.replace(/\.md$/, ""))}`;
}

function copyPathSubmenu(app: any, m: Menu, f: TAbstractFile): void {
  m.addItem((i) => {
    i.setTitle("Copy path").setIcon("clipboard").setSection("info");
    const sub = i.setSubmenu();
    sub.addItem((s) => s.setTitle(`as ${BRAND.displayName} URL`).setIcon("link").onClick(() => navigator.clipboard.writeText(fileUrl(app, f))));
    sub.addItem((s) => s.setTitle("from vault folder").setIcon("vault").onClick(() => navigator.clipboard.writeText(f.path)));
    sub.addItem((s) =>
      s
        .setTitle("from system root")
        .setIcon("hard-drive")
        .onClick(() => navigator.clipboard.writeText(nodePath.normalize(app.vault.adapter.getFullPath(f.path)))),
    );
  });
}

export interface FileMenuHooks {
  rename?: (f: TAbstractFile) => void;
  newNote?: (folder: TFolder) => void;
  newFolder?: (folder: TFolder) => void;
  /** Extra items for the search-result style menus (Reveal file in navigation). */
  reveal?: boolean;
  /** Show the "Make a copy" / "Merge" items (file explorer). */
  explorer?: boolean;
}

function bookmarkItem(app: any, m: Menu, f: TAbstractFile): void {
  const bm = (app as any).bookmarks;
  if (!bm) return;
  const existing = bm.findFileBookmark?.(f.path);
  m.addItem((i) =>
    i
      .setTitle(existing ? "Edit bookmark" : "Bookmark...")
      .setIcon("bookmark")
      .setSection("action")
      .onClick(() => (existing ? bm.editBookmark(existing) : bm.bookmarkFileInteractive(f))),
  );
}

async function renamePrompt(app: any, f: TAbstractFile): Promise<void> {
  const cur = f instanceof TFile ? f.basename : f.name;
  const v = await app.ui.prompt({ title: f instanceof TFolder ? "Rename folder" : "Rename file", value: cur, cta: "Rename" });
  if (!v || v === cur) return;
  const name = f instanceof TFile && f.extension ? `${v}.${f.extension}` : v;
  try {
    await app.fileManager.renameFile(f, (f.parent && !f.parent.isRoot() ? f.parent.path + "/" : "") + name);
  } catch (e: any) {
    new Notice(`Couldn't rename: ${e?.message ?? e}`);
  }
}

/** Fill a menu for a file the way the original does (explorer and sidebar panes). */
export function fillFileMenu(app: any, m: Menu, file: TFile, hooks: FileMenuHooks = {}): void {
  m.addItem((i) => i.setTitle("Open in new tab").setIcon("file-plus").setSection("open").onClick(() => app.workspace.getLeaf("tab").openFile(file)));
  m.addItem((i) => i.setTitle("Open to the right").setIcon("separator-vertical").setSection("open").onClick(() => app.workspace.getLeaf("split").openFile(file)));
  m.addItem((i) => i.setTitle("Open in new window").setIcon("picture-in-picture-2").setSection("open").onClick(() => app.workspace.getLeaf("window").openFile(file)));
  if (hooks.explorer) m.addItem((i) => i.setTitle("Make a copy").setIcon("files").setSection("action").onClick(() => makeCopy(app, file)));
  if (!hooks.explorer) m.addItem((i) => i.setTitle("Rename...").setIcon("edit-3").setSection("action").onClick(() => (hooks.rename ?? ((f) => renamePrompt(app, f)))(file)));
  m.addItem((i) => i.setTitle("Move file to...").setIcon("folder-tree").setSection("action").onClick(() => moveToFolder(app, file)));
  bookmarkItem(app, m, file);
  if (hooks.explorer && file.extension === "md" && app.commands?.findCommand?.("note-composer:merge-file"))
    m.addItem((i) =>
      i
        .setTitle("Merge entire file with...")
        .setIcon("git-merge")
        .setSection("action")
        .onClick(() => {
          app.workspace.getLeaf(false).openFile(file).then(() => app.commands.executeCommandById("note-composer:merge-file"));
        }),
    );
  if (hooks.explorer) copyPathSubmenu(app, m, file);
  m.addItem((i) => i.setTitle("Open in default app").setIcon("arrow-up-right").setSection("system").onClick(() => app.openWithDefaultApp(file.path)));
  m.addItem((i) => i.setTitle("Show in system explorer").setIcon("arrow-up-right").setSection("system").onClick(() => app.showInFolder(file.path)));
  if (hooks.reveal)
    m.addItem((i) =>
      i
        .setTitle("Reveal file in navigation")
        .setIcon("folder-open")
        .setSection("system")
        .onClick(() => revealInExplorer(app, file)),
    );
  if (hooks.explorer) {
    m.addItem((i) => i.setTitle("Rename...").setIcon("edit-3").setSection("danger").onClick(() => (hooks.rename ?? ((f) => renamePrompt(app, f)))(file)));
    m.addItem((i) => i.setTitle("Delete").setIcon("trash-2").setWarning(true).setSection("danger").onClick(() => app.fileManager.promptForDeletion(file)));
  } else {
    m.addItem((i) => i.setTitle("Delete file").setIcon("trash-2").setWarning(true).setSection("danger").onClick(() => app.fileManager.promptForDeletion(file)));
    m.addItem((i) => i.setTitle("Copy path").setIcon("clipboard").setSection("info").onClick(() => navigator.clipboard.writeText(file.path)));
  }
}

export function fillFolderMenu(app: any, m: Menu, folder: TFolder, hooks: FileMenuHooks = {}): void {
  m.addItem((i) => i.setTitle("New note").setIcon("edit").setSection("new").onClick(() => hooks.newNote?.(folder)));
  m.addItem((i) => i.setTitle("New folder").setIcon("folder-open").setSection("new").onClick(() => hooks.newFolder?.(folder)));
  if (app.commands?.findCommand?.("canvas:new-file"))
    m.addItem((i) => i.setTitle("New canvas").setIcon("layout-dashboard").setSection("new").onClick(() => newFileInFolder(app, folder, "canvas")));
  if (app.commands?.findCommand?.("bases:new-file"))
    m.addItem((i) => i.setTitle("New base").setIcon("layout-list").setSection("new").onClick(() => newFileInFolder(app, folder, "base")));
  if (!folder.isRoot()) {
    m.addItem((i) => i.setTitle("Make a copy").setIcon("files").setSection("action").onClick(() => makeCopy(app, folder)));
    m.addItem((i) => i.setTitle("Move folder to...").setIcon("folder-tree").setSection("action").onClick(() => moveToFolder(app, folder)));
  }
  m.addItem((i) =>
    i
      .setTitle("Search in folder")
      .setIcon("folder-search")
      .setSection("action")
      .onClick(() => (app as any).globalSearch?.openGlobalSearch(`path:"${folder.isRoot() ? "" : folder.path}" `)),
  );
  if (!folder.isRoot()) bookmarkItem(app, m, folder);
  copyPathSubmenu(app, m, folder);
  m.addItem((i) => i.setTitle("Show in system explorer").setIcon("arrow-up-right").setSection("system").onClick(() => app.showInFolder(folder.path)));
  if (!folder.isRoot()) {
    m.addItem((i) => i.setTitle("Rename...").setIcon("edit-3").setSection("danger").onClick(() => (hooks.rename ?? ((f) => renamePrompt(app, f)))(folder)));
    m.addItem((i) => i.setTitle("Delete").setIcon("trash-2").setWarning(true).setSection("danger").onClick(() => app.fileManager.promptForDeletion(folder)));
  }
}

async function newFileInFolder(app: any, folder: TFolder, ext: string): Promise<void> {
  const base = folder.getParentPrefix() + "Untitled";
  const path = app.vault.getAvailablePath(base, ext);
  const f = await app.vault.create(path, ext === "canvas" ? "{}" : "");
  await app.workspace.getLeaf(false).openFile(f, { active: true });
}

export function revealInExplorer(app: any, file: TAbstractFile): void {
  const leaf = app.workspace.getLeavesOfType("file-explorer")[0];
  if (!leaf) return;
  app.workspace.revealLeaf(leaf);
  leaf.view?.revealInFolder?.(file);
}

/** Show the standard file menu for a row in a sidebar pane. */
export function showFileMenu(app: any, e: MouseEvent, f: TAbstractFile, source: string, leaf?: any): void {
  e.preventDefault();
  e.stopPropagation();
  const m = new Menu();
  if (f instanceof TFile) fillFileMenu(app, m, f, { reveal: true });
  else if (f instanceof TFolder) fillFolderMenu(app, m, f);
  app.workspace.trigger("file-menu", m, f, source, leaf);
  m.showAtMouseEvent(e);
}
