// Compatibility layer for community plugins: API classes from obsidian.d.ts 1.14 that the rest of
// the app doesn't implement yet (so `class X extends obsidian.Y` doesn't fail to load), plus the
// globals and app internals popular plugins reach for (window.CodeMirror, CodeMirrorAdapter,
// app.metadataTypeManager, app.embedRegistry). Found by loading real plugins (docs/PLUGINS.md).
import { Modal } from "../ui/modal";
import { ButtonComponent } from "../ui/setting";
import { Component } from "./events";
import { TAbstractFile } from "../vault/files";
import { WorkspaceSplit } from "../workspace/items";
import { MarkdownRenderChild, MarkdownRenderer, postProcessors, codeBlockProcessors } from "../markdown/renderer";
import { editorLivePreviewField } from "../editor/fields";
import { Language as CMLanguage } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Editor } from "../editor/editor";
import { buildEditorExtensions, configFromVault } from "../editor/extensions";
import { javascript as legacyJs } from "@codemirror/legacy-modes/mode/javascript";
import { css as legacyCss } from "@codemirror/legacy-modes/mode/css";
import { yaml as legacyYaml } from "@codemirror/legacy-modes/mode/yaml";

// ---------------------------------------------------------------- ConfirmationModal (1.14)
export class ConfirmationButton extends ButtonComponent {
  private handler: ((evt: MouseEvent) => unknown) | null = null;
  initialFocus = false;
  secondary = false;
  constructor(containerEl: HTMLElement, private modal: ConfirmationModal) {
    super(containerEl);
    this.buttonEl.addEventListener("click", async (e) => {
      const keepOpen = this.handler ? await this.handler(e) : false;
      if (!keepOpen) this.modal.close();
    });
  }
  onClick(handler: (evt: MouseEvent) => unknown): this {
    this.handler = handler;
    return this;
  }
  setInitialFocus(): this {
    this.initialFocus = true;
    return this;
  }
  setSecondary(): this {
    this.secondary = true;
    this.buttonEl.addClass("mod-secondary");
    return this;
  }
  setCancel(): this {
    this.buttonEl.addClass("mod-cancel");
    return this;
  }
}

export class ConfirmationModal extends Modal {
  buttonContainerEl: HTMLElement;
  private buttons: ConfirmationButton[] = [];
  constructor(app: any) {
    super(app);
    this.modalEl.addClass("mod-confirmation");
    this.buttonContainerEl = this.modalEl.createDiv("modal-button-container");
  }
  addClass(cls: string): this {
    this.modalEl.addClass(cls);
    return this;
  }
  addCheckbox(label: string, cb: (value: boolean) => any): this {
    const l = this.buttonContainerEl.createEl("label", { cls: "mod-checkbox" });
    const i = l.createEl("input", { type: "checkbox" });
    l.appendText(" " + label);
    i.addEventListener("change", () => cb(i.checked));
    this.buttonContainerEl.prepend(l);
    return this;
  }
  addButton(cb: (btn: ConfirmationButton) => any): this {
    const b = new ConfirmationButton(this.buttonContainerEl, this);
    this.buttons.push(b);
    cb(b);
    return this;
  }
  addCancelButton(text = "Cancel"): this {
    return this.addButton((b) => b.setButtonText(text).setCancel());
  }
  open(): void {
    super.open();
    const f = [...this.buttons].reverse().find((b) => b.initialFocus);
    f?.buttonEl.focus();
  }
}

// ---------------------------------------------------------------- small classes
export class MenuSeparator {
  constructor(public menu?: any) {}
}
export class TExternalFile extends TAbstractFile {}
export class CapacitorAdapter {}
export class WorkspaceContainer extends WorkspaceSplit {}
export class WorkspaceWindow extends WorkspaceContainer {}
export class WorkspaceFloating extends WorkspaceSplit {}
export class WorkspaceMobileDrawer extends WorkspaceSplit {}
export class MarkdownPreviewView extends MarkdownRenderer {}
export class MarkdownEditView {}
export class RenderContext {}
export class DisplayValueComponent extends Component {}
export const livePreviewState = editorLivePreviewField;

