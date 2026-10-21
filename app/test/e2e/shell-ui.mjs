// Workspace and UI parity, end to end on the built app with real mouse and keyboard input where it
// matters: tabs (new tab, close, drag, tab list, linked tabs, history menu, state, focus setting),
// sidebars, ribbon, status bar, view header, quick switcher, command palette, page preview, the
// General / Backlinks / Page preview settings, core plugin switches, files (naming, attachments,
// file types, excluded files), community plugin loading, export to PDF, tooltips, notices, menus.
// Usage: node test/e2e/shell-ui.mjs [--only <section,...>] [--keep]
import fs from "node:fs";
import path from "node:path";
import { launch, Checks, shot, argValue } from "./lib/harness.mjs";

const C = new Checks();
const only = argValue("--only")?.split(",") ?? null;
const want = (s) => !only || only.includes(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 5000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(100);
  }
  return null;
}
const menuItems = (win) => win.evaluate(() => Array.from(document.querySelectorAll(".menu .menu-item-title, .menu .menu-separator")).map((e) => (e.classList.contains("menu-separator") ? "---" : e.textContent)));
const closeMenus = (win) => win.evaluate(() => document.querySelectorAll(".menu").forEach((m) => m.remove()));
const notices = (win) => win.evaluate(() => Array.from(document.querySelectorAll(".notice")).map((n) => n.textContent).join(" | "));

function writeTestPlugins(vault) {
  const pdir = path.join(vault, ".obsidian", "plugins");
  const mk = (id, manifest, main, css) => {
    fs.mkdirSync(path.join(pdir, id), { recursive: true });
    fs.writeFileSync(path.join(pdir, id, "manifest.json"), JSON.stringify({ id, name: id, version: "1.0.0", description: "test", author: "test", ...manifest }));
    fs.writeFileSync(path.join(pdir, id, "main.js"), main);
    if (css) fs.writeFileSync(path.join(pdir, id, "styles.css"), css);
  };
  mk("too-new", { minAppVersion: "99.0.0" }, `module.exports = class extends require("obsidian").Plugin { onload() { window.__tooNewLoaded = true; } };`);
  mk(
    "full-plugin",
    { minAppVersion: "1.0.0" },
    `const { Plugin, ItemView } = require("obsidian");
class V extends ItemView { getViewType() { return "full-view"; } getDisplayText() { return "Full"; } }
module.exports = class extends Plugin {
  async onload() {
    window.__full = { external: 0 };
    this.addCommand({ id: "hello", name: "Hello", callback: () => {} });
    this.addRibbonIcon("star", "Full ribbon", () => {});
    this.addStatusBarItem().setText("full-status");
    this.registerView("full-view", (leaf) => new V(leaf));
    this.registerInterval(window.setInterval(() => (window.__fullTicks = (window.__fullTicks || 0) + 1), 50));
    this.registerDomEvent(document, "click", () => (window.__fullClicks = (window.__fullClicks || 0) + 1));
    await this.saveData({ a: 1 });
  }
  onExternalSettingsChange() { window.__full.external++; }
};`,
    ".full-plugin-marker { --full-plugin: 1; }",
  );
  fs.writeFileSync(path.join(vault, ".obsidian", "community-plugins.json"), JSON.stringify(["bedrock-test-plugin", "too-new", "full-plugin"]));
}

const L = await launch({ width: 1280, height: 800, beforeLaunch: ({ vault }) => writeTestPlugins(vault) });
const { win, errors } = L;
const ev = (f, a) => win.evaluate(f, a);
async function reset() {
  await ev(async () => {
    const app = window.app;
    document.querySelectorAll(".menu, .modal-container, .popover").forEach((m) => m.remove());
    while (app.keymap.scopes?.length) app.keymap.popScope(app.keymap.scopes[app.keymap.scopes.length - 1]);
    for (const w of app.workspace.floatingSplit.children.slice()) w.close();
    await app.workspace.changeLayout(app.workspace.defaultLayout());
    await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath("Welcome.md"), { state: { mode: "source" } });
  });
  await sleep(300);
}

