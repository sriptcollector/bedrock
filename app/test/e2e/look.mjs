// Look parity: launches the built app on a COPY of the demo vault in a 1280x800 window, puts it in the
// same state as each reference screenshot (same scenes as the reference capture), saves our screenshot,
// and with --ref <dir> writes a sheet per screen: reference | ours | pixel diff (red = differs).
// Usage: node test/e2e/look.mjs [--vault <dir>] [--ref <refDir>] [--out <dir>] [--theme light,dark]
//                               [--only <regex>] [--settings]
// Prints one line per screen with the share of differing pixels.
import { _electron as electron } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../..");
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const src = arg("--vault") ?? "C:/Users/orion/tbv-scratch/demo-vault";
const refDir = arg("--ref");
const outDir = arg("--out") ?? path.join(appDir, "test", "out", "look");
const themes = (arg("--theme") ?? "light,dark").split(",");
const only = arg("--only") ? new RegExp(arg("--only")) : null;
const settingsMode = process.argv.includes("--settings");
fs.mkdirSync(outDir, { recursive: true });
if (!fs.existsSync(src)) {
  console.log(`demo vault not found at ${src}; pass --vault <dir>`);
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Scenes mirror the reference capture (same notes, same state). [name, setup, mouse?]
const S = [
  ["main-live-preview", `t.expandFolders(true); await t.open('Welcome.md','live');`],
  ["main-live-preview-sidebars", `t.expandFolders(true); await t.open('Projects/Garden Planner.md','live'); await t.right('backlink');`],
  ["source-mode", `await t.open('Welcome.md','source');`],
  ["reading-view", `await t.open('Welcome.md','reading');`],
  ["live-preview-cursor-in-markup", `await t.open('Welcome.md','live'); const ed=app.workspace.activeEditor.editor; ed.focus(); ed.setCursor({line:9,ch:30}); await t.sleep(300);`],
  ["file-explorer-expanded", `t.expandFolders(true); await t.open('People/Ada Lovelace.md','live'); await t.sleep(300);`],
  ["search-results", `await t.open('Welcome.md','live'); const l=await t.left('search'); l.view.setExplainSearch?.(false); l.view.setQuery('garden'); await t.sleep(1200);`],
  ["search-operators", `await t.open('Welcome.md','live'); const l=await t.left('search'); l.view.setExplainSearch?.(true); l.view.setQuery('tag:#garden path:Projects "water"'); await t.sleep(1200);`],
  ["search-empty", `await t.open('Welcome.md','live'); const l=await t.left('search'); l.view.setQuery(''); l.view.setExplainSearch?.(false); await t.sleep(500);`],
  ["backlinks-panel", `await t.open('Projects/Garden Planner.md','live'); const l=await t.right('backlink'); await l.setViewState({type:'backlink',state:{backlinkCollapsed:false,unlinkedCollapsed:false}}); await t.sleep(900);`],
  ["outgoing-links-panel", `await t.open('Welcome.md','live'); await t.right('outgoing-link'); await t.sleep(700);`],
  ["tags-panel", `await t.open('Welcome.md','live'); await t.right('tag'); await t.sleep(500);`],
  ["outline-panel", `await t.open('Projects/Garden Planner.md','live'); await t.right('outline'); await t.sleep(500);`],
  ["all-properties-panel", `await t.open('Welcome.md','live'); await t.right('all-properties'); await t.sleep(500);`],
  ["file-properties-panel", `await t.open('Welcome.md','live'); t.cmd('properties:open-local'); await t.sleep(600);`],
  ["bookmarks-panel", `await t.open('Welcome.md','live'); await t.left('bookmarks'); await t.sleep(300); document.querySelectorAll('.workspace-leaf-content[data-type=bookmarks] .tree-item.is-collapsed > .tree-item-self').forEach(e=>e.click()); await t.sleep(300);`],
  ["properties-editor", `await t.open('Welcome.md','live'); await t.sleep(300);`, null, ".workspace-leaf.mod-active .view-content"],
  ["embeds-live", `app.vault.setConfig('mermaid', true); await t.open('Ideas/Zettel 0003 Embeds.md','live'); await t.sleep(1200);`],
  ["embeds-reading", `await t.open('Ideas/Zettel 0003 Embeds.md','reading'); await t.sleep(1200);`],
  ["embeds-reading-scrolled", `await t.open('Ideas/Zettel 0003 Embeds.md','reading'); await t.sleep(1000); const s=document.querySelector('.workspace-leaf.mod-active .markdown-preview-view'); s.scrollTop=900; await t.sleep(800);`],
  ["callouts", `await t.open('Welcome.md','live'); const s=document.querySelector('.workspace-leaf.mod-active .cm-scroller'); s.scrollTop=400; await t.sleep(600);`],
  ["tables-code-live", `await t.open('Projects/Garden Planner.md','live'); const s=document.querySelector('.workspace-leaf.mod-active .cm-scroller'); s.scrollTop=150; await t.sleep(600);`],
  ["tables-code-reading", `await t.open('Projects/Garden Planner.md','reading'); const s=document.querySelector('.workspace-leaf.mod-active .markdown-preview-view'); s.scrollTop=150; await t.sleep(600);`],
  ["math", `await t.open('People/Alan Turing.md','live'); await t.sleep(1200);`],
  ["graph-view", `await t.open('Welcome.md','live'); t.cmd('graph:open'); await t.sleep(2500); document.querySelector('.workspace-leaf.mod-active .graph-controls.is-close')?.click(); await t.sleep(1500);`],
  ["graph-view-settings", `await t.open('Welcome.md','live'); t.cmd('graph:open'); await t.sleep(2000); const c=document.querySelector('.workspace-leaf.mod-active .graph-controls'); if(c?.classList.contains('is-close')) c.click(); await t.sleep(300); document.querySelectorAll('.workspace-leaf.mod-active .graph-controls .tree-item.is-collapsed > .tree-item-self').forEach(e=>e.click()); await t.sleep(1500);`],
  ["local-graph", `await t.open('Projects/Garden Planner.md','live'); t.cmd('graph:open-local'); await t.sleep(2500);`],
  ["canvas", `await t.open('Garden board.canvas','live'); await t.sleep(1500); app.workspace.activeLeaf.view.canvas?.zoomToFit?.(); await t.sleep(1500);`],
  ["command-palette", `await t.open('Welcome.md','live'); t.cmd('command-palette:open'); await t.sleep(500);`],
  ["command-palette-query", `await t.open('Welcome.md','live'); t.cmd('command-palette:open'); await t.sleep(300); const i=document.querySelector('.prompt-input'); i.value='toggle'; i.dispatchEvent(new Event('input',{bubbles:true})); await t.sleep(400);`],
  ["quick-switcher", `await t.open('Welcome.md','live'); await t.open('People/Ada Lovelace.md','live'); t.cmd('switcher:open'); await t.sleep(500);`],
  ["quick-switcher-query", `await t.open('Welcome.md','live'); t.cmd('switcher:open'); await t.sleep(300); const i=document.querySelector('.prompt-input'); i.value='ada'; i.dispatchEvent(new Event('input',{bubbles:true})); await t.sleep(400);`],
  ["insert-template", `await t.open('Inbox/Empty note.md','live'); app.workspace.activeEditor.editor.focus(); t.cmd('insert-template'); await t.sleep(500);`],
  ["daily-note", `await t.open('Daily/2026-10-21.md','live');`],
  ["stacked-tabs", `await t.open('Welcome.md','live'); await t.open('Projects/Garden Planner.md','live','tab'); await t.open('People/Ada Lovelace.md','live','tab'); await t.open('People/Alan Turing.md','live','tab'); app.workspace.activeLeaf.parent.setStacked(true); await t.sleep(700);`],
  ["tabs", `await t.open('Welcome.md','live'); await t.open('Projects/Garden Planner.md','live','tab'); await t.open('People/Ada Lovelace.md','live','tab'); await t.sleep(400);`],
  ["split-panes", `await t.open('Welcome.md','live'); const l2=app.workspace.getLeaf('split','vertical'); await l2.openFile(app.vault.getAbstractFileByPath('Projects/Garden Planner.md')); const l3=app.workspace.createLeafBySplit(l2,'horizontal'); await l3.openFile(app.vault.getAbstractFileByPath('Garden board.canvas')); await t.sleep(1200);`],
  ["context-menu-file", `t.expandFolders(true); await t.open('Welcome.md','live'); await t.sleep(200);`, [{ type: "right", sel: '.nav-file-title[data-path="Projects/Garden Planner.md"]' }]],
  ["context-menu-folder", `t.expandFolders(true); await t.open('Welcome.md','live');`, [{ type: "right", sel: '.nav-folder-title[data-path="Projects"]' }]],
  ["context-menu-editor", `await t.open('Welcome.md','live'); app.workspace.activeEditor.editor.focus(); await t.sleep(200);`, [{ type: "right", sel: ".workspace-leaf.mod-active .cm-line", idx: 4 }]],
  ["context-menu-tab", `await t.open('Welcome.md','live'); await t.open('Projects/Garden Planner.md','live','tab');`, [{ type: "right", sel: ".workspace-tab-header.is-active" }]],
  ["context-menu-link", `await t.open('Welcome.md','reading'); await t.sleep(300);`, [{ type: "right", sel: ".workspace-leaf.mod-active a.internal-link" }]],
  ["more-options-menu", `await t.open('Welcome.md','live');`, [{ type: "click", sel: '.workspace-leaf.mod-active .view-action[aria-label="More options"]' }]],
  ["tooltip-ribbon", `await t.open('Welcome.md','live');`, [{ type: "hover", sel: ".side-dock-ribbon-action", idx: 1, wait: 1200 }]],
  ["page-preview-hover", `await t.open('Welcome.md','reading'); await t.sleep(300);`, [{ type: "hover", sel: ".workspace-leaf.mod-active a.internal-link", idx: 0, wait: 1500, ctrl: true }]],
  ["notice", `await t.open('Welcome.md','live'); new (app.plugins.apiModule().Notice)('Demo notice: this is how a Notice looks.', 0); await t.sleep(500);`],
  ["empty-new-tab", `await t.sleep(200);`],
  ["empty-note", `await t.open('Inbox/Empty note.md','live');`],
  ["empty-backlinks", `await t.open('Inbox/Quick capture.md','live'); await t.right('backlink');`],
  ["rename-modal", `await t.open('Welcome.md','live'); t.cmd('workspace:edit-file-title'); await t.sleep(300);`],
  ["delete-confirm", `await t.open('Inbox/Quick capture.md','live'); t.cmd('app:delete-file'); await t.sleep(400);`],
  ["file-recovery", `await t.open('Welcome.md','live'); t.cmd('file-recovery:open'); await t.sleep(600);`],
  ["ribbon-collapsed-sidebars", `await t.open('Welcome.md','live'); app.workspace.leftSplit.collapse(); await t.sleep(400);`],
  ["editor-search", `await t.open('Welcome.md','live'); app.workspace.activeEditor.editor.focus(); t.cmd('editor:open-search-replace'); await t.sleep(300); const i=document.querySelector('.document-search-input'); if(i){i.value='garden'; i.dispatchEvent(new Event('input',{bubbles:true}));} await t.sleep(400);`],
  ["link-suggest", `await t.open('Inbox/Empty note.md','live'); const ed=app.workspace.activeEditor.editor; ed.focus(); ed.replaceRange('[[Ga',{line:0,ch:0}); ed.setCursor({line:0,ch:4}); await t.sleep(800);`, null, null, `app.workspace.activeEditor?.editor?.setValue('');`],
  ["tag-suggest", `await t.open('Inbox/Empty note.md','live'); const ed=app.workspace.activeEditor.editor; ed.focus(); ed.replaceRange('#ga',{line:0,ch:0}); ed.setCursor({line:0,ch:3}); await t.sleep(800);`, null, null, `app.workspace.activeEditor?.editor?.setValue('');`],
  ["bases-new", `await t.open('Welcome.md','live'); await t.sleep(200); t.cmd('bases:new-file'); await t.sleep(1500);`, null, null, `for(const f of app.vault.getFiles().filter(f=>f.extension==='base')) await app.vault.delete(f);`],
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-look-"));
const vault = path.join(tmp, "demo-vault");
fs.cpSync(src, vault, { recursive: true });
fs.rmSync(path.join(vault, ".obsidian", "workspace.json"), { force: true });
const userData = path.join(tmp, "userdata");

const electronPath = (await import("electron")).default;
const app = await electron.launch({ executablePath: electronPath, args: [appDir, "--vault", vault], env: { ...process.env, BEDROCK_USER_DATA: userData, BEDROCK_NO_UPDATE: "1" } });
const win = await app.firstWindow();
const errors = [];
win.on("pageerror", (e) => errors.push(String(e)));
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  w.unmaximize();
  w.setContentSize(1280, 800);
  w.center();
  // Keep painting when another window covers this one (screenshots wait for a frame).
  w.webContents.setBackgroundThrottling(false);
});
await win.waitForSelector(".workspace", { timeout: 30000 });
await win.waitForFunction(() => window.app?.workspace?.layoutReady && window.app?.indexStats, null, { timeout: 120000 });
await sleep(800);