/** MarkdownPreviewRenderer: the old static post-processor registry. */
export class MarkdownPreviewRenderer {
  static registerPostProcessor(pp: any, sortOrder?: number): void {
    if (sortOrder !== undefined) pp.sortOrder = sortOrder;
    postProcessors.push(pp);
  }
  static unregisterPostProcessor(pp: any): void {
    const i = postProcessors.indexOf(pp);
    if (i >= 0) postProcessors.splice(i, 1);
  }
  static registerDomEvents(): void {}
  static createCodeBlockPostProcessor(language: string, handler: (source: string, el: HTMLElement, ctx: any) => any): any {
    codeBlockProcessors[language] = handler;
    return handler;
  }
}

export function parsePropertyId(id: string): { type: "note" | "file" | "formula"; name: string } {
  if (id.startsWith("file.")) return { type: "file", name: id.slice(5) };
  if (id.startsWith("formula.")) return { type: "formula", name: id.slice(8) };
  return { type: "note", name: id.startsWith("note.") ? id.slice(5) : id };
}

// ---------------------------------------------------------------- Bases API values (1.10+)
export abstract class Value {
  static type = "value";
  abstract toString(): string;
  isTruthy(): boolean {
    return !!this.toString();
  }
  equals(other: Value): boolean {
    return this.toString() === other?.toString();
  }
  looseEquals(other: Value): boolean {
    return this.equals(other);
  }
  renderTo(el: HTMLElement, _ctx?: any): void {
    el.setText(this.toString());
  }
}
export class NullValue extends Value {
  static value = new NullValue();
  toString(): string {
    return "";
  }
  isTruthy(): boolean {
    return false;
  }
}
export class NotNullValue extends Value {
  toString(): string {
    return "";
  }
}
export class PrimitiveValue<T> extends NotNullValue {
  constructor(public value: T) {
    super();
  }
  toString(): string {
    return String(this.value ?? "");
  }
  isTruthy(): boolean {
    return !!this.value;
  }
}
export class StringValue extends PrimitiveValue<string> {}
export class NumberValue extends PrimitiveValue<number> {}
export class BooleanValue extends PrimitiveValue<boolean> {}
export class DateValue extends PrimitiveValue<any> {
  toString(): string {
    return this.value?.format ? this.value.format("YYYY-MM-DD") : String(this.value ?? "");
  }
}
export class RelativeDateValue extends DateValue {}
export class DurationValue extends PrimitiveValue<any> {}
export class RegExpValue extends PrimitiveValue<RegExp> {}
export class UrlValue extends StringValue {}
export class HTMLValue extends StringValue {}
export class IconValue extends StringValue {}
export class ImageValue extends StringValue {}
export class TagValue extends StringValue {}
export class LinkValue extends StringValue {}
export class FileValue extends PrimitiveValue<any> {
  toString(): string {
    return this.value?.path ?? "";
  }
}
export class ListValue extends NotNullValue {
  constructor(public value: Value[]) {
    super();
  }
  toString(): string {
    return this.value.map((v) => v.toString()).join(", ");
  }
  isTruthy(): boolean {
    return this.value.length > 0;
  }
  length(): number {
    return this.value.length;
  }
  get(i: number): Value {
    return this.value[i] ?? NullValue.value;
  }
}
export class ObjectValue extends PrimitiveValue<Record<string, any>> {
  toString(): string {
    return JSON.stringify(this.value);
  }
}
export class BasesEntry {
  constructor(public file: any, public ctx?: any) {}
  getValue(_propertyId: string): Value {
    return NullValue.value;
  }
}
export class BasesEntryGroup {
  key: Value = NullValue.value;
  entries: BasesEntry[] = [];
  hasKey(): boolean {
    return !(this.key instanceof NullValue);
  }
}
export class BasesQueryResult {
  data: BasesEntry[] = [];
  groupedData: BasesEntryGroup[] = [];
  properties: string[] = [];
}
export class BasesViewConfig {
  name = "";
  get(_key: string): unknown {
    return undefined;
  }
  set(_key: string, _value: unknown): void {}
  getOrder(): string[] {
    return [];
  }
  getDisplayName(id: string): string {
    return parsePropertyId(id).name;
  }
}
export class QueryController extends Component {}
/** Base class for custom Bases views (plugin.registerBasesView). Not run by Bedrock's Bases yet. */
export abstract class BasesView extends Component {
  type = "";
  app: any;
  config = new BasesViewConfig();
  allProperties: string[] = [];
  data = new BasesQueryResult();
  constructor(public controller?: QueryController) {
    super();
    this.app = (window as any).app;
  }
  abstract onDataUpdated(): void;
}

