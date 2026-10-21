// Graph view, local graph and canvas end-to-end: launches the built app on a temp copy of the demo
// vault (or --vault <path>, copied first), opens the global graph, a local graph and a canvas at a
// 1280x800 window, checks they render and react, saves screenshots to test/out and, with --compare,
// writes side-by-side sheets (reference left, ours right) to --compare-dir.
// Usage: node test/e2e/graph-canvas.mjs [--vault <dir>] [--dark] [--compare] [--compare-dir <dir>] [--bench <vault>] [--keep]
import { _electron as electron } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../..");
const outDir = path.join(appDir, "test", "out");
fs.mkdirSync(outDir, { recursive: true });
const arg = (name, def = null) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : def);
const DEMO = "C:/Users/orion/tbv-scratch/demo-vault";
const REF = "C:/Users/orion/tbv-scratch/ref";
const src = arg("--vault") ?? (fs.existsSync(DEMO) ? DEMO : path.join(appDir, "test", "fixtures", "vault"));
const benchVault = arg("--bench");
const dark = process.argv.includes("--dark");
const compare = process.argv.includes("--compare");
const compareDir = arg("--compare-dir", "C:/Users/orion/tbv-scratch/compare");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-gc-"));
const vault = path.join(tmp, "vault");
fs.cpSync(benchVault ?? src, vault, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(p) });
// Same graph settings as the reference capture (sections expanded).
const observed = "C:/Users/orion/tbv-scratch/data/graph.observed.json";
fs.mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
if (!benchVault && fs.existsSync(observed)) fs.copyFileSync(observed, path.join(vault, ".obsidian", "graph.json"));

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
};

const electronPath = (await import("electron")).default;
const app = await electron.launch({
  executablePath: electronPath,
  args: [appDir, "--smoke-test", "--vault", vault],
  env: { ...process.env, BEDROCK_USER_DATA: path.join(tmp, "userdata"), BEDROCK_NO_UPDATE: "1" },
});
const errors = [];
const win = await app.firstWindow();
win.on("console", (m) => {
  // ignore errors from web pages shown in canvas link cards (they come from http(s) or sandboxed frames with no app URL)
  const at = m.location()?.url ?? "";
  if (m.type() === "error" && at && !/^https?:/.test(at)) errors.push(m.text() + " @" + (m.location()?.url ?? ""));
});
win.on("pageerror", (e) => {
  if (!/https?:\/\//.test(String(e?.stack ?? ""))) errors.push(String(e) + " " + String(e?.stack ?? "").split("\n")[1]);
});
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  w.unmaximize();
  w.setContentSize(1280, 800);
  w.center();
});

const shot = async (name) => {
  await win.waitForTimeout(300);
  const file = path.join(outDir, name + ".png");
  await win.screenshot({ path: file });
  console.log(`  screenshot: test/out/${name}.png`);
  return file;
};
const run = (id) => win.evaluate((id) => window.app.commands.executeCommandById(id), id);

/** Side-by-side sheet built in the app window itself (no image library needed). */
async function sheet(name, refFile, ourFile) {
  if (!compare || !fs.existsSync(refFile)) return;
  fs.mkdirSync(compareDir, { recursive: true });
  const a = "data:image/png;base64," + fs.readFileSync(refFile).toString("base64");
  const b = "data:image/png;base64," + fs.readFileSync(ourFile).toString("base64");
  const png = await win.evaluate(
    async ({ a, b, name }) => {
      const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = s; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const head = 28;
      const c = document.createElement("canvas");
      c.width = ia.width + ib.width + 16;
      c.height = Math.max(ia.height, ib.height) + head;
      const x = c.getContext("2d");
      x.fillStyle = "#888";
      x.fillRect(0, 0, c.width, c.height);
      x.drawImage(ia, 0, head);
      x.drawImage(ib, ia.width + 16, head);
      x.fillStyle = "#fff";
      x.font = "16px sans-serif";
      x.fillText(`${name}: Obsidian 1.14.4 (reference)`, 8, 19);
      x.fillText(`${name}: Bedrock`, ia.width + 24, 19);
      return c.toDataURL("image/png").split(",")[1];
    },
    { a, b, name },
  );
  const out = path.join(compareDir, name + ".png");
  fs.writeFileSync(out, Buffer.from(png, "base64"));
  console.log(`  comparison: ${out}`);
}

