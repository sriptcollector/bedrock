// Main process entry: single instance, the one vault window, hub contract, IPC, updates.
// Nothing runs in the background: no tray, no launch at login, closing the last window quits.
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { BRAND } from "../shared/brand";
import { IPC, type BootInfo } from "../shared/ipc";
import * as account from "./account";
import * as hub from "./hub";
import { startAutoUpdate, checkNow, registerUpdaterIpc } from "./updater";
import { ensureMainVault, importIntoMain, isVaultFolder, readRegistry, rememberOther } from "./vaults";
import { isAccessErrorCode, vaultAccessMessage } from "../shared/vault-access";
import { createVaultWindow, flushAllWindows, iconPath, vaultWindows } from "./windows";
import { runSelftest } from "./selftest";
import { applyEarlyAppSettings, registerSettingsIpc, readAppSettings } from "./settings-host";
import { startSync, stopSync } from "./sync";
import { installCrashHandling, log } from "./log";
import { startAgents, stopAgents } from "./agents/host";
import { installWebviewer } from "./webviewer";
import { installUiExtras } from "./ui-extras";
import { registerShellIpc, handleUri, uriArg, registerProtocols } from "./shell-host";
import { spawn } from "node:child_process";
import { registerEditorIpc } from "./editor-ipc";

// ---- identity & app data (before anything touches userData) ----
app.setName(BRAND.displayName);
if (process.platform === "win32") app.setAppUserModelId(BRAND.appId);
// %APPDATA%\<appId> / ~/Library/Application Support/<appId>: where the hub looks for running.json.
const userDataOverride = process.env.BEDROCK_USER_DATA;
// ---- agent command line: `<exe> --cli <args>` and `<exe> --mcp` (stdio MCP server) ----
// No window, no single-instance lock, no sync: talks to the running app or works on the vault folder.
// This process keeps Chromium's own files out of the app's folder (the running app has them open).
const agentArgs = agentCliArgs(process.argv);
if (agentArgs) app.setPath("userData", path.join(app.getPath("temp"), `${BRAND.appId}-cli`));
else app.setPath("userData", userDataOverride ? path.resolve(userDataOverride) : path.join(app.getPath("appData"), BRAND.appId));
account.captureEnvToken();
if (!agentArgs) {
  installCrashHandling();
  log("info", `start ${app.getVersion()} ${process.platform} args=${process.argv.slice(1).filter((a) => a.startsWith("--")).join(" ")}`);
  applyEarlyAppSettings();
}

function argValue(argv: string[], flag: string): string | null {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
}

