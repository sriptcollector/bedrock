// Self-update from GitHub releases (electron-updater). Only in packaged builds. This talks to
// GitHub's release feed only; no analytics or identifiers are sent.
import { app } from "electron";

export function startAutoUpdate(): void {
  if (!app.isPackaged || process.env.BEDROCK_NO_UPDATE === "1") return;
  try {
    const { autoUpdater } = require("electron-updater") as typeof import("electron-updater");
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;
    const check = () => autoUpdater.checkForUpdates().catch(() => undefined);
    check();
    setInterval(check, 6 * 60 * 60 * 1000).unref();
  } catch {
    /* updater unavailable (e.g. portable build) */
  }
}

export async function checkNow(): Promise<string> {
  if (!app.isPackaged) return "Updates are only checked in installed builds.";
  try {
    const { autoUpdater } = require("electron-updater") as typeof import("electron-updater");
    const r = await autoUpdater.checkForUpdates();
    const v = r?.updateInfo?.version;
    return v && v !== app.getVersion() ? `Downloading version ${v}. It installs when you quit.` : "You're on the latest version.";
  } catch (e: any) {
    return "Couldn't check for updates right now. Check your connection and try again.";
  }
}
