// Daily notes core plugin: open (create) today's note named with a moment format, in a folder, from
// a template; previous / next existing daily note. Options in .obsidian/daily-notes.json:
// {format, folder, template, autorun(legacy → app.json openBehavior "daily")}.
import moment from "moment";
import { Notice } from "../../ui/notice";
import { normalizePath } from "../../../core/path";
import { applyTemplate, DEFAULT_TIME_FORMAT } from "../templates/format";
import { CoreOptionsTab, cleanFolder, ensureFolder, readTemplateFile, openFile } from "../shared";
import { fileCombobox } from "../../settings/render";
import type { CorePluginImpl, InternalPlugin } from "../manager";
import type { Setting } from "../../ui/setting";

export const DEFAULT_DAILY_FORMAT = "YYYY-MM-DD";

export function dailyNotePath(options: { format?: string; folder?: string }, date: moment.Moment): string {
  const fmt = options.format || DEFAULT_DAILY_FORMAT;
  const folder = cleanFolder(options.folder);
  const name = date.format(fmt);
  return normalizePath((folder ? folder + "/" : "") + name + ".md");
}

/** Date of a daily note from its path, or null when it doesn't match the format. */
export function dailyNoteDate(options: { format?: string; folder?: string }, path: string): moment.Moment | null {
  const fmt = options.format || DEFAULT_DAILY_FORMAT;
  const folder = cleanFolder(options.folder);
  let rel = path.replace(/\.md$/, "");
  if (folder) {
    if (!rel.startsWith(folder + "/")) return null;
    rel = rel.slice(folder.length + 1);
  } else if (rel.includes("/") && !fmt.includes("/")) return null;
  const m = moment(rel, fmt, true);
  return m.isValid() ? m : null;
}

export async function openDailyNote(app: any, date: moment.Moment = moment(), newLeaf: boolean | "tab" = false): Promise<any> {
  const o = app.internalPlugins.getEnabledPluginById("daily-notes")?.options ?? {};
  const path = dailyNotePath(o, date);
  let file = app.vault.getFileByPath(path);
  if (!file) {
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    await ensureFolder(app, dir);
    let text = "";
    if (o.template) {
      const t = await readTemplateFile(app, o.template);
      if (!t) new Notice(`The daily note template “${o.template}” wasn't found, so the note starts empty.`);
      else {
        const title = path.split("/").pop()!.replace(/\.md$/, "");
        const tplOpts = app.internalPlugins.getEnabledPluginById("templates")?.options ?? {};
        // {{time}} is the time the note is made; {{date}} is the note's own date.
        const pre = t.text.replace(/{{time}}/gi, () => moment().format(tplOpts.timeFormat || DEFAULT_TIME_FORMAT));
        text = applyTemplate(pre, { title }, { date, dateFormat: o.format || DEFAULT_DAILY_FORMAT, timeFormat: tplOpts.timeFormat || DEFAULT_TIME_FORMAT });
      }
    }
    try {
      file = await app.vault.create(path, text);
    } catch (e: any) {
      new Notice(`Couldn't create the daily note “${path}”: ${e?.message ?? e}`);
      return null;
    }
  }
  await openFile(app, file, newLeaf);
  return file;
}

/** All existing daily notes, sorted by date. */
export function allDailyNotes(app: any): { file: any; date: moment.Moment }[] {
  const o = app.internalPlugins.getEnabledPluginById("daily-notes")?.options ?? {};
  const out: { file: any; date: moment.Moment }[] = [];
  for (const f of app.vault.getMarkdownFiles()) {
    const d = dailyNoteDate(o, f.path);
    if (d) out.push({ file: f, date: d });
  }
  return out.sort((a, b) => a.date.valueOf() - b.date.valueOf());
}

async function gotoAdjacent(app: any, dir: 1 | -1): Promise<void> {
  const o = app.internalPlugins.getEnabledPluginById("daily-notes")?.options ?? {};
  const cur = app.workspace.getActiveFile();
  const d = cur ? dailyNoteDate(o, cur.path) : null;
  if (!d) return;
  const list = allDailyNotes(app);
  const target = dir > 0 ? list.find((x) => x.date.isAfter(d, "day")) : [...list].reverse().find((x) => x.date.isBefore(d, "day"));
  if (!target) {
    new Notice(dir > 0 ? "There's no later daily note." : "There's no earlier daily note.");
    return;
  }
  await openFile(app, target.file);
}

const PRESETS = ["YYYY-MM-DD", "YYYY.MM.DD", "YYYY/MM/DD", "YYYY/MM/YYYY-MM-DD"];

