// Walks the vault folder. Produces files and *empty* folders (non-empty folders are implied by
// their files). Symlinks are skipped, ignored paths are pruned without descending into them.

import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isIgnored, TEMP_PREFIX, type IgnoreOptions } from './ignore.js';
import { dirOf, pathKey } from './paths.js';

export interface Entry {
  path: string;
  kind: 'file' | 'folder';
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  /** inode / file index; changes when an editor replaces the file or a rename swaps two files. */
  ino: number;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const n = i++;
        out[n] = await fn(items[n]);
      }
    }),
  );
  return out;
}

export async function statEntry(root: string, rel: string): Promise<Entry | null> {
  try {
    const st = await lstat(join(root, rel));
    if (st.isSymbolicLink()) return null;
    const ctimeMs = Math.floor(st.birthtimeMs || st.ctimeMs);
    if (st.isFile()) return { path: rel, kind: 'file', mtimeMs: st.mtimeMs, ctimeMs, size: st.size, ino: st.ino };
    if (st.isDirectory()) return { path: rel, kind: 'folder', mtimeMs: st.mtimeMs, ctimeMs, size: 0, ino: st.ino };
    return null;
  } catch {
    return null;
  }
}

/** Walks `rel` (a folder, '' = vault root) and adds files and empty folders to `out` (keyed by pathKey). */
export async function walk(root: string, rel: string, ignore: IgnoreOptions, out: Map<string, Entry>, temps?: string[]): Promise<void> {
  let dirents;
  try {
    dirents = await readdir(join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  const files: string[] = [];
  const dirs: string[] = [];
  for (const d of dirents) {
    const p = rel ? `${rel}/${d.name}` : d.name;
    if (temps && d.isFile() && d.name.startsWith(TEMP_PREFIX)) temps.push(p);
    if (isIgnored(p, ignore)) continue;
    if (d.isFile()) files.push(p);
    else if (d.isDirectory()) dirs.push(p);
    // symlinks and special files are not synced
  }
  if (rel && files.length === 0 && dirs.length === 0) {
    const e = await statEntry(root, rel);
    if (e && e.kind === 'folder') out.set(pathKey(rel), e);
    return;
  }
  const entries = await mapLimit(files, 32, (p) => statEntry(root, p));
  for (const e of entries) if (e && e.kind === 'file') out.set(pathKey(e.path), e);
  for (const d of dirs) await walk(root, d, ignore, out, temps);
}

/** True if the folder has no non-ignored entries. */
export async function isEmptyDir(root: string, rel: string, ignore: IgnoreOptions): Promise<boolean> {
  try {
    const names = await readdir(join(root, rel));
    return names.every((n) => isIgnored(rel ? `${rel}/${n}` : n, ignore));
  } catch {
    return false;
  }
}

/**
 * Scans only the given paths (from the watcher): each path itself (file, or folder walked fully)
 * and its parent folder (which may have become empty or non-empty).
 */
export async function scanPaths(root: string, paths: Iterable<string>, ignore: IgnoreOptions): Promise<{ entries: Map<string, Entry>; scopes: string[] }> {
  const entries = new Map<string, Entry>();
  const scopes = new Set<string>();
  for (const p of paths) {
    if (!p || isIgnored(p, ignore)) continue;
    scopes.add(p);
    const e = await statEntry(root, p);
    if (e?.kind === 'file') entries.set(pathKey(p), e);
    else if (e?.kind === 'folder') await walk(root, p, ignore, entries);
    const parent = dirOf(p);
    if (parent) {
      scopes.add('\u0000' + parent); // parent folder itself only (not its subtree)
      if (await isEmptyDir(root, parent, ignore)) {
        const pe = await statEntry(root, parent);
        if (pe?.kind === 'folder') entries.set(pathKey(parent), pe);
      }
    }
  }
  return { entries, scopes: [...scopes] };
}
