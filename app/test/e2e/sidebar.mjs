// Sidebar panes e2e: launches the built app on a COPY of the demo vault at a 1280x800 window,
// opens every sidebar view (search, backlinks, outgoing links, tags, outline, bookmarks,
// properties, page preview, file explorer menus), checks the DOM, and saves screenshots to
// test/out/sidebar-<scene>.png. With --compare <refDir> <outDir> it also writes side-by-side
// sheets (reference left, ours right).
// Usage: node test/e2e/sidebar.mjs [--vault <dir>] [--compare <refDir> <outDir>] [--only <regex>] [--theme light|dark] [--keep]
import { _electron as electron } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../..");
const outDir = path.join(appDir, "test", "out");
fs.mkdirSync(outDir, { recursive: true });
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const src = arg("--vault") ?? "C:/Users/orion/tbv-scratch/demo-vault";
const compare = process.argv.includes("--compare") ? [arg("--compare"), process.argv[process.argv.indexOf("--compare") + 2]] : null;
const only = arg("--only") ? new RegExp(arg("--only")) : null;
const theme = arg("--theme") ?? "light";
if (!fs.existsSync(src)) {
  console.log(`demo vault not found at ${src}; pass --vault <dir>`);
  process.exit(0);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-sidebar-"));
const vault = path.join(tmp, "demo-vault");
fs.cpSync(src, vault, { recursive: true });
fs.rmSync(path.join(vault, ".obsidian", "workspace.json"), { force: true });
fs.writeFileSync(path.join(vault, ".obsidian", "appearance.json"), JSON.stringify({ theme: theme === "dark" ? "obsidian" : "moonstone" }));
const userData = path.join(tmp, "userdata");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
};

const electronPath = (await import("electron")).default;
const app = await electron.launch({ executablePath: electronPath, args: [appDir, "--vault", vault], env: { ...process.env, BEDROCK_USER_DATA: userData, BEDROCK_NO_UPDATE: "1" } });
const errors = [];
const win = await app.firstWindow();
win.on("console", (m) => m.type() === "error" && errors.push(m.text() + (process.env.STACK ? " @ " + JSON.stringify(m.location()) : "")));
win.on("pageerror", (e) => errors.push(String(e) + (process.env.STACK ? " @ " + e.stack : "")));
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  w.unmaximize();
  w.setContentSize(1280, 800);
  w.center();
});
await win.waitForSelector(".workspace", { timeout: 30000 });
await win.waitForFunction(() => window.app?.indexStats, null, { timeout: 120000 });
await win.waitForFunction(() => window.app?.searchIndex?.loaded, null, { timeout: 60000 });

// Page helpers (same idea as the reference capture helpers).
await win.evaluate(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ws = () => window.app.workspace;
  window.__t = {
    sleep,
    async reset() {
      document.querySelectorAll(".menu, .popover, .tooltip, .notice").forEach((m) => m.remove());
      document.querySelectorAll(".modal-container").forEach((m) => m.remove());
      const leaves = [];
      ws().iterateRootLeaves((l) => leaves.push(l));
      for (const l of leaves.slice(1)) l.detach();
      ws().leftSplit.expand();
      ws().rightSplit.collapse();
      const fe = ws().getLeavesOfType("file-explorer")[0];
      if (fe) await ws().revealLeaf(fe);
      const v = fe?.view;
      if (v) {
        v.expanded?.clear?.();
        v.rebuild?.();
      }
      await sleep(150);
    },
    expandAll() {
      const v = ws().getLeavesOfType("file-explorer")[0]?.view;
      for (const f of window.app.vault.getAllFolders(false)) v?.expanded?.add(f.path);
      v?.rebuild?.();
    },
    async open(p, mode = "live") {
      const leaf = ws().getMostRecentLeaf() ?? ws().getLeaf(false);
      await leaf.openFile(window.app.vault.getFileByPath(p), { active: true, state: mode === "reading" ? { mode: "preview" } : { mode: "source", source: false } });
      ws().setActiveLeaf(leaf, { focus: true });
      await sleep(400);
      return leaf;
    },
    async side(type, side) {
      const leaf = await ws().ensureSideLeaf(type, side, { reveal: true });
      (side === "left" ? ws().leftSplit : ws().rightSplit).expand();
      await sleep(500);
      return leaf;
    },
  };
});

const shot = async (name) => {
  await win.waitForTimeout(500);
  const file = path.join(outDir, `sidebar-${name}.png`);
  await win.screenshot({ path: file });
  return file;
};

