// PopoverSuggest, AbstractInputSuggest and EditorSuggest (obsidian API). Suggestion popovers
// attach to the document of the element they serve, so they also work in the settings window.
import { Scope } from "../commands/keymap";

export interface ISuggestOwner<T> {
  renderSuggestion(value: T, el: HTMLElement): void;
  selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void;
}

class SuggestList<T> {
  values: T[] = [];
  els: HTMLElement[] = [];
  selected = 0;
  constructor(public containerEl: HTMLElement, private owner: ISuggestOwner<T>) {
    containerEl.addEventListener("mousedown", (e) => e.preventDefault());
  }
  setSuggestions(values: T[]): void {
    this.containerEl.empty();
    this.values = values;
    this.els = values.map((v, i) => {
      const el = this.containerEl.createDiv("suggestion-item");
      this.owner.renderSuggestion(v, el);
      el.addEventListener("click", (e) => this.owner.selectSuggestion(v, e));
      el.addEventListener("mousemove", () => this.setSelected(i, false));
      return el;
    });
    this.setSelected(0, false);
  }
  setSelected(i: number, scroll: boolean): void {
    if (!this.els.length) return;
    i = (i + this.els.length) % this.els.length;
    this.els[this.selected]?.removeClass("is-selected");
    this.selected = i;
    this.els[i].addClass("is-selected");
    if (scroll) this.els[i].scrollIntoView({ block: "nearest" });
  }
  useSelected(evt: KeyboardEvent): boolean {
    const v = this.values[this.selected];
    if (v === undefined) return false;
    this.owner.selectSuggestion(v, evt);
    return true;
  }
}

export abstract class PopoverSuggest<T> implements ISuggestOwner<T> {
  app: any;
  scope: Scope;
  suggestEl: HTMLElement;
  protected suggestions: SuggestList<T>;
  isOpen = false;

  constructor(app: any, scope?: Scope) {
    this.app = app ?? (window as any).app;
    this.scope = new Scope(scope ?? this.app?.scope);
    this.suggestEl = createDiv("suggestion-container");
    const list = this.suggestEl.createDiv("suggestion");
    this.suggestions = new SuggestList<T>(list, this);
    this.scope.register([], "ArrowDown", (e) => {
      e.preventDefault();
      this.suggestions.setSelected(this.suggestions.selected + 1, true);
      return false;
    });
    this.scope.register([], "ArrowUp", (e) => {
      e.preventDefault();
      this.suggestions.setSelected(this.suggestions.selected - 1, true);
      return false;
    });
    this.scope.register([], "Enter", (e) => {
      if (this.suggestions.useSelected(e)) {
        e.preventDefault();
        return false;
      }
    });
    this.scope.register([], "Escape", () => {
      this.close();
      return false;
    });
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.app?.keymap?.pushScope(this.scope);
  }
  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.app?.keymap?.popScope(this.scope);
    this.suggestEl.detach();
  }
  /** Position the popover under a rectangle in `doc`. */
  protected reposition(rect: { left: number; top: number; bottom: number; width?: number }, doc: Document): void {
    if (!this.suggestEl.isConnected || this.suggestEl.ownerDocument !== doc) doc.body.appendChild(this.suggestEl);
    const win = doc.defaultView ?? window;
    const el = this.suggestEl;
    el.style.left = Math.max(4, Math.min(rect.left, win.innerWidth - el.offsetWidth - 4)) + "px";
    const below = rect.bottom + 4;
    if (below + el.offsetHeight > win.innerHeight - 4 && rect.top - el.offsetHeight - 4 > 0) el.style.top = rect.top - el.offsetHeight - 4 + "px";
    else el.style.top = below + "px";
    if (rect.width) el.style.minWidth = rect.width + "px";
  }
  abstract renderSuggestion(value: T, el: HTMLElement): void;
  abstract selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void;
}

export abstract class AbstractInputSuggest<T> extends PopoverSuggest<T> {
  limit = 100;
  protected textInputEl: HTMLInputElement | HTMLDivElement;
  private selectCb: ((value: T, evt: MouseEvent | KeyboardEvent) => any) | null = null;
  private seq = 0;

