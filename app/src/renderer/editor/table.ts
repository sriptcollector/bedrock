// Live preview table editor: tables render as a widget whose cells are edited in place by a small
// nested CodeMirror editor; edits are written back to the note as a tidy, padded Markdown table.
// Tab / Shift+Tab / Enter / arrows move between cells (adding rows at the end), the handles drag
// rows and columns, the + buttons add a row or column, and the cell context menu has Row,
// Column and Sort actions. Also the `editor:table-*` commands (tableCommand).
import { Annotation, EditorSelection, EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, WidgetType, keymap, drawSelection } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { history, historyKeymap, defaultKeymap, undo, redo } from "@codemirror/commands";
import { parseTable, formatTable, cellOffset, cellAt, applyTableOp, type TableModel, type TableOp } from "./table-model";
import { setIcon } from "../dom/icons";
import { Menu } from "../ui/menu";
import { renderInlineMarkdown } from "../markdown/renderer";

export type { TableOp } from "./table-model";

/** Marks transactions written by the table editor itself. */
export const tableEdit = Annotation.define<boolean>();

/** Find the table (syntax node "Table") containing pos. */
export function tableAt(state: EditorState, pos: number): { from: number; to: number } | null {
  for (const side of [1, -1] as const) {
    for (let n: any = syntaxTree(state).resolveInner(pos, side); n; n = n.parent) if (n.name === "Table") return { from: n.from, to: n.to };
  }
  return null;
}

/** Run (or with check=true, test) a table command at the main cursor. */
export function tableCommand(cm: EditorView, op: TableOp, check = false): boolean {
  const state = cm.state;
  const head = state.selection.main.head;
  const range = tableAt(state, head);
  if (!range) return false;
  const text = state.sliceDoc(range.from, range.to);
  const t = parseTable(text);
  const cell = cellAt(text, head - range.from);
  if (!t || !cell) return false;
  const res = applyTableOp(t, op, cell.row, cell.col);
  if (!res) return false;
  if (check) return true;
  writeTable(cm, range, res.t, res.row, res.col, true);
  return true;
}

function writeTable(cm: EditorView, range: { from: number; to: number }, t: TableModel, row: number, col: number, refocus: boolean): void {
  const formatted = formatTable(t);
  const anchor = range.from + cellOffset(t, row, col);
  cm.dispatch({
    changes: { from: range.from, to: range.to, insert: formatted },
    selection: { anchor },
    annotations: tableEdit.of(true),
    userEvent: "input.table",
  });
  if (refocus) pendingFocus.set(cm, { from: range.from, row, col });
  // Re-focus the cell once the widget has re-rendered.
  requestAnimationFrame(() => focusPending(cm));
}

const pendingFocus = new WeakMap<EditorView, { from: number; row: number; col: number; selectAll?: boolean; atEnd?: boolean }>();

function focusPending(cm: EditorView): void {
  const p = pendingFocus.get(cm);
  if (!p) return;
  pendingFocus.delete(cm);
  const el = cm.contentDOM.querySelector<HTMLElement>(`.cm-table-widget[data-table-from="${p.from}"]`) ?? findWidgetAt(cm, p.from);
  const ctl = (el as any)?.__table as TableController | undefined;
  ctl?.activate(p.row, p.col, p.selectAll ? "all" : p.atEnd ? "end" : "start");
}

