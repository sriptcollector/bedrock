// Main-process side of the app shell: the vault manager (list, create, open, rename, remove,
// sandbox), window commands (always on top, close), PDF export, debug info, and URIs: our own
// scheme (brand.json "protocol") registered per user, plus obsidian://-style payloads passed as
// arguments. URIs are routed to the window of the vault they name and dispatched by the renderer.
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { BRAND } from "../shared/brand";
import { SHELL_IPC, type PdfOptions, type VaultInfo } from "../shared/ipc-shell";
import { isAppUri, parseAppUri, vaultForPath, type ParsedUri } from "../shared/uri";
import { readRegistry, writeRegistry, rememberOther, ensureMainVault } from "./vaults";
import { createVaultWindow, vaultWindows } from "./windows";
import { readAppSettings } from "./settings-host";

export const URI_SCHEMES = Array.from(new Set([BRAND.protocol || BRAND.name, "obsidian"].map((s) => s.toLowerCase())));

export interface ShellContext {
  /** Show (and create if needed) the main vault window. */
  showMain(): BrowserWindow | null;
  mainVaultPath(): string;
}

let ctx: ShellContext | null = null;
const pendingUris = new Map<number, ParsedUri[]>(); // webContents id -> URIs waiting for the renderer
const readyRenderers = new Set<number>();

function windowForVault(vaultPath: string): BrowserWindow | null {
  for (const v of vaultWindows.values()) if (path.resolve(v.vaultPath).toLowerCase() === path.resolve(vaultPath).toLowerCase() && !v.win.isDestroyed()) return v.win;
  return null;
}

function knownVaults(): { path: string; isMain: boolean; lastOpened?: number }[] {
  const reg = readRegistry();
  const main = ctx?.mainVaultPath() ?? reg.main;
  const out = [{ path: main, isMain: true }, ...reg.others.filter((o) => path.resolve(o.path) !== path.resolve(main)).map((o) => ({ path: o.path, isMain: false, lastOpened: o.lastOpened }))];
  // Vault windows opened in this session (e.g. dev --vault) count as known too.
  for (const v of vaultWindows.values()) if (!out.some((o) => path.resolve(o.path) === path.resolve(v.vaultPath))) out.push({ path: v.vaultPath, isMain: v.isMain });
  return out;
}

export function listVaults(sender?: Electron.WebContents): VaultInfo[] {
  const cur = sender ? vaultWindows.get(sender.id)?.vaultPath : undefined;
  return knownVaults().map((v) => ({
    path: v.path,
    name: path.basename(v.path),
    isMain: v.isMain,
    exists: fs.existsSync(v.path),
    open: !!windowForVault(v.path),
    current: !!cur && path.resolve(cur) === path.resolve(v.path),
    lastOpened: v.lastOpened,
  }));
}

/** Open a vault in its own window (or focus it). The main vault always goes to the main window. */
export function openVaultWindow(dir: string, remember = true): BrowserWindow | null {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  const main = ctx?.mainVaultPath();
  if (main && path.resolve(main).toLowerCase() === path.resolve(dir).toLowerCase()) return ctx!.showMain();
  const existing = windowForVault(dir);
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return existing;
  }
  if (remember) rememberOther(dir);
  return createVaultWindow({ vaultPath: dir, isMain: false, show: true });
}

const SANDBOX_NOTES: Record<string, string> = {
  "Start here.md": `# Sandbox vault

This is a place to try things out. Change, move or delete anything: the sandbox is reset when you
open it again from the command palette ("Open sandbox vault") after deleting its folder.

- [[Formatting]] shows the Markdown you can write.
- [[Links]] shows how notes connect.
`,
  "Formatting.md": `# Formatting

**Bold**, *italic*, ~~strikethrough~~, ==highlight== and \`inline code\`.

> [!tip] Callouts
> Start a quote with [!tip], [!note] or [!warning].

- [ ] A task
- [x] A finished task

| Column | Another |
| --- | --- |
| a | b |
`,
  "Links.md": `# Links

Type [[ to link to another note, like [[Start here]]. Links to notes that don't exist yet, such as
[[An idea for later]], create the note when you click them.

Add #tags anywhere to group notes.
`,
};

function sandboxPath(): string {
  return path.join(app.getPath("userData"), "Sandbox");
}

export function openSandbox(): string {
  const dir = sandboxPath();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(path.join(dir, ".obsidian"), { recursive: true });
    for (const [n, t] of Object.entries(SANDBOX_NOTES)) fs.writeFileSync(path.join(dir, n), t);
  }
  openVaultWindow(dir, false);
  return dir;
}

