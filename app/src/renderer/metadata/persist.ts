// The metadata cache kept between runs (IndexedDB, per vault, outside the vault): each note's
// parsed metadata with the size and modified time it was parsed at. On start only files whose
// size or time changed are read and parsed again; "Rebuild vault cache" clears it.
import fs from "node:fs";
import nodePath from "node:path";

export interface PersistedEntry {
  path: string;
  mtime: number;
  size: number;
  ctime: number;
  meta: any;
}

const STORE = "files";

function open(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "path" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export class MetadataStore {
  constructor(private dbName: string) {}

  async loadAll(): Promise<Map<string, PersistedEntry>> {
    const db = await open(this.dbName);
    const out = new Map<string, PersistedEntry>();
    if (!db) return out;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        for (const e of req.result as PersistedEntry[]) out.set(e.path, e);
        resolve();
      };
      req.onerror = () => resolve();
    });
    db.close();
    return out;
  }

  /** Replace the stored entries with `entries`. */
  async saveAll(entries: PersistedEntry[]): Promise<void> {
    const db = await open(this.dbName);
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const st = tx.objectStore(STORE);
      st.clear();
      for (const e of entries) st.put(e);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
    db.close();
  }

  clear(): Promise<void> {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.deleteDatabase(this.dbName);
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}

/** Stat files in parallel batches (null when a file is gone). */
export async function statAll(base: string, paths: string[], batch = 256): Promise<Map<string, { mtime: number; size: number; ctime: number } | null>> {
  const out = new Map<string, { mtime: number; size: number; ctime: number } | null>();
  for (let i = 0; i < paths.length; i += batch) {
    const part = paths.slice(i, i + batch);
    const res = await Promise.all(part.map((p) => fs.promises.stat(nodePath.join(base, p)).then((s) => ({ mtime: s.mtimeMs, size: s.size, ctime: s.birthtimeMs || s.ctimeMs }), () => null)));
    part.forEach((p, j) => out.set(p, res[j]));
  }
  return out;
}
