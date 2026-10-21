// Shared e2e harness: launch the built app on a temp COPY of a vault with its own app data,
// collect renderer errors, record checks, and clean up.
import { _electron as electron } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const repoDir = path.resolve(appDir, "..");
export const outDir = path.join(appDir, "test", "out");
fs.mkdirSync(outDir, { recursive: true });

export function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

export class Checks {
  results = [];
  check(name, ok, detail = "") {
    this.results.push({ name, ok: !!ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
    return !!ok;
  }
  skip(name, why) {
    this.results.push({ name, ok: true, skipped: true, detail: why });
    console.log(`SKIP ${name} - ${why}`);
  }
  summary() {
    const failed = this.results.filter((r) => !r.ok);
    const skipped = this.results.filter((r) => r.skipped).length;
    console.log(`\n${this.results.length - failed.length - skipped}/${this.results.length - skipped} checks passed${skipped ? `, ${skipped} skipped` : ""}`);
    return failed.length;
  }
}

/** Launch on a temp copy of `src` (default: the fixture vault). */
export async function launch({ src = path.join(appDir, "test", "fixtures", "vault"), args = [], env = {}, width = 1400, height = 900, reuse = null, beforeLaunch = null } = {}) {
  // `reuse` ({tmp, vault, userData} from an earlier launch) relaunches on the same vault and app data.
  const tmp = reuse?.tmp ?? fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-e2e-"));
  const vault = reuse?.vault ?? path.join(tmp, "vault");
  const userData = reuse?.userData ?? path.join(tmp, "userdata");
  if (!reuse) fs.cpSync(src, vault, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(p) });
  fs.mkdirSync(userData, { recursive: true });
  beforeLaunch?.({ tmp, vault, userData });
  const electronPath = (await import("electron")).default;
  const app = await electron.launch({
    executablePath: electronPath,
    args: [appDir, "--smoke-test", "--vault", vault, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", ...args],
    env: { ...process.env, BEDROCK_USER_DATA: userData, BEDROCK_NO_UPDATE: "1", ...env },
  });
  const errors = [];
  const win = await app.firstWindow();
  win.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  win.on("pageerror", (e) => errors.push(String(e?.stack ?? e)));
  await app.evaluate(({ BrowserWindow }, s) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(s.width, s.height);
    w.center();
  }, { width, height });
  await win.waitForSelector(".workspace", { timeout: 30000 });
  await win.waitForFunction(() => window.app?.indexStats, null, { timeout: 120000 });
  // close({keep: true}) keeps the folders for a relaunch with `reuse`.
  const close = async (o = {}) => {
    await win.evaluate(() => window.app?.vault?.flushConfig?.()).catch(() => {});
    await app.close().catch(() => {});
    if (!o.keep && !process.argv.includes("--keep")) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  return { app, win, vault, userData, tmp, errors, close };
}

export async function shot(win, name) {
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(outDir, name + ".png") });
}
