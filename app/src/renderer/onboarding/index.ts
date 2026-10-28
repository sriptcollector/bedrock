// First-run setup guide: three short pages that hand the person two prompts for their Claude (build
// a personal wiki in this vault, then keep it up to date every day) and let them pick graph colours,
// app colours and a book theme. Shows once on the first start of the main vault; reopen it with the
// command "Open onboarding" or Settings › General › Setup guide.
// Texts and file formats: core/onboarding.ts. Book theme CSS: ./themes.ts.
import { Modal } from "../ui/modal";
import { Notice } from "../ui/notice";
import { writeClipboard } from "../shell/clipboard";
import { updateGraphJson } from "../views/graph/view";
import { BOOK_SNIPPET, CLAUDE_SNIPPET, bookThemeCss } from "./themes";
import {
  APP_PRESETS,
  BOOK_THEMES,
  DEFAULT_SCHEME,
  GRADIENT_SCHEMES,
  INSTRUCTIONS_PATH,
  MODE_LABELS,
  RECOLOR_REQUEST_BODY,
  RECOLOR_REQUEST_TITLE,
  THEME_REQUEST_BODY,
  THEME_REQUEST_TITLE,
  addRequest,
  areaLevelColor,
  buildDailyPrompt,
  buildWikiPrompt,
  isoDate,
  mergeAreaColorGroups,
  newInstructionsFile,
  preferredSchemeName,
  setPreferences,
  type AppPreset,
  type BookThemeId,
  type GradientScheme,
} from "../../core/onboarding";

/** App-wide (not per vault): the guide shows once per computer. */
const DONE_KEY = "bedrock-onboarding-done";
const STYLE_ID = "bedrock-onboarding-style";

export function mountOnboarding(app: any): void {
  installStyles();
  app.commands.addCommand({
    id: "bedrock:open-onboarding",
    name: "Open onboarding",
    icon: "sparkles",
    callback: () => openOnboarding(app),
  });
  if (shouldAutoOpen(app)) setTimeout(() => openOnboarding(app), 400);
}

function shouldAutoOpen(app: any): boolean {
  if (localStorage.getItem(DONE_KEY)) return false;
  if (!app.boot?.isMainVault || app.boot?.smokeTest || (app.boot as any)?.selftest) return false;
  // Test runs use their own app data dir; they opt in with BEDROCK_ONBOARDING=1.
  const env = typeof process !== "undefined" ? process.env : ({} as any);
  if (env.BEDROCK_NO_ONBOARDING) return false;
  if (env.BEDROCK_USER_DATA && !env.BEDROCK_ONBOARDING) return false;
  return true;
}

let current: OnboardingModal | null = null;

export function openOnboarding(app: any, page = 0): OnboardingModal {
  if (current) current.close();
  current = new OnboardingModal(app, page);
  current.open();
  return current;
}

// ---------- vault helpers ----------

async function readInstructions(app: any): Promise<string | null> {
  try {
    const a = app.vault.adapter;
    return (await a.exists(INSTRUCTIONS_PATH)) ? await a.read(INSTRUCTIONS_PATH) : null;
  } catch {
    return null;
  }
}

async function writeInstructions(app: any, text: string): Promise<void> {
  const folder = INSTRUCTIONS_PATH.slice(0, INSTRUCTIONS_PATH.lastIndexOf("/"));
  if (!app.vault.getFolderByPath(folder)) {
    try {
      await app.vault.createFolder(folder);
    } catch {
      /* already there on disk */
    }
  }
  const f = app.vault.getFileByPath(INSTRUCTIONS_PATH);
  if (f) await app.vault.modify(f, text);
  else await app.vault.create(INSTRUCTIONS_PATH, text);
}

/** Make sure the instructions file exists before Claude is told to read it. */
export async function ensureInstructionsFile(app: any): Promise<void> {
  if ((await readInstructions(app)) === null) await writeInstructions(app, newInstructionsFile());
}

async function readSnippet(app: any, name: string): Promise<string | null> {
  try {
    const p = `${app.vault.configDir}/snippets/${name}.css`;
    return (await app.vault.adapter.exists(p)) ? await app.vault.adapter.read(p) : null;
  } catch {
    return null;
  }
}

