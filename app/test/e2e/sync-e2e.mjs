// End-to-end sync test with real processes: the real sync server (server/, DEV_AUTH=1, disk
// backend, temp DATA_DIR), a fake toolbay.ai (/api/v1/me + the tool settings sync API used for the
// vault key), and two then three Bedrock app instances, each with its own app data, keychain
// folder and vault. Screenshots go to app/test/out/sync-*.png (gitignored).
//
// Usage (after `npm run build -w app` and `npm run build -w server`):
//   node app/test/e2e/sync-e2e.mjs                 everything except the real-vault run
//   node app/test/e2e/sync-e2e.mjs --vault <dir>   also import a COPY of <dir> on one computer and
//                                                  check it arrives byte-identical on another
//   --only <name,...>  run only some steps (always runs setup)    --keep  keep temp folders
import { _electron as electron } from "playwright";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../..");
const root = path.resolve(appDir, "..");
const outDir = path.join(appDir, "test", "out");
fs.mkdirSync(outDir, { recursive: true });
const arg = (f) => (process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : null);
const realVault = arg("--vault");
const only = arg("--only")?.split(",") ?? null;
const keep = process.argv.includes("--keep");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-sync-e2e-"));
console.log(`temp: ${tmp}`);

const results = [];
const timings = {};
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
  return ok;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 15000, every = 50) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try {
      v = await fn();
    } catch {
      v = null;
    }
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await sleep(every);
  }
}
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

// ------------------------------------------------------------------ fake toolbay.ai

function startFakeToolbay() {
  const store = new Map();
  let rev = 0;
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    const user = token?.startsWith("dev:") ? token.slice(4) : undefined;
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/api/v1/me") return user ? send(200, { user: { id: user, name: `Test ${user}`, handle: user, email: `${user}@example.test` } }) : send(401, { error: "unauthorized" });
    const m = /^\/api\/v1\/me\/tools\/([^/]+)\/sync$/.exec(url.pathname);
    if (!m) return send(404, { error: "not found" });
    if (!user) return send(401, { error: "unauthorized" });
    const k = `${user}/${m[1]}`;
    if (!store.has(k)) store.set(k, new Map());
    const items = store.get(k);
    if (req.method === "GET") return send(200, { tool: m[1], rev, full: true, items: Object.fromEntries(items) });
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const applied = {};
    const conflicts = {};
    for (const ch of body.changes) {
      const cur = items.get(ch.key);
      if (ch.baseVersion !== (cur?.version ?? 0)) {
        conflicts[ch.key] = cur ?? null;
        continue;
      }
      const item = { value: ch.value, version: (cur?.version ?? 0) + 1, updatedAt: Date.now() };
      items.set(ch.key, item);
      applied[ch.key] = { version: item.version, updatedAt: item.updatedAt };
      rev++;
    }
    send(200, { tool: m[1], rev, applied, conflicts });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

// ------------------------------------------------------------------ sync server (child process)

const freePort = () =>
  new Promise((r) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });

const serverMain = path.join(root, "server", "dist", "main.js");
if (!fs.existsSync(serverMain)) throw new Error("Build the server first: npm run build -w server");
const dataDir = path.join(tmp, "server-data");
let serverProc = null;
let serverPort = 0;
let fake;

