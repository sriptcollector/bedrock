// Community plugin loader. Reads .obsidian/community-plugins.json (enabled ids) and
// .obsidian/plugins/<id>/{manifest.json, main.js, styles.css}. main.js is CommonJS; it runs in a
// wrapper whose `require` maps "obsidian" to our API module and "@codemirror/*" / "@lezer/*" to the
// exact instances our editor uses (plugins must share them), everything else to Node's require.
//
// Safety: like Obsidian's "Restricted mode", plugins only run after the person turns community
// plugins on for this vault (Settings > Community plugins). That choice is stored per vault in
// app data, not in the vault, so a downloaded vault can't switch it on by itself.
import nodeFs from "node:fs";
import type { PluginManifest, Plugin } from "./plugin";
import { Notice } from "../ui/notice";

const LEGACY_CM: Record<string, string> = {
  "@codemirror/text": "@codemirror/state",
  "@codemirror/rangeset": "@codemirror/state",
  "@codemirror/closebrackets": "@codemirror/autocomplete",
  "@codemirror/comment": "@codemirror/commands",
  "@codemirror/history": "@codemirror/commands",
  "@codemirror/fold": "@codemirror/language",
  "@codemirror/gutter": "@codemirror/view",
  "@codemirror/highlight": "@codemirror/language",
  "@codemirror/matchbrackets": "@codemirror/language",
  "@codemirror/panel": "@codemirror/view",
  "@codemirror/rectangular-selection": "@codemirror/view",
  "@codemirror/stream-parser": "@codemirror/language",
  "@codemirror/tooltip": "@codemirror/view",
};

export class PluginManager {
  manifests: Record<string, PluginManifest> = {};
  plugins: Record<string, Plugin> = {};
  enabledPlugins = new Set<string>();
  private styleEls: Record<string, HTMLStyleElement> = {};

  /** id -> last error a plugin threw (load failures and uncaught errors whose stack points at it). */
  loadErrors: Record<string, string> = {};

