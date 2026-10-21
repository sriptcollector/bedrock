// Built-in "Options" tabs in Obsidian 1.14's order.
import type { SettingTab } from "../../ui/setting";
import { GeneralTab } from "./general";
import { AppearanceTab } from "./appearance";
import { InterfaceTab } from "./interface";
import { EditorTab } from "./editor";
import { FilesTab } from "./files";
import { HotkeysTab } from "./hotkeys";
import { KeychainTab } from "./keychain";
import { CorePluginsTab } from "./core-plugins";
import { CommunityPluginsTab } from "./community-plugins";

export function builtinTabs(app: any): SettingTab[] {
  return [
    new GeneralTab(app),
    new AppearanceTab(app),
    new InterfaceTab(app),
    new EditorTab(app),
    new FilesTab(app),
    new HotkeysTab(app),
    new KeychainTab(app),
    new CorePluginsTab(app),
    new CommunityPluginsTab(app),
  ];
}
