// MarkdownView ("markdown"): CodeMirror 6 editor in live preview or source mode, plus reading
// view; inline title; properties; Editor API for plugins; external-change reload.
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { TextFileView } from "../workspace/view";
import type { WorkspaceLeaf } from "../workspace/leaf";
import type { TFile } from "../vault/files";
import { Editor } from "./editor";
import { buildEditorExtensions, compartments, configExtensions, configFromVault } from "./extensions";
import { setLivePreview } from "./fields";
import { refreshLivePreview } from "./live-preview";
import { PropertiesEditor } from "./properties";
import { getFrontMatterInfo, parseYaml, stringifyYaml } from "../../core/parse";
import { renderMarkdownInto } from "../markdown/renderer";
import { resolveSubpath } from "../metadata/cache";
import { Component } from "../api/events";
import { Notice } from "../ui/notice";
import { Menu } from "../ui/menu";
import { setIcon } from "../dom/icons";

export type MarkdownMode = "source" | "preview";

class PreviewMode extends Component {
  containerEl: HTMLElement;
  sizerEl: HTMLElement;
  headerEl: HTMLElement;
  private renderComp: Component | null = null;
  private renderedFor: string | null = null;
  constructor(private view: MarkdownView) {
    super();
    this.containerEl = createDiv("markdown-reading-view");
    const pv = this.containerEl.createDiv("markdown-preview-view markdown-rendered node-insert-event allow-fold-headings allow-fold-lists show-indentation-guide show-properties");
    this.sizerEl = pv.createDiv("markdown-preview-sizer markdown-preview-section");
    this.headerEl = createDiv("mod-header");
  }
  get previewEl(): HTMLElement {
    return this.containerEl.firstElementChild as HTMLElement;
  }
  /** Re-render the note. `full` forces it even if the text didn't change. */
  async rerender(full = false): Promise<void> {
    const text = this.view.data;
    if (!full && this.renderedFor === text) return;
    this.renderedFor = text;
    const scroll = this.previewEl.scrollTop;
    if (this.renderComp) this.removeChild(this.renderComp);
    this.renderComp = this.addChild(new Component());
    this.sizerEl.empty();
    this.sizerEl.createDiv("markdown-preview-pusher");
    this.sizerEl.appendChild(this.headerEl);
    this.view.mountHeader(this.headerEl, true);
    const fm = getFrontMatterInfo(text);
    const body = fm.exists ? text.slice(fm.contentStart) : text;
    const lineOffset = fm.exists ? text.slice(0, fm.contentStart).split("\n").length - 1 : 0;
    let frontmatter: any = null;
    try {
      frontmatter = fm.exists ? parseYaml(fm.frontmatter) : null;
    } catch {
      /* invalid yaml */
    }
    const content = createDiv();
    await renderMarkdownInto(this.view.app, body, content, this.view.file?.path ?? "", this.renderComp, { embedDepth: 0, lineOffset, frontmatter, sourceText: text });
    while (content.firstChild) this.sizerEl.appendChild(content.firstChild);
    this.sizerEl.createDiv("mod-footer");
    // Checkboxes toggle the source.
    this.sizerEl.querySelectorAll<HTMLInputElement>("input.task-list-item-checkbox").forEach((cb) => {
      cb.addEventListener("click", (e) => {
        const line = Number(cb.getAttribute("data-line"));
        if (!Number.isFinite(line) || line < 0) return;
        e.preventDefault();
        this.view.toggleTaskAtLine(line);
      });
    });
    this.previewEl.scrollTop = scroll;
  }
  applyScroll(line: number): void {
    const els = Array.from(this.sizerEl.querySelectorAll<HTMLElement>("[data-line]"));
    let best: HTMLElement | null = null;
    for (const el of els) {
      const l = Number(el.getAttribute("data-line"));
      if (l <= line) best = el;
      else break;
    }
    best?.scrollIntoView({ block: "start" });
  }
  getScroll(): number {
    return this.previewEl.scrollTop;
  }
}

