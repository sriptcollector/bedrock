// File recovery: snapshots of notes (md, canvas, base) kept on this computer, never in the vault.
// Like Obsidian they live in IndexedDB (database "<appId>-backup", store "backups", records
// {path, ts, data}). A file gets a new snapshot when it changes and its last snapshot is older
// than the interval (default 5 minutes); snapshots older than the history length (default 7 days)
// are removed. Options in .obsidian/file-recovery.json {intervalMinutes, keepDays}.
import moment from "moment";
import { Modal } from "../../ui/modal";
import { Notice } from "../../ui/notice";
import { Setting, SearchComponent, ToggleComponent } from "../../ui/setting";
import { CoreOptionsTab } from "../shared";
import type { CorePluginImpl, InternalPlugin } from "../manager";

export interface Snapshot {
  id?: number;
  path: string;
  ts: number;
  data: string;
}

const EXTS = new Set(["md", "canvas", "base"]);

export class SnapshotStore {
  private dbp: Promise<IDBDatabase> | null = null;
  constructor(private name: string) {}
  private db(): Promise<IDBDatabase> {
    if (!this.dbp)
      this.dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.name, 1);
        req.onupgradeneeded = () => {
          const s = req.result.createObjectStore("backups", { keyPath: "id", autoIncrement: true });
          s.createIndex("path", "path");
          s.createIndex("ts", "ts");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    return this.dbp;
  }
  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
    const db = await this.db();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction("backups", mode);
      const r = fn(t.objectStore("backups"));
      t.oncomplete = () => resolve((r as IDBRequest<T>)?.result as T);
      t.onerror = () => reject(t.error);
    });
  }
  add(s: Snapshot): Promise<any> {
    return this.tx("readwrite", (st) => st.add({ path: s.path, ts: s.ts, data: s.data }));
  }
  async forPath(path: string): Promise<Snapshot[]> {
    const all = (await this.tx<Snapshot[]>("readonly", (st) => st.index("path").getAll(IDBKeyRange.only(path)))) ?? [];
    return all.sort((a, b) => b.ts - a.ts);
  }
  async latest(path: string): Promise<Snapshot | null> {
    return (await this.forPath(path))[0] ?? null;
  }
  async paths(): Promise<{ path: string; count: number; last: number }[]> {
    const all = (await this.tx<Snapshot[]>("readonly", (st) => st.getAll())) ?? [];
    const m = new Map<string, { path: string; count: number; last: number }>();
    for (const s of all) {
      const e = m.get(s.path) ?? { path: s.path, count: 0, last: 0 };
      e.count++;
      e.last = Math.max(e.last, s.ts);
      m.set(s.path, e);
    }
    return [...m.values()].sort((a, b) => b.last - a.last);
  }
  async prune(olderThan: number): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction("backups", "readwrite");
      const req = t.objectStore("backups").index("ts").openCursor(IDBKeyRange.upperBound(olderThan));
      req.onsuccess = () => {
        const c = req.result;
        if (c) {
          c.delete();
          c.continue();
        }
      };
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }
  clear(): Promise<void> {
    return this.tx("readwrite", (st) => st.clear());
  }
}

function options(p: InternalPlugin): { intervalMinutes: number; keepDays: number } {
  const i = Number(p.options.intervalMinutes);
  const k = Number(p.options.keepDays);
  return { intervalMinutes: Number.isFinite(i) && i >= 0 ? i : 5, keepDays: Number.isFinite(k) && k > 0 ? k : 7 };
}

/** Whether a new snapshot is due (pure; used by tests). */
export function snapshotDue(last: Snapshot | null, data: string, now: number, intervalMinutes: number): boolean {
  if (!last) return true;
  if (last.data === data) return false;
  return now - last.ts >= intervalMinutes * 60 * 1000;
}

export class FileRecoveryModal extends Modal {
  private listEl!: HTMLElement;
  private contentWrap!: HTMLElement;
  private textEl!: HTMLTextAreaElement;
  private diffEl!: HTMLElement;
  private titleTextEl!: HTMLElement;
  private showDiff = localStorage.getItem("history-show-diff") === "true";
  private current: Snapshot | null = null;
  private snaps: Snapshot[] = [];
  private search!: SearchComponent;

  constructor(app: any, private store: SnapshotStore, private path: string | null) {
    super(app);
    this.modalEl.addClass("mod-sync-history", "mod-sidebar-layout", "mod-file-recovery");
    const close = this.modalEl.querySelector(".modal-close-button");
    close?.removeClass("modal-close-button");
    close?.addClass("modal-header-button", "mod-raised", "clickable-icon");
  }

