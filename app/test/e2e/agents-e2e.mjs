// End-to-end test of agent access with real processes:
//  - two app instances (A, B) signed in to the same account, the real sync server (server/,
//    DEV_AUTH=1, temp DATA_DIR) and a fake toolbay.ai, as in sync-e2e.mjs;
//  - an MCP client (official SDK) calling A's MCP server over Streamable HTTP with the token;
//  - the stdio server launched the way an MCP client launches it (`electron <app> --mcp`, and the
//    Node-mode CLI `dist/cli.js mcp`), both with the app running (talks to it) and without
//    (works on the folder);
//  - an MCP edit arriving on B through the sync server and showing up in version history;
//  - the REST API (token, Host check), the `--cli` entry and Settings › Connect an AI agent
//    (Connect buttons write only temp config files, set through env overrides).
// Screenshots: app/test/out/agents-*.png. Results: app/test/out/agents-e2e-results.json.
//
// Usage (after `npm run build -w app` and `npm run build -w server`):
//   node app/test/e2e/agents-e2e.mjs [--keep]
import { _electron as electron } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../..");
const root = path.resolve(appDir, "..");
const outDir = path.join(appDir, "test", "out");
fs.mkdirSync(outDir, { recursive: true });
const keep = process.argv.includes("--keep");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-agents-e2e-"));
console.log(`temp: ${tmp}`);

const results = [];
const timings = {};
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
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
const parse = (r) => JSON.parse(r.content[0].text);

// ------------------------------------------------------------------ fake toolbay.ai + sync server

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
if (!fs.existsSync(path.join(appDir, "dist", "cli.js"))) throw new Error("Build the app first: npm run build -w app");
let serverProc = null;
let serverPort = 0;
let fake;

async function startServer() {
  serverProc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", serverMain], {
    env: { ...process.env, PORT: String(serverPort), HOST: "127.0.0.1", DATA_DIR: path.join(tmp, "server-data"), DEV_AUTH: "1", TOOLBAY_API: fake.url, RATE_LIMIT_PER_SEC: "10000", RATE_LIMIT_BURST: "10000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProc.stderr.on("data", (d) => process.env.E2E_DEBUG && process.stderr.write("[server] " + d));
  if (!(await waitFor(async () => (await fetch(`http://127.0.0.1:${serverPort}/healthz`)).ok, 15000, 100))) throw new Error("sync server did not start");
}

// ------------------------------------------------------------------ app instances

const electronPath = (await import("electron")).default;
const apps = [];
const clientsDir = path.join(tmp, "client-configs");
const clientEnv = {
  BEDROCK_CLAUDE_CODE_CONFIG: path.join(clientsDir, "claude.json"),
  BEDROCK_CLAUDE_DESKTOP_CONFIG: path.join(clientsDir, "Claude", "claude_desktop_config.json"),
  BEDROCK_CURSOR_CONFIG: path.join(clientsDir, "cursor", "mcp.json"),
  BEDROCK_CLAUDE_CLI: "none",
};

function baseEnv(ud, extra = {}) {
  const env = { ...process.env, BEDROCK_USER_DATA: ud, BEDROCK_NO_UPDATE: "1", BEDROCK_AGENT_PORT: "0", ...clientEnv, ...extra };
  delete env.TOOLBAY_TOKEN;
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

async function launch(name, { user = "u1" } = {}) {
  const base = path.join(tmp, name);
  const ud = path.join(base, "userdata");
  const kc = path.join(base, "keychain");
  const vault = path.join(base, "vault");
  fs.mkdirSync(ud, { recursive: true });
  fs.mkdirSync(kc, { recursive: true });
  fs.writeFileSync(path.join(ud, "vaults.json"), JSON.stringify({ main: vault, others: [] }));
  fs.writeFileSync(path.join(kc, "ai.toolbay.desktop--session"), `dev:${user}`);
  const env = baseEnv(ud, { BEDROCK_SYNC_URL: `http://127.0.0.1:${serverPort}`, TOOLBAY_API_BASE: fake.url, BEDROCK_KEYCHAIN_DIR: kc, BEDROCK_HUB_INSTALLED: "1" });
  const app = await electron.launch({ executablePath: electronPath, args: [appDir, "--smoke-test"], env });
  const win = await app.firstWindow();
  const errors = [];
  win.on("pageerror", (e) => errors.push(String(e)));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 860));
  await win.waitForSelector(".workspace", { timeout: 30000 });
  const inst = { name, app, win, vault, ud, errors };
  apps.push(inst);
  return inst;
}

