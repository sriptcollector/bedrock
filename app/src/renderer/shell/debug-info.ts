// "Show debug info": app/OS versions and the vault's setup as plain text you can copy when asking
// for help, plus a shortcut to the sandbox vault. Nothing is sent anywhere.
import { ipcRenderer } from "electron";
import { writeClipboard } from "./clipboard";
import { SHELL_IPC } from "../../shared/ipc-shell";
import { BRAND } from "../../shared/brand";
import { Modal } from "../ui/modal";
import { Notice } from "../ui/notice";

export async function collectDebugInfo(app: any): Promise<[string, string][]> {
  const m = (await ipcRenderer.invoke(SHELL_IPC.debugInfo).catch(() => ({}))) ?? {};
  const installed = Object.keys(app.plugins?.manifests ?? {}).length;
  const enabled = app.plugins?.enabledPlugins?.size ?? 0;
  const snippets: string[] = app.vault.getConfig("enabledCssSnippets") ?? [];
  const account = await app.native?.getAccount?.().catch(() => null);
  return [
    [`${BRAND.displayName} version`, String(app.version)],
    ["Electron", String(m.electron ?? process.versions.electron)],
    ["Operating system", String(m.os ?? process.platform)],
    ["Signed in to Toolbay", account?.signedIn || account?.email ? "Yes" : "No"],
    ["Language", "en"],
    ["Packaged build", m.packaged ? "Yes" : "No (development)"],
    ["Window frame", String(m.frame ?? "hidden")],
    ["Hardware acceleration", m.hardwareAcceleration === false ? "Off" : "On"],
    ["Live preview", app.vault.getConfig("livePreview") === false ? "Off" : "On"],
    ["Base theme", app.isDarkMode() ? "dark" : "light"],
    ["Community theme", app.vault.getConfig("cssTheme") || "none"],
    ["Snippets enabled", String(snippets.length)],
    ["Restricted mode", app.plugins?.isEnabled?.() ? "off" : "on"],
    ["Plugins installed", String(installed)],
    ["Plugins enabled", String(enabled)],
  ];
}

export function formatDebugInfo(rows: [string, string][]): string {
  return "SYSTEM INFO:\n" + rows.map(([k, v]) => `\t${k}: ${v}`).join("\n") + "\n\nRECOMMENDATIONS:\n\tnone";
}

class DebugInfoModal extends Modal {
  constructor(app: any, rows: [string, string][]) {
    super(app);
    this.setTitle("Debug info");
    this.modalEl.addClass("mod-lg", "mod-debug-info");
    const text = formatDebugInfo(rows);
    const ta = this.contentEl.createEl("textarea", { cls: "debug-textarea", attr: { readonly: "true", spellcheck: "false" } });
    ta.value = text;
    ta.rows = Math.min(24, text.split("\n").length + 1);
    const btns = this.modalEl.createDiv("modal-button-container");
    btns.createEl("button", { cls: "mod-secondary", text: "Copy to clipboard" }).addEventListener("click", () => {
      void writeClipboard(text);
      new Notice("Debug info copied to your clipboard");
    });
    btns.createEl("button", { text: "Sandbox vault" }).addEventListener("click", () => ipcRenderer.invoke(SHELL_IPC.openSandbox));
    btns.createEl("button", { cls: "mod-cancel", text: "Done" }).addEventListener("click", () => this.close());
  }
}

export async function showDebugInfo(app: any): Promise<void> {
  new DebugInfoModal(app, await collectDebugInfo(app)).open();
}