  onOpen(): void {
    const c = this.contentEl;
    c.empty();
    const side = c.createDiv("modal-sidebar mod-history");
    const inner = side.createDiv("modal-sidebar-inner");
    this.search = new SearchComponent(inner);
    this.search.containerEl.addClass("mod-raised");
    this.search.setPlaceholder("Choose a file...");
    this.listEl = inner.createDiv("modal-sidebar-list");
    this.contentWrap = c.createDiv("sync-history-content-container mod-empty");
    this.contentWrap.createEl("p", { cls: "sync-history-content-empty", text: "Choose a file on the left to see its snapshots." });
    const content = this.contentWrap.createDiv("sync-history-content");
    const bar = content.createDiv("modal-setting-titlebar");
    this.titleTextEl = bar.createDiv("modal-setting-title");
    const actions = bar.createDiv("modal-setting-titlebar-actions");
    const tg = actions.createSpan({ cls: "modal-setting-titlebar-toggle", text: "Show changes" });
    new ToggleComponent(tg)
      .setValue(this.showDiff)
      .onChange((v) => {
        this.showDiff = v;
        localStorage.setItem("history-show-diff", String(v));
        this.renderSnapshot();
      })
      .toggleEl.addClass("mod-small");
    actions.createEl("button", { text: "Copy" }).addEventListener("click", async () => {
      if (!this.current) return;
      await navigator.clipboard.writeText(this.current.data);
      new Notice("Copied the snapshot to the clipboard.");
    });
    actions.createEl("button", { text: "Restore" }).addEventListener("click", () => this.restore());
    this.textEl = content.createEl("textarea", { cls: "file-recovery-text", attr: { readonly: "true", spellcheck: "false" } });
    this.diffEl = content.createDiv("file-recovery-diff");
    this.search.onChange(() => this.renderFiles());
    if (this.path) void this.openPath(this.path);
    else void this.renderFiles();
  }

  private async renderFiles(): Promise<void> {
    this.path = null;
    this.setTitle("File recovery");
    const q = this.search.getValue().toLowerCase();
    const list = await this.store.paths();
    this.listEl.empty();
    const shown = list.filter((e) => e.path.toLowerCase().includes(q));
    if (!shown.length) this.listEl.createDiv({ cls: "modal-sidebar-empty u-muted", text: list.length ? "No matching files." : "No snapshots yet." });
    for (const e of shown) {
      const it = this.listEl.createDiv("modal-sidebar-item tappable");
      it.createDiv({ cls: "modal-sidebar-item-title", text: e.path.replace(/\.md$/, "") });
      it.createDiv({ cls: "modal-sidebar-item-subtitle", text: `${e.count} ${e.count === 1 ? "snapshot" : "snapshots"} · ${moment(e.last).fromNow()}` });
      it.addEventListener("click", () => this.openPath(e.path));
    }
  }

  private async openPath(path: string): Promise<void> {
    this.path = path;
    this.search.setValue(path.replace(/\.md$/, ""));
    this.setTitle(path.split("/").pop()!.replace(/\.md$/, ""));
    this.snaps = await this.store.forPath(path);
    this.listEl.empty();
    if (!this.snaps.length) {
      this.listEl.createDiv({ cls: "modal-sidebar-empty u-muted", text: "This file has no snapshots yet." });
      return;
    }
    this.snaps.forEach((s, i) => {
      const it = this.listEl.createDiv("modal-sidebar-item tappable");
      it.createDiv({ cls: "modal-sidebar-item-title", text: moment(s.ts).format("ddd, MMM D, YYYY h:mm A") });
      it.createDiv({ cls: "modal-sidebar-item-subtitle", text: formatSize(new Blob([s.data]).size) });
      it.addEventListener("click", () => {
        this.listEl.querySelectorAll(".modal-sidebar-item").forEach((x) => x.removeClass("is-selected"));
        it.addClass("is-selected");
        this.current = s;
        this.renderSnapshot(i);
      });
      if (i === 0) it.click();
    });
  }

  private renderSnapshot(i = this.snaps.indexOf(this.current!)): void {
    const s = this.current;
    this.contentWrap.toggleClass("mod-empty", !s);
    if (!s) return;
    this.titleTextEl.setText(this.path?.split("/").pop()?.replace(/\.md$/, "") ?? "");
    this.textEl.value = s.data;
    this.textEl.toggle(!this.showDiff);
    this.diffEl.toggle(this.showDiff);
    if (this.showDiff) {
      // Changes compared with the snapshot before this one.
      const prev = this.snaps[i + 1]?.data ?? "";
      this.diffEl.empty();
      for (const d of lineDiff(prev, s.data)) {
        const line = this.diffEl.createDiv({ cls: d.op === "+" ? "mod-added" : d.op === "-" ? "mod-removed" : "", text: d.text || " " });
        void line;
      }
    }
  }

  private async restore(): Promise<void> {
    if (!this.current || !this.path) return;
    const ok = await this.app.ui.confirm({ title: "Restore snapshot", body: `Replace the current text of “${this.path}” with this snapshot from ${moment(this.current.ts).format("lll")}? The current text is saved as a snapshot first.`, cta: "Restore" });
    if (!ok) return;
    const file = this.app.vault.getFileByPath(this.path);
    if (file) {
      const cur = await this.app.vault.read(file);
      await this.store.add({ path: this.path, ts: Date.now(), data: cur });
      await this.app.vault.modify(file, this.current.data);
    } else await this.app.vault.create(this.path, this.current.data);
    new Notice("Snapshot restored.");
    this.close();
  }
}

