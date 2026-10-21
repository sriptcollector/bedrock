// Every `editor:*` command (ids from docs/reference/commands.json) plus the editor context menu.
// Registered from commands/builtin.ts through registerEditorCommands(app); later registrations
// replace the older inline versions there (same ids).
import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { moveLineUp, moveLineDown, deleteLine, selectAll, addCursorAbove, addCursorBelow } from "@codemirror/commands";
import { foldAll, unfoldAll, toggleFold, foldCode, unfoldCode, foldable, foldedRanges, foldEffect, unfoldEffect, syntaxTree } from "@codemirror/language";
import { openSearchPanel } from "@codemirror/search";
import type { Command, Hotkey } from "../commands/commands";
import { Menu } from "../ui/menu";
import { Notice } from "../ui/notice";
import { promptDialog } from "../ui/modal";
import { toggleInline, toggleHighlightColor, clearFormatting, insertMarkdownLink, insertWrapped, insertTag, insertFencedBlock, insertCallout, insertTable, insertHorizontalRule, insertFootnote, HIGHLIGHT_COLORS, type InlineKind } from "./formatting";
import { toggleChecklistStatus, cycleListChecklist, toggleLinePrefix, setHeading, indentLines, outdentLines } from "./lists";
import { tableCommand, bindTableEditor, type TableOp } from "./table";
import { editorInfoField } from "./fields";
import { splitAlias } from "../../core/links";

const hk = (mods: Hotkey["modifiers"], key: string): Hotkey[] => [{ modifiers: mods, key }];

/** The link (wikilink, embed, markdown link, URL) under a document position, if any. */
export function linkAt(state: EditorState, pos: number): { href: string; external: boolean; from: number; to: number } | null {
  let n: any = syntaxTree(state).resolveInner(pos, 1);
  for (let i = 0; i < 2; i++) {
    for (let p = n; p; p = p.parent) {
      if (p.name === "WikiLink" || p.name === "Embed") {
        const text = state.sliceDoc(p.from, p.to).replace(/^!?\[\[|\]\]$/g, "");
        return { href: splitAlias(text).link, external: false, from: p.from, to: p.to };
      }
      if (p.name === "Link" || p.name === "Image") {
        const url = p.getChild("URL");
        if (!url) return null;
        let href = state.sliceDoc(url.from, url.to).replace(/^<|>$/g, "");
        const external = /^[a-z][a-z0-9+.-]*:/i.test(href);
        if (!external)
          try {
            href = decodeURI(href);
          } catch {
            /* keep */
          }
        return { href, external, from: p.from, to: p.to };
      }
      if (p.name === "URL" || p.name === "Autolink") {
        const href = state.sliceDoc(p.from, p.to).replace(/^<|>$/g, "");
        return { href, external: true, from: p.from, to: p.to };
      }
    }
    n = syntaxTree(state).resolveInner(pos, -1);
  }
  // Bare URLs are not separate nodes in every parser configuration: match the text.
  const line = state.doc.lineAt(pos);
  const re = /\bhttps?:\/\/[^\s<>()\]]+/g;
  for (const m of line.text.matchAll(re)) {
    const a = line.from + m.index!;
    if (pos >= a && pos <= a + m[0].length) return { href: m[0], external: true, from: a, to: a + m[0].length };
  }
  return null;
}

