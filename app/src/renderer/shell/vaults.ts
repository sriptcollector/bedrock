// Vaults: the vault manager window (800x650; known vaults on the left with a per-vault menu,
// create / open folder / open the synced vault on the right, plus the create-vault form), the
// quick vault picker ("Open vault..." / "Change vault...") and the vault switcher at the bottom
// of the left sidebar (vault name with a menu, help and settings buttons).
// [ours] The synced (Toolbay account) vault always lives in the main window; other vaults open in
// their own windows, so "Change vault" never replaces the synced vault.
import { ipcRenderer } from "electron";
import { SHELL_IPC, type VaultInfo } from "../../shared/ipc-shell";
import { BRAND } from "../../shared/brand";
import { PopoutWindow } from "../settings/popout";
import { setIcon } from "../dom/icons";
import { Menu } from "../ui/menu";
import { Notice } from "../ui/notice";
import { SuggestModal } from "../ui/modal";
import { prepareFuzzySearch, renderMatches, type SearchResult } from "../ui/search";
import { writeClipboard } from "./clipboard";

export function listVaults(): Promise<VaultInfo[]> {
  return ipcRenderer.invoke(SHELL_IPC.vaults);
}

export async function openVault(path: string, closeCurrent = false): Promise<boolean> {
  const ok = await ipcRenderer.invoke(SHELL_IPC.openVault, path, { closeSender: closeCurrent });
  if (!ok) new Notice("That folder can't be opened. It may have been moved or deleted.");
  return ok;
}

// ---------------------------------------------------------------- quick picker

class VaultPicker extends SuggestModal<{ v: VaultInfo; m: SearchResult | null }> {
  constructor(app: any, private vaults: VaultInfo[], private mode: "open" | "switch") {
    super(app);
    this.setPlaceholder(mode === "switch" ? "Change to vault..." : "Open vault...");
    this.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "↵", purpose: "to open" },
      { command: "esc", purpose: "to dismiss" },
    ]);
    this.emptyStateText = "No vaults found.";
  }
  getSuggestions(q: string) {
    const list = this.vaults.filter((v) => !(this.mode === "switch" && v.current));
    if (!q.trim()) return list.map((v) => ({ v, m: null }));
    const fn = prepareFuzzySearch(q);
    return list
      .map((v) => ({ v, m: fn(v.name) }))
      .filter((x) => x.m)
      .sort((a, b) => b.m!.score - a.m!.score);
  }
  renderSuggestion(x: { v: VaultInfo; m: SearchResult | null }, el: HTMLElement) {
    el.addClass("mod-complex");
    const c = el.createDiv("suggestion-content");
    const t = c.createDiv("suggestion-title");
    if (x.m) renderMatches(t, x.v.name, x.m.matches);
    else t.setText(x.v.name);
    c.createDiv({ cls: "suggestion-note", text: x.v.path });
    if (x.v.isMain) el.createDiv("suggestion-aux").createSpan({ cls: "suggestion-flair", text: "Synced" });
  }
  onChooseSuggestion(x: { v: VaultInfo }) {
    void openVault(x.v.path, this.mode === "switch");
  }
}

export async function openVaultPicker(app: any, mode: "open" | "switch"): Promise<void> {
  new VaultPicker(app, await listVaults(), mode).open();
}

// ---------------------------------------------------------------- vault manager window

