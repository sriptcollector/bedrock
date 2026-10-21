// Settings modal: vertical tabs (Options / Core plugins / Community plugins). Built-in tabs are
// SettingTab subclasses registered with addSettingTab, the same way plugins add theirs.
// Extension point: other agents add tabs via app.setting.addSettingTab(tab, "options").
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Modal } from "../ui/modal";
import { Setting, SettingTab } from "../ui/setting";
import { setIcon } from "../dom/icons";
import { BRAND, INSPIRED_BY } from "../../shared/brand";
import { hotkeyLabel, eventModifiers, normaliseKey } from "../commands/keymap";
import { Notice } from "../ui/notice";

type Group = "options" | "core" | "community";

export class SettingsModal extends Modal {
  private tabs: { tab: SettingTab; group: Group }[] = [];
  private navEl: HTMLElement;
  private contentContainer: HTMLElement;
  activeTab: SettingTab | null = null;

  constructor(app: any) {
    super(app);
    this.modalEl.addClass("mod-settings", "mod-sidebar-layout");
    this.titleEl.detach();
    const container = this.contentEl.createDiv("vertical-tabs-container");
    this.navEl = container.createDiv("vertical-tab-header");
    this.contentContainer = container.createDiv("vertical-tab-content-container");
  }

  addSettingTab(tab: SettingTab, group: Group = "options"): void {
    tab.app = this.app;
    this.tabs.push({ tab, group });
  }
  addPluginTab(tab: SettingTab): void {
    this.addSettingTab(tab, "community");
  }
  removePluginTab(tab: SettingTab): void {
    this.tabs = this.tabs.filter((t) => t.tab !== tab);
    if (this.activeTab === tab) this.activeTab = null;
  }

  openTabById(id: string): void {
    this.open();
    const t = this.tabs.find((x) => x.tab.id === id);
    if (t) this.openTab(t.tab);
  }

  onOpen(): void {
    this.renderNav();
    this.openTab(this.activeTab ?? this.tabs[0]?.tab);
  }

  onClose(): void {
    this.activeTab?.hide();
  }

  private renderNav(): void {
    this.navEl.empty();
    const groups: [Group, string][] = [
      ["options", "Options"],
      ["core", "Core plugins"],
      ["community", "Community plugins"],
    ];
    for (const [g, label] of groups) {
      const items = this.tabs.filter((t) => t.group === g);
      if (!items.length) continue;
      const grp = this.navEl.createDiv("vertical-tab-header-group");
      grp.createDiv({ cls: "vertical-tab-header-group-title", text: label });
      const list = grp.createDiv("vertical-tab-header-group-items");
      for (const { tab } of items) {
        const it = list.createDiv({ cls: "vertical-tab-nav-item", text: tab.name, attr: { "data-tab-id": tab.id } });
        it.addEventListener("click", () => this.openTab(tab));
      }
    }
  }

  openTab(tab?: SettingTab): void {
    if (!tab) return;
    this.activeTab?.hide();
    this.activeTab?.containerEl.detach();
    this.activeTab = tab;
    this.navEl.querySelectorAll(".vertical-tab-nav-item").forEach((e) => e.toggleClass("is-active", e.getAttribute("data-tab-id") === tab.id));
    this.contentContainer.empty();
    this.contentContainer.appendChild(tab.containerEl);
    tab.containerEl.empty();
    tab.display();
  }
}

// ---------------- built-in tabs ----------------
abstract class BuiltinTab extends SettingTab {
  constructor(app: any, id: string, name: string, icon: string) {
    super();
    this.app = app;
    this.id = id;
    this.name = name;
    this.icon = icon;
  }
  protected toggle(name: string, desc: string, key: string, after?: () => void): Setting {
    return new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addToggle((t) =>
        t.setValue(!!this.app.vault.getConfig(key)).onChange((v) => {
          this.app.vault.setConfig(key, v);
          this.app.workspace.updateOptions();
          after?.();
        }),
      );
  }
  protected heading(text: string): void {
    new Setting(this.containerEl).setName(text).setHeading();
  }
}

export function renderCredit(el: HTMLElement): void {
  if (!INSPIRED_BY) return;
  const c = el.createDiv("bedrock-inspired-credit");
  // The original's logo is only shown if the lead has dropped the official file in (see brand.json).
  const logoUrl = new URL("inspired-by.svg", location.href);
  if (fs.existsSync(fileURLToPath(logoUrl))) c.createEl("img", { cls: "bedrock-inspired-logo", attr: { src: logoUrl.href, alt: `${INSPIRED_BY.name} logo`, width: "16", height: "16" } });
  c.createSpan({ text: `Inspired by ${INSPIRED_BY.name}. ` });
  c.createSpan({ cls: "bedrock-inspired-note", text: INSPIRED_BY.notAffiliated });
}