class DailyNotesTab extends CoreOptionsTab {
  private custom = false;
  getSettingDefinitions(): any[] {
    const o = this.plugin.options;
    const fmt = o.format || DEFAULT_DAILY_FORMAT;
    const isCustom = this.custom || !PRESETS.includes(fmt);
    const options: Record<string, string> = {};
    for (const p of PRESETS) options[p] = moment().format(p);
    options.custom = "Custom";
    return [
      {
        name: "Date format",
        desc: "How daily notes are named. Slashes make folders.",
        render: (s: Setting) =>
          s.addDropdown((d) =>
            d
              .addOptions(options)
              .setValue(isCustom ? "custom" : fmt)
              .onChange((v) => {
                this.custom = v === "custom";
                if (!this.custom) this.plugin.setOption("format", v === DEFAULT_DAILY_FORMAT ? undefined : v);
                this.rerender();
              }),
          ),
      },
      {
        name: "Custom format",
        desc: (() => {
          const f = document.createDocumentFragment();
          f.appendText("Any moment.js format. See the ");
          const a = f.createEl("a", { text: "format reference", href: "https://momentjs.com/docs/#/displaying/format/" });
          a.addEventListener("click", (e) => {
            e.preventDefault();
            this.app.openExternal("https://momentjs.com/docs/#/displaying/format/");
          });
          f.appendText(".");
          f.createEl("br");
          f.appendText("Today's note would be called: ");
          f.createEl("b", { cls: "u-pop", text: moment().format(fmt) });
          return f;
        })(),
        render: (s: Setting) =>
          s.addText((t) =>
            t
              .setPlaceholder(DEFAULT_DAILY_FORMAT)
              .setValue(fmt)
              .onChange((v) => {
                this.plugin.setOption("format", v && v !== DEFAULT_DAILY_FORMAT ? v : undefined);
                const b = s.descEl.querySelector("b");
                b?.setText(moment().format(v || DEFAULT_DAILY_FORMAT));
              }),
          ),
      },
      { name: "New file location", desc: "Daily notes are created in this folder.", control: { type: "folder", key: "folder", placeholder: "Example: folder 1/folder 2" } },
      {
        name: "Template file location",
        desc: "The note to copy into each new daily note.",
        render: (s: Setting) => {
          const err = s.controlEl.createDiv({ cls: "setting-item-error-text mod-warning" });
          const check = (p: string) => {
            const ok = !p || !!this.app.vault.getFileByPath(cleanFolder(p)) || !!this.app.vault.getFileByPath(cleanFolder(p) + ".md");
            err.setText(ok ? "" : "File not found.");
          };
          fileCombobox(this.app, s.controlEl, o.template || "", "No file selected", undefined, (p) => {
            this.plugin.setOption("template", p ? p.replace(/\.md$/, "") : undefined);
            check(p);
          });
          s.controlEl.appendChild(err);
          s.controlEl.addClass("mod-stacked");
          check(o.template || "");
        },
      },
    ];
  }
}

export const dailyNotesPlugin: CorePluginImpl = {
  id: "daily-notes",
  defaultOptions: {},
  async onEnable(p: InternalPlugin) {
    const app = p.app;
    // Legacy "open on startup" moved to Files and links › Default file to open.
    if (p.options.autorun) {
      if (!app.vault.getConfig("openBehavior")) app.vault.setConfig("openBehavior", "daily");
      delete p.options.autorun;
      await p.saveData();
    }
    p.addCommand({ id: "daily-notes", name: "Daily notes: Open today's daily note", icon: "calendar", callback: () => openDailyNote(app) });
    p.addCommand({ id: "daily-notes:goto-prev", name: "Daily notes: Open previous daily note", icon: "chevron-left", callback: () => gotoAdjacent(app, -1) });
    p.addCommand({ id: "daily-notes:goto-next", name: "Daily notes: Open next daily note", icon: "chevron-right", callback: () => gotoAdjacent(app, 1) });
    p.addRibbonIcon("calendar", "Open today's daily note", (e: MouseEvent) => openDailyNote(app, moment(), e.ctrlKey || e.metaKey ? "tab" : false));
    // Obsidian-compatible instance API (calendar-style plugins call these).
    p.instance.getFormat = () => p.options.format || DEFAULT_DAILY_FORMAT;
    p.instance.getFolder = () => cleanFolder(p.options.folder);
    p.instance.getDailyNote = (d?: moment.Moment) => openDailyNote(app, d ?? moment());
    p.instance.onOpenDailyNote = (e?: MouseEvent) => openDailyNote(app, moment(), !!(e && (e.ctrlKey || e.metaKey)) && "tab");
    p.instance.iterateDailyNotes = (cb: (file: any, date: moment.Moment) => any) => {
      for (const x of allDailyNotes(app)) cb(x.file, x.date);
    };
    p.instance.gotoPreviousExisting = () => gotoAdjacent(app, -1);
    p.instance.gotoNextExisting = () => gotoAdjacent(app, 1);
    // URI action obsidian://daily (registered if the app has a protocol handler table).
    if (app.protocolHandlers) {
      app.protocolHandlers.daily = async (params: any) => {
        const file = await openDailyNote(app, moment(), params?.paneType ?? false);
        if (file && (params?.content || params?.clipboard)) {
          const content = params.clipboard ? await navigator.clipboard.readText() : params.content;
          await app.vault.process(file, (t: string) => (params.prepend ? content + "\n" + t : t + (t && !t.endsWith("\n") ? "\n" : "") + content));
        }
      };
      p.register(() => delete app.protocolHandlers.daily);
    }
  },
  settingTab: (p) => new DailyNotesTab(p),
};
