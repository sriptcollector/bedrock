import http from 'node:http';
import { mkdtemp, readdir, readFile, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSyncServer, type ServerOptions, type SyncServer } from '../../../server/src/app.js';
import { SyncEngine, type SyncEngineOptions } from '../src/engine.js';
import { generateVaultKey } from '../src/crypto.js';
import { isIgnored } from '../src/ignore.js';

/** Tiny fake of toolbay.ai: GET /api/v1/me and the tool settings sync API. */
export interface FakeToolbay {
  url: string;
  tokens: Map<string, string>; // token -> user id
  meCalls: number;
  /** Delay (ms) applied to settings PUTs, to provoke races. */
  putDelayMs: number;
  store: Map<string, Map<string, { value: unknown; version: number; updatedAt: number }>>; // `${user}/${slug}` -> items
  close(): Promise<void>;
}

export async function startFakeToolbay(): Promise<FakeToolbay> {
  const fake: FakeToolbay = {
    url: '',
    tokens: new Map(),
    meCalls: 0,
    putDelayMs: 0,
    store: new Map(),
    close: async () => {},
  };
  let rev = 0;
  const server = http.createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const user = token ? fake.tokens.get(token) : undefined;
    const url = new URL(req.url!, 'http://x');
    if (url.pathname === '/api/v1/me') {
      fake.meCalls++;
      return user ? send(200, { user: { id: user, email: `${user}@example.test` } }) : send(401, { error: 'unauthorized' });
    }
    const m = /^\/api\/v1\/me\/tools\/([^/]+)\/sync$/.exec(url.pathname);
    if (!m) return send(404, { error: 'not found' });
    if (!user) return send(401, { error: 'unauthorized' });
    const k = `${user}/${m[1]}`;
    let items = fake.store.get(k);
    if (!items) fake.store.set(k, (items = new Map()));
    if (req.method === 'GET') {
      return send(200, { tool: m[1], rev, full: true, items: Object.fromEntries(items) });
    }
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (fake.putDelayMs) await new Promise((r) => setTimeout(r, fake.putDelayMs));
      const applied: Record<string, unknown> = {};
      const conflicts: Record<string, unknown> = {};
      for (const ch of body.changes) {
        const cur = items.get(ch.key);
        const curV = cur?.version ?? 0;
        if (ch.baseVersion !== curV) {
          conflicts[ch.key] = cur ? { ...cur } : null;
          continue;
        }
        const item = { value: ch.value, version: curV + 1, updatedAt: Date.now() };
        items.set(ch.key, item);
        applied[ch.key] = { version: item.version, updatedAt: item.updatedAt };
        rev++;
      }
      return send(200, { tool: m[1], rev, applied, conflicts });
    }
    send(405, {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  fake.url = `http://127.0.0.1:${(server.address() as any).port}`;
  fake.close = () =>
    new Promise((r) => {
      server.close(() => r());
      server.closeAllConnections();
    });
  return fake;
}

export async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `bedrock-${prefix}-`));
}

export interface TestEnv {
  dataDir: string;
  server: SyncServer;
  toolbay: FakeToolbay;
  key: Uint8Array;
  port: number;
  restart(opts?: Partial<ServerOptions>): Promise<void>;
  stopServer(): Promise<void>;
  startServer(): Promise<void>;
  device(name: string, opts?: Partial<SyncEngineOptions>): Promise<Device>;
  devices: Device[];
  close(): Promise<void>;
}

export interface Device {
  name: string;
  dir: string;
  stateDir: string;
  engine: SyncEngine;
  token: { value: string | null };
  conflicts: Array<{ path: string; conflictPath: string }>;
  newEngine(opts?: Partial<SyncEngineOptions>): SyncEngine;
}

