// Web viewer core plugin ("webviewer"): web pages in a tab, address bar, back/forward/reload,
// reader mode, save page to the vault as Markdown, find in page, zoom, history, search engine,
// ad blocker (main/webviewer.ts) and "open external links" in the app.
// Options in .obsidian/webviewer.json {openExternalURLs, homepage, markdownPath, searchEngine,
// customSearchEngine, enableAdblocking}; ad block lists/frequency are shared by all vaults (app data).
import { ipcRenderer } from "electron";
import { IPC } from "../../../shared/ipc";
import { ItemView } from "../../workspace/view";
import type { WorkspaceLeaf } from "../../workspace/leaf";
import { setIcon } from "../../dom/icons";
import { Menu } from "../../ui/menu";
import { Notice } from "../../ui/notice";
import { SuggestModal } from "../../ui/modal";
import { MarkdownRenderer } from "../../markdown/renderer";
import { CoreOptionsTab, cleanFolder, ensureFolder } from "../shared";
import type { CorePluginImpl, InternalPlugin } from "../manager";
import type { Setting } from "../../ui/setting";
import { addressToUrl, extractArticle, htmlToMarkdown, safeFileName } from "./extract";
export { addressToUrl };

export const VIEW_TYPE_WEBVIEWER = "webviewer";

export const SEARCH_ENGINES: Record<string, { name: string; url: string }> = {
  duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
  brave: { name: "Brave", url: "https://search.brave.com/search?q=%s" },
  bing: { name: "Bing", url: "https://www.bing.com/search?q=%s" },
  google: { name: "Google", url: "https://www.google.com/search?q=%s" },
};

const DEFAULTS = {
  openExternalURLs: true,
  homepage: "",
  markdownPath: "",
  searchEngine: "duckduckgo",
  customSearchEngine: "https://duckduckgo.com/?q=%s",
  enableAdblocking: true,
};

let plugin: InternalPlugin | null = null;
const opt = (k: keyof typeof DEFAULTS): any => plugin?.options[k] ?? DEFAULTS[k];

function searchTemplate(): string {
  const e = opt("searchEngine");
  if (e === "custom") return opt("customSearchEngine") || DEFAULTS.customSearchEngine;
  return SEARCH_ENGINES[e]?.url ?? SEARCH_ENGINES.duckduckgo.url;
}

// ---------------------------------------------------------------- history (shared by all vaults)
interface HistoryItem {
  url: string;
  title: string;
  at: number;
}
const HISTORY_KEY = "webviewer-history";
function readHistory(): HistoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function addHistory(url: string, title: string): void {
  if (!/^https?:/i.test(url)) return;
  const h = readHistory().filter((x) => x.url !== url);
  h.unshift({ url, title: title || url, at: Date.now() });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 1000)));
}

class HistoryModal extends SuggestModal<HistoryItem> {
  constructor(app: any, private onPick: (url: string, newTab: boolean) => void) {
    super(app);
    this.setPlaceholder("Search web viewer history...");
    this.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "↵", purpose: "to open" },
      { command: "ctrl ↵", purpose: "to open in new tab" },
      { command: "esc", purpose: "to dismiss" },
    ]);
  }
  getSuggestions(q: string): HistoryItem[] {
    const s = q.toLowerCase();
    return readHistory().filter((h) => !s || h.title.toLowerCase().includes(s) || h.url.toLowerCase().includes(s));
  }
  renderSuggestion(h: HistoryItem, el: HTMLElement): void {
    el.addClass("mod-complex");
    const c = el.createDiv("suggestion-content");
    c.createDiv({ cls: "suggestion-title", text: h.title });
    c.createDiv({ cls: "suggestion-note", text: h.url });
  }
  onChooseSuggestion(h: HistoryItem, evt: MouseEvent | KeyboardEvent): void {
    this.onPick(h.url, !!(evt.ctrlKey || evt.metaKey));
  }
}