async function startServer() {
  serverProc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", serverMain], {
    env: { ...process.env, PORT: String(serverPort), HOST: "127.0.0.1", DATA_DIR: dataDir, DEV_AUTH: "1", TOOLBAY_API: fake.url, RATE_LIMIT_PER_SEC: "10000", RATE_LIMIT_BURST: "10000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProc.stderr.on("data", (d) => process.env.E2E_DEBUG && process.stderr.write("[server] " + d));
  const ok = await waitFor(async () => (await fetch(`http://127.0.0.1:${serverPort}/healthz`)).ok, 15000, 100);
  if (!ok) throw new Error("sync server did not start");
}
async function stopServer() {
  if (!serverProc) return;
  const p = serverProc;
  serverProc = null;
  p.kill();
  await new Promise((r) => p.once("exit", r));
}

// ------------------------------------------------------------------ app instances

const electronPath = (await import("electron")).default;
const apps = [];

async function launch(name, { user = "u1", vault } = {}) {
  const base = path.join(tmp, name);
  const ud = path.join(base, "userdata");
  const kc = path.join(base, "keychain");
  vault = vault ?? path.join(base, "vault");
  fs.mkdirSync(ud, { recursive: true });
  fs.mkdirSync(kc, { recursive: true });
  // the one vault of this "computer" (created with its welcome note on first start)
  fs.writeFileSync(path.join(ud, "vaults.json"), JSON.stringify({ main: vault, others: [] }));
  fs.writeFileSync(path.join(kc, "ai.toolbay.desktop--session"), `dev:${user}`);
  const env = { ...process.env, BEDROCK_USER_DATA: ud, BEDROCK_NO_UPDATE: "1", BEDROCK_SYNC_URL: `http://127.0.0.1:${serverPort}`, TOOLBAY_API_BASE: fake.url, BEDROCK_KEYCHAIN_DIR: kc, BEDROCK_HUB_INSTALLED: "1" };
  delete env.TOOLBAY_TOKEN;
  const app = await electron.launch({ executablePath: electronPath, args: [appDir, "--smoke-test"], env });
  const win = await app.firstWindow();
  const errors = [];
  win.on("pageerror", (e) => errors.push(String(e)));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1280, 820);
  });
  await win.waitForSelector(".workspace", { timeout: 30000 });
  await win.waitForSelector(".status-bar-item.plugin-sync", { timeout: 15000 });
  const inst = { name, app, win, vault, ud, kc, errors, user };
  apps.push(inst);
  return inst;
}

const syncStatus = (i) => i.win.evaluate(() => document.querySelector(".status-bar-item.plugin-sync")?.getAttribute("data-sync-status"));
const snapshot = (i) => i.win.evaluate(() => window.app.sync.snapshot);
const waitStatus = (i, st, timeout = 20000) => waitFor(async () => (await syncStatus(i)) === st, timeout, 100);
const waitSynced = async (i, timeout = 30000) =>
  waitFor(async () => {
    const s = await snapshot(i);
    return s?.status === "synced" && s.pendingUploads === 0 ? s : null;
  }, timeout, 100);
const syncNow = (i) => i.win.evaluate(() => window.app.sync.syncNow().catch((e) => e.message));
async function shot(i, name) {
  await i.win.waitForTimeout(300);
  await i.win.screenshot({ path: path.join(outDir, `sync-${name}.png`) });
}
const readF = (i, rel) => {
  try {
    return fs.readFileSync(path.join(i.vault, rel), "utf8");
  } catch {
    return null;
  }
};
const writeF = (i, rel, s) => {
  fs.mkdirSync(path.dirname(path.join(i.vault, rel)), { recursive: true });
  fs.writeFileSync(path.join(i.vault, rel), s);
};
const exists = (i, rel) => fs.existsSync(path.join(i.vault, rel));

