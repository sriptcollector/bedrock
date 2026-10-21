// Web viewer + Slides core plugins, end to end on a temp vault (needs network for the web page).
// Usage: node test/e2e/webviewer-slides.mjs [--url https://example.com] [--shots <dir>]
import { _electron as electron } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../..");
const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const url = arg("--url") ?? "https://example.com/";
const shots = arg("--shots") ?? path.join(appDir, "test", "out");
fs.mkdirSync(shots, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-wv-"));
const vault = path.join(tmp, "vault");
fs.mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
fs.writeFileSync(path.join(vault, ".obsidian", "core-plugins.json"), JSON.stringify({ "file-explorer": true, webviewer: true, slides: true }));
fs.writeFileSync(path.join(vault, "Deck.md"), "---\ntags: [x]\n---\n# First slide\n\nHello **world**\n\n---\n\n## Second slide\n\n- one\n- two\n\n```\n---\n```\n\n---\n\n## Third\n\n[link](https://example.com)\n");

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
};
const electronPath = (await import("electron")).default;
const app = await electron.launch({ executablePath: electronPath, args: [appDir, "--vault", vault], env: { ...process.env, BEDROCK_USER_DATA: path.join(tmp, "ud"), BEDROCK_NO_UPDATE: "1" } });
const win = await app.firstWindow();
const errors = [];
win.on("pageerror", (e) => errors.push(String(e)));
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  w.unmaximize();
  w.setContentSize(1280, 800);
});
await win.waitForFunction(() => window.app?.workspace?.layoutReady && window.app?.internalPlugins?.getPluginById?.("webviewer")?.enabled, null, { timeout: 60000 });

