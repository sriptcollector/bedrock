// Commands sweep: runs EVERY command id in docs/reference/commands.json in the built app (temp copy
// of the fixture vault, all core plugins switched on) and checks that it exists, is available in
// a suitable state, runs without renderer errors, and has the expected effect where checkable.
// Commands that only exist on other platforms/products are reported as skipped with the reason.
// Usage: node test/e2e/commands-sweep.mjs [--only <prefix>] [--keep]
import fs from "node:fs";
import path from "node:path";
import { launch, Checks, repoDir, shot, argValue } from "./lib/harness.mjs";

const ref = JSON.parse(fs.readFileSync(path.join(repoDir, "docs", "reference", "commands.json"), "utf8")).commands;
const only = argValue("--only");
const C = new Checks();

// Not applicable to this app (documented in docs/FEATURES.md).
const NOT_APPLICABLE = {
  "mobile:quick-action": "mobile only (no mobile app)",
  "publish:open-in-live-site": "Publish is Obsidian's paid hosting; not part of this app",
  "publish:publish-file": "Publish is Obsidian's paid hosting; not part of this app",
  "publish:view-changes": "Publish is Obsidian's paid hosting; not part of this app",
};
// Run separately at the end (they reload or close the window).
const LAST = new Set(["app:reload"]);

