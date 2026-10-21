// In-memory text index for Search, backlinks (unlinked mentions) and query blocks.
// Holds the text of every Markdown and canvas file (canvas: the text of its text cards) plus a
// lower-case copy, filled in the background after the metadata cache is ready and kept current
// from vault events. Every other file is searchable by name only.
import { TFile, type TAbstractFile } from "../../vault/files";
import { makeDoc, type SearchDoc } from "./search-query";

export const TEXT_EXTS = new Set(["md", "canvas"]);

export class SearchIndex {
  private docs = new Map<string, SearchDoc>();
  private loading: Promise<void> | null = null;
  loaded = false;
  private listeners = new Set<() => void>();
  private changeTimer: any = null;

  constructor(private app: any) {
    const v = app.vault;
    v.on("create", (f: TAbstractFile) => f instanceof TFile && this.refresh(f));
    v.on("modify", (f: TAbstractFile) => f instanceof TFile && this.refresh(f));
    v.on("delete", (f: TAbstractFile) => {
      if (this.docs.delete(f.path)) this.changed();
      if (!(f instanceof TFile)) for (const k of [...this.docs.keys()]) if (k.startsWith(f.path + "/")) this.docs.delete(k);
    });
    v.on("rename", (f: TAbstractFile, old: string) => {
      if (f instanceof TFile) {
        this.docs.delete(old);
        this.refresh(f);
      } else {
        for (const k of [...this.docs.keys()]) if (k.startsWith(old + "/")) this.docs.delete(k);
        this.loaded && this.loadMissing();
      }
    });
    // Metadata arrives after the text for new/changed notes: keep doc.meta current.
    app.metadataCache.on("changed", (file: TFile, text: string, meta: any) => {
      this.docs.set(file.path, makeDoc(file.path, text, meta));
      this.changed();
    });
    app.metadataCache.on("resolved", () => {
      if (!this.loaded) return;
      for (const d of this.docs.values()) if (d.extension === "md" && !d.meta) d.meta = app.metadataCache.getCache(d.path);
    });
  }

  /** Called (debounced) after any document changes. */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private changed(): void {
    clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => this.listeners.forEach((l) => l()), 400);
  }

  private async read(f: TFile): Promise<string> {
    if (!TEXT_EXTS.has(f.extension)) return "";
    try {
      const raw = await this.app.vault.cachedRead(f);
      return f.extension === "canvas" ? canvasText(raw) : raw;
    } catch {
      return "";
    }
  }

  private async refresh(f: TFile): Promise<void> {
    if (!this.loaded && !this.loading) return;
    const text = await this.read(f);
    if (f.deleted) return;
    this.docs.set(f.path, makeDoc(f.path, text, f.extension === "md" ? this.app.metadataCache.getFileCache(f) : null));
    this.changed();
  }

  /** Load every file's text (once). Yields to the UI between batches. */
  ensureLoaded(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (!this.loading) this.loading = this.loadAll();
    return this.loading;
  }

  private async loadAll(): Promise<void> {
    const t0 = performance.now();
    await this.loadMissing();
    this.loaded = true;
    (this.app as any).searchIndexStats = { docs: this.docs.size, ms: Math.round(performance.now() - t0) };
  }

  private async loadMissing(): Promise<void> {
    const files: TFile[] = this.app.vault.getFiles().filter((f: TFile) => !this.docs.has(f.path));
    const BATCH = 200;
    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH);
      const texts = await Promise.all(batch.map((f) => this.read(f)));
      batch.forEach((f, j) => {
        if (!f.deleted) this.docs.set(f.path, makeDoc(f.path, texts[j], f.extension === "md" ? this.app.metadataCache.getFileCache(f) : null));
      });
      if (i + BATCH < files.length) await new Promise((r) => setTimeout(r, 0));
    }
  }

  get(path: string): SearchDoc | undefined {
    const d = this.docs.get(path);
    if (d && d.extension === "md" && !d.meta) d.meta = this.app.metadataCache.getCache(path);
    return d;
  }

  all(): SearchDoc[] {
    return [...this.docs.values()];
  }

  get size(): number {
    return this.docs.size;
  }
}

/** Text of a canvas file's text cards (and group labels), one card per paragraph. */
export function canvasText(raw: string): string {
  try {
    const data = JSON.parse(raw);
    const parts: string[] = [];
    for (const n of data?.nodes ?? []) {
      if (n?.type === "text" && typeof n.text === "string") parts.push(n.text);
    }
    return parts.join("\n\n");
  } catch {
    return "";
  }
}

/** Files referenced by a canvas file's file cards. */
export function canvasFileRefs(raw: string): string[] {
  try {
    const data = JSON.parse(raw);
    return (data?.nodes ?? []).filter((n: any) => n?.type === "file" && typeof n.file === "string").map((n: any) => n.file);
  } catch {
    return [];
  }
}

let shared: SearchIndex | null = null;
export function getSearchIndex(app: any): SearchIndex {
  if (!shared || (shared as any).app !== app) shared = new SearchIndex(app);
  return shared;
}