/** Fold one more / one less level of headings and lists. */
function foldLevel(view: EditorView, more: boolean): void {
  const { state } = view;
  const ranges: { from: number; to: number; depth: number }[] = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const r = foldable(state, line.from, line.to);
    if (!r) continue;
    const h = /^(#{1,6})\s/.exec(line.text);
    const depth = h ? h[1].length : 7 + (/^\s*/.exec(line.text)![0].replace(/\t/g, "    ").length >> 2);
    ranges.push({ ...r, depth });
  }
  const folded = foldedRanges(state);
  const isFolded = (r: { from: number; to: number }) => {
    let f = false;
    folded.between(r.from, r.to, (a, b) => {
      if (a === r.from && b === r.to) f = true;
    });
    return f;
  };
  if (more) {
    // Fold the deepest level that still has unfolded ranges.
    const open = ranges.filter((r) => !isFolded(r));
    if (!open.length) return;
    const level = Math.max(...open.map((r) => r.depth));
    view.dispatch({ effects: open.filter((r) => r.depth === level).map((r) => foldEffect.of({ from: r.from, to: r.to })) });
  } else {
    const shut = ranges.filter(isFolded);
    if (!shut.length) return;
    const level = Math.min(...shut.map((r) => r.depth));
    view.dispatch({ effects: shut.filter((r) => r.depth === level).map((r) => unfoldEffect.of({ from: r.from, to: r.to })) });
  }
}

