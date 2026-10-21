// The community plugin / theme browser window: search, sort, "installed only", a card grid that
// becomes a sidebar list when one item is open, and a details pane with the README (plugins) or
// screenshot (themes) and install / enable / update / uninstall buttons.
import moment from "moment";
import { Modal } from "../../ui/modal";
import { Menu } from "../../ui/menu";
import { Notice } from "../../ui/notice";
import { SearchComponent, Setting } from "../../ui/setting";
import { setIcon } from "../../dom/icons";
import { PopoutWindow } from "../../settings/popout";
import { renderHtml, sanitize } from "../../markdown/renderer";
import {
  getPlugins,
  getThemes,
  getReadme,
  getRepoManifest,
  installPlugin,
  installTheme,
  uninstallTheme,
  resolveInstallVersion,
  compareVersions,
  formatCount,
  isAllowedUrl,
  themeScreenshotUrl,
  type CommunityPlugin,
  type CommunityTheme,
} from "./catalog";

type Kind = "plugins" | "themes";
type SortKey = "downloads" | "updated" | "alphabetical" | "release";
const SORTS: Record<Kind, [SortKey, string][]> = {
  plugins: [
    ["downloads", "Most downloaded"],
    ["updated", "Recently updated"],
    ["alphabetical", "Alphabetical"],
  ],
  themes: [
    ["release", "Listing order"],
    ["alphabetical", "Alphabetical"],
  ],
};
const PAGE = 60;
/** Version reported to plugin manifests (minAppVersion checks): the Obsidian release we match. */
export const COMPAT_APP_VERSION = "1.14.4";

interface Item {
  key: string;
  name: string;
  author: string;
  desc: string;
  repo: string;
  downloads: number;
  updated: number;
  plugin?: CommunityPlugin;
  theme?: CommunityTheme;
  builtin?: boolean;
}

export class CommunityBrowser extends Modal {
  private popout: PopoutWindow;
  private state: "closed" | "modal" | "popout" = "closed";
  private items: Item[] = [];
  private filtered: Item[] = [];
  private shown = 0;
  private selected: Item | null = null;
  private query = "";
  private installedOnly = false;
  private modeOnly = false;
  private sort: SortKey;
  private searchEl!: SearchComponent;
  private summaryEl!: HTMLElement;
  private resultsEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private detailsEl!: HTMLElement;
  private sidebarEl!: HTMLElement;
  private loadError = "";

  constructor(app: any, private kind: Kind) {
    super(app);
    this.modalEl.addClass("mod-community-modal", "mod-sidebar-layout", kind === "plugins" ? "mod-community-plugin" : "mod-community-theme");
    const close = this.modalEl.querySelector(".modal-close-button");
    close?.removeClass("modal-close-button");
    close?.addClass("modal-header-button", "mod-raised", "clickable-icon");
    this.setTitle(kind === "plugins" ? "Community plugins" : "Community themes");
    this.sort = (localStorage.getItem(kind === "plugins" ? "communityPluginSortOrder" : "communityThemeSortOrder") as SortKey) || (kind === "plugins" ? "downloads" : "release");
    if (!SORTS[kind].some(([k]) => k === this.sort)) this.sort = SORTS[kind][0][0];
    this.build();
    this.popout = new PopoutWindow({
      name: "community-" + kind,
      width: 1100,
      height: 800,
      title: this.windowTitle(),
      bodyClasses: ["is-popout-modal"],
      onKeyDown: (e) => this.onKey(e),
      onClose: () => {
        this.state = "closed";
        this.modalEl.detach();
      },
    });
  }

  private windowTitle(): string {
    return `${this.kind === "plugins" ? "Community plugins" : "Community themes"} - ${this.app.vault.getName()} - ${this.app.brand.displayName}`;
  }

  open(focusId?: string): void {
    if (this.state === "closed") {
      const usePopout = this.app.vault.getConfig("settingsPopoutWindow") !== false;
      const body = usePopout ? this.popout.open() : null;
      if (body) {
        this.state = "popout";
        this.popout.setTitle(this.windowTitle());
        this.modalEl.addClass("is-popout");
        body.appendChild(this.modalEl);
      } else {
        this.state = "modal";
        this.modalEl.removeClass("is-popout");
        if (this.modalEl.parentElement !== this.containerEl) this.containerEl.appendChild(this.modalEl);
        super.open();
      }
      void this.load(focusId);
    } else {
      if (this.state === "popout") this.popout.focus();
      if (focusId) this.selectById(focusId);
    }
  }
  close(): void {
    if (this.state === "popout") this.popout.close();
    else if (this.state === "modal") {
      super.close();
      this.state = "closed";
    }
  }
  private onKey(e: KeyboardEvent): void {
    const km = this.app.keymap;
    if (km?.scopes?.length) {
      if (km.onKeyEvent(e) === false) e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (this.selected) this.select(null);
      else this.close();
    }
  }

