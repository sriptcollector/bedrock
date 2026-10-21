// Unique note creator (zk-prefixer): notes named with a time stamp (default YYYYMMDDHHmm), in a
// folder, from a template. Options in .obsidian/zk-prefixer.json {format, folder, template}.
import moment from "moment";
import { Notice } from "../../ui/notice";
import { applyTemplate, DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT } from "../templates/format";
import { CoreOptionsTab, cleanFolder, ensureFolder, readTemplateFile, openFile } from "../shared";
import { fileCombobox } from "../../settings/render";
import type { CorePluginImpl, InternalPlugin } from "../manager";
import type { Setting } from "../../ui/setting";

export const DEFAULT_ZK_FORMAT = "YYYYMMDDHHmm";

/** A free path "<folder>/<stamp>.md"; if taken, the stamp moves forward a minute at a time. */
export function uniqueNotePath(exists: (p: string) => boolean, folder: string, format: string, now = moment()): string {
  const f = cleanFolder(folder);
  const t = now.clone();
  for (let i = 0; i < 1000; i++) {
    const p = (f ? f + "/" : "") + t.format(format || DEFAULT_ZK_FORMAT) + ".md";
    if (!exists(p)) return p;
    t.add(1, format.includes("s") ? "second" : "minute");
  }
  return (f ? f + "/" : "") + t.format(format) + " " + Date.now() + ".md";
}

async function createUniqueNote(app: any, open: boolean): Promise<any> {
  const o = app.internalPlugins.getEnabledPluginById("zk-prefixer")?.options ?? {};
  const folder = o.folder !== undefined && o.folder !== "" ? cleanFolder(o.folder) : app.fileManager.getNewFileParent(app.workspace.getActiveFile()?.path ?? "").path.replace(/^\/$/, "");
  const path = uniqueNotePath((p) => !!app.vault.getAbstractFileByPath(p), folder, o.format || DEFAULT_ZK_FORMAT);
  await ensureFolder(app, path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
  let text = "";
  if (o.template) {
    const t = await readTemplateFile(app, o.template);
    if (t) {
      const tpl = app.internalPlugins.getEnabledPluginById("templates")?.options ?? {};
      text = applyTemplate(t.text, { title: path.split("/").pop()!.replace(/\.md$/, "") }, { dateFormat: tpl.dateFormat || DEFAULT_DATE_FORMAT, timeFormat: tpl.timeFormat || DEFAULT_TIME_FORMAT });
    } else new Notice(`The template “${o.template}” wasn't found.`);
  }
  const file = await app.vault.create(path, text);
  if (open) await openFile(app, file, false, { state: { mode: "source" }, eState: { rename: "all" } });
  return file;
}

class ZkTab extends CoreOptionsTab {
  getSettingDefinitions(): any[] {
    const o = this.plugin.options;
    return [
      { name: "New file location", desc: "Unique notes are created in this folder. Leave empty to use the default location for new notes.", control: { type: "folder", key: "folder", placeholder: "Example: folder 1/folder 2" } },
      {
        name: "Template file location",
        desc: "The note to copy into each new unique note.",
        render: (s: Setting) => fileCombobox(this.app, s.controlEl, o.template || "", "No file selected", undefined, (p) => this.plugin.setOption("template", p ? p.replace(/\.md$/, "") : undefined)),
      },
      {
        name: "Unique prefix format",
        desc: `The time stamp used as the note name. Right now it gives: ${moment().format(o.format || DEFAULT_ZK_FORMAT)}`,
        control: { type: "text", key: "format", placeholder: DEFAULT_ZK_FORMAT },
      },
    ];
  }
}

export const zkPrefixerPlugin: CorePluginImpl = {
  id: "zk-prefixer",
  onEnable(p: InternalPlugin) {
    const app = p.app;
    p.addCommand({ id: "zk-prefixer", name: "Unique note creator: Create new unique note", icon: "sheets-in-box", callback: () => createUniqueNote(app, true) });
    p.addCommand({
      id: "insert-unique-link",
      name: "Unique note creator: Add unique internal link",
      editorCallback: async (editor: any, view: any) => {
        const f = await createUniqueNote(app, false);
        editor.replaceSelection(app.fileManager.generateMarkdownLink(f, view?.file?.path ?? ""));
      },
    });
    p.addRibbonIcon("sheets-in-box", "Create new unique note", () => createUniqueNote(app, true));
    if (app.protocolHandlers) {
      app.protocolHandlers.unique = async (params: any) => {
        const f = await createUniqueNote(app, !params?.silent);
        if (params?.content || params?.clipboard) await app.vault.modify(f, params.clipboard ? await navigator.clipboard.readText() : params.content);
      };
      p.register(() => delete app.protocolHandlers.unique);
    }
  },
  settingTab: (p) => new ZkTab(p),
};
