// File and folder pickers used by settings rows ("Template file location", "New file location"...).
import { AbstractInputSuggest } from "../api/suggest";
import { prepareFuzzySearch } from "../ui/search";

export class FileSuggest extends AbstractInputSuggest<string> {
  constructor(app: any, inputEl: HTMLInputElement, private filter?: (f: any) => boolean, private exts: string[] = ["md"]) {
    super(app, inputEl);
  }
  getSuggestions(q: string): string[] {
    const files: any[] = this.app.vault.getFiles().filter((f: any) => (this.filter ? this.filter(f) : this.exts.includes(f.extension)));
    if (!q) return files.map((f) => f.path).sort();
    const fz = prepareFuzzySearch(q);
    return files
      .map((f) => ({ p: f.path, m: fz(f.path) }))
      .filter((x) => x.m)
      .sort((a, b) => b.m!.score - a.m!.score)
      .map((x) => x.p);
  }
  renderSuggestion(v: string, el: HTMLElement): void {
    el.setText(v);
  }
}

export class FolderSuggest extends AbstractInputSuggest<string> {
  constructor(app: any, inputEl: HTMLInputElement, private filter?: (f: any) => boolean, private includeRoot = false) {
    super(app, inputEl);
  }
  getSuggestions(q: string): string[] {
    const folders: any[] = this.app.vault.getAllFolders(this.includeRoot).filter((f: any) => !this.filter || this.filter(f));
    const lq = q.toLowerCase();
    return folders
      .map((f) => f.path)
      .filter((p: string) => p.toLowerCase().includes(lq))
      .sort();
  }
  renderSuggestion(v: string, el: HTMLElement): void {
    el.setText(v);
  }
}
