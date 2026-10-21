// Base class for our built-in settings tabs (declarative, like Obsidian 1.13+).
import { ipcRenderer } from "electron";
import { SettingTab } from "../../ui/setting";
import { SETTINGS_IPC } from "../../../shared/ipc-settings";

export abstract class BuiltinTab extends SettingTab {
  constructor(app: any, id: string, name: string, icon: string) {
    super();
    this.app = app;
    this.id = id;
    this.name = name;
    this.icon = icon;
  }
  /** Re-render the tab (after a change that affects which rows are shown). */
  rerender(): void {
    if (!this.containerEl.isConnected) return;
    const top = this.containerEl.scrollTop;
    this.display();
    this.containerEl.scrollTop = top;
  }
}

/** Helpers for definitions. */
export const toggle = (name: string, key: string, desc?: string, extra: any = {}) => ({ name, desc, control: { type: "toggle", key }, ...extra });
export const dropdown = (name: string, key: string, options: Record<string, string>, desc?: string, extra: any = {}) => ({ name, desc, control: { type: "dropdown", key, options }, ...extra });

/** App-level settings (outside the vault) kept by the main process. */
export const appSettings = {
  get: (): Promise<Record<string, any>> => ipcRenderer.invoke(SETTINGS_IPC.getAppSettings),
  set: (patch: Record<string, any>): Promise<Record<string, any>> => ipcRenderer.invoke(SETTINGS_IPC.setAppSettings, patch),
  relaunch: (): Promise<void> => ipcRenderer.invoke(SETTINGS_IPC.relaunch),
};

/** A link inside a description. */
export function descWithLink(text: string, linkText: string, onClick: () => void, after = ""): DocumentFragment {
  const f = document.createDocumentFragment();
  f.appendChild(document.createTextNode(text));
  const a = document.createElement("a");
  a.textContent = linkText;
  a.href = "#";
  a.addEventListener("click", (e) => {
    e.preventDefault();
    onClick();
  });
  f.appendChild(a);
  if (after) f.appendChild(document.createTextNode(after));
  return f;
}

export function relaunchButton(s: any, app: any): void {
  s.addButton((b: any) =>
    b
      .setButtonText("Relaunch")
      .setCta()
      .onClick(() => appSettings.relaunch()),
  );
  void app;
}
