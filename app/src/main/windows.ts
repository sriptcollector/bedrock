// Vault windows. The main window shows the one vault; "Open another folder as vault" opens extra
// windows. Frame: frameless on Windows/Linux (our own title bar with min/max/close, drawn by the
// renderer), hidden-inset traffic lights on macOS.
import { app, BrowserWindow, screen, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { IPC } from "../shared/ipc";
import { BRAND } from "../shared/brand";

export interface VaultWindow {
  win: BrowserWindow;
  vaultPath: string;
  isMain: boolean;
  openFile?: string;
}

export const vaultWindows = new Map<number, VaultWindow>();
const isMac = process.platform === "darwin";

interface Bounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

function boundsFile(): string {
  return path.join(app.getPath("userData"), "window-state.json");
}

function loadBounds(key: string): Bounds {
  try {
    const all = JSON.parse(fs.readFileSync(boundsFile(), "utf8"));
    const b = all[key] as Bounds | undefined;
    if (b && b.width > 300 && b.height > 200) {
      const visible = screen.getAllDisplays().some((d) => {
        const a = d.workArea;
        return b.x === undefined || (b.x! < a.x + a.width - 50 && b.x! + b.width > a.x + 50 && b.y! >= a.y - 20 && b.y! < a.y + a.height - 50);
      });
      if (visible) return b;
    }
  } catch {
    /* default */
  }
  return { width: 1200, height: 800 };
}

function saveBounds(key: string, win: BrowserWindow): void {
  try {
    let all: Record<string, Bounds> = {};
    try {
      all = JSON.parse(fs.readFileSync(boundsFile(), "utf8"));
    } catch {
      /* none */
    }
    all[key] = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    fs.writeFileSync(boundsFile(), JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export function iconPath(): string {
  return path.join(__dirname, process.platform === "win32" ? "icon.ico" : "icon.png");
}

export function createVaultWindow(opts: { vaultPath: string; isMain: boolean; show: boolean; openFile?: string; smokeTest?: boolean }): BrowserWindow {
  const key = opts.isMain ? "main" : opts.vaultPath;
  const b = loadBounds(key);
  const win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    minWidth: 400,
    minHeight: 300,
    show: false,
    title: BRAND.displayName,
    icon: fs.existsSync(iconPath()) ? iconPath() : undefined,
    backgroundColor: "#1e1e1e",
    // Like Obsidian 1.14 on Windows: no native frame, but native caption buttons drawn over our
    // tab bar (titleBarOverlay). That gives working minimize/maximize/close, Windows snap layouts on
    // hover, and double-click/drag on our -webkit-app-region: drag areas.
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    titleBarOverlay: isMac ? undefined : { color: "#00000000", symbolColor: "#b3b3b3", height: 39 },
    trafficLightPosition: isMac ? { x: 12, y: 12 } : undefined,
    webPreferences: {
      // Like Obsidian: community plugins expect require('fs'), require('electron'), require('obsidian').
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      spellcheck: true,
      webviewTag: false,
      preload: path.join(__dirname, "preload.js"),
      additionalArguments: opts.smokeTest ? ["--bedrock-smoke"] : [],
    },
  });
  const entry: VaultWindow = { win, vaultPath: opts.vaultPath, isMain: opts.isMain, openFile: opts.openFile };
  vaultWindows.set(win.webContents.id, entry);

  if (b.maximized) win.maximize();
  win.once("ready-to-show", () => {
    if (opts.show) win.show();
  });
  const sendState = () => {
    if (win.isDestroyed()) return;
    win.webContents.send(IPC.windowStateChanged, { maximized: win.isMaximized(), fullscreen: win.isFullScreen(), focused: win.isFocused() });
  };
  for (const ev of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen", "focus", "blur"] as const) win.on(ev as any, sendState);
  win.on("close", () => saveBounds(key, win));
  const id = win.webContents.id;
  win.on("closed", () => vaultWindows.delete(id));

  // Links open in the browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file:")) {
      e.preventDefault();
      if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
    }
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  return win;
}
