// The settings window. Like Obsidian 1.14 it opens in its own window (Interface › "Open settings
// in new window", on by default) and falls back to an in-window modal. Navigation: Options tabs,
// then core plugin tabs (alphabetical), then community plugin tabs (alphabetical); a search box
// that searches every declarative tab; sub-pages with a back button.
//
// Extension points (unchanged API):
//   app.setting.addSettingTab(tab, "options" | "core" | "community")
//   app.setting.openTabById(id), app.setting.open(), app.setting.close()
// The Sync tab (sync agent) registers with group "core" and lands between Quick switcher and
// Templates, where Obsidian shows it.
import { Modal } from "../ui/modal";
import { SettingTab, SearchComponent, setSettingsRenderer } from "../ui/setting";
import { setIcon } from "../dom/icons";
import { PopoutWindow } from "./popout";
import { renderDefinitions, refreshDomState, indexDefinitions, type SettingPage, SettingGroup } from "./render";
import { builtinTabs } from "./tabs";

setSettingsRenderer({ renderDefinitions, refreshDomState });

export type Group = "options" | "core" | "community";

export class SettingsModal extends Modal {
  /** Obsidian names: built-in option tabs and plugin tabs (core + community). */
  settingTabs: SettingTab[] = [];
  pluginTabs: SettingTab[] = [];
  private groups = new Map<SettingTab, Group>();
  activeTab: SettingTab | null = null;
  lastTabId = "";
  pageStack: SettingPage[] = [];
  tabHeadersEl: HTMLElement;
  tabContentContainer: HTMLElement;
  private groupContainerEl: HTMLElement;
  private searchResultsEl: HTMLElement;
  searchComponent: SearchComponent;
  backButtonEl: HTMLElement;
  titleTextEl: HTMLElement;
  private popout: PopoutWindow;
  private openState: "closed" | "modal" | "popout" = "closed";
  win: Window | null = null;

  constructor(app: any) {
    super(app);
    this.modalEl.addClass("mod-settings", "mod-sidebar-layout");
    // Header: back button + title (visible while a sub-page is open).
    const closeBtn = this.modalEl.querySelector(".modal-close-button");
    closeBtn?.removeClass("modal-close-button");
    closeBtn?.addClass("modal-header-button", "mod-raised", "clickable-icon");
    this.titleEl.empty();
    this.backButtonEl = this.titleEl.createDiv({ cls: "clickable-icon modal-setting-back-button mod-raised", attr: { "aria-label": "Back" } });
    setIcon(this.backButtonEl, "arrow-left");
    this.backButtonEl.addEventListener("click", () => this.closePage());
    this.titleTextEl = this.titleEl.createDiv();
    this.contentEl.addClass("vertical-tabs-container");
    this.tabHeadersEl = this.contentEl.createDiv("vertical-tab-header");
    const searchWrap = this.tabHeadersEl.createDiv("setting-search-container");
    this.searchComponent = new SearchComponent(searchWrap);
    this.searchComponent.containerEl.addClass("mod-raised");
    this.searchComponent.setPlaceholder("Search settings...");
    this.searchComponent.onChange(() => this.onSearchChanged());
    this.searchResultsEl = this.tabHeadersEl.createDiv("setting-search-results");
    this.groupContainerEl = this.tabHeadersEl.createDiv("vertical-tab-header-group-container");
    this.tabContentContainer = this.contentEl.createDiv("vertical-tab-content-container");
    this.scope.register([], "Escape", () => {
      if (this.pageStack.length) this.closePage();
      else this.close();
      return false;
    });
    this.popout = new PopoutWindow({
      name: "settings",
      width: 900,
      height: 700,
      minWidth: 600,
      minHeight: 400,
      title: this.windowTitle(),
      bodyClasses: ["is-popout-modal"],
      onKeyDown: (e) => this.onPopoutKey(e),
      onClose: () => this.afterClose(),
    });
  }

  get isActive(): boolean {
    return this.openState !== "closed";
  }

