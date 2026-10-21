// Inline formatting toggles (bold, italic, strikethrough, highlight + colours, code, math,
// comment), clear formatting and the "insert ..." editor commands, as pure EditorState ->
// TransactionSpec functions. Behaviour measured against the original with the parity harness.
import { EditorSelection, type EditorState, type SelectionRange, type TransactionSpec, type ChangeSpec } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

export type InlineKind = "bold" | "italic" | "strikethrough" | "highlight" | "code" | "math" | "comment";

const MARK: Record<InlineKind, string> = { bold: "**", italic: "*", strikethrough: "~~", highlight: "==", code: "`", math: "$", comment: "%%" };
const NODE: Record<InlineKind, string[]> = {
  bold: ["StrongEmphasis"],
  italic: ["Emphasis"],
  strikethrough: ["Strikethrough"],
  highlight: ["Highlight"],
  code: ["InlineCode"],
  math: ["InlineMath"],
  comment: ["Comment"],
};
/** Kinds that wrap each line separately when the selection spans lines. */
const PER_LINE = new Set<InlineKind>(["bold", "italic", "strikethrough", "highlight", "code"]);

export const HIGHLIGHT_COLORS: Record<string, string> = { red: "🔴", orange: "🟠", yellow: "🟡", green: "🟢", blue: "🔵", purple: "🟣" };
const COLOR_EMOJI = new RegExp("^(" + Object.values(HIGHLIGHT_COLORS).join("|") + ")", "u");

/** Find the innermost syntax node of one of `names` around pos (inclusive edges). */
function enclosing(state: EditorState, pos: number, names: string[]): { from: number; to: number; node: any } | null {
  for (const side of [-1, 1] as const) {
    let n: any = syntaxTree(state).resolveInner(pos, side);
    for (; n; n = n.parent) if (names.includes(n.name) && n.from <= pos && n.to >= pos) return { from: n.from, to: n.to, node: n };
  }
  return null;
}