/** The book theme in use, from the snippet's marker line. */
async function currentBookTheme(app: any): Promise<BookThemeId> {
  const on = app.customCss.enabledSnippets as Set<string>;
  if (on.has(BOOK_SNIPPET)) {
    const css = (await readSnippet(app, BOOK_SNIPPET)) ?? "";
    const m = /bedrock-book-theme: ([a-z]+)/.exec(css);
    if (m && BOOK_THEMES.some((t) => t.id === m[1])) return m[1] as BookThemeId;
  }
  if (on.has(CLAUDE_SNIPPET)) return "claude";
  return "none";
}

/** Apply a book theme right away (snippet file + appearance.json enabledCssSnippets, both synced). */
export async function applyBookTheme(app: any, id: BookThemeId): Promise<void> {
  const css = app.customCss;
  if (id === "none" || id === "claude") {
    if (css.enabledSnippets.has(BOOK_SNIPPET)) await css.setSnippet(BOOK_SNIPPET, false);
    // Classic means Bedrock as it is: Claude's theme goes off too (it stays on disk).
    if (id === "none" && css.enabledSnippets.has(CLAUDE_SNIPPET)) await css.setSnippet(CLAUDE_SNIPPET, false);
    return;
  }
  const path = `${app.vault.configDir}/snippets/${BOOK_SNIPPET}.css`;
  await app.vault.adapter.write(path, `/* bedrock-book-theme: ${id} */\n` + bookThemeCss(id));
  await css.readSnippets();
  if (css.enabledSnippets.has(CLAUDE_SNIPPET)) await css.setSnippet(CLAUDE_SNIPPET, false);
  if (!css.enabledSnippets.has(BOOK_SNIPPET)) await css.setSnippet(BOOK_SNIPPET, true);
  else await css.reloadSnippets();
}

/** Graph colour groups for a scheme (keeps the person's own groups). */
export async function applyGradient(app: any, scheme: GradientScheme): Promise<void> {
  await updateGraphJson(app, (stored) => ({ ...stored, colorGroups: mergeAreaColorGroups(stored?.colorGroups, scheme) }));
}

export function applyAppColors(app: any, preset: AppPreset, mode: AppPreset["mode"]): void {
  app.customCss.setAccentColor(preset.accent);
  app.customCss.setBaseTheme(mode === "system" ? "system" : mode);
}

// ---------- the modal ----------

export class OnboardingModal extends Modal {
  page: number;
  scheme: GradientScheme = DEFAULT_SCHEME;
  preset: AppPreset | null = null;
  mode: AppPreset["mode"] = "system";
  theme: BookThemeId = "none";
  private prevSchemeName: string | null = null;
  private finished = false;
  private bodyEl!: HTMLElement;
  private footEl!: HTMLElement;
  private noteCountTimer: any = null;

  constructor(app: any, page = 0) {
    super(app);
    this.page = page;
    this.modalEl.addClass("bedrock-onboarding");
    this.headerEl.detach();
  }

  async onOpen(): Promise<void> {
    const text = await readInstructions(this.app);
    this.prevSchemeName = preferredSchemeName(text);
    if (this.prevSchemeName) this.scheme = GRADIENT_SCHEMES.find((s) => s.name === this.prevSchemeName) ?? DEFAULT_SCHEME;
    const accent = (this.app.customCss.accentColor || "#8a5cf5").toLowerCase();
    this.preset = APP_PRESETS.find((p) => p.accent === accent) ?? null;
    const base = this.app.customCss.baseTheme;
    this.mode = base === "moonstone" || base === "obsidian" ? base : "system";
    this.theme = await currentBookTheme(this.app);
    this.render();
  }

  onClose(): void {
    clearInterval(this.noteCountTimer);
    localStorage.setItem(DONE_KEY, isoDate());
    if (current === this) current = null;
  }

  private go(page: number): void {
    this.page = page;
    this.render();
  }

