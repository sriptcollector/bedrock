// Settings › Appearance: color scheme, accent, themes, CSS snippets, fonts, font size.
import { ipcRenderer } from "electron";
import { IPC } from "../../../shared/ipc";
import { Notice } from "../../ui/notice";
import { BuiltinTab, appSettings } from "./base";
import { SettingPage, SettingGroup } from "../render";
import { Setting } from "../../ui/setting";
import { DEFAULT_ACCENT } from "../../theme/custom-css";
import { openCommunityBrowser } from "../../plugins/browser";

export class AppearanceTab extends BuiltinTab {
  constructor(app: any) {
    super(app, "appearance", "Appearance", "palette");
  }

  getSettingDefinitions(): any[] {
    const app = this.app;
    const css = app.customCss;
    const nThemes = css.themes.length;
    const nSnippets = css.snippets.filter((s: string) => css.enabledSnippets.has(s)).length;
    const fontRow = (name: string, key: "interfaceFontFamily" | "textFontFamily" | "monospaceFontFamily", desc: string) => ({
      type: "page",
      name,
      desc,
      displayValue: () => app.vault.getConfig(key) || "",
      page: () => new FontPage(app, name, key),
    });
    return [
      {
        name: "Base color scheme",
        desc: "Pick light or dark, or follow your system setting.",
        control: { type: "dropdown", key: "theme", options: { obsidian: "Dark", moonstone: "Light", system: "Adapt to system" }, defaultValue: "system" },
      },
      {
        name: "Accent color",
        desc: "The highlight color used for buttons, links and selections.",
        render: (s: Setting) => {
          s.settingEl.addClass("mod-toggle");
          s.addExtraButton((b) =>
            b
              .setIcon("rotate-ccw")
              .setTooltip("Restore default")
              .onClick(() => {
                css.setAccentColor("");
                this.rerender();
              }),
          );
          s.addColorPicker((c) => c.setValue(css.accentColor || DEFAULT_ACCENT).onChange((v) => css.setAccentColor(v)));
        },
      },
      {
        name: "Themes",
        desc: "Choose an installed theme, or browse community themes.",
        render: (s: Setting) => {
          s.addExtraButton((b) =>
            b
              .setIcon("folder-open")
              .setTooltip("Open themes folder")
              .onClick(async () => {
                await app.vault.adapter.mkdir(css.themesDir).catch(() => undefined);
                app.openWithDefaultApp(css.themesDir);
              }),
          );
          s.addDropdown((d) => {
            d.addOption("", "Default");
            for (const t of css.themes) d.addOption(t, t);
            d.setValue(css.theme).onChange(async (v) => {
              await css.setTheme(v);
            });
          });
          s.addButton((b) => b.setButtonText("Manage").onClick(() => openCommunityBrowser(app, "themes")));
        },
      },
      {
        name: "Current community themes",
        desc: `You have ${nThemes} ${nThemes === 1 ? "theme" : "themes"} installed.`,
        render: (s: Setting) => {
          if (!nThemes) return;
          s.addButton((b) =>
            b.setButtonText("Check for updates").onClick(async () => {
              b.setDisabled(true).setButtonText("Checking...");
              const { checkThemeUpdates } = await import("../../plugins/browser/catalog");
              await checkThemeUpdates(app);
              b.setDisabled(false).setButtonText("Check for updates");
            }),
          );
        },
      },
      {
        type: "page",
        name: "CSS snippets",
        desc: "Small CSS files that adjust how the app looks.",
        displayValue: () => `${nSnippets} enabled`,
        page: () => new SnippetsPage(app),
      },
      {
        type: "group",
        heading: "Font",
        items: [
          fontRow("Interface font", "interfaceFontFamily", "The font for menus, sidebars and everything outside your notes."),
          fontRow("Text font", "textFontFamily", "The font for note text in editing and reading views."),
          fontRow("Monospace font", "monospaceFontFamily", "The font for code blocks, inline code and properties."),
          {
            name: "Font size",
            desc: "Text size in pixels for editing and reading views.",
            render: (s: Setting) => {
              s.addExtraButton((b) =>
                b
                  .setIcon("rotate-ccw")
                  .setTooltip("Restore default")
                  .onClick(() => {
                    css.setFontSize(16);
                    this.rerender();
                  }),
              );
              const val = s.controlEl.createSpan({ cls: "slider-value", text: String(css.fontSize) });
              s.addSlider((sl) =>
                sl
                  .setLimits(10, 30, 1)
                  .setValue(css.fontSize)
                  .setDynamicTooltip()
                  .onChange((v) => {
                    val.setText(String(v));
                    css.setFontSize(v);
                  }),
              );
            },
          },
          {
            name: "Quick font size adjustment",
            desc: "Change the font size with Ctrl + scroll wheel, or by pinching on a trackpad.",
            control: { type: "toggle", key: "baseFontSizeAction" },
          },
        ],
      },
      {
        type: "group",
        heading: "Advanced",
        items: [
          {
            name: "Custom app icon",
            desc: "Use your own picture as the app's window and taskbar icon.",
            render: (s: Setting) => {
              let relaunch: HTMLElement | null = null;
              const call = (op: "get" | "choose" | "reset") => ipcRenderer.invoke(IPC.appIcon, op) as Promise<boolean>;
              const sync = (has: boolean) => reset.extraSettingsEl.toggle(has);
              let reset!: any;
              s.addExtraButton((b) => {
                reset = b;
                b.setIcon("rotate-ccw")
                  .setTooltip("Restore default")
                  .onClick(async () => {
                    sync(await call("reset"));
                    relaunch?.show();
                  });
              });
              s.addButton((b) =>
                b.setButtonText("Choose").onClick(async () => {
                  try {
                    sync(await call("choose"));
                    relaunch?.show();
                  } catch (e) {
                    new Notice(`Couldn't use that picture: ${(e as Error).message}`);
                  }
                }),
              );
              s.addButton((b) => {
                relaunch = b.buttonEl;
                b.setButtonText("Relaunch").setCta().onClick(() => appSettings.relaunch());
                b.buttonEl.hide();
              });
              void call("get").then(sync);
            },
          },
        ],
      },
    ];
  }

