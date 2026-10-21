// One-click "Connect" for AI agent apps, and copyable setup snippets for the rest.
// Only the config file of the app the person clicks is touched; it is backed up first and merged
// (other MCP servers and settings are kept). Paths can be redirected with env vars so tests never
// touch the real files:
//   BEDROCK_CLAUDE_CODE_CONFIG     (default ~/.claude.json)
//   BEDROCK_CLAUDE_DESKTOP_CONFIG  (default %APPDATA%\Claude\claude_desktop_config.json, macOS ~/Library/Application Support/Claude/…)
//   BEDROCK_CURSOR_CONFIG          (default ~/.cursor/mcp.json)
//   BEDROCK_CLAUDE_CLI             (path to the `claude` CLI, or "none" to never use it)
// No Electron imports.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BRAND } from "../../shared/brand";

export type ClientId = "claude-code" | "claude-desktop" | "cursor";

export interface LaunchCommand {
  command: string;
  args: string[];
}

export interface ClientState {
  id: ClientId;
  name: string;
  /** The app seems to be installed (its config folder exists, or its CLI is on PATH). */
  installed: boolean;
  connected: boolean;
  /** Connected, but to a different copy of the app (e.g. an older install path). */
  stale: boolean;
  configPath: string;
  via: "cli" | "file";
}

export const SERVER_NAME = BRAND.name;

const home = () => process.env.BEDROCK_HOME_OVERRIDE || os.homedir();

export function claudeCodeConfigPath(): string {
  return process.env.BEDROCK_CLAUDE_CODE_CONFIG || path.join(home(), ".claude.json");
}

export function claudeDesktopConfigPath(): string {
  if (process.env.BEDROCK_CLAUDE_DESKTOP_CONFIG) return process.env.BEDROCK_CLAUDE_DESKTOP_CONFIG;
  if (process.platform === "win32") {
    const roaming = process.env.APPDATA || path.join(home(), "AppData", "Roaming");
    const plain = path.join(roaming, "Claude");
    if (!fs.existsSync(plain)) {
      // Store (MSIX) installs keep their files in a virtualised folder.
      const pkgs = path.join(process.env.LOCALAPPDATA || path.join(home(), "AppData", "Local"), "Packages");
      try {
        const pkg = fs.readdirSync(pkgs).find((d) => /^Claude_/i.test(d));
        if (pkg) {
          const v = path.join(pkgs, pkg, "LocalCache", "Roaming", "Claude");
          if (fs.existsSync(v)) return path.join(v, "claude_desktop_config.json");
        }
      } catch {
        /* no Packages folder */
      }
    }
    return path.join(plain, "claude_desktop_config.json");
  }
  if (process.platform === "darwin") return path.join(home(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home(), ".config"), "Claude", "claude_desktop_config.json");
}

export function cursorConfigPath(): string {
  return process.env.BEDROCK_CURSOR_CONFIG || path.join(home(), ".cursor", "mcp.json");
}

/** The `claude` CLI on PATH, or null. */
export function findClaudeCli(): string | null {
  const env = process.env.BEDROCK_CLAUDE_CLI;
  if (env) return env === "none" ? null : env;
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  dirs.push(path.join(home(), ".local", "bin"), path.join(home(), ".claude", "local"));
  for (const d of dirs)
    for (const e of exts) {
      const p = path.join(d, "claude" + e);
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch {
        /* not here */
      }
    }
  return null;
}

function readJson(file: string): any {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new Error(`“${file}” isn't valid JSON, so it was left alone. Fix or remove it, then try again.`);
  }
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Merge one MCP server entry into a JSON config file (or remove it with entry = null). Backs the file up first. */
export function mergeServerEntry(file: string, entry: Record<string, unknown> | null, key = "mcpServers"): { backup: string | null } {
  const cur = readJson(file);
  if (cur !== null && (typeof cur !== "object" || Array.isArray(cur))) throw new Error(`“${file}” doesn't hold a settings object, so it was left alone.`);
  const obj = cur ?? {};
  const servers = obj[key] && typeof obj[key] === "object" && !Array.isArray(obj[key]) ? obj[key] : {};
  if (entry) servers[SERVER_NAME] = entry;
  else if (!(SERVER_NAME in servers)) return { backup: null };
  else delete servers[SERVER_NAME];
  obj[key] = servers;
  let backup: string | null = null;
  if (cur !== null) {
    backup = `${file}.bak-${stamp()}`;
    fs.copyFileSync(file, backup);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n");
  fs.renameSync(tmp, file);
  return { backup };
}

function entryIn(file: string, key = "mcpServers"): any {
  try {
    return readJson(file)?.[key]?.[SERVER_NAME] ?? null;
  } catch {
    return null;
  }
}

const sameCommand = (e: any, cmd: LaunchCommand) => !!e && typeof e.command === "string" && path.resolve(e.command).toLowerCase() === path.resolve(cmd.command).toLowerCase() && JSON.stringify(e.args ?? []) === JSON.stringify(cmd.args);

export function clientStates(cmd: LaunchCommand): ClientState[] {
  const cc = claudeCodeConfigPath();
  const cd = claudeDesktopConfigPath();
  const cu = cursorConfigPath();
  const cli = findClaudeCli();
  const mk = (id: ClientId, name: string, file: string, installed: boolean, via: "cli" | "file"): ClientState => {
    const e = entryIn(file);
    return { id, name, installed, connected: !!e, stale: !!e && !sameCommand(e, cmd), configPath: file, via };
  };
  return [
    mk("claude-code", "Claude Code", cc, !!cli || fs.existsSync(cc), cli ? "cli" : "file"),
    mk("claude-desktop", "Claude Desktop", cd, fs.existsSync(path.dirname(cd)), "file"),
    mk("cursor", "Cursor", cu, fs.existsSync(path.dirname(cu)), "file"),
  ];
}

function run(file: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const isScript = process.platform === "win32" && /\.(cmd|bat)$/i.test(file);
    const q = (s: string) => (/[\s"&|<>^()]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const [f, a, opts] = isScript ? ["cmd.exe", ["/d", "/s", "/c", `"${[file, ...args].map(q).join(" ")}"`], { windowsVerbatimArguments: true }] : [file, args, {}];
    execFile(f, a as string[], { timeout: 30000, windowsHide: true, ...(opts as any) }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as any).code ?? 1) : 0, out: String(stdout) + String(stderr) });
    });
  });
}

