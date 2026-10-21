// Settings tabs for two core plugins whose features live in views/sidebar:
// Settings › Backlinks (backlink.json › backlinkInDocument) and Settings › Page preview
// (page-preview.json: one "require Ctrl" flag per hover source, only changed values stored).
import type { CorePluginImpl } from "./manager";
import { CoreOptionsTab } from "./shared";
import { HOVER_SOURCES } from "../views/sidebar/page-preview";

class BacklinkTab extends CoreOptionsTab {
  getSettingDefinitions(): any[] {
    return [
      {
        name: "Show backlinks at the bottom of notes",
        desc: "Show the backlinks of a note under its text in every tab you open. Each tab can still change this from its More options menu.",
        control: { type: "toggle", key: "backlinkInDocument", defaultValue: false },
      },
    ];
  }
  setControlValue(key: string, value: unknown): void {
    super.setControlValue(key, value);
    if (key === "backlinkInDocument") this.app.embeddedBacklinks?.setEnabled?.(!!value);
  }
}

export const backlinkPlugin: CorePluginImpl = {
  id: "backlink",
  defaultOptions: { backlinkInDocument: false },
  onEnable(p) {
    p.app.embeddedBacklinks?.setEnabled?.(!!p.options.backlinkInDocument);
  },
  onDisable(p) {
    p.app.embeddedBacklinks?.refresh?.();
  },
  settingTab: (p) => new BacklinkTab(p),
};

/** Default "require Ctrl" per source (Reading view is the one that doesn't). */
export const PAGE_PREVIEW_DEFAULTS: Record<string, boolean> = Object.fromEntries(Object.entries(HOVER_SOURCES).map(([k, v]) => [k, v.defaultMod]));

class PagePreviewTab extends CoreOptionsTab {
  getSettingDefinitions(): any[] {
    const sources: Record<string, { display: string; defaultMod: boolean }> = { ...HOVER_SOURCES, ...(this.app.workspace.hoverLinkSources ?? {}) };
    return [
      {
        type: "list",
        heading: "Require Ctrl to trigger page preview on hover",
        items: Object.entries(sources).map(([key, info]) => ({
          name: info.display,
          control: { type: "toggle", key, defaultValue: !!info.defaultMod },
        })),
      },
    ];
  }
  getControlValue(key: string): unknown {
    const v = this.plugin.options[key];
    return typeof v === "boolean" ? v : (this.app.workspace.hoverLinkSources?.[key]?.defaultMod ?? PAGE_PREVIEW_DEFAULTS[key] ?? true);
  }
  setControlValue(key: string, value: unknown): void {
    this.plugin.setOption(key, value);
    if (this.app.pagePreview) this.app.pagePreview.settings = { ...this.plugin.options };
  }
}

export const pagePreviewPlugin: CorePluginImpl = {
  id: "page-preview",
  defaultOptions: { ...PAGE_PREVIEW_DEFAULTS },
  onEnable(p) {
    if (p.app.pagePreview) p.app.pagePreview.settings = { ...p.options };
  },
  onDisable(p) {
    p.app.pagePreview?.hide?.(true);
  },
  settingTab: (p) => new PagePreviewTab(p),
};
