# Bedrock app: developer guide

Electron 45 + TypeScript, bundled with esbuild (`scripts/build.mjs`), packaged with electron-builder
(`electron-builder.config.cjs`). The renderer is vanilla DOM + CodeMirror 6 and runs with
`nodeIntegration: true, contextIsolation: false` like Obsidian, so community plugins can
`require("obsidian" | "electron" | "fs" | "@codemirror/view" ...)`.

```
npm start -w app            build + run (uses the one vault, Documents\Bedrock)
npx electron app --vault <dir>   run against any folder (dev)
npm run watch -w app        rebuild on save (reload the window with Ctrl+R / "Reload app")
npm test -w app             vitest unit tests
npm run test:e2e -w app     Playwright smoke test (screenshots -> app/test/out, gitignored)
node app/test/e2e/smoke.mjs --vault <dir>   smoke test against a COPY of a real vault
npx electron app --selftest <vault> [--no-ui]   headless index benchmark (JSON on stdout)
npm run icons -w app        re-render assets/icon.svg + tray.svg into build-res/
npm run dist -w app         installer (+ rewrites ../toolbay.json)
```

Env: `BEDROCK_USER_DATA=<dir>` (separate app data, used by tests), `BEDROCK_NO_UPDATE=1`,
`TOOLBAY_TOKEN` (hub token, memory only), `TOOLBAY_API_BASE` (defaults to https://toolbay.ai).

## Module map

```
src/shared/            brand.ts (reads ../brand.json: the ONLY place the name lives), ipc.ts (channel names)
src/main/              Electron main process
  index.ts             single instance, app data dir (= %APPDATA%\<appId>), hub args, IPC handlers
  hub.ts               --show/--hide/--quit/--from-toolbay, running.json writer
  account.ts           TOOLBAY_TOKEN (memory only) + hub keychain session (ai.toolbay.desktop/session)
  vaults.ts            the one vault (Documents\<DisplayName>), welcome note, vaults.json, import-into-main
  windows.ts           vault windows (frameless on Win/Linux, hiddenInset on mac), bounds memory
  tray.ts              tray Show/Hide/Quit
  updater.ts           electron-updater against GitHub releases (packaged builds only)
  selftest.ts          --selftest: core index in main process + real UI in a hidden window
src/preload/           tiny bridge (window.bedrockNative); the renderer has Node anyway
src/core/              pure TS, no DOM/Electron (runs in workers, main, tests)
  parse.ts             Markdown -> CachedMetadata (frontmatter, headings, links, embeds, tags, blocks,
                       sections, list items, footnotes), YAML helpers, getAllTags...
  links.ts             parseLinktext, LinkIndex (Obsidian link resolution + new-link-format text)
  scan.ts              scanVault, indexFiles (worker_threads pool, batch fallback)
  index-worker.ts      worker entry
  resolve.ts           resolvedLinks / unresolvedLinks for one file
src/renderer/
  main.ts              boot: DOM helpers, shared module map for plugins, new App()
  app.ts               App: wires everything, window chrome, startup sequence, paste/drop attachments
  api/index.ts         the `obsidian` module (what require("obsidian") returns)
  api/events.ts        Events, Component
  dom/augment.ts       createEl/createDiv/el.empty()/addClass/... prototype helpers plugins expect
  dom/icons.ts         setIcon/getIcon/addIcon (Lucide set + Obsidian's legacy icon names)
  vault/               TAbstractFile/TFile/TFolder, FileSystemAdapter (atomic writes), Vault,
                       VaultWatcher (fs.watch -> live create/modify/delete), FileManager
  metadata/cache.ts    MetadataCache (+ resolveSubpath, getBacklinksForFile, getTags...)
  workspace/           Workspace, items (Split/Tabs/Sidedock/Root/Ribbon), leaf (history, pin),
                       view (View/ItemView/FileView/TextFileView), registry (registerView/Extensions),
                       dnd (tab drag: reorder, move, edge-split)
  editor/              markdown-view.ts (MarkdownView: live preview / source / reading, inline title,
                       properties), editor.ts (Editor API), syntax.ts (Lezer extensions + cm-* classes),
                       live-preview.ts (hiding + widgets), extensions.ts (lists, autopair, folding,
                       [[ and # autocomplete, vim, compartments), properties.ts, fields.ts
  markdown/            parser.ts (markdown-it + Obsidian syntax), renderer.ts (MarkdownRenderer,
                       post processors, embeds, callouts, mermaid), highlight.ts (Lezer -> Prism classes)
  views/               file-explorer.ts, simple-views.ts (empty/image/audio/video/pdf),
                       switcher.ts (quick switcher, command palette), placeholder.ts (unbuilt/unknown views)
  views/graph/         graph + local graph: data.ts (filters, groups, local depth, orphans; pure), options.ts
                       (graph.json shape/defaults), query.ts (filter/group queries), sim.ts (force layout,
                       Barnes-Hut, runs in a blob Web Worker), renderer.ts (WebGL2 instanced nodes/links/arrows
                       + 2D label overlay, canvas2D fallback), controls.ts (settings panel), view.ts (views,
                       commands graph:open / open-local / animate), styles.ts (injected CSS)
  views/canvas/        format.ts (JSON Canvas parse/serialise, Obsidian-identical output), geometry.ts (edge
                       curves, sides, snapping), nodes.ts (text/file/link/group cards, edges), canvas.ts
                       (controller: viewport, selection, drag/resize/connect, menus, history, clipboard),
                       view.ts (CanvasView, canvas.json, commands, Settings > Canvas, ![[x.canvas]] embeds),
                       links.ts (canvas links into resolvedLinks for graph/backlinks), export.ts (PNG)
  commands/            commands.ts (registry + HotkeyManager, hotkeys.json), keymap.ts (Scope, Keymap,
                       Platform, Mod mapping), builtin.ts (built-in commands with Obsidian's ids)
  settings/modal.ts    settings modal with vertical tabs; built-in tabs are SettingTab subclasses
  plugins/             plugin.ts (Plugin base), loader.ts (community plugins, CommonJS wrapper)
  theme/               app.css (default theme on Obsidian's public variables/classes), custom-css.ts
                       (light/dark, accent, themes/, snippets/ from appearance.json)
  sync-ui/index.ts     extension point for the sync UI (status bar item stub)
  ui/                  Modal/SuggestModal/FuzzySuggestModal, Notice, Menu, Setting components,
                       fuzzy search, title bar + status bar
test/unit/             vitest: links, parse, vault (+rename updates links), markdown snapshots, workspace
test/e2e/smoke.mjs     Playwright _electron smoke test
test/fixtures/vault/   sample vault incl. a test community plugin
```

## Extension points for the next agents

- **Views** (graph, local graph, canvas, search, backlinks, outgoing links, tags, outline, bookmarks,
  properties, bases): `app.viewRegistry.registerView(type, leaf => new MyView(leaf))` and, for file
  types, `registerExtensions(["canvas"], "canvas")`. Use Obsidian's type ids (`graph`, `localgraph`,
  `canvas`, `search`, `backlink`, `outgoing-link`, `tag`, `outline`, `bookmarks`, `all-properties`,
  `file-properties`, `bases`). Saved leaves of an unregistered type show `PlaceholderView`, keep their
  state, and switch to the real view automatically when it registers. Register in
  `App.registerCoreViews()` (app.ts) and flip `available` in `CORE_PLUGINS` (app.ts).
