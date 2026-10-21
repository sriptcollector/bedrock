// Editor suggestions (obsidian API: PopoverSuggest, EditorSuggest, AbstractInputSuggest) and the
// built-in ones: [[link]] / ![[embed]] suggest with headings (#), blocks (^, creating a block id),
// aliases and unresolved notes; #tag suggest; ==highlight colour suggest. The popup is a
// .suggestion-container positioned at the cursor; Up/Down/Enter/Tab/Escape drive it.
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { Scope } from "../commands/keymap";
import { prepareFuzzySearch, type SearchResult } from "../ui/search";
import { setIcon } from "../dom/icons";
import { editorInfoField } from "./fields";
import { stripHeadingForLink } from "../../core/links";
import { parseMetadata } from "../../core/parse";
import { HIGHLIGHT_COLORS } from "./formatting";
import type { EditorPosition } from "./editor";

export interface Instruction {
  command: string;
  purpose: string;
}

export interface EditorSuggestTriggerInfo {
  start: EditorPosition;
  end: EditorPosition;
  query: string;
}

export interface EditorSuggestContext extends EditorSuggestTriggerInfo {
  editor: any;
  file: any;
}

/** A popup list of suggestions (obsidian API base class). */
export abstract class PopoverSuggest<T> {
  app: any;
  scope: Scope;
  suggestEl: HTMLElement;
  protected suggestions: HTMLElement;
  protected instructionsEl: HTMLElement | null = null;
  protected values: T[] = [];
  protected selectedItem = 0;
  protected itemEls: HTMLElement[] = [];
  isOpen = false;

  constructor(app: any, scope?: Scope) {
    this.app = app;
    this.scope = scope ?? new Scope(app?.scope);
    this.suggestEl = createDiv("suggestion-container");
    this.suggestions = this.suggestEl.createDiv("suggestion");
    this.suggestEl.addEventListener("mousedown", (e) => e.preventDefault());
    this.scope.register([], "ArrowDown", (e) => {
      if (!this.isOpen) return;
      e.preventDefault();
      this.moveSelection(1);
      return false;
    });
    this.scope.register([], "ArrowUp", (e) => {
      if (!this.isOpen) return;
      e.preventDefault();
      this.moveSelection(-1);
      return false;
    });
    this.scope.register(null, "Enter", (e) => {
      if (!this.isOpen || !this.values.length) return;
      e.preventDefault();
      this.useSelectedItem(e);
      return false;
    });
    this.scope.register([], "Escape", (e) => {
      if (!this.isOpen) return;
      e.preventDefault();
      this.close();
      return false;
    });
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    document.body.appendChild(this.suggestEl);
    this.app?.keymap?.pushScope(this.scope);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.suggestEl.detach();
    this.app?.keymap?.popScope(this.scope);
  }

  setSuggestions(values: T[], emptyText = "No match found"): void {
    this.values = values;
    this.suggestions.empty();
    this.itemEls = [];
    if (!values.length) {
      this.suggestions.createDiv({ cls: "suggestion-empty", text: emptyText });
      return;
    }
    values.forEach((v, i) => {
      const el = this.suggestions.createDiv("suggestion-item");
      this.renderSuggestion(v, el);
      el.addEventListener("mousemove", () => this.setSelectedItem(i, false));
      el.addEventListener("click", (e) => {
        this.setSelectedItem(i, false);
        this.useSelectedItem(e);
      });
      this.itemEls.push(el);
    });
    this.setSelectedItem(0, false);
  }

  setSelectedItem(i: number, scroll = true): void {
    this.itemEls[this.selectedItem]?.removeClass("is-selected");
    this.selectedItem = i;
    const el = this.itemEls[i];
    el?.addClass("is-selected");
    if (scroll) el?.scrollIntoView({ block: "nearest" });
  }

  moveSelection(d: number): void {
    if (!this.values.length) return;
    this.setSelectedItem((this.selectedItem + d + this.values.length) % this.values.length);
  }

  useSelectedItem(evt: MouseEvent | KeyboardEvent): void {
    const v = this.values[this.selectedItem];
    if (v !== undefined) this.selectSuggestion(v, evt);
  }