// ---------------------------------------------------------------- the view
export class WebViewerView extends ItemView {
  navigation = true;
  icon = "globe-2";
  url = "";
  title = "";
  mode: "webview" | "reader" = "webview";
  webview: any;
  private addressInput!: HTMLInputElement;
  private readerEl!: HTMLElement;
  private errorEl!: HTMLElement;
  private findEl!: HTMLElement;
  private findInput!: HTMLInputElement;
  private readerBtn!: HTMLElement;
  private ready = false;
  private pendingUrl: string | null = null;
  private zoom = 0;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.buildHeader();
    this.buildContent();
  }

  getViewType(): string {
    return VIEW_TYPE_WEBVIEWER;
  }
  getDisplayText(): string {
    return this.title || this.url.replace(/^https?:\/\//, "") || "New tab";
  }

  private buildHeader(): void {
    this.headerEl.addClass("view-header-always-show");
    // Back/forward move through the page's own history.
    const back = this.backButtonEl.cloneNode(true) as HTMLElement;
    const fwd = this.forwardButtonEl.cloneNode(true) as HTMLElement;
    this.backButtonEl.replaceWith(back);
    this.forwardButtonEl.replaceWith(fwd);
    this.backButtonEl = back;
    this.forwardButtonEl = fwd;
    back.addEventListener("click", () => this.webview?.canGoBack?.() && this.webview.goBack());
    fwd.addEventListener("click", () => this.webview?.canGoForward?.() && this.webview.goForward());
    const reload = createDiv("view-header-reload-button");
    const rb = reload.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Reload" } });
    setIcon(rb, "rotate-cw");
    rb.addEventListener("click", () => this.webview?.reload?.());
    this.headerEl.insertBefore(reload, this.titleContainerEl);
    this.titleContainerEl.addClass("webviewer-address-container");
    this.titleEl.hide();
    const addr = this.titleContainerEl.createDiv("webviewer-address");
    this.addressInput = addr.createEl("input", { attr: { type: "text", spellcheck: "false", placeholder: "Search or enter address" } });
    this.addressInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.navigate(addressToUrl(this.addressInput.value, searchTemplate()));
        this.webview?.focus?.();
      } else if (e.key === "Escape") {
        this.addressInput.value = this.url;
        this.addressInput.blur();
      }
    });
    this.addressInput.addEventListener("focus", () => this.addressInput.select());
    this.readerBtn = this.addAction("glasses", "Reader view", () => this.toggleReaderMode());
  }

  private buildContent(): void {
    this.contentEl.addClass("webviewer-content");
    this.findEl = this.contentEl.createDiv("search-in-page");
    this.findEl.hide();
    this.findInput = this.findEl.createEl("input", { attr: { type: "search", placeholder: "Find in page..." } });
    const prev = this.findEl.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Previous" } });
    setIcon(prev, "arrow-up");
    const next = this.findEl.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Next" } });
    setIcon(next, "arrow-down");
    const close = this.findEl.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Close" } });
    setIcon(close, "x");
    const find = (forward: boolean, findNext: boolean) => {
      const t = this.findInput.value;
      if (t) this.webview?.findInPage?.(t, { forward, findNext });
      else this.webview?.stopFindInPage?.("clearSelection");
    };
    this.findInput.addEventListener("input", () => find(true, false));
    this.findInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") find(!e.shiftKey, true);
      if (e.key === "Escape") this.closeFind();
    });
    prev.addEventListener("click", () => find(false, true));
    next.addEventListener("click", () => find(true, true));
    close.addEventListener("click", () => this.closeFind());

    this.readerEl = this.contentEl.createDiv("reader-mode-content is-readable-line-width");
    this.readerEl.hide();
    const wv = document.createElement("webview") as any;
    wv.setAttribute("partition", "persist:webviewer");
    wv.setAttribute("allowpopups", "");
    wv.setAttribute("webpreferences", "contextIsolation=yes, sandbox=yes");
    this.webview = wv;
    this.contentEl.appendChild(wv);
    this.errorEl = this.contentEl.createDiv("error-notice");
    this.errorEl.hide();

    wv.addEventListener("dom-ready", () => {
      if (!this.ready) {
        this.ready = true;
        wv.setZoomLevel(this.zoom);
        if (this.pendingUrl && this.pendingUrl !== wv.getURL()) wv.loadURL(this.pendingUrl);
        this.pendingUrl = null;
      }
    });
    const onNav = (e: any) => {
      if (!e.url || e.url === "about:blank") return;
      this.url = e.url;
      if (document.activeElement !== this.addressInput) this.addressInput.value = e.url;
      this.errorEl.hide();
      this.syncNav();
      this.app.workspace.requestSaveLayout?.();
    };
    wv.addEventListener("did-navigate", onNav);
    wv.addEventListener("did-navigate-in-page", (e: any) => e.isMainFrame && onNav(e));
    wv.addEventListener("page-title-updated", (e: any) => {
      this.title = e.title;
      addHistory(this.url, this.title);
      this.leaf.updateHeader();
      this.app.workspace.requestSaveLayout?.();
    });
    wv.addEventListener("did-stop-loading", () => {
      this.syncNav();
      if (this.mode === "reader") void this.renderReader();
    });
    wv.addEventListener("did-fail-load", (e: any) => {
      if (!e.isMainFrame || e.errorCode === -3) return; // -3: aborted (a new navigation started)
      this.errorEl.empty();
      this.errorEl.createEl("h1", { text: "This page couldn't load" });
      this.errorEl.createEl("p", { text: `${e.validatedURL || this.url} (${e.errorDescription || "error " + e.errorCode})` });
      this.errorEl.show();
    });
    wv.addEventListener("found-in-page", () => undefined);
  }

  private syncNav(): void {
    const wv = this.webview;
    if (!this.ready) return;
    this.backButtonEl.toggleClass("mod-disabled", !wv.canGoBack());
    this.forwardButtonEl.toggleClass("mod-disabled", !wv.canGoForward());
  }

  updateHeader(): void {
    // The address bar replaces the title; nav buttons follow the page history (syncNav).
    if (this.addressInput && document.activeElement !== this.addressInput) this.addressInput.value = this.url;
  }

  navigate(url: string): void {
    this.url = url;
    this.addressInput.value = url === "about:blank" ? "" : url;
    if (this.ready) this.webview.loadURL(url).catch(() => undefined);
    else if (!this.webview.getAttribute("src")) this.webview.setAttribute("src", url);
    else this.pendingUrl = url;
  }

  getState(): Record<string, any> {
    return { url: this.url, title: this.title, mode: this.mode };
  }

  async setState(state: any, result: { history: boolean }): Promise<void> {
    if (state?.title) this.title = state.title;
    const mode = state?.mode === "reader" ? "reader" : "webview";
    const url = state?.url || opt("homepage") || "about:blank";
    if (url !== this.url || !this.webview.getAttribute("src")) this.navigate(url);
    if (mode !== this.mode) this.setMode(mode);
    if (url === "about:blank") setTimeout(() => this.focusAddressBar(), 50);
    await super.setState(state, result);
    this.leaf.updateHeader();
  }

  focusAddressBar(): void {
    this.addressInput.focus();
    this.addressInput.select();
  }

  setMode(mode: "webview" | "reader"): void {
    this.mode = mode;
    this.readerBtn.toggleClass("is-active", mode === "reader");
    this.webview.style.display = mode === "reader" ? "none" : "";
    this.readerEl.toggle(mode === "reader");
    if (mode === "reader") void this.renderReader();
    this.app.workspace.requestSaveLayout?.();
  }

  toggleReaderMode(): void {
    this.setMode(this.mode === "reader" ? "webview" : "reader");
  }

  /** The page as Markdown (main article only), with its title. */
  async pageMarkdown(): Promise<{ title: string; markdown: string }> {
    const html: string = await this.webview.executeJavaScript("document.documentElement.outerHTML");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const base = this.webview.getURL?.() || this.url;
    const art = extractArticle(doc);
    return { title: this.title || art.title, markdown: htmlToMarkdown(art.content, base) };
  }

  private async renderReader(): Promise<void> {
    if (!this.ready) return;
    try {
      const { markdown } = await this.pageMarkdown();
      this.readerEl.empty();
      const view = this.readerEl.createDiv("markdown-preview-view markdown-rendered");
      const sizer = view.createDiv("markdown-preview-sizer markdown-preview-section");
      await MarkdownRenderer.render(this.app, markdown, sizer, "", this);
      // Links in reader mode navigate this viewer.
      sizer.querySelectorAll("a.external-link").forEach((a) =>
        a.addEventListener(
          "click",
          (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.setMode("webview");
            this.navigate((a as HTMLAnchorElement).href);
          },
          true,
        ),
      );
    } catch (e) {
      this.readerEl.setText("Reader view isn't available for this page.");
    }
  }

  async saveToVault(): Promise<void> {
    try {
      const { title, markdown } = await this.pageMarkdown();
      const folder = cleanFolder(opt("markdownPath"));
      await ensureFolder(this.app, folder);
      const base = (folder ? folder + "/" : "") + safeFileName(title);
      const path = this.app.vault.getAvailablePath(base, "md");
      const file = await this.app.vault.create(path, markdown);
      new Notice(`Saved “${file.basename}” to your vault.`);
      await this.app.workspace.getLeaf("tab").openFile(file);
    } catch (e) {
      new Notice(`Couldn't save this page: ${(e as Error).message}`);
    }
  }

  openFind(): void {
    this.findEl.show();
    this.findInput.focus();
    this.findInput.select();
  }
  private closeFind(): void {
    this.findEl.hide();
    this.webview?.stopFindInPage?.("clearSelection");
  }

  setZoom(delta: number | null): void {
    this.zoom = delta === null ? 0 : Math.max(-8, Math.min(9, this.zoom + delta));
    if (this.ready) this.webview.setZoomLevel(this.zoom);
  }

  onPaneMenu(menu: Menu, source: string): void {
    const split = (dir: "vertical" | "horizontal") => () => {
      const leaf = this.app.workspace.getLeaf("split", dir);
      void leaf.setViewState({ type: VIEW_TYPE_WEBVIEWER, state: { url: this.url }, active: true });
    };
    menu.addItem((i) => i.setTitle("Split right").setIcon("separator-vertical").setSection("open").onClick(split("vertical")));
    menu.addItem((i) => i.setTitle("Split down").setIcon("separator-horizontal").setSection("open").onClick(split("horizontal")));
    menu.addItem((i) => i.setTitle("Find...").setIcon("file-search").setSection("action").onClick(() => this.openFind()));
    menu.addItem((i) =>
      i
        .setTitle("Open in default browser")
        .setIcon("globe-2")
        .setSection("action")
        .onClick(() => ipcRenderer.invoke(IPC.webviewerCall, "openInBrowser", this.url)),
    );
    menu.addItem((i) => i.setTitle("Save to vault").setIcon("file-down").setSection("view").onClick(() => this.saveToVault()));
    menu.addItem((i) => i.setTitle("Zoom in").setIcon("zoom-in").setSection("zoom").onClick(() => this.setZoom(1)));
    menu.addItem((i) => i.setTitle("Reset zoom").setIcon("rotate-cw").setSection("zoom").onClick(() => this.setZoom(null)));
    menu.addItem((i) => i.setTitle("Zoom out").setIcon("zoom-out").setSection("zoom").onClick(() => this.setZoom(-1)));
    super.onPaneMenu(menu, source);
  }

  protected async onClose(): Promise<void> {
    this.webview?.remove();
  }
}

