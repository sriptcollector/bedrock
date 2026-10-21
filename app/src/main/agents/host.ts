// Agent access inside the running app (main process): the local HTTP server (MCP at /mcp, REST at
// /v1), the bridge to the main window's vault (writes go through app.vault so open editors update
// live), the settings IPC used by Settings › Connect an AI agent, and the "Connect" buttons.
import { app, BrowserWindow, dialog, ipcMain, type WebContents } from "electron";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentError, AgentOps, DiskWriter, type AppHooks, type VaultWriter } from "../../core/agent-ops";
import { BRAND } from "../../shared/brand";
import { IPC } from "../../shared/ipc";
import { log } from "../log";
import { clientStates, connectClient, disconnectClient, snippets, type ClientId, type LaunchCommand } from "./clients";
import { AgentHttpServer } from "./http";
import { DEFAULT_PORT, loadSettings, newToken, removeRunning, saveSettings, writeRunning, type AgentSettings } from "./settings";
import { runTool } from "./tools";

export interface AgentState {
  enabled: boolean;
  running: boolean;
  error: string | null;
  port: number | null;
  mcpUrl: string | null;
  restUrl: string | null;
  token: string;
  vaultPath: string;
  launch: LaunchCommand;
  clients: ReturnType<typeof clientStates>;
  snippets: ReturnType<typeof snippets>;
  cli: { installed: boolean; location: string | null; canInstall: boolean };
  appConnected: boolean;
}

/** How an MCP client starts us: the app's own executable with --mcp (dev: electron <appDir> --mcp). */
export function mcpLaunchCommand(): LaunchCommand {
  if (app.isPackaged) return { command: process.execPath, args: ["--mcp"] };
  return { command: process.execPath, args: [app.getAppPath(), "--mcp"] };
}

/** The bundled CLI script (inside app.asar when packaged). */
function cliScript(): string {
  return path.join(app.getAppPath(), "dist", "cli.js");
}

