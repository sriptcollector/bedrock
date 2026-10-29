// Appearance: light/dark base theme, accent color, fonts, font size, community themes
// (.obsidian/themes/<name>/theme.css) and CSS snippets (.obsidian/snippets/*.css). Values live in
// the vault config (appearance.json keys, see Vault.APPEARANCE_KEYS) and only non-default values
// are written, like Obsidian.
import { Events } from "../api/events";
import { isAccessError, VaultAccessError } from "../../core/scan";

export const DEFAULT_ACCENT = "#8a5cf5";

export interface ThemeManifest {
  name: string;
  version?: string;
  minAppVersion?: string;
  author?: string;
  authorUrl?: string;
  dir?: string;
}

export class CustomCss extends Events {
  themes: string[] = [];
  /** name -> manifest for installed themes (folder name is the theme name). */
  themeManifests: Record<string, ThemeManifest> = {};
  snippets: string[] = [];
  private themeEl: HTMLStyleElement;
  private snippetEls = new Map<string, HTMLStyleElement>();
  private accentEl: HTMLStyleElement;
  private media = window.matchMedia("(prefers-color-scheme: dark)");
  private wheelHandler: ((e: WheelEvent) => void) | null = null;

  constructor(private app: any) {
    super();
    this.accentEl = document.head.createEl("style", { attr: { id: "bedrock-accent" } });
    this.themeEl = document.head.createEl("style", { attr: { id: "css-theme" } });
    this.media.addEventListener("change", () => this.applyBase());
  }

  private get cfg() {
    return this.app.vault;
  }
  get baseTheme(): string {
    return this.cfg.getConfig("theme") || "system";
  }
  get theme(): string {
    return this.cfg.getConfig("cssTheme") || "";
  }
  get accentColor(): string {
    return this.cfg.getConfig("accentColor") || "";
  }
  get fontSize(): number {
    const n = Number(this.cfg.getConfig("baseFontSize"));
    return Number.isFinite(n) && n > 0 ? Math.min(30, Math.max(10, n)) : 16;
  }
  get enabledSnippets(): Set<string> {
    return new Set<string>(this.cfg.getConfig("enabledCssSnippets") ?? []);
  }

  get themesDir(): string {
    return this.app.vault.configDir + "/themes";
  }
  get snippetsDir(): string {
    return this.app.vault.configDir + "/snippets";
  }

  private listening = false;
  async load(): Promise<void> {
    if (!this.listening) {
      this.listening = true;
      this.app.vault.on("config-changed", (k: string) => {
        if (["showInlineTitle", "showRibbon", "showViewHeader", "floatingNavigation", "autoFullScreen", "translucency", "tabSize", "baseFontSizeAction"].includes(k)) this.applyInterface();
      });
    }
    await this.readThemes();
    await this.readSnippets();
    this.applyAll();
    await this.applyTheme();
    await this.applySnippets();
  }

  async readThemes(): Promise<void> {
    const a = this.app.vault.adapter;
    this.themes = [];
    this.themeManifests = {};
    try {
      const list = await a.list(this.themesDir);
      for (const folder of list.folders) {
        const name = folder.split("/").pop()!;
        this.themes.push(name);
        let m: ThemeManifest = { name };
        try {
          m = { ...JSON.parse(await a.read(folder + "/manifest.json")), name };
        } catch {
          /* manifest optional */
        }
        m.dir = folder;
        this.themeManifests[name] = m;
      }
      // Very old single-file themes: themes/<name>.css
      for (const f of list.files) if (f.endsWith(".css")) {
        const name = f.split("/").pop()!.slice(0, -4);
        if (!this.themes.includes(name)) {
          this.themes.push(name);
          this.themeManifests[name] = { name, dir: this.themesDir };
        }
      }
    } catch (e) {
      if (isAccessError(e)) throw new VaultAccessError(e); // not allowed to read: don't pretend there are no themes
      /* none */
    }
    this.themes.sort((x, y) => x.localeCompare(y));
  }

