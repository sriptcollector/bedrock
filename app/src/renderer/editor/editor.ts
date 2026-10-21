// Editor (obsidian API) on top of a CodeMirror 6 EditorView. Positions are {line, ch}, 0-based.
import { EditorSelection, type ChangeSpec, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo, redo, selectAll, indentMore, indentLess, insertNewlineAndIndent, moveLineUp, moveLineDown, deleteLine, cursorLineUp, cursorLineDown, cursorCharLeft, cursorCharRight, cursorDocStart, cursorDocEnd, cursorGroupLeft, cursorGroupRight } from "@codemirror/commands";
import { foldCode, unfoldCode, foldAll, unfoldAll, toggleFold } from "@codemirror/language";

export interface EditorPosition {
  line: number;
  ch: number;
}
export interface EditorRange {
  from: EditorPosition;
  to: EditorPosition;
}
export interface EditorSelectionRange {
  anchor: EditorPosition;
  head: EditorPosition;
}
export interface EditorChange {
  text: string;
  from: EditorPosition;
  to?: EditorPosition;
}
export interface EditorTransaction {
  replaceSelection?: string;
  changes?: EditorChange[];
  selections?: { from: EditorPosition; to?: EditorPosition }[];
  selection?: { from: EditorPosition; to?: EditorPosition };
}

export class Editor {
  constructor(public cm: EditorView, private owner?: any) {}

  private get doc(): Text {
    return this.cm.state.doc;
  }

  posToOffset(pos: EditorPosition): number {
    const line = Math.max(0, Math.min(pos.line, this.doc.lines - 1));
    const l = this.doc.line(line + 1);
    return l.from + Math.max(0, Math.min(pos.ch, l.length));
  }

  offsetToPos(offset: number): EditorPosition {
    offset = Math.max(0, Math.min(offset, this.doc.length));
    const l = this.doc.lineAt(offset);
    return { line: l.number - 1, ch: offset - l.from };
  }