// ---- headless self test: `--selftest <vaultPath>` ----
const selftestVault = argValue(process.argv, "--selftest");
if (agentArgs) {
  app.disableHardwareAcceleration();
  app.dock?.hide();
  // Electron's main process can't read stdin reliably, so run dist/cli.js with this same
  // executable in Node mode and hand it our stdin/stdout/stderr (the MCP client's pipes).
  const child = spawn(process.execPath, [path.join(app.getAppPath(), "dist", "cli.js"), ...agentArgs], {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  child.on("exit", (code) => app.exit(code ?? 1));
  child.on("error", (e) => {
    process.stderr.write(`Couldn't start the command line: ${e.message}\n`);
    app.exit(1);
  });
} else if (process.argv.includes("--selftest")) {
  app.whenReady().then(async () => {
    const code = await runSelftest(selftestVault ?? "").catch((e) => {
      console.error(e);
      return 1;
    });
    app.exit(code);
  });
} else {
  startApp();
}

function agentCliArgs(argv: string[]): string[] | null {
  const cli = argv.indexOf("--cli");
  if (cli >= 0) return argv.slice(cli + 1);
  const mcp = argv.indexOf("--mcp");
  if (mcp >= 0) return ["mcp", ...argv.slice(mcp + 1)];
  return null;
}

function startApp(): void {
  const smokeTest = process.argv.includes("--smoke-test");
  // Single instance. Tests run with their own userData so they can coexist with a real install.
  if (!smokeTest && !app.requestSingleInstanceLock()) {
    app.exit(0);
    return;
  }

  let mainWin: BrowserWindow | null = null;
  let quitting = false;
  const devVault = argValue(process.argv, "--vault");

  const show = () => {
    if (!mainWin || mainWin.isDestroyed()) mainWin = openMain(true);
    if (!mainWin) return;
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
    hub.writeState(mainWin);
  };
  // The hub's "hide" minimizes: the app never hides itself away and keeps running unseen.
  const hide = () => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && w.isMinimizable()) w.minimize();
    hub.writeState(mainWin);
  };
  const quit = () => {
    quitting = true;
    hub.removeState();
    app.quit();
  };

  /** The one vault's path, or null after telling the person why it can't be opened. */
  function mainVaultPathOrExplain(): string | null {
    try {
      return devVault ? path.resolve(devVault) : ensureMainVault();
    } catch (e: any) {
      log("error", `main vault: ${e?.code ?? ""} ${e?.message ?? e}`);
      dialog.showMessageBoxSync({
        type: "error",
        title: BRAND.displayName,
        message: isAccessErrorCode(e) ? vaultAccessMessage(process.platform) : `${BRAND.displayName} couldn't open your notes folder.`,
        detail: `${readRegistry().main}\n${e?.message ?? e}`,
      });
      return null;
    }
  }

  function openMain(visible: boolean): BrowserWindow | null {
    const vaultPath = mainVaultPathOrExplain();
    if (!vaultPath) return null;
    const win = createVaultWindow({ vaultPath, isMain: true, show: visible, openFile: hub.pathArg(process.argv) ?? undefined, smokeTest });
    // Closing the window really closes it; when it was the last one the app quits (window-all-closed).
    for (const ev of ["show", "hide", "minimize", "restore"] as const) win.on(ev as any, () => hub.writeState(win));
    return win;
  }

  function openOtherVault(dir: string): void {
    const existing = [...vaultWindows.values()].find((v) => path.resolve(v.vaultPath) === path.resolve(dir));
    if (existing) {
      existing.win.show();
      existing.win.focus();
      return;
    }
    rememberOther(dir);
    createVaultWindow({ vaultPath: dir, isMain: false, show: true });
  }

  function handleArgs(argv: string[]): void {
    switch (hub.parseHubArgs(argv)) {
      case "quit":
        return quit();
      case "hide":
        return hide();
      case "show":
        return show();
      default: {
        // A bedrock:// (or obsidian://) URI goes to the vault it names.
        const uri = uriArg(argv);
        if (uri) {
          handleUri(uri, BrowserWindow.getFocusedWindow());
          return;
        }
        // Plain relaunch (or hub "open"): show. A .md path opens that note.
        show();
        const p = hub.pathArg(argv);
        if (p && mainWin) mainWin.webContents.send(IPC.openPath, p);
      }
    }
  }

  app.on("second-instance", (_e, argv) => handleArgs(argv));
  let syncStopped = false;
  app.on("before-quit", (e) => {
    quitting = true;
    hub.removeState();
    if (!syncStopped) {
      // Windows write unsaved edits first (each answers or times out after 3 s), then the sync
      // engine saves its state (a few ms) before the process exits.
      e.preventDefault();
      syncStopped = true;
      const done = () => app.quit();
      flushAllWindows()
        .then(() => Promise.race([Promise.all([stopSync(), stopAgents()]), new Promise((r) => setTimeout(r, 3000))]))
        .then(done, done);
    }
  });
  // Every OS, macOS included: no windows left means the app quits (sync and agent access stop in before-quit).
  app.on("window-all-closed", () => {
    if (!quitting) quit();
  });
  app.on("activate", () => show());

  registerIpc({ openOtherVault });
  registerSettingsIpc();
  installWebviewer();
  installUiExtras(iconPath);
  registerUpdaterIpc();
  registerShellIpc({
    showMain: () => {
      show();
      return mainWin;
    },
    mainVaultPath: () => (devVault ? path.resolve(devVault) : ensureMainVault()),
  });
  // macOS delivers URIs as an event instead of arguments.
  app.on("open-url", (e, url) => {
    e.preventDefault();
    void app.whenReady().then(() => handleUri(url, BrowserWindow.getFocusedWindow()));
  });
  registerEditorIpc();

  app.whenReady().then(() => {
    if (process.platform !== "darwin") Menu.setApplicationMenu(null);
    else Menu.setApplicationMenu(macMenu());
    if (process.argv.includes("--quit")) return quit(); // nothing running: nothing to quit
    // Never launched at login: clear any login item an earlier version (or the OS) left behind.
    if (!smokeTest && (process.platform === "darwin" || process.platform === "win32")) {
      try {
        app.setLoginItemSettings({ openAtLogin: false });
      } catch (e) {
        log("warn", `login item: ${(e as Error)?.message ?? e}`);
      }
    }
    // Hidden-start flags (--hide, --hidden) are ignored: the app always opens with its window shown.
    mainWin = openMain(true);
    if (!mainWin) return quit(); // the folder can't be opened: the dialog said what to do
    hub.writeState(mainWin);
    if (!smokeTest) registerProtocols();
    const firstUri = uriArg(process.argv);
    if (firstUri) handleUri(firstUri, mainWin);
    // Sync runs in the main process for the one vault while the app is open; it stops when the app quits.
    startSync({ vaultPath: devVault ? path.resolve(devVault) : ensureMainVault(), smokeTest });
    // Agent access (MCP over HTTP + REST on 127.0.0.1, token-protected) for the same vault.
    void startAgents({ vaultPath: devVault ? path.resolve(devVault) : ensureMainVault(), showMain: show });
    if (!smokeTest) startAutoUpdate();
  });
}

