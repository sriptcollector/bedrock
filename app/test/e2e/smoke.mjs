// Smoke test: launch the built app against a temp copy of test/fixtures/vault (or a vault given
// with --vault <path>, which is COPIED first), open a note, toggle live preview / source /
// reading, split a pane, check external edits show up live, and save screenshots to test/out.
// Usage: node test/e2e/smoke.mjs [--vault <path>] [--keep]
import { _electron as electron } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../..");
const outDir = path.join(appDir, "test", "out");
fs.mkdirSync(outDir, { recursive: true });
const argVault = process.argv.includes("--vault") ? process.argv[process.argv.indexOf("--vault") + 1] : null;
const src = argVault ?? path.join(appDir, "test", "fixtures", "vault");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-smoke-"));
const vault = path.join(tmp, "vault");
const userData = path.join(tmp, "userdata");
const t0 = Date.now();
fs.cpSync(src, vault, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(p) });
console.log(`vault copy: ${vault} (${Date.now() - t0} ms)`);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
};

const electronPath = (await import("electron")).default;
const app = await electron.launch({
  executablePath: electronPath,
  args: [appDir, "--smoke-test", "--vault", vault],
  env: { ...process.env, BEDROCK_USER_DATA: userData, BEDROCK_NO_UPDATE: "1" },
});
const errors = [];
const win = await app.firstWindow();
win.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
win.on("pageerror", (e) => errors.push(String(e)));
await win.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  w.setSize(1400, 900);
  w.center();
});

const shot = async (name) => {
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(outDir, name + ".png") });
  console.log(`  screenshot: test/out/${name}.png`);
};
const run = (id) => win.evaluate((id) => window.app.commands.executeCommandById(id), id);

