// Editor behaviour wiring: smart lists, auto-pair, indentation, folding, suggestions ([[links]],
// #tags, properties, highlight colours), vim mode, line numbers, spellcheck, RTL and keymaps.
import { Compartment, EditorState, type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, drawSelection, dropCursor, rectangularSelection, crosshairCursor, placeholder, type KeyBinding } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { foldKeymap, indentUnit, bracketMatching, codeFolding } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches, search } from "@codemirror/search";
import { vim } from "@replit/codemirror-vim";
import { markdownSupport, syntaxHighlightExtensions } from "./syntax";
import { livePreviewExtensions } from "./live-preview";
import { editorInfoField, editorLivePreviewField } from "./fields";
import { autopairExtensions } from "./autopair";
import { insertNewlineContinueList, insertListContinuationLine, indentLines, outdentLines, renumberOnChange, smartListsFacet, parseListLine } from "./lists";
import { foldServiceFor, foldIndicators, foldPlaceholder, foldStatePersistence, activeLineClass } from "./folding";
import { editorSuggestExtension } from "./suggest";
import { setupVimMappings } from "./vim";

export const compartments = {
  vim: new Compartment(),
  lineNumbers: new Compartment(),
  spellcheck: new Compartment(),
  tabs: new Compartment(),
  autopair: new Compartment(),
  fold: new Compartment(),
  lists: new Compartment(),
  direction: new Compartment(),
  plugins: new Compartment(),
  readonly: new Compartment(),
};

// ---------- keys ----------
/** Home: in a list item, go to the start of the item text first (then to the line start). */
function homeKey(view: EditorView, extend: boolean): boolean {
  const { state } = view;
  if (state.selection.ranges.length > 1) return false;
  const r = state.selection.main;
  const line = state.doc.lineAt(r.head);
  const it = parseListLine(line.text);
  if (!it) return false;
  const start = line.from + it.contentStart;
  const target = r.head === start ? line.from : start;
  view.dispatch({ selection: extend ? { anchor: r.anchor, head: target } : { anchor: target }, scrollIntoView: true, userEvent: "select" });
  return true;
}

/** Default CodeMirror keys the original doesn't bind (moving/copying lines with Alt+arrows...). */
const DROPPED_KEYS = new Set(["Alt-ArrowUp", "Alt-ArrowDown", "Shift-Alt-ArrowUp", "Shift-Alt-ArrowDown", "Mod-Enter", "Alt-l", "Mod-i", "Mod-/", "Alt-A", "Ctrl-m", "Shift-Mod-\\", "Mod-Alt-\\"]);
const baseKeymap: KeyBinding[] = defaultKeymap.filter((b) => !b.key || !DROPPED_KEYS.has(b.key));

const listKeymap: KeyBinding[] = [
  { key: "Enter", run: insertNewlineContinueList, shift: insertListContinuationLine },
  { key: "Tab", run: indentLines, shift: outdentLines },
  { key: "Mod-]", run: indentLines },
  { key: "Mod-[", run: outdentLines },
  { key: "Home", run: (v) => homeKey(v, false), shift: (v) => homeKey(v, true) },
];

// ---------- configuration ----------
export interface EditorConfig {
  vimMode: boolean;
  showLineNumber: boolean;
  spellcheck: boolean;
  useTab: boolean;
  tabSize: number;
  autoPairBrackets: boolean;
  autoPairMarkdown: boolean;
  foldHeading: boolean;
  foldIndent: boolean;
  smartIndentList: boolean;
  rightToLeft: boolean;
}

export function configFromVault(vault: any): EditorConfig {
  return {
    vimMode: !!vault.getConfig("vimMode"),
    showLineNumber: !!vault.getConfig("showLineNumber"),
    spellcheck: vault.getConfig("spellcheck") !== false,
    useTab: vault.getConfig("useTab") !== false,
    tabSize: Number(vault.getConfig("tabSize")) || 4,
    autoPairBrackets: vault.getConfig("autoPairBrackets") !== false,
    autoPairMarkdown: vault.getConfig("autoPairMarkdown") !== false,
    foldHeading: vault.getConfig("foldHeading") !== false,
    foldIndent: vault.getConfig("foldIndent") !== false,
    smartIndentList: vault.getConfig("smartIndentList") !== false,
    rightToLeft: !!vault.getConfig("rightToLeft"),
  };
}

export function configExtensions(c: EditorConfig) {
  if (c.vimMode) setupVimMappings();
  return {
    vim: c.vimMode ? vim() : [],
    lineNumbers: c.showLineNumber ? lineNumbers() : [],
    spellcheck: EditorView.contentAttributes.of({ spellcheck: c.spellcheck ? "true" : "false", autocorrect: "on", autocapitalize: "on" }),
    tabs: [EditorState.tabSize.of(c.tabSize), indentUnit.of(c.useTab ? "\t" : " ".repeat(c.tabSize))],
    autopair: autopairExtensions({ brackets: c.autoPairBrackets, markdown: c.autoPairMarkdown }),
    fold: c.foldHeading || c.foldIndent ? [foldServiceFor(c.foldHeading, c.foldIndent), codeFolding({ placeholderDOM: foldPlaceholder }), foldIndicators] : [],
    lists: smartListsFacet.of(c.smartIndentList),
    direction: c.rightToLeft ? [EditorView.contentAttributes.of({ dir: "rtl" }), EditorView.editorAttributes.of({ class: "is-rtl" })] : [],
  };
}

export function buildEditorExtensions(owner: any, c: EditorConfig, livePreview: boolean, pluginExtensions: Extension[]): Extension[] {
  const ce = configExtensions(c);
  return [
    editorInfoField.init(() => owner),
    editorLivePreviewField.init(() => livePreview),
    compartments.vim.of(ce.vim),
    markdownSupport(),
    ...syntaxHighlightExtensions,
    livePreviewExtensions(),
    history(),
    EditorState.allowMultipleSelections.of(true),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    activeLineClass,
    highlightSelectionMatches(),
    bracketMatching(),
    search({ top: true }),
    EditorView.lineWrapping,
    compartments.lineNumbers.of(ce.lineNumbers),
    compartments.spellcheck.of(ce.spellcheck),
    compartments.tabs.of(ce.tabs),
    compartments.autopair.of(ce.autopair),
    compartments.fold.of(ce.fold),
    compartments.lists.of(ce.lists),
    compartments.direction.of(ce.direction),
    foldStatePersistence,
    renumberOnChange,
    editorSuggestExtension(),
    Prec.high(keymap.of(listKeymap)),
    keymap.of([...searchKeymap, ...historyKeymap, ...foldKeymap, ...baseKeymap]),
    placeholder(""),
    compartments.plugins.of(pluginExtensions),
  ];
}
