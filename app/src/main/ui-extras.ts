// Main-process helpers for two Settings options:
// - Interface › Advanced › Native menus: context menus shown as the operating system's own menus.
//   The renderer sends the menu as a template; we pop it up and answer with the chosen item's path.
// - Appearance › Advanced › Custom app icon: a picture the person chooses becomes the window /
//   taskbar icon (stored as <appData>/custom-icon.png; removed by "restore default").
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, type MenuItemConstructorOptions } from "electron";
import fs from "node:fs";
import path from "node:path";
import { IPC } from "../shared/ipc";

export interface NativeMenuItem {
  type?: "separator";
  label?: string;
  checked?: boolean | null;
  disabled?: boolean;
  submenu?: NativeMenuItem[];
}

export const customIconFile = () => path.join(app.getPath("userData"), "custom-icon.png");

export function installUiExtras(defaultIcon: () => string): void {
  ipcMain.handle(IPC.nativeMenu, (e, req: { items: NativeMenuItem[]; x: number; y: number }) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    return new Promise<number[] | null>((resolve) => {
      let chosen: number[] | null = null;
      const build = (items: NativeMenuItem[], at: number[]): MenuItemConstructorOptions[] =>
        items.map((it, i) =>
          it.type === "separator"
            ? { type: "separator" }
            : {
                label: it.label ?? "",
                type: it.checked === true || it.checked === false ? "checkbox" : "normal",
                checked: !!it.checked,
                enabled: !it.disabled,
                submenu: it.submenu ? build(it.submenu, [...at, i]) : undefined,
                click: it.submenu ? undefined : () => (chosen = [...at, i]),
              },
        );
      const menu = Menu.buildFromTemplate(build(req.items ?? [], []));
      menu.popup({ window: win, x: Math.round(req.x), y: Math.round(req.y), callback: () => setTimeout(() => resolve(chosen), 0) });
    });
  });

  const applyIcon = () => {
    const p = fs.existsSync(customIconFile()) ? customIconFile() : defaultIcon();
    if (!fs.existsSync(p)) return;
    const img = nativeImage.createFromPath(p);
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.setIcon(img);
  };
  ipcMain.handle(IPC.appIcon, async (e, op: "get" | "choose" | "reset") => {
    if (op === "choose") {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
      const r = await dialog.showOpenDialog(win!, { title: "Choose an app icon", properties: ["openFile"], filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "ico", "bmp", "gif", "webp"] }] });
      if (r.canceled || !r.filePaths[0]) return fs.existsSync(customIconFile());
      const img = nativeImage.createFromPath(r.filePaths[0]);
      if (img.isEmpty()) throw new Error("That file isn't a picture the app can read.");
      fs.writeFileSync(customIconFile(), img.resize({ width: 256, height: 256, quality: "best" }).toPNG());
      applyIcon();
    } else if (op === "reset") {
      fs.rmSync(customIconFile(), { force: true });
      applyIcon();
    }
    return fs.existsSync(customIconFile());
  });
}
