// Renderer side of the sync IPC (the engine runs in the main process, see main/sync/host.ts).
import { ipcRenderer } from "electron";
import { IPC } from "../../shared/ipc";
import type { SyncContent, SyncKeyInfo, SyncLogEntry, SyncSettings, SyncSnapshot, SyncTrashItem, SyncTurnOnMode, SyncUiEvent, SyncUsage, SyncVersion } from "../../shared/sync";

type Listener = (s: SyncSnapshot) => void;

export class SyncClient {
  snapshot: SyncSnapshot | null = null;
  private listeners = new Set<Listener>();
  private eventListeners = new Set<(e: SyncUiEvent) => void>();

  constructor() {
    ipcRenderer.on(IPC.syncUpdate, (_e, s: SyncSnapshot) => this.set(s));
    ipcRenderer.on(IPC.syncEvent, (_e, ev: SyncUiEvent) => {
      for (const l of this.eventListeners) l(ev);
    });
    void this.call<SyncSnapshot>("state").then((s) => this.set(s), () => {});
  }

  private set(s: SyncSnapshot): void {
    this.snapshot = s;
    for (const l of this.listeners) l(s);
  }

  /** Calls the host; rejects with a plain-language Error. */
  async call<T>(op: string, ...args: any[]): Promise<T> {
    const r = await ipcRenderer.invoke(IPC.syncCall, op, ...args);
    if (!r?.ok) throw new Error(r?.error ?? "Sync is not available.");
    return r.value as T;
  }

  onChange(l: Listener): () => void {
    this.listeners.add(l);
    if (this.snapshot) l(this.snapshot);
    return () => this.listeners.delete(l);
  }

  onEvent(l: (e: SyncUiEvent) => void): () => void {
    this.eventListeners.add(l);
    return () => this.eventListeners.delete(l);
  }

  syncNow = () => this.call("syncNow");
  pause = () => this.call<SyncSnapshot>("pause");
  resume = () => this.call<SyncSnapshot>("resume");
  signIn = () => this.call<string>("signIn");
  keyInfo = () => this.call<SyncKeyInfo>("keyInfo");
  turnOn = (mode: SyncTurnOnMode, passphrase?: string) => this.call<SyncSnapshot>("turnOn", mode, passphrase);
  turnOff = () => this.call<SyncSnapshot>("turnOff");
  dismissMigration = () => this.call<SyncSnapshot>("dismissMigration");
  setSettings = (p: Partial<SyncSettings>) => this.call<SyncSnapshot>("setSettings", p);
  usage = () => this.call<SyncUsage>("usage");
  log = () => this.call<SyncLogEntry[]>("log");
  clearLog = () => this.call<boolean>("clearLog");
  versions = (path: string) => this.call<SyncVersion[]>("versions", path);
  versionContent = (path: string, v: number) => this.call<SyncContent>("versionContent", path, v);
  restoreVersion = (path: string, v: number) => this.call<boolean>("restoreVersion", path, v);
  trash = () => this.call<SyncTrashItem[]>("trash");
  trashContent = (fileId: string, path: string) => this.call<SyncContent>("trashContent", fileId, path);
  restoreTrash = (fileId: string) => this.call<string>("restoreTrash", fileId);
  emptyTrash = (fileIds?: string[]) => this.call<{ freedBytes: number }>("emptyTrash", fileIds);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2).replace(/\.?0+$/, "")} ${u[i]}`;
}

export function formatTime(t: number | null): string {
  if (!t) return "unknown time";
  const d = new Date(t);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" }) + ` ${time}`;
}

/** "Today" / "Yesterday" / "This week" / "Older" group for history lists. */
export function dayGroup(t: number | null): string {
  if (!t) return "Older";
  const d = new Date(t);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (d >= start) return "Today";
  const y = new Date(start);
  y.setDate(start.getDate() - 1);
  if (d >= y) return "Yesterday";
  const w = new Date(start);
  w.setDate(start.getDate() - 6);
  if (d >= w) return "This week";
  return "Older";
}

export function baseName(p: string): string {
  const n = p.slice(p.lastIndexOf("/") + 1);
  return n.endsWith(".md") ? n.slice(0, -3) : n;
}
