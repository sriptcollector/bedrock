// App: wires the vault, metadata cache, workspace, commands, settings and plugins together and
// builds the window. `window.app` is this object (plugins rely on that, as in Obsidian).
import { ipcRenderer } from "electron";
import nodePath from "node:path";
import { IPC, type BootInfo } from "../shared/ipc";
import { BRAND } from "../shared/brand";
import { FileSystemAdapter } from "./vault/adapter";
import { Vault } from "./vault/vault";
import { VaultWatcher } from "./vault/watcher";
import { FileManager } from "./vault/file-manager";
import { MetadataCache } from "./metadata/cache";
import { ViewRegistry } from "./workspace/registry";
import { Workspace } from "./workspace/workspace";
import { Commands, HotkeyManager } from "./commands/commands";
import { Keymap, Scope } from "./commands/keymap";
import { registerBuiltinCommands } from "./commands/builtin";
import { createSettingsModal, type SettingsModal } from "./settings/modal";
import { PluginManager } from "./plugins/loader";
import { CustomCss } from "./theme/custom-css";
import { TitleBar, StatusBar } from "./ui/chrome";
import { confirmDialog, promptDialog, setModalApp } from "./ui/modal";
import { Notice } from "./ui/notice";
import { MarkdownView } from "./editor/markdown-view";
import { FileExplorerView } from "./views/file-explorer";
import { registerSimpleViews, IMAGE_EXTS } from "./views/simple-views";
import { registerGraph } from "./views/graph/view";
import { registerCanvas } from "./views/canvas/view";
import { registerSidebar } from "./views/sidebar";
import { PropertyTypes } from "./editor/properties";
import { mountSyncUi } from "./sync-ui";
import { InternalPlugins } from "./core-plugins/manager";
import { applyConfigDirOverride, startSettingsFeatures, afterLayoutSettingsFeatures } from "./settings/bootstrap";
import { scanVault } from "../core/scan";
import type { WorkspaceLeaf } from "./workspace/leaf";
import type { ViewState } from "./workspace/view";

export interface NativeBridge {
  invoke(channel: string, ...args: any[]): Promise<any>;
  on(channel: string, cb: (...a: any[]) => void): () => void;
  windowControl(action: string): Promise<void>;
  setTitle(t: string): void;
  openVaultDialog(): Promise<string | null>;
  getAccount(): Promise<any>;
  checkForUpdates(): Promise<string>;
}

function makeNative(): NativeBridge {
  return {
    invoke: (c, ...a) => ipcRenderer.invoke(c, ...a),
    on: (c, cb) => {
      const h = (_e: unknown, ...a: any[]) => cb(...a);
      ipcRenderer.on(c, h);
      return () => ipcRenderer.removeListener(c, h);
    },
    windowControl: (a) => ipcRenderer.invoke(IPC.windowControl, a),
    setTitle: (t) => void ipcRenderer.invoke(IPC.setTitle, t),
    openVaultDialog: () => ipcRenderer.invoke(IPC.openVaultDialog),
    getAccount: () => ipcRenderer.invoke(IPC.getAccount),
    checkForUpdates: () => ipcRenderer.invoke(IPC.checkForUpdates),
  };
}

const CORE_PLUGINS: Record<string, { name: string; description: string; available: boolean }> = {
  "file-explorer": { name: "Files", description: "See all files in your vault.", available: true },
  "global-search": { name: "Search", description: "Search for text and files in your vault.", available: false },
  switcher: { name: "Quick switcher", description: "Jump to any file with the keyboard.", available: true },
  graph: { name: "Graph view", description: "See how your notes link together.", available: true },
  backlink: { name: "Backlinks", description: "See which notes link to the current note.", available: false },
  canvas: { name: "Canvas", description: "Lay out notes and media on an infinite board.", available: true },
  "outgoing-link": { name: "Outgoing links", description: "See the links in the current note.", available: false },
  "tag-pane": { name: "Tags view", description: "See all tags in your vault.", available: false },
  properties: { name: "Properties view", description: "See all properties in your vault.", available: false },
  "page-preview": { name: "Page preview", description: "Preview a linked note by hovering.", available: false },
  "daily-notes": { name: "Daily notes", description: "Open today's note.", available: false },
  templates: { name: "Templates", description: "Insert templates into notes.", available: false },
  "command-palette": { name: "Command palette", description: "Run any command from the keyboard.", available: true },
  bookmarks: { name: "Bookmarks", description: "Keep important notes close.", available: false },
  outline: { name: "Outline", description: "See the headings of the current note.", available: false },
  "word-count": { name: "Word count", description: "Show the word count in the status bar.", available: true },
  "file-recovery": { name: "File recovery", description: "Restore earlier versions of notes.", available: false },
};

