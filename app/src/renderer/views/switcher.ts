// Quick switcher (Mod+O) and command palette (Mod+P).
import { SuggestModal } from "../ui/modal";
import { prepareFuzzySearch, renderMatches, type SearchResult } from "../ui/search";
import { setIcon } from "../dom/icons";
import { Keymap } from "../commands/keymap";
import type { TFile } from "../vault/files";
import type { Command } from "../commands/commands";

export interface SwitcherItem {
  type: "file" | "alias" | "unresolved" | "create" | "bookmark";
  file: TFile | null;
  /** Shown as the title (file name, alias, link text or the typed name). */
  text: string;
  /** Searched text (path without .md, alias, link text). */
  key: string;
  match: SearchResult | null;
  ignored?: boolean;
  bookmark?: any;
}

const isMd = (f: TFile) => f.extension === "md";
const displayPath = (f: TFile) => (isMd(f) ? f.path.slice(0, -3) : f.path);

/** Candidates and ranking for the quick switcher (pure enough to unit-test with a fake app). */
export function switcherSuggestions(app: any, query: string, opts: { showExistingOnly?: boolean; showAttachments?: boolean; showAllFileTypes?: boolean } = {}): SwitcherItem[] {
  const vault = app.vault;
  const mc = app.metadataCache;
  const active: TFile | null = app.workspace.getActiveFile?.() ?? null;
  const shown = (f: TFile) => isMd(f) || f.extension === "canvas" || f.extension === "base" || !!opts.showAllFileTypes || (opts.showAttachments !== false && app.viewRegistry.isExtensionRegistered(f.extension));
  const q = query.trim();
  if (!q) {
    // Recently opened files, most recent first, without the one already open.
    const out: SwitcherItem[] = [];
    for (const p of app.workspace.getLastOpenFiles() as string[]) {
      const f: TFile | null = vault.getFileByPath(p);
      if (!f || f === active || !shown(f)) continue;
      out.push({ type: "file", file: f, text: isMd(f) ? f.basename : f.name, key: displayPath(f), match: null });
      if (out.length >= 10) break;
    }
    return out;
  }
  const fn = prepareFuzzySearch(q);
  const hits: SwitcherItem[] = [];
  const ignored = (p: string) => !!mc.isUserIgnored?.(p);
  for (const f of vault.getFiles() as TFile[]) {
    if (!shown(f)) continue;
    const key = displayPath(f);
    const m = fn(key);
    if (m) hits.push({ type: "file", file: f, text: isMd(f) ? f.basename : f.name, key, match: m, ignored: ignored(f.path) });
    if (isMd(f)) {
      const fm = mc.getFileCache(f)?.frontmatter;
      const raw = fm?.aliases ?? fm?.alias;
      const aliases: string[] = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(",").map((s: string) => s.trim()) : [];
      for (const a of aliases) {
        if (!a) continue;
        const am = fn(a);
        if (am) hits.push({ type: "alias", file: f, text: a, key: a, match: am, ignored: ignored(f.path) });
      }
    }
  }
  if (!opts.showExistingOnly) {
    const seen = new Set<string>();
    for (const links of Object.values(mc.unresolvedLinks ?? {}) as Record<string, number>[]) {
      for (const name of Object.keys(links)) {
        if (seen.has(name)) continue;
        seen.add(name);
        const m = fn(name);
        if (m) hits.push({ type: "unresolved", file: null, text: name, key: name, match: m });
      }
    }
  }
  // Best match first; files in Excluded files sink to the bottom.
  hits.sort((a, b) => Number(!!a.ignored) - Number(!!b.ignored) || b.match!.score - a.match!.score);
  const exact = hits.some((h) => (h.type === "file" || h.type === "unresolved") && h.text.toLowerCase() === q.toLowerCase());
  if (!exact && !opts.showExistingOnly) hits.push({ type: "create", file: null, text: q, key: q, match: null });
  return hits;
}

