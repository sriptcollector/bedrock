// Settings › Files and links
import { BuiltinTab, appSettings } from "./base";
import { SettingPage, SettingGroup } from "../render";
import type { Setting } from "../../ui/setting";
import { fileCombobox } from "../render";
import { FolderSuggest } from "../suggest";

/** attachmentFolderPath encodes the dropdown: "/" vault root, "./" same folder, "./x" subfolder, "x" folder. */
export function attachmentMode(p: string | undefined): "root" | "current" | "subfolder" | "folder" {
  if (!p || p === "/") return "root";
  if (p === "./" || p === ".") return "current";
  if (p.startsWith("./")) return "subfolder";
  return "folder";
}

export class FilesTab extends BuiltinTab {
  constructor(app: any) {
    super(app, "file", "Files and links", "folder-cog");
  }
  getControlValue(key: string): unknown {
    const v = this.app.vault;
    switch (key) {
      case "openBehaviorMode": {
        const b: string = v.getConfig("openBehavior") || "";
        return b.startsWith("file:") ? "file" : b;
      }
      case "attachmentMode":
        return attachmentMode(v.getConfig("attachmentFolderPath"));
      case "attachmentFolder": {
        const p = v.getConfig("attachmentFolderPath") || "";
        return attachmentMode(p) === "folder" ? p : "";
      }
      case "attachmentSubfolder": {
        const p = v.getConfig("attachmentFolderPath") || "";
        return attachmentMode(p) === "subfolder" ? p.slice(2) : "";
      }
      case "useWikilinks":
        return !v.getConfig("useMarkdownLinks");
      case "newFileFolderPath": {
        const p = v.getConfig("newFileFolderPath");
        return p === "/" ? "" : p;
      }
    }
    return super.getControlValue(key);
  }
  setControlValue(key: string, value: any): void {
    const v = this.app.vault;
    switch (key) {
      case "openBehaviorMode":
        v.setConfig("openBehavior", value === "file" ? "file:" : value || undefined);
        return this.rerender();
      case "attachmentMode":
        v.setConfig("attachmentFolderPath", value === "root" ? "/" : value === "current" ? "./" : value === "subfolder" ? "./attachments" : "Attachments");
        return this.rerender();
      case "attachmentFolder":
        v.setConfig("attachmentFolderPath", String(value || "").replace(/^\/+|\/+$/g, "") || "/");
        return;
      case "attachmentSubfolder":
        v.setConfig("attachmentFolderPath", "./" + (String(value || "").replace(/^\/+|\/+$/g, "") || "attachments"));
        return;
      case "useWikilinks":
        v.setConfig("useMarkdownLinks", !value);
        return;
      case "newFileLocation":
        super.setControlValue(key, value);
        return this.rerender();
      case "newFileFolderPath":
        v.setConfig("newFileFolderPath", String(value || "").replace(/^\/+|\/+$/g, "") || "/");
        return;
    }
    super.setControlValue(key, value);
  }
  getSettingDefinitions(): any[] {
    const app = this.app;
    const v = app.vault;
    const folderPh = "Example: folder 1/folder 2";
    return [
      {
        name: "Default file to open",
        desc: "What to show when the app starts.",
        control: { type: "dropdown", key: "openBehaviorMode", options: { "": "Last opened", new: "New note", file: "Specific file", daily: "Daily note" } },
      },
      {
        name: "File to open",
        desc: "The note to open when the app starts.",
        visible: () => (v.getConfig("openBehavior") || "").startsWith("file:"),
        render: (s: Setting) => {
          const cur = (v.getConfig("openBehavior") || "").slice(5);
          fileCombobox(app, s.controlEl, cur, "No file selected", undefined, (p) => v.setConfig("openBehavior", "file:" + p));
        },
      },
      { name: "Always focus new tabs", desc: "Switch to a tab as soon as it opens, instead of opening it in the background.", control: { type: "toggle", key: "focusNewTab" } },
      {
        name: "Default location for new notes",
        desc: "Where new notes are created. Templates and plugins may use their own folder.",
        control: { type: "dropdown", key: "newFileLocation", options: { root: "Vault folder", current: "Same folder as current file", folder: "In the folder specified below" } },
      },
      {
        name: "Folder to create new notes in",
        desc: "New notes go into this folder.",
        visible: () => v.getConfig("newFileLocation") === "folder",
        control: { type: "folder", key: "newFileFolderPath", placeholder: folderPh },
      },
      {
        name: "Default location for new attachments",
        desc: "Where pasted and dropped files are saved.",
        control: {
          type: "dropdown",
          key: "attachmentMode",
          options: { root: "Vault folder", current: "Same folder as current file", subfolder: "In subfolder under current folder", folder: "In the folder specified below" },
        },
      },
      {
        name: "Attachment folder path",
        desc: "Attachments go into this folder.",
        visible: () => attachmentMode(v.getConfig("attachmentFolderPath")) === "folder",
        control: { type: "folder", key: "attachmentFolder", placeholder: "Attachments" },
      },
      {
        name: "Subfolder name",
        desc: "Attachments go into a folder with this name next to the note, created if needed.",
        visible: () => attachmentMode(v.getConfig("attachmentFolderPath")) === "subfolder",
        control: { type: "text", key: "attachmentSubfolder", placeholder: "Attachments" },
      },
      {
        type: "group",
        heading: "Links",
        items: [
          {
            name: "New link format",
            desc: "How links are written when the app inserts them for you.",
            control: { type: "dropdown", key: "newLinkFormat", options: { shortest: "Shortest path when possible", relative: "Path from current file", absolute: "Path from vault folder" } },
          },
          { name: "Automatically update internal links", desc: "Fix links in other notes when you rename or move a file, without asking first.", control: { type: "toggle", key: "alwaysUpdateLinks" } },
          { name: "Use [[Wikilinks]]", desc: "Insert [[Wikilinks]] for links and embeds. Turn off to insert standard Markdown links instead.", control: { type: "toggle", key: "useWikilinks" } },
          { name: "Show all file types", desc: "List files of every type in the vault, even ones the app can't open.", control: { type: "toggle", key: "showUnsupportedFiles" } },
        ],
      },
      {
        type: "group",
        heading: "Trash",
        items: [
          { name: "Confirm before deleting files", desc: "Ask before a file is deleted.", control: { type: "toggle", key: "promptDelete" } },
          {
            name: "Delete attachments when deleting files",
            desc: "Whether to also delete attachments that no other note uses.",
            control: { type: "dropdown", key: "deleteUnlinkedAttachments", options: { ask: "Ask each time", always: "Always", never: "Never" } },
          },
          {
            name: "Deleted files",
            desc: "Where files go when you delete them.",
            control: {
              type: "dropdown",
              key: "trashOption",
              options: { system: "Move to system trash", local: `Move to ${app.brand.displayName} trash (.trash folder)`, none: "Permanently delete" },
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Advanced",
        items: [
          {
            type: "page",
            name: "Excluded files",
            desc: "Hide matching files from search, the graph, link suggestions and the quick switcher.",
            displayValue: () => {
              const n = (v.getConfig("userIgnoreFilters") ?? []).length;
              return n ? `${n} excluded` : "";
            },
            page: () => new ExcludedFilesPage(app),
          },
          {
            name: "Override config folder",
            desc: "Use a different folder than .obsidian for this vault's settings. It must start with a dot. Takes effect after a relaunch.",
            render: (s: Setting) => {
              const initial = app.loadLocalStorage("config") ?? "";
              let relaunch: HTMLElement | null = null;
              s.addText((t) =>
                t
                  .setPlaceholder(".obsidian")
                  .setValue(initial)
                  .onChange((val) => {
                    const ok = !val || /^\.[^/\\]+$/.test(val);
                    s.settingEl.toggleClass("has-error", !ok);
                    if (ok) app.saveLocalStorage("config", val || null);
                    relaunch?.toggle(ok && val !== initial);
                  }),
              );
              relaunch = s.controlEl.createEl("button", { cls: "mod-cta", text: "Relaunch" });
              relaunch.addEventListener("click", () => appSettings.relaunch());
              relaunch.hide();
            },
          },
          { name: "Allow URI callbacks", desc: "Let other apps that open links into this app get a link back to the result (x-callback-url).", control: { type: "toggle", key: "uriCallbacks" } },
          {
            name: "Rebuild vault cache",
            desc: "Read every file again and rebuild the index of links, tags and headings. Try this if links or search seem out of date.",
            render: (s: Setting) =>
              s.addButton((b) =>
                b.setButtonText("Rebuild").onClick(async () => {
                  const ok = await app.ui.confirm({ title: "Rebuild vault cache", body: "The window will reload and index your vault again. This can take a moment for large vaults.", cta: "Rebuild" });
                  if (ok) app.native.windowControl("reload");
                }),
              ),
          },
        ],
      },
    ];
  }
}

/** Files and links › Excluded files */
class ExcludedFilesPage extends SettingPage {
  constructor(private app: any) {
    super();
    this.title = "Excluded files";
  }
  private get filters(): string[] {
    return [...(this.app.vault.getConfig("userIgnoreFilters") ?? [])];
  }
  private save(l: string[]): void {
    this.app.vault.setConfig("userIgnoreFilters", l.length ? l : undefined);
  }
  display(): void {
    const el = this.containerEl;
    el.empty();
    const g = new SettingGroup(el).addClass("mod-list", "mod-no-icon");
    g.setHeading("Excluded paths");
    const list = this.filters;
    if (!list.length) {
      g.addSetting((s) => s.setClass("mod-empty-state").setName("Nothing is excluded. Add a folder, a file, or a /regular expression/ below."));
    }
    list.forEach((f, i) =>
      g.addSetting((s) =>
        s.setName(f).addExtraButton((b) =>
          b
            .setIcon("trash-2")
            .setTooltip("Delete")
            .onClick(() => {
              this.save(list.filter((_, j) => j !== i));
              this.display();
            }),
        ),
      ),
    );
    const add = new SettingGroup(el);
    add.addSetting((s) => {
      s.setName("Add excluded path").setDesc("A folder or file path, or a pattern between slashes like /\\.png$/.");
      let val = "";
      s.addText((t) => {
        t.setPlaceholder("Folder/subfolder").onChange((x) => (val = x));
        new FolderSuggest(this.app, t.inputEl).onSelect((x) => {
          t.setValue(x);
          val = x;
        });
      });
      s.addButton((b) =>
        b
          .setButtonText("Add")
          .setCta()
          .onClick(() => {
            const v = val.trim();
            if (!v || list.includes(v)) return;
            this.save([...list, v]);
            this.display();
          }),
      );
    });
  }
}