await win.evaluate(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ws = () => window.app.workspace;
  const t = {
    sleep,
    async reset() {
      document.querySelectorAll(".menu, .popover, .tooltip, .notice").forEach((m) => m.remove());
      for (let i = 0; i < 5; i++) {
        const m = document.querySelector(".modal-container");
        if (!m) break;
        m.querySelector(".modal-close-button")?.click();
        await sleep(60);
      }
      document.querySelectorAll(".modal-container").forEach((m) => m.remove());
      const leaves = [];
      ws().iterateRootLeaves((l) => leaves.push(l));
      for (const l of leaves) l.detach();
      await sleep(80);
      const keep = new Set(["backlink", "outgoing-link", "tag", "all-properties", "outline", "file-explorer", "search", "bookmarks"]);
      const side = [];
      ws().iterateAllLeaves((l) => side.push(l));
      for (const l of side) if (l.getRoot?.() !== ws().rootSplit && !keep.has(l.getViewState().type)) l.detach();
      const rest = [];
      ws().iterateRootLeaves((l) => rest.push(l));
      const leaf = rest[0] ?? ws().getLeaf(true);
      await leaf.setViewState({ type: "empty", state: {} });
      leaf.parent?.setStacked?.(false);
      ws().setActiveLeaf(leaf, { focus: true });
      ws().leftSplit.expand();
      ws().rightSplit.collapse();
      ws().leftSplit.setSize?.(300);
      ws().rightSplit.setSize?.(300);
      const fe = ws().getLeavesOfType("file-explorer")[0];
      if (fe) await ws().revealLeaf(fe);
      t.expandFolders(false);
      await sleep(200);
    },
    expandFolders(open = true) {
      const v = ws().getLeavesOfType("file-explorer")[0]?.view;
      if (!v) return;
      if (v.expanded) {
        v.expanded.clear();
        if (open) for (const f of window.app.vault.getAllFolders(false)) v.expanded.add(f.path);
        v.rebuild?.();
      }
    },
    async open(p, mode = "live", newLeaf = false) {
      const leaf = newLeaf ? ws().getLeaf(newLeaf) : ws().getMostRecentLeaf() ?? ws().getLeaf(false);
      const state = mode === "reading" ? { mode: "preview" } : { mode: "source", source: mode === "source" };
      await leaf.openFile(window.app.vault.getAbstractFileByPath(p), { active: true, state });
      ws().setActiveLeaf(leaf, { focus: true });
      await sleep(350);
      return leaf;
    },
    async right(type) {
      return t.side(type, "right");
    },
    async left(type) {
      return t.side(type, "left");
    },
    async side(type, side) {
      const leaf = await ws().ensureSideLeaf(type, side, { reveal: true });
      (side === "left" ? ws().leftSplit : ws().rightSplit).expand();
      await sleep(400);
      return leaf;
    },
    cmd(id) {
      return window.app.commands.executeCommandById(id);
    },
    center(sel, idx = 0) {
      const e = document.querySelectorAll(sel)[idx];
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    },
    rect(sel) {
      const e = document.querySelector(sel);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    },
  };
  window.__t = t;
});

