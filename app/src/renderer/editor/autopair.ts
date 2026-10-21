// Auto-pair: brackets/quotes (setting "Auto-pair brackets") through CodeMirror's closeBrackets
// with backticks added, and Markdown syntax (setting "Auto-pair Markdown syntax"): * and _ pair
// between spaces, selections get wrapped in * _ = ~ $ ` %, and ``` opens a code fence.
import { EditorSelection, EditorState, Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";

const PAIR_CHARS = new Set(["*", "_"]);
const WRAP_CHARS = new Set(["*", "_", "=", "~", "$", "`", "%"]);

const addCloser = StateEffect.define<number>();

/** Positions of closing * / _ we inserted ourselves (so typing over them skips instead of inserting). */
const closers = StateField.define<number[]>({
  create: () => [],
  update(v, tr) {
    let out = v;
    if (tr.docChanged) out = out.map((p) => tr.changes.mapPos(p, 1)).filter((p) => p < tr.newDoc.length);
    for (const e of tr.effects) if (e.is(addCloser)) out = [...out, e.value];
    if (tr.selection) {
      const line = tr.newDoc.lineAt(tr.newSelection.main.head);
      out = out.filter((p) => p >= line.from && p <= line.to);
    }
    return out;
  },
});

const isSpace = (c: string) => c === "" || /\s/.test(c);

function handleInput(view: EditorView, from: number, to: number, text: string, markdown: boolean, brackets: boolean): boolean {
  if (view.composing || text.length !== 1) return false;
  const { state } = view;
  const sel = state.selection;
  // Wrap selections in Markdown syntax.
  if (markdown && WRAP_CHARS.has(text) && sel.ranges.some((r) => !r.empty)) {
    view.dispatch(
      state.changeByRange((r) => {
        if (r.empty) return { changes: { from: r.from, insert: text }, range: EditorSelection.cursor(r.from + 1) };
        return {
          changes: [
            { from: r.from, insert: text },
            { from: r.to, insert: text },
          ],
          range: EditorSelection.range(r.anchor + (r.anchor < r.head ? 1 : 1), r.head + 1),
        };
      }),
      { userEvent: "input.type" },
    );
    return true;
  }
  if (!sel.ranges.every((r) => r.empty) || sel.ranges.length > 1) return false;
  const pos = sel.main.head;
  const line = state.doc.lineAt(pos);
  const before = state.sliceDoc(line.from, pos);
  const next = state.sliceDoc(pos, pos + 1);
  // ``` opens a fenced block.
  if (brackets && text === "`" && before.endsWith("``")) {
    const rest = state.sliceDoc(pos, line.to);
    if (rest === "" || rest === "`") {
      view.dispatch({ changes: { from: pos, to: line.to, insert: "`\n```" }, selection: { anchor: pos + 1 }, userEvent: "input.type" });
      return true;
    }
  }
  if (markdown && PAIR_CHARS.has(text)) {
    const tracked = state.field(closers, false) ?? [];
    if (next === text && tracked.includes(pos)) {
      view.dispatch({ selection: { anchor: pos + 1 }, userEvent: "input.type" });
      return true;
    }
    const prev = before.slice(-1);
    if (isSpace(next) && isSpace(prev)) {
      view.dispatch({ changes: { from: pos, insert: text + text }, selection: { anchor: pos + 1 }, effects: addCloser.of(pos + 1), userEvent: "input.type" });
      return true;
    }
  }
  return false;
}

function deletePair(view: EditorView): boolean {
  const { state } = view;
  if (state.selection.ranges.length > 1 || !state.selection.main.empty) return false;
  const pos = state.selection.main.head;
  const prev = state.sliceDoc(pos - 1, pos);
  const next = state.sliceDoc(pos, pos + 1);
  if (PAIR_CHARS.has(prev) && prev === next && (state.field(closers, false) ?? []).includes(pos)) {
    view.dispatch({ changes: { from: pos - 1, to: pos + 1 }, userEvent: "delete.backward" });
    return true;
  }
  return false;
}

export interface AutopairConfig {
  brackets: boolean;
  markdown: boolean;
}

export function autopairExtensions(c: AutopairConfig): Extension[] {
  const out: Extension[] = [closers];
  if (c.brackets) {
    out.push(closeBrackets(), EditorState.languageData.of(() => [{ closeBrackets: { brackets: ["(", "[", "{", "'", '"', "`"] } }]), keymap.of(closeBracketsKeymap));
  }
  out.push(
    Prec.high(EditorView.inputHandler.of((view, from, to, text) => handleInput(view, from, to, text, c.markdown, c.brackets))),
    Prec.high(keymap.of([{ key: "Backspace", run: deletePair }])),
  );
  return out;
}