  setInstructions(ins: Instruction[]): void {
    this.instructionsEl?.remove();
    if (!ins.length) {
      this.instructionsEl = null;
      return;
    }
    this.instructionsEl = this.suggestEl.createDiv("prompt-instructions");
    for (const i of ins) {
      const el = this.instructionsEl.createDiv("prompt-instruction");
      el.createSpan({ cls: "prompt-instruction-command", text: i.command });
      el.createSpan({ text: i.purpose });
    }
  }

  /** Place the popup under (or above) a screen rectangle. */
  reposition(rect: { left: number; top: number; bottom: number }): void {
    const el = this.suggestEl;
    el.style.left = Math.max(0, Math.min(rect.left, window.innerWidth - Math.max(el.offsetWidth, 200) - 8)) + "px";
    const below = rect.bottom + 4;
    const h = el.offsetHeight || 200;
    el.style.top = (below + h > window.innerHeight && rect.top - h - 4 > 0 ? rect.top - h - 4 : below) + "px";
  }

  abstract renderSuggestion(value: T, el: HTMLElement): void;
  abstract selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void;
}

/** Suggestions while typing in the editor (obsidian API). Register with Plugin.registerEditorSuggest. */
export abstract class EditorSuggest<T> extends PopoverSuggest<T> {
  context: EditorSuggestContext | null = null;
  limit = 100;

  constructor(app: any) {
    super(app);
  }

  abstract onTrigger(cursor: EditorPosition, editor: any, file: any): EditorSuggestTriggerInfo | null;
  abstract getSuggestions(context: EditorSuggestContext): T[] | Promise<T[]>;

  /** Called by the manager with fresh context; renders and positions the list. */
  async showSuggestions(context: EditorSuggestContext, view: EditorView): Promise<boolean> {
    this.context = context;
    const got = await this.getSuggestions(context);
    if (this.context !== context) return false;
    const list = (got ?? []).slice(0, this.limit);
    if (!list.length && !this.showEmpty()) {
      this.close();
      return false;
    }
    this.open();
    this.setSuggestions(list);
    const pos = view.coordsAtPos(context.editor.posToOffset(context.start));
    if (pos) requestAnimationFrame(() => this.reposition(pos));
    return true;
  }

  /** Whether an empty result keeps the popup open with "No match found". */
  showEmpty(): boolean {
    return false;
  }

  close(): void {
    super.close();
    this.context = null;
  }
}

/** Suggestions under an <input> or contenteditable (obsidian API: AbstractInputSuggest). */
export abstract class AbstractInputSuggest<T> extends PopoverSuggest<T> {
  limit = 100;
  private onSelectCb: ((value: T, evt: MouseEvent | KeyboardEvent) => any) | null = null;
  constructor(app: any, readonly textInputEl: HTMLInputElement | HTMLDivElement) {
    super(app);
    const update = () => this.refresh();
    textInputEl.addEventListener("input", update);
    textInputEl.addEventListener("focus", update);
    textInputEl.addEventListener("blur", () => setTimeout(() => this.close(), 100));
  }
  getValue(): string {
    return this.textInputEl instanceof HTMLInputElement ? this.textInputEl.value : this.textInputEl.textContent ?? "";
  }
  setValue(v: string): void {
    if (this.textInputEl instanceof HTMLInputElement) this.textInputEl.value = v;
    else this.textInputEl.textContent = v;
  }
  onSelect(cb: (value: T, evt: MouseEvent | KeyboardEvent) => any): this {
    this.onSelectCb = cb;
    return this;
  }
  selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void {
    this.onSelectCb?.(value, evt);
    this.close();
  }
  protected abstract getSuggestions(query: string): T[] | Promise<T[]>;
  private async refresh(): Promise<void> {
    const list = ((await this.getSuggestions(this.getValue())) ?? []).slice(0, this.limit);
    if (!list.length || document.activeElement !== this.textInputEl) {
      this.close();
      return;
    }
    this.open();
    this.setSuggestions(list);
    const r = this.textInputEl.getBoundingClientRect();
    this.reposition({ left: r.left, top: r.top, bottom: r.bottom });
  }
}

// ---------------------------------------------------------------------------------------------
// Manager: one per app (app.workspace.editorSuggest), runs on every editor change.

