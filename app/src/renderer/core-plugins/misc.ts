// Smaller core plugins: Random note, Workspaces, Audio recorder, Format converter, Slash commands,
// Footnotes view, and the options tabs for Quick switcher and Command palette.
import moment from "moment";
import { Modal, FuzzySuggestModal } from "../ui/modal";
import { Notice } from "../ui/notice";
import { Setting } from "../ui/setting";
import { EditorSuggest } from "../editor/suggest";
import { ItemView } from "../workspace/view";
import { CoreOptionsTab } from "./shared";
import type { CorePluginImpl, InternalPlugin } from "./manager";

// ---------------------------------------------------------------- Random note
export const randomNotePlugin: CorePluginImpl = {
  id: "random-note",
  onEnable(p) {
    const app = p.app;
    const open = async (newLeaf = false) => {
      const files = app.vault.getMarkdownFiles();
      const cur = app.workspace.getActiveFile();
      const pool = files.length > 1 ? files.filter((f: any) => f !== cur) : files;
      if (!pool.length) {
        new Notice("There are no notes to choose from.");
        return;
      }
      await app.workspace.getLeaf(newLeaf).openFile(pool[Math.floor(Math.random() * pool.length)]);
    };
    p.addCommand({ id: "random-note", name: "Random note: Open random note", icon: "dice", callback: () => open() });
    p.addRibbonIcon("dice", "Open random note", (e: MouseEvent) => open(e.ctrlKey || e.metaKey));
  },
};

// ---------------------------------------------------------------- Workspaces
interface WorkspacesData {
  workspaces: Record<string, any>;
  active?: string;
}
async function readWorkspaces(app: any): Promise<WorkspacesData> {
  const d = await app.vault.readConfigJson("workspaces");
  return d && typeof d === "object" && d.workspaces ? d : { workspaces: {} };
}
async function writeWorkspaces(app: any, d: WorkspacesData): Promise<void> {
  await app.vault.writeConfigJson("workspaces", d);
}
async function saveWorkspace(app: any, name: string): Promise<void> {
  const d = await readWorkspaces(app);
  const layout = app.workspace.getLayout();
  delete layout.lastOpenFiles;
  d.workspaces[name] = layout;
  d.active = name;
  await writeWorkspaces(app, d);
  new Notice(`Saved the layout as “${name}”.`);
}
async function loadWorkspace(app: any, name: string): Promise<void> {
  const d = await readWorkspaces(app);
  const layout = d.workspaces[name];
  if (!layout) return;
  await app.workspace.changeLayout(layout);
  d.active = name;
  await writeWorkspaces(app, d);
}

class WorkspacesModal extends Modal {
  constructor(app: any, private mode: "manage" | "save-and-load" = "manage") {
    super(app);
    this.modalEl.addClass("mod-workspaces");
  }
  async onOpen(): Promise<void> {
    this.setTitle("Manage workspace layouts");
    const d = await readWorkspaces(this.app);
    const c = this.contentEl;
    c.empty();
    let name = d.active ?? "";
    new Setting(c)
      .setName("Save current layout")
      .setDesc("Save the open tabs and sidebars under a name.")
      .addText((t) => t.setPlaceholder("Name").setValue(this.mode === "manage" ? name : "").onChange((v) => (name = v.trim())))
      .addButton((b) =>
        b
          .setButtonText("Save")
          .setCta()
          .onClick(async () => {
            if (!name) return;
            if (this.mode === "save-and-load" && d.active) await saveWorkspace(this.app, d.active);
            await saveWorkspace(this.app, name);
            void this.onOpen();
          }),
      );
    const names = Object.keys(d.workspaces).sort();
    if (!names.length) c.createDiv({ cls: "setting-item-description", text: "No saved layouts yet." });
    for (const n of names) {
      const s = new Setting(c).setName(n);
      if (n === d.active) s.setDesc("Current layout");
      s.addButton((b) =>
        b.setButtonText("Load").onClick(async () => {
          if (this.mode === "save-and-load" && d.active) await saveWorkspace(this.app, d.active);
          await loadWorkspace(this.app, n);
          this.close();
        }),
      );
      s.addExtraButton((b) =>
        b
          .setIcon("trash-2")
          .setTooltip("Delete")
          .onClick(async () => {
            delete d.workspaces[n];
            if (d.active === n) delete d.active;
            await writeWorkspaces(this.app, d);
            void this.onOpen();
          }),
      );
    }
  }
}

