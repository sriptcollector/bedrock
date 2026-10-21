// Note composer: merge the current note into another note; extract the selection or the current
// heading section into a new (or existing) note, leaving a link, an embed or nothing behind.
// Options in .obsidian/note-composer.json {replacementText: "link"|"embed"|"none", template, askBeforeMerging}.
import { SuggestModal } from "../../ui/modal";
import { Notice } from "../../ui/notice";
import { prepareFuzzySearch, renderResults } from "../../ui/search";
import { getFrontMatterInfo, parseYaml } from "../../../core/parse";
import { applyTemplate } from "../templates/format";
import { CoreOptionsTab, readTemplateFile, cleanFolder } from "../shared";
import { fileCombobox } from "../../settings/render";
import { mergeProperties, templateOptions } from "../templates";
import type { CorePluginImpl, InternalPlugin } from "../manager";
import type { Setting } from "../../ui/setting";

interface Target {
  file: any | null;
  name: string;
  match?: any;
}

class TargetPicker extends SuggestModal<Target> {
  constructor(app: any, private exclude: any, private allowCreate: boolean, private onPick: (t: Target) => void, placeholder: string) {
    super(app);
    this.setPlaceholder(placeholder);
    this.emptyStateText = "No notes found.";
  }
  getSuggestions(q: string): Target[] {
    const files = this.app.vault.getMarkdownFiles().filter((f: any) => f !== this.exclude);
    const query = q.trim();
    let out: Target[];
    if (!query) out = files.sort((a: any, b: any) => b.stat.mtime - a.stat.mtime).slice(0, 50).map((f: any) => ({ file: f, name: f.basename }));
    else {
      const fz = prepareFuzzySearch(query);
      out = files
        .map((f: any) => ({ file: f, name: f.basename, match: fz(f.path.slice(0, -3)) }))
        .filter((x: Target) => x.match)
        .sort((a: Target, b: Target) => b.match.score - a.match.score);
    }
    if (this.allowCreate && query && !files.some((f: any) => f.basename.toLowerCase() === query.toLowerCase())) out.unshift({ file: null, name: query });
    return out;
  }
  renderSuggestion(t: Target, el: HTMLElement): void {
    if (!t.file) {
      el.createDiv({ cls: "suggestion-content", text: t.name });
      el.createDiv("suggestion-aux").createSpan({ cls: "suggestion-hotkey", text: "Create new note" });
      return;
    }
    const c = el.createDiv("suggestion-content");
    if (t.match) renderResults(c.createDiv("suggestion-title"), t.file.path.slice(0, -3), t.match);
    else c.createDiv({ cls: "suggestion-title", text: t.file.path.slice(0, -3) });
  }
  onChooseSuggestion(t: Target): void {
    this.onPick(t);
  }
}

function opts(app: any): { replacementText: string; template?: string; askBeforeMerging: boolean } {
  const o = app.internalPlugins.getEnabledPluginById("note-composer")?.options ?? {};
  return { replacementText: o.replacementText ?? "link", template: o.template, askBeforeMerging: o.askBeforeMerging !== false };
}

/** Text that goes into the target note: the content run through the template if one is set. */
async function composeText(app: any, content: string, fromTitle: string, newTitle: string): Promise<string> {
  const o = opts(app);
  const t = o.template ? await readTemplateFile(app, o.template) : null;
  if (!t) return content;
  return applyTemplate(t.text, { content, fromTitle, newTitle, title: newTitle }, templateOptions(app));
}

/** Append text to a note; properties in `text` are merged into the note's properties. */
async function appendToNote(app: any, file: any, text: string): Promise<void> {
  const fm = getFrontMatterInfo(text);
  let body = text;
  let props: any = null;
  if (fm.exists) {
    body = text.slice(fm.contentStart);
    try {
      props = parseYaml(fm.frontmatter);
    } catch {
      props = null;
    }
  }
  await app.vault.process(file, (cur: string) => (cur.trim() ? cur.replace(/\s*$/, "") + "\n\n" : "") + body.replace(/^\s+/, ""));
  if (props && typeof props === "object") await app.fileManager.processFrontMatter(file, (t: any) => mergeProperties(t, props));
}

