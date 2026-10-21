// The app shell: commands with Obsidian's ids (app, file-explorer, markdown, open-with-default-app,
// theme, window, workspace), URIs, the vault manager / switcher and small shell helpers that
// other modules reach through `app.shell`.
import { ipcRenderer } from "electron";
import { SHELL_IPC } from "../../shared/ipc-shell";
import { registerShellCommands, HELP_URL } from "./commands";
import { mountUriHandling } from "./uri";
import { VaultManager, mountVaultSwitcher } from "./vaults";
import { ReleaseNotesView, RELEASE_NOTES_VIEW, isHelpOpen } from "./help";
import { fillTabMenu, fillMoreOptionsMenu, installPaneMenus } from "./pane-menu";
import { mountUpdates } from "./updates";
import { installTooltips } from "../ui/tooltip";
import { mountIndexingStatus, mountRightSidebarToggle, applyFrameStyle } from "./chrome-extras";
import { watchConfigFolder } from "./config-watch";
import nodePath from "node:path";
import { Notice } from "../ui/notice";
import { TFile, TFolder, type TAbstractFile } from "../vault/files";
import shellCss from "./shell.css" with { type: "text" };

export function mountShell(app: any): void {
  let manager: VaultManager | null = null;
  app.shell = {
    openVaultManager: () => (manager ??= new VaultManager(app)).open(),
    closeVaultManager: () => manager?.close(),
    /** Rename prompt for views without an inline title. */
    renameFilePrompt: async (f: TAbstractFile) => {
      const cur = f instanceof TFile ? f.basename : f.name;
      const v = await app.ui.prompt({ title: f instanceof TFolder ? "Rename folder" : "Rename file", value: cur, cta: "Rename" });
      if (!v || v === cur) return;
      const name = f instanceof TFile && f.extension ? `${v}.${f.extension}` : v;
      try {
        await app.fileManager.renameFile(f, (f.parent && !f.parent.isRoot() ? f.parent.path + "/" : "") + name);
      } catch (e: any) {
        new Notice(`Couldn't rename: ${e?.message ?? e}`);
      }
    },
    openSystemTrash: () => ipcRenderer.invoke(SHELL_IPC.windowAction, "open-trash"),
    isHelpOpen,
    fillTabMenu: (m: any, leaf: any) => fillTabMenu(app, m, leaf),
    fillMoreOptionsMenu: (m: any, leaf: any) => fillMoreOptionsMenu(app, m, leaf),
  };
  installPaneMenus(app);
  mountUpdates();
  installTooltips(document);
  mountIndexingStatus(app);
  mountRightSidebarToggle(app);
  void applyFrameStyle(app);
  app.workspace.onLayoutReady(() => watchConfigFolder(app));
  // Settings › General › "Notify if startup takes longer than expected".
  const notifyStartup = () => {
    const st = app.indexStats;
    if (!st || app.loadLocalStorage("startup-notify") !== "true") return;
    if (st.layoutReadyMs > 3000 || st.totalMs > 15000)
      new Notice(`Startup took longer than expected: the window was ready after ${(st.layoutReadyMs / 1000).toFixed(1)} s and indexing ${st.files} files took ${(st.totalMs / 1000).toFixed(1)} s. Large vaults and many plugins slow startup.`, 15000);
  };
  const wait = setInterval(() => {
    if (!app.indexStats) return;
    clearInterval(wait);
    notifyStartup();
  }, 500);
  const style = document.head.createEl("style", { attr: { "data-bedrock": "shell" } });
  style.textContent = shellCss;
  app.viewRegistry.registerView(RELEASE_NOTES_VIEW, (leaf: any) => new ReleaseNotesView(leaf));
  registerShellCommands(app);
  mountUriHandling(app);
  mountVaultSwitcher(app, HELP_URL);
  // The sandbox vault is thrown away and re-created each time it opens.
  if (nodePath.resolve(app.boot.vaultPath) === nodePath.resolve(app.boot.userData, "Sandbox"))
    app.workspace.onLayoutReady(() => new Notice("This is a sandbox vault. Anything you change here is thrown away the next time it opens.", 8000));
}
