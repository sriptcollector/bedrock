// Settings › Connect an AI agent. Lets AI apps (Claude Code, Claude Desktop, Cursor, VS Code, …)
// use the notes in this vault through MCP, the local REST API or the `bedrock` command.
// Registered additively from app.ts with mountAgentsUi(app); the work happens in the main process
// (main/agents/host.ts) through IPC.agentCall.
import { clipboard, ipcRenderer } from "electron";
import { IPC } from "../../shared/ipc";
import { BRAND } from "../../shared/brand";
import { Setting, SettingTab } from "../ui/setting";
import { Notice } from "../ui/notice";
import { mountAgentBridge } from "./agents-bridge";

interface ClientState {
  id: string;
  name: string;
  installed: boolean;
  connected: boolean;
  stale: boolean;
  configPath: string;
  via: "cli" | "file";
}

interface AgentState {
  enabled: boolean;
  running: boolean;
  error: string | null;
  port: number | null;
  mcpUrl: string | null;
  restUrl: string | null;
  token: string;
  vaultPath: string;
  launch: { command: string; args: string[] };
  clients: ClientState[];
  snippets: { id: string; title: string; where: string; text: string }[];
  cli: { installed: boolean; location: string | null; canInstall: boolean };
  appConnected: boolean;
}

async function call<T = any>(op: string, ...args: any[]): Promise<T> {
  const r = await ipcRenderer.invoke(IPC.agentCall, op, ...args);
  if (!r?.ok) throw new Error(r?.error ?? "Something went wrong.");
  return r.value as T;
}

function copy(text: string, what: string): void {
  try {
    clipboard.writeText(text);
  } catch {
    void navigator.clipboard?.writeText(text);
  }
  new Notice(`${what} copied.`);
}

const CSS = `
.bedrock-agents .agents-intro { margin: 0 0 12px; color: var(--text-muted); font-size: var(--font-ui-small); line-height: 1.5; }
.bedrock-agents .agents-status-on { color: var(--text-success); }
.bedrock-agents .agents-status-off { color: var(--text-muted); }
.bedrock-agents .agents-status-error { color: var(--text-error); }
.bedrock-agents .agents-token input { font-family: var(--font-monospace); width: 260px; }
.bedrock-agents .agents-snippet { margin: 0 0 14px; }
.bedrock-agents .agents-snippet-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
.bedrock-agents .agents-snippet-title { font-weight: var(--font-semibold); }
.bedrock-agents .agents-snippet-where { color: var(--text-muted); font-size: var(--font-ui-smaller); }
.bedrock-agents pre.agents-code { margin: 0; padding: 8px 10px; max-height: 180px; overflow: auto; white-space: pre-wrap; word-break: break-all; user-select: text;
  background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s); font-family: var(--font-monospace); font-size: var(--font-ui-smaller); }
.bedrock-agents .agents-badge { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: var(--radius-s); font-size: var(--font-ui-smaller); }
.bedrock-agents .agents-badge.mod-on { background: rgba(var(--color-green-rgb), 0.15); color: var(--text-success); }
.bedrock-agents .agents-badge.mod-off { background: var(--background-modifier-hover); color: var(--text-muted); }
.bedrock-agents .agents-badge.mod-warn { background: rgba(var(--color-orange-rgb), 0.15); color: var(--text-warning); }
`;

let cssInjected = false;
function injectCss(): void {
  if (cssInjected) return;
  cssInjected = true;
  const st = document.createElement("style");
  st.id = "bedrock-agents-css";
  st.textContent = CSS;
  const base = document.head.querySelector('link[href="app.css"]');
  if (base) base.after(st);
  else document.head.prepend(st);
}

export class AgentsSettingTab extends SettingTab {
  private state: AgentState | null = null;
  private showToken = false;
  private busy = false;

  constructor(app: any) {
    super();
    this.app = app;
    this.id = "agents";
    this.name = "Connect an AI agent";
    (this as any).icon = "bot";
  }

  display(): void {
    this.containerEl.addClass("bedrock-agents");
    if (!this.state) this.containerEl.createDiv({ cls: "setting-item-description", text: "Loading…" });
    void this.reload();
  }

  private async reload(): Promise<void> {
    try {
      this.state = await call<AgentState>("state");
    } catch (e: any) {
      this.containerEl.empty();
      this.containerEl.createEl("p", { text: `Couldn't load agent settings: ${e.message}` });
      return;
    }
    this.render();
  }

