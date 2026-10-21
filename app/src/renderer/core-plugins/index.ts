// Registers the behaviour of the core plugins built in this folder with app.internalPlugins.
import { installEditorSuggests } from "../api/suggest";
import { templatesPlugin } from "./templates";
import { dailyNotesPlugin } from "./daily-notes";
import { zkPrefixerPlugin } from "./zk-prefixer";
import { noteComposerPlugin } from "./note-composer";
import { fileRecoveryPlugin } from "./file-recovery";
import { basesPlugin } from "./bases";
import { backlinkPlugin, pagePreviewPlugin } from "./link-tabs";
import { installCorePluginGates } from "./gates";
import {
  randomNotePlugin,
  workspacesPlugin,
  audioRecorderPlugin,
  formatConverterPlugin,
  slashCommandPlugin,
  footnotesPlugin,
  switcherPlugin,
  commandPalettePlugin,
  publishPlugin,
} from "./misc";

export { InternalPlugins, InternalPlugin, type CorePluginImpl } from "./manager";

export function registerCorePlugins(app: any): void {
  installEditorSuggests(app);
  const ip = app.internalPlugins;
  for (const impl of [
    templatesPlugin,
    dailyNotesPlugin,
    zkPrefixerPlugin,
    noteComposerPlugin,
    fileRecoveryPlugin,
    basesPlugin,
    randomNotePlugin,
    workspacesPlugin,
    audioRecorderPlugin,
    formatConverterPlugin,
    slashCommandPlugin,
    footnotesPlugin,
    switcherPlugin,
    commandPalettePlugin,
    backlinkPlugin,
    pagePreviewPlugin,
  ])
    ip.register(impl);
  void publishPlugin;
  installCorePluginGates(app);
}
