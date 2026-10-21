// Folding: headings (until the next heading of the same or higher level) and indented list items,
// the inline fold indicator at the start of foldable lines (.cm-fold-indicator, shown on hover),
// the "…" placeholder, and fold state saved per file ({folds:[{from,to}], lines} by line number).
import { StateEffect, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { foldService, foldedRanges, foldEffect, unfoldEffect, foldable } from "@codemirror/language";
import { setIcon } from "../dom/icons";
import { editorInfoField } from "./fields";

function headingLevel(text: string): number {
  const m = /^(#{1,6})\s/.exec(text);
  return m ? m[1].length : 0;
}

function indentOf(text: string, tabSize: number): number {
  let w = 0;
  for (const ch of /^[ \t]*/.exec(text)![0]) w = ch === "\t" ? w + tabSize - (w % tabSize) : w + 1;
  return w;
}

/** Fold range for a heading or list item line, or null. Exposed for tests. */
export function foldRangeAt(state: EditorState, lineFrom: number, headings = true, lists = true): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineFrom);
  const level = headingLevel(line.text);
  if (level && headings) {
    let end = line.to;
    let inFence = false;
    for (let n = line.number + 1; n <= state.doc.lines; n++) {
      const l = state.doc.line(n);
      if (/^\s{0,3}(```|~~~)/.test(l.text)) inFence = !inFence;
      const hl = inFence ? 0 : headingLevel(l.text);
      if (hl && hl <= level) break;
      if (l.text.trim()) end = l.to;
    }
    return end > line.to ? { from: line.to, to: end } : null;
  }
  if (lists && /^\s*([-*+]|\d+[.)])\s/.test(line.text)) {
    const tab = state.tabSize;
    const ind = indentOf(line.text, tab);
    let end = line.to;
    for (let n = line.number + 1; n <= state.doc.lines; n++) {
      const l = state.doc.line(n);
      if (!l.text.trim()) continue;
      if (indentOf(l.text, tab) <= ind) break;
      end = l.to;
    }
    return end > line.to ? { from: line.to, to: end } : null;
  }
  return null;
}

export function foldServiceFor(headings: boolean, lists: boolean): Extension {
  return foldService.of((state, lineStart) => foldRangeAt(state, lineStart, headings, lists));
}

export function foldPlaceholder(view: EditorView, onclick: (e: Event) => void): HTMLElement {
  const el = createSpan({ cls: "cm-foldPlaceholder", text: "…", attr: { "aria-label": "Unfold" } });
  el.addEventListener("click", onclick);
  void view;
  return el;
}

class FoldIndicator extends WidgetType {
  constructor(readonly folded: boolean, readonly lineFrom: number) {
    super();
  }
  eq(o: FoldIndicator) {
    return o.folded === this.folded && o.lineFrom === this.lineFrom;
  }
  toDOM(view: EditorView) {
    const el = createDiv({ cls: "cm-fold-indicator" + (this.folded ? " is-collapsed" : ""), attr: { contenteditable: "false" } });
    const icon = el.createDiv("collapse-indicator collapse-icon" + (this.folded ? " is-collapsed" : ""));
    setIcon(icon, "right-triangle");
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const line = view.state.doc.lineAt(this.lineFrom);
      const range = foldable(view.state, line.from, line.to);
      if (!range) return;
      let isFolded = false;
      foldedRanges(view.state).between(range.from, range.to, (a, b) => {
        if (a === range.from && b === range.to) isFolded = true;
      });
      view.dispatch({ effects: (isFolded ? unfoldEffect : foldEffect).of(range) });
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

function buildIndicators(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const { state } = view;
  const folded = foldedRanges(state);
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      if (headingLevel(line.text) || /^\s*([-*+]|\d+[.)])\s/.test(line.text)) {
        const r = foldable(state, line.from, line.to);
        if (r) {
          let isFolded = false;
          folded.between(r.from, r.to, (a, b) => {
            if (a === r.from && b === r.to) isFolded = true;
          });
          decos.push(Decoration.widget({ widget: new FoldIndicator(isFolded, line.from), side: -1 }).range(line.from));
        }
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(decos, true);
}

export const foldIndicators = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildIndicators(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.transactions.some((t) => t.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect)))) this.decorations = buildIndicators(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

// ---------- fold state persistence ----------
export interface FoldInfo {
  folds: { from: number; to: number }[];
  lines: number;
}

export function getFoldInfo(state: EditorState): FoldInfo {
  const folds: { from: number; to: number }[] = [];
  foldedRanges(state).between(0, state.doc.length, (a, b) => {
    folds.push({ from: state.doc.lineAt(a).number - 1, to: state.doc.lineAt(b).number - 1 });
  });
  return { folds, lines: state.doc.lines };
}

/** Effects that re-apply saved folds (by line number). Skipped when the line count changed. */
export function applyFoldInfoEffects(state: EditorState, info: FoldInfo | null): StateEffect<unknown>[] {
  if (!info || info.lines !== state.doc.lines) return [];
  const out: StateEffect<unknown>[] = [];
  for (const f of info.folds) {
    if (f.from >= state.doc.lines) continue;
    const line = state.doc.line(f.from + 1);
    const r = foldable(state, line.from, line.to);
    if (r) out.push(foldEffect.of(r));
  }
  return out;
}

export function foldStorageKey(path: string): string {
  return "fold-" + path;
}

/** Saves fold state (debounced) whenever folds change. */
export const foldStatePersistence = ViewPlugin.fromClass(
  class {
    timer: any = null;
    constructor(readonly view: EditorView) {}
    update(u: ViewUpdate) {
      if (!u.transactions.some((t) => t.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect)))) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        const owner = this.view.state.field(editorInfoField, false);
        const path = owner?.file?.path;
        if (!path || !owner.app?.saveLocalStorage) return;
        const info = getFoldInfo(this.view.state);
        owner.app.saveLocalStorage(foldStorageKey(path), info.folds.length ? JSON.stringify(info) : null);
      }, 300);
    }
    destroy() {
      clearTimeout(this.timer);
    }
  },
);

/** Class "cm-active" on lines holding a cursor (the original's active-line class). */
export const activeLineClass = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const seen = new Set<number>();
      const decos: Range<Decoration>[] = [];
      for (const r of view.state.selection.ranges) {
        const l = view.state.doc.lineAt(r.head);
        if (seen.has(l.from)) continue;
        seen.add(l.from);
        decos.push(Decoration.line({ class: "cm-active" }).range(l.from));
      }
      return Decoration.set(decos, true);
    }
  },
  { decorations: (v) => v.decorations },
);