  private windowTitle(): string {
    return `Settings - ${this.app.vault.getName()} - ${this.app.brand.displayName}`;
  }

  shouldUsePopout(): boolean {
    return this.app.vault.getConfig("settingsPopoutWindow") !== false;
  }

  // ---------------------------------------------------------------- tabs
  addSettingTab(tab: SettingTab, group: Group = "options"): void {
    tab.app = tab.app ?? this.app;
    this.groups.set(tab, group);
    if (group === "options") {
      if (!this.settingTabs.includes(tab)) this.settingTabs.push(tab);
    } else if (!this.pluginTabs.includes(tab)) this.pluginTabs.push(tab);
    try {
      tab.update?.();
    } catch (e) {
      console.error(e);
    }
    if (this.isActive) this.renderNav();
  }
  addPluginTab(tab: SettingTab): void {
    this.addSettingTab(tab, "community");
  }
  removeSettingTab(tab: SettingTab): void {
    this.settingTabs.remove(tab);
    this.pluginTabs.remove(tab);
    this.groups.delete(tab);
    if (this.activeTab === tab) {
      tab.hide();
      tab.containerEl.detach();
      this.activeTab = null;
      if (this.isActive) this.openTab(this.settingTabs[0]);
    }
    if (this.isActive) this.renderNav();
  }
  removePluginTab(tab: SettingTab): void {
    this.removeSettingTab(tab);
  }
  isPluginSettingTab(tab: SettingTab): boolean {
    return this.groups.get(tab) === "community";
  }
  findTabById(id: string): SettingTab | undefined {
    return [...this.settingTabs, ...this.pluginTabs].find((t) => t.id === id);
  }
  /** Tabs of a group in nav order. */
  tabsIn(group: Group): SettingTab[] {
    const list = (group === "options" ? this.settingTabs : this.pluginTabs).filter((t) => (this.groups.get(t) ?? "options") === group);
    return group === "options" ? list : [...list].sort((a, b) => a.name.localeCompare(b.name));
  }

  openTabById(id: string): SettingTab | undefined {
    if (!this.isActive) this.open();
    const t = this.findTabById(id);
    if (t) this.openTab(t);
    return t;
  }

  // ---------------------------------------------------------------- open / close
  open(): void {
    if (this.isActive) {
      if (this.openState === "popout") this.popout.focus();
      return;
    }
    if (this.shouldUsePopout()) {
      const body = this.popout.open();
      if (body) {
        this.openState = "popout";
        this.win = this.popout.win;
        this.popout.setTitle(this.windowTitle());
        this.modalEl.addClass("is-popout");
        body.appendChild(this.modalEl);
        this.onOpen();
        return;
      }
    }
    this.openState = "modal";
    this.win = window;
    this.modalEl.removeClass("is-popout");
    if (this.modalEl.parentElement !== this.containerEl) this.containerEl.appendChild(this.modalEl);
    super.open();
  }

  close(): void {
    if (this.openState === "popout") {
      this.popout.close(); // calls afterClose via onClose
      return;
    }
    if (this.openState === "modal") {
      super.close();
      this.openState = "closed";
      this.win = null;
    }
  }

  private afterClose(): void {
    if (this.openState !== "popout") return;
    this.openState = "closed";
    this.win = null;
    this.modalEl.detach();
    this.onClose();
  }

  onOpen(): void {
    this.searchComponent.setValue("");
    this.onSearchChanged();
    this.renderNav();
    const t = this.activeTab ?? this.findTabById(this.lastTabId) ?? this.settingTabs[0];
    this.activeTab = null;
    this.openTab(t);
    setTimeout(() => this.searchComponent.inputEl.focus(), 0);
  }

  onClose(): void {
    this.clearPageStack();
    if (this.activeTab) {
      this.lastTabId = this.activeTab.id;
      this.activeTab.hide();
      this.activeTab.containerEl.detach();
      this.activeTab = null;
    }
  }