// ---------------------------------------------------------------- settings
class WebViewerTab extends CoreOptionsTab {
  private global: { adblockLists: string[]; adblockFrequency: number } | null = null;
  display(): void {
    if (!this.global) {
      ipcRenderer.invoke(IPC.webviewerCall, "getGlobal").then((g) => {
        this.global = g;
        this.rerender();
      });
    }
    super.display();
  }
  getControlValue(key: string): unknown {
    if (key === "adblockLists") return (this.global?.adblockLists ?? []).join("\n");
    if (key === "adblockFrequency") return this.global?.adblockFrequency ?? 4;
    const v = this.plugin.options[key];
    return v === undefined ? (DEFAULTS as any)[key] : v;
  }
  setControlValue(key: string, value: unknown): void {
    if (key === "adblockLists" || key === "adblockFrequency") {
      const patch = key === "adblockLists" ? { adblockLists: String(value).split(/\r?\n/).map((s) => s.trim()).filter(Boolean) } : { adblockFrequency: Number(value) };
      ipcRenderer.invoke(IPC.webviewerCall, "setGlobal", patch).then((g) => (this.global = g));
      return;
    }
    super.setControlValue(key, value);
    if (key === "enableAdblocking") void ipcRenderer.invoke(IPC.webviewerCall, "setAdblock", !!value);
    if (key === "searchEngine") this.rerender();
  }
  getSettingDefinitions(): any[] {
    return [
      { name: "Open external links", desc: "Open web links from your notes here instead of in your browser.", control: { type: "toggle", key: "openExternalURLs" } },
      { name: "Homepage", desc: "The page a new web viewer starts on.", control: { type: "text", key: "homepage" } },
      { name: "Saved page folder", desc: "Pages you save as Markdown go in this folder.", control: { type: "folder", key: "markdownPath", placeholder: "Example: folder 1/folder 2" } },
      {
        name: "Search engine",
        desc: "Used when you type words instead of an address.",
        control: { type: "dropdown", key: "searchEngine", options: { duckduckgo: "DuckDuckGo", brave: "Brave", bing: "Bing", google: "Google", custom: "Custom" } },
      },
      { name: "Custom search engine", desc: "Search address for the Custom engine; %s is replaced by what you typed.", control: { type: "text", key: "customSearchEngine", placeholder: DEFAULTS.customSearchEngine } },
      { name: "Enable ad blocker", desc: "Block requests to ad and tracker servers from the filter lists below in every web viewer tab.", control: { type: "toggle", key: "enableAdblocking" } },
      { name: "Ad blocking rules", desc: "Filter list addresses, one per line. Used by every vault.", control: { type: "textarea", key: "adblockLists", rows: 3 } },
      { name: "Ad block update frequency", desc: "Days between filter list updates (0 turns updates off). Used by every vault.", control: { type: "slider", key: "adblockFrequency", min: 0, max: 24, step: 1 } },
      {
        name: "Web viewer data",
        desc: "",
        render: (s: Setting) =>
          s.addButton((b) =>
            b.setButtonText("Clear web viewer data").onClick(async () => {
              await ipcRenderer.invoke(IPC.webviewerCall, "clearData");
              localStorage.removeItem(HISTORY_KEY);
              new Notice("Web viewer data cleared.");
            }),
          ),
      },
    ];
  }
}