const VARIANT_EXTRA = {};
// Expected effects: (before, after, extra) => true | string (failure detail).
const EXPECT = {
  "app:decrease-font-size": (b, a) => a.fontSize === b.fontSize - 1 || `font ${b.fontSize} -> ${a.fontSize}`,
  "app:increase-font-size": (b, a) => a.fontSize === b.fontSize + 1 || `font ${b.fontSize} -> ${a.fontSize}`,
  "app:delete-file": (b, a) => a.modal === "confirm" || a.files === b.files - 1 || `modal ${a.modal}, files ${b.files}->${a.files}`,
  "app:go-back": (b, a) => a.activePath === "Beta.md" || a.activePath,
  "app:go-forward": (b, a) => a.activePath === "Welcome.md" || a.activePath,
  "app:migrate-frontmatter": (b, a) => !!a.modal || "no modal",
  "app:open-another-vault": (b, a) => a.prompt || "no picker",
  "app:switch-vault": (b, a) => a.prompt || "no picker",
  "app:open-file": (b, a, x) => x.pickFile >= 1 || "no file dialog",
  "app:open-help": (b, a, x) => x.external.some((u) => /github\.com/.test(u)) || x.external.join(","),
  "app:open-sandbox-vault": (b, a, x) => x.sandbox >= 1 || "sandbox not requested",
  "app:open-settings": (b, a) => a.settings || "settings not open",
  "app:open-vault": (b, a) => a.vaultManager || "vault manager not open",
  "app:show-debug-info": (b, a) => a.modal === "debug" || `modal ${a.modal}`,
  "app:show-release-notes": (b, a, x) => x.external.some((u) => /releases/.test(u)) || x.external.join(","),
  "app:toggle-default-new-pane-mode": (b, a) => a.defaultViewMode !== b.defaultViewMode || "unchanged",
  "app:toggle-left-sidebar": (b, a) => a.leftCollapsed !== b.leftCollapsed || "unchanged",
  "app:toggle-right-sidebar": (b, a) => a.rightCollapsed !== b.rightCollapsed || "unchanged",
  "app:toggle-ribbon": (b, a) => a.showRibbon !== b.showRibbon || "unchanged",
  "command-palette:open": (b, a) => a.prompt || "no palette",
  "switcher:open": (b, a) => a.prompt || "no switcher",
  "file-explorer:new-file": (b, a) => (a.files === b.files + 1 && /^Untitled/.test(a.activeName)) || `files ${b.files}->${a.files}, ${a.activeName}`,
  "file-explorer:new-file-in-current-tab": (b, a) => (a.files === b.files + 1 && a.rootLeaves === b.rootLeaves) || `files ${b.files}->${a.files}, leaves ${b.rootLeaves}->${a.rootLeaves}`,
  "file-explorer:new-file-in-new-pane": (b, a) => (a.files === b.files + 1 && a.tabGroups === b.tabGroups + 1) || `files ${b.files}->${a.files}, groups ${b.tabGroups}->${a.tabGroups}`,
  "file-explorer:new-folder": (b, a) => a.folders === b.folders + 1 || `folders ${b.folders}->${a.folders}`,
  "file-explorer:duplicate-file": (b, a) => a.files === b.files + 1 || `files ${b.files}->${a.files}`,
  "file-explorer:move-file": (b, a) => a.prompt || "no folder picker",
  "file-explorer:open": (b, a) => a.explorerVisible || "explorer not shown",
  "file-explorer:reveal-active-file": (b, a) => a.explorerActive === a.activePath || `${a.explorerActive}`,
  "markdown:add-alias": (b, a) => a.fmKeys.includes("aliases") || a.fmKeys.join(","),
  "markdown:add-metadata-property": (b, a) => a.propertyInput || "no new property field",
  "markdown:clear-metadata-properties": (b, a) => (b.fmKeys.length > 0 && a.fmKeys.length === 0) || `${b.fmKeys} -> ${a.fmKeys}`,
  "markdown:toggle-preview": (b, a) => a.mode !== b.mode || "mode unchanged",
  "open-with-default-app:open": (b, a, x) => x.openDefault >= 1 || "not called",
  "open-with-default-app:show": (b, a, x) => x.showInFolder >= 1 || "not called",
  "theme:toggle-light-dark": (b, a) => a.dark !== b.dark || "unchanged",
  "theme:switch": (b, a) => a.prompt || "no theme picker",
  "window:reset-zoom": (b, a) => a.zoom === 0 || `zoom ${a.zoom}`,
  "window:zoom-in": (b, a) => a.zoom > b.zoom || `${b.zoom} -> ${a.zoom}`,
  "window:zoom-out": (b, a) => a.zoom < b.zoom || `${b.zoom} -> ${a.zoom}`,
  "window:toggle-always-on-top": (b, a, x) => x.alwaysOnTop !== undefined || "no state",
  "workspace:close": (b, a) => a.rootLeaves === b.rootLeaves - 1 || `${b.rootLeaves} -> ${a.rootLeaves}`,
  "workspace:close-others": (b, a) => a.rootLeaves === 1 || `${a.rootLeaves}`,
  "workspace:close-others-tab-group": (b, a) => a.groupTabs === 1 || `${a.groupTabs}`,
  "workspace:close-tab-group": (b, a) => a.tabGroups === b.tabGroups - 1 || `${b.tabGroups} -> ${a.tabGroups}`,
  "workspace:goto-last-tab": (b, a) => a.tabIndex === a.groupTabs - 1 || `${a.tabIndex}/${a.groupTabs}`,
  "workspace:close-window": (b, a) => a.floating === b.floating - 1 || `${b.floating} -> ${a.floating}`,
  "workspace:copy-full-path": (b, a) => /[\\/]Welcome\.md$/.test(a.clipboard) && path.isAbsolute(a.clipboard) || a.clipboard,
  "workspace:copy-path": (b, a) => a.clipboard === "Welcome.md" || a.clipboard,
  "workspace:copy-url": (b, a) => /^[a-z]+:\/\/open\?vault=.+&file=Welcome$/.test(a.clipboard) || a.clipboard,
  "workspace:edit-file-title": (b, a) => a.inlineTitleFocused || "inline title not focused",
  "workspace:export-pdf": (b, a) => a.modal === "pdf" || `modal ${a.modal}`,
  "workspace:move-to-new-window": (b, a) => a.floating === b.floating + 1 || `${b.floating} -> ${a.floating}`,
  "workspace:new-tab": (b, a) => (a.rootLeaves === b.rootLeaves + 1 && a.activeType === "empty") || `${b.rootLeaves} -> ${a.rootLeaves}, ${a.activeType}`,
  "workspace:new-window": (b, a) => a.floating === b.floating + 1 || `${b.floating} -> ${a.floating}`,
  "workspace:next-tab": (b, a) => a.tabIndex === (b.tabIndex + 1) % b.groupTabs || `${b.tabIndex} -> ${a.tabIndex}`,
  "workspace:open-in-new-window": (b, a) => a.floating === b.floating + 1 || `${b.floating} -> ${a.floating}`,
  "workspace:previous-tab": (b, a) => a.tabIndex === (b.tabIndex - 1 + b.groupTabs) % b.groupTabs || `${b.tabIndex} -> ${a.tabIndex}`,
  "workspace:show-trash": (b, a, x) => x.trash >= 1 || x.showInFolder >= 1 || "not shown",
  "workspace:split-horizontal": (b, a) => a.tabGroups === b.tabGroups + 1 || `${b.tabGroups} -> ${a.tabGroups}`,
  "workspace:split-vertical": (b, a) => a.tabGroups === b.tabGroups + 1 || `${b.tabGroups} -> ${a.tabGroups}`,
  "workspace:toggle-pin": (b, a) => a.pinned !== b.pinned || "unchanged",
  "workspace:toggle-stacked-tabs": (b, a) => a.stacked !== b.stacked || "unchanged",
  "workspace:undo-close-pane": (b, a) => a.rootLeaves === b.rootLeaves + 1 || `${b.rootLeaves} -> ${a.rootLeaves}`,
  "audio-recorder:start": (b, a) => a.recording || "not recording",
  "audio-recorder:stop": (b, a) => (!a.recording && a.files === b.files + 1) || `recording=${a.recording} files ${b.files}->${a.files}`,
  "global-search:open": (b, a) => a.searchVisible || "search not shown",
  "graph:open": (b, a) => a.activeType === "graph" || a.activeType,
  "random-note": (b, a) => a.activeType === "markdown" || a.activeType,
  "daily-notes": (b, a) => /^\d{4}-\d{2}-\d{2}$/.test(a.activeName) || a.activeName,
  "zk-prefixer": (b, a) => /^\d{12}/.test(a.activeName) || a.activeName,
  "canvas:new-file": (b, a) => a.activeType === "canvas" || a.activeType,
  "bases:new-file": (b, a) => a.activeType === "bases" || a.activeType,
};
for (let i = 1; i <= 8; i++) {
  EXPECT[`workspace:goto-tab-${i}`] = (b, a) => a.tabIndex === i - 1 || `${a.tabIndex}`;
  VARIANT_EXTRA[`workspace:goto-tab-${i}`] = "tabs9";
}

