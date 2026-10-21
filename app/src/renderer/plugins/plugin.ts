// Plugin base class (obsidian API). Community plugins extend this; we also use it for built-ins.
import { Component } from "../api/events";
import type { Command } from "../commands/commands";
import { postProcessors, codeBlockProcessors, type MarkdownPostProcessor } from "../markdown/renderer";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  description: string;
  author: string;
  authorUrl?: string;
  isDesktopOnly?: boolean;
  dir?: string;
}

export abstract class Plugin extends Component {
  app: any;
  manifest: PluginManifest;
  private settingTabs: any[] = [];

  constructor(app: any, manifest: PluginManifest) {
    super();
    this.app = app;
    this.manifest = manifest;
  }

  onUserEnable(): void {}

  addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => any): HTMLElement {
    const id = `${this.manifest.id}:${title}`;
    const el = this.app.workspace.leftRibbon.addRibbonItemButton(id, icon, title, callback);
    this.register(() => this.app.workspace.leftRibbon.removeRibbonAction(id));
    return el;
  }

  addStatusBarItem(): HTMLElement {
    const el = this.app.statusBar.containerEl.createDiv(`status-bar-item plugin-${this.manifest.id.replace(/[^a-z0-9-]/gi, "-")}`);
    this.register(() => el.remove());
    return el;
  }

  addCommand(cmd: Command): Command {
    const full = { ...cmd, id: `${this.manifest.id}:${cmd.id}`, name: `${this.manifest.name}: ${cmd.name}` };
    this.app.commands.addCommand(full);
    this.register(() => this.app.commands.removeCommand(full.id));
    return full;
  }

  removeCommand(id: string): void {
    this.app.commands.removeCommand(`${this.manifest.id}:${id}`);
  }

  addSettingTab(tab: any): void {
    this.settingTabs.push(tab);
    this.app.setting.addPluginTab(tab);
    this.register(() => this.app.setting.removePluginTab(tab));
  }

  registerView(type: string, creator: (leaf: any) => any): void {
    this.app.viewRegistry.registerView(type, creator);
    this.register(() => this.app.viewRegistry.unregisterView(type));
  }

  registerHoverLinkSource(id: string, info: any): void {
    this.app.workspace.hoverLinkSources = this.app.workspace.hoverLinkSources ?? {};
    this.app.workspace.hoverLinkSources[id] = info;
    this.register(() => delete this.app.workspace.hoverLinkSources[id]);
  }

  registerExtensions(exts: string[], type: string): void {
    this.app.viewRegistry.registerExtensions(exts, type);
    this.register(() => this.app.viewRegistry.unregisterExtensions(exts));
  }

  registerMarkdownPostProcessor(pp: MarkdownPostProcessor, sortOrder?: number): MarkdownPostProcessor {
    if (sortOrder !== undefined) pp.sortOrder = sortOrder;
    postProcessors.push(pp);
    this.register(() => postProcessors.remove(pp));
    return pp;
  }

  registerMarkdownCodeBlockProcessor(language: string, handler: (source: string, el: HTMLElement, ctx: any) => any, _sortOrder?: number): any {
    codeBlockProcessors[language] = handler;
    this.register(() => delete codeBlockProcessors[language]);
    return handler;
  }

  registerEditorExtension(ext: any): void {
    this.app.workspace.editorExtensions.push(ext);
    this.app.workspace.updateOptions();
    this.register(() => {
      this.app.workspace.editorExtensions.remove(ext);
      this.app.workspace.updateOptions();
    });
  }

  registerObsidianProtocolHandler(action: string, handler: (params: any) => any): void {
    this.app.protocolHandlers[action] = handler;
    this.register(() => delete this.app.protocolHandlers[action]);
  }

  registerEditorSuggest(suggest: any): void {
    this.app.workspace.editorSuggest = this.app.workspace.editorSuggest ?? { suggests: [] };
    this.app.workspace.editorSuggest.suggests.push(suggest);
    this.register(() => this.app.workspace.editorSuggest.suggests.remove(suggest));
  }

  registerCliHandler(): void {}

  async loadData(): Promise<any> {
    try {
      return JSON.parse(await this.app.vault.adapter.read(`${this.manifest.dir}/data.json`));
    } catch {
      return null;
    }
  }

  /** What we last wrote to data.json (so our own saves don't count as outside changes). */
  __lastSavedData: string | null = null;

  async saveData(data: any): Promise<void> {
    const text = JSON.stringify(data, null, 2);
    this.__lastSavedData = text;
    await this.app.vault.adapter.write(`${this.manifest.dir}/data.json`, text);
  }

  onExternalSettingsChange?(): any;
}
