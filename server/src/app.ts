// Bedrock sync service: HTTP JSON API + one websocket. See docs/SYNC.md for the protocol.

import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { AuthError, Authenticator, UpstreamError } from './auth.js';
import { Db, versionOut, type CommitInput, type VaultRow } from './db.js';
import { RateLimiter } from './ratelimit.js';
import { runRetention, type RetentionResult } from './retention.js';
import { DiskStore, type BlobStore } from './storage/index.js';

export const PROTOCOL_VERSION = 1;
export const WS_PROTOCOL = 'bedrock.v1';
const CHUNK_ID = /^[0-9a-f]{64}$/;
const FILE_ID = /^[0-9A-Za-z_-]{8,64}$/;
const GB = 1024 ** 3;
const MB = 1024 ** 2;

export interface ServerOptions {
  dataDir: string;
  store?: BlobStore;
  toolbayApi?: string;
  devAuth?: boolean;
  authFetch?: typeof fetch;
  authPositiveTtlMs?: number;
  authNegativeTtlMs?: number;
  quotaBytes?: number;
  maxFileBytes?: number;
  maxChunkBytes?: number;
  maxJsonBytes?: number;
  retentionDays?: number;
  gcGraceMs?: number;
  rateLimitPerSec?: number;
  rateLimitBurst?: number;
  maxSocketsPerUser?: number;
  /** Chunks at least this big go straight to the bucket via presigned URLs (S3 backend only). */
  directThreshold?: number;
  heartbeatMs?: number;
  now?: () => number;
  log?: (msg: string) => void;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra?: Record<string, unknown>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

function fmtBytes(n: number): string {
  if (n >= GB) return `${(n / GB).toFixed(1)} GB`;
  if (n >= MB) return `${(n / MB).toFixed(1)} MB`;
  return `${Math.ceil(n / 1024)} KB`;
}

/** Binary framing for batched chunks: repeated [64-byte ascii id][u32 BE length][bytes]. */
export function encodeFrames(items: Array<{ id: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  for (const it of items) {
    const h = Buffer.alloc(68);
    h.write(it.id, 0, 'ascii');
    h.writeUInt32BE(it.data.length, 64);
    parts.push(h, it.data);
  }
  return Buffer.concat(parts);
}

export function decodeFrames(buf: Buffer): Array<{ id: string; data: Buffer }> {
  const out: Array<{ id: string; data: Buffer }> = [];
  let o = 0;
  while (o < buf.length) {
    if (o + 68 > buf.length) throw new HttpError(400, 'bad_frame', 'Truncated chunk batch');
    const id = buf.toString('ascii', o, o + 64);
    const len = buf.readUInt32BE(o + 64);
    o += 68;
    if (o + len > buf.length) throw new HttpError(400, 'bad_frame', 'Truncated chunk batch');
    out.push({ id, data: buf.subarray(o, o + len) });
    o += len;
  }
  return out;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export interface SyncServer {
  server: http.Server;
  db: Db;
  store: BlobStore;
  auth: Authenticator;
  readonly port: number;
  readonly url: string;
  listen(port?: number, host?: string): Promise<void>;
  close(): Promise<void>;
  runRetention(opts?: { prune?: boolean; vaultId?: string; graceMs?: number }): Promise<RetentionResult>;
  stats: { requests: number; chunkPuts: number; chunkBytesIn: number; commits: number };
}

export function createSyncServer(o: ServerOptions): SyncServer {
  const now = o.now ?? Date.now;
  const log = o.log ?? (() => {});
  const db = new Db(o.dataDir);
  const store: BlobStore = o.store ?? new DiskStore(join(o.dataDir, "blobs"));
  const auth = new Authenticator({
    toolbayApi: o.toolbayApi ?? 'https://toolbay.ai',
    devAuth: o.devAuth,
    fetch: o.authFetch,
    positiveTtlMs: o.authPositiveTtlMs,
    negativeTtlMs: o.authNegativeTtlMs,
    now,
  });
  const quotaDefault = o.quotaBytes ?? 10 * GB;
  const maxFile = o.maxFileBytes ?? 1 * GB;
  const maxChunk = o.maxChunkBytes ?? 8 * MB + 1024;
  const maxJson = o.maxJsonBytes ?? 8 * MB;
  const retentionDays = o.retentionDays ?? 90;
  const gcGraceMs = o.gcGraceMs ?? 24 * 3600_000;
  const directThreshold = o.directThreshold ?? 1 * MB;
  const userLimiter = new RateLimiter(o.rateLimitPerSec ?? 30, o.rateLimitBurst ?? 300, now);
  const ipLimiter = new RateLimiter(10, 60, now); // requests that fail auth
  const gcLocks = new Set<string>();
  const stats = { requests: 0, chunkPuts: 0, chunkBytesIn: 0, commits: 0 };
  const sockets = new Map<string, Set<WebSocket>>(); // vaultId -> sockets
  const socketsPerUser = new Map<string, number>();
  const direct = !!(store.presignPut && store.presignGet);

  const quotaOf = (v: VaultRow) => v.quota_bytes ?? quotaDefault;

  function notify(vaultId: string, seq: number): void {
    const set = sockets.get(vaultId);
    if (!set) return;
    const msg = JSON.stringify({ type: 'seq', seq });
    for (const ws of set) if (ws.readyState === 1) ws.send(msg);
  }

  function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    const data = Buffer.from(JSON.stringify(body));
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': String(data.length), 'cache-control': 'no-store', ...headers });
    res.end(data);
  }

  function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
    const declared = Number(req.headers['content-length'] ?? NaN);
    if (declared > limit) {
      req.resume();
      return Promise.reject(new HttpError(413, 'too_large', `Request too large (limit ${fmtBytes(limit)})`));
    }
    return new Promise((resolve, reject) => {
      const parts: Buffer[] = [];
      let n = 0;
      req.on('data', (c: Buffer) => {
        n += c.length;
        if (n > limit) {
          req.removeAllListeners('data');
          req.resume();
          reject(new HttpError(413, 'too_large', `Request too large (limit ${fmtBytes(limit)})`));
          return;
        }
        parts.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(parts)));
      req.on('error', reject);
    });
  }

  async function readJson(req: IncomingMessage): Promise<any> {
    const b = await readBody(req, maxJson);
    try {
      return JSON.parse(b.toString('utf8') || '{}');
    } catch {
      throw new HttpError(400, 'bad_json', 'Body is not valid JSON');
    }
  }

  function quotaError(v: VaultRow, adding: number): HttpError {
    const quota = quotaOf(v);
    return new HttpError(
      413,
      'quota_exceeded',
      `Your synced vault is full: ${fmtBytes(v.used_bytes)} of ${fmtBytes(quota)} used, and this upload needs ${fmtBytes(adding)} more. ` +
        `Delete large files you no longer need and empty the recycle bin to free space.`,
      { usedBytes: v.used_bytes, quotaBytes: quota },
    );
  }

  async function storeChunk(vault: VaultRow, id: string, data: Buffer): Promise<boolean> {
    if (!CHUNK_ID.test(id)) throw new HttpError(400, 'bad_chunk_id', 'Chunk id must be 64 hex characters');
    if (data.length > maxChunk) throw new HttpError(413, 'too_large', `Chunk too large (limit ${fmtBytes(maxChunk)})`);
    if (db.hasChunk(vault.vault_id, id)) {
      db.addChunk(vault.vault_id, id, data.length, now()); // touch
      return false;
    }
    const key = `${vault.vault_id}/${id}`;
    if (gcLocks.has(key)) throw new HttpError(503, 'busy', 'Try again in a moment', undefined, { 'retry-after': '1' });
    await store.put(key, data);
    stats.chunkPuts++;
    stats.chunkBytesIn += data.length;
    return db.addChunk(vault.vault_id, id, data.length, now());
  }

  function parseCommit(c: any): CommitInput {
    if (!c || typeof c !== 'object') throw new HttpError(400, 'bad_commit', 'Bad commit');
    const { fileId, baseVersion, meta, chunks, size, deleted, deviceId } = c;
    if (typeof fileId !== 'string' || !FILE_ID.test(fileId)) throw new HttpError(400, 'bad_file_id', 'Bad file id');
    if (!Number.isInteger(baseVersion) || baseVersion < 0) throw new HttpError(400, 'bad_commit', 'Bad baseVersion');
    if (typeof meta !== 'string' || meta.length > 64 * 1024) throw new HttpError(400, 'bad_commit', 'Bad meta');
    if (!Array.isArray(chunks) || chunks.length > Math.ceil(maxFile / (4 * MB)) + 16 || !chunks.every((x) => typeof x === 'string' && CHUNK_ID.test(x)))
      throw new HttpError(400, 'bad_commit', 'Bad chunk list');
    if (!Number.isInteger(size) || size < 0) throw new HttpError(400, 'bad_commit', 'Bad size');
    if (size > maxFile) throw new HttpError(413, 'file_too_large', `Files larger than ${fmtBytes(maxFile)} do not sync`);
    if (deviceId !== undefined && (typeof deviceId !== 'string' || deviceId.length > 128)) throw new HttpError(400, 'bad_commit', 'Bad deviceId');
    return { fileId, baseVersion, meta, chunks, size, deleted: !!deleted, deviceId };
  }

  function vaultOut(v: VaultRow) {
    return {
      vaultId: v.vault_id,
      seq: v.seq,
      usedBytes: v.used_bytes,
      quotaBytes: quotaOf(v),
      retentionDays,
      maxFileBytes: maxFile,
      keyCheck: v.key_check,
      direct,
      directThreshold,
      protocol: PROTOCOL_VERSION,
    };
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    stats.requests++;
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (path === '/healthz' || path === '/') {
      db.db.prepare('SELECT 1').get();
      return send(res, 200, { ok: true, service: 'bedrock-sync', protocol: PROTOCOL_VERSION });
    }
    if (!path.startsWith('/v1/')) throw new HttpError(404, 'not_found', 'Not found');

    let userId: string;
    try {
      userId = await auth.verify(Authenticator.fromHeader(req.headers.authorization));
    } catch (e) {
      const ip = req.socket.remoteAddress ?? '?';
      const wait = ipLimiter.take(ip);
      if (wait) throw new HttpError(429, 'rate_limited', 'Too many requests', undefined, { 'retry-after': String(wait) });
      if (e instanceof AuthError) throw new HttpError(401, 'unauthorized', 'Your Toolbay sign-in has expired or is not valid. Sign in to Toolbay again.');
      if (e instanceof UpstreamError) throw new HttpError(503, 'auth_unavailable', e.message, undefined, { 'retry-after': '10' });
      throw e;
    }
    const wait = userLimiter.take(userId);
    if (wait) throw new HttpError(429, 'rate_limited', 'Too many requests, slow down', undefined, { 'retry-after': String(wait) });

    let vault = db.getOrCreateVault(userId, now());
    const vid = vault.vault_id;
    let m: RegExpExecArray | null;

    if (path === '/v1/vault' && method === 'GET') return send(res, 200, vaultOut(vault));

    if (path === '/v1/vault/key-check' && method === 'POST') {
      const b = await readJson(req);
      if (typeof b.keyCheck !== 'string' || !/^[0-9a-f]{16,128}$/.test(b.keyCheck)) throw new HttpError(400, 'bad_key_check', 'Bad key check');
      return send(res, 200, { keyCheck: db.setKeyCheck(vid, b.keyCheck) });
    }

    // Start the vault over under a new key (key rotation, or "forgot my passphrase"): every file,
    // version and chunk of the old vault is deleted and the vault gets a new id, so other computers
    // see a different vault and re-match their files. `from` must name the current key check (null
    // when none is set), so two computers can't wipe each other's fresh upload.
    if (path === '/v1/vault/rekey' && method === 'POST') {
      const b = await readJson(req);
      const hex = /^[0-9a-f]{16,128}$/;
      if (typeof b.to !== 'string' || !hex.test(b.to)) throw new HttpError(400, 'bad_key_check', 'Bad key check');
      if (b.from !== null && (typeof b.from !== 'string' || !hex.test(b.from))) throw new HttpError(400, 'bad_key_check', 'Bad key check');
      const r = db.rekeyVault(userId, b.from, b.to, now());
      if (!r) throw new HttpError(409, 'key_changed', 'The vault key changed on another computer meanwhile.', { keyCheck: db.getVault(userId)?.key_check ?? null });
      notify(r.oldVaultId, Number.MAX_SAFE_INTEGER); // computers still on the old vault re-check now
      await runRetention(retentionCtx, { prune: false, vaultId: r.oldVaultId, graceMs: -1 });
      return send(res, 200, vaultOut(r.vault));
    }

    if (path === '/v1/chunks/check' && method === 'POST') {
      const b = await readJson(req);
      if (!Array.isArray(b.ids) || b.ids.length > 10000) throw new HttpError(400, 'bad_request', 'ids must be an array of at most 10000');
      const ids = b.ids.filter((x: unknown) => typeof x === 'string' && CHUNK_ID.test(x));
      return send(res, 200, { missing: db.missingChunks(vid, ids, now()) });
    }

    if (path === '/v1/chunks/batch' && method === 'POST') {
      const body = await readBody(req, 2 * maxChunk);
      const items = decodeFrames(body);
      for (const it of items) {
        if (!CHUNK_ID.test(it.id)) throw new HttpError(400, 'bad_chunk_id', 'Chunk id must be 64 hex characters');
        if (it.data.length > maxChunk) throw new HttpError(413, 'too_large', `Chunk too large (limit ${fmtBytes(maxChunk)})`);
      }
      const seen = new Set<string>();
      const fresh = items.filter((it) => !seen.has(it.id) && (seen.add(it.id), !db.hasChunk(vid, it.id)));
      const adding = fresh.reduce((s, it) => s + it.data.length, 0);
      if (vault.used_bytes + adding > quotaOf(vault)) throw quotaError(vault, adding);
      if (fresh.some((it) => gcLocks.has(`${vid}/${it.id}`))) throw new HttpError(503, 'busy', 'Try again in a moment', undefined, { 'retry-after': '1' });
      // blobs first (in parallel: with R2 each one is a network round trip), then one DB transaction
      await mapLimit(fresh, 16, (it) => store.put(`${vid}/${it.id}`, it.data));
      stats.chunkPuts += fresh.length;
      stats.chunkBytesIn += adding;
      const stored = db.addChunks(vid, items.filter((it) => seen.delete(it.id)).map((it) => ({ id: it.id, size: it.data.length })), now());
      return send(res, 200, { stored });
    }

    if ((m = /^\/v1\/chunks\/([0-9a-f]{64})$/.exec(path))) {
      const id = m[1];
      if (method === 'PUT') {
        const declared = Number(req.headers['content-length'] ?? NaN);
        if (!db.hasChunk(vid, id) && Number.isFinite(declared) && vault.used_bytes + declared > quotaOf(vault)) {
          req.resume();
          throw quotaError(vault, declared);
        }
        const data = await readBody(req, maxChunk);
        vault = db.getVault(userId)!;
        if (!db.hasChunk(vid, id) && vault.used_bytes + data.length > quotaOf(vault)) throw quotaError(vault, data.length);
        const created = await storeChunk(vault, id, data);
        return send(res, 200, { stored: created });
      }
      if (method === 'GET') {
        const size = db.chunkSize(vid, id);
        if (size === null) throw new HttpError(404, 'not_found', 'Chunk not found');
        if (direct && size >= directThreshold) {
          res.writeHead(302, { location: await store.presignGet!(`${vid}/${id}`, 900), 'cache-control': 'no-store' });
          return void res.end();
        }
        const data = await store.get(`${vid}/${id}`);
        if (!data) throw new HttpError(404, 'not_found', 'Chunk data missing');
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(data.length), 'cache-control': 'no-store' });
        return void res.end(data);
      }
    }

