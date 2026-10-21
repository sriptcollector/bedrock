// The sync host: runs packages/sync's SyncEngine for the one vault in the main process.
//
// - Starts by itself when a Toolbay sign-in exists (the hub's keychain session or the
//   TOOLBAY_TOKEN it launched us with, see ../account.ts) and stops on sign-out. The token is
//   re-read every few seconds, so a sign-in, sign-out or new token in the hub is picked up live.
// - Vault key: obtainVaultKey (Toolbay account escrow + OS keychain ai.toolbay.bedrock/vault-key).
//   Fetched only after the sync service answered, so nothing is written to the account while the
//   service is unreachable.
// - Per-computer settings (pause, device name, selective sync) live in <userData>/sync/settings.json,
//   the activity log in <userData>/sync/log.json, the engine state in <userData>/sync/state-<id>/.
// - The renderer talks to it over IPC.syncCall ({op, ...}) and listens to IPC.syncUpdate / syncEvent.
import { app, BrowserWindow, ipcMain, shell } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_SERVER_URL,
  EMPTY_VAULT_MESSAGE,
  KEYCHAIN_ACCOUNT,
  KEYCHAIN_SERVICE,
  SyncEngine,
  SyncError,
  obtainVaultKey,
  type SyncStatus,
} from "../../../../packages/sync/src/index";
import * as account from "../account";
import { IPC } from "../../shared/ipc";
import {
  DEFAULT_SYNC_SETTINGS,
  type SyncAccount,
  type SyncContent,
  type SyncLogEntry,
  type SyncSettings,
  type SyncSnapshot,
  type SyncUiEvent,
  type SyncUiStatus,
  type SyncUsage,
} from "../../shared/sync";
import { excludeRule } from "./selective";
import { keychainGet, keychainSet } from "./keychain";
import { WELCOME_NOTE } from "../vaults";

const TOKEN_POLL_MS = 4000;
const LOG_MAX = 1000;
const RECENT_MS = 2 * 60_000;
const TEXT_EXT = /\.(md|txt|canvas|base|json|css|js|mjs|csv|tsv|html?|svg|ya?ml|xml|tex|org|rst|ini|log)$/i;

