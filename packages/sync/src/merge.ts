import { mergeText } from './diff3.js';

const TEXT_EXT = new Set([
  'md', 'markdown', 'mdown', 'txt', 'canvas', 'css', 'csv', 'tsv', 'html', 'htm', 'svg', 'xml', 'yaml', 'yml',
  'tex', 'bib', 'org', 'rst', 'js', 'ts', 'json', 'base', 'excalidraw', 'ics', 'log',
]);

/** Largest text we try to merge line by line; bigger files fall back to conflict copies. */
export const MAX_MERGE_BYTES = 4 * 1024 * 1024;

export function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function isTextPath(path: string): boolean {
  return TEXT_EXT.has(extOf(path));
}

/** `.obsidian/*.json` settings files merge per key instead of per line. */
export function isSettingsJson(path: string): boolean {
  return /^\.obsidian\/[^/]+\.json$/i.test(path) || /^\.obsidian\/plugins\/[^/]+\/data\.json$/i.test(path);
}

export function decodeUtf8(buf: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return null;
  }
}

export type MergeOutcome = { clean: true; data: Buffer } | { clean: false };

/**
 * Tries to merge two versions of a file given their common ancestor. Returns clean:false when the
 * caller must keep both copies (binary file, base missing, or overlapping edits).
 */
export function mergeFile(
  path: string,
  base: Uint8Array | null,
  ours: Uint8Array,
  theirs: Uint8Array,
  oursNewer: boolean,
): MergeOutcome {
  if (base === null) return { clean: false };
  if (!isTextPath(path)) return { clean: false };
  if (base.length > MAX_MERGE_BYTES || ours.length > MAX_MERGE_BYTES || theirs.length > MAX_MERGE_BYTES) return { clean: false };
  const b = decodeUtf8(base);
  const o = decodeUtf8(ours);
  const t = decodeUtf8(theirs);
  if (b === null || o === null || t === null) return { clean: false };
  if (isSettingsJson(path)) {
    const r = mergeJsonText(b, o, t, oursNewer);
    if (r !== null) return { clean: true, data: Buffer.from(r) };
  }
  const r = mergeText(b, o, t);
  return r.clean ? { clean: true, data: Buffer.from(r.text) } : { clean: false };
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Key-level merge: a key changed on one side takes that side; changed on both, the newer side wins. */
export function mergeJsonValues(base: unknown, ours: unknown, theirs: unknown, oursNewer: boolean): unknown {
  if (same(ours, theirs)) return ours;
  if (same(base, ours)) return theirs;
  if (same(base, theirs)) return ours;
  if (isPlainObject(ours) && isPlainObject(theirs)) {
    const b = isPlainObject(base) ? base : {};
    const out: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(ours), ...Object.keys(theirs)]);
    for (const key of keys) {
      const inO = key in ours;
      const inT = key in theirs;
      const inB = key in b;
      if (inO && inT) out[key] = mergeJsonValues(b[key], ours[key], theirs[key], oursNewer);
      else if (inO) {
        // theirs removed it (if it was in base and we did not change it) or we added it
        if (inB && same(b[key], ours[key])) continue;
        if (inB && !oursNewer) continue;
        out[key] = ours[key];
      } else {
        if (inB && same(b[key], theirs[key])) continue;
        if (inB && oursNewer) continue;
        out[key] = theirs[key];
      }
    }
    return out;
  }
  return oursNewer ? ours : theirs;
}

export function mergeJsonText(base: string, ours: string, theirs: string, oursNewer: boolean): string | null {
  try {
    const b = base.trim() ? JSON.parse(base) : {};
    const o = JSON.parse(ours);
    const t = JSON.parse(theirs);
    const indent = /^\{[ \t]*\r?\n([ \t]+)/.exec(ours)?.[1] ?? '  ';
    return JSON.stringify(mergeJsonValues(b, o, t, oursNewer), null, indent);
  } catch {
    return null;
  }
}
