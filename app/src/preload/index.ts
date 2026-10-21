// Preload. The renderer already has Node (nodeIntegration, like Obsidian), so this only installs a
// tiny typed bridge used by our own UI code; plugins may use require('electron') directly.
import { ipcRenderer } from "electron";

(window as any).bedrockNative = {
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, cb: (...args: any[]) => void) => {
    const h = (_e: unknown, ...a: any[]) => cb(...a);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
};