// Sheet: reference | ours | diff, composed in a hidden window's canvas (no image dependencies).
const sheetWin = await app.evaluate(async ({ BrowserWindow }) => {
  const w = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { offscreen: false } });
  await w.loadURL("about:blank");
  return w.id;
});
let sheetPage = null;
for (let i = 0; i < 20 && !sheetPage; i++) {
  sheetPage = app.windows().find((p) => p.url() === "about:blank" && p !== win) ?? null;
  if (!sheetPage) await sleep(150);
}
async function makeSheet(refFile, oursFile, outFile, title) {
  const a = "data:image/png;base64," + fs.readFileSync(refFile).toString("base64");
  const b = "data:image/png;base64," + fs.readFileSync(oursFile).toString("base64");
  const r = await sheetPage.evaluate(
    async ({ a, b, title }) => {
      const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const W = Math.max(ia.width, ib.width), H = Math.max(ia.height, ib.height);
      const get = (img) => { const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, W, H); x.drawImage(img, 0, 0); return x.getImageData(0, 0, W, H); };
      const da = get(ia), db = get(ib);
      const dd = new ImageData(W, H);
      let diff = 0;
      for (let p = 0; p < da.data.length; p += 4) {
        const d = Math.max(Math.abs(da.data[p] - db.data[p]), Math.abs(da.data[p + 1] - db.data[p + 1]), Math.abs(da.data[p + 2] - db.data[p + 2]));
        const lum = (da.data[p] * 0.3 + da.data[p + 1] * 0.59 + da.data[p + 2] * 0.11);
        if (d > 32) { diff++; dd.data[p] = 230; dd.data[p + 1] = 20; dd.data[p + 2] = 60; }
        else { const g = 200 + lum * 0.2; dd.data[p] = g; dd.data[p + 1] = g; dd.data[p + 2] = g; }
        dd.data[p + 3] = 255;
      }
      const L = 24, G = 8;
      const c = document.createElement("canvas");
      c.width = W * 3 + G * 2; c.height = H + L;
      const x = c.getContext("2d");
      x.fillStyle = "#333"; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = "#fff"; x.font = "14px sans-serif";
      const pct = ((diff / (W * H)) * 100).toFixed(1);
      x.fillText("Obsidian 1.14.4 (reference): " + title, 6, 17);
      x.fillText("Bedrock (ours)", W + G + 6, 17);
      x.fillText("pixel diff (red = differs): " + pct + "%", 2 * (W + G) + 6, 17);
      x.drawImage(ia, 0, L);
      x.drawImage(ib, W + G, L);
      x.putImageData(dd, 2 * (W + G), L);
      return { url: c.toDataURL("image/png"), pct };
    },
    { a, b, title },
  );
  fs.writeFileSync(outFile, Buffer.from(r.url.split(",")[1], "base64"));
  return r.pct;
}

