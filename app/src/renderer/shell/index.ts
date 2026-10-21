// The app shell: commands with Obsidian's ids (app, file-explorer, markdown, open-with-default-app,
// theme, window, workspace), URIs, the vault manager / switcher and small shell helpers that
// other modules reach through `app.shell`.
import { ipcRenderer } from "electron";
import { SHELL_IPC } from "../../shared/ipc-shell";
import { registerShellCommands, HELP_URL } from "./commands";
import { mountUriHandling } from "./uri";
import { VaultManager, mountVaultSwitcher } from "./vaults";
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
  };
  const style = document.head.createEl("style", { attr: { "data-bedrock": "shell" } });
  style.textContent = shellCss;
  registerShellCommands(app);
  mountUriHandling(app);
  mountVaultSwitcher(app, HELP_URL);
}