// ---------------------------------------------------------------- globals and app internals
/** CodeMirror 5 global (Obsidian ships one for modes and vim); plugins register modes on it. */
function installCodeMirror5Shim(): void {
  const w = window as any;
  if (w.CodeMirror) return;
  const modes: Record<string, any> = {};
  const mimes: Record<string, any> = {};
  const cm: any = function CodeMirror() {
    throw new Error("CodeMirror 5 editors aren't available in this app.");
  };
  cm.defineMode = (name: string, factory: any) => (modes[name] = factory);
  cm.defineMIME = (mime: string, spec: any) => (mimes[mime] = spec);
  const nullMode = () => ({ name: "null", startState: () => ({}), copyState: (s: any) => ({ ...s }), token: (s: any) => (s.skipToEnd(), null) });
  // CodeMirror 5-style modes from the CM6 legacy-modes package (StreamParser has the same shape).
  const fromStream = (p: any) => () => ({ ...p, startState: (indentUnit?: number) => (p.startState ? p.startState(indentUnit ?? 2) : {}), copyState: p.copyState ?? ((s: any) => (s && typeof s === "object" ? JSON.parse(JSON.stringify(s)) : s)) });
  modes.javascript = fromStream(legacyJs);
  modes.css = fromStream(legacyCss);
  modes.yaml = fromStream(legacyYaml);
  cm.getMode = (config: any, spec: any) => {
    const name = typeof spec === "string" ? spec : spec?.name;
    const f = modes[name] ?? (mimes[name] ? modes[typeof mimes[name] === "string" ? mimes[name] : mimes[name]?.name] : undefined);
    try {
      const m = f ? f(config ?? {}, spec ?? {}) : nullMode();
      if (!m.startState) m.startState = () => ({});
      return m;
    } catch {
      return nullMode();
    }
  };
  cm.startState = (mode: any, a1?: any, a2?: any) => (mode.startState ? mode.startState(a1, a2) : true);
  cm.copyState = (mode: any, state: any) => (mode.copyState ? mode.copyState(state) : state && typeof state === "object" ? { ...state } : state);
  cm.innerMode = (mode: any, state: any) => ({ mode, state });
  cm.StringStream = class {
    pos = 0;
    start = 0;
    constructor(public string: string) {}
    eol() {
      return this.pos >= this.string.length;
    }
    sol() {
      return this.pos === 0;
    }
    peek() {
      return this.string.charAt(this.pos) || undefined;
    }
    next() {
      return this.pos < this.string.length ? this.string.charAt(this.pos++) : undefined;
    }
    skipToEnd() {
      this.pos = this.string.length;
    }
    current() {
      return this.string.slice(this.start, this.pos);
    }
  };
  cm.modes = modes;
  cm.mimeModes = mimes;
  cm.modeInfo = [];
  cm.findModeByName = (n: string) => cm.modeInfo.find((m: any) => m.name.toLowerCase() === String(n).toLowerCase() || m.alias?.includes(n)) ?? null;
  cm.findModeByExtension = (e: string) => cm.modeInfo.find((m: any) => m.ext?.includes(e)) ?? null;
  cm.findModeByMIME = (m: string) => cm.modeInfo.find((x: any) => x.mime === m) ?? null;
  cm.defineSimpleMode = (name: string, _states: any) => (modes[name] = () => ({ token: (s: any) => s.skipToEnd() }));
  cm.commands = {};
  cm.keyMap = {};
  cm.defineExtension = () => undefined;
  cm.defineOption = () => undefined;
  cm.registerHelper = () => undefined;
  cm.Pos = (line: number, ch: number) => ({ line, ch });
  cm.runMode = (text: string, _mode: any, cb: any) => cb(text, null);
  w.CodeMirror = cm;
  // Vim adapter global (Linter and vimrc plugins attach commands to it).
  w.CodeMirrorAdapter = w.CodeMirrorAdapter ?? { commands: {}, keyMap: {}, Vim: null };
}

