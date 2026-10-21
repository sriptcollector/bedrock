# Bedrock feature list (parity with Obsidian 1.14.4)

Every screen, state, setting, command and hotkey Bedrock needs so that people moving from Obsidian find what they expect. Written in our own words from a clean-room study of Obsidian 1.14.4 (October 2026). Tick a box when the item ships and has been compared side by side with the reference screenshots (kept outside this repo at `C:\Users\orion\tbv-scratch\ref\`, see its `index.md`; never commit them).

Related docs: `docs/ARCHITECTURE.md` (how Bedrock is built), `docs/UI-SPEC.md` (measured sizes, colors, class names), `docs/reference/commands.json`, `docs/reference/settings.json`, `docs/reference/css-variables.json`. Full research report: `toolbay-research/obsidian-report.md`.

Legend: **[later]** = not needed for the first release. **[ours]** = Bedrock does this its own way on purpose.

## 1. App shell and windows

- [x] Single instance: a second launch passes its arguments (file path, URI) to the running app
- [ ] One window per open vault; window size and position remembered per vault
- [x] Hidden native title bar by default; tab row is the drag area; our own minimize / maximize / close buttons at top right
- [ ] Window frame setting: hidden (default), app frame, native frame (needs restart)
- [ ] Popout windows for any tab ("Open in new window", "Move to new window"); they share the same app state
- [ ] Settings opens in its own window by default (900x700), with an option to show it as an in-app dialog
- [ ] Plugin browser and theme browser open in their own windows (1100x800)
- [ ] Vault picker window (800x650): list of known vaults on the left with a per-vault menu (reveal, rename, remove from list), right side with "create new vault", "open folder as vault", "open synced vault" [ours: Toolbay account vault], language picker
- [ ] Create-vault form: name, location (folder picker), create button; back link
- [ ] Vault switcher at the bottom of the left sidebar: vault name, menu to switch or manage vaults, help button, settings button
- [ ] Loading state while a big vault is indexed (progress in the status bar)
- [ ] App-package self-update: small installer plus a signed renderer package checked on start and hourly; "relaunch to update" prompt; early-access channel toggle [ours: Toolbay release feed]
- [x] Zoom in / out / reset for the whole window; hardware acceleration toggle (restart)
- [ ] Spellcheck language list from the OS spellchecker
- [ ] Interface languages (English first) [later: others]
- [ ] Command line interface toggle [later]

## 2. Vault and files

- [x] Any folder is a vault; plain `.md` files; folders are real folders
- [ ] Config folder `.obsidian/` (overridable name) with the same files and JSON shapes; only non-default values written
- [x] Watch for outside changes (create, modify, delete, rename) and update everything live
- [ ] Supported file types open in their own views: Markdown, canvas, base, images, PDF, audio, video; "show all file types" setting
- [x] New note location: vault root (default), same folder as current file, or a chosen folder
- [ ] New notes are named "Untitled", "Untitled 1", ...; title selected for immediate rename
- [ ] Attachments location: vault root (default), same folder, subfolder under current folder, or a chosen folder
- [x] Paste or drop an image: saved as `Pasted image YYYYMMDDHHmmss.png` and linked
- [x] Delete: confirm dialog (default on); move to OS trash (default), to `.trash` in the vault, or delete permanently
- [ ] Delete attachments used only by the deleted note: ask (default), always, never
- [x] Rename: ask whether to update links (default) or always update automatically
- [x] Link format for new links: shortest path (default), relative path, absolute path; wikilinks (default) or Markdown links
- [ ] Excluded files list (hidden from search, graph, unlinked mentions; lower in the quick switcher)
- [ ] Metadata cache built in a worker: links, embeds, tags, headings, blocks, sections, list items, tasks, frontmatter and links inside frontmatter, footnotes; resolved and unresolved link maps; stored between runs
- [ ] "Rebuild vault cache" button
- [ ] Default file to open on start: last opened (default), new note, a specific file, or today's daily note

## 3. Workspace layout

- [x] Layout tree: main area, left sidebar, right sidebar, popout windows; splits (vertical and horizontal) contain tab groups; tab groups contain tabs
- [x] Layout saved in `.obsidian/workspace.json` on every change and restored on start (also the list of recently opened files)
- [ ] Tabs: click to switch, middle-click or X to close, drag to reorder, drag into a split (four drop zones) or out to a new window
- [ ] New tab button and the empty new tab screen (new note, new base, new canvas, go to file, with hotkey chips)
- [ ] Tab list dropdown (all tabs in the group)
- [x] Stacked tabs mode per tab group: tabs become overlapping vertical strips with rotated titles; click a strip to slide it into view
- [x] Pinned tabs (pin icon; links open elsewhere)
- [ ] Linked tabs (local graph, outline, backlinks follow another tab; chain icon)
- [x] Split right, split down; resize handles; close tab group; close others
- [x] Undo close tab
- [ ] Back and forward history per tab, with long-press/right-click history list
- [ ] Tabs remember mode (editing or reading), scroll position and cursor
- [ ] Deferred tabs: hidden tabs keep their state without building their view until shown
- [ ] "Always focus new tabs" setting
- [ ] Left sidebar default tabs: Files, Search, Bookmarks; right sidebar default tabs: Backlinks, Outgoing links, Tags, All properties, Outline (right collapsed by default)
- [x] Sidebar tab strip shows icons only; sidebars can hold their own splits and tab groups
- [ ] Toggle buttons for each sidebar at the top corners; sidebar width 300 px default, resizable, remembered
- [ ] Ribbon: 44 px strip at the far left with action buttons from core and community plugins; hide/show and reorder in Settings > Interface; can be turned off
- [ ] Status bar at the bottom right: backlinks count, properties count, editing mode toggle, word and character count (selection-aware), sync status; plugins can add items
- [ ] View header: back, forward, breadcrumb path (click a folder to reveal it, click the name to rename), bookmark icon, mode toggle, more-options menu; can be hidden
- [ ] More-options menu: backlinks in document, reading view / source mode, split right, split down, open in new window, rename, move, bookmark, merge, add property, export to PDF, find, replace, copy path, version history, open linked view, open in default app, show in system explorer, reveal in file tree, delete
- [ ] Saved layouts (Workspaces plugin) [later]

## 4. Editor (Markdown)

### Modes
- [x] Live Preview (default editing mode)
- [x] Source mode
- [x] Reading view
- [x] Toggle editing and reading (Ctrl+E), toggle Live Preview and Source, per-tab mode, defaults for new tabs from settings
- [x] Inline title: file name shown as an editable title above the note (setting, on by default)

### Live Preview behaviour
- [ ] Markdown symbols hidden when the cursor is not touching them; revealed per token group (not whole line) when the cursor or selection touches them, only while the editor has focus
- [x] Heading `#` marks shown only when the cursor is on the heading line
- [ ] Hidden ranges are skipped by the cursor (atomic); clicks inside them land at the edge
- [x] Links show only their display text; full syntax appears when the cursor enters the link
- [x] List bullets drawn as dots; numbered lists keep numbers; task boxes are clickable checkboxes
- [x] Quotes drawn with a left border
- [ ] Block widgets when the cursor is outside: properties form, tables, callouts, embeds, images, math, Mermaid, HTML; each with an "edit this block" button
- [ ] No flicker while dragging a selection or typing with an input method (decorations mapped, not rebuilt)
- [ ] Same `cm-*` token classes and `HyperMD-*` line classes as Obsidian so themes work

### Syntax support
- [x] CommonMark + GitHub tables, task lists, strikethrough, autolinks
- [x] Wikilinks with alias, heading and block targets; Markdown links; external links with an external-link marker
- [ ] Embeds `![[...]]` of notes, headings, blocks, images (with width or width x height), PDF (page, height), audio, video, canvas, base
- [x] Tags `#tag` and nested `#a/b`; tag pills in reading view
- [x] Highlights `==text==`; comments `%%text%%` hidden in reading view
- [x] Footnotes (reference and inline)
- [ ] Math with `$...$` and `$$...$$` (MathJax-compatible output)
- [ ] Mermaid code blocks, off by default (setting) and gated by a per-vault "allow" prompt
- [ ] Code blocks with syntax highlighting, language label, copy button
- [x] Callouts `> [!type] title` with `+`/`-` fold markers; 13 types and their aliases; custom types fall back to note; nested callouts
- [x] Block ids `^id`; horizontal rules; HTML blocks (sanitized)
- [x] Frontmatter YAML at the top

### Editing aids
- [x] Auto-pair brackets and quotes (setting)
- [x] Auto-pair Markdown symbols (setting)
- [ ] Smart lists: continue lists on Enter, fix indentation and numbering (setting)
- [x] Indent with tabs or 4 spaces (setting); tab visual width (setting)
- [ ] Fold headings and indented lists (settings); fold all / unfold all; fold state remembered
- [ ] Line numbers (setting, off); indentation guides (setting, on); readable line length 700 px (setting, on); right-to-left (setting)
- [x] Strict line breaks (setting, off)
- [ ] Spellcheck (setting, on) with language list
- [ ] Link autocomplete after `[[` (files, headings with `#`, blocks with `^`, aliases); create link to a new note
- [x] Tag autocomplete after `#`
- [ ] Slash command menu after `/` (when the plugin is on)
- [ ] Paste HTML as Markdown (setting, on); paste as plain text
- [ ] Drag files in to link or embed them
- [ ] Multiple cursors (Alt+click, add cursor above/below)
- [x] Find and replace bar inside the note (match case, regex, whole word)
- [ ] Table editing in Live Preview: cell editing, add/move/delete rows and columns, alignment, row and column handles
- [ ] Properties form: add, rename, retype, reorder, delete properties; value editors per type; list pills; tag pills; date picker; links inside values
- [ ] Highlight colors (red, orange, yellow, green, blue, purple) for highlights
- [x] Vim key bindings (setting) [later]

### Reading view
- [ ] Sections rendered lazily near the viewport (fast on long notes)
- [ ] Clickable links, tags, checkboxes; hover preview; copy button on code blocks; foldable headings and callouts
- [x] Post-processor hooks for plugins (`registerMarkdownPostProcessor`, code block processors)
- [ ] Backlinks at the bottom of notes (option, off)
- [ ] Note classes from the `cssclasses` property

## 5. Navigation and finding things

### File explorer
- [x] Tree of folders and files; folders first; non-Markdown files show an uppercase extension tag; Markdown files hide `.md`
- [x] Header buttons: new note, new folder, sort order, auto-reveal current file, collapse/expand all
- [x] Sort: name A-Z (default), name Z-A, modified new-old, modified old-new, created new-old, created old-new
- [x] Click opens, Ctrl+click opens in new tab, middle-click new tab
- [x] Multi-select with Ctrl and Shift; drag and drop files and folders (move); drop files from the OS (copy in)
- [ ] Inline rename (F2); cut, copy, paste of files
- [ ] File context menu: open in new tab, open to the right, open in new window, make a copy, move, bookmark, merge with, copy path (vault path, full path, obsidian URL), version history, open in default app, show in system explorer, rename, delete
- [ ] Folder context menu: new note, new folder, new canvas, new base, move, bookmark, copy path, search in folder, show in system explorer, rename, delete
- [x] Filter box (show search) for the tree
- [x] Active file highlighted; indentation guides

### Quick switcher
- [ ] Fuzzy search over file names, paths and aliases; recent files when empty
- [ ] Unresolved link names offered as "create" (setting: show existing only)
- [ ] Attachments shown (setting, on); all file types (setting, off)
- [ ] Enter open, Ctrl+Enter new tab, Ctrl+Alt+Enter to the right, Shift+Enter create, Esc close; instruction bar listing these

### Command palette
- [x] Fuzzy search over every command with hotkey chips
- [ ] Recently used commands first; pinned commands (settings) at the top
- [x] Only commands that apply to the current context are listed (editor-only commands need an editor)

### Search
- [x] Search pane with query box, match-case toggle, explain-search toggle, collapse results, show more context, sort order (file name, modified, created; both directions)
- [x] Results grouped per file with counts and highlighted matches; click jumps to the match
- [x] Operators: AND by space, quotes, OR, minus, parentheses, `/regex/`, `file:`, `path:`, `content:`, `tag:`, `line:`, `block:`, `section:`, `task:`, `task-todo:`, `task-done:`, `match-case:`, `ignore-case:`, `[property]`, `[property:value]`
- [x] Explain search: each part of the query described in words
- [x] Search inside canvas text cards
- [x] "Copy search results"; bookmark a search; open search from a tag click
- [ ] In-note find (Ctrl+F) and replace (Ctrl+H)

### Bookmarks
- [x] Bookmark files, folders, searches, headings, blocks, graph settings, web addresses; groups of bookmarks; drag to reorder; rename; remove
- [x] Bookmark icon in the view header filled when the current note is bookmarked
- [x] Stored in `bookmarks.json`

### Page preview
- [ ] Hover popover showing the linked note (scrollable, editable, expand button)
- [ ] Per-source "needs Ctrl" settings (defaults: reading view without Ctrl, everything else with Ctrl)

## 6. Links and knowledge

- [x] Backlinks pane: linked mentions with context cards; unlinked mentions with a "link" button; counts; collapse results; more context; sort; filter
- [ ] Backlinks at the bottom of each note (setting in Backlinks options and per note from the menu)
- [x] Outgoing links pane: links (resolved and unresolved) and unlinked mentions of other notes
- [x] Tags pane: tree of nested tags, counts, sort by name or frequency, click to search
- [x] Outline pane: heading tree, click to jump, drag to move sections, filter, follow cursor option
- [x] All properties pane: every property key with counts and type icons, sort, filter, rename across vault
- [x] File properties pane: properties of the active note in the sidebar
- [x] Property types: text, list, number, checkbox, date, date and time, plus aliases and tags; stored in `types.json`; inferred from values; change type from the key's menu
- [ ] Footnotes pane [later]
- [ ] Rename heading updates links to it; rename file updates links (per setting)

## 7. Graph view

- [x] Global graph in a tab; local graph for the current note (opens linked, in a split)
- [x] WebGL drawing with a worker-driven force layout; smooth zoom and pan; drag nodes; hover highlights neighbors in the accent color; click opens
- [x] Node size grows with link count; unresolved notes faded; optional tag and attachment nodes; labels fade by zoom (text fade threshold)
- [x] Settings panel with four collapsible sections and a reset button:
  - [x] Filters: file search, tags (off), attachments (off), existing files only (off), orphans (on)
  - [x] Groups: color groups from search queries, add/remove/reorder, color picker
  - [x] Display: arrows (off), text fade threshold (0), node size (1), link thickness (1), animate (time-lapse by creation date)
  - [x] Forces: center, repel (default 10), link force (1), link distance (250)
- [x] Local graph extras: depth (1), incoming links (on), outgoing links (on), neighbor links (off)
- [x] Colors from CSS variables so themes apply
- [ ] Settings saved in `graph.json`; bookmark a graph

## 8. Canvas

- [x] Open, edit and save `.canvas` files in JSON Canvas 1.0 format (keep unknown fields)
- [x] Node types: text (Markdown, editable in place), file (note, image, PDF, any file, with heading/block subpath), link (web page), group (label, background)
- [x] Node colors: six presets and custom hex
- [x] Edges: from/to sides, arrow ends, color, label; draw by dragging from side handles
- [x] Infinite dotted background; zoom and pan; selection box; multi-select; move and resize with snapping (grid and objects, settings)
- [x] Right-side controls: canvas settings, zoom in, reset zoom, zoom to fit, zoom out, undo, redo, help
- [x] Bottom card menu: add text card, add note from vault, add media; drag files in from the explorer
- [x] Node toolbar when selected: delete, color, zoom to selection, edit
- [x] Card names shown always (setting: always, on hover, never)
- [x] Wheel behaviour (pan default, zoom option); Ctrl+drag behaviour (menu default)
- [x] Hide card content when zoomed out past a threshold (setting)
- [x] Commands: new canvas, export as image, jump to group, convert card to file
- [ ] Canvas embeds in notes; canvas files in search and graph

## 9. Daily notes, templates and note tools

- [x] Daily notes: open today's note (create from template if missing), previous and next daily note; date format (moment syntax, default YYYY-MM-DD); folder; template; ribbon button
- [x] Templates: template folder; insert template picker; `{{title}}`, `{{date}}`, `{{time}}`, `{{date:FORMAT}}`, `{{time:FORMAT}}`; date and time format settings; insert current date / time commands
- [x] Unique note creator: timestamp prefix (default YYYYMMDDHHmm), folder, template [later]
- [x] Note composer: merge file into another, extract selection or heading to a new note; leave a link (default), embed or nothing; template with `{{content}}`, `{{fromTitle}}`, `{{newTitle}}`; confirm before merge
- [x] Random note [later]
- [ ] Word count in the status bar (words and characters, selection-aware)
- [x] File recovery: snapshots at most every 5 minutes, kept 7 days, outside the vault; snapshot browser with diff, restore, copy; clear history
- [ ] Export note to PDF (page size, orientation, margins, scale)
- [ ] Slides (present a note split by `---`) [later]
- [ ] Audio recorder (record into the vault) [later]
- [x] Bases (`.base` table and card views over properties, with sort, group, filter, formulas) [later]
- [ ] Web viewer (in-app browser, reader mode, save page as Markdown, ad blocking) [later]

## 10. Look and feel

- [ ] Default theme written from scratch to match the measured values in `UI-SPEC.md` (light and dark)
- [x] Base color scheme: light, dark, follow system (default)
- [x] Accent color picker (default violet `#8a5cf5`) with restore-default; derived accent variables
- [x] Interface font, text font, monospace font pickers (system fonts); font size slider (default 16) with restore-default; Ctrl+scroll font size (setting, off)
- [ ] Every public CSS variable name from `docs/reference/css-variables.json` defined with the same default values
- [ ] Same DOM class names and nesting for every component (UI-SPEC section 4)
- [ ] Lucide icons by name; our own drawings for the few custom icons (sidebar toggles, links in/out, fold triangle)
- [x] Community themes: theme browser (search, sort, light/dark filters, installed only, preview images, detail page, install/use/uninstall, update check); one active theme; `themes/<name>/theme.css` + `manifest.json`
- [x] CSS snippets: list `.obsidian/snippets/*.css`, toggle each, reload list, open folder
- [ ] Translucent window (setting) [later]
- [ ] Native menus option [later]
- [ ] Custom app icon [later]
- [ ] Context menus, tooltips, notices (toasts), modals, prompts, suggestion lists matching the measured styles

## 11. Settings window

- [x] Left navigation: Options tabs, then core plugin tabs with options, then community plugin tabs; icons per tab
- [x] Search box that filters settings across all tabs
- [ ] Every setting below with the same label, control and default


### Settings > General

- [x] "Version 1.14.4": button "Check for updates"
- [ ] "Update Available": button "Download"
- [x] "Automatic updates": toggle, on
- [ ] "Receive early access versions": toggle shown only with a Catalyst license
- [ ] "Language": dropdown, English (51 options); button "Relaunch"
- [x] "Help": button "Open"
- [ ] Account / "Your account": button "Log in"; button "Sign up"
- [ ] Account / "Catalyst license": shows license status when signed in
- [ ] Account / "Commercial license": button "Activate"; button "Purchase"
- [ ] Advanced / "Notify if startup takes longer than expected": toggle, off; icon button "Check now"
- [ ] Advanced / "Command line interface": toggle, off
- [x] Advanced / "Hardware acceleration": toggle, on; button "Relaunch"

### Settings > Appearance

- [x] "Base color scheme": dropdown, Adapt to system (options: Dark, Light, Adapt to system)
- [x] "Accent color": color, #8a5cf5; restore-default button
- [x] "Themes": dropdown, Default; button "Manage"; icon button "Open themes folder"
- [x] "Current community themes": count of installed themes
- [x] "CSS snippets": subpage (chevron row; shows "0 enabled")
- [x] Font / "Interface font": subpage (font picker; default: theme font)
- [x] Font / "Text font": subpage (font picker; default: theme font)
- [x] Font / "Monospace font": subpage (font picker; default: theme font)
- [x] Font / "Font size": slider, 16; restore-default button
- [x] Font / "Quick font size adjustment": toggle, off
- [ ] Advanced / "Custom app icon": button "Choose"; button "Relaunch"; restore-default button

### Settings > Interface

- [x] "Show tab title bar": toggle, on
- [x] "Show ribbon": toggle, on
- [x] "Ribbon menu configuration": subpage (show/hide and reorder ribbon items)
- [x] Advanced / "Zoom level": slider, 0; restore-default button
- [ ] Advanced / "Native menus": toggle, off
- [x] Advanced / "Window frame style": dropdown, Hidden (default) (options: Hidden (default), Obsidian frame, Native frame); button "Relaunch"
- [x] Advanced / "Open settings in new window": toggle, on

### Settings > Editor

- [x] "Default view for new tabs": dropdown, Editing view (options: Editing view, Reading view)
- [x] "Default editing mode": dropdown, Live Preview (options: Live Preview, Source mode)
- [x] "Show editing mode in status bar": toggle, on
- [x] Display / "Inline title": toggle, on
- [x] Display / "Readable line length": toggle, on
- [x] Display / "Strict line breaks": toggle, off
- [x] Display / "Properties in document": dropdown, Visible (options: Visible, Hidden, Source)
- [x] Display / "Fold heading": toggle, on
- [x] Display / "Fold indent": toggle, on
- [x] Display / "Line numbers": toggle, off
- [x] Display / "Indentation guides": toggle, on
- [x] Display / "Right-to-left (RTL)": toggle, off
- [x] Display / "Show Mermaid diagrams in notes": toggle, off
- [x] Behavior / "Spellcheck": toggle, on; icon button
- [x] Behavior / "Spellcheck languages": dropdown, + (58 options)
- [x] Behavior / "Auto-pair brackets": toggle, on
- [x] Behavior / "Auto-pair Markdown syntax": toggle, on
- [x] Behavior / "Smart lists": toggle, on
- [x] Behavior / "Indent using tabs": toggle, on
- [x] Behavior / "Indent visual width": slider, 4; restore-default button
- [x] Advanced / "Convert pasted HTML to Markdown": toggle, on
- [x] Advanced / "Vim key bindings": toggle, off

### Settings > Files and links

- [x] "Default file to open": dropdown, Last opened (options: Last opened, New note, Specific file, Daily note)
- [x] "File to open": file picker with clear button; default empty
- [x] "Always focus new tabs": toggle, on
- [x] "Default location for new notes": dropdown, Vault folder (options: Vault folder, Same folder as current file, In the folder specified below)
- [x] "Folder to create new notes in": text, empty (placeholder "Example: folder 1/folder 2")
- [x] "Default location for new attachments": dropdown, Vault folder (options: Vault folder, Same folder as current file, In subfolder under current folder, In the folder specified below)
- [x] "Attachment folder path": text, empty (placeholder "Attachments")
- [x] "Subfolder name": text, empty (placeholder "Attachments")
- [x] Links / "New link format": dropdown, Shortest path when possible (options: Shortest path when possible, Path from current file, Path from vault folder)
- [x] Links / "Automatically update internal links": toggle, off
- [x] Links / "Use [[Wikilinks]]": toggle, on
- [x] Links / "Show all file types": toggle, off
- [x] Trash / "Confirm before deleting files": toggle, on
- [x] Trash / "Delete attachments when deleting files": dropdown, Ask each time (options: Ask each time, Always, Never)
- [x] Trash / "Deleted files": dropdown, Move to system trash (options: Move to system trash, Move to Obsidian trash (.trash folder), Permanently delete)
- [x] Advanced / "Excluded files": subpage (list of excluded paths and patterns; default empty)
- [x] Advanced / "Override config folder": text, empty (placeholder ".obsidian"); button "Relaunch"
- [x] Advanced / "Allow URI callbacks": toggle, off
- [x] Advanced / "Rebuild vault cache": button "Rebuild"

### Settings > Keychain

- [x] Secrets / "No secrets have been added. Secrets are used to store information like API keys and pas...": info text

### Settings > Community plugins

- [x] "Community plugins, like any other software you install, could potentially cause data in...": info text
- [x] "Allow community plugins": button "Exit Restricted mode"
- [x] "Learn more about plugin security": info text

### Settings > Quick switcher

- [x] "Show existing only": toggle, off
- [x] "Show attachments": toggle, on
- [x] "Show all file types": toggle, off

### Settings > Sync

- [x] Signed-out state: short explanation plus Sign up / Log in (Bedrock: replace with our Sync settings, see "Sync")

### Settings > Backlinks

- [ ] "Show backlinks at the bottom of notes": toggle, off

### Settings > Canvas

- [x] "Default location for new canvas files": dropdown, Vault folder (options: Vault folder, Same folder as current file, In the folder specified below)
- [x] "Folder to create new canvas files in": text, empty (placeholder "Example: folder 1/folder 2")
- [x] "Default mouse wheel behavior": dropdown, Pan (options: Pan, Zoom)
- [x] "Default Ctrl + Drag behavior": dropdown, Show menu (options: Show menu, Add card, Add note from vault, Add media from vault, Add web page, Create group)
- [x] "Show card names": dropdown, Always (options: Always, On hover, Never)
- [x] "Snap to grid": toggle, on
- [x] "Snap to objects": toggle, on
- [ ] "Zoom threshold for hiding card content": slider, 0; restore-default button

### Settings > Page preview

- [ ] Require Ctrl to trigger page preview on hover / "Search, Backlinks, and Outgoing links": toggle, on
- [ ] Require Ctrl to trigger page preview on hover / "Reading view": toggle, off
- [ ] Require Ctrl to trigger page preview on hover / "Editing view": toggle, on
- [ ] Require Ctrl to trigger page preview on hover / "Tab header": toggle, on
- [ ] Require Ctrl to trigger page preview on hover / "Files": toggle, on
- [ ] Require Ctrl to trigger page preview on hover / "Properties view": toggle, on
- [ ] Require Ctrl to trigger page preview on hover / "Bookmarks": toggle, on
- [ ] Require Ctrl to trigger page preview on hover / "Outline": toggle, on
- [ ] Require Ctrl to trigger page preview on hover / "Bases": toggle, on
- [ ] Require Ctrl to trigger page preview on hover / "Graph view": toggle, on

### Settings > Daily notes

- [x] "Date format": dropdown, 2026-10-21 (options: 2026-10-21, 2026.10.21, 2026/10/21, 2026/10/2026-10-21, Custom)
- [x] "Custom format": text, YYYY-MM-DD (placeholder "YYYY-MM-DD")
- [x] "New file location": text, Daily (placeholder "Example: folder 1/folder 2")
- [x] "Template file location": file picker with clear button; default empty

### Settings > Templates

- [x] "Template folder location": text, Templates (placeholder "Example: folder 1/folder 2")
- [x] "Date format": text, empty (placeholder "YYYY-MM-DD")
- [x] "Time format": text, empty (placeholder "HH:mm")

### Settings > Note composer

- [x] "Text after extraction": dropdown, Link to new file (options: Link to new file, Embed new file, None)
- [x] "Template file location": file picker with clear button; default empty
- [x] "Confirm file merge": toggle, on

### Settings > Command palette

- [x] Pinned commands / "No commands found.": info text

### Settings > File recovery

- [x] "Snapshot interval": text, 5
- [x] "History length": text, 7
- [x] "Snapshots": button "View"
- [x] "Clear history": button "Clear"

### Settings > Unique note creator

- [x] "New file location": text, empty (placeholder "Example: folder 1/folder 2")
- [x] "Template file location": file picker with clear button; default empty
- [x] "Unique prefix format": text, empty (placeholder "YYYYMMDDHHmm")

### Settings > Web viewer

- [ ] "Open external links": toggle, on
- [ ] "Homepage": text, empty
- [ ] "Saved page folder": text, empty (placeholder "Example: folder 1/folder 2")
- [ ] "Search engine": dropdown, DuckDuckGo (options: DuckDuckGo, Brave, Bing, Google, Custom)
- [ ] "Custom search engine": text, https://duckduckgo.com/?q=%s (placeholder "https://duckduckgo.com/?q=%s")
- [ ] "Enable ad blocker": toggle, on
- [ ] "Ad blocking rules": text area, https://easylist.to/easylist/easylist.txt, https://easylist.to/easylist/easyprivacy.txt
- [ ] "Ad block update frequency": slider, 4
- [ ] "Web viewer data": button "Clear web viewer data"


### Settings > Hotkeys
- [x] List of every command with its current hotkeys; search box; filter "assigned only"
- [x] Add a hotkey by pressing keys; remove a hotkey; restore default; conflicts shown
- [x] Stored in `hotkeys.json`, only changes

### Settings > Core plugins
- [x] One toggle per core plugin, with buttons for its options and hotkeys; defaults as listed in section 12

## 12. Plugins

### Core plugins (same ids; default state)
- [ ] `file-explorer` Files (on)
- [ ] `global-search` Search (on)
- [x] `switcher` Quick switcher (on)
- [x] `graph` Graph view (on)
- [ ] `backlink` Backlinks (on)
- [x] `canvas` Canvas (on)
- [ ] `outgoing-link` Outgoing links (on)
- [ ] `tag-pane` Tags view (on)
- [x] `footnotes` Footnotes view (off) [later]
- [ ] `properties` Properties view (on)
- [ ] `page-preview` Page preview (on)
- [x] `daily-notes` Daily notes (on)
- [x] `templates` Templates (on)
- [x] `note-composer` Note composer (on)
- [x] `command-palette` Command palette (on)
- [x] `slash-command` Slash commands (off)
- [ ] `editor-status` editing mode in status bar (on, not listed)
- [ ] `bookmarks` Bookmarks (on)
- [x] `zk-prefixer` Unique note creator (off) [later]
- [x] `random-note` Random note (off) [later]
- [ ] `outline` Outline (on)
- [ ] `word-count` Word count (on)
- [ ] `slides` Slides (off) [later]
- [ ] `audio-recorder` Audio recorder (off) [later]
- [x] `workspaces` Workspaces (off) [later]
- [x] `file-recovery` File recovery (on)
- [ ] `publish` Publish (off) [ours: not planned]
- [ ] `sync` Sync (on) [ours: Bedrock sync, always available]
- [x] `bases` Bases (on) [later]
- [ ] `webviewer` Web viewer (off) [later]

### Community plugins
- [x] Restricted mode on by default; "turn on community plugins" flow with a warning; per-vault trust prompt when a vault with plugins is opened the first time; stored outside the vault
- [ ] Load each enabled id from `community-plugins.json`; read `manifest.json`; skip if `minAppVersion` is too new or the plugin is mobile-only on mobile
- [x] Run `main.js` as CommonJS with a `require` that gives `obsidian`, the shared `@codemirror/*` and `@lezer/*` packages, and falls through to Node for everything else; map old CodeMirror package names
- [ ] Inject `styles.css`; `loadData` / `saveData` on `data.json`; notify the plugin when `data.json` changes on disk
- [ ] Unload cleanly: everything registered through the plugin is removed
- [x] Installed plugins list in settings: toggle, options, hotkeys, uninstall, open folder, reload, check for updates
- [x] Plugin browser: public community list, downloads and update dates, search, sort, installed only, detail page with README, install / enable / update / uninstall
- [ ] `obsidian` API implemented to match `obsidian.d.ts` (App, Vault, Workspace, MetadataCache, FileManager, Plugin, ItemView, MarkdownView, Editor, Modal, SuggestModal, FuzzySuggestModal, Setting, PluginSettingTab, Notice, Menu, MarkdownRenderer, requestUrl, moment, Platform, setIcon, addIcon, normalizePath, parseYaml, stringifyYaml, debounce, prepareFuzzySearch, ...)
- [ ] Globals and DOM helpers plugins expect (`createEl`, `createDiv`, `createSpan`, `empty`, `setText`, `addClass`, `toggleClass`, `activeWindow`, `activeDocument`, `moment`, `Notice`, `requestUrl`)
- [x] Keychain: secrets store for plugins (settings tab lists secrets) [later]

## 13. Commands

Every command id below must exist with the same id so `hotkeys.json`, plugins and URIs keep working. `[editor]` = needs an active editor. Default hotkeys shown in brackets (Windows; Mod = Ctrl).

#### `app` (20)

- [ ] `app:decrease-font-size` Decrease font size
- [ ] `app:delete-file` Delete current file
- [ ] `app:go-back` Navigate back (Ctrl + Alt + ArrowLeft)
- [ ] `app:go-forward` Navigate forward (Ctrl + Alt + ArrowRight)
- [ ] `app:increase-font-size` Increase font size
- [ ] `app:migrate-frontmatter` Format converter: Frontmatter migration
- [ ] `app:open-another-vault` Open vault...
- [ ] `app:open-file` Open file from outside the vault...
- [ ] `app:open-help` Open help (F1)
- [ ] `app:open-sandbox-vault` Open sandbox vault
- [x] `app:open-settings` Open settings (Ctrl + ,)
- [ ] `app:open-vault` Manage vaults
- [ ] `app:reload` Reload app without saving
- [ ] `app:show-debug-info` Show debug info
- [ ] `app:show-release-notes` Show release notes
- [ ] `app:switch-vault` Change vault...
- [ ] `app:toggle-default-new-pane-mode` Toggle default mode for new tabs
- [ ] `app:toggle-left-sidebar` Toggle left sidebar
- [ ] `app:toggle-ribbon` Toggle ribbon
- [ ] `app:toggle-right-sidebar` Toggle right sidebar

#### `audio-recorder` (2)

- [ ] `audio-recorder:start` Audio recorder: Start recording audio
- [ ] `audio-recorder:stop` Audio recorder: Stop recording audio

#### `backlink` (3)

- [x] `backlink:open` Backlinks: Show backlinks
- [x] `backlink:open-backlinks` Backlinks: Open backlinks for the current note
- [x] `backlink:toggle-backlinks-in-document` Backlinks: Toggle backlinks in document

#### `bases` (6)

- [x] `bases:add-item` Bases: Add item
- [x] `bases:add-view` Bases: Add view
- [x] `bases:change-view` Bases: Switch view...
- [x] `bases:copy-table` Bases: Copy table to clipboard
- [x] `bases:insert` Bases: Insert new base [editor]
- [x] `bases:new-file` Bases: Create new base

#### `bookmarks` (7)

- [x] `bookmarks:bookmark-all-tabs` Bookmarks: Bookmark all tabs...
- [x] `bookmarks:bookmark-current-heading` Bookmarks: Bookmark heading under cursor... [editor]
- [x] `bookmarks:bookmark-current-search` Bookmarks: Bookmark current search...
- [x] `bookmarks:bookmark-current-section` Bookmarks: Bookmark block under cursor... [editor]
- [x] `bookmarks:bookmark-current-view` Bookmarks: Bookmark...
- [x] `bookmarks:open` Bookmarks: Show bookmarks
- [x] `bookmarks:unbookmark-current-view` Bookmarks: Remove bookmark for the current file

#### `canvas` (4)

- [x] `canvas:convert-to-file` Canvas: Convert to file...
- [x] `canvas:export-as-image` Canvas: Export as image
- [x] `canvas:jump-to-group` Canvas: Jump to group
- [x] `canvas:new-file` Canvas: Create new canvas

#### `command-palette` (1)

- [ ] `command-palette:open` Command palette: Open command palette (Ctrl + P)

#### `daily-notes` (3)

- [x] `daily-notes` Daily notes: Open today's daily note
- [x] `daily-notes:goto-next` Daily notes: Open next daily note
- [x] `daily-notes:goto-prev` Daily notes: Open previous daily note

#### `editor` (85)

- [ ] `editor:add-cursor-above` Add cursor above [editor]
- [ ] `editor:add-cursor-below` Add cursor below [editor]
- [ ] `editor:attach-file` Insert attachment [editor]
- [ ] `editor:clear-formatting` Clear formatting [editor]
- [ ] `editor:context-menu` Show context menu under cursor [editor]
- [ ] `editor:cycle-list-checklist` Cycle bullet/checkbox [editor]
- [ ] `editor:delete-paragraph` Delete paragraph (Ctrl + D) [editor]
- [ ] `editor:download-attachments` Download attachments for current file
- [ ] `editor:focus` Focus on last note
- [ ] `editor:focus-bottom` Focus on tab group below
- [ ] `editor:focus-left` Focus on tab group to the left
- [ ] `editor:focus-right` Focus on tab group to the right
- [ ] `editor:focus-top` Focus on tab group above
- [ ] `editor:fold-all` Fold all headings and lists [editor]
- [ ] `editor:fold-less` Fold less [editor]
- [ ] `editor:fold-more` Fold more [editor]
- [ ] `editor:follow-link` Follow link under cursor (Alt + Enter)
- [ ] `editor:indent-list` Indent list item [editor]
- [ ] `editor:insert-callout` Insert callout [editor]
- [ ] `editor:insert-codeblock` Insert code block [editor]
- [ ] `editor:insert-embed` Add embed [editor]
- [ ] `editor:insert-footnote` Insert footnote [editor]
- [ ] `editor:insert-horizontal-rule` Insert horizontal rule [editor]
- [ ] `editor:insert-link` Insert Markdown link (Ctrl + K) [editor]
- [ ] `editor:insert-mathblock` Insert math block [editor]
- [ ] `editor:insert-table` Insert table [editor]
- [ ] `editor:insert-tag` Add tag [editor]
- [ ] `editor:insert-wikilink` Add internal link [editor]
- [ ] `editor:open-link-in-new-leaf` Open link under cursor in new tab (Ctrl + Enter)
- [ ] `editor:open-link-in-new-split` Open link under cursor to the right (Ctrl + Alt + Enter)
- [ ] `editor:open-link-in-new-window` Open link under cursor in new window (Ctrl + Alt + Shift + Enter)
- [ ] `editor:open-search` Search current file (Ctrl + F)
- [ ] `editor:open-search-replace` Search & replace in current file (Ctrl + H)
- [ ] `editor:rename-heading` Rename this heading... [editor]
- [ ] `editor:save-file` Save current file (Ctrl + S)
- [ ] `editor:set-heading` Toggle heading [editor]
- [ ] `editor:set-heading-0` Remove heading [editor]
- [ ] `editor:set-heading-1` Set as heading 1 [editor]
- [ ] `editor:set-heading-2` Set as heading 2 [editor]
- [ ] `editor:set-heading-3` Set as heading 3 [editor]
- [ ] `editor:set-heading-4` Set as heading 4 [editor]
- [ ] `editor:set-heading-5` Set as heading 5 [editor]
- [ ] `editor:set-heading-6` Set as heading 6 [editor]
- [ ] `editor:swap-line-down` Move line down [editor]
- [ ] `editor:swap-line-up` Move line up [editor]
- [ ] `editor:table-col-after` Table: Add column to the right [editor]
- [ ] `editor:table-col-align-center` Table: Align center [editor]
- [ ] `editor:table-col-align-left` Table: Align left [editor]
- [ ] `editor:table-col-align-right` Table: Align right [editor]
- [ ] `editor:table-col-before` Table: Add column to the left [editor]
- [ ] `editor:table-col-copy` Table: Duplicate column [editor]
- [ ] `editor:table-col-delete` Table: Delete column [editor]
- [ ] `editor:table-col-left` Table: Move column left [editor]
- [ ] `editor:table-col-right` Table: Move column right [editor]
- [ ] `editor:table-row-after` Table: Add row below [editor]
- [ ] `editor:table-row-before` Table: Add row above [editor]
- [ ] `editor:table-row-copy` Table: Duplicate row [editor]
- [ ] `editor:table-row-delete` Table: Delete row [editor]
- [ ] `editor:table-row-down` Table: Move row down [editor]
- [ ] `editor:table-row-up` Table: Move row up [editor]
- [ ] `editor:toggle-blockquote` Toggle blockquote [editor]
- [ ] `editor:toggle-bold` Toggle bold (Ctrl + B) [editor]
- [ ] `editor:toggle-bullet-list` Toggle bullet list [editor]
- [ ] `editor:toggle-checklist-status` Toggle checkbox status (Ctrl + L) [editor]
- [ ] `editor:toggle-code` Toggle code [editor]
- [ ] `editor:toggle-comments` Toggle comment (Ctrl + /) [editor]
- [ ] `editor:toggle-fold` Toggle fold on the current line [editor]
- [ ] `editor:toggle-fold-properties` Toggle fold properties in current file
- [ ] `editor:toggle-highlight` Toggle highlight [editor]
- [ ] `editor:toggle-highlight-blue` Toggle blue highlight [editor]
- [ ] `editor:toggle-highlight-green` Toggle green highlight [editor]
- [ ] `editor:toggle-highlight-orange` Toggle orange highlight [editor]
- [ ] `editor:toggle-highlight-purple` Toggle purple highlight [editor]
- [ ] `editor:toggle-highlight-red` Toggle red highlight [editor]
- [ ] `editor:toggle-highlight-yellow` Toggle yellow highlight [editor]
- [ ] `editor:toggle-inline-math` Toggle inline math [editor]
- [ ] `editor:toggle-italics` Toggle italic (Ctrl + I) [editor]
- [ ] `editor:toggle-line-numbers` Toggle line numbers
- [ ] `editor:toggle-numbered-list` Toggle numbered list [editor]
- [ ] `editor:toggle-readable-line-length` Toggle readable line length
- [ ] `editor:toggle-source` Toggle Live Preview/Source mode
- [ ] `editor:toggle-spellcheck` Toggle spellcheck
- [ ] `editor:toggle-strikethrough` Toggle strikethrough [editor]
- [ ] `editor:unfold-all` Unfold all headings and lists [editor]
- [ ] `editor:unindent-list` Unindent list item [editor]

#### `file-explorer` (8)

- [ ] `file-explorer:duplicate-file` Make a copy of the current file
- [ ] `file-explorer:move-file` Move current file to another folder
- [ ] `file-explorer:new-file` Create new note (Ctrl + N)
- [ ] `file-explorer:new-file-in-current-tab` Create new note in current tab
- [ ] `file-explorer:new-file-in-new-pane` Create note to the right (Ctrl + Shift + N)
- [ ] `file-explorer:new-folder` Files: Create new folder
- [ ] `file-explorer:open` Files: Show file explorer
- [ ] `file-explorer:reveal-active-file` Files: Reveal current file in navigation

#### `file-recovery` (1)

- [x] `file-recovery:open` File recovery: Open local history

#### `footnotes` (1)

- [x] `footnotes:open` Footnotes view: Show footnotes

#### `global-search` (1)

- [x] `global-search:open` Search: Search in all files (Ctrl + Shift + F)

#### `graph` (3)

- [x] `graph:animate` Graph view: Start graph timelapse animation
- [x] `graph:open` Graph view: Open graph view (Ctrl + G)
- [x] `graph:open-local` Graph view: Open local graph

#### `insert-current-date` (1)

- [x] `insert-current-date` Templates: Insert current date [editor]

#### `insert-current-time` (1)

- [x] `insert-current-time` Templates: Insert current time [editor]

#### `insert-template` (1)

- [x] `insert-template` Templates: Insert template

#### `insert-unique-link` (1)

- [x] `insert-unique-link` Unique note creator: Add unique internal link [editor]

#### `markdown` (4)

- [ ] `markdown:add-alias` Add alias
- [ ] `markdown:add-metadata-property` Add file property (Ctrl + ;)
- [ ] `markdown:clear-metadata-properties` Clear file properties
- [ ] `markdown:toggle-preview` Toggle reading view (Ctrl + E)

#### `mobile` (1)

- [ ] `mobile:quick-action` Configure mobile Quick Action

#### `note-composer` (3)

- [x] `note-composer:extract-heading` Note composer: Extract this heading... [editor]
- [x] `note-composer:merge-file` Note composer: Merge current file with another file...
- [x] `note-composer:split-file` Note composer: Extract current selection... [editor]

#### `open-with-default-app` (2)

- [ ] `open-with-default-app:open` Open in default app
- [ ] `open-with-default-app:show` Show in system explorer

#### `outgoing-links` (2)

- [x] `outgoing-links:open` Outgoing links: Show outgoing links
- [x] `outgoing-links:open-for-current` Outgoing links: Open outgoing links for the current file

#### `outline` (2)

- [x] `outline:open` Outline: Show outline
- [x] `outline:open-for-current` Outline: Open outline of the current file

#### `properties` (2)

- [x] `properties:open` Properties view: Show all properties
- [x] `properties:open-local` Properties view: Show file properties

#### `publish` (3)

- [ ] `publish:open-in-live-site` Publish: Open in live site
- [ ] `publish:publish-file` Publish: Publish current file
- [ ] `publish:view-changes` Publish: Publish changes...

#### `random-note` (1)

- [x] `random-note` Random note: Open random note

#### `slides` (1)

- [ ] `slides:start` Slides: Start presentation

#### `switcher` (1)

- [ ] `switcher:open` Quick switcher: Open quick switcher (Ctrl + O)

#### `sync` (4)

- [x] `sync:open-sync-log` Sync: Open activity log
- [x] `sync:open-sync-view` Sync: Show Sync history
- [x] `sync:setup` Sync: Set up Sync
- [x] `sync:view-version-history` Sync: Open version history for the current file

#### `tag-pane` (1)

- [x] `tag-pane:open` Tags view: Show tags

#### `theme` (2)

- [x] `theme:switch` Change theme...
- [ ] `theme:toggle-light-dark` Toggle light/dark mode

#### `webviewer` (9)

- [ ] `webviewer:focus-address-bar` Web viewer: Focus address bar
- [ ] `webviewer:open` Web viewer: Open web viewer
- [ ] `webviewer:open-history` Web viewer: Show history
- [ ] `webviewer:save-to-vault` Web viewer: Save to vault
- [ ] `webviewer:search` Web viewer: Search the web
- [ ] `webviewer:toggle-reader-mode` Web viewer: Toggle reader mode
- [ ] `webviewer:zoom-in` Web viewer: Zoom in
- [ ] `webviewer:zoom-out` Web viewer: Zoom out
- [ ] `webviewer:zoom-reset` Web viewer: Reset zoom

#### `window` (4)

- [x] `window:reset-zoom` Reset zoom
- [ ] `window:toggle-always-on-top` Toggle window always on top
- [x] `window:zoom-in` Zoom in
- [x] `window:zoom-out` Zoom out

#### `workspace` (31)

- [ ] `workspace:close` Close current tab (Ctrl + W)
- [ ] `workspace:close-others` Close all other tabs
- [ ] `workspace:close-others-tab-group` Close others in tab group
- [ ] `workspace:close-tab-group` Close this tab group
- [ ] `workspace:close-window` Close window (Ctrl + Shift + W)
- [ ] `workspace:copy-full-path` Copy current file path from system root
- [ ] `workspace:copy-path` Copy current file path from vault folder
- [ ] `workspace:copy-url` Copy Obsidian URL for current file
- [ ] `workspace:edit-file-title` Rename file (F2)
- [ ] `workspace:export-pdf` Export to PDF...
- [ ] `workspace:goto-last-tab` Go to last tab (Ctrl + 9)
- [ ] `workspace:goto-tab-1` Go to tab #1 (Ctrl + 1)
- [ ] `workspace:goto-tab-2` Go to tab #2 (Ctrl + 2)
- [ ] `workspace:goto-tab-3` Go to tab #3 (Ctrl + 3)
- [ ] `workspace:goto-tab-4` Go to tab #4 (Ctrl + 4)
- [ ] `workspace:goto-tab-5` Go to tab #5 (Ctrl + 5)
- [ ] `workspace:goto-tab-6` Go to tab #6 (Ctrl + 6)
- [ ] `workspace:goto-tab-7` Go to tab #7 (Ctrl + 7)
- [ ] `workspace:goto-tab-8` Go to tab #8 (Ctrl + 8)
- [ ] `workspace:move-to-new-window` Move current tab to new window
- [ ] `workspace:new-tab` New tab (Ctrl + T)
- [ ] `workspace:new-window` New window
- [ ] `workspace:next-tab` Go to next tab (Ctrl + Tab, Ctrl + PageDown)
- [ ] `workspace:open-in-new-window` Open current tab in new window
- [ ] `workspace:previous-tab` Go to previous tab (Ctrl + Shift + Tab, Ctrl + PageUp)
- [ ] `workspace:show-trash` Show trash
- [ ] `workspace:split-horizontal` Split down
- [ ] `workspace:split-vertical` Split right
- [ ] `workspace:toggle-pin` Toggle pin
- [ ] `workspace:toggle-stacked-tabs` Toggle stacked tabs
- [ ] `workspace:undo-close-pane` Undo close tab (Ctrl + Shift + T)

#### `workspaces` (4)

- [x] `workspaces:load` Workspaces: Load workspace layout
- [x] `workspaces:open-modal` Workspaces: Manage workspace layouts
- [x] `workspaces:save` Workspaces: Save layout
- [x] `workspaces:save-and-load` Workspaces: Save and load another layout

#### `zk-prefixer` (1)

- [x] `zk-prefixer` Unique note creator: Create new unique note


## 14. Default hotkeys

- [ ] All 41 defaults below (Windows/Linux / macOS)
- [ ] Ctrl + Alt + ArrowLeft / Cmd + Option + ArrowLeft: `app:go-back`
- [ ] Ctrl + Alt + ArrowRight / Cmd + Option + ArrowRight: `app:go-forward`
- [ ] F1 / F1: `app:open-help`
- [ ] Ctrl + , / Cmd + ,: `app:open-settings`
- [ ] Ctrl + P / Cmd + P: `command-palette:open`
- [ ] Ctrl + D / Cmd + D: `editor:delete-paragraph`
- [ ] Alt + Enter / Option + Enter: `editor:follow-link`
- [ ] Ctrl + K / Cmd + K: `editor:insert-link`
- [ ] Ctrl + Enter / Cmd + Enter: `editor:open-link-in-new-leaf`
- [ ] Ctrl + Alt + Enter / Cmd + Option + Enter: `editor:open-link-in-new-split`
- [ ] Ctrl + Alt + Shift + Enter / Cmd + Option + Shift + Enter: `editor:open-link-in-new-window`
- [ ] Ctrl + F / Cmd + F: `editor:open-search`
- [ ] Ctrl + H / Cmd + H: `editor:open-search-replace`
- [ ] Ctrl + S / Cmd + S: `editor:save-file`
- [ ] Ctrl + B / Cmd + B: `editor:toggle-bold`
- [ ] Ctrl + L / Cmd + L: `editor:toggle-checklist-status`
- [ ] Ctrl + / / Cmd + /: `editor:toggle-comments`
- [ ] Ctrl + I / Cmd + I: `editor:toggle-italics`
- [ ] Ctrl + N / Cmd + N: `file-explorer:new-file`
- [ ] Ctrl + Shift + N / Cmd + Shift + N: `file-explorer:new-file-in-new-pane`
- [ ] Ctrl + Shift + F / Cmd + Shift + F: `global-search:open`
- [x] Ctrl + G / Cmd + G: `graph:open`
- [ ] Ctrl + ; / Cmd + ;: `markdown:add-metadata-property`
- [ ] Ctrl + E / Cmd + E: `markdown:toggle-preview`
- [ ] Ctrl + O / Cmd + O: `switcher:open`
- [ ] Ctrl + W / Cmd + W: `workspace:close`
- [ ] Ctrl + Shift + W / Cmd + Shift + W: `workspace:close-window`
- [ ] F2 / F2: `workspace:edit-file-title`
- [ ] Ctrl + 9 / Cmd + 9: `workspace:goto-last-tab`
- [ ] Ctrl + 1 / Cmd + 1: `workspace:goto-tab-1`
- [ ] Ctrl + 2 / Cmd + 2: `workspace:goto-tab-2`
- [ ] Ctrl + 3 / Cmd + 3: `workspace:goto-tab-3`
- [ ] Ctrl + 4 / Cmd + 4: `workspace:goto-tab-4`
- [ ] Ctrl + 5 / Cmd + 5: `workspace:goto-tab-5`
- [ ] Ctrl + 6 / Cmd + 6: `workspace:goto-tab-6`
- [ ] Ctrl + 7 / Cmd + 7: `workspace:goto-tab-7`
- [ ] Ctrl + 8 / Cmd + 8: `workspace:goto-tab-8`
- [ ] Ctrl + T / Cmd + T: `workspace:new-tab`
- [ ] Ctrl + Tab or Ctrl + PageDown / Ctrl + Tab or Ctrl + PageDown: `workspace:next-tab`
- [ ] Ctrl + Shift + Tab or Ctrl + PageUp / Ctrl + Shift + Tab or Ctrl + PageUp: `workspace:previous-tab`
- [ ] Ctrl + Shift + T / Cmd + Shift + T: `workspace:undo-close-pane`

- [ ] Editor keys that are not commands: undo, redo, select all, cut, copy, paste, paste as plain text (Ctrl+Shift+V), arrow and page movement with selection, Tab / Shift+Tab indent, Enter list continuation, Alt+click extra cursor, Ctrl+click link in new tab, Ctrl+hover preview, window zoom (Ctrl+=, Ctrl+-, Ctrl+0)

## 15. Config files

- [ ] `app.json` and `appearance.json` split exactly as Obsidian does (appearance keys: theme, accent color, CSS theme, snippets, fonts, font size, ribbon, view header, native menus, translucency, sidebar behaviour)
- [ ] `core-plugins.json` as an object of id to boolean (migrate the older array form)
- [ ] `community-plugins.json`, `hotkeys.json`, `types.json`, `bookmarks.json`, `graph.json`, `daily-notes.json`, `templates.json`, `zk-prefixer.json`, `note-composer.json`, `switcher.json`, `command-palette.json`, `file-recovery.json`, `backlink.json`, `canvas.json`, `page-preview.json`, `webviewer.json`, `workspaces.json` (defaults in `docs/reference/settings.json`)
- [ ] `workspace.json` layout format (never synced)
- [ ] `plugins/<id>/`, `themes/<name>/`, `snippets/`
- [ ] Reload config when a file changes on disk (sync or another device)

## 16. URIs

- [ ] `open` (vault, file, path, pane type)
- [ ] `new` (name / file / path, content, clipboard, append, prepend, overwrite, silent, pane type)
- [ ] `daily`, `unique`, `search`
- [ ] `hook-get-address`, `choose-vault`, `show-plugin`, `show-theme`
- [ ] Short forms `vault/<vault>/<file>` and absolute path
- [ ] `x-success` / `x-error` callbacks behind the "Allow URI callbacks" setting (off)
- [ ] Register our own scheme; optionally also `obsidian://` when Obsidian is not installed [ours]

## 17. Sync [ours]

Bedrock's sync replaces Obsidian Sync (design in `ARCHITECTURE.md`). Parity items users will look for:
- [x] Built in and free; signs in through the Toolbay account; no vault password
- [x] End-to-end encryption (contents, names, metadata)
- [x] Status bar sync icon with states: synced, syncing, paused, offline, error, not set up; click opens the sync panel
- [x] Sync settings tab: account and vault info, device name, pause/resume, storage used, log
- [x] Selective sync: images, audio, video, PDFs, other types toggles; excluded folders
- [x] Settings sync categories: main settings, appearance, themes and snippets, hotkeys, active core plugins, core plugin settings, active community plugins, installed community plugins
- [x] Version history per file with diff and restore (90 days)
- [x] Deleted files list with restore
- [ ] Conflict handling: three-way merge for text, conflict copy when it cannot merge, notice to the user, snapshot saved before merging
- [x] Guard: an empty or missing local vault pauses sync instead of deleting remote files
- [ ] Sync log (what changed, when, from which device)
- [x] Works offline; catches up on reconnect

## 18. Small states to match

- [ ] Empty new tab; empty sidebar panes; no search results; no backlinks; empty note; empty vault
- [ ] Tooltips on every icon button (label + hotkey where it has one), shown after a short delay, positioned below or beside the target with an arrow
- [ ] Notices (toasts) at the top right, stacking, auto-hide; clickable to dismiss
- [ ] Context menus with icons, separators, submenus, red destructive items, disabled items
- [ ] Confirm dialogs (delete file, merge, update links after rename)
- [ ] Modal prompts (rename, move to folder, insert template, choose file)
- [ ] Drag ghosts and drop overlays when dragging tabs and files
- [ ] Loading spinner in tabs and the indexing progress indicator
- [ ] Error notice when a file cannot be opened or saved
