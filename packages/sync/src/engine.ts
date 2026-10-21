// The Bedrock sync engine. One instance per vault folder; runs in the app's main process.
//
// A sync cycle is: scan local -> pull remote changes (merge / conflict copies) -> push local changes.
// If a push is rejected because the server moved on (409), the cycle pulls and pushes again.
// Rule of the house: never lose data. A locally changed file is never overwritten; it is merged or
// the other version is written next to it as a conflict copy.

import { EventEmitter } from 'node:events';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rmdir, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { SyncApi, SyncError, type CommitRequest, type FetchLike, type RemoteVersion, type VaultInfo } from './api.js';
import { forEachChunk, hashFile, mapLimit } from './chunker.js';
import { CHUNK_SIZE } from './constants.js';
import {
  chunkId,
  decryptChunk,
  decryptMeta,
  deriveKeys,
  encryptChunk,
  encryptMeta,
  sha256,
  type FileMeta,
  type VaultKeys,
} from './crypto.js';
import { isIgnored, TEMP_PREFIX, type IgnoreOptions } from './ignore.js';
import { LiveClient, type WebSocketCtor } from './live.js';
import { isTextPath, MAX_MERGE_BYTES, mergeFile } from './merge.js';
import { baseName, conflictPath, dirOf, isUnder, nfc, pathKey, safePath, toPosix } from './paths.js';
import { isEmptyDir, scanPaths, statEntry, walk, type Entry } from './scanner.js';
import { StateStore, type FileRecord } from './state.js';
import { VaultWatcher } from './watcher.js';

export type SyncState = 'off' | 'connecting' | 'syncing' | 'synced' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  /** Plain-language message for the status bar / tooltip. */
  message: string;
  pendingUploads: number;
  pendingDownloads: number;
  lastSyncedAt: number | null;
  /** 'auth' | 'quota' | 'key' | 'network' | 'server' | 'client' when state is error/offline. */
  errorKind?: string;
}

export interface SyncEngineOptions {
  vaultPath: string;
  stateDir: string;
  serverUrl: string;
  getToken: () => Promise<string | null>;
  getVaultKey: () => Promise<Uint8Array>;
  deviceId: string;
  deviceName: string;
  fetch?: FetchLike;
  /** WebSocket constructor; defaults to globalThis.WebSocket. Pass null to disable live updates. */
  WebSocket?: WebSocketCtor | null;
  now?: () => number;
  /** Watch the folder for changes (default true). */
  watch?: boolean;
  /** Poll interval when the websocket is down (default 30 s). */
  pollMs?: number;
  /** Full rescan interval as a safety net for missed watcher events (default 10 min). */
  fullScanMs?: number;
  debounceMs?: number;
  ignore?: IgnoreOptions;
  /**
   * Selective sync (vault-relative '/' paths). Excluded paths are neither uploaded nor downloaded
   * on this computer. Files that were already synced are left alone on both sides: excluding them
   * never deletes them anywhere, and they pick up remote changes again once included.
   * Change it at runtime with setExclude().
   */
  exclude?: (path: string) => boolean;
  uploadConcurrency?: number;
  log?: (msg: string) => void;
}

export interface VersionInfo {
  version: number;
  path: string;
  size: number;
  deleted: boolean;
  createdAt: number | null;
  device: string | null;
  current: boolean;
}

export interface TrashItem {
  fileId: string;
  path: string;
  deletedAt: number | null;
  device: string | null;
  restorable: boolean;
}

interface PullItem {
  c: RemoteVersion;
  meta: FileMeta;
  rec?: FileRecord;
  origLp?: string;
}

type ApplyResult = 'ok' | 'skip';

const SMALL_FILE = 1024 * 1024;
/** The empty-vault guard only applies when at least this many synced files would vanish at once. */
const EMPTY_GUARD_MIN_FILES = 3;
export const EMPTY_VAULT_MESSAGE =
  'The vault folder is empty or missing, so sync is paused to keep your notes safe on your other computers. Put the files back (or restart the app) and sync carries on.';
const COMMIT_BATCH = 500;
const UPLOAD_BATCH_BYTES = 8 * 1024 * 1024;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function retryFs<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e: any) {
      if (i >= 6 || !['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(e.code)) throw e;
      await sleep(40 * (i + 1));
    }
  }
}

export class SyncEngine extends EventEmitter {
  readonly api: SyncApi;
  private readonly root: string;
  private readonly state: StateStore;
  private readonly ignore: IgnoreOptions;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private keys: VaultKeys | null = null;
  private vault: VaultInfo | null = null;
  private loaded = false;
  private started = false;
  private watcher: VaultWatcher | null = null;
  private live: LiveClient | null = null;
  private timers: NodeJS.Timeout[] = [];
  private retryTimer: NodeJS.Timeout | null = null;
  private failures = 0;

  // scheduling
  private loopPromise: Promise<void> | null = null;
  private wantFull = false;
  private wantPaths = new Set<string>();
  private wantAny = false;
  private requestedGen = 0;
  private completedGen = 0;
  private waiters: Array<{ gen: number; resolve: (s: SyncStatus) => void }> = [];

  // per-cycle scratch
  private chunkCache = new Map<string, Buffer>();
  private touchedDirs = new Set<string>();
  private renameHints = new Map<string, string>();
  private skippedTooBig = new Set<string>();

  private _status: SyncStatus = { state: 'off', message: 'Sync is off', pendingUploads: 0, pendingDownloads: 0, lastSyncedAt: null };

  constructor(private readonly o: SyncEngineOptions) {
    super();
    this.root = resolve(o.vaultPath);
    this.now = o.now ?? Date.now;
    this.log = o.log ?? (() => {});
    this.api = new SyncApi(o.serverUrl, o.getToken, o.fetch ?? globalThis.fetch);
    this.state = new StateStore(o.stateDir);
    const prefixes = [...(o.ignore?.prefixes ?? [])];
    const relState = relative(this.root, resolve(o.stateDir));
    if (relState && !relState.startsWith('..') && !relState.includes(':')) prefixes.push(toPosix(relState));
    this.ignore = { prefixes, patterns: o.ignore?.patterns, exclude: o.exclude ?? o.ignore?.exclude };
  }

  // ------------------------------------------------------------------ public API

  get status(): SyncStatus {
    return { ...this._status };
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.setStatus({ state: 'connecting', message: 'Connecting…' });
    if (this.o.watch !== false) {
      this.watcher = new VaultWatcher(this.root, this.ignore, (paths) => this.request(paths ? { paths } : { full: true }), {
        debounceMs: this.o.debounceMs,
      });
      this.watcher.start();
    }
    const WS = this.o.WebSocket === undefined ? ((globalThis as any).WebSocket as WebSocketCtor | undefined) : this.o.WebSocket ?? undefined;
    if (WS) {
      this.live = new LiveClient(
        this.o.serverUrl,
        this.o.getToken,
        WS,
        (seq) => {
          if (seq > this.state.data.lastSeq) this.request({});
        },
        (up) => {
          if (up) this.request({}); // catch up whatever happened while disconnected
        },
      );
      this.live.start();
    }
    const poll = setInterval(() => {
      if (!this.live?.connected) this.request({});
    }, this.o.pollMs ?? 30_000);
    const full = setInterval(() => this.request({ full: true }), this.o.fullScanMs ?? 10 * 60_000);
    poll.unref?.();
    full.unref?.();
    this.timers.push(poll, full);
    this.request({ full: true });
  }