async function mouse(act) {
  const pt = await win.evaluate(([s, i]) => window.__t.center(s, i), [act.sel, act.idx ?? 0]);
  if (!pt) return console.warn("  no element for", act.sel);
  if (act.type === "hover") {
    await win.mouse.move(pt.x, pt.y);
    if (act.ctrl) await win.keyboard.down("Control");
    await win.waitForTimeout(act.wait ?? 800);
  } else {
    await win.mouse.click(pt.x, pt.y, { button: act.type === "right" ? "right" : "left" });
    await win.waitForTimeout(act.wait ?? 500);
  }
}

// --probe <scene> <js expression>: set up one scene, evaluate the expression, print the JSON result.
if (process.argv.includes("--probe")) {
  const [scene, expr] = [arg("--probe"), process.argv[process.argv.indexOf("--probe") + 2]];
  const sc = S.find((s) => s[0] === scene);
  if (themes[0] === "dark") await win.evaluate(() => window.app.changeTheme("obsidian"));
  if (fs.existsSync(path.join("C:/Users/orion/tbv-scratch/scripts/measure-lib.js"))) await win.evaluate(fs.readFileSync("C:/Users/orion/tbv-scratch/scripts/measure-lib.js", "utf8"));
  await win.evaluate(() => window.__t.reset());
  if (sc) await win.evaluate(`(async()=>{const t=window.__t; const app=window.app; ${sc[1]}})()`);
  for (const m of sc?.[2] ?? []) await mouse(m);
  await sleep(400);
  console.log(JSON.stringify(await win.evaluate(`(async()=>{ return ${expr} })()`), null, 1));
  if (arg("--shot")) await win.screenshot({ path: arg("--shot") });
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
}

