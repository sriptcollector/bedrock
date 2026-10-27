// Onboarding end to end: a fresh main vault (temp) opens the setup guide by itself; copy prompt 1,
// walk the three pages, pick graph colors / app colors / a theme, finish, and check what was written
// (graph.json colour groups, appearance.json, the snippet, Bedrock/Instructions for Claude.md).
// Then opens the graph on a few notes with `icon` / `color` properties. Screenshots -> test/out.
// Usage: npm run build && node test/e2e/onboarding.mjs [--keep]
import { _electron as electron } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../..");
const outDir = path.join(appDir, "test", "out");
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-onboarding-"));
const vault = path.join(tmp, "Bedrock");
const userData = path.join(tmp, "userdata");

// A small wiki like the one prompt 1 asks Claude to write.
const note = (area, color, icon, activity, body) => `---\narea: ${area}\ncolor: "${color}"\nicon: ${icon}\ntags:\n  - area/${area.toLowerCase()}\n  - activity/${activity}\nupdated: 2026-10-26\n---\n${body}\n`;
const files = {
  "Home.md": note("Personal", "#9b5de5", "🏠", 4, "# Home\n\n[[About me]] · [[Bedrock app]] · [[Website]] · [[Running]] · [[Budget]] · [[Sam]] · [[TypeScript]]"),
  "About me.md": note("Personal", "#9b5de5", "🙂", 3, "Builder. See [[Bedrock app]], [[Running]]."),
  "Projects/Bedrock app.md": note("Work", "#ff6b35", "🪨", 4, "Notes app. With [[Sam]], uses [[TypeScript]]."),
  "Projects/Website.md": note("Projects", "#f7931e", "🌐", 2, "Site. [[TypeScript]]"),
  "Projects/Old game.md": note("Projects", "#f7931e", "🎮", 1, "Old. [[TypeScript]] [[Home]]"),
  "Health/Running.md": note("Health", "#e63946", "🏃", 3, "Running log. [[Home]]"),
  "Money/Budget.md": note("Money", "#e0a800", "💰", 2, "Budget. [[Home]]"),
  "People/Sam.md": note("People", "#ff7a9c", "🧑", 4, "Works on [[Bedrock app]]."),
  "Skills/TypeScript.md": note("Learning", "#d62989", "📘", 4, "Used in [[Bedrock app]], [[Website]]."),
};
for (const [p, t] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(vault, p)), { recursive: true });
  fs.writeFileSync(path.join(vault, p), t);
}
fs.mkdirSync(path.join(vault, ".obsidian"), { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
};

const electronPath = (await import("electron")).default;
const app = await electron.launch({
  executablePath: electronPath,
  args: [appDir],
  env: { ...process.env, BEDROCK_USER_DATA: userData, BEDROCK_MAIN_VAULT: vault, BEDROCK_NO_UPDATE: "1", BEDROCK_ONBOARDING: "1" },
});
const errors = [];
const win = await app.firstWindow();
win.on("pageerror", (e) => errors.push(String(e)));
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  w.setSize(1280, 860);
  w.center();
});
const shot = async (name) => {
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(outDir, name + ".png") });
  console.log(`  screenshot: test/out/${name}.png`);
};
const read = (p) => {
  try {
    return fs.readFileSync(path.join(vault, p), "utf8");
  } catch {
    return null;
  }
};

