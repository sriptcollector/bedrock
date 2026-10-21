// Test helpers: an EditorState with Bedrock's Markdown language and list behaviour, plus a fake
// view so commands that call view.dispatch can run without a DOM. "‸" marks the cursor and
// «…» a selection in documents.
import { EditorSelection, EditorState, Transaction, type Extension, type TransactionSpec } from "@codemirror/state";
import { indentUnit, ensureSyntaxTree } from "@codemirror/language";
import { markdownSupport } from "../../src/renderer/editor/syntax";
import { renumberOnChange, smartListsFacet } from "../../src/renderer/editor/lists";

export function parseMarked(src: string): { text: string; ranges: { anchor: number; head: number }[] } {
  let text = "";
  const ranges: { anchor: number; head: number }[] = [];
  let anchor: number | null = null;
  for (const ch of src) {
    if (ch === "‸") ranges.push({ anchor: text.length, head: text.length });
    else if (ch === "«") anchor = text.length;
    else if (ch === "»") {
      ranges.push({ anchor: anchor!, head: text.length });
      anchor = null;
    } else text += ch;
  }
  if (!ranges.length) ranges.push({ anchor: text.length, head: text.length });
  return { text, ranges };
}

export function marked(state: EditorState): string {
  let out = state.doc.toString();
  const marks: [number, string][] = [];
  for (const r of state.selection.ranges) {
    if (r.empty) marks.push([r.head, "‸"]);
    else marks.push([r.from, "«"], [r.to, "»"]);
  }
  marks.sort((a, b) => b[0] - a[0] || (a[1] === "«" ? -1 : 1));
  for (const [p, m] of marks) out = out.slice(0, p) + m + out.slice(p);
  return out;
}

export interface FakeView {
  state: EditorState;
  dispatch(tr: Transaction | TransactionSpec): void;
}

export function makeView(src: string, opts: { smart?: boolean; useTab?: boolean; extra?: Extension[] } = {}): FakeView {
  const { text, ranges } = parseMarked(src);
  let state = EditorState.create({
    doc: text,
    selection: EditorSelection.create(ranges.map((r) => EditorSelection.range(r.anchor, r.head))),
    extensions: [markdownSupport(), EditorState.allowMultipleSelections.of(true), renumberOnChange, smartListsFacet.of(opts.smart ?? true), indentUnit.of(opts.useTab === false ? "    " : "\t"), EditorState.tabSize.of(4), ...(opts.extra ?? [])],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const view: FakeView = {
    get state() {
      return state;
    },
    set state(s: EditorState) {
      state = s;
    },
    dispatch(tr: Transaction | TransactionSpec) {
      state = (tr instanceof Transaction ? tr : state.update(tr)).state;
      ensureSyntaxTree(state, state.doc.length, 5000);
    },
  };
  return view;
}

/** Apply a spec-returning command (formatting.ts / lists.ts style) and return the marked doc. */
export function run(src: string, cmd: (s: EditorState) => TransactionSpec | null, opts?: Parameters<typeof makeView>[1]): string {
  const v = makeView(src, opts);
  const spec = cmd(v.state);
  if (spec) v.dispatch(spec);
  return marked(v.state);
}

/** Apply a view command (takes {state, dispatch}) and return the marked doc. */
export function runView(src: string, cmd: (v: FakeView) => boolean, opts?: Parameters<typeof makeView>[1]): string {
  const v = makeView(src, opts);
  cmd(v);
  return marked(v.state);
}

/** Type text into the fake view (plain insertion, user event input.type). */
export function type(v: FakeView, text: string): void {
  v.dispatch(v.state.update(v.state.replaceSelection(text), { userEvent: "input.type" }));
}