  private renderedPage = -1;
  render(): void {
    clearInterval(this.noteCountTimer);
    const keepScroll = this.renderedPage === this.page ? this.bodyEl?.scrollTop ?? 0 : 0;
    this.renderedPage = this.page;
    const c = this.contentEl;
    c.empty();
    this.bodyEl = c.createDiv("bedrock-ob-body");
    this.footEl = c.createDiv("bedrock-ob-foot");
    if (this.page === 0) this.renderWiki();
    else if (this.page === 1) this.renderDaily();
    else this.renderLook();
    const dots = this.footEl.createDiv("bedrock-ob-dots");
    this.bodyEl.scrollTop = keepScroll;
    for (let i = 0; i < 3; i++) {
      const d = dots.createEl("button", { cls: "bedrock-ob-dot" + (i === this.page ? " is-active" : ""), attr: { "aria-label": `Step ${i + 1} of 3` } });
      d.addEventListener("click", () => this.go(i));
    }
  }

  private title(t: string, sub?: string): void {
    this.bodyEl.createDiv({ cls: "bedrock-ob-step", text: `Step ${this.page + 1} of 3` });
    this.bodyEl.createEl("h2", { cls: "bedrock-ob-title", text: t });
    if (sub) this.bodyEl.createDiv({ cls: "bedrock-ob-sub", text: sub });
  }

  private promptBox(text: string, onCopy?: () => void): void {
    const box = this.bodyEl.createDiv("bedrock-ob-prompt");
    const ta = box.createEl("textarea", { cls: "bedrock-ob-prompt-text", attr: { readonly: "true", spellcheck: "false", rows: "7", "aria-label": "Prompt for Claude" } });
    ta.value = text;
    const btn = box.createEl("button", { cls: "mod-cta bedrock-ob-copy", text: "Copy prompt" });
    btn.addEventListener("click", async () => {
      try {
        await writeClipboard(text);
      } catch {
        ta.select();
        document.execCommand("copy");
      }
      btn.setText("Copied");
      btn.addClass("is-copied");
      setTimeout(() => {
        btn.setText("Copy prompt");
        btn.removeClass("is-copied");
      }, 2000);
      onCopy?.();
    });
  }

  private buttons(back: boolean, next: string, onNext: () => void): void {
    const row = this.footEl.createDiv("bedrock-ob-buttons");
    if (back) row.createEl("button", { text: "Back" }).addEventListener("click", () => this.go(this.page - 1));
    const n = row.createEl("button", { cls: "mod-cta", text: next });
    n.addEventListener("click", onNext);
  }

  // Page 1: build the wiki.
  private renderWiki(): void {
    this.title("This is how to use Bedrock");
    this.bodyEl.createEl("p", {
      text: "Bedrock keeps notes about you and builds a personal Wikipedia of all your projects and everything about you.",
    });
    this.bodyEl.createEl("p", { cls: "bedrock-ob-lead", text: "Start by giving this prompt to your Claude" });
    this.promptBox(buildWikiPrompt(this.app.boot.vaultPath, this.scheme), () => void ensureInstructionsFile(this.app));
    const tip = this.bodyEl.createEl("p", { cls: "bedrock-ob-hint" });
    tip.appendText("Works best in Claude Code or the Claude desktop app. To let Claude write notes straight into Bedrock, connect it in ");
    const link = tip.createEl("a", { text: "Settings › Connect an AI agent", attr: { href: "#" } });
    link.addEventListener("click", (e) => {
      e.preventDefault();
      this.app.setting.open();
      this.app.setting.openTabById("agents");
    });
    tip.appendText(".");
    const seen = this.bodyEl.createEl("p", { cls: "bedrock-ob-status" });
    const count = () => {
      const n = this.app.vault.getMarkdownFiles().length;
      seen.setText(n > 3 ? `Once Claude is done, you'll see your notes here. ${n} notes so far.` : "Once Claude is done, you'll see your notes here.");
    };
    count();
    this.noteCountTimer = setInterval(count, 2000);
    this.buttons(false, "I've prompted Claude", () => {
      void ensureInstructionsFile(this.app);
      this.go(1);
    });
  }

