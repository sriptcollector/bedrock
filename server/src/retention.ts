import type { Db } from './db.js';
import type { BlobStore } from './storage/index.js';

export interface RetentionContext {
  db: Db;
  store: BlobStore;
  /** Blob keys being deleted right now; uploads of these keys wait until removal finishes. */
  gcLocks: Set<string>;
  now: () => number;
  retentionDays: number;
  gcGraceMs: number;
  log?: (msg: string) => void;
}

export interface RetentionResult {
  prunedVersions: number;
  deletedChunks: number;
  freedBytes: number;
}

/**
 * 1. Drop versions older than the retention window, except each file's current version.
 * 2. Delete chunks nothing refers to any more, but only if nobody uploaded or checked them during
 *    the grace period (a device may have uploaded a chunk and not committed the file yet).
 */
export async function runRetention(ctx: RetentionContext, opts: { prune?: boolean; vaultId?: string; graceMs?: number } = {}): Promise<RetentionResult> {
  const now = ctx.now();
  let prunedVersions = 0;
  if (opts.prune !== false) prunedVersions = ctx.db.pruneVersions(now - ctx.retentionDays * 86_400_000);
  const touchedBefore = now - (opts.graceMs ?? ctx.gcGraceMs);
  let deletedChunks = 0;
  let freedBytes = 0;
  for (;;) {
    const batch = ctx.db.unreferencedChunks(touchedBefore, 5000, opts.vaultId);
    if (!batch.length) break;
    let progressed = false;
    for (const c of batch) {
      const key = `${c.vault_id}/${c.chunk_id}`;
      ctx.gcLocks.add(key);
      try {
        if (!ctx.db.dropChunk(c.vault_id, c.chunk_id, touchedBefore)) continue;
        progressed = true;
        try {
          await ctx.store.delete(key);
        } catch (e) {
          ctx.log?.(`retention: could not delete blob ${key}: ${(e as Error).message}`); // orphan blob, harmless
        }
        deletedChunks++;
        freedBytes += c.size;
      } finally {
        ctx.gcLocks.delete(key);
      }
    }
    if (!progressed || batch.length < 5000) break;
  }
  ctx.log?.(`retention: pruned ${prunedVersions} versions, deleted ${deletedChunks} chunks (${freedBytes} bytes)`);
  return { prunedVersions, deletedChunks, freedBytes };
}