    if (path === '/v1/chunks/fetch' && method === 'POST') {
      const b = await readJson(req);
      if (!Array.isArray(b.ids) || b.ids.length > 2000) throw new HttpError(400, 'bad_request', 'ids must be an array of at most 2000');
      const wanted: string[] = [];
      let total = 0;
      for (const id of b.ids) {
        if (typeof id !== 'string' || !CHUNK_ID.test(id)) continue;
        const size = db.chunkSize(vid, id);
        if (size === null) continue;
        if (total + size > 32 * MB && wanted.length) break; // client asks again for the rest
        wanted.push(id);
        total += size;
      }
      const datas = await mapLimit(wanted, 16, (id) => store.get(`${vid}/${id}`));
      const items = wanted.map((id, i) => ({ id, data: datas[i]! })).filter((x) => x.data);
      const out = encodeFrames(items);
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(out.length), 'cache-control': 'no-store' });
      return void res.end(out);
    }

    if (path === '/v1/chunks/upload-urls' && method === 'POST') {
      if (!direct) return send(res, 200, { urls: {} });
      const b = await readJson(req);
      if (!Array.isArray(b.chunks) || b.chunks.length > 1000) throw new HttpError(400, 'bad_request', 'chunks must be an array');
      const wanted = b.chunks.filter((c: any) => c && typeof c.id === 'string' && CHUNK_ID.test(c.id) && Number.isInteger(c.size) && c.size > 0 && c.size <= maxChunk);
      const adding = wanted.filter((c: any) => !db.hasChunk(vid, c.id)).reduce((s: number, c: any) => s + c.size, 0);
      if (vault.used_bytes + adding > quotaOf(vault)) throw quotaError(vault, adding);
      const urls: Record<string, string> = {};
      for (const c of wanted) urls[c.id] = await store.presignPut!(`${vid}/${c.id}`, c.size, 900);
      return send(res, 200, { urls });
    }

    if (path === '/v1/chunks/confirm' && method === 'POST') {
      const b = await readJson(req);
      if (!Array.isArray(b.ids) || b.ids.length > 1000) throw new HttpError(400, 'bad_request', 'ids must be an array');
      const missing: string[] = [];
      for (const id of b.ids) {
        if (typeof id !== 'string' || !CHUNK_ID.test(id)) continue;
        if (db.hasChunk(vid, id)) continue;
        const size = await store.head(`${vid}/${id}`);
        if (size === null) missing.push(id);
        else db.addChunk(vid, id, size, now());
      }
      return send(res, 200, { missing });
    }

    if (path === '/v1/commit' && method === 'POST') {
      const b = await readJson(req);
      if (!Array.isArray(b.commits) || b.commits.length > 1000) throw new HttpError(400, 'bad_request', 'commits must be an array of at most 1000');
      const commits = b.commits.map(parseCommit);
      const r = db.commit(vid, commits, now());
      stats.commits += r.results.filter((x) => x.ok).length;
      if (r.results.some((x) => x.ok)) notify(vid, r.seq);
      return send(res, 200, r);
    }

    if ((m = /^\/v1\/files\/([^/]+)\/commit$/.exec(path)) && method === 'POST') {
      const b = await readJson(req);
      const c = parseCommit({ ...b, fileId: m[1] });
      const r = db.commit(vid, [c], now());
      const one = r.results[0];
      if (one.ok) {
        stats.commits++;
        notify(vid, r.seq);
        return send(res, 200, { version: one.version, seq: one.seq });
      }
      if (one.status === 409) return send(res, 409, { error: 'conflict', message: 'File changed on the server', current: one.current });
      return send(res, 400, one);
    }

    if (path === '/v1/changes' && method === 'GET') {
      const since = Math.max(0, Number(url.searchParams.get('since') ?? 0) || 0);
      const limit = Math.min(5000, Math.max(1, Number(url.searchParams.get('limit') ?? 1000) || 1000));
      const { rows, more } = db.changes(vid, since, limit);
      const seq = more ? rows[rows.length - 1].seq : db.getVault(userId)!.seq;
      return send(res, 200, { changes: rows.map(versionOut), seq, more });
    }

    if ((m = /^\/v1\/files\/([^/]+)\/versions$/.exec(path)) && method === 'GET') {
      const rows = db.versions(vid, m[1]);
      return send(res, 200, { versions: rows.map(versionOut) });
    }

    if ((m = /^\/v1\/files\/([^/]+)\/versions\/(\d+)$/.exec(path)) && method === 'GET') {
      const row = db.version(vid, m[1], Number(m[2]));
      if (!row) throw new HttpError(404, 'not_found', 'That version no longer exists');
      return send(res, 200, versionOut(row));
    }

    if (path === '/v1/trash' && method === 'GET') {
      const items = db.trash(vid).map((t) => ({ ...versionOut(t.head), lastLiveVersion: t.lastLive }));
      return send(res, 200, { items });
    }

    if (path === '/v1/trash/empty' && method === 'POST') {
      const b = await readJson(req);
      const ids = Array.isArray(b.fileIds) ? b.fileIds.filter((x: unknown) => typeof x === 'string') : undefined;
      const purged = db.purgeDeleted(vid, ids);
      // No grace period here: if a device is mid-upload of one of these chunks, its commit is refused
      // as "missing chunks" and it simply uploads again.
      const r = await runRetention(retentionCtx, { prune: false, vaultId: vid, graceMs: -1 });
      return send(res, 200, { purgedVersions: purged, freedBytes: r.freedBytes });
    }

    throw new HttpError(404, 'not_found', 'Not found');
  }

  const retentionCtx = { db, store, gcLocks, now, retentionDays, gcGraceMs, log };

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (res.headersSent) return void res.destroy();
      if (e instanceof HttpError) return send(res, e.status, { error: e.code, message: e.message, ...e.extra }, e.headers);
      log(`error: ${e?.stack ?? e}`);
      send(res, 500, { error: 'internal', message: 'Something went wrong on the sync server' });
    });
  });
  server.requestTimeout = 5 * 60_000;
  server.headersTimeout = 30_000;
  server.keepAliveTimeout = 30_000;

  // ---- websocket: /v1/live ----
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 4096,
    handleProtocols: (protocols) => (protocols.has(WS_PROTOCOL) ? WS_PROTOCOL : false),
  });
  const heartbeatMs = o.heartbeatMs ?? 25_000;

  /** Token travels in Sec-WebSocket-Protocol as "bearer.<base64url(token)>" so it never lands in URLs or logs. */
  function tokenFromProtocols(h: string | undefined): string | null {
    if (!h) return null;
    for (const p of h.split(',').map((s) => s.trim())) {
      if (p.startsWith('bearer.')) {
        try {
          return Buffer.from(p.slice(7), 'base64url').toString('utf8');
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  function reject(socket: Duplex, status: number, msg: string): void {
    socket.write(`HTTP/1.1 ${status} ${msg}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/v1/live') return reject(socket, 404, 'Not Found');
    const token = tokenFromProtocols(req.headers['sec-websocket-protocol'] as string | undefined);
    auth.verify(token).then(
      (userId) => {
        const n = socketsPerUser.get(userId) ?? 0;
        if (n >= (o.maxSocketsPerUser ?? 20)) return reject(socket, 429, 'Too Many Requests');
        wss.handleUpgrade(req, socket, head, (ws) => {
          const vault = db.getOrCreateVault(userId, now());
          socketsPerUser.set(userId, (socketsPerUser.get(userId) ?? 0) + 1);
          let set = sockets.get(vault.vault_id);
          if (!set) sockets.set(vault.vault_id, (set = new Set()));
          set.add(ws);
          let alive = true;
          let lastAuth = now();
          ws.on('pong', () => (alive = true));
          ws.on('message', () => {}); // clients may send {type:"ping"}; nothing to do
          const timer = setInterval(() => {
            if (!alive) return ws.terminate();
            alive = false;
            ws.ping();
            if (ws.readyState === 1) ws.send('{"type":"ping"}');
            if (now() - lastAuth > 5 * 60_000) {
              lastAuth = now();
              auth.verify(token).catch((e) => {
                if (e instanceof AuthError) ws.close(4401, 'sign-in expired');
              });
            }
          }, heartbeatMs);
          ws.on('close', () => {
            clearInterval(timer);
            set!.delete(ws);
            if (!set!.size) sockets.delete(vault.vault_id);
            socketsPerUser.set(userId, (socketsPerUser.get(userId) ?? 1) - 1);
          });
          ws.send(JSON.stringify({ type: 'seq', seq: vault.seq }));
        });
      },
      (e) => reject(socket, e instanceof AuthError ? 401 : 503, e instanceof AuthError ? 'Unauthorized' : 'Service Unavailable'),
    );
  });

  let boundPort = 0;
  const api: SyncServer = {
    server,
    db,
    store,
    auth,
    stats,
    get port() {
      return boundPort;
    },
    get url() {
      return `http://127.0.0.1:${boundPort}`;
    },
    listen(port = 0, host = '127.0.0.1') {
      return new Promise((resolve, rej) => {
        server.once('error', rej);
        server.listen(port, host, () => {
          boundPort = (server.address() as { port: number }).port;
          resolve();
        });
      });
    },
    async close() {
      for (const set of sockets.values()) for (const ws of set) ws.terminate();
      await new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      });
      wss.close();
      db.close();
    },
    runRetention: (opts) => runRetention(retentionCtx, opts),
  };
  return api;
}
