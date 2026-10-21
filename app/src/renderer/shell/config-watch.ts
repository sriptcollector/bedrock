// Reload settings when the config folder changes on disk (sync from another device, a text
// editor, git): app.json / appearance.json, hotkeys.json, core-plugins.json, bookmarks.json and
// types.json. Writes the app made itself are recognised by their content and ignored.
import fs from "node:fs";
import nodePath from "node:path";

const WATCHED = ["app.json", "appearance.json", "hotkeys.json", "core-plugins.json", "bookmarks.json", "types.json"];

export function watchConfigFolder(app: any): () => void {
  const dir = app.vault.adapter.getFullPath(app.vault.configDir);
  const last = new Map<string, string>();
  const read = (name: string): string | null => {
    try {
      return fs.readFileSync(nodePath.join(dir, name), "utf8");
    } catch {
      return null;
    }
  };
  for (const n of WATCHED) last.set(n, read(n) ?? "");
  const timers = new Map<string, any>();
  const reload = async (name: string) => {
    const text = read(name);
    if (text === null || text === last.get(name)) return;
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      return; // half-written file: the next change event brings the full one
    }
    last.set(name, text);
    const v = app.vault;
    if (name === "app.json" || name === "appearance.json") {
      const which = name === "app.json" ? "app" : "appearance";
      if (JSON.stringify(parsed) === JSON.stringify(v.configFiles?.[which])) return;
      const before = { ...v.config };
      await v.loadConfig();
      const keys = new Set([...Object.keys(before), ...Object.keys(v.config)]);
      for (const k of keys) if (JSON.stringify(before[k]) !== JSON.stringify(v.config[k])) v.trigger("config-changed", k, v.getConfig(k));
      await app.customCss?.load?.().catch?.(() => undefined);
      app.customCss?.applyAll?.();
      app.workspace.updateOptions?.();
    } else if (name === "hotkeys.json") await app.hotkeyManager.load();
    else if (name === "core-plugins.json") {
      for (const [id, on] of Object.entries(parsed && !Array.isArray(parsed) ? parsed : {})) {
        const p = app.internalPlugins.plugins[id];
        if (!p || !!p.enabled === !!on) continue;
        if (on) await p.enable();
        else p.disable();
      }
    } else if (name === "bookmarks.json") await app.bookmarks?.load?.();
    else if (name === "types.json") await app.propertyTypes?.load?.();
  };
  // Our own writes update `last` through this hook (so they don't look like outside changes).
  const origWrite = app.vault.adapter.write.bind(app.vault.adapter);
  app.vault.adapter.write = async (p: string, data: string, ...rest: any[]) => {
    const r = await origWrite(p, data, ...rest);
    const prefix = app.vault.configDir + "/";
    if (p.startsWith(prefix) && WATCHED.includes(p.slice(prefix.length))) last.set(p.slice(prefix.length), data);
    return r;
  };
  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(dir, { persistent: false }, (_e, f) => {
      const name = f?.toString();
      if (!name || !WATCHED.includes(name)) return;
      clearTimeout(timers.get(name));
      timers.set(name, setTimeout(() => void reload(name).catch((e) => console.error(e)), 150));
    });
  } catch {
    /* no config folder yet */
  }
  return () => watcher?.close();
}
