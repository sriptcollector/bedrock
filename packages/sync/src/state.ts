// Local sync state, kept in the app's data folder (never inside the vault).
// One JSON file, written atomically (temp file + rename). 10k files is about 3 MB and takes a few
// milliseconds to write; writes are batched, not done per file.

import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathKey } from './paths.js';

export interface FileRecord {
  id: string;
  kind: 'file' | 'folder';
  // ---- what the server has, as of the last sync ----
  /** Last synced version; 0 = never committed. */
  v: number;
  /** Server path at version v. */
  sp: string;
  /** Server content hash at version v. */
  sh: string;
  /** Server version v is a deletion. */
  sd: boolean;
  /** Device name / mtime from the server metadata (used for deterministic conflict names). */
  sdev?: string;
  smt?: number;
  /** Server chunk ids at version v (lets a rename commit without re-uploading). */
  sc?: string[];
  /** Server size at version v. */
  ssz?: number;
  // ---- what is on this computer ----
  /** Current local path. */
  lp: string;
  /** Hash of the local content when last looked at. */
  lh: string;
  /** Deleted locally. */
  ld: boolean;
  /** mtimeMs / size / ctimeMs when lh was computed (to skip re-hashing unchanged files). */
  lm: number;
  ls: number;
  lc?: number;
  /** inode when lh was computed. */
  li?: number;
}

export interface StateData {
  format: 1;
  vaultId: string | null;
  lastSeq: number;
  keyCheck: string | null;
  files: Record<string, FileRecord>;
}

const empty = (): StateData => ({ format: 1, vaultId: null, lastSeq: 0, keyCheck: null, files: {} });

export class StateStore {
  data: StateData = empty();
  /** pathKey(local path) -> file id, for records that exist locally. */
  private byPath = new Map<string, string>();
  private file: string;
  private dirty = false;
  private saving: Promise<void> | null = null;

  constructor(private readonly dir: string) {
    this.file = join(dir, 'sync-state.json');
  }

  async load(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8'));
      if (raw?.format === 1 && raw.files) this.data = raw;
    } catch (e: any) {
      if (e.code !== 'ENOENT') {
        // unreadable state: start fresh; the next sync re-matches files by content, nothing is lost
        this.data = empty();
      }
    }
    this.reindex();
  }

  reset(vaultId: string | null): void {
    this.data = { ...empty(), vaultId };
    this.reindex();
    this.dirty = true;
  }

  reindex(): void {
    this.byPath.clear();
    for (const r of Object.values(this.data.files)) if (!r.ld) this.byPath.set(pathKey(r.lp), r.id);
  }

  get(id: string): FileRecord | undefined {
    return this.data.files[id];
  }

  all(): FileRecord[] {
    return Object.values(this.data.files);
  }

  byLocalPath(p: string): FileRecord | undefined {
    const id = this.byPath.get(pathKey(p));
    return id ? this.data.files[id] : undefined;
  }

  idAtPath(key: string): string | undefined {
    return this.byPath.get(key);
  }

  put(r: FileRecord): void {
    const prev = this.data.files[r.id];
    if (prev && !prev.ld && this.byPath.get(pathKey(prev.lp)) === r.id) this.byPath.delete(pathKey(prev.lp));
    this.data.files[r.id] = r;
    if (!r.ld) this.byPath.set(pathKey(r.lp), r.id);
    this.dirty = true;
  }

  /** Call after changing lp/ld on a record obtained from get(). */
  update(r: FileRecord, change: Partial<FileRecord>): void {
    if (!r.ld && this.byPath.get(pathKey(r.lp)) === r.id) this.byPath.delete(pathKey(r.lp));
    Object.assign(r, change);
    if (!r.ld) this.byPath.set(pathKey(r.lp), r.id);
    this.dirty = true;
  }

  remove(id: string): void {
    const r = this.data.files[id];
    if (!r) return;
    if (!r.ld && this.byPath.get(pathKey(r.lp)) === id) this.byPath.delete(pathKey(r.lp));
    delete this.data.files[id];
    this.dirty = true;
  }

  markDirty(): void {
    this.dirty = true;
  }

  async save(force = false): Promise<void> {
    if (!this.dirty && !force) return;
    while (this.saving) await this.saving;
    this.dirty = false;
    const body = JSON.stringify(this.data);
    const tmp = `${this.file}.${randomBytes(4).toString('hex')}.tmp`;
    this.saving = (async () => {
      try {
        await writeFile(tmp, body);
        for (let i = 0; ; i++) {
          try {
            await rename(tmp, this.file);
            break;
          } catch (e: any) {
            if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
            await new Promise((r) => setTimeout(r, 50 * (i + 1)));
          }
        }
      } catch (e) {
        this.dirty = true;
        await unlink(tmp).catch(() => {});
        throw e;
      }
    })().finally(() => (this.saving = null));
    await this.saving;
  }
}
