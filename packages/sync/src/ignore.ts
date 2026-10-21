// What never syncs. Paths are vault-relative and '/'-separated.

/** Prefix of temp files the engine itself writes (atomic writes, moves); always ignored. */
export const TEMP_PREFIX = '.bedrock-tmp-';

const IGNORED_NAMES = new Set(['.ds_store', 'thumbs.db', 'ehthumbs.db', 'desktop.ini', '.git', '.spotlight-v100', '.trashes', '.fseventsd', '$recycle.bin', '.localized']);

const TEMP_NAME = [
  /^~\$/, // Office lock files
  /^\.~lock\..*#$/, // LibreOffice
  /^\.#/, // Emacs locks
  /^#.*#$/, // Emacs autosave
  /~$/, // backup files
  /\.(tmp|temp|swp|swo|swx|crdownload|part|partial|download)$/i,
  /^\.bedrock-/, // our own temp files
  /^\.sb-[0-9a-f]+-/, // macOS safe-save temp
];

const IGNORED_PATHS = [
  /^\.trash(\/|$)/i, // Obsidian's local recycle bin
  /^\.obsidian\/workspace(-[^/]*)?\.json$/i, // window layout, per device (workspaces.json = saved layouts DOES sync)
  /^\.obsidian\/cache(\/|$)/i,
];

export interface IgnoreOptions {
  /** Extra vault-relative prefixes to skip (e.g. the state dir when it lives inside the vault). */
  prefixes?: string[];
  /** Extra regular expressions matched against the vault-relative path. */
  patterns?: RegExp[];
}

export function isIgnored(rel: string, opts?: IgnoreOptions): boolean {
  if (!rel) return false;
  const segs = rel.split('/');
  for (const s of segs) {
    if (IGNORED_NAMES.has(s.toLowerCase())) return true;
  }
  const name = segs[segs.length - 1];
  for (const re of TEMP_NAME) if (re.test(name)) return true;
  for (const re of IGNORED_PATHS) if (re.test(rel)) return true;
  if (opts?.prefixes) {
    const low = rel.toLowerCase();
    for (const p of opts.prefixes) {
      const pl = p.toLowerCase();
      if (low === pl || low.startsWith(pl + '/')) return true;
    }
  }
  if (opts?.patterns) for (const re of opts.patterns) if (re.test(rel)) return true;
  return false;
}