/** Every synced file: rel path -> sha256 (same ignore rules as the engine, roughly). */
/** Default selective sync: installed community plugins and their on/off list stay on each computer. */
const notSyncedByDefault = (r) => /^\.obsidian\/(plugins(\/|$)|community-plugins\.json$)/i.test(r);
function treeHashes(dir, { all = false } = {}) {
  const out = new Map();
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (/^(\.trash|\.git)$/i.test(e.name) || e.name.startsWith(".bedrock-") || /^\.obsidian\/(workspace(-[^/]*)?\.json|cache)$/i.test(r)) continue;
      if (/^(\.ds_store|thumbs\.db|desktop\.ini)$/i.test(e.name) || /\.(tmp|part|crdownload|swp)$/i.test(e.name) || e.name.endsWith("~")) continue;
      if (!all && notSyncedByDefault(r)) continue;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) out.set(r, sha(fs.readFileSync(path.join(dir, r))));
    }
  };
  walk("");
  return out;
}
function treeDiff(a, b) {
  const d = [];
  for (const [k, v] of a) if (!b.has(k)) d.push(`only in first: ${k}`);
  else if (b.get(k) !== v) d.push(`differs: ${k}`);
  for (const k of b.keys()) if (!a.has(k)) d.push(`only in second: ${k}`);
  return d;
}
async function converged(insts, timeout = 30000) {
  return waitFor(async () => {
    for (const i of insts) await syncNow(i);
    const t = insts.map((i) => treeHashes(i.vault));
    return t.every((x) => treeDiff(t[0], x).length === 0) ? t[0] : null;
  }, timeout, 300);
}
const step = (n) => !only || only.includes(n);
const run = (i, id) => i.win.evaluate((id) => window.app.commands.executeCommandById(id), id);
const openNote = (i, p) =>
  i.win.evaluate(async (p) => {
    const f = window.app.vault.getFileByPath(p);
    await window.app.workspace.getLeaf(false).openFile(f);
  }, p);

// ------------------------------------------------------------------ the test