  private async act(fn: () => Promise<any>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const r = await fn();
      if (r?.message) new Notice(r.message, 8000);
      this.state = r?.state ?? (r?.enabled !== undefined ? r : await call<AgentState>("state"));
    } catch (e: any) {
      new Notice(e.message, 10000);
      this.state = await call<AgentState>("state").catch(() => this.state);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private render(): void {
    const s = this.state;
    if (!s) return;
    const el = this.containerEl;
    const scroll = el.scrollTop;
    el.empty();
    el.addClass("bedrock-agents");

    el.createEl("p", {
      cls: "agents-intro",
      text:
        `Let AI apps such as Claude, Cursor or VS Code search, read and edit the notes in this vault. ` +
        `They connect on this computer only. Their changes sync and keep version history just like yours, and deleted notes go to the .trash folder.`,
    });

    new Setting(el)
      .setName("Agent access")
      .setDesc("On: apps you connect can use your notes. Off: no app can reach them (the command line still works for you).")
      .addToggle((t) => t.setValue(s.enabled).onChange((v) => this.act(() => call("setEnabled", v))));

    const status = new Setting(el).setName("Status");
    const frag = document.createDocumentFragment();
    if (!s.enabled) frag.createSpan({ cls: "agents-status-off", text: "Off." });
    else if (s.error) frag.createSpan({ cls: "agents-status-error", text: s.error });
    else if (s.running) {
      frag.createSpan({ cls: "agents-status-on", text: "Ready. " });
      frag.createSpan({ text: `MCP: ${s.mcpUrl}  ·  REST: ${s.restUrl}` });
    } else frag.createSpan({ cls: "agents-status-off", text: "Starting…" });
    status.setDesc(frag);
    if (s.running && s.mcpUrl) status.addExtraButton((b) => b.setIcon("copy").setTooltip("Copy the MCP address").onClick(() => copy(s.mcpUrl!, "MCP address")));

    const tok = new Setting(el)
      .setName("API token")
      .setDesc("Apps that connect over HTTP send this token. Keep it private. It's stored only on this computer, never in your vault.")
      .setClass("agents-token")
      .addText((t) => {
        t.setValue(this.showToken ? s.token : "•".repeat(24));
        t.inputEl.readOnly = true;
        t.inputEl.setAttr("aria-label", "API token");
      })
      .addExtraButton((b) => b.setIcon(this.showToken ? "eye-off" : "eye").setTooltip(this.showToken ? "Hide" : "Show").onClick(() => {
        this.showToken = !this.showToken;
        this.render();
      }))
      .addButton((b) => b.setButtonText("Copy").onClick(() => copy(s.token, "Token")))
      .addButton((b) =>
        b.setButtonText("New token").onClick(async () => {
          const ok = await this.app.ui.confirm({ title: "Make a new token?", body: "Apps set up with the current token will stop working until you give them the new one. Apps connected with the buttons below aren't affected.", cta: "Make new token" });
          if (ok) await this.act(() => call("regenerateToken"));
        }),
      );
    void tok;

    new Setting(el).setName("Connect with one click").setHeading();
    for (const c of s.clients) {
      const row = new Setting(el).setName(c.name);
      const d = document.createDocumentFragment();
      if (c.connected && !c.stale) {
        d.createSpan({ cls: "agents-badge mod-on", text: "Connected" });
        d.createSpan({ text: c.id === "claude-code" ? "  New Claude Code sessions can use your notes." : `  Restart ${c.name} after connecting if it was open.` });
      } else if (c.connected && c.stale) {
        d.createSpan({ cls: "agents-badge mod-warn", text: "Needs update" });
        d.createSpan({ text: `  It points to another copy of ${BRAND.displayName}. Click Connect to fix it.` });
      } else if (!c.installed) {
        d.createSpan({ cls: "agents-badge mod-off", text: "Not found" });
        d.createSpan({ text: `  ${c.name} doesn't seem to be installed. You can still connect it now.` });
      } else {
        d.createSpan({ cls: "agents-badge mod-off", text: "Not connected" });
      }
      row.setDesc(d);
      row.settingEl.setAttr("data-client", c.id);
      if (c.connected) row.addButton((b) => b.setButtonText("Disconnect").onClick(() => this.act(() => call("disconnect", c.id))));
      row.addButton((b) => {
        b.setButtonText(c.connected && !c.stale ? "Reconnect" : "Connect").onClick(() => this.act(() => call("connect", c.id)));
        if (!c.connected || c.stale) b.setCta();
      });
    }

    new Setting(el).setName("Other apps").setHeading();
    el.createEl("p", { cls: "agents-intro", text: "Copy the setup for your app. The stdio setups start a small helper that works whether or not this app is open." });
    for (const sn of s.snippets) {
      const box = el.createDiv({ cls: "agents-snippet", attr: { "data-snippet": sn.id } });
      const head = box.createDiv("agents-snippet-head");
      const left = head.createDiv();
      left.createDiv({ cls: "agents-snippet-title", text: sn.title });
      left.createDiv({ cls: "agents-snippet-where", text: sn.where });
      const btn = head.createEl("button", { text: "Copy" });
      btn.addEventListener("click", () => copy(sn.text, sn.title));
      box.createEl("pre", { cls: "agents-code", text: sn.text });
    }

    new Setting(el).setName("Command line").setHeading();
    const cli = new Setting(el).setName(`The “${BRAND.exeName}” command`);
    if (s.cli.installed) cli.setDesc(`Installed (${s.cli.location}). Try “${BRAND.exeName} search meeting” or “${BRAND.exeName} help” in a terminal.`);
    else if (s.cli.canInstall) cli.setDesc(`Lets terminals and coding agents use your notes: “${BRAND.exeName} search”, “${BRAND.exeName} daily --append …”.`);
    else cli.setDesc(`Available in the installed app. In development run “node app/dist/cli.js help”.`);
    if (s.cli.canInstall) cli.addButton((b) => b.setButtonText(s.cli.installed ? "Reinstall" : "Install command line tool").onClick(() => this.act(() => call("installCli"))));

    el.createEl("p", {
      cls: "agents-intro",
      text: `Nothing is sent anywhere: agents reach your notes only on this computer, over 127.0.0.1 with the token, or by starting the helper themselves. Connecting an app changes only that app's settings file (a backup is kept). Details: docs/AGENT-API.md.`,
    });
    el.scrollTop = scroll;
  }
}

/** Registers Settings › Connect an AI agent and the vault bridge (called once from app.ts). */
export function mountAgentsUi(app: any): void {
  injectCss();
  mountAgentBridge(app);
  if (app.boot?.isMainVault === false) return;
  app.setting.addSettingTab(new AgentsSettingTab(app), "options");
}