export class AgentHost {
  private settings: AgentSettings;
  private server: AgentHttpServer | null = null;
  private error: string | null = null;
  readonly ops: AgentOps;
  private bridge: WebContents | null = null;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void; timer: NodeJS.Timeout }>();
  private disk: DiskWriter;

  constructor(
    private o: { vaultPath: string; dataDir: string; version: string; showMain: () => void },
  ) {
    this.settings = loadSettings(o.dataDir, true)!;
    this.disk = new DiskWriter(o.vaultPath);
    const writer: VaultWriter = {
      write: (p, text) => (this.bridge ? this.ask("write", { path: p, text }) : this.disk.write(p, text)),
      rename: (from, to) => (this.bridge ? this.ask("rename", { from, to }) : this.disk.rename(from, to)),
      trash: (p) => (this.bridge ? this.ask("trash", { path: p }) : this.disk.trash(p)),
    };
    const hooks: AppHooks = {
      activeNote: async () => {
        if (!this.bridge) throw new AgentError("unavailable", `The ${BRAND.displayName} window isn't ready yet. Try again in a moment.`);
        return this.ask("active", {});
      },
      open: async (p, opts) => {
        if (!this.bridge) throw new AgentError("unavailable", `The ${BRAND.displayName} window isn't ready yet. Try again in a moment.`);
        this.o.showMain();
        await this.ask("open", { path: p, ...opts });
      },
    };
    this.ops = new AgentOps({ vaultPath: o.vaultPath, writer, app: hooks });
  }

  async start(): Promise<void> {
    this.registerIpc();
    if (this.settings.enabled) await this.startServer();
  }

  async stop(): Promise<void> {
    await this.stopServer();
  }

  // ---------------- server

  private async startServer(): Promise<void> {
    if (this.server) return;
    const server = new AgentHttpServer({
      call: (name, args) => runTool(this.ops, name, args),
      getToken: () => this.settings.token,
      version: this.o.version,
      status: () => ({ app: BRAND.name, vault: path.basename(this.o.vaultPath), appConnected: !!this.bridge }),
    });
    const envPort = process.env.BEDROCK_AGENT_PORT;
    const want = envPort !== undefined && envPort !== "" ? Number(envPort) : this.settings.port;
    let port: number;
    try {
      port = await server.listen(want);
    } catch (e: any) {
      if (e?.code !== "EADDRINUSE" && e?.code !== "EACCES") {
        this.error = `Couldn't start the local agent server: ${e?.message ?? e}`;
        log("error", this.error);
        return;
      }
      try {
        port = await server.listen(0);
      } catch (e2: any) {
        this.error = `Couldn't start the local agent server: ${e2?.message ?? e2}`;
        log("error", this.error);
        return;
      }
      // Keep the new port from now on so HTTP setups stay valid.
      if (envPort === undefined) {
        this.settings.port = port;
        saveSettings(this.o.dataDir, this.settings);
      }
      log("info", `agent server: port ${want} was taken, using ${port}`);
    }
    this.server = server;
    this.error = null;
    writeRunning(this.o.dataDir, { pid: process.pid, port, vaultPath: this.o.vaultPath, version: this.o.version, startedAt: new Date().toISOString() });
    log("info", `agent server on 127.0.0.1:${port}`);
  }

  private async stopServer(): Promise<void> {
    const s = this.server;
    this.server = null;
    removeRunning(this.o.dataDir);
    if (s) await s.close();
  }

  // ---------------- bridge to the main window's vault

  private ask(op: string, args: Record<string, unknown>): Promise<any> {
    const wc = this.bridge;
    if (!wc || wc.isDestroyed()) {
      this.bridge = null;
      // Window gone: do it on disk.
      if (op === "write") return this.disk.write(args.path as string, args.text as string);
      if (op === "rename") return this.disk.rename(args.from as string, args.to as string);
      if (op === "trash") return this.disk.trash(args.path as string);
      return Promise.reject(new AgentError("unavailable", `The ${BRAND.displayName} window isn't open.`));
    }
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AgentError("unavailable", `The ${BRAND.displayName} window didn't answer in time. Try again.`));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      wc.send(IPC.agentRequest, { id, op, args });
    });
  }

  private registerIpc(): void {
    ipcMain.on(IPC.agentBridgeReady, (e, info: { vaultPath: string }) => {
      if (!info?.vaultPath || path.resolve(info.vaultPath).toLowerCase() !== path.resolve(this.o.vaultPath).toLowerCase()) return;
      this.bridge = e.sender;
      e.sender.once("destroyed", () => {
        if (this.bridge === e.sender) this.bridge = null;
      });
    });
    ipcMain.on(IPC.agentResponse, (_e, r: { id: string; ok: boolean; value?: any; error?: { code: string; message: string } }) => {
      const p = this.pending.get(r?.id);
      if (!p) return;
      this.pending.delete(r.id);
      clearTimeout(p.timer);
      if (r.ok) p.resolve(r.value);
      else p.reject(new AgentError((r.error?.code as any) ?? "unavailable", r.error?.message ?? "The app couldn't do that."));
    });
    ipcMain.handle(IPC.agentCall, async (e, op: string, ...args: any[]) => {
      try {
        return { ok: true, value: await this.settingsCall(e.sender, op, args) };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    });
  }

  // ---------------- Settings › Connect an AI agent

  state(): AgentState {
    const launch = mcpLaunchCommand();
    const port = this.server?.port ?? null;
    const base = port ? `http://127.0.0.1:${port}` : null;
    return {
      enabled: this.settings.enabled,
      running: !!this.server,
      error: this.error,
      port,
      mcpUrl: base ? base + "/mcp" : null,
      restUrl: base ? base + "/v1" : null,
      token: this.settings.token,
      vaultPath: this.o.vaultPath,
      launch,
      clients: clientStates(launch),
      snippets: snippets(launch, base ? { url: base, token: this.settings.token } : null),
      cli: cliStatus(),
      appConnected: !!this.bridge,
    };
  }

  private async settingsCall(sender: WebContents, op: string, args: any[]): Promise<unknown> {
    switch (op) {
      case "state":
        return this.state();
      case "setEnabled": {
        this.settings.enabled = !!args[0];
        saveSettings(this.o.dataDir, this.settings);
        if (this.settings.enabled) await this.startServer();
        else await this.stopServer();
        return this.state();
      }
      case "regenerateToken": {
        this.settings.token = newToken();
        saveSettings(this.o.dataDir, this.settings);
        return this.state();
      }
      case "connect":
        return { message: await connectClient(args[0] as ClientId, mcpLaunchCommand()), state: this.state() };
      case "disconnect":
        return { message: await disconnectClient(args[0] as ClientId), state: this.state() };
      case "installCli":
        return { message: await installCli(BrowserWindow.fromWebContents(sender)), state: this.state() };
      default:
        throw new Error(`Unknown agent settings call “${op}”.`);
    }
  }
}

// ---------------- the `bedrock` command

const CMD = BRAND.exeName;

function onPath(dir: string): boolean {
  const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, "").toLowerCase();
  return (process.env.PATH || "").split(path.delimiter).filter(Boolean).some((d) => norm(d) === norm(dir));
}