function findWidgetAt(cm: EditorView, from: number): HTMLElement | null {
  for (const el of Array.from(cm.contentDOM.querySelectorAll<HTMLElement>(".cm-table-widget"))) {
    const c = (el as any).__table as TableController | undefined;
    if (c && Math.abs(c.from - from) < 3) return el;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------

class TableController {
  model: TableModel;
  active: { row: number; col: number; editor: EditorView } | null = null;
  constructor(public view: EditorView, public dom: HTMLElement, public source: string, public from: number, public app: any, public sourcePath: string, public cellExtensions: () => Extension[]) {
    this.model = parseTable(source) ?? { rows: [[""]], aligns: [null] };
  }

  get to(): number {
    return this.from + this.source.length;
  }

  render(): void {
    const wrap = this.dom.querySelector(".table-wrapper") ?? this.dom.createDiv("table-wrapper");
    wrap.empty();
    const table = wrap.createEl("table", { cls: "table-editor", attr: { tabindex: "-1" } });
    const thead = table.createEl("thead");
    const tbody = table.createEl("tbody");
    this.model.rows.forEach((cells, r) => {
      const tr = (r === 0 ? thead : tbody).createEl("tr");
      cells.forEach((text, c) => {
        const cell = tr.createEl(r === 0 ? "th" : "td", { attr: { dir: r === 0 ? "ltr" : "auto" } });
        const a = this.model.aligns[c];
        if (a) cell.setAttr("align", a);
        const inner = cell.createDiv("table-cell-wrapper");
        renderInlineMarkdown(this.app, text, inner, this.sourcePath);
        if (r === 0) this.handle(cell, "col", c);
        if (c === 0) this.handle(cell, "row", r);
        cell.addEventListener("mousedown", (e) => {
          if ((e.target as HTMLElement).closest(".table-col-drag-handle, .table-row-drag-handle")) return;
          const link = (e.target as HTMLElement).closest("a");
          if (link && !(this.active && this.active.row === r && this.active.col === c)) return;
          if (this.active && this.active.row === r && this.active.col === c) return;
          e.preventDefault();
          this.activate(r, c, "end");
        });
        cell.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!this.active || this.active.row !== r || this.active.col !== c) this.activate(r, c, "end");
          this.showMenu(e);
        });
      });
    });
    const rowBtn = wrap.createDiv({ cls: "table-row-btn", attr: { "aria-label": "Add row below" } });
    setIcon(rowBtn, "plus");
    rowBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.op("row-after", this.model.rows.length - 1, this.active?.col ?? 0);
    });
    const colBtn = wrap.createDiv({ cls: "table-col-btn", attr: { "aria-label": "Add column to the right" } });
    setIcon(colBtn, "plus");
    colBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.op("col-after", this.active?.row ?? 0, this.model.aligns.length - 1);
    });
    this.active = null;
  }

  private handle(cell: HTMLElement, kind: "row" | "col", index: number): void {
    const h = cell.createDiv({ cls: kind === "col" ? "table-col-drag-handle" : "table-row-drag-handle", attr: { "data-ignore-swipe": "true" } });
    setIcon(h, kind === "col" ? "grip-horizontal" : "grip-vertical");
    h.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      let moved = false;
      this.dom.addClass("is-dragging");
      const target = () => {
        const cells = Array.from(this.dom.querySelectorAll<HTMLElement>(kind === "col" ? "thead th" : "tr"));
        return cells;
      };
      const onMove = (ev: MouseEvent) => {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 4) moved = true;
        for (const el of target()) el.toggleClass("is-drop-target", kind === "col" ? ev.clientX >= el.getBoundingClientRect().left && ev.clientX < el.getBoundingClientRect().right : ev.clientY >= el.getBoundingClientRect().top && ev.clientY < el.getBoundingClientRect().bottom);
      };
      const onUp = (ev: MouseEvent) => {
        window.removeEventListener("mousemove", onMove, true);
        window.removeEventListener("mouseup", onUp, true);
        this.dom.removeClass("is-dragging");
        const els = target();
        els.forEach((el) => el.removeClass("is-drop-target"));
        if (!moved) {
          // A click on a handle selects the row/column (shows its menu, like a right-click).
          this.activate(kind === "row" ? index : 0, kind === "col" ? index : 0, "end");
          this.showMenu(ev, kind);
          return;
        }
        let to = -1;
        els.forEach((el, i) => {
          const r = el.getBoundingClientRect();
          if (kind === "col" ? ev.clientX >= r.left && ev.clientX < r.right : ev.clientY >= r.top && ev.clientY < r.bottom) to = i;
        });
        if (to < 0 || to === index || (kind === "row" && to === 0)) return;
        this.move(kind, index, to);
      };
      window.addEventListener("mousemove", onMove, true);
      window.addEventListener("mouseup", onUp, true);
    });
  }

  private move(kind: "row" | "col", from: number, to: number): void {
    const rows = this.model.rows.map((r) => r.slice());
    const aligns = this.model.aligns.slice();
    if (kind === "row") {
      const [r] = rows.splice(from, 1);
      rows.splice(to, 0, r);
    } else {
      for (const r of rows) {
        const [c] = r.splice(from, 1);
        r.splice(to, 0, c);
      }
      const [a] = aligns.splice(from, 1);
      aligns.splice(to, 0, a);
    }
    this.write({ rows, aligns }, kind === "row" ? to : 0, kind === "col" ? to : 0, true);
  }

  op(op: TableOp, row: number, col: number): void {
    const res = applyTableOp(this.model, op, row, col);
    if (!res) return;
    this.write(res.t, res.row, res.col, true);
  }

  write(t: TableModel, row: number, col: number, refocus: boolean): void {
    writeTable(this.view, { from: this.from, to: this.to }, t, row, col, refocus);
  }

  showMenu(e: MouseEvent, only?: "row" | "col"): void {
    const r = this.active?.row ?? 0;
    const c = this.active?.col ?? 0;
    const rows = this.model.rows.length;
    const cols = this.model.aligns.length;
    const rowMenu = (m: Menu) => {
      if (r > 0) m.addItem((i) => i.setTitle("Add row above").setIcon("arrow-up-to-line").onClick(() => this.op("row-before", r, c)));
      m.addItem((i) => i.setTitle("Add row below").setIcon("arrow-down-to-line").onClick(() => this.op("row-after", r, c)));
      m.addSeparator();
      if (r > 1) m.addItem((i) => i.setTitle("Move row up").setIcon("arrow-up").onClick(() => this.op("row-up", r, c)));
      if (r > 0 && r < rows - 1) m.addItem((i) => i.setTitle("Move row down").setIcon("arrow-down").onClick(() => this.op("row-down", r, c)));
      m.addSeparator();
      if (r > 0) m.addItem((i) => i.setTitle("Duplicate row").setIcon("copy").onClick(() => this.op("row-copy", r, c)));
      if (r > 0) m.addItem((i) => i.setTitle("Delete row").setIcon("trash-2").setWarning(true).onClick(() => this.op("row-delete", r, c)));
    };
    const colMenu = (m: Menu) => {
      m.addItem((i) => i.setTitle("Add column to the left").setIcon("arrow-left-to-line").onClick(() => this.op("col-before", r, c)));
      m.addItem((i) => i.setTitle("Add column to the right").setIcon("arrow-right-to-line").onClick(() => this.op("col-after", r, c)));
      m.addSeparator();
      if (c > 0) m.addItem((i) => i.setTitle("Move column left").setIcon("arrow-left").onClick(() => this.op("col-left", r, c)));
      if (c < cols - 1) m.addItem((i) => i.setTitle("Move column right").setIcon("arrow-right").onClick(() => this.op("col-right", r, c)));
      m.addSeparator();
      for (const [a, label] of [
        ["left", "Align left"],
        ["center", "Align center"],
        ["right", "Align right"],
      ] as const)
        m.addItem((i) =>
          i
            .setTitle(label)
            .setIcon(`align-${a}`)
            .setChecked(this.model.aligns[c] === a)
            .onClick(() => this.op(`col-align-${a}` as TableOp, r, c)),
        );
      m.addSeparator();
      m.addItem((i) => i.setTitle("Duplicate column").setIcon("copy").onClick(() => this.op("col-copy", r, c)));
      if (cols > 1) m.addItem((i) => i.setTitle("Delete column").setIcon("trash-2").setWarning(true).onClick(() => this.op("col-delete", r, c)));
    };
    if (only) {
      const m = new Menu();
      (only === "row" ? rowMenu : colMenu)(m);
      m.showAtMouseEvent(e);
      return;
    }
    const owner = this.view.state.field(editorInfoFieldRef(), false);
    const ed = this.active?.editor;
    const extra = (m: Menu) => {
      m.addSeparator();
      m.addItem((i) => {
        i.setTitle("Row").setIcon("rows-3").setSection("table");
        rowMenu(i.setSubmenu());
      });
      m.addItem((i) => {
        i.setTitle("Column").setIcon("columns-3").setSection("table");
        colMenu(i.setSubmenu());
      });
      m.addItem((i) => i.setTitle("Sort by column (A to Z)").setIcon("arrow-down-a-z").setSection("table-sort").onClick(() => this.op("sort-asc", r, c)));
      m.addItem((i) => i.setTitle("Sort by column (Z to A)").setIcon("arrow-up-z-a").setSection("table-sort").onClick(() => this.op("sort-desc", r, c)));
    };
    if (owner && ed && showMenuRef) showMenuRef(this.app, owner, ed, e, extra);
    else {
      const m = new Menu();
      extra(m);
      m.showAtMouseEvent(e);
    }
  }

  cellEl(row: number, col: number): HTMLElement | null {
    const tr = this.dom.querySelectorAll("tr")[row];
    return (tr?.children[col] as HTMLElement) ?? null;
  }

  /** Put a nested editor in the cell and focus it. */
  activate(row: number, col: number, where: "start" | "end" | "all" | number): void {
    row = Math.max(0, Math.min(row, this.model.rows.length - 1));
    col = Math.max(0, Math.min(col, this.model.aligns.length - 1));
    this.deactivate();
    const cell = this.cellEl(row, col);
    if (!cell) return;
    const text = this.model.rows[row][col] ?? "";
    // Normalise the table once editing starts (the original reformats on focus).
    const formatted = formatTable(this.model);
    if (formatted !== this.source) {
      this.write(this.model, row, col, false);
      pendingFocus.set(this.view, { from: this.from, row, col, selectAll: where === "all", atEnd: where === "end" });
      return;
    }
    const shown = cell.querySelector<HTMLElement>(".table-cell-wrapper");
    if (shown) shown.style.display = "none";
    const host = createDiv({ cls: "table-cell-wrapper", attr: { "data-ignore-swipe": "true" } });
    cell.insertBefore(host, shown?.nextSibling ?? null);
    cell.closest("tr")?.querySelector("th, td")?.addClass("mod-active-row-handle");
    this.dom.querySelectorAll("thead th")[col]?.addClass("mod-active-col-handle");
    const editor = new EditorView({
      parent: host.createDiv("cm-s-obsidian mod-cm6 is-live-preview"),
      state: EditorState.create({
        doc: text.replace(/<br\s*\/?>/gi, "\n"),
        extensions: [Prec.highest(keymap.of(this.cellKeymap())), history(), drawSelection(), keymap.of([...historyKeymap, ...defaultKeymap]), EditorView.lineWrapping, ...this.cellExtensions(), EditorView.updateListener.of((u) => this.onCellUpdate(u))],
      }),
    });
    this.active = { row, col, editor };
    this.dom.addClass("has-focus");
    const len = editor.state.doc.length;
    const sel = where === "all" ? EditorSelection.range(0, len) : where === "start" ? EditorSelection.cursor(0) : where === "end" ? EditorSelection.cursor(len) : EditorSelection.cursor(Math.min(len, where));
    editor.dispatch({ selection: sel });
    editor.focus();
    this.syncMainSelection();
    editor.contentDOM.addEventListener("blur", () => {
      setTimeout(() => {
        if (this.active?.editor === editor && !editor.hasFocus && !document.querySelector(".menu")) this.deactivate();
      }, 0);
    });
  }

  deactivate(): void {
    if (!this.active) return;
    const { editor, row, col } = this.active;
    this.active = null;
    editor.destroy();
    const cell = this.cellEl(row, col);
    if (cell) {
      cell.querySelectorAll(".table-cell-wrapper").forEach((w, i) => (i === 0 ? ((w as HTMLElement).style.display = "") : w.remove()));
      const shown = cell.querySelector<HTMLElement>(".table-cell-wrapper");
      if (shown) {
        shown.empty();
        renderInlineMarkdown(this.app, this.model.rows[row]?.[col] ?? "", shown, this.sourcePath);
      }
    }
    this.dom.querySelectorAll(".mod-active-row-handle, .mod-active-col-handle").forEach((e) => e.removeClass("mod-active-row-handle", "mod-active-col-handle"));
    this.dom.removeClass("has-focus");
  }

  private syncMainSelection(): void {
    if (!this.active) return;
    const off = cellOffset(this.model, this.active.row, this.active.col);
    const head = this.active.editor.state.selection.main.head;
    const pos = Math.min(this.view.state.doc.length, this.from + off + head);
    if (this.view.state.selection.main.head !== pos || this.view.state.selection.ranges.length > 1) this.view.dispatch({ selection: { anchor: pos }, annotations: tableEdit.of(true) });
  }

  private onCellUpdate(u: any): void {
    if (!this.active || u.view !== this.active.editor) return;
    if (u.docChanged) {
      const raw = u.state.doc.toString();
      const value = raw.replace(/\n/g, "<br>").replace(/(^|[^\\])\|/g, "$1\\|");
      const rows = this.model.rows.map((r) => r.slice());
      rows[this.active.row][this.active.col] = value;
      const t = { rows, aligns: this.model.aligns.slice() };
      const formatted = formatTable(t);
      const off = cellOffset(t, this.active.row, this.active.col);
      this.model = t;
      const head = u.state.selection.main.head;
      this.view.dispatch({
        changes: { from: this.from, to: this.to, insert: formatted },
        selection: { anchor: this.from + off + head },
        annotations: tableEdit.of(true),
        userEvent: "input.table",
      });
      this.source = formatted;
    } else if (u.selectionSet) this.syncMainSelection();
  }

  private move1(dRow: number, dCol: number, where: "start" | "end" | "all"): boolean {
    if (!this.active) return false;
    let { row, col } = this.active;
    const cols = this.model.aligns.length;
    const rows = this.model.rows.length;
    if (dCol) {
      col += dCol;
      if (col >= cols) {
        col = 0;
        row++;
      } else if (col < 0) {
        col = cols - 1;
        row--;
      }
    }
    row += dRow;
    if (row < 0) {
      this.leave(-1);
      return true;
    }
    if (row >= rows) {
      if (dRow || dCol > 0) {
        // Past the last row: add a new one (Tab and Enter both do this).
        if (where === "all" || dRow) {
          this.op("row-after", rows - 1, dCol ? 0 : col);
          return true;
        }
      }
      this.leave(1);
      return true;
    }
    this.activate(row, col, where);
    return true;
  }

  /** Leave the table: put the main cursor before or after it. */
  leave(dir: -1 | 1): void {
    this.deactivate();
    const doc = this.view.state.doc;
    const pos = dir < 0 ? Math.max(0, this.from - 1) : Math.min(doc.length, this.to + 1);
    this.view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    this.view.focus();
  }

  private cellKeymap() {
    const at = (fn: (ed: EditorView) => boolean) => (ed: EditorView) => fn(ed);
    return [
      { key: "Tab", run: at(() => this.move1(0, 1, "all")) },
      { key: "Shift-Tab", run: at(() => this.move1(0, -1, "all")) },
      { key: "Enter", run: at(() => this.move1(1, 0, "start")) },
      { key: "Shift-Enter", run: at((ed) => (ed.dispatch(ed.state.replaceSelection("\n")), true)) },
      { key: "Escape", run: at(() => (this.leave(1), true)) },
      {
        key: "ArrowUp",
        run: at((ed) => {
          const line = ed.state.doc.lineAt(ed.state.selection.main.head);
          if (line.number > 1) return false;
          return this.move1(-1, 0, "start");
        }),
      },
      {
        key: "ArrowDown",
        run: at((ed) => {
          const line = ed.state.doc.lineAt(ed.state.selection.main.head);
          if (line.number < ed.state.doc.lines) return false;
          if (this.active && this.active.row >= this.model.rows.length - 1) {
            this.leave(1);
            return true;
          }
          return this.move1(1, 0, "start");
        }),
      },
      {
        key: "ArrowLeft",
        run: at((ed) => {
          const s = ed.state.selection.main;
          if (!s.empty || s.head > 0) return false;
          if (this.active && this.active.row === 0 && this.active.col === 0) {
            this.leave(-1);
            return true;
          }
          return this.move1(0, -1, "end");
        }),
      },
      {
        key: "ArrowRight",
        run: at((ed) => {
          const s = ed.state.selection.main;
          if (!s.empty || s.head < ed.state.doc.length) return false;
          if (this.active && this.active.row === this.model.rows.length - 1 && this.active.col === this.model.aligns.length - 1) {
            this.leave(1);
            return true;
          }
          return this.move1(0, 1, "start");
        }),
      },
      { key: "Mod-z", run: () => undo(this.view) },
      { key: "Mod-y", run: () => redo(this.view) },
      { key: "Mod-Shift-z", run: () => redo(this.view) },
    ];
  }
}

