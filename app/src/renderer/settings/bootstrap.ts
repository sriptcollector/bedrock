// Startup wiring for settings-owned features, kept out of app.ts so the shared file only gets a
// couple of calls: config folder override, keychain, core plugins (with their behaviour),
// zoom, spellcheck languages, "Default file to open", window zoom commands and update checks.
import { SecretStorage } from "./secret-storage";
import { getZoom, setZoom } from "./tabs/interface";
import { applySpellcheckLanguages } from "./tabs/editor";
import { registerCorePlugins } from "../core-plugins";
import { Notice } from "../ui/notice";
import { installPluginCompat } from "../api/compat";

/** Before vault.loadConfig(): per-vault override of the config folder (kept outside the vault). */
export function applyConfigDirOverride(app: any): void {
  const dir = app.loadLocalStorage?.("config");
  if (dir && /^\.[^/\\]+$/.test(dir)) app.vault.configDir = dir;
}

/** After the DOM, commands and hotkeys exist and before the layout loads. */
export async function startSettingsFeatures(app: any): Promise<void> {
  app.secretStorage = app.secretStorage ?? new SecretStorage(app);
  await app.secretStorage.load().catch((e: any) => console.error(e));
  if (getZoom(app)) setZoom(app, getZoom(app));
  void applySpellcheckLanguages(app);
  addWindowCommands(app);
  addAppMethods(app);
  installPluginCompat(app);
  registerCorePlugins(app);
  await app.internalPlugins.load();
}

/** After the layout is ready: "Default file to open" and the plugin update check. */
export async function afterLayoutSettingsFeatures(app: any): Promise<void> {
  const ob: string = app.vault.getConfig("openBehavior") || "";
  try {
    if (ob === "daily") await app.commands.executeCommandById("daily-notes");
    else if (ob === "new") await app.commands.executeCommandById("file-explorer:new-file");
    else if (ob.startsWith("file:")) {
      const f = app.vault.getFileByPath(ob.slice(5));
      if (f) await app.workspace.getLeaf(false).openFile(f);
    }
  } catch (e) {
    console.error(e);
  }
  if (localStorage.getItem("plugin-automatically-check-for-updates") === "true" && app.plugins.isEnabled() && Object.keys(app.plugins.manifests).length) {
    setTimeout(async () => {
      try {
        const { checkPluginUpdates } = await import("../plugins/browser/catalog");
        const u = await checkPluginUpdates(app);
        const n = Object.keys(u).length;
        if (n) new Notice(`${n} plugin ${n === 1 ? "update is" : "updates are"} available. Open Settings › Community plugins to update.`);
      } catch {
        /* offline */
      }
    }, 10_000);
  }
}

function addWindowCommands(app: any): void {
  const c = app.commands;
  const has = (id: string) => !!c.commands[id];
  if (!has("window:zoom-in")) c.addCommand({ id: "window:zoom-in", name: "Zoom in", callback: () => setZoom(app, getZoom(app) + 0.5) });
  if (!has("window:zoom-out")) c.addCommand({ id: "window:zoom-out", name: "Zoom out", callback: () => setZoom(app, getZoom(app) - 0.5) });
  if (!has("window:reset-zoom")) c.addCommand({ id: "window:reset-zoom", name: "Reset zoom", callback: () => setZoom(app, 0) });
  // Ctrl/Cmd + = / - / 0 zoom the window like a browser (not commands in Obsidian either).
  window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.code === "Equal" || e.code === "NumpadAdd") setZoom(app, getZoom(app) + 0.5);
    else if (e.code === "Minus" || e.code === "NumpadSubtract") setZoom(app, getZoom(app) - 0.5);
    else if (e.code === "Digit0" || e.code === "Numpad0") setZoom(app, 0);
    else return;
    e.preventDefault();
  });
  if (!has("app:open-settings")) c.addCommand({ id: "app:open-settings", name: "Open settings", hotkeys: [{ modifiers: ["Mod"], key: "," }], callback: () => app.setting.open() });
  if (!has("theme:switch"))
    c.addCommand({
      id: "theme:switch",
      name: "Change theme...",
      callback: async () => {
        const { FuzzySuggestModal } = await import("../ui/modal");
        class M extends FuzzySuggestModal<string> {
          getItems() {
            return ["", ...app.customCss.themes];
          }
          getItemText(t: string) {
            return t || "Default";
          }
          onChooseItem(t: string) {
            void app.customCss.setTheme(t);
          }
        }
        new M(app).open();
      },
    });
}

/** Obsidian App methods some plugins and themes call (Style Settings, theme togglers...). */
function addAppMethods(app: any): void {
  const css = app.customCss;
  app.changeTheme = app.changeTheme ?? ((t: string) => css.setBaseTheme(t));
  app.updateAccentColor = app.updateAccentColor ?? (() => css.applyAll());
  app.updateFontFamily = app.updateFontFamily ?? (() => css.applyFonts());
  app.updateFontSize = app.updateFontSize ?? (() => css.applyBase());
  app.updateTheme = app.updateTheme ?? (() => css.applyAll());
  app.setTheme = app.setTheme ?? ((t: string) => css.setTheme(t));
  app.setAccentColor = app.setAccentColor ?? ((c: string) => css.setAccentColor(c));
  app.openVaultChooser = app.openVaultChooser ?? (() => app.native.openVaultDialog());
  app.getAppTitle = app.getAppTitle ?? (() => app.brand.displayName);
  app.isMobile = false;
}