export class App {
  brand = BRAND;
  boot: BootInfo;
  version: string;
  native: NativeBridge;
  vault: Vault;
  metadataCache: MetadataCache;
  fileManager: FileManager;
  viewRegistry = new ViewRegistry();
  workspace: Workspace;
  scope: Scope;
  keymap: Keymap;
  commands: Commands;
  hotkeyManager: HotkeyManager;
  setting: SettingsModal;
  plugins: PluginManager;
  customCss: CustomCss;
  propertyTypes: PropertyTypes;
  statusBar: StatusBar;
  titleBar: TitleBar;
  watcher: VaultWatcher;
  internalPlugins: any;
  secretStorage: any = null;
  protocolHandlers: Record<string, (p: any) => any> = {};
  closedTabs: ViewState[] = [];
  recentCommands: string[] = [];
  appId: string;
  lastEvent: any = null;
  ui = {
    confirm: (o: any) => confirmDialog(this, o),
    prompt: (o: any) => promptDialog(this, o),
  };
  indexStats: any = null;

  constructor(boot: BootInfo, apiModule: () => any, sharedModules: Record<string, any>) {
    this.boot = boot;
    this.version = boot.version;
    this.native = makeNative();
    this.appId = hash(boot.vaultPath);
    const adapter = new FileSystemAdapter(boot.vaultPath);
    this.vault = new Vault(adapter);
    this.metadataCache = new MetadataCache(this.vault);
    this.fileManager = new FileManager(this);
    this.scope = new Scope();
    this.keymap = new Keymap(this.scope);
    this.commands = new Commands(this);
    this.hotkeyManager = new HotkeyManager(this);
    this.workspace = new Workspace(this, this.viewRegistry);
    this.workspace.bindVault(this.vault);
    this.customCss = new CustomCss(this);
    this.propertyTypes = new PropertyTypes(this);
    this.plugins = new PluginManager(this, apiModule, sharedModules);
    this.watcher = new VaultWatcher(this.vault);
    setModalApp(this);
    // Core plugins (core-plugins.json, per-plugin options, behaviour): core-plugins/manager.ts.
    // CORE_PLUGINS["x"].available marks plugins whose views are built elsewhere in the app.
    this.internalPlugins = new InternalPlugins(this, CORE_PLUGINS);
    applyConfigDirOverride(this);
  }

  // ---------- startup ----------
  async start(): Promise<void> {
    const t0 = performance.now();
    document.body.addClass(`mod-${this.boot.platform === "win32" ? "windows" : this.boot.platform === "darwin" ? "macos" : "linux"}`, "is-frameless", "is-hidden-frameless", "mod-desktop");
    await this.vault.loadConfig();
    // Scan the folder and build the tree, then index in the background (worker pool).
    const entries = await scanVault(this.boot.vaultPath);
    this.vault.buildTree(entries);
    const tScan = performance.now();
    const workerScript = nodePath.join(this.distDir(), "index-worker.js").replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
    const indexing = this.metadataCache.initialIndex(workerScript);

    this.buildDom();
    await Promise.all([this.customCss.load(), this.propertyTypes.load()]);
    this.registerCoreViews();
    registerBuiltinCommands(this);
    await this.hotkeyManager.load();
    this.registerRibbon();
    await startSettingsFeatures(this); // keychain, core plugins, zoom (settings/bootstrap.ts)
    window.addEventListener("keydown", (e) => this.onKeyDown(e), true);
    ["mousedown", "keydown", "click"].forEach((t) => window.addEventListener(t, (e) => (this.lastEvent = e), true));

    await this.workspace.loadLayout();
    this.workspace.markLayoutReady();
    const tLayout = performance.now();
    void afterLayoutSettingsFeatures(this);
    this.watcher.start();
    mountSyncUi(this);

    if (this.boot.openFile) this.openAbsolutePath(this.boot.openFile);
    this.native.on(IPC.openPath, (p: string) => this.openAbsolutePath(p));

    const stats = await indexing;
    const tIndex = performance.now();
    this.indexStats = {
      files: stats.files,
      notes: stats.notes,
      scanMs: Math.round(tScan - t0),
      layoutReadyMs: Math.round(tLayout - t0),
      indexMs: stats.ms,
      totalMs: Math.round(tIndex - t0),
    };
    console.log("[bedrock] startup", this.indexStats);
    await this.plugins.initialize();
    if ((this.boot as any).selftest) {
      ipcRenderer.invoke("bedrock:selftest-report", {
        ...this.indexStats,
        resolvedLinkSources: Object.keys(this.metadataCache.resolvedLinks).length,
        uniqueTags: Object.keys(this.metadataCache.getTags()).length,
        leaves: (() => {
          let n = 0;
          this.workspace.iterateAllLeaves(() => n++);
          return n;
        })(),
      });
    }
  }

