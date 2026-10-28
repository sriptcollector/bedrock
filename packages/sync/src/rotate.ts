// Vault key rotation: moves the synced vault from an old key to a new one.
//
// Used when sync is turned on with a new key while the sync service still holds data under an
// older key: the key 0.1.2 and older left unprotected in the Toolbay account (exposed, so it must
// not keep protecting anything), or a key whose passphrase was forgotten ("start over").
//
//   1. stage   - if this computer has the old key: download the current version of every synced
//                file (all folders, including ones this computer leaves out with selective sync),
//                decrypt it and keep it in `stagingDir` (on this computer, inside the app's data).
//   2. rekey   - the sync service deletes every file, version and chunk of the old vault and starts
//                an empty one under the new key check (version history and deleted files of the old
//                vault go with it: they were encrypted with the exposed key).
//   3. upload  - re-encrypt each staged file with the new key and commit it to the new vault.
//   4. cleanup - delete the staging folder.
//
// A journal in `stagingDir` makes this resumable: a crash or lost connection after step 2 picks
// up at step 3 on the next try. Without the old key (no computer kept it) step 1 is skipped and the
// vault restarts empty; every computer then uploads its own files again when it syncs, because
// local files are never touched by any of this.

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SyncApi, CommitRequest } from './api.js';
import { forEachChunk } from './chunker.js';
import { chunkId, decryptChunk, decryptMeta, deriveKeys, encryptChunk, encryptMeta, type FileMeta } from './crypto.js';

export interface RotateOptions {
  api: SyncApi;
  newKey: Uint8Array;
  /** Keys this computer knows besides the new one; the one matching the server's key check is used to read old data. */
  oldKeys: Uint8Array[];
  stagingDir: string;
  deviceId: string;
  log?: (msg: string) => void;
  onProgress?: (done: number, total: number) => void;
}

export interface RotateResult {
  /** 'none': the vault already used the new key (or was empty and unclaimed). */
  action: 'none' | 'reencrypted' | 'restarted';
  files: number;
}

interface StagedFile {
  fileId: string;
  meta: FileMeta;
  /** File name inside stagingDir/files (absent for folders). */
  blob?: string;
  done?: boolean;
}

interface Journal {
  v: 1;
  phase: 'staged' | 'rekeyed';
  newKeyCheck: string;
  fromKeyCheck: string | null;
  files: StagedFile[];
}

async function writeJournal(dir: string, j: Journal): Promise<void> {
  const f = join(dir, 'journal.json');
  await writeFile(f + '.tmp', JSON.stringify(j));
  await rename(f + '.tmp', f);
}

async function readJournal(dir: string): Promise<Journal | null> {
  try {
    const j = JSON.parse(await readFile(join(dir, 'journal.json'), 'utf8')) as Journal;
    return j?.v === 1 ? j : null;
  } catch {
    return null;
  }
}

