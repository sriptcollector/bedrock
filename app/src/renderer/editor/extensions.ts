// Editor behaviour: smart lists, auto-pair, tab indent, folding, [[link]] and #tag autocomplete,
// vim mode, line numbers, spellcheck, and the base keymaps.
import { Compartment, EditorSelection, EditorState, type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, drawSelection, dropCursor, highlightActiveLine, rectangularSelection, crosshairCursor, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentMore, indentLess, indentWithTab } from "@codemirror/commands";
import { foldGutter, foldKeymap, foldService, indentUnit, bracketMatching, indentOnInput } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap, type CompletionContext, type CompletionResult, type Completion } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches, search } from "@codemirror/search";
import { insertNewlineContinueMarkup, deleteMarkupBackward } from "@codemirror/lang-markdown";
import { vim } from "@replit/codemirror-vim";
import { markdownSupport, syntaxHighlightExtensions } from "./syntax";
import { livePreviewExtensions } from "./live-preview";
import { editorInfoField, editorLivePreviewField } from "./fields";
import { prepareFuzzySearch } from "../ui/search";
import { stripHeadingForLink } from "../../core/links";

export const compartments = {
  vim: new Compartment(),
  lineNumbers: new Compartment(),
  spellcheck: new Compartment(),
  tabs: new Compartment(),
  autopair: new Compartment(),
  fold: new Compartment(),
  plugins: new Compartment(),
  readonly: new Compartment(),
};