// --vars <css-variables.json>: list CSS variables whose computed value on body differs from the
// reference (docs/reference/css-variables.json), per theme -> <out>/_vars-diff.txt
if (arg("--vars")) {
  const ref = JSON.parse(fs.readFileSync(arg("--vars"), "utf8"));
  const lines = [];
  for (const theme of themes) {
    await win.evaluate((th) => window.app.changeTheme(th === "dark" ? "obsidian" : "moonstone"), theme);
    await sleep(200);
    const names = Object.keys(ref[theme]);
    const ours = await win.evaluate((ns) => { const cs = getComputedStyle(document.body); return ns.map((n) => cs.getPropertyValue(n).trim()); }, names);
    // Normalise colours by resolving both through a probe element.
    const norm = await win.evaluate(([ns, a, b]) => {
      const el = document.createElement("div"); document.body.appendChild(el);
      const res = (v) => { if (!v) return ""; el.style.color = ""; el.style.color = v; if (!el.style.color) return v.replace(/\s+/g, " "); return getComputedStyle(el).color; };
      const out = ns.map((n, i) => [n, res(a[i]), res(b[i]), a[i], b[i]]);
      el.remove(); return out;
    }, [names, names.map((n) => ref[theme][n]), ours]);
    lines.push(`## ${theme}`);
    for (const [n, r, o, rr, oo] of norm) if (r !== o) lines.push(`${n}: ref ${rr || "(unset)"} | ours ${oo || "(unset)"}`);
  }
  fs.writeFileSync(path.join(outDir, "_vars-diff.txt"), lines.join("\n"));
  console.log(lines.length + " lines");
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
}