  setControlValue(key: string, value: unknown): void {
    if (key === "theme") this.app.customCss.setBaseTheme(String(value));
    else super.setControlValue(key, value);
  }
}

/** Appearance › CSS snippets */
class SnippetsPage extends SettingPage {
  constructor(private app: any) {
    super();
    this.title = "CSS snippets";
  }
  display(): void {
    const css = this.app.customCss;
    const el = this.containerEl;
    el.empty();
    const g = new SettingGroup(el).addClass("mod-list", "mod-no-icon");
    g.setHeading("");
    g.addExtraButton((b) =>
      b
        .setIcon("refresh-cw")
        .setTooltip("Reload snippets")
        .onClick(async () => {
          await css.reloadSnippets();
          this.display();
        }),
    );
    g.addExtraButton((b) =>
      b
        .setIcon("folder-open")
        .setTooltip("Open snippets folder")
        .onClick(async () => {
          await this.app.vault.adapter.mkdir(css.snippetsDir).catch(() => undefined);
          this.app.openWithDefaultApp(css.snippetsDir);
        }),
    );
    if (!css.snippets.length) {
      g.addSetting((s) => {
        s.setClass("mod-empty-state");
        s.nameEl.appendText(`Snippets are .css files that change how the app looks. Put them in “${this.app.vault.configDir}/snippets” inside your vault and they show up here. `);
        const a = s.nameEl.createEl("a", { text: "Learn more", href: "#" });
        a.addEventListener("click", (e) => {
          e.preventDefault();
          this.app.openExternal(`https://github.com/${this.app.brand.repo}#css-snippets-and-themes`);
        });
        s.descEl.remove();
      });
      return;
    }
    for (const name of css.snippets) {
      g.addSetting((s) =>
        s
          .setName(name)
          .addExtraButton((b) =>
            b
              .setIcon("file-code")
              .setTooltip("Open file")
              .onClick(() => this.app.openWithDefaultApp(`${css.snippetsDir}/${name}.css`)),
          )
          .addToggle((t) => t.setValue(css.enabledSnippets.has(name)).onChange((v) => css.setSnippet(name, v))),
      );
    }
  }
}