class WorkspacePicker extends FuzzySuggestModal<string> {
  constructor(app: any, private names: string[], private pick: (n: string) => void) {
    super(app);
    this.setPlaceholder("Choose a workspace layout...");
  }
  getItems(): string[] {
    return this.names;
  }
  getItemText(n: string): string {
    return n;
  }
  onChooseItem(n: string): void {
    this.pick(n);
  }
}

export const workspacesPlugin: CorePluginImpl = {
  id: "workspaces",
  onEnable(p) {
    const app = p.app;
    p.addCommand({ id: "workspaces:open-modal", name: "Workspaces: Manage workspace layouts", icon: "layout", callback: () => new WorkspacesModal(app).open() });
    p.addCommand({ id: "workspaces:save-and-load", name: "Workspaces: Save and load another layout", callback: () => new WorkspacesModal(app, "save-and-load").open() });
    p.addCommand({
      id: "workspaces:load",
      name: "Workspaces: Load workspace layout",
      callback: async () => {
        const d = await readWorkspaces(app);
        new WorkspacePicker(app, Object.keys(d.workspaces).sort(), (n) => loadWorkspace(app, n)).open();
      },
    });
    p.addCommand({
      id: "workspaces:save",
      name: "Workspaces: Save layout",
      callback: async () => {
        const d = await readWorkspaces(app);
        if (d.active) await saveWorkspace(app, d.active);
        else new WorkspacesModal(app).open();
      },
    });
    p.addRibbonIcon("layout", "Manage workspace layouts", () => new WorkspacesModal(app).open());
    p.instance.saveWorkspace = (n: string) => saveWorkspace(app, n);
    p.instance.loadWorkspace = (n: string) => loadWorkspace(app, n);
  },
};

// ---------------------------------------------------------------- Audio recorder
export const audioRecorderPlugin: CorePluginImpl = {
  id: "audio-recorder",
  onEnable(p) {
    const app = p.app;
    let rec: MediaRecorder | null = null;
    let chunks: Blob[] = [];
    let ribbon: HTMLElement | null = null;
    const start = async () => {
      if (rec) return;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        new Notice("The microphone isn't available. Check that one is connected and that the app may use it.");
        return;
      }
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = rec?.mimeType || "audio/webm";
        rec = null;
        ribbon?.removeClass("is-recording");
        const ext = type.includes("ogg") ? "ogg" : "webm";
        const view = app.workspace.activeEditor;
        const name = `Recording ${moment().format("YYYYMMDDHHmmss")}.${ext}`;
        const path = await app.fileManager.getAvailablePathForAttachment(name, view?.file?.path ?? "");
        const buf = await new Blob(chunks, { type }).arrayBuffer();
        const f = await app.vault.createBinary(path, buf);
        if (view?.editor) view.editor.replaceSelection("!" + app.fileManager.generateMarkdownLink(f, view.file?.path ?? ""));
        else await app.workspace.getLeaf(false).openFile(f);
        new Notice(`Saved ${f.name}.`);
      };
      rec.start();
      ribbon?.addClass("is-recording");
      new Notice("Recording... Run “Stop recording audio” or click the microphone again to stop.");
    };
    const stop = () => rec?.stop();
    p.addCommand({ id: "audio-recorder:start", name: "Audio recorder: Start recording audio", icon: "mic", checkCallback: (c: boolean) => (rec ? false : (c || start(), true)) });
    p.addCommand({ id: "audio-recorder:stop", name: "Audio recorder: Stop recording audio", icon: "square", checkCallback: (c: boolean) => (!rec ? false : (c || stop(), true)) });
    ribbon = p.addRibbonIcon("mic", "Start/stop recording", () => (rec ? stop() : start()));
    p.register(() => rec?.stop());
  },
};