  private onPopoutKey(e: KeyboardEvent): void {
    if ((window as any).__bedrockRecordingHotkey) return;
    // Modals/suggesters opened from the settings window push keymap scopes; route keys to them.
    const km = this.app.keymap;
    if (km?.scopes?.length) {
      if (km.onKeyEvent(e) === false) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (e.key === "Escape" && !e.defaultPrevented) {
      // Let open popovers/modals inside the window handle Escape first.
      const d = this.popout.doc;
      if (d?.querySelector(".modal-container, .menu, .suggestion-container")) return;
      e.preventDefault();
      if (this.pageStack.length) this.closePage();
      else this.close();
      return;
    }
    // Ctrl/Cmd+F focuses the settings search.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      this.searchComponent.inputEl.focus();
    }
  }

  // ---------------------------------------------------------------- nav
  renderNav(): void {
    const c = this.groupContainerEl;
    c.empty();
    const groups: [Group, string][] = [
      ["options", "Options"],
      ["core", "Core plugins"],
      ["community", "Community plugins"],
    ];
    for (const [g, label] of groups) {
      const tabs = this.tabsIn(g);
      if (!tabs.length && g !== "options") continue;
      const grp = c.createDiv("vertical-tab-header-group");
      grp.createDiv({ cls: "vertical-tab-header-group-title", text: label });
      const items = grp.createDiv("vertical-tab-header-group-items");
      for (const tab of tabs) {
        const it = items.createDiv({ cls: "vertical-tab-nav-item tappable", attr: { "data-tab-id": tab.id } });
        const iconEl = it.createDiv("vertical-tab-nav-item-icon");
        setIcon(iconEl, tab.icon || (g === "community" ? "puzzle" : "settings"));
        it.appendText(tab.name);
        it.createDiv("vertical-tab-nav-item-chevron");
        it.toggleClass("is-active", tab === this.activeTab);
        it.addEventListener("click", () => this.openTab(tab));
      }
    }
  }

  openTab(tab?: SettingTab): void {
    if (!tab) return;
    this.clearPageStack();
    if (this.activeTab && this.activeTab !== tab) {
      this.activeTab.hide();
      this.activeTab.containerEl.detach();
    }
    this.activeTab = tab;
    this.lastTabId = tab.id;
    this.groupContainerEl.querySelectorAll(".vertical-tab-nav-item").forEach((e) => e.toggleClass("is-active", e.getAttribute("data-tab-id") === tab.id));
    this.tabContentContainer.empty();
    this.tabContentContainer.appendChild(tab.containerEl);
    tab.containerEl.empty();
    tab.containerEl.scrollTop = 0;
    try {
      tab.display();
    } catch (e: any) {
      console.error(`Settings tab "${tab.id}" failed`, e);
      tab.containerEl.createDiv({ cls: "setting-item-description", text: `This settings tab couldn't be shown: ${e?.message ?? e}` });
    }
    this.updatePageTitle();
  }

  closeActiveTab(): void {
    this.activeTab?.hide();
  }

  // ---------------------------------------------------------------- sub-pages
  openPage(page: SettingPage): void {
    const current = this.pageStack[this.pageStack.length - 1];
    if (current) current.rootEl.detach();
    else this.activeTab?.containerEl.detach();
    this.pageStack.push(page);
    page.titleEl.setText(page.title);
    page.backButtonEl.onclick = () => this.closePage();
    this.tabContentContainer.appendChild(page.rootEl);
    page.containerEl.empty();
    page.display();
    this.updatePageTitle();
  }

  closePage(): void {
    const page = this.pageStack.pop();
    if (!page) return;
    page.hide();
    page.rootEl.detach();
    const prev = this.pageStack[this.pageStack.length - 1];
    if (prev) {
      this.tabContentContainer.appendChild(prev.rootEl);
      prev.containerEl.empty();
      prev.display();
    } else if (this.activeTab) {
      this.tabContentContainer.appendChild(this.activeTab.containerEl);
      // Values shown on the tab (e.g. "2 enabled") may have changed on the page.
      this.activeTab.containerEl.empty();
      this.activeTab.display();
    }
    this.updatePageTitle();
  }