class GeneralTab extends BuiltinTab {
  display(): void {
    const el = this.containerEl;
    this.heading("App");
    new Setting(el)
      .setName("Current version")
      .setDesc(`${BRAND.byline} ${this.app.version}. Free and open source.`)
      .addButton((b) =>
        b.setButtonText("Check for updates").onClick(async () => {
          new Notice(await this.app.native.checkForUpdates());
        }),
      );
    new Setting(el).setName("Language").setDesc("Change the display language.").addDropdown((d) => d.addOption("en", "English").setValue("en").setDisabled(true));
    this.heading("Account");
    const acct = new Setting(el).setName("Toolbay account").setDesc("Checking…");
    this.app.native.getAccount().then((a: any) => {
      acct.setDesc(a ? `Signed in as ${a.name || a.handle}. Your vault syncs to your other computers.` : "Not signed in. Sign in with the Toolbay app to sync this vault. Everything works offline without it.");
    });
    this.heading("Advanced");
    new Setting(el)
      .setName("Open another folder as vault")
      .setDesc("Open any folder, such as an existing Obsidian vault, in its own window. It isn't synced.")
      .addButton((b) => b.setButtonText("Open folder").onClick(() => this.app.native.openVaultDialog()));
    new Setting(el)
      .setName("Make an existing vault your synced vault")
      .setDesc(`Copy an existing vault's notes, attachments and settings into your ${BRAND.displayName} vault so it syncs. Nothing in the original folder changes.`)
      .addButton((b) => b.setButtonText("Import vault").onClick(() => this.app.importVaultFlow()));
    new Setting(el)
      .setName("Vault location")
      .setDesc(this.app.vault.adapter.basePath)
      .addButton((b) => b.setButtonText("Show in folder").onClick(() => this.app.showInFolder("/")));
    renderCredit(el.createDiv("setting-item bedrock-credit-row"));
  }
}

class EditorTab extends BuiltinTab {
  display(): void {
    this.heading("Display");
    this.toggle("Readable line length", "Limit maximum line length.", "readableLineLength");
    this.toggle("Strict line breaks", "Markdown ignores single line breaks in reading view. Turn this off to show them.", "strictLineBreaks");
    new Setting(this.containerEl)
      .setName("Properties in document")
      .setDesc("Choose how properties are shown at the top of notes.")
      .addDropdown((d) =>
        d
          .addOptions({ visible: "Visible", hidden: "Hidden", source: "Source" })
          .setValue(this.app.vault.getConfig("propertiesInDocument"))
          .onChange((v) => {
            this.app.vault.setConfig("propertiesInDocument", v);
            this.app.workspace.updateOptions();
          }),
      );
    this.toggle("Fold heading", "Lets you fold all content under a heading.", "foldHeading");
    this.toggle("Fold indent", "Lets you fold part of an indentation, such as lists.", "foldIndent");
    this.toggle("Line numbers", "Show line numbers in the gutter.", "showLineNumber");
    this.toggle("Show inline title", "Displays the file name as an editable title inline with the file contents.", "showInlineTitle");
    this.heading("Behavior");
    new Setting(this.containerEl)
      .setName("Default editing mode")
      .setDesc("New tabs open in this mode.")
      .addDropdown((d) =>
        d
          .addOptions({ preview: "Live Preview", source: "Source mode" })
          .setValue(this.app.vault.getConfig("livePreview") ? "preview" : "source")
          .onChange((v) => this.app.vault.setConfig("livePreview", v === "preview")),
      );
    this.toggle("Spellcheck", "Turn on the spellchecker.", "spellcheck");
    this.toggle("Auto pair brackets", "Pair brackets and quotes automatically.", "autoPairBrackets");
    this.toggle("Auto pair Markdown syntax", "Pair symbols automatically for bold, italic, code and more.", "autoPairMarkdown");
    this.toggle("Smart lists", "Continue lists and fix numbering as you type.", "smartIndentList");
    this.toggle("Indent using tabs", "Use tabs to indent instead of spaces.", "useTab");
    this.heading("Advanced");
    this.toggle("Vim key bindings", "Use Vim key bindings when editing.", "vimMode");
  }
}