/** app.metadataTypeManager (property types), backed by app.propertyTypes / types.json. */
function installMetadataTypeManager(app: any): void {
  if (app.metadataTypeManager) return;
  const pt = app.propertyTypes;
  app.metadataTypeManager = {
    get types() {
      return pt?.types ?? {};
    },
    get properties() {
      return this.getAllProperties();
    },
    getAllProperties(): Record<string, { name: string; type: string; count: number }> {
      const out: Record<string, { name: string; type: string; count: number }> = {};
      for (const f of app.vault.getMarkdownFiles()) {
        const fm = app.metadataCache.getFileCache(f)?.frontmatter;
        if (!fm) continue;
        for (const [k, v] of Object.entries(fm)) {
          const key = k.toLowerCase();
          const e = out[key] ?? (out[key] = { name: k, type: pt?.get?.(k, v) ?? "text", count: 0 });
          e.count++;
        }
      }
      for (const [k, t] of Object.entries(pt?.types ?? {})) if (!out[k.toLowerCase()]) out[k.toLowerCase()] = { name: k, type: String(t), count: 0 };
      return out;
    },
    getPropertyInfo(name: string) {
      return this.getAllProperties()[String(name).toLowerCase()] ?? null;
    },
    getAssignedType(name: string) {
      return pt?.types?.[name] ?? pt?.types?.[String(name).toLowerCase()] ?? null;
    },
    getAssignedWidget(name: string) {
      return this.getAssignedType(name);
    },
    getTypeInfo(name: string, value?: any) {
      const t = pt?.get?.(name, value) ?? "text";
      return { expected: { type: t }, inferred: { type: t } };
    },
    setType(name: string, type: string) {
      pt?.set?.(name, type);
      app.metadataCache?.trigger?.("properties-changed");
    },
    unsetType(name: string) {
      if (pt?.types) {
        delete pt.types[name];
        pt.save?.();
      }
    },
    on: (...a: any[]) => app.metadataCache.on(...a),
    off: (...a: any[]) => app.metadataCache.off?.(...a),
    trigger: (...a: any[]) => app.metadataCache.trigger(...a),
  };
}

/** A small Markdown editor that can live anywhere (Obsidian's internal embeddable editor that some
 * plugins, e.g. Kanban, get from an embed's `editMode` and subclass): `new X(app, containerEl,
 * owner)`, `.cm`, `.editor`, `set(text)`, `buildLocalExtensions()`, `onUpdate(update, changed)`. */
