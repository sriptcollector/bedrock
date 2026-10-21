// Built-in commands with Obsidian's command ids (so hotkeys.json from Obsidian keeps working)
// and their default hotkeys. The full default list can grow here; the registry is the contract.
import type { App } from "../app";
import type { Command, Hotkey } from "./commands";
import { MarkdownView } from "../editor/markdown-view";
import { WorkspaceTabs } from "../workspace/items";
import { CommandPalette, QuickSwitcher } from "../views/switcher";
import { foldAll, unfoldAll, toggleFold } from "@codemirror/language";
import { openSearchPanel } from "@codemirror/search";
import { Notice } from "../ui/notice";
import { EditorSelection } from "@codemirror/state";

const hk = (mods: Hotkey["modifiers"], key: string): Hotkey[] => [{ modifiers: mods, key }];

function wrapSelection(view: MarkdownView, before: string, after = before): void {
  const cm = view.cm;
  cm.dispatch(
    cm.state.changeByRange((r) => {
      const text = cm.state.sliceDoc(r.from, r.to);
      const pre = cm.state.sliceDoc(r.from - before.length, r.from);
      const post = cm.state.sliceDoc(r.to, r.to + after.length);
      if (pre === before && post === after) {
        return {
          changes: [
            { from: r.from - before.length, to: r.from, insert: "" },
            { from: r.to, to: r.to + after.length, insert: "" },
          ],
          range: EditorSelection.range(r.from - before.length, r.to - before.length),
        };
      }
      if (text.startsWith(before) && text.endsWith(after) && text.length >= before.length + after.length) {
        const inner = text.slice(before.length, text.length - after.length);
        return { changes: { from: r.from, to: r.to, insert: inner }, range: EditorSelection.range(r.from, r.from + inner.length) };
      }
      return {
        changes: { from: r.from, to: r.to, insert: before + text + after },
        range: EditorSelection.range(r.from + before.length, r.to + before.length),
      };
    }),
  );
  cm.focus();
}

function mapLines(view: MarkdownView, fn: (line: string) => string): void {
  const cm = view.cm;
  const changes: { from: number; to: number; insert: string }[] = [];
  const seen = new Set<number>();
  for (const r of cm.state.selection.ranges) {
    for (let n = cm.state.doc.lineAt(r.from).number; n <= cm.state.doc.lineAt(r.to).number; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const l = cm.state.doc.line(n);
      const next = fn(l.text);
      if (next !== l.text) changes.push({ from: l.from, to: l.to, insert: next });
    }
  }
  if (changes.length) cm.dispatch({ changes });
  cm.focus();
}

