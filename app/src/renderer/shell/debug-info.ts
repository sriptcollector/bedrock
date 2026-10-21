// "Show debug info": app/OS versions and the vault's setup, with a button to copy it all
// (handy when asking for help). Nothing is sent anywhere.
import { ipcRenderer } from "electron";
import { writeClipboard } from "./clipboard";
import { SHELL_IPC } from "../../shared/ipc-shell";
import { BRAND } from "../../shared/brand";
import { Modal } from "../ui/modal";
import { Notice } from "../ui/notice";

export async function collectDebugInfo(app: any): Promise<[string, string][]> {
  const m = (await ipcRenderer.invoke(SHELL_IPC.debugInfo).catch(() => ({}))) ?? {};
  const enabledCore = Object.values(app.internalPlugins?.plugins ?? {}).filter((p: any) => p.enabled).length;
  const community = Object.keys(app.plugins?.enabledPlugins ? Object.fromEntries([...app.plugins.enabledPlugins].map((x: string) => [x, 1])) : {});
  const snippets: string[] = app.vault.getConfig("enabledCssSnippets") ?? [];
  return [
    ["App version", `${BRAND.displayName} ${app.version}`],
    ["Electron", String(m.electron ?? process.versions.electron)],
    ["Chrome", String(m.chrome ?? process.versions.chrome)],
    ["Operating system", String(m.os ?? process.platform)],
    ["Packaged", m.packaged ? "Yes" : "No (development)"],
    ["Window frame", String(m.frame ?? "hidden")],
    ["Hardware acceleration", m.hardwareAcceleration === false ? "Off" : "On"],
    ["Theme", app.vault.getConfig("cssTheme") || "Default"],
    ["Base color scheme", app.isDarkMode() ? "Dark" : "Light"],
    ["Snippets enabled", String(snippets.length)],
    ["Restricted mode", app.plugins?.isEnabled?.() ? "Off" : "On"],
    ["Core plugins on", String(enabledCore)],
    ["Community plugins on", String(community.length)],
    ["Files in vault", String(app.vault.getFiles().length)],
    ["Notes in vault", String(app.vault.getMarkdownFiles().length)],
  ];
}

class DebugInfoModal extends Modal {
  constructor(app: any, rows: [string, string][]) {
    super(app);
    this.setTitle("Debug info");
    this.modalEl.addClass("mod-debug-info");
    const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n");
    const list = this.contentEl.createDiv("debug-info-list");
    for (const [k, v] of rows) {
      const r = list.createDiv("debug-info-row");
      r.createSpan({ cls: "debug-info-key", text: k + ": " });
      r.createSpan({ cls: "debug-info-value", text: v });
    }
    const btns = this.modalEl.createDiv("modal-button-container");
    btns.createEl("button", { cls: "mod-cta", text: "Copy to clipboard" }).addEventListener("click", () => {
      void writeClipboard("SYSTEM INFO:\n" + text);
      new Notice("Debug info copied to your clipboard");
    });
  }
}

export async function showDebugInfo(app: any): Promise<void> {
  new DebugInfoModal(app, await collectDebugInfo(app)).open();
}