export class EmbeddableMarkdownEditor extends Component {
  cm!: EditorView;
  editor!: Editor;
  editorEl: HTMLElement;
  constructor(public app: any, public containerEl: HTMLElement, public owner: any) {
    super();
    this.editorEl = containerEl.createDiv("markdown-source-view cm-s-obsidian mod-cm6 is-live-preview is-readable-line-width");
    const cfg = configFromVault(app.vault);
    const exts: Extension[] = [
      ...buildEditorExtensions(owner ?? this, cfg, true, app.workspace.editorExtensions?.slice?.() ?? []),
      ...this.buildLocalExtensions(),
      EditorView.updateListener.of((u) => this.onUpdate(u, u.docChanged)),
    ];
    this.cm = new EditorView({ state: EditorState.create({ doc: "", extensions: exts }), parent: this.editorEl });
    this.editor = new Editor(this.cm, owner ?? this);
  }
  get activeCM(): EditorView {
    return this.cm;
  }
  buildLocalExtensions(): Extension[] {
    return [];
  }
  onUpdate(_update: any, _changed: boolean): void {}
  updateBottomPadding(): void {}
  get(): string {
    return this.cm.state.doc.toString();
  }
  set(text: string, _clear?: boolean): void {
    this.cm.dispatch({ changes: { from: 0, to: this.cm.state.doc.length, insert: text } });
  }
  focus(): void {
    this.cm.focus();
  }
  destroy(): void {
    this.cm.destroy();
    this.editorEl.remove();
  }
  onunload(): void {
    this.destroy();
  }
}
/** What embed.showEditor() puts in embed.editMode (a subclass, so plugins can reach the base). */
class EmbedEditMode extends EmbeddableMarkdownEditor {}

/** app.embedRegistry: creators for ![[file.ext]] embeds by extension (Kanban, Excalidraw...). */
function installEmbedRegistry(app: any): void {
  if (app.embedRegistry) return;
  class MarkdownEmbed extends MarkdownRenderChild {
    file: any = null;
    subpath = "";
    editable = false;
    editMode: EmbeddableMarkdownEditor | null = null;
    showEditor(): void {
      if (this.editMode) return;
      this.editMode = new EmbedEditMode(app, this.containerEl, this);
      this.addChild(this.editMode);
    }
    constructor(private ctx: any, file: any, subpath = "") {
      super(ctx.containerEl);
      this.file = file;
      this.subpath = subpath;
      this.containerEl.addClass("markdown-embed", "inline-embed", "is-loaded");
    }
    async loadFile(): Promise<void> {
      if (!this.file) return;
      const text = await app.vault.cachedRead(this.file);
      this.containerEl.empty();
      const body = this.containerEl.createDiv("markdown-embed-content markdown-preview-view markdown-rendered");
      await MarkdownRenderer.render(app, text, body, this.file.path, this);
    }
  }
  const registry: any = {
    embedByExtension: {} as Record<string, (ctx: any, file: any, subpath?: string) => any>,
    registerExtension(ext: string, creator: any) {
      this.embedByExtension[ext] = creator;
    },
    registerExtensions(exts: string[], creator: any) {
      for (const e of exts) this.registerExtension(e, creator);
    },
    unregisterExtension(ext: string) {
      delete this.embedByExtension[ext];
    },
    unregisterExtensions(exts: string[]) {
      for (const e of exts) this.unregisterExtension(e);
    },
    isExtensionRegistered(ext: string) {
      return ext in this.embedByExtension;
    },
    getEmbedCreator(file: any) {
      return this.embedByExtension[file?.extension] ?? null;
    },
  };
  registry.embedByExtension.md = (ctx: any, file: any, subpath?: string) => new MarkdownEmbed(ctx, file, subpath);
  app.embedRegistry = registry;
}

