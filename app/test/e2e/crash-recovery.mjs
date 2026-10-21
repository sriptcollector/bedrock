// Regression test: a crashed window reloads by itself and the crash is written to logs/main.log.
import { _electron as electron } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-crash-"));
fs.mkdirSync(path.join(tmp, "vault"));
fs.writeFileSync(path.join(tmp, "vault", "Note.md"), "# Note\n");
const app = await electron.launch({ args: [appDir, "--vault", path.join(tmp, "vault")], env: { ...process.env, BEDROCK_USER_DATA: path.join(tmp, "data"), BEDROCK_NO_UPDATE: "1" } });
let ok = true;
const check = (n, c) => { console.log((c ? "PASS " : "FAIL ") + n); if (!c) ok = false; };
try {
  const win = await app.firstWindow();
  await win.waitForSelector(".workspace", { timeout: 20000 });
  win.evaluate(() => process.crash()).catch(() => {});
  await new Promise((r) => setTimeout(r, 4000));
  let back = false;
  for (let i = 0; i < 40 && !back; i++) {
    back = await app.evaluate(async ({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0]?.webContents;
      if (!wc || wc.isCrashed() || wc.isLoading()) return false;
      return wc.executeJavaScript("!!document.querySelector('.workspace .workspace-leaf')").catch(() => false);
    });
    if (!back) await new Promise((r) => setTimeout(r, 500));
  }
  check("window came back after a renderer crash", back);
  const log = fs.readFileSync(path.join(tmp, "data", "logs", "main.log"), "utf8");
  check("crash written to logs/main.log", /render-process-gone/.test(log));
} catch (e) {
  check(String(e), false);
} finally {
  await app.close().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
