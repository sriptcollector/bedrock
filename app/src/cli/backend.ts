// Where the CLI and the stdio MCP server send each operation:
//  - the running app (its local REST API, token from app data), so edits show live in open
//    editors and go through the app's vault code; or
//  - the vault folder on disk, when the app isn't running (the app's watcher and the sync engine
//    pick the change up later).
// Checked again on every call (cached for 2 s), so a long MCP session follows the app starting or
// quitting. No Electron imports.
import path from "node:path";
import fs from "node:fs";
import { AgentError, AgentOps } from "../core/agent-ops";
import { runTool } from "../main/agents/tools";
import { appDataDir, findMainVault, loadSettings, readRunning, sameDir } from "../main/agents/settings";
import { BRAND } from "../shared/brand";

declare const __APP_VERSION__: string;
export const VERSION: string = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

export interface BackendOptions {
  /** Explicit vault folder (--vault or BEDROCK_VAULT). */
  vault?: string;
  dataDir?: string;
  /** Never talk to the running app (tests, --offline). */
  diskOnly?: boolean;
}

export type Mode = "app" | "disk";

export class Backend {
  readonly dataDir: string;
  readonly vaultPath: string;
  private ops: AgentOps | null = null;
  private appCheck: { at: number; url: string | null; token: string | null } = { at: 0, url: null, token: null };
  lastMode: Mode = "disk";

  constructor(private o: BackendOptions = {}) {
    this.dataDir = o.dataDir ?? appDataDir();
    const explicit = o.vault ?? process.env.BEDROCK_VAULT;
    const running = readRunning(this.dataDir);
    this.vaultPath = path.resolve(explicit || running?.vaultPath || findMainVault(this.dataDir));
  }

  /** Is agent access switched on in Settings? (The stdio MCP server refuses to work when it's off.) */
  enabled(): boolean {
    return loadSettings(this.dataDir)?.enabled !== false;
  }

  private disk(): AgentOps {
    if (!fs.existsSync(this.vaultPath)) throw new AgentError("not_found", `The vault folder “${this.vaultPath}” doesn't exist. Open ${BRAND.displayName} once to create it, or pass --vault <folder>.`);
    this.ops ??= new AgentOps({ vaultPath: this.vaultPath });
    return this.ops;
  }

  /** The running app's REST base URL and token, or null. */
  private async app(): Promise<{ url: string; token: string } | null> {
    if (this.o.diskOnly) return null;
    if (Date.now() - this.appCheck.at < 2000) return this.appCheck.url && this.appCheck.token ? { url: this.appCheck.url, token: this.appCheck.token } : null;
    this.appCheck = { at: Date.now(), url: null, token: null };
    const running = readRunning(this.dataDir);
    const settings = loadSettings(this.dataDir);
    if (!running || !settings?.enabled || !sameDir(running.vaultPath, this.vaultPath)) return null;
    const url = `http://127.0.0.1:${running.port}`;
    try {
      const r = await fetch(url + "/v1/status", { headers: { authorization: `Bearer ${settings.token}` }, signal: AbortSignal.timeout(1500) });
      if (!r.ok) return null;
    } catch {
      return null;
    }
    this.appCheck = { at: Date.now(), url, token: settings.token };
    return { url, token: settings.token };
  }

  async mode(): Promise<Mode> {
    return (await this.app()) ? "app" : "disk";
  }

  /** Run one tool. */
  async call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const app = await this.app();
    if (app) {
      let r: Response;
      try {
        r = await fetch(`${app.url}/v1/tools/${name}`, {
          method: "POST",
          headers: { authorization: `Bearer ${app.token}`, "content-type": "application/json" },
          body: JSON.stringify(args ?? {}),
          signal: AbortSignal.timeout(60_000),
        });
      } catch {
        // The app went away between the check and the call: fall back to the folder.
        this.appCheck.at = 0;
        return this.callDisk(name, args);
      }
      this.lastMode = "app";
      const body: any = await r.json().catch(() => ({}));
      if (!r.ok) throw new AgentError(codeOf(body?.error), body?.message ?? `The app answered ${r.status}.`);
      return body;
    }
    return this.callDisk(name, args);
  }

  private callDisk(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.lastMode = "disk";
    return runTool(this.disk(), name, args);
  }
}

function codeOf(s: unknown): any {
  return ["bad_request", "not_found", "exists", "forbidden", "unavailable", "disabled"].includes(String(s)) ? s : "unavailable";
}