function validVaultName(name: string): string | null {
  const n = name.trim();
  if (!n) return "Enter a name for the vault.";
  if (/[\\/:*?"<>|]/.test(n)) return 'A vault name can\'t contain any of these characters: \\ / : * ? " < > |';
  if (n === "." || n === "..") return "That name isn't allowed.";
  return null;
}

export function createVault(name: string, parent: string): { path?: string; error?: string } {
  const bad = validVaultName(name);
  if (bad) return { error: bad };
  if (!parent || !fs.existsSync(parent)) return { error: "Choose a location for the vault." };
  const dir = path.join(parent, name.trim());
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) return { error: "A folder with that name already exists there. Pick another name or location." };
  try {
    fs.mkdirSync(path.join(dir, ".obsidian"), { recursive: true });
  } catch (e: any) {
    return { error: `Couldn't create the folder: ${e?.message ?? e}` };
  }
  openVaultWindow(dir, true);
  return { path: dir };
}

export function renameVault(dir: string, newName: string): { path?: string; error?: string } {
  const bad = validVaultName(newName);
  if (bad) return { error: bad };
  if (ctx && path.resolve(ctx.mainVaultPath()) === path.resolve(dir)) return { error: "Your synced vault can't be renamed here." };
  if (windowForVault(dir)) return { error: "Close the vault's window first, then rename it." };
  const target = path.join(path.dirname(dir), newName.trim());
  if (fs.existsSync(target)) return { error: "A folder with that name already exists." };
  try {
    fs.renameSync(dir, target);
  } catch (e: any) {
    return { error: `Couldn't rename the folder: ${e?.message ?? e}` };
  }
  const reg = readRegistry();
  reg.others = reg.others.map((o) => (path.resolve(o.path) === path.resolve(dir) ? { ...o, path: target } : o));
  writeRegistry(reg);
  return { path: target };
}

export function removeVault(dir: string): void {
  const reg = readRegistry();
  reg.others = reg.others.filter((o) => path.resolve(o.path) !== path.resolve(dir));
  writeRegistry(reg);
}

// ---------------------------------------------------------------- URIs

/** The first URI among command-line arguments, if any. */
export function uriArg(argv: string[]): string | null {
  for (const a of argv.slice(1)) if (isAppUri(a, URI_SCHEMES)) return a;
  return null;
}

/** Route a URI to the right vault window (opening it if needed). */
export function handleUri(raw: string, focused?: BrowserWindow | null): boolean {
  const u = parseAppUri(raw, URI_SCHEMES);
  if (!u) return false;
  if (u.action === "choose-vault") {
    const w = ctx?.showMain();
    if (w) send(w, { action: "choose-vault", params: u.params });
    return true;
  }
  const params = { ...u.params };
  let target: BrowserWindow | null = null;
  if (params.path) {
    const hit = vaultForPath(params.path, knownVaults().map((v) => v.path));
    if (hit) {
      params.vault = path.basename(hit.vault);
      if (hit.rel) params.file = hit.rel;
      delete params.path;
      target = openVaultWindow(hit.vault, true);
    }
  } else if (params.vault) {
    const want = params.vault.toLowerCase();
    const v = knownVaults().find((x) => path.basename(x.path).toLowerCase() === want || x.path.toLowerCase() === want);
    if (v) target = openVaultWindow(v.path, !v.isMain);
  }
  if (!target) {
    // No vault named (or not found): the focused vault window, else the main window.
    const f = focused && vaultWindows.has(focused.webContents.id) ? focused : null;
    target = f ?? ctx?.showMain() ?? null;
    if (params.vault && !knownVaults().some((x) => path.basename(x.path).toLowerCase() === params.vault.toLowerCase())) params.vaultNotFound = "true";
    if (u.params.path && !params.vault) params.pathNotFound = "true";
  }
  if (!target) return false;
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
  send(target, { action: u.action, params });
  return true;
}

function send(w: BrowserWindow, u: ParsedUri): void {
  const id = w.webContents.id;
  if (readyRenderers.has(id) && !w.webContents.isLoading()) w.webContents.send(SHELL_IPC.uri, u);
  else pendingUris.set(id, [...(pendingUris.get(id) ?? []), u]);
}

/** Register our scheme with the OS for this user (packaged builds; dev runs don't touch the registry). */
export function registerProtocols(): void {
  if (!app.isPackaged) return;
  const own = (BRAND.protocol || BRAND.name).toLowerCase();
  try {
    if (!app.isDefaultProtocolClient(own)) app.setAsDefaultProtocolClient(own);
    // obsidian:// too, but only when nothing else handles it (Obsidian isn't installed).
    if (!app.getApplicationNameForProtocol("obsidian://")) app.setAsDefaultProtocolClient("obsidian");
  } catch {
    /* registry not writable: links just won't open the app */
  }
}

// ---------------------------------------------------------------- IPC

const PAGE_SIZES = new Set(["A3", "A4", "A5", "Legal", "Letter", "Tabloid"]);
const MARGINS: Record<string, any> = {
  "0": { marginType: "default" },
  "1": { marginType: "none" },
  "2": { marginType: "custom", top: 0.25, bottom: 0.25, left: 0.25, right: 0.25 },
};

export function registerShellIpc(c: ShellContext): void {
  ctx = c;
  const winOf = (e: Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender);
  ipcMain.handle(SHELL_IPC.vaults, (e) => listVaults(e.sender));
  ipcMain.handle(SHELL_IPC.openVault, (e, dir: string, o?: { closeSender?: boolean }) => {
    const w = openVaultWindow(dir, true);
    if (w && o?.closeSender) {
      const me = winOf(e);
      const entry = me ? vaultWindows.get(me.webContents.id) : undefined;
      if (me && entry && !entry.isMain && me !== w) me.close();
    }
    return !!w;
  });
  ipcMain.handle(SHELL_IPC.createVault, (_e, name: string, parent: string) => createVault(name, parent));
  ipcMain.handle(SHELL_IPC.renameVault, (_e, dir: string, name: string) => renameVault(dir, name));
  ipcMain.handle(SHELL_IPC.removeVault, (_e, dir: string) => removeVault(dir));
  ipcMain.handle(SHELL_IPC.openSandbox, () => openSandbox());
  ipcMain.handle(SHELL_IPC.documentsDir, () => app.getPath("documents"));
  ipcMain.handle(SHELL_IPC.clipboard, (_e, op: string, text?: string) => {
    if (op === "write") clipboard.writeText(String(text ?? ""));
    else return clipboard.readText();
  });
  ipcMain.handle(SHELL_IPC.pickFile, async (e, title: string, filters?: Electron.FileFilter[]) => {
    const r = await dialog.showOpenDialog(winOf(e)!, { title, properties: ["openFile"], filters });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  ipcMain.handle(SHELL_IPC.pickFolder, async (e, title: string) => {
    const r = await dialog.showOpenDialog(winOf(e)!, { title, properties: ["openDirectory", "createDirectory"] });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  ipcMain.handle(SHELL_IPC.windowAction, (e, action: string) => {
    const w = winOf(e);
    if (!w) return null;
    if (action === "always-on-top") w.setAlwaysOnTop(!w.isAlwaysOnTop());
    else if (action === "close") w.close();
    else if (action === "open-trash") {
      // The OS trash (recycle bin), where deleted notes go by default.
      if (process.platform === "win32") spawn("explorer.exe", ["shell:RecycleBinFolder"], { detached: true, stdio: "ignore" }).unref();
      else if (process.platform === "darwin") void shell.openPath(path.join(os.homedir(), ".Trash"));
      else void shell.openExternal("trash:///");
    }
    return { alwaysOnTop: w.isAlwaysOnTop() };
  });
  ipcMain.handle(SHELL_IPC.printPdf, async (e, defaultName: string, o: PdfOptions) => {
    const w = winOf(e);
    if (!w) return null;
    const r = await dialog.showSaveDialog(w, { title: "Export to PDF", defaultPath: path.join(app.getPath("documents"), `${defaultName || "Untitled"}.pdf`), filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (r.canceled || !r.filePath) return null;
    const data = await e.sender.printToPDF({
      pageSize: (PAGE_SIZES.has(o.pageSize) ? o.pageSize : "Letter") as any,
      landscape: !!o.landscape,
      margins: MARGINS[o.margin] ?? MARGINS["0"],
      scale: Math.max(0.1, Math.min(2, (Number(o.downscalePercent) || 100) / 100)),
      printBackground: true,
      generateDocumentOutline: true,
    });
    fs.writeFileSync(r.filePath, data);
    return r.filePath;
  });
  ipcMain.handle(SHELL_IPC.debugInfo, () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    frame: readAppSettings().frame ?? "hidden",
    hardwareAcceleration: !readAppSettings().disableGpu,
    packaged: app.isPackaged,
  }));
  // The renderer tells us when it can take URIs (after its layout is ready).
  ipcMain.on(SHELL_IPC.uri, (e) => {
    readyRenderers.add(e.sender.id);
    const q = pendingUris.get(e.sender.id);
    pendingUris.delete(e.sender.id);
    for (const u of q ?? []) e.sender.send(SHELL_IPC.uri, u);
    e.sender.once("destroyed", () => readyRenderers.delete(e.sender.id));
    e.sender.once("did-start-navigation", () => readyRenderers.delete(e.sender.id));
  });
  void ensureMainVault;
}
