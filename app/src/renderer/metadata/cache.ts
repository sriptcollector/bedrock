// MetadataCache (obsidian.d.ts): per-file CachedMetadata, link resolution and the
// resolvedLinks / unresolvedLinks maps. The initial index runs in a worker_threads pool
// (core/scan.ts); later changes are parsed in-process (one note takes well under a millisecond).
import { MetadataStore, statAll, type PersistedEntry } from "./persist";
import type { CachedMetadata } from "obsidian";
import { Events } from "../api/events";
import { TFile, type TAbstractFile, TFolder } from "../vault/files";
import type { Vault } from "../vault/vault";
import { LinkIndex, getLinkpath, parseLinktext } from "../../core/links";
import { parseMetadata, getAllTags, parseFrontMatterAliases } from "../../core/parse";
import { resolveLinksFor } from "../../core/resolve";
import { indexFiles } from "../../core/scan";
import { basename } from "../../core/path";

export interface IndexStats {
  files: number;
  notes: number;
  ms: number;
  workers: boolean;
}

export class MetadataCache extends Events {
  vault: Vault;
  resolvedLinks: Record<string, Record<string, number>> = {};
  unresolvedLinks: Record<string, Record<string, number>> = {};
  /** path -> parsed metadata */
  private caches = new Map<string, CachedMetadata>();
  linkIndex = new LinkIndex();
  initialized = false;
  resolved = false;
  lastIndex: IndexStats | null = null;
  private resolvedTimer: any = null;
  private pendingReads = new Map<string, Promise<void>>();

  constructor(vault: Vault) {
    super();
    this.vault = vault;
    vault.on("create", (f: TAbstractFile) => this.onCreate(f));
    vault.on("modify", (f: TAbstractFile) => f instanceof TFile && this.onModify(f));
    vault.on("delete", (f: TAbstractFile) => this.onDelete(f));
    vault.on("rename", (f: TAbstractFile, old: string) => this.onRename(f, old));
  }

  /** Index every file in the vault. Calls onProgress(done, total) as batches complete. */
  async initialIndex(workerScript: string | undefined, onProgress?: (done: number, total: number) => void): Promise<IndexStats> {
    const t0 = performance.now();
    const files = this.vault.getFiles();
    for (const f of files) this.linkIndex.add(f.path);
    const byPath = new Map(files.map((f) => [f.path, f] as const));
    let usedWorkers = false;
    // Notes unchanged since the last run come from the cache kept between runs.
    let toIndex = files.map((f) => f.path);
    let reused = 0;
    if (this.store) {
      try {
        const [saved, stats] = await Promise.all([this.store.loadAll(), statAll(this.vault.adapter.basePath, toIndex)]);
        toIndex = [];
        for (const f of files) {
          const st = stats.get(f.path);
          const e = saved.get(f.path);
          if (st) f.stat = { ctime: Math.round(st.ctime), mtime: Math.round(st.mtime), size: st.size };
          if (st && e && Math.round(e.mtime) === Math.round(st.mtime) && e.size === st.size) {
            if (e.meta) this.caches.set(f.path, e.meta);
            reused++;
          } else toIndex.push(f.path);
        }
      } catch (e) {
        console.error("Couldn't read the saved metadata cache", e);
        toIndex = files.map((f) => f.path);
      }
    }
    this.lastReused = reused;
    await indexFiles(this.vault.adapter.basePath, toIndex, {
      workerScript,
      onProgress,
      onBatch: (batch) => {
        usedWorkers = usedWorkers || batch.length > 0;
        for (const r of batch) {
          const f = byPath.get(r.path);
          if (!f) continue;
          f.stat = r.stat;
          if (r.meta) this.caches.set(r.path, r.meta);
        }
      },
    });
    this.initialized = true;
    for (const f of files) if (f.extension === "md") this.resolveFile(f.path, false);
    if (this.store) {
      this.persistSoon(0);
      for (const ev of ["changed", "deleted"]) this.on(ev, () => this.persistSoon());
      this.vault.on("rename", () => this.persistSoon());
    }
    this.resolved = true;
    this.lastIndex = { files: files.length, notes: this.caches.size, ms: Math.round(performance.now() - t0), workers: !!workerScript };
    this.trigger("resolved");
    return this.lastIndex;
  }