const CSS = `
.vault-manager { display: flex; height: 100%; font-size: var(--font-ui-small); color: var(--text-normal); }
.vault-manager-list { width: 280px; flex-shrink: 0; background: var(--background-secondary); border-right: 1px solid var(--divider-color); overflow-y: auto; padding: 40px 8px 8px; -webkit-app-region: drag; }
.vault-manager-list > * { -webkit-app-region: no-drag; }
.vault-manager-item { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-radius: var(--radius-s); cursor: var(--cursor); }
.vault-manager-item:hover { background: var(--background-modifier-hover); }
.vault-manager-item.is-active { background: var(--background-modifier-active-hover); }
.vault-manager-item-text { flex: 1; min-width: 0; }
.vault-manager-item-name { font-weight: var(--font-semibold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vault-manager-item-path { color: var(--text-muted); font-size: var(--font-ui-smaller); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vault-manager-item.is-missing .vault-manager-item-name { color: var(--text-faint); text-decoration: line-through; }
.vault-manager-item-flair { font-size: var(--font-ui-smaller); color: var(--text-accent); }
.vault-manager-item-menu { opacity: 0; }
.vault-manager-item:hover .vault-manager-item-menu { opacity: 1; }
.vault-manager-empty { color: var(--text-muted); padding: 10px; }
.vault-manager-main { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 48px 24px; -webkit-app-region: drag; position: relative; }
.vault-manager-main > * { -webkit-app-region: no-drag; }
.vault-manager-logo { width: 72px; height: 72px; margin-bottom: 12px; }
.vault-manager-title { font-size: 1.6em; font-weight: var(--font-bold); }
.vault-manager-version { color: var(--text-muted); margin-bottom: 28px; }
.vault-manager-options { width: 100%; max-width: 420px; }
.vault-manager-options .setting-item { padding: 14px 0; }
.vault-manager-back { align-self: flex-start; color: var(--text-muted); cursor: var(--cursor); margin-bottom: 16px; display: flex; gap: 4px; align-items: center; }
.vault-manager-back:hover { color: var(--text-normal); }
.vault-manager-form-title { font-size: 1.3em; font-weight: var(--font-bold); align-self: flex-start; margin-bottom: 8px; }
.vault-manager-error { color: var(--text-error); min-height: 1.4em; margin-top: 8px; }
.vault-manager-location { color: var(--text-muted); font-size: var(--font-ui-smaller); word-break: break-all; }
.vault-manager-language { position: absolute; bottom: 16px; right: 24px; display: flex; gap: 8px; align-items: center; color: var(--text-muted); }
`;

export class VaultManager {
  popout = new PopoutWindow({ name: "starter", width: 800, height: 650, minWidth: 600, minHeight: 450, title: "Manage vaults", bodyClasses: ["is-vault-manager"], onKeyDown: (e) => e.key === "Escape" && this.popout.close() });
  private root!: HTMLElement;
  private listEl!: HTMLElement;
  private mainEl!: HTMLElement;

  constructor(private app: any) {}

  async open(): Promise<void> {
    if (this.popout.isOpen) {
      this.popout.focus();
      await this.renderList();
      return;
    }
    const body = this.popout.open();
    if (!body) {
      new Notice("Couldn't open the vault manager window.");
      return;
    }
    const d = this.popout.doc!;
    d.head.createEl("style").textContent = CSS;
    this.root = body.createDiv("vault-manager");
    this.listEl = this.root.createDiv("vault-manager-list");
    this.mainEl = this.root.createDiv("vault-manager-main");
    await this.renderList();
    this.renderHome();
  }

  close(): void {
    this.popout.close();
  }