  getDoc(): this {
    return this;
  }
  refresh(): void {
    this.cm.requestMeasure();
  }
  getValue(): string {
    return this.doc.toString();
  }
  setValue(content: string): void {
    this.cm.dispatch({ changes: { from: 0, to: this.doc.length, insert: content } });
  }
  getLine(line: number): string {
    if (line < 0 || line >= this.doc.lines) return "";
    return this.doc.line(line + 1).text;
  }
  setLine(n: number, text: string): void {
    const l = this.doc.line(n + 1);
    this.cm.dispatch({ changes: { from: l.from, to: l.to, insert: text } });
  }
  lineCount(): number {
    return this.doc.lines;
  }
  lastLine(): number {
    return this.doc.lines - 1;
  }
  getSelection(): string {
    const r = this.cm.state.selection.main;
    return this.cm.state.sliceDoc(r.from, r.to);
  }
  somethingSelected(): boolean {
    return this.cm.state.selection.ranges.some((r) => !r.empty);
  }
  getRange(from: EditorPosition, to: EditorPosition): string {
    return this.cm.state.sliceDoc(this.posToOffset(from), this.posToOffset(to));
  }
  replaceSelection(replacement: string, origin?: string): void {
    this.cm.dispatch(this.cm.state.replaceSelection(replacement), { userEvent: origin ?? "input" });
  }
  replaceRange(replacement: string, from: EditorPosition, to?: EditorPosition, origin?: string): void {
    const a = this.posToOffset(from);
    const b = to ? this.posToOffset(to) : a;
    this.cm.dispatch({ changes: { from: Math.min(a, b), to: Math.max(a, b), insert: replacement }, userEvent: origin ?? "input" });
  }
  getCursor(which: "from" | "to" | "head" | "anchor" = "head"): EditorPosition {
    const r = this.cm.state.selection.main;
    const off = which === "from" ? r.from : which === "to" ? r.to : which === "anchor" ? r.anchor : r.head;
    return this.offsetToPos(off);
  }
  listSelections(): EditorSelectionRange[] {
    return this.cm.state.selection.ranges.map((r) => ({ anchor: this.offsetToPos(r.anchor), head: this.offsetToPos(r.head) }));
  }
  setCursor(pos: EditorPosition | number, ch?: number): void {
    const p = typeof pos === "number" ? { line: pos, ch: ch ?? 0 } : pos;
    const o = this.posToOffset(p);
    this.cm.dispatch({ selection: { anchor: o }, scrollIntoView: true });
  }
  setSelection(anchor: EditorPosition, head?: EditorPosition): void {
    this.cm.dispatch({ selection: { anchor: this.posToOffset(anchor), head: this.posToOffset(head ?? anchor) }, scrollIntoView: true });
  }
  setSelections(ranges: EditorSelectionRange[], main?: number): void {
    if (!ranges.length) return;
    this.cm.dispatch({
      selection: EditorSelection.create(
        ranges.map((r) => EditorSelection.range(this.posToOffset(r.anchor), this.posToOffset(r.head ?? r.anchor))),
        main ?? 0,
      ),
    });
  }
  focus(): void {
    this.cm.focus();
  }
  blur(): void {
    this.cm.contentDOM.blur();
  }
  hasFocus(): boolean {
    return this.cm.hasFocus;
  }
  getScrollInfo(): { top: number; left: number } {
    return { top: this.cm.scrollDOM.scrollTop, left: this.cm.scrollDOM.scrollLeft };
  }
  scrollTo(x?: number | null, y?: number | null): void {
    if (x != null) this.cm.scrollDOM.scrollLeft = x;
    if (y != null) this.cm.scrollDOM.scrollTop = y;
  }
  scrollIntoView(range: EditorRange, center = false): void {
    const from = this.posToOffset(range.from);
    this.cm.dispatch({ effects: EditorView.scrollIntoView(from, { y: center ? "center" : "nearest" }) });
  }
  undo(): void {
    undo(this.cm);
  }
  redo(): void {
    redo(this.cm);
  }
  exec(command: string): void {
    const map: Record<string, (v: EditorView) => boolean> = {
      goUp: cursorLineUp,
      goDown: cursorLineDown,
      goLeft: cursorCharLeft,
      goRight: cursorCharRight,
      goStart: cursorDocStart,
      goEnd: cursorDocEnd,
      goWordLeft: cursorGroupLeft,
      goWordRight: cursorGroupRight,
      indentMore,
      indentLess,
      newlineAndIndent: insertNewlineAndIndent,
      swapLineUp: moveLineUp,
      swapLineDown: moveLineDown,
      deleteLine,
      toggleFold,
      foldAll,
      unfoldAll,
      selectAll,
      fold: foldCode,
      unfold: unfoldCode,
    };
    map[command]?.(this.cm);
  }
  transaction(tx: EditorTransaction, origin?: string): void {
    const changes: ChangeSpec[] = [];
    if (tx.changes) for (const c of tx.changes) changes.push({ from: this.posToOffset(c.from), to: c.to ? this.posToOffset(c.to) : undefined, insert: c.text });
    const spec: any = { userEvent: origin ?? "input" };
    if (tx.replaceSelection !== undefined) {
      const r = this.cm.state.selection.main;
      changes.push({ from: r.from, to: r.to, insert: tx.replaceSelection });
    }
    if (changes.length) spec.changes = changes;
    const sels = tx.selections ?? (tx.selection ? [tx.selection] : null);
    if (sels) spec.selection = EditorSelection.create(sels.map((s) => EditorSelection.range(this.posToOffset(s.from), this.posToOffset(s.to ?? s.from))));
    this.cm.dispatch(spec);
  }
  wordAt(pos: EditorPosition): EditorRange | null {
    const r = this.cm.state.wordAt(this.posToOffset(pos));
    return r ? { from: this.offsetToPos(r.from), to: this.offsetToPos(r.to) } : null;
  }
  processLines<T>(read: (line: number, text: string) => T | null, write: (line: number, text: string, value: T | null) => EditorChange | void, ignoreEmpty = false): void {
    const changes: ChangeSpec[] = [];
    for (const r of this.cm.state.selection.ranges) {
      const a = this.doc.lineAt(r.from).number - 1;
      const b = this.doc.lineAt(r.to).number - 1;
      for (let n = a; n <= b; n++) {
        const text = this.getLine(n);
        if (ignoreEmpty && !text.trim()) continue;
        const ch = write(n, text, read(n, text));
        if (ch) changes.push({ from: this.posToOffset(ch.from), to: ch.to ? this.posToOffset(ch.to) : undefined, insert: ch.text });
      }
    }
    if (changes.length) this.cm.dispatch({ changes });
  }
  /** CodeMirror 6 view, as exposed by Obsidian. */
  get editorComponent(): any {
    return this.owner;
  }
}
