// Main-process side of the settings window and app-level (not per-vault) settings:
// - popout windows (settings, plugin browser, theme browser) opened by the renderer with
//   window.open("about:blank", "bedrock-popout-<name>", ...). Their DOM is driven by the vault
//   window's renderer (same JS context), so plugin setting tabs keep working unchanged.
// - window controls for those popouts (min/max/close) from the opener renderer;
// - app settings in <userData>/app-settings.json: automatic updates, hardware acceleration,
//   window frame style, language;
// - secret storage encryption for the Keychain (Electron safeStorage, OS-backed).
import { app, BrowserWindow, ipcMain, safeStorage, type BrowserWindowConstructorOptions, type WebContents } from "electron";
import fs from "node:fs";
import path from "node:path";
import { SETTINGS_IPC } from "../shared/ipc-settings";

const popouts = new Map<string, BrowserWindow>(); // `${openerId}:${frameName}` -> window

export interface AppSettings {
  updateDisabled?: boolean;
  disableGpu?: boolean;
  frame?: "hidden" | "custom" | "native";
  language?: string;
}

function appSettingsFile(): string {
  return path.join(app.getPath("userData"), "app-settings.json");
}

export function readAppSettings(): AppSettings {
  try {
    return JSON.parse(fs.readFileSync(appSettingsFile(), "utf8")) ?? {};
  } catch {
    return {};
  }
}

function writeAppSettings(s: AppSettings): void {
  // Only non-default values are kept.
  const out: AppSettings = {};
  if (s.updateDisabled) out.updateDisabled = true;
  if (s.disableGpu) out.disableGpu = true;
  if (s.frame && s.frame !== "hidden") out.frame = s.frame;
  if (s.language && s.language !== "en") out.language = s.language;
  try {
    if (Object.keys(out).length) fs.writeFileSync(appSettingsFile(), JSON.stringify(out, null, 2));
    else fs.rmSync(appSettingsFile(), { force: true });
  } catch {
    /* read-only app data: settings just don't persist */
  }
}

/** Must run before app ready (hardware acceleration can only be switched off then). */
export function applyEarlyAppSettings(): void {
  if (readAppSettings().disableGpu) app.disableHardwareAcceleration();
}

/** Window-open handler result for our popouts; null for anything else. */
export function popoutWindowOptions(frameName: string, features: string): BrowserWindowConstructorOptions | null {
  if (!frameName.startsWith("bedrock-popout")) return null;
  const f = Object.fromEntries(
    features
      .split(",")
      .map((kv) => kv.trim().split("="))
      .filter((kv) => kv.length === 2),
  );
  const isMac = process.platform === "darwin";
  const frame = readAppSettings().frame === "native";
  const overlayH = Number(f.overlay) || 30;
  return {
    x: f.left !== undefined ? Number(f.left) : undefined,
    y: f.top !== undefined ? Number(f.top) : undefined,
    width: Number(f.width) || 900,
    height: Number(f.height) || 700,
    minWidth: Number(f.minWidth) || 600,
    minHeight: Number(f.minHeight) || 400,
    // Same window chrome as the vault window: no frame, native caption buttons over our title bar
    // (titleBarOverlay), recoloured from the renderer on theme changes. Native frame if chosen.
    frame: frame || isMac,
    titleBarStyle: isMac ? "hiddenInset" : frame ? undefined : "hidden",
    titleBarOverlay: isMac || frame ? undefined : { color: f.background ? decodeURIComponent(f.background) : "#00000000", symbolColor: f.symbol ? decodeURIComponent(f.symbol) : "#888888", height: overlayH },
    backgroundColor: f.background ? decodeURIComponent(f.background) : undefined,
    autoHideMenuBar: true,
    show: true,
    // Same web preferences as the vault window: the popout must stay in the opener's process and
    // world so the opener can build its DOM synchronously (Obsidian does the same).
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, spellcheck: true, webviewTag: false },
  };
}

/** Called from the vault window's did-create-window. */
export function registerPopout(opener: WebContents, frameName: string, win: BrowserWindow): void {
  const key = `${opener.id}:${frameName}`;
  popouts.set(key, win);
  win.removeMenu();
  const send = () => {
    if (opener.isDestroyed() || win.isDestroyed()) return;
    opener.send(SETTINGS_IPC.popoutState, frameName, { maximized: win.isMaximized(), focused: win.isFocused(), fullscreen: win.isFullScreen() });
  };
  for (const ev of ["maximize", "unmaximize", "focus", "blur", "enter-full-screen", "leave-full-screen"] as const) win.on(ev as any, send);
  win.on("closed", () => {
    popouts.delete(key);
    if (!opener.isDestroyed()) opener.send(SETTINGS_IPC.popoutClosed, frameName);
  });
  // Links clicked inside a popout go to the browser, never navigate the popout.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
}

export function registerSettingsIpc(): void {
  ipcMain.handle(SETTINGS_IPC.popoutControl, (e, frameName: string, action: string) => {
    const w = popouts.get(`${e.sender.id}:${frameName}`);
    if (!w || w.isDestroyed()) return null;
    if (action === "minimize") w.minimize();
    else if (action === "maximize") w.isMaximized() ? w.unmaximize() : w.maximize();
    else if (action === "close") w.close();
    else if (action === "focus") {
      if (w.isMinimized()) w.restore();
      w.focus();
    } else if (action === "devtools") w.webContents.toggleDevTools();
    else if (action === "always-on-top") w.setAlwaysOnTop(!w.isAlwaysOnTop());
    else if (action.startsWith("overlay:")) {
      const [color, symbolColor, h] = action.slice(8).split("|");
      try {
        w.setTitleBarOverlay({ color, symbolColor, height: Number(h) || 30 });
      } catch {
        /* native frame: no overlay */
      }
    }
    return { maximized: w.isMaximized(), focused: w.isFocused(), fullscreen: w.isFullScreen(), alwaysOnTop: w.isAlwaysOnTop() };
  });
  ipcMain.handle(SETTINGS_IPC.getAppSettings, () => readAppSettings());
  ipcMain.handle(SETTINGS_IPC.setAppSettings, (_e, patch: Partial<AppSettings>) => {
    const s = { ...readAppSettings(), ...patch };
    writeAppSettings(s);
    return readAppSettings();
  });
  ipcMain.handle(SETTINGS_IPC.relaunch, () => {
    app.relaunch();
    app.exit(0);
  });
  ipcMain.handle(SETTINGS_IPC.secretsAvailable, () => safeStorage.isEncryptionAvailable());
  ipcMain.handle(SETTINGS_IPC.secretsEncrypt, (_e, plain: string) => {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.encryptString(plain).toString("base64");
  });
  ipcMain.handle(SETTINGS_IPC.secretsDecrypt, (_e, b64: string) => {
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(b64, "base64"));
    } catch {
      return null;
    }
  });
  ipcMain.handle(SETTINGS_IPC.getGpuInfo, () => ({ disabled: !!readAppSettings().disableGpu }));
  ipcMain.handle(SETTINGS_IPC.spellcheckLanguages, (e) => ({
    available: e.sender.session.availableSpellCheckerLanguages ?? [],
    current: e.sender.session.getSpellCheckerLanguages(),
  }));
  ipcMain.handle(SETTINGS_IPC.setSpellcheckLanguages, (e, langs: string[]) => {
    try {
      e.sender.session.setSpellCheckerLanguages(langs);
    } catch {
      /* macOS uses the system spellchecker */
    }
    return e.sender.session.getSpellCheckerLanguages();
  });
}
