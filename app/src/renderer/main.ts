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
import { IPC, type BootInfo } from "../shared/ipc";
import * as api from "./api";
import { App } from "./app";

async function boot(): Promise<void> {
  const info: BootInfo = await ipcRenderer.invoke(IPC.bootInfo);
  const shared: Record<string, any> = {
    "@codemirror/state": CMState,
    "@codemirror/view": CMView,
    "@codemirror/language": CMLanguage,
    "@codemirror/commands": CMCommands,
    "@codemirror/search": CMSearch,
    "@codemirror/autocomplete": CMAutocomplete,
    "@lezer/common": LezerCommon,
    "@lezer/highlight": LezerHighlight,
    moment: api.moment,
  };
  const app = new App(info, () => api, shared);
  (window as any).app = app;
  (window as any).moment = api.moment;
  try {
    await app.start();
  } catch (e: any) {
    console.error(e);
    document.body.empty();
    const box = document.body.createDiv("bedrock-fatal");
    box.createEl("h2", { text: "Something went wrong opening your vault" });
    box.createEl("p", { text: String(e?.message ?? e) });
    box.createEl("p", { text: "Try restarting the app. If it keeps happening, the vault folder may not be readable." });
  }
}

boot();
