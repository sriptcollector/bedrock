// Every core plugin of Obsidian 1.14 with the same id, display name and default state
// (docs/reference/settings.json). Descriptions are our own wording.
export interface CorePluginInfo {
  id: string;
  name: string;
  description: string;
  defaultOn: boolean;
  /** Settings tab icon. */
  icon?: string;
  /** Not listed in Settings › Core plugins (editor-status is the "Show editing mode" option). */
  hidden?: boolean;
  /** Built without a registered implementation (views/commands live elsewhere in the app). */
  available?: boolean;
  /** Shown instead of a working toggle when the plugin can't work in Bedrock. */
  unavailableNote?: string;
  /** Older Obsidian core plugin kept in Bedrock but not listed by 1.14 (only saved once used). */
  legacy?: boolean;
}

export const CORE_PLUGIN_LIST: CorePluginInfo[] = [
  { id: "file-explorer", name: "Files", description: "Browse every file and folder in your vault.", defaultOn: true, available: true, icon: "folder-closed" },
  { id: "global-search", name: "Search", description: "Find text and files anywhere in your vault.", defaultOn: true, icon: "search" },
  { id: "switcher", name: "Quick switcher", description: "Jump to any note by typing part of its name.", defaultOn: true, available: true, icon: "file-search" },
  { id: "graph", name: "Graph view", description: "See your notes and the links between them as a network.", defaultOn: true, icon: "git-fork" },
  { id: "backlink", name: "Backlinks", description: "List the notes that link to the note you have open, plus mentions of its name that aren't linked yet.", defaultOn: true, icon: "links-coming-in" },
  { id: "canvas", name: "Canvas", description: "Arrange notes, media and cards on an endless board.", defaultOn: true, icon: "layout-dashboard" },
  { id: "outgoing-link", name: "Outgoing links", description: "List the links in the note you have open, including names that could become links.", defaultOn: true, icon: "links-going-out" },
  { id: "tag-pane", name: "Tags view", description: "Browse every tag in your vault and how often it's used.", defaultOn: true, icon: "tags" },
  { id: "footnotes", name: "Footnotes view", description: "List the footnotes of the note you have open.", defaultOn: false, icon: "footprints" },
  { id: "properties", name: "Properties view", description: "Browse every property used across your vault.", defaultOn: true, icon: "archive" },
  { id: "page-preview", name: "Page preview", description: "Hover over an internal link to see the note it points to. Some places need Ctrl held down; set them in the options.", defaultOn: true, icon: "scan-eye" },
  { id: "daily-notes", name: "Daily notes", description: "Open or create a note for today.", defaultOn: true, icon: "calendar" },
  { id: "templates", name: "Templates", description: "Insert prepared snippets of text into the note you're editing.", defaultOn: true, icon: "files" },
  { id: "note-composer", name: "Note composer", description: "Merge notes together and split parts of a note into new notes.", defaultOn: true, icon: "merge" },
  { id: "command-palette", name: "Command palette", description: "Run any command by typing its name.", defaultOn: true, available: true, icon: "terminal" },
  { id: "slash-command", name: "Slash commands", description: "Type / in a note to search and run commands.", defaultOn: false, icon: "slash" },
  { id: "editor-status", name: "Show editing mode in status bar", description: "Show and switch the editing mode from the status bar.", defaultOn: true, hidden: true },
  { id: "bookmarks", name: "Bookmarks", description: "Keep shortcuts to notes, folders, searches, headings and blocks.", defaultOn: true, icon: "bookmark" },
  { id: "zk-prefixer", name: "Unique note creator", description: "Create notes whose names start with a time stamp, handy for Zettelkasten-style note taking.", defaultOn: false, icon: "sheets-in-box" },
  { id: "random-note", name: "Random note", description: "Open a note picked at random from your vault.", defaultOn: false, icon: "dice" },
  { id: "outline", name: "Outline", description: "Show the headings of the note you have open.", defaultOn: true, icon: "list" },
  { id: "word-count", name: "Word count", description: "Count the words and characters in the status bar.", defaultOn: true, available: true, icon: "binary" },
  { id: "slides", name: "Slides", description: "Present a note as slides, split at horizontal rules.", defaultOn: false, icon: "presentation" },
  { id: "audio-recorder", name: "Audio recorder", description: "Record audio from your microphone and save it into the vault.", defaultOn: false, icon: "mic" },
  { id: "workspaces", name: "Workspaces", description: "Save layouts of panes and tabs and switch between them.", defaultOn: false, icon: "layout" },
  { id: "file-recovery", name: "File recovery", description: "Keeps snapshots of your notes on this computer so you can get back text you lost.", defaultOn: true, icon: "history" },
  { id: "publish", name: "Publish", description: "Publish notes as a website.", defaultOn: false, icon: "send", unavailableNote: "Publishing to the web isn't part of this app. Your notes stay on your computers." },
  { id: "sync", name: "Sync", description: "Keep this vault in sync across your computers with your Toolbay account.", defaultOn: true, available: true, icon: "refresh-cw" },
  { id: "bases", name: "Bases", description: "Build table and card views of your notes from their properties.", defaultOn: true, icon: "layout-list" },
  { id: "webviewer", name: "Web viewer", description: "Open web links inside the app.", defaultOn: false, icon: "globe-2" },
  { id: "markdown-importer", name: "Format converter", description: "Convert notes written with other apps' Markdown into this app's format.", defaultOn: false, icon: "file-input", legacy: true },
];
