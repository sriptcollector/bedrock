// App-shell commands with Obsidian's ids (docs/reference/commands.json), so hotkeys.json, plugins
// and URIs keep working: app:*, file-explorer:*, markdown:*, open-with-default-app:*, theme:*,
// window:*, workspace:*. Editor commands (editor:*) live with the editor.
import { ipcRenderer } from "electron";
import { writeClipboard } from "./clipboard";
import nodePath from "node:path";
import { SHELL_IPC } from "../../shared/ipc-shell";
import { BRAND } from "../../shared/brand";
import { Notice } from "../ui/notice";
import { Modal } from "../ui/modal";
import { TFile, TFolder } from "../vault/files";
import { WorkspaceTabs } from "../workspace/items";
import { WorkspaceWindow } from "../workspace/popout";
import { makeCopy, moveToFolder, revealInExplorer } from "../views/sidebar/file-menu";
import { fileUrl } from "./uri";
import { exportToPdf } from "./pdf";
import { showDebugInfo } from "./debug-info";
import { openVaultPicker } from "./vaults";
import { openHelpWindow, RELEASE_NOTES_VIEW } from "./help";
import type { Command, Hotkey } from "../commands/commands";
import { migrateFrontmatter, needsFrontmatterMigration } from "../../core/frontmatter-migrate";

const hk = (mods: Hotkey["modifiers"], key: string): Hotkey[] => [{ modifiers: mods, key }];

export { HELP_URL } from "./help";

/** The view of the active leaf, if it shows a file. */
function activeFileView(app: any): any {
  const v = app.workspace.activeLeaf?.view;
  return v && v.file instanceof TFile ? v : null;
}

/** Create "Untitled" in the new-file location and open it with the title selected. */
export async function createNewNote(app: any, where: "current" | "tab" | "split" | false): Promise<TFile> {
  const active = app.workspace.getActiveFile();
  const folder = app.fileManager.getNewFileParent(active?.path ?? "");
  const f: TFile = await app.fileManager.createNewMarkdownFile(folder, "Untitled");
  const leaf = where === "current" ? app.workspace.getLeaf(false) : app.workspace.getLeaf(where === false ? false : where);
  await leaf.openFile(f, { active: true, state: { mode: "source" }, eState: { rename: "all" } });
  return f;
}

/** Leaves of the tab group of the active leaf / of the whole window. */
function windowRootLeaves(app: any, leaf: any): any[] {
  const out: any[] = [];
  const container = leaf.getContainer();
  app.workspace.iterateLeavesOf(container, (l: any) => void out.push(l));
  return out;
}

function closeLeaves(app: any, leaves: any[]): void {
  for (const l of leaves) if (!l.pinned) l.detach();
}

class MigrateModal extends Modal {
  constructor(app: any) {
    super(app);
    this.setTitle("Frontmatter migration");
    this.contentEl.createEl("p", {
      text: "Convert the tags, aliases and cssclasses properties of your notes to the list format this app expects (older notes may use the single-value keys tag, alias and cssclass).",
    });
    this.contentEl.createEl("p", { cls: "mod-warning", text: "This changes every note in the vault, not only the one you have open, and overwrites the files. Make a backup of your vault first." });
    const btns = this.modalEl.createDiv("modal-button-container");
    btns.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    const go = btns.createEl("button", { cls: "mod-cta", text: "Convert all notes" });
    go.addEventListener("click", async () => {
      go.disabled = true;
      let n = 0;
      for (const f of this.app.vault.getMarkdownFiles() as TFile[]) {
        const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
        if (!needsFrontmatterMigration(fm)) continue;
        try {
          let changed = false;
          await this.app.fileManager.processFrontMatter(f, (x: any) => (changed = migrateFrontmatter(x)));
          if (changed) n++;
        } catch (e) {
          console.error(e);
        }
      }
      new Notice(n ? `Converted the properties of ${n} ${n === 1 ? "note" : "notes"}.` : "No notes needed converting.");
      this.close();
    });
  }
}