  async stop(): Promise<void> {
    this.started = false;
    this.watcher?.stop();
    this.watcher = null;
    this.live?.stop();
    this.live = null;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.wantAny = false;
    this.wantFull = false;
    this.wantPaths.clear();
    if (this.loopPromise) await this.loopPromise.catch(() => {});
    if (this.loaded) await this.state.save().catch(() => {});
    this.setStatus({ state: 'off', message: 'Sync is off' });
  }

  /** Runs a full sync (scan everything, pull, push) and resolves when it is done. */
  syncNow(): Promise<SyncStatus> {
    return new Promise((resolve) => {
      this.request({ full: true });
      this.waiters.push({ gen: this.requestedGen, resolve });
    });
  }

  /** Tells the engine the app renamed a file (keeps history attached even if the content also changed). */
  notifyRename(from: string, to: string): void {
    this.renameHints.set(pathKey(toPosix(from)), toPosix(to));
    this.request({ paths: new Set([toPosix(from), toPosix(to)]) });
  }

  /**
   * Changes the selective-sync rule. Re-reads the whole server list on the next cycle so files
   * that became included are downloaded (or adopted if this computer already has them).
   */
  setExclude(exclude: ((path: string) => boolean) | undefined): void {
    this.ignore.exclude = exclude;
    this.repullAll = true;
    if (this.started) this.request({ full: true });
  }
  private repullAll = false;

  private excluded(p: string): boolean {
    return !!p && !!this.ignore.exclude?.(p);
  }

  /** The bytes of one version of a file (for diffs in the version history). */
  async versionContent(path: string, version: number): Promise<Buffer> {
    await this.ensureReady();
    const rec = this.state.byLocalPath(toPosix(path)) ?? this.state.all().find((r) => pathKey(r.sp) === pathKey(toPosix(path)));
    if (!rec || rec.v === 0) throw new SyncError(`"${path}" is not synced yet`, 'client');
    return this.readVersion(rec.id, version);
  }

  /** The bytes of the last version of a deleted file (to preview it in the recycle bin). */
  async trashContent(fileId: string): Promise<Buffer> {
    await this.ensureReady();
    const item = (await this.api.trash()).find((t) => t.fileId === fileId);
    if (!item || item.lastLiveVersion === null) throw new SyncError('That file is not in the recycle bin', 'client');
    return this.readVersion(fileId, item.lastLiveVersion);
  }

  async usage(): Promise<{ usedBytes: number; quotaBytes: number; retentionDays: number }> {
    const v = await this.api.vault();
    return { usedBytes: v.usedBytes, quotaBytes: v.quotaBytes, retentionDays: v.retentionDays };
  }

  async listVersions(path: string): Promise<VersionInfo[]> {
    await this.ensureReady();
    const rec = this.state.byLocalPath(toPosix(path)) ?? this.state.all().find((r) => pathKey(r.sp) === pathKey(toPosix(path)));
    if (!rec || rec.v === 0) return [];
    const rows = await this.api.versions(rec.id);
    const head = rows.reduce((m, r) => Math.max(m, r.version), 0);
    return rows.map((r) => {
      const meta = decryptMeta(this.keys!, rec.id, r.meta);
      return {
        version: r.version,
        path: meta.path,
        size: r.deleted ? 0 : meta.size,
        deleted: r.deleted,
        createdAt: r.createdAt ?? null,
        device: meta.device ?? null,
        current: r.version === head,
      };
    });
  }

  /** Makes an old version the current one (as a new version, so nothing is lost) and writes it locally. */
  async restoreVersion(path: string, version: number): Promise<void> {
    await this.syncNow();
    const p = toPosix(path);
    for (let attempt = 0; attempt < 4; attempt++) {
      const rec = this.state.byLocalPath(p);
      if (!rec || rec.v === 0) throw new SyncError(`"${p}" is not synced yet`, 'client');
      const old = await this.api.version(rec.id, version);
      if (old.deleted) throw new SyncError('That version is a deletion; pick an earlier one', 'client');
      const oldMeta = decryptMeta(this.keys!, rec.id, old.meta);
      const meta: FileMeta = { ...oldMeta, path: rec.sp, mtime: this.now(), device: this.o.deviceName };
      const r = await this.api.commit([
        { fileId: rec.id, baseVersion: rec.v, meta: encryptMeta(this.keys!, rec.id, meta), chunks: old.chunks, size: old.size, deleted: false, deviceId: this.o.deviceId },
      ]);
      await this.syncNow();
      if (r.results[0].ok) return;
    }
    throw new SyncError('Could not restore the version because the file keeps changing; try again', 'client');
  }

  async listTrash(): Promise<TrashItem[]> {
    await this.ensureReady();
    const items = await this.api.trash();
    const out: TrashItem[] = [];
    for (const t of items) {
      const meta = decryptMeta(this.keys!, t.fileId, t.meta);
      if (meta.kind === 'folder') continue; // empty-folder markers are not interesting in the recycle bin
      out.push({ fileId: t.fileId, path: meta.path, deletedAt: t.createdAt ?? null, device: meta.device ?? null, restorable: t.lastLiveVersion !== null });
    }
    return out;
  }

  /** Brings a deleted file back (under "<name> (restored …)" if its old path is taken). */
  async restoreFromTrash(fileId: string): Promise<string> {
    await this.syncNow();
    for (let attempt = 0; attempt < 4; attempt++) {
      const item = (await this.api.trash()).find((t) => t.fileId === fileId);
      if (!item) throw new SyncError('That file is not in the recycle bin', 'client');
      if (item.lastLiveVersion === null) throw new SyncError('That file is too old to restore', 'client');
      const old = await this.api.version(fileId, item.lastLiveVersion);
      const oldMeta = decryptMeta(this.keys!, fileId, old.meta);
      let path = oldMeta.path;
      if (this.state.idAtPath(pathKey(path)) || existsSync(this.abs(path)))
        path = conflictPath(path, this.o.deviceName, this.now(), (p) => this.taken(p), 'restored');
      const meta: FileMeta = { ...oldMeta, path, device: this.o.deviceName };
      const r = await this.api.commit([
        { fileId, baseVersion: item.version, meta: encryptMeta(this.keys!, fileId, meta), chunks: old.chunks, size: old.size, deleted: false, deviceId: this.o.deviceId },
      ]);
      await this.syncNow();
      if (r.results[0].ok) return path;
    }
    throw new SyncError('Could not restore the file; try again', 'client');
  }

  /** Permanently removes the history of deleted files (all of them, or the given ids) to free space. */
  async emptyTrash(fileIds?: string[]): Promise<{ freedBytes: number }> {
    const r = await this.api.emptyTrash(fileIds);
    return { freedBytes: r.freedBytes };
  }

  // ------------------------------------------------------------------ scheduling

  private request(r: { full?: boolean; paths?: Set<string> }): void {
    if (r.full) this.wantFull = true;
    if (r.paths) for (const p of r.paths) this.wantPaths.add(p);
    this.wantAny = true;
    this.requestedGen++;
    if (!this.looping) {
      this.looping = true; // set and cleared synchronously so a request can never fall between two loops
      this.loopPromise = this.loop();
    }
  }
  private looping = false;

  private async loop(): Promise<void> {
    try {
      await Promise.resolve();
      while (this.wantAny) await this.loopOnce();
    } finally {
      this.looping = false; // same tick as the last wantAny check
    }
  }