export function registerBuiltinCommands(app: App): void {
  const add = (c: Command) => app.commands.addCommand(c);
  const md = () => app.workspace.getActiveViewOfType(MarkdownView) as MarkdownView | null;
  const editorCmd = (id: string, name: string, run: (v: MarkdownView) => any, hotkeys?: Hotkey[], icon?: string) =>
    add({
      id,
      name,
      icon,
      hotkeys,
      checkCallback: (checking) => {
        const v = md();
        if (!v || v.getMode() !== "source") return false;
        if (!checking) run(v);
        return true;
      },
    });

  add({ id: "app:open-settings", name: "Open settings", icon: "settings", hotkeys: hk(["Mod"], ","), callback: () => app.setting.open() });
  add({ id: "command-palette:open", name: "Command palette: Open command palette", icon: "terminal", hotkeys: hk(["Mod"], "P"), callback: () => new CommandPalette(app).open() });
  add({ id: "switcher:open", name: "Quick switcher: Open quick switcher", icon: "file-search", hotkeys: hk(["Mod"], "O"), callback: () => new QuickSwitcher(app).open() });
  add({
    id: "file-explorer:new-file",
    name: "Create new note",
    icon: "square-pen",
    hotkeys: hk(["Mod"], "N"),
    callback: async () => {
      const active = app.workspace.getActiveFile();
      const folder = app.fileManager.getNewFileParent(active?.path ?? "");
      const f = await app.fileManager.createNewMarkdownFile(folder, "Untitled");
      await app.workspace.getLeaf(false).openFile(f, { active: true, state: { mode: "source" }, eState: { rename: "all" } });
    },
  });
  add({
    id: "file-explorer:new-file-in-new-pane",
    name: "Create note in new tab",
    icon: "file-plus",
    callback: async () => {
      const active = app.workspace.getActiveFile();
      const f = await app.fileManager.createNewMarkdownFile(app.fileManager.getNewFileParent(active?.path ?? ""), "Untitled");
      await app.workspace.getLeaf("tab").openFile(f, { active: true, eState: { rename: "all" } });
    },
  });
  add({
    id: "workspace:new-tab",
    name: "New tab",
    icon: "plus",
    hotkeys: hk(["Mod"], "T"),
    callback: () => app.workspace.setActiveLeaf(app.workspace.getLeaf("tab"), { focus: true }),
  });
  add({
    id: "workspace:close",
    name: "Close current tab",
    icon: "x",
    hotkeys: hk(["Mod"], "W"),
    checkCallback: (checking) => {
      const leaf = app.workspace.activeLeaf;
      if (!leaf) return false;
      if (!checking) {
        if (leaf.pinned) new Notice("This tab is pinned. Unpin it to close it.");
        else {
          app.closedTabs.push(leaf.getViewState());
          leaf.detach();
        }
      }
      return true;
    },
  });
  add({
    id: "workspace:undo-close-pane",
    name: "Undo close tab",
    icon: "rotate-ccw",
    hotkeys: hk(["Mod", "Shift"], "T"),
    checkCallback: (checking) => {
      if (!app.closedTabs.length) return false;
      if (!checking) {
        const st = app.closedTabs.pop()!;
        app.workspace.getLeaf("tab").setViewState({ ...st, active: true });
      }
      return true;
    },
  });
  add({ id: "workspace:split-vertical", name: "Split right", icon: "columns-2", callback: () => app.workspace.activeLeaf && app.workspace.duplicateLeaf(app.workspace.activeLeaf, "split", "vertical") });
  add({ id: "workspace:split-horizontal", name: "Split down", icon: "rows-2", callback: () => app.workspace.activeLeaf && app.workspace.duplicateLeaf(app.workspace.activeLeaf, "split", "horizontal") });
  add({ id: "workspace:toggle-pin", name: "Toggle pin", icon: "pin", callback: () => app.workspace.activeLeaf?.togglePinned() });
  add({
    id: "workspace:toggle-stacked-tabs",
    name: "Toggle stacked tabs",
    icon: "layers",
    callback: () => {
      const t = app.workspace.activeLeaf?.parent;
      if (t instanceof WorkspaceTabs) t.setStacked(!t.isStacked);
    },
  });
  add({ id: "app:go-back", name: "Navigate back", icon: "arrow-left", hotkeys: hk(["Mod", "Alt"], "ArrowLeft"), callback: () => app.workspace.activeLeaf?.history.back() });
  add({ id: "app:go-forward", name: "Navigate forward", icon: "arrow-right", hotkeys: hk(["Mod", "Alt"], "ArrowRight"), callback: () => app.workspace.activeLeaf?.history.forward() });
  add({ id: "app:toggle-left-sidebar", name: "Toggle left sidebar", icon: "panel-left", callback: () => app.workspace.leftSplit.toggle() });
  add({ id: "app:toggle-right-sidebar", name: "Toggle right sidebar", icon: "panel-right", callback: () => app.workspace.rightSplit.toggle() });
  add({ id: "theme:toggle-light-dark", name: "Use light/dark mode (toggle)", icon: "sun-moon", callback: () => app.customCss.setBaseTheme(app.customCss.isDark() ? "moonstone" : "obsidian") });
  add({ id: "app:reload", name: "Reload app without saving", icon: "refresh-cw", callback: () => location.reload() });
  add({ id: "app:toggle-devtools", name: "Toggle developer tools", icon: "bug", hotkeys: hk(["Mod", "Shift"], "I"), callback: () => app.native.windowControl("toggle-devtools") });
  add({ id: "app:open-vault", name: "Open another folder as vault", icon: "folder-open", callback: () => app.native.openVaultDialog() });
  add({ id: "bedrock:import-vault", name: "Import an existing vault into this vault", icon: "folder-input", callback: () => app.importVaultFlow() });
  add({
    id: "file-explorer:open",
    name: "Files: Show file explorer",
    icon: "folder-closed",
    callback: () => app.workspace.ensureSideLeaf("file-explorer", "left", { reveal: true }),
  });
  add({
    id: "file-explorer:reveal-active-file",
    name: "Files: Reveal current file in navigation",
    icon: "locate",
    checkCallback: (checking) => {
      const f = app.workspace.getActiveFile();
      if (!f) return false;
      if (!checking) {
        const leaf = app.workspace.getLeavesOfType("file-explorer")[0];
        if (leaf) {
          app.workspace.revealLeaf(leaf);
          (leaf.view as any).revealInFolder(f);
        }
      }
      return true;
    },
  });
  add({
    id: "app:delete-file",
    name: "Delete current file",
    icon: "trash-2",
    checkCallback: (checking) => {
      const f = app.workspace.getActiveFile();
      if (!f) return false;
      if (!checking) app.fileManager.promptForDeletion(f);
      return true;
    },
  });
  add({
    id: "workspace:edit-file-title",
    name: "Rename file",
    icon: "pencil",
    hotkeys: hk([], "F2"),
    checkCallback: (checking) => {
      const v = md();
      if (!v?.file) return false;
      if (!checking) v.focusInlineTitle(true);
      return true;
    },
  });
  add({
    id: "markdown:toggle-preview",
    name: "Toggle reading view",
    icon: "book-open",
    hotkeys: hk(["Mod"], "E"),
    checkCallback: (checking) => {
      const v = md();
      if (!v) return false;
      if (!checking) v.toggleMode();
      return true;
    },
  });
  add({
    id: "editor:toggle-source",
    name: "Toggle Live Preview/Source mode",
    icon: "code",
    checkCallback: (checking) => {
      const v = md();
      if (!v) return false;
      if (!checking) v.toggleSource();
      return true;
    },
  });
  add({
    id: "editor:save-file",
    name: "Save current file",
    icon: "save",
    hotkeys: hk(["Mod"], "S"),
    checkCallback: (checking) => {
      const v = md();
      if (!v) return false;
      if (!checking) v.save();
      return true;
    },
  });
  // Tabs by number / next / previous.
  for (let i = 1; i <= 8; i++)
    add({
      id: `workspace:goto-tab-${i}`,
      name: `Go to tab #${i}`,
      hotkeys: hk(["Mod"], String(i)),
      callback: () => {
        const t = app.workspace.activeLeaf?.parent as WorkspaceTabs | undefined;
        const leaf = t?.children[i - 1];
        if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
      },
    });
  add({
    id: "workspace:goto-last-tab",
    name: "Go to last tab",
    hotkeys: hk(["Mod"], "9"),
    callback: () => {
      const t = app.workspace.activeLeaf?.parent as WorkspaceTabs | undefined;
      const leaf = t?.children[t.children.length - 1];
      if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
    },
  });
  const cycle = (d: number) => {
    const leaf = app.workspace.activeLeaf;
    const t = leaf?.parent as WorkspaceTabs | undefined;
    if (!leaf || !t) return;
    const i = (t.children.indexOf(leaf) + d + t.children.length) % t.children.length;
    app.workspace.setActiveLeaf(t.children[i], { focus: true });
  };
  add({ id: "workspace:next-tab", name: "Go to next tab", hotkeys: hk(["Ctrl"], "Tab").concat(hk(["Ctrl"], "PageDown")), callback: () => cycle(1) });
  add({ id: "workspace:previous-tab", name: "Go to previous tab", hotkeys: hk(["Ctrl", "Shift"], "Tab").concat(hk(["Ctrl"], "PageUp")), callback: () => cycle(-1) });

  // Editing commands.
  editorCmd("editor:toggle-bold", "Toggle bold", (v) => wrapSelection(v, "**"), hk(["Mod"], "B"), "bold");
  editorCmd("editor:toggle-italics", "Toggle italics", (v) => wrapSelection(v, "*"), hk(["Mod"], "I"), "italic");
  editorCmd("editor:toggle-strikethrough", "Toggle strikethrough", (v) => wrapSelection(v, "~~"), undefined, "strikethrough");
  editorCmd("editor:toggle-highlight", "Toggle highlight", (v) => wrapSelection(v, "=="), undefined, "highlighter");
  editorCmd("editor:toggle-code", "Toggle code", (v) => wrapSelection(v, "`"), undefined, "code");
  editorCmd("editor:toggle-inline-math", "Toggle math", (v) => wrapSelection(v, "$"), undefined, "sigma");
  editorCmd("editor:toggle-comments", "Toggle comment", (v) => wrapSelection(v, "%%"), hk(["Mod"], "/"), "percent");
  editorCmd(
    "editor:insert-link",
    "Insert Markdown link",
    (v) => {
      const sel = v.editor.getSelection();
      v.editor.replaceSelection(`[${sel}]()`);
      const c = v.editor.getCursor();
      v.editor.setCursor({ line: c.line, ch: c.ch - 1 });
    },
    hk(["Mod"], "K"),
    "link",
  );
  editorCmd(
    "editor:insert-wikilink",
    "Add internal link",
    (v) => {
      const sel = v.editor.getSelection();
      v.editor.replaceSelection(`[[${sel}]]`);
      if (!sel) {
        const c = v.editor.getCursor();
        v.editor.setCursor({ line: c.line, ch: c.ch - 2 });
      }
    },
    undefined,
    "link-2",
  );
  editorCmd("editor:insert-embed", "Add embed", (v) => v.editor.replaceSelection(`![[${v.editor.getSelection()}]]`), undefined, "file-input");
  editorCmd("editor:insert-horizontal-rule", "Insert horizontal rule", (v) => v.editor.replaceSelection("\n---\n"), undefined, "minus");
  editorCmd(
    "editor:toggle-checklist-status",
    "Toggle checkbox status",
    (v) =>
      mapLines(v, (l) => {
        const m = l.match(/^(\s*(?:[-*+]|\d+[.)])\s+)\[(.)\](.*)$/);
        if (m) return `${m[1]}[${m[2] === " " ? "x" : " "}]${m[3]}`;
        const b = l.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/);
        if (b) return `${b[1]}[ ] ${b[2]}`;
        const ws = l.match(/^\s*/)![0];
        return `${ws}- [ ] ${l.slice(ws.length)}`;
      }),
    hk(["Mod"], "Enter"),
    "check-square",
  );
  editorCmd(
    "editor:toggle-bullet-list",
    "Toggle bullet list",
    (v) =>
      mapLines(v, (l) => {
        const m = l.match(/^(\s*)[-*+]\s+(.*)$/);
        if (m) return m[1] + m[2];
        const ws = l.match(/^\s*/)![0];
        return `${ws}- ${l.slice(ws.length).replace(/^\d+[.)]\s+/, "")}`;
      }),
    undefined,
    "list",
  );
  editorCmd(
    "editor:toggle-numbered-list",
    "Toggle numbered list",
    (v) => {
      let n = 0;
      mapLines(v, (l) => {
        const m = l.match(/^(\s*)\d+[.)]\s+(.*)$/);
        if (m) return m[1] + m[2];
        const ws = l.match(/^\s*/)![0];
        return `${ws}${++n}. ${l.slice(ws.length).replace(/^[-*+]\s+/, "")}`;
      });
    },
    undefined,
    "list-ordered",
  );
  editorCmd("editor:toggle-blockquote", "Toggle blockquote", (v) => mapLines(v, (l) => (/^>\s?/.test(l) ? l.replace(/^>\s?/, "") : "> " + l)), undefined, "quote");
  for (let h = 0; h <= 6; h++)
    editorCmd(
      `editor:set-heading${h ? "-" + h : ""}`,
      h ? `Set as heading ${h}` : "Remove heading",
      (v) => mapLines(v, (l) => (h ? "#".repeat(h) + " " : "") + l.replace(/^#{1,6}\s+/, "")),
      undefined,
      "heading",
    );
  editorCmd("editor:open-search", "Search current file", (v) => openSearchPanel(v.cm), hk(["Mod"], "F"), "search");
  editorCmd("editor:open-search-replace", "Search & replace in current file", (v) => openSearchPanel(v.cm), hk(["Mod"], "H"), "replace");
  editorCmd("editor:fold-all", "Fold all headings and lists", (v) => foldAll(v.cm), undefined, "chevrons-down-up");
  editorCmd("editor:unfold-all", "Unfold all headings and lists", (v) => unfoldAll(v.cm), undefined, "chevrons-up-down");
  editorCmd("editor:toggle-fold", "Toggle fold on the current line", (v) => toggleFold(v.cm), undefined, "chevrons-right-left");
  editorCmd("editor:toggle-vim", "Toggle Vim key bindings", () => {
    app.vault.setConfig("vimMode", !app.vault.getConfig("vimMode"));
    app.workspace.updateOptions();
  });
  editorCmd("editor:toggle-line-numbers", "Toggle line numbers", () => {
    app.vault.setConfig("showLineNumber", !app.vault.getConfig("showLineNumber"));
    app.workspace.updateOptions();
  });
  editorCmd("editor:toggle-readable-line-length", "Toggle readable line length", () => {
    app.vault.setConfig("readableLineLength", !app.vault.getConfig("readableLineLength"));
    app.workspace.updateOptions();
  });
}
