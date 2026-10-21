// Appearance: light/dark base theme, accent color, font size, community themes
// (.obsidian/themes/<name>/theme.css) and CSS snippets (.obsidian/snippets/*.css), all stored in
// .obsidian/appearance.json like Obsidian.
import { Events } from "../api/events";

export class CustomCss extends Events {
  baseTheme = "obsidian"; // "obsidian" (dark) | "moonstone" (light) | "system"
  theme = "";
  themes: string[] = [];
  snippets: string[] = [];
  enabledSnippets = new Set<string>();
  accentColor = "";
  fontSize = 16;
  private data: Record<string, any> = {};
  private themeEl: HTMLStyleElement;
  private snippetEls = new Map<string, HTMLStyleElement>();
  private accentEl: HTMLStyleElement;
  private media = window.matchMedia("(prefers-color-scheme: dark)");

  constructor(private app: any) {
    super();
    this.accentEl = document.head.createEl("style", { attr: { id: "bedrock-accent" } });
    this.themeEl = document.head.createEl("style", { attr: { id: "css-theme" } });
    this.media.addEventListener("change", () => this.applyBase());
  }

  private get path(): string {
    return this.app.vault.configDir + "/appearance.json";
  }

  async load(): Promise<void> {
    const a = this.app.vault.adapter;
    try {
      this.data = JSON.parse(await a.read(this.path)) ?? {};
    } catch {
      this.data = {};
    }
    this.baseTheme = this.data.theme ?? "obsidian";
    this.theme = this.data.cssTheme ?? "";
    this.accentColor = this.data.accentColor ?? "";
    this.fontSize = this.data.baseFontSize ?? 16;
    this.enabledSnippets = new Set(this.data.enabledCssSnippets ?? []);
    this.themes = [];
    this.snippets = [];
    const dir = this.app.vault.configDir;
    try {
      this.themes = (await a.list(dir + "/themes")).folders.map((f: string) => f.split("/").pop()!);
    } catch {
      /* none */
    }
    try {
      this.snippets = (await a.list(dir + "/snippets")).files.filter((f: string) => f.endsWith(".css")).map((f: string) => f.split("/").pop()!.slice(0, -4));
    } catch {
      /* none */
    }
    this.applyBase();
    this.applyAccent();
    await this.applyTheme();
    await this.applySnippets();
  }

  private save(): void {
    this.data.theme = this.baseTheme;
    if (this.theme) this.data.cssTheme = this.theme;
    else delete this.data.cssTheme;
    if (this.accentColor) this.data.accentColor = this.accentColor;
    this.data.baseFontSize = this.fontSize;
    this.data.enabledCssSnippets = [...this.enabledSnippets];
    this.app.vault.adapter.write(this.path, JSON.stringify(this.data, null, 2));
  }

  isDark(): boolean {
    return this.baseTheme === "obsidian" || (this.baseTheme === "system" && this.media.matches);
  }

  applyBase(): void {
    const dark = this.isDark();
    document.body.toggleClass("theme-dark", dark);
    document.body.toggleClass("theme-light", !dark);
    document.body.style.setProperty("--font-text-size", this.fontSize + "px");
    this.app.workspace?.trigger("css-change");
  }

  private applyAccent(): void {
    if (!this.accentColor) {
      this.accentEl.textContent = "";
      return;
    }
    const h = this.accentColor.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16) / 255,
      g = parseInt(h.slice(2, 4), 16) / 255,
      b = parseInt(h.slice(4, 6), 16) / 255;
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
    this.accentEl.textContent = `body { --accent-h: ${Math.round(hue)}; --accent-s: ${Math.round(s * 100)}%; --accent-l: ${Math.round(l * 100)}%; }`;
  }

  private async applyTheme(): Promise<void> {
    this.themeEl.textContent = "";
    if (!this.theme) return;
    try {
      this.themeEl.textContent = await this.app.vault.adapter.read(`${this.app.vault.configDir}/themes/${this.theme}/theme.css`);
    } catch {
      try {
        // Very old themes lived as a single file.
        this.themeEl.textContent = await this.app.vault.adapter.read(`${this.app.vault.configDir}/themes/${this.theme}.css`);
      } catch {
        /* missing theme: default look */
      }
    }
    this.app.workspace?.trigger("css-change");
  }

  private async applySnippets(): Promise<void> {
    for (const el of this.snippetEls.values()) el.remove();
    this.snippetEls.clear();
    for (const s of this.snippets) {
      if (!this.enabledSnippets.has(s)) continue;
      try {
        const css = await this.app.vault.adapter.read(`${this.app.vault.configDir}/snippets/${s}.css`);
        const el = document.head.createEl("style", { attr: { "data-snippet": s } });
        el.textContent = css;
        this.snippetEls.set(s, el);
      } catch {
        /* skip */
      }
    }
  }

  setBaseTheme(t: string): void {
    this.baseTheme = t;
    this.applyBase();
    this.save();
  }
  setAccentColor(c: string): void {
    this.accentColor = c;
    this.applyAccent();
    this.save();
  }
  setFontSize(n: number): void {
    this.fontSize = n;
    this.applyBase();
    this.save();
  }
  async setTheme(t: string): Promise<void> {
    this.theme = t;
    await this.applyTheme();
    this.save();
  }
  async setSnippet(s: string, on: boolean): Promise<void> {
    on ? this.enabledSnippets.add(s) : this.enabledSnippets.delete(s);
    await this.applySnippets();
    this.save();
  }
}