try {
  await win.waitForSelector(".workspace", { timeout: 30000 });
  await win.waitForSelector(".modal.bedrock-onboarding", { timeout: 15000 });
  check("setup guide opens on first start", true);
  const promptText = await win.$eval(".bedrock-ob-prompt-text", (el) => el.value);
  check("prompt 1 has the real vault path", promptText.includes(vault), vault);
  await shot("onboarding-1-light");
  await win.click(".bedrock-ob-copy");
  await win.waitForTimeout(300);
  check("copy button says Copied", (await win.textContent(".bedrock-ob-copy")) === "Copied");
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
  check("prompt is on the clipboard", clip === promptText);
  await win.waitForTimeout(300);
  check("instructions file created", (read("Bedrock/Instructions for Claude.md") ?? "").startsWith("# Instructions for Claude"));
  await win.click("text=I've prompted Claude");
  const daily = await win.$eval(".bedrock-ob-prompt-text", (el) => el.value);
  check("prompt 2 has the vault path", daily.includes(vault));
  await shot("onboarding-2-light");
  await win.click("text=I'm done, next step");
  await shot("onboarding-3-light");
  await win.click(".bedrock-ob-tile[data-name='Sunset']");
  await win.click(".bedrock-ob-tile.is-preset[data-name='Forest']"); // app colors preset: dark
  await win.waitForTimeout(300);
  check("app preset switches to dark right away", await win.evaluate(() => document.body.classList.contains("theme-dark")));
  await win.click(".bedrock-ob-tile[data-name='Pixelated']");
  await win.waitForTimeout(500);
  check("theme snippet applied right away", await win.evaluate(() => !!document.querySelector("style[data-snippet='bedrock-book-theme']")));
  await shot("onboarding-3-dark-pixelated");
  await win.click(".bedrock-ob-tile[data-name='Let Claude decide']");
  await win.waitForTimeout(300);
  await win.click("text=Finish");
  await win.waitForSelector(".modal.bedrock-onboarding", { state: "detached", timeout: 5000 });
  await win.waitForTimeout(800);
  const instr = read("Bedrock/Instructions for Claude.md") ?? "";
  check("preferences written", instr.includes("- Graph colors: Sunset") && instr.includes("- App colors: Forest"));
  check("theme request written", /- \[ \] Theme request \(\d{4}-\d{2}-\d{2}\): design a personal Bedrock theme/.test(instr));
  check("recolor request written (scheme changed from default)", instr.includes("- [ ] Colors changed"));
  const graph = JSON.parse(read(".obsidian/graph.json") ?? "{}");
  check("graph.json has area colour groups", (graph.colorGroups ?? []).some((g) => g.query === "tag:#area/work tag:#activity/4"), `${graph.colorGroups?.length} groups`);
  const appearance = JSON.parse(read(".obsidian/appearance.json") ?? "{}");
  check("appearance.json has accent + dark", appearance.accentColor === "#2f9e63" && appearance.theme === "obsidian", JSON.stringify(appearance));
  check("Claude theme: book snippet off", !(appearance.enabledCssSnippets ?? []).includes("bedrock-book-theme"));
  check("Finish opened Home.md", await win.evaluate(() => window.app.workspace.getActiveFile()?.path === "Home.md"));
  check("done flag stored", await win.evaluate(() => !!localStorage.getItem("bedrock-onboarding-done")));
  // Graph with icons and area colours.
  await win.evaluate(() => window.app.commands.executeCommandById("graph:open"));
  await win.waitForTimeout(4000);
  const icons = await win.evaluate(() => {
    const v = window.app.workspace.getLeavesOfType("graph")[0]?.view;
    return v?.engine?.renderer?.graph?.icons?.filter(Boolean).length ?? 0;
  });
  check("graph nodes carry icons", icons >= 8, String(icons));
  await shot("onboarding-graph-dark");
  // Reopen from the command palette and switch to light + Animals for a second look.
  await win.evaluate(() => window.app.commands.executeCommandById("bedrock:open-onboarding"));
  await win.waitForSelector(".modal.bedrock-onboarding");
  await win.click(".bedrock-ob-dot >> nth=2");
  await win.click(".bedrock-ob-mode:has-text('Light')");
  await win.click(".bedrock-ob-tile[data-name='Halloween']");
  await win.waitForTimeout(500);
  await shot("onboarding-3-light-halloween");
  await win.keyboard.press("Escape");
  await win.waitForTimeout(300);
  await shot("onboarding-graph-light-halloween");
  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("run", false, String(e?.stack ?? e));
  await shot("onboarding-failure").catch(() => {});
} finally {
  await app.close();
  if (!process.argv.includes("--keep")) fs.rmSync(tmp, { recursive: true, force: true });
  else console.log("kept", tmp);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
