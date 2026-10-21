// ```query``` code blocks: live search results embedded in a note, in reading view (code block
// processor) and in live preview (a block widget shown while the cursor is outside the block).
import { StateField, type EditorState, type Range as CMRange } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { Component } from "../../api/events";
import { setIcon } from "../../dom/icons";
import { Menu } from "../../ui/menu";
import { Notice } from "../../ui/notice";
import { codeBlockProcessors, MarkdownRenderChild } from "../../markdown/renderer";
import { editorLivePreviewField } from "../../editor/fields";
import { getSearchIndex } from "./search-index";
import { ResultList } from "./results";
import { countResults, runSearch, SORT_OPTIONS, type SearchRun, type SortOrder } from "./search-engine";
import { navButton } from "./tree";

/** Renders a live query result list into `el`. Returns a component that stops updating on unload. */
export function renderQueryBlock(app: any, source: string, el: HTMLElement, comp?: Component): Component {
  const child = new MarkdownRenderChild(el);
  const query = source.trim();
  const wrap = el.createDiv("internal-query");
  const header = wrap.createDiv("internal-query-header");
  const title = header.createDiv({ cls: "internal-query-header-title", text: "Search results" });
  const countEl = header.createDiv({ cls: "internal-query-header-count" });
  const btns = header.createDiv("nav-buttons-container");
  const st = { collapseAll: false, extraContext: false, sort: "alphabetical" as SortOrder };
  const list = new ResultList(wrap, { app, hoverSource: "search", hoverParent: child, collapseAll: () => st.collapseAll, extraContext: () => st.extraContext, emptyText: "No matches found." });
  const collapseBtn = navButton(btns, "list", "Collapse results", () => {
    st.collapseAll = !st.collapseAll;
    collapseBtn.toggleClass("is-active", st.collapseAll);
    list.resetCollapse();
    list.rerender();
  });
  const ctxBtn = navButton(btns, "move-vertical", "Show more context", () => {
    st.extraContext = !st.extraContext;
    ctxBtn.toggleClass("is-active", st.extraContext);
    list.rerender();
  });
  navButton(btns, "sort-asc", "Change sort order", (e) => {
    const m = new Menu();
    for (const [k, label] of SORT_OPTIONS)
      m.addItem((i) =>
        i
          .setTitle(label)
          .setChecked(st.sort === k)
          .onClick(() => {
            st.sort = k;
            run();
          }),
      );
    m.showAtMouseEvent(e);
  });
  navButton(btns, "copy", "Copy search results", () => {
    navigator.clipboard.writeText(list.toText());
    new Notice("Search results copied to clipboard.");
  });
  navButton(btns, "search", "Open in search", () => app.globalSearch?.openGlobalSearch(query));
  let current: SearchRun | null = null;
  const run = async () => {
    if (current) current.cancelled = true;
    const r: SearchRun = { cancelled: false };
    current = r;
    if (!query) {
      list.setEntries([]);
      countEl.setText("");
      return;
    }
    const out = await runSearch(app, getSearchIndex(app), query, { matchCase: false, sort: st.sort }, r);
    if (!out || r.cancelled) return;
    list.setEntries(out.entries);
    let n = 0;
    n = countResults(out.entries);
    countEl.setText(`${n} ${n === 1 ? "result" : "results"}`);
  };
  void title;
  child.register(getSearchIndex(app).onChange(() => run()));
  child.register(() => current && (current.cancelled = true));
  comp?.addChild(child);
  if (!comp) child.load();
  run();
  return child;
}

export function registerQueryCodeBlock(app: any): () => void {
  codeBlockProcessors["query"] = (source, el, ctx) => {
    el.addClass("block-language-query");
    const holder = new Component();
    ctx.addChild(holder);
    renderQueryBlock(app, source, el, holder);
  };
  return () => delete codeBlockProcessors["query"];
}

// ---------------------------------------------------------------- live preview widget
class QueryWidget extends WidgetType {
  private comp: Component | null = null;
  constructor(readonly source: string, readonly from: number) {
    super();
  }
  eq(other: QueryWidget): boolean {
    return other.source === this.source && other.from === this.from;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = createDiv("cm-embed-block cm-query-block block-language-query");
    this.comp = renderQueryBlock((window as any).app, this.source, el);
    const edit = el.createDiv({ cls: "edit-block-button", attr: { "aria-label": "Edit this block" } });
    setIcon(edit, "code-2");
    edit.addEventListener("click", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from + 4 } });
      view.focus();
    });
    return el;
  }
  destroy(): void {
    this.comp?.unload();
    this.comp = null;
  }
  ignoreEvent(): boolean {
    return true;
  }
  get estimatedHeight(): number {
    return 200;
  }
}

function buildQueryDecorations(state: EditorState): DecorationSet {
  const lp = state.field(editorLivePreviewField, false) ?? true;
  if (!lp) return Decoration.none;
  const decos: CMRange<Decoration>[] = [];
  const sel = state.selection.main;
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "FencedCode") return node.name === "Document" || node.name === "Blockquote" || node.name === "ListItem" || node.name === "BulletList" || node.name === "OrderedList";
      const info = node.node.getChild("CodeInfo");
      const lang = info ? state.sliceDoc(info.from, info.to).trim() : "";
      if (lang !== "query") return false;
      const from = state.doc.lineAt(node.from).from;
      const to = state.doc.lineAt(node.to).to;
      if (sel.from <= to && sel.to >= from) return false;
      const text = node.node.getChild("CodeText");
      const src = text ? state.sliceDoc(text.from, text.to) : "";
      decos.push(Decoration.replace({ widget: new QueryWidget(src, from), block: true }).range(from, to));
      return false;
    },
  });
  return Decoration.set(decos, true);
}

export const queryBlockField = StateField.define<DecorationSet>({
  create: (s) => buildQueryDecorations(s),
  update(value, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state) || tr.startState.field(editorLivePreviewField, false) !== tr.state.field(editorLivePreviewField, false)) return buildQueryDecorations(tr.state);
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});
