import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { createSyncServer, encodeFrames, WS_PROTOCOL, type ServerOptions, type SyncServer } from '../src/app.js';
import { Authenticator } from '../src/auth.js';
import { S3Store } from '../src/storage/index.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!().catch(() => {});
});

async function fakeMe(users: Record<string, string>) {
  const state = { calls: 0, down: false };
  const srv = http.createServer((req, res) => {
    state.calls++;
    if (state.down) {
      res.writeHead(502);
      return res.end();
    }
    const tok = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const id = tok ? users[tok] : undefined;
    res.writeHead(id ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(id ? { user: { id, email: 'x@y.z' } } : { error: 'unauthorized' }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  cleanup.push(() => new Promise((r) => srv.close(r)));
  return { url: `http://127.0.0.1:${(srv.address() as any).port}`, state };
}

async function server(opts: Partial<ServerOptions> = {}): Promise<SyncServer> {
  const dataDir = await mkdtemp(join(tmpdir(), 'bedrock-srvtest-'));
  const s = createSyncServer({ dataDir, devAuth: true, ...opts });
  await s.listen(0);
  cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
  cleanup.push(() => s.close());
  return s;
}

const id64 = (s: string) => createHash('sha256').update(s).digest('hex');

function client(s: SyncServer, token = 'dev:u1') {
  const call = async (method: string, path: string, body?: unknown, raw?: Buffer) => {
    const res = await fetch(s.url + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: raw ? (raw as any) : body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* binary */
    }
    return { status: res.status, json, headers: res.headers };
  };
  return {
    call,
    put: (id: string, data: Buffer) => call('PUT', `/v1/chunks/${id}`, undefined, data),
    commit: (fileId: string, baseVersion: number, chunks: string[] = [], extra: object = {}) =>
      call('POST', `/v1/files/${fileId}/commit`, { baseVersion, meta: 'bWV0YQ==', chunks, size: 10, deleted: false, deviceId: 'd1', ...extra }),
  };
}

describe('auth', () => {
  it('caches positive answers 5 min and negative 30 s; upstream failure is 503 and not cached', async () => {
    const me = await fakeMe({ good: 'user-1' });
    let now = 1_000_000;
    const auth = new Authenticator({ toolbayApi: me.url, now: () => now });
    expect(await auth.verify('good')).toBe('user-1');
    expect(await auth.verify('good')).toBe('user-1');
    expect(me.state.calls).toBe(1);
    now += 4 * 60_000;
    await auth.verify('good');
    expect(me.state.calls).toBe(1);
    now += 2 * 60_000;
    await auth.verify('good');
    expect(me.state.calls).toBe(2);

    await expect(auth.verify('bad')).rejects.toMatchObject({ status: 401 });
    await expect(auth.verify('bad')).rejects.toMatchObject({ status: 401 });
    expect(me.state.calls).toBe(3);
    now += 31_000;
    await expect(auth.verify('bad')).rejects.toMatchObject({ status: 401 });
    expect(me.state.calls).toBe(4);

    me.state.down = true;
    await expect(auth.verify('other')).rejects.toMatchObject({ status: 503 });
    me.state.down = false;
    await expect(auth.verify('other')).rejects.toMatchObject({ status: 401 });
    expect(me.state.calls).toBe(6);

    // concurrent checks of one token make one upstream call
    now += 10 * 60_000;
    const before = me.state.calls;
    await Promise.all([auth.verify('good'), auth.verify('good'), auth.verify('good')]);
    expect(me.state.calls).toBe(before + 1);
  });

  it('dev tokens only work with DEV_AUTH; HTTP answers 401 with a plain message', async () => {
    const me = await fakeMe({});
    const s = await server({ devAuth: false, toolbayApi: me.url });
    const r = await client(s).call('GET', '/v1/vault');
    expect(r.status).toBe(401);
    expect(r.json.message).toMatch(/sign-in/i);
    const s2 = await server({ devAuth: true });
    expect((await client(s2).call('GET', '/v1/vault')).status).toBe(200);
  });
});

describe('protocol', () => {
  it('health check', async () => {
    const s = await server();
    const r = await fetch(s.url + '/healthz');
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, service: 'bedrock-sync' });
  });

  it('creates one vault per user on first call; users are isolated', async () => {
    const s = await server();
    const a = await client(s, 'dev:alice').call('GET', '/v1/vault');
    const a2 = await client(s, 'dev:alice').call('GET', '/v1/vault');
    const b = await client(s, 'dev:bob').call('GET', '/v1/vault');
    expect(a.json.vaultId).toBe(a2.json.vaultId);
    expect(b.json.vaultId).not.toBe(a.json.vaultId);
    expect(a.json).toMatchObject({ seq: 0, usedBytes: 0, quotaBytes: 10 * 1024 ** 3, retentionDays: 90 });
    const data = randomBytes(100);
    await client(s, 'dev:alice').put(id64('x'), data);
    expect((await client(s, 'dev:bob').call('GET', `/v1/chunks/${id64('x')}`)).status).toBe(404);
  });

  it('commits with optimistic concurrency: 409 on stale baseVersion', async () => {
    const s = await server();
    const c = client(s);
    const id = id64('chunk1');
    expect((await c.commit('file-0001', 0, [id])).status).toBe(400); // chunk not uploaded yet
    await c.put(id, Buffer.from('enc'));
    const r1 = await c.commit('file-0001', 0, [id]);
    expect(r1.status).toBe(200);
    expect(r1.json).toEqual({ version: 1, seq: 1 });
    const r2 = await c.commit('file-0001', 0, [id]);
    expect(r2.status).toBe(409);
    expect(r2.json.current).toMatchObject({ fileId: 'file-0001', version: 1, chunks: [id], deleted: false });
    expect((await c.commit('file-0001', 1, [id])).json).toEqual({ version: 2, seq: 2 });
    // batch commit: per-item results
    const b = await c.call('POST', '/v1/commit', {
      commits: [
        { fileId: 'file-0001', baseVersion: 2, meta: 'x', chunks: [], size: 0, deleted: true },
        { fileId: 'file-0002', baseVersion: 5, meta: 'x', chunks: [], size: 0, deleted: false },
      ],
    });
    expect(b.json.results.map((x: any) => [x.ok, x.status])).toEqual([
      [true, undefined],
      [false, 409],
    ]);
    const trash = await c.call('GET', '/v1/trash');
    expect(trash.json.items.map((t: any) => [t.fileId, t.lastLiveVersion])).toEqual([['file-0001', 2]]);
    const versions = await c.call('GET', '/v1/files/file-0001/versions');
    expect(versions.json.versions.map((v: any) => v.version)).toEqual([3, 2, 1]);
    expect((await c.call('GET', '/v1/files/file-0001/versions/1')).json.version).toBe(1);
  });

  it('pages the changes feed by seq, returning only the latest version of each file', async () => {
    const s = await server();
    const c = client(s);
    for (let i = 0; i < 25; i++) await c.commit(`file-${String(i).padStart(4, '0')}`, 0);
    await c.commit('file-0003', 1); // moves file-0003 to the end
    const seen: string[] = [];
    let since = 0;
    let pages = 0;
    for (;;) {
      const r = await c.call('GET', `/v1/changes?since=${since}&limit=10`);
      pages++;
      seen.push(...r.json.changes.map((x: any) => `${x.fileId}@${x.version}`));
      since = r.json.seq;
      if (!r.json.more) break;
    }
    expect(pages).toBe(3);
    expect(seen.length).toBe(25);
    expect(seen[seen.length - 1]).toBe('file-0003@2');
    expect(since).toBe(26);
    expect((await c.call('GET', `/v1/changes?since=26`)).json).toEqual({ changes: [], seq: 26, more: false });
  });

  it('enforces quota (413 with a clear message), chunk size and request size limits', async () => {
    const s = await server({ quotaBytes: 1000, maxChunkBytes: 600, maxJsonBytes: 2000 });
    const c = client(s);
    expect((await c.put(id64('a'), Buffer.alloc(500))).status).toBe(200);
    const over = await c.put(id64('b'), Buffer.alloc(501));
    expect(over.status).toBe(413);
    expect(over.json.error).toBe('quota_exceeded');
    expect(over.json.message).toMatch(/vault is full/);
    expect((await c.put(id64('c'), Buffer.alloc(700))).status).toBe(413);
    // batch upload counts against quota too
    const batch = encodeFrames([
      { id: id64('d'), data: Buffer.alloc(300) },
      { id: id64('e'), data: Buffer.alloc(300) },
    ]);
    expect((await c.call('POST', '/v1/chunks/batch', undefined, batch)).status).toBe(413);
    // re-uploading an existing chunk is free
    expect((await c.put(id64('a'), Buffer.alloc(500))).status).toBe(200);
    const big = await c.call('POST', '/v1/chunks/check', { ids: Array.from({ length: 100 }, (_, i) => id64(String(i))) });
    expect(big.status).toBe(413);
    expect((await c.call('GET', '/v1/vault')).json.usedBytes).toBe(500);
  });

  it('rate limits per user with 429 + Retry-After', async () => {
    const s = await server({ rateLimitPerSec: 1, rateLimitBurst: 5 });
    const c = client(s);
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await c.call('GET', '/v1/vault')).status);
    expect(codes.slice(0, 5).every((x) => x === 200)).toBe(true);
    expect(codes).toContain(429);
    const other = client(s, 'dev:someone-else');
    expect((await other.call('GET', '/v1/vault')).status).toBe(200);
  });

  it('websocket pushes the new seq after a commit; bad tokens are refused', async () => {
    const s = await server();
    const wsUrl = s.url.replace('http', 'ws') + '/v1/live';
    const proto = (t: string) => [WS_PROTOCOL, 'bearer.' + Buffer.from(t).toString('base64url')];
    const ws = new WebSocket(wsUrl, proto('dev:u1'));
    const msgs: any[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
    await new Promise((r, j) => {
      ws.on('open', r);
      ws.on('error', j);
    });
    expect(ws.protocol).toBe(WS_PROTOCOL);
    await new Promise((r) => setTimeout(r, 50));
    expect(msgs[0]).toEqual({ type: 'seq', seq: 0 });
    await client(s).commit('file-0001', 0);
    await new Promise((r) => setTimeout(r, 100));
    expect(msgs.at(-1)).toEqual({ type: 'seq', seq: 1 });
    ws.close();
    const bad = new WebSocket(wsUrl, proto('nope'));
    const err = await new Promise<string>((r) => {
      bad.on('unexpected-response', (_req, res) => r(String(res.statusCode)));
      bad.on('error', (e) => r(e.message));
    });
    expect(err).toMatch(/401/);
  });
});

describe('retention and garbage collection', () => {
  it('prunes old versions except the current one and deletes unreferenced chunks after the grace period', async () => {
    let now = Date.UTC(2026, 0, 1);
    const day = 86_400_000;
    const s = await server({ now: () => now, retentionDays: 90, gcGraceMs: day });
    const c = client(s);
    const [c1, c2, c3, orphan] = ['v1', 'v2', 'v3', 'orphan'].map(id64);
    await c.put(c1, Buffer.alloc(100, 1));
    await c.commit('file-0001', 0, [c1]);
    now += 10 * day;
    await c.put(c2, Buffer.alloc(100, 2));
    await c.commit('file-0001', 1, [c2]);
    now += 10 * day;
    await c.put(c3, Buffer.alloc(100, 3));
    await c.commit('file-0001', 2, [c3]);
    await c.put(orphan, Buffer.alloc(100, 4)); // uploaded, never committed (in flight)

    // day 20: nothing is old enough
    let r = await s.runRetention();
    expect(r).toEqual({ prunedVersions: 0, deletedChunks: 0, freedBytes: 0 });
    // day 21: the orphan is past the grace period and goes; history stays
    now += day + 1;
    r = await s.runRetention();
    expect(r.prunedVersions).toBe(0);
    expect(r.deletedChunks).toBe(1);
    expect((await c.call('GET', `/v1/chunks/${orphan}`)).status).toBe(404);
    // day 101: version 1 is older than 90 days and goes with its chunk; v2 is 91 days old too
    now = Date.UTC(2026, 0, 1) + 101 * day;
    r = await s.runRetention();
    expect(r.prunedVersions).toBe(2);
    expect(r.deletedChunks).toBe(2);
    const vs = await c.call('GET', '/v1/files/file-0001/versions');
    expect(vs.json.versions.map((v: any) => v.version)).toEqual([3]);
    expect((await c.call('GET', `/v1/chunks/${c3}`)).status).toBe(200);
    expect((await c.call('GET', `/v1/chunks/${c1}`)).status).toBe(404);
    expect((await c.call('GET', '/v1/vault')).json.usedBytes).toBe(100);
    // the current version is kept forever, even when very old
    now += 1000 * day;
    r = await s.runRetention();
    expect(r.prunedVersions).toBe(0);
    expect((await c.call('GET', `/v1/chunks/${c3}`)).status).toBe(200);
  });

  it('a chunk that was just checked (about to be committed) survives GC', async () => {
    let now = 0;
    const s = await server({ now: () => now, gcGraceMs: 1000 });
    const c = client(s);
    const id = id64('reuse');
    await c.put(id, Buffer.alloc(10));
    now = 5000;
    expect((await c.call('POST', '/v1/chunks/check', { ids: [id] })).json.missing).toEqual([]);
    now = 5500;
    expect((await s.runRetention()).deletedChunks).toBe(0);
    expect((await c.commit('file-0009', 0, [id])).status).toBe(200);
  });
});

describe('S3 backend', () => {
  it('builds presigned PUT/GET URLs (signed content length) without network access', async () => {
    const st = new S3Store({ endpoint: 'https://acct.r2.cloudflarestorage.com', bucket: 'bedrock-vaults', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' });
    const put = new URL(await st.presignPut('vault/abc', 1234, 900));
    expect(put.pathname).toBe('/bedrock-vaults/vault/abc');
    expect(put.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(put.searchParams.get('X-Amz-SignedHeaders')).toContain('content-length');
    const get = new URL(await st.presignGet('vault/abc', 900));
    expect(get.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });
});
