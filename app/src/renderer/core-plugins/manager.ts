// Core ("internal") plugins: Obsidian's app.internalPlugins. State in .obsidian/core-plugins.json
// ({id: boolean}; the legacy array form is read too), each plugin's options in .obsidian/<id>.json
// (only non-default values). Plugins with behaviour implement CorePluginImpl (onEnable/onDisable,
// options tab); others are toggles whose views are registered elsewhere (see README-DEV).
//
// Extension point for other modules: app.internalPlugins.register(impl) before or after load.
import { Component } from "../api/events";
import type { SettingTab } from "../ui/setting";
import { CORE_PLUGIN_LIST, type CorePluginInfo } from "./list";

export interface CorePluginImpl {
  id: string;
  /** Default option values (written to <id>.json only when they differ). */
  defaultOptions?: Record<string, any>;
  onEnable?(p: InternalPlugin): void | Promise<void>;
  onDisable?(p: InternalPlugin): void;
  /** Options tab shown in Settings › Core plugins while the plugin is on. */
  settingTab?(p: InternalPlugin): SettingTab;
}

/** What plugins see as `internalPlugins.plugins[id].instance` (Obsidian shape). */
export interface InternalPluginInstance {
  id: string;
  name: string;
  description: string;
  defaultOn: boolean;
  options: Record<string, any>;
  [k: string]: any;
}

export class InternalPlugin extends Component {
  enabled = false;
  instance: InternalPluginInstance;
  impl: CorePluginImpl | null = null;
  private tab: SettingTab | null = null;
  private ribbonIds: string[] = [];

  constructor(public app: any, public manager: InternalPlugins, public info: CorePluginInfo) {
    super();
    this.instance = { id: info.id, name: info.name, description: info.description, defaultOn: info.defaultOn, options: {} };
  }
  get id(): string {
    return this.info.id;
  }
  /** Implemented in Bedrock (toggle does something). */
  get available(): boolean {
    return !!this.impl || this.info.available || !!this.manager.externallyAvailable.has(this.id);
  }
  /** Modules that build a core plugin's views mark it available (views/sidebar does this). */
  set available(v: boolean) {
    if (v) this.manager.externallyAvailable.add(this.id);
    else this.manager.externallyAvailable.delete(this.id);
  }
  get options(): Record<string, any> {
    return this.instance.options;
  }

  async loadData(): Promise<void> {
    const raw = (await this.app.vault.readConfigJson(this.id)) ?? {};
    this.stored = raw && typeof raw === "object" ? raw : {};
    this.instance.options = { ...(this.impl?.defaultOptions ?? {}), ...this.stored };
  }
  private stored: Record<string, any> = {};
  /** Save options, keeping only non-default values (and keys we don't know). */
  async saveData(): Promise<void> {
    const d = this.impl?.defaultOptions ?? {};
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(this.instance.options)) {
      if (v === undefined) continue;
      if (k in d && JSON.stringify(d[k]) === JSON.stringify(v)) continue;
      out[k] = v;
    }
    if (JSON.stringify(out) === JSON.stringify(this.stored)) return this.writing;
    this.stored = out;
    this.writing = this.writing.then(() => this.app.vault.writeConfigJson(this.id, out)).catch((e: any) => console.error(e));
    return this.writing;
  }
  private writing: Promise<void> = Promise.resolve();
  setOption(key: string, value: any): void {
    this.instance.options[key] = value;
    void this.saveData();
  }

  // Helpers used by implementations (cleaned up on disable).
  addCommand(cmd: any): any {
    // Core plugin command ids are used as-is (Obsidian's ids are not uniformly prefixed:
    // "insert-template", "daily-notes", "daily-notes:goto-next", ...).
    const full = { ...cmd };
    this.app.commands.addCommand(full);
    this.register(() => this.app.commands.removeCommand(full.id));
    return full;
  }
  addRibbonIcon(icon: string, title: string, cb: (e: MouseEvent) => any): HTMLElement | null {
    const rb = this.app.workspace?.leftRibbon;
    if (!rb) return null;
    const id = `${this.id}:${title}`;
    const el = rb.addRibbonItemButton(id, icon, title, cb);
    this.ribbonIds.push(id);
    this.register(() => rb.removeRibbonAction?.(id));
    return el;
  }
  addStatusBarItem(): HTMLElement {
    const el = this.app.statusBar.containerEl.createDiv(`status-bar-item plugin-${this.id}`);
    this.register(() => el.remove());
    return el;
  }
  registerView(type: string, creator: (leaf: any) => any): void {
    this.app.viewRegistry.registerView(type, creator);
    this.register(() => this.app.viewRegistry.unregisterView(type));
  }
  registerExtensions(exts: string[], type: string): void {
    this.app.viewRegistry.registerExtensions(exts, type);
    this.register(() => this.app.viewRegistry.unregisterExtensions(exts));
  }

  async enable(): Promise<void> {
    if (this.enabled) return;
    this.enabled = true;
    this.load(); // Component: allows register()/registerEvent()
    try {
      await this.impl?.onEnable?.(this);
    } catch (e) {
      console.error(`Core plugin "${this.id}" failed to start`, e);
    }
    if (this.impl?.settingTab && this.app.setting) {
      this.tab = this.impl.settingTab(this);
      this.tab.id = this.tab.id || this.id;
      this.tab.name = this.tab.name || this.info.name;
      if (!this.tab.icon || this.tab.icon === "settings") this.tab.icon = this.info.icon ?? "settings";
      this.app.setting.addSettingTab(this.tab, "core");
    }
    this.manager.trigger("change", this.id, true);
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    try {
      this.impl?.onDisable?.(this);
    } catch (e) {
      console.error(e);
    }
    if (this.tab) {
      this.app.setting?.removeSettingTab(this.tab);
      this.tab = null;
    }
    this.unload();
    this.manager.trigger("change", this.id, false);
  }
}

