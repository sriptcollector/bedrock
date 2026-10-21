// Settings › Community plugins: Restricted mode, browse, installed plugins with options, hotkeys,
// uninstall and on/off, update checks.
import { BuiltinTab } from "./base";
import type { Setting } from "../../ui/setting";
import { setIcon } from "../../dom/icons";
import { Notice } from "../../ui/notice";
import { openCommunityBrowser } from "../../plugins/browser";

export class CommunityPluginsTab extends BuiltinTab {
  private updates: Record<string, { version: string; repo: string }> | null = null;
  constructor(app: any) {
    super(app, "community-plugins", "Community plugins", "puzzle");
  }
  getControlValue(key: string): unknown {
    if (key === "autoCheckUpdates") return localStorage.getItem("plugin-automatically-check-for-updates") === "true";
    return super.getControlValue(key);
  }
  setControlValue(key: string, value: unknown): void {
    if (key === "autoCheckUpdates") {
      if (value) localStorage.setItem("plugin-automatically-check-for-updates", "true");
      else localStorage.removeItem("plugin-automatically-check-for-updates");
      return;
    }
    super.setControlValue(key, value);
  }

  getSettingDefinitions(): any[] {
    const pm = this.app.plugins;
    if (!pm.isEnabled()) return this.restricted();
    const ids = Object.keys(pm.manifests).sort((a, b) => pm.manifests[a].name.localeCompare(pm.manifests[b].name));
    const n = ids.length;
    return [
      {
        name: "Restricted mode",
        desc: "Turn Restricted mode back on to stop all community plugins in this vault.",
        render: (s: Setting) =>
          s.addButton((b) =>
            b.setButtonText("Turn on and reload").onClick(async () => {
              for (const id of Object.keys(pm.plugins)) await pm.unloadPlugin(id);
              pm.setEnabled(false);
              this.rerender();
            }),
          ),
      },
      {
        name: "Community plugins",
        desc: "Find and install plugins made by other people.",
        render: (s: Setting) => s.addButton((b) => b.setButtonText("Browse").onClick(() => openCommunityBrowser(this.app, "plugins"))),
      },
      {
        name: "Current plugins",
        desc: `You have ${n} ${n === 1 ? "plugin" : "plugins"} installed.`,
        render: (s: Setting) => {
          if (!n) return;
          s.addButton((b) =>
            b.setButtonText(this.updates && Object.keys(this.updates).length ? `Update all (${Object.keys(this.updates).length})` : "Check for updates").onClick(async () => {
              const { checkPluginUpdates, installPlugin } = await import("../../plugins/browser/catalog");
              if (this.updates && Object.keys(this.updates).length) {
                b.setDisabled(true).setButtonText("Updating...");
                for (const [id, u] of Object.entries(this.updates)) await installPlugin(this.app, u.repo, u.version, pm.manifests[id]).catch((e: any) => new Notice(`Couldn't update ${id}: ${e?.message ?? e}`));
                this.updates = {};
                new Notice("Plugins updated.");
              } else {
                b.setDisabled(true).setButtonText("Checking...");
                this.updates = await checkPluginUpdates(this.app).catch((e: any) => {
                  new Notice(`Couldn't check for updates: ${e?.message ?? e}`);
                  return null;
                });
                const k = Object.keys(this.updates ?? {}).length;
                new Notice(k ? `${k} ${k === 1 ? "update" : "updates"} available.` : "All plugins are up to date.");
              }
              this.rerender();
            }),
          );
        },
      },
      { name: "Automatically check for plugin updates", desc: "Check for new versions of your plugins now and then, and tell you when there are some.", control: { type: "toggle", key: "autoCheckUpdates" } },
      {
        type: "list",
        heading: "Installed plugins",
        cls: "installed-plugins-container",
        emptyState: "No plugins installed.",
        extraButtons: [
          (b: any) =>
            b
              .setIcon("refresh-cw")
              .setTooltip("Reload plugins")
              .onClick(async () => {
                await pm.loadManifests();
                this.rerender();
              }),
          (b: any) =>
            b
              .setIcon("folder-open")
              .setTooltip("Open plugins folder")
              .onClick(async () => {
                await this.app.vault.adapter.mkdir(pm.dir).catch(() => undefined);
                this.app.openWithDefaultApp(pm.dir);
              }),
        ],
        search: n ? { placeholder: "Search installed plugins...", match: (d: any, q: string) => (d.name + " " + (d.aliases ?? []).join(" ")).toLowerCase().includes(q) } : undefined,
        items: ids.map((id) => this.pluginRow(id)),
      },
    ];
  }

