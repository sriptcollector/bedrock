// Templates core plugin: "Insert template" (picker of notes in the template folder), "Insert
// current date" / "Insert current time". Template properties are merged into the note's
// properties; the body goes in at the cursor. Options: folder, dateFormat, timeFormat
// (.obsidian/templates.json).
import moment from "moment";
import { FuzzySuggestModal } from "../../ui/modal";
import { Notice } from "../../ui/notice";
import { getFrontMatterInfo, parseYaml } from "../../../core/parse";
import { applyTemplate, DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT } from "./format";
import { CoreOptionsTab, cleanFolder } from "../shared";
import type { CorePluginImpl, InternalPlugin } from "../manager";

export function templateVarsFor(app: any, file: any): Record<string, string> {
  return { title: file?.basename ?? "" };
}

export function templateOptions(app: any): { dateFormat: string; timeFormat: string } {
  const o = app.internalPlugins?.getEnabledPluginById?.("templates")?.options ?? {};
  return { dateFormat: o.dateFormat || DEFAULT_DATE_FORMAT, timeFormat: o.timeFormat || DEFAULT_TIME_FORMAT };
}

/** Merge template properties into a note: lists are combined, missing keys added. */
export function mergeProperties(target: Record<string, any>, add: Record<string, any>): void {
  for (const [k, v] of Object.entries(add ?? {})) {
    if (!(k in target) || target[k] === null || target[k] === undefined || target[k] === "") target[k] = v;
    else if (Array.isArray(target[k]) || Array.isArray(v)) {
      const a = Array.isArray(target[k]) ? target[k] : [target[k]];
      const b = Array.isArray(v) ? v : [v];
      target[k] = [...a, ...b.filter((x: any) => !a.some((y: any) => JSON.stringify(y) === JSON.stringify(x)))];
    }
  }
}

/** Insert a template into the active editor (frontmatter merged, body at the cursor). */
export async function insertTemplateInto(app: any, template: any, view: any): Promise<void> {
  const editor = view?.editor;
  const file = view?.file;
  if (!editor || !file) {
    new Notice("Open a note to insert a template into.");
    return;
  }
  const raw = await app.vault.read(template);
  const text = applyTemplate(raw, templateVarsFor(app, file), { ...templateOptions(app), date: moment() });
  const fm = getFrontMatterInfo(text);
  let body = text;
  if (fm.exists) {
    body = text.slice(fm.contentStart);
    let props: any = null;
    try {
      props = parseYaml(fm.frontmatter);
    } catch {
      props = null;
    }
    if (props && typeof props === "object" && Object.keys(props).length) {
      // Insert the body first (cursor positions refer to the current text), then merge properties.
      editor.replaceSelection(body);
      await (view.save?.() ?? Promise.resolve());
      await app.fileManager.processFrontMatter(file, (target: any) => mergeProperties(target, props));
      return;
    }
  }
  editor.replaceSelection(body);
}

class TemplatePicker extends FuzzySuggestModal<any> {
  constructor(app: any, private files: any[], private folder: string, private onPick: (f: any) => void) {
    super(app);
    this.setPlaceholder("Type to search for a template...");
    this.emptyStateText = "No templates found.";
  }
  getItems(): any[] {
    return this.files;
  }
  getItemText(f: any): string {
    const p: string = f.path.replace(/\.md$/, "");
    return this.folder && p.startsWith(this.folder + "/") ? p.slice(this.folder.length + 1) : p;
  }
  onChooseItem(f: any): void {
    this.onPick(f);
  }
}

export function templateFiles(app: any, folder: string): any[] {
  const f = cleanFolder(folder);
  const root = f ? app.vault.getFolderByPath(f) : null;
  if (!root) return [];
  const out: any[] = [];
  const walk = (dir: any) => {
    for (const c of dir.children) {
      if (c.children) walk(c);
      else if (c.extension === "md") out.push(c);
    }
  };
  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function openTemplatePicker(app: any, onPick: (f: any) => void): void {
  const folder = cleanFolder(app.internalPlugins.getEnabledPluginById("templates")?.options?.folder);
  if (!folder) {
    new Notice("Choose a template folder first in Settings › Templates.");
    app.setting.openTabById("templates");
    return;
  }
  if (!app.vault.getFolderByPath(folder)) {
    new Notice(`The template folder “${folder}” doesn't exist.`);
    return;
  }
  new TemplatePicker(app, templateFiles(app, folder), folder, onPick).open();
}

class TemplatesTab extends CoreOptionsTab {
  getSettingDefinitions(): any[] {
    const sample = (fmt: string, dflt: string) => moment().format(fmt || dflt);
    return [
      { name: "Template folder location", desc: "Notes in this folder are offered as templates.", control: { type: "folder", key: "folder", placeholder: "Example: folder 1/folder 2" } },
      {
        name: "Date format",
        desc: `Format for {{date}}. Right now it gives: ${sample(this.plugin.options.dateFormat, DEFAULT_DATE_FORMAT)}`,
        control: { type: "text", key: "dateFormat", placeholder: DEFAULT_DATE_FORMAT },
      },
      {
        name: "Time format",
        desc: `Format for {{time}}. Right now it gives: ${sample(this.plugin.options.timeFormat, DEFAULT_TIME_FORMAT)}`,
        control: { type: "text", key: "timeFormat", placeholder: DEFAULT_TIME_FORMAT },
      },
    ];
  }
}

export const templatesPlugin: CorePluginImpl = {
  id: "templates",
  defaultOptions: {},
  onEnable(p: InternalPlugin) {
    const app = p.app;
    const insert = () => {
      const view = app.workspace.activeEditor;
      openTemplatePicker(app, (f) => insertTemplateInto(app, f, view));
    };
    p.addCommand({
      id: "insert-template",
      name: "Templates: Insert template",
      icon: "files",
      editorCheckCallback: (checking: boolean) => {
        if (checking) return true;
        insert();
      },
    });
    p.addCommand({
      id: "insert-current-date",
      name: "Templates: Insert current date",
      editorCallback: (editor: any) => editor.replaceSelection(moment().format(templateOptions(app).dateFormat)),
    });
    p.addCommand({
      id: "insert-current-time",
      name: "Templates: Insert current time",
      editorCallback: (editor: any) => editor.replaceSelection(moment().format(templateOptions(app).timeFormat)),
    });
    p.addRibbonIcon("files", "Insert template", () => {
      if (!app.workspace.activeEditor?.editor) {
        new Notice("Open a note to insert a template into.");
        return;
      }
      insert();
    });
    // Obsidian-compatible instance methods (used by some plugins).
    p.instance.insertTemplate = (f: any) => insertTemplateInto(app, f, app.workspace.activeEditor);
    p.instance.getDefaultFolder = () => cleanFolder(p.options.folder);
  },
  settingTab: (p) => new TemplatesTab(p),
};