  // Page 2: the daily update.
  private renderDaily(): void {
    this.title("Keep it up to date", "Optional, highly recommended");
    this.bodyEl.createEl("p", {
      text: "Give Claude this prompt too. It sets up a daily update that logs what you did that day and keeps your projects and people notes fresh.",
    });
    this.promptBox(buildDailyPrompt(this.app.boot.vaultPath), () => void ensureInstructionsFile(this.app));
    const ul = this.bodyEl.createEl("ul", { cls: "bedrock-ob-notes" });
    ul.createEl("li", { text: "Everything stays on your computer. Nothing is uploaded unless you turn on sync." });
    ul.createEl("li", {
      text: "Sync between your computers is optional and off until you turn it on in Settings › Sync. It runs through Toolbay and is locked with a sync passphrase you choose: your notes are encrypted on your computer before they're sent, and Toolbay only keeps that locked copy (plus 90 days of history), which it can't read.",
    });
    this.buttons(true, "I'm done, next step", () => this.go(2));
  }

  // Page 3: colours and theme.
  private renderLook(): void {
    this.title("Make it yours", "Changes show right away. You can change them later with “Open onboarding”.");
    // (a) graph colours
    this.bodyEl.createDiv({ cls: "bedrock-ob-label", text: "Graph colors" });
    this.bodyEl.createDiv({ cls: "bedrock-ob-hint", text: "Each part of your life gets its own color, faint for old notes and strong where you worked lately." });
    const schemes = this.bodyEl.createDiv("bedrock-ob-grid");
    for (const s of GRADIENT_SCHEMES) {
      const tile = tileEl(schemes, "bedrock-ob-tile" + (s.id === this.scheme.id ? " is-selected" : ""), s.name);
      const bar = tile.createDiv("bedrock-ob-gradient");
      bar.style.background = `linear-gradient(90deg, ${s.colors.join(", ")})`;
      const fade = tile.createDiv("bedrock-ob-fade");
      fade.style.background = `linear-gradient(90deg, ${[1, 2, 3, 4].map((l) => areaLevelColor(s, 0, l)).join(", ")})`;
      tile.createDiv({ cls: "bedrock-ob-tile-name", text: s.name });
      tile.addEventListener("click", async () => {
        this.scheme = s;
        this.render();
        await applyGradient(this.app, s).catch((e: any) => new Notice(`Couldn't save the graph colors: ${e?.message ?? e}`));
      });
    }
    // (b) app colours
    this.bodyEl.createDiv({ cls: "bedrock-ob-label", text: "App colors" });
    const presets = this.bodyEl.createDiv("bedrock-ob-grid");
    for (const p of APP_PRESETS) {
      const tile = tileEl(presets, "bedrock-ob-tile is-preset" + (p.id === this.preset?.id ? " is-selected" : ""), p.name);
      const sw = tile.createDiv("bedrock-ob-swatch");
      sw.style.background = p.accent;
      sw.addClass(p.mode === "obsidian" ? "is-dark" : p.mode === "moonstone" ? "is-light" : "is-auto");
      tile.createDiv({ cls: "bedrock-ob-tile-name", text: p.name });
      tile.createDiv({ cls: "bedrock-ob-tile-desc", text: MODE_LABELS[p.mode] });
      tile.addEventListener("click", () => {
        this.preset = p;
        this.mode = p.mode;
        applyAppColors(this.app, p, p.mode);
        this.render();
      });
    }
    const modes = this.bodyEl.createDiv("bedrock-ob-modes");
    modes.createSpan({ cls: "bedrock-ob-hint", text: "Mode" });
    for (const m of ["system", "moonstone", "obsidian"] as const) {
      const b = tileEl(modes, "bedrock-ob-mode" + (m === this.mode ? " is-selected" : ""), MODE_LABELS[m]);
      b.setText(MODE_LABELS[m]);
      b.addEventListener("click", () => {
        this.mode = m;
        this.app.customCss.setBaseTheme(m);
        this.render();
      });
    }
    // (c) book theme
    this.bodyEl.createDiv({ cls: "bedrock-ob-label", text: "Theme" });
    const themes = this.bodyEl.createDiv("bedrock-ob-grid");
    for (const t of BOOK_THEMES) {
      const tile = tileEl(themes, `bedrock-ob-tile is-theme mod-${t.id}` + (t.id === this.theme ? " is-selected" : ""), t.name);
      tile.createDiv({ cls: "bedrock-ob-tile-name", text: t.name });
      tile.createDiv({ cls: "bedrock-ob-tile-desc", text: t.desc });
      tile.addEventListener("click", async () => {
        this.theme = t.id;
        this.render();
        await applyBookTheme(this.app, t.id).catch((e: any) => new Notice(`Couldn't apply the theme: ${e?.message ?? e}`));
        if (t.id === "claude") new Notice("Claude will design your theme the next time it updates your notes.");
      });
    }
    this.buttons(true, "Finish", () => void this.finish());
  }