/** Connect one client. Returns a sentence for the person. */
export async function connectClient(id: ClientId, cmd: LaunchCommand): Promise<string> {
  const stdioEntry = { command: cmd.command, args: cmd.args };
  if (id === "claude-code") {
    const cli = findClaudeCli();
    if (cli) {
      await run(cli, ["mcp", "remove", "--scope", "user", SERVER_NAME]);
      const r = await run(cli, ["mcp", "add", "--scope", "user", SERVER_NAME, "--", cmd.command, ...cmd.args]);
      if (r.code === 0) return `Connected. Claude Code can use your notes in new sessions (added with “claude mcp add”).`;
      // fall through to the file when the CLI fails
    }
    const { backup } = mergeServerEntry(claudeCodeConfigPath(), { type: "stdio", ...stdioEntry, env: {} });
    return `Connected. Claude Code can use your notes in new sessions.${backup ? ` A backup of its settings is at ${backup}.` : ""}`;
  }
  const file = id === "claude-desktop" ? claudeDesktopConfigPath() : cursorConfigPath();
  const { backup } = mergeServerEntry(file, stdioEntry);
  const name = id === "claude-desktop" ? "Claude Desktop" : "Cursor";
  return `Connected. Restart ${name} to load your notes.${backup ? ` The old settings file was backed up to ${backup}.` : ""}`;
}

export async function disconnectClient(id: ClientId): Promise<string> {
  if (id === "claude-code") {
    const cli = findClaudeCli();
    if (cli) await run(cli, ["mcp", "remove", "--scope", "user", SERVER_NAME]);
    mergeServerEntry(claudeCodeConfigPath(), null);
    return "Disconnected from Claude Code.";
  }
  mergeServerEntry(id === "claude-desktop" ? claudeDesktopConfigPath() : cursorConfigPath(), null);
  return `Disconnected. Restart ${id === "claude-desktop" ? "Claude Desktop" : "Cursor"} to finish.`;
}

export interface Snippet {
  id: string;
  title: string;
  where: string;
  text: string;
}

/** Copyable setup for other apps. */
export function snippets(cmd: LaunchCommand, http: { url: string; token: string } | null): Snippet[] {
  const stdio = { command: cmd.command, args: cmd.args };
  const shellQuote = (s: string) => (/[\s"]/.test(s) ? `"${s}"` : s);
  const out: Snippet[] = [
    { id: "claude-code-cli", title: "Claude Code (command)", where: "Run in a terminal", text: `claude mcp add --scope user ${SERVER_NAME} -- ${[cmd.command, ...cmd.args].map(shellQuote).join(" ")}` },
    { id: "vscode", title: "VS Code (GitHub Copilot)", where: "Command Palette › “MCP: Open User Configuration”, or .vscode/mcp.json in a project", text: JSON.stringify({ servers: { [SERVER_NAME]: { type: "stdio", ...stdio } } }, null, 2) },
    { id: "windsurf", title: "Windsurf", where: "~/.codeium/windsurf/mcp_config.json", text: JSON.stringify({ mcpServers: { [SERVER_NAME]: stdio } }, null, 2) },
    { id: "generic-stdio", title: "Any MCP app (stdio)", where: "The app's MCP settings file", text: JSON.stringify({ mcpServers: { [SERVER_NAME]: stdio } }, null, 2) },
  ];
  if (http) {
    out.push(
      { id: "generic-http", title: "Any MCP app (HTTP, while the app is open)", where: "Streamable HTTP with a bearer token", text: JSON.stringify({ mcpServers: { [SERVER_NAME]: { type: "http", url: http.url + "/mcp", headers: { Authorization: `Bearer ${http.token}` } } } }, null, 2) },
      { id: "claude-code-http", title: "Claude Code over HTTP", where: "Run in a terminal", text: `claude mcp add --transport http ${SERVER_NAME} ${http.url}/mcp --header "Authorization: Bearer ${http.token}"` },
      { id: "rest", title: "REST API", where: "Any program; see docs/AGENT-API.md", text: `curl -H "Authorization: Bearer ${http.token}" "${http.url}/v1/search?query=meeting"` },
    );
  }
  return out;
}