  private async loopOnce(): Promise<void> {
    {
      const gen = this.requestedGen;
      const full = this.wantFull || !this.watcher?.active;
      const paths = this.wantPaths;
      this.wantAny = false;
      this.wantFull = false;
      this.wantPaths = new Set();
      try {
        await this.cycle(full ? 'full' : paths);
        this.failures = 0;
      } catch (e) {
        this.onCycleError(e, full, paths);
      }
      this.completedGen = gen;
      const ready = this.waiters.filter((w) => w.gen <= gen);
      this.waiters = this.waiters.filter((w) => w.gen > gen);
      for (const w of ready) w.resolve(this.status);
    }
  }

  private onCycleError(e: any, full: boolean, paths: Set<string>): void {
    // nothing scanned in a failed cycle is lost: the next one rescans
    if (full) this.wantFullAfterRetry = true;
    for (const p of paths) this.retryPaths.add(p);
    const err = e instanceof SyncError ? e : new SyncError(e?.message ?? String(e), 'client');
    this.failures++;
    let delay: number;
    if (err.kind === 'network') {
      this.setStatus({ state: 'offline', message: 'Offline. Changes are saved on this computer and will sync when the connection is back.', errorKind: 'network' });
      delay = Math.min(60_000, 2000 * 2 ** Math.min(this.failures - 1, 5));
    } else if (err.kind === 'auth') {
      this.setStatus({ state: 'error', message: err.message, errorKind: 'auth' });
      delay = 30_000;
    } else if (err.kind === 'quota') {
      this.setStatus({ state: 'error', message: err.message, errorKind: 'quota' });
      delay = 5 * 60_000;
    } else {
      this.log(`sync error: ${e?.stack ?? e}`);
      this.setStatus({ state: 'error', message: `Sync problem: ${err.message}`, errorKind: err.kind });
      delay = err.kind === 'key' ? 10 * 60_000 : 30_000;
    }
    if (this.started) {
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.live?.kick();
        this.request({ full: this.wantFullAfterRetry, paths: this.retryPaths });
        this.wantFullAfterRetry = false;
        this.retryPaths = new Set();
      }, delay);
      this.retryTimer.unref?.();
    }
  }
  private wantFullAfterRetry = false;
  private retryPaths = new Set<string>();

  private setStatus(s: Partial<SyncStatus> & { state: SyncState; message: string }): void {
    const next: SyncStatus = { ...this._status, errorKind: undefined, ...s };
    const changed = JSON.stringify(next) !== JSON.stringify(this._status);
    this._status = next;
    if (changed) this.emit('status', this.status);
  }

  private pendingCount(): number {
    let n = 0;
    for (const r of this.state.all()) if (this.needsPush(r)) n++;
    return n;
  }

  // ------------------------------------------------------------------ cycle

  private async ensureReady(): Promise<void> {
    if (!this.loaded) {
      await this.state.load();
      this.loaded = true;
      await this.recoverMoves();
    }
    if (!this.keys) {
      let k: Uint8Array;
      try {
        k = await this.o.getVaultKey();
      } catch (e: any) {
        if (e instanceof SyncError) throw e;
        throw new SyncError(`Could not get the vault key (${e?.message ?? e})`, 'network');
      }
      this.keys = deriveKeys(k);
    }
    const v = await this.api.vault();
    this.vault = v;
    if (this.state.data.vaultId && this.state.data.vaultId !== v.vaultId) {
      // a different vault (other account, or the server vault was recreated): forget sync history,
      // keep every local file; they are re-matched by content on the next pull
      this.log('vault changed; resetting local sync state');
      this.state.reset(v.vaultId);
    }
    this.state.data.vaultId = v.vaultId;
    let kc = v.keyCheck;
    if (!kc) kc = await this.api.setKeyCheck(this.keys.keyCheck);
    if (kc !== this.keys.keyCheck) {
      this.keys = null;
      throw new SyncError(
        "This computer's vault key does not match your Toolbay account's vault. Sign out and back in to Toolbay to fetch the right key.",
        'key',
      );
    }
  }

  private async cycle(scan: 'full' | Set<string>): Promise<void> {
    this.setStatus({ state: 'syncing', message: 'Syncing…' });
    const t0 = performance.now();
    await this.ensureReady();
    const t1 = performance.now();
    if (scan === 'full') await this.scanFull();
    else if (scan.size) await this.scanSome(scan);
    const t2 = performance.now();
    let tPull = 0;
    let tPush = 0;
    for (let round = 0; ; round++) {
      let t = performance.now();
      if (round === 0 && this.repullAll) {
        this.repullAll = false;
        this.state.data.lastSeq = 0;
      }
      if (round > 0 || this.vault!.seq !== this.state.data.lastSeq) await this.pull();
      tPull += performance.now() - t;
      t = performance.now();
      const r = await this.push();
      tPush += performance.now() - t;
      this.log(`cycle timings: ready ${(t1 - t0).toFixed(0)} ms, scan ${(t2 - t1).toFixed(0)} ms, pull ${tPull.toFixed(0)} ms, push ${tPush.toFixed(0)} ms`);
      if (!r.again) break;
      if (round >= 6) throw new SyncError('Files keep changing on the server; will retry shortly', 'network');
    }
    await this.state.save();
    const pending = this.pendingCount();
    this.setStatus({
      state: 'synced',
      message: this.skippedTooBig.size
        ? `Synced, except ${this.skippedTooBig.size} file(s) larger than ${Math.round((this.vault?.maxFileBytes ?? 0) / 1024 ** 2)} MB`
        : 'All changes synced',
      pendingUploads: pending,
      pendingDownloads: 0,
      lastSyncedAt: this.now(),
    });
  }

  // ------------------------------------------------------------------ local scan

  private abs(rel: string): string {
    return join(this.root, ...rel.split('/'));
  }

  private taken(p: string): boolean {
    return this.state.idAtPath(pathKey(p)) !== undefined || existsSync(this.abs(p));
  }

  private async scanFull(): Promise<void> {
    const entries = new Map<string, Entry>();
    const temps: string[] = [];
    if (!existsSync(this.root)) throw new SyncError(EMPTY_VAULT_MESSAGE, 'client');
    await walk(this.root, '', this.ignore, entries, temps);
    await this.cleanTemps(temps);
    const cands = this.state.all().filter((r) => !r.ld && !this.excluded(r.lp));
    // Guard: a vault folder that suddenly has nothing in it (unplugged drive, folder swapped,
    // mistaken bulk delete by another program) must not empty the vault on every other computer.
    if (entries.size === 0 && cands.filter((r) => r.v > 0 && !r.sd && r.kind === 'file').length >= EMPTY_GUARD_MIN_FILES)
      throw new SyncError(EMPTY_VAULT_MESSAGE, 'client');
    await this.reconcile(entries, cands);
  }

  private async scanSome(paths: Set<string>): Promise<void> {
    if (!existsSync(this.root)) throw new SyncError(EMPTY_VAULT_MESSAGE, 'client');
    const { entries, scopes } = await scanPaths(this.root, paths, this.ignore);
    const exact = new Set<string>();
    const trees: string[] = [];
    for (const s of scopes) {
      if (s.startsWith('\u0000')) exact.add(pathKey(s.slice(1)));
      else {
        exact.add(pathKey(s));
        trees.push(s);
      }
    }
    const cands = this.state.all().filter((r) => !r.ld && !this.excluded(r.lp) && (exact.has(pathKey(r.lp)) || trees.some((t) => isUnder(r.lp, t))));
    // paths found that already belong to records outside the candidate set (should not happen) are left alone
    await this.reconcile(entries, cands);
  }

  private async cleanTemps(temps: string[]): Promise<void> {
    for (const t of temps) {
      try {
        const st = await stat(this.abs(t));
        if (this.now() - st.mtimeMs > 3600_000) await unlink(this.abs(t));
      } catch {
        /* ignore */
      }
    }
  }

  private newRecord(id: string, kind: 'file' | 'folder', lp: string): FileRecord {
    return { id, kind, v: 0, sp: '', sh: '', sd: false, lp, lh: kind === 'folder' ? 'folder' : '', ld: false, lm: 0, ls: 0 };
  }

  /** Compares what is on disk (`entries`) with the records that should be there (`cands`). */
  private async reconcile(entries: Map<string, Entry>, cands: FileRecord[]): Promise<void> {
    const missing: FileRecord[] = [];
    const rehash: Array<{ rec: FileRecord; e: Entry }> = [];
    for (const rec of cands) {
      const key = pathKey(rec.lp);
      const e = entries.get(key);
      if (!e || e.kind !== rec.kind) {
        missing.push(rec);
        continue;
      }
      entries.delete(key);
      if (e.path !== rec.lp) this.state.update(rec, { lp: e.path }); // renamed only in letter case / normalization
      if (rec.kind === 'file' && (e.mtimeMs !== rec.lm || e.size !== rec.ls || (rec.li !== undefined && e.ino !== rec.li))) rehash.push({ rec, e });
    }
    await mapLimit(rehash, 16, async ({ rec, e }) => {
      try {
        const h = await hashFile(this.abs(e.path), e.size);
        this.state.update(rec, { lh: h.hash, lm: e.mtimeMs, ls: h.size, lc: e.ctimeMs, li: e.ino });
      } catch {
        missing.push(rec);
      }
    });
    // new paths: hash them, then pair them with missing records (renames/moves)
    const newEntries = [...entries.values()].filter((e) => !this.state.idAtPath(pathKey(e.path))); // others belong to records outside this scan's scope
    const hashed = await mapLimit(newEntries, 16, async (e) => {
      if (e.kind === 'folder') return { e, hash: 'folder' };
      try {
        return { e, hash: (await hashFile(this.abs(e.path), e.size)).hash };
      } catch {
        return null; // vanished meanwhile
      }
    });
    const fresh = hashed.filter((x): x is { e: Entry; hash: string } => x !== null);
    const pool = new Map<string, FileRecord[]>();
    for (const rec of missing) {
      const k = rec.kind === 'folder' ? 'folder' : rec.lh;
      (pool.get(k) ?? pool.set(k, []).get(k)!).push(rec);
    }
    const hinted = new Map<string, FileRecord>();
    for (const rec of missing) {
      const to = this.renameHints.get(pathKey(rec.lp));
      if (to) hinted.set(pathKey(to), rec);
    }
    const used = new Set<string>();
    const deletedHere = new Map<string, FileRecord>();
    if (fresh.length) for (const r of this.state.all()) if (r.ld && r.v > 0) deletedHere.set(pathKey(r.lp) + '\u0000' + r.kind, r);
    for (const { e, hash } of fresh) {
      let rec = hinted.get(pathKey(e.path));
      if (rec && (used.has(rec.id) || rec.kind !== e.kind)) rec = undefined;
      if (!rec) {
        const list = (pool.get(hash) ?? []).filter((r) => !used.has(r.id));
        rec =
          list.find((r) => r.li === e.ino) ??
          list.find((r) => baseName(r.lp) === baseName(e.path)) ??
          list.find((r) => dirOf(r.lp) === dirOf(e.path)) ??
          list[0];
      }
      if (!rec && e.kind === 'file') {
        // renamed AND edited before we looked: same inode, same name or same folder
        rec = missing.find(
          (r) => !used.has(r.id) && r.kind === 'file' && r.li !== undefined && r.li === e.ino && (baseName(r.lp) === baseName(e.path) || dirOf(r.lp) === dirOf(e.path)),
        );
      }
      if (rec) {
        used.add(rec.id);
        this.state.update(rec, { lp: e.path, lh: hash, lm: e.mtimeMs, ls: e.size, lc: e.ctimeMs, li: e.ino, ld: false });
        continue;
      }
      // a path that was deleted locally and recreated before we synced: keep the same file id
      const revived = deletedHere.get(pathKey(e.path) + '\u0000' + e.kind);
      if (revived && !used.has(revived.id)) {
        used.add(revived.id);
        this.state.update(revived, { lp: e.path, lh: hash, lm: e.mtimeMs, ls: e.size, lc: e.ctimeMs, li: e.ino, ld: false });
        continue;
      }
      const r = this.newRecord(randomUUID(), e.kind, e.path);
      Object.assign(r, { lh: hash, lm: e.mtimeMs, ls: e.size, lc: e.ctimeMs, li: e.ino });
      this.state.put(r);
    }
    for (const rec of missing) {
      if (used.has(rec.id)) continue;
      if (rec.v === 0) this.state.remove(rec.id);
      else this.state.update(rec, { ld: true });
    }
    this.renameHints.clear();
  }

  // ------------------------------------------------------------------ pull

  private async pull(): Promise<void> {
    const startSeq = this.state.data.lastSeq;
    let since = startSeq;
    const changes: RemoteVersion[] = [];
    for (;;) {
      const r = await this.api.changes(since, 1000);
      changes.push(...r.changes);
      since = r.seq;
      if (!r.more) break;
    }
    const items: PullItem[] = [];
    for (const c of changes) {
      const rec = this.state.get(c.fileId);
      if (rec && rec.v >= c.version) continue;
      const meta = decryptMeta(this.keys!, c.fileId, c.meta);
      // selective sync: not wanted here (and not already here under a wanted path)
      if (this.excluded(safePath(meta.path)) && (!rec || rec.ld || this.excluded(rec.lp))) continue;
      items.push({ c, meta, rec });
    }
    let skippedSeq = Infinity;
    if (items.length) {
      this.setStatus({ state: 'syncing', message: `Downloading ${items.length} change(s)…`, pendingDownloads: items.length });
      skippedSeq = await this.applyRemote(items);
    }
    this.state.data.lastSeq = skippedSeq === Infinity ? since : Math.max(startSeq, skippedSeq - 1);
    this.state.markDirty();
    await this.state.save();
  }

  /** Applies remote changes; returns the lowest seq that had to be skipped (Infinity if none). */
  private async applyRemote(items: PullItem[]): Promise<number> {
    let skipped = Infinity;
    const skip = (it: PullItem) => (skipped = Math.min(skipped, it.c.seq));
    this.touchedDirs.clear();
    const dels = items.filter((i) => i.c.deleted);
    const lives = items.filter((i) => !i.c.deleted).sort((a, b) => (a.meta.kind === b.meta.kind ? a.c.seq - b.c.seq : a.meta.kind === 'file' ? -1 : 1));

    for (const it of dels) {
      if ((await this.guard(it, () => this.applyDelete(it))) === 'skip') skip(it);
    }

    // Files that move onto a path currently held by another moving file (swaps, cycles) first step aside.
    const movers = new Map<string, PullItem>();
    for (const it of lives) {
      const rec = this.state.get(it.c.fileId);
      it.rec = rec;
      if (rec && !rec.ld) {
        it.origLp = rec.lp;
        if (pathKey(safePath(it.meta.path)) !== pathKey(rec.lp)) movers.set(rec.id, it);
      }
    }
    for (const it of lives) {
      const holder = this.state.idAtPath(pathKey(safePath(it.meta.path)));
      if (holder && holder !== it.c.fileId && movers.has(holder)) {
        const h = this.state.get(holder)!;
        const tmp = `.bedrock-move-${h.id}`;
        await this.moveLocal(h.lp, tmp);
        this.state.update(h, { lp: tmp });
      }
    }

    // Small files: prefetch their chunks in bulk (one request per ~32 MB instead of one per file).
    for (let i = 0; i < lives.length; ) {
      const group: PullItem[] = [];
      let bytes = 0;
      while (i < lives.length && group.length < 1000 && bytes < 32 * 1024 * 1024) {
        group.push(lives[i]);
        if (lives[i].meta.kind === 'file' && lives[i].c.size <= SMALL_FILE) bytes += lives[i].c.size;
        i++;
      }
      const ids = group.filter((g) => g.meta.kind === 'file' && g.c.size <= SMALL_FILE && this.needsDownload(g)).flatMap((g) => g.c.chunks);
      if (ids.length) this.chunkCache = await this.api.fetchChunks(ids);
      // items whose target path is unique in the group cannot collide with each other: run them in parallel
      const count = new Map<string, number>();
      for (const it of group) {
        const k = pathKey(safePath(it.meta.path));
        count.set(k, (count.get(k) ?? 0) + 1);
      }
      const parallel = group.filter((it) => it.meta.kind === 'file' && count.get(pathKey(safePath(it.meta.path))) === 1);
      const inParallel = new Set(parallel);
      const serial = group.filter((it) => !inParallel.has(it));
      await mapLimit(parallel, 16, async (it) => {
        if ((await this.guard(it, () => this.applyLive(it))) === 'skip') skip(it);
      });
      for (const it of serial) {
        if ((await this.guard(it, () => this.applyLive(it))) === 'skip') skip(it);
      }
      this.chunkCache = new Map();
      await this.state.save();
      this.setStatus({ state: 'syncing', message: 'Syncing…', pendingDownloads: Math.max(0, lives.length - i) });
    }
    // anything still parked under a step-aside name (its change was skipped) goes back where it was
    if (movers.size) {
      for (const rec of this.state.all()) {
        if (rec.ld || !rec.lp.startsWith('.bedrock-move-')) continue;
        const back = movers.get(rec.id)?.origLp ?? (rec.sp || `recovered ${rec.id}`);
        const dest = this.taken(back) ? conflictPath(back, this.o.deviceName, this.now(), (p) => this.taken(p), 'recovered') : back;
        await this.moveLocal(rec.lp, dest);
        this.state.update(rec, { lp: dest });
      }
    }
    await this.cleanDirs();
    return skipped;
  }

  /** Network/auth errors abort the cycle; anything else only skips this file (retried next cycle). */
  private async guard(it: PullItem, fn: () => Promise<ApplyResult>): Promise<ApplyResult> {
    try {
      return await fn();
    } catch (e: any) {
      if (e instanceof SyncError && (e.kind === 'network' || e.kind === 'auth')) throw e;
      this.log(`could not apply ${it.meta.path}: ${e?.stack ?? e}`);
      this.emit('error', { path: it.meta.path, message: e?.message ?? String(e) });
      return 'skip';
    }
  }

  private needsDownload(it: PullItem): boolean {
    const rec = this.state.get(it.c.fileId);
    if (!rec) return true;
    return rec.sd || rec.sh !== it.meta.hash;
  }

  private setSynced(rec: FileRecord, c: RemoteVersion, meta: FileMeta): void {
    this.state.update(rec, {
      v: c.version,
      sp: meta.path,
      sh: c.deleted ? '' : meta.hash,
      sd: c.deleted,
      sdev: meta.device,
      smt: meta.mtime,
      sc: c.chunks,
      ssz: c.size,
      kind: meta.kind,
    });
  }

  private setLocal(rec: FileRecord, lp: string, e: Entry | null, hash: string): void {
    this.state.update(rec, { lp, lh: hash, ld: false, lm: e?.mtimeMs ?? 0, ls: e?.size ?? 0, lc: e?.ctimeMs, li: e?.ino });
  }

  /** True if the file on disk is still what we last saw (so overwriting it loses nothing). */
  private async unchangedOnDisk(rec: FileRecord, expect = rec.lh): Promise<boolean> {
    const e = await statEntry(this.root, rec.lp);
    if (!e || e.kind !== rec.kind) return false;
    if (rec.kind === 'folder') return true;
    if (e.mtimeMs === rec.lm && e.size === rec.ls && (rec.li === undefined || e.ino === rec.li) && expect === rec.lh) return true;
    try {
      return (await hashFile(this.abs(rec.lp))).hash === expect;
    } catch {
      return false;
    }
  }

  private async applyDelete(it: PullItem): Promise<ApplyResult> {
    const rec = this.state.get(it.c.fileId);
    if (!rec) return 'ok';
    if (rec.ld) {
      this.state.remove(rec.id);
      return 'ok';
    }
    if (rec.kind === 'folder') {
      if (await isEmptyDir(this.root, rec.lp, this.ignore)) await rmdir(this.abs(rec.lp)).catch(() => {});
      this.touchedDirs.add(dirOf(rec.lp));
      this.state.remove(rec.id);
      return 'ok';
    }
    const localChanged = rec.v === 0 || rec.sd || rec.lh !== rec.sh || nfc(rec.lp) !== rec.sp;
    if (localChanged) {
      // edited here, deleted there: the edit wins; the push re-creates the file on the server
      this.setSynced(rec, it.c, it.meta);
      this.emit('file', { path: rec.lp, action: 'kept' });
      return 'ok';
    }
    if (!(await this.unchangedOnDisk(rec))) return 'skip';
    await retryFs(() => unlink(this.abs(rec.lp))).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
    });
    this.touchedDirs.add(dirOf(rec.lp));
    this.state.remove(rec.id);
    this.emit('file', { path: rec.lp, action: 'delete' });
    return 'ok';
  }

  /**
   * Finds where a remote file may live locally. If `target` is held by another file, decide who
   * moves, deterministically, so every device reaches the same result:
   *  - a file that is at that path only on this computer (new, or renamed here) steps aside;
   *  - two server files at the same path (case-insensitively): the larger file id gets a conflict name.
   */
  private async claimPath(target: string, forId: string, meta: FileMeta): Promise<string> {
    const key = pathKey(target);
    const otherId = this.state.idAtPath(key);
    if (otherId === forId) return target;
    if (otherId) {
      const o = this.state.get(otherId)!;
      const oOnServerHere = o.v > 0 && !o.sd && pathKey(o.sp) === key;
      if (!oOnServerHere) {
        await this.displace(o, this.o.deviceName, this.now());
        return target;
      }
      if (forId > otherId) return conflictPath(target, meta.device ?? '', meta.mtime, (p) => this.taken(p));
      await this.displace(o, o.sdev ?? '', o.smt ?? this.now());
      return target;
    }
    const e = await statEntry(this.root, target);
    if (e) {
      if (e.kind === 'folder' && meta.kind === 'folder') return target;
      if (e.kind === 'folder' || meta.kind === 'folder') return conflictPath(target, meta.device ?? '', meta.mtime, (p) => this.taken(p));
      // an untracked file appeared there after the scan: track it and move it aside
      const h = await hashFile(this.abs(target));
      if (h.hash === meta.hash) return target;
      const r = this.newRecord(randomUUID(), 'file', target);
      Object.assign(r, { lh: h.hash, lm: e.mtimeMs, ls: e.size, lc: e.ctimeMs, li: e.ino });
      this.state.put(r);
      await this.displace(r, this.o.deviceName, this.now());
    }
    return target;
  }

  private async displace(o: FileRecord, device: string, ms: number): Promise<void> {
    const from = o.lp;
    const to = conflictPath(from, device, ms, (p) => this.taken(p));
    await this.moveLocal(from, to);
    this.state.update(o, { lp: to });
    this.emit('conflict', { path: from, conflictPath: to });
  }

  private async moveLocal(from: string, to: string): Promise<void> {
    if (from === to) return;
    await mkdir(join(this.abs(to), '..'), { recursive: true });
    await retryFs(() => rename(this.abs(from), this.abs(to)));
    this.touchedDirs.add(dirOf(from));
  }

  private async applyLive(it: PullItem): Promise<ApplyResult> {
    const { c, meta } = it;
    const rec = this.state.get(c.fileId);
    const target = safePath(meta.path);

    if (!rec) return this.placeNew(it, target);

    if (meta.kind === 'folder' || rec.kind === 'folder') {
      if (rec.ld) {
        this.setSynced(rec, c, meta);
        return 'ok';
      }
      if (pathKey(target) !== pathKey(rec.lp)) {
        const final = await this.claimPath(target, rec.id, meta);
        await mkdir(this.abs(final), { recursive: true });
        if (await isEmptyDir(this.root, rec.lp, this.ignore)) await rmdir(this.abs(rec.lp)).catch(() => {});
        this.touchedDirs.add(dirOf(rec.lp));
        this.state.update(rec, { lp: final });
      }
      this.setSynced(rec, c, meta);
      return 'ok';
    }

    const origLp = it.origLp ?? rec.lp;
    const localPathChanged = rec.v > 0 && !rec.sd && nfc(origLp) !== rec.sp;
    const localContentChanged = !rec.ld && (rec.sd || rec.lh !== rec.sh);
    const remotePathChanged = meta.path !== rec.sp;
    const remoteContentChanged = rec.sd || meta.hash !== rec.sh;

    if (rec.ld) {
      if (remoteContentChanged) {
        // deleted here, edited there: the edit wins, the file comes back
        const final = await this.claimPath(target, rec.id, meta);
        const e = await this.downloadTo(c, meta, final);
        this.setSynced(rec, c, meta);
        this.setLocal(rec, final, e, meta.hash);
        this.emit('file', { path: final, action: 'download' });
      } else {
        this.setSynced(rec, c, meta); // stays deleted; push sends the deletion
      }
      return 'ok';
    }

    const desired = remotePathChanged || !localPathChanged ? target : origLp;

    const moveTo = async (dest: string) => {
      if (dest === rec.lp) return;
      const final = pathKey(dest) === pathKey(rec.lp) && !rec.lp.startsWith('.bedrock-move-') ? dest : await this.claimPath(dest, rec.id, meta);
      const from = rec.lp;
      await this.moveLocal(from, final);
      this.state.update(rec, { lp: final });
      this.emit('file', { path: final, from, action: 'rename' });
    };

    if (!remoteContentChanged || rec.lh === meta.hash) {
      await moveTo(desired);
      this.setSynced(rec, c, meta);
      return 'ok';
    }

    if (!localContentChanged) {
      if (!(await this.unchangedOnDisk(rec))) return 'skip';
      await moveTo(desired);
      const e = await this.downloadTo(c, meta, rec.lp);
      this.setSynced(rec, c, meta);
      this.setLocal(rec, rec.lp, e, meta.hash);
      this.emit('file', { path: rec.lp, action: 'download' });
      return 'ok';
    }

    // Changed on both sides.
    const mergeable = isTextPath(meta.path) && c.size <= MAX_MERGE_BYTES && rec.ls <= MAX_MERGE_BYTES;
    if (mergeable) {
      const ours = await readFile(this.abs(rec.lp));
      const oursHash = sha256(ours);
      const theirs = await this.readRemote(c, meta);
      let base: Buffer | null = null;
      if (rec.v > 0 && !rec.sd) base = await this.readVersion(rec.id, rec.v).catch(() => null);
      const m = mergeFile(desired, base, ours, theirs, rec.lm > meta.mtime);
      if (!(await this.unchangedOnDisk(rec, oursHash))) return 'skip';
      await moveTo(desired);
      if (m.clean) {
        const e = await this.writeAtomic(rec.lp, m.data);
        this.setSynced(rec, c, meta);
        this.setLocal(rec, rec.lp, e, sha256(m.data));
        this.emit('file', { path: rec.lp, action: 'merge' });
        return 'ok';
      }
      const cp = conflictPath(rec.lp, meta.device ?? '', meta.mtime, (p) => this.taken(p));
      const e = await this.writeAtomic(cp, theirs, meta.mtime);
      this.addConflictCopy(cp, e, meta.hash);
      this.setSynced(rec, c, meta);
      this.setLocal(rec, rec.lp, await statEntry(this.root, rec.lp), oursHash);
      this.emit('conflict', { path: rec.lp, conflictPath: cp });
      return 'ok';
    }
    // binary or big: keep ours in place, theirs next to it
    if (!(await this.unchangedOnDisk(rec))) return 'skip';
    await moveTo(desired);
    const cp = conflictPath(rec.lp, meta.device ?? '', meta.mtime, (p) => this.taken(p));
    const e = await this.downloadTo(c, meta, cp);
    this.addConflictCopy(cp, e, meta.hash);
    this.setSynced(rec, c, meta);
    this.emit('conflict', { path: rec.lp, conflictPath: cp });
    return 'ok';
  }

  private addConflictCopy(path: string, e: Entry | null, hash: string): void {
    const r = this.newRecord(randomUUID(), 'file', path);
    Object.assign(r, { lh: hash, lm: e?.mtimeMs ?? 0, ls: e?.size ?? 0, lc: e?.ctimeMs, li: e?.ino });
    this.state.put(r);
  }

  private async placeNew(it: PullItem, target: string): Promise<ApplyResult> {
    const { c, meta } = it;
    if (meta.kind === 'folder') {
      const other = this.state.byLocalPath(target);
      if (other && other.v === 0 && other.kind === 'folder') this.state.remove(other.id); // same new folder on both sides
      const final = await this.claimPath(target, c.fileId, meta);
      await mkdir(this.abs(final), { recursive: true });
      const rec = this.newRecord(c.fileId, 'folder', final);
      this.state.put(rec);
      this.setSynced(rec, c, meta);
      return 'ok';
    }
    const other = this.state.byLocalPath(target);
    if (other && other.v === 0 && !other.ld && other.kind === 'file' && other.lh === meta.hash) {
      // the same file was created on both sides: adopt the server's id
      this.state.remove(other.id);
      const rec = { ...other, id: c.fileId };
      this.state.put(rec);
      if (other.lp !== target) {
        await this.moveLocal(other.lp, target);
        this.state.update(rec, { lp: target });
      }
      this.setSynced(rec, c, meta);
      return 'ok';
    }
    const final = await this.claimPath(target, c.fileId, meta);
    const e = await this.downloadTo(c, meta, final);
    const rec = this.newRecord(c.fileId, 'file', final);
    this.state.put(rec);
    this.setSynced(rec, c, meta);
    this.setLocal(rec, final, e, meta.hash);
    this.emit('file', { path: final, action: 'download' });
    return 'ok';
  }

  private async chunkData(id: string): Promise<Buffer> {
    const cached = this.chunkCache.get(id);
    const blob = cached ?? (await this.api.getChunk(id));
    return decryptChunk(this.keys!, id, blob);
  }

  private async readRemote(c: { chunks: string[] }, meta: { hash: string }): Promise<Buffer> {
    const parts: Buffer[] = [];
    for (const id of c.chunks) parts.push(await this.chunkData(id));
    const data = Buffer.concat(parts);
    if (sha256(data) !== meta.hash) throw new SyncError('Downloaded data does not match its checksum', 'server');
    return data;
  }

  private async readVersion(fileId: string, version: number): Promise<Buffer> {
    const v = await this.api.version(fileId, version);
    const meta = decryptMeta(this.keys!, fileId, v.meta);
    return this.readRemote(v, meta);
  }

  /** Streams a remote file into place: temp file in the same folder, verify hash, rename over. */
  private async downloadTo(c: RemoteVersion, meta: FileMeta, rel: string): Promise<Entry | null> {
    const dest = this.abs(rel);
    await mkdir(join(dest, '..'), { recursive: true });
    const tmp = join(dest, '..', TEMP_PREFIX + randomBytes(6).toString('hex'));
    const fh = await open(tmp, 'w');
    const h = createHash('sha256');
    try {
      for (const id of c.chunks) {
        const plain = await this.chunkData(id);
        h.update(plain);
        await fh.write(plain);
      }
    } catch (e) {
      await fh.close();
      await unlink(tmp).catch(() => {});
      throw e;
    }
    await fh.close();
    if (h.digest('hex') !== meta.hash) {
      await unlink(tmp).catch(() => {});
      throw new SyncError(`Downloaded "${meta.path}" does not match its checksum`, 'server');
    }
    return this.finishWrite(tmp, rel, meta.mtime);
  }

  private async writeAtomic(rel: string, data: Uint8Array, mtime?: number): Promise<Entry | null> {
    const dest = this.abs(rel);
    await mkdir(join(dest, '..'), { recursive: true });
    const tmp = join(dest, '..', TEMP_PREFIX + randomBytes(6).toString('hex'));
    await writeFile(tmp, data);
    return this.finishWrite(tmp, rel, mtime);
  }

  private async finishWrite(tmp: string, rel: string, mtime?: number): Promise<Entry | null> {
    if (mtime && mtime > 0) await utimes(tmp, new Date(), new Date(mtime)).catch(() => {});
    try {
      await retryFs(() => rename(tmp, this.abs(rel)));
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
    return statEntry(this.root, rel);
  }

  /** Removes folders emptied by remote deletes/moves (but not folders that are synced as empty folders). */
  private async cleanDirs(): Promise<void> {
    const dirs = [...this.touchedDirs].sort((a, b) => b.length - a.length);
    this.touchedDirs.clear();
    const done = new Set<string>();
    for (let d of dirs) {
      while (d && !done.has(d)) {
        done.add(d);
        if (this.state.byLocalPath(d)) break;
        if (!(await isEmptyDir(this.root, d, this.ignore))) break;
        try {
          await rmdir(this.abs(d));
        } catch {
          break;
        }
        d = dirOf(d);
      }
    }
  }

  /** After a crash in the middle of a swap, put step-aside files back. */
  private async recoverMoves(): Promise<void> {
    let names: string[] = [];
    try {
      names = await readdir(this.root);
    } catch {
      return;
    }
    for (const n of names) {
      const m = /^\.bedrock-move-(.+)$/.exec(n);
      if (!m) continue;
      const rec = this.state.get(m[1]);
      let dest = rec && !rec.ld && rec.lp !== n ? rec.lp : `recovered ${m[1]}`;
      if (existsSync(this.abs(dest))) dest = conflictPath(dest, this.o.deviceName, this.now(), (p) => this.taken(p), 'recovered');
      await this.moveLocal(n, dest).catch(() => {});
      if (rec) this.state.update(rec, { lp: dest });
    }
  }

  // ------------------------------------------------------------------ push

  private needsPush(r: FileRecord): boolean {
    if (this.skippedTooBig.has(r.id)) return false;
    if (this.excluded(r.lp)) return false;
    if (r.v === 0) return !r.ld;
    if (r.ld) return !r.sd;
    return r.sd || (r.kind === 'file' && r.lh !== r.sh) || nfc(r.lp) !== r.sp;
  }

  private metaFor(r: FileRecord, hash: string, size: number, deleted: boolean): FileMeta {
    return {
      path: nfc(r.lp),
      kind: r.kind,
      size: deleted ? 0 : size,
      mtime: Math.floor(r.lm) || this.now(),
      ctime: r.lc ?? (Math.floor(r.lm) || this.now()),
      hash: deleted || r.kind === 'folder' ? '' : hash,
      device: this.o.deviceName,
    };
  }

  /** Uploads local changes. Returns again=true if the server had newer versions (pull and retry). */
  private async push(): Promise<{ again: boolean }> {
    for (const r of this.state.all()) if (r.v === 0 && r.ld) this.state.remove(r.id);
    for (const r of this.state.all()) if (r.ld && r.sd) this.state.remove(r.id);
    // deletions and renames first (cheap, and deletions free space), then content, small files first
    const rank = (r: FileRecord) => (r.ld ? 0 : r.kind === 'folder' ? 1 : 2);
    const todo = this.state
      .all()
      .filter((r) => this.needsPush(r))
      .sort((x, y) => rank(x) - rank(y) || x.ls - y.ls);
    let quotaError: SyncError | null = null;
    const isQuota = (e: unknown): e is SyncError => e instanceof SyncError && e.kind === 'quota';
    if (!todo.length) return { again: false };
    const keys = this.keys!;
    let again = false;
    let left = todo.length;
    this.setStatus({ state: 'syncing', message: `Uploading ${left} change(s)…`, pendingUploads: left });

    type Prepared = { rec: FileRecord; commit: CommitRequest; hash: string; size: number };
    let commits: Prepared[] = [];
    let small: Array<{ rec: FileRecord; data: Buffer; hash: string; id: string }> = [];
    let smallBytes = 0;

    const sendCommits = async () => {
      if (!commits.length) return;
      const batch = commits;
      commits = [];
      const r = await this.api.commit(batch.map((p) => p.commit));
      for (let i = 0; i < r.results.length; i++) {
        const res = r.results[i];
        const p = batch[i];
        if (res.ok) {
          const deleted = p.commit.deleted;
          if (deleted) {
            this.state.remove(p.rec.id);
          } else {
            this.state.update(p.rec, {
              v: res.version,
              sp: nfc(p.rec.lp),
              sh: p.hash,
              sd: false,
              sdev: this.o.deviceName,
              smt: p.rec.lm,
              sc: p.commit.chunks,
              ssz: p.size,
            });
            this.emit('file', { path: p.rec.lp, action: 'upload' });
          }
        } else again = true; // 409 (pull first) or missing chunks (re-upload next round)
      }
      left -= batch.length;
      this.setStatus({ state: 'syncing', message: left > 0 ? `Uploading ${left} change(s)…` : 'Syncing…', pendingUploads: Math.max(0, left) });
      await this.state.save();
    };

    const flushSmall = async () => {
      if (!small.length) return;
      const group = small;
      small = [];
      smallBytes = 0;
      const missing = await this.api.missingChunks([...new Set(group.map((g) => g.id))]);
      let frames: Array<{ id: string; data: Uint8Array }> = [];
      let fb = 0;
      const sent = new Set<string>();
      for (const g of group) {
        if (!missing.has(g.id) || sent.has(g.id)) continue;
        sent.add(g.id);
        const enc = encryptChunk(keys, g.id, g.data);
        frames.push({ id: g.id, data: enc });
        fb += enc.length;
        if (fb >= UPLOAD_BATCH_BYTES) {
          try {
            await this.api.uploadBatch(frames);
          } catch (e) {
            if (!isQuota(e)) throw e;
            quotaError = e;
            return;
          }
          frames = [];
          fb = 0;
        }
      }
      try {
        await this.api.uploadBatch(frames);
      } catch (e) {
        if (!isQuota(e)) throw e;
        quotaError = e; // these files wait; the rest carries on
        return;
      }
      for (const g of group) {
        commits.push({
          rec: g.rec,
          hash: g.hash,
          size: g.data.length,
          commit: {
            fileId: g.rec.id,
            baseVersion: g.rec.v,
            meta: encryptMeta(keys, g.rec.id, this.metaFor(g.rec, g.hash, g.data.length, false)),
            chunks: [g.id],
            size: g.data.length,
            deleted: false,
            deviceId: this.o.deviceId,
          },
        });
        if (commits.length >= COMMIT_BATCH) await sendCommits();
      }
    };

    // read small changed files ahead, in parallel (one sequential read per note is the slow part on Windows)
    const readAhead = new Map<string, Promise<{ data: Buffer; st: import('node:fs').Stats } | null>>();
    const smallTodo = todo.filter((r) => !r.ld && r.kind === 'file' && r.ls <= CHUNK_SIZE && (r.v === 0 || r.sd || r.lh !== r.sh || !r.sc));
    let ahead = 0;
    const fillAhead = () => {
      while (ahead < smallTodo.length && readAhead.size < 64) {
        const r = smallTodo[ahead++];
        readAhead.set(
          r.id,
          (async () => {
            try {
              const st = await stat(this.abs(r.lp));
              if (st.size > CHUNK_SIZE) return null;
              return { data: await readFile(this.abs(r.lp)), st };
            } catch {
              return null;
            }
          })(),
        );
      }
    };
    fillAhead();

    for (const rec of todo) {
      if (rec.ld || rec.kind === 'folder') {
        const deleted = rec.ld;
        commits.push({
          rec,
          hash: '',
          size: 0,
          commit: {
            fileId: rec.id,
            baseVersion: rec.v,
            meta: encryptMeta(keys, rec.id, this.metaFor(rec, '', 0, deleted)),
            chunks: [],
            size: 0,
            deleted,
            deviceId: this.o.deviceId,
          },
        });
        if (commits.length >= COMMIT_BATCH) await sendCommits();
        continue;
      }
      const contentChanged = rec.v === 0 || rec.sd || rec.lh !== rec.sh || !rec.sc;
      if (!contentChanged) {
        // rename/move only: same chunks, new metadata
        commits.push({
          rec,
          hash: rec.sh,
          size: rec.ssz ?? rec.ls,
          commit: {
            fileId: rec.id,
            baseVersion: rec.v,
            meta: encryptMeta(keys, rec.id, this.metaFor(rec, rec.sh, rec.ssz ?? rec.ls, false)),
            chunks: rec.sc!,
            size: rec.ssz ?? rec.ls,
            deleted: false,
            deviceId: this.o.deviceId,
          },
        });
        if (commits.length >= COMMIT_BATCH) await sendCommits();
        continue;
      }
      const pre = readAhead.get(rec.id);
      if (pre) {
        readAhead.delete(rec.id);
        fillAhead();
        const got = await pre;
        if (got) {
          const { data, st } = got;
          const hash = sha256(data);
          if (hash !== rec.lh) this.state.update(rec, { lh: hash, ls: data.length, lm: st.mtimeMs, li: st.ino });
          small.push({ rec, data, hash, id: chunkId(keys, data) });
          smallBytes += data.length;
          if (smallBytes >= UPLOAD_BATCH_BYTES || small.length >= COMMIT_BATCH) await flushSmall();
          continue;
        }
      }
      let st;
      try {
        st = await stat(this.abs(rec.lp));
      } catch {
        continue; // vanished; next scan handles it
      }
      if (this.vault && st.size > this.vault.maxFileBytes) {
        this.skippedTooBig.add(rec.id);
        this.emit('error', { path: rec.lp, message: `Too large to sync (limit ${Math.round(this.vault.maxFileBytes / 1024 ** 2)} MB)` });
        continue;
      }
      if (st.size <= CHUNK_SIZE) {
        let data: Buffer;
        try {
          data = await readFile(this.abs(rec.lp));
        } catch {
          continue;
        }
        const hash = sha256(data);
        if (hash !== rec.lh) this.state.update(rec, { lh: hash, ls: data.length, lm: st.mtimeMs, li: st.ino });
        small.push({ rec, data, hash, id: chunkId(keys, data) });
        smallBytes += data.length;
        if (smallBytes >= UPLOAD_BATCH_BYTES || small.length >= COMMIT_BATCH) await flushSmall();
      } else {
        await flushSmall();
        let p: Awaited<ReturnType<SyncEngine['uploadLarge']>>;
        try {
          p = await this.uploadLarge(rec);
        } catch (e) {
          if (!isQuota(e)) throw e;
          quotaError = e;
          continue;
        }
        if (p) {
          commits.push(p);
          await sendCommits();
        }
      }
    }
    await flushSmall();
    await sendCommits();
    if (quotaError && !again) throw quotaError;
    return { again };
  }

  /** Two passes over a big file: ids first (to skip chunks the server has), then upload the missing ones. */
  private async uploadLarge(rec: FileRecord): Promise<{ rec: FileRecord; commit: CommitRequest; hash: string; size: number } | null> {
    const keys = this.keys!;
    const abs = this.abs(rec.lp);
    const ids: string[] = [];
    const first = await forEachChunk(abs, (data) => {
      ids.push(chunkId(keys, data));
    });
    const missing = await this.api.missingChunks([...new Set(ids)]);
    const direct = !!this.vault?.direct;
    const conc = Math.max(1, this.o.uploadConcurrency ?? 4);
    const inflight = new Set<Promise<void>>();
    let failure: unknown = null;
    const done = new Set<string>();
    let changed = false;
    let second: { hash: string; size: number };
    try {
      second = await forEachChunk(abs, async (data, index) => {
      if (failure) throw failure;
      const id = chunkId(keys, data);
      if (id !== ids[index]) changed = true;
      if (changed || !missing.has(id) || done.has(id)) return;
      done.add(id);
      const enc = encryptChunk(keys, id, data);
      const task = (async () => {
        if (direct && enc.length >= (this.vault?.directThreshold ?? Infinity)) {
          const urls = await this.api.uploadUrls([{ id, size: enc.length }]);
          if (urls[id]) {
            await this.api.putDirect(urls[id], enc);
            const still = await this.api.confirmChunks([id]);
            if (!still.length) return;
          }
        }
        await this.api.putChunk(id, enc);
      })().catch((e) => {
        failure ??= e;
      });
      inflight.add(task);
      task.finally(() => inflight.delete(task));
      if (inflight.size >= conc) await Promise.race(inflight);
      });
    } finally {
      await Promise.allSettled(inflight); // never leave uploads running behind the caller's back
    }
    if (failure) throw failure;
    if (changed || second.hash !== first.hash) return null; // file changed while uploading; next cycle retries
    if (second.hash !== rec.lh) this.state.update(rec, { lh: second.hash, ls: second.size });
    return {
      rec,
      hash: second.hash,
      size: second.size,
      commit: {
        fileId: rec.id,
        baseVersion: rec.v,
        meta: encryptMeta(keys, rec.id, this.metaFor(rec, second.hash, second.size, false)),
        chunks: ids,
        size: second.size,
        deleted: false,
        deviceId: this.o.deviceId,
      },
    };
  }
}

export { isIgnored };