// Late-bound references (avoid import cycles with live-preview / commands).
let showMenuRef: ((app: any, v: any, cm: EditorView, at: MouseEvent, extra?: (m: Menu) => void) => any) | null = null;
let infoField: any = null;
export function bindTableEditor(opts: { showMenu: typeof showMenuRef; editorInfoField: any }): void {
  showMenuRef = opts.showMenu;
  infoField = opts.editorInfoField;
}
function editorInfoFieldRef(): any {
  return infoField;
}

export class TableWidget extends WidgetType {
  constructor(readonly source: string, readonly from: number, readonly app: any, readonly sourcePath: string, readonly cellExtensions: () => Extension[]) {
    super();
  }
  eq(o: TableWidget): boolean {
    return o.source === this.source && o.from === this.from;
  }
  toDOM(view: EditorView): HTMLElement {
    const dom = createDiv({ cls: "cm-embed-block cm-table-widget markdown-rendered", attr: { contenteditable: "false", dir: "ltr" } });
    dom.setAttr("data-table-from", String(this.from));
    const ctl = new TableController(view, dom, this.source, this.from, this.app, this.sourcePath, this.cellExtensions);
    (dom as any).__table = ctl;
    ctl.render();
    requestAnimationFrame(() => {
      focusPending(view);
      view.requestMeasure();
    });
    return dom;
  }
  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const ctl = (dom as any).__table as TableController | undefined;
    if (!ctl) return false;
    dom.setAttr("data-table-from", String(this.from));
    ctl.from = this.from;
    if (ctl.source === this.source) return true;
    // Edit came from somewhere else (undo, sync, source edit): re-read the table.
    const editing = ctl.active;
    ctl.source = this.source;
    ctl.model = parseTable(this.source) ?? ctl.model;
    if (editing && editing.editor.hasFocus) {
      const want = (ctl.model.rows[editing.row]?.[editing.col] ?? "").replace(/<br\s*\/?>/gi, "\n");
      const have = editing.editor.state.doc.toString();
      if (want !== have) editing.editor.dispatch({ changes: { from: 0, to: have.length, insert: want } });
      return true;
    }
    ctl.render();
    requestAnimationFrame(() => focusPending(view));
    return true;
  }
  get estimatedHeight(): number {
    return 40 + this.source.split("\n").length * 30;
  }
  ignoreEvent(): boolean {
    return true;
  }
  destroy(dom: HTMLElement): void {
    (dom as any).__table?.deactivate();
  }
}

/** When the main cursor arrives inside a table (keyboard navigation), move it into a cell. */
export const tableCursorCapture = EditorView.updateListener.of((u) => {
  if (!u.selectionSet || u.transactions.some((t) => t.annotation(tableEdit))) return;
  if (!u.view.hasFocus) return;
  const sel = u.state.selection.main;
  if (!sel.empty) return;
  const range = tableAt(u.state, sel.head);
  if (!range || sel.head === range.from || sel.head === range.to) return;
  const user = u.transactions.some((t) => t.isUserEvent("select"));
  if (!user) return;
  const text = u.state.sliceDoc(range.from, range.to);
  const cell = cellAt(text, sel.head - range.from);
  if (!cell) return;
  pendingFocus.set(u.view, { from: range.from, row: cell.row, col: cell.col, atEnd: true });
  requestAnimationFrame(() => focusPending(u.view));
});