  constructor(private app: any, private apiModule: () => any, private sharedModules: Record<string, any>) {
    const record = (err: any) => {
      const stack = String(err?.stack ?? err ?? "");
      const m = /plugin:([^:\s)]+)/.exec(stack);
      if (m) this.loadErrors[decodeURIComponent(m[1])] = String(err?.message ?? err).slice(0, 300);
    };
    window.addEventListener("unhandledrejection", (e) => record(e.reason));
    window.addEventListener("error", (e) => record(e.error ?? e.message));
  }

  get dir(): string {
    return this.app.vault.configDir + "/plugins";
  }

  isEnabled(): boolean {
    return this.app.loadLocalStorage("community-plugins-enabled") === "true";
  }

  setEnabled(v: boolean): void {
    this.app.saveLocalStorage("community-plugins-enabled", v ? "true" : "false");
  }

  async loadManifests(): Promise<void> {
    this.manifests = {};
    const a = this.app.vault.adapter;
    if (!(await a.exists(this.dir))) return;
    const list = await a.list(this.dir);
    for (const folder of list.folders) {
      try {
        const m = JSON.parse(await a.read(folder + "/manifest.json")) as PluginManifest;
        if (!m.id) continue;
        m.dir = folder;
        this.manifests[m.id] = m;
      } catch {
        /* not a plugin folder */
      }
    }
  }

  async readEnabledList(): Promise<string[]> {
    try {
      const j = JSON.parse(await this.app.vault.adapter.read(this.app.vault.configDir + "/community-plugins.json"));
      return Array.isArray(j) ? j.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  async saveEnabledList(): Promise<void> {
    await this.app.vault.adapter.write(this.app.vault.configDir + "/community-plugins.json", JSON.stringify([...this.enabledPlugins], null, 2));
  }

  /** Called at startup (after layout ready). */
  async initialize(): Promise<void> {
    await this.loadManifests();
    const ids = await this.readEnabledList();
    this.enabledPlugins = new Set(ids);
    // First time this vault is opened on this computer with plugins switched on in it: ask whether
    // to trust it (like Obsidian), instead of silently running or silently ignoring them.
    // The question doesn't block startup (and is skipped in headless self-tests).
    if (this.app.loadLocalStorage("community-plugins-enabled") === null && ids.some((id) => this.manifests[id]) && !this.app.boot?.selftest && !this.app.boot?.smokeTest) {
      void this.app.ui
        .confirm({
          title: "Trust this vault?",
          body: `This vault has ${ids.length} community ${ids.length === 1 ? "plugin" : "plugins"} turned on. Plugins are made by other people and can read and change your files. Only turn them on if you trust where this vault came from. You can change this later in Settings › Community plugins.`,
          cta: "Trust and turn on plugins",
        })
        .then(async (trust: boolean) => {
          this.setEnabled(!!trust);
          if (trust) for (const id of ids) await this.loadPlugin(id);
        });
      return;
    }
    if (!this.isEnabled()) return;
    for (const id of ids) await this.loadPlugin(id);
  }

  private makeRequire(dir: string): (name: string) => any {
    const nodeRequire = (window as any).require ?? require;
    return (name: string) => {
      if (name === "obsidian") return this.apiModule();
      if (this.sharedModules[name]) return this.sharedModules[name];
      // CodeMirror 0.19-era package names map to their CodeMirror 6 homes (as in Obsidian).
      const legacy = LEGACY_CM[name];
      if (legacy && this.sharedModules[legacy]) {
        console.warn(`Plugin requires deprecated "${name}"; using "${legacy}".`);
        return this.sharedModules[legacy];
      }
      if (name.startsWith("./") || name.startsWith("../")) return nodeRequire(this.app.vault.adapter.getFullPath(dir + "/" + name));
      return nodeRequire(name);
    };
  }

  async loadPlugin(id: string): Promise<Plugin | null> {
    if (this.plugins[id]) return this.plugins[id];
    const m = this.manifests[id];
    if (!m) return null;
    // Like the original: a plugin that needs a newer app version is skipped, with a message.
    if (m.minAppVersion && compareVersions(m.minAppVersion, APP_COMPAT_VERSION) > 0) {
      this.loadErrors[id] = `Needs app version ${m.minAppVersion} or newer.`;
      new Notice(`The plugin "${m.name}" needs a newer version of the app (${m.minAppVersion}), so it wasn't turned on.`);
      return null;
    }
    try {
      const code = await this.app.vault.adapter.read(m.dir + "/main.js");
      const module = { exports: {} as any };
      // Same CommonJS wrapper shape as Obsidian: (require, module, exports) only — plugins may declare
      // their own top-level `app` (Excalidraw does); window.app is the global.
      const fn = (0, eval)(`(function anonymous(require,module,exports){${code}\n})\n//# sourceURL=plugin:${encodeURIComponent(id)}`);
      fn(this.makeRequire(m.dir!), module, module.exports);
      const PluginClass = module.exports.default ?? module.exports;
      if (typeof PluginClass !== "function") throw new Error("main.js does not export a plugin class");
      const plugin: Plugin = new PluginClass(this.app, m);
      this.plugins[id] = plugin;
      plugin.load();
      // Obsidian calls onload (possibly async) via load(); give async onload a chance to settle.
      await Promise.resolve();
      try {
        const css = await this.app.vault.adapter.read(m.dir + "/styles.css");
        const el = document.head.createEl("style", { attr: { "data-plugin": id } });
        el.textContent = css;
        this.styleEls[id] = el;
      } catch {
        /* no styles */
      }
      this.watchData(plugin, m.dir!);
      return plugin;
    } catch (e: any) {
      console.error(`Plugin "${id}" failed to load`, e);
      this.loadErrors[id] = String(e?.message ?? e).slice(0, 300);
      new Notice(`The plugin "${m.name}" couldn't start: ${e?.message ?? e}`);
      return null;
    }
  }

  /** Tell the plugin when its data.json changes on disk (sync, another device, a text editor). */
  private watchData(plugin: Plugin, dir: string): void {
    const full = this.app.vault.adapter.getFullPath(dir);
    let timer: any = null;
    let watcher: any = null;
    try {
      watcher = nodeFs.watch(full, (_ev: string, name: string | null) => {
        if (name && name !== "data.json") return;
        clearTimeout(timer);
        timer = setTimeout(async () => {
          let text: string | null = null;
          try {
            text = await this.app.vault.adapter.read(dir + "/data.json");
          } catch {
            return;
          }
          if (text === plugin.__lastSavedData) return;
          plugin.__lastSavedData = text;
          try {
            await plugin.onExternalSettingsChange?.();
          } catch (e) {
            console.error(e);
          }
        }, 200);
      });
    } catch {
      return;
    }
    void this.app.vault.adapter
      .read(dir + "/data.json")
      .then((t: string) => (plugin.__lastSavedData ??= t))
      .catch(() => undefined);
    plugin.register(() => {
      clearTimeout(timer);
      watcher?.close();
    });
  }

  async unloadPlugin(id: string): Promise<void> {
    const p = this.plugins[id];
    if (!p) return;
    try {
      p.unload();
    } catch (e) {
      console.error(e);
    }
    delete this.plugins[id];
    this.styleEls[id]?.remove();
    delete this.styleEls[id];
  }

  async enablePluginAndSave(id: string): Promise<boolean> {
    this.enabledPlugins.add(id);
    await this.saveEnabledList();
    if (!this.isEnabled()) return false;
    return !!(await this.loadPlugin(id));
  }

  async disablePluginAndSave(id: string): Promise<void> {
    this.enabledPlugins.delete(id);
    await this.saveEnabledList();
    await this.unloadPlugin(id);
  }

  getPlugin(id: string): Plugin | null {
    return this.plugins[id] ?? null;
  }

  /** Turn off, forget and delete a plugin's folder (Settings › Community plugins › Uninstall). */
  async uninstallPlugin(id: string): Promise<void> {
    const m = this.manifests[id];
    await this.unloadPlugin(id);
    if (this.enabledPlugins.delete(id)) await this.saveEnabledList();
    if (m?.dir) await this.app.vault.adapter.rmdir(m.dir, true).catch((e: any) => console.error(e));
    delete this.manifests[id];
  }

  /** Obsidian's names, used by some plugins (e.g. "Hot Reload"). */
  async enablePlugin(id: string): Promise<boolean> {
    if (!this.isEnabled()) return false;
    return !!(await this.loadPlugin(id));
  }
  async disablePlugin(id: string): Promise<void> {
    await this.unloadPlugin(id);
  }
  setEnable(v: boolean): void {
    this.setEnabled(v);
  }
}

/** The Obsidian version whose API we follow (plugins' minAppVersion is compared with it). */
export const APP_COMPAT_VERSION = "1.14.4";

export function compareVersions(a: string, b: string): number {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}