// ---------- folding: headings and list items ----------
const headingFold = foldService.of((state, lineStart, lineEnd) => {
  const line = state.doc.lineAt(lineStart);
  const m = line.text.match(/^(#{1,6})\s/);
  if (m) {
    const level = m[1].length;
    let end = line.to;
    let inFence = false;
    for (let n = line.number + 1; n <= state.doc.lines; n++) {
      const l = state.doc.line(n);
      if (/^\s{0,3}(```|~~~)/.test(l.text)) inFence = !inFence;
      const hm = !inFence && l.text.match(/^(#{1,6})\s/);
      if (hm && hm[1].length <= level) break;
      if (l.text.trim()) end = l.to;
    }
    return end > lineEnd ? { from: lineEnd, to: end } : null;
  }
  const lm = line.text.match(/^(\s*)([-*+]|\d+[.)])\s/);
  if (lm) {
    const indent = lm[1].replace(/\t/g, "    ").length;
    let end = line.to;
    for (let n = line.number + 1; n <= state.doc.lines; n++) {
      const l = state.doc.line(n);
      if (!l.text.trim()) continue;
      const ind = (l.text.match(/^\s*/)![0]).replace(/\t/g, "    ").length;
      if (ind <= indent) break;
      end = l.to;
    }
    return end > lineEnd ? { from: lineEnd, to: end } : null;
  }
  return null;
});

// ---------- markdown auto-pair: wrap the selection with * _ = ~ ` ----------
const wrapChars = new Set(["*", "_", "=", "~", "`", "$"]);
const markdownAutopair = EditorView.inputHandler.of((view, from, to, text) => {
  if (!wrapChars.has(text)) return false;
  const sel = view.state.selection;
  if (sel.ranges.every((r) => r.empty)) return false;
  view.dispatch(
    view.state.changeByRange((r) => {
      if (r.empty) return { changes: { from: r.from, insert: text }, range: EditorSelection.cursor(r.from + 1) };
      const w = text === "=" || text === "~" ? text + text : text;
      return {
        changes: [
          { from: r.from, insert: w },
          { from: r.to, insert: w },
        ],
        range: EditorSelection.range(r.from + w.length, r.to + w.length),
      };
    }),
  );
  return true;
});

// ---------- tab indent for lists ----------
const listIndentKeymap = [
  {
    key: "Tab",
    run: (view: EditorView) => {
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      if (/^\s*([-*+]|\d+[.)])\s/.test(line.text) || !view.state.selection.main.empty) return indentMore(view);
      return false;
    },
    shift: indentLess,
  },
];

// ---------- autocomplete: [[links]] and #tags ----------
function linkSource(ctx: CompletionContext): CompletionResult | null {
  const owner = ctx.state.field(editorInfoField, false);
  const app = owner?.app;
  if (!app) return null;
  const m = ctx.matchBefore(/!?\[\[[^\]\[\n]*$/);
  if (!m) return null;
  const open = m.text.indexOf("[[") + 2;
  const query = m.text.slice(open);
  const from = m.from + open;
  const sourcePath = owner.file?.path ?? "";
  const after = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2);
  const close = after === "]]" ? "" : "]]";
  // Heading / block suggestions: [[Note#
  const hashAt = query.indexOf("#");
  if (hashAt >= 0) {
    const notePart = query.slice(0, hashAt);
    const file = notePart ? app.metadataCache.getFirstLinkpathDest(notePart, sourcePath) : owner.file;
    const cache = file ? app.metadataCache.getFileCache(file) : null;
    const q = query.slice(hashAt + 1);
    const opts: Completion[] = (cache?.headings ?? []).map((h: any) => ({
      label: h.heading,
      detail: "H" + h.level,
      apply: (view: EditorView, _c: Completion, f: number, t: number) => {
        const text = stripHeadingForLink(h.heading) + close;
        view.dispatch({ changes: { from: f, to: t, insert: text }, selection: { anchor: f + text.length } });
      },
    }));
    return { from: from + hashAt + 1, options: opts, filter: !!q };
  }
  const fuzzy = prepareFuzzySearch(query);
  const scored: { c: Completion; s: number }[] = [];
  for (const s of app.metadataCache.getLinkSuggestions()) {
    const name = s.alias ?? (s.file ? (s.file.extension === "md" ? s.file.path.replace(/\.md$/, "") : s.file.path) : s.path);
    const r = query ? fuzzy(name) : { score: 0 };
    if (!r) continue;
    const file = s.file;
    const linktext = file ? app.metadataCache.fileToLinktext(file, sourcePath, true) : s.path;
    scored.push({
      s: r.score + (s.file ? 0 : -5),
      c: {
        label: s.alias ?? (file ? (file.extension === "md" ? file.basename : file.name) : s.path),
        detail: s.alias ? `→ ${file?.basename ?? ""}` : file && file.parent && !file.parent.isRoot() ? file.parent.path : file ? "" : "Not created yet",
        type: file ? "file" : "unresolved",
        apply: (view: EditorView, _c: Completion, f: number, t: number) => {
          const text = linktext + (s.alias ? "|" + s.alias : "") + close;
          view.dispatch({ changes: { from: f, to: t, insert: text }, selection: { anchor: f + text.length } });
        },
      },
    });
  }
  scored.sort((a, b) => b.s - a.s);
  return { from, options: scored.slice(0, 100).map((x) => x.c), filter: false };
}

function tagSource(ctx: CompletionContext): CompletionResult | null {
  const app = ctx.state.field(editorInfoField, false)?.app;
  if (!app) return null;
  const m = ctx.matchBefore(/(?:^|[\s(])#[\p{L}\p{N}_\-\/]*$/u);
  if (!m) return null;
  const hash = m.text.indexOf("#");
  const from = m.from + hash;
  const q = m.text.slice(hash + 1).toLowerCase();
  if (!q && !ctx.explicit) return null;
  const tags = Object.entries(app.metadataCache.getTags() as Record<string, number>)
    .filter(([t]) => t.toLowerCase().includes(q))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50);
  return { from, options: tags.map(([t, n]) => ({ label: t, detail: String(n), type: "tag", apply: t + " " })), filter: false };
}

// ---------- the full extension list ----------
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
  };
}

export function configExtensions(c: EditorConfig) {
  return {
    vim: c.vimMode ? vim() : [],
    lineNumbers: c.showLineNumber ? lineNumbers() : [],
    spellcheck: EditorView.contentAttributes.of({ spellcheck: c.spellcheck ? "true" : "false", autocorrect: "on", autocapitalize: "on" }),
    tabs: [EditorState.tabSize.of(c.tabSize), indentUnit.of(c.useTab ? "\t" : " ".repeat(c.tabSize))],
    autopair: [c.autoPairBrackets ? closeBrackets() : [], c.autoPairMarkdown ? markdownAutopair : []],
    fold: c.foldHeading || c.foldIndent ? [headingFold, foldGutter({ openText: "▾", closedText: "▸" })] : [],
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
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    bracketMatching(),
    indentOnInput(),
    search({ top: true }),
    EditorView.lineWrapping,
    compartments.lineNumbers.of(ce.lineNumbers),
    compartments.spellcheck.of(ce.spellcheck),
    compartments.tabs.of(ce.tabs),
    compartments.autopair.of(ce.autopair),
    compartments.fold.of(ce.fold),
    autocompletion({ override: [linkSource, tagSource], icons: false, activateOnTyping: true, closeOnBlur: true }),
    Prec.high(keymap.of([{ key: "Enter", run: insertNewlineContinueMarkup }, { key: "Backspace", run: deleteMarkupBackward }, ...listIndentKeymap])),
    keymap.of([...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...defaultKeymap, indentWithTab]),
    placeholder(""),
    compartments.plugins.of(pluginExtensions),
  ];
}
