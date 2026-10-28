// Metadata store: SQLite (node:sqlite, WAL) on the Railway volume. Everything here is opaque to the
// server except ids, sizes, sequence numbers and timestamps; `meta` is an encrypted blob (base64).

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

export interface VaultRow {
  user_id: string;
  vault_id: string;
  created_at: number;
  used_bytes: number;
  quota_bytes: number | null;
  seq: number;
  key_check: string | null;
}

export interface VersionRow {
  vault_id: string;
  file_id: string;
  version: number;
  seq: number;
  meta: string;
  chunks: string; // JSON array of chunk ids
  size: number;
  deleted: number;
  device_id: string | null;
  created_at: number;
}

export interface CommitInput {
  fileId: string;
  baseVersion: number;
  meta: string;
  chunks: string[];
  size: number;
  deleted: boolean;
  deviceId?: string;
}

export type CommitResult =
  | { fileId: string; ok: true; version: number; seq: number }
  | { fileId: string; ok: false; status: 409; current: ReturnType<typeof versionOut> | null }
  | { fileId: string; ok: false; status: 400; error: string; message: string; missing?: string[] };

export function versionOut(r: VersionRow) {
  return {
    fileId: r.file_id,
    version: r.version,
    seq: r.seq,
    meta: r.meta,
    chunks: JSON.parse(r.chunks) as string[],
    size: r.size,
    deleted: !!r.deleted,
    deviceId: r.device_id,
    createdAt: r.created_at,
  };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS vaults(
  user_id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  used_bytes INTEGER NOT NULL DEFAULT 0,
  quota_bytes INTEGER,
  seq INTEGER NOT NULL DEFAULT 0,
  key_check TEXT
);
CREATE TABLE IF NOT EXISTS versions(
  vault_id TEXT NOT NULL, file_id TEXT NOT NULL, version INTEGER NOT NULL, seq INTEGER NOT NULL,
  meta TEXT NOT NULL, chunks TEXT NOT NULL, size INTEGER NOT NULL, deleted INTEGER NOT NULL,
  device_id TEXT, created_at INTEGER NOT NULL,
  PRIMARY KEY(vault_id, file_id, version)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS heads(
  vault_id TEXT NOT NULL, file_id TEXT NOT NULL, version INTEGER NOT NULL, seq INTEGER NOT NULL, deleted INTEGER NOT NULL,
  PRIMARY KEY(vault_id, file_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS heads_by_seq ON heads(vault_id, seq);
CREATE TABLE IF NOT EXISTS version_chunks(
  vault_id TEXT NOT NULL, chunk_id TEXT NOT NULL, file_id TEXT NOT NULL, version INTEGER NOT NULL,
  PRIMARY KEY(vault_id, chunk_id, file_id, version)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS chunks(
  vault_id TEXT NOT NULL, chunk_id TEXT NOT NULL, size INTEGER NOT NULL,
  created_at INTEGER NOT NULL, touched_at INTEGER NOT NULL,
  PRIMARY KEY(vault_id, chunk_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS chunks_by_touch ON chunks(touched_at);
`;

export class Db {
  readonly db: DatabaseSync;
  private st: Record<string, StatementSync> = {};

  constructor(dataDir: string) {
    let file = ':memory:';
    if (dataDir !== ':memory:') {
      mkdirSync(dataDir, { recursive: true });
      file = join(dataDir, 'bedrock-sync.sqlite');
    }
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;');
    this.db.exec(SCHEMA);
  }

  private q(sql: string): StatementSync {
    return (this.st[sql] ??= this.db.prepare(sql));
  }

  close(): void {
    this.db.close();
  }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  getVault(userId: string): VaultRow | undefined {
    return this.q('SELECT * FROM vaults WHERE user_id = ?').get(userId) as VaultRow | undefined;
  }

  getVaultById(vaultId: string): VaultRow | undefined {
    return this.q('SELECT * FROM vaults WHERE vault_id = ?').get(vaultId) as VaultRow | undefined;
  }

  getOrCreateVault(userId: string, now: number): VaultRow {
    const v = this.getVault(userId);
    if (v) return v;
    this.q('INSERT OR IGNORE INTO vaults(user_id, vault_id, created_at) VALUES (?, ?, ?)').run(userId, randomUUID(), now);
    return this.getVault(userId)!;
  }

  /**
   * Deletes everything in the user's vault and gives it a new id and key check, if its key check is
   * still `from`. Chunk rows of the old id stay until retention removes them with their blobs.
   */
  rekeyVault(userId: string, from: string | null, to: string, now: number): { oldVaultId: string; vault: VaultRow } | null {
    return this.tx(() => {
      const v = this.getOrCreateVault(userId, now);
      if ((v.key_check ?? null) !== from) return null;
      for (const t of ['versions', 'heads', 'version_chunks']) this.q(`DELETE FROM ${t} WHERE vault_id = ?`).run(v.vault_id);
      this.q('UPDATE vaults SET vault_id = ?, seq = 0, used_bytes = 0, key_check = ? WHERE user_id = ?').run(randomUUID(), to, userId);
      return { oldVaultId: v.vault_id, vault: this.getVault(userId)! };
    });
  }

  setKeyCheck(vaultId: string, keyCheck: string): string {
    this.q('UPDATE vaults SET key_check = ? WHERE vault_id = ? AND key_check IS NULL').run(keyCheck, vaultId);
    return this.getVaultById(vaultId)!.key_check!;
  }

  setQuota(userId: string, quota: number | null): void {
    this.q('UPDATE vaults SET quota_bytes = ? WHERE user_id = ?').run(quota, userId);
  }

  hasChunk(vaultId: string, chunkId: string): boolean {
    return !!this.q('SELECT 1 FROM chunks WHERE vault_id = ? AND chunk_id = ?').get(vaultId, chunkId);
  }

  /** Returns ids not stored yet; marks stored ones as recently used so GC leaves them alone. */
  missingChunks(vaultId: string, ids: string[], now: number): string[] {
    const missing: string[] = [];
    const touch = this.q('UPDATE chunks SET touched_at = ? WHERE vault_id = ? AND chunk_id = ?');
    this.tx(() => {
      for (const id of ids) {
        if (touch.run(now, vaultId, id).changes === 0) missing.push(id);
      }
    });
    return missing;
  }

  /** Records a stored chunk; returns true if it was new (and its bytes were added to the vault's usage). */
  addChunk(vaultId: string, chunkId: string, size: number, now: number): boolean {
    return this.tx(() => {
      const r = this.q('INSERT OR IGNORE INTO chunks(vault_id, chunk_id, size, created_at, touched_at) VALUES (?, ?, ?, ?, ?)').run(
        vaultId, chunkId, size, now, now,
      );
      if (r.changes > 0) {
        this.q('UPDATE vaults SET used_bytes = used_bytes + ? WHERE vault_id = ?').run(size, vaultId);
        return true;
      }
      this.q('UPDATE chunks SET touched_at = ? WHERE vault_id = ? AND chunk_id = ?').run(now, vaultId, chunkId);
      return false;
    });
  }

  /** Bulk version of addChunk (one transaction). Returns the number of new chunks. */
  addChunks(vaultId: string, items: Array<{ id: string; size: number }>, now: number): number {
    return this.tx(() => {
      let added = 0;
      let bytes = 0;
      const ins = this.q('INSERT OR IGNORE INTO chunks(vault_id, chunk_id, size, created_at, touched_at) VALUES (?, ?, ?, ?, ?)');
      const touch = this.q('UPDATE chunks SET touched_at = ? WHERE vault_id = ? AND chunk_id = ?');
      for (const it of items) {
        if (ins.run(vaultId, it.id, it.size, now, now).changes > 0) {
          added++;
          bytes += it.size;
        } else touch.run(now, vaultId, it.id);
      }
      if (bytes) this.q('UPDATE vaults SET used_bytes = used_bytes + ? WHERE vault_id = ?').run(bytes, vaultId);
      return added;
    });
  }

  chunkSize(vaultId: string, chunkId: string): number | null {
    const r = this.q('SELECT size FROM chunks WHERE vault_id = ? AND chunk_id = ?').get(vaultId, chunkId) as { size: number } | undefined;
    return r ? r.size : null;
  }

  head(vaultId: string, fileId: string): VersionRow | undefined {
    return this.q(
      'SELECT v.* FROM heads h JOIN versions v ON v.vault_id = h.vault_id AND v.file_id = h.file_id AND v.version = h.version WHERE h.vault_id = ? AND h.file_id = ?',
    ).get(vaultId, fileId) as VersionRow | undefined;
  }

  /** Applies commits in one transaction. Each one is accepted only if baseVersion equals the current version. */
  commit(vaultId: string, commits: CommitInput[], now: number): { results: CommitResult[]; seq: number } {
    return this.tx(() => {
      const results: CommitResult[] = [];
      let seq = (this.q('SELECT seq FROM vaults WHERE vault_id = ?').get(vaultId) as { seq: number }).seq;
      for (const c of commits) {
        const head = this.q('SELECT version FROM heads WHERE vault_id = ? AND file_id = ?').get(vaultId, c.fileId) as
          | { version: number }
          | undefined;
        const cur = head?.version ?? 0;
        if (c.baseVersion !== cur) {
          const row = cur ? this.head(vaultId, c.fileId) : undefined;
          results.push({ fileId: c.fileId, ok: false, status: 409, current: row ? versionOut(row) : null });
          continue;
        }
        const ids = [...new Set(c.chunks)];
        const missing = ids.filter((id) => !this.q('SELECT 1 FROM chunks WHERE vault_id = ? AND chunk_id = ?').get(vaultId, id));
        if (missing.length) {
          results.push({ fileId: c.fileId, ok: false, status: 400, error: 'missing_chunks', message: 'Some chunks were not uploaded', missing });
          continue;
        }
        const version = cur + 1;
        seq += 1;
        this.q(
          'INSERT INTO versions(vault_id, file_id, version, seq, meta, chunks, size, deleted, device_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(vaultId, c.fileId, version, seq, c.meta, JSON.stringify(c.chunks), c.size, c.deleted ? 1 : 0, c.deviceId ?? null, now);
        this.q(
          'INSERT INTO heads(vault_id, file_id, version, seq, deleted) VALUES (?, ?, ?, ?, ?) ON CONFLICT(vault_id, file_id) DO UPDATE SET version = excluded.version, seq = excluded.seq, deleted = excluded.deleted',
        ).run(vaultId, c.fileId, version, seq, c.deleted ? 1 : 0);
        const ins = this.q('INSERT OR IGNORE INTO version_chunks(vault_id, chunk_id, file_id, version) VALUES (?, ?, ?, ?)');
        for (const id of ids) ins.run(vaultId, id, c.fileId, version);
        results.push({ fileId: c.fileId, ok: true, version, seq });
      }
      this.q('UPDATE vaults SET seq = ? WHERE vault_id = ?').run(seq, vaultId);
      return { results, seq };
    });
  }

  changes(vaultId: string, since: number, limit: number): { rows: VersionRow[]; more: boolean } {
    const rows = this.q(
      `SELECT v.* FROM heads h JOIN versions v ON v.vault_id = h.vault_id AND v.file_id = h.file_id AND v.version = h.version
       WHERE h.vault_id = ? AND h.seq > ? ORDER BY h.seq LIMIT ?`,
    ).all(vaultId, since, limit + 1) as unknown as VersionRow[];
    const more = rows.length > limit;
    if (more) rows.length = limit;
    return { rows, more };
  }

  versions(vaultId: string, fileId: string): VersionRow[] {
    return this.q('SELECT * FROM versions WHERE vault_id = ? AND file_id = ? ORDER BY version DESC').all(vaultId, fileId) as unknown as VersionRow[];
  }

  version(vaultId: string, fileId: string, version: number): VersionRow | undefined {
    return this.q('SELECT * FROM versions WHERE vault_id = ? AND file_id = ? AND version = ?').get(vaultId, fileId, version) as
      | VersionRow
      | undefined;
  }

  trash(vaultId: string): Array<{ head: VersionRow; lastLive: number | null }> {
    const heads = this.q(
      `SELECT v.* FROM heads h JOIN versions v ON v.vault_id = h.vault_id AND v.file_id = h.file_id AND v.version = h.version
       WHERE h.vault_id = ? AND h.deleted = 1 ORDER BY h.seq DESC LIMIT 5000`,
    ).all(vaultId) as unknown as VersionRow[];
    const live = this.q('SELECT MAX(version) AS v FROM versions WHERE vault_id = ? AND file_id = ? AND deleted = 0');
    return heads.map((h) => ({ head: h, lastLive: (live.get(vaultId, h.file_id) as { v: number | null }).v }));
  }

  /** Deletes versions created before `cutoff`, never a file's current version. Returns how many were removed. */
  pruneVersions(cutoff: number): number {
    return this.tx(() => {
      const old = this.q(
        `SELECT v.vault_id, v.file_id, v.version, v.chunks FROM versions v JOIN heads h ON h.vault_id = v.vault_id AND h.file_id = v.file_id
         WHERE v.created_at < ? AND v.version < h.version`,
      ).all(cutoff) as Array<{ vault_id: string; file_id: string; version: number; chunks: string }>;
      const delV = this.q('DELETE FROM versions WHERE vault_id = ? AND file_id = ? AND version = ?');
      const delC = this.q('DELETE FROM version_chunks WHERE vault_id = ? AND chunk_id = ? AND file_id = ? AND version = ?');
      for (const r of old) {
        delV.run(r.vault_id, r.file_id, r.version);
        for (const id of new Set(JSON.parse(r.chunks) as string[])) delC.run(r.vault_id, id, r.file_id, r.version);
      }
      return old.length;
    });
  }

  /** Chunks no version refers to and nobody touched since `touchedBefore` (optionally in one vault). */
  unreferencedChunks(touchedBefore: number, limit = 10000, vaultId?: string): Array<{ vault_id: string; chunk_id: string; size: number }> {
    const sql = `SELECT c.vault_id, c.chunk_id, c.size FROM chunks c
       WHERE c.touched_at < ? ${vaultId ? 'AND c.vault_id = ?' : ''}
       AND NOT EXISTS (SELECT 1 FROM version_chunks vc WHERE vc.vault_id = c.vault_id AND vc.chunk_id = c.chunk_id)
       LIMIT ?`;
    const args = vaultId ? [touchedBefore, vaultId, limit] : [touchedBefore, limit];
    return this.q(sql).all(...args) as Array<{ vault_id: string; chunk_id: string; size: number }>;
  }

  /**
   * "Empty recycle bin": drops every old version of files whose current version is a deletion.
   * The deletion record itself stays so other devices still learn the file is gone.
   */
  purgeDeleted(vaultId: string, fileIds?: string[]): number {
    return this.tx(() => {
      const old = this.q(
        `SELECT v.file_id, v.version, v.chunks FROM versions v JOIN heads h ON h.vault_id = v.vault_id AND h.file_id = v.file_id
         WHERE v.vault_id = ? AND h.deleted = 1 AND v.version < h.version`,
      ).all(vaultId) as Array<{ file_id: string; version: number; chunks: string }>;
      const only = fileIds ? new Set(fileIds) : null;
      const delV = this.q('DELETE FROM versions WHERE vault_id = ? AND file_id = ? AND version = ?');
      const delC = this.q('DELETE FROM version_chunks WHERE vault_id = ? AND chunk_id = ? AND file_id = ? AND version = ?');
      let n = 0;
      for (const r of old) {
        if (only && !only.has(r.file_id)) continue;
        delV.run(vaultId, r.file_id, r.version);
        for (const id of new Set(JSON.parse(r.chunks) as string[])) delC.run(vaultId, id, r.file_id, r.version);
        n++;
      }
      return n;
    });
  }

  /** Removes a chunk row if it is still unreferenced; returns true if removed. */
  dropChunk(vaultId: string, chunkId: string, touchedBefore: number): boolean {
    return this.tx(() => {
      if (this.q('SELECT 1 FROM version_chunks WHERE vault_id = ? AND chunk_id = ? LIMIT 1').get(vaultId, chunkId)) return false;
      const row = this.q('SELECT size, touched_at FROM chunks WHERE vault_id = ? AND chunk_id = ?').get(vaultId, chunkId) as
        | { size: number; touched_at: number }
        | undefined;
      if (!row || row.touched_at >= touchedBefore) return false;
      this.q('DELETE FROM chunks WHERE vault_id = ? AND chunk_id = ?').run(vaultId, chunkId);
      this.q('UPDATE vaults SET used_bytes = MAX(0, used_bytes - ?) WHERE vault_id = ?').run(row.size, vaultId);
      return true;
    });
  }
}