// ---------------------------------------------------------------- Format converter
export interface ConvertOptions {
  roamHighlights: boolean;
  roamTodos: boolean;
  bearTags: boolean;
  hashLinks: boolean;
  mdLinks: boolean;
}
/** Convert other apps' Markdown dialects to this app's. Pure (used by tests). */
export function convertMarkdown(text: string, o: ConvertOptions, resolve?: (target: string) => string | null): string {
  let t = text;
  if (o.roamHighlights) t = t.replace(/\^\^([^^\n]+?)\^\^/g, "==$1==");
  if (o.roamTodos) t = t.replace(/\{\{\[\[TODO\]\]\}\}\s?/g, "[ ] ").replace(/\{\{\[\[DONE\]\]\}\}\s?/g, "[x] ").replace(/^(\s*)([-*]\s+)?\[( |x)\] /gm, (_m, ind, bullet, c) => `${ind}${bullet ?? "- "}[${c}] `);
  if (o.bearTags) t = t.replace(/(^|\s)#([^\s#][^#\n]*?[^\s#])#(?=\s|$)/g, (_m, pre, tag) => `${pre}#${tag.trim().replace(/\s+/g, "-")}`);
  if (o.hashLinks) t = t.replace(/#\[\[([^\]]+)\]\]/g, (_m, tag) => "#" + tag.replace(/\s+/g, "-"));
  if (o.mdLinks && resolve)
    t = t.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (m, bang, label, href) => {
      if (/^[a-z]+:/i.test(href)) return m;
      const target = resolve(decodeURIComponent(href));
      if (!target) return m;
      return label && label !== target ? `${bang}[[${target}|${label}]]` : `${bang}[[${target}]]`;
    });
  return t;
}

class ConverterModal extends Modal {
  onOpen(): void {
    this.setTitle("Format converter");
    const c = this.contentEl;
    c.empty();
    c.createEl("p", { cls: "setting-item-description", text: "Convert notes written in other apps' Markdown so they work here. This changes files in your vault; File recovery keeps snapshots if you need to undo." });
    const o: ConvertOptions = { roamHighlights: true, roamTodos: true, bearTags: true, hashLinks: true, mdLinks: false };
    const row = (k: keyof ConvertOptions, name: string, desc: string) => new Setting(c).setName(name).setDesc(desc).addToggle((t) => t.setValue(o[k]).onChange((v) => (o[k] = v)));
    row("roamHighlights", "Roam highlights", "^^text^^ becomes ==text==.");
    row("roamTodos", "Roam to-dos", "{{[[TODO]]}} and {{[[DONE]]}} become task check boxes.");
    row("bearTags", "Bear tags", "#multi word tag# becomes #multi-word-tag.");
    row("hashLinks", "Tag links", "#[[tag name]] becomes #tag-name.");
    row("mdLinks", "Markdown links to notes", "[text](note.md) becomes [[note|text]].");
    const btns = this.modalEl.createDiv("modal-button-container");
    btns.createEl("button", { cls: "mod-cta", text: "Start conversion" }).addEventListener("click", async () => {
      const app = this.app;
      let changed = 0;
      for (const f of app.vault.getMarkdownFiles()) {
        const before = await app.vault.read(f);
        const after = convertMarkdown(before, o, (target) => {
          const dest = app.metadataCache.getFirstLinkpathDest(target.replace(/\.md$/, ""), f.path);
          return dest ? app.metadataCache.fileToLinktext(dest, f.path, true) : null;
        });
        if (after !== before) {
          await app.vault.modify(f, after);
          changed++;
        }
      }
      new Notice(changed ? `Converted ${changed} ${changed === 1 ? "note" : "notes"}.` : "Nothing needed converting.");
      this.close();
    });
    btns.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
  }
}

export const formatConverterPlugin: CorePluginImpl = {
  id: "markdown-importer",
  onEnable(p) {
    p.addCommand({ id: "markdown-importer:open", name: "Format converter: Open format converter", icon: "file-input", callback: () => new ConverterModal(p.app).open() });
  },
};

// ---------------------------------------------------------------- Slash commands
class SlashSuggest extends EditorSuggest<any> {
  onTrigger(cursor: any, editor: any): any {
    const line = editor.getLine(cursor.line).slice(0, cursor.ch);
    const m = /(?:^|\s)\/([^\s/]*)$/.exec(line);
    if (!m) return null;
    return { start: { line: cursor.line, ch: cursor.ch - m[1].length - 1 }, end: cursor, query: m[1] };
  }
  getSuggestions(ctx: any): any[] {
    const q = ctx.query.toLowerCase();
    return this.app.commands
      .listCommands()
      .filter((c: any) => (c.editorCallback || c.editorCheckCallback || c.callback || c.checkCallback) && c.name.toLowerCase().includes(q))
      .sort((a: any, b: any) => a.name.localeCompare(b.name))
      .slice(0, 50);
  }
  renderSuggestion(c: any, el: HTMLElement): void {
    el.addClass("mod-complex");
    el.createDiv({ cls: "suggestion-content", text: c.name });
    const hk = this.app.hotkeyManager.printHotkeyForCommand(c.id);
    if (hk) el.createDiv("suggestion-aux").createEl("kbd", { cls: "suggestion-hotkey", text: hk });
  }
  selectSuggestion(c: any): void {
    const ctx = this.context;
    if (!ctx) return;
    ctx.editor.replaceRange("", ctx.start, ctx.end);
    this.close();
    this.app.commands.executeCommand(c);
  }
}

export const slashCommandPlugin: CorePluginImpl = {
  id: "slash-command",
  onEnable(p) {
    const app = p.app;
    const s = new SlashSuggest(app);
    app.workspace.editorSuggest = app.workspace.editorSuggest ?? { suggests: [] };
    app.workspace.editorSuggest.suggests.push(s);
    p.register(() => {
      s.close();
      app.workspace.editorSuggest.suggests.remove(s);
    });
  },
};

// ---------------------------------------------------------------- Footnotes view
export const FOOTNOTES_VIEW = "footnotes";
class FootnotesView extends ItemView {
  getViewType(): string {
    return FOOTNOTES_VIEW;
  }
  getDisplayText(): string {
    return "Footnotes";
  }
  getIcon(): string {
    return "footprints";
  }
  async onOpen(): Promise<void> {
    this.registerEvent(this.app.workspace.on("file-open", () => this.render()));
    this.registerEvent(this.app.metadataCache.on("changed", (f: any) => f === this.app.workspace.getActiveFile() && this.render()));
    this.render();
  }
  private async render(): Promise<void> {
    const el = this.contentEl;
    el.empty();
    el.addClass("footnotes-view");
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      el.createDiv({ cls: "pane-empty", text: "No file open." });
      return;
    }
    const text: string = await this.app.vault.cachedRead(file);
    const defs = [...text.matchAll(/^\[\^([^\]]+)\]:\s*(.*)$/gm)];
    if (!defs.length) {
      el.createDiv({ cls: "pane-empty", text: "No footnotes in this note." });
      return;
    }
    for (const d of defs) {
      const item = el.createDiv("tree-item footnote-item");
      const self = item.createDiv("tree-item-self is-clickable");
      self.createDiv({ cls: "tree-item-inner", text: `[${d[1]}] ${d[2]}` });
      const offset = d.index ?? 0;
      self.addEventListener("click", async () => {
        const leaf = this.app.workspace.getMostRecentLeaf?.() ?? this.app.workspace.getLeaf(false);
        await leaf.openFile(file);
        const ed = (leaf.view as any)?.editor;
        if (ed) {
          const pos = ed.offsetToPos(offset);
          ed.setCursor(pos);
          ed.scrollIntoView({ from: pos, to: pos }, true);
        }
      });
    }
  }
}