export async function rotateVault(o: RotateOptions): Promise<RotateResult> {
  const log = o.log ?? (() => {});
  const newKeys = deriveKeys(o.newKey);
  let j = await readJournal(o.stagingDir);
  if (j && j.newKeyCheck !== newKeys.keyCheck) {
    // a rotation to some other key never finished; that key is gone, start from the server's state
    await rm(o.stagingDir, { recursive: true, force: true });
    j = null;
  }

  if (!j || j.phase === 'staged') {
    const v = await o.api.vault();
    if (v.keyCheck === newKeys.keyCheck) {
      await rm(o.stagingDir, { recursive: true, force: true });
      return { action: 'none', files: 0 };
    }
    if (v.keyCheck === null && v.seq === 0) {
      await o.api.setKeyCheck(newKeys.keyCheck);
      await rm(o.stagingDir, { recursive: true, force: true });
      return { action: 'none', files: 0 };
    }
    if (!j || j.fromKeyCheck !== v.keyCheck) {
      await rm(o.stagingDir, { recursive: true, force: true });
      await mkdir(join(o.stagingDir, 'files'), { recursive: true });
      const old = o.oldKeys.map((k) => deriveKeys(k)).find((k) => k.keyCheck === v.keyCheck) ?? null;
      const files = old ? await stage(o, old) : [];
      log(old ? `rotate: staged ${files.length} files from the old vault` : 'rotate: old vault key unknown here; the vault restarts from the files on each computer');
      j = { v: 1, phase: 'staged', newKeyCheck: newKeys.keyCheck, fromKeyCheck: v.keyCheck, files };
      await writeJournal(o.stagingDir, j);
    }
    await o.api.rekey(j.fromKeyCheck, newKeys.keyCheck);
    j.phase = 'rekeyed';
    await writeJournal(o.stagingDir, j);
  }

  // upload (resumable)
  const total = j.files.length;
  let done = j.files.filter((f) => f.done).length;
  let sinceSave = 0;
  for (const f of j.files) {
    if (f.done) continue;
    const chunks: string[] = [];
    if (f.blob) {
      const abs = join(o.stagingDir, 'files', f.blob);
      await forEachChunk(abs, async (data) => {
        const id = chunkId(newKeys, data);
        chunks.push(id);
        await o.api.uploadBatch([{ id, data: encryptChunk(newKeys, id, data) }]);
      });
    }
    const commit: CommitRequest = {
      fileId: f.fileId,
      baseVersion: 0,
      meta: encryptMeta(newKeys, f.fileId, f.meta),
      chunks,
      size: f.meta.size,
      deleted: false,
      deviceId: o.deviceId,
    };
    const r = (await o.api.commit([commit])).results[0];
    // 409: already committed by an earlier try (or a computer that synced in between): fine either way
    if (!r.ok && r.status === 400) throw new Error(`could not re-upload a file (${r.message})`);
    f.done = true;
    done++;
    o.onProgress?.(done, total);
    if (++sinceSave >= 50) {
      sinceSave = 0;
      await writeJournal(o.stagingDir, j);
    }
  }
  await rm(o.stagingDir, { recursive: true, force: true });
  log(`rotate: vault moved to the new key (${total} files re-encrypted)`);
  return { action: total ? 'reencrypted' : 'restarted', files: total };
}

/** Downloads and decrypts the current version of every live file into stagingDir/files. */
async function stage(o: RotateOptions, old: ReturnType<typeof deriveKeys>): Promise<StagedFile[]> {
  const heads = new Map<string, { meta: string; chunks: string[]; deleted: boolean }>();
  let since = 0;
  for (;;) {
    const r = await o.api.changes(since, 1000);
    for (const c of r.changes) heads.set(c.fileId, { meta: c.meta, chunks: c.chunks, deleted: c.deleted });
    if (!r.more || !r.changes.length) break;
    since = r.changes[r.changes.length - 1].seq;
  }
  const out: StagedFile[] = [];
  let n = 0;
  for (const [fileId, h] of heads) {
    if (h.deleted) continue;
    const meta = decryptMeta(old, fileId, h.meta);
    if (meta.kind === 'folder') {
      out.push({ fileId, meta });
      continue;
    }
    const blob = String(n++);
    const parts: Buffer[] = [];
    for (let i = 0; i < h.chunks.length; i += 64) {
      const ids = h.chunks.slice(i, i + 64);
      const got = await o.api.fetchChunks(ids);
      for (const id of ids) {
        const enc = got.get(id);
        if (!enc) throw new Error('the sync service is missing data for a file');
        parts.push(decryptChunk(old, id, enc));
      }
      // flush every 64 chunks so a big file never sits in memory whole
      await writeFile(join(o.stagingDir, 'files', blob), Buffer.concat(parts), { flag: i === 0 ? 'w' : 'a' });
      parts.length = 0;
    }
    if (!h.chunks.length || !existsSync(join(o.stagingDir, 'files', blob))) await writeFile(join(o.stagingDir, 'files', blob), Buffer.alloc(0));
    out.push({ fileId, meta, blob });
  }
  return out;
}
