// Living under the Toolbay hub.
// Control: `bedrock --show | --hide | --quit` (a second launch forwards its args to the running
// instance via the single-instance lock). `--from-toolbay` marks a hub launch.
// State: `<app data>/running.json` = {pid, version, visible, window, updatedAt, hub}, rewritten on
// every show/hide and removed on quit. App data = %APPDATA%\<appId> (Windows),
// ~/Library/Application Support/<appId> (mac), matching how the hub looks it up.
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";

export function fromHub(argv: string[] = process.argv): boolean {
  return process.env.TOOLBAY_HUB === "1" || argv.includes("--from-toolbay");
}

export function statePath(): string {
  return path.join(app.getPath("userData"), "running.json");
}

export function writeState(win: BrowserWindow | null): void {
  const visible = !!win && !win.isDestroyed() && win.isVisible();
  const v = {
    pid: process.pid,
    version: app.getVersion(),
    visible,
    window: visible ? "shown" : "hidden",
    updatedAt: new Date().toISOString(),
    hub: fromHub(),
  };
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(v));
  } catch {
    /* app data not writable: the hub falls back to its own window check */
  }
}

export function removeState(): void {
  try {
    fs.rmSync(statePath(), { force: true });
  } catch {
    /* ignore */
  }
}

export type HubAction = "show" | "hide" | "quit" | "default";

export function parseHubArgs(argv: string[]): HubAction {
  if (argv.includes("--quit")) return "quit";
  if (argv.includes("--hide")) return "hide";
  if (argv.includes("--show")) return "show";
  return "default";
}

/** A .md path or folder passed on the command line (file association / "open with"). */
export function pathArg(argv: string[]): string | null {
  for (const a of argv.slice(1)) {
    if (a.startsWith("-")) continue;
    if (/\.(md|canvas)$/i.test(a) && fs.existsSync(a)) return path.resolve(a);
  }
  return null;
}