export const footnotesPlugin: CorePluginImpl = {
  id: "footnotes",
  onEnable(p) {
    const app = p.app;
    p.registerView(FOOTNOTES_VIEW, (leaf: any) => new FootnotesView(leaf));
    p.addCommand({
      id: "footnotes:open",
      name: "Footnotes view: Show footnotes",
      icon: "footprints",
      callback: async () => {
        const leaves = app.workspace.getLeavesOfType(FOOTNOTES_VIEW);
        const leaf = leaves[0] ?? app.workspace.getRightLeaf(false);
        await leaf.setViewState({ type: FOOTNOTES_VIEW, active: true });
        app.workspace.revealLeaf(leaf);
      },
    });
  },
  onDisable(p) {
    p.app.workspace.detachLeavesOfType(FOOTNOTES_VIEW);
  },
};

// ---------------------------------------------------------------- Quick switcher options
class SwitcherTab extends CoreOptionsTab {
  getSettingDefinitions(): any[] {
    return [
      { name: "Show existing only", desc: "Only list notes that exist; don't offer to create a new one.", control: { type: "toggle", key: "showExistingOnly", defaultValue: false } },
      { name: "Show attachments", desc: "Also list images, PDFs and other attachments the app can open.", control: { type: "toggle", key: "showAttachments", defaultValue: true } },
      { name: "Show all file types", desc: "Also list files the app can't open.", control: { type: "toggle", key: "showAllFileTypes", defaultValue: false } },
    ];
  }
}
export const switcherPlugin: CorePluginImpl = {
  id: "switcher",
  defaultOptions: { showExistingOnly: false, showAttachments: true, showAllFileTypes: false },
  settingTab: (p) => new SwitcherTab(p),
};

