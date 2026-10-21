// Links from canvas files into the rest of the vault, so canvases show up in the graph and in
// backlinks like Obsidian: every file card counts as a link to its file, and [[links]] inside text
// cards count too. The metadata cache has no parser for .canvas files, so this module reads them
// and fills `resolvedLinks` / `unresolvedLinks` for each canvas.
import { parseCanvas, canvasLinkTargets, type CanvasData } from "./format";
import { getLinkpath } from "../../../core/links";

export interface LinkResolver {
  has(path: string): boolean;
  resolve(linkpath: string, sourcePath: string): string | null;
}

export function canvasLinkMaps(data: CanvasData, sourcePath: string, index: LinkResolver): { resolved: Record<string, number>; unresolved: Record<string, number> } {
  const resolved: Record<string, number> = {};
  const unresolved: Record<string, number> = {};
  for (const t of canvasLinkTargets(data)) {
    if (t.kind === "background") continue;
    if (t.kind === "file") {
      if (index.has(t.link)) {
        const exact = index.resolve(t.link, "") ?? t.link;
        resolved[exact] = (resolved[exact] ?? 0) + 1;
      } else {
        const key = t.link.replace(/\.md$/i, "");
        unresolved[key] = (unresolved[key] ?? 0) + 1;
      }
      continue;
    }
    const lp = getLinkpath(t.link);
    const dest = index.resolve(lp, sourcePath);
    if (dest) resolved[dest] = (resolved[dest] ?? 0) + 1;
    else if (lp) unresolved[lp] = (unresolved[lp] ?? 0) + 1;
  }
  return { resolved, unresolved };
}

/** Keeps the metadata cache's link maps up to date for every .canvas file in the vault. */
export class CanvasLinkIndexer {
  private data = new Map<string, CanvasData>();
  private applying = false;
  private ready = false;

  constructor(private app: any) {}

  start(): void {
    const { vault, metadataCache: mc } = this.app;
    const isCanvas = (f: any) => f && f.extension === "canvas";
    const init = async () => {
      if (this.ready) return;
      this.ready = true;
      for (const f of vault.getFiles()) if (isCanvas(f)) await this.read(f, false);
      mc.trigger("resolved");
    };
    if (mc.resolved) void init();
    else {
      const ref = mc.on("resolved", () => {
        mc.offref(ref);
        void init();
      });
    }
    vault.on("create", (f: any) => isCanvas(f) && this.ready && this.read(f, true));
    vault.on("modify", (f: any) => isCanvas(f) && this.ready && this.read(f, true));
    vault.on("delete", (f: any) => {
      if (!isCanvas(f)) return;
      this.data.delete(f.path);
      delete mc.resolvedLinks[f.path];
      delete mc.unresolvedLinks[f.path];
    });
    vault.on("rename", (f: any, old: string) => {
      if (!isCanvas(f)) return;
      const d = this.data.get(old);
      this.data.delete(old);
      if (d) this.data.set(f.path, d);
      this.apply(f.path, true);
    });
    // The cache re-resolves sources when files appear or move; it has no canvas parser, so put the
    // canvas links back whenever it touches a canvas.
    mc.on("resolve", (f: any) => {
      if (isCanvas(f) && !this.applying) this.apply(f.path, false);
    });
    // Targets appearing/disappearing change what a canvas resolves to.
    const refreshAll = () => {
      if (!this.ready) return;
      for (const p of this.data.keys()) this.apply(p, false);
    };
    vault.on("create", (f: any) => !isCanvas(f) && refreshAll());
    vault.on("delete", (f: any) => !isCanvas(f) && refreshAll());
    vault.on("rename", (f: any) => !isCanvas(f) && refreshAll());
  }

  private async read(f: any, fire: boolean): Promise<void> {
    try {
      const text = await this.app.vault.cachedRead(f);
      this.data.set(f.path, parseCanvas(text));
    } catch {
      this.data.set(f.path, { nodes: [], edges: [] });
    }
    this.apply(f.path, fire);
  }

  private apply(path: string, fire: boolean): void {
    const mc = this.app.metadataCache;
    const d = this.data.get(path);
    if (!d) return;
    const { resolved, unresolved } = canvasLinkMaps(d, path, mc.linkIndex);
    mc.resolvedLinks[path] = resolved;
    mc.unresolvedLinks[path] = unresolved;
    if (fire) {
      const f = this.app.vault.getFileByPath(path);
      this.applying = true;
      try {
        if (f) mc.trigger("resolve", f);
      } finally {
        this.applying = false;
      }
      mc.trigger("resolved");
    }
  }

  /** Parsed data of a canvas (for search and other views). */
  get(path: string): CanvasData | undefined {
    return this.data.get(path);
  }
}
