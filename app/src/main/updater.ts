// Self-update from GitHub releases (electron-updater). Only in packaged builds. This talks to
// GitHub's release feed only; no analytics or identifiers are sent. Checked at start and every
// hour; downloads in the background (differential, so usually small) and installs on quit, or
// right away when the person clicks "Relaunch to update". "Receive early access versions"
// (Settings › General) also takes pre-releases.
import { app, BrowserWindow, ipcMain } from "electron";
import { readAppSettings } from "./settings-host";
import { flushAllWindows } from "./windows";
import { SHELL_IPC } from "../shared/ipc-shell";

export interface UpdateState {
  status: "idle" | "checking" | "available" | "downloaded" | "none" | "error" | "dev";
  version?: string;
}

let state: UpdateState = { status: app.isPackaged ? "idle" : "dev" };
let updater: any = null;

function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(SHELL_IPC.updateState, state);
}

function getUpdater(): any {
  if (updater) return updater;
  const { autoUpdater } = require("electron-updater") as typeof import("electron-updater");
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on("checking-for-update", () => ((state = { status: "checking" }), broadcast()));
  autoUpdater.on("update-available", (i: any) => ((state = { status: "available", version: i?.version }), broadcast()));
  autoUpdater.on("update-not-available", () => ((state = { status: "none" }), broadcast()));
  autoUpdater.on("update-downloaded", (i: any) => ((state = { status: "downloaded", version: i?.version }), broadcast()));
  autoUpdater.on("error", () => ((state = { status: "error" }), broadcast()));
  updater = autoUpdater;
  return updater;
}

export function startAutoUpdate(): void {
  if (!app.isPackaged || process.env.BEDROCK_NO_UPDATE === "1" || readAppSettings().updateDisabled) return;
  try {
    const u = getUpdater();
    u.allowPrerelease = !!readAppSettings().earlyAccess;
    const check = () => u.checkForUpdates().catch(() => undefined);
    check();
    setInterval(check, 60 * 60 * 1000).unref();
  } catch {
    /* updater unavailable (e.g. portable build) */
  }
}

export async function checkNow(): Promise<string> {
  if (!app.isPackaged) return "Updates are only checked in installed builds.";
  try {
    const u = getUpdater();
    u.allowPrerelease = !!readAppSettings().earlyAccess;
    const r = await u.checkForUpdates();
    const v = r?.updateInfo?.version;
    return v && isNewerVersion(v, app.getVersion()) ? `Downloading version ${v}. It installs when you quit, or relaunch to update now.` : "You're on the latest version.";
  } catch {
    return "Couldn't check for updates right now. Check your connection and try again.";
  }
}

/** a > b by semver (x.y.z, a release beats its own pre-releases). */
export function isNewerVersion(a: string, b: string): boolean {
  const parse = (v: string) => {
    const [core, pre = ""] = String(v).trim().replace(/^v/i, "").split("+")[0].split(/-(.*)/s);
    return { nums: core.split(".").map((n) => parseInt(n, 10) || 0), pre: pre ? pre.split(".") : [] };
  };
  const x = parse(a),
    y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.nums[i] ?? 0) !== (y.nums[i] ?? 0)) return (x.nums[i] ?? 0) > (y.nums[i] ?? 0);
  if (!x.pre.length || !y.pre.length) return !x.pre.length && !!y.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i],
      q = y.pre[i];
    if (p === undefined || q === undefined) return q === undefined;
    if (p === q) continue;
    const pn = /^\d+$/.test(p),
      qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) > Number(q);
    if (pn !== qn) return qn; // numeric identifiers sort before text ones
    return p > q;
  }
  return false;
}

export function registerUpdaterIpc(): void {
  ipcMain.handle(SHELL_IPC.updateState, () => state);
  ipcMain.handle(SHELL_IPC.installUpdate, () => {
    if (state.status !== "downloaded" || !updater) return false;
    // Write unsaved edits before the updater closes the windows.
    void flushAllWindows().then(() => updater.quitAndInstall(false, true));
    return true;
  });
}