  private async renderList(): Promise<void> {
    const vaults = await listVaults();
    this.listEl.empty();
    if (!vaults.length) this.listEl.createDiv({ cls: "vault-manager-empty", text: "No vaults yet." });
    for (const v of vaults) {
      const it = this.listEl.createDiv({ cls: "vault-manager-item", attr: { "data-path": v.path } });
      it.toggleClass("is-active", v.current);
      it.toggleClass("is-missing", !v.exists);
      const txt = it.createDiv("vault-manager-item-text");
      txt.createDiv({ cls: "vault-manager-item-name", text: v.name });
      txt.createDiv({ cls: "vault-manager-item-path", text: v.path });
      if (v.isMain) it.createDiv({ cls: "vault-manager-item-flair", text: "Synced" });
      const menuBtn = it.createDiv({ cls: "clickable-icon vault-manager-item-menu", attr: { "aria-label": "Vault options" } });
      setIcon(menuBtn, "more-horizontal");
      const showMenu = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const m = new Menu();
        m.addItem((i) => i.setTitle("Copy vault path").setIcon("copy").setSection("info").onClick(() => writeClipboard(v.path)));
        if (!v.isMain) {
          m.addItem((i) => i.setTitle("Rename vault...").setIcon("pencil").setSection("edit").onClick(() => this.renameVault(v)));
          m.addItem((i) => i.setTitle("Move vault...").setIcon("folder-input").setSection("edit").onClick(() => this.moveVault(v)));
        }
        m.addItem((i) => i.setTitle("Reveal vault in system explorer").setIcon("folder-open").setSection("system").onClick(() => this.app.native.invoke("bedrock:reveal", v.path)));
        if (!v.isMain)
          m.addItem((i) =>
            i
              .setTitle("Remove from list")
              .setIcon("x")
              .setWarning(true)
              .setSection("danger")
              .onClick(async () => {
                await ipcRenderer.invoke(SHELL_IPC.removeVault, v.path);
                await this.renderList();
              }),
          );
        m.showAtMouseEvent(e);
      };
      menuBtn.addEventListener("click", showMenu);
      it.addEventListener("contextmenu", showMenu);
      it.addEventListener("click", async () => {
        if (!v.exists) {
          new Notice("This vault's folder is missing. It may have been moved or deleted.");
          return;
        }
        if (await openVault(v.path)) this.close();
      });
    }
  }

  private async moveVault(v: VaultInfo): Promise<void> {
    const parent = await ipcRenderer.invoke(SHELL_IPC.pickFolder, `Move "${v.name}" to...`);
    if (!parent) return;
    const r = await ipcRenderer.invoke(SHELL_IPC.moveVault, v.path, parent);
    if (r?.error) new Notice(r.error);
    await this.renderList();
  }

  private async renameVault(v: VaultInfo): Promise<void> {
    const name = await this.app.ui.prompt({ title: "Rename vault", value: v.name, cta: "Rename" });
    if (!name || name === v.name) return;
    const r = await ipcRenderer.invoke(SHELL_IPC.renameVault, v.path, name);
    if (r?.error) new Notice(r.error);
    await this.renderList();
  }

  private header(): void {
    const logo = this.mainEl.createDiv("vault-manager-logo");
    setIcon(logo, "gem");
    logo.querySelector("svg")?.setAttribute("width", "72");
    logo.querySelector("svg")?.setAttribute("height", "72");
    this.mainEl.createDiv({ cls: "vault-manager-title", text: BRAND.displayName });
    this.mainEl.createDiv({ cls: "vault-manager-version", text: `Version ${this.app.version}` });
  }

  private option(parent: HTMLElement, name: string, desc: string, button: string, cta: boolean, cb: () => any): void {
    const row = parent.createDiv("setting-item");
    const info = row.createDiv("setting-item-info");
    info.createDiv({ cls: "setting-item-name", text: name });
    info.createDiv({ cls: "setting-item-description", text: desc });
    const ctl = row.createDiv("setting-item-control");
    const b = ctl.createEl("button", { text: button, cls: cta ? "mod-cta" : "" });
    b.addEventListener("click", cb);
  }

  renderHome(): void {
    this.mainEl.empty();
    this.header();
    const opts = this.mainEl.createDiv("vault-manager-options");
    this.option(opts, "Create new vault", "Make a new, empty vault in a folder of your choice.", "Create", true, () => this.renderCreate());
    this.option(opts, "Open folder as vault", "Pick a folder of Markdown files on this computer to use as a vault.", "Open", false, async () => {
      const dir = await ipcRenderer.invoke(SHELL_IPC.pickFolder, "Open folder as vault");
      if (dir && (await openVault(dir))) this.close();
    });
    this.option(opts, "Open your synced vault", `The vault that syncs with your Toolbay account, in its own window.`, "Open", false, async () => {
      const main = (await listVaults()).find((v) => v.isMain);
      if (main && (await openVault(main.path))) this.close();
    });
    const lang = this.mainEl.createDiv("vault-manager-language");
    setIcon(lang.createSpan(), "languages");
    const sel = lang.createEl("select", { cls: "dropdown" });
    sel.createEl("option", { text: "English", value: "en" });
    sel.disabled = true;
    lang.setAttr("aria-label", "More languages are coming");
  }

  private async renderCreate(): Promise<void> {
    this.mainEl.empty();
    const back = this.mainEl.createDiv("vault-manager-back");
    setIcon(back.createSpan(), "chevron-left");
    back.createSpan({ text: "Back" });
    back.addEventListener("click", () => this.renderHome());
    this.mainEl.createDiv({ cls: "vault-manager-form-title", text: "Create local vault" });
    const opts = this.mainEl.createDiv("vault-manager-options");
    let parent: string = await ipcRenderer.invoke(SHELL_IPC.documentsDir);
    const nameRow = opts.createDiv("setting-item");
    const ni = nameRow.createDiv("setting-item-info");
    ni.createDiv({ cls: "setting-item-name", text: "Vault name" });
    ni.createDiv({ cls: "setting-item-description", text: "Pick a name for your new vault." });
    const input = nameRow.createDiv("setting-item-control").createEl("input", { type: "text", placeholder: "Vault name", cls: "vault-manager-name" });
    const locRow = opts.createDiv("setting-item");
    const li = locRow.createDiv("setting-item-info");
    li.createDiv({ cls: "setting-item-name", text: "Location" });
    const locText = li.createDiv({ cls: "vault-manager-location", text: `Your vault will be placed in: ${parent}` });
    const browse = locRow.createDiv("setting-item-control").createEl("button", { text: "Browse" });
    browse.addEventListener("click", async () => {
      const d = await ipcRenderer.invoke(SHELL_IPC.pickFolder, "Choose where to create the vault");
      if (d) {
        parent = d;
        locText.setText(`Your vault will be placed in: ${parent}`);
      }
    });
    const err = this.mainEl.createDiv("vault-manager-error");
    const create = this.mainEl.createEl("button", { cls: "mod-cta", text: "Create" });
    const submit = async () => {
      err.setText("");
      const r = await ipcRenderer.invoke(SHELL_IPC.createVault, input.value, parent);
      if (r?.error) err.setText(r.error);
      else this.close();
    };
    create.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => e.key === "Enter" && submit());
    input.focus();
  }
}