export class EditorSuggests {
  suggests: EditorSuggest<any>[] = [];
  currentSuggest: EditorSuggest<any> | null = null;
  builtins: EditorSuggest<any>[] = [];
  constructor(public app: any) {}

  addSuggest(s: EditorSuggest<any>): void {
    this.suggests.push(s);
  }
  removeSuggest(s: EditorSuggest<any>): void {
    this.suggests.remove(s);
    if (this.currentSuggest === s) this.close();
  }
  close(): void {
    this.currentSuggest?.close();
    this.currentSuggest = null;
  }
  isShowingSuggestion(): boolean {
    return !!this.currentSuggest?.isOpen;
  }

  /** Ask every suggest (plugins first, then built-ins) whether it triggers at the cursor. */
  trigger(view: EditorView, owner: any, explicit = false): void {
    const editor = owner?.editor;
    if (!editor || owner.cm !== view) return;
    if (view.state.selection.ranges.length > 1 || !view.state.selection.main.empty) return this.close();
    const cursor = editor.getCursor();
    const ordered = [...this.suggests.filter((s) => !this.builtins.includes(s)), ...this.builtins];
    for (const s of ordered) {
      let info: EditorSuggestTriggerInfo | null = null;
      try {
        info = s.onTrigger(cursor, editor, owner.file ?? null);
      } catch (e) {
        console.error(e);
      }
      if (!info) continue;
      if (this.currentSuggest && this.currentSuggest !== s) this.currentSuggest.close();
      this.currentSuggest = s;
      void s.showSuggestions({ ...info, editor, file: owner.file ?? null }, view);
      return;
    }
    void explicit;
    this.close();
  }
}

export function getSuggestManager(app: any): EditorSuggests {
  const ws = app.workspace;
  if (!(ws.editorSuggest instanceof EditorSuggests)) {
    const prev: any[] = ws.editorSuggest?.suggests ?? [];
    const m = new EditorSuggests(app);
    m.builtins = [new LinkSuggest(app), new TagSuggest(app), new HighlightColorSuggest(app)];
    m.suggests = [...prev, ...m.builtins];
    ws.editorSuggest = m;
  }
  return ws.editorSuggest;
}

/** Triggers suggestions on typing/deleting and closes them when the cursor leaves. */
export function editorSuggestExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {}
      update(u: ViewUpdate) {
        const owner = u.state.field(editorInfoField, false);
        if (!owner?.app) return;
        const m = getSuggestManager(owner.app);
        const typed = u.transactions.some((t) => t.isUserEvent("input.type") || t.isUserEvent("delete") || t.isUserEvent("input.complete") || t.isUserEvent("input"));
        if (u.docChanged && typed) {
          queueMicrotask(() => m.trigger(u.view, owner));
          return;
        }
        if (u.focusChanged && !u.view.hasFocus) {
          setTimeout(() => {
            if (!u.view.hasFocus) m.close();
          }, 150);
          return;
        }
        if (u.selectionSet && m.isShowingSuggestion()) queueMicrotask(() => m.trigger(u.view, owner));
      }
      destroy() {
        const owner = this.view.state.field(editorInfoField, false);
        if (owner?.app?.workspace?.editorSuggest instanceof EditorSuggests) owner.app.workspace.editorSuggest.close();
      }
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Built-in: link suggest.

type LinkItem =
  | { type: "file"; file: any; path: string; score: number; matches: [number, number][]; title: string; alias?: string }
  | { type: "unresolved"; linktext: string; score: number; matches: [number, number][]; title: string }
  | { type: "heading"; file: any; heading: string; level: number; score: number; matches: [number, number][]; title: string }
  | { type: "block"; file: any; node: any; text: string; id: string | null; score: number; matches: [number, number][]; title: string };

function renderHighlighted(el: HTMLElement, text: string, matches: [number, number][]): void {
  let i = 0;
  for (const [a, b] of matches) {
    if (a > i) el.appendText(text.slice(i, a));
    el.createSpan({ cls: "suggestion-highlight", text: text.slice(a, b) });
    i = b;
  }
  if (i < text.length) el.appendText(text.slice(i));
}

