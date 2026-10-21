// Watches the vault folder for changes made outside the app (sync engine, other editors, git)
// and feeds them to the Vault, which fires the usual create/modify/delete events so every view
// updates live. Our own writes are recognised by unchanged mtime+size and ignored.
import fs from "node:fs";
import type { Vault } from "./vault";

export class VaultWatcher {
  private watcher: fs.FSWatcher | null = null;
  private pending = new Map<string, any>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private vault: Vault) {}

  start(): void {
    const base = this.vault.adapter.basePath;
    try {
      this.watcher = fs.watch(base, { recursive: true, persistent: false }, (_ev, filename) => {
        if (!filename) return;
        const rel = filename.toString().replace(/\\/g, "/");
        this.schedule(rel);
      });
      this.watcher.on("error", (e) => console.warn("vault watcher error", e));
    } catch (e) {
      console.warn("vault watcher unavailable; falling back to polling", e);
      this.poll();
    }
  }

  private schedule(rel: string): void {
    // Ignore temp files written by atomic saves and editor swap files.
    const name = rel.slice(rel.lastIndexOf("/") + 1);
    if (/\.tmp$|~$|\.swp$/.test(name) && name.startsWith(".")) return;
    clearTimeout(this.pending.get(rel));
    this.pending.set(
      rel,
      setTimeout(() => {
        this.pending.delete(rel);
        // Serialize so parent folders are created before their children.
        this.queue = this.queue.then(() => this.vault.onExternalChange(rel)).catch((e) => console.error(e));
      }, 80),
    );
  }

  private pollTimer: any = null;
  private poll(): void {
    // Rare fallback: rescan every 5 s.
    this.pollTimer = setInterval(async () => {
      const { scanVault } = await import("../../core/scan");
      const entries = await scanVault(this.vault.adapter.basePath);
      const seen = new Set(entries.map((e) => e.path));
      for (const e of entries) this.schedule(e.path);
      for (const p of Object.keys(this.vault.fileMap)) if (p !== "/" && !seen.has(p)) this.schedule(p);
    }, 5000);
  }

  stop(): void {
    this.watcher?.close();
    clearInterval(this.pollTimer);
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
  }
}