const snapshot = (i) => i.win.evaluate(() => window.app.sync?.snapshot);
const waitSynced = (i, timeout = 30000) =>
  waitFor(async () => {
    const s = await snapshot(i);
    return s?.status === "synced" && s.pendingUploads === 0 ? s : null;
  }, timeout, 100);
const syncNow = (i) => i.win.evaluate(() => window.app.sync.syncNow().catch((e) => e.message));
const readF = (dir, rel) => {
  try {
    return fs.readFileSync(path.join(dir, rel), "utf8");
  } catch {
    return null;
  }
};
const agentInfo = (ud) => {
  const s = JSON.parse(fs.readFileSync(path.join(ud, "agents", "settings.json"), "utf8"));
  const r = JSON.parse(fs.readFileSync(path.join(ud, "agents", "running.json"), "utf8"));
  return { token: s.token, port: r.port, base: `http://127.0.0.1:${r.port}`, settings: s, running: r };
};
const openNoteB = async (p) => {
  await B.win.waitForFunction((p) => !!window.app.vault.getFileByPath(p), p, { timeout: 10000 });
  await B.win.evaluate(async (p) => window.app.workspace.getLeaf(false).openFile(window.app.vault.getFileByPath(p)), p);
};
async function shot(i, name) {
  await i.win.waitForTimeout(300);
  await i.win.screenshot({ path: path.join(outDir, `agents-${name}.png`) });
}

