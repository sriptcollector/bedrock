// Sidebar performance on a synthetic 10,000-note vault: search index load, query times,
// backlinks (with unlinked mentions) and the tags view. Prints JSON.
// Usage: node test/e2e/sidebar-perf.mjs [count]
import { _electron as electron } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../..");
const count = Number(process.argv[2] ?? 10000);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-sidebar-perf-"));
const vault = path.join(tmp, "vault");
execFileSync(process.execPath, [path.join(appDir, "scripts", "gen-bench-vault.mjs"), vault, String(count)]);
const electronPath = (await import("electron")).default;
const app = await electron.launch({ executablePath: electronPath, args: [appDir, "--vault", vault], env: { ...process.env, BEDROCK_USER_DATA: path.join(tmp, "ud"), BEDROCK_NO_UPDATE: "1" } });
const win = await app.firstWindow();
try {
  await win.waitForFunction(() => window.app?.indexStats, null, { timeout: 180000 });
  const out = await win.evaluate(async () => {
    const app = window.app;
    const t0 = performance.now();
    await app.searchIndex.ensureLoaded();
    const indexMs = Math.round(performance.now() - t0);
    const leaf = await app.workspace.ensureSideLeaf("search", "left", { reveal: true });
    const v = leaf.view;
    const time = async (q) => {
      const s = performance.now();
      v.setQuery(q);
      await new Promise((r) => {
        const tick = () => (v.run ? setTimeout(tick, 2) : r());
        tick();
      });
      return { q, ms: Math.round(performance.now() - s), count: v.containerEl.querySelector(".search-results-result-count span").textContent };
    };
    const queries = [];
    for (const q of ["garden", "stone river", '"quiet amber"', "/sig.al/", "tag:#garden", "path:\"Area 3\" field", "line:(stone layer)", "[tags:river]", "-garden north"]) queries.push(await time(q));
    const note = app.vault.getMarkdownFiles()[42];
    await app.workspace.getLeaf(false).openFile(note);
    const bl = await app.workspace.ensureSideLeaf("backlink", "right", { reveal: true });
    const s1 = performance.now();
    await bl.view.backlink.update();
    const backlinkMs = Math.round(performance.now() - s1);
    const tag = await app.workspace.ensureSideLeaf("tag", "right", { reveal: true });
    const s2 = performance.now();
    tag.view.render();
    const tagsMs = Math.round(performance.now() - s2);
    return { notes: app.vault.getMarkdownFiles().length, indexMs, queries, backlinkMs, tagsMs, heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576) };
  });
  console.log(JSON.stringify(out, null, 1));
} finally {
  await app.close().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
}
