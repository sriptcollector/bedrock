// Smart lists: Enter / Shift+Enter continuation, Tab / Shift+Tab indentation, numbered list
// renumbering, checkbox toggling and the list-related editor commands. Behaviour follows the
// original app as measured by the parity harness (docs/PARITY-EDITOR.md); everything here is
// plain functions over EditorState so it can be unit tested without a DOM.
import { Annotation, ChangeSet, EditorSelection, EditorState, Facet, Transaction as Tx, type ChangeSpec, type Line, type SelectionRange, type Transaction, type TransactionSpec, type Text } from "@codemirror/state";
import { indentUnit, syntaxTree } from "@codemirror/language";

const renumbering = Annotation.define<boolean>();

export interface ListLine {
  /** Blockquote prefix, e.g. "> " or "> > ". */
  quote: string;
  /** Leading whitespace after the quote prefix. */
  indent: string;
  /** "-", "*", "+", or the number text for ordered items ("1", "12"). */
  bullet: string;
  /** "." or ")" for ordered items, "" for bullets. */
  delim: string;
  /** Whitespace after the marker. */
  space: string;
  /** Task status char (" ", "x", "/", ...) or null when there is no checkbox. */
  task: string | null;
  /** Offset in the line where the item text starts (after marker and checkbox). */
  contentStart: number;
  /** Offset in the line of the marker. */
  markerStart: number;
}

const LIST_RE = /^((?:[ \t]*>[ \t]?)*)([ \t]*)([-*+]|\d{1,9})([.)])?( +|\t|$)(\[(.)\](?: |$))?/;
const QUOTE_RE = /^((?:[ \t]*>[ \t]?)+)/;

export function parseListLine(text: string): ListLine | null {
  const m = LIST_RE.exec(text);
  if (!m) return null;
  const [, quote, indent, bullet, delim = ""] = m;
  const isNum = /^\d/.test(bullet);
  if (isNum !== !!delim) return null;
  let space = m[5];
  // A marker must be followed by whitespace (or end the line, then it is an empty item).
  if (space === "" && m[0].length !== text.length) return null;
  // "-" alone (no space) is not an item for continuation purposes.
  if (space === "" && !isNum) return null;
  if (space === "" && isNum) return null;
  let task: string | null = null;
  let contentStart = quote.length + indent.length + bullet.length + delim.length + space.length;
  if (m[6]) {
    task = m[7];
    contentStart += m[6].length;
  }
  return { quote, indent, bullet, delim, space, task, contentStart, markerStart: quote.length + indent.length };
}

export function isOrdered(l: ListLine): boolean {
  return l.delim !== "";
}

export function indentWidth(ws: string, tabSize: number): number {
  let w = 0;
  for (const ch of ws) w = ch === "\t" ? w + tabSize - (w % tabSize) : w + 1;
  return w;
}

function inCode(state: EditorState, pos: number): boolean {
  let node: any = syntaxTree(state).resolveInner(pos, -1);
  for (; node; node = node.parent) if (node.name === "FencedCode" || node.name === "CodeBlock" || node.name === "Frontmatter" || node.name === "BlockMath") return true;
  return false;
}

function smartLists(state: EditorState): boolean {
  return state.facet(smartListsFacet);
}

/** Mirrors the "Smart lists" setting (smartIndentList). */
export const smartListsFacet = Facet.define<boolean, boolean>({ combine: (v) => (v.length ? v[v.length - 1] : true) });

/** The list item that owns `line` (the line itself, or the item a continuation line belongs to). */
export function owningItem(doc: Text, line: Line, tabSize: number): { line: Line; item: ListLine } | null {
  const own = parseListLine(line.text);
  if (own) return { line, item: own };
  if (!line.text.trim()) return null;
  const quote = (QUOTE_RE.exec(line.text) ?? [""])[0];
  const ws = /^[ \t]*/.exec(line.text.slice(quote.length))![0];
  const w = indentWidth(ws, tabSize);
  if (w === 0) return null;
  for (let n = line.number - 1; n >= 1 && line.number - n < 500; n--) {
    const l = doc.line(n);
    if (!l.text.trim()) continue;
    const it = parseListLine(l.text);
    if (it) {
      const cw = indentWidth(it.indent, tabSize) + (it.contentStart - it.markerStart);
      if (w >= cw || w > indentWidth(it.indent, tabSize)) return { line: l, item: it };
      continue;
    }
    const lws = /^[ \t]*/.exec(l.text.slice(quote.length))![0];
    if (indentWidth(lws, tabSize) === 0) return null;
  }
  return null;
}