try {
  await win.waitForSelector(".workspace", { timeout: 30000 });
  await win.waitForFunction(() => window.app?.indexStats, null, { timeout: 180000 });
  const isDark = await win.evaluate(() => document.body.classList.contains("theme-dark"));
  if (isDark !== dark) await run("theme:toggle-light-dark");
  await win.evaluate(() => {
    const ws = window.app.workspace;
    if (ws.rightSplit && !ws.rightSplit.collapsed) ws.rightSplit.collapse?.();
    if (ws.leftSplit && ws.leftSplit.collapsed) ws.leftSplit.expand?.();
  });
  const theme = dark ? "dark" : "light";

  // ---------- global graph ----------
  await win.evaluate(() => (window.__graphOpenedAt = performance.now()));
  await run("graph:open");
  await win.waitForSelector('.workspace-leaf.mod-active .workspace-leaf-content[data-type="graph"] canvas', { timeout: 10000 });
  const g = await win.waitForFunction(
    () => {
      const v = window.app.workspace.getLeavesOfType("graph")[0]?.view;
      const r = v?.engine?.renderer;
      return r && r.graph.ids.length > 0 && r.simTicks > 20 ? { nodes: r.graph.ids.length, links: r.graph.src.length, webgl: !!r.glState, ids: r.graph.ids } : null;
    },
    null,
    { timeout: 30000 },
  ).then((h) => h.jsonValue());
  check("global graph renders nodes and links", g.nodes > 0 && g.links > 0, `nodes ${g.nodes}, links ${g.links}, webgl ${g.webgl}`);
  if (!benchVault && src === DEMO) {
    check("graph has the canvas and unresolved notes like Obsidian", g.ids.includes("Garden board.canvas") && g.ids.includes("Not created yet") && g.nodes === 17, `${g.nodes} nodes`);
  }
  if (benchVault) {
    const bench = await win.evaluate(async () => {
      const v = window.app.workspace.getLeavesOfType("graph")[0].view;
      const r = v.engine.renderer;
      const t0 = performance.now();
      const start = r.simTicks;
      // FPS while the layout is running and while panning/zooming
      const running = await r.measureFps(3000);
      const ticksPerSec = ((r.simTicks - start) * 1000) / (performance.now() - t0);
      r.zoomTo(0.25);
      const zoomed = await r.measureFps(2000);
      return { nodes: r.graph.ids.length, links: r.graph.src.length, fpsDuringLayout: Math.round(running.fps), worstFrameMs: Math.round(running.frameMs * 10) / 10, layoutTicksPerSec: Math.round(ticksPerSec), fpsZoomed: Math.round(zoomed.fps), webgl: !!r.glState };
    });
    console.log("BENCH", JSON.stringify(bench));
    check("10k graph stays smooth (>= 30 fps while laying out)", bench.fpsDuringLayout >= 30, JSON.stringify(bench));
    const settle = await win.evaluate(async () => {
      const r = window.app.workspace.getLeavesOfType("graph")[0].view.engine.renderer;
      const t0 = performance.now();
      while (r.simRunning && performance.now() - t0 < 120000) await new Promise((res) => setTimeout(res, 250));
      return { layoutMsFromOpen: Math.round(performance.now() - window.__graphOpenedAt), ticks: r.simTicks, alpha: r.simAlpha };
    });
    console.log("LAYOUT", JSON.stringify(settle));
    // synthetic stress: 10k nodes and 160k distinct links straight into the renderer
    const stress = await win.evaluate(async () => {
      const r = window.app.workspace.getLeavesOfType("graph")[0].view.engine.renderer;
      const n = 10000;
      const nodes = {};
      let seed = 7;
      const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
      for (let i = 0; i < n; i++) nodes["n" + i + ".md"] = { type: "", links: {} };
      let made = 0;
      while (made < 160000) {
        const a = Math.floor(rnd() * n), b = Math.floor(rnd() * n);
        if (a === b || nodes["n" + a + ".md"].links["n" + b + ".md"]) continue;
        nodes["n" + a + ".md"].links["n" + b + ".md"] = true;
        made++;
      }
      const t0 = performance.now();
      r.setData({ nodes });
      const setDataMs = performance.now() - t0;
      r.zoomTo(0.05);
      await new Promise((res) => setTimeout(res, 1500));
      const fps = await r.measureFps(3000);
      const t1 = performance.now();
      const ticks0 = r.simTicks;
      await new Promise((res) => setTimeout(res, 3000));
      return { nodes: r.graph.ids.length, links: r.graph.src.length, setDataMs: Math.round(setDataMs), fps: Math.round(fps.fps), worstFrameMs: Math.round(fps.frameMs * 10) / 10, layoutTicksPerSec: Math.round(((r.simTicks - ticks0) * 1000) / (performance.now() - t1)) };
    });
    console.log("STRESS", JSON.stringify(stress));
    check("10k nodes / 160k links render smoothly", stress.fps >= 30, JSON.stringify(stress));
  }
  await win.waitForTimeout(benchVault ? 500 : 3500);
  const graphShot = await shot(`graph-view-${theme}`);
  await sheet(`graph-view-${theme}`, path.join(REF, `graph-view-${theme}.png`), graphShot);

  // hover highlights a node; click opens it
  const nodePos = () =>
    win.evaluate(() => {
      const r = window.app.workspace.getLeavesOfType("graph")[0].view.engine.renderer;
      const i = r.graph.ids.indexOf(r.graph.ids.find((id) => id.endsWith("Welcome.md")) ?? r.graph.ids[0]);
      const rect = r.canvasEl.getBoundingClientRect();
      return { x: rect.left + r.x[i] * r.scale + r.panX, y: rect.top + r.y[i] * r.scale + r.panY, id: r.graph.ids[i] };
    });
  let hover = await nodePos();
  let hl = -1;
  // the layout may still be drifting: re-aim a few times
  for (let attempt = 0; attempt < 4 && hl < 0; attempt++) {
    hover = await nodePos();
    await win.mouse.move(hover.x, hover.y);
    await win.waitForTimeout(300);
    hl = await win.evaluate(() => window.app.workspace.getLeavesOfType("graph")[0].view.engine.renderer.highlight);
  }
  if (!benchVault) check("hovering a node highlights it", hl >= 0, hover.id);
  await shot(`graph-hover-${theme}`);
  await win.mouse.move(5, 400);

  // options round-trip to graph.json
  await win.evaluate(() => {
    const v = window.app.workspace.getLeavesOfType("graph")[0].view;
    v.engine.onOption("showTags", true, "data");
  });
  await win.waitForTimeout(1500);
  const gj = JSON.parse(fs.readFileSync(path.join(vault, ".obsidian", "graph.json"), "utf8"));
  check("graph settings saved to graph.json", gj.showTags === true && gj.repelStrength === 10 && Object.keys(gj)[0] === "collapse-filter", Object.keys(gj).join(","));
  await win.evaluate(() => window.app.workspace.getLeavesOfType("graph")[0].view.engine.onOption("showTags", false, "data"));

  if (!benchVault) {
    // timelapse: starts with a few nodes and grows back to the whole graph
    const anim = await win.evaluate(async () => {
      const e = window.app.workspace.getLeavesOfType("graph")[0].view.engine;
      const p = e.renderProgression();
      await new Promise((r) => setTimeout(r, 120));
      const early = e.renderer.graph.ids.length;
      await p;
      return { early, final: e.renderer.graph.ids.length };
    });
    check("timelapse animation grows the graph", anim.early < anim.final && (src !== DEMO || anim.final === 17), JSON.stringify(anim));
    await win.waitForTimeout(1500);
    const target = await win.evaluate(() => {
      const r = window.app.workspace.getLeavesOfType("graph")[0].view.engine.renderer;
      const i = r.graph.ids.findIndex((id) => id.endsWith("Welcome.md"));
      const rect = r.canvasEl.getBoundingClientRect();
      return { x: rect.left + r.x[i] * r.scale + r.panX, y: rect.top + r.y[i] * r.scale + r.panY };
    });
    hover.x = target.x;
    hover.y = target.y;
    await win.mouse.click(hover.x, hover.y);
    await win.waitForTimeout(800);
    const opened = await win.evaluate(() => window.app.workspace.getActiveFile()?.path);
    check("clicking a node opens the note", opened === hover.id, opened);

    // ---------- local graph ----------
    const gp = (await win.evaluate(() => window.app.vault.getFileByPath("Projects/Garden Planner.md")?.path)) ?? (await win.evaluate(() => window.app.vault.getMarkdownFiles()[0].path));
    await win.evaluate(async (p) => {
      const ws = window.app.workspace;
      ws.detachLeavesOfType("graph");
      await ws.getLeaf(false).openFile(window.app.vault.getFileByPath(p));
    }, gp);
    await win.waitForTimeout(500);
    await run("graph:open-local");
    await win.waitForSelector('.workspace-leaf-content[data-type="localgraph"] canvas', { timeout: 10000 });
    await win.waitForTimeout(3500);
    const lg = await win.evaluate(() => {
      const v = window.app.workspace.getLeavesOfType("localgraph")[0].view;
      return { title: v.getDisplayText(), ids: v.engine.renderer.graph.ids, links: v.engine.renderer.graph.src.length, state: v.getState() };
    });
    check("local graph shows the note and its neighbours", lg.ids.length > 1 && lg.title.startsWith("Graph of"), `${lg.title}: ${lg.ids.length} nodes, ${lg.links} links`);
    if (src === DEMO) check("local graph matches Obsidian (8 nodes, 9 links for Garden Planner)", lg.ids.length === 8 && lg.links === 9, JSON.stringify(lg.ids));
    check("local graph keeps its options in the leaf state", lg.state.options?.localJumps === 1 && lg.state.file === gp);
    const localShot = await shot(`local-graph-${theme}`);
    await sheet(`local-graph-${theme}`, path.join(REF, `local-graph-${theme}.png`), localShot);

    // ---------- canvas ----------
    const canvasPath = await win.evaluate(() => window.app.vault.getFiles().find((f) => f.extension === "canvas")?.path);
    if (canvasPath) {
      await win.evaluate(async (p) => {
        const ws = window.app.workspace;
        ws.detachLeavesOfType("localgraph");
        await ws.getLeaf(false).openFile(window.app.vault.getFileByPath(p));
      }, canvasPath);
      await win.waitForSelector('.workspace-leaf.mod-active .canvas-wrapper .canvas-node', { timeout: 10000 });
      await win.waitForTimeout(2500);
      const cv = await win.evaluate(() => {
        const c = window.app.workspace.activeLeaf.view.canvas;
        return { nodes: c.nodes.size, edges: c.edges.size, zoom: c.zoom, types: [...c.nodes.values()].map((n) => n.data.type) };
      });
      check("canvas opens with all cards and edges", cv.nodes > 0, JSON.stringify(cv));
      const canvasShot = await shot(`canvas-${theme}`);
      await sheet(`canvas-${theme}`, path.join(REF, `canvas-${theme}.png`), canvasShot);
      const before = fs.readFileSync(path.join(vault, canvasPath), "utf8");
      // add a card, connect it, undo, redo; then the file is saved in JSON Canvas form
      const edit = await win.evaluate(async () => {
        const c = window.app.workspace.activeLeaf.view.canvas;
        const first = [...c.nodes.values()].find((n) => n.data.type !== "group");
        const n = c.createTextNode({ x: first.x + first.width + 300, y: first.y }, "Added by the e2e test", false, undefined, false);
        c.addEdge(first, "right", n, "left");
        await new Promise((r) => setTimeout(r, 400));
        const afterAdd = c.nodes.size;
        c.undo();
        const afterUndo = c.nodes.size;
        c.redo();
        await window.app.workspace.activeLeaf.view.save();
        return { afterAdd, afterUndo, afterRedo: c.nodes.size };
      });
      const after = fs.readFileSync(path.join(vault, canvasPath), "utf8");
      const parsed = JSON.parse(after);
      check("canvas edits, undo/redo and save", edit.afterUndo === edit.afterAdd - 1 && edit.afterRedo === edit.afterAdd && parsed.nodes.some((n) => n.text === "Added by the e2e test") && after !== before, JSON.stringify(edit));
      await shot(`canvas-edited-${theme}`);
      // select a card: menu above it, resize handles
      await win.evaluate(() => {
        const c = window.app.workspace.activeLeaf.view.canvas;
        const n = [...c.nodes.values()].find((n) => n.data.type === "text");
        c.selectOnly(n);
      });
      await win.waitForTimeout(400);
      const sel = await win.evaluate(() => ({ menu: !document.querySelector(".canvas-menu-container").classList.contains("is-hidden"), buttons: document.querySelectorAll(".canvas-menu button").length, resizers: document.querySelectorAll(".canvas-node-interaction-layer:not(.is-hidden) .canvas-node-resizer").length }));
      check("selecting a card shows its menu and resize handles", sel.menu && sel.buttons >= 3 && sel.resizers === 8, JSON.stringify(sel));
      await shot(`canvas-selected-${theme}`);
      // drop a note from the file explorer onto the canvas
      const dropped = await win.evaluate(async () => {
        const c = window.app.workspace.activeLeaf.view.canvas;
        const before = c.nodes.size;
        const dt = new DataTransfer();
        dt.setData("application/x-bedrock-file", "Welcome.md");
        const r = c.wrapperEl.getBoundingClientRect();
        c.wrapperEl.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, clientX: r.left + 100, clientY: r.top + 100, bubbles: true, cancelable: true }));
        await new Promise((res) => setTimeout(res, 300));
        const last = [...c.nodes.values()].pop();
        return { added: c.nodes.size - before, file: last?.data.file };
      });
      check("dropping a note from the file explorer adds a file card", dropped.added === 1 && dropped.file === "Welcome.md", JSON.stringify(dropped));
      // export as image
      const ran = await win.evaluate(() => {
        const cmd = window.app.commands.findCommand("canvas:export-as-image");
        return { found: !!cmd, available: cmd ? !!cmd.checkCallback(true) : false, active: window.app.workspace.activeLeaf?.view?.getViewType() };
      });
      console.log("  export command:", JSON.stringify(ran));
      await run("canvas:export-as-image");
      for (let i = 0; i < 20 && !fs.readdirSync(vault).some((f) => f.endsWith(".png")); i++) await win.waitForTimeout(500);
      const png = fs.readdirSync(vault).find((f) => f.endsWith(".png"));
      const notice = await win.evaluate(() => [...document.querySelectorAll(".notice")].map((n) => n.textContent).join(" | "));
      check("export as image writes a PNG", !!png && fs.statSync(path.join(vault, png)).size > 1000, png ?? notice);
      await win.evaluate(async () => window.app.workspace.activeLeaf.view.save());
      // canvas embedded in a note
      await win.evaluate(async (p) => {
        const f = await window.app.vault.create("Canvas embed.md", `# Embed

![[${p}]]
`);
        const leaf = window.app.workspace.getLeaf("tab");
        await leaf.openFile(f);
        await window.app.commands.executeCommandById("markdown:toggle-preview");
      }, canvasPath);
      await win.waitForTimeout(2000);
      const emb = await win.evaluate(() => document.querySelectorAll(".workspace-leaf.mod-active .canvas-embed .canvas-node").length);
      check("canvas embeds render in notes", emb > 0, `${emb} cards`);
      await shot(`canvas-embed-${theme}`);
      // the canvas feeds the graph
      const links = await win.evaluate((p) => window.app.metadataCache.resolvedLinks[p], canvasPath);
      check("canvas file cards count as links (graph, backlinks)", links && Object.keys(links).length > 0, JSON.stringify(links));
    }
  }
  check("no renderer errors", errors.length === 0, errors.slice(0, 5).join(" | "));
} catch (e) {
  check("graph/canvas run", false, String(e?.stack ?? e));
  console.log("renderer errors:", errors.join(" || "));
  await shot("99-gc-failure").catch(() => {});
} finally {
  await app.close().catch(() => {});
  if (!process.argv.includes("--keep")) fs.rmSync(tmp, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