// ---------------------------------------------------------------- Command palette options
class PaletteTab extends CoreOptionsTab {
  getSettingDefinitions(): any[] {
    const pinned: string[] = this.plugin.options.pinned ?? [];
    const cmds = this.app.commands.commands;
    const save = (l: string[]) => {
      this.plugin.setOption("pinned", l);
      this.rerender();
    };
    return [
      {
        type: "list",
        heading: "Pinned commands",
        emptyState: "No commands pinned. Pinned commands show at the top of the command palette.",
        addItem: {
          name: "Add command",
          action: () => {
            const app = this.app;
            class Pick extends FuzzySuggestModal<any> {
              getItems() {
                return Object.values(cmds).filter((c: any) => !pinned.includes(c.id));
              }
              getItemText(c: any) {
                return c.name;
              }
              onChooseItem(c: any) {
                save([...pinned, c.id]);
              }
            }
            new Pick(app).open();
          },
        },
        onDelete: (i: number) => save(pinned.filter((_, j) => j !== i)),
        items: pinned.map((id, i) => ({
          name: cmds[id]?.name ?? id,
          desc: cmds[id] ? "" : "This command isn't available right now.",
          render: (s: Setting) => {
            if (i > 0)
              s.addExtraButton((b) =>
                b
                  .setIcon("arrow-up")
                  .setTooltip("Move up")
                  .onClick(() => {
                    const l = [...pinned];
                    [l[i - 1], l[i]] = [l[i], l[i - 1]];
                    save(l);
                  }),
              );
          },
        })),
      },
    ];
  }
}
export const commandPalettePlugin: CorePluginImpl = {
  id: "command-palette",
  defaultOptions: { pinned: [] },
  settingTab: (p) => new PaletteTab(p),
};

// ---------------------------------------------------------------- Publish (not part of this app)
export const publishPlugin: CorePluginImpl = { id: "publish" };

export type { InternalPlugin };