  async finish(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    const app = this.app;
    try {
      await applyGradient(app, this.scheme);
      let text = await readInstructions(app);
      text = setPreferences(text, { scheme: this.scheme, preset: this.preset, mode: this.mode, theme: this.theme, date: isoDate() });
      const before = this.prevSchemeName ?? DEFAULT_SCHEME.name;
      if (before !== this.scheme.name) text = addRequest(text, RECOLOR_REQUEST_TITLE, RECOLOR_REQUEST_BODY);
      if (this.theme === "claude") text = addRequest(text, THEME_REQUEST_TITLE, THEME_REQUEST_BODY);
      await writeInstructions(app, text);
    } catch (e: any) {
      new Notice(`Couldn't save your choices: ${e?.message ?? e}`);
    }
    this.close();
    const home = app.vault.getFileByPath("Home.md");
    if (home) await app.workspace.getLeaf(false).openFile(home);
    else {
      // No wiki yet: show the vault's files.
      const leaf = app.workspace.getLeavesOfType("file-explorer")[0];
      if (leaf) await app.workspace.revealLeaf(leaf);
    }
  }
}

/** A selectable tile: a div acting as a button (Enter / Space work), so it skips the app's button styles. */
function tileEl(parent: HTMLElement, cls: string, name: string): HTMLElement {
  const el = parent.createDiv({ cls, attr: { role: "button", tabindex: "0", "data-name": name } });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      el.click();
    }
  });
  return el;
}

// ---------- styles ----------

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.head.createEl("style", { attr: { id: STYLE_ID } });
  el.textContent = CSS;
}