const scenes = [
  ["search-results", `await t.open('Welcome.md'); const l = await t.side('search','left'); l.view.setExplainSearch(false); l.view.setQuery('garden'); await t.sleep(900);`,
    () => ({ files: document.querySelectorAll(".workspace-leaf-content[data-type=search] .search-result").length, matches: document.querySelectorAll(".workspace-leaf-content[data-type=search] .search-result-file-matched-text").length, count: document.querySelector(".search-results-result-count span")?.textContent }),
    (r) => r.files >= 6 && r.matches >= 10],
  ["search-operators", `await t.open('Welcome.md'); const l = await t.side('search','left'); l.view.setExplainSearch(true); l.view.setQuery('tag:#garden path:Projects "water"'); await t.sleep(900);`,
    () => ({ info: document.querySelector(".search-info-container")?.innerText, files: [...document.querySelectorAll(".workspace-leaf-content[data-type=search] .search-result-file-title")].map((e) => e.innerText) }),
    (r) => r.files.length === 1 && /Projects\/Garden Planner/.test(r.files[0]) && /Match all of/.test(r.info)],
  ["search-empty", `await t.open('Welcome.md'); const l = await t.side('search','left'); l.view.setExplainSearch(false); l.view.setQuery(''); await t.sleep(400);`,
    () => ({ empty: document.querySelector(".workspace-leaf-content[data-type=search] .search-empty-state")?.textContent }), (r) => r.empty === "No matches found."],
  ["backlinks-panel", `await t.open('Projects/Garden Planner.md'); const l = await t.side('backlink','right'); await l.setViewState({type:'backlink', state:{backlinkCollapsed:false, unlinkedCollapsed:false}}); await t.sleep(900);`,
    () => ({ heads: [...document.querySelectorAll(".backlink-pane > .tree-item-self")].map((e) => e.innerText.replace(/\n/g, " ")), files: [...document.querySelectorAll(".backlink-pane .search-result-file-title")].map((e) => e.innerText.split("\n")[0]) }),
    (r) => r.heads.length === 2 && r.files.includes("Ada Lovelace") && r.files.includes("Garden board.canvas") && r.files.includes("Reading List")],
  ["empty-backlinks", `await t.open('Inbox/Quick capture.md'); await t.side('backlink','right'); await t.sleep(700);`,
    () => ({ empty: [...document.querySelectorAll(".backlink-pane .search-empty-state")].map((e) => e.textContent) }), (r) => r.empty.length === 2],
  ["outgoing-links-panel", `await t.open('Welcome.md'); await t.side('outgoing-link','right'); await t.sleep(700);`,
    () => ({ items: [...document.querySelectorAll(".outgoing-link-item .tree-item-inner-text")].map((e) => e.textContent) }), (r) => r.items.length === 8 && r.items.includes("Now reading") && r.items.includes("Not created yet")],
  ["tags-panel", `await t.open('Welcome.md'); await t.side('tag','right'); await t.sleep(600);`,
    () => ({ tags: [...document.querySelectorAll(".tag-pane-tag > .tree-item-inner")].map((e) => e.innerText.trim()), counts: [...document.querySelectorAll(".tag-pane-tag-count")].map((e) => e.textContent) }),
    (r) => r.tags[0] === "garden" && r.counts[0] === "5" && r.tags.includes("shopping")],
  ["outline-panel", `await t.open('Projects/Garden Planner.md'); await t.side('outline','right'); await t.sleep(700);`,
    () => ({ heads: [...document.querySelectorAll(".workspace-leaf-content[data-type=outline] .tree-item-inner")].map((e) => e.textContent) }), (r) => r.heads.join("|") === "Garden Planner|Beds|Watering schedule|Code sample"],
  ["all-properties-panel", `await t.open('Welcome.md'); await t.side('all-properties','right'); await t.sleep(600);`,
    () => ({ props: [...document.querySelectorAll(".workspace-leaf-content[data-type=all-properties] .tree-item-self")].map((e) => e.innerText.replace(/\n/g, " ")) }), (r) => r.props[0] === "tags 11" && r.props.some((p) => p === "cssclasses 0")],
  ["file-properties-panel", `await t.open('Welcome.md'); await window.app.commands.executeCommandById('properties:open-local'); await t.sleep(700);`,
    () => ({ props: document.querySelectorAll(".workspace-leaf-content[data-type=file-properties] .metadata-property").length }), (r) => r.props === 6],
  ["bookmarks-panel", `await t.open('Welcome.md'); await t.side('bookmarks','left'); await t.sleep(500);`,
    () => ({ items: [...document.querySelectorAll(".workspace-leaf-content[data-type=bookmarks] .tree-item-inner-text")].map((e) => e.textContent) }), (r) => r.items.join("|") === "Welcome|Garden tasks|People|Ada Lovelace|Alan Turing"],
  ["file-explorer-expanded", `t.expandAll(); await t.open('People/Ada Lovelace.md'); await t.sleep(300);`,
    () => ({ rows: document.querySelectorAll(".nav-files-container .nav-file-title").length, tags: [...document.querySelectorAll(".nav-file-tag")].map((e) => e.textContent) }), (r) => r.rows >= 17 && r.tags.includes("png")],
  ["page-preview-hover", `await t.open('Welcome.md','reading'); await t.sleep(500);`, null, null, async () => {
    const link = await win.$(".workspace-leaf.mod-active a.internal-link");
    const b = await link.boundingBox();
    await win.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await win.keyboard.down("Control");
    await win.waitForTimeout(900);
    const r = await win.evaluate(() => ({ pop: !!document.querySelector(".popover.hover-popover .markdown-embed.is-loaded"), h1: document.querySelector(".popover h1")?.textContent }));
    check("page-preview-hover: popover shows the linked note", r.pop && /Garden Planner/.test(r.h1 ?? ""), JSON.stringify(r));
  }],
  ["context-menu-file", `t.expandAll(); await t.open('Welcome.md');`, null, null, async () => {
    const el = await win.$('.nav-file-title[data-path="Projects/Garden Planner.md"]');
    await el.click({ button: "right" });
    await win.waitForTimeout(400);
    const items = await win.evaluate(() => [...document.querySelectorAll(".menu .menu-item-title")].map((e) => e.textContent));
    check("context-menu-file: same items", ["Open in new tab", "Open to the right", "Open in new window", "Make a copy", "Move file to...", "Bookmark...", "Copy path", "Open in default app", "Show in system explorer", "Rename...", "Delete"].every((x) => items.includes(x)), items.join(", "));
  }],
  ["context-menu-folder", `t.expandAll(); await t.open('Welcome.md');`, null, null, async () => {
    const el = await win.$('.nav-folder-title[data-path="Projects"]');
    await el.click({ button: "right" });
    await win.waitForTimeout(400);
    const items = await win.evaluate(() => [...document.querySelectorAll(".menu .menu-item-title")].map((e) => e.textContent));
    check("context-menu-folder: same items", ["New note", "New folder", "Make a copy", "Move folder to...", "Search in folder", "Bookmark...", "Copy path", "Show in system explorer", "Rename...", "Delete"].every((x) => items.includes(x)), items.join(", "));
  }],
];

