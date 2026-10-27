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
node dist/cli.js help       the `bedrock` command in development (also: npx electron app --cli help)
node test/e2e/agents-e2e.mjs   agent access end to end (MCP HTTP + stdio, REST, sync, settings)
node scripts/agent-openapi.mjs regenerate the OpenAPI block in docs/AGENT-API.md
node test/e2e/onboarding.mjs   first-run setup guide end to end (temp main vault, screenshots -> test/out)
```

Env: `BEDROCK_USER_DATA=<dir>` (separate app data, used by tests), `BEDROCK_NO_UPDATE=1`,
`BEDROCK_SYNC_URL` (sync server, default https://sync.toolbay.ai), `BEDROCK_KEYCHAIN_DIR` (tests: file keychain),
`TOOLBAY_TOKEN` (hub token, memory only), `TOOLBAY_API_BASE` (defaults to https://toolbay.ai).
The setup guide opens by itself once per computer on the main vault; test runs (`BEDROCK_USER_DATA` set)
skip it unless `BEDROCK_ONBOARDING=1`, and `BEDROCK_NO_ONBOARDING=1` always skips it.

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
  webviewer.ts         Web viewer core plugin, main side: every <webview> forced into a locked-down
                       config (own partition, no Node, isolation, sandbox, no preload, http(s) only),
                       pop-ups -> new tabs, ad blocker (filter-list domain rules), shared settings
  ui-extras.ts         Native menus (OS menu from a renderer template) and the custom app icon
  agents/              agent access (docs/AGENT-API.md): tools.ts (tool list, zod), mcp.ts (MCP server,
                       @modelcontextprotocol/sdk), http.ts (127.0.0.1 REST + /mcp, token, Host/Origin
                       checks), settings.ts (token/port/running.json in app data), clients.ts (Connect
                       buttons + snippets), host.ts (Electron side), openapi.ts (spec for the docs)
src/cli/               `bedrock` command + stdio MCP server (dist/cli.js, run in Node mode by the
                       bin/bedrock.cmd shim, `<exe> --cli`, `<exe> --mcp`); backend.ts = app or folder
  sync/                sync host: runs packages/sync for the one vault (host.ts), keychain.ts,
                       selective.ts (selective sync rule). Design + sign-in decision: docs/SYNC.md §11
src/preload/           tiny bridge (window.bedrockNative); the renderer has Node anyway
src/core/              pure TS, no DOM/Electron (runs in workers, main, tests)
  parse.ts             Markdown -> CachedMetadata (frontmatter, headings, links, embeds, tags, blocks,
                       sections, list items, footnotes), YAML helpers, getAllTags...
  links.ts             parseLinktext, LinkIndex (Obsidian link resolution + new-link-format text)
  scan.ts              scanVault, indexFiles (worker_threads pool, batch fallback)
  index-worker.ts      worker entry
  resolve.ts           resolvedLinks / unresolvedLinks for one file
  onboarding.ts        setup guide texts: the two prompts for Claude (vault path filled in), the
                       "Bedrock/Instructions for Claude.md" writer, areas, graph gradient schemes, presets
  agent-ops.ts         vault operations for agents (search, read/write, move with link updates, tags,
                       properties, daily note), path safety; used by MCP, REST and the CLI
src/renderer/
  main.ts              boot: DOM helpers, shared module map for plugins, new App()
  app.ts               App: wires everything, window chrome, startup sequence, paste/drop attachments
  api/index.ts         the `obsidian` module (what require("obsidian") returns)
  api/events.ts        Events, Component
  api/suggest.ts       PopoverSuggest, AbstractInputSuggest, EditorSuggest (+ editor-change dispatcher)
  api/compat.ts        plugin compatibility: ConfirmationModal, Bases values, CodeMirror 5 shim,
                       metadataTypeManager, embedRegistry + embeddable editor (docs/PLUGINS.md)
  dom/augment.ts       createEl/createDiv/el.empty()/addClass/... prototype helpers plugins expect
  dom/icons.ts         setIcon/getIcon/addIcon (Lucide set + Obsidian's legacy icon names)
  vault/               TAbstractFile/TFile/TFolder, FileSystemAdapter (atomic writes), Vault,
                       VaultWatcher (fs.watch -> live create/modify/delete), FileManager
  metadata/cache.ts    MetadataCache (+ resolveSubpath, getBacklinksForFile, getTags...)
  workspace/           Workspace, items (Split/Tabs/Sidedock/Root/Ribbon), leaf (history, pin),
                       view (View/ItemView/FileView/TextFileView), registry (registerView/Extensions),
                       dnd (tab drag: reorder, move, edge-split)
  editor/              markdown-view.ts (MarkdownView: live preview / source / reading, inline title,
                       properties), editor.ts (Editor API), syntax.ts (Lezer extensions + cm-* classes,
                       footnotes), live-preview.ts (per-group hiding, atomic ranges, widgets),
                       extensions.ts (wiring + compartments + keymaps), lists.ts (Enter/Tab/renumber,
                       checkbox and list toggles), autopair.ts, formatting.ts (inline toggles, insert
                       commands), commands.ts (every editor:* command, editor context menu),
                       table.ts + table-model.ts (live preview table editor), suggest.ts (EditorSuggest
                       API, [[link]] / #tag / ==colour suggest), folding.ts (fold service, indicators,
                       saved folds), list-drag.ts, rename-heading.ts, export-pdf.ts, spellcheck.ts,
                       vim.ts (:w :q ...), properties.ts (+ key/value autocomplete), editor.css
  markdown/            parser.ts (markdown-it + Obsidian syntax), renderer.ts (MarkdownRenderer,
                       post processors, embeds, callouts, mermaid), reading.ts (virtualised reading
                       view, heading/list folds, footnote hovers), highlight.ts (Lezer -> Prism classes)
  workspace/popout.ts  popout windows (floating split): window.open from the main renderer
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
  views/sidebar/       index.ts registerSidebar(app): views, commands, page preview, status items, CSS
                       search-query.ts (query language: parser, matcher, explain; pure), search-index.ts
                       (text of every note + canvas cards, kept current), search-engine.ts (time-sliced
                       runs, sort), results.ts (result tree DOM), snippets.ts (match cards), search-view.ts,
                       query-block.ts (```query``` in reading view + live preview), backlinks.ts (+ in
                       document), mentions.ts (linked/unlinked mention helpers), outgoing.ts, tags.ts +
                       tag-tree.ts, outline.ts + outline-model.ts, bookmarks.ts + bookmark-model.ts
                       (bookmarks.json), properties-views.ts (all/file properties), page-preview.ts
                       (hover-link popover, page-preview.json), file-menu.ts (file/folder context menus),
                       status.ts, icons.ts (right-triangle, links-coming-in/-going-out, heading-glyph),
                       sidebar.css (imported as text, injected after app.css)
  commands/            commands.ts (registry + HotkeyManager, hotkeys.json), keymap.ts (Scope, Keymap,
                       Platform, Mod mapping), builtin.ts (built-in commands with Obsidian's ids)
  settings/            the settings window: modal.ts (SettingsModal: popout window or in-window modal,
                       nav groups, search, sub-pages), popout.ts (about:blank popout driven by this
                       renderer; mirrors styles/body classes; native caption buttons), render.ts
                       (declarative settings: SettingGroup, SettingPage, definitions renderer),
                       tabs/*.ts (General, Appearance, Interface, Editor, Files and links, Hotkeys,
                       Keychain, Core plugins, Community plugins), secret-storage.ts (app.secretStorage,
                       safeStorage-encrypted, outside the vault), bootstrap.ts (startup wiring),
                       suggest.ts / file-picker.ts (folder/file pickers)
  core-plugins/        manager.ts (app.internalPlugins: core-plugins.json, <id>.json options, lifecycle),
                       list.ts (all 1.14 core plugins), daily-notes/, templates/ (format.ts: {{title}}
                       {{date}} {{time}} variables), zk-prefixer/, note-composer/, file-recovery/
                       (IndexedDB snapshots + browser), bases/ (expr.ts: .base parser, expressions,
                       filters, formulas; index.ts: table/cards view), misc.ts (random note, workspaces,
                       audio recorder, format converter, slash commands, footnotes view, quick
                       switcher + command palette options), webviewer/ (index.ts: view, commands,
                       settings, history; extract.ts: article extraction + HTML -> Markdown + address
                       bar), slides.ts (present a note split at ---)
  plugins/             plugin.ts (Plugin base), loader.ts (community plugins, CommonJS wrapper,
                       load errors), browser/ (plugin + theme browser window; catalog.ts: GitHub lists,
                       install/update/uninstall)
  theme/               app.css (default theme on Obsidian's public variables/classes), tokens.css
                       (every variable's default value, both themes; generated by scripts/gen-tokens.mjs
                       from docs/reference/css-variables.json, do not edit), custom-css.ts
                       (light/dark, accent, themes/, snippets/ from appearance.json)
  sync-ui/             sync UI: index.ts (status bar icon + menu, commands, file menu, notices),
                       settings-tab.ts (Settings › Sync), modals.ts (version history + diff, deleted
                       files, activity log, excluded folders), client.ts (IPC), diff.ts, styles.ts
  onboarding/          first-run setup guide (index.ts: modal, command "Open onboarding", applies graph
                       colour groups / accent + light-dark / book theme snippet), themes.ts (book theme CSS)
  ui/                  Modal/SuggestModal/FuzzySuggestModal, Notice, Menu (sections, submenus, native),
                       Setting components, fuzzy search, title bar + status bar (editor mode item),
                       tooltip.ts (aria-label tooltips, setTooltip/displayTooltip)
test/unit/             vitest: links, parse, vault (+rename updates links), markdown snapshots, workspace,
                       editor lists / formatting / tables / suggest / misc, embed snapshots
test/parity/           editor behaviour-diff harness (see below)
test/e2e/smoke.mjs     Playwright _electron smoke test
test/e2e/settings-tabs.mjs   settings window: screenshots of every tab and sub-page, config writes
test/e2e/settings-window.ps1 real mouse clicks on the settings window's caption buttons and a toggle
test/e2e/look.mjs      look parity: every reference screen in the same state, sheets reference | ours |
                       pixel diff (--ref <dir> --out <dir> [--theme light,dark] [--settings]); --measure
                       lists box/style differences against the reference measurements, --vars lists CSS
                       variables that differ, --probe <scene> "<js>" for one-off checks
test/e2e/webviewer-slides.mjs  web viewer (security, reader, save, zoom, history, search, ad blocker,
                       links from notes), native menus, custom app icon, slides (needs network)
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
  subclass; core and community tabs are listed alphabetically (Sync lands between Quick switcher and
  Templates). Prefer `getSettingDefinitions()` (obsidian 1.13 declarative settings) so the settings
  search finds your rows; imperative `display()` still works. Values go through
  `app.vault.getConfig/setConfig` (app.json / appearance.json split, non-default values only). The
  settings window is a popout of this renderer: open modals/menus in `activeDocument`, attach key
  listeners to `el.doc` / `el.win`, not the global `document`.
- **Core plugins**: `app.internalPlugins.register({id, defaultOptions, onEnable(p), onDisable(p),
  settingTab(p)})` (core-plugins/manager.ts). `p.addCommand` / `addRibbonIcon` / `registerView` /
  `registerEvent` are cleaned up when the user switches the plugin off; `p.options` is saved to
  `.obsidian/<id>.json` (non-default only) with `p.setOption(k, v)`. Views built without an impl can
  still mark a plugin available (`plugins[id].available = true`).
- **Plugins**: `plugins/loader.ts`. Restricted mode = `app.plugins.isEnabled()` (per vault, stored in
  app data localStorage, not in the vault). Browser and installs: `plugins/browser/`
  (`openCommunityBrowser(app, "plugins" | "themes")`). Compatibility notes: docs/PLUGINS.md.
- **Sync**: the engine runs in the main process (`main/sync/host.ts`); the renderer calls it with
  `ipcRenderer.invoke(IPC.syncCall, op, ...args)` (returns `{ok, value | error}`) and listens to
  `IPC.syncUpdate` (snapshot) / `IPC.syncEvent`. `window.app.sync` is the client (snapshot, versions,
  restore, trash...). The vault watcher turns files written by sync into live UI updates.
  `node test/e2e/sync-e2e.mjs [--vault <dir>]` runs the real-process sync test (docs/SYNC.md §12).
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
Sidebar on the synthetic 10k vault (`node test/e2e/sidebar-perf.mjs`): search text index 282 ms
after indexing (background), queries 9 to 212 ms (`garden` 75, `stone river` 151, `/sig.al/` 64,
`tag:#garden` 62, `line:(stone layer)` 212), backlinks with unlinked mentions 14 ms, tags view 18 ms,
renderer heap 133 MB. Sidebar e2e on a copy of the demo vault: `node test/e2e/sidebar.mjs [--compare
<refDir> <outDir>] [--theme dark]`.