class FilesTab extends BuiltinTab {
  display(): void {
    const el = this.containerEl;
    this.toggle("Confirm file deletion", "Ask before deleting a file.", "promptDelete");
    new Setting(el)
      .setName("Deleted files")
      .setDesc("What happens to a file after you delete it.")
      .addDropdown((d) =>
        d
          .addOptions({ system: "Move to system trash", local: "Move to vault trash folder (.trash)", none: "Permanently delete" })
          .setValue(this.app.vault.getConfig("trashOption"))
          .onChange((v) => this.app.vault.setConfig("trashOption", v)),
      );
    new Setting(el)
      .setName("Default location for new notes")
      .addDropdown((d) =>
        d
          .addOptions({ root: "Vault folder", current: "Same folder as current file", folder: "In the folder specified below" })
          .setValue(this.app.vault.getConfig("newFileLocation"))
          .onChange((v) => this.app.vault.setConfig("newFileLocation", v)),
      );
    new Setting(el).setName("Folder to create new notes in").addText((t) => t.setValue(this.app.vault.getConfig("newFileFolderPath") ?? "").onChange((v) => this.app.vault.setConfig("newFileFolderPath", v)));
    this.toggle("Automatically update internal links", "Update links when you rename or move a file.", "alwaysUpdateLinks");
    new Setting(el)
      .setName("New link format")
      .addDropdown((d) =>
        d
          .addOptions({ shortest: "Shortest path when possible", relative: "Relative path to file", absolute: "Absolute path in vault" })
          .setValue(this.app.vault.getConfig("newLinkFormat"))
          .onChange((v) => this.app.vault.setConfig("newLinkFormat", v)),
      );
    this.toggle("Use [[Wikilinks]]", "Generate [[Wikilinks]] instead of Markdown links.", "useMarkdownLinksInverted");
    new Setting(el)
      .setName("Default location for new attachments")
      .addText((t) => t.setPlaceholder("/").setValue(this.app.vault.getConfig("attachmentFolderPath") ?? "/").onChange((v) => this.app.vault.setConfig("attachmentFolderPath", v || "/")));
    this.toggle("Detect all file extensions", "Show files with any extension in the file explorer.", "showUnsupportedFiles");
  }
  protected toggle(name: string, desc: string, key: string): Setting {
    if (key === "useMarkdownLinksInverted") {
      return new Setting(this.containerEl)
        .setName(name)
        .setDesc(desc)
        .addToggle((t) => t.setValue(!this.app.vault.getConfig("useMarkdownLinks")).onChange((v) => this.app.vault.setConfig("useMarkdownLinks", !v)));
    }
    return super.toggle(name, desc, key);
  }
}

class AppearanceTab extends BuiltinTab {
  display(): void {
    const el = this.containerEl;
    const css = this.app.customCss;
    new Setting(el)
      .setName("Base color scheme")
      .addDropdown((d) =>
        d
          .addOptions({ system: "Adapt to system", moonstone: "Light", obsidian: "Dark" })
          .setValue(css.baseTheme)
          .onChange((v) => css.setBaseTheme(v)),
      );
    new Setting(el)
      .setName("Accent color")
      .addColorPicker((c) => c.setValue(css.accentColor || "#7c6ce0").onChange((v) => css.setAccentColor(v)));
    new Setting(el)
      .setName("Font size")
      .addSlider((s) =>
        s
          .setLimits(10, 30, 1)
          .setValue(css.fontSize)
          .onChange((v) => css.setFontSize(v)),
      );
    new Setting(el)
      .setName("Themes")
      .setDesc(css.themes.length ? "Themes installed in this vault (.obsidian/themes)." : "No themes installed. Themes live in .obsidian/themes.")
      .addDropdown((d) => {
        d.addOption("", "Default");
        for (const t of css.themes) d.addOption(t, t);
        d.setValue(css.theme).onChange((v) => css.setTheme(v));
      });
    this.heading("CSS snippets");
    if (!css.snippets.length) new Setting(el).setDesc("No snippets. Put .css files in .obsidian/snippets.");
    for (const s of css.snippets)
      new Setting(el).setName(s).addToggle((t) => t.setValue(css.enabledSnippets.has(s)).onChange((v) => css.setSnippet(s, v)));
    new Setting(el).setName("Reload themes and snippets").addButton((b) => b.setButtonText("Reload").onClick(async () => {
      await css.load();
      this.containerEl.empty();
      this.display();
    }));
    new Setting(el).setName("Window frame style").setDesc("Uses the app's own title bar (hidden frame).");
  }
}

