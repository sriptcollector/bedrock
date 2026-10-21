// Small DOM builders shared by the sidebar panes: nav header buttons, the filter box, tree items
// with collapse chevrons, and opening a file at a position.
import { setIcon } from "../../dom/icons";
import { Keymap } from "../../commands/keymap";
import { showFileMenu } from "./file-menu";
import type { TFile } from "../../vault/files";
import { FILE_DRAG_TYPE } from "../../workspace/dnd";

export function navButton(parent: HTMLElement, icon: string, label: string, onClick: (e: MouseEvent) => any): HTMLElement {
  const b = parent.createDiv({ cls: "clickable-icon nav-action-button", attr: { "aria-label": label } });
  setIcon(b, icon);
  b.addEventListener("click", (e) => onClick(e));
  return b;
}

export interface SearchBox {
  containerEl: HTMLElement;
  inputEl: HTMLInputElement;
  clearEl: HTMLElement;
  setValue(v: string): void;
  getValue(): string;
}

/** `.search-input-container` with an input and a clear button. */
export function searchBox(parent: HTMLElement, onChange: (v: string) => void, placeholder = "Search..."): SearchBox {
  const containerEl = parent.createDiv("search-input-container");
  const inputEl = containerEl.createEl("input", { attr: { enterkeyhint: "search", type: "search", spellcheck: "false", placeholder } }) as HTMLInputElement;
  const clearEl = containerEl.createDiv({ cls: "search-input-clear-button", attr: { "aria-label": "Clear search" } });
  const sync = () => clearEl.toggle(!!inputEl.value);
  inputEl.addEventListener("input", () => {
    sync();
    onChange(inputEl.value);
  });
  clearEl.addEventListener("click", () => {
    inputEl.value = "";
    sync();
    onChange("");
    inputEl.focus();
  });
  sync();
  return {
    containerEl,
    inputEl,
    clearEl,
    setValue: (v) => {
      inputEl.value = v;
      sync();
    },
    getValue: () => inputEl.value,
  };
}

/** Set the collapsed state of a `.tree-item` and its chevron. */
export function setCollapsed(item: HTMLElement, collapsed: boolean): void {
  item.toggleClass("is-collapsed", collapsed);
  item.querySelector(":scope > .tree-item-self > .collapse-icon")?.toggleClass("is-collapsed", collapsed);
}

export function collapseIcon(parent: HTMLElement, tag: "div" | "span" = "div"): HTMLElement {
  const el = parent.createEl(tag, { cls: "tree-item-icon collapse-icon" });
  setIcon(el, "right-triangle");
  return el;
}

/** Header row of a collapsible pane section ("Linked mentions 5"). */
export function sectionHeader(parent: HTMLElement, title: string, onToggle: () => void): { el: HTMLElement; flair: HTMLElement; icon: HTMLElement } {
  const el = parent.createDiv({ cls: "tree-item-self is-clickable", attr: { "aria-label": "Click to collapse", "data-tooltip-position": "left" } });
  const icon = collapseIcon(el, "span");
  el.createDiv({ cls: "tree-item-inner", text: title });
  const flair = el.createDiv("tree-item-flair-outer").createSpan("tree-item-flair");
  el.addEventListener("click", () => onToggle());
  return { el, flair, icon };
}

/** Open a file, optionally selecting a range (file offsets) in the editor. */
export async function openFileAt(app: any, file: TFile, e: MouseEvent | null, range?: [number, number], text?: string): Promise<void> {
  const leaf = app.workspace.getLeaf(e ? Keymap.isModEvent(e) : false);
  let eState: any = undefined;
  if (range && text !== undefined) {
    const from = offsetToPos(text, range[0]);
    const to = offsetToPos(text, range[1]);
    eState = { line: from.line, cursor: { from, to } };
  }
  await leaf.openFile(file, { active: true });
  if (!eState) return;
  const view = leaf.view;
  if (view?.getViewType?.() !== "markdown") return;
  if (view.getMode?.() === "preview" || !view.editor) {
    view.setEphemeralState?.({ line: eState.line });
    return;
  }
  setTimeout(() => {
    try {
      view.editor.setSelection(eState.cursor.from, eState.cursor.to);
      view.editor.scrollIntoView?.({ from: eState.cursor.from, to: eState.cursor.to }, true);
    } catch {
      view.setEphemeralState?.({ line: eState.line });
    }
  }, 30);
}

export function offsetToPos(text: string, offset: number): { line: number; ch: number } {
  let line = 0;
  let last = 0;
  for (let i = 0; i < offset && i < text.length; i++)
    if (text.charCodeAt(i) === 10) {
      line++;
      last = i + 1;
    }
  return { line, ch: offset - last };
}

/** Make a row draggable as a file (drop into notes to link, into folders to move). */
export function makeFileDraggable(app: any, el: HTMLElement, file: TFile): void {
  el.setAttr("draggable", "true");
  el.addEventListener("dragstart", (e) => {
    e.dataTransfer!.setData(FILE_DRAG_TYPE, file.path);
    e.dataTransfer!.setData("text/plain", app.fileManager.generateMarkdownLink(file, app.workspace.getActiveFile()?.path ?? ""));
    e.dataTransfer!.effectAllowed = "all";
  });
}

/** Context menu for a file row in a sidebar pane (open items + whatever plugins add). */
export function fileContextMenu(app: any, e: MouseEvent, file: TFile, source: string, leaf?: any): void {
  showFileMenu(app, e, file, source, leaf);
}

/** Trigger a page preview for a sidebar row (hover-link event). */
export function hoverLink(app: any, e: MouseEvent, source: string, targetEl: HTMLElement, linktext: string, parent: any, state?: any): void {
  app.workspace.trigger("hover-link", { event: e, source, hoverParent: parent, targetEl, linktext, sourcePath: "", state });
}
