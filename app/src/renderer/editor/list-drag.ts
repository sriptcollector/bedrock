// Drag a list item (with its children) by its bullet in live preview and drop it before/after
// another line. The moved block takes the indentation of the item it is dropped next to.
import type { EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { parseListLine, indentWidth } from "./lists";

/** Line range [first, last] (1-based) of the list item at `lineNo` and its children. */
export function itemBlock(state: EditorState, lineNo: number): { first: number; last: number } {
  const it = parseListLine(state.doc.line(lineNo).text);
  const base = it ? indentWidth(it.indent, state.tabSize) : 0;
  let last = lineNo;
  for (let n = lineNo + 1; n <= state.doc.lines; n++) {
    const text = state.doc.line(n).text;
    if (!text.trim()) {
      // A blank line only belongs to the item when a deeper line follows it.
      const next = n + 1 <= state.doc.lines ? state.doc.line(n + 1).text : "";
      if (next.trim() && indentWidth(/^[ \t]*/.exec(next)![0], state.tabSize) > base) continue;
      break;
    }
    if (indentWidth(/^[ \t]*/.exec(text)![0], state.tabSize) <= base) break;
    last = n;
  }
  return { first: lineNo, last };
}

/** Changes that move the block [first,last] so it sits before line `target` (1-based; doc.lines+1 = end). */
export function moveBlock(state: EditorState, first: number, last: number, target: number, reindentTo: string | null) {
  const doc = state.doc;
  if (target >= first && target <= last + 1) return null;
  const from = doc.line(first).from;
  const to = doc.line(last).to;
  let lines = doc.sliceString(from, to).split("\n");
  if (reindentTo !== null) {
    const own = /^[ \t]*/.exec(lines[0])![0];
    lines = lines.map((l) => (l.startsWith(own) ? reindentTo + l.slice(own.length) : l));
  }
  const text = lines.join("\n");
  const del = last < doc.lines ? { from, to: to + 1 } : { from: Math.max(0, from - 1), to };
  const insAt = target > doc.lines ? doc.length : doc.line(target).from;
  const ins = target > doc.lines ? "\n" + text : text + "\n";
  return { changes: [del, { from: insAt, insert: ins }] };
}

export const listDrag = ViewPlugin.fromClass(
  class {
    indicator: HTMLElement | null = null;
    constructor(readonly view: EditorView) {}
    destroy() {
      this.indicator?.remove();
    }
  },
  {
    eventHandlers: {
      mousedown(e: MouseEvent, view: EditorView) {
        const bullet = (e.target as HTMLElement).closest?.(".list-bullet");
        if (!bullet || e.button !== 0) return false;
        const pos = view.posAtDOM(bullet);
        const lineNo = view.state.doc.lineAt(pos).number;
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        let dragging = false;
        let target = -1;
        const ind = createDiv("cm-list-drop-indicator");
        const doc = view.dom.ownerDocument;
        const move = (ev: MouseEvent) => {
          if (!dragging && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 5) return;
          if (!dragging) {
            dragging = true;
            view.dom.addClass("is-dragging-list-item");
            doc.body.appendChild(ind);
          }
          const p = view.posAtCoords({ x: ev.clientX, y: ev.clientY }, false);
          const line = view.state.doc.lineAt(p);
          const block = view.lineBlockAt(line.from);
          const mid = block.top + block.height / 2 + view.documentTop;
          target = ev.clientY < mid ? line.number : line.number + 1;
          // Fixed-position line at the drop boundary (viewport coordinates).
          const top = view.documentTop + (target <= view.state.doc.lines ? view.lineBlockAt(view.state.doc.line(target).from).top : view.contentHeight);
          const r = view.contentDOM.getBoundingClientRect();
          ind.style.top = top - 1 + "px";
          ind.style.left = r.left + "px";
          ind.style.width = r.width + "px";
        };
        const up = () => {
          doc.removeEventListener("mousemove", move, true);
          doc.removeEventListener("mouseup", up, true);
          view.dom.removeClass("is-dragging-list-item");
          ind.remove();
          if (!dragging) {
            // A plain click on the bullet puts the cursor at the start of the item text.
            const line = view.state.doc.line(lineNo);
            const it = parseListLine(line.text);
            view.dispatch({ selection: { anchor: line.from + (it?.contentStart ?? 0) } });
            view.focus();
            return;
          }
          const { first, last } = itemBlock(view.state, lineNo);
          // Take the indentation of the item we drop next to (the one at the target, or before it).
          let reindent: string | null = null;
          const near = target <= view.state.doc.lines ? view.state.doc.line(target).text : "";
          const prev = target - 1 >= 1 ? view.state.doc.line(target - 1).text : "";
          const ref = parseListLine(near) ?? parseListLine(prev);
          if (ref) reindent = ref.quote + ref.indent;
          const spec = moveBlock(view.state, first, last, target, reindent);
          if (spec) view.dispatch({ ...spec, userEvent: "move.drop", scrollIntoView: false });
          view.focus();
        };
        doc.addEventListener("mousemove", move, true);
        doc.addEventListener("mouseup", up, true);
        return true;
      },
    },
  },
);