let A, B, C;
try {
  fake = await startFakeToolbay();
  serverPort = await freePort();
  await startServer();
  check("sync server and fake toolbay.ai started", true, `server :${serverPort}, toolbay ${fake.url}`);

  // ---- A: first computer
  A = await launch("A");
  fs.mkdirSync(path.join(A.vault, "Projects"), { recursive: true });
  writeF(A, "Projects/Plan.md", "# Plan\n\nline 1\nline 2\nline 3\n");
  writeF(A, "Ideas.md", "# Ideas\n\n- one\n");
  check("A connects and syncs", !!(await waitSynced(A, 30000)), JSON.stringify(await snapshot(A).then((s) => s?.message)));
  await A.win.evaluate(() => window.app.vault.setConfig("trashOption", "local"));
  await shot(A, "01-A-synced");
  check("status icon: synced", (await syncStatus(A)) === "synced");

  // ---- B: second computer, with its own notes -> merge + one notice
  // B already has a vault with its own note before it ever signs in
  writeF({ vault: path.join(tmp, "B", "vault") }, "From B.md", "written on B before it ever synced\n");
  B = await launch("B");
  const tB = Date.now();
  const bSynced = await waitSynced(B, 30000);
  check("B first sync", !!bSynced, `${Date.now() - tB} ms`);
  const tree = await converged([A, B]);
  check("A and B converge (B's own note merged in, nothing replaced)", !!tree && tree.has("From B.md") && tree.has("Projects/Plan.md") && tree.has("Welcome.md"));
  const mergeNotice = await waitFor(() => B.win.evaluate(() => [...document.querySelectorAll(".notice")].map((n) => n.textContent).find((t) => t.includes("combined"))), 8000);
  check("B shows the one-time merge notice", !!mergeNotice, mergeNotice ?? "");
  await shot(B, "02-B-merge-notice");

  // ---- live latency: typing in A's editor, measured from "saved on A's disk" to "visible in B's editor"
  if (step("latency")) {
    writeF(A, "Latency.md", "# Latency\n\n");
    await waitFor(() => exists(B, "Latency.md"), 15000);
    await openNote(A, "Latency.md");
    await waitFor(() => B.win.evaluate(() => !!window.app.vault.getFileByPath("Latency.md")), 5000);
    await openNote(B, "Latency.md");
    const typed = [];
    const disk = [];
    for (let i = 0; i < 8; i++) {
      const mark = `typed${i}x${Date.now() % 100000}`;
      await A.win.evaluate(() => {
        const ed = window.app.workspace.activeEditor.editor;
        ed.focus();
        ed.setCursor(ed.lastLine(), ed.getLine(ed.lastLine()).length);
      });
      await A.win.keyboard.type(` ${mark}`, { delay: 15 });
      const saved = await waitFor(() => (readF(A, "Latency.md")?.includes(mark) ? Date.now() : null), 8000, 10);
      const onB = await waitFor(() => B.win.evaluate((m) => (window.app.workspace.activeEditor?.editor?.getValue() ?? "").includes(m), mark).then((ok) => (ok ? Date.now() : null)), 10000, 15);
      if (saved && onB) typed.push(onB - saved);
    }
    for (let i = 0; i < 20; i++) {
      const mark = `disk${i}y${Date.now() % 100000}`;
      const t0 = Date.now();
      fs.appendFileSync(path.join(A.vault, "Latency2.md"), mark + "\n");
      const t1 = await waitFor(() => (readF(B, "Latency2.md")?.includes(mark) ? Date.now() : null), 10000, 10);
      if (t1) disk.push(t1 - t0);
      await sleep(150);
    }
    timings.typedSaveToEditorB = { n: typed.length, p50: pct(typed, 50), p95: pct(typed, 95), max: Math.max(...typed) };
    timings.diskWriteAToDiskB = { n: disk.length, p50: pct(disk, 50), p95: pct(disk, 95), max: Math.max(...disk) };
    check("typed edits reach B's open editor", typed.length === 8 && pct(typed, 95) < 2000, JSON.stringify(timings.typedSaveToEditorB));
    check("file writes on A reach B's disk", disk.length === 20 && pct(disk, 95) < 2000, JSON.stringify(timings.diskWriteAToDiskB));
    await shot(B, "03-B-live-edit");
  }

  // ---- offline on both, edits on both, reconnect -> merged
  if (step("offline")) {
    await stopServer();
    writeF(A, "Projects/Plan.md", "# Plan\n\nline 1 edited on A\nline 2\nline 3\n");
    writeF(B, "Projects/Plan.md", "# Plan\n\nline 1\nline 2\nline 3 edited on B\n");
    writeF(A, "Offline A.md", "new on A while offline\n");
    writeF(B, "Offline B.md", "new on B while offline\n");
    const offA = await waitStatus(A, "offline", 20000);
    const offB = await waitStatus(B, "offline", 20000);
    check("status icon: offline on both while the server is down", !!offA && !!offB, (await snapshot(A))?.message);
    await shot(A, "04-A-offline");
    const t0 = Date.now();
    await startServer();
    const merged = await waitFor(() => {
      const a = readF(A, "Projects/Plan.md");
      const b = readF(B, "Projects/Plan.md");
      return a === b && a?.includes("edited on A") && a?.includes("edited on B") && exists(A, "Offline B.md") && exists(B, "Offline A.md");
    }, 90000, 200);
    timings.reconnectToMerged = Date.now() - t0;
    check("after reconnect both edits are merged on both computers (no conflict copy)", !!merged, `${timings.reconnectToMerged} ms after the server came back`);
    await waitSynced(A);
    await waitSynced(B);
  }

  // ---- same-line conflict -> conflict copy + notice with "Open both"
  if (step("conflict")) {
    await converged([A, B]);
    await stopServer();
    writeF(A, "Ideas.md", "# Ideas\n\n- one changed on A\n");
    await sleep(50);
    writeF(B, "Ideas.md", "# Ideas\n\n- one changed on B\n");
    await waitStatus(A, "offline", 20000);
    await waitStatus(B, "offline", 20000);
    await startServer();
    const both = await converged([A, B], 90000);
    const copies = [...(both?.keys() ?? [])].filter((k) => /^Ideas \(conflict .*\)\.md$/.test(k));
    check("same line edited on both -> one conflict copy, both texts kept", copies.length === 1, copies.join(", "));
    const texts = [readF(A, "Ideas.md"), copies[0] && readF(A, copies[0])].join("|");
    check("conflict keeps both versions", texts.includes("changed on A") && texts.includes("changed on B"));
    const loser = await waitFor(async () => {
      for (const i of [A, B]) if (await i.win.evaluate(() => !!document.querySelector(".notice.mod-sync-conflict"))) return i;
      return null;
    }, 8000);
    check("conflict notice shown on the side that got the copy", !!loser, loser?.name ?? "");
    if (loser) {
      await shot(loser, "05-conflict-notice");
      await loser.win.click(".notice.mod-sync-conflict button");
      const two = await waitFor(() => loser.win.evaluate(() => document.querySelectorAll('.workspace-leaf-content[data-type="markdown"]').length >= 2), 5000);
      check("“Open both” opens the note and its conflict copy side by side", !!two);
      await shot(loser, "06-conflict-open-both");
    }
  }

  // ---- rename / move / delete through the app on A -> mirrored on B
  if (step("explorer")) {
    writeF(A, "Rename me.md", "rename test\n");
    writeF(A, "Move me.md", "move test\n");
    writeF(A, "Delete me.md", "delete test\n");
    await waitFor(() => exists(B, "Delete me.md") && exists(B, "Move me.md"), 15000);
    await A.win.waitForFunction(() => window.app.vault.getFileByPath("Delete me.md") && window.app.vault.getFileByPath("Move me.md"), null, { timeout: 10000 });
    const t0 = Date.now();
    await A.win.evaluate(async () => {
      const v = window.app.vault;
      await window.app.fileManager.renameFile(v.getFileByPath("Rename me.md"), "Renamed.md");
      await window.app.fileManager.renameFile(v.getFileByPath("Move me.md"), "Projects/Move me.md");
      await window.app.fileManager.trashFile(v.getFileByPath("Delete me.md"));
    });
    const mirrored = await waitFor(
      () => exists(B, "Renamed.md") && !exists(B, "Rename me.md") && exists(B, "Projects/Move me.md") && !exists(B, "Move me.md") && !exists(B, "Delete me.md"),
      15000,
    );
    check("rename, move and delete on A are mirrored on B", !!mirrored, `${Date.now() - t0} ms`);
    const hist = await B.win.evaluate(() => window.app.sync.versions("Projects/Move me.md"));
    check("history follows the moved file", hist.length >= 2 && hist.some((h) => h.path === "Move me.md"), hist.map((h) => h.path).join(" <- "));
  }

  // ---- 20 MB image + pdf dropped into a note on A -> on B
  if (step("attachments")) {
    await openNote(A, "Ideas.md");
    const t0 = Date.now();
    const dropped = await A.win.evaluate(async () => {
      const rnd = (n, seed) => {
        const b = new Uint8Array(n);
        let x = seed;
        for (let i = 0; i < n; i++) {
          x = (x * 1103515245 + 12345) >>> 0;
          b[i] = x >>> 24;
        }
        return b;
      };
      const dt = new DataTransfer();
      dt.items.add(new File([rnd(20 * 1024 * 1024, 1)], "big photo.png", { type: "image/png" }));
      dt.items.add(new File([rnd(20 * 1024 * 1024, 2)], "big doc.pdf", { type: "application/pdf" }));
      const target = document.querySelector(".workspace-leaf.mod-active .cm-content");
      const r = target.getBoundingClientRect();
      const ev = new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 20 });
      target.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    check("drop of a 20 MB image and a 20 MB PDF is handled by the editor", dropped);
    const files = await waitFor(() => {
      const f = fs.readdirSync(A.vault, { recursive: true }).map(String).map((p) => p.replace(/\\/g, "/"));
      const img = f.find((p) => p.endsWith("big photo.png"));
      const pdf = f.find((p) => p.endsWith("big doc.pdf"));
      return img && pdf && fs.statSync(path.join(A.vault, img)).size === 20 * 1024 * 1024 && fs.statSync(path.join(A.vault, pdf)).size === 20 * 1024 * 1024 ? [img, pdf] : null;
    }, 15000);
    const tSaved = Date.now();
    const arrived = files && (await waitFor(() => files.every((p) => exists(B, p) && sha(fs.readFileSync(path.join(B.vault, p))) === sha(fs.readFileSync(path.join(A.vault, p)))), 60000, 200));
    timings.attachments40MB = Date.now() - tSaved;
    check("both 20 MB attachments arrive on B byte-identical", !!arrived, `${timings.attachments40MB} ms after they were saved on A (${Date.now() - t0} ms incl. saving)`);
  }

  // ---- version history: restore through the UI
  if (step("history")) {
    writeF(A, "History.md", "version one\n");
    await waitSynced(A);
    await syncNow(A);
    writeF(A, "History.md", "version two\nmore\n");
    await syncNow(A);
    writeF(A, "History.md", "version three\nmore\nand more\n");
    await syncNow(A);
    await waitFor(() => readF(B, "History.md") === "version three\nmore\nand more\n", 15000);
    await A.win.waitForFunction(() => window.app.vault.getFileByPath("History.md"), null, { timeout: 10000 });
    await openNote(A, "History.md");
    await run(A, "sync:view-version-history");
    await A.win.waitForSelector(".bedrock-sync-history .sync-history-list-item", { timeout: 10000 });
    const items = await A.win.$$(".bedrock-sync-history .sync-history-list-item");
    check("version history lists the versions", items.length === 3, `${items.length} versions`);
    await items[items.length - 1].click();
    await A.win.waitForSelector(".bedrock-sync-history .sync-history-text", { timeout: 10000 });
    const shown = await A.win.textContent(".bedrock-sync-history .sync-history-text");
    check("selecting the oldest version shows its text", shown === "version one\n", JSON.stringify(shown));
    await A.win.click(".bedrock-sync-history .modal-setting-titlebar-toggle .checkbox-container");
    await A.win.waitForSelector(".bedrock-sync-history .diff-line.mod-right", { timeout: 5000 });
    check("“Show changes” shows a diff against the current note", (await A.win.$$(".bedrock-sync-history .diff-line.mod-right")).length >= 2);
    await shot(A, "07-version-history-diff");
    await A.win.click(".bedrock-sync-history .modal-setting-titlebar-actions button.mod-cta");
    const restored = await waitFor(() => readF(A, "History.md") === "version one\n" && readF(B, "History.md") === "version one\n", 15000);
    check("Restore puts the old version back on A and B", !!restored);
    await A.win.waitForSelector(".bedrock-sync-history .sync-history-list-item:nth-child(n+4)", { timeout: 5000 }).catch(() => {});
    await shot(A, "08-version-history-restored");
    await A.win.keyboard.press("Escape");
  }

  // ---- deleted files: restore through the UI on B
  if (step("trash")) {
    writeF(A, "Recycle me.md", "please bring me back\n");
    await waitFor(() => exists(B, "Recycle me.md"), 15000);
    await A.win.waitForFunction(() => window.app.vault.getFileByPath("Recycle me.md"), null, { timeout: 10000 });
    await A.win.evaluate(() => window.app.fileManager.trashFile(window.app.vault.getFileByPath("Recycle me.md")));
    await waitFor(() => !exists(B, "Recycle me.md"), 15000);
    await run(B, "sync:open-deleted-files");
    await B.win.waitForSelector(".bedrock-sync-deleted .sync-history-list-item", { timeout: 10000 });
    const row = await B.win.$('.bedrock-sync-deleted .sync-history-list-item:has-text("Recycle me.md")');
    check("deleted files lists the deleted note", !!row);
    await row?.click();
    await B.win.waitForSelector(".bedrock-sync-deleted .sync-history-text", { timeout: 10000 });
    await shot(B, "09-deleted-files");
    await B.win.click(".bedrock-sync-deleted .modal-setting-titlebar-actions button.mod-cta");
    const back = await waitFor(() => readF(A, "Recycle me.md") === "please bring me back\n" && readF(B, "Recycle me.md") === "please bring me back\n", 15000);
    check("Restore brings the note back on both computers", !!back);
    await B.win.keyboard.press("Escape");
  }

  // ---- settings tab, status menu, paused, error, signed-out states
  if (step("states")) {
    await A.win.evaluate(() => window.app.setting.openTabById("sync"));
    await A.win.waitForSelector(".bedrock-sync-settings .sync-status-setting", { timeout: 5000 });
    const txt = await A.win.textContent(".bedrock-sync-settings");
    check("Sync settings tab shows account, status, storage and selective sync", /Signed in as Test u1/.test(txt) && /Storage used/.test(txt) && /Sync images/.test(txt) && /Installed community plugins/.test(txt));
    await waitFor(() => A.win.evaluate(() => !!document.querySelector(".sync-usage-bar")), 5000);
    await shot(A, "10-settings-sync");
    await A.win.keyboard.press("Escape");

    await A.win.click(".status-bar-item.plugin-sync");
    await A.win.waitForSelector(".menu .menu-item", { timeout: 3000 });
    await shot(A, "11-status-menu");
    await A.win.click('.menu .menu-item:has-text("Pause syncing")');
    check("status icon: paused", !!(await waitStatus(A, "paused", 5000)));
    writeF(A, "While paused.md", "x\n");
    await sleep(2500);
    check("nothing syncs while paused", !exists(B, "While paused.md"));
    await shot(A, "12-paused");
    await A.win.evaluate(() => window.app.sync.resume());
    check("resume catches up", !!(await waitFor(() => exists(B, "While paused.md"), 15000)));

    fs.writeFileSync(path.join(A.kc, "ai.toolbay.desktop--session"), "not-a-valid-token");
    check("status icon: error when the sign-in is rejected", !!(await waitStatus(A, "error", 20000)), (await snapshot(A))?.message);
    await shot(A, "13-error");
    fs.writeFileSync(path.join(A.kc, "ai.toolbay.desktop--session"), "dev:u1");
    check("a fresh token recovers by itself", !!(await waitSynced(A, 30000)));

    // sign out (the hub removes its keychain entry) -> sync stops
    fs.rmSync(path.join(A.kc, "ai.toolbay.desktop--session"));
    check("status icon: signed out after sign-out", !!(await waitStatus(A, "signed-out", 10000)));
    writeF(A, "After sign-out.md", "local only\n");
    await sleep(3000);
    check("sync stops after sign-out", !exists(B, "After sign-out.md"));
    await A.win.evaluate(() => window.app.setting.openTabById("sync"));
    await A.win.waitForSelector(".sync-signin-button", { timeout: 5000 });
    check("signed-out settings show the sign-in button", (await A.win.textContent(".sync-signin-button")) === "Sign in to Toolbay to sync");
    await shot(A, "14-signed-out");
    await A.win.keyboard.press("Escape");
    fs.writeFileSync(path.join(A.kc, "ai.toolbay.desktop--session"), "dev:u1");
    check("signing back in resumes and uploads what was written meanwhile", !!(await waitFor(() => exists(B, "After sign-out.md"), 20000)));
  }

  // ---- third computer
  if (step("third")) {
    const t0 = Date.now();
    C = await launch("C");
    const s = await waitSynced(C, 60000);
    const t3 = await converged([A, B, C], 60000);
    timings.thirdComputerFirstSync = Date.now() - t0;
    check("a third computer gets everything and all three trees are identical", !!s && !!t3, `${t3?.size ?? 0} files, ${timings.thirdComputerFirstSync} ms incl. app start`);
    const copies3 = [...(t3?.keys() ?? [])].filter((k) => /(Welcome|app) \(conflict/.test(k));
    check("a fresh computer's own welcome note and settings file don't become conflict copies", copies3.length === 0, copies3.join(", "));
    const notice3 = await C.win.evaluate(() => [...document.querySelectorAll(".notice")].some((n) => n.textContent.includes("combined")));
    check("no merge notice on a fresh computer (it had no notes of its own)", !notice3);
    writeF(C, "From C.md", "hello from C\n");
    check("edits on C reach A and B", !!(await waitFor(() => readF(A, "From C.md") && readF(B, "From C.md"), 15000)));
    await shot(C, "15-C-synced");
  }

  // ---- real vault copy: import it on D, see it arrive on E (separate account u2)
  if (realVault && step("vault")) {
    const copy = path.join(tmp, "vault-source");
    let t = Date.now();
    fs.cpSync(realVault, copy, { recursive: true });
    console.log(`copied ${realVault} -> ${copy} in ${Date.now() - t} ms`);
    const D = await launch("D", { user: "u2" });
    const E = await launch("E", { user: "u2" });
    await waitSynced(D, 30000);
    await waitSynced(E, 30000);
    t = Date.now();
    const imp = await D.win.evaluate((src) => require("electron").ipcRenderer.invoke("bedrock:import-into-main-vault", src), copy);
    timings.vaultImport = { ms: Date.now() - t, ...imp };
    const tUp = Date.now();
    const srcCount = treeHashes(D.vault).size;
    const up = await waitFor(async () => {
      const s = await snapshot(D);
      return s.status === "synced" && s.pendingUploads === 0 && Date.now() - tUp > 3000 ? s : null;
    }, 600000, 500);
    timings.vaultUpload = Date.now() - tUp;
    const same = await waitFor(() => {
      const a = treeHashes(D.vault);
      const b = treeHashes(E.vault);
      return treeDiff(a, b).length === 0 ? a : null;
    }, 600000, 1000);
    timings.vaultOnSecondComputer = Date.now() - tUp;
    // every note and attachment of the source copy is on E, byte for byte
    const src = treeHashes(copy);
    const eTree = treeHashes(E.vault);
    const imported = (k) => k.replace(/(\.[^./]*)?$/, (ext) => ` (imported)${ext}`);
    const missing = [...src]
      .filter(([k, h]) => !k.startsWith(".obsidian/") && !/(^|\/)node_modules\//.test(k) && eTree.get(k) !== h && eTree.get(imported(k)) !== h)
      .map(([k]) => k);
    check("every note and attachment of the copied vault is on E, byte-identical", missing.length === 0, missing.slice(0, 5).join(", "));
    const pluginsLocal = treeHashes(D.vault, { all: true }).size - treeHashes(D.vault).size;
    check("installed community plugins stay on D (off by default, as in Obsidian)", !treeHashes(E.vault, { all: true }).has(".obsidian/community-plugins.json"), `${pluginsLocal} plugin files not synced`);
    const bytes = [...(same?.keys() ?? [])].reduce((n, k) => n + fs.statSync(path.join(D.vault, k)).size, 0);
    timings.vault = { files: same?.size ?? 0, mb: +(bytes / 1024 ** 2).toFixed(1) };
    check(
      "real vault copy: imported on D, byte-identical on E",
      !!up && !!same,
      `${imp.copied} files imported in ${timings.vaultImport.ms} ms; D uploaded in ${timings.vaultUpload} ms; E identical after ${timings.vaultOnSecondComputer} ms; ${timings.vault.files} files, ${timings.vault.mb} MB (D had ${srcCount})`,
    );
    if (!same) console.log(treeDiff(treeHashes(D.vault), treeHashes(E.vault)).slice(0, 20));
    await shot(E, "16-real-vault-on-E");
  }

  const pageErrors = apps.flatMap((i) => i.errors.map((e) => `${i.name}: ${e}`));
  check("no uncaught errors in any window", pageErrors.length === 0, pageErrors.slice(0, 5).join(" | "));
} catch (e) {
  check("e2e run", false, e?.stack ?? String(e));
} finally {
  for (const i of apps) await i.app.close().catch(() => {});
  await stopServer().catch(() => {});
  fake?.close();
  console.log("\ntimings:", JSON.stringify(timings, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  fs.writeFileSync(path.join(outDir, "sync-e2e-results.json"), JSON.stringify({ results, timings }, null, 2));
  if (!keep) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  process.exit(failed.length ? 1 : 0);
}
