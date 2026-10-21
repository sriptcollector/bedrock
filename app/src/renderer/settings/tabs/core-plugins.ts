// Settings › Core plugins: one row per core plugin with options, hotkeys and an on/off toggle.
import { BuiltinTab } from "./base";
import type { Setting } from "../../ui/setting";
import { HotkeysTab } from "./hotkeys";

export class CorePluginsTab extends BuiltinTab {
  constructor(app: any) {
    super(app, "plugins", "Core plugins", "toy-brick");
  }
  getSettingDefinitions(): any[] {
    const ip = this.app.internalPlugins;
    const plugins = Object.values(ip?.plugins ?? {}) as any[];
    const rows = plugins
      .filter((p) => !p.info.hidden)
      .sort((a, b) => a.info.name.localeCompare(b.info.name))
      .map((p) => ({
        name: p.info.name,
        desc: p.info.unavailableNote ?? (p.available ? p.info.description : `${p.info.description} Not built yet in this version.`),
        aliases: [p.id],
        render: (s: Setting) => {
          s.settingEl.addClass("mod-toggle");
          s.settingEl.prepend(createDiv("setting-item-icon"));
          if (p.enabled && p.impl?.settingTab)
            s.addExtraButton((b) =>
              b
                .setIcon("settings")
                .setTooltip("Options")
                .onClick(() => this.app.setting.openTabById(p.id)),
            );
          if (p.enabled) s.addExtraButton((b) => {
            b.setIcon("plus-circle")
              .setTooltip("Hotkeys")
              .onClick(() => {
                const hk = this.app.setting.findTabById("hotkeys") as HotkeysTab | undefined;
                if (hk) (hk as any).query = p.info.name;
                this.app.setting.openTabById("hotkeys");
              });
            b.extraSettingsEl.addClass("mod-hotkeys");
          });
          s.addToggle((t) => {
            t.setValue(!!p.enabled && !p.info.unavailableNote).onChange(async (v) => {
              await ip.setEnabled(p.id, v);
              this.rerender();
            });
            if (p.info.unavailableNote) t.setDisabled(true);
          });
        },
      }));
    return [
      {
        type: "list",
        search: { placeholder: "Search plugins...", match: (d: any, q: string) => (d.name + " " + (d.desc ?? "")).toLowerCase().includes(q) },
        items: rows,
      },
    ];
  }
}