export class InternalPlugins {
  plugins: Record<string, InternalPlugin> = {};
  /** Ids other modules marked as built (their views exist even without an impl). */
  externallyAvailable = new Set<string>();
  private fileState: Record<string, boolean> | null = null;
  private extraKeys: Record<string, boolean> = {};
  private loaded = false;
  private listeners: Record<string, ((...a: any[]) => any)[]> = {};

  constructor(private app: any, available: Record<string, { available: boolean }> = {}) {
    for (const info of CORE_PLUGIN_LIST) this.plugins[info.id] = new InternalPlugin(app, this, info);
    for (const [id, v] of Object.entries(available)) if (v?.available) this.externallyAvailable.add(id);
  }

  on(name: string, cb: (...a: any[]) => any): { name: string; cb: any } {
    (this.listeners[name] ??= []).push(cb);
    return { name, cb };
  }
  trigger(name: string, ...a: any[]): void {
    for (const cb of this.listeners[name] ?? []) cb(...a);
  }

  /** Attach behaviour to a core plugin id (call any time; enables it if its state is on). */
  register(impl: CorePluginImpl): void {
    const p = this.plugins[impl.id];
    if (!p) return;
    p.impl = impl;
    if (this.loaded && this.shouldBeOn(impl.id)) void p.loadData().then(() => p.enable());
  }

  markAvailable(id: string): void {
    this.externallyAvailable.add(id);
  }

  private shouldBeOn(id: string): boolean {
    const p = this.plugins[id];
    if (!p) return false;
    if (this.fileState && id in this.fileState) return !!this.fileState[id];
    return p.info.defaultOn;
  }

  async load(): Promise<void> {
    const raw = await this.app.vault.readConfigJson("core-plugins");
    if (Array.isArray(raw)) {
      // Legacy format: list of enabled ids.
      this.fileState = {};
      for (const [id, p] of Object.entries(this.plugins)) if (!p.info.legacy || raw.includes(id)) this.fileState[id] = raw.includes(id);
    } else if (raw && typeof raw === "object") {
      this.fileState = {};
      for (const [k, v] of Object.entries(raw)) {
        if (this.plugins[k]) this.fileState[k] = !!v;
        else this.extraKeys[k] = !!v;
      }
    }
    this.loaded = true;
    for (const p of Object.values(this.plugins)) {
      await p.loadData();
      const on = this.shouldBeOn(p.id);
      // core-plugins.json is authoritative, even if another module flagged the plugin early.
      if (!on && p.enabled && !p.impl) p.enabled = false;
      if (on) {
        // Plugins without an implementation still count as enabled (their views are built elsewhere).
        await p.enable();
      }
    }
  }

  private async save(): Promise<void> {
    const out: Record<string, boolean> = {};
    for (const p of Object.values(this.plugins)) {
      // Ids Obsidian 1.14 no longer lists (Format converter) are only written once used.
      if (p.info.legacy && !p.enabled && !(this.fileState && p.id in this.fileState)) continue;
      out[p.id] = p.enabled;
    }
    Object.assign(out, this.extraKeys);
    this.fileState = out;
    await this.app.vault.writeConfigJson("core-plugins", out);
  }

  getPluginById(id: string): InternalPlugin | null {
    const p = this.plugins[id];
    return p?.enabled ? p : null;
  }
  getEnabledPluginById(id: string): InternalPluginInstance | null {
    return this.getPluginById(id)?.instance ?? null;
  }
  getEnabledPlugins(): InternalPlugin[] {
    return Object.values(this.plugins).filter((p) => p.enabled);
  }

  async setEnabled(id: string, on: boolean): Promise<void> {
    const p = this.plugins[id];
    if (!p) return;
    if (on) await p.enable();
    else p.disable();
    await this.save();
  }
  async enablePluginAndSave(id: string): Promise<void> {
    await this.setEnabled(id, true);
  }
  async disablePluginAndSave(id: string): Promise<void> {
    await this.setEnabled(id, false);
  }
}