/** Small internal methods popular plugins call on app objects. */
function installInternals(app: any): void {
  const mc = app.metadataCache;
  if (mc && !mc.getCachedFiles) mc.getCachedFiles = () => app.vault.getFiles().map((f: any) => f.path).filter((p: string) => !!mc.getCache(p));
  if (mc && !mc.isUserIgnored) mc.isUserIgnored = () => false;
  const hm = app.hotkeyManager;
  if (hm && !hm.addDefaultHotkeys) {
    // Plugins may add/remove default hotkeys of their commands at runtime (Excalidraw).
    const extra: Record<string, any[]> = (hm.extraDefaults = {});
    const orig = hm.getDefaultHotkeys.bind(hm);
    hm.getDefaultHotkeys = (id: string) => extra[id] ?? orig(id);
    hm.addDefaultHotkeys = (id: string, keys: any[]) => {
      extra[id] = keys;
      const c = app.commands.commands[id];
      if (c) c.hotkeys = keys;
      hm.bake();
    };
    hm.removeDefaultHotkeys = (id: string) => {
      delete extra[id];
      const c = app.commands.commands[id];
      if (c) c.hotkeys = [];
      hm.bake();
    };
  }
  const ws = app.workspace;
  if (ws && !ws.registerHoverLinkSource) {
    ws.hoverLinkSources = ws.hoverLinkSources ?? {};
    ws.registerHoverLinkSource = (id: string, info: any) => (ws.hoverLinkSources[id] = info);
    ws.unregisterHoverLinkSource = (id: string) => delete ws.hoverLinkSources[id];
  }
  if (ws && !ws.floatingSplit) ws.floatingSplit = { children: [] };
  if (app.workspace && !app.workspace.getActiveFileView) app.workspace.getActiveFileView = () => app.workspace.activeLeaf?.view?.file ? app.workspace.activeLeaf.view : null;
}

/** Plugin editor extensions that replace the Markdown language (CodeMirror 5 overlay modes such as
 * Templater's "<% %>" highlighting) only work on Obsidian's stream-based Markdown mode; here they
 * would switch off Live Preview, so they're left out (logged once). */
function guardEditorExtensions(app: any): void {
  const arr: any[] = app.workspace?.editorExtensions;
  if (!arr || (arr as any).__guarded) return;
  const warned = new WeakSet<object>();
  const isLanguage = (e: any): boolean => !!e && typeof e === "object" && (e instanceof CMLanguage || (e.inner && isLanguage(e.inner)) || (e.extension && e.language instanceof CMLanguage));
  const clean = (e: any): any => {
    if (Array.isArray(e)) return e.map(clean).filter((x) => x !== null);
    if (isLanguage(e)) {
      if (!warned.has(e)) {
        warned.add(e);
        console.warn("A plugin tried to replace the Markdown editor language; skipped so Live Preview keeps working.");
      }
      return null;
    }
    return e;
  };
  Object.defineProperty(arr, "slice", { value: (...a: any[]) => clean(Array.prototype.slice.apply(arr, a as any)), configurable: true });
  Object.defineProperty(arr, "__guarded", { value: true });
}

export function installPluginCompat(app: any): void {
  guardEditorExtensions(app);
  installCodeMirror5Shim();
  installMetadataTypeManager(app);
  installEmbedRegistry(app);
  installInternals(app);
  if (app.vault?.constructor?.DEFAULT_CONFIG && !("mobileToolbarCommands" in app.vault.constructor.DEFAULT_CONFIG)) {
    Object.assign(app.vault.constructor.DEFAULT_CONFIG, {
      mobileQuickRibbonItem: "",
      mobilePullAction: "command-palette:open",
      mobileToolbarCommands: [
        "editor:undo",
        "editor:redo",
        "editor:insert-wikilink",
        "editor:insert-embed",
        "editor:insert-tag",
        "editor:attach-file",
        "editor:set-heading",
        "editor:toggle-bold",
        "editor:toggle-italics",
        "editor:toggle-strikethrough",
        "editor:toggle-highlight",
        "editor:toggle-code",
        "editor:toggle-blockquote",
        "editor:toggle-comment",
        "editor:insert-link",
        "editor:toggle-bullet-list",
        "editor:toggle-numbered-list",
        "editor:toggle-checklist-status",
        "editor:indent-list",
        "editor:unindent-list",
        "editor:configure-toolbar",
      ],
    });
  }
}