// --measure <scriptsDir> <reference measure.json>: measure the same elements as the reference
// measurement script and list every box / style that differs (written to <out>/_measure-diff.txt).
const measureArgs = process.argv.includes("--measure") ? [arg("--measure"), process.argv[process.argv.indexOf("--measure") + 2]] : null;
if (measureArgs) {
  const [dir, refJson] = measureArgs;
  await win.evaluate(fs.readFileSync(path.join(dir, "measure-lib.js"), "utf8"));
  const msrc = fs.readFileSync(path.join(dir, "measure.js"), "utf8");
  const STATES = new Function(msrc.slice(msrc.indexOf("const L ="), msrc.indexOf("(async () =>")) + "; return STATES;")();
  const ref = JSON.parse(fs.readFileSync(refJson, "utf8"));
  const lines = [];
  const KEYS = ["padding", "margin", "gap", "font-size", "font-weight", "line-height", "letter-spacing", "color", "background-color", "border-top", "border-right", "border-bottom", "border-left", "border-radius", "box-shadow", "opacity", "text-transform"];
  for (const theme of themes) {
    await win.evaluate((th) => window.app.changeTheme(th === "dark" ? "obsidian" : "moonstone"), theme);
    for (const st of STATES) {
      if (only && !only.test(st.name) && !only.test(st.scene)) continue;
      const sc = S.find((s) => s[0] === st.scene);
      await win.mouse.move(1000, 20);
      await win.evaluate(() => window.__t.reset());
      await win.evaluate(`(async()=>{const t=window.__t; const app=window.app; ${sc[1]}})()`).catch((e) => lines.push(`!! ${st.scene}: ${e.message}`));
      for (const m of sc[2] ?? []) await mouse(m);
      await sleep(400);
      lines.push(`\n## ${st.name} (${theme})`);
      for (const [label, sel] of st.items) {
        const r = ref.states[st.name]?.[theme]?.[label]?.v;
        const o = await win.evaluate((s) => window.__m.measure(s), sel);
        if (!r && !o) continue;
        if (!r || !o) { lines.push(`${label}: ${r ? "MISSING in ours" : "extra in ours"} (${sel})`); continue; }
        const d = [];
        if (r.rect.some((v, i) => Math.abs(v - o.rect[i]) > 1.5)) d.push(`rect ${r.rect.join(",")} vs ${o.rect.join(",")}`);
        for (const k of KEYS) if ((r[k] ?? "") !== (o[k] ?? "")) d.push(`${k}: ${r[k] ?? "-"} vs ${o[k] ?? "-"}`);
        if ((r.icon?.name ?? "") !== (o.icon?.name ?? "") || (r.icon?.size ?? 0) !== (o.icon?.size ?? 0)) d.push(`icon ${r.icon?.name}/${r.icon?.size} vs ${o.icon?.name}/${o.icon?.size}`);
        if (d.length) lines.push(`${label} (${sel}): ${d.join("; ")}`);
      }
      await win.keyboard.up("Control").catch(() => {});
      await win.keyboard.press("Escape").catch(() => {});
    }
  }
  fs.writeFileSync(path.join(outDir, "_measure-diff.txt"), lines.join("\n"));
  console.log(lines.join("\n"));
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
}