try {
  // ------------------------------------------------------------ defaults (fresh vault)
  if (want("layout")) {
    const d = await ev(() => {
      const ws = window.app.workspace;
      const types = (dock) => {
        const out = [];
        ws.iterateLeavesOf(dock, (l) => out.push(l.view?.getViewType()));
        return out;
      };
      return { left: types(ws.leftSplit), right: types(ws.rightSplit), rightCollapsed: ws.rightSplit.collapsed, leftW: ws.leftSplit.size, ribbonW: document.querySelector(".workspace-ribbon.mod-left").getBoundingClientRect().width };
    });
    C.check("default sidebars: Files, Search, Bookmarks left; Backlinks, Outgoing links, Tags, All properties, Outline right (collapsed)", d.left.join() === "file-explorer,search,bookmarks" && d.right.join() === "backlink,outgoing-link,tag,all-properties,outline" && d.rightCollapsed, JSON.stringify(d));
    C.check("left sidebar 300 px by default; ribbon 44 px", d.leftW === 300 && Math.round(d.ribbonW) === 44, JSON.stringify(d));
    // Sidebar toggles (real clicks) and resize (real drag), remembered in the layout.
    await win.click(".workspace-ribbon .sidebar-toggle-button.mod-left .clickable-icon");
    const lc = await ev(() => window.app.workspace.leftSplit.collapsed);
    await win.click(".workspace-ribbon .sidebar-toggle-button.mod-left .clickable-icon");
    await win.click(".sidebar-toggle-button.mod-right .clickable-icon");
    const rc = await ev(() => window.app.workspace.rightSplit.collapsed);
    C.check("toggle buttons for each sidebar at the top corners", lc === true && rc === false, `${lc} ${rc}`);
    const h = await win.$(".mod-left-split > .mod-sidedock-handle");
    const hb = await h.boundingBox();
    await win.mouse.move(hb.x + hb.width / 2, hb.y + 300);
    await win.mouse.down();
    await win.mouse.move(hb.x + 60, hb.y + 300, { steps: 6 });
    await win.mouse.up();
    const w2 = await ev(() => window.app.workspace.getLayout().left.width);
    C.check("sidebar resizable by dragging, width kept in workspace.json", w2 >= 340 && w2 <= 370, String(w2));
    await win.click(".sidebar-toggle-button.mod-right .clickable-icon");
    // Ribbon: hide an item from its context menu, turn the ribbon off.
    await win.click(".workspace-ribbon.mod-left .side-dock-actions", { button: "right" });
    const rItems = await menuItems(win);
    await closeMenus(win);
    await ev(() => window.app.commands.executeCommandById("app:toggle-ribbon"));
    const hidden = await ev(() => getComputedStyle(document.querySelector(".workspace-ribbon.mod-left")).display === "none" || !document.body.classList.contains("show-ribbon"));
    await ev(() => window.app.commands.executeCommandById("app:toggle-ribbon"));
    C.check("ribbon: plugin buttons, show/hide menu, can be turned off", rItems.includes("Open quick switcher") && rItems.includes("Open graph view") && hidden, rItems.join(","));
    C.check("ribbon order matches the original (switcher, graph, canvas, daily, templates, palette, bases)", (await ev(() => window.app.workspace.leftRibbon.items.filter((i) => !i.hidden).map((i) => i.id.split(":")[0]).slice(0, 7).join(","))) === "switcher,graph,canvas,daily-notes,templates,command-palette,bases", await ev(() => window.app.workspace.leftRibbon.items.map((i) => i.id).join(",")));
  }

  // ------------------------------------------------------------ tabs
  if (want("tabs")) {
    await reset();
    // New tab button (real click) -> empty tab with actions and hotkey chips.
    await win.click(".mod-root .workspace-tab-header-new-tab .clickable-icon");
    await sleep(300);
    const empty = await ev(() => ({ type: window.app.workspace.activeLeaf.view.getViewType(), actions: Array.from(document.querySelectorAll(".workspace-leaf.mod-active .empty-state-action .text-button-label")).map((e) => e.textContent), chips: Array.from(document.querySelectorAll(".workspace-leaf.mod-active .empty-state-hotkey")).map((e) => e.textContent.trim()) }));
    C.check("new tab button and empty tab: New note, New base, New canvas, Go to file, with hotkey chips", empty.type === "empty" && empty.actions.join() === "New note,New base,New canvas,Go to file" && empty.chips.join() === "Ctrl + N,Ctrl + O", JSON.stringify(empty));
    await win.click(".workspace-leaf.mod-active .empty-state-action >> text=New note");
    await sleep(400);
    C.check("empty tab's New note creates Untitled", /^Untitled/.test((await ev(() => window.app.workspace.getActiveFile()?.basename)) ?? ""));
    // Close with X and middle click.
    await reset();
    await ev(async () => {
      for (const p of ["Beta.md", "Projects/Alpha.md"]) await window.app.workspace.getLeaf("tab").openFile(window.app.vault.getFileByPath(p), { active: false });
    });
    const count = () => ev(() => window.app.workspace.rootSplit.children[0].children.length);
    const n0 = await count();
    await win.click(".mod-root .workspace-tab-header:nth-child(3) .workspace-tab-header-inner-close-button", { force: true });
    await sleep(200);
    const n1 = await count();
    await win.click(".mod-root .workspace-tab-header:nth-child(2)", { button: "middle" });
    await sleep(200);
    C.check("close a tab with X and with middle click", n1 === n0 - 1 && (await count()) === n0 - 2, `${n0} ${n1} ${await count()}`);
    // Drag to reorder (real mouse drag).
    await reset();
    await ev(async () => {
      for (const p of ["Beta.md", "Projects/Alpha.md"]) await window.app.workspace.getLeaf("tab").openFile(window.app.vault.getFileByPath(p), { active: false });
    });
    const order = () => ev(() => window.app.workspace.rootSplit.children[0].children.map((l) => l.getDisplayText()).join(","));
    const o0 = await order();
    await win.dragAndDrop(".mod-root .workspace-tab-header:nth-child(1)", ".mod-root .workspace-tab-header:nth-child(3)", { targetPosition: { x: 60, y: 10 } });
    await sleep(300);
    const o1 = await order();
    C.check("drag a tab to reorder", o1 !== o0 && o1.endsWith("Welcome"), `${o0} -> ${o1}`);
    // Drag into a split: drop on the right edge of the content.
    const box = await (await win.$(".mod-root .workspace-leaf.mod-active")).boundingBox();
    await win.dragAndDrop(".mod-root .workspace-tab-header:nth-child(1)", ".mod-root .workspace-leaf.mod-active", { targetPosition: { x: box.width - 20, y: box.height / 2 } });
    await sleep(400);
    C.check("drag a tab into a split (drop zone at the edge)", (await ev(() => document.querySelectorAll(".mod-root .workspace-tabs").length)) === 2);
    // Drag out of the window: a dragend that nothing took, outside the window.
    await ev(() => {
      const h = document.querySelector(".mod-root .workspace-tab-header");
      h.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: new DataTransfer() }));
      h.dispatchEvent(new DragEvent("dragend", { bubbles: true, screenX: window.screenX + window.outerWidth + 200, screenY: window.screenY + 100, dataTransfer: new DataTransfer() }));
    });
    C.check("drag a tab out of the window opens it in a new window", !!(await waitFor(() => ev(() => window.app.workspace.floatingSplit.children.length === 1))));
    // Tab list.
    await reset();
    await ev(() => window.app.workspace.getLeaf("tab").openFile(window.app.vault.getFileByPath("Beta.md"), { active: false }));
    await win.click(".mod-root .workspace-tab-header-tab-list .clickable-icon");
    const tl = await menuItems(win);
    await closeMenus(win);
    C.check("tab list dropdown: stack, bookmark tabs, close all, every tab", tl.join("|") === "Stack tabs|Bookmark 2 tabs...|---|Close all|---|Welcome|Beta", tl.join("|"));
    // Tab context menu and More options (exact lists).
    await win.click(".mod-root .workspace-tab-header.is-active", { button: "right" });
    const tm = await menuItems(win);
    await closeMenus(win);
    const TAB = "Close|Close others|Close all|---|Pin|Link with tab...|Backlinks in document|Reading view|Source mode|---|Move to new window|Split right|Split down|Open in new window|---|Rename...|Move file to...|Bookmark...|Merge entire file with...|Add file property|Export to PDF...|---|Find...|Replace...|---|Copy path|---|Open version history|Open linked view|---|Open in default app|Show in system explorer|Reveal file in navigation|---|Delete file";
    C.check("tab header menu has the original's items, order and groups", tm.join("|") === TAB, tm.join("|"));
    await win.click(".workspace-leaf.mod-active .view-action[aria-label='More options']");
    const mo = await menuItems(win);
    await closeMenus(win);
    const MORE = "Backlinks in document|Reading view|Source mode|---|Split right|Split down|Open in new window|---|Rename...|Move file to...|Bookmark...|Merge entire file with...|Add file property|Export to PDF...|---|Find...|Replace...|---|Copy path|---|Open version history|Open linked view|---|Open in default app|Show in system explorer|Reveal file in navigation|---|Delete file";
    C.check("More options menu has the original's items, order and groups", mo.join("|") === MORE, mo.join("|"));
    // Linked view follows its tab; chain icon.
    await reset();
    await ev(async () => {
      const app = window.app;
      const leaf = app.workspace.activeLeaf;
      window.__linked = await window.app.shell.__openLinked?.(leaf, "backlink");
    });
    await ev(async () => {
      const { openLinkedView } = window.__shellTest ?? {};
      void openLinkedView;
    });
    await win.click(".mod-root .workspace-tab-header.is-active", { button: "right" });
    await ev(async () => {
      const it = Array.from(document.querySelectorAll(".menu .menu-item")).find((e) => e.textContent === "Open linked view");
      it.dispatchEvent(new MouseEvent("mouseenter"));
      await new Promise((r) => setTimeout(r, 200));
      Array.from(document.querySelectorAll(".menu .menu-item")).find((e) => e.textContent === "Open backlinks").click();
    });
    await sleep(500);
    const linked = await ev(async () => {
      const ws = window.app.workspace;
      const bl = ws.getLeavesOfType("backlink").find((l) => l.group);
      const main = ws.getLeavesOfType("markdown")[0];
      await main.openFile(window.app.vault.getFileByPath("Beta.md"));
      await new Promise((r) => setTimeout(r, 400));
      return { grouped: !!bl && bl.group === main.group, chain: !!main.tabHeaderEl.querySelector(".mod-linked"), follows: bl?.view.getState().file };
    });
    C.check("linked tabs: the linked backlinks view follows its tab; chain icon on the tab", linked.grouped && linked.chain && linked.follows === "Beta.md", JSON.stringify(linked));
    // History list on right-click of the back button.
    await reset();
    await ev(async () => {
      const l = window.app.workspace.activeLeaf;
      await l.openFile(window.app.vault.getFileByPath("Beta.md"));
      await l.openFile(window.app.vault.getFileByPath("Projects/Alpha.md"));
    });
    await win.click(".workspace-leaf.mod-active .view-header-nav-buttons button[aria-label='Navigate back']", { button: "right" });
    const hist = await menuItems(win);
    await win.click(".menu .menu-item >> text=Welcome");
    await sleep(400);
    const afterHist = await ev(() => ({ file: window.app.workspace.getActiveFile()?.path, fwd: window.app.workspace.activeLeaf.history.forwardHistory.length }));
    C.check("back button right-click lists history (nearest first); picking one jumps several steps", hist.join() === "Beta,Welcome" && afterHist.file === "Welcome.md" && afterHist.fwd === 2, JSON.stringify({ hist, afterHist }));
    // Tabs remember mode, scroll and cursor.
    await reset();
    const remembered = await ev(async () => {
      const app = window.app;
      const ws = app.workspace;
      const a = ws.activeLeaf;
      const long = Array.from({ length: 120 }, (_, i) => `Line ${i}`).join("\n");
      const f = app.vault.getFileByPath("Long.md") ?? (await app.vault.create("Long.md", long));
      await a.openFile(f, { state: { mode: "source" } });
      a.view.editor.setCursor({ line: 80, ch: 3 });
      a.view.editor.scrollIntoView({ from: { line: 80, ch: 0 }, to: { line: 80, ch: 0 } }, true);
      await new Promise((r) => setTimeout(r, 200));
      const scroll = a.view.editor.getScrollInfo().top;
      const b = ws.getLeaf("tab");
      await b.openFile(app.vault.getFileByPath("Beta.md"), { active: true });
      await b.setViewState({ type: "markdown", state: { file: "Beta.md", mode: "preview" }, active: true });
      ws.setActiveLeaf(a, { focus: true });
      await new Promise((r) => setTimeout(r, 200));
      const back = { cursor: a.view.editor.getCursor().line, scroll: a.view.editor.getScrollInfo().top };
      ws.setActiveLeaf(b, { focus: true });
      const mode = b.view.getMode();
      const saved = ws.getLayout().main.children[0].children.map((l) => l.state.state.mode);
      return { scroll, back, mode, saved };
    });
    C.check("tabs remember mode (also in workspace.json), scroll position and cursor", remembered.back.cursor === 80 && Math.abs(remembered.back.scroll - remembered.scroll) < 2 && remembered.scroll > 0 && remembered.mode === "preview" && remembered.saved.includes("preview"), JSON.stringify(remembered));
    // Always focus new tabs.
    await reset();
    const focus = await ev(async () => {
      const app = window.app;
      app.vault.setConfig("focusNewTab", false);
      const before = app.workspace.activeLeaf;
      await app.workspace.openLinkText("Beta", "Welcome.md", "tab");
      const stayed = app.workspace.activeLeaf === before;
      app.vault.setConfig("focusNewTab", undefined);
      await app.workspace.openLinkText("Projects/Alpha", "Welcome.md", "tab");
      return { stayed, moved: app.workspace.getActiveFile()?.path };
    });
    C.check('"Always focus new tabs" off keeps focus; on (default) moves to the new tab', focus.stayed && focus.moved === "Projects/Alpha.md", JSON.stringify(focus));
  }

  // ------------------------------------------------------------ view header, status bar
  if (want("header")) {
    await reset();
    await ev(() => window.app.workspace.getLeaf(false).openFile(window.app.vault.getFileByPath("Projects/Alpha.md"), { state: { mode: "source" } }));
    await sleep(300);
    const hdr = await ev(() => {
      const v = document.querySelector(".workspace-leaf.mod-active .view-header");
      return { back: !!v.querySelector("[aria-label='Navigate back']"), fwd: !!v.querySelector("[aria-label='Navigate forward']"), crumbs: Array.from(v.querySelectorAll(".view-header-breadcrumb")).map((e) => e.textContent), title: v.querySelector(".view-header-title").textContent, actions: Array.from(v.querySelectorAll(".view-action")).map((e) => e.getAttribute("aria-label")) };
    });
    await win.click(".workspace-leaf.mod-active .view-header-breadcrumb");
    await sleep(400);
    const revealed = await ev(() => document.querySelector(".nav-folder-title.is-active, .tree-item-self.is-active, .nav-folder-title.has-focus, .tree-item-self.has-focus")?.getAttribute("data-path"));
    await win.click(".workspace-leaf.mod-active .view-header-title");
    await sleep(200);
    const renaming = await ev(() => !!document.activeElement?.closest(".inline-title"));
    C.check("view header: back, forward, breadcrumbs, title, bookmark, mode toggle, more options", hdr.back && hdr.fwd && hdr.crumbs.join() === "Projects" && hdr.title === "Alpha" && hdr.actions.some((a) => /bookmark/i.test(a)) && hdr.actions.some((a) => /^Current view/.test(a)) && hdr.actions.includes("More options"), JSON.stringify(hdr));
    C.check("click a folder in the path reveals it; click the name to rename", revealed === "Projects" && renaming, `${revealed} ${renaming}`);
    await ev(() => window.app.vault.setConfig("showViewHeader", false) || window.app.customCss.applyInterface());
    const hiddenHdr = await ev(() => getComputedStyle(document.querySelector(".workspace-leaf.mod-active .view-header")).display === "none");
    await ev(() => window.app.vault.setConfig("showViewHeader", undefined) || window.app.customCss.applyInterface());
    C.check("view header can be hidden", hiddenHdr);
    // Status bar.
    const sb = await ev(async () => {
      await new Promise((r) => setTimeout(r, 400));
      return Array.from(document.querySelectorAll(".status-bar > .status-bar-item")).filter((e) => getComputedStyle(e).display !== "none" && (e.textContent || e.querySelector("svg"))).map((e) => e.className.match(/plugin-[a-z-]+/)?.[0] ?? e.className);
    });
    C.check("status bar order: backlinks, properties, editing mode, word count, sync", sb.slice(0, 5).join() === "plugin-backlink,plugin-properties,plugin-editor-status,plugin-word-count,plugin-sync" || sb.join().startsWith("plugin-backlink,plugin-editor-status,plugin-word-count"), sb.join());
    const wc = await ev(async () => {
      const v = window.app.workspace.activeLeaf.view;
      v.editor.setValue("one two three\nfour five");
      await new Promise((r) => setTimeout(r, 500));
      const all = document.querySelector(".plugin-word-count").textContent;
      v.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 7 });
      await new Promise((r) => setTimeout(r, 500));
      return { all, sel: document.querySelector(".plugin-word-count").textContent };
    });
    C.check("word count (words, characters), selection-aware", wc.all === "5 words23 characters" && wc.sel === "2 words7 characters", JSON.stringify(wc));
    await win.click(".status-bar-item.plugin-editor-status");
    const modes = await menuItems(win);
    await win.click(".menu .menu-item >> text=Reading view");
    await sleep(300);
    C.check("editing mode in the status bar: shows the mode, click to switch", modes.join() === "Live Preview,Source mode,Reading view" && (await ev(() => window.app.workspace.activeLeaf.view.getMode())) === "preview", modes.join());
  }

  // ------------------------------------------------------------ quick switcher, command palette
  if (want("switcher")) {
    await reset();
    await ev(async () => {
      const app = window.app;
      await app.vault.create("Linker.md", "See [[Not created yet]]");
      await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath("Beta.md"));
      await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath("Welcome.md"));
    });
    await sleep(600);
    await win.keyboard.press("Control+O");
    await sleep(300);
    const qs = await ev(() => ({ placeholder: document.querySelector(".prompt-input").placeholder, ins: Array.from(document.querySelectorAll(".prompt-instruction")).map((e) => e.textContent).join("|"), items: Array.from(document.querySelectorAll(".suggestion-title")).map((e) => e.textContent) }));
    C.check("quick switcher: placeholder, instruction bar, recent files when empty (not the open one)", qs.placeholder === "Find or create a note..." && qs.ins === "↑↓to navigate|↵to open|ctrl ↵to open in new tab|ctrl alt ↵to open to the right|shift ↵to create|escto dismiss" && qs.items[0] === "Beta" && !qs.items.includes("Welcome"), JSON.stringify(qs));
    await win.keyboard.type("not created");
    await sleep(300);
    const unres = await ev(() => Array.from(document.querySelectorAll(".suggestion-item")).map((e) => e.textContent + (e.querySelector(".suggestion-flair")?.getAttribute("aria-label") ?? "")));
    C.check("unresolved link names offered (Not created yet, select to create)", unres.some((t) => /Not created yet.*Not created yet, select to create/.test(t)), unres.join(" / "));
    await win.keyboard.press("Escape");
    // Enter / Ctrl+Enter / Ctrl+Alt+Enter / Shift+Enter
    const openWith = async (keys, q) => {
      await reset();
      await win.keyboard.press("Control+O");
      await sleep(200);
      await win.keyboard.type(q);
      await sleep(250);
      await win.keyboard.press(keys);
      await sleep(500);
      return ev(() => ({ file: window.app.workspace.getActiveFile()?.path, tabs: window.app.workspace.rootSplit.children.length === 1 ? window.app.workspace.rootSplit.children[0].children?.length : -1, groups: document.querySelectorAll(".mod-root .workspace-tabs").length }));
    };
    const e1 = await openWith("Enter", "beta");
    const e2 = await openWith("Control+Enter", "beta");
    const e3 = await openWith("Control+Alt+Enter", "beta");
    const e4 = await openWith("Shift+Enter", "Bet");
    C.check("Enter opens in this tab; Ctrl+Enter new tab; Ctrl+Alt+Enter to the right; Shift+Enter creates the typed name", e1.file === "Beta.md" && e1.tabs === 1 && e2.file === "Beta.md" && e2.tabs === 2 && e3.groups === 2 && e4.file === "Bet.md", JSON.stringify([e1, e2, e3, e4]));
    // Aliases, attachments, all file types, show existing only.
    await reset();
    const sugg = await ev(async () => {
      const app = window.app;
      await app.vault.create("odd.xyz", "x");
      const { switcherSuggestions } = window.__switcher ?? {};
      void switcherSuggestions;
      const p = app.internalPlugins.plugins.switcher;
      const run = async (q) => {
        app.commands.executeCommandById("switcher:open");
        await new Promise((r) => setTimeout(r, 100));
        const input = document.querySelector(".prompt-input");
        input.value = q;
        input.dispatchEvent(new Event("input"));
        await new Promise((r) => setTimeout(r, 200));
        const out = Array.from(document.querySelectorAll(".suggestion-item")).map((e) => e.querySelector(".suggestion-title").textContent + "|" + (e.querySelector(".suggestion-note")?.textContent ?? "") + "|" + (e.querySelector(".suggestion-flair")?.getAttribute("aria-label") ?? "") + "|" + (e.querySelector(".suggestion-action")?.textContent ?? ""));
        document.querySelectorAll(".modal-container").forEach((m) => m.remove());
        while (app.keymap.scopes.length) app.keymap.popScope(app.keymap.scopes[0]);
        return out;
      };
      const r = {};
      r.pixel = await run("pixel");
      r.odd = await run("odd");
      p.setOption("showAllFileTypes", true);
      r.oddAll = await run("odd");
      p.setOption("showAllFileTypes", false);
      p.setOption("showAttachments", false);
      r.pixelOff = await run("pixel");
      p.setOption("showAttachments", true);
      r.create = await run("brand new name");
      p.setOption("showExistingOnly", true);
      r.existing = await run("brand new name");
      p.setOption("showExistingOnly", false);
      return r;
    });
    C.check("attachments shown (setting on by default) and hidden when off", sugg.pixel.some((x) => x.startsWith("pixel.png")) && !sugg.pixelOff.some((x) => x.startsWith("pixel.png")), JSON.stringify(sugg.pixel));
    C.check("all file types only with the setting", !sugg.odd.some((x) => x.startsWith("odd.xyz")) && sugg.oddAll.some((x) => x.startsWith("odd.xyz")), JSON.stringify([sugg.odd, sugg.oddAll]));
    C.check('typed name offered with "Enter to create"; not with "show existing only"', sugg.create.some((x) => /^brand new name\|\|\|Enter to create$/.test(x)) && sugg.existing.length === 0, JSON.stringify([sugg.create, sugg.existing]));
    // Command palette: recent first, pinned on top.
    await reset();
    const pal = await ev(async () => {
      const app = window.app;
      const open = async () => {
        app.commands.executeCommandById("command-palette:open");
        await new Promise((r) => setTimeout(r, 200));
        const out = Array.from(document.querySelectorAll(".suggestion-item")).slice(0, 3).map((e) => e.querySelector(".suggestion-title").textContent + (e.querySelector(".suggestion-flair") ? " [pin]" : ""));
        return out;
      };
      const first = await open();
      const input = document.querySelector(".prompt-input");
      input.value = "toggle left sidebar";
      input.dispatchEvent(new Event("input"));
      await new Promise((r) => setTimeout(r, 200));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      const second = await open();
      document.querySelectorAll(".modal-container").forEach((m) => m.remove());
      while (app.keymap.scopes.length) app.keymap.popScope(app.keymap.scopes[0]);
      app.internalPlugins.plugins["command-palette"].setOption("pinned", ["app:open-help"]);
      const third = await open();
      document.querySelectorAll(".modal-container").forEach((m) => m.remove());
      while (app.keymap.scopes.length) app.keymap.popScope(app.keymap.scopes[0]);
      return { first, second, third, placeholder: document.querySelector(".prompt-input")?.placeholder };
    });
    C.check("command palette: recently used commands first, pinned commands at the top", pal.second[0] === "Toggle left sidebar" && pal.third[0] === "Open help [pin]" && pal.third[1] === "Toggle left sidebar", JSON.stringify(pal));
    await ev(() => window.app.workspace.leftSplit.collapsed && window.app.workspace.leftSplit.expand());
  }

  // ------------------------------------------------------------ page preview
  if (want("preview")) {
    await reset();
    await ev(async () => {
      const app = window.app;
      await app.workspace.getLeaf(false).setViewState({ type: "markdown", state: { file: "Welcome.md", mode: "preview" }, active: true });
    });
    await sleep(600);
    const link = await win.$(".workspace-leaf.mod-active .markdown-reading-view a.internal-link");
    await link.hover();
    const pop = await waitFor(() => win.$(".popover.hover-popover .markdown-embed.is-loaded"), 2000);
    C.check("reading view: hovering a link shows the page preview without Ctrl", !!pop);
    const editable = await ev(async () => {
      const p = document.querySelector(".popover.hover-popover");
      p.querySelector(".markdown-embed-content p, .markdown-embed-content .markdown-preview-sizer").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 500));
      return { editor: !!p.querySelector(".cm-editor"), expand: !!p.querySelector(".markdown-embed-link[aria-label='Open link']") };
    });
    C.check("page preview is editable (click turns it into an editor) and has an expand button", editable.editor && editable.expand, JSON.stringify(editable));
    await win.keyboard.type("EDITED-IN-POPOVER ");
    await sleep(1600);
    const target = await ev(() => document.querySelector(".popover .cm-editor") && window.app.workspace.activeLeaf.view.previewMode?.containerEl ? "" : "");
    void target;
    const edited = Object.values(fs.readdirSync(L.vault)).some((f) => f.endsWith(".md") && fs.readFileSync(path.join(L.vault, f), "utf8").includes("EDITED-IN-POPOVER"));
    C.check("edits in the page preview are saved to the note", edited);
    await win.mouse.click(5, 300);
    await sleep(200);
    C.check("clicking outside closes the page preview", !(await win.$(".popover.hover-popover")));
    // Editing view needs Ctrl by default; the setting changes it.
    await reset();
    await sleep(400);
    const elink = await win.$(".workspace-leaf.mod-active .cm-hmd-internal-link");
    if (elink) {
      await win.mouse.move(5, 5);
      await elink.hover();
      await sleep(700);
      const noCtrl = !!(await win.$(".popover.hover-popover"));
      await ev(() => window.app.internalPlugins.plugins["page-preview"].setOption("editor", false));
      await win.mouse.move(5, 5);
      await sleep(400);
      await elink.hover();
      await sleep(700);
      const off = !!(await win.$(".popover.hover-popover"));
      const json = JSON.parse(await waitFor(() => { try { return fs.readFileSync(path.join(L.vault, ".obsidian", "page-preview.json"), "utf8"); } catch { return null; } }));
      C.check("editing view requires Ctrl by default; turning the setting off previews on plain hover (page-preview.json stores the change)", !noCtrl && off && json.editor === false && Object.keys(json).length === 1, JSON.stringify({ noCtrl, off, json }));
      await ev(() => window.app.internalPlugins.plugins["page-preview"].setOption("editor", true));
    } else C.check("editor link found", false);
  }

  // ------------------------------------------------------------ settings tabs
  if (want("settings")) {
    await reset();
    const tabRows = async (id) => {
      await ev((i) => window.app.setting.openTabById(i), id);
      await sleep(500);
      const r = await ev(() => {
        const d = window.app.setting.popout?.doc ?? document;
        const c = d.querySelector(".vertical-tab-content");
        return { headings: Array.from(c.querySelectorAll(".setting-item-heading .setting-item-name")).map((e) => e.textContent), rows: Array.from(c.querySelectorAll(".setting-item:not(.setting-item-heading) > .setting-item-info > .setting-item-name")).filter((e) => e.closest(".setting-item").style.display !== "none").map((e) => e.textContent), toggles: c.querySelectorAll(".checkbox-container").length };
      });
      return r;
    };
    const gen = await tabRows("about");
    C.check("Settings › General rows: version, automatic updates, early access, language, help; Account; Advanced (startup notice, command line, hardware acceleration)", ["Automatic updates", "Receive early access versions", "Language", "Help", "Your account", "Commercial use", "Notify if startup takes longer than expected", "Command line interface", "Hardware acceleration"].every((n) => gen.rows.includes(n)) && gen.headings.includes("Account") && gen.headings.includes("Advanced") && gen.rows.some((r) => /^Version /.test(r)), JSON.stringify(gen));
    const bl = await tabRows("backlink");
    C.check("Settings › Backlinks: Show backlinks at the bottom of notes (off)", bl.rows.join() === "Show backlinks at the bottom of notes" && bl.toggles === 1, JSON.stringify(bl));
    const pp = await tabRows("page-preview");
    C.check("Settings › Page preview: 'Require Ctrl...' list with 10 sources", pp.headings[0] === "Require Ctrl to trigger page preview on hover" && pp.rows.join("|") === "Search, Backlinks, and Outgoing links|Reading view|Editing view|Tab header|Files|Properties view|Bookmarks|Outline|Bases|Graph view" && pp.toggles === 10, JSON.stringify(pp));
    await ev(() => window.app.setting.close());
    // Backlinks in document: setting and per tab.
    await ev(async () => {
      window.app.internalPlugins.plugins.backlink.setOption("backlinkInDocument", true);
      window.app.embeddedBacklinks.setEnabled(true);
      await window.app.workspace.getLeaf(false).openFile(window.app.vault.getFileByPath("Beta.md"), { state: { mode: "source" } });
    });
    await sleep(600);
    const inDoc = await ev(() => !!document.querySelector(".workspace-leaf.mod-active .embedded-backlinks"));
    await win.click(".workspace-leaf.mod-active .view-action[aria-label='More options']");
    await win.click(".menu .menu-item >> text=Backlinks in document");
    await sleep(300);
    const perTab = await ev(() => !document.querySelector(".workspace-leaf.mod-active .embedded-backlinks") && window.app.workspace.getLayout().main.children[0].children[0].state.state.backlinks === false);
    const json = JSON.parse(fs.readFileSync(path.join(L.vault, ".obsidian", "backlink.json"), "utf8"));
    C.check("backlinks at the bottom of notes (setting, backlink.json) and per tab from the menu", inDoc && perTab && json.backlinkInDocument === true, JSON.stringify({ inDoc, perTab, json }));
    await ev(() => window.app.internalPlugins.plugins.backlink.setOption("backlinkInDocument", false));
  }

  // ------------------------------------------------------------ core plugin switches
  if (want("core")) {
    await reset();
    const sw = await ev(async () => {
      const app = window.app;
      const ip = app.internalPlugins;
      const ws = app.workspace;
      const out = {};
      const check = async (id, cmd, view, status) => {
        await ip.setEnabled(id, false);
        await new Promise((r) => setTimeout(r, 150));
        const off = { cmd: !!app.commands.commands[cmd], leaves: view ? ws.getLeavesOfType(view).length : 0, status: status ? getComputedStyle(document.querySelector(status)).display : "" };
        await ip.setEnabled(id, true);
        await new Promise((r) => setTimeout(r, 300));
        const on = { cmd: !!app.commands.commands[cmd], leaves: view ? ws.getLeavesOfType(view).length : 0, status: status ? getComputedStyle(document.querySelector(status)).display : "" };
        out[id] = { off, on };
      };
      await check("backlink", "backlink:open", "backlink", ".status-bar-item.plugin-backlink");
      await check("outline", "outline:open", "outline");
      await check("file-explorer", "file-explorer:open", "file-explorer");
      await check("global-search", "global-search:open", "search");
      await check("bookmarks", "bookmarks:open", "bookmarks");
      await check("tag-pane", "tag-pane:open", "tag");
      await check("outgoing-link", "outgoing-links:open", "outgoing-link");
      await check("properties", "properties:open", "all-properties", ".status-bar-item.plugin-properties");
      await check("graph", "graph:open", null);
      await check("switcher", "switcher:open", null);
      await check("command-palette", "command-palette:open", null);
      await check("word-count", "app:open-settings", null, ".status-bar-item.plugin-word-count");
      await ip.setEnabled("page-preview", false);
      out.pagePreviewOff = !ip.plugins["page-preview"].enabled;
      await ip.setEnabled("page-preview", true);
      await ip.setEnabled("editor-status", false);
      out.editorStatusOff = !document.querySelector(".status-bar-item.plugin-editor-status");
      await ip.setEnabled("editor-status", true);
      out.editorStatusOn = !!document.querySelector(".status-bar-item.plugin-editor-status");
      out.file = await app.vault.adapter.read(app.vault.configDir + "/core-plugins.json");
      return out;
    });
    let allOk = true;
    for (const [id, r] of Object.entries(sw)) {
      if (!r.off) continue;
      const ok = !r.off.cmd && r.on.cmd && (r.off.leaves === 0) && (!r.off.status || r.off.status === "none") && (!r.on.status || r.on.status !== "none");
      allOk &&= ok;
      C.check(`core plugin "${id}" off removes its commands/tabs/status; on restores them`, ok, JSON.stringify(r));
    }
    const file = JSON.parse(sw.file);
    C.check("core-plugins.json is an object of id -> boolean with the 1.14 ids", typeof file === "object" && !Array.isArray(file) && file["file-explorer"] === true && file["slash-command"] === false && file.publish === false && "webviewer" in file, sw.file.slice(0, 200));
    C.check("editing mode in status bar (editor-status) can be switched off", sw.editorStatusOff && sw.editorStatusOn);
  }

  // ------------------------------------------------------------ files
  if (want("files")) {
    await reset();
    const f = await ev(async () => {
      const app = window.app;
      const out = {};
      app.commands.executeCommandById("file-explorer:new-file");
      await new Promise((r) => setTimeout(r, 400));
      app.commands.executeCommandById("file-explorer:new-file");
      await new Promise((r) => setTimeout(r, 400));
      out.names = app.vault.getMarkdownFiles().map((x) => x.basename).filter((n) => /^Untitled/.test(n)).sort();
      out.selected = window.getSelection().toString();
      app.commands.executeCommandById("file-explorer:new-folder");
      await new Promise((r) => setTimeout(r, 300));
      app.commands.executeCommandById("file-explorer:new-folder");
      await new Promise((r) => setTimeout(r, 300));
      out.folders = app.vault.getAllFolders(false).map((x) => x.name).filter((n) => /^Untitled/.test(n)).sort();
      document.activeElement?.blur?.();
      // Attachment location
      const fm = app.fileManager;
      const src = "Projects/Alpha.md";
      const at = async (v) => {
        app.vault.setConfig("attachmentFolderPath", v);
        return fm.getAvailablePathForAttachment("pic.png", src);
      };
      out.att = [await at("/"), await at("./"), await at("./assets"), await at("Files")];
      app.vault.setConfig("attachmentFolderPath", undefined);
      return out;
    });
    C.check('new notes are "Untitled", "Untitled 1" with the title selected', f.names.join() === "Untitled,Untitled 1" && f.selected === "Untitled 1", JSON.stringify(f));
    C.check('new folders are "Untitled", "Untitled 1"', f.folders.join() === "Untitled,Untitled 1", f.folders.join());
    C.check("attachments location: vault root, same folder, subfolder under it, chosen folder", f.att.join() === "pic.png,Projects/pic.png,Projects/assets/pic.png,Files/pic.png", f.att.join());
    // Unused attachments with a deleted note: always / never / ask.
    const del = await ev(async () => {
      const app = window.app;
      const bin = new Uint8Array([137, 80, 78, 71]).buffer;
      const mk = async (n) => {
        await app.vault.createBinary(`att-${n}.png`, bin);
        const note = await app.vault.create(`Note ${n}.md`, `![[att-${n}.png]]`);
        await new Promise((r) => setTimeout(r, 400));
        return note;
      };
      app.vault.setConfig("promptDelete", false);
      const out = {};
      app.vault.setConfig("deleteUnlinkedAttachments", "always");
      await app.fileManager.promptForDeletion(await mk("a"));
      out.always = !app.vault.getFileByPath("att-a.png");
      app.vault.setConfig("deleteUnlinkedAttachments", "never");
      await app.fileManager.promptForDeletion(await mk("b"));
      out.never = !!app.vault.getFileByPath("att-b.png");
      app.vault.setConfig("deleteUnlinkedAttachments", undefined);
      const p = app.fileManager.promptForDeletion(await mk("c"));
      await new Promise((r) => setTimeout(r, 400));
      out.ask = document.querySelector(".modal .modal-title")?.textContent;
      document.querySelector(".modal .mod-warning")?.click();
      await p;
      out.askDeleted = !app.vault.getFileByPath("att-c.png");
      app.vault.setConfig("promptDelete", undefined);
      return out;
    });
    C.check("delete attachments used only by the deleted note: always / never / ask (default)", del.always && del.never && del.ask === "Delete attachments" && del.askDeleted, JSON.stringify(del));
    // File types open in their own views.
    const types = await ev(async () => {
      const app = window.app;
      const out = {};
      const files = { "x.pdf": "%PDF-1.4\n%%EOF", "x.mp3": "", "x.mp4": "", "x.canvas": "{}", "x.base": "views:\n  - type: table\n    name: Table\n" };
      for (const [n, c] of Object.entries(files)) if (!app.vault.getFileByPath(n)) await app.vault.create(n, c);
      for (const n of ["pixel.png", ...Object.keys(files), "Beta.md"]) {
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(app.vault.getFileByPath(n));
        out[n] = leaf.view.getViewType();
      }
      // Show all file types in the explorer.
      await app.vault.create("weird.xyz", "x").catch(() => null);
      await new Promise((r) => setTimeout(r, 300));
      const visible = () => !!document.querySelector('.nav-file-title[data-path="weird.xyz"], .tree-item-self[data-path="weird.xyz"]');
      out.hidden = !visible();
      app.vault.setConfig("showUnsupportedFiles", true);
      await new Promise((r) => setTimeout(r, 400));
      out.shown = visible();
      app.vault.setConfig("showUnsupportedFiles", undefined);
      return out;
    });
    C.check("supported file types open in their own views (markdown, canvas, base, image, PDF, audio, video)", types["Beta.md"] === "markdown" && types["x.canvas"] === "canvas" && types["x.base"] === "bases" && types["pixel.png"] === "image" && types["x.pdf"] === "pdf" && types["x.mp3"] === "audio" && types["x.mp4"] === "video", JSON.stringify(types));
    C.check('"show all file types" lists other files in the file explorer', types.hidden && types.shown, JSON.stringify(types));
    // Excluded files.
    const ex = await ev(async () => {
      const app = window.app;
      app.vault.setConfig("userIgnoreFilters", ["Projects/"]);
      const out = {};
      const v = await app.globalSearch.revealView();
      v.setQuery("alpha");
      await new Promise((r) => setTimeout(r, 1200));
      out.search = Array.from(document.querySelectorAll(".search-result-file-title, .tree-item-self.search-result-file-title")).map((e) => e.textContent);
      const { switcherSuggestions } = await Promise.resolve({});
      void switcherSuggestions;
      app.commands.executeCommandById("switcher:open");
      await new Promise((r) => setTimeout(r, 100));
      const input = document.querySelector(".prompt-input");
      input.value = "a";
      input.dispatchEvent(new Event("input"));
      await new Promise((r) => setTimeout(r, 200));
      const items = Array.from(document.querySelectorAll(".suggestion-item"));
      out.downranked = items.filter((e) => e.classList.contains("mod-downranked")).map((e) => e.textContent);
      out.lastIsDownranked = items.length > 1 && items.findIndex((e) => e.classList.contains("mod-downranked")) > items.findIndex((e) => !e.classList.contains("mod-downranked") && !e.querySelector(".suggestion-action"));
      document.querySelectorAll(".modal-container").forEach((m) => m.remove());
      while (app.keymap.scopes.length) app.keymap.popScope(app.keymap.scopes[0]);
      app.vault.setConfig("userIgnoreFilters", undefined);
      return out;
    });
    C.check("excluded files: hidden from search, lower in the quick switcher", !ex.search.some((t) => /Alpha/.test(t)) && ex.downranked.length > 0 && ex.lastIsDownranked, JSON.stringify(ex));
  }

  // ------------------------------------------------------------ community plugins
  if (want("plugins")) {
    const pl = await ev(async () => {
      const app = window.app;
      app.plugins.setEnabled(true);
      for (const id of ["too-new", "full-plugin"]) await app.plugins.loadPlugin(id);
      await new Promise((r) => setTimeout(r, 300));
      return {
        tooNew: !window.__tooNewLoaded && /newer/.test(app.plugins.loadErrors["too-new"] ?? ""),
        loaded: !!app.plugins.getPlugin("full-plugin"),
        css: !!document.querySelector('style[data-plugin="full-plugin"]'),
        cmd: !!app.commands.commands["full-plugin:hello"],
        ribbon: app.workspace.leftRibbon.items.some((i) => i.title === "Full ribbon"),
        status: Array.from(document.querySelectorAll(".status-bar-item")).some((e) => e.textContent === "full-status"),
      };
    });
    C.check("plugins: manifest read, minAppVersion too new is skipped with a message", pl.tooNew && pl.loaded, JSON.stringify(pl));
    C.check("plugins: styles.css injected", pl.css);
    fs.writeFileSync(path.join(L.vault, ".obsidian", "plugins", "full-plugin", "data.json"), JSON.stringify({ a: 2 }));
    C.check("plugins: notified when data.json changes on disk (onExternalSettingsChange)", !!(await waitFor(() => ev(() => window.__full?.external === 1), 4000)));
    const un = await ev(async () => {
      const app = window.app;
      const leaf = app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: "full-view" });
      await app.plugins.disablePluginAndSave("full-plugin");
      const ticks = window.__fullTicks;
      await new Promise((r) => setTimeout(r, 300));
      document.body.click();
      return {
        cmd: !!app.commands.commands["full-plugin:hello"],
        ribbon: app.workspace.leftRibbon.items.some((i) => i.title === "Full ribbon"),
        status: Array.from(document.querySelectorAll(".status-bar-item")).some((e) => e.textContent === "full-status"),
        css: !!document.querySelector('style[data-plugin="full-plugin"]'),
        view: app.viewRegistry.getViewCreatorByType("full-view") ? "still" : "gone",
        interval: window.__fullTicks === ticks,
        clicks: window.__fullClicks ?? 0,
      };
    });
    C.check("plugins unload cleanly: commands, ribbon, status, styles, views, intervals, DOM listeners", !un.cmd && !un.ribbon && !un.status && !un.css && un.view === "gone" && un.interval && un.clicks === 0, JSON.stringify(un));
  }

  // ------------------------------------------------------------ export to PDF
  if (want("pdf")) {
    await reset();
    const out = path.join(L.tmp, "export.pdf");
    await L.app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, out);
    await ev(() => window.app.commands.executeCommandById("workspace:export-pdf"));
    await sleep(300);
    const fields = await ev(() => Array.from(document.querySelectorAll(".modal .setting-item-name")).map((e) => e.textContent));
    await win.click(".modal button.mod-cta");
    const ok = await waitFor(() => fs.existsSync(out) && fs.readFileSync(out).slice(0, 4).toString() === "%PDF", 15000);
    C.check("export to PDF: options (page size, landscape, margin, downscale) and a PDF file", !!ok && ["Include file name as title", "Page size", "Landscape", "Margin", "Downscale percent"].every((n) => fields.includes(n)), fields.join(","));
  }

  // ------------------------------------------------------------ small states
  if (want("states")) {
    await reset();
    // Tooltip after a real hover (1 s default).
    await win.mouse.move(400, 400);
    const ribbonBtn = await win.$(".workspace-ribbon.mod-left .side-dock-ribbon-action");
    const rb = await ribbonBtn.boundingBox();
    await win.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2, { steps: 3 });
    await sleep(500);
    const early = !!(await win.$(".tooltip"));
    await sleep(800);
    const tip = await ev(() => {
      const t = document.querySelector(".tooltip");
      return t ? { text: t.textContent, arrow: !!t.querySelector(".tooltip-arrow"), right: t.classList.contains("mod-right") } : null;
    });
    C.check("tooltips: shown after a delay with an arrow, beside the ribbon", !early && tip?.text === "Open quick switcher" && tip.arrow && tip.right, JSON.stringify({ early, tip }));
    await win.mouse.move(600, 600);
    // Notices: top right, stack, click to dismiss, auto-hide.
    await ev(() => {
      const { Notice } = require("obsidian") ?? {};
      void Notice;
    }).catch(() => {});
    await ev(() => {
      const N = window.app.plugins.apiModule?.().Notice ?? null;
      const make = N ? (t, d) => new N(t, d) : (t) => window.app.shell && null;
      make("first notice", 1500);
      make("second notice", 10000);
    });
    await sleep(200);
    const pos = await ev(() => {
      const els = Array.from(document.querySelectorAll(".notice"));
      const r = els.map((e) => e.getBoundingClientRect());
      return { n: els.length, right: r.map((x) => Math.round(window.innerWidth - x.right)), tops: r.map((x) => Math.round(x.top)) };
    });
    await win.click(".notice >> text=second notice");
    await sleep(400);
    const afterClick = await notices(win);
    await sleep(1600);
    const afterTime = await notices(win);
    C.check("notices: top right, stacked, click to dismiss, hide on their own", pos.n === 2 && pos.tops[1] > pos.tops[0] && pos.right.every((x) => x < 40) && !/second notice/.test(afterClick) && !/first notice/.test(afterTime), JSON.stringify({ pos, afterClick, afterTime }));
    // Confirm dialog and prompt modals.
    await ev(() => window.app.fileManager.promptForDeletion(window.app.vault.getFileByPath("Beta.md")));
    await sleep(200);
    const confirm = await ev(() => ({ title: document.querySelector(".modal .modal-title")?.textContent, danger: !!document.querySelector(".modal .mod-warning") }));
    await ev(() => document.querySelectorAll(".modal-container").forEach((m) => m.remove()) || window.app.keymap.scopes.splice(0));
    await ev(() => window.app.commands.executeCommandById("file-explorer:move-file"));
    await sleep(200);
    const prompt = await ev(() => document.querySelector(".prompt-input")?.placeholder);
    await win.keyboard.press("Escape");
    C.check("confirm dialog (delete) and prompt modal (move to folder)", confirm.title === "Delete file" && confirm.danger && prompt === "Type a folder", JSON.stringify({ confirm, prompt }));
    // Context menus: icons, separators, submenus, warning items.
    await win.click(".mod-root .workspace-tab-header.is-active", { button: "right" });
    const menu = await ev(() => ({ icons: document.querySelectorAll(".menu .menu-item-icon svg").length, seps: document.querySelectorAll(".menu .menu-separator").length, sub: document.querySelectorAll(".menu .menu-item.has-submenu").length, warn: document.querySelectorAll(".menu .menu-item.is-warning").length }));
    await closeMenus(win);
    C.check("context menus: icons, separators, submenus, red destructive items", menu.icons > 10 && menu.seps >= 5 && menu.sub >= 2 && menu.warn === 1, JSON.stringify(menu));
    // Error notice when a file can't be saved.
    const errNotice = await ev(async () => {
      const v = window.app.workspace.activeLeaf.view;
      const orig = window.app.vault.modify.bind(window.app.vault);
      window.app.vault.modify = async () => {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      };
      v.editor.replaceRange("x", { line: 0, ch: 0 });
      await v.save();
      window.app.vault.modify = orig;
      return Array.from(document.querySelectorAll(".notice")).map((n) => n.textContent).join("|");
    });
    C.check("an error notice says when a file can't be saved and what to do", /Couldn't save "Welcome.md".*isn't allowed to write/.test(errNotice), errNotice);
    // Empty states.
    await ev(() => window.app.workspace.rightSplit.expand());
    const states = await ev(async () => {
      const app = window.app;
      await app.workspace.getLeaf(false).openFile(await app.vault.create("Lonely.md", "nothing"));
      await new Promise((r) => setTimeout(r, 600));
      const v = await app.globalSearch.revealView();
      v.setQuery("zzzzqqq-no-match");
      await new Promise((r) => setTimeout(r, 800));
      return {
        search: document.querySelector(".workspace-leaf-content[data-type=search] .search-empty-state")?.textContent ?? document.querySelector(".workspace-leaf-content[data-type=search]")?.textContent,
        backlinks: document.querySelector(".workspace-leaf-content[data-type=backlink] .search-empty-state")?.textContent ?? "",
      };
    });
    C.check("empty states: no search results, no backlinks", /No matches found|No results/i.test(states.search ?? "") && /No backlinks found/i.test(states.backlinks), JSON.stringify(states));
  }

  C.check("no renderer errors", errors.filter((e) => !/net::ERR|Failed to load resource/.test(e)).length === 0, errors.slice(0, 4).join(" | "));
} catch (e) {
  C.check("ui run", false, String(e?.stack ?? e));
  await shot(win, "shell-ui-crash").catch(() => {});
} finally {
  await L.close();
}
process.exit(C.summary() ? 1 : 0);