  distDir(): string {
    // index.html lives in dist/renderer; worker in dist/
    return nodePath.resolve(decodeURIComponent(new URL(".", location.href).pathname).replace(/^\/([a-zA-Z]:)/, "$1"), "..");
  }

  private buildDom(): void {
    const body = document.body;
    body.empty();
    this.titleBar = new TitleBar(this.native, this.boot.platform);
    const appContainer = body.createDiv("app-container");
    const main = appContainer.createDiv("horizontal-main-container");
    main.appendChild(this.workspace.containerEl);
    this.statusBar = new StatusBar(this);
    appContainer.appendChild(this.statusBar.containerEl);
    // Last in the DOM: Chromium applies drag/no-drag regions in document order.
    body.appendChild(this.titleBar.containerEl);
    const markTopRight = () => TitleBar.markTopRight();
    this.workspace.on("layout-change", markTopRight);
    this.workspace.on("resize", markTopRight);
    window.addEventListener("resize", markTopRight);
    this.workspace.on("css-change", () => this.titleBar.syncOverlayColors());
    requestAnimationFrame(() => {
      markTopRight();
      this.titleBar.syncOverlayColors();
    });
    this.setting = createSettingsModal(this);
    body.addEventListener("dragover", (e) => e.preventDefault());
    body.addEventListener("drop", (e) => e.preventDefault());
  }

  private registerCoreViews(): void {
    const r = this.viewRegistry;
    r.registerView("markdown", (leaf: WorkspaceLeaf) => new MarkdownView(leaf));
    r.registerExtensions(["md"], "markdown");
    r.registerView("file-explorer", (leaf: WorkspaceLeaf) => new FileExplorerView(leaf));
    registerSimpleViews(this);
    registerGraph(this);
    registerCanvas(this);
    registerSidebar(this);
  }

  private registerRibbon(): void {
    const rb = this.workspace.leftRibbon;
    rb.addRibbonItemButton("switcher:open", "file-search", "Open quick switcher", () => this.commands.executeCommandById("switcher:open"));
    rb.addRibbonItemButton("graph:Open graph view", "git-fork", "Open graph view", () => this.commands.executeCommandById("graph:open"));
    rb.addRibbonItemButton("canvas:Create new canvas", "layout-dashboard", "Create new canvas", () => this.commands.executeCommandById("canvas:new-file"));
    rb.addRibbonItemButton("command-palette:open", "terminal", "Open command palette", () => this.commands.executeCommandById("command-palette:open"));
    rb.addRibbonItemButton("file-explorer:new-file", "square-pen", "Create new note", () => this.commands.executeCommandById("file-explorer:new-file"));
    rb.addSettingsButton("folder-open", "Open another folder as vault", () => this.native.openVaultDialog());
    rb.addSettingsButton("help-circle", "Help", () => this.openExternal(`https://github.com/${BRAND.repo}#readme`));
    rb.addSettingsButton("settings", "Settings", () => this.setting.open());
  }

