// Quick switcher (Mod+O) and command palette (Mod+P).
import { SuggestModal } from "../ui/modal";
import { prepareFuzzySearch, renderMatches, type SearchResult } from "../ui/search";
import { Keymap } from "../commands/keymap";
import type { TFile } from "../vault/files";
import type { Command } from "../commands/commands";

interface FileHit {
  file: TFile | null;
  name: string;
  path: string;
  match: SearchResult | null;
  create?: boolean;
}

export class QuickSwitcher extends SuggestModal<FileHit> {
  constructor(app: any) {
    super(app);
    this.setPlaceholder("Find or create a note...");
    this.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "↵", purpose: "to open" },
      { command: process.platform === "darwin" ? "cmd ↵" : "ctrl ↵", purpose: "to open in new tab" },
      { command: "shift ↵", purpose: "to create" },
      { command: "esc", purpose: "to dismiss" },
    ]);
    this.emptyStateText = "No notes found. Press shift ↵ to create.";
  }

  getSuggestions(query: string): FileHit[] {
    const files: TFile[] = this.app.vault.getFiles().filter((f: TFile) => f.extension === "md" || f.extension === "canvas" || this.app.viewRegistry.isExtensionRegistered(f.extension));
    if (!query.trim()) {
      const recent = this.app.workspace.getLastOpenFiles().map((p: string) => this.app.vault.getFileByPath(p)).filter(Boolean) as TFile[];
      const rest = files.filter((f) => !recent.includes(f)).sort((a, b) => b.stat.mtime - a.stat.mtime);
      return [...recent, ...rest].slice(0, 50).map((f) => ({ file: f, name: f.extension === "md" ? f.basename : f.name, path: f.path, match: null }));
    }
    const fn = prepareFuzzySearch(query);
    const hits: FileHit[] = [];
    for (const f of files) {
      const target = f.extension === "md" ? f.path.slice(0, -3) : f.path;
      const m = fn(target);
      if (m) hits.push({ file: f, name: f.extension === "md" ? f.basename : f.name, path: f.path, match: m });
    }
    hits.sort((a, b) => b.match!.score - a.match!.score);
    const exact = hits.some((h) => h.name.toLowerCase() === query.trim().toLowerCase());
    if (!exact) hits.push({ file: null, name: query.trim(), path: query.trim(), match: null, create: true });
    return hits;
  }

  renderSuggestion(h: FileHit, el: HTMLElement): void {
    el.addClass("mod-complex");
    const content = el.createDiv("suggestion-content");
    const title = content.createDiv("suggestion-title");
    if (h.create) {
      title.setText(h.name);
      el.createDiv("suggestion-aux").createSpan({ cls: "suggestion-hotkey", text: "Enter to create" });
      return;
    }
    const target = h.file!.extension === "md" ? h.path.slice(0, -3) : h.path;
    const nameStart = target.lastIndexOf("/") + 1;
    if (h.match) renderMatches(title, target.slice(nameStart), h.match.matches, -nameStart);
    else title.setText(h.name);
    if (nameStart > 0) content.createDiv({ cls: "suggestion-note", text: target.slice(0, nameStart - 1) });
  }

  async onChooseSuggestion(h: FileHit, evt: MouseEvent | KeyboardEvent): Promise<void> {
    let file = h.file;
    if (h.create || (evt as KeyboardEvent).shiftKey) {
      const parent = this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path ?? "");
      const name = h.create ? h.name : this.inputEl.value.trim();
      if (!name) return;
      const path = (name.includes("/") ? name : parent.getParentPrefix() + name).replace(/\.md$/i, "") + ".md";
      file = this.app.vault.getFileByPath(path) ?? (await this.app.vault.create(path, ""));
    }
    if (!file) return;
    await this.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(file, { active: true });
  }
}

export class CommandPalette extends SuggestModal<{ cmd: Command; match: SearchResult | null }> {
  constructor(app: any) {
    super(app);
    this.setPlaceholder("Type a command...");
    this.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "↵", purpose: "to use" },
      { command: "esc", purpose: "to dismiss" },
    ]);
    this.emptyStateText = "No commands found.";
  }

  getSuggestions(query: string): { cmd: Command; match: SearchResult | null }[] {
    const cmds: Command[] = this.app.commands.listCommands();
    const recent: string[] = this.app.recentCommands ?? [];
    if (!query.trim()) {
      const byRecent = recent.map((id) => cmds.find((c) => c.id === id)).filter(Boolean) as Command[];
      const rest = cmds.filter((c) => !byRecent.includes(c)).sort((a, b) => a.name.localeCompare(b.name));
      return [...byRecent, ...rest].map((cmd) => ({ cmd, match: null }));
    }
    const fn = prepareFuzzySearch(query);
    const out: { cmd: Command; match: SearchResult | null }[] = [];
    for (const cmd of cmds) {
      const m = fn(cmd.name);
      if (m) out.push({ cmd, match: m });
    }
    return out.sort((a, b) => b.match!.score - a.match!.score);
  }

  renderSuggestion(x: { cmd: Command; match: SearchResult | null }, el: HTMLElement): void {
    el.addClass("mod-complex");
    const content = el.createDiv("suggestion-content");
    const t = content.createDiv("suggestion-title");
    if (x.match) renderMatches(t, x.cmd.name, x.match.matches);
    else t.setText(x.cmd.name);
    const hk = this.app.hotkeyManager.printHotkeyForCommand(x.cmd.id);
    if (hk) el.createDiv("suggestion-aux").createEl("kbd", { cls: "suggestion-hotkey", text: hk });
  }

  onChooseSuggestion(x: { cmd: Command }): void {
    this.app.recentCommands = [x.cmd.id, ...(this.app.recentCommands ?? []).filter((i: string) => i !== x.cmd.id)].slice(0, 10);
    this.app.commands.executeCommand(x.cmd);
  }
}