export class MarkdownView extends TextFileView {
  icon = "file-text";
  editor: Editor;
  cm: EditorView;
  mode: MarkdownMode = "source";
  sourceMode = false; // true = plain source, false = live preview
  sourceEl: HTMLElement;
  previewMode: PreviewMode;
  inlineTitleEl: HTMLElement;
  properties: PropertiesEditor;
  private settingData = false;
  private propsTimer: any = null;
  private renderTimer: any = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.contentEl.addClass("markdown-view-content");
    this.sourceEl = this.contentEl.createDiv("markdown-source-view cm-s-obsidian mod-cm6 node-insert-event is-folding show-properties");
    this.previewMode = new PreviewMode(this);
    this.addChild(this.previewMode);
    this.contentEl.appendChild(this.previewMode.containerEl);
    this.inlineTitleEl = createDiv({ cls: "inline-title", attr: { contenteditable: "true", spellcheck: "false", tabindex: "-1", autocapitalize: "on" } });
    this.setupInlineTitle();
    this.properties = new PropertiesEditor(this.app, (fm) => this.writeFrontmatter(fm));
    const cfg = configFromVault(this.app.vault);
    this.sourceMode = !this.app.vault.getConfig("livePreview");
    this.cm = new EditorView({
      parent: this.sourceEl,
      state: this.makeState(""),
    });
    this.editor = new Editor(this.cm, this);
    void cfg;
    this.wrapEditorDom();
    this.applyAppearance();
  }

  sizerEl: HTMLElement;
  editorHeaderEl: HTMLElement;
  private fmHidden = false;

  /**
   * Give the editor Obsidian's DOM shape (.cm-scroller > .cm-sizer > [inline title, properties,
   * .cm-contentContainer > .cm-content]) because themes style those elements. CodeMirror only
   * needs contentDOM to stay inside scrollDOM; gutters insert themselves before the sizer.
   */
  private wrapEditorDom(): void {
    const scroller = this.cm.scrollDOM;
    this.sizerEl = createDiv("cm-sizer");
    const container = createDiv("cm-contentContainer");
    scroller.insertBefore(this.sizerEl, this.cm.contentDOM);
    this.editorHeaderEl = this.sizerEl.createDiv("cm-note-header");
    this.sizerEl.appendChild(container);
    container.appendChild(this.cm.contentDOM);
    const sizer = this.sizerEl;
    const nativeInsert = Node.prototype.insertBefore;
    (scroller as any).insertBefore = function (node: Node, ref: Node | null) {
      if (ref && ref.parentNode !== this) ref = sizer;
      return nativeInsert.call(this, node, ref);
    };
    this.mountEditorHeader();
  }

  /** Called by live preview when it hides (or shows) the YAML block. */
  onFrontmatterHidden(hidden: boolean): void {
    if (hidden === this.fmHidden) return;
    this.fmHidden = hidden;
    queueMicrotask(() => this.mountEditorHeader());
  }

  private mountEditorHeader(): void {
    if (!this.editorHeaderEl || this.mode !== "source") return;
    this.editorHeaderEl.empty();
    this.mountHeader(this.editorHeaderEl, this.fmHidden && !this.sourceMode);
  }

  get editMode(): any {
    return { editor: this.editor, cm: this.cm, updateOptions: () => this.updateOptions(), containerEl: this.sourceEl, sourceMode: this.sourceMode };
  }
  get currentMode(): any {
    return this.mode === "preview" ? this.previewMode : this.editMode;
  }

  private makeState(doc: string): EditorState {
    const cfg = configFromVault(this.app.vault);
    const exts: Extension[] = buildEditorExtensions(this, cfg, !this.sourceMode, this.app.workspace.editorExtensions.slice());
    exts.push(
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !this.settingData) {
          this.data = u.state.doc.toString();
          this.requestSave();
          this.app.workspace.trigger("editor-change", this.editor, this);
          clearTimeout(this.propsTimer);
          this.propsTimer = setTimeout(() => this.syncPropertiesFromText(), 150);
        }
        if (u.focusChanged || u.selectionSet) this.app.workspace.trigger("editor-selection-change", this.editor, this);
      }),
      EditorView.domEventHandlers({
        contextmenu: (e) => {
          e.preventDefault();
          const m = new Menu();
          m.addItem((i) => i.setTitle("Cut").setIcon("scissors").setSection("clipboard").onClick(() => document.execCommand("cut")));
          m.addItem((i) => i.setTitle("Copy").setIcon("copy").setSection("clipboard").onClick(() => document.execCommand("copy")));
          m.addItem((i) => i.setTitle("Paste").setIcon("clipboard-paste").setSection("clipboard").onClick(async () => this.editor.replaceSelection(await navigator.clipboard.readText())));
          m.addItem((i) => i.setTitle("Select all").setIcon("text-select").setSection("selection").onClick(() => this.editor.exec("selectAll")));
          this.app.workspace.trigger("editor-menu", m, this.editor, this);
          m.showAtMouseEvent(e);
          return true;
        },
        paste: (e) => this.app.handlePaste?.(e, this) ?? false,
        drop: (e) => this.app.handleDrop?.(e, this) ?? false,
      }),
    );
    return EditorState.create({ doc, extensions: exts });
  }

  getViewType(): string {
    return "markdown";
  }
  getMode(): MarkdownMode {
    return this.mode;
  }
  canAcceptExtension(ext: string): boolean {
    return ext === "md";
  }

  getState(): any {
    const s: any = super.getState();
    s.mode = this.mode;
    s.source = this.sourceMode;
    return s;
  }

  async setState(state: any, result: { history: boolean }): Promise<void> {
    if (state?.mode === "preview" || state?.mode === "source") this.setModeInternal(state.mode);
    if (typeof state?.source === "boolean") this.setSourceMode(state.source);
    await super.setState(state, result);
  }

  getEphemeralState(): any {
    const r = this.cm.state.selection.main;
    const from = this.editor.offsetToPos(r.from);
    const to = this.editor.offsetToPos(r.to);
    return { cursor: { from, to }, scroll: this.mode === "preview" ? this.previewMode.getScroll() : this.cm.scrollDOM.scrollTop };
  }

  setEphemeralState(s: any): void {
    if (!s) return;
    if (s.rename === "all" || s.rename === "end") {
      setTimeout(() => this.focusInlineTitle(s.rename === "all"), 30);
      return;
    }
    if (s.subpath && this.file) {
      const cache = this.app.metadataCache.getFileCache(this.file);
      const r = cache ? resolveSubpath(cache, s.subpath) : null;
      if (r) {
        const line = r.start.line;
        this.scrollToLine(line, true);
        return;
      }
    }
    if (typeof s.line === "number") {
      this.scrollToLine(s.line, true);
      return;
    }
    if (s.cursor) {
      try {
        this.editor.setSelection(s.cursor.from, s.cursor.to);
      } catch {
        /* out of range */
      }
    }
    if (typeof s.scroll === "number") {
      requestAnimationFrame(() => {
        if (this.mode === "preview") this.previewMode.previewEl.scrollTop = s.scroll;
        else this.cm.scrollDOM.scrollTop = s.scroll;
      });
    }
  }

  private scrollToLine(line: number, setCursor: boolean): void {
    if (this.mode === "preview") {
      setTimeout(() => this.previewMode.applyScroll(line), 50);
      return;
    }
    const l = Math.min(line, this.cm.state.doc.lines - 1);
    const pos = this.cm.state.doc.line(l + 1).from;
    this.cm.dispatch({ selection: setCursor ? { anchor: pos } : undefined, effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 40 }) });
  }

  // ----- data -----
  getViewData(): string {
    return this.cm.state.doc.toString();
  }

  setViewData(data: string, clear: boolean): void {
    this.settingData = true;
    try {
      if (clear) {
        this.cm.setState(this.makeState(data));
      } else {
        // Apply only the changed middle so the cursor and scroll stay put.
        const cur = this.cm.state.doc.toString();
        let a = 0;
        while (a < cur.length && a < data.length && cur.charCodeAt(a) === data.charCodeAt(a)) a++;
        let b = 0;
        while (b < cur.length - a && b < data.length - a && cur.charCodeAt(cur.length - 1 - b) === data.charCodeAt(data.length - 1 - b)) b++;
        this.cm.dispatch({ changes: { from: a, to: cur.length - b, insert: data.slice(a, data.length - b) }, userEvent: "set" });
      }
    } finally {
      this.settingData = false;
    }
    this.data = data;
    this.syncPropertiesFromText();
    if (this.mode === "preview") this.previewMode.rerender(true);
  }

  clear(): void {
    this.settingData = true;
    this.cm.setState(this.makeState(""));
    this.settingData = false;
  }

  async onLoadFile(file: TFile): Promise<void> {
    await super.onLoadFile(file);
    this.inlineTitleEl.setText(file.basename);
    this.containerEl.setAttr("data-mode", this.mode);
    this.refreshHeader();
  }

  async onRename(file: TFile): Promise<void> {
    await super.onRename(file);
    if (document.activeElement !== this.inlineTitleEl) this.inlineTitleEl.setText(file.basename);
  }

  // ----- header: inline title + properties -----
  mountHeader(wrap: HTMLElement, withProperties: boolean): void {
    if (this.app.vault.getConfig("showInlineTitle") !== false) wrap.appendChild(this.inlineTitleEl);
    else this.inlineTitleEl.detach();
    const showProps = this.app.vault.getConfig("propertiesInDocument") !== "hidden";
    if (withProperties && showProps) wrap.appendChild(this.properties.el);
    else if (this.properties.el.parentElement === wrap) this.properties.el.detach();
  }

  private refreshHeader(): void {
    this.cm.dispatch({ effects: refreshLivePreview.of(null) });
    this.mountEditorHeader();
  }

  private setupInlineTitle(): void {
    const el = this.inlineTitleEl;
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.commitInlineTitle();
        this.cm.focus();
        this.cm.dispatch({ selection: { anchor: getFrontMatterInfo(this.data).contentStart } });
      } else if (e.key === "Escape") {
        el.setText(this.file?.basename ?? "");
        this.cm.focus();
      }
    });
    el.addEventListener("blur", () => this.commitInlineTitle());
    el.addEventListener("paste", (e) => {
      e.preventDefault();
      const t = e.clipboardData?.getData("text/plain")?.replace(/\n/g, " ") ?? "";
      document.execCommand("insertText", false, t);
    });
  }

  focusInlineTitle(selectAll: boolean): void {
    const el = this.inlineTitleEl;
    if (!el.isConnected) return;
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    if (!selectAll) r.collapse(false);
    const s = window.getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  }

  private async commitInlineTitle(): Promise<void> {
    const file = this.file;
    if (!file) return;
    const name = (this.inlineTitleEl.textContent ?? "").trim();
    if (!name || name === file.basename) {
      this.inlineTitleEl.setText(file.basename);
      return;
    }
    if (/[\\/:]/.test(name)) {
      new Notice('File names can\'t contain any of these characters: \\ / :');
      this.inlineTitleEl.setText(file.basename);
      return;
    }
    const newPath = (file.parent && !file.parent.isRoot() ? file.parent.path + "/" : "") + name + "." + file.extension;
    try {
      await this.app.fileManager.renameFile(file, newPath);
    } catch (e: any) {
      new Notice(`Couldn't rename: ${e?.message ?? e}`);
      this.inlineTitleEl.setText(file.basename);
    }
  }

  private syncPropertiesFromText(): void {
    const fm = getFrontMatterInfo(this.data);
    let obj: any = null;
    if (fm.exists) {
      try {
        obj = parseYaml(fm.frontmatter);
      } catch {
        obj = null;
      }
    }
    this.properties.setFrontmatter(obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null);
  }

  private writeFrontmatter(fm: Record<string, any>): void {
    const text = this.cm.state.doc.toString();
    const info = getFrontMatterInfo(text);
    const yaml = Object.keys(fm).length ? "---\n" + stringifyYaml(fm) + "---\n" : "";
    const from = 0;
    const to = info.exists ? info.contentStart : 0;
    this.cm.dispatch({ changes: { from, to, insert: yaml }, userEvent: "input.properties" });
  }

  toggleTaskAtLine(line: number): void {
    const doc = this.cm.state.doc;
    if (line >= doc.lines) return;
    const l = doc.line(line + 1);
    const m = l.text.match(/^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\])/);
    if (!m) return;
    const pos = l.from + m[1].length;
    this.cm.dispatch({ changes: { from: pos, to: pos + 1, insert: m[2] === " " ? "x" : " " } });
    this.previewMode.rerender(true);
  }

  // ----- modes -----
  private setModeInternal(mode: MarkdownMode): void {
    this.mode = mode;
    this.sourceEl.toggle(mode === "source");
    this.previewMode.containerEl.toggle(mode === "preview");
    this.containerEl.setAttr("data-mode", mode);
    if (mode === "preview") this.previewMode.rerender(true);
    else this.refreshHeader();
  }

  async setMode(mode: MarkdownMode): Promise<void> {
    const line = this.topLine();
    this.setModeInternal(mode);
    if (mode === "preview") setTimeout(() => this.previewMode.applyScroll(line), 30);
    else this.scrollToLine(line, false);
    this.app.workspace.requestSaveLayout();
    this.leaf.updateHeader();
  }

  toggleMode(): void {
    this.setMode(this.mode === "preview" ? "source" : "preview");
  }

  setSourceMode(source: boolean): void {
    this.sourceMode = source;
    this.sourceEl.toggleClass("is-live-preview", !source);
    this.cm.dispatch({ effects: setLivePreview.of(!source) });
    this.app.workspace.requestSaveLayout();
  }

  toggleSource(): void {
    if (this.mode === "preview") this.setModeInternal("source");
    this.setSourceMode(!this.sourceMode);
  }

  private topLine(): number {
    try {
      if (this.mode === "preview") {
        const els = Array.from(this.previewMode.sizerEl.querySelectorAll<HTMLElement>("[data-line]"));
        const top = this.previewMode.previewEl.getBoundingClientRect().top;
        for (const el of els) if (el.getBoundingClientRect().bottom > top) return Number(el.getAttribute("data-line")) || 0;
        return 0;
      }
      const block = this.cm.lineBlockAtHeight(this.cm.scrollDOM.scrollTop);
      return this.cm.state.doc.lineAt(block.from).number - 1;
    } catch {
      return 0;
    }
  }

  // ----- appearance & options -----
  applyAppearance(): void {
    const v = this.app.vault;
    const readable = v.getConfig("readableLineLength") !== false;
    this.sourceEl.toggleClass("is-readable-line-width", readable);
    this.previewMode.previewEl.toggleClass("is-readable-line-width", readable);
    this.sourceEl.toggleClass("is-live-preview", !this.sourceMode);
    this.sourceEl.toggleClass("show-line-numbers", !!v.getConfig("showLineNumber"));
    const showProps = v.getConfig("propertiesInDocument") !== "hidden";
    this.sourceEl.toggleClass("show-properties", showProps);
  }

  updateOptions(): void {
    const ce = configExtensions(configFromVault(this.app.vault));
    this.cm.dispatch({
      effects: [
        compartments.vim.reconfigure(ce.vim),
        compartments.lineNumbers.reconfigure(ce.lineNumbers),
        compartments.spellcheck.reconfigure(ce.spellcheck),
        compartments.tabs.reconfigure(ce.tabs),
        compartments.autopair.reconfigure(ce.autopair),
        compartments.fold.reconfigure(ce.fold),
        compartments.plugins.reconfigure(this.app.workspace.editorExtensions.slice()),
        refreshLivePreview.of(null),
      ],
    });
    this.applyAppearance();
    if (this.mode === "preview") this.previewMode.rerender(true);
  }

  focus(): void {
    if (this.mode === "source") this.cm.focus();
  }

  editorHasFocus(): boolean {
    return this.cm?.hasFocus ?? false;
  }

  onResize(): void {
    this.cm.requestMeasure();
  }

  getDisplayText(): string {
    return this.file?.basename ?? "No file";
  }

  onPaneMenu(menu: Menu, source: string): void {
    menu.addItem((i) =>
      i
        .setTitle(this.mode === "preview" ? "Editing view" : "Reading view")
        .setIcon(this.mode === "preview" ? "pencil" : "book-open")
        .setSection("view")
        .onClick(() => this.toggleMode()),
    );
    menu.addItem((i) =>
      i
        .setTitle(this.sourceMode ? "Live Preview" : "Source mode")
        .setIcon("code")
        .setSection("view")
        .onClick(() => this.toggleSource()),
    );
    if (this.file) this.app.workspace.trigger("file-menu", menu, this.file, source, this.leaf);
    super.onPaneMenu(menu, source);
  }

  protected async onOpen(): Promise<void> {
    this.addAction("book-open", "Current view: editing. Click to read", () => this.toggleMode());
    this.registerEvent(
      this.app.vault.on("config-changed", () => {
        this.applyAppearance();
      }),
    );
    this.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        clearTimeout(this.renderTimer);
        this.renderTimer = setTimeout(() => this.cm.dispatch({ effects: refreshLivePreview.of(null) }), 200);
      }),
    );
    this.setModeInternal(this.mode);
  }

  updateHeader(): void {
    super.updateHeader();
    const btn = this.actionsEl?.querySelector<HTMLElement>(".view-action[aria-label^='Current view']");
    if (btn) {
      btn.empty();
      setIcon(btn, this.mode === "preview" ? "pencil" : "book-open");
      btn.setAttr("aria-label", this.mode === "preview" ? "Current view: reading. Click to edit" : "Current view: editing. Click to read");
    }
  }

  async onClose(): Promise<void> {
    await super.onClose();
    this.cm.destroy();
  }
}