function nextMarker(it: ListLine): string {
  if (isOrdered(it)) return String(Number(it.bullet) + 1) + it.delim;
  return it.bullet;
}

function leadingWs(text: string): string {
  return /^[ \t]*/.exec(text)![0];
}

// ---------- Enter ----------

/** Enter with list / quote continuation. Returns false when not handled (never: always inserts). */
export function insertNewlineContinueList(view: { state: EditorState; dispatch: (tr: TransactionSpec | Transaction) => void }): boolean {
  const { state } = view;
  const tabSize = state.tabSize;
  const smart = smartLists(state);
  const tr = state.changeByRange((range) => {
    const pos = range.from;
    const line = state.doc.lineAt(pos);
    const del = { from: range.from, to: range.to };
    const plain = (indent: string) => ({ changes: { ...del, insert: "\n" + indent }, range: EditorSelection.cursor(range.from + 1 + indent.length) });
    if (inCode(state, pos) && !/^\s*(```|~~~)/.test(line.text)) return plain(leadingWs(line.text.slice(0, pos - line.from)));
    if (!smart) return plain(parseListLine(line.text) ? "" : leadingWs(line.text.slice(0, pos - line.from)));
    const col = pos - line.from;
    const after = line.text.slice(range.to - line.from);
    const owned = owningItem(state.doc, line, tabSize);
    if (owned) {
      const { item } = owned;
      const isFirst = owned.line.number === line.number;
      if (isFirst && col < item.contentStart) {
        // Cursor inside the marker or indentation: plain newline.
        if (col <= item.markerStart) return plain("");
      }
      const content = line.text.slice(item.contentStart);
      if (isFirst && !content.trim() && !after.trim()) {
        // Empty item: outdent nested items, end the list at top level.
        if (item.indent.length) {
          const unit = state.facet(indentUnit);
          const ind = removeOneIndent(item.indent, unit, tabSize);
          const parent = findParentItem(state.doc, line, tabSize, item);
          let marker = parent ? (isOrdered(parent) ? nextMarker(parent) : parent.bullet) : item.bullet + item.delim;
          if (!parent && isOrdered(item)) marker = item.bullet + item.delim;
          const insert = item.quote + ind + marker + " " + (item.task !== null ? "[ ] " : "");
          return { changes: { from: line.from, to: line.to, insert }, range: EditorSelection.cursor(line.from + insert.length) };
        }
        const insert = item.quote.replace(/[ \t]+$/, item.quote ? " " : "");
        return { changes: { from: line.from, to: line.to, insert }, range: EditorSelection.cursor(line.from + insert.length) };
      }
      const marker = nextMarker(item);
      const insert = "\n" + item.quote + item.indent + marker + item.space.replace(/^$/, " ") + (item.task !== null ? "[ ] " : "");
      return { changes: { ...del, insert }, range: EditorSelection.cursor(range.from + insert.length) };
    }
    const q = QUOTE_RE.exec(line.text);
    if (q) {
      const quote = q[1];
      const content = line.text.slice(quote.length);
      if (!content.trim() && !after.trim() && col >= quote.length - 1) {
        // Empty quote line: drop the marker and leave a blank line.
        return { changes: { from: line.from, to: Math.max(line.to, range.to), insert: "\n" }, range: EditorSelection.cursor(line.from + 1) };
      }
      if (col >= quote.trimEnd().length) {
        const prefix = /\s$/.test(quote) ? quote : quote + " ";
        return { changes: { ...del, insert: "\n" + prefix }, range: EditorSelection.cursor(range.from + 1 + prefix.length) };
      }
    }
    if (/^#{1,6}\s/.test(line.text)) return plain("");
    return plain(leadingWs(line.text.slice(0, col)));
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input" }));
  return true;
}

/** Shift+Enter: new line aligned with the list item's text (no new bullet). */
export function insertListContinuationLine(view: { state: EditorState; dispatch: (tr: TransactionSpec | Transaction) => void }): boolean {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from);
    const owned = owningItem(state.doc, line, state.tabSize);
    let pad = "";
    if (owned) {
      const it = owned.item;
      pad = it.quote + it.indent + " ".repeat(it.contentStart - it.markerStart);
    } else pad = leadingWs(line.text.slice(0, range.from - line.from));
    return { changes: { from: range.from, to: range.to, insert: "\n" + pad }, range: EditorSelection.cursor(range.from + 1 + pad.length) };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input" }));
  return true;
}

function removeOneIndent(ws: string, unit: string, tabSize: number): string {
  if (ws.endsWith("\t")) return ws.slice(0, -1);
  const w = indentWidth(ws, tabSize);
  const step = unit === "\t" ? tabSize : unit.length;
  const target = Math.max(0, w - step);
  let out = "";
  for (const ch of ws) {
    if (indentWidth(out + ch, tabSize) > target) break;
    out += ch;
  }
  return out;
}

/** The nearest list item above `line` with a smaller indent than `item`. */
function findParentItem(doc: Text, line: Line, tabSize: number, item: ListLine): ListLine | null {
  const w = indentWidth(item.indent, tabSize);
  for (let n = line.number - 1; n >= 1; n--) {
    const l = doc.line(n);
    if (!l.text.trim()) continue;
    const it = parseListLine(l.text);
    if (!it) {
      if (indentWidth(leadingWs(l.text), tabSize) === 0) return null;
      continue;
    }
    if (indentWidth(it.indent, tabSize) < w) return it;
  }
  return null;
}

// ---------- renumbering ----------

/**
 * Renumber ordered lists in [fromLine, toLine] (1-based, extended to whole lists): the first item
 * of a list keeps its number, every later item is previous sibling + 1; an ordered item that
 * follows a bullet sibling starts again at 1.
 */
export function renumberChanges(doc: Text, tabSize: number, fromLine = 1, toLine = doc.lines): ChangeSpec[] {
  // Extend the range back to the start of the list region.
  let start = Math.max(1, fromLine);
  while (start > 1) {
    const prev = doc.line(start - 1).text;
    if (!prev.trim() || parseListLine(prev) || /^[ \t]+\S/.test(prev)) start--;
    else break;
  }
  const changes: ChangeSpec[] = [];
  const stack: { w: number; num: number | null; quote: string }[] = [];
  for (let n = start; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = line.text;
    if (!text.trim()) continue;
    const it = parseListLine(text);
    if (!it) {
      const w = indentWidth(leadingWs(text), tabSize);
      if (w === 0 && !/^>/.test(text)) {
        stack.length = 0;
        if (n > toLine) break;
      }
      continue;
    }
    const w = indentWidth(it.indent, tabSize);
    while (stack.length && (stack[stack.length - 1].w > w || stack[stack.length - 1].quote !== it.quote)) stack.pop();
    const top = stack.length && stack[stack.length - 1].w === w ? stack[stack.length - 1] : null;
    let num: number | null = null;
    if (isOrdered(it)) {
      const own = Number(it.bullet);
      num = top ? (top.num === null ? 1 : top.num + 1) : own;
      if (num !== own) {
        const from = line.from + it.markerStart;
        changes.push({ from, to: from + it.bullet.length, insert: String(num) });
      }
    }
    if (top) {
      top.num = num;
    } else stack.push({ w, num, quote: it.quote });
  }
  return changes;
}

/** Transaction filter: keep numbered lists numbered after any edit (when Smart lists is on). */
export const renumberOnChange = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(renumbering)) return tr;
  const ev = tr.annotation(Tx.userEvent);
  if (ev && /^(undo|redo|set)$/.test(ev)) return tr;
  if (!tr.startState.facet(smartListsFacet)) return tr;
  const doc = tr.newDoc;
  let a = Infinity;
  let b = -1;
  tr.changes.iterChangedRanges((_f, _t, fromB, toB) => {
    a = Math.min(a, doc.lineAt(fromB).number);
    b = Math.max(b, doc.lineAt(toB).number);
  });
  if (b < 0) return tr;
  const from = Math.max(1, a - 300);
  const to = Math.min(doc.lines, b + 300);
  const changes = renumberChanges(doc, tr.startState.tabSize, from, to);
  if (!changes.length) return tr;
  return [tr, { changes, sequential: true, annotations: renumbering.of(true) }];
});


// ---------- indentation ----------

function selectedLines(state: EditorState, r: SelectionRange): Line[] {
  const a = state.doc.lineAt(r.from);
  let b = state.doc.lineAt(r.to);
  if (b.number > a.number && r.to === b.from && !r.empty) b = state.doc.line(b.number - 1);
  const out: Line[] = [];
  for (let n = a.number; n <= b.number; n++) out.push(state.doc.line(n));
  return out;
}

function forEachSelectedLine(state: EditorState, fn: (line: Line) => ChangeSpec | null): ChangeSpec[] {
  const seen = new Set<number>();
  const changes: ChangeSpec[] = [];
  for (const r of state.selection.ranges)
    for (const l of selectedLines(state, r)) {
      if (seen.has(l.number)) continue;
      seen.add(l.number);
      const c = fn(l);
      if (c) changes.push(c);
    }
  return changes;
}

/** Tab: indent the selected lines by one unit (after any quote prefix). */
export function indentLines(view: { state: EditorState; dispatch: (tr: TransactionSpec | Transaction) => void }): boolean {
  const { state } = view;
  const unit = state.facet(indentUnit);
  const changes = forEachSelectedLine(state, (l) => {
    const q = (QUOTE_RE.exec(l.text) ?? [""])[0];
    const at = l.from + q.length;
    return { from: at, insert: unit };
  });
  dispatchWithNumberFix(view, changes, true);
  return true;
}

/** Shift+Tab: remove one unit of indentation from the selected lines. */
export function outdentLines(view: { state: EditorState; dispatch: (tr: TransactionSpec | Transaction) => void }): boolean {
  const { state } = view;
  const unit = state.facet(indentUnit);
  const changes = forEachSelectedLine(state, (l) => {
    const q = (QUOTE_RE.exec(l.text) ?? [""])[0];
    const ws = leadingWs(l.text.slice(q.length));
    if (!ws) return null;
    const kept = removeOneIndent(ws, unit, state.tabSize);
    const at = l.from + q.length;
    return { from: at + kept.length, to: at + ws.length, insert: "" };
  });
  if (!changes.length) return true;
  dispatchWithNumberFix(view, changes, false);
  return true;
}

/** Number an ordered item that just moved level: previous sibling + 1, else 1 (indent) or kept (outdent). */
function dispatchWithNumberFix(view: { state: EditorState; dispatch: (tr: TransactionSpec | Transaction) => void }, changes: ChangeSpec[], indenting: boolean): void {
  const { state } = view;
  const set1 = state.changes(changes);
  let all = set1;
  if (state.facet(smartListsFacet)) {
    const doc = set1.apply(state.doc);
    const fixes: ChangeSpec[] = [];
    const lines = new Set<number>();
    set1.iterChangedRanges((_a, _b, fromB) => lines.add(doc.lineAt(fromB).number));
    for (const n of lines) {
      const line = doc.line(n);
      const it = parseListLine(line.text);
      if (!it || !isOrdered(it)) continue;
      const prev = prevSiblingNumber(doc, n, state.tabSize, it);
      const want = prev === undefined ? (indenting ? 1 : Number(it.bullet)) : prev === null ? 1 : prev + 1;
      if (want !== Number(it.bullet)) fixes.push({ from: line.from + it.markerStart, to: line.from + it.markerStart + it.bullet.length, insert: String(want) });
    }
    if (fixes.length) all = set1.compose(ChangeSet.of(fixes, doc.length));
  }
  view.dispatch({ changes: all, selection: state.selection.map(all, 1), userEvent: indenting ? "input.indent" : "delete.dedent", scrollIntoView: true });
}

/** Number of the previous sibling item (null when it is a bullet, undefined when there is none). */
function prevSiblingNumber(doc: Text, lineNo: number, tabSize: number, item: ListLine): number | null | undefined {
  const w = indentWidth(item.indent, tabSize);
  for (let n = lineNo - 1; n >= 1; n--) {
    const text = doc.line(n).text;
    if (!text.trim()) continue;
    const it = parseListLine(text);
    if (!it) {
      if (indentWidth(leadingWs(text), tabSize) === 0) return undefined;
      continue;
    }
    if (it.quote !== item.quote) return undefined;
    const iw = indentWidth(it.indent, tabSize);
    if (iw > w) continue;
    if (iw < w) return undefined;
    return isOrdered(it) ? Number(it.bullet) : null;
  }
  return undefined;
}


// ---------- checkbox / list toggles ----------

/** Ctrl+L: toggle checkbox status (all unchecked -> checked; checked -> unchecked; plain -> task). */
export function toggleChecklistStatus(state: EditorState): TransactionSpec | null {
  const lines: Line[] = [];
  const seen = new Set<number>();
  for (const r of state.selection.ranges) for (const l of selectedLines(state, r)) if (!seen.has(l.number)) (seen.add(l.number), lines.push(l));
  const items = lines.map((l) => ({ l, it: parseListLine(l.text) }));
  const tasks = items.filter((x) => x.it && x.it.task !== null);
  const changes: ChangeSpec[] = [];
  if (tasks.length === items.length) {
    const states = new Set(tasks.map((x) => (x.it!.task === " " ? "open" : /[xX]/.test(x.it!.task!) ? "done" : "other")));
    if (states.size > 1) return null;
    const s = [...states][0];
    if (s === "other") return null;
    for (const { l, it } of tasks) {
      const at = l.from + it!.contentStart - (l.text.slice(it!.contentStart - 1, it!.contentStart) === " " ? 3 : 2);
      changes.push({ from: at, to: at + 1, insert: s === "open" ? "x" : " " });
    }
    return { changes, userEvent: "input" };
  }
  for (const { l, it } of items) {
    if (it && it.task !== null) continue;
    if (it) {
      if (isOrdered(it)) continue;
      changes.push({ from: l.from + it.contentStart, insert: "[ ] " });
    } else {
      const q = (QUOTE_RE.exec(l.text) ?? [""])[0];
      const ws = leadingWs(l.text.slice(q.length));
      changes.push({ from: l.from + q.length + ws.length, insert: "- [ ] " });
    }
  }
  if (!changes.length) return null;
  return { changes, selection: state.selection.map(state.changes(changes), 1), userEvent: "input" };
}

/** Cycle bullet/checkbox: text -> bullet -> task -> done task -> bullet. */
export function cycleListChecklist(state: EditorState): TransactionSpec | null {
  const changes = forEachSelectedLine(state, (l) => {
    const it = parseListLine(l.text);
    if (!it) {
      const q = (QUOTE_RE.exec(l.text) ?? [""])[0];
      const ws = leadingWs(l.text.slice(q.length));
      return { from: l.from + q.length + ws.length, insert: "- " };
    }
    if (it.task === null) return { from: l.from + it.contentStart, insert: "[ ] " };
    const boxAt = l.from + it.contentStart - (l.text[it.contentStart - 1] === " " ? 4 : 3);
    if (it.task === " ") return { from: boxAt + 1, to: boxAt + 2, insert: "x" };
    return { from: boxAt, to: l.from + it.contentStart, insert: "" };
  });
  if (!changes.length) return null;
  return { changes, selection: state.selection.map(state.changes(changes), 1), userEvent: "input" };
}

type Kind = "bullet" | "numbered" | "quote";

/** Toggle bullet list / numbered list / blockquote on the selected lines. */
export function toggleLinePrefix(state: EditorState, kind: Kind): TransactionSpec | null {
  const lines: Line[] = [];
  const seen = new Set<number>();
  for (const r of state.selection.ranges) for (const l of selectedLines(state, r)) if (!seen.has(l.number)) (seen.add(l.number), lines.push(l));
  const has = (l: Line) => {
    if (kind === "quote") return /^[ \t]*>/.test(l.text);
    const it = parseListLine(l.text);
    if (!it) return false;
    return kind === "numbered" ? isOrdered(it) && it.task === null : !isOrdered(it) && it.task === null;
  };
  const allHave = lines.every(has);
  const changes: ChangeSpec[] = [];
  let n = 0;
  for (const l of lines) {
    if (kind === "quote") {
      const m = /^([ \t]*)>[ \t]?/.exec(l.text);
      if (allHave && m) changes.push({ from: l.from + m[1].length, to: l.from + m[0].length, insert: "" });
      else if (!m) changes.push({ from: l.from, insert: "> " });
      continue;
    }
    const it = parseListLine(l.text);
    if (allHave) {
      if (it) changes.push({ from: l.from + it.markerStart, to: l.from + it.contentStart, insert: "" });
      continue;
    }
    n++;
    if (it && has(l)) continue;
    const marker = kind === "numbered" ? `${n}. ` : "- ";
    if (it) changes.push({ from: l.from + it.markerStart, to: l.from + it.contentStart, insert: marker });
    else {
      const q = (QUOTE_RE.exec(l.text) ?? [""])[0];
      const ws = leadingWs(l.text.slice(q.length));
      changes.push({ from: l.from + q.length + ws.length, insert: marker });
    }
  }
  if (!changes.length) return null;
  return { changes, selection: state.selection.map(state.changes(changes), 1), userEvent: "input" };
}

/** Set heading level (0 removes) on the selected lines. */
export function setHeading(state: EditorState, level: number): TransactionSpec | null {
  const changes = forEachSelectedLine(state, (l) => {
    const m = /^#{1,6}[ \t]+/.exec(l.text) ?? /^#{1,6}$/.exec(l.text);
    const insert = level ? "#".repeat(level) + " " : "";
    if (m) return m[0] === insert ? null : { from: l.from, to: l.from + m[0].length, insert };
    return insert ? { from: l.from, insert } : null;
  });
  if (!changes.length) return null;
  return { changes, selection: state.selection.map(state.changes(changes), 1), userEvent: "input" };
}
