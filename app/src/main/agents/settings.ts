// Agent access settings and discovery files, all in the app data folder (never in the vault, never
// synced). No Electron imports: the CLI and the stdio MCP server read the same files.
//
//   <app data>/agents/settings.json  {enabled, token, port}       (token: 0600 on macOS/Linux)
//   <app data>/agents/running.json   {pid, port, vaultPath, version, startedAt}  while the app serves
//
// <app data> = BEDROCK_USER_DATA, else %APPDATA%\<appId> (Windows),
// ~/Library/Application Support/<appId> (macOS), $XDG_CONFIG_HOME/<appId> or ~/.config/<appId>.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BRAND } from "../../shared/brand";

export const DEFAULT_PORT = 27125;

export interface AgentSettings {
  enabled: boolean;
  token: string;
  port: number;
}

export interface RunningInfo {
  pid: number;
  port: number;
  vaultPath: string;
  version: string;
  startedAt: string;
}

export function appDataDir(): string {
  if (process.env.BEDROCK_USER_DATA) return path.resolve(process.env.BEDROCK_USER_DATA);
  const home = os.homedir();
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), BRAND.appId);
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", BRAND.appId);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), BRAND.appId);
}

const dirOf = (dataDir: string) => path.join(dataDir, "agents");
export const settingsPath = (dataDir: string) => path.join(dirOf(dataDir), "settings.json");
export const runningPath = (dataDir: string) => path.join(dirOf(dataDir), "running.json");

export function newToken(): string {
  return "bdk_" + crypto.randomBytes(32).toString("base64url");
}

function writePrivate(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
  if (process.platform !== "win32") fs.chmodSync(file, 0o600);
}

/** Read the settings. `create` makes the file (with a new token) on first run: only the app does that. */
export function loadSettings(dataDir: string, create = false): AgentSettings | null {
  let raw: any = null;
  try {
    raw = JSON.parse(fs.readFileSync(settingsPath(dataDir), "utf8"));
  } catch {
    /* first run */
  }
  if (!raw && !create) return null;
  const s: AgentSettings = {
    enabled: raw?.enabled !== false, // on by default
    token: typeof raw?.token === "string" && raw.token.length >= 32 ? raw.token : newToken(),
    port: Number.isInteger(raw?.port) && raw.port > 0 && raw.port < 65536 ? raw.port : DEFAULT_PORT,
  };
  if (create && (!raw || raw.token !== s.token || raw.port !== s.port || raw.enabled !== s.enabled)) saveSettings(dataDir, s);
  return s;
}

export function saveSettings(dataDir: string, s: AgentSettings): void {
  writePrivate(settingsPath(dataDir), JSON.stringify(s, null, 2) + "\n");
}

export function writeRunning(dataDir: string, r: RunningInfo): void {
  writePrivate(runningPath(dataDir), JSON.stringify(r, null, 2) + "\n");
}

export function removeRunning(dataDir: string): void {
  try {
    const cur = JSON.parse(fs.readFileSync(runningPath(dataDir), "utf8"));
    if (cur?.pid && cur.pid !== process.pid) return; // someone else's
  } catch {
    /* nothing there */
  }
  fs.rmSync(runningPath(dataDir), { force: true });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === "EPERM";
  }
}

/** The running app's agent server, if there is one (stale files from a crash are ignored). */
export function readRunning(dataDir: string): RunningInfo | null {
  try {
    const r = JSON.parse(fs.readFileSync(runningPath(dataDir), "utf8")) as RunningInfo;
    if (!r?.pid || !r.port || !alive(r.pid)) return null;
    return r;
  } catch {
    return null;
  }
}

/**
 * Which vault the CLI / stdio server works on when the app isn't running: the main vault from
 * <app data>/vaults.json (the app writes it on first start), else Documents/<vault folder name>.
 */
export function findMainVault(dataDir: string): string {
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(dataDir, "vaults.json"), "utf8"));
    if (typeof reg?.main === "string" && reg.main) return reg.main;
  } catch {
    /* app never ran */
  }
  const home = os.homedir();
  const candidates = [path.join(home, "Documents", BRAND.vaultFolderName), path.join(home, "OneDrive", "Documents", BRAND.vaultFolderName)];
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0];
}

export function sameDir(a: string, b: string): boolean {
  const n = (p: string) => path.resolve(p).replace(/[\\/]+$/, "");
  return process.platform === "win32" || process.platform === "darwin" ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
}