  // ---------- cache kept between runs ----------
  store: MetadataStore | null = null;
  lastReused = 0;
  private persistTimer: any = null;
  /** Keep the parsed metadata in IndexedDB (call before initialIndex). */
  usePersistentStore(name: string): void {
    this.store = new MetadataStore(name);
  }
  persistSoon(delay = 5000): void {
    if (!this.store) return;
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => void this.persistNow(), delay);
  }
  async persistNow(): Promise<void> {
    if (!this.store) return;
    const entries: PersistedEntry[] = [];
    for (const f of this.vault.getFiles()) {
      const meta = this.caches.get(f.path);
      if (!meta && f.extension === "md") continue;
      entries.push({ path: f.path, mtime: f.stat.mtime, size: f.stat.size, ctime: f.stat.ctime, meta: meta ?? null });
    }
    await this.store.saveAll(entries);
  }
  /** "Rebuild vault cache": forget what was saved (the next start reads every file again). */
  async clearPersisted(): Promise<void> {
    clearTimeout(this.persistTimer);
    await this.store?.clear();
  }

  // ---------- public API ----------
  getFileCache(file: TFile | null): CachedMetadata | null {
    return file ? this.caches.get(file.path) ?? null : null;
  }
  getCache(path: string): CachedMetadata | null {
    return this.caches.get(path) ?? null;
  }

  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null {
    const p = this.linkIndex.resolve(getLinkpath(linkpath), sourcePath);
    return p ? this.vault.getFileByPath(p) : null;
  }

  getLinkpathDest(linkpath: string, sourcePath: string): TFile[] {
    const f = this.getFirstLinkpathDest(linkpath, sourcePath);
    return f ? [f] : [];
  }

  fileToLinktext(file: TFile, sourcePath: string, omitMdExtension = true): string {
    const fmt = this.vault.getConfig("newLinkFormat");
    let t = this.linkIndex.linkText(file.path, sourcePath, fmt);
    if (!omitMdExtension && file.extension === "md" && !t.endsWith(".md")) t += ".md";
    return t;
  }

  /** Internal API used by many plugins: tag -> count across the vault. */
  getTags(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const meta of this.caches.values()) for (const t of getAllTags(meta) ?? []) out[t] = (out[t] ?? 0) + 1;
    return out;
  }

  /** Internal API: notes linking to `file`, with the link caches. */
  getBacklinksForFile(file: TFile): { data: Map<string, any[]>; keys(): string[]; get(k: string): any[] | undefined; count(): number } {
    const data = new Map<string, any[]>();
    for (const [src, targets] of Object.entries(this.resolvedLinks)) {
      if (!targets[file.path]) continue;
      const meta = this.caches.get(src);
      const refs = [...(meta?.links ?? []), ...(meta?.embeds ?? []), ...((meta?.frontmatterLinks as any[]) ?? [])].filter(
        (l) => this.linkIndex.resolve(getLinkpath(l.link), src) === file.path,
      );
      data.set(src, refs);
    }
    return { data, keys: () => [...data.keys()], get: (k) => data.get(k), count: () => data.size };
  }

  /** Link suggestions for [[ autocomplete: files, aliases and unresolved names. */
  getLinkSuggestions(): { file: TFile | null; path: string; alias?: string }[] {
    const out: { file: TFile | null; path: string; alias?: string }[] = [];
    for (const f of this.vault.getFiles()) {
      out.push({ file: f, path: f.path });
      const aliases = parseFrontMatterAliases(this.caches.get(f.path)?.frontmatter);
      if (aliases) for (const a of aliases) out.push({ file: f, path: f.path, alias: a });
    }
    const seen = new Set<string>();
    for (const m of Object.values(this.unresolvedLinks))
      for (const k of Object.keys(m))
        if (!seen.has(k)) {
          seen.add(k);
          out.push({ file: null, path: k });
        }
    return out;
  }

  getFrontmatterPropertyValuesForKey(key: string): string[] {
    const set = new Set<string>();
    for (const m of this.caches.values()) {
      const v = m.frontmatter?.[key];
      if (Array.isArray(v)) v.forEach((x) => x != null && set.add(String(x)));
      else if (v != null) set.add(String(v));
    }
    return [...set];
  }

  getAllPropertyInfos(): Record<string, { name: string; type: string; count: number }> {
    const out: Record<string, { name: string; type: string; count: number }> = {};
    for (const m of this.caches.values())
      for (const [k, v] of Object.entries(m.frontmatter ?? {})) {
        const e = (out[k.toLowerCase()] ??= { name: k, type: guessType(v), count: 0 });
        e.count++;
      }
    return out;
  }

  isUserIgnored(path: string): boolean {
    const filters: string[] = this.vault.getConfig("userIgnoreFilters") ?? [];
    return filters.some((f) => {
      if (f.startsWith("/") && f.endsWith("/") && f.length > 2) {
        try {
          return new RegExp(f.slice(1, -1)).test(path);
        } catch {
          return false;
        }
      }
      const pat = f.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      return new RegExp("^" + pat).test(path) || path.includes("/" + f);
    });
  }

  // ---------- updates ----------
  private resolveFile(path: string, fire = true): void {
    const { resolved, unresolved } = resolveLinksFor(path, this.caches.get(path), this.linkIndex);
    this.resolvedLinks[path] = resolved;
    this.unresolvedLinks[path] = unresolved;
    if (fire) {
      const f = this.vault.getFileByPath(path);
      if (f) this.trigger("resolve", f);
      this.scheduleResolved();
    }
  }

  private scheduleResolved(): void {
    clearTimeout(this.resolvedTimer);
    this.resolvedTimer = setTimeout(() => this.trigger("resolved"), 50);
  }

  /** Re-resolve notes whose links may point to `name` (after a file appears/disappears/moves). */
  private reresolveMentions(paths: string[]): void {
    const names = new Set(paths.map((p) => basename(p).toLowerCase().replace(/\.md$/, "")));
    for (const [src, targets] of Object.entries(this.unresolvedLinks)) {
      if (Object.keys(targets).some((k) => names.has(basename(k).toLowerCase().replace(/\.md$/, "")))) this.resolveFile(src);
    }
    const lower = new Set(paths.map((p) => p.toLowerCase()));
    for (const [src, targets] of Object.entries(this.resolvedLinks)) {
      if (Object.keys(targets).some((k) => lower.has(k.toLowerCase()))) this.resolveFile(src);
    }
  }

  private async parseFile(file: TFile): Promise<void> {
    const prev = this.pendingReads.get(file.path);
    const run = (async () => {
      if (prev) await prev.catch(() => undefined);
      let text: string;
      try {
        text = await this.vault.cachedRead(file);
      } catch {
        return;
      }
      if (file.deleted) return;
      const meta = parseMetadata(text);
      this.caches.set(file.path, meta);
      this.trigger("changed", file, text, meta);
      this.resolveFile(file.path);
    })();
    this.pendingReads.set(file.path, run);
    await run;
    if (this.pendingReads.get(file.path) === run) this.pendingReads.delete(file.path);
  }

  private onCreate(f: TAbstractFile): void {
    if (!(f instanceof TFile)) return;
    this.linkIndex.add(f.path);
    if (f.extension === "md") this.parseFile(f);
    this.reresolveMentions([f.path]);
  }

  private onModify(f: TFile): void {
    if (f.extension === "md") this.parseFile(f);
  }

  private onDelete(f: TAbstractFile): void {
    if (!(f instanceof TFile)) return;
    this.linkIndex.remove(f.path);
    const prev = this.caches.get(f.path) ?? null;
    this.caches.delete(f.path);
    delete this.resolvedLinks[f.path];
    delete this.unresolvedLinks[f.path];
    this.trigger("deleted", f, prev);
    this.reresolveMentions([f.path]);
    this.scheduleResolved();
  }

  private onRename(f: TAbstractFile, oldPath: string): void {
    if (f instanceof TFolder) return;
    if (!(f instanceof TFile)) return;
    this.linkIndex.remove(oldPath);
    this.linkIndex.add(f.path);
    const meta = this.caches.get(oldPath);
    if (meta) {
      this.caches.delete(oldPath);
      this.caches.set(f.path, meta);
    }
    for (const m of [this.resolvedLinks, this.unresolvedLinks]) {
      if (m[oldPath]) {
        m[f.path] = m[oldPath];
        delete m[oldPath];
      }
    }
    if (f.extension === "md") this.resolveFile(f.path);
    this.reresolveMentions([oldPath, f.path]);
  }
}