class HotkeysTab extends BuiltinTab {
  display(): void {
    const el = this.containerEl;
    const search = el.createEl("input", { type: "search", placeholder: "Filter...", cls: "bedrock-hotkey-filter" });
    const list = el.createDiv();
    const render = () => {
      list.empty();
      const q = search.value.toLowerCase();
      const cmds = Object.values(this.app.commands.commands as Record<string, any>)
        .filter((c: any) => !q || c.name.toLowerCase().includes(q))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));
      for (const c of cmds as any[]) {
        const s = new Setting(list).setName(c.name);
        const keys = this.app.hotkeyManager.getHotkeys(c.id) ?? c.hotkeys ?? [];
        const kc = s.controlEl.createDiv("setting-command-hotkeys");
        for (const k of keys) kc.createSpan({ cls: "setting-hotkey", text: hotkeyLabel(k.modifiers, k.key) });
        s.addExtraButton((b) =>
          b
            .setIcon("plus-circle")
            .setTooltip("Customize this command")
            .onClick(() => {
              const span = kc.createSpan({ cls: "setting-hotkey mod-active", text: "Press hotkey..." });
              const onKey = (e: KeyboardEvent) => {
                if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
                e.preventDefault();
                e.stopPropagation();
                document.removeEventListener("keydown", onKey, true);
                if (e.key === "Escape") {
                  span.remove();
                  return;
                }
                const hk = { modifiers: eventModifiers(e), key: normaliseKey(e) };
                this.app.hotkeyManager.setHotkeys(c.id, [...(this.app.hotkeyManager.getHotkeys(c.id) ?? c.hotkeys ?? []), hk]);
                render();
              };
              document.addEventListener("keydown", onKey, true);
            }),
        );
        if (this.app.hotkeyManager.getHotkeys(c.id))
          s.addExtraButton((b) =>
            b
              .setIcon("rotate-ccw")
              .setTooltip("Restore default")
              .onClick(() => {
                this.app.hotkeyManager.removeHotkeys(c.id);
                render();
              }),
          );
      }
    };
    search.addEventListener("input", render);
    render();
  }
}

class CorePluginsTab extends BuiltinTab {
  display(): void {
    const el = this.containerEl;
    el.createEl("p", { cls: "setting-item-description", text: "Core plugins come with the app. Some are still being built." });
    for (const [id, p] of Object.entries(this.app.internalPlugins.plugins as Record<string, any>)) {
      new Setting(el)
        .setName(p.name)
        .setDesc(p.description + (p.available ? "" : " (coming soon)"))
        .addToggle((t) => t.setValue(p.enabled).setDisabled(!p.available).onChange((v) => this.app.internalPlugins.setEnabled(id, v)));
    }
  }
}

class CommunityPluginsTab extends BuiltinTab {
  display(): void {
    const el = this.containerEl;
    const pm = this.app.plugins;
    new Setting(el)
      .setName("Turn on community plugins")
      .setDesc("Community plugins are made by other people and can read and change any file in this vault. Only turn them on for plugins you trust.")
      .addToggle((t) =>
        t.setValue(pm.isEnabled()).onChange(async (v) => {
          pm.setEnabled(v);
          if (v) for (const id of pm.enabledPlugins) await pm.loadPlugin(id);
          else for (const id of Object.keys(pm.plugins)) await pm.unloadPlugin(id);
          this.containerEl.empty();
          this.display();
        }),
      );
    this.heading("Installed plugins");
    const ids = Object.keys(pm.manifests);
    if (!ids.length) new Setting(el).setDesc("No plugins installed in this vault (.obsidian/plugins).");
    for (const id of ids) {
      const m = pm.manifests[id];
      new Setting(el)
        .setName(m.name)
        .setDesc(`${m.version} by ${m.author}. ${m.description}`)
        .addToggle((t) =>
          t
            .setValue(pm.enabledPlugins.has(id))
            .setDisabled(!pm.isEnabled())
            .onChange((v) => (v ? pm.enablePluginAndSave(id) : pm.disablePluginAndSave(id))),
        );
    }
    new Setting(el).setName("Browse community plugins").setDesc("The in-app plugin browser is coming in a later version.");
  }
}

export function createSettingsModal(app: any): SettingsModal {
  const m = new SettingsModal(app);
  m.addSettingTab(new GeneralTab(app, "about", "General", "settings"));
  m.addSettingTab(new EditorTab(app, "editor", "Editor", "pencil"));
  m.addSettingTab(new FilesTab(app, "file", "Files and links", "folder"));
  m.addSettingTab(new AppearanceTab(app, "appearance", "Appearance", "palette"));
  m.addSettingTab(new HotkeysTab(app, "hotkeys", "Hotkeys", "keyboard"));
  m.addSettingTab(new CorePluginsTab(app, "plugins", "Core plugins", "box"));
  m.addSettingTab(new CommunityPluginsTab(app, "community-plugins", "Community plugins", "puzzle"));
  void setIcon;
  return m;
}