  // ---------------------------------------------------------------- layout
  private build(): void {
    const c = this.contentEl;
    this.sidebarEl = c.createDiv("modal-sidebar");
    const controls = this.sidebarEl.createDiv("community-modal-controls");
    const searchRow = controls.createDiv("community-modal-search");
    this.searchEl = new SearchComponent(searchRow);
    this.searchEl.containerEl.addClass("mod-raised");
    this.searchEl.setPlaceholder(this.kind === "plugins" ? "Search community plugins..." : "Filter...");
    this.searchEl.onChange((v) => {
      this.query = v;
      this.refilter();
    });
    const sortBtn = searchRow.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Change sort order" } });
    setIcon(sortBtn, "sort-asc");
    sortBtn.addEventListener("click", (e) => {
      const m = new Menu();
      for (const [k, label] of SORTS[this.kind])
        m.addItem((i) =>
          i
            .setTitle(label)
            .setChecked(this.sort === k)
            .onClick(() => {
              this.sort = k;
              localStorage.setItem(this.kind === "plugins" ? "communityPluginSortOrder" : "communityThemeSortOrder", k);
              this.refilter();
            }),
        );
      m.showAtMouseEvent(e);
    });
    new Setting(controls).setName("Show installed only").addToggle((t) =>
      t.setValue(this.installedOnly).onChange((v) => {
        this.installedOnly = v;
        this.refilter();
      }),
    );
    if (this.kind === "themes") {
      const dark = this.app.isDarkMode();
      new Setting(controls).setName(dark ? "Dark themes only" : "Light themes only").addToggle((t) =>
        t.setValue(this.modeOnly).onChange((v) => {
          this.modeOnly = v;
          this.refilter();
        }),
      );
    }
    this.summaryEl = controls.createDiv("community-modal-search-summary u-muted");
    const wrap = this.sidebarEl.createDiv("community-modal-search-results-wrapper");
    this.statusEl = wrap.createDiv("community-modal-search-results-status");
    this.resultsEl = wrap.createDiv("community-modal-search-results");
    wrap.addEventListener("scroll", () => {
      if (wrap.scrollTop + wrap.clientHeight > wrap.scrollHeight - 400) this.renderMore();
    });
    this.detailsEl = c.createDiv("community-modal-details");
    this.detailsEl.hide();
  }

  private async load(focusId?: string): Promise<void> {
    this.loadError = "";
    this.statusEl.setText("Loading the list from GitHub...");
    this.resultsEl.empty();
    try {
      if (this.kind === "plugins") {
        const list = await getPlugins();
        this.items = list.map((p) => ({ key: p.id, name: p.name, author: p.author, desc: p.description, repo: p.repo, downloads: p.downloads, updated: p.updated, plugin: p }));
      } else {
        const list = await getThemes();
        this.items = [
          { key: "", name: "Default", author: this.app.brand.displayName, desc: "The app's own look, in light and dark.", repo: "", downloads: 0, updated: 0, builtin: true },
          ...list.map((t, i) => ({ key: t.name, name: t.name, author: t.author, desc: "", repo: t.repo, downloads: list.length - i, updated: 0, theme: t })),
        ];
      }
      this.statusEl.setText("");
    } catch (e: any) {
      this.loadError = e?.message ?? String(e);
      this.items = this.installedFallback();
      this.statusEl.setText(`Couldn't load the list from GitHub. Check your internet connection and try again. (${this.loadError})`);
    }
    this.refilter();
    if (focusId !== undefined) this.selectById(focusId);
  }

  /** Offline: still show what's installed. */
  private installedFallback(): Item[] {
    if (this.kind === "plugins")
      return Object.values(this.app.plugins.manifests as Record<string, any>).map((m) => ({ key: m.id, name: m.name, author: m.author ?? "", desc: m.description ?? "", repo: "", downloads: 0, updated: 0 }));
    return this.app.customCss.themes.map((n: string) => ({ key: n, name: n, author: this.app.customCss.themeManifests[n]?.author ?? "", desc: "", repo: "", downloads: 0, updated: 0 }));
  }

