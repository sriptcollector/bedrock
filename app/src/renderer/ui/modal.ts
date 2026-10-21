// Modal, SuggestModal, FuzzySuggestModal (obsidian API) and simple confirm/prompt dialogs.
import { Scope } from "../commands/keymap";
import { prepareFuzzySearch, renderResults, type SearchResult } from "./search";
import { setIcon } from "../dom/icons";

let appRef: any = null;
export function setModalApp(app: any): void {
  appRef = app;
}

export class Modal {
  app: any;
  scope: Scope;
  containerEl: HTMLElement;
  modalEl: HTMLElement;
  titleEl: HTMLElement;
  contentEl: HTMLElement;
  headerEl: HTMLElement;
  shouldRestoreSelection = true;
  private bgEl: HTMLElement;
  private isOpen = false;
  private onCloseCb: (() => void) | null = null;

  constructor(app: any) {
    this.app = app ?? appRef;
    this.scope = new Scope(this.app?.scope);
    this.containerEl = createDiv("modal-container mod-dim");
    this.bgEl = this.containerEl.createDiv("modal-bg");
    this.modalEl = this.containerEl.createDiv("modal");
    const close = this.modalEl.createDiv({ cls: "modal-close-button modal-header-button mod-raised clickable-icon", attr: { "aria-label": "Close" } });
    setIcon(close, "x");
    close.addEventListener("click", () => this.close());
    this.headerEl = this.modalEl.createDiv("modal-header");
    this.titleEl = this.headerEl.createDiv("modal-title");
    this.contentEl = this.modalEl.createDiv("modal-content");
    this.bgEl.addEventListener("click", () => this.close());
    this.scope.register([], "Escape", () => {
      this.close();
      return false;
    });
  }

  setTitle(t: string): this {
    this.titleEl.setText(t);
    return this;
  }

  setContent(c: string | DocumentFragment): this {
    this.contentEl.empty();
    if (typeof c === "string") this.contentEl.setText(c);
    else this.contentEl.appendChild(c);
    return this;
  }

  setCloseCallback(cb: () => void): this {
    this.onCloseCb = cb;
    return this;
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    // Open in the focused window (the settings window is its own popout window).
    const doc: Document = (window as any).activeDocument ?? document;
    doc.body.appendChild(this.containerEl);
    this.app?.keymap?.pushScope(this.scope);
    this.onOpen();
    const first = this.modalEl.querySelector<HTMLElement>("input, textarea, button.mod-cta");
    if (first && !this.modalEl.contains(doc.activeElement)) first.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.app?.keymap?.popScope(this.scope);
    this.containerEl.detach();
    this.onClose();
    this.onCloseCb?.();
  }

  onOpen(): void | Promise<void> {}
  onClose(): void {}
}

export interface Instruction {
  command: string;
  purpose: string;
}

export abstract class SuggestModal<T> extends Modal {
  limit = 100;
  emptyStateText = "No results found.";
  inputEl: HTMLInputElement;
  resultContainerEl: HTMLElement;
  private instructionsEl: HTMLElement;
  private items: T[] = [];
  private selected = 0;
  private itemEls: HTMLElement[] = [];

  constructor(app: any) {
    super(app);
    this.containerEl.removeClass("mod-dim");
    this.modalEl.addClass("prompt");
    this.modalEl.empty();
    const inputWrap = this.modalEl.createDiv("prompt-input-container");
    this.inputEl = inputWrap.createEl("input", { cls: "prompt-input", attr: { type: "text", enterkeyhint: "done", spellcheck: "false" } });
    this.resultContainerEl = this.modalEl.createDiv("prompt-results");
    this.instructionsEl = this.modalEl.createDiv("prompt-instructions");
    this.inputEl.addEventListener("input", () => this.update());
    this.scope.register([], "ArrowDown", (e) => {
      e.preventDefault();
      this.move(1);
      return false;
    });
    this.scope.register([], "ArrowUp", (e) => {
      e.preventDefault();
      this.move(-1);
      return false;
    });
    this.scope.register(["Mod"], "J", (e) => {
      e.preventDefault();
      this.move(1);
      return false;
    });
    this.scope.register(["Mod"], "K", (e) => {
      e.preventDefault();
      this.move(-1);
      return false;
    });
    this.scope.register(null, "Enter", (e) => {
      e.preventDefault();
      this.choose(e);
      return false;
    });
  }

  setPlaceholder(p: string): void {
    this.inputEl.placeholder = p;
  }

  setInstructions(ins: Instruction[]): void {
    this.instructionsEl.empty();
    for (const i of ins) {
      const el = this.instructionsEl.createDiv("prompt-instruction");
      el.createSpan({ cls: "prompt-instruction-command", text: i.command });
      el.createSpan({ text: i.purpose });
    }
  }

  onOpen(): void {
    this.inputEl.focus();
    this.update();
  }