  private onKeyDown(e: KeyboardEvent): void {
    if ((window as any).__bedrockRecordingHotkey) return; // Settings › Hotkeys is recording a key
    // Scopes first (modals, plugins), then global command hotkeys.
    const scoped = this.keymap.scopes.length > 0;
    if (scoped) {
      const r = this.keymap.onKeyEvent(e);
      if (r === false) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      return; // a modal is open: don't fire global commands
    }
    if (this.keymap.onKeyEvent(e) === false) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (this.hotkeyManager.onTrigger(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  // ---------- helpers used by views ----------
  loadLocalStorage(key: string): string | null {
    return localStorage.getItem(`${this.appId}-${key}`);
  }
  saveLocalStorage(key: string, value: any): void {
    if (value === null || value === undefined) localStorage.removeItem(`${this.appId}-${key}`);
    else localStorage.setItem(`${this.appId}-${key}`, String(value));
  }
  isDarkMode(): boolean {
    return this.customCss.isDark();
  }
  getTheme(): string {
    return this.isDarkMode() ? "obsidian" : "moonstone";
  }
  openExternal(url: string): void {
    ipcRenderer.invoke(IPC.openExternal, url);
  }
  openWithDefaultApp(path: string): void {
    ipcRenderer.invoke(IPC.openExternal, this.vault.adapter.getFullPath(path));
  }
  showInFolder(path: string): void {
    ipcRenderer.invoke(IPC.revealInFolder, this.vault.adapter.getFullPath(path));
  }

  private openAbsolutePath(abs: string): void {
    const rel = nodePath.relative(this.boot.vaultPath, abs).split(nodePath.sep).join("/");
    if (rel.startsWith("..")) {
      new Notice("That file is outside this vault. Use “Open another folder as vault” to open its folder.");
      return;
    }
    const f = this.vault.getFileByPath(rel);
    if (f) this.workspace.getLeaf(false).openFile(f);
  }

  async importVaultFlow(): Promise<void> {
    const r = await ipcRenderer.invoke(IPC.vaultList);
    void r;
    const res = await ipcRenderer.invoke(IPC.pickFolder);
    if (!res) return;
    const ok = await this.ui.confirm({
      title: "Import vault",
      body: `Copy everything from “${res}” into your ${BRAND.displayName} vault? The original folder isn't changed. Files with the same name get “(imported)” added.`,
      cta: "Import",
    });
    if (!ok) return;
    const out = await ipcRenderer.invoke(IPC.importIntoMainVault, res);
    new Notice(`Imported ${out.copied} files${out.renamed ? `, ${out.renamed} renamed to avoid clashes` : ""}.`);
  }

  // ---------- attachments: paste & drop ----------
  async handlePaste(e: ClipboardEvent, view: MarkdownView): Promise<boolean> {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (!files.length) return false;
    e.preventDefault();
    for (const f of files) await this.saveAttachment(f, view);
    return true;
  }

  handleDrop(e: DragEvent, view: MarkdownView): boolean {
    const path = e.dataTransfer?.getData("application/x-bedrock-file");
    if (path) {
      const f = this.vault.getFileByPath(path);
      if (f && view.file) {
        e.preventDefault();
        const pos = view.cm.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.cm.state.selection.main.head;
        const link = this.fileManager.generateMarkdownLink(f, view.file.path);
        view.cm.dispatch({ changes: { from: pos, insert: link }, selection: { anchor: pos + link.length } });
        return true;
      }
    }
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!files.length) return false;
    e.preventDefault();
    (async () => {
      for (const f of files) await this.saveAttachment(f, view);
    })();
    return true;
  }

  private async saveAttachment(file: File, view: MarkdownView): Promise<void> {
    const src = view.file?.path ?? "";
    let name = file.name || "Pasted image";
    if (!file.name && IMAGE_EXTS.includes(file.type.split("/")[1] ?? "")) {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      name = `Pasted image ${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${file.type.split("/")[1]}`;
    }
    const path = await this.fileManager.getAvailablePathForAttachment(name, src);
    const tf = await this.vault.createBinary(path, await file.arrayBuffer());
    let link = this.fileManager.generateMarkdownLink(tf, src);
    if (!link.startsWith("!") && IMAGE_EXTS.includes(tf.extension)) link = "!" + link;
    view.editor.replaceSelection(link);
  }
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0") + (s.length.toString(16));
}