const shots = [];
for (const [name, setup, probe, ok, after] of scenes) {
  if (only && !only.test(name)) continue;
  try {
    await win.keyboard.up("Control").catch(() => {});
    await win.mouse.move(1000, 20);
    await win.evaluate(() => window.__t.reset());
    await win.evaluate(`(async()=>{const t=window.__t; ${setup}})()`);
    if (after) await after();
    if (probe) {
      const r = await win.evaluate(probe);
      check(name, ok(r), JSON.stringify(r).slice(0, 300));
    }
    shots.push([name, await shot(name)]);
    await win.keyboard.up("Control").catch(() => {});
    await win.keyboard.press("Escape").catch(() => {});
  } catch (e) {
    check(name, false, String(e?.stack ?? e).slice(0, 400));
  }
}

// Behaviour checks beyond screenshots.
if (!only) {
  try {
    const r = await win.evaluate(async () => {
      const t = window.__t;
      const app = window.app;
      await t.reset();
      const out = {};
      // Query block in reading view and live preview.
      await app.vault.create("Inbox/Query demo.md", "# Query demo\n\n```query\ntag:#garden\n```\n\nEnd.\n");
      await t.sleep(400);
      await t.open("Inbox/Query demo.md", "reading");
      await t.sleep(900);
      out.queryReading = document.querySelectorAll(".workspace-leaf.mod-active .internal-query .search-result").length;
      await t.open("Inbox/Query demo.md", "live");
      app.workspace.activeEditor.editor.setCursor({ line: 7, ch: 0 });
      await t.sleep(900);
      out.queryLive = document.querySelectorAll(".workspace-leaf.mod-active .cm-query-block .search-result").length;
      // Backlinks in document.
      await t.open("Projects/Garden Planner.md", "live");
      app.commands.executeCommandById("backlink:toggle-backlinks-in-document");
      await t.sleep(900);
      out.embedded = document.querySelectorAll(".workspace-leaf.mod-active .embedded-backlinks .search-result").length;
      app.commands.executeCommandById("backlink:toggle-backlinks-in-document");
      await t.sleep(200);
      out.embeddedOff = document.querySelectorAll(".workspace-leaf.mod-active .embedded-backlinks").length;
      // Unlinked mention -> Link button.
      const bl = await t.side("backlink", "right");
      await bl.view.backlink.update();
      const btn = document.querySelector(".backlink-pane .search-result-file-match-replace-button");
      btn?.click();
      await t.sleep(600);
      out.linked = (await app.vault.read(app.vault.getFileByPath("Projects/Reading List.md"))).match(/mentions \[\[[^\]]*Garden Planner[^\]]*\]\] without/) !== null;
      // Outline: move "Code sample" before "Beds".
      const ol = await t.side("outline", "right");
      await ol.view.move(3, 1, "before");
      await t.sleep(400);
      const gp = app.workspace.getMostRecentLeaf().view.editor.getValue();
      out.outlineMoved = gp.indexOf("## Code sample") < gp.indexOf("## Beds");
      out.outlineDebug = JSON.stringify({ file: ol.view.file?.path, n: ol.view.headings?.length, mode: app.workspace.getMostRecentLeaf()?.view?.getViewType() });
      // Bookmarks: add the active file, header button turns filled.
      app.bookmarks.add({ type: "file", path: "Projects/Garden Planner.md" });
      await t.sleep(500);
      out.headerBookmarked = !!document.querySelector(".workspace-leaf.mod-active .view-action.mod-bookmark.mod-bookmarked");
      out.bookmarksJson = JSON.parse(await app.vault.adapter.read(".obsidian/bookmarks.json")).items.length;
      // Status bar.
      out.status = [...document.querySelectorAll(".status-bar .plugin-backlink, .status-bar .plugin-properties, .status-bar .plugin-word-count")].map((e) => e.textContent);
      // Search "Copy results" text and bookmark search command.
      const sv = (await t.side("search", "left")).view;
      sv.setQuery("compost");
      await t.sleep(600);
      out.copyText = sv.results.toText().includes("Order compost");
      return out;
    });
    check("query block renders results (reading view)", r.queryReading >= 2, JSON.stringify(r.queryReading));
    check("query block renders results (live preview)", r.queryLive >= 2, JSON.stringify(r.queryLive));
    check("backlinks in document toggle", r.embedded >= 3 && r.embeddedOff === 0, `${r.embedded}/${r.embeddedOff}`);
    check("unlinked mention Link button rewrites the note", r.linked);
    check("outline drag moves the section", r.outlineMoved, r.outlineDebug);
    check("bookmark header button + bookmarks.json", r.headerBookmarked && r.bookmarksJson === 4, JSON.stringify([r.headerBookmarked, r.bookmarksJson]));
    check("status bar backlinks/properties/word count", /backlinks/.test(r.status[0] ?? "") && /properties/.test(r.status[1] ?? "") && /words/.test(r.status[2] ?? ""), r.status.join(" | "));
    check("copy search results", r.copyText);
  } catch (e) {
    check("behaviour checks", false, String(e?.stack ?? e).slice(0, 400));
  }
}