  private async update(): Promise<void> {
    const q = this.inputEl.value;
    const items = await this.getSuggestions(q);
    this.items = items.slice(0, this.limit);
    this.selected = 0;
    this.resultContainerEl.empty();
    this.itemEls = [];
    if (!this.items.length) {
      if (this.emptyStateText) this.resultContainerEl.createDiv({ cls: "suggestion-empty", text: this.emptyStateText });
      this.onNoSuggestion();
      return;
    }
    this.items.forEach((it, i) => {
      const el = this.resultContainerEl.createDiv("suggestion-item");
      el.addEventListener("mousemove", () => this.select(i));
      el.addEventListener("click", (e) => {
        this.select(i);
        this.choose(e);
      });
      this.renderSuggestion(it, el);
      this.itemEls.push(el);
    });
    this.select(0);
  }

  private select(i: number): void {
    this.itemEls[this.selected]?.removeClass("is-selected");
    this.selected = i;
    const el = this.itemEls[i];
    el?.addClass("is-selected");
    el?.scrollIntoView({ block: "nearest" });
  }

  private move(d: number): void {
    if (!this.items.length) return;
    this.select((this.selected + d + this.items.length) % this.items.length);
  }

  private choose(evt: MouseEvent | KeyboardEvent): void {
    const it = this.items[this.selected];
    if (it === undefined) return;
    this.close();
    this.selectSuggestion(it, evt);
  }

  selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void {
    this.onChooseSuggestion(value, evt);
  }

  onNoSuggestion(): void {}
  abstract getSuggestions(query: string): T[] | Promise<T[]>;
  abstract renderSuggestion(value: T, el: HTMLElement): void;
  abstract onChooseSuggestion(item: T, evt: MouseEvent | KeyboardEvent): void;
}

export interface FuzzyMatch<T> {
  item: T;
  match: SearchResult;
}

export abstract class FuzzySuggestModal<T> extends SuggestModal<FuzzyMatch<T>> {
  getSuggestions(query: string): FuzzyMatch<T>[] {
    const items = this.getItems();
    if (!query.trim()) return items.map((item) => ({ item, match: { score: 0, matches: [] } }));
    const fn = prepareFuzzySearch(query);
    const out: FuzzyMatch<T>[] = [];
    for (const item of items) {
      const m = fn(this.getItemText(item));
      if (m) out.push({ item, match: m });
    }
    return out.sort((a, b) => b.match.score - a.match.score);
  }
  renderSuggestion(m: FuzzyMatch<T>, el: HTMLElement): void {
    renderResults(el, this.getItemText(m.item), m.match);
  }
  onChooseSuggestion(m: FuzzyMatch<T>, evt: MouseEvent | KeyboardEvent): void {
    this.onChooseItem(m.item, evt);
  }
  abstract getItems(): T[];
  abstract getItemText(item: T): string;
  abstract onChooseItem(item: T, evt: MouseEvent | KeyboardEvent): void;
}

/** Simple dialogs used by the app itself. */
export function confirmDialog(app: any, o: { title: string; body: string; cta: string; danger?: boolean; dontAskAgain?: () => void }): Promise<boolean> {
  return new Promise((resolve) => {
    const m = new Modal(app);
    let result = false;
    m.setTitle(o.title);
    m.containerEl.addClass("mod-confirmation");
    // One paragraph per line of the body.
    for (const line of o.body.split("\n")) m.contentEl.createEl("p", { cls: "u-break-word", text: line });
    let dont = false;
    const btns = m.modalEl.createDiv("modal-button-container");
    if (o.dontAskAgain) {
      const lab = btns.createEl("label", { cls: "mod-checkbox" });
      const cb = lab.createEl("input", { type: "checkbox" });
      lab.appendText("Don't ask again");
      cb.addEventListener("change", () => (dont = cb.checked));
    }
    const cancel = btns.createEl("button", { cls: "mod-cancel", text: "Cancel" });
    const ok = btns.createEl("button", { cls: o.danger ? "mod-cta mod-destructive mod-warning" : "mod-cta", text: o.cta });
    ok.addEventListener("click", () => {
      result = true;
      if (dont) o.dontAskAgain?.();
      m.close();
    });
    cancel.addEventListener("click", () => m.close());
    m.setCloseCallback(() => resolve(result));
    m.open();
    ok.focus();
  });
}

export function promptDialog(app: any, o: { title: string; value?: string; placeholder?: string; cta?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    const m = new Modal(app);
    let result: string | null = null;
    m.setTitle(o.title);
    const input = m.contentEl.createEl("input", { type: "text", value: o.value ?? "", placeholder: o.placeholder ?? "" });
    input.style.width = "100%";
    const btns = m.modalEl.createDiv("modal-button-container");
    const ok = btns.createEl("button", { cls: "mod-cta", text: o.cta ?? "OK" });
    const cancel = btns.createEl("button", { text: "Cancel" });
    const submit = () => {
      result = input.value;
      m.close();
    };
    ok.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    cancel.addEventListener("click", () => m.close());
    m.setCloseCallback(() => resolve(result));
    m.open();
    input.focus();
    input.select();
  });
}