function randomBlockId(): string {
  return Math.random().toString(36).slice(2, 8).padEnd(6, "0");
}

export class LinkSuggest extends EditorSuggest<LinkItem> {
  private embed = false;
  constructor(app: any) {
    super(app);
    this.limit = 100;
    this.setInstructions(LinkSuggest.FILE_INSTRUCTIONS);
    this.scope.register([], "Tab", (e) => {
      if (!this.isOpen || !this.values.length) return;
      e.preventDefault();
      this.complete(this.values[this.selectedItem], true);
      return false;
    });
  }

  showEmpty(): boolean {
    return true;
  }

  onTrigger(cursor: EditorPosition, editor: any, _file?: any): EditorSuggestTriggerInfo | null {
    const line: string = editor.getLine(cursor.line);
    const before = line.slice(0, cursor.ch);
    const open = before.lastIndexOf("[[");
    if (open < 0) return null;
    const query = before.slice(open + 2);
    if (query.includes("]]") || query.includes("|")) return null;
    this.embed = before[open - 1] === "!";
    return { start: { line: cursor.line, ch: open + 2 }, end: cursor, query };
  }

  private setMode(mode: "file" | "sub"): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.setInstructions(mode === "file" ? LinkSuggest.FILE_INSTRUCTIONS : [{ command: "â†µ", purpose: "to accept" }]);
  }
  private mode: "file" | "sub" = "file";
  static FILE_INSTRUCTIONS = [
    { command: "Type #", purpose: "to link heading" },
    { command: "Type ^", purpose: "to link blocks" },
    { command: "Type |", purpose: "to change display text" },
  ];

  getSuggestions(ctx: EditorSuggestContext): LinkItem[] | Promise<LinkItem[]> {
    const app = this.app;
    const q = ctx.query;
    this.setMode(q.includes("#") || q.startsWith("^") ? "sub" : "file");
    const sourcePath = ctx.file?.path ?? "";
    const hash = q.indexOf("#");
    const caret = q.startsWith("^") ? 0 : q.indexOf("#^");
    if (caret === 0 || caret > 0) {
      // Blocks: [[^query (this note) or [[Note#^query.
      const notePart = caret > 0 ? q.slice(0, caret) : "";
      const blockQ = caret > 0 ? q.slice(caret + 2) : q.slice(1);
      const file = notePart ? app.metadataCache.getFirstLinkpathDest(notePart, sourcePath) : ctx.file;
      return this.blockItems(file, blockQ, ctx);
    }
    if (hash >= 0) {
      const notePart = q.slice(0, hash);
      const hq = q.slice(hash + 1);
      const file = notePart ? app.metadataCache.getFirstLinkpathDest(notePart, sourcePath) : ctx.file;
      const cache = file ? app.metadataCache.getFileCache(file) : null;
      const fuzzy = prepareFuzzySearch(hq);
      const out: LinkItem[] = [];
      for (const h of cache?.headings ?? []) {
        const r: SearchResult | null = hq ? fuzzy(h.heading) : { score: 0, matches: [] };
        if (!r) continue;
        out.push({ type: "heading", file, heading: h.heading, level: h.level, score: r.score, matches: r.matches as any, title: h.heading });
      }
      if (hq) out.sort((a, b) => b.score - a.score);
      return out;
    }
    const fuzzy = prepareFuzzySearch(q);
    const out: LinkItem[] = [];
    const files: any[] = app.vault.getFiles();
    for (const f of files) {
      if (f.extension !== "md" && !this.embed && !app.vault.getConfig("showUnsupportedFiles") && !["canvas", "base", "pdf", "png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "avif", "mp3", "wav", "m4a", "ogg", "3gp", "flac", "mp4", "webm", "ogv", "mov", "mkv"].includes(f.extension)) continue;
      const title = f.extension === "md" ? f.basename : f.name;
      if (!q) {
        out.push({ type: "file", file: f, path: f.path, score: f.stat?.mtime ?? 0, matches: [], title });
      } else {
        const r = fuzzy(title) ?? (q.includes("/") ? fuzzy(f.path) : null);
        if (r) out.push({ type: "file", file: f, path: f.path, score: r.score + (f.extension === "md" ? 0.001 : 0), matches: fuzzy(title)?.matches ?? [], title } as any);
      }
      const fm = app.metadataCache.getFileCache(f)?.frontmatter;
      const aliases = fm ? ([] as any[]).concat(fm.aliases ?? fm.alias ?? []).filter((a) => typeof a === "string" && a) : [];
      for (const a of aliases) {
        if (!q) continue;
        const r = fuzzy(a);
        if (r) out.push({ type: "file", file: f, path: f.path, score: r.score + 0.002, matches: r.matches as any, title: a, alias: a });
      }
    }
    if (q) {
      const seen = new Set<string>();
      for (const m of Object.values(app.metadataCache.unresolvedLinks as Record<string, Record<string, number>>))
        for (const k of Object.keys(m)) {
          if (seen.has(k.toLowerCase())) continue;
          seen.add(k.toLowerCase());
          const r = fuzzy(k);
          if (r) out.push({ type: "unresolved", linktext: k, score: r.score - 0.5, matches: r.matches as any, title: k });
        }
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  private async blockItems(file: any, q: string, _ctx: EditorSuggestContext): Promise<LinkItem[]> {
    if (!file) return [];
    const live = this.contextText(file);
    const text: string = live ?? (await this.app.vault.cachedRead(file));
    const cache = live !== null ? parseMetadata(live) : this.app.metadataCache.getFileCache(file);
    const fuzzy = prepareFuzzySearch(q);
    const out: LinkItem[] = [];
    for (const s of cache?.sections ?? []) {
      if (s.type === "yaml" || s.type === "heading" || s.type === "thematicBreak") continue;
      const nodes = s.type === "list" ? (cache.listItems ?? []).filter((li: any) => li.position.start.offset >= s.position.start.offset && li.position.end.offset <= s.position.end.offset) : [s];
      const cursorOff = this.context && this.context.file === file ? this.context.editor.posToOffset(this.context.end) : -1;
      for (const n of nodes) {
        if (cursorOff >= n.position.start.offset && cursorOff <= n.position.end.offset) continue;
        const t = text.slice(n.position.start.offset, n.position.end.offset);
        const shown = t.replace(/\s\^[A-Za-z0-9-]+\s*$/, "").trim();
        if (!shown) continue;
        const r = q ? fuzzy(shown) : { score: 0, matches: [] };
        if (!r) continue;
        const idm = /\s\^([A-Za-z0-9-]+)\s*$/.exec(t);
        out.push({ type: "block", file, node: n, text: shown, id: idm ? idm[1] : n.id ?? null, score: r.score, matches: r.matches as any, title: shown });
      }
    }
    if (q) out.sort((a, b) => b.score - a.score);
    return out;
  }

  /** The text of a file as the editor currently has it (falls back to the cache's read). */
  private contextText(file: any): string | null {
    const ctx = this.context;
    if (ctx && ctx.file === file) return ctx.editor.getValue();
    return null;
  }

  renderSuggestion(item: LinkItem, el: HTMLElement): void {
    el.addClass("mod-complex");
    const content = el.createDiv("suggestion-content");
    const title = content.createDiv("suggestion-title");
    const note = content.createDiv("suggestion-note");
    const aux = el.createDiv("suggestion-aux");
    renderHighlighted(title, item.title, item.matches);
    if (item.type === "file") {
      if (item.alias) {
        note.setText(item.file.basename);
        const f = aux.createSpan({ cls: "suggestion-flair", attr: { "aria-label": "Alias" } });
        setIcon(f, "forward");
      } else if (item.file.parent && item.file.parent.path && item.file.parent.path !== "/") note.setText(item.file.parent.path + "/");
    } else if (item.type === "heading") {
      aux.createSpan({ cls: "suggestion-flair", text: "H" + item.level });
    } else if (item.type === "block") {
      if (item.file !== this.context?.file) note.setText(item.file?.basename ?? "");
    }
  }

  selectSuggestion(item: LinkItem, _evt: MouseEvent | KeyboardEvent): void {
    this.complete(item, false);
  }

  private complete(item: LinkItem, tab: boolean): void {
    const ctx = this.context;
    if (!ctx) return;
    const editor = ctx.editor;
    const app = this.app;
    const sourcePath = ctx.file?.path ?? "";
    const startOff = editor.posToOffset(ctx.start);
    const endOff = editor.posToOffset(ctx.end);
    const doc: string = editor.getValue();
    const hasClose = doc.slice(endOff, endOff + 2) === "]]";
    const markdownLinks = !!app.vault.getConfig("useMarkdownLinks");
    let linktext = "";
    let alias: string | undefined;
    let extraChanges: { from: number; to: number; text: string }[] = [];
    if (item.type === "file") {
      linktext = app.metadataCache.fileToLinktext(item.file, sourcePath, true);
      alias = item.alias;
    } else if (item.type === "unresolved") linktext = item.linktext;
    else if (item.type === "heading") {
      const q = ctx.query;
      const notePart = q.slice(0, q.indexOf("#"));
      linktext = (notePart ? notePart : "") + "#" + stripHeadingForLink(item.heading);
    } else if (item.type === "block") {
      let id = item.id;
      if (!id) {
        id = randomBlockId();
        // Add " ^id" at the end of the block.
        const endPos = item.node.position.end.offset;
        if (ctx.file && item.file === ctx.file) extraChanges.push({ from: endPos, to: endPos, text: " ^" + id });
        else void appendBlockId(app, item.file, endPos, id);
      }
      const q = ctx.query;
      const caret = q.indexOf("#^");
      const notePart = caret > 0 ? q.slice(0, caret) : "";
      linktext = (notePart || (item.file === ctx.file ? "" : app.metadataCache.fileToLinktext(item.file, sourcePath, true))) + "#^" + id;
    }
    // Markdown link format: replace the whole [[...]] with [text](path).
    if (markdownLinks && (item.type === "file" || item.type === "unresolved" || item.type === "heading")) {
      const open = startOff - 2 - (this.embed ? 1 : 0);
      const close = hasClose ? endOff + 2 : endOff;
      let path = linktext;
      let sub = "";
      const h = path.indexOf("#");
      if (h >= 0) {
        sub = path.slice(h);
        path = path.slice(0, h);
      }
      if (item.type === "file" && item.file.extension === "md" && path && !path.endsWith(".md")) path += ".md";
      const display = alias ?? (item.type === "heading" ? item.heading : item.type === "file" ? (item.file.extension === "md" ? item.file.basename : item.file.name) : item.linktext);
      const url = encodeURI(path).replace(/#/g, "%23") + (sub ? "#" + encodeURI(sub.slice(1)) : "");
      const text = (this.embed ? "!" : "") + `[${display}](${url})`;
      this.close();
      editor.cm.dispatch({ changes: { from: open, to: close, insert: text }, selection: { anchor: open + text.length }, userEvent: "input.complete" });
      editor.cm.focus();
      return;
    }
    const inner = linktext + (alias !== undefined ? "|" + alias : "");
    const closeText = hasClose ? "" : "]]";
    const insert = inner + closeText;
    const changes = [{ from: startOff, to: endOff, insert }, ...extraChanges.map((c) => ({ from: c.from, to: c.to, insert: c.text }))];
    this.close();
    const cm = editor.cm;
    const set = cm.state.changes(changes);
    const base = set.mapPos(startOff, -1);
    // Enter puts the cursor after the link; Tab keeps editing inside it (alias selected).
    const anchor = base + (tab ? (alias !== undefined ? linktext.length + 1 : inner.length) : inner.length + 2);
    const head = tab && alias !== undefined ? base + inner.length : anchor;
    cm.dispatch({ changes: set, selection: { anchor, head }, userEvent: "input.complete" });
    cm.focus();
  }
}

async function appendBlockId(app: any, file: any, offset: number, id: string): Promise<void> {
  await app.vault.process(file, (data: string) => data.slice(0, offset) + " ^" + id + data.slice(offset));
}

// ---------------------------------------------------------------------------------------------
// Built-in: tag suggest.

export class TagSuggest extends EditorSuggest<{ tag: string; matches: [number, number][] }> {
  constructor(app: any) {
    super(app);
  }
  onTrigger(cursor: EditorPosition, editor: any, _file?: any): EditorSuggestTriggerInfo | null {
    const line: string = editor.getLine(cursor.line);
    const before = line.slice(0, cursor.ch);
    const m = /(?:^|[\s(\[{,;])#([\p{L}\p{N}\p{M}_\-/]*)$/u.exec(before);
    if (!m) return null;
    // Not in a heading marker ("# ") or inside code.
    if (/^#+$/.test(before.trim()) && !m[1]) return null;
    const cm = editor.cm as EditorView;
    const node = (cm.state as any).tree?.resolveInner?.(editor.posToOffset(cursor), -1);
    void node;
    return { start: { line: cursor.line, ch: cursor.ch - m[1].length }, end: cursor, query: m[1] };
  }
  getSuggestions(ctx: EditorSuggestContext) {
    const tags = Object.keys(this.app.metadataCache.getTags() as Record<string, number>).map((t) => t.slice(1));
    const q = ctx.query;
    if (!q) return tags.sort((a, b) => a.localeCompare(b)).map((tag) => ({ tag, matches: [] as [number, number][] }));
    const fuzzy = prepareFuzzySearch(q);
    const scored = tags
      .map((t) => ({ t, r: fuzzy(t) }))
      .filter((x) => x.r)
      .sort((a, b) => b.r!.score - a.r!.score || a.t.length - b.t.length || a.t.localeCompare(b.t))
      .map((x) => ({ tag: x.t, matches: x.r!.matches as [number, number][] }));
    return scored;
  }
  renderSuggestion(v: { tag: string; matches: [number, number][] }, el: HTMLElement): void {
    renderHighlighted(el, v.tag, v.matches);
  }
  selectSuggestion(v: { tag: string }): void {
    const ctx = this.context;
    if (!ctx) return;
    const editor = ctx.editor;
    const from = editor.posToOffset(ctx.start);
    const to = editor.posToOffset(ctx.end);
    const after = editor.getValue().slice(to, to + 1);
    const insert = v.tag + (after === " " ? "" : " ");
    this.close();
    editor.cm.dispatch({ changes: { from, to, insert }, selection: { anchor: from + v.tag.length + 1 }, userEvent: "input.complete" });
    editor.cm.focus();
  }
}

// ---------------------------------------------------------------------------------------------
// Built-in: ==highlight colour suggest (typed "==").

const COLOR_NAMES: [string, string | null][] = [
  ["Default", null],
  ["Red", "red"],
  ["Orange", "orange"],
  ["Yellow", "yellow"],
  ["Green", "green"],
  ["Blue", "blue"],
  ["Purple", "purple"],
];

export class HighlightColorSuggest extends EditorSuggest<[string, string | null]> {
  onTrigger(cursor: EditorPosition, editor: any, _file?: any): EditorSuggestTriggerInfo | null {
    const line: string = editor.getLine(cursor.line);
    const before = line.slice(0, cursor.ch);
    if (!/(^|[^=])==$/.test(before)) return null;
    // Only right after typing the opening ==, not a closing one.
    const opens = (before.slice(0, -2).match(/==/g) ?? []).length;
    if (opens % 2 === 1) return null;
    return { start: cursor, end: cursor, query: "" };
  }
  getSuggestions() {
    return COLOR_NAMES;
  }
  renderSuggestion(v: [string, string | null], el: HTMLElement): void {
    el.addClass("mod-complex");
    const sw = el.createDiv("suggestion-icon").createDiv("highlight-swatch");
    if (v[1]) sw.setAttr("data-highlight", v[1]);
    el.createDiv("suggestion-content").createDiv({ cls: "suggestion-title", text: v[0] });
  }
  selectSuggestion(v: [string, string | null]): void {
    const ctx = this.context;
    if (!ctx) return;
    const editor = ctx.editor;
    const at = editor.posToOffset(ctx.end);
    this.close();
    if (v[1]) {
      const e = HIGHLIGHT_COLORS[v[1]];
      editor.cm.dispatch({ changes: { from: at, insert: e }, selection: { anchor: at + e.length }, userEvent: "input.complete" });
    }
    editor.cm.focus();
  }
}

/** Open the link suggest at the cursor (used by "Add internal link"/"Add embed"). */
export function openSuggestAt(view: any): void {
  const m = getSuggestManager(view.app);
  m.trigger(view.cm, view, true);
}