try {
  await win.waitForSelector(".workspace", { timeout: 30000 });
  const startup = await win.waitForFunction(() => window.app?.indexStats, null, { timeout: 120000 }).then((h) => h.jsonValue());
  check("app started and indexed", !!startup, JSON.stringify(startup));

  // Open a note via the quick switcher API path.
  const noteName = argVault ? await win.evaluate(() => window.app.vault.getMarkdownFiles().sort((a, b) => b.stat.size - a.stat.size)[0]?.path) : "Welcome.md";
  await win.evaluate((p) => window.app.workspace.getLeaf(false).openFile(window.app.vault.getFileByPath(p)), noteName);
  await win.waitForSelector('.workspace-leaf.mod-active .workspace-leaf-content[data-type="markdown"] .cm-content', { timeout: 15000 });
  await win.waitForTimeout(800);
  check("note opened in editor", true, noteName);
  await shot("01-live-preview");

  if (!argVault) {
    const lp = await win.evaluate(() => {
      const root = document.querySelector(".workspace-leaf.mod-active .markdown-source-view");
      return {
        livePreview: root.classList.contains("is-live-preview"),
        links: root.querySelectorAll(".cm-hmd-internal-link").length,
        checkboxes: root.querySelectorAll("input.task-list-item-checkbox").length,
        callouts: root.querySelectorAll(".callout").length,
        tables: root.querySelectorAll(".cm-table-widget table").length,
        math: root.querySelectorAll(".math .katex").length,
        properties: root.querySelectorAll(".metadata-property").length,
        inlineTitle: root.querySelector(".inline-title")?.textContent,
      };
    });
    check("live preview renders links/checkboxes/callouts/tables/math/properties", lp.livePreview && lp.links >= 3 && lp.checkboxes >= 2 && lp.callouts >= 1 && lp.tables >= 1 && lp.math >= 1 && lp.properties >= 4, JSON.stringify(lp));
  }

  await run("editor:toggle-source");
  await win.waitForTimeout(300);
  const src1 = await win.evaluate(() => !document.querySelector(".workspace-leaf.mod-active .markdown-source-view").classList.contains("is-live-preview"));
  check("source mode toggles", src1);
  await shot("02-source-mode");
  await run("editor:toggle-source");

  await run("markdown:toggle-preview");
  await win.waitForSelector(".workspace-leaf.mod-active .markdown-reading-view .el-h1, .workspace-leaf.mod-active .markdown-reading-view .el-p", { timeout: 10000 });
  await win.waitForTimeout(800);
  const rv = await win.evaluate(() => {
    const r = document.querySelector(".workspace-leaf.mod-active .markdown-reading-view");
    return { sections: r.querySelectorAll("[class^='el-']").length, callouts: r.querySelectorAll(".callout").length, mermaid: r.querySelectorAll(".mermaid svg").length, embeds: r.querySelectorAll(".internal-embed.is-loaded").length };
  });
  check("reading view renders", rv.sections > 3, JSON.stringify(rv));
  await shot("03-reading-view");
  await run("markdown:toggle-preview");

  await run("workspace:split-vertical");
  await win.waitForTimeout(600);
  const tabsCount = await win.evaluate(() => document.querySelectorAll(".mod-root .workspace-tabs").length);
  check("split right creates a second tab group", tabsCount === 2, `tab groups: ${tabsCount}`);
  await shot("04-split");

  // External change on disk shows up live (what the sync engine does).
  if (!argVault) {
    fs.writeFileSync(path.join(vault, "Beta.md"), "# Beta\n\nChanged on disk by another program.\n");
    fs.writeFileSync(path.join(vault, "Gamma from sync.md"), "# Gamma\n\nArrived from another device.\n");
    await win.evaluate(() => window.app.workspace.getLeaf(false).openFile(window.app.vault.getFileByPath("Beta.md")));
    const ok = await win
      .waitForFunction(() => window.app.vault.getFileByPath("Gamma from sync.md") && document.querySelector(".workspace-leaf.mod-active .cm-content")?.textContent.includes("Changed on disk"), null, { timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    check("external file changes appear live", ok);
    // Rename updates links.
    await win.evaluate(async () => {
      const f = window.app.vault.getFileByPath("Beta.md");
      window.app.vault.setConfig("alwaysUpdateLinks", true); // default is "ask"; skip the dialog here
      await window.app.fileManager.renameFile(f, "Beta renamed.md");
    });
    await win.waitForTimeout(500);
    const welcome = fs.readFileSync(path.join(vault, "Welcome.md"), "utf8");
    check("rename updates links in other notes", welcome.includes("[[Beta renamed]]") && welcome.includes("[[Beta renamed#Goals]]"), welcome.match(/\[\[Beta[^\]]*\]\]/g)?.join(", "));
  }

  await run("switcher:open");
  await win.keyboard.type("alp");
  await win.waitForTimeout(300);
  await shot("05-quick-switcher");
  await win.keyboard.press("Escape");

  await run("app:open-settings");
  await win.waitForTimeout(300);
  await shot("06-settings");
  await win.keyboard.press("Escape");

  await run("theme:toggle-light-dark");
  await win.waitForTimeout(300);
  await shot("07-light-theme");
  await run("theme:toggle-light-dark");

  await win.evaluate(() => window.app.workspace.saveLayout());
  const ws = JSON.parse(fs.readFileSync(path.join(vault, ".obsidian", "workspace.json"), "utf8"));
  check("workspace.json saved in Obsidian's shape", ws.main?.type === "split" && ws.left?.type === "split" && Array.isArray(ws.lastOpenFiles), `main children: ${ws.main?.children?.length}`);

  const mem = await app.evaluate(async ({ app: a }) => a.getAppMetrics().map((m) => ({ type: m.type, mb: Math.round(m.memory.workingSetSize / 1024) })));
  console.log("memory (working set MB):", JSON.stringify(mem));
  check("no renderer errors", errors.length === 0, errors.slice(0, 5).join(" | "));
} catch (e) {
  check("smoke run", false, String(e?.stack ?? e));
  console.log("renderer errors:", errors.join(" || "));
  await shot("99-failure").catch(() => {});
} finally {
  await app.close().catch(() => {});
  if (!process.argv.includes("--keep")) fs.rmSync(tmp, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