export function registerEditorCommands(app: any): void {
  const add = (c: Command) => app.commands.addCommand(c);
  const activeMd = () => {
    const v = app.workspace.activeEditor;
    return v && v.editor && v.cm ? v : null;
  };
  /** editorCallback + checkCallback pair, like the original: unavailable in reading view and while the title is focused. */
  const ed = (id: string, name: string, icon: string, run: (view: any, cm: EditorView) => any, hotkeys?: Hotkey[], opts: { repeatable?: boolean; check?: (view: any, cm: EditorView) => boolean } = {}) =>
    add({
      id,
      name,
      icon,
      hotkeys,
      repeatable: opts.repeatable,
      editorCheckCallback: (checking: boolean, _editor: any, view: any) => {
        if (!view?.cm || (view.getMode?.() === "preview")) return false;
        if (view.inlineTitleEl && document.activeElement === view.inlineTitleEl) return false;
        if (opts.check && !opts.check(view, view.cm)) return false;
        if (!checking) {
          run(view, view.cm);
        }
        return true;
      },
    });
  const apply = (cm: EditorView, spec: TransactionSpec | null) => {
    if (spec) cm.dispatch({ userEvent: "input", scrollIntoView: true, ...spec });
    cm.focus();
  };
  const inline = (id: string, name: string, icon: string, kind: InlineKind, hotkeys?: Hotkey[]) => ed(id, name, icon, (_v, cm) => apply(cm, toggleInline(cm.state, kind)), hotkeys);

  inline("editor:toggle-bold", "Toggle bold", "bold", "bold", hk(["Mod"], "B"));
  inline("editor:toggle-italics", "Toggle italic", "italic", "italic", hk(["Mod"], "I"));
  inline("editor:toggle-strikethrough", "Toggle strikethrough", "strikethrough", "strikethrough");
  inline("editor:toggle-highlight", "Toggle highlight", "highlighter", "highlight");
  inline("editor:toggle-code", "Toggle code", "code", "code");
  inline("editor:toggle-inline-math", "Toggle inline math", "sigma", "math");
  inline("editor:toggle-comments", "Toggle comment", "percent", "comment", hk(["Mod"], "/"));
  for (const color of Object.keys(HIGHLIGHT_COLORS))
    ed(`editor:toggle-highlight-${color}`, `Toggle ${color} highlight`, "highlighter", (_v, cm) => apply(cm, toggleHighlightColor(cm.state, color)));
  ed("editor:clear-formatting", "Clear formatting", "eraser", (_v, cm) => apply(cm, clearFormatting(cm.state)), undefined, { check: (_v, cm) => cm.state.selection.ranges.some((r) => !r.empty) });

  ed("editor:insert-link", "Insert Markdown link", "link", (_v, cm) => apply(cm, insertMarkdownLink(cm.state)), hk(["Mod"], "K"));
  ed("editor:insert-wikilink", "Add internal link", "link-2", (v, cm) => {
    apply(cm, insertWrapped(cm.state, "[[", "]]"));
    v.openLinkSuggest?.();
  });
  ed("editor:insert-embed", "Add embed", "file-input", (v, cm) => {
    apply(cm, insertWrapped(cm.state, "![[", "]]"));
    v.openLinkSuggest?.();
  });
  ed("editor:insert-tag", "Add tag", "tag", (v, cm) => {
    apply(cm, insertTag(cm.state));
    v.openTagSuggest?.();
  });
  ed("editor:insert-callout", "Insert callout", "quote", (_v, cm) => apply(cm, insertCallout(cm.state)));
  ed("editor:insert-table", "Insert table", "table", (_v, cm) => apply(cm, insertTable(cm.state)));
  ed("editor:insert-codeblock", "Insert code block", "code-2", (_v, cm) => apply(cm, insertFencedBlock(cm.state, "```")));
  ed("editor:insert-mathblock", "Insert math block", "sigma-square", (_v, cm) => apply(cm, insertFencedBlock(cm.state, "$$")));
  ed("editor:insert-horizontal-rule", "Insert horizontal rule", "minus", (_v, cm) => apply(cm, insertHorizontalRule(cm.state)));
  ed("editor:insert-footnote", "Insert footnote", "footprints", (_v, cm) => apply(cm, insertFootnote(cm.state)));
  ed("editor:attach-file", "Insert attachment", "paperclip", (v) => v.attachFile?.());

  ed("editor:toggle-checklist-status", "Toggle checkbox status", "check-square", (_v, cm) => apply(cm, toggleChecklistStatus(cm.state)), hk(["Mod"], "L"));
  ed("editor:cycle-list-checklist", "Cycle bullet/checkbox", "list-checks", (_v, cm) => apply(cm, cycleListChecklist(cm.state)));
  ed("editor:toggle-bullet-list", "Toggle bullet list", "list", (_v, cm) => apply(cm, toggleLinePrefix(cm.state, "bullet")));
  ed("editor:toggle-numbered-list", "Toggle numbered list", "list-ordered", (_v, cm) => apply(cm, toggleLinePrefix(cm.state, "numbered")));
  ed("editor:toggle-blockquote", "Toggle blockquote", "quote", (_v, cm) => apply(cm, toggleLinePrefix(cm.state, "quote")));
  ed("editor:indent-list", "Indent list item", "indent", (_v, cm) => (indentLines(cm), cm.focus()));
  ed("editor:unindent-list", "Unindent list item", "outdent", (_v, cm) => (outdentLines(cm), cm.focus()));
  for (let h = 0; h <= 6; h++)
    ed(`editor:set-heading-${h}`, h ? `Set as heading ${h}` : "Remove heading", h ? `heading-${h}` : "heading", (_v, cm) => apply(cm, setHeading(cm.state, h)));
  ed("editor:set-heading", "Toggle heading", "heading", (v, cm) => {
    const m = new Menu();
    for (let h = 1; h <= 6; h++) m.addItem((i) => i.setTitle(`Heading ${h}`).setIcon(`heading-${h}`).onClick(() => apply(cm, setHeading(cm.state, h))));
    m.addItem((i) => i.setTitle("Body").setIcon("pilcrow").onClick(() => apply(cm, setHeading(cm.state, 0))));
    const c = cm.coordsAtPos(cm.state.selection.main.head);
    m.showAtPosition({ x: c?.left ?? 0, y: c?.bottom ?? 0 });
    void v;
  });

  ed("editor:swap-line-up", "Move line up", "arrow-up", (_v, cm) => (moveLineUp(cm), cm.focus()), undefined, { repeatable: true });
  ed("editor:swap-line-down", "Move line down", "arrow-down", (_v, cm) => (moveLineDown(cm), cm.focus()), undefined, { repeatable: true });
  ed("editor:delete-paragraph", "Delete paragraph", "trash", (_v, cm) => (deleteLine(cm), cm.focus()), hk(["Mod"], "D"), { repeatable: true });
  ed("editor:add-cursor-above", "Add cursor above", "chevrons-up", (_v, cm) => addCursorAbove(cm), undefined, { repeatable: true });
  ed("editor:add-cursor-below", "Add cursor below", "chevrons-down", (_v, cm) => addCursorBelow(cm), undefined, { repeatable: true });

  ed("editor:fold-all", "Fold all headings and lists", "chevrons-down-up", (_v, cm) => foldAll(cm));
  ed("editor:unfold-all", "Unfold all headings and lists", "chevrons-up-down", (_v, cm) => unfoldAll(cm));
  ed("editor:fold-more", "Fold more", "chevrons-down-up", (_v, cm) => foldLevel(cm, true));
  ed("editor:fold-less", "Fold less", "chevrons-up-down", (_v, cm) => foldLevel(cm, false));
  ed("editor:toggle-fold", "Toggle fold on the current line", "chevrons-right-left", (_v, cm) => toggleFold(cm) || foldCode(cm) || unfoldCode(cm));
  add({
    id: "editor:toggle-fold-properties",
    name: "Toggle fold properties in current file",
    icon: "chevrons-down-up",
    checkCallback: (checking) => {
      const v = activeMd();
      if (!v?.properties) return false;
      if (!checking) v.properties.toggleCollapsed?.();
      return true;
    },
  });

  // Links under the cursor.
  const openLinkUnderCursor = (v: any, cm: EditorView, where: false | "tab" | "split" | "window") => {
    const link = linkAt(cm.state, cm.state.selection.main.head);
    if (!link) return false;
    if (link.external) app.openExternal?.(link.href) ?? window.open(link.href);
    else app.workspace.openLinkText(link.href, v.file?.path ?? "", where);
    return true;
  };
  const hasLink = (_v: any, cm: EditorView) => !!linkAt(cm.state, cm.state.selection.main.head);
  ed("editor:follow-link", "Follow link under cursor", "link", (v, cm) => openLinkUnderCursor(v, cm, false), hk(["Alt"], "Enter"), { check: hasLink });
  ed("editor:open-link-in-new-leaf", "Open link under cursor in new tab", "file-plus", (v, cm) => openLinkUnderCursor(v, cm, "tab"), hk(["Mod"], "Enter"), { check: hasLink });
  ed("editor:open-link-in-new-split", "Open link under cursor to the right", "separator-vertical", (v, cm) => openLinkUnderCursor(v, cm, "split"), hk(["Mod", "Alt"], "Enter"), { check: hasLink });
  ed("editor:open-link-in-new-window", "Open link under cursor in new window", "picture-in-picture-2", (v, cm) => openLinkUnderCursor(v, cm, "window"), hk(["Mod", "Alt", "Shift"], "Enter"), { check: hasLink });

  ed("editor:rename-heading", "Rename this heading...", "pencil", (v, cm) => renameHeading(app, v, cm), undefined, {
    check: (_v, cm) => /^#{1,6}\s/.test(cm.state.doc.lineAt(cm.state.selection.main.head).text),
  });
  ed("editor:context-menu", "Show context menu under cursor", "menu", (v, cm) => {
    const c = cm.coordsAtPos(cm.state.selection.main.head);
    showEditorMenu(app, v, cm, { x: c?.left ?? 0, y: c?.bottom ?? 0 });
  });
  ed("editor:open-search", "Search current file", "search", (_v, cm) => openSearchPanel(cm), hk(["Mod"], "F"));
  ed("editor:open-search-replace", "Search & replace in current file", "replace", (_v, cm) => openSearchPanel(cm), hk(["Mod"], "H"));
  add({
    id: "editor:focus",
    name: "Focus on last note",
    icon: "file-text",
    callback: () => {
      const leaf = app.workspace.getMostRecentLeaf?.();
      if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
    },
  });
  for (const [dir, label] of [
    ["top", "above"],
    ["bottom", "below"],
    ["left", "to the left"],
    ["right", "to the right"],
  ] as const)
    add({ id: `editor:focus-${dir}`, name: `Focus on tab group ${label}`, icon: `arrow-${dir === "top" ? "up" : dir === "bottom" ? "down" : dir}`, callback: () => app.workspace.focusAdjacent?.(dir) });

  // Settings toggles.
  const toggleSetting = (id: string, name: string, icon: string, key: string, def: boolean) =>
    add({
      id,
      name,
      icon,
      callback: () => {
        const cur = app.vault.getConfig(key);
        app.vault.setConfig(key, !(cur === undefined || cur === null ? def : cur));
        app.workspace.updateOptions();
      },
    });
  toggleSetting("editor:toggle-line-numbers", "Toggle line numbers", "list-ordered", "showLineNumber", false);
  toggleSetting("editor:toggle-readable-line-length", "Toggle readable line length", "wrap-text", "readableLineLength", true);
  toggleSetting("editor:toggle-spellcheck", "Toggle spellcheck", "spell-check", "spellcheck", true);
  toggleSetting("editor:toggle-vim", "Toggle Vim key bindings", "keyboard", "vimMode", false);

  // Tables.
  const tableOps: [TableOp, string, string][] = [
    ["row-before", "Add row above", "arrow-up-to-line"],
    ["row-after", "Add row below", "arrow-down-to-line"],
    ["row-up", "Move row up", "arrow-up"],
    ["row-down", "Move row down", "arrow-down"],
    ["row-copy", "Duplicate row", "copy"],
    ["row-delete", "Delete row", "trash-2"],
    ["col-before", "Add column to the left", "arrow-left-to-line"],
    ["col-after", "Add column to the right", "arrow-right-to-line"],
    ["col-left", "Move column left", "arrow-left"],
    ["col-right", "Move column right", "arrow-right"],
    ["col-copy", "Duplicate column", "copy"],
    ["col-delete", "Delete column", "trash-2"],
    ["col-align-left", "Align left", "align-left"],
    ["col-align-center", "Align center", "align-center"],
    ["col-align-right", "Align right", "align-right"],
  ];
  for (const [op, label, icon] of tableOps)
    ed(`editor:table-${op}`, `Table: ${label}`, icon, (_v, cm) => tableCommand(cm, op), undefined, { check: (_v, cm) => tableCommand(cm, op, true) });

  // Download remote images into the vault and point the links at the local copies.
  add({
    id: "editor:download-attachments",
    name: "Download attachments for current file",
    icon: "download",
    checkCallback: (checking) => {
      const v = activeMd();
      if (!v?.file) return false;
      if (!checking) downloadAttachments(app, v);
      return true;
    },
  });
}

