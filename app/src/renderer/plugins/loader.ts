// Community plugin loader. Reads .obsidian/community-plugins.json (enabled ids) and
// .obsidian/plugins/<id>/{manifest.json, main.js, styles.css}. main.js is CommonJS; it runs in a
// wrapper whose `require` maps "obsidian" to our API module and "@codemirror/*" / "@lezer/*" to the
// exact instances our editor uses (plugins must share them), everything else to Node's require.
//
// Safety: like Obsidian's "Restricted mode", plugins only run after the person turns community
// plugins on for this vault (Settings > Community plugins). That choice is stored per vault in
// app data, not in the vault, so a downloaded vault can't switch it on by itself.
import type { PluginManifest, Plugin } from "./plugin";
import { Notice } from "../ui/notice";

export class PluginManager {
  manifests: Record<string, PluginManifest> = {};
  plugins: Record<string, Plugin> = {};
  enabledPlugins = new Set<string>();
  private styleEls: Record<string, HTMLStyleElement> = {};

  constructor(private app: any, private apiModule: () => any, private sharedModules: Record<string, any>) {}

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
    if (!this.isEnabled()) return;
    for (const id of ids) await this.loadPlugin(id);
  }

  private makeRequire(dir: string): (name: string) => any {
    const nodeRequire = (window as any).require ?? require;
    return (name: string) => {
      if (name === "obsidian") return this.apiModule();
      if (this.sharedModules[name]) return this.sharedModules[name];
      if (name.startsWith("./") || name.startsWith("../")) return nodeRequire(this.app.vault.adapter.getFullPath(dir + "/" + name));
      return nodeRequire(name);
    };
  }

  async loadPlugin(id: string): Promise<Plugin | null> {
    if (this.plugins[id]) return this.plugins[id];
    const m = this.manifests[id];
    if (!m) return null;
    try {
      const code = await this.app.vault.adapter.read(m.dir + "/main.js");
      const module = { exports: {} as any };
      const fn = new Function("require", "module", "exports", "app", code + `\n//# sourceURL=plugin:${encodeURIComponent(id)}`);
      fn(this.makeRequire(m.dir!), module, module.exports, this.app);
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
      return plugin;
    } catch (e: any) {
      console.error(`Plugin "${id}" failed to load`, e);
      new Notice(`The plugin "${m.name}" couldn't start: ${e?.message ?? e}`);
      return null;
    }
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
}