const CSS = `
.modal.bedrock-onboarding {
  width: 600px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 60px);
  border-radius: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.bedrock-onboarding .modal-content { display: flex; flex-direction: column; min-height: 0; flex: 1; margin: 0; }
.bedrock-ob-body { padding: 22px 24px 8px; overflow-y: auto; flex: 1; min-height: 0; }
.bedrock-ob-step { font-size: var(--font-ui-smaller); color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
.bedrock-ob-title { margin: 0 0 4px; font-size: 1.35em; font-weight: var(--font-semibold, 600); line-height: 1.25; }
.bedrock-ob-sub { color: var(--text-accent); font-size: var(--font-ui-small); margin-bottom: 8px; }
.bedrock-onboarding p { margin: 8px 0; font-size: var(--font-ui-medium); line-height: 1.45; color: var(--text-normal); }
.bedrock-ob-lead { font-weight: var(--font-semibold, 600); }
.bedrock-ob-hint { font-size: var(--font-ui-small); color: var(--text-muted); line-height: 1.4; }
p.bedrock-ob-hint { margin: 6px 0; color: var(--text-muted); font-size: var(--font-ui-small); }
.bedrock-ob-status { color: var(--text-muted) !important; font-size: var(--font-ui-small) !important; }
.bedrock-ob-prompt { border: 1px solid var(--background-modifier-border); background: var(--background-secondary); margin: 6px 0 4px; }
.bedrock-ob-prompt-text {
  display: block; width: 100%; resize: vertical; min-height: 120px; height: 150px; border: 0; border-radius: 0 !important;
  background: transparent; color: var(--text-normal); font-family: var(--font-monospace); font-size: var(--font-ui-smaller);
  line-height: 1.45; padding: 10px 12px; box-shadow: none !important;
}
.bedrock-ob-prompt-text:focus { outline: none; }
.bedrock-ob-copy { display: block; width: 100%; border-radius: 0 !important; height: 38px; font-size: var(--font-ui-medium); font-weight: var(--font-semibold, 600); }
.bedrock-ob-copy.is-copied { background-color: var(--color-green, #2f9e63) !important; }
.bedrock-ob-notes { margin: 10px 0 4px; padding-left: 18px; font-size: var(--font-ui-small); color: var(--text-muted); line-height: 1.45; }
.bedrock-ob-notes li { margin: 4px 0; }
.bedrock-ob-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 24px 16px; border-top: 1px solid var(--background-modifier-border); }
.bedrock-ob-dots { display: flex; gap: 6px; order: 0; }
.bedrock-onboarding .bedrock-ob-dot { width: 8px !important; height: 8px !important; min-width: 0; padding: 0 !important; border: 0; border-radius: 0 !important; background: var(--background-modifier-border) !important; box-shadow: none !important; cursor: pointer; }
.bedrock-onboarding .bedrock-ob-dot.is-active { background: var(--interactive-accent) !important; width: 20px !important; }
.bedrock-ob-buttons { display: flex; gap: 8px; order: 1; }
.bedrock-ob-buttons button { border-radius: 0 !important; }
.bedrock-ob-label { font-weight: var(--font-semibold, 600); font-size: var(--font-ui-small); margin: 14px 0 2px; }
.bedrock-ob-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 6px; }
.bedrock-ob-tile {
  user-select: none;
  display: flex; flex-direction: column; align-items: stretch; gap: 4px; height: auto; padding: 7px 8px; text-align: left;
  border-radius: 0 !important; border: 1px solid var(--background-modifier-border); background: var(--background-primary); box-shadow: none !important;
  cursor: pointer; font-weight: normal;
}
.bedrock-ob-tile:hover { border-color: var(--background-modifier-border-hover); background: var(--background-modifier-hover); }
.bedrock-ob-tile.is-selected { border-color: var(--interactive-accent); box-shadow: inset 0 0 0 1px var(--interactive-accent) !important; }
.bedrock-ob-gradient { height: 14px; }
.bedrock-ob-fade { height: 4px; opacity: 0.9; }
.bedrock-ob-tile-name { font-size: var(--font-ui-small); color: var(--text-normal); }
.bedrock-ob-tile-desc { font-size: var(--font-ui-smaller); color: var(--text-muted); white-space: normal; line-height: 1.3; }
.bedrock-ob-swatch { height: 14px; border: 3px solid transparent; }
.bedrock-ob-swatch.is-light { border-color: #f4f4f4; outline: 1px solid var(--background-modifier-border); }
.bedrock-ob-swatch.is-dark { border-color: #1e1e1e; }
.bedrock-ob-swatch.is-auto { border-left-color: #f4f4f4; border-top-color: #f4f4f4; border-right-color: #1e1e1e; border-bottom-color: #1e1e1e; }
.bedrock-ob-modes { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.bedrock-ob-modes .bedrock-ob-hint { margin-right: 4px; }
.bedrock-ob-mode { cursor: pointer; user-select: none; display: inline-flex; align-items: center; border-radius: 0 !important; height: 26px; padding: 0 12px; font-size: var(--font-ui-small); box-shadow: none !important; border: 1px solid var(--background-modifier-border); background: var(--background-primary); }
.bedrock-ob-mode.is-selected { border-color: var(--interactive-accent); color: var(--text-accent); }
.bedrock-ob-tile.is-theme.mod-pixelated .bedrock-ob-tile-name { font-family: "Press Start 2P", "Cascadia Mono", Consolas, monospace; font-size: var(--font-ui-smaller); }
.bedrock-ob-tile.is-theme.mod-halloween .bedrock-ob-tile-name::before { content: "🎃 "; }
.bedrock-ob-tile.is-theme.mod-animals .bedrock-ob-tile-name::before { content: "🐾 "; }
.bedrock-ob-tile.is-theme.mod-claude .bedrock-ob-tile-name::before { content: "✨ "; }
`;