/** Where the command is installed: the installer's bin folder (Windows) or a wrapper in a bin dir. */
function cliStatus(): { installed: boolean; location: string | null; canInstall: boolean } {
  if (process.platform === "win32") {
    const shim = path.join(path.dirname(process.execPath), "bin", CMD + ".cmd");
    const installed = app.isPackaged && fs.existsSync(shim);
    return { installed, location: installed ? shim : null, canInstall: app.isPackaged };
  }
  for (const d of ["/usr/local/bin", path.join(os.homedir(), ".local", "bin")]) {
    const f = path.join(d, CMD);
    try {
      if (fs.readFileSync(f, "utf8").includes("ELECTRON_RUN_AS_NODE")) return { installed: true, location: f, canInstall: true };
    } catch {
      /* not there */
    }
  }
  return { installed: false, location: null, canInstall: app.isPackaged };
}

async function installCli(win: BrowserWindow | null): Promise<string> {
  if (!app.isPackaged) throw new Error("The command line tool can only be installed from an installed copy of the app. In development, run “node app/dist/cli.js”.");
  if (process.platform === "win32") {
    // The installer normally does this; this repairs it (per-user PATH, no admin).
    const bin = path.join(path.dirname(process.execPath), "bin");
    const shim = path.join(bin, CMD + ".cmd");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(shim, windowsShim(path.basename(process.execPath)));
    // Same as build-res/installer.nsh: raw HKCU\Environment\Path (keeps %VARS%), then broadcast.
    const ps =
      "$b=$env:TB_CLI_BIN; $k=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment'); " +
      "$p=[string]$k.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); " +
      "if((($p -split ';') | ForEach-Object { $_.TrimEnd('\\') }) -notcontains $b.TrimEnd('\\')){ $k.SetValue('Path',(($p.TrimEnd(';')+';'+$b).TrimStart(';')),[Microsoft.Win32.RegistryValueKind]::ExpandString) }; $k.Close(); " +
      "[Environment]::SetEnvironmentVariable('TB_CLI_BROADCAST',$null,'User')";
    await new Promise<void>((resolve, reject) =>
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps], { windowsHide: true, timeout: 30000, env: { ...process.env, TB_CLI_BIN: bin } }, (e) => (e ? reject(e) : resolve())),
    );
    return `Installed. Open a new terminal and type “${CMD} help”.`;
  }
  const targets = ["/usr/local/bin", path.join(os.homedir(), ".local", "bin")];
  const dir = targets.find((d) => {
    try {
      fs.accessSync(d, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }) ?? targets[1];
  const file = path.join(dir, CMD);
  const opts = { type: "question" as const, buttons: ["Install", "Cancel"], defaultId: 0, cancelId: 1, message: `Install the “${CMD}” command?`, detail: `This adds a small script at ${file} so AI agents and terminals can use your notes.` };
  const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  if (r.response !== 0) return "Not installed.";
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, posixWrapper(process.execPath, cliScript()), { mode: 0o755 });
  return onPath(dir) ? `Installed at ${file}. Open a new terminal and type “${CMD} help”.` : `Installed at ${file}. Add ${dir} to your PATH, then type “${CMD} help” in a new terminal.`;
}

export function windowsShim(exeName: string): string {
  return ["@echo off", "setlocal", "set ELECTRON_RUN_AS_NODE=1", `"%~dp0..\\${exeName}" "%~dp0..\\resources\\app.asar\\dist\\cli.js" %*`, "exit /b %ERRORLEVEL%", ""].join("\r\n");
}

export function posixWrapper(exe: string, script: string): string {
  return `#!/bin/sh\n# ${BRAND.productTitle} command line (installed from Settings > Connect an AI agent)\nELECTRON_RUN_AS_NODE=1 exec "${exe}" "${script}" "$@"\n`;
}

let host: AgentHost | null = null;

/** Start agent access for the main vault (main/index.ts). BEDROCK_AGENTS=0 turns it off for tests. */
export async function startAgents(o: { vaultPath: string; showMain: () => void }): Promise<AgentHost | null> {
  if (host || process.env.BEDROCK_AGENTS === "0") return host;
  host = new AgentHost({ vaultPath: o.vaultPath, dataDir: app.getPath("userData"), version: app.getVersion(), showMain: o.showMain });
  await host.start().catch((e) => log("error", `agents: ${e?.message ?? e}`));
  return host;
}

export async function stopAgents(): Promise<void> {
  await host?.stop();
}

void DEFAULT_PORT;
