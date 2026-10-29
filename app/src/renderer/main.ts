// Renderer entry. Runs with Node integration (like Obsidian) so plugins can require Node modules.
import { ipcRenderer } from "electron";
import { installDomHelpers } from "./dom/augment";
installDomHelpers();
import * as CMState from "@codemirror/state";
import * as CMView from "@codemirror/view";
import * as CMLanguage from "@codemirror/language";
import * as CMCommands from "@codemirror/commands";
import * as CMSearch from "@codemirror/search";
import * as CMAutocomplete from "@codemirror/autocomplete";
import * as LezerCommon from "@lezer/common";
import * as LezerHighlight from "@lezer/highlight";
import * as LezerLR from "@lezer/lr";
import * as CMLint from "@codemirror/lint";
import { IPC, type BootInfo } from "../shared/ipc";
import * as api from "./api";
import { App } from "./app";
import { VaultAccessError } from "../core/scan";
import { vaultAccessMessage } from "../shared/vault-access";

async function boot(): Promise<void> {
  const info: BootInfo = await ipcRenderer.invoke(IPC.bootInfo);
  const shared: Record<string, any> = {
    "@codemirror/state": CMState,
    "@codemirror/view": CMView,
    // Obsidian's @codemirror/language also exports tokenClassNodeProp (HyperMD token classes);
    // plugins read it, so it must exist (our syntax tree doesn't set it, so lookups return undefined).
    "@codemirror/language": { ...CMLanguage, tokenClassNodeProp: new LezerCommon.NodeProp<string>() },
    "@codemirror/commands": CMCommands,
    "@codemirror/search": CMSearch,
    "@codemirror/autocomplete": CMAutocomplete,
    "@lezer/common": LezerCommon,
    "@lezer/highlight": LezerHighlight,
    "@lezer/lr": LezerLR,
    "@codemirror/lint": CMLint,
    moment: api.moment,
  };
  const app = new App(info, () => api, shared);
  (window as any).app = app;
  (window as any).moment = api.moment;
  // The window is closing or the app is quitting: write unsaved edits first, then tell main
  // (it closes after the answer or 3 s). beforeunload covers reloads and anything main misses.
  ipcRenderer.on(IPC.flushPendingSaves, () => {
    void app.flushPendingSaves().finally(() => ipcRenderer.send(IPC.flushedPendingSaves));
  });
  window.addEventListener("beforeunload", () => void app.flushPendingSaves());
  try {
    await app.start();
  } catch (e: any) {
    console.error(e);
    document.body.empty();
    const box = document.body.createDiv("bedrock-fatal");
    if (e instanceof VaultAccessError) {
      // Never show defaults over a vault we may not read: nothing has been written, retry or reopen.
      box.createEl("h2", { text: "Your notes folder can't be opened" });
      box.createEl("p", { text: vaultAccessMessage(info.platform) });
      box.createEl("p", { text: info.vaultPath, cls: "u-muted" });
      const retry = box.createEl("button", { text: "Retry", cls: "mod-cta" });
      retry.addEventListener("click", () => location.reload());
      return;
    }
    box.createEl("h2", { text: "Something went wrong opening your vault" });
    box.createEl("p", { text: String(e?.message ?? e) });
    box.createEl("p", { text: "Try restarting the app. If it keeps happening, the vault folder may not be readable." });
  }
}

boot();