// ---------------------------------------------------------------- plugin
function activeViewer(app: any): WebViewerView | null {
  const v = app.workspace.activeLeaf?.view;
  return v instanceof WebViewerView ? v : null;
}

async function openUrl(app: any, url: string, newLeaf: boolean | "tab" | "split" = "tab"): Promise<WebViewerView> {
  const leaf = app.workspace.getLeaf(newLeaf);
  await leaf.setViewState({ type: VIEW_TYPE_WEBVIEWER, state: { url }, active: true });
  app.workspace.setActiveLeaf(leaf, { focus: true });
  return leaf.view as WebViewerView;
}

export const webviewerPlugin: CorePluginImpl = {
  id: "webviewer",
  defaultOptions: { ...DEFAULTS },
  onEnable(p) {
    plugin = p;
    const app = p.app;
    p.registerView(VIEW_TYPE_WEBVIEWER, (leaf: WorkspaceLeaf) => new WebViewerView(leaf));
    void ipcRenderer.invoke(IPC.webviewerCall, "setAdblock", !!opt("enableAdblocking"));
    const onPopup = (_e: any, url: string) => void openUrl(app, url, "tab");
    ipcRenderer.on(IPC.webviewerOpenUrl, onPopup);
    p.register(() => ipcRenderer.removeListener(IPC.webviewerOpenUrl, onPopup));
    // Web links from notes open here (Settings › Web viewer › Open external links).
    app.openWebLink = (url: string, newLeaf?: any) => {
      if (!opt("openExternalURLs") || !/^https?:/i.test(url)) return false;
      void openUrl(app, url, newLeaf ?? "tab");
      return true;
    };
    p.register(() => delete app.openWebLink);
    const viewer = (fn: (v: WebViewerView) => any) => (checking: boolean) => {
      const v = activeViewer(app);
      if (!v) return false;
      if (!checking) fn(v);
      return true;
    };
    p.addCommand({ id: "webviewer:open", icon: "globe-2", name: "Web viewer: Open web viewer", callback: () => openUrl(app, opt("homepage") || "about:blank") });
    p.addCommand({ id: "webviewer:open-history", icon: "clock", name: "Web viewer: Show history", callback: () => new HistoryModal(app, (url, tab) => (activeViewer(app) && !tab ? activeViewer(app)!.navigate(url) : openUrl(app, url))).open() });
    p.addCommand({ id: "webviewer:toggle-reader-mode", icon: "glasses", name: "Web viewer: Toggle reader mode", checkCallback: viewer((v) => v.toggleReaderMode()) });
    p.addCommand({ id: "webviewer:focus-address-bar", icon: "text-cursor-input", name: "Web viewer: Focus address bar", checkCallback: viewer((v) => v.focusAddressBar()) });
    p.addCommand({ id: "webviewer:zoom-in", icon: "zoom-in", name: "Web viewer: Zoom in", checkCallback: viewer((v) => v.setZoom(1)) });
    p.addCommand({ id: "webviewer:zoom-reset", icon: "rotate-cw", name: "Web viewer: Reset zoom", checkCallback: viewer((v) => v.setZoom(null)) });
    p.addCommand({ id: "webviewer:zoom-out", icon: "zoom-out", name: "Web viewer: Zoom out", checkCallback: viewer((v) => v.setZoom(-1)) });
    p.addCommand({
      id: "webviewer:search",
      icon: "search",
      name: "Web viewer: Search the web",
      callback: async () => {
        const v = activeViewer(app) ?? (await openUrl(app, "about:blank"));
        v.focusAddressBar();
      },
    });
    p.addCommand({ id: "webviewer:save-to-vault", icon: "file-down", name: "Web viewer: Save to vault", checkCallback: viewer((v) => v.saveToVault()) });
  },
  onDisable() {
    void ipcRenderer.invoke(IPC.webviewerCall, "setAdblock", false);
    plugin = null;
  },
  settingTab: (p) => new WebViewerTab(p),
};