  clearPageStack(): void {
    for (const p of this.pageStack.splice(0)) {
      p.hide();
      p.rootEl.detach();
    }
    this.updatePageTitle();
  }

  /** Re-render the visible tab or page (after data it shows changed). */
  refreshCurrentPage(): void {
    const page = this.pageStack[this.pageStack.length - 1];
    if (page) {
      page.containerEl.empty();
      page.display();
    } else if (this.activeTab) {
      const top = this.activeTab.containerEl.scrollTop;
      this.activeTab.containerEl.empty();
      this.activeTab.display();
      this.activeTab.containerEl.scrollTop = top;
    }
  }

  private updatePageTitle(): void {
    const page = this.pageStack[this.pageStack.length - 1];
    this.modalEl.toggleClass("mod-page-open", !!page);
    this.titleTextEl.setText(page ? page.title : this.activeTab?.name ?? "");
  }

  // ---------------------------------------------------------------- search
  private onSearchChanged(): void {
    const q = this.searchComponent.getValue().trim().toLowerCase();
    this.searchResultsEl.empty();
    this.groupContainerEl.toggle(!q);
    this.searchResultsEl.toggle(!!q);
    if (!q) return;
    const results: { tab: SettingTab; name: string; group: string | null; pages: string[] }[] = [];
    for (const tab of [...this.tabsIn("options"), ...this.tabsIn("core"), ...this.tabsIn("community")]) {
      let defs: any[] = [];
      try {
        defs = tab.getSettingDefinitions?.() ?? [];
      } catch {
        defs = [];
      }
      const entries = indexDefinitions(defs);
      for (const e of entries) {
        const hay = [e.name, e.desc, ...e.aliases].join(" ").toLowerCase();
        if (q.split(/\s+/).every((w) => hay.includes(w))) results.push({ tab, name: e.name, group: e.group, pages: e.pages });
      }
      if (!entries.length && tab.name.toLowerCase().includes(q)) results.push({ tab, name: tab.name, group: null, pages: [] });
    }
    if (!results.length) {
      this.searchResultsEl.createDiv({ cls: "setting-search-empty u-muted", text: "No settings found." });
      return;
    }
    let lastTab: SettingTab | null = null;
    for (const r of results.slice(0, 200)) {
      if (r.tab !== lastTab) {
        this.searchResultsEl.createDiv({ cls: "vertical-tab-header-group-title", text: r.tab.name });
        lastTab = r.tab;
      }
      const it = this.searchResultsEl.createDiv({ cls: "vertical-tab-nav-item tappable setting-search-result" });
      it.createDiv({ cls: "setting-search-result-name", text: r.name });
      const path = [...r.pages, r.group].filter(Boolean).join(" › ");
      if (path) it.createDiv({ cls: "setting-search-result-path", text: path });
      it.addEventListener("click", () => this.navigateToSearchResult(r.tab, r.name, r.pages));
    }
  }

  private navigateToSearchResult(tab: SettingTab, name: string, pages: string[]): void {
    this.openTab(tab);
    // Follow sub-pages by name.
    for (const p of pages) {
      const row = Array.from(this.tabContentContainer.querySelectorAll(".setting-item.mod-navigable")).find((el) => el.querySelector(".setting-item-name")?.textContent === p) as HTMLElement | undefined;
      row?.click();
    }
    const target = Array.from(this.tabContentContainer.querySelectorAll(".setting-item")).find((el) => el.querySelector(":scope > .setting-item-info > .setting-item-name")?.textContent === name) as HTMLElement | undefined;
    if (target) {
      target.scrollIntoView({ block: "center" });
      target.addClass("is-highlighted");
      setTimeout(() => target.removeClass("is-highlighted"), 1500);
    }
  }
}

export { renderCredit } from "./credit";

export function createSettingsModal(app: any): SettingsModal {
  const m = new SettingsModal(app);
  for (const t of builtinTabs(app)) m.addSettingTab(t, "options");
  return m;
}

export { SettingGroup };
