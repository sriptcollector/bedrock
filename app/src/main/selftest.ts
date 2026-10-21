// `bedrock --selftest <vaultPath>`: index a vault the way the app does and print counts, timings
// and memory, then exit. Phase 1 runs the shared core indexer in this process (worker pool);
// phase 2 opens the real UI in a hidden window against the same vault and reports how long the
// renderer took to reach layout-ready with its metadata cache resolved.
import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs";
import { scanVault, indexFiles } from "../core/scan";
import { LinkIndex } from "../core/links";
import { resolveLinksFor } from "../core/resolve";
import { getAllTags } from "../core/parse";

const mb = (n: number) => Math.round((n / 1024 / 1024) * 10) / 10;

export async function runSelftest(vault: string): Promise<number> {
  if (!vault || !fs.existsSync(vault)) {
    console.error(`selftest: vault folder not found: ${vault || "(none given)"}\nusage: --selftest <vaultPath>`);
    return 2;
  }
  vault = path.resolve(vault);
  const out: Record<string, any> = { vault, version: app.getVersion() };
  const m0 = process.memoryUsage();
  const t0 = performance.now();
  const entries = await scanVault(vault);
  const t1 = performance.now();
  const files = entries.filter((e) => !e.folder).map((e) => e.path);
  const md = files.filter((f) => /\.md$/i.test(f));
  const indexed = await indexFiles(vault, files, { workerScript: path.join(__dirname, "index-worker.js") });
  const t2 = performance.now();
  const idx = new LinkIndex(files);
  let resolved = 0;
  let unresolved = 0;
  let links = 0;
  let embeds = 0;
  let headings = 0;
  let blocks = 0;
  let tasks = 0;
  let withFrontmatter = 0;
  const tags = new Set<string>();
  const errors = indexed.filter((f) => f.error);
  for (const f of indexed) {
    if (!f.meta) continue;
    const r = resolveLinksFor(f.path, f.meta, idx);
    resolved += Object.values(r.resolved).reduce((a, b) => a + b, 0);
    unresolved += Object.values(r.unresolved).reduce((a, b) => a + b, 0);
    links += f.meta.links?.length ?? 0;
    embeds += f.meta.embeds?.length ?? 0;
    headings += f.meta.headings?.length ?? 0;
    blocks += Object.keys(f.meta.blocks ?? {}).length;
    tasks += f.meta.listItems?.filter((l) => l.task !== undefined).length ?? 0;
    if (f.meta.frontmatter) withFrontmatter++;
    for (const t of getAllTags(f.meta) ?? []) tags.add(t.toLowerCase());
  }
  const t3 = performance.now();
  const m1 = process.memoryUsage();
  Object.assign(out, {
    folders: entries.length - files.length,
    files: files.length,
    notes: md.length,
    withFrontmatter,
    links,
    embeds,
    resolvedRefs: resolved,
    unresolvedRefs: unresolved,
    uniqueTags: tags.size,
    headings,
    blockIds: blocks,
    tasks,
    readErrors: errors.length,
    timingsMs: { scan: Math.round(t1 - t0), readParse: Math.round(t2 - t1), resolve: Math.round(t3 - t2), total: Math.round(t3 - t0) },
    memoryMB: { rssBefore: mb(m0.rss), rssAfter: mb(m1.rss), heapUsed: mb(m1.heapUsed) },
  });

  if (!process.argv.includes("--no-ui")) out.ui = await uiPhase(vault).catch((e) => ({ error: String(e?.message ?? e) }));
  console.log(JSON.stringify(out, null, 2));
  return errors.length ? 1 : 0;
}

async function uiPhase(vault: string): Promise<any> {
  const started = performance.now();
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, preload: path.join(__dirname, "preload.js") },
  });
  const result = new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("UI did not become ready within 120 s")), 120000);
    ipcMain.handleOnce("bedrock:selftest-report", (_e, r) => {
      clearTimeout(timer);
      resolve(r);
    });
  });
  ipcMain.removeHandler("bedrock:boot-info");
  ipcMain.handle("bedrock:boot-info", () => ({
    vaultPath: vault,
    vaultName: path.basename(vault),
    isMainVault: false,
    platform: process.platform,
    version: app.getVersion(),
    userData: app.getPath("userData"),
    resourcesPath: process.resourcesPath,
    smokeTest: true,
    selftest: true,
  }));
  await win.loadFile(path.join(__dirname, "renderer", "index.html"));
  const r = await result;
  const mem = await win.webContents.executeJavaScript("(()=>{const m=performance.memory;return m?{usedJSHeapMB:Math.round(m.usedJSHeapSize/1048576)}:null})()").catch(() => null);
  const metrics = app.getAppMetrics().find((m) => m.pid === win.webContents.getOSProcessId());
  win.destroy();
  return { ...r, wallMs: Math.round(performance.now() - started), rendererMemory: mem, rendererWorkingSetMB: metrics ? Math.round(metrics.memory.workingSetSize / 1024) : null };
}
