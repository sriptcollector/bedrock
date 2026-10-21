// Settings e2e: opens Settings (its own window), screenshots every tab and sub-page in light and
// dark to test/out/settings-<tab>-<theme>.png, and checks the settings files are written the way
// Obsidian writes them (only non-default values, app.json vs appearance.json).
// Usage: node test/e2e/settings-tabs.mjs   (after npm run build)
import { _electron as electron } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../..");
const outDir = path.join(appDir, "test", "out");
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-settings-e2e-"));
const vault = path.join(tmp, "vault");
fs.cpSync(path.join(appDir, "test", "fixtures", "vault"), vault, { recursive: true });
fs.rmSync(path.join(vault, ".obsidian", "app.json"), { force: true });
fs.rmSync(path.join(vault, ".obsidian", "appearance.json"), { force: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
};
const electronPath = (await import("electron")).default;
const app = await electron.launch({
  executablePath: electronPath,
  args: [appDir, "--smoke-test", "--vault", vault],
  env: { ...process.env, BEDROCK_USER_DATA: path.join(tmp, "userdata"), BEDROCK_NO_UPDATE: "1" },
});
const win = await app.firstWindow();
const errors = [];
win.on("pageerror", (e) => errors.push(String(e)));
const readCfg = (f) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(vault, ".obsidian", f), "utf8"));
  } catch {
    return null;
  }
};

try {
  await win.waitForFunction(() => window.app?.workspace?.layoutReady, null, { timeout: 60000 });
  const popoutPromise = app.waitForEvent("window", { timeout: 15000 });
  await win.evaluate(() => window.app.setting.open());
  const pop = await popoutPromise;
  await pop.waitForSelector(".modal.mod-settings .vertical-tab-nav-item", { timeout: 15000 });
  check("settings open in their own window", (await pop.title()).startsWith("Settings"), await pop.title());
  const ids = await win.evaluate(() => [...window.app.setting.tabsIn("options"), ...window.app.setting.tabsIn("core"), ...window.app.setting.tabsIn("community")].map((t) => t.id));
  check("all option tabs present", ["about", "appearance", "interface", "editor", "file", "hotkeys", "keychain", "plugins", "community-plugins"].every((i) => ids.includes(i)), ids.join(","));
  for (const theme of ["moonstone", "obsidian"]) {
    await win.evaluate((t) => window.app.customCss.setBaseTheme(t), theme);
    for (const id of ids) {
      await win.evaluate((i) => window.app.setting.openTabById(i), id);
      await pop.waitForTimeout(350);
      await pop.screenshot({ path: path.join(outDir, `settings-${id}-${theme === "obsidian" ? "dark" : "light"}.png`) });
    }
    // Sub-pages.
    for (const [tab, name] of [["appearance", "CSS snippets"], ["appearance", "Interface font"], ["interface", "Ribbon menu configuration"], ["file", "Excluded files"]]) {
      await win.evaluate((i) => window.app.setting.openTabById(i), tab);
      await pop.locator(".setting-item.mod-navigable", { hasText: name }).first().click();
      await pop.waitForTimeout(300);
      await pop.screenshot({ path: path.join(outDir, `settings-${tab}-${name.toLowerCase().replace(/\s+/g, "-")}-${theme === "obsidian" ? "dark" : "light"}.png`) });
    }
  }
  await win.evaluate(() => window.app.customCss.setBaseTheme("system"));

  // A click on a toggle in the settings window writes app.json (non-default only).
  await win.evaluate(() => window.app.setting.openTabById("editor"));
  const row = pop.locator(".setting-item", { has: pop.locator(".setting-item-name", { hasText: /^Line numbers$/ }) });
  await row.locator(".checkbox-container").click();
  await pop.waitForTimeout(800);
  check("toggle writes app.json", JSON.stringify(readCfg("app.json")) === JSON.stringify({ showLineNumber: true }), JSON.stringify(readCfg("app.json")));
  await row.locator(".checkbox-container").click();
  await pop.waitForTimeout(800);
  check("back to default removes the key", JSON.stringify(readCfg("app.json")) === "{}", JSON.stringify(readCfg("app.json")));
  check("appearance.json has no defaults", !readCfg("appearance.json") || Object.keys(readCfg("appearance.json")).length === 0, JSON.stringify(readCfg("appearance.json")));

  // Search finds settings across tabs.
  await pop.fill(".setting-search-container input", "spellcheck");
  await pop.waitForTimeout(300);
  const hits = await pop.locator(".setting-search-result").count();
  check("settings search finds results", hits > 0, `${hits} results`);
  await pop.screenshot({ path: path.join(outDir, "settings-search-light.png") });

  await win.evaluate(() => window.app.setting.close());
  await win.waitForTimeout(500);
  check("closing settings closes its window", app.windows().length === 1, `${app.windows().length} windows`);
  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("settings e2e ran", false, String(e?.stack ?? e));
} finally {
  await app.close().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} check(s) failed` : "all settings checks passed");
process.exit(failed ? 1 : 0);