// Page-side helpers: stubs for things that leave the app (browser, OS dialogs), state reset and snapshot.
const PAGE_HELPERS = () => {
  const app = window.app;
  const x = (window.__sweepCalls = { external: [], openDefault: 0, showInFolder: 0, trash: 0, pickFile: 0, sandbox: 0, alwaysOnTop: undefined });
  app.openExternal = (u) => x.external.push(String(u));
  app.openWithDefaultApp = () => x.openDefault++;
  app.showInFolder = () => x.showInFolder++;
  app.shell.openSystemTrash = () => x.trash++;
  const { ipcRenderer } = require("electron");
  const realInvoke = ipcRenderer.invoke.bind(ipcRenderer);
  ipcRenderer.invoke = async (ch, ...a) => {
    if (ch === "bedrock:shell-pick-file" || ch === "bedrock:shell-pick-folder" || ch === "bedrock:pick-folder" || ch === "bedrock:open-vault-dialog") {
      x.pickFile++;
      return null;
    }
    if (ch === "bedrock:shell-open-sandbox") {
      x.sandbox++;
      return null;
    }
    const r = await realInvoke(ch, ...a);
    if (ch === "bedrock:shell-window" && a[0] === "always-on-top") {
      x.alwaysOnTop = r?.alwaysOnTop;
      if (r?.alwaysOnTop) await realInvoke(ch, ...a); // put it back
    }
    return r;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__sweep = {
    sleep,
    async reset(variant) {
      // Close modals, menus, prompts, popouts; reset to Welcome + Beta tabs in one group.
      for (let i = 0; i < 4; i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      for (const m of Array.from(document.querySelectorAll(".modal-container"))) m.remove();
      while (app.keymap.scopes?.length) app.keymap.popScope(app.keymap.scopes[app.keymap.scopes.length - 1]);
      document.querySelectorAll(".menu").forEach((m) => m.remove());
      app.setting?.close?.();
      app.shell.closeVaultManager?.();
      for (const w of app.workspace.floatingSplit.children.slice()) w.close();
      await sleep(50);
      if (app.workspace.rightSplit.collapsed) app.workspace.rightSplit.expand();
      if (app.workspace.leftSplit.collapsed) app.workspace.leftSplit.expand();
      const layout = app.workspace.defaultLayout();
      await app.workspace.changeLayout(layout);
      let welcome = app.vault.getFileByPath("Welcome.md");
      if (!welcome) welcome = await app.vault.create("Welcome.md", "---\ntags: [a]\n---\n# Welcome\n\nHello [[Beta]].\n");
      const text = await app.vault.read(welcome);
      if (!/^---\n/.test(text)) await app.vault.modify(welcome, "---\ntags: [a]\n---\n" + text);
      let beta = app.vault.getFileByPath("Beta.md") ?? (await app.vault.create("Beta.md", "# Beta\n"));
      const l1 = app.workspace.getLeaf(false);
      if (variant === "history") {
        await l1.openFile(beta, { active: true });
        await l1.openFile(welcome, { active: true });
        if (window.__sweepForward) await l1.history.back();
      } else await l1.openFile(welcome, { active: true, state: { mode: "source" } });
      const l2 = app.workspace.getLeaf("tab");
      await l2.openFile(beta, { active: false });
      app.workspace.setActiveLeaf(l1, { focus: true });
      if (variant === "closed") app.closedTabs.push({ type: "markdown", state: { file: "Beta.md" } });
      if (variant === "preview") await l1.setViewState({ type: "markdown", state: { file: "Welcome.md", mode: "preview" }, active: true });
      if (variant === "popout") {
        const pl = app.workspace.openPopoutLeaf();
        await pl.openFile(beta, { active: true });
        await sleep(300);
      }
      if (variant === "tabs9") {
        const g = l1.parent;
        for (let i = 0; i < 7; i++) await app.workspace.createLeafInTabs(g).openFile(beta, { active: false });
        app.workspace.setActiveLeaf(l1, { focus: true });
      }
      if (variant === "split") {
        await app.workspace.duplicateLeaf(l1, "split", "vertical");
        app.workspace.setActiveLeaf(l1, { focus: true });
      }
      if (variant === "heading" || variant === "selection") {
        const ed = l1.view.editor;
        const lines = ed.getValue().split("\n");
        const h = lines.findIndex((x) => /^#{1,6} /.test(x));
        if (variant === "heading") ed.setCursor({ line: Math.max(0, h), ch: 1 });
        else {
          const b = lines.findIndex((x, i) => i > h && x.trim().length > 3 && !/^[#>|-]/.test(x));
          ed.setSelection({ line: b, ch: 0 }, { line: b, ch: lines[b].length });
        }
        l1.view.editor.focus();
      }
      if (variant === "search") await app.globalSearch.openGlobalSearch("hello");
      if (variant === "bookmarked") app.bookmarks.add({ type: "file", path: "Welcome.md" });
      if (variant === "graph") await l1.setViewState({ type: "graph", state: {}, active: true });
      if (variant === "base") {
        app.commands.executeCommandById("bases:new-file");
        await sleep(600);
      }
      if (variant === "canvas") {
        const data = { nodes: [{ id: "t1", type: "text", text: "Card", x: 0, y: 0, width: 200, height: 80 }, { id: "g1", type: "group", label: "Group", x: -40, y: -40, width: 400, height: 300 }], edges: [] };
        const f = app.vault.getFileByPath("Sweep.canvas") ?? (await app.vault.create("Sweep.canvas", JSON.stringify(data)));
        await l1.openFile(f, { active: true });
        await sleep(500);
        const c = l1.view.canvas;
        const n = c?.nodes.get("t1");
        if (n) c.selectOnly(n);
      }
      if (variant === "recording") {
        app.commands.executeCommandById("audio-recorder:start");
        await sleep(800);
      }
      await sleep(150);
      x.external = [];
      x.openDefault = x.showInFolder = x.trash = x.pickFile = x.sandbox = 0;
      x.alwaysOnTop = undefined;
      await realInvoke("bedrock:shell-clipboard", "write", "");
    },
    async snap() {
      const ws = app.workspace;
      const leaf = ws.activeLeaf;
      const v = leaf?.view;
      let rootLeaves = 0;
      ws.iterateRootLeaves(() => void rootLeaves++);
      const tabGroups = document.querySelectorAll(".mod-root .workspace-tabs").length;
      const file = ws.getActiveFile();
      // Frontmatter keys from the editor text (the cache only updates after the file is saved).
      let fm = file ? app.metadataCache.getFileCache(file)?.frontmatter : null;
      if (v?.editor?.getValue) {
        const t = v.editor.getValue();
        const m = /^---\r?\n([\s\S]*?)\r?\n?---(\r?\n|$)/.exec(t);
        fm = {};
        if (m) for (const line of m[1].split(/\r?\n/)) {
          const k = /^([^\s:#-][^:]*):/.exec(line);
          if (k) fm[k[1].trim()] = true;
        }
      }
      const modalEl = document.querySelector(".modal-container .modal");
      const docs = ws.allDocuments();
      const anyDoc = (sel) => docs.some((d) => d.querySelector(sel));
      const explorer = ws.getLeavesOfType("file-explorer")[0];
      const search = ws.getLeavesOfType("search")[0];
      const visible = (l) => !!l && l.containerEl.isConnected && l.containerEl.style.display !== "none" && !(l.getRoot()?.collapsed);
      return {
        files: app.vault.getFiles().length,
        folders: app.vault.getAllFolders(false).length,
        rootLeaves,
        tabGroups,
        groupTabs: leaf?.parent?.children?.length ?? 0,
        tabIndex: leaf?.parent?.children?.indexOf(leaf) ?? -1,
        activeType: v?.getViewType?.() ?? null,
        activePath: v?.file?.path ?? null,
        activeName: v?.file?.basename ?? null,
        mode: v?.getMode?.() ?? null,
        pinned: !!leaf?.pinned,
        stacked: !!leaf?.parent?.isStacked,
        floating: ws.floatingSplit.children.length,
        leftCollapsed: ws.leftSplit.collapsed,
        rightCollapsed: ws.rightSplit.collapsed,
        fontSize: Number(app.vault.getConfig("baseFontSize")) || 16,
        showRibbon: app.vault.getConfig("showRibbon") !== false,
        dark: app.customCss.isDark(),
        defaultViewMode: app.vault.getConfig("defaultViewMode"),
        zoom: require("electron").webFrame.getZoomLevel(),
        modal: modalEl ? (modalEl.classList.contains("mod-debug-info") ? "debug" : modalEl.querySelector(".modal-title")?.textContent === "Export to PDF" ? "pdf" : modalEl.querySelector(".mod-warning") ? "confirm" : "modal") : null,
        prompt: anyDoc(".prompt") || anyDoc(".modal-container .prompt-input") || anyDoc(".suggestion-container"),
        settings: !!app.setting?.isActive,
        vaultManager: !!app.shell.__managerOpen?.(),
        clipboard: await realInvoke("bedrock:shell-clipboard", "read"),
        fmKeys: fm ? Object.keys(fm) : [],
        propertyInput: anyDoc(".metadata-property-key-input:focus") || anyDoc(".metadata-container .metadata-property-key-input"),
        inlineTitleFocused: !!document.activeElement?.closest?.(".inline-title"),
        explorerVisible: visible(explorer),
        explorerActive: explorer?.view?.containerEl?.querySelector(".tree-item-self.is-active")?.getAttribute("data-path") ?? null,
        searchVisible: visible(search),
        recording: !!document.querySelector(".side-dock-ribbon-action.is-recording"),
      };
    },
  };
};

const VARIANT = {
  "workspace:goto-last-tab": "tabs9",
  "workspace:close-tab-group": "split",
  "workspace:close-others-tab-group": "split",
  "bookmarks:bookmark-current-heading": "heading",
  "note-composer:extract-heading": "heading",
  "note-composer:split-file": "selection",
  "bookmarks:bookmark-current-search": "search",
  "bookmarks:unbookmark-current-view": "bookmarked",
  "graph:animate": "graph",
  "bases:add-item": "base",
  "bases:add-view": "base",
  "bases:change-view": "base",
  "bases:copy-table": "base",
  "canvas:convert-to-file": "canvas",
  "canvas:export-as-image": "canvas",
  "canvas:jump-to-group": "canvas",
  "app:go-back": "history",
  "app:go-forward": "history-forward",
  "workspace:undo-close-pane": "closed",
  "workspace:close-window": "popout",
  "audio-recorder:stop": "recording",
};

const L = await launch();
const { win, errors } = L;
try {
  // All core plugins on so every core command exists.
  await win.evaluate(async () => {
    for (const p of Object.values(window.app.internalPlugins.plugins)) if (!p.info.legacy && p.id !== "publish") await p.enable?.();
    await new Promise((r) => setTimeout(r, 300));
  });
  await win.evaluate(PAGE_HELPERS);
  const registered = new Set(await win.evaluate(() => Object.keys(window.app.commands.commands)));
  // vault manager state probe (the popout is created on demand)
  await win.evaluate(() => {
    const s = window.app.shell;
    const orig = s.openVaultManager;
    let open = false;
    s.openVaultManager = async () => {
      open = true;
      return orig();
    };
    const close = s.closeVaultManager;
    s.closeVaultManager = () => {
      open = false;
      return close();
    };
    s.__managerOpen = () => open;
  });

  for (const c of ref) {
    const id = c.id;
    if (only && !id.startsWith(only)) continue;
    if (NOT_APPLICABLE[id]) {
      C.skip(id, NOT_APPLICABLE[id]);
      continue;
    }
    if (LAST.has(id)) continue;
    if (!registered.has(id)) {
      C.check(`${id} registered`, false, "command id missing");
      continue;
    }
    const variant = VARIANT[id] ?? VARIANT_EXTRA[id] ?? (c.needsActiveEditor ? "source" : null);
    if (variant === "history-forward") await win.evaluate(() => (window.__sweepForward = true));
    await win.evaluate((v) => window.__sweep.reset(v === "history-forward" ? "history" : v), variant);
    await win.evaluate(() => (window.__sweepForward = false));
    const errBefore = errors.length;
    const before = await win.evaluate(() => window.__sweep.snap());
    let ran;
    try {
      ran = await win.evaluate((id) => window.app.commands.executeCommandById(id), id);
    } catch (e) {
      ran = String(e);
    }
    await win.waitForTimeout(id.startsWith("audio-recorder") || /window|popout|vault|sandbox/.test(id) ? 900 : 350);
    const after = await win.evaluate(() => window.__sweep.snap());
    const calls = await win.evaluate(() => window.__sweepCalls);
    const newErrors = errors.slice(errBefore).filter((e) => !/Permission denied|NotAllowedError|Requested device not found/i.test(e));
    const exp = EXPECT[id];
    const effect = exp ? exp(before, after, calls) : true;
    const ok = ran === true && newErrors.length === 0 && effect === true;
    C.check(id, ok, ok ? "" : `ran=${ran}${newErrors.length ? " errors=" + newErrors.slice(0, 2).join(" | ") : ""}${effect !== true ? " effect: " + effect : ""}`);
    if (!ok) await shot(win, "sweep-fail-" + id.replace(/[^a-z0-9-]/gi, "_"));
  }

  // Last: app:reload reloads the window and the app comes back.
  if (!only || "app:reload".startsWith(only)) {
    await win.evaluate(() => window.__sweep.reset(null));
    const ran = await win.evaluate(() => window.app.commands.executeCommandById("app:reload"));
    await win.waitForTimeout(500);
    const back = await win
      .waitForFunction(() => window.app?.indexStats, null, { timeout: 60000 })
      .then(() => true)
      .catch(() => false);
    C.check("app:reload", ran === true && back, `ran=${ran} back=${back}`);
  }
} catch (e) {
  C.check("sweep run", false, String(e?.stack ?? e));
  await shot(win, "sweep-crash").catch(() => {});
} finally {
  await L.close();
}
process.exit(C.summary() ? 1 : 0);