async function renameHeading(app: any, v: any, cm: EditorView): Promise<void> {
  const line = cm.state.doc.lineAt(cm.state.selection.main.head);
  const m = /^(#{1,6}\s+)(.*?)\s*#*\s*$/.exec(line.text);
  if (!m || !v.file) return;
  const old = m[2];
  const next = await promptDialog(app, { title: "Rename heading", value: old, cta: "Rename" });
  if (next == null || next === old || !next.trim()) return;
  cm.dispatch({ changes: { from: line.from + m[1].length, to: line.from + m[1].length + old.length, insert: next }, userEvent: "input" });
  await app.fileManager?.renameHeadingLinks?.(v.file, old, next);
}

async function downloadAttachments(app: any, v: any): Promise<void> {
  const cm: EditorView = v.cm;
  const text = cm.state.doc.toString();
  const re = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
  const found = [...text.matchAll(re)];
  if (!found.length) {
    new Notice("No remote attachments to download.");
    return;
  }
  let done = 0;
  for (const m of found.reverse()) {
    try {
      const res = await fetch(m[2]);
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      const ext = (/\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(m[2])?.[1] ?? "png").toLowerCase();
      const name = (decodeURIComponent(m[2].split("/").pop() ?? "image").split(/[?#]/)[0].replace(/\.[^.]+$/, "") || "image") + "." + ext;
      const path = await app.fileManager.getAvailablePathForAttachment(name, v.file.path);
      const f = await app.vault.createBinary(path, buf);
      const link = app.fileManager.generateMarkdownLink(f, v.file.path);
      const from = m.index!;
      cm.dispatch({ changes: { from, to: from + m[0].length, insert: link } });
      done++;
    } catch {
      /* skip */
    }
  }
  new Notice(done ? `Downloaded ${done} attachment${done === 1 ? "" : "s"}.` : "Couldn't download the attachments. Check your internet connection.");
}

/** Editor context menu: links, selection actions, Format / Paragraph / Insert submenus, clipboard. */
export function showEditorMenu(app: any, v: any, cm: EditorView, at: { x: number; y: number } | MouseEvent, extra?: (m: Menu) => void): Menu {
  const m = new Menu();
  const run = (spec: TransactionSpec | null) => {
    if (spec) cm.dispatch({ userEvent: "input", ...spec });
    cm.focus();
  };
  const st = () => cm.state;
  const sel = st().selection.main;
  const selected = st().sliceDoc(sel.from, sel.to);
  const link = linkAt(st(), sel.head);
  if (link) {
    if (link.external) {
      m.addItem((i) => i.setTitle("Open link in default browser").setIcon("external-link").setSection("open").onClick(() => app.openExternal?.(link.href)));
      m.addItem((i) => i.setTitle("Copy URL").setIcon("copy").setSection("open").onClick(() => navigator.clipboard.writeText(link.href)));
    } else {
      m.addItem((i) => i.setTitle("Open link").setIcon("file").setSection("open").onClick(() => app.workspace.openLinkText(link.href, v.file?.path ?? "", false)));
      m.addItem((i) => i.setTitle("Open in new tab").setIcon("file-plus").setSection("open").onClick(() => app.workspace.openLinkText(link.href, v.file?.path ?? "", "tab")));
      m.addItem((i) => i.setTitle("Open to the right").setIcon("separator-vertical").setSection("open").onClick(() => app.workspace.openLinkText(link.href, v.file?.path ?? "", "split")));
      m.addItem((i) => i.setTitle("Open in new window").setIcon("picture-in-picture-2").setSection("open").onClick(() => app.workspace.openLinkText(link.href, v.file?.path ?? "", "window")));
    }
  }
  m.addItem((i) =>
    i
      .setTitle("Add link")
      .setIcon("link")
      .setSection("insert")
      .onClick(() => {
        run(insertWrapped(st(), "[[", "]]"));
        v.openLinkSuggest?.();
      }),
  );
  m.addItem((i) => i.setTitle("Add external link").setIcon("link-2").setSection("insert").onClick(() => run(insertMarkdownLink(st()))));
  if (selected) {
    const q = selected.length > 40 ? selected.slice(0, 40) + "…" : selected;
    m.addItem((i) =>
      i
        .setTitle(`Search for “${q}”`)
        .setIcon("search")
        .setSection("selection")
        .onClick(() => {
          app.commands.executeCommandById("global-search:open");
          app.workspace.trigger("search:query", selected);
          const s = app.internalPlugins?.getPluginById?.("global-search")?.instance;
          s?.openGlobalSearch?.(selected);
        }),
    );
    if (app.commands.findCommand("note-composer:split-file"))
      m.addItem((i) => i.setTitle("Extract current selection...").setIcon("scissors").setSection("selection").onClick(() => app.commands.executeCommandById("note-composer:split-file")));
  }
  m.addItem((i) => {
    i.setTitle("Format").setIcon("type").setSection("format");
    const s = i.setSubmenu();
    const fmt = (title: string, icon: string, kind: InlineKind) => s.addItem((x) => x.setTitle(title).setIcon(icon).onClick(() => run(toggleInline(st(), kind))));
    fmt("Bold", "bold", "bold");
    fmt("Italic", "italic", "italic");
    fmt("Strikethrough", "strikethrough", "strikethrough");
    fmt("Highlight", "highlighter", "highlight");
    s.addSeparator();
    fmt("Code", "code", "code");
    fmt("Math", "sigma", "math");
    fmt("Comment", "percent", "comment");
    s.addSeparator();
    s.addItem((x) => x.setTitle("Clear formatting").setIcon("eraser").onClick(() => run(clearFormatting(st()))));
  });
  const inTable = tableCommand(cm, "row-after", true);
  m.addItem((i) => {
    i.setTitle("Paragraph").setIcon("pilcrow").setSection("format").setDisabled(inTable);
    if (inTable) return;
    const s = i.setSubmenu();
    s.addItem((x) => x.setTitle("Bullet list").setIcon("list").onClick(() => run(toggleLinePrefix(st(), "bullet"))));
    s.addItem((x) => x.setTitle("Numbered list").setIcon("list-ordered").onClick(() => run(toggleLinePrefix(st(), "numbered"))));
    s.addItem((x) => x.setTitle("Task list").setIcon("check-square").onClick(() => run(toggleChecklistStatus(st()))));
    s.addSeparator();
    for (let h = 1; h <= 6; h++) s.addItem((x) => x.setTitle(`Heading ${h}`).setIcon(`heading-${h}`).onClick(() => run(setHeading(st(), h))));
    s.addItem((x) => x.setTitle("Body").setIcon("pilcrow").onClick(() => run(setHeading(st(), 0))));
    s.addSeparator();
    s.addItem((x) => x.setTitle("Quote").setIcon("quote").onClick(() => run(toggleLinePrefix(st(), "quote"))));
  });
  m.addItem((i) => {
    i.setTitle("Insert").setIcon("plus").setSection("format").setDisabled(inTable);
    if (inTable) return;
    const s = i.setSubmenu();
    s.addItem((x) => x.setTitle("Footnote").setIcon("footprints").onClick(() => run(insertFootnote(st()))));
    s.addItem((x) => x.setTitle("Table").setIcon("table").onClick(() => run(insertTable(st()))));
    s.addItem((x) => x.setTitle("Callout").setIcon("quote").onClick(() => run(insertCallout(st()))));
    s.addItem((x) => x.setTitle("Horizontal rule").setIcon("minus").onClick(() => run(insertHorizontalRule(st()))));
    s.addSeparator();
    s.addItem((x) => x.setTitle("Code block").setIcon("code-2").onClick(() => run(insertFencedBlock(st(), "```"))));
    s.addItem((x) => x.setTitle("Math block").setIcon("sigma-square").onClick(() => run(insertFencedBlock(st(), "$$"))));
    if (app.commands.findCommand("bases:insert")) s.addItem((x) => x.setTitle("New base").setIcon("table-2").onClick(() => app.commands.executeCommandById("bases:insert")));
  });
  const hasSel = st().selection.ranges.some((r) => !r.empty);
  m.addItem((i) => i.setTitle("Cut").setIcon("scissors").setSection("clipboard").setDisabled(!hasSel).onClick(() => (cm.focus(), document.execCommand("cut"))));
  m.addItem((i) => i.setTitle("Copy").setIcon("copy").setSection("clipboard").setDisabled(!hasSel).onClick(() => (cm.focus(), document.execCommand("copy"))));
  m.addItem((i) =>
    i
      .setTitle("Paste")
      .setIcon("clipboard-paste")
      .setSection("clipboard")
      .onClick(() => {
        cm.focus();
        if (!document.execCommand("paste")) navigator.clipboard.readText().then((t) => cm.dispatch(cm.state.replaceSelection(t), { userEvent: "input.paste" }));
      }),
  );
  m.addItem((i) =>
    i
      .setTitle("Paste as plain text")
      .setIcon("clipboard-type")
      .setSection("clipboard")
      .onClick(async () => {
        cm.focus();
        const t = await navigator.clipboard.readText();
        cm.dispatch(cm.state.replaceSelection(t), { userEvent: "input.paste" });
      }),
  );
  m.addItem((i) => i.setTitle("Select all").setIcon("text-select").setSection("clipboard").onClick(() => (cm.focus(), selectAll(cm))));
  extra?.(m);
  app.workspace.trigger("editor-menu", m, v.editor, v);
  if (at instanceof MouseEvent) m.showAtMouseEvent(at);
  else m.showAtPosition(at);
  return m;
}

bindTableEditor({ showMenu: showEditorMenu, editorInfoField });
