// Tray icon with Show / Hide / Quit (Toolbay tools live in the tray while hidden).
import { Menu, Tray, nativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { BRAND } from "../shared/brand";

let tray: Tray | null = null;

export function createTray(actions: { show: () => void; hide: () => void; quit: () => void; isVisible: () => boolean }): Tray {
  const isMac = process.platform === "darwin";
  const file = path.join(__dirname, isMac ? "trayTemplate.png" : "tray.png");
  let img = fs.existsSync(file) ? nativeImage.createFromPath(file) : nativeImage.createEmpty();
  if (isMac && !img.isEmpty()) img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip(BRAND.displayName);
  const rebuild = () => {
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Show ${BRAND.displayName}`, click: actions.show },
        { label: "Hide", click: actions.hide, enabled: actions.isVisible() },
        { type: "separator" },
        { label: `Quit ${BRAND.displayName}`, click: actions.quit },
      ]),
    );
  };
  rebuild();
  tray.on("click", () => (actions.isVisible() ? actions.hide() : actions.show()));
  (tray as any).rebuild = rebuild;
  return tray;
}

export function refreshTray(): void {
  (tray as any)?.rebuild?.();
}
