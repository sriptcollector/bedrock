// Selective sync: turns the "sync these too" toggles and excluded folders into the engine's
// exclude rule. Notes (.md), canvases and bases always sync. Pure, unit tested.
import type { SyncSettings } from "../../shared/sync";

export const IMAGE_EXTS = ["bmp", "png", "jpg", "jpeg", "gif", "svg", "webp", "avif"];
export const AUDIO_EXTS = ["mp3", "wav", "m4a", "3gp", "flac", "ogg", "oga", "opus"];
export const VIDEO_EXTS = ["mp4", "webm", "ogv", "mov", "mkv"];
const ALWAYS = new Set(["md", "canvas", "base"]);
const CONFIG = ".obsidian";

function ext(p: string): string {
  const name = p.slice(p.lastIndexOf("/") + 1);
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

function normFolder(f: string): string {
  return f.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
}

/** Which settings category a path inside .obsidian/ belongs to (null = not a config path). */
export function configCategory(p: string): keyof SyncSettings["config"] | null {
  const low = p.toLowerCase();
  if (low !== CONFIG && !low.startsWith(CONFIG + "/")) return null;
  const rest = low.slice(CONFIG.length + 1);
  if (!rest) return null; // the folder itself
  if (rest === "app.json" || rest === "types.json") return "app";
  if (rest === "appearance.json") return "appearance";
  if (rest === "themes" || rest.startsWith("themes/") || rest === "snippets" || rest.startsWith("snippets/")) return "themes";
  if (rest === "hotkeys.json") return "hotkeys";
  if (rest === "core-plugins.json" || rest === "core-plugins-migration.json") return "corePlugins";
  if (rest === "community-plugins.json") return "communityPlugins";
  if (rest === "plugins" || rest.startsWith("plugins/")) return "communityPluginData";
  return "corePluginSettings"; // graph.json, daily-notes.json, bookmarks.json, workspaces.json, ...
}

/** Returns the exclude rule for the engine, or undefined when everything syncs. */
export function excludeRule(s: SyncSettings): ((path: string) => boolean) | undefined {
  const folders = s.excludedFolders.map(normFolder).filter(Boolean);
  const off = new Set<string>();
  if (!s.images) IMAGE_EXTS.forEach((e) => off.add(e));
  if (!s.audio) AUDIO_EXTS.forEach((e) => off.add(e));
  if (!s.video) VIDEO_EXTS.forEach((e) => off.add(e));
  if (!s.pdf) off.add("pdf");
  const known = new Set([...IMAGE_EXTS, ...AUDIO_EXTS, ...VIDEO_EXTS, "pdf", ...ALWAYS]);
  const configOff = Object.entries(s.config).some(([, v]) => !v);
  if (!folders.length && !off.size && s.other && !configOff) return undefined;
  return (p: string) => {
    const low = p.toLowerCase();
    for (const f of folders) if (low === f || low.startsWith(f + "/")) return true;
    const cat = configCategory(p);
    if (cat) return !s.config[cat];
    const e = ext(p);
    if (!e) {
      // folders and extension-less files: a folder path never gets excluded by type
      return false;
    }
    if (ALWAYS.has(e)) return false;
    if (off.has(e)) return true;
    if (!s.other && !known.has(e)) return true;
    return false;
  };
}
