# Community plugins in Bedrock

Bedrock runs Obsidian community plugins: the `obsidian` module it hands to plugins follows the MIT
`obsidian` package's `obsidian.d.ts` (1.14.4), plugins run as CommonJS in the vault window with Node
and Electron available (as in Obsidian), and the `.obsidian/plugins/<id>/` folder layout,
`community-plugins.json` and `data.json` are the same. Community plugins only run after you leave
Restricted mode in Settings › Community plugins (stored per vault on this computer, not in the vault).

## Compatibility test (2026-10-21)

The 15 plugins below were installed **through Bedrock's own plugin browser** (Settings › Community
plugins › Browse › Install, which downloads `manifest.json`, `main.js` and `styles.css` from each
plugin's GitHub release) into a temporary copy of the demo vault, switched on, and their main
feature exercised from a script over the DevTools protocol (`app/test/out/probe/plugtest*.js`, not
committed). Versions are the ones current on that day.

| Plugin | Version | Loads | Main feature | Notes |
|---|---|---|---|---|
| Dataview | 0.5.68 | Yes | Works | `LIST FROM "People"` and inline `= 1 + 2` render in reading view; settings tab works. DataviewJS highlighting uses our CodeMirror 5 shim (no colours). |
| Calendar | 1.5.10 | Yes | Works | Month view in the right sidebar; reads Daily notes settings through `internalPlugins`. |
| Templater | 2.26.0 | Yes | Works | `<% tp.date.now() %>` / `tp.file.title` replaced by "Replace templates in the active file". Its `<% %>` syntax colouring is left out (it would replace the Markdown language and switch off Live Preview). |
| Tasks | 8.6.0 | Yes | Works | ```` ```tasks ```` queries render the matching tasks; commands registered. |
| Excalidraw | 2.29.0 | Yes | Mostly | New drawings are created and the drawing editor works. Embedding notes/Markdown cards inside a drawing doesn't (it needs Obsidian's internal Canvas plugin classes). |
| Kanban | 2.0.51 | Yes | Works | Boards render; adding a card uses Bedrock's embeddable Markdown editor. |
| Advanced Tables | 0.23.2 | Yes | Works | "Format all tables" aligns tables. |
| Style Settings | 1.0.9 | Yes | Works | Settings tab renders; shows options when a theme or snippet declares `@settings`. |
| Iconize | 2.14.7 | Yes | Works | Folder icons appear in the file explorer (uses `view.fileItems`). |
| Outliner | 4.10.2 | Yes | Works | "Move list item down" moves items. Its Vim integration logs "Vim adapter not found" (Vim mode off). |
| Natural Language Dates | 0.6.4 | Yes | Works | `parseDate("tomorrow")`; its `@` editor suggestion is registered. |
| Omnisearch | 1.31.0 | Yes | Works | Modal opens and returns ranked results for "garden". |
| Linter | 1.34.2 | Yes | Works | "Lint the current file" fixes trailing spaces and extra blank lines once rules are on. |
| Commander | 0.7.0 | Yes | Works | Settings tab and command buttons. |
| Homepage | 4.5.0 | Yes | Works | "Open homepage" opens the configured note. |

Result: **15 of 15 load; 14 fully work, Excalidraw works except notes embedded in drawings.**

## What was added to make them work

All additive, in `app/src/renderer/api/` (`compat.ts`, `suggest.ts`) and the settings/plugin code:

- Loader: the exact Obsidian wrapper `(function anonymous(require,module,exports){...})` — the old
  wrapper's extra `app` parameter broke plugins that declare their own `app` (Excalidraw); old
  CodeMirror 0.19 package names map to their CodeMirror 6 homes; `@codemirror/lint` and `@lezer/lr`
  are shared; `@codemirror/language` exposes `tokenClassNodeProp`.
- API classes: `ConfirmationModal`/`ConfirmationButton`, `SettingGroup`, `SettingPage`, the 1.13
  declarative settings (`getSettingDefinitions`, `update`, `getControlValue`, ...), `SecretStorage` /
  `SecretComponent` (Keychain), `PopoverSuggest`, `AbstractInputSuggest`, `EditorSuggest` (with a
  dispatcher on editor changes), `MenuSeparator`, `MarkdownPreviewRenderer`, `MarkdownPreviewView`,
  `TExternalFile`, `Workspace{Container,Window,Floating,MobileDrawer}`, Bases value classes
  (`Value`, `StringValue`, `ListValue`, ...), `BasesView`, `parsePropertyId`.
- `MarkdownRenderer.render` puts blocks straight into the element (no section wrappers), as Obsidian
  does — Tasks relies on it.
- Globals and internals: `window.CodeMirror` (CodeMirror 5 mode registry with JavaScript, CSS and
  YAML modes), `window.CodeMirrorAdapter`, `app.metadataTypeManager`, `app.embedRegistry` (with a
  Markdown embed and an embeddable editor), `app.secretStorage`, `metadataCache.getCachedFiles`,
  `hotkeyManager.addDefaultHotkeys/removeDefaultHotkeys`, `workspace.registerHoverLinkSource`,
  file explorer `view.fileItems`, `app.changeTheme`/`updateAccentColor`/..., default
  `mobileToolbarCommands`.
- Uncaught errors whose stack points into a plugin are recorded in `app.plugins.loadErrors` and the
  plugin's row in Settings › Community plugins says it didn't start.

## Not supported (yet)

- Obsidian's internal Canvas plugin objects (`internalPlugins.plugins.canvas.views.canvas(leaf)`),
  so plugins that build canvas nodes (Excalidraw's embedded notes) can't.
- CodeMirror 5 overlay modes on top of Obsidian's HyperMD Markdown mode: Bedrock's editor uses a
  Lezer Markdown parser, so such overlays (Templater's highlighting) are skipped.
- CodeMirror 5 editors (`new CodeMirror(...)`) and the Vim adapter API (`CodeMirrorAdapter.Vim`).
- Custom Bases views from plugins (`registerBasesView`): the classes exist so plugins load, but
  Bedrock's Bases view doesn't host plugin views.
- Mobile-only APIs (`app.mobileToolbar`, `Platform.isMobile` is always false).
- Popout (floating) workspace windows: `workspace.openPopoutLeaf` opens a tab.
- Obsidian Sync / Publish APIs and `app.vault.adapter` features tied to them.

## Plugin and theme browser

Settings › Community plugins › Browse and Appearance › Themes › Manage open the browser in its own
window (like Obsidian). Lists come from `obsidianmd/obsidian-releases` on GitHub
(`community-plugins.json`, `community-plugin-stats.json`, `community-plugin-deprecation.json`,
`community-css-themes.json`), cached for 5 minutes; manifests, READMEs and release files from each
project's own GitHub repository. Nothing else is contacted: README images from other hosts become
links, and theme download counts (only published on obsidian.md) aren't shown, so themes are listed
in the order of the public list. Plugin install picks the newest version whose `minAppVersion` fits
(using the plugin's `versions.json` when needed); updates are checked by comparing the installed
manifest with the repository's.
