// HTTP client for the Bedrock sync service.

export type FetchLike = typeof fetch;

export class SyncError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'network' | 'quota' | 'server' | 'client' | 'key',
    readonly status = 0,
    readonly body?: any,
  ) {
    super(message);
  }
}

export interface VaultInfo {
  vaultId: string;
  seq: number;
  usedBytes: number;
  quotaBytes: number;
  retentionDays: number;
  maxFileBytes: number;
  keyCheck: string | null;
  direct: boolean;
  directThreshold: number;
}

export interface RemoteVersion {
  fileId: string;
  version: number;
  seq: number;
  meta: string;
  chunks: string[];
  size: number;
  deleted: boolean;
  deviceId?: string | null;
  createdAt?: number;
}

export interface CommitRequest {
  fileId: string;
  baseVersion: number;
  meta: string;
  chunks: string[];
  size: number;
  deleted: boolean;
  deviceId: string;
}

export type CommitResponse =
  | { fileId: string; ok: true; version: number; seq: number }
  | { fileId: string; ok: false; status: 409; current: RemoteVersion | null }
  | { fileId: string; ok: false; status: 400; error: string; message: string; missing?: string[] };

export function encodeFrames(items: Array<{ id: string; data: Uint8Array }>): Buffer {
  const parts: Buffer[] = [];
  for (const it of items) {
    const h = Buffer.alloc(68);
    h.write(it.id, 0, 'ascii');
    h.writeUInt32BE(it.data.length, 64);
    parts.push(h, Buffer.from(it.data.buffer, it.data.byteOffset, it.data.byteLength));
  }
  return Buffer.concat(parts);
}