- **Commands / hotkeys**: `app.commands.addCommand({id, name, hotkeys, callback | checkCallback |
  editorCallback | editorCheckCallback})`; use Obsidian's command ids (`docs/reference/commands.json`)
  so users' hotkeys.json keeps working. Default keys go in `commands/builtin.ts`.
- **Settings**: `app.setting.addSettingTab(tab, "options" | "core" | "community")` with a `SettingTab`
  subclass (`settings/modal.ts`). Values go through `app.vault.getConfig/setConfig` (app.json).
- **Plugins**: `plugins/loader.ts`. Restricted mode = `app.plugins.isEnabled()` (per vault, stored in
  app data localStorage, not in the vault). Plugin browser and update checks are not built yet.
- **Sync UI**: `sync-ui/index.ts` (`mountSyncUi` returns the status bar item). The sync engine runs in
  the main process (packages/sync); add IPC channels prefixed `bedrock:sync-` in `shared/ipc.ts`.
  The vault watcher already turns files written by sync into live UI updates.
- **Markdown**: syntax lives in `markdown/parser.ts` (reading view) and `editor/syntax.ts` (editor).
  Plugins use `registerMarkdownPostProcessor` / `registerMarkdownCodeBlockProcessor`.
- **Editor extensions**: `app.workspace.editorExtensions` (+ `workspace.updateOptions()`), via
  `plugin.registerEditorExtension`.

## Performance (measured 2026-10-21, Windows 11, Electron 45)

| Vault | Files / notes | Core index (main, workers) | UI to layout-ready | UI full index | Memory |
|---|---|---|---|---|---|
| vault-copy (Orion's vault copy, incl. code folders) | 955 / 517 | 594 ms (scan 404, read+parse 184) | 354 ms | 446 ms | renderer heap 45 MB, working set 175 MB |
| synthetic 10k (`scripts/gen-bench-vault.mjs`, 43 MB, 160k links) | 10,000 / 10,000 | 1,089 ms (read+parse 841, resolve 235) | 68 ms | 1,863 ms | renderer heap 111 MB, working set 259 MB |

Graph view (same synthetic 10k vault, `node test/e2e/graph-canvas.mjs --bench <vault>`, WebGL2, 240 Hz
display): 10,050 nodes / 49,962 links draw at the display rate (240 fps, < 1.5 ms of main-thread work
per frame) while the worker lays them out at ~42 ticks/s; the layout settles 6.1 s after opening. A
synthetic 10,000-node / 160,000-link graph: `setData` 57 ms, 240 fps, 28 layout ticks/s (worker),
25 ms per tick in the unit benchmark.

The window is usable at layout-ready; the metadata cache fills in behind it (worker pool, 150 files
per batch) and fires `resolved` when done.

## Known gaps

See the final report in the PR / commit history; the short list: search, backlinks,
outline, bookmarks, daily notes, templates, page preview are placeholders; popout windows open as
tabs; reading view renders the whole note (no virtualised sections yet); the table and callout
widgets in live preview are read-only renders (click "</>" or move the cursor in to edit the source);
no plugin/theme browser; settings opens as a modal, not its own window.