export function registerShellCommands(app: any): void {
  const add = (c: Command) => app.commands.addCommand(c);
  const ws = app.workspace;

  // ---------------------------------------------------------------- app
  const fontStep = (d: number) => app.customCss.setFontSize((Number(app.vault.getConfig("baseFontSize")) || 16) + d);
  add({ id: "app:decrease-font-size", name: "Decrease font size", callback: () => fontStep(-1) });
  add({ id: "app:increase-font-size", name: "Increase font size", callback: () => fontStep(1) });
  add({ id: "app:migrate-frontmatter", name: "Format converter: Frontmatter migration", callback: () => new MigrateModal(app).open() });
  add({ id: "app:open-another-vault", name: "Open vault...", icon: "vault", callback: () => openVaultPicker(app, "open") });
  add({ id: "app:switch-vault", name: "Change vault...", icon: "vault", callback: () => openVaultPicker(app, "switch") });
  add({ id: "app:open-vault", name: "Manage vaults", icon: "vault", callback: () => app.shell.openVaultManager() });
  add({ id: "app:open-sandbox-vault", name: "Open sandbox vault", icon: "box", callback: () => ipcRenderer.invoke(SHELL_IPC.openSandbox) });
  add({
    id: "app:open-file",
    name: "Open file from outside the vault...",
    icon: "file",
    callback: async () => {
      const p: string | null = await ipcRenderer.invoke(SHELL_IPC.pickFile, "Open file", [{ name: "Notes", extensions: ["md", "canvas", "base"] }, { name: "All files", extensions: ["*"] }]);
      if (!p) return;
      const rel = nodePath.relative(app.vault.adapter.getBasePath(), p).split(nodePath.sep).join("/");
      if (!rel.startsWith("..") && !nodePath.isAbsolute(rel)) {
        const f = app.vault.getFileByPath(rel);
        if (f) return ws.getLeaf(false).openFile(f, { active: true });
      }
      // Outside this vault: open it in the vault that contains it, or its folder as a vault.
      const opened = await ipcRenderer.invoke(SHELL_IPC.openVault, nodePath.dirname(p));
      if (!opened) new Notice("Couldn't open that file.");
    },
  });
  add({ id: "app:open-help", name: "Open help", icon: "help-circle", hotkeys: hk([], "F1"), callback: () => openHelpWindow(app) });
  add({ id: "app:show-debug-info", name: "Show debug info", icon: "bug", callback: () => showDebugInfo(app) });
  add({
    id: "app:show-release-notes",
    name: "Show release notes",
    icon: "book-up",
    callback: async () => {
      const existing = ws.getLeavesOfType(RELEASE_NOTES_VIEW)[0];
      if (existing) return ws.setActiveLeaf(existing, { focus: true });
      await ws.getLeaf("tab").setViewState({ type: RELEASE_NOTES_VIEW, state: { currentVersion: app.version }, active: true });
    },
  });
  add({
    id: "app:toggle-default-new-pane-mode",
    name: "Toggle default mode for new tabs",
    callback: () => {
      const next = app.vault.getConfig("defaultViewMode") === "preview" ? "source" : "preview";
      app.vault.setConfig("defaultViewMode", next);
      new Notice(next === "preview" ? "New tabs now open in reading view by default." : "New tabs now open in editing view by default.");
    },
  });
  add({
    id: "app:toggle-ribbon",
    name: "Toggle ribbon",
    callback: () => {
      app.vault.setConfig("showRibbon", app.vault.getConfig("showRibbon") === false);
      app.customCss.applyInterface();
    },
  });
  add({ id: "app:toggle-left-sidebar", name: "Toggle left sidebar", icon: "panel-left", callback: () => ws.leftSplit.toggle() });
  add({ id: "app:toggle-right-sidebar", name: "Toggle right sidebar", icon: "panel-right", callback: () => ws.rightSplit.toggle() });

  // ---------------------------------------------------------------- file-explorer
  add({ id: "file-explorer:new-file", name: "Create new note", icon: "square-pen", hotkeys: hk(["Mod"], "N"), callback: () => createNewNote(app, false) });
  add({ id: "file-explorer:new-file-in-current-tab", name: "Create new note in current tab", icon: "square-pen", callback: () => createNewNote(app, "current") });
  add({ id: "file-explorer:new-file-in-new-pane", name: "Create note to the right", icon: "file-plus", hotkeys: hk(["Mod", "Shift"], "N"), callback: () => createNewNote(app, "split") });
  add({
    id: "file-explorer:new-folder",
    name: "Files: Create new folder",
    icon: "folder-plus",
    callback: async () => {
      const active = app.workspace.getActiveFile();
      const parent: TFolder = app.fileManager.getNewFileParent(active?.path ?? "");
      const leaf = await ws.ensureSideLeaf("file-explorer", "left", { reveal: true });
      const v: any = leaf.view;
      if (v?.createFolder) await v.createFolder(parent);
      else await app.vault.createFolder(app.vault.getAvailablePath(parent.getParentPrefix() + "Untitled", ""));
    },
  });
  add({
    id: "file-explorer:duplicate-file",
    name: "Make a copy of the current file",
    icon: "files",
    checkCallback: (checking) => {
      const f = app.workspace.getActiveFile();
      if (!f) return false;
      if (!checking)
        void makeCopy(app, f).then((c: any) => {
          if (c instanceof TFile) void ws.getLeaf("tab").openFile(c, { active: true, state: { mode: "source" }, eState: { rename: "all" } });
        });
      return true;
    },
  });
  add({
    id: "file-explorer:move-file",
    name: "Move current file to another folder",
    icon: "folder-tree",
    checkCallback: (checking) => {
      const f = app.workspace.getActiveFile();
      if (!f) return false;
      if (!checking) moveToFolder(app, f);
      return true;
    },
  });
  add({ id: "file-explorer:open", name: "Files: Show file explorer", icon: "folder-closed", callback: () => ws.ensureSideLeaf("file-explorer", "left", { reveal: true }) });
  add({
    id: "file-explorer:reveal-active-file",
    name: "Files: Reveal current file in navigation",
    icon: "locate",
    checkCallback: (checking) => {
      const f = app.workspace.getActiveFile();
      if (!f) return false;
      if (!checking) {
        if (!ws.getLeavesOfType("file-explorer").length) void ws.ensureSideLeaf("file-explorer", "left", { reveal: true }).then(() => revealInExplorer(app, f));
        else revealInExplorer(app, f);
      }
      return true;
    },
  });

  // ---------------------------------------------------------------- markdown
  const mdView = () => {
    const v = ws.activeLeaf?.view;
    return v?.getViewType?.() === "markdown" && v.file ? v : null;
  };
  /** Show the properties block (adding an empty frontmatter if the note has none) and run fn on it. */
  const withProperties = async (v: any, fn: (el: HTMLElement) => void) => {
    if (v.getMode?.() === "preview") await v.setState({ ...v.getState(), mode: "source" }, { history: false });
    const text: string = v.editor?.getValue?.() ?? "";
    if (!/^---\r?\n/.test(text)) {
      // An empty properties block, like the original's "Add file property" on a note without one.
      v.editor.replaceRange("---\n---\n", { line: 0, ch: 0 });
    }
    await new Promise((r) => setTimeout(r, 60));
    const el = v.containerEl.querySelector(".metadata-container") as HTMLElement | null;
    if (el) fn(el);
  };
  add({
    id: "markdown:add-metadata-property",
    name: "Add file property",
    icon: "plus-circle",
    hotkeys: hk(["Mod"], ";"),
    checkCallback: (checking) => {
      const v = mdView();
      if (!v) return false;
      if (!checking) void withProperties(v, (el) => (el.querySelector(".metadata-add-button") as HTMLElement | null)?.click());
      return true;
    },
  });
  add({
    id: "markdown:add-alias",
    name: "Add alias",
    icon: "forward",
    checkCallback: (checking) => {
      const v = mdView();
      if (!v) return false;
      if (!checking)
        void (async () => {
          const fm = app.metadataCache.getFileCache(v.file)?.frontmatter ?? {};
          if (!Object.keys(fm).some((k) => k.toLowerCase() === "aliases" || k.toLowerCase() === "alias")) {
            const text: string = v.editor.getValue();
            if (/^---\r?\n/.test(text)) {
              const end = text.indexOf("\n---", 3);
              const line = text.slice(0, end).split("\n").length;
              v.editor.replaceRange("aliases: []\n", { line, ch: 0 });
            } else v.editor.replaceRange("---\naliases: []\n---\n", { line: 0, ch: 0 });
          }
          await new Promise((r) => setTimeout(r, 120));
          const row = v.containerEl.querySelector('.metadata-property[data-property-key="aliases"], .metadata-property[data-property-key="alias"]') as HTMLElement | null;
          (row?.querySelector(".metadata-property-value input, .metadata-property-value [contenteditable]") as HTMLElement | null)?.focus();
        })();
      return true;
    },
  });
  add({
    id: "markdown:clear-metadata-properties",
    name: "Clear file properties",
    icon: "eraser",
    checkCallback: (checking) => {
      const v = mdView();
      if (!v) return false;
      if (!checking) void app.fileManager.processFrontMatter(v.file, (fm: any) => Object.keys(fm).forEach((k) => delete fm[k]));
      return true;
    },
  });

  // ---------------------------------------------------------------- open-with-default-app
  add({
    id: "open-with-default-app:open",
    name: "Open in default app",
    icon: "arrow-up-right",
    checkCallback: (checking) => {
      const f = app.workspace.getActiveFile();
      if (!f) return false;
      if (!checking) app.openWithDefaultApp(f.path);
      return true;
    },
  });
  add({
    id: "open-with-default-app:show",
    name: "Show in system explorer",
    icon: "arrow-up-right",
    checkCallback: (checking) => {
      const f = app.workspace.getActiveFile();
      if (!f) return false;
      if (!checking) app.showInFolder(f.path);
      return true;
    },
  });

  // ---------------------------------------------------------------- theme
  add({ id: "theme:toggle-light-dark", name: "Toggle light/dark mode", icon: "sun-moon", callback: () => app.customCss.setBaseTheme(app.customCss.isDark() ? "moonstone" : "obsidian") });

  // ---------------------------------------------------------------- window
  add({
    id: "window:toggle-always-on-top",
    name: "Toggle window always on top",
    icon: "pin",
    // Like the original: offered in popout windows that aren't maximized.
    checkCallback: (checking) => {
      const c = app.workspace.activeLeaf?.getContainer?.();
      if (!(c instanceof WorkspaceWindow) || c.doc?.body.hasClass("is-maximized")) return false;
      if (!checking)
        void c.popout.control("always-on-top").then((s: any) => {
          c.doc?.body.toggleClass("is-always-on-top", !!s?.alwaysOnTop);
          if (s) new Notice(s.alwaysOnTop ? "This window now stays on top." : "This window no longer stays on top.");
        });
      return true;
    },
  });

  // ---------------------------------------------------------------- workspace
  add({
    id: "workspace:close-others",
    name: "Close all other tabs",
    icon: "x",
    checkCallback: (checking) => {
      const leaf = ws.activeLeaf;
      if (!leaf || !ws.isRootLeaf(leaf)) return false;
      if (!checking) closeLeaves(app, windowRootLeaves(app, leaf).filter((l) => l !== leaf));
      return true;
    },
  });
  add({
    id: "workspace:close-others-tab-group",
    name: "Close others in tab group",
    icon: "x",
    checkCallback: (checking) => {
      const leaf = ws.activeLeaf;
      if (!leaf?.parent) return false;
      if (!checking) closeLeaves(app, (leaf.parent as WorkspaceTabs).children.filter((l: any) => l !== leaf));
      return true;
    },
  });
  add({
    id: "workspace:close-tab-group",
    name: "Close this tab group",
    icon: "x",
    checkCallback: (checking) => {
      const leaf = ws.activeLeaf;
      if (!leaf?.parent || !ws.isRootLeaf(leaf)) return false;
      if (!checking) for (const l of (leaf.parent as WorkspaceTabs).children.slice()) l.detach();
      return true;
    },
  });
  add({
    id: "workspace:close-window",
    name: "Close window",
    icon: "x",
    hotkeys: hk(["Mod", "Shift"], "W"),
    callback: () => {
      const c = ws.activeLeaf?.getContainer?.();
      const doc = (window as any).activeDocument;
      const pop = ws.floatingSplit.children.find((w: WorkspaceWindow) => w.doc === doc) ?? (c instanceof WorkspaceWindow && doc !== document ? c : null);
      if (pop) pop.close();
      else void ipcRenderer.invoke(SHELL_IPC.windowAction, "close");
    },
  });
  const pathCmd = (id: string, name: string, get: (f: TFile) => string) =>
    add({
      id,
      name,
      icon: "clipboard-copy",
      checkCallback: (checking) => {
        const f = app.workspace.getActiveFile();
        if (!f) return false;
        if (!checking) {
          void writeClipboard(get(f));
          new Notice(id === "workspace:copy-url" ? "Link copied to your clipboard" : "Path copied to your clipboard");
        }
        return true;
      },
    });
  pathCmd("workspace:copy-full-path", "Copy current file path from system root", (f) => nodePath.normalize(app.vault.adapter.getFullPath(f.path)));
  pathCmd("workspace:copy-path", "Copy current file path from vault folder", (f) => f.path);
  pathCmd("workspace:copy-url", `Copy ${BRAND.displayName} URL for current file`, (f) => fileUrl(app, f));
  add({
    id: "workspace:edit-file-title",
    name: "Rename file",
    icon: "pencil",
    hotkeys: hk([], "F2"),
    checkCallback: (checking) => {
      const v = activeFileView(app);
      if (!v) return false;
      if (!checking) {
        if (typeof v.focusInlineTitle === "function" && v.getMode?.() !== "preview" && app.vault.getConfig("showInlineTitle") !== false) v.focusInlineTitle(true);
        else void app.shell.renameFilePrompt(v.file);
      }
      return true;
    },
  });
  add({
    id: "workspace:export-pdf",
    name: "Export to PDF...",
    icon: "file-output",
    checkCallback: (checking) => {
      const v = ws.activeLeaf?.view;
      if (v?.getViewType?.() !== "markdown" || !v.file) return false;
      if (!checking) void exportToPdf(app, v);
      return true;
    },
  });
  add({
    id: "workspace:move-to-new-window",
    name: "Move current tab to new window",
    icon: "picture-in-picture-2",
    checkCallback: (checking) => {
      const leaf = ws.activeLeaf;
      if (!leaf || !ws.isRootLeaf(leaf)) return false;
      if (!checking) ws.moveLeafToPopout(leaf);
      return true;
    },
  });
  add({
    id: "workspace:open-in-new-window",
    name: "Open current tab in new window",
    icon: "picture-in-picture-2",
    checkCallback: (checking) => {
      const leaf = ws.activeLeaf;
      if (!leaf || !ws.isRootLeaf(leaf)) return false;
      if (!checking) {
        const nl = ws.openPopoutLeaf();
        void nl.setViewState({ ...leaf.getViewState(), active: true }, leaf.getEphemeralState());
      }
      return true;
    },
  });
  add({ id: "workspace:new-window", name: "New window", icon: "app-window", callback: () => ws.setActiveLeaf(ws.openPopoutLeaf(), { focus: true }) });
  add({
    id: "workspace:show-trash",
    name: "Show trash",
    icon: "trash",
    // Offered when deleted files go to the vault's .trash folder (Files and links › Deleted files).
    checkCallback: (checking) => {
      if (app.vault.getConfig("trashOption") !== "local") return false;
      if (!checking)
        void (async () => {
          if (!(await app.vault.adapter.exists(".trash"))) await app.vault.adapter.mkdir(".trash");
          app.showInFolder(".trash");
        })();
      return true;
    },
  });
}