  async readSnippets(): Promise<void> {
    try {
      this.snippets = (await this.app.vault.adapter.list(this.snippetsDir)).files
        .filter((f: string) => f.toLowerCase().endsWith(".css"))
        .map((f: string) => f.split("/").pop()!.slice(0, -4))
        .sort((x: string, y: string) => x.localeCompare(y));
    } catch (e) {
      if (isAccessError(e)) throw new VaultAccessError(e);
      this.snippets = [];
    }
  }

  isDark(): boolean {
    const t = this.baseTheme;
    return t === "obsidian" || (t !== "moonstone" && this.media.matches);
  }

  /** Body classes and CSS variables driven by appearance + interface settings. */
  applyAll(): void {
    this.applyBase();
    this.applyAccent();
    this.applyFonts();
    this.applyInterface();
  }

  applyBase(): void {
    const dark = this.isDark();
    document.body.toggleClass("theme-dark", dark);
    document.body.toggleClass("theme-light", !dark);
    document.body.style.setProperty("--font-text-size", this.fontSize + "px");
    this.trigger("change");
    this.app.workspace?.trigger("css-change");
  }

  applyFonts(): void {
    const s = document.body.style;
    const set = (v: string, val: string) => (val ? s.setProperty(v, quoteFonts(val)) : s.removeProperty(v));
    set("--font-interface-override", this.cfg.getConfig("interfaceFontFamily") || "");
    set("--font-text-override", this.cfg.getConfig("textFontFamily") || "");
    set("--font-print-override", this.cfg.getConfig("textFontFamily") || "");
    set("--font-monospace-override", this.cfg.getConfig("monospaceFontFamily") || "");
  }