// ---------------------------------------------------------------- vault switcher (left sidebar)

export function mountVaultSwitcher(app: any, helpUrl: string): HTMLElement {
  const dock = app.workspace.leftSplit.containerEl as HTMLElement;
  const el = createDiv("workspace-sidedock-vault-profile");
  const sw = el.createDiv({ cls: "workspace-drawer-vault-switcher", attr: { "data-tooltip-position": "top", "data-tooltip-delay": "1000" } });
  // Tooltip: the vault's folder and how many files and folders it has.
  sw.addEventListener("mouseenter", () => {
    const files = app.vault.getFiles().length;
    const folders = app.vault.getAllFolders(false).length;
    sw.setAttr("aria-label", `${app.vault.adapter.getBasePath?.() ?? app.vault.getName()}\n\n${files} ${files === 1 ? "file" : "files"}, ${folders} ${folders === 1 ? "folder" : "folders"}`);
  });
  const icon = sw.createDiv("workspace-drawer-vault-switcher-icon");
  setIcon(icon, "chevrons-up-down");
  sw.createDiv({ cls: "workspace-drawer-vault-name", text: app.vault.getName() });
  const actions = el.createDiv("workspace-drawer-vault-actions");
  const help = actions.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Help" } });
  setIcon(help, "help-circle");
  help.addEventListener("click", () => app.openExternal(helpUrl));
  const settings = actions.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Settings" } });
  setIcon(settings, "settings");
  settings.addEventListener("click", () => app.setting.open());
  sw.addEventListener("click", async (e) => {
    const vaults = await listVaults();
    const m = new Menu();
    for (const v of vaults)
      m.addItem((i) =>
        i
          .setTitle(v.name)
          .setChecked(v.current)
          .onClick(() => !v.current && openVault(v.path)),
      );
    m.addSeparator();
    m.addItem((i) => i.setTitle("Manage vaults...").setIcon("vault").onClick(() => app.shell.openVaultManager()));
    const r = sw.getBoundingClientRect();
    m.showAtPosition({ x: r.left, y: r.top, left: false, overlap: true } as any);
    void e;
  });
  // The edge resize handle stays last.
  const handle = dock.querySelector(":scope > .mod-sidedock-handle");
  dock.insertBefore(el, handle);
  return el;
}