export async function setupEnv(serverOpts: Partial<ServerOptions> = {}, userId = 'u1'): Promise<TestEnv> {
  const toolbay = await startFakeToolbay();
  toolbay.tokens.set(`tok-${userId}`, userId);
  const dataDir = await tempDir('srv');
  const key = generateVaultKey();
  const cleanup: string[] = [dataDir];
  const mk = () => createSyncServer({ dataDir, toolbayApi: toolbay.url, devAuth: true, rateLimitPerSec: 10_000, rateLimitBurst: 10_000, ...serverOpts });
  const env: TestEnv = {
    dataDir,
    toolbay,
    key,
    server: mk(),
    port: 0,
    devices: [],
    async stopServer() {
      await env.server.close();
    },
    async startServer() {
      env.server = mk();
      await env.server.listen(env.port);
    },
    async restart(opts = {}) {
      await env.server.close();
      env.server = createSyncServer({ dataDir, toolbayApi: toolbay.url, devAuth: true, rateLimitPerSec: 10_000, rateLimitBurst: 10_000, ...serverOpts, ...opts });
      await env.server.listen(env.port);
    },
    async device(name, opts = {}) {
      const dir = await tempDir(`vault-${name}`);
      const stateDir = await tempDir(`state-${name}`);
      cleanup.push(dir, stateDir);
      const token = { value: `tok-${userId}` as string | null };
      const dev: Device = {
        name,
        dir,
        stateDir,
        token,
        conflicts: [],
        engine: undefined as unknown as SyncEngine,
        newEngine(o2 = {}) {
          const e = new SyncEngine({
            vaultPath: dir,
            stateDir,
            serverUrl: env.server.url,
            getToken: async () => token.value,
            getVaultKey: async () => key,
            deviceId: `dev-${name}`,
            deviceName: name,
            watch: false,
            WebSocket: null,
            ...opts,
            ...o2,
          });
          e.on('conflict', (c) => dev.conflicts.push(c));
          e.on('error', () => {});
          dev.engine = e;
          return e;
        },
      };
      dev.newEngine();
      env.devices.push(dev);
      return dev;
    },
    async close() {
      for (const d of env.devices) await d.engine.stop().catch(() => {});
      await env.server.close().catch(() => {});
      await toolbay.close();
      for (const d of cleanup) await rm(d, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
    },
  };
  await env.server.listen(0);
  env.port = env.server.port;
  return env;
}

/** Reads every synced file under dir: path -> content. Empty folders appear as "path/" -> "". */
export async function readTree(dir: string, rel = '', out = new Map<string, string>()): Promise<Map<string, string>> {
  const names = await readdir(join(dir, rel));
  let any = false;
  for (const n of names) {
    const p = rel ? `${rel}/${n}` : n;
    if (isIgnored(p)) continue;
    any = true;
    const st = await lstat(join(dir, p));
    if (st.isDirectory()) await readTree(dir, p, out);
    else out.set(p, await readFile(join(dir, p), 'utf8'));
  }
  if (rel && !any) out.set(rel + '/', '');
  return out;
}

export function treeDiff(a: Map<string, string>, b: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [k, v] of a) if (!b.has(k)) out.push(`only in A: ${k}`);
  else if (b.get(k) !== v) out.push(`differs: ${k}`);
  for (const k of b.keys()) if (!a.has(k)) out.push(`only in B: ${k}`);
  return out;
}

/** Syncs devices round-robin until a whole round changes nothing anywhere. */
export async function settle(devs: Device[], maxRounds = 8): Promise<number> {
  for (let round = 1; round <= maxRounds; round++) {
    const before = await Promise.all(devs.map((d) => readTree(d.dir)));
    const seqBefore = devs.map(() => 0);
    for (const d of devs) {
      const s = await d.engine.syncNow();
      if (s.state !== 'synced') throw new Error(`${d.name}: ${s.state} ${s.message}`);
    }
    const after = await Promise.all(devs.map((d) => readTree(d.dir)));
    const allSame = after.every((t) => treeDiff(t, after[0]).length === 0);
    const unchanged = after.every((t, i) => treeDiff(t, before[i]).length === 0);
    void seqBefore;
    if (allSame && unchanged) return round;
  }
  throw new Error('devices did not settle');
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