  constructor(app: any, textInputEl: HTMLInputElement | HTMLDivElement) {
    super(app);
    this.textInputEl = textInputEl;
    textInputEl.addEventListener("input", () => this.onInputChange());
    textInputEl.addEventListener("focus", () => this.onInputChange());
    textInputEl.addEventListener("blur", () => setTimeout(() => this.close(), 150));
    // Route arrow/enter keys through our scope while the popover is open, even in popouts.
    textInputEl.addEventListener("keydown", (e: Event) => {
      const ev = e as KeyboardEvent;
      if (!this.isOpen) return;
      if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(ev.key)) {
        if (ev.key === "ArrowDown") this.suggestions.setSelected(this.suggestions.selected + 1, true);
        else if (ev.key === "ArrowUp") this.suggestions.setSelected(this.suggestions.selected - 1, true);
        else if (ev.key === "Enter") {
          if (!this.suggestions.useSelected(ev)) return;
        } else this.close();
        ev.preventDefault();
        ev.stopPropagation();
      }
    });
  }

  // Keys are handled on the input itself (works in popout windows), so no keymap scope is pushed.
  open(): void {
    this.isOpen = true;
  }
  close(): void {
    this.isOpen = false;
    this.suggestEl.detach();
  }

  getValue(): string {
    return this.textInputEl instanceof HTMLInputElement || (this.textInputEl as any).value !== undefined ? (this.textInputEl as HTMLInputElement).value : this.textInputEl.textContent ?? "";
  }
  setValue(value: string): void {
    if ((this.textInputEl as any).value !== undefined) (this.textInputEl as HTMLInputElement).value = value;
    else this.textInputEl.textContent = value;
  }
  onSelect(cb: (value: T, evt: MouseEvent | KeyboardEvent) => any): this {
    this.selectCb = cb;
    return this;
  }
  selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void {
    this.selectCb?.(value, evt);
    this.textInputEl.dispatchEvent(new Event("input"));
    this.close();
  }
  protected abstract getSuggestions(query: string): T[] | Promise<T[]>;

  private async onInputChange(): Promise<void> {
    const my = ++this.seq;
    const items = await this.getSuggestions(this.getValue());
    if (my !== this.seq) return;
    if (!items || !items.length || this.textInputEl.ownerDocument.activeElement !== this.textInputEl) {
      this.close();
      return;
    }
    this.suggestions.setSuggestions(items.slice(0, this.limit));
    this.open();
    const r = this.textInputEl.getBoundingClientRect();
    this.reposition({ left: r.left, top: r.top, bottom: r.bottom, width: r.width }, this.textInputEl.ownerDocument);
  }
}

export interface EditorPosition {
  line: number;
  ch: number;
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

/** Editor autocomplete popover driven by `onTrigger` (registered with plugin.registerEditorSuggest). */
export abstract class EditorSuggest<T> extends PopoverSuggest<T> {
  context: EditorSuggestContext | null = null;
  limit = 100;
  instructionsEl: HTMLElement;
  constructor(app: any) {
    super(app);
    this.instructionsEl = this.suggestEl.createDiv("prompt-instructions");
    this.instructionsEl.hide();
  }
  setInstructions(instructions: { command: string; purpose: string }[]): void {
    this.instructionsEl.empty();
    for (const i of instructions) {
      const d = this.instructionsEl.createDiv("prompt-instruction");
      d.createSpan({ cls: "prompt-instruction-command", text: i.command });
      d.createSpan({ text: i.purpose });
    }
    this.instructionsEl.toggle(instructions.length > 0);
  }
  abstract onTrigger(cursor: EditorPosition, editor: any, file: any): EditorSuggestTriggerInfo | null;
  abstract getSuggestions(context: EditorSuggestContext): T[] | Promise<T[]>;

  /** Called by the editor-suggest dispatcher after each editor change. Returns true if shown. */
  async trigger(editor: any, file: any, cmView?: any): Promise<boolean> {
    let info: EditorSuggestTriggerInfo | null = null;
    try {
      info = this.onTrigger(editor.getCursor(), editor, file);
    } catch (e) {
      console.error(e);
    }
    if (!info) {
      this.close();
      return false;
    }
    this.context = { ...info, editor, file };
    const items = await this.getSuggestions(this.context);
    if (!items?.length) {
      this.close();
      return false;
    }
    this.suggestions.setSuggestions(items.slice(0, this.limit));
    this.open();
    const view = cmView ?? editor.cm;
    const off = editor.posToOffset ? editor.posToOffset(info.start) : null;
    const coords = view && off !== null ? view.coordsAtPos(off) : null;
    const doc = view?.dom?.ownerDocument ?? document;
    if (coords) this.reposition({ left: coords.left, top: coords.top, bottom: coords.bottom }, doc);
    return true;
  }
  close(): void {
    super.close();
    this.context = null;
  }
}

/** Runs registered EditorSuggests (plugin.registerEditorSuggest) after each edit in an editor. */
export function installEditorSuggests(app: any): void {
  if (app.__editorSuggestsInstalled) return;
  app.__editorSuggestsInstalled = true;
  const ws = app.workspace;
  ws.editorSuggest = ws.editorSuggest ?? { suggests: [] };
  let current: EditorSuggest<any> | null = null;
  let seq = 0;
  ws.on("editor-change", async (editor: any, info: any) => {
    const my = ++seq;
    const file = info?.file ?? ws.getActiveFile?.();
    const list: EditorSuggest<any>[] = ws.editorSuggest.suggests ?? [];
    // Keep the open one if it still matches; otherwise try each in order.
    const order = current ? [current, ...list.filter((s) => s !== current)] : list;
    for (const s of order) {
      if (my !== seq) return;
      let shown = false;
      try {
        shown = await s.trigger(editor, file, editor?.cm);
      } catch (e) {
        console.error(e);
      }
      if (shown) {
        if (current && current !== s) current.close();
        current = s;
        return;
      }
    }
    current?.close();
    current = null;
  });
  const closeAll = () => {
    current?.close();
    current = null;
  };
  ws.on("active-leaf-change", closeAll);
  window.addEventListener("mousedown", (e) => {
    if (current && !current.suggestEl.contains(e.target as Node)) closeAll();
  });
}