export function decodeFrames(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let o = 0;
  while (o + 68 <= buf.length) {
    const id = buf.toString('ascii', o, o + 64);
    const len = buf.readUInt32BE(o + 64);
    o += 68;
    if (o + len > buf.length) throw new SyncError('Truncated chunk batch from server', 'server');
    out.set(id, buf.subarray(o, o + len));
    o += len;
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SyncApi {
  /** Counters, handy for tests and diagnostics (never sent anywhere). */
  stats = { requests: 0, bytesUp: 0, bytesDown: 0, chunksUp: 0, chunksDown: 0 };

  constructor(
    private readonly serverUrl: string,
    private readonly getToken: () => Promise<string | null>,
    private readonly fetchFn: FetchLike = globalThis.fetch,
  ) {}

  private async token(): Promise<string> {
    let t: string | null;
    try {
      t = await this.getToken();
    } catch {
      t = null;
    }
    if (!t) throw new SyncError('Sign in to Toolbay to sync this vault.', 'auth', 401);
    return t;
  }

  private async raw(method: string, path: string, init: { json?: unknown; body?: Uint8Array; signal?: AbortSignal } = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.token();
      const headers: Record<string, string> = { authorization: `Bearer ${token}` };
      let body: BodyInit | undefined;
      if (init.json !== undefined) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(init.json);
      } else if (init.body) {
        headers['content-type'] = 'application/octet-stream';
        body = init.body as unknown as BodyInit;
        this.stats.bytesUp += init.body.length;
      }
      let res: Response;
      this.stats.requests++;
      try {
        res = await this.fetchFn(new URL(path, this.serverUrl), { method, headers, body, signal: init.signal ?? AbortSignal.timeout(120_000) });
      } catch (e) {
        throw new SyncError(`Cannot reach the sync server (${(e as Error).message})`, 'network');
      }
      if (res.ok) return res;
      let data: any = null;
      try {
        data = await res.json();
      } catch {
        /* not json */
      }
      const msg = data?.message || `Sync server error ${res.status}`;
      if ((res.status === 429 || res.status === 503) && attempt < 4) {
        const wait = Math.min(30, Number(res.headers.get('retry-after')) || 2 ** attempt);
        await sleep(wait * 1000);
        continue;
      }
      if (res.status === 401) throw new SyncError('Your Toolbay sign-in has expired. Sign in to Toolbay again to keep syncing.', 'auth', 401, data);
      if (res.status === 413 && data?.error === 'quota_exceeded') throw new SyncError(msg, 'quota', 413, data);
      if (res.status === 409) throw new SyncError(msg, 'client', 409, data);
      if (res.status >= 500 || res.status === 429) throw new SyncError(msg, 'network', res.status, data);
      throw new SyncError(msg, 'client', res.status, data);
    }
  }

  private async json<T>(method: string, path: string, json?: unknown): Promise<T> {
    const res = await this.raw(method, path, { json });
    return (await res.json()) as T;
  }

  vault(): Promise<VaultInfo> {
    return this.json('GET', '/v1/vault');
  }

  async setKeyCheck(keyCheck: string): Promise<string> {
    return (await this.json<{ keyCheck: string }>('POST', '/v1/vault/key-check', { keyCheck })).keyCheck;
  }

  /** Deletes the whole vault on the server and starts it over under key check `to` (see server rekey). */
  rekey(from: string | null, to: string): Promise<VaultInfo> {
    return this.json('POST', '/v1/vault/rekey', { from, to });
  }

  async missingChunks(ids: string[]): Promise<Set<string>> {
    const missing = new Set<string>();
    for (let i = 0; i < ids.length; i += 5000) {
      const r = await this.json<{ missing: string[] }>('POST', '/v1/chunks/check', { ids: ids.slice(i, i + 5000) });
      for (const id of r.missing) missing.add(id);
    }
    return missing;
  }

  async uploadBatch(items: Array<{ id: string; data: Uint8Array }>): Promise<void> {
    if (!items.length) return;
    await this.raw('POST', '/v1/chunks/batch', { body: encodeFrames(items) });
    this.stats.chunksUp += items.length;
  }

  async putChunk(id: string, data: Uint8Array): Promise<void> {
    await this.raw('PUT', `/v1/chunks/${id}`, { body: data });
    this.stats.chunksUp++;
  }

  async uploadUrls(chunks: Array<{ id: string; size: number }>): Promise<Record<string, string>> {
    return (await this.json<{ urls: Record<string, string> }>('POST', '/v1/chunks/upload-urls', { chunks })).urls;
  }

  /** PUT straight to the bucket (presigned URL; no Toolbay token is sent there). */
  async putDirect(url: string, data: Uint8Array): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchFn(url, { method: 'PUT', body: data as unknown as BodyInit, signal: AbortSignal.timeout(300_000) });
    } catch (e) {
      throw new SyncError(`Upload failed (${(e as Error).message})`, 'network');
    }
    if (!res.ok) throw new SyncError(`Upload to storage failed (${res.status})`, 'network', res.status);
    this.stats.bytesUp += data.length;
    this.stats.chunksUp++;
  }

  async confirmChunks(ids: string[]): Promise<string[]> {
    return (await this.json<{ missing: string[] }>('POST', '/v1/chunks/confirm', { ids })).missing;
  }

  async getChunk(id: string): Promise<Buffer> {
    const res = await this.raw('GET', `/v1/chunks/${id}`);
    const b = Buffer.from(await res.arrayBuffer());
    this.stats.bytesDown += b.length;
    this.stats.chunksDown++;
    return b;
  }

  /** Fetches many small chunks in as few requests as possible. */
  async fetchChunks(ids: string[]): Promise<Map<string, Buffer>> {
    const out = new Map<string, Buffer>();
    let pending = [...new Set(ids)];
    while (pending.length) {
      const batch = pending.slice(0, 2000);
      const res = await this.raw('POST', '/v1/chunks/fetch', { json: { ids: batch } });
      const buf = Buffer.from(await res.arrayBuffer());
      this.stats.bytesDown += buf.length;
      const got = decodeFrames(buf);
      if (!got.size) throw new SyncError('The sync server is missing data for some files', 'server');
      for (const [id, data] of got) out.set(id, data);
      this.stats.chunksDown += got.size;
      pending = pending.filter((id) => !out.has(id));
    }
    return out;
  }

  async commit(commits: CommitRequest[]): Promise<{ results: CommitResponse[]; seq: number }> {
    return this.json('POST', '/v1/commit', { commits });
  }

  changes(since: number, limit = 1000): Promise<{ changes: RemoteVersion[]; seq: number; more: boolean }> {
    return this.json('GET', `/v1/changes?since=${since}&limit=${limit}`);
  }

  async versions(fileId: string): Promise<RemoteVersion[]> {
    return (await this.json<{ versions: RemoteVersion[] }>('GET', `/v1/files/${encodeURIComponent(fileId)}/versions`)).versions;
  }

  version(fileId: string, version: number): Promise<RemoteVersion> {
    return this.json('GET', `/v1/files/${encodeURIComponent(fileId)}/versions/${version}`);
  }

  async trash(): Promise<Array<RemoteVersion & { lastLiveVersion: number | null }>> {
    return (await this.json<{ items: Array<RemoteVersion & { lastLiveVersion: number | null }> }>('GET', '/v1/trash')).items;
  }

  emptyTrash(fileIds?: string[]): Promise<{ purgedVersions: number; freedBytes: number }> {
    return this.json('POST', '/v1/trash/empty', { fileIds });
  }
}