  private isInstalled(it: Item): boolean {
    if (it.builtin) return true;
    return this.kind === "plugins" ? !!this.app.plugins.manifests[it.key] : this.app.customCss.themes.includes(it.key);
  }

  private refilter(): void {
    const q = this.query.toLowerCase().trim();
    const words = q.split(/\s+/).filter(Boolean);
    const dark = this.app.isDarkMode();
    let list = this.items.filter((it) => {
      if (this.installedOnly && !this.isInstalled(it)) return false;
      if (this.modeOnly && it.theme && !it.theme.modes?.includes(dark ? "dark" : "light")) return false;
      if (!words.length) return true;
      const hay = `${it.name} ${it.author} ${it.desc} ${it.key}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    const by: Record<SortKey, (a: Item, b: Item) => number> = {
      downloads: (a, b) => b.downloads - a.downloads,
      updated: (a, b) => b.updated - a.updated,
      alphabetical: (a, b) => a.name.localeCompare(b.name),
      release: (a, b) => b.downloads - a.downloads,
    };
    list = [...list].sort((a, b) => (a.builtin ? -1 : b.builtin ? 1 : by[this.sort](a, b)));
    // Name matches first when searching.
    if (q) list.sort((a, b) => Number(b.name.toLowerCase().includes(q)) - Number(a.name.toLowerCase().includes(q)));
    this.filtered = list;
    const noun = this.kind === "plugins" ? "plugin" : "theme";
    this.summaryEl.setText(`Showing ${list.length.toLocaleString("en-US")} ${list.length === 1 ? noun : noun + "s"}`);
    this.resultsEl.empty();
    this.shown = 0;
    this.renderMore();
    if (!list.length && !this.loadError) this.statusEl.setText(q ? "Nothing matches your search." : "Nothing to show.");
    else if (!this.loadError) this.statusEl.setText("");
  }

  private renderMore(): void {
    const end = Math.min(this.filtered.length, this.shown + PAGE);
    for (let i = this.shown; i < end; i++) this.renderCard(this.filtered[i]);
    this.shown = end;
  }

  private renderCard(it: Item): void {
    const card = this.resultsEl.createDiv("community-item tappable");
    card.toggleClass("is-selected", this.selected?.key === it.key);
    card.dataset.key = it.key;
    const nameEl = card.createDiv({ cls: "community-item-name", text: it.name });
    if (this.isInstalled(it)) {
      const active = this.kind === "themes" ? this.app.customCss.theme === it.key : !!this.app.plugins.plugins[it.key];
      nameEl.createSpan({ cls: "flair mod-pop", text: this.kind === "themes" ? (active ? "Active" : "Installed") : active ? "Enabled" : "Installed" });
    }
    card.createDiv({ cls: "community-item-author", text: `By ${it.author}` });
    if (this.kind === "plugins") {
      if (it.downloads) {
        const d = card.createDiv("community-item-downloads");
        setIcon(d.createSpan(), "download-cloud");
        d.createSpan({ cls: "community-item-downloads-text", text: formatCount(it.downloads) });
      }
      if (it.updated) card.createDiv({ cls: "community-item-updated", text: `Updated ${moment(it.updated).fromNow()}` });
      card.createDiv({ cls: "community-item-desc", text: it.desc });
    } else {
      const shot = card.createDiv("community-item-screenshot");
      if (it.theme) {
        const img = shot.createEl("img", { attr: { loading: "lazy", alt: "" } });
        const url = themeScreenshotUrl(it.theme);
        if (isAllowedUrl(url)) img.src = url;
      } else shot.addClass("mod-default-theme");
    }
    card.addEventListener("click", () => this.select(it));
  }

  private selectById(id: string): void {
    const it = this.items.find((x) => x.key === id);
    if (it) this.select(it);
  }

  private select(it: Item | null): void {
    this.selected = it;
    this.modalEl.toggleClass("mod-has-selection", !!it);
    this.resultsEl.querySelectorAll(".community-item").forEach((c) => c.toggleClass("is-selected", !!it && (c as HTMLElement).dataset.key === it.key));
    this.detailsEl.toggle(!!it);
    this.detailsEl.empty();
    if (it) void this.renderDetails(it);
  }

  // ---------------------------------------------------------------- details
  private async renderDetails(it: Item): Promise<void> {
    const d = this.detailsEl;
    const bar = d.createDiv("setting-page-titlebar");
    const back = bar.createDiv({ cls: "clickable-icon setting-page-back-button", attr: { "aria-label": "Back" } });
    setIcon(back, "chevron-left");
    back.addEventListener("click", () => this.select(null));
    const info = d.createDiv("community-modal-info");
    const meta = info.createDiv("community-modal-meta");
    meta.createDiv({ cls: "community-modal-info-name", text: it.name });
    if (this.kind === "plugins") await this.pluginDetails(it, meta, d);
    else await this.themeDetails(it, meta, d);
  }

  private link(parent: HTMLElement, text: string, url: string): HTMLAnchorElement {
    const a = parent.createEl("a", { text, href: url });
    a.addEventListener("click", (e) => {
      e.preventDefault();
      this.app.openExternal(url);
    });
    return a;
  }

  private async pluginDetails(it: Item, meta: HTMLElement, d: HTMLElement): Promise<void> {
    const pm = this.app.plugins;
    if (it.downloads) {
      const dl = meta.createDiv("community-modal-info-downloads");
      setIcon(dl.createSpan(), "download-cloud");
      dl.createSpan({ cls: "community-modal-info-downloads-text", text: formatCount(it.downloads) });
    }
    const verEl = meta.createDiv({ cls: "community-modal-info-version", text: "Version: ..." });
    const author = meta.createDiv({ cls: "community-modal-info-author", text: "By " });
    author.appendText(it.author);
    if (it.repo) {
      const r = meta.createDiv({ cls: "community-modal-info-repo", text: "Repository: " });
      this.link(r, `https://github.com/${it.repo}`, `https://github.com/${it.repo}`);
    }
    if (it.updated) {
      const u = meta.createDiv({ cls: "community-modal-info-repo", text: "Last update: " });
      this.link(u, moment(it.updated).fromNow(), `https://github.com/${it.repo}/releases`);
    }
    meta.createDiv({ cls: "community-modal-info-desc", text: it.desc });
    const btns = meta.createDiv("community-modal-button-container");
    const readme = d.createDiv("community-modal-readme markdown-rendered");
    readme.createDiv({ cls: "u-muted", text: "Loading README..." });

    let manifest: any = null;
    if (it.repo) {
      try {
        manifest = await getRepoManifest(it.repo);
        verEl.setText(`Version: ${manifest.version}`);
        if (manifest.authorUrl && isHttp(manifest.authorUrl)) {
          author.empty();
          author.appendText("By ");
          this.link(author, it.author, manifest.authorUrl);
        }
      } catch {
        verEl.setText(it.plugin?.latestVersion ? `Version: ${it.plugin.latestVersion}` : "Version: unknown");
      }
    } else verEl.setText(`Version: ${pm.manifests[it.key]?.version ?? "unknown"}`);

    const render = () => {
      if (this.selected !== it) return;
      btns.empty();
      const installed = pm.manifests[it.key];
      const enabled = pm.enabledPlugins.has(it.key);
      const restricted = !pm.isEnabled();
      if (!installed) {
        const b = btns.createEl("button", { cls: "mod-cta", text: "Install" });
        b.disabled = !it.repo;
        b.addEventListener("click", async () => {
          b.disabled = true;
          b.setText("Installing...");
          try {
            const r = await resolveInstallVersion(it.repo, COMPAT_APP_VERSION);
            await installPlugin(this.app, it.repo, r.version, { id: it.key });
            new Notice(r.note ? `${it.name} installed. ${r.note}` : `${it.name} installed. Turn it on to use it.`);
          } catch (e: any) {
            new Notice(`Couldn't install ${it.name}: ${e?.message ?? e}`);
          }
          this.refreshCard(it);
          render();
        });
      } else {
        if (manifest && compareVersions(manifest.version, installed.version) > 0) {
          const u = btns.createEl("button", { cls: "mod-cta", text: `Update to ${manifest.version}` });
          u.addEventListener("click", async () => {
            u.disabled = true;
            u.setText("Updating...");
            try {
              const r = await resolveInstallVersion(it.repo, COMPAT_APP_VERSION);
              await installPlugin(this.app, it.repo, r.version, { id: it.key });
              new Notice(`${it.name} updated to ${r.version}.`);
            } catch (e: any) {
              new Notice(`Couldn't update ${it.name}: ${e?.message ?? e}`);
            }
            render();
          });
        }
        const en = btns.createEl("button", { cls: enabled ? "" : "mod-cta", text: enabled ? "Disable" : "Enable" });
        if (restricted && !enabled) en.setAttr("aria-label", "Restricted mode is on: the plugin will run once you turn community plugins on.");
        en.addEventListener("click", async () => {
          if (enabled) await pm.disablePluginAndSave(it.key);
          else {
            const ok = await pm.enablePluginAndSave(it.key);
            if (restricted) new Notice("Turned on. It runs once you leave Restricted mode in Settings › Community plugins.");
            else if (!ok) new Notice(`“${it.name}” couldn't start.`);
          }
          this.refreshCard(it);
          this.app.setting?.refreshCurrentPage?.();
          render();
        });
        if (pm.plugins[it.key] && this.app.setting?.findTabById?.(it.key)) {
          btns.createEl("button", { text: "Options" }).addEventListener("click", () => this.app.setting.openTabById(it.key));
        }
        if (pm.plugins[it.key])
          btns.createEl("button", { text: "Hotkeys" }).addEventListener("click", () => {
            const hk: any = this.app.setting.findTabById("hotkeys");
            if (hk) hk.query = it.name;
            this.app.setting.openTabById("hotkeys");
          });
        const un = btns.createEl("button", { cls: "mod-warning", text: "Uninstall" });
        un.addEventListener("click", async () => {
          await pm.uninstallPlugin(it.key);
          new Notice(`${it.name} uninstalled.`);
          this.refreshCard(it);
          this.app.setting?.refreshCurrentPage?.();
          render();
        });
      }
      if (it.repo) btns.createEl("button", { text: "View on GitHub" }).addEventListener("click", () => this.app.openExternal(`https://github.com/${it.repo}`));
      const fund = manifest?.fundingUrl;
      const fundUrl = typeof fund === "string" ? fund : fund && typeof fund === "object" ? Object.values(fund)[0] : null;
      if (fundUrl && isHttp(String(fundUrl))) btns.createEl("button", { text: "Donate" }).addEventListener("click", () => this.app.openExternal(String(fundUrl)));
    };
    render();

    if (!it.repo) {
      readme.empty();
      return;
    }
    try {
      const md = await getReadme(it.repo);
      if (this.selected !== it) return;
      readme.empty();
      if (!md) readme.createDiv({ cls: "u-muted", text: "This plugin has no README." });
      else renderReadme(this.app, md, readme, it.repo);
    } catch (e: any) {
      readme.empty();
      readme.createDiv({ cls: "u-muted", text: `Couldn't load the README: ${e?.message ?? e}` });
    }
  }

  private async themeDetails(it: Item, meta: HTMLElement, d: HTMLElement): Promise<void> {
    const css = this.app.customCss;
    meta.createDiv({ cls: "community-modal-info-author", text: `By ${it.author}` });
    if (it.repo) {
      const r = meta.createDiv({ cls: "community-modal-info-repo", text: "Repository: " });
      this.link(r, `https://github.com/${it.repo}`, `https://github.com/${it.repo}`);
    }
    if (it.theme?.modes?.length) meta.createDiv({ cls: "community-modal-info-version", text: `Works in: ${it.theme.modes.map((m) => (m === "dark" ? "dark mode" : "light mode")).join(", ")}` });
    const btns = meta.createDiv("community-modal-button-container");
    if (it.builtin) meta.createDiv({ cls: "community-modal-info-desc", text: it.desc });
    const render = () => {
      if (this.selected !== it) return;
      btns.empty();
      const installed = this.isInstalled(it);
      const active = it.builtin ? !css.theme : css.theme === it.key;
      if (active) {
        const b = btns.createEl("button", { text: "Active" });
        b.disabled = true;
      } else if (installed) {
        btns.createEl("button", { cls: "mod-cta", text: "Use" }).addEventListener("click", async () => {
          await css.setTheme(it.builtin ? "" : it.key);
          this.refreshAll();
          render();
        });
      } else {
        const b = btns.createEl("button", { cls: "mod-cta", text: "Install and use" });
        b.addEventListener("click", async () => {
          b.disabled = true;
          b.setText("Installing...");
          try {
            await installTheme(this.app, it.theme!);
            await css.setTheme(it.key);
          } catch (e: any) {
            new Notice(`Couldn't install ${it.name}: ${e?.message ?? e}`);
          }
          this.refreshAll();
          render();
        });
        const b2 = btns.createEl("button", { text: "Install" });
        b2.addEventListener("click", async () => {
          b2.disabled = true;
          try {
            await installTheme(this.app, it.theme!);
            new Notice(`${it.name} installed.`);
          } catch (e: any) {
            new Notice(`Couldn't install ${it.name}: ${e?.message ?? e}`);
          }
          this.refreshAll();
          render();
        });
      }
      if (installed && !it.builtin) {
        btns.createEl("button", { text: "Update" }).addEventListener("click", async () => {
          try {
            await installTheme(this.app, it.theme!);
            new Notice(`${it.name} updated.`);
          } catch (e: any) {
            new Notice(`Couldn't update ${it.name}: ${e?.message ?? e}`);
          }
        });
        btns.createEl("button", { cls: "mod-warning", text: "Uninstall" }).addEventListener("click", async () => {
          await uninstallTheme(this.app, it.key);
          this.refreshAll();
          render();
        });
      }
      if (it.repo) btns.createEl("button", { text: "View on GitHub" }).addEventListener("click", () => this.app.openExternal(`https://github.com/${it.repo}`));
    };
    render();
    if (it.theme) {
      const shot = d.createDiv("community-modal-screenshot");
      const url = themeScreenshotUrl(it.theme);
      if (isAllowedUrl(url)) shot.createEl("img", { attr: { src: url, alt: `${it.name} screenshot` } });
    }
  }

  private refreshCard(it: Item): void {
    const card = Array.from(this.resultsEl.querySelectorAll<HTMLElement>(".community-item")).find((c) => c.dataset.key === it.key);
    if (!card) return;
    const tmp = this.resultsEl.ownerDocument.createElement("div");
    const keep = this.resultsEl;
    this.resultsEl = tmp as any;
    this.renderCard(it);
    this.resultsEl = keep;
    const fresh = tmp.firstElementChild as HTMLElement;
    fresh.addEventListener("click", () => this.select(it));
    card.replaceWith(fresh);
  }
  private refreshAll(): void {
    const keepSel = this.selected;
    this.refilter();
    if (keepSel) this.resultsEl.querySelectorAll(".community-item").forEach((c) => c.toggleClass("is-selected", (c as HTMLElement).dataset.key === keepSel.key));
  }
}

function isHttp(u: string): boolean {
  return /^https?:\/\//i.test(u);
}

/** Render a GitHub README safely: relative links/images resolved against the repo, images only
 * from GitHub (others become links so nothing else is contacted), links open in the browser. */
export function renderReadme(app: any, md: string, el: HTMLElement, repo: string): void {
  const html = renderHtml(md, { strictLineBreaks: true });
  const t = el.ownerDocument.createElement("template");
  t.innerHTML = html;
  sanitize(t.content);
  const rawBase = `https://raw.githubusercontent.com/${repo}/HEAD/`;
  const blobBase = `https://github.com/${repo}/blob/HEAD/`;
  for (const img of Array.from(t.content.querySelectorAll("img"))) {
    let src = img.getAttribute("src") ?? "";
    if (src && !/^[a-z]+:/i.test(src)) src = rawBase + src.replace(/^\.?\//, "");
    src = src.replace(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/(blob|raw)\//, "https://raw.githubusercontent.com/$1/");
    if (isAllowedUrl(src)) {
      img.setAttribute("src", src);
      img.setAttribute("loading", "lazy");
    } else {
      const a = el.ownerDocument.createElement("a");
      a.textContent = img.getAttribute("alt") || "Image (opens in your browser)";
      a.setAttribute("href", src);
      a.className = "external-link";
      img.replaceWith(a);
    }
  }
  for (const a of Array.from(t.content.querySelectorAll("a"))) {
    let href = a.getAttribute("href") ?? "";
    if (href.startsWith("#")) continue;
    if (href && !/^[a-z]+:/i.test(href)) href = blobBase + href.replace(/^\.?\//, "");
    a.setAttribute("href", href);
    a.classList.add("external-link");
    a.removeAttribute("data-href");
  }
  // Videos/iframes would load other sites: drop them.
  t.content.querySelectorAll("video, iframe, audio, source, picture > source").forEach((n) => n.remove());
  el.appendChild(t.content);
  el.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      const target = el.querySelector(`[id="${CSS.escape(href.slice(1))}"]`);
      target?.scrollIntoView();
    } else if (isHttp(href)) app.openExternal(href);
  });
}
