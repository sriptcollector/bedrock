// Main process entry: single instance, the one vault window, tray, hub contract, IPC, updates.
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { BRAND } from "../shared/brand";
import { IPC, type BootInfo } from "../shared/ipc";
import * as account from "./account";
import * as hub from "./hub";
import { createTray, refreshTray } from "./tray";
import { startAutoUpdate, checkNow } from "./updater";
import { ensureMainVault, importIntoMain, isVaultFolder, readRegistry, rememberOther } from "./vaults";
import { createVaultWindow, vaultWindows } from "./windows";
import { runSelftest } from "./selftest";
import { startSync, stopSync } from "./sync";
import { installCrashHandling, log } from "./log";
import { startAgents, stopAgents } from "./agents/host";
import { runCli } from "../cli/main";

// ---- identity & app data (before anything touches userData) ----
app.setName(BRAND.displayName);
if (process.platform === "win32") app.setAppUserModelId(BRAND.appId);
// %APPDATA%\<appId> / ~/Library/Application Support/<appId>: where the hub looks for running.json.
const userDataOverride = process.env.BEDROCK_USER_DATA;
app.setPath("userData", userDataOverride ? path.resolve(userDataOverride) : path.join(app.getPath("appData"), BRAND.appId));
account.captureEnvToken();
installCrashHandling();
log("info", `start ${app.getVersion()} ${process.platform} args=${process.argv.slice(1).filter((a) => a.startsWith("--")).join(" ")}`);

function argValue(argv: string[], flag: string): string | null {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
}

// ---- agent command line: `<exe> --cli <args>` and `<exe> --mcp` (stdio MCP server) ----
// No window, no single-instance lock, no sync: talks to the running app or works on the vault folder.
const agentArgs = agentCliArgs(process.argv);

// ---- headless self test: `--selftest <vaultPath>` ----
const selftestVault = argValue(process.argv, "--selftest");
if (agentArgs) {
  app.disableHardwareAcceleration();
  app.dock?.hide();
  runCli(agentArgs).then(
    (code) => app.exit(code),
    (e) => {
      process.stderr.write(String(e?.stack ?? e) + "\n");
      app.exit(1);
    },
  );
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
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
    hub.writeState(mainWin);
    refreshTray();
  };
  const hide = () => {
    for (const w of BrowserWindow.getAllWindows()) w.hide();
    hub.writeState(mainWin);
    refreshTray();
  };
  const quit = () => {
    quitting = true;
    hub.removeState();
    app.quit();
  };

  function openMain(visible: boolean): BrowserWindow {
    const vaultPath = devVault ? path.resolve(devVault) : ensureMainVault();
    const win = createVaultWindow({ vaultPath, isMain: true, show: visible, openFile: hub.pathArg(process.argv) ?? undefined, smokeTest });
    win.on("close", (e) => {
      // Closing the main window hides it to the tray so sync keeps running; Quit is in the tray.
      if (!quitting && !smokeTest) {
        e.preventDefault();
        win.hide();
        hub.writeState(win);
        refreshTray();
      }
    });
    win.on("show", () => hub.writeState(win));
    win.on("hide", () => hub.writeState(win));
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
      // let the sync engine save its state (a few ms) before the process exits
      e.preventDefault();
      syncStopped = true;
      const done = () => app.quit();
      Promise.race([Promise.all([stopSync(), stopAgents()]), new Promise((r) => setTimeout(r, 3000))]).then(done, done);
    }
  });
  app.on("window-all-closed", () => {
    if (smokeTest || process.platform !== "darwin") {
      if (smokeTest) app.quit();
    }
  });
  app.on("activate", () => show());

  registerIpc({ openOtherVault });

  app.whenReady().then(() => {
    if (process.platform !== "darwin") Menu.setApplicationMenu(null);
    else Menu.setApplicationMenu(macMenu());
    if (process.argv.includes("--quit")) return quit(); // nothing running: nothing to quit
    const startHidden = process.argv.includes("--hide");
    mainWin = openMain(!startHidden);
    hub.writeState(mainWin);
    // Sync runs in the main process for the one vault, whether or not the window is visible.
    startSync({ vaultPath: devVault ? path.resolve(devVault) : ensureMainVault(), smokeTest });
    // Agent access (MCP over HTTP + REST on 127.0.0.1, token-protected) for the same vault.
    void startAgents({ vaultPath: devVault ? path.resolve(devVault) : ensureMainVault(), showMain: show });
    if (!smokeTest) {
      createTray({ show, hide, quit, isVisible: () => !!mainWin && !mainWin.isDestroyed() && mainWin.isVisible() });
      startAutoUpdate();
    }
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
      w.setTitleBarOverlay({ color: o.color, symbolColor: o.symbolColor, height: 39 });
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