// Search speed on this vault (index already loaded).
const perf = await win.evaluate(async () => {
  const v = window.app.workspace.getLeavesOfType("search")[0]?.view;
  if (!v) return null;
  const t0 = performance.now();
  v.setQuery("the");
  await new Promise((r) => {
    const tick = () => (v.run ? setTimeout(tick, 5) : r());
    tick();
  });
  return { ms: Math.round(performance.now() - t0), docs: window.app.searchIndex.size };
});
console.log("search timing:", JSON.stringify(perf));

if (compare) {
  const [refDir, cmpDir] = compare;
  fs.mkdirSync(cmpDir, { recursive: true });
  for (const [name, ours] of shots) {
    const ref = path.join(refDir, `${name}-${theme}.png`);
    if (!fs.existsSync(ref)) continue;
    const htmlFile = path.join(tmp, "cmp.html");
    fs.writeFileSync(htmlFile, "<html><body></body></html>");
    const url = (p) => "file:///" + p.replace(/\\/g, "/");
    const b64 = await app.evaluate(async ({ BrowserWindow }, { htmlFile, a, b, name }) => {
      const w = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { webSecurity: false } });
      await w.loadFile(htmlFile);
      const data = await w.webContents.executeJavaScript(`(async () => {
        const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
        const [ra, rb] = await Promise.all([load(${JSON.stringify(a)}), load(${JSON.stringify(b)})]);
        const c = document.createElement("canvas"); c.width = 2580; c.height = 830;
        const g = c.getContext("2d"); g.fillStyle = "#666"; g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = "#fff"; g.font = "15px sans-serif";
        g.fillText("Obsidian 1.14.4 (reference): " + ${JSON.stringify(name)}, 8, 20); g.fillText("Bedrock (ours)", 1308, 20);
        g.drawImage(ra, 0, 30, 1280, 800); g.drawImage(rb, 1300, 30, 1280, 800);
        return c.toDataURL("image/png").split(",")[1];
      })()`);
      w.destroy();
      return data;
    }, { htmlFile, a: url(ref), b: url(ours), name });
    const file = path.join(cmpDir, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(b64, "base64"));
    console.log("  compare:", file);
  }
}

check("no renderer errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await app.close().catch(() => {});
if (!process.argv.includes("--keep")) fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} sidebar checks passed`);
process.exit(failed.length ? 1 : 0);