export class QuickSwitcher extends SuggestModal<SwitcherItem> {
  constructor(app: any) {
    super(app);
    this.setPlaceholder("Find or create a note...");
    const mod = process.platform === "darwin" ? "cmd" : "ctrl";
    this.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "↵", purpose: "to open" },
      { command: `${mod} ↵`, purpose: "to open in new tab" },
      { command: `${mod} alt ↵`, purpose: "to open to the right" },
      { command: "shift ↵", purpose: "to create" },
      { command: "esc", purpose: "to dismiss" },
    ]);
    this.emptyStateText = "No notes found.";
    // Shift+Enter creates a note named exactly as typed, even when something else matches.
    const h = this.scope.register(["Shift"], "Enter", (e) => {
      e.preventDefault();
      const name = this.inputEl.value.trim();
      if (!name) return false;
      this.close();
      void this.create(name, e);
      return false;
    });
    this.scope.keys.remove(h);
    this.scope.keys.unshift(h);
  }

  private get options(): any {
    return this.app.internalPlugins?.getEnabledPluginById?.("switcher")?.options ?? this.app.internalPlugins?.plugins?.switcher?.options ?? {};
  }

  getSuggestions(query: string): SwitcherItem[] {
    return switcherSuggestions(this.app, query, this.options);
  }

  renderSuggestion(h: SwitcherItem, el: HTMLElement): void {
    el.addClass("mod-complex");
    const content = el.createDiv("suggestion-content");
    const title = content.createDiv("suggestion-title");
    const aux = el.createDiv("suggestion-aux");
    if (h.type === "create") {
      title.setText(h.text);
      aux.createSpan({ cls: "suggestion-action", text: "Enter to create" });
      return;
    }
    if (h.type === "unresolved") {
      if (h.match) renderMatches(title, h.text, h.match.matches);
      else title.setText(h.text);
      const fl = aux.createSpan({ cls: "suggestion-flair", attr: { "aria-label": "Not created yet, select to create" } });
      setIcon(fl, "file-plus");
      return;
    }
    if (h.type === "alias") {
      if (h.match) renderMatches(title, h.text, h.match.matches);
      else title.setText(h.text);
      content.createDiv({ cls: "suggestion-note", text: displayPath(h.file!) });
      const fl = aux.createSpan({ cls: "suggestion-flair", attr: { "aria-label": "Alias" } });
      setIcon(fl, "forward");
      return;
    }
    const target = h.key;
    const nameStart = target.lastIndexOf("/") + 1;
    const name = target.slice(nameStart);
    if (h.match) renderMatches(title, name, h.match.matches, -nameStart);
    else title.setText(name);
    if (nameStart > 0) content.createDiv({ cls: "suggestion-note", text: target.slice(0, nameStart - 1) });
    if (h.ignored) el.addClass("mod-downranked");
    if (this.app.bookmarks?.findFileBookmark?.(h.file!.path)) {
      const fl = aux.createSpan({ cls: "suggestion-flair", attr: { "aria-label": "Bookmarked" } });
      setIcon(fl, "bookmark");
    }
  }

  /** Where to open: Enter = this tab, Ctrl+Enter = new tab, Ctrl+Alt+Enter = to the right. */
  private paneFor(evt: MouseEvent | KeyboardEvent): "tab" | "split" | false {
    if (Keymap.isModEvent(evt) && evt.altKey) return "split";
    if (Keymap.isModEvent(evt)) return "tab";
    return false;
  }

  private async create(name: string, evt: MouseEvent | KeyboardEvent): Promise<void> {
    const parent = this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path ?? "");
    const clean = name.replace(/\.md$/i, "");
    const path = (clean.includes("/") ? clean : parent.getParentPrefix() + clean) + ".md";
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (dir && !this.app.vault.getFolderByPath(dir)) await this.app.vault.createFolder(dir).catch(() => null);
    const file = this.app.vault.getFileByPath(path) ?? (await this.app.vault.create(path, ""));
    await this.app.workspace.getLeaf(this.paneFor(evt)).openFile(file, { active: true });
  }

  async onChooseSuggestion(h: SwitcherItem, evt: MouseEvent | KeyboardEvent): Promise<void> {
    if (h.type === "create" || h.type === "unresolved") return this.create(h.text, evt);
    if (!h.file) return;
    await this.app.workspace.getLeaf(this.paneFor(evt)).openFile(h.file, { active: true });
  }
}