  applyInterface(): void {
    const b = document.body;
    const c = this.cfg;
    b.toggleClass("show-inline-title", c.getConfig("showInlineTitle") !== false);
    b.toggleClass("show-ribbon", c.getConfig("showRibbon") !== false);
    b.toggleClass("show-view-header", c.getConfig("showViewHeader") !== false);
    b.toggleClass("is-floating-nav", c.getConfig("floatingNavigation") !== false);
    b.toggleClass("auto-full-screen", c.getConfig("autoFullScreen") !== false);
    b.toggleClass("is-translucent", !!c.getConfig("translucency"));
    b.style.setProperty("--indent-size", String(Number(c.getConfig("tabSize")) || 4));
    // Quick font size adjustment: Ctrl/Cmd + wheel changes the font size.
    const want = !!c.getConfig("baseFontSizeAction");
    if (want && !this.wheelHandler) {
      this.wheelHandler = (e: WheelEvent) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        this.setFontSize(this.fontSize + (e.deltaY < 0 ? 1 : -1));
      };
      window.addEventListener("wheel", this.wheelHandler, { passive: false });
    } else if (!want && this.wheelHandler) {
      window.removeEventListener("wheel", this.wheelHandler);
      this.wheelHandler = null;
    }
  }

  private applyAccent(): void {
    const hsl = hexToHsl(this.accentColor);
    this.accentEl.textContent = hsl ? `body { --accent-h: ${hsl.h}; --accent-s: ${hsl.s}%; --accent-l: ${hsl.l}%; }` : "";
  }

  private async applyTheme(): Promise<void> {
    this.themeEl.textContent = "";
    const name = this.theme;
    if (name) {
      const a = this.app.vault.adapter;
      // A missing theme falls back to the default look; a theme we may not read is an error.
      for (const p of [`${this.themesDir}/${name}/theme.css`, `${this.themesDir}/${name}/obsidian.css`, `${this.themesDir}/${name}.css`]) {
        try {
          this.themeEl.textContent = await a.read(p);
          break;
        } catch (e) {
          if (isAccessError(e)) throw new VaultAccessError(e);
        }
      }
    }
    this.trigger("change");
    this.app.workspace?.trigger("css-change");
  }

  private async applySnippets(): Promise<void> {
    for (const el of this.snippetEls.values()) el.remove();
    this.snippetEls.clear();
    const on = this.enabledSnippets;
    for (const s of this.snippets) {
      if (!on.has(s)) continue;
      try {
        const css = await this.app.vault.adapter.read(`${this.snippetsDir}/${s}.css`);
        const el = document.head.createEl("style", { attr: { "data-snippet": s } });
        el.textContent = css;
        this.snippetEls.set(s, el);
      } catch (e) {
        if (isAccessError(e)) throw new VaultAccessError(e);
        /* skip */
      }
    }
    this.trigger("change");
    this.app.workspace?.trigger("css-change");
  }

  setBaseTheme(t: string): void {
    this.cfg.setConfig("theme", t === "system" ? undefined : t);
    this.applyBase();
  }
  setAccentColor(c: string): void {
    this.cfg.setConfig("accentColor", c && c.toLowerCase() !== DEFAULT_ACCENT ? c : undefined);
    this.applyAccent();
    this.trigger("change");
  }
  setFontSize(n: number): void {
    n = Math.min(30, Math.max(10, Math.round(n)));
    this.cfg.setConfig("baseFontSize", n);
    this.applyBase();
  }
  setFont(key: "interfaceFontFamily" | "textFontFamily" | "monospaceFontFamily", value: string): void {
    this.cfg.setConfig(key, value || undefined);
    this.applyFonts();
    this.trigger("change");
  }
  async setTheme(t: string): Promise<void> {
    this.cfg.setConfig("cssTheme", t || undefined);
    await this.applyTheme();
  }
  async setSnippet(s: string, on: boolean): Promise<void> {
    const set = this.enabledSnippets;
    on ? set.add(s) : set.delete(s);
    this.cfg.setConfig("enabledCssSnippets", [...set]);
    await this.applySnippets();
  }
  async reloadSnippets(): Promise<void> {
    await this.readSnippets();
    await this.applySnippets();
  }
  async reloadThemes(): Promise<void> {
    await this.readThemes();
    await this.applyTheme();
  }
  /** Theme CSS + snippet CSS currently applied (popout windows mirror these). */
  getAppliedStyleEls(): HTMLStyleElement[] {
    return [this.accentEl, this.themeEl, ...this.snippetEls.values()];
  }
}

/** Font family names with spaces get quoted; lists ("A, B") are kept as typed. */
export function quoteFonts(v: string): string {
  return v
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => (/^["'].*["']$/.test(f) || !/\s/.test(f) ? f : `"${f}"`))
    .join(", ");
}

/** Accent color to HSL: #rgb, #rgba, #rrggbb, #rrggbbaa (alpha ignored) or rgb()/rgba(). */
export function hexToHsl(color: string): { h: number; s: number; l: number } | null {
  const rgb = parseRgb((color || "").trim());
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = 0,
    hue = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue *= 60;
  }
  return { h: Math.round(hue), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function parseRgb(c: string): [number, number, number] | null {
  const hex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = [...h].map((x) => x + x).join("");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  // rgb(1, 2, 3) / rgba(1, 2, 3, 0.5) / rgb(1 2 3 / 50%), channels as numbers or percentages.
  const fn = /^rgba?\(\s*([^)]*)\)$/i.exec(c);
  if (!fn) return null;
  const parts = fn[1].split(/\s*[,/]\s*|\s+/).filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) return null;
  const ch = parts.slice(0, 3).map((p) => {
    const m = /^(\d+(?:\.\d+)?|\.\d+)(%?)$/.exec(p);
    if (!m) return NaN;
    return Math.min(255, Math.max(0, m[2] ? (Number(m[1]) * 255) / 100 : Number(m[1])));
  });
  return ch.every(Number.isFinite) ? (ch as [number, number, number]) : null;
}
