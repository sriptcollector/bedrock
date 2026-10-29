// Vault scanning and indexing (Node only: used by the renderer, the index worker and --selftest).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { CachedMetadata } from "obsidian";
import { parseMetadata } from "./parse";
import { isAccessErrorCode } from "../shared/vault-access";

export interface ScannedEntry {
  path: string; // vault-relative, forward slashes
  folder: boolean;
}

export interface FileStat {
  ctime: number;
  mtime: number;
  size: number;
}

export interface IndexedFile {
  path: string;
  stat: FileStat;
  meta?: CachedMetadata;
  error?: string;
}

/** The OS refused access (macOS privacy settings, file permissions), as opposed to "not there". */
export const isAccessError = isAccessErrorCode;

/** The vault folder can't be read at all: the app shows a blocking screen instead of an empty vault. */
export class VaultAccessError extends Error {
  code = "VAULT_ACCESS";
  constructor(public reason?: any) {
    super("The app isn't allowed to read the vault folder.");
  }
}

/** Files and folders in a vault, skipping dot-files/folders (.obsidian, .git, .trash). */
export async function scanVault(root: string): Promise<ScannedEntry[]> {
  const out: ScannedEntry[] = [];
  const walk = async (rel: string) => {
    let ents: fs.Dirent[];
    try {
      ents = await fs.promises.readdir(rel ? path.join(root, rel) : root, { withFileTypes: true });
    } catch (e) {
      // An unreadable vault root must not look like an empty vault.
      if (!rel && isAccessError(e)) throw new VaultAccessError(e);
      return;
    }
    const subs: Promise<void>[] = [];
    for (const e of ents) {
      if (e.name.startsWith(".")) continue;
      const r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) {
        out.push({ path: r, folder: true });
        subs.push(walk(r));
      } else if (e.isFile() || e.isSymbolicLink()) out.push({ path: r, folder: false });
    }
    await Promise.all(subs);
  };
  await walk("");
  return out;
}

export function isMarkdown(p: string): boolean {
  return /\.md$/i.test(p);
}

/** Stat + read + parse a batch of files (what a worker does). */
export async function indexBatch(root: string, paths: string[]): Promise<IndexedFile[]> {
  return Promise.all(
    paths.map(async (p): Promise<IndexedFile> => {
      const abs = path.join(root, p);
      try {
        const st = await fs.promises.stat(abs);
        const stat = { ctime: st.birthtimeMs || st.ctimeMs, mtime: st.mtimeMs, size: st.size };
        if (!isMarkdown(p)) return { path: p, stat };
        const text = await fs.promises.readFile(abs, "utf8");
        return { path: p, stat, meta: parseMetadata(text) };
      } catch (e: any) {
        return { path: p, stat: { ctime: 0, mtime: 0, size: 0 }, error: String(e?.message ?? e) };
      }
    }),
  );
}

export interface IndexOptions {
  workerScript?: string; // path to dist/index-worker.js; omit to index in-process
  workers?: number;
  batchSize?: number;
  onProgress?: (done: number, total: number) => void;
  onBatch?: (files: IndexedFile[]) => void;
}

/** Index many files using a worker_threads pool when available, else in-process batches. */
export async function indexFiles(root: string, paths: string[], opts: IndexOptions = {}): Promise<IndexedFile[]> {
  const batchSize = opts.batchSize ?? 150;
  const batches: string[][] = [];
  for (let i = 0; i < paths.length; i += batchSize) batches.push(paths.slice(i, i + batchSize));
  const results: IndexedFile[] = [];
  let done = 0;
  const take = (r: IndexedFile[]) => {
    for (const x of r) results.push(x);
    done += r.length;
    opts.onBatch?.(r);
    opts.onProgress?.(done, paths.length);
  };

  let Worker: typeof import("node:worker_threads").Worker | null = null;
  if (opts.workerScript && fs.existsSync(opts.workerScript) && paths.length > 300) {
    try {
      Worker = require("node:worker_threads").Worker;
    } catch {
      Worker = null;
    }
  }
  if (!Worker) {
    for (const b of batches) {
      take(await indexBatch(root, b));
      await new Promise((r) => setTimeout(r, 0)); // let the UI breathe
    }
    return results;
  }
  const n = Math.max(1, Math.min(opts.workers ?? Math.max(1, Math.min(4, os.cpus().length - 1)), batches.length));
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, () =>
      new Promise<void>((resolve, reject) => {
        let w: import("node:worker_threads").Worker;
        try {
          w = new Worker!(opts.workerScript!);
        } catch (e) {
          reject(e);
          return;
        }
        const send = () => {
          if (next >= batches.length) {
            w.terminate();
            resolve();
            return;
          }
          w.postMessage({ root, paths: batches[next++] });
        };
        w.on("message", (r: IndexedFile[]) => {
          take(r);
          send();
        });
        w.on("error", reject);
        send();
      }),
    ),
  ).catch(async () => {
    // Worker failed: finish the remaining batches in-process.
    while (next < batches.length) take(await indexBatch(root, batches[next++]));
  });
  return results;
}