const report = [];
for (const theme of themes) {
  await win.evaluate((th) => window.app.changeTheme(th === "dark" ? "obsidian" : "moonstone"), theme);
  await sleep(300);
  if (settingsMode) {
    await runSettings(theme);
    continue;
  }
  for (const [name, setup, mice, clip, cleanup] of S) {
    if (only && !only.test(name)) continue;
    try {
      await win.mouse.move(1000, 20);
      await win.keyboard.up("Control").catch(() => {});
      await win.evaluate(() => window.__t.reset());
      await win.evaluate(`(async()=>{const t=window.__t; const app=window.app; ${setup}})()`);
      for (const m of mice ?? []) await mouse(m);
      await sleep(400);
      const file = path.join(outDir, `${name}-${theme}.bedrock.png`);
      const rect = clip ? await win.evaluate((s) => window.__t.rect(s), clip) : null;
      try {
        await win.screenshot({ path: file, clip: rect ?? undefined, timeout: 15000 });
      } catch {
        // The window wasn't painting (covered or unfocused): bring it forward and try again.
        await app.evaluate(({ BrowserWindow }) => {
          const w = BrowserWindow.getAllWindows()[0];
          w.show();
          w.focus();
          w.webContents.invalidate();
        });
        await sleep(500);
        await win.screenshot({ path: file, clip: rect ?? undefined, timeout: 30000 });
      }
      let pct = "";
      const ref = refDir && path.join(refDir, `${name}-${theme}.png`);
      if (ref && fs.existsSync(ref)) pct = await makeSheet(ref, file, path.join(outDir, `${name}-${theme}.png`), name);
      report.push([name, theme, pct]);
      console.log(`${name} ${theme} ${pct}%`);
    } catch (e) {
      console.log(`${name} ${theme} FAIL ${String(e?.message ?? e).slice(0, 300)}`);
    }
    try {
      if (cleanup) await win.evaluate(`(async()=>{const app=window.app; ${cleanup}})()`);
      await win.keyboard.up("Control").catch(() => {});
      await win.keyboard.press("Escape");
    } catch {}
  }
}

async function runSettings(theme) {
  await win.evaluate(() => { window.app.setting.close?.(); window.app.setting.open(); });
  await sleep(1200);
  const pop = app.windows().find((p) => p !== win && p !== sheetPage && /about:blank/.test(p.url()) && p !== sheetPage);
  const ids = await win.evaluate(() => [...window.app.setting.settingTabs, ...window.app.setting.pluginTabs].map((t) => t.id));
  for (const id of ids) {
    if (only && !only.test(id)) continue;
    await win.evaluate((i) => window.app.setting.openTabById(i), id);
    await sleep(600);
    const page = pop ?? win;
    const geo = await page.evaluate(() => { const c = document.querySelector(".vertical-tab-content"); c.scrollTop = 0; return { sh: c.scrollHeight, ch: c.clientHeight }; });
    const pages = Math.min(25, Math.max(1, Math.ceil((geo.sh - 20) / geo.ch)));
    for (let p = 0; p < pages; p++) {
      await page.evaluate((y) => { document.querySelector(".vertical-tab-content").scrollTop = y; }, p * (geo.ch - 40));
      await sleep(250);
      const name = `settings-${id}${pages > 1 ? "-p" + (p + 1) : ""}`;
      const file = path.join(outDir, `${name}-${theme}.bedrock.png`);
      try {
        await page.screenshot({ path: file, timeout: 15000 });
      } catch {
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => (w.webContents.setBackgroundThrottling(false), w.webContents.invalidate())));
        await sleep(500);
        await page.screenshot({ path: file, timeout: 30000 });
      }
      let pct = "";
      const ref = refDir && path.join(refDir, `${name}-${theme}.png`);
      if (ref && fs.existsSync(ref)) pct = await makeSheet(ref, file, path.join(outDir, `${name}-${theme}.png`), name);
      report.push([name, theme, pct]);
      console.log(`${name} ${theme} ${pct}%`);
    }
  }
  await win.evaluate(() => window.app.setting.close?.());
  await sleep(500);
}

fs.writeFileSync(path.join(outDir, settingsMode ? "_report-settings.json" : "_report.json"), JSON.stringify(report, null, 1));
if (errors.length) console.log("page errors:\n" + errors.slice(0, 10).join("\n"));
await app.close();
fs.rmSync(tmp, { recursive: true, force: true });