/** Minimal line diff (LCS) for "Show changes". */
export function lineDiff(a: string, b: string): { op: " " | "+" | "-"; text: string }[] {
  const x = a.split("\n"),
    y = b.split("\n");
  if (x.length * y.length > 4_000_000) return [...x.map((t) => ({ op: "-" as const, text: t })), ...y.map((t) => ({ op: "+" as const, text: t }))];
  const n = x.length,
    m = y.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { op: " " | "+" | "-"; text: string }[] = [];
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ op: " ", text: x[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ op: "-", text: x[i++] });
    else out.push({ op: "+", text: y[j++] });
  }
  while (i < n) out.push({ op: "-", text: x[i++] });
  while (j < m) out.push({ op: "+", text: y[j++] });
  return out;
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

class RecoveryTab extends CoreOptionsTab {
  constructor(p: InternalPlugin, private store: SnapshotStore) {
    super(p);
  }
  getSettingDefinitions(): any[] {
    const num = (key: "intervalMinutes" | "keepDays", min: number) => (v: string) => {
      const n = Number(v);
      if (v !== "" && (!Number.isFinite(n) || n < min)) return;
      this.plugin.setOption(key, v === "" ? undefined : n);
    };
    const o = options(this.plugin);
    return [
      {
        name: "Snapshot interval",
        desc: "Minimum number of minutes between two snapshots of the same file.",
        render: (s: Setting) => s.addText((t) => t.setPlaceholder("5").setValue(String(this.plugin.options.intervalMinutes ?? o.intervalMinutes)).onChange(num("intervalMinutes", 0))),
      },
      {
        name: "History length",
        desc: "Number of days snapshots are kept.",
        render: (s: Setting) => s.addText((t) => t.setPlaceholder("7").setValue(String(this.plugin.options.keepDays ?? o.keepDays)).onChange(num("keepDays", 1))),
      },
      { name: "Snapshots", desc: "Browse every file that has snapshots and restore an earlier version.", render: (s: Setting) => s.addButton((b) => b.setButtonText("View").onClick(() => new FileRecoveryModal(this.app, this.store, null).open())) },
      {
        name: "Clear history",
        desc: "Delete every snapshot on this computer. Your notes aren't touched.",
        render: (s: Setting) =>
          s.addButton((b) =>
            b
              .setButtonText("Clear")
              .setWarning()
              .onClick(async () => {
                const ok = await this.app.ui.confirm({ title: "Clear history", body: "Delete all snapshots? This can't be undone.", cta: "Clear", danger: true });
                if (!ok) return;
                await this.store.clear();
                new Notice("File recovery history cleared.");
              }),
          ),
      },
    ];
  }
}

export const fileRecoveryPlugin: CorePluginImpl = {
  id: "file-recovery",
  defaultOptions: {},
  onEnable(p: InternalPlugin) {
    const app = p.app;
    const store = new SnapshotStore(`${app.appId}-backup`);
    (p as any).store = store;
    const pending = new Map<string, any>();
    const take = async (file: any) => {
      if (!file || !EXTS.has(file.extension)) return;
      try {
        const data = await app.vault.cachedRead(file);
        const last = await store.latest(file.path);
        if (snapshotDue(last, data, Date.now(), options(p).intervalMinutes)) await store.add({ path: file.path, ts: Date.now(), data });
      } catch (e) {
        console.error("File recovery snapshot failed", e);
      }
    };
    // Debounce per file: changes are snapshotted 2 s after typing stops.
    const schedule = (file: any) => {
      if (!file || !EXTS.has(file.extension)) return;
      clearTimeout(pending.get(file.path));
      pending.set(
        file.path,
        setTimeout(() => {
          pending.delete(file.path);
          void take(file);
        }, 2000),
      );
    };
    p.registerEvent(app.vault.on("modify", schedule));
    p.registerEvent(app.vault.on("create", schedule));
    p.register(() => {
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
    });
    const prune = () => store.prune(Date.now() - options(p).keepDays * 86400000).catch(() => undefined);
    void prune();
    p.registerInterval(window.setInterval(prune, 60 * 60 * 1000));
    p.addCommand({
      id: "file-recovery:open",
      name: "File recovery: Open local history",
      icon: "history",
      callback: () => new FileRecoveryModal(app, store, app.workspace.getActiveFile()?.path ?? null).open(),
    });
    // Obsidian API used by sync before overwriting a file.
    app.fileManager.storeTextFileBackup = async (path: string, data: string) => store.add({ path, ts: Date.now(), data });
    p.register(() => delete app.fileManager.storeTextFileBackup);
    p.instance.forceAdd = (path: string, data: string) => store.add({ path, ts: Date.now(), data });
    p.instance.getBackups = (path: string) => store.forPath(path);
  },
  settingTab: (p) => new RecoveryTab(p, ((p as any).store as SnapshotStore) ?? new SnapshotStore(`${p.app.appId}-backup`)),
};
