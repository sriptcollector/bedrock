// Plain-text clipboard through the main process (Electron's renderer clipboard module is gone in
// recent versions, and navigator.clipboard needs a focused document).
import { ipcRenderer } from "electron";
import { SHELL_IPC } from "../../shared/ipc-shell";

export function writeClipboard(text: string): Promise<void> {
  return ipcRenderer.invoke(SHELL_IPC.clipboard, "write", text);
}

export function readClipboard(): Promise<string> {
  return ipcRenderer.invoke(SHELL_IPC.clipboard, "read");
}
