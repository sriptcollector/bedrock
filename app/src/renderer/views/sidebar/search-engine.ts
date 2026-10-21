// Runs a query over the SearchIndex in time slices so typing stays smooth on large vaults.
import type { TFile } from "../../vault/files";
import { matchDoc, parseQuery, requiredNeedle, type QueryNode } from "./search-query";
import type { SearchIndex } from "./search-index";
import type { ResultEntry } from "./results";

export type SortOrder = "alphabetical" | "alphabeticalReverse" | "byModifiedTime" | "byModifiedTimeReverse" | "byCreatedTime" | "byCreatedTimeReverse";

export const SORT_OPTIONS: [SortOrder, string][] = [
  ["alphabetical", "File name (A to Z)"],
  ["alphabeticalReverse", "File name (Z to A)"],
  ["byModifiedTime", "Modified time (new to old)"],
  ["byModifiedTimeReverse", "Modified time (old to new)"],
  ["byCreatedTime", "Created time (new to old)"],
  ["byCreatedTimeReverse", "Created time (old to new)"],
];

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function sortEntries<T extends { file: TFile }>(list: T[], order: SortOrder): T[] {
  const title = (f: TFile) => (f.extension === "md" ? f.basename : f.name);
  const cmp: Record<SortOrder, (a: T, b: T) => number> = {
    alphabetical: (a, b) => collator.compare(title(a.file), title(b.file)) || collator.compare(a.file.path, b.file.path),
    alphabeticalReverse: (a, b) => collator.compare(title(b.file), title(a.file)) || collator.compare(b.file.path, a.file.path),
    byModifiedTime: (a, b) => b.file.stat.mtime - a.file.stat.mtime,
    byModifiedTimeReverse: (a, b) => a.file.stat.mtime - b.file.stat.mtime,
    byCreatedTime: (a, b) => b.file.stat.ctime - a.file.stat.ctime,
    byCreatedTimeReverse: (a, b) => a.file.stat.ctime - b.file.stat.ctime,
  };
  return list.sort(cmp[order] ?? cmp.alphabetical);
}

export interface SearchRun {
  cancelled: boolean;
}

export interface SearchOutcome {
  node: QueryNode | null;
  entries: ResultEntry[];
  ms: number;
}

/** Search the whole vault. `onPartial` gets the entries found so far (unsorted) between slices. */
export async function runSearch(app: any, index: SearchIndex, query: string, opts: { matchCase: boolean; sort: SortOrder; limitToPaths?: Set<string> }, run: SearchRun, onPartial?: (entries: ResultEntry[]) => void): Promise<SearchOutcome | null> {
  const t0 = performance.now();
  const node = parseQuery(query);
  if (!node) return { node: null, entries: [], ms: 0 };
  await index.ensureLoaded();
  if (run.cancelled) return null;
  const docs = index.all();
  const needle = requiredNeedle(node);
  const entries: ResultEntry[] = [];
  let sliceStart = performance.now();
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    if (opts.limitToPaths && !opts.limitToPaths.has(d.path)) continue;
    if (app.metadataCache.isUserIgnored?.(d.path)) continue; // Settings › Files and links › Excluded files
    if (needle && !d.lower.includes(needle) && !d.name.toLowerCase().includes(needle)) continue;
    if (d.extension === "md" && !d.meta) d.meta = app.metadataCache.getCache(d.path);
    const r = matchDoc(node, d, opts.matchCase);
    if (!r) continue;
    const file = app.vault.getFileByPath(d.path);
    if (!file) continue;
    const titleIsPath = r.path.length > 0;
    entries.push({ file, text: d.content, ranges: r.content, titleRanges: titleIsPath ? r.path : r.name, titleIsPath });
    if (performance.now() - sliceStart > 12) {
      onPartial?.(entries);
      await new Promise((res) => setTimeout(res, 0));
      if (run.cancelled) return null;
      sliceStart = performance.now();
    }
  }
  sortEntries(entries, opts.sort);
  return { node, entries, ms: Math.round(performance.now() - t0) };
}

/** Number shown as "N results": every match in file contents, plus notes matched by name. */
export function countResults(entries: ResultEntry[]): number {
  let n = 0;
  for (const e of entries) n += e.ranges.length + (e.file.extension === "md" && (e.titleRanges?.length ?? 0) > 0 && !e.titleIsPath ? 1 : 0);
  return n;
}