The window is usable at layout-ready; the metadata cache fills in behind it (worker pool, 150 files
per batch) and fires `resolved` when done.

## Editor parity harness

`test/parity/` drives Bedrock and an isolated instance of the original app over CDP with the same
key sequences and compares document text, cursor/selection and what each editor shows per line.
Start the reference instance yourself with its own user-data dir and a copy of the demo vault,
`--remote-debugging-port=9733` (never Orion's real vault or config), then:

```
node test/parity/run.mjs --vault <copy of the same vault> --keep [--reload] [--filter lists] [--write]
node test/parity/run.mjs --explore "- one‸" "key:Enter" "type:two"      # both apps, one ad-hoc case
node test/parity/perf.mjs 9734                                           # 1 MB note typing latency
node test/parity/shots.mjs <outDir> <name> <note> [--doc "..."] [--mode preview]   # side-by-side
```

Bedrock is launched on port 9734 with a temp copy of the vault (`--keep` leaves it running so
`--reload` can pick up a rebuild). `--write` regenerates `docs/PARITY-EDITOR.md`. Cases live in
`test/parity/cases.mjs` (no code from the original app; only its observable behaviour).

## Known gaps

Tracked in docs/FEATURES.md (unchecked items). Short list: page preview popovers are read-only; the
Backlinks / Page preview settings tabs are not built (options live in backlink.json / page-preview.json).
Settings/core plugins: Publish is shown as not part of the app; General › Language (English only)
and Command line interface are shown disabled; Bases has table and cards views only (no
list/map views, no formula editor UI; filters are edited as expressions). Plugin gaps: docs/PLUGINS.md.
See the final report in the PR / commit history; the short list: graph, canvas, search, backlinks,
outline, bookmarks, daily notes, templates, page preview are placeholders; no plugin/theme browser;
settings opens as a modal, not its own window. Editor: PDF embeds use Chromium's viewer (not the
original's pdf.js toolbar); popout windows use a native frame on Windows and menus open in the main
window; the spellcheck language picker UI belongs to Settings (helpers in editor/spellcheck.ts).
Remaining editor differences are listed in docs/PARITY-EDITOR.md.