  private pluginRow(id: string): any {
    const pm = this.app.plugins;
    const m = pm.manifests[id];
    const upd = this.updates?.[id];
    const frag = document.createDocumentFragment();
    const ver = frag.appendChild(document.createElement("div"));
    ver.textContent = `Version ${m.version}${m.author ? ` by ${m.author}` : ""}`;
    if (upd) ver.appendChild(document.createTextNode(` · Version ${upd.version} available`));
    const d = frag.appendChild(document.createElement("div"));
    d.textContent = m.description ?? "";
    const loaded = !!pm.plugins[id];
    const failed = pm.enabledPlugins.has(id) && !loaded;
    if (failed) {
      const f = frag.appendChild(document.createElement("div"));
      f.className = "mod-warning";
      f.textContent = "This plugin didn't start. Open the developer console (Ctrl+Shift+I) for details.";
    }
    return {
      name: m.name,
      desc: frag,
      aliases: [id, m.author ?? ""],
      render: (s: Setting) => {
        s.settingEl.addClass("mod-toggle");
        if (upd)
          s.addButton((b) =>
            b
              .setButtonText("Update")
              .setCta()
              .onClick(async () => {
                b.setDisabled(true).setButtonText("Updating...");
                const { installPlugin } = await import("../../plugins/browser/catalog");
                try {
                  await installPlugin(this.app, upd.repo, upd.version, m);
                  delete this.updates![id];
                  new Notice(`${m.name} updated to ${upd.version}.`);
                } catch (e: any) {
                  new Notice(`Couldn't update ${m.name}: ${e?.message ?? e}`);
                }
                this.rerender();
              }),
          );
        const tab = this.app.setting.findTabById(id);
        if (loaded && tab)
          s.addExtraButton((b) =>
            b
              .setIcon("settings")
              .setTooltip("Options")
              .onClick(() => this.app.setting.openTabById(id)),
          );
        if (loaded)
          s.addExtraButton((b) => {
            b.setIcon("plus-circle")
              .setTooltip("Hotkeys")
              .onClick(() => {
                const hk: any = this.app.setting.findTabById("hotkeys");
                if (hk) hk.query = m.name;
                this.app.setting.openTabById("hotkeys");
              });
            b.extraSettingsEl.addClass("mod-hotkeys");
          });
        s.addExtraButton((b) =>
          b
            .setIcon("trash-2")
            .setTooltip("Uninstall")
            .onClick(async () => {
              const ok = await this.app.ui.confirm({ title: "Uninstall plugin", body: `Uninstall “${m.name}”? Its folder, including its settings, is deleted from this vault.`, cta: "Uninstall", danger: true });
              if (!ok) return;
              await pm.uninstallPlugin(id);
              this.rerender();
            }),
        );
        s.addToggle((t) =>
          t.setValue(pm.enabledPlugins.has(id)).onChange(async (v) => {
            if (v) {
              const ok = await pm.enablePluginAndSave(id);
              if (!ok) new Notice(`“${m.name}” couldn't start.`);
            } else await pm.disablePluginAndSave(id);
            this.rerender();
          }),
        );
      },
    };
  }

  private restricted(): any[] {
    const pm = this.app.plugins;
    const intro = document.createDocumentFragment();
    const feats = intro.appendChild(document.createElement("div"));
    feats.className = "community-plugins-features";
    const feat = (icon: string, name: string, desc: string) => {
      const f = feats.createDiv("community-plugins-feature");
      setIcon(f.createDiv("community-plugins-feature-icon"), icon);
      const t = f.createDiv("community-plugins-feature-text");
      t.createDiv({ cls: "community-plugins-feature-name", text: name });
      t.createDiv({ cls: "community-plugins-feature-desc", text: desc });
    };
    feat("hand", "Nothing runs until you say so", "Plugins stay off in this vault until you leave Restricted mode and switch each one on.");
    feat("github", "Open source", "Most plugins publish their code on GitHub, so you or someone you trust can read what it does.");
    feat("hard-drive", "Decided per computer", "This choice is stored on this computer, not in the vault, so a vault you download can't turn its plugins on by itself.");
    feat("rotate-ccw", "Easy to undo", "Turn Restricted mode back on at any time to stop every community plugin.");
    return [
      {
        type: "group",
        cls: "community-plugins-banner",
        items: [
          {
            name: "Community plugins are made by other people, not by us. Like any software you install, a plugin can read and change files in your vault and connect to the internet.",
            desc: intro,
            render: (s: Setting) => s.settingEl.addClass("community-plugins-intro"),
          },
          {
            name: "Allow community plugins",
            desc: "Plugins run code on your computer. Only install plugins from people you trust.",
            render: (s: Setting) =>
              s.addButton((b) =>
                b
                  .setButtonText("Exit Restricted mode")
                  .setCta()
                  .onClick(async () => {
                    pm.setEnabled(true);
                    await pm.loadManifests();
                    for (const id of pm.enabledPlugins) await pm.loadPlugin(id);
                    this.rerender();
                  }),
              ),
          },
        ],
      },
    ];
  }
}