/** Command palette order with an empty query: pinned (in order), recent (newest first), A to Z. */
export function paletteOrder(cmds: Command[], pinnedIds: string[], recent: string[]): { cmd: Command; pinned: boolean }[] {
  const byId = new Map(cmds.map((c) => [c.id, c]));
  const pinned = pinnedIds.map((id) => byId.get(id)).filter(Boolean) as Command[];
  const rec = (Array.from(new Set(recent)).map((id) => byId.get(id)).filter(Boolean) as Command[]).filter((c) => !pinned.includes(c));
  const rest = cmds.filter((c) => !rec.includes(c) && !pinned.includes(c)).sort((a, b) => a.name.localeCompare(b.name));
  return [...pinned.map((cmd) => ({ cmd, pinned: true })), ...[...rec, ...rest].map((cmd) => ({ cmd, pinned: false }))];
}

const RECENT_KEY = "recent-commands";

export class CommandPalette extends SuggestModal<{ cmd: Command; match: SearchResult | null; pinned: boolean }> {
  constructor(app: any) {
    super(app);
    this.setPlaceholder("Select a command...");
    this.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "↵", purpose: "to use" },
      { command: "esc", purpose: "to dismiss" },
    ]);
    this.emptyStateText = "No commands found.";
    if (!app.recentCommands?.length) {
      try {
        app.recentCommands = JSON.parse(app.loadLocalStorage?.(RECENT_KEY) ?? "[]");
      } catch {
        app.recentCommands = [];
      }
    }
  }

  getSuggestions(query: string): { cmd: Command; match: SearchResult | null; pinned: boolean }[] {
    const cmds: Command[] = this.app.commands.listCommands();
    const pinnedIds: string[] = this.app.internalPlugins?.getEnabledPluginById?.("command-palette")?.options?.pinned ?? [];
    if (!query.trim()) return paletteOrder(cmds, pinnedIds, this.app.recentCommands ?? []).map((x) => ({ ...x, match: null }));
    const fn = prepareFuzzySearch(query);
    const out: { cmd: Command; match: SearchResult | null; pinned: boolean }[] = [];
    for (const cmd of cmds) {
      const m = fn(cmd.name);
      if (m) out.push({ cmd, match: m, pinned: pinnedIds.includes(cmd.id) });
    }
    return out.sort((a, b) => b.match!.score - a.match!.score);
  }

  renderSuggestion(x: { cmd: Command; match: SearchResult | null; pinned: boolean }, el: HTMLElement): void {
    el.addClass("mod-complex");
    const content = el.createDiv("suggestion-content");
    const t = content.createDiv("suggestion-title");
    // "Plugin: Command" shows the plugin part as a prefix.
    const colon = x.cmd.name.indexOf(": ");
    const name = x.cmd.name;
    if (x.match) renderMatches(t, name, x.match.matches);
    else if (colon > 0) {
      t.createSpan({ cls: "suggestion-prefix", text: name.slice(0, colon + 2) });
      t.appendText(name.slice(colon + 2));
    } else t.setText(name);
    const aux = el.createDiv("suggestion-aux");
    if (x.pinned) {
      const fl = aux.createSpan({ cls: "suggestion-flair", attr: { "aria-label": "Pinned" } });
      setIcon(fl, "pin");
    }
    for (const hk of this.hotkeyLabels(x.cmd.id)) aux.createEl("kbd", { cls: "suggestion-hotkey", text: hk });
  }

  private hotkeyLabels(id: string): string[] {
    const first = this.app.hotkeyManager.printHotkeyForCommand(id);
    return first ? [first] : [];
  }

  onChooseSuggestion(x: { cmd: Command }): void {
    this.app.recentCommands = [x.cmd.id, ...(this.app.recentCommands ?? []).filter((i: string) => i !== x.cmd.id)].slice(0, 50);
    this.app.saveLocalStorage?.(RECENT_KEY, JSON.stringify(this.app.recentCommands));
    this.app.commands.executeCommand(x.cmd);
  }
}