const COMMON_FONTS = [
  "Arial",
  "Calibri",
  "Cambria",
  "Cascadia Code",
  "Cascadia Mono",
  "Consolas",
  "Courier New",
  "Georgia",
  "Helvetica",
  "Inter",
  "Menlo",
  "Monaco",
  "Palatino Linotype",
  "Segoe UI",
  "SF Mono",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
];

/** Appearance › Interface / Text / Monospace font: an ordered list of fonts (first available wins). */
class FontPage extends SettingPage {
  private systemFonts: string[] | null = null;
  constructor(private app: any, title: string, private key: "interfaceFontFamily" | "textFontFamily" | "monospaceFontFamily") {
    super();
    this.title = title;
  }
  private get fonts(): string[] {
    const v: string = this.app.vault.getConfig(this.key) || "";
    return v
      .split(",")
      .map((f) => f.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  private save(list: string[]): void {
    this.app.customCss.setFont(this.key, list.join(", "));
  }
  private async loadSystemFonts(): Promise<string[]> {
    if (this.systemFonts) return this.systemFonts;
    let names: string[] = [];
    try {
      const q = (window as any).queryLocalFonts;
      if (q) names = [...new Set<string>((await q()).map((f: any) => f.family))];
    } catch {
      /* permission denied or unsupported */
    }
    this.systemFonts = (names.length ? names : COMMON_FONTS).sort((a, b) => a.localeCompare(b));
    return this.systemFonts;
  }
  display(): void {
    const el = this.containerEl;
    el.empty();
    const list = this.fonts;
    const g = new SettingGroup(el).addClass("mod-list", "mod-no-icon");
    g.setHeading("Fonts in use");
    if (!list.length) {
      g.addSetting((s) => {
        s.setClass("mod-empty-state").setName("Using the theme's default font. Add a font below to change it.");
        s.descEl.remove();
      });
    }
    list.forEach((f, i) =>
      g.addSetting((s) => {
        s.setName(f);
        s.nameEl.style.fontFamily = `"${f}"`;
        if (i > 0)
          s.addExtraButton((b) =>
            b
              .setIcon("arrow-up")
              .setTooltip("Move up")
              .onClick(() => {
                const l = [...list];
                [l[i - 1], l[i]] = [l[i], l[i - 1]];
                this.save(l);
                this.display();
              }),
          );
        s.addExtraButton((b) =>
          b
            .setIcon("x")
            .setTooltip("Remove")
            .onClick(() => {
              this.save(list.filter((_, j) => j !== i));
              this.display();
            }),
        );
      }),
    );
    const add = new SettingGroup(el).addClass("mod-list", "mod-no-icon");
    add.setHeading("Add a font");
    const results = add.listEl;
    add.addSearch((c) => {
      c.setPlaceholder("Search installed fonts...");
      const render = async () => {
        const all = await this.loadSystemFonts();
        const q = c.getValue().toLowerCase();
        results.empty();
        const shown = all.filter((f) => !list.includes(f) && f.toLowerCase().includes(q)).slice(0, 60);
        if (q && !all.some((f) => f.toLowerCase() === q)) shown.unshift(c.getValue());
        for (const f of shown) {
          const s = new Setting(results).setName(f);
          s.nameEl.style.fontFamily = `"${f}"`;
          s.addExtraButton((b) =>
            b
              .setIcon("plus")
              .setTooltip("Add font")
              .onClick(() => {
                this.save([...list, f]);
                this.display();
              }),
          );
        }
      };
      c.onChange(render);
      void render();
    });
  }
}