try {
  // Web viewer: open a page, address bar, title, security of the guest page.
  const r1 = await win.evaluate(async (u) => {
    const app = window.app;
    app.commands.executeCommandById("webviewer:open");
    await new Promise((r) => setTimeout(r, 800));
    const v = app.workspace.activeLeaf.view;
    if (!v.navigate) return { type: v.getViewType(), leaves: app.workspace.getLeavesOfType("webviewer").length, reg: !!app.viewRegistry.getViewCreatorByType?.("webviewer") };
    v.navigate(u);
    for (let i = 0; i < 100 && !v.title; i++) await new Promise((r) => setTimeout(r, 200));
    const guest = await v.webview.executeJavaScript("({ req: typeof require, proc: typeof process, title: document.title })");
    return { type: v.getViewType(), title: v.title, addr: document.querySelector(".workspace-leaf.mod-active .webviewer-address input")?.value, tab: app.workspace.activeLeaf.tabHeaderInnerTitleEl.textContent, guest, state: app.workspace.activeLeaf.getViewState().state };
  }, url);
  check("web viewer opens a page in a tab", r1.type === "webviewer" && !!r1.title && r1.tab === r1.title, JSON.stringify(r1));
  check("guest page has no Node access (sandboxed, isolated)", r1.guest.req === "undefined" && r1.guest.proc === "undefined");
  await win.screenshot({ path: path.join(shots, "webviewer.png") });

  // Reader mode + save to vault.
  const r3 = await win.evaluate(async () => {
    const app = window.app;
    app.commands.executeCommandById("webviewer:toggle-reader-mode");
    await new Promise((r) => setTimeout(r, 1500));
    const v = app.workspace.activeLeaf.view;
    const readerText = document.querySelector(".workspace-leaf.mod-active .reader-mode-content")?.textContent ?? "";
    const before = new Set(app.vault.getFiles().map((f) => f.path));
    app.commands.executeCommandById("webviewer:save-to-vault");
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 150));
      if (app.vault.getFiles().some((f) => !before.has(f.path))) break;
    }
    const nf = app.vault.getFiles().find((f) => !before.has(f.path));
    return { mode: v.mode, readerText: readerText.slice(0, 120), saved: nf?.path, text: nf ? (await app.vault.read(nf)).slice(0, 300) : null };
  });
  check("reader mode shows the article", r3.mode === "reader" && r3.readerText.length > 20, r3.readerText);
  check("save to vault writes the page as Markdown", !!r3.saved && /\w/.test(r3.text ?? ""), `${r3.saved}: ${JSON.stringify(r3.text)}`);

  // Zoom, address bar focus, history, search, settings tab.
  const r6 = await win.evaluate(async () => {
    const app = window.app;
    const leaf = app.workspace.getLeavesOfType("webviewer")[0];
    app.workspace.setActiveLeaf(leaf, { focus: true });
    const v = leaf.view;
    v.setMode("webview");
    const run = (id) => app.commands.executeCommandById(id);
    run("webviewer:zoom-in");
    run("webviewer:zoom-in");
    const z1 = v.webview.getZoomLevel();
    run("webviewer:zoom-out");
    const z2 = v.webview.getZoomLevel();
    run("webviewer:zoom-reset");
    const z3 = v.webview.getZoomLevel();
    run("webviewer:focus-address-bar");
    const focused = document.activeElement === document.querySelector(".workspace-leaf.mod-active .webviewer-address input");
    run("webviewer:open-history");
    await new Promise((r) => setTimeout(r, 300));
    const hist = [...document.querySelectorAll(".prompt .suggestion-item .suggestion-note")].map((e) => e.textContent);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const before = app.workspace.getLeavesOfType("webviewer").length;
    run("webviewer:search");
    await new Promise((r) => setTimeout(r, 300));
    const input = document.querySelector(".workspace-leaf.mod-active .webviewer-address input");
    input.value = "bedrock notes";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const searched = app.workspace.activeLeaf.view.url;
    const p = app.internalPlugins.getPluginById("webviewer");
    const rows = p.impl.settingTab(p).getSettingDefinitions().map((d) => d.name);
    return { z1, z2, z3, focused, hist, before, searched, rows };
  });
  check("zoom in/out/reset", r6.z1 === 2 && r6.z2 === 1 && r6.z3 === 0, JSON.stringify([r6.z1, r6.z2, r6.z3]));
  check("focus address bar", r6.focused);
  check("history lists visited pages", r6.hist.includes("https://example.com/"), JSON.stringify(r6.hist));
  check("search the web uses the search engine", /^https:\/\/duckduckgo\.com\/\?q=bedrock%20notes$/.test(r6.searched), r6.searched);
  check("settings tab rows", r6.rows.length === 9 && r6.rows[0] === "Open external links" && r6.rows[8] === "Web viewer data", r6.rows.join(", "));

  // Ad blocker: requests to hosts on the filter lists fail inside the page.
  const r8 = await win.evaluate(async () => {
    const { ipcRenderer } = require("electron");
    const app = window.app;
    const v = app.workspace.getLeavesOfType("webviewer")[0].view;
    v.navigate("https://example.com/");
    await new Promise((r) => setTimeout(r, 2500));
    const probe = () => v.webview.executeJavaScript("fetch('https://www.google-analytics.com/analytics.js', {mode:'no-cors'}).then(() => 'loaded', () => 'blocked')");
    await ipcRenderer.invoke("bedrock:webviewer-call", "setAdblock", false);
    const off = await probe();
    await ipcRenderer.invoke("bedrock:webviewer-call", "setAdblock", true);
    let on = "";
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      on = await probe();
      if (on === "blocked") break;
    }
    return { off, on };
  });
  check("ad blocker blocks listed hosts (EasyPrivacy)", r8.off === "loaded" && r8.on === "blocked", JSON.stringify(r8));

  // "Open external links": a web link in a note opens in a web viewer tab.
  const r7 = await win.evaluate(async () => {
    const app = window.app;
    const leaf = app.workspace.getLeaf("tab");
    await leaf.openFile(app.vault.getFileByPath("Deck.md"), { state: { mode: "preview" } });
    await new Promise((r) => setTimeout(r, 600));
    const before = app.workspace.getLeavesOfType("webviewer").length;
    leaf.view.containerEl.querySelector("a.external-link")?.click();
    await new Promise((r) => setTimeout(r, 800));
    return { before, after: app.workspace.getLeavesOfType("webviewer").length, url: app.workspace.activeLeaf.view.url };
  });
  check("web links from notes open in the web viewer", r7.after === r7.before + 1 && /example\.com/.test(r7.url ?? ""), JSON.stringify(r7));

  // Slides.
  const r4 = await win.evaluate(async () => {
    const app = window.app;
    await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath("Deck.md"));
    await new Promise((r) => setTimeout(r, 400));
    app.commands.executeCommandById("slides:start");
    await new Promise((r) => setTimeout(r, 800));
    const c = document.querySelector(".slides-container");
    const sections = [...document.querySelectorAll(".slides-container .slides > section")].map((s) => s.querySelector("h1,h2")?.textContent);
    const present0 = document.querySelector(".slides-container section.present h1")?.textContent;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
    const present1 = document.querySelector(".slides-container section.present h2")?.textContent;
    return { open: !!c, sections, present0, present1 };
  });
  check("slides: one slide per part, frontmatter and fenced --- ignored", r4.open && r4.sections.length === 3 && r4.present0 === "First slide" && r4.present1 === "Second slide", JSON.stringify(r4));
  await win.screenshot({ path: path.join(shots, "slides.png") });
  const r5 = await win.evaluate(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    return !!document.querySelector(".slides-container");
  });
  check("slides: Esc closes", r5 === false);
} catch (e) {
  check("run", false, String(e?.stack ?? e));
}
check("no renderer errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await app.close();
fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
