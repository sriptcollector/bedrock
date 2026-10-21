// Helpers shared by core plugin implementations.
import { SettingTab } from "../ui/setting";
import { normalizePath } from "../../core/path";
import type { InternalPlugin } from "./manager";

/** Options tab for a core plugin: controls read/write the plugin's options (.obsidian/<id>.json). */
export abstract class CoreOptionsTab extends SettingTab {
  constructor(public plugin: InternalPlugin) {
    super();
    this.app = plugin.app;
    this.id = plugin.id;
    this.name = plugin.info.name;
    this.icon = plugin.info.icon ?? "settings";
  }
  getControlValue(key: string): unknown {
    return this.plugin.options[key];
  }
  setControlValue(key: string, value: unknown): void {
    this.plugin.setOption(key, value === "" ? undefined : value);
  }
  rerender(): void {
    if (!this.containerEl.isConnected) return;
    const top = this.containerEl.scrollTop;
    this.display();
    this.containerEl.scrollTop = top;
  }
}

/** Normalised folder path ("" for the vault root). */
export function cleanFolder(p: string | undefined | null): string {
  const n = normalizePath(String(p ?? "").trim());
  return n === "/" || n === "." ? "" : n.replace(/^\/+|\/+$/g, "");
}

export async function ensureFolder(app: any, folder: string): Promise<void> {
  folder = cleanFolder(folder);
  if (!folder || app.vault.getAbstractFileByPath(folder)) return;
  const parts = folder.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const p = parts.slice(0, i).join("/");
    if (!app.vault.getAbstractFileByPath(p)) await app.vault.createFolder(p).catch(() => undefined);
  }
}

/** Read a template file given its configured path (with or without ".md"). */
export async function readTemplateFile(app: any, path: string | undefined | null): Promise<{ file: any; text: string } | null> {
  const p = cleanFolder(path);
  if (!p) return null;
  const file = app.vault.getFileByPath(p) ?? app.vault.getFileByPath(p + ".md") ?? app.metadataCache.getFirstLinkpathDest?.(p, "");
  if (!file) return null;
  return { file, text: await app.vault.read(file) };
}

/** Open a file in the most recent leaf (or a new tab when requested). */
export async function openFile(app: any, file: any, newLeaf: boolean | "tab" | "split" | "window" = false, state?: any): Promise<void> {
  const leaf = app.workspace.getLeaf(newLeaf);
  await leaf.openFile(file, state);
}