/** Opening/closing marker lengths of an inline node, read from the text. */
function markerLengths(state: EditorState, kind: InlineKind, from: number, to: number): [number, number] {
  const text = state.sliceDoc(from, to);
  if (kind === "bold" || kind === "italic") {
    const ch = text[0];
    let a = 0;
    while (text[a] === ch && a < 3) a++;
    let b = 0;
    while (text[text.length - 1 - b] === ch && b < 3) b++;
    const n = kind === "bold" ? 2 : 1;
    return [Math.min(a, n), Math.min(b, n)];
  }
  if (kind === "code") {
    const a = /^`+/.exec(text)![0].length;
    return [a, a];
  }
  if (kind === "highlight") {
    const m = COLOR_EMOJI.exec(text.slice(2));
    return [2 + (m ? m[0].length : 0), 2];
  }
  const m = MARK[kind].length;
  return [m, m];
}

function unwrapRange(state: EditorState, kind: InlineKind, r: SelectionRange, node: { from: number; to: number }) {
  const [a, b] = markerLengths(state, kind, node.from, node.to);
  const changes: ChangeSpec[] = [
    { from: node.from, to: node.from + a },
    { from: node.to - b, to: node.to },
  ];
  const map = (p: number) => Math.max(node.from, Math.min(p - a, node.to - a - b));
  return { changes, range: EditorSelection.range(map(r.anchor), map(r.head)) };
}

/** Toggle an inline format on every selection range. */
export function toggleInline(state: EditorState, kind: InlineKind): TransactionSpec {
  const m = MARK[kind];
  return state.changeByRange((r) => {
    if (!r.empty) {
      const pre = state.sliceDoc(r.from - m.length, r.from);
      const post = state.sliceDoc(r.to, r.to + m.length);
      const text = state.sliceDoc(r.from, r.to);
      if (pre === m && post === m && !(kind === "italic" && state.sliceDoc(r.from - 2, r.from) === "**" && state.sliceDoc(r.to, r.to + 2) === "**" && state.sliceDoc(r.from - 3, r.from) !== "***")) {
        return {
          changes: [
            { from: r.from - m.length, to: r.from },
            { from: r.to, to: r.to + m.length },
          ],
          range: EditorSelection.range(r.anchor - m.length, r.head - m.length),
        };
      }
      if (text.length >= 2 * m.length && text.startsWith(m) && text.endsWith(m)) {
        const inner = text.slice(m.length, text.length - m.length);
        return { changes: { from: r.from, to: r.to, insert: inner }, range: EditorSelection.range(r.from, r.from + inner.length) };
      }
      if (PER_LINE.has(kind) && text.includes("\n")) {
        const changes: ChangeSpec[] = [];
        let pos = r.from;
        let added = 0;
        for (const part of text.split("\n")) {
          if (part.length) {
            changes.push({ from: pos, insert: m }, { from: pos + part.length, insert: m });
            added += 2 * m.length;
          }
          pos += part.length + 1;
        }
        const first = text.split("\n")[0].length ? m.length : 0;
        return { changes, range: EditorSelection.range(r.from + first, r.to + added - (text.split("\n").pop()!.length ? m.length : 0)) };
      }
      return {
        changes: [
          { from: r.from, insert: m },
          { from: r.to, insert: m },
        ],
        range: EditorSelection.range(r.anchor + m.length, r.head + m.length),
      };
    }
    // Empty selection: remove the format around the cursor, or wrap the word under it.
    const node = enclosing(state, r.head, NODE[kind]);
    if (node) return unwrapRange(state, kind, r, node);
    const word = state.wordAt(r.head);
    if (word && word.from < r.head && word.to > r.head) {
      const changes = [
        { from: word.from, insert: m },
        { from: word.to, insert: m },
      ];
      if (kind === "comment") return { changes, range: EditorSelection.range(word.from + m.length, word.to + m.length) };
      return { changes, range: EditorSelection.cursor(r.head + m.length) };
    }
    return { changes: { from: r.head, insert: m + m }, range: EditorSelection.cursor(r.head + m.length) };
  });
}

/** Toggle a coloured highlight (==🔴text==); `color` null = plain highlight toggle. */
export function toggleHighlightColor(state: EditorState, color: string): TransactionSpec {
  const emoji = HIGHLIGHT_COLORS[color];
  return state.changeByRange((r) => {
    const node = enclosing(state, r.empty ? r.head : r.from, ["Highlight"]);
    if (node && (r.empty || (node.from <= r.from && node.to >= r.to))) {
      const after = state.sliceDoc(node.from + 2, node.from + 6);
      const cur = COLOR_EMOJI.exec(after);
      if (cur && cur[0] === emoji) return unwrapRange(state, "highlight", r, node);
      const from = node.from + 2;
      const to = from + (cur ? cur[0].length : 0);
      const d = emoji.length - (to - from);
      const map = (p: number) => (p >= to ? p + d : p);
      return { changes: { from, to, insert: emoji }, range: EditorSelection.range(map(r.anchor), map(r.head)) };
    }
    const open = "==" + emoji;
    if (r.empty) {
      const word = state.wordAt(r.head);
      if (word && word.from < r.head && word.to > r.head)
        return {
          changes: [
            { from: word.from, insert: open },
            { from: word.to, insert: "==" },
          ],
          range: EditorSelection.cursor(r.head + open.length),
        };
      return { changes: { from: r.head, insert: open + "==" }, range: EditorSelection.cursor(r.head + open.length) };
    }
    return {
      changes: [
        { from: r.from, insert: open },
        { from: r.to, insert: "==" },
      ],
      range: EditorSelection.range(r.anchor + open.length, r.head + open.length),
    };
  });
}

const CLEARABLE: [string, InlineKind][] = [
  ["StrongEmphasis", "bold"],
  ["Emphasis", "italic"],
  ["Strikethrough", "strikethrough"],
  ["Highlight", "highlight"],
  ["InlineCode", "code"],
  ["InlineMath", "math"],
  ["Comment", "comment"],
];

/** Remove inline formatting whose markup lies entirely inside the selection. */
export function clearFormatting(state: EditorState): TransactionSpec | null {
  const changes: ChangeSpec[] = [];
  for (const r of state.selection.ranges) {
    if (r.empty) continue;
    syntaxTree(state).iterate({
      from: r.from,
      to: r.to,
      enter: (n) => {
        const k = CLEARABLE.find(([name]) => name === n.name);
        if (!k || n.from < r.from || n.to > r.to) return;
        const [a, b] = markerLengths(state, k[1], n.from, n.to);
        changes.push({ from: n.from, to: n.from + a }, { from: n.to - b, to: n.to });
      },
    });
  }
  if (!changes.length) return null;
  const set = state.changes(changes);
  return { changes: set, selection: state.selection.map(set, 1) };
}

// ---------- insert commands ----------

export function insertMarkdownLink(state: EditorState): TransactionSpec {
  return state.changeByRange((r) => {
    const text = state.sliceDoc(r.from, r.to);
    if (!text) return { changes: { from: r.from, insert: "[]()" }, range: EditorSelection.cursor(r.from + 1) };
    const insert = `[${text}]()`;
    return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.cursor(r.from + insert.length - 1) };
  });
}

export function insertWrapped(state: EditorState, open: string, close: string): TransactionSpec {
  return state.changeByRange((r) => {
    const text = state.sliceDoc(r.from, r.to);
    const insert = open + text + close;
    return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.cursor(r.from + open.length + text.length) };
  });
}

export function insertTag(state: EditorState): TransactionSpec {
  return state.changeByRange((r) => ({ changes: { from: r.from, insert: "#" }, range: EditorSelection.cursor(r.from + 1) }));
}

function coveredLines(state: EditorState, r: SelectionRange) {
  const a = state.doc.lineAt(r.from);
  let b = state.doc.lineAt(r.to);
  if (b.number > a.number && r.to === b.from) b = state.doc.line(b.number - 1);
  return { a, b };
}

/** Wrap the selected lines in a fence (``` or $$); an empty line gets an empty block. */
export function insertFencedBlock(state: EditorState, fence: string): TransactionSpec {
  const r = state.selection.main;
  const { a, b } = coveredLines(state, r);
  const insertTop = fence + "\n";
  const changes = [
    { from: a.from, insert: insertTop },
    { from: b.to, insert: "\n" + fence },
  ];
  const set = state.changes(changes);
  return { changes: set, selection: EditorSelection.range(r.anchor + insertTop.length, r.head + insertTop.length) };
}

export function insertCallout(state: EditorState): TransactionSpec {
  const r = state.selection.main;
  const { a, b } = coveredLines(state, r);
  if (a.number === b.number && !a.text.trim()) {
    const prevBlank = a.number === 1 || !state.doc.line(a.number - 1).text.trim();
    const head = (prevBlank ? "" : "\n") + "> [!";
    const insert = head + "NOTE] Title\n> Contents\n";
    return { changes: { from: a.from, to: a.to, insert }, selection: EditorSelection.range(a.from + head.length, a.from + head.length + 4) };
  }
  const changes: ChangeSpec[] = [{ from: a.from, insert: "> [!NOTE]\n" }];
  for (let n = a.number; n <= b.number; n++) changes.push({ from: state.doc.line(n).from, insert: "> " });
  return { changes, selection: EditorSelection.range(a.from + 4, a.from + 8) };
}

export function insertTable(state: EditorState): TransactionSpec {
  const line = state.doc.lineAt(state.selection.main.head);
  const prefix = line.text.length ? "\n\n" : "\n";
  const table = "|     |     |\n| --- | --- |\n|     |     |\n";
  return { changes: { from: line.to, insert: prefix + table }, selection: EditorSelection.cursor(line.to + prefix.length + 1) };
}

export function insertHorizontalRule(state: EditorState): TransactionSpec {
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const before = state.sliceDoc(line.from, pos);
  let prefix = "";
  if (before.trim()) prefix = "\n\n";
  else if (line.number > 1 && state.doc.line(line.number - 1).text.trim()) prefix = "\n";
  const insert = prefix + "---\n";
  const r = state.selection.main;
  return { changes: { from: r.from, to: r.to, insert }, selection: EditorSelection.cursor(r.from + insert.length) };
}

export function insertFootnote(state: EditorState): TransactionSpec {
  const doc = state.doc.toString();
  let max = 0;
  for (const m of doc.matchAll(/\[\^(\d+)\]/g)) max = Math.max(max, Number(m[1]));
  const n = max + 1;
  const ref = `[^${n}]`;
  const r = state.selection.main;
  const tail = doc.endsWith("\n\n") ? "" : doc.endsWith("\n") ? "\n" : "\n\n";
  return {
    changes: [
      { from: r.to, insert: ref },
      { from: doc.length, insert: tail + `[^${n}]: \n` },
    ],
    selection: EditorSelection.cursor(r.to + ref.length),
  };
}
