// In-file search and replace bar (editor:open-search / editor:open-search-replace): our own panel
// for @codemirror/search with the original's layout and class names (.document-search-container).
import type { EditorView, Panel } from "@codemirror/view";
import { SearchQuery, closeSearchPanel, openSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, selectMatches, setSearchQuery } from "@codemirror/search";
import { setIcon } from "../dom/icons";

/** Open the bar (or switch it between search and search-and-replace when it's already open). */
export function openDocumentSearch(view: EditorView, replace: boolean): boolean {
  searchPanelMode.replace = replace;
  const open = view.dom.querySelector<HTMLElement>(".document-search-container");
  if (open) {
    open.toggleClass("mod-replace-mode", replace);
    open.querySelector<HTMLElement>(".document-replace")?.toggle(replace);
    const input = open.querySelector<HTMLInputElement>(".document-search-input input");
    input?.focus();
    input?.select();
    return true;
  }
  return openSearchPanel(view);
}

/** Replace row shown? Set by the open-search-replace command before opening the panel. */
export const searchPanelMode = { replace: false };

function countMatches(view: EditorView, q: SearchQuery): { current: number; total: number } {
  if (!q.valid || !q.search) return { current: 0, total: 0 };
  const sel = view.state.selection.main;
  let total = 0;
  let current = 0;
  const cur = q.getCursor(view.state) as any;
  for (let r = cur.next(); !r.done; r = cur.next()) {
    total++;
    if (r.value.from === sel.from && r.value.to === sel.to) current = total;
    if (total > 9999) break;
  }
  return { current, total };
}

export function createSearchPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "document-search-container";
  const row = dom.createDiv("document-search");
  const box = row.createDiv("search-input-container document-search-input");
  const input = box.createEl("input", { attr: { type: "search", placeholder: "Find...", spellcheck: "false", "main-field": "true" } });
  const countEl = box.createDiv("document-search-count");
  const btns = row.createDiv("document-search-buttons");
  const button = (parent: HTMLElement, icon: string, label: string, run: () => void) => {
    const b = parent.createEl("button", { cls: "clickable-icon document-search-button", attr: { "aria-label": label } });
    setIcon(b, icon);
    b.addEventListener("click", (e) => {
      e.preventDefault();
      run();
      update();
    });
    return b;
  };
  button(btns, "arrow-up", "Previous\nShift + F3", () => findPrevious(view));
  button(btns, "arrow-down", "Next\nF3", () => findNext(view));
  button(btns, "text-select", "Find all\nAlt + Enter", () => selectMatches(view));
  const close = row.createDiv({ cls: "clickable-icon document-search-close-button", attr: { "aria-label": "Exit search" } });
  setIcon(close, "x");
  close.addEventListener("click", () => {
    closeSearchPanel(view);
    view.focus();
  });
  const rep = dom.createDiv("document-replace");
  const repInput = rep.createEl("input", { cls: "document-replace-input", attr: { type: "text", placeholder: "Replace...", spellcheck: "false" } });
  const repBtns = rep.createDiv("document-replace-buttons");
  button(repBtns, "replace", "Replace\nEnter", () => replaceNext(view));
  button(repBtns, "replace-all", "Replace all\nCtrl + Alt + Enter", () => replaceAll(view));

  const commit = () => {
    const q = new SearchQuery({ search: input.value, replace: repInput.value, caseSensitive: false });
    if (!q.eq(getSearchQuery(view.state))) view.dispatch({ effects: setSearchQuery.of(q) });
  };
  const update = () => {
    const { current, total } = countMatches(view, getSearchQuery(view.state));
    countEl.setText(`${current} / ${total}`);
    countEl.toggle(!!input.value);
  };
  input.addEventListener("input", () => {
    commit();
    update();
  });
  repInput.addEventListener("input", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "F3") {
      e.preventDefault();
      if (e.altKey) selectMatches(view);
      else if (e.shiftKey) findPrevious(view);
      else findNext(view);
      update();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPanel(view);
      view.focus();
    }
  });
  repInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.ctrlKey && e.altKey) replaceAll(view);
      else replaceNext(view);
      update();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPanel(view);
      view.focus();
    }
  });
  const setMode = () => {
    dom.toggleClass("mod-replace-mode", searchPanelMode.replace);
    rep.toggle(searchPanelMode.replace);
  };
  return {
    dom,
    top: true,
    mount() {
      const q = getSearchQuery(view.state);
      input.value = q.search;
      repInput.value = q.replace;
      setMode();
      input.focus();
      input.select();
      update();
    },
    update(u) {
      if (u.docChanged || u.selectionSet || u.transactions.some((t) => t.effects.some((e) => e.is(setSearchQuery)))) {
        const q = getSearchQuery(u.state);
        if (document.activeElement !== input && q.search !== input.value) input.value = q.search;
        update();
      }
      setMode();
    },
  };
}