function macMenu(): Menu {
  return Menu.buildFromTemplate([
    { role: "appMenu" },
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]);
}

function registerIpc(ctx: { openOtherVault: (dir: string) => void }): void {
  const winOf = (e: Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender);

  ipcMain.handle(IPC.bootInfo, (e): BootInfo => {
    const v = vaultWindows.get(e.sender.id);
    const vaultPath = v?.vaultPath ?? ensureMainVault();
    return {
      vaultPath,
      vaultName: path.basename(vaultPath),
      isMainVault: v?.isMain ?? true,
      platform: process.platform,
      version: app.getVersion(),
      userData: app.getPath("userData"),
      resourcesPath: process.resourcesPath,
      smokeTest: process.argv.includes("--smoke-test"),
      openFile: v?.openFile,
    };
  });

  ipcMain.handle(IPC.windowControl, (e, action: string) => {
    const w = winOf(e);
    if (!w) return;
    if (action === "minimize") w.minimize();
    else if (action === "maximize") (w.isMaximized() ? w.unmaximize() : w.maximize());
    else if (action === "close") w.close();
    else if (action === "toggle-devtools") w.webContents.toggleDevTools();
    else if (action === "reload") w.webContents.reload();
  });
  ipcMain.handle(IPC.titleBarOverlay, (e, o: { color: string; symbolColor: string }) => {
    const w = winOf(e);
    if (!w || process.platform === "darwin") return;
    try {
      w.setTitleBarOverlay({ color: o.color, symbolColor: o.symbolColor, height: readAppSettings().frame === "custom" ? 30 : 39 });
    } catch {
      /* window without an overlay */
    }
  });
  ipcMain.handle(IPC.windowState, (e) => {
    const w = winOf(e);
    return { maximized: !!w?.isMaximized(), fullscreen: !!w?.isFullScreen(), focused: !!w?.isFocused() };
  });
  ipcMain.handle(IPC.setTitle, (e, title: string) => winOf(e)?.setTitle(title));

  ipcMain.handle(IPC.openVaultDialog, async (e) => {
    const w = winOf(e);
    const r = await dialog.showOpenDialog(w!, { title: "Open folder as vault", properties: ["openDirectory", "createDirectory"] });
    if (r.canceled || !r.filePaths[0]) return null;
    ctx.openOtherVault(r.filePaths[0]);
    return r.filePaths[0];
  });
  ipcMain.handle(IPC.openVault, (_e, dir: string) => {
    if (!isVaultFolder(dir)) return false;
    ctx.openOtherVault(dir);
    return true;
  });
  ipcMain.handle(IPC.vaultList, () => readRegistry());
  ipcMain.handle(IPC.pickFolder, async (e) => {
    const r = await dialog.showOpenDialog(winOf(e)!, { title: "Choose a vault folder", properties: ["openDirectory"] });
    return r.canceled ? null : r.filePaths[0] ?? null;
  });
  ipcMain.handle(IPC.importIntoMainVault, (_e, src: string) => importIntoMain(src));

  ipcMain.handle(IPC.revealInFolder, (_e, p: string) => shell.showItemInFolder(p));
  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    if (/^(https?:|mailto:)/i.test(url)) return shell.openExternal(url);
    if (/^file:/i.test(url) || path.isAbsolute(url)) return shell.openPath(url.replace(/^file:\/\/\/?/i, ""));
  });
  ipcMain.handle(IPC.trashItem, async (_e, p: string) => {
    try {
      await shell.trashItem(p);
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle(IPC.getAccount, () => account.account());
  ipcMain.handle(IPC.checkForUpdates, () => checkNow());
}

// Keep the bundle from tree-shaking fs (used by sub-modules at runtime).
void fs;