export interface SyncHostOptions {
  vaultPath: string;
  /** false = never sync (smoke tests without a sync server). */
  enabled: boolean;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export class SyncHost {
  readonly vaultPath: string;
  private readonly enabled: boolean;
  private readonly dir: string;
  private readonly serverUrl: string;
  private readonly toolbayApi: string;
  private settings: SyncSettings;
  private engine: SyncEngine | null = null;
  private engineStarted = false;
  private engineStatus: SyncStatus | null = null;
  private token: string | null = null;
  private acct: SyncAccount | null = null;
  private key: Uint8Array | null = null;
  private usage: SyncUsage | null = null;
  private serverDown = false;
  private log: SyncLogEntry[] = [];
  private logTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private pushTimer: NodeJS.Timeout | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private mergeNoticePending = false;
  private hubInstalledCache: boolean | null = null;
  private closed = false;
  private recent: Array<{ time: number; ev: SyncUiEvent }> = [];

  constructor(o: SyncHostOptions) {
    this.vaultPath = path.resolve(o.vaultPath);
    this.enabled = o.enabled;
    this.dir = path.join(app.getPath("userData"), "sync");
    this.serverUrl = (process.env.BEDROCK_SYNC_URL || DEFAULT_SERVER_URL).replace(/\/+$/, "");
    this.toolbayApi = (process.env.TOOLBAY_API_BASE || "https://toolbay.ai").replace(/\/+$/, "");
    fs.mkdirSync(this.dir, { recursive: true });
    this.settings = this.readSettings();
    this.log = this.readJson<SyncLogEntry[]>("log.json", []).slice(-LOG_MAX);
  }

  // ------------------------------------------------------------------ lifecycle

  start(): void {
    ipcMain.handle(IPC.syncCall, async (_e, op: string, ...args: any[]) => this.call(op, args));
    if (!this.enabled) return;
    void this.checkToken();
    this.pollTimer = setInterval(() => void this.checkToken(), TOKEN_POLL_MS);
    this.pollTimer.unref?.();
  }

  async stop(): Promise<void> {
    this.closed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.flushLog();
    await this.serial(() => this.stopEngine());
  }

  /** Runs engine start/stop steps one after another. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p;
  }

  private async checkToken(): Promise<void> {
    const t = account.token();
    if (t === this.token) return;
    const hadToken = this.token !== null;
    this.token = t;
    this.key = null;
    this.acct = null;
    this.usage = null;
    if (t) void this.loadAccount(t);
    if (!t && hadToken) this.addLog({ time: Date.now(), action: "info", path: "", message: "Signed out of Toolbay. Sync stopped." });
    await this.serial(() => this.restartEngine());
  }

  private async loadAccount(t: string): Promise<void> {
    const a = await account.account();
    if (this.token !== t) return;
    this.acct = a ? { name: a.name, handle: a.handle, email: a.email } : null;
    this.pushUpdate();
  }

  private async stopEngine(): Promise<void> {
    const e = this.engine;
    this.engine = null;
    this.engineStarted = false;
    this.engineStatus = null;
    if (e) {
      e.removeAllListeners();
      await e.stop().catch(() => {});
    }
    this.pushUpdate();
  }

  private async restartEngine(): Promise<void> {
    await this.stopEngine();
    if (!this.enabled || !this.token || this.closed) return;
    const stateDir = path.join(this.dir, "state-" + crypto.createHash("sha256").update(this.vaultPath.toLowerCase()).digest("hex").slice(0, 16));
    const firstRun = !fs.existsSync(path.join(stateDir, "sync-state.json"));
    const e = new SyncEngine({
      vaultPath: this.vaultPath,
      stateDir,
      serverUrl: this.serverUrl,
      getToken: async () => account.token(),
      getVaultKey: () => this.vaultKey(),
      deviceId: this.deviceId(),
      deviceName: this.deviceName(),
      exclude: excludeRule(this.settings),
      // The editor already waits for 2 s of quiet before it saves, so the engine needs only a short
      // pause after a save (versions still can't pile up faster than the editor saves).
      debounceMs: process.env.BEDROCK_SYNC_DEBOUNCE_MS ? Number(process.env.BEDROCK_SYNC_DEBOUNCE_MS) : 400,
      log: process.env.BEDROCK_SYNC_DEBUG ? (m) => console.log("[sync]", m) : undefined,
    });
    this.engine = e;
    e.on("status", (s: SyncStatus) => this.onStatus(s));
    e.on("file", (f: { path: string; action: SyncLogEntry["action"]; from?: string }) =>
      this.addLog({ time: Date.now(), action: f.action, path: f.path, from: f.from }),
    );
    e.on("conflict", (c: { path: string; conflictPath: string }) => {
      this.addLog({ time: Date.now(), action: "conflict", path: c.path, from: c.conflictPath });
      this.send({ type: "conflict", path: c.path, conflictPath: c.conflictPath });
    });
    e.on("error", (x: { path: string; message: string }) => this.addLog({ time: Date.now(), action: "error", path: x.path, message: x.message }));
    if (this.settings.paused) {
      this.pushUpdate();
      return;
    }
    if (firstRun) await this.prepareFirstRun(e);
    if (this.engine !== e) return;
    this.engineStarted = true;
    await e.start();
    this.pushUpdate();
  }

  /**
   * First sync of this computer. If the account already has notes: the untouched welcome note and
   * the empty settings file this computer made on its first start step aside (the account's copies
   * come down instead of conflict copies), and if the person had their own notes here we say once
   * that both sets were combined.
   */
  private async prepareFirstRun(e: SyncEngine): Promise<void> {
    let seq = 0;
    try {
      await this.probeServer();
      seq = (await e.api.vault()).seq;
    } catch {
      return; // offline: the engine copes (worst case a conflict copy of the welcome note)
    }
    if (seq === 0) return;
    const pristine: Array<[string, string]> = [
      ["Welcome.md", WELCOME_NOTE],
      [path.join(".obsidian", "app.json"), "{}\n"],
    ];
    for (const [rel, content] of pristine) {
      const p = path.join(this.vaultPath, rel);
      try {
        if (fs.readFileSync(p, "utf8") === content) fs.unlinkSync(p);
      } catch {
        /* not there */
      }
    }
    this.mergeNoticePending = countNotes(this.vaultPath) > 0;
  }

  private async probeServer(): Promise<void> {
    try {
      const r = await fetch(`${this.serverUrl}/healthz`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this.serverDown = false;
    } catch (err: any) {
      this.serverDown = true;
      throw new SyncError(`Cannot reach the sync service (${err?.message ?? err})`, "network");
    }
  }

  private async vaultKey(): Promise<Uint8Array> {
    if (this.key) return this.key;
    await this.probeServer();
    const t = account.token();
    if (!t) throw new SyncError("Sign in to Toolbay to sync.", "auth");
    this.key = await obtainVaultKey({
      toolbayApi: this.toolbayApi,
      token: t,
      keychain: {
        get: async () => keychainGet(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT),
        set: async (v) => keychainSet(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, v),
      },
    });
    return this.key;
  }

  private onStatus(s: SyncStatus): void {
    const prev = this.engineStatus;
    this.engineStatus = s;
    if (s.state === "synced") {
      this.serverDown = false;
      if (this.mergeNoticePending) {
        this.mergeNoticePending = false;
        this.send({
          type: "notice",
          message:
            "The notes on this computer were combined with the notes already in your Toolbay account. Nothing was replaced; where two different notes had the same name, both were kept.",
        });
        this.addLog({ time: Date.now(), action: "info", path: "", message: "First sync on this computer: combined this computer's notes with the account's notes." });
      }
    }
    if (s.state === "offline" && prev?.state !== "offline") void this.probeServer().catch(() => {});
    if (s.state === "error" && prev?.message !== s.message) this.addLog({ time: Date.now(), action: "error", path: "", message: cleanMessage(s.message) });
    this.pushUpdate();
  }

  // ------------------------------------------------------------------ snapshot

  private hubInstalled(): boolean {
    if (this.hubInstalledCache === null) {
      try {
        this.hubInstalledCache = process.env.BEDROCK_HUB_INSTALLED ? process.env.BEDROCK_HUB_INSTALLED === "1" : app.getApplicationNameForProtocol("toolbay://") !== "";
      } catch {
        this.hubInstalledCache = false;
      }
    }
    return this.hubInstalledCache;
  }

  snapshot(): SyncSnapshot {
    const s = this.engineStatus;
    let status: SyncUiStatus;
    let message: string;
    if (!this.enabled) {
      status = "disabled";
      message = "Sync is off for this window.";
    } else if (!this.token) {
      status = "signed-out";
      message = "Not signed in. Sign in to Toolbay to sync this vault to your other computers.";
    } else if (this.settings.paused) {
      status = "paused";
      message = "Sync is paused. Changes are saved on this computer and sync when you resume.";
    } else if (!s || s.state === "off" || s.state === "connecting") {
      status = "connecting";
      message = "Connecting…";
    } else if (s.state === "offline") {
      status = "offline";
      message = this.serverDown
        ? "Can't reach the sync service right now. Your notes are saved on this computer and will sync as soon as it's back."
        : s.message;
    } else {
      status = s.state;
      message = cleanMessage(s.message);
    }
    return {
      status,
      message,
      errorKind: s?.errorKind ?? (s?.message.includes(EMPTY_VAULT_MESSAGE) ? "empty" : undefined),
      signedIn: !!this.token,
      hubInstalled: this.hubInstalled(),
      account: this.acct,
      pendingUploads: s?.pendingUploads ?? 0,
      pendingDownloads: s?.pendingDownloads ?? 0,
      lastSyncedAt: s?.lastSyncedAt ?? null,
      deviceName: this.deviceName(),
      computerName: os.hostname(),
      vaultPath: this.vaultPath,
      usage: this.usage,
      settings: this.settings,
    };
  }

  private pushUpdate(): void {
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      const snap = this.snapshot();
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.syncUpdate, snap);
    }, 50);
  }

  private send(ev: SyncUiEvent): void {
    if (ev.type !== "log") {
      // kept for a while so a window that loads a moment later still shows it (see "recentEvents")
      ev.id = crypto.randomUUID();
      this.recent = [...this.recent.filter((r) => Date.now() - r.time < RECENT_MS), { time: Date.now(), ev }];
    }
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.syncEvent, ev);
  }

  // ------------------------------------------------------------------ renderer calls

  private async call(op: string, args: any[]): Promise<Result<any>> {
    try {
      return { ok: true, value: await this.dispatch(op, args) };
    } catch (e: any) {
      return { ok: false, error: cleanMessage(e?.message ?? String(e)) };
    }
  }

  private needEngine(): SyncEngine {
    if (!this.token) throw new Error("Sign in to Toolbay to use sync.");
    if (!this.engine) throw new Error("Sync is starting. Try again in a moment.");
    return this.engine;
  }

  private async dispatch(op: string, a: any[]): Promise<unknown> {
    switch (op) {
      case "state":
        return this.snapshot();
      case "signIn":
        return this.signIn();
      case "syncNow": {
        if (!this.engineStarted) throw new Error(this.snapshot().message);
        return cleanStatus(await this.needEngine().syncNow());
      }
      case "pause":
      case "resume":
        this.settings.paused = op === "pause";
        this.writeSettings();
        this.addLog({ time: Date.now(), action: "info", path: "", message: op === "pause" ? "Sync paused." : "Sync resumed." });
        await this.serial(() => this.restartEngine());
        return this.snapshot();
      case "setSettings":
        return this.setSettings(a[0] as Partial<SyncSettings>);
      case "usage": {
        this.usage = await this.needEngine().usage();
        this.pushUpdate();
        return this.usage;
      }
      case "log":
        return this.log;
      case "recentEvents":
        return this.recent.filter((r) => Date.now() - r.time < RECENT_MS).map((r) => r.ev);
      case "clearLog":
        this.log = [];
        this.saveLogSoon();
        return true;
      case "versions":
        return this.needEngine().listVersions(a[0]);
      case "versionContent":
        return toContent(a[0], await this.needEngine().versionContent(a[0], a[1]));
      case "restoreVersion":
        await this.needEngine().restoreVersion(a[0], a[1]);
        this.addLog({ time: Date.now(), action: "info", path: a[0], message: `Restored an earlier version.` });
        return true;
      case "trash":
        return this.needEngine().listTrash();
      case "trashContent":
        return toContent(a[1] ?? "", await this.needEngine().trashContent(a[0]));
      case "restoreTrash": {
        const p = await this.needEngine().restoreFromTrash(a[0]);
        this.addLog({ time: Date.now(), action: "info", path: p, message: "Restored from deleted files." });
        return p;
      }
      case "emptyTrash": {
        const r = await this.needEngine().emptyTrash(a[0]);
        this.addLog({ time: Date.now(), action: "info", path: "", message: "Emptied the deleted files." });
        this.usage = await this.needEngine().usage().catch(() => this.usage);
        this.pushUpdate();
        return r;
      }
      default:
        throw new Error(`Unknown sync call ${op}`);
    }
  }

  private async signIn(): Promise<string> {
    if (this.hubInstalled()) {
      await shell.openExternal("toolbay://signin");
      return "hub";
    }
    await shell.openExternal(`${this.toolbayApi}/download`);
    return "download";
  }

  private async setSettings(patch: Partial<SyncSettings>): Promise<SyncSnapshot> {
    const before = this.settings;
    const next: SyncSettings = {
      ...before,
      ...patch,
      config: { ...before.config, ...(patch.config ?? {}) },
      excludedFolders: patch.excludedFolders ? [...new Set(patch.excludedFolders.map((f) => f.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")).filter(Boolean))] : before.excludedFolders,
    };
    this.settings = next;
    this.writeSettings();
    if (patch.paused !== undefined && patch.paused !== before.paused) {
      await this.serial(() => this.restartEngine());
    } else if (patch.deviceName !== undefined && patch.deviceName !== before.deviceName) {
      await this.serial(() => this.restartEngine());
    } else {
      this.engine?.setExclude(excludeRule(next));
    }
    this.pushUpdate();
    return this.snapshot();
  }

  // ------------------------------------------------------------------ files

  private deviceName(): string {
    return this.settings.deviceName.trim() || os.hostname();
  }

  private deviceId(): string {
    const f = path.join(this.dir, "device.json");
    const cur = this.readJson<{ deviceId?: string }>("device.json", {});
    if (cur.deviceId) return cur.deviceId;
    const id = crypto.randomUUID();
    fs.writeFileSync(f, JSON.stringify({ deviceId: id, createdAt: Date.now() }, null, 2));
    return id;
  }

  private readJson<T>(name: string, fallback: T): T {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir, name), "utf8"));
    } catch {
      return fallback;
    }
  }

  private writeJson(name: string, v: unknown): void {
    const f = path.join(this.dir, name);
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
    fs.renameSync(tmp, f);
  }

  private readSettings(): SyncSettings {
    const v = this.readJson<Partial<SyncSettings>>("settings.json", {});
    return {
      ...DEFAULT_SYNC_SETTINGS,
      ...v,
      config: { ...DEFAULT_SYNC_SETTINGS.config, ...(v.config ?? {}) },
      excludedFolders: Array.isArray(v.excludedFolders) ? v.excludedFolders.filter((x) => typeof x === "string") : [],
    };
  }

  private writeSettings(): void {
    this.writeJson("settings.json", this.settings);
  }

  private addLog(e: SyncLogEntry): void {
    this.log.push(e);
    if (this.log.length > LOG_MAX * 1.2) this.log = this.log.slice(-LOG_MAX);
    this.send({ type: "log", entry: e });
    this.saveLogSoon();
  }

  private saveLogSoon(): void {
    if (this.logTimer) return;
    this.logTimer = setTimeout(() => this.flushLog(), 2000);
    this.logTimer.unref?.();
  }

  private flushLog(): void {
    if (this.logTimer) clearTimeout(this.logTimer);
    this.logTimer = null;
    try {
      this.writeJson("log.json", this.log.slice(-LOG_MAX));
    } catch {
      /* best effort */
    }
  }
}

function cleanMessage(m: string): string {
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, "").replace(/^Sync problem: (?=The vault folder)/, "");
}

function cleanStatus(s: SyncStatus): SyncStatus {
  return { ...s, message: cleanMessage(s.message) };
}

function toContent(p: string, data: Buffer): SyncContent {
  const isText = TEXT_EXT.test(p) && data.length <= 4 * 1024 * 1024;
  if (!isText) return { text: null, size: data.length };
  const text = data.toString("utf8");
  return { text: text.includes("�") ? null : text, size: data.length };
}

/** Number of user files in the vault (everything except the settings folder). */
function countNotes(dir: string): number {
  let n = 0;
  const walk = (d: string, depth: number) => {
    if (depth > 30 || n > 0) return;
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (e.name.startsWith(".")) continue;
      if (e.isFile()) n++;
      else if (e.isDirectory()) walk(path.join(d, e.name), depth + 1);
      if (n > 0) return;
    }
  };
  walk(dir, 0);
  return n;
}