async function stdioClient(command, args, env) {
  const transport = new StdioClientTransport({ command, args, env, stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", (d) => (stderr += d));
  const client = new Client({ name: "e2e-stdio", version: "1" });
  const t0 = Date.now();
  await client.connect(transport);
  return { client, ms: Date.now() - t0, stderr: () => stderr };
}

// ------------------------------------------------------------------ the test

let A, B;
try {
  fake = await startFakeToolbay();
  serverPort = await freePort();
  await startServer();

  A = await launch("A");
  fs.writeFileSync(path.join(A.vault, "Hub.md"), "# Hub\nSee [[Old name]].\n");
  fs.writeFileSync(path.join(A.vault, "Old name.md"), "---\nstatus: active\n---\n# Old name\n");
  check("A signed in and synced", !!(await waitSynced(A)));
  B = await launch("B");
  check("B signed in and synced", !!(await waitSynced(B)));

  // ---- discovery files + token
  const a = agentInfo(A.ud);
  check("agent server runs on 127.0.0.1 with a token in app data", a.port > 0 && /^bdk_/.test(a.token) && a.settings.enabled === true, `port ${a.port}`);
  check("token is not in the vault", !fs.readdirSync(A.vault, { recursive: true }).some((f) => readF(A.vault, String(f))?.includes(a.token)));
  const unauth = await fetch(a.base + "/v1/status");
  check("REST refuses requests without the token", unauth.status === 401);
  const rebind = await new Promise((r) => http.get({ host: "127.0.0.1", port: a.port, path: "/v1/status", headers: { host: "rebind.attacker.test", authorization: `Bearer ${a.token}` } }, (res) => r(res.statusCode)));
  check("REST refuses a non-local Host header", rebind === 403);

  // ---- MCP over HTTP with the SDK client
  const httpClient = new Client({ name: "e2e-http", version: "1" });
  await httpClient.connect(new StreamableHTTPClientTransport(new URL(a.base + "/mcp"), { requestInit: { headers: { authorization: `Bearer ${a.token}` } } }));
  const tools = await httpClient.listTools();
  check("MCP HTTP lists the 18 tools", tools.tools.length === 18, tools.tools.map((t) => t.name).join(", "));
  let t0 = Date.now();
  const created = parse(await httpClient.callTool({ name: "create_note", arguments: { path: "Agents/From MCP", content: "# From MCP\nWritten by an agent.\n" } }));
  check("create_note over MCP HTTP writes the file", readF(A.vault, "Agents/From MCP.md") === "# From MCP\nWritten by an agent.\n", created.path);
  const inTree = await waitFor(() => A.win.evaluate(() => !!window.app.vault.getFileByPath("Agents/From MCP.md")), 3000, 20);
  check("the new note appears in A's file tree right away", !!inTree, `${Date.now() - t0} ms`);
  await httpClient.callTool({ name: "open_note", arguments: { path: "Agents/From MCP" } });
  const active = parse(await httpClient.callTool({ name: "get_active_note", arguments: {} }));
  check("open_note opens it in the app and get_active_note sees it", active.path === "Agents/From MCP.md");
  t0 = Date.now();
  await httpClient.callTool({ name: "edit_note", arguments: { path: "Agents/From MCP", mode: "find_replace", find: "Written by an agent.", replace: "Edited live by an agent." } });
  const live = await waitFor(() => A.win.evaluate(() => window.app.workspace.activeEditor?.editor?.getValue?.() ?? window.app.workspace.getActiveViewOfType?.(Object)?.editor?.getValue?.()), 5000, 20).then(() =>
    waitFor(async () => {
      const v = await A.win.evaluate(() => {
        let text = null;
        window.app.workspace.iterateAllLeaves((l) => {
          if (l.view?.file?.path === "Agents/From MCP.md" && l.view.editor) text = l.view.editor.getValue();
        });
        return text;
      });
      return v?.includes("Edited live by an agent.") ? v : null;
    }, 5000, 20),
  );
  timings.liveEditMs = Date.now() - t0;
  check("edit_note shows up in the open editor", !!live, `${timings.liveEditMs} ms`);
  await shot(A, "01-A-mcp-edit-live");

  const mv = parse(await httpClient.callTool({ name: "move_note", arguments: { from: "Old name", to: "Archive/New name" } }));
  check("move_note renames and updates links", mv.updatedLinks === 1 && readF(A.vault, "Hub.md") === "# Hub\nSee [[New name]].\n", JSON.stringify(mv));
  const del = parse(await httpClient.callTool({ name: "delete_note", arguments: { path: "Archive/New name" } }));
  check("delete_note moves to .trash", del.movedTo.startsWith(".trash/") && fs.existsSync(path.join(A.vault, del.movedTo)));
  const trav = await httpClient.callTool({ name: "read_note", arguments: { path: "../../userdata/agents/settings.json" } });
  check("path traversal is refused over MCP", trav.isError === true, trav.content[0].text);

  // ---- the MCP edit syncs to B and lands in version history
  t0 = Date.now();
  await syncNow(A);
  const onB = await waitFor(() => readF(B.vault, "Agents/From MCP.md")?.includes("Edited live by an agent."), 20000, 50);
  timings.mcpEditToB = Date.now() - t0;
  check("MCP edit arrives on B through the sync server", !!onB, `${timings.mcpEditToB} ms after A's sync`);
  check("B sees links updated by the move", (await waitFor(() => readF(B.vault, "Hub.md") === "# Hub\nSee [[New name]].\n", 15000)) === true);
  // Each synced MCP edit is its own version (edits within the debounce window merge, like typing).
  const before = (await B.win.evaluate(() => window.app.sync.versions("Agents/From MCP.md"))).length;
  await httpClient.callTool({ name: "append_to_note", arguments: { path: "Agents/From MCP", text: "Third version." } });
  await syncNow(A);
  await waitFor(() => readF(B.vault, "Agents/From MCP.md")?.includes("Third version."), 15000);
  await httpClient.callTool({ name: "set_property", arguments: { path: "Agents/From MCP", key: "reviewed", value: true } });
  await syncNow(A);
  await waitFor(() => readF(B.vault, "Agents/From MCP.md")?.startsWith("---\nreviewed: true\n---\n"), 15000);
  const hist = await B.win.evaluate(() => window.app.sync.versions("Agents/From MCP.md"));
  check("version history on B has the MCP edits as versions", before >= 1 && hist.length === before + 2, `${before} -> ${hist.length} versions`);
  await openNoteB("Agents/From MCP.md");
  await B.win.evaluate(() => window.app.commands.executeCommandById("sync:view-version-history"));
  const items = await B.win.waitForSelector(".bedrock-sync-history .sync-history-list-item", { timeout: 10000 }).then(() => B.win.$$(".bedrock-sync-history .sync-history-list-item"));
  check("the version history window on B lists them", items.length === hist.length, `${items.length} rows`);
  await shot(B, "05-B-version-history");
  await B.win.keyboard.press("Escape");
  await httpClient.close();

  // ---- stdio server launched like an MCP client does, app running -> talks to the app
  const stdioEnv = { BEDROCK_USER_DATA: A.ud, BEDROCK_NO_UPDATE: "1" };
  const s1 = await stdioClient(electronPath, [appDir, "--mcp"], stdioEnv);
  timings.stdioElectronConnectMs = s1.ms;
  const s1tools = await s1.client.listTools();
  check("stdio (`<exe> --mcp`) starts and lists tools", s1tools.tools.length === 18, `${s1.ms} ms to initialize`);
  const s1active = await s1.client.callTool({ name: "get_active_note", arguments: {} });
  check("stdio with the app running talks to the app (get_active_note works)", !s1active.isError && parse(s1active).path === "Agents/From MCP.md", s1active.content[0].text.slice(0, 80));
  await s1.client.callTool({ name: "get_daily_note", arguments: { append: "- logged over stdio" } });
  const today = await A.win.evaluate(() => window.moment().format("YYYY-MM-DD"));
  check("get_daily_note over stdio creates today's note in A's vault", readF(A.vault, `${today}.md`)?.includes("- logged over stdio"));
  const resources = await s1.client.listResources();
  check("notes are listed as bedrock://note/ resources", resources.resources.some((r) => r.uri === "bedrock://note/Agents/From%20MCP.md"));
  const res = await s1.client.readResource({ uri: "bedrock://note/Hub.md" });
  check("a note resource can be read", res.contents[0].text === "# Hub\nSee [[New name]].\n");
  await s1.client.close();

  // ---- Node-mode CLI stdio server (what the installed `bedrock mcp` shim runs), app not running
  const lone = path.join(tmp, "lone");
  fs.mkdirSync(path.join(lone, "vault"), { recursive: true });
  fs.writeFileSync(path.join(lone, "vault", "Solo.md"), "# Solo\n#offline\n");
  const s2 = await stdioClient(electronPath, [path.join(appDir, "dist", "cli.js"), "mcp", "--vault", path.join(lone, "vault")], { BEDROCK_USER_DATA: path.join(lone, "ud"), ELECTRON_RUN_AS_NODE: "1" });
  timings.stdioNodeConnectMs = s2.ms;
  const solo = parse(await s2.client.callTool({ name: "notes_with_tag", arguments: { tag: "offline" } }));
  check("stdio without the app works on the vault folder", solo.notes[0] === "Solo.md", `${s2.ms} ms to initialize`);
  await s2.client.callTool({ name: "create_note", arguments: { path: "Made offline", content: "x" } });
  check("…and writes go straight to disk", readF(path.join(lone, "vault"), "Made offline.md") === "x");
  const noApp = await s2.client.callTool({ name: "get_active_note", arguments: {} });
  check("…and says plainly when it needs the app", noApp.isError && /isn't running/.test(noApp.content[0].text), noApp.content[0].text);
  await s2.client.close();

  // ---- `--cli` on the app executable (no window, no single-instance conflict while A runs)
  t0 = Date.now();
  const cli = spawnSync(electronPath, [appDir, "--cli", "search", "Hub", "--json"], { env: baseEnv(A.ud), encoding: "utf8", timeout: 30000 });
  timings.cliElectronMs = Date.now() - t0;
  let cliOut = null;
  try {
    cliOut = JSON.parse(cli.stdout);
  } catch {
    /* printed below */
  }
  check("`<exe> --cli search` answers while the app runs", cli.status === 0 && cliOut?.results?.some((r) => r.path === "Hub.md"), `${timings.cliElectronMs} ms ${cli.stderr.slice(0, 200)}`);
  t0 = Date.now();
  const nodeCli = spawnSync(electronPath, [path.join(appDir, "dist", "cli.js"), "append", "Hub", "from the shim"], { env: { ...baseEnv(A.ud), ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8", timeout: 30000 });
  timings.cliNodeModeMs = Date.now() - t0;
  check("Node-mode CLI (the installed shim) appends through the app", nodeCli.status === 0 && readF(A.vault, "Hub.md").endsWith("from the shim\n"), `${timings.cliNodeModeMs} ms: ${nodeCli.stdout.trim()}`);
  check("A still has exactly one window", (await A.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) === 1);

  // ---- Settings › Connect an AI agent
  await A.win.evaluate(() => window.app.setting.openTabById("agents"));
  await A.win.waitForSelector(".bedrock-agents [data-client='cursor']", { timeout: 10000 });
  await shot(A, "02-settings-tab");
  await A.win.click(".bedrock-agents [data-client='cursor'] button.mod-cta");
  const cursorFile = clientEnv.BEDROCK_CURSOR_CONFIG;
  const cursorCfg = await waitFor(() => JSON.parse(readF(path.dirname(cursorFile), path.basename(cursorFile)) ?? "null"), 5000);
  const entry = cursorCfg?.mcpServers?.bedrock;
  check("Connect (Cursor) writes the temp config (app exe running the stdio server)", entry?.command === electronPath && entry.args.at(-1) === "mcp" && entry.env?.ELECTRON_RUN_AS_NODE === "1", JSON.stringify(entry));
  // Start exactly what Cursor would start, from the file the button wrote.
  const viaCfg = await stdioClient(entry.command, entry.args, { ...entry.env, BEDROCK_USER_DATA: A.ud });
  const viaCfgActive = await viaCfg.client.callTool({ name: "get_active_note", arguments: {} });
  check("the server in that config starts and reaches the running app", !viaCfgActive.isError, `${viaCfg.ms} ms to initialize`);
  await viaCfg.client.close();
  const badge = await waitFor(() => A.win.textContent(".bedrock-agents [data-client='cursor'] .agents-badge").then((t) => (t === "Connected" ? t : null)), 5000);
  check("the tab shows Cursor as connected", !!badge);
  fs.mkdirSync(path.dirname(clientEnv.BEDROCK_CLAUDE_DESKTOP_CONFIG), { recursive: true });
  fs.writeFileSync(clientEnv.BEDROCK_CLAUDE_DESKTOP_CONFIG, JSON.stringify({ mcpServers: { other: { command: "other.exe" } } }));
  await A.win.click(".bedrock-agents [data-client='claude-desktop'] button.mod-cta");
  const cd = await waitFor(() => {
    const j = JSON.parse(readF(path.dirname(clientEnv.BEDROCK_CLAUDE_DESKTOP_CONFIG), "claude_desktop_config.json"));
    return j.mcpServers.bedrock ? j : null;
  }, 5000);
  const backups = fs.readdirSync(path.dirname(clientEnv.BEDROCK_CLAUDE_DESKTOP_CONFIG)).filter((f) => f.includes(".bak-"));
  check("Connect (Claude Desktop) merges, keeps the other server and backs up", cd?.mcpServers?.other?.command === "other.exe" && backups.length === 1);
  await A.win.click(".bedrock-agents [data-client='claude-code'] button.mod-cta");
  const cc = await waitFor(() => JSON.parse(readF(clientsDir, "claude.json") ?? "null")?.mcpServers?.bedrock, 5000);
  check("Connect (Claude Code, no CLI) writes the temp ~/.claude.json entry", cc?.type === "stdio" && cc.args.at(-1) === "mcp" && cc.env?.ELECTRON_RUN_AS_NODE === "1");
  await shot(A, "03-settings-connected");

  // ---- toggle off: HTTP server gone, stdio refuses; on again
  await A.win.click(".bedrock-agents .setting-item:first-of-type .checkbox-container");
  const off = await waitFor(async () => {
    try {
      await fetch(a.base + "/v1/status", { headers: { authorization: `Bearer ${a.token}` }, signal: AbortSignal.timeout(500) });
      return null;
    } catch {
      return true;
    }
  }, 5000);
  check("turning agent access off stops the local server", !!off);
  const s3 = await stdioClient(electronPath, [path.join(appDir, "dist", "cli.js"), "mcp"], { BEDROCK_USER_DATA: A.ud, ELECTRON_RUN_AS_NODE: "1" });
  const refused = await s3.client.callTool({ name: "list_tags", arguments: {} });
  check("…and the stdio server refuses with a plain message", refused.isError && /turned off/.test(refused.content[0].text), refused.content[0].text);
  await s3.client.close();
  await shot(A, "04-settings-off");
  await A.win.click(".bedrock-agents .setting-item:first-of-type .checkbox-container");
  const back = await waitFor(async () => {
    const r = agentInfo(A.ud);
    return (await fetch(r.base + "/v1/status", { headers: { authorization: `Bearer ${r.token}` } })).ok;
  }, 5000);
  check("turning it back on restarts the server", !!back);

  check("no page errors in A or B", A.errors.length === 0 && B.errors.length === 0, [...A.errors, ...B.errors].join(" | ").slice(0, 300));
} catch (e) {
  check("unexpected error", false, String(e?.stack ?? e));
} finally {
  for (const i of apps) await i.app.close().catch(() => {});
  if (serverProc) serverProc.kill();
  fake?.close();
  const passed = results.filter((r) => r.ok).length;
  fs.writeFileSync(path.join(outDir, "agents-e2e-results.json"), JSON.stringify({ passed, total: results.length, timings, results }, null, 2));
  console.log(`\n${passed}/${results.length} checks passed`, timings);
  if (!keep) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  process.exit(passed === results.length ? 0 : 1);
}