function guessType(v: any): string {
  if (Array.isArray(v)) return "multitext";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "checkbox";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return "datetime";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return "date";
  return "text";
}

/** resolveSubpath (obsidian API): find the heading/block a "#..." subpath refers to. */
export function resolveSubpath(cache: CachedMetadata, subpath: string): any {
  if (!subpath) return null;
  const sp = subpath.replace(/^#/, "");
  if (sp.startsWith("^")) {
    const id = sp.slice(1);
    const block = cache.blocks?.[id] ?? cache.blocks?.[id.toLowerCase()];
    if (!block) return null;
    const list = cache.listItems?.find((l) => l.id === id);
    return { type: "block", block, list, start: block.position.start, end: block.position.end };
  }
  const parts = sp.split("#").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const hs = cache.headings ?? [];
  let idx = -1;
  let from = 0;
  for (const part of parts) {
    idx = hs.findIndex((h, i) => i >= from && normHeading(h.heading) === normHeading(part));
    if (idx < 0) return null;
    from = idx + 1;
  }
  if (idx < 0) return null;
  const h = hs[idx];
  const next = hs.slice(idx + 1).find((x) => x.level <= h.level);
  return { type: "heading", current: h, next: next ?? null, start: h.position.start, end: next ? next.position.start : null };
}

function normHeading(s: string): string {
  return s.toLowerCase().replace(/[#|^\\%\[\]:]/g, " ").replace(/\s+/g, " ").trim();
}

export { parseLinktext };
