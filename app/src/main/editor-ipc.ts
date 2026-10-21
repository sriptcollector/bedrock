// Main-process side of editor features: export to PDF (printToPDF of the window while the
// renderer shows only the print container), spellcheck languages and the custom dictionary,
// and window.open() popout windows for workspace tabs.
import { BrowserWindow, dialog, ipcMain, session, type IpcMainInvokeEvent } from "electron";
import fs from "node:fs";
import path from "node:path";
import { EDITOR_IPC } from "../shared/editor-ipc";

export interface PdfRequest {
  defaultPath: string;
  pageSize: string;
  landscape: boolean;
  /** Obsidian's margin values: "0" default, "1" none, "2" minimal. */
  margin: string;
  /** 10..200 */
  scale: number;
}

const winOf = (e: IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender);

export function registerEditorIpc(): void {
  ipcMain.handle(EDITOR_IPC.pickPdfPath, async (e, defaultPath: string) => {
    const win = winOf(e);
    const r = await dialog.showSaveDialog(win!, { defaultPath, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    return r.canceled ? null : r.filePath ?? null;
  });
  ipcMain.handle(EDITOR_IPC.printToPdf, async (e, req: PdfRequest & { filePath: string }) => {
    // Inches: default ≈ 0.4", minimal 0.1", none 0.
    const m = req.margin === "1" ? 0 : req.margin === "2" ? 0.1 : 0.4;
    const margins = { top: m, bottom: m, left: m, right: m };
    const data = await e.sender.printToPDF({
      pageSize: req.pageSize as any,
      landscape: !!req.landscape,
      margins,
      scale: Math.max(0.1, Math.min(2, (req.scale || 100) / 100)),
      printBackground: true,
      generateDocumentOutline: true,
    });
    fs.mkdirSync(path.dirname(req.filePath), { recursive: true });
    fs.writeFileSync(req.filePath, data);
    return req.filePath;
  });
  ipcMain.handle(EDITOR_IPC.spellcheckInfo, () => ({
    available: session.defaultSession.availableSpellCheckerLanguages,
    current: session.defaultSession.getSpellCheckerLanguages(),
  }));
  ipcMain.handle(EDITOR_IPC.setSpellcheckLanguages, (_e, langs: string[]) => {
    const avail = new Set(session.defaultSession.availableSpellCheckerLanguages);
    session.defaultSession.setSpellCheckerLanguages(langs.filter((l) => avail.has(l)));
    return session.defaultSession.getSpellCheckerLanguages();
  });
  ipcMain.handle(EDITOR_IPC.addToDictionary, (_e, word: string) => session.defaultSession.addWordToSpellCheckerDictionary(word));
}

/** Options for popout windows the renderer opens with window.open("about:blank", "bedrock-popout-…"). */
export function popoutWindowOptions(parent: BrowserWindow, features: string): Electron.BrowserWindowConstructorOptions {
  const num = (k: string) => {
    const m = new RegExp(`${k}=(\\d+)`).exec(features);
    return m ? Number(m[1]) : undefined;
  };
  const isMac = process.platform === "darwin";
  return {
    width: num("width") ?? 800,
    height: num("height") ?? 600,
    x: num("left"),
    y: num("top"),
    minWidth: 300,
    minHeight: 200,
    frame: isMac,
    titleBarStyle: isMac ? "hiddenInset" : undefined,
    backgroundColor: parent.getBackgroundColor?.() ?? "#1e1e1e",
    icon: undefined,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, spellcheck: true },
  };
}
