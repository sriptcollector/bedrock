import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { BlobStore } from './index.js';

/** Local disk backend: DATA_DIR/blobs/<vaultId>/<first 2 of chunkId>/<chunkId>. */
export class DiskStore implements BlobStore {
  readonly kind = 'disk' as const;
  constructor(private readonly root: string) {}

  private file(key: string): string {
    const [vault, id] = key.split('/');
    if (!/^[\w-]+$/.test(vault) || !/^[0-9a-f]{64}$/.test(id)) throw new Error('bad blob key');
    return join(this.root, vault, id.slice(0, 2), id);
  }

  private made = new Set<string>();

  async put(key: string, data: Buffer): Promise<void> {
    const f = this.file(key);
    const dir = dirname(f);
    if (!this.made.has(dir)) {
      await mkdir(dir, { recursive: true });
      if (this.made.size > 100_000) this.made.clear();
      this.made.add(dir);
    }
    const tmp = `${f}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(tmp, data);
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
      await mkdir(dir, { recursive: true }); // folder removed behind our back
      await writeFile(tmp, data);
    }
    await rename(tmp, f);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.file(key));
    } catch (e: any) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  async head(key: string): Promise<number | null> {
    try {
      return (await stat(this.file(key))).size;
    } catch (e: any) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.file(key));
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
}