async function resolveTarget(app: any, t: Target, sourceFile: any): Promise<any> {
  if (t.file) return t.file;
  const name = t.name.replace(/[\\:*?"<>|]/g, "").trim() || "Untitled";
  const parent = app.fileManager.getNewFileParent(sourceFile?.path ?? "");
  const base = name.includes("/") ? cleanFolder(name) : (parent.isRoot() ? "" : parent.path + "/") + name;
  return app.vault.create(app.vault.getAvailablePath(base, "md"), "");
}

function replacement(app: any, target: any, sourcePath: string): string {
  const r = opts(app).replacementText;
  if (r === "none") return "";
  const link = app.fileManager.generateMarkdownLink(target, sourcePath);
  return r === "embed" ? "!" + link : link;
}

async function mergeFile(app: any, source: any): Promise<void> {
  new TargetPicker(
    app,
    source,
    false,
    async (t) => {
      if (!t.file) return;
      if (opts(app).askBeforeMerging) {
        const ok = await app.ui.confirm({
          title: "Merge notes",
          body: `Add the contents of “${source.basename}” to the end of “${t.file.basename}” and delete “${source.basename}”? Links to it will point to “${t.file.basename}”.`,
          cta: "Merge",
        });
        if (!ok) return;
      }
      const content = await app.vault.read(source);
      await appendToNote(app, t.file, await composeText(app, content, source.basename, t.file.basename));
      // Point links at the merged note, then remove the old one.
      const backlinks: string[] = Object.entries(app.metadataCache.resolvedLinks as Record<string, Record<string, number>>)
        .filter(([, to]) => to[source.path])
        .map(([from]) => from);
      for (const from of backlinks) {
        const f = app.vault.getFileByPath(from);
        if (!f || f === source) continue;
        await app.vault.process(f, (text: string) =>
          text.replace(/(!?)\[\[([^\]|#^]+)([#^][^\]|]*)?(\|[^\]]*)?\]\]/g, (m: string, bang: string, link: string, sub = "", alias = "") => {
            const dest = app.metadataCache.getFirstLinkpathDest(link.trim(), from);
            return dest === source ? `${bang}[[${app.metadataCache.fileToLinktext(t.file, from)}${sub}${alias}]]` : m;
          }),
        );
      }
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(t.file);
      await app.vault.trash(source, app.vault.getConfig("trashOption") !== "local").catch(() => app.vault.delete(source));
      new Notice(`Merged “${source.basename}” into “${t.file.basename}”.`);
    },
    "Choose a note to merge into...",
  ).open();
}

async function extract(app: any, editor: any, view: any, range: { from: any; to: any } | null, suggestedName: string): Promise<void> {
  const source = view.file;
  if (!range) return;
  const content = editor.getRange(range.from, range.to);
  if (!content.trim()) {
    new Notice("Select some text to extract first.");
    return;
  }
  const picker = new TargetPicker(
    app,
    source,
    true,
    async (t) => {
      const target = await resolveTarget(app, t, source);
      await appendToNote(app, target, await composeText(app, content, source.basename, target.basename));
      editor.replaceRange(replacement(app, target, source.path), range.from, range.to);
      new Notice(t.file ? `Moved the text to “${target.basename}”.` : `Created “${target.basename}”.`);
    },
    "Name the new note, or choose one to add the text to...",
  );
  picker.open();
  if (suggestedName) {
    picker.inputEl.value = suggestedName;
    picker.inputEl.dispatchEvent(new Event("input"));
    picker.inputEl.select();
  }
}

/** Range of the heading section the cursor is in (heading line to the next heading of the same or higher level). */
export function headingSection(lines: string[], cursorLine: number): { start: number; end: number; level: number; title: string } | null {
  let start = -1,
    level = 0;
  for (let i = cursorLine; i >= 0; i--) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (m) {
      start = i;
      level = m[1].length;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s/.exec(lines[i]);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  const title = /^(#{1,6})\s+(.*)$/.exec(lines[start])![2].replace(/\s+#+\s*$/, "").trim();
  return { start, end, level, title };
}

class ComposerTab extends CoreOptionsTab {
  getSettingDefinitions(): any[] {
    const o = this.plugin.options;
    return [
      {
        name: "Text after extraction",
        desc: "What's left in the original note where the text was taken out.",
        control: { type: "dropdown", key: "replacementText", options: { link: "Link to new file", embed: "Embed new file", none: "None" }, defaultValue: "link" },
      },
      {
        name: "Template file location",
        desc: "A note used to wrap merged or extracted text. Use {{content}}, {{fromTitle}} and {{newTitle}}, plus {{date}} and {{time}}.",
        render: (s: Setting) => fileCombobox(this.app, s.controlEl, o.template || "", "No file selected", undefined, (p) => this.plugin.setOption("template", p ? p.replace(/\.md$/, "") : undefined)),
      },
      { name: "Confirm file merge", desc: "Ask before merging, since the merged note is deleted.", control: { type: "toggle", key: "askBeforeMerging", defaultValue: true } },
    ];
  }
}

export const noteComposerPlugin: CorePluginImpl = {
  id: "note-composer",
  defaultOptions: { replacementText: "link", askBeforeMerging: true },
  onEnable(p: InternalPlugin) {
    const app = p.app;
    p.addCommand({
      id: "note-composer:merge-file",
      name: "Note composer: Merge current file with another file...",
      icon: "merge",
      checkCallback: (checking: boolean) => {
        const f = app.workspace.getActiveFile();
        if (!f || f.extension !== "md") return false;
        if (!checking) void mergeFile(app, f);
        return true;
      },
    });
    p.addCommand({
      id: "note-composer:split-file",
      name: "Note composer: Extract current selection...",
      icon: "scissors",
      editorCheckCallback: (checking: boolean, editor: any, view: any) => {
        if (!editor.somethingSelected?.() && !editor.getSelection()) return false;
        if (!checking) {
          const sel = editor.listSelections?.()[0];
          const from = sel ? (cmp(sel.anchor, sel.head) <= 0 ? sel.anchor : sel.head) : editor.getCursor("from");
          const to = sel ? (cmp(sel.anchor, sel.head) <= 0 ? sel.head : sel.anchor) : editor.getCursor("to");
          void extract(app, editor, view, { from, to }, "");
        }
        return true;
      },
    });
    p.addCommand({
      id: "note-composer:extract-heading",
      name: "Note composer: Extract this heading...",
      icon: "heading",
      editorCheckCallback: (checking: boolean, editor: any, view: any) => {
        const lines = editor.getValue().split("\n");
        const sec = headingSection(lines, editor.getCursor().line);
        if (!sec) return false;
        if (!checking) {
          const to = sec.end >= lines.length ? { line: lines.length - 1, ch: lines[lines.length - 1].length } : { line: sec.end, ch: 0 };
          void extract(app, editor, view, { from: { line: sec.start, ch: 0 }, to }, sec.title);
        }
        return true;
      },
    });
  },
  settingTab: (p) => new ComposerTab(p),
};

function cmp(a: { line: number; ch: number }, b: { line: number; ch: number }): number {
  return a.line - b.line || a.ch - b.ch;
}
