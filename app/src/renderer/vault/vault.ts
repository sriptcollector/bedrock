// Vault: the file tree plus read/write operations and events (obsidian.d.ts Vault).
// Events: create, modify, delete, rename(file, oldPath), raw(path), closed.
import { Events } from "../api/events";
import { FileSystemAdapter, type DataWriteOptions } from "./adapter";
import { TAbstractFile, TFile, TFolder } from "./files";
import { normalizePath, dirname } from "../../core/path";
import type { ScannedEntry } from "../../core/scan";

export class Vault extends Events {
  adapter: FileSystemAdapter;
  configDir = ".obsidian";
  fileMap: Record<string, TAbstractFile> = {};
  root: TFolder;
  /** .obsidian/app.json values (Obsidian's vault.getConfig/setConfig). */
  config: Record<string, any> = {};
  private contentCache = new Map<string, { mtime: number; text: string }>();
  private configSaveTimer: any = null;

  constructor(adapter: FileSystemAdapter) {
    super();
    this.adapter = adapter;
    this.root = new TFolder(this, "/");
    this.fileMap["/"] = this.root;
  }

  getName(): string {
    return this.adapter.getName();
  }

  // ---------- config (.obsidian/app.json) ----------
  async loadConfig(): Promise<void> {
    try {
      this.config = JSON.parse(await this.adapter.read(this.configDir + "/app.json")) ?? {};
    } catch {
      this.config = {};
    }
  }

  static DEFAULT_CONFIG: Record<string, any> = {
    promptDelete: true,
    trashOption: "system", // "system" | "local" | "none"
    alwaysUpdateLinks: true,
    newLinkFormat: "shortest",
    useMarkdownLinks: false,
    newFileLocation: "root", // "root" | "current" | "folder"
    newFileFolderPath: "",
    attachmentFolderPath: "/",
    showLineNumber: false,
    readableLineLength: true,
    strictLineBreaks: false,
    showFrontmatter: false,
    foldHeading: true,
    foldIndent: true,
    showIndentGuide: true,
    livePreview: true,
    defaultViewMode: "source",
    vimMode: false,
    spellcheck: true,
    autoPairBrackets: true,
    autoPairMarkdown: true,
    smartIndentList: true,
    useTab: true,
    tabSize: 4,
    showInlineTitle: true,
    propertiesInDocument: "visible",
    focusNewTab: true,
    showUnsupportedFiles: false,
    userIgnoreFilters: [],
    alwaysShowTabHeaders: true,
    stackedTabs: false,
  };

  getConfig(key: string): any {
    return key in this.config ? this.config[key] : Vault.DEFAULT_CONFIG[key];
  }

  setConfig(key: string, value: any): void {
    if (value === undefined || value === Vault.DEFAULT_CONFIG[key]) delete this.config[key];
    else this.config[key] = value;
    this.trigger("config-changed", key, value);
    clearTimeout(this.configSaveTimer);
    this.configSaveTimer = setTimeout(() => {
      this.adapter.write(this.configDir + "/app.json", JSON.stringify(this.config, null, 2)).catch(console.error);
    }, 300);
  }

  // ---------- tree ----------
  /** Build the tree from a scan (folders first so parents exist). */
  buildTree(entries: ScannedEntry[]): void {
    const folders = entries.filter((e) => e.folder).sort((a, b) => a.path.length - b.path.length);
    for (const f of folders) this.addChild(new TFolder(this, f.path));
    for (const e of entries) if (!e.folder) this.addChild(new TFile(this, e.path));
  }

  private addChild(file: TAbstractFile): void {
    const parentPath = dirname(file.path) || "/";
    let parent = this.fileMap[parentPath] as TFolder | undefined;
    if (!parent) {
      parent = new TFolder(this, parentPath);
      this.addChild(parent);
    }
    file.parent = parent;
    parent.children.push(file);
    this.fileMap[file.path] = file;
  }

  private removeChild(file: TAbstractFile): void {
    if (file.parent) {
      const i = file.parent.children.indexOf(file);
      if (i >= 0) file.parent.children.splice(i, 1);
    }
    delete this.fileMap[file.path];
    if (file instanceof TFolder) for (const c of file.children.slice()) this.removeChild(c);
    file.deleted = true;
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this.fileMap[normalizePath(path)] ?? null;
  }
  getAbstractFileByPathInsensitive(path: string): TAbstractFile | null {
    const p = normalizePath(path).toLowerCase();
    for (const k in this.fileMap) if (k.toLowerCase() === p) return this.fileMap[k];
    return null;
  }
  getFileByPath(path: string): TFile | null {
    const f = this.getAbstractFileByPath(path);
    return f instanceof TFile ? f : null;
  }
  getFolderByPath(path: string): TFolder | null {
    const f = this.getAbstractFileByPath(path);
    return f instanceof TFolder ? f : null;
  }
  getRoot(): TFolder {
    return this.root;
  }
  getAllLoadedFiles(): TAbstractFile[] {
    return Object.values(this.fileMap);
  }
  getAllFolders(includeRoot = false): TFolder[] {
    return Object.values(this.fileMap).filter((f): f is TFolder => f instanceof TFolder && (includeRoot || !f.isRoot()));
  }
  getFiles(): TFile[] {
    return Object.values(this.fileMap).filter((f): f is TFile => f instanceof TFile);
  }
  getMarkdownFiles(): TFile[] {
    return this.getFiles().filter((f) => f.extension === "md");
  }
  static recurseChildren(root: TFolder, cb: (f: TAbstractFile) => any): void {
    const stack: TAbstractFile[] = [root];
    while (stack.length) {
      const f = stack.pop()!;
      cb(f);
      if (f instanceof TFolder) stack.push(...f.children);
    }
  }

  getAvailablePath(base: string, ext: string): string {
    let n = 0;
    let p = ext ? `${base}.${ext}` : base;
    while (this.getAbstractFileByPathInsensitive(p)) {
      n++;
      p = ext ? `${base} ${n}.${ext}` : `${base} ${n}`;
    }
    return p;
  }

  // ---------- reads ----------
  async read(file: TFile): Promise<string> {
    const text = await this.adapter.read(file.path);
    this.contentCache.set(file.path, { mtime: file.stat.mtime, text });
    return text;
  }

  async cachedRead(file: TFile): Promise<string> {
    const c = this.contentCache.get(file.path);
    if (c && c.mtime === file.stat.mtime) return c.text;
    return this.read(file);
  }

  readBinary(file: TFile): Promise<ArrayBuffer> {
    return this.adapter.readBinary(file.path);
  }

  getResourcePath(file: TFile): string {
    return this.adapter.getResourcePath(file.path);
  }

  // ---------- writes ----------
  private async refreshStat(file: TFile): Promise<void> {
    const st = await this.adapter.stat(file.path);
    if (st) file.stat = { ctime: st.ctime, mtime: st.mtime, size: st.size };
  }

  private assertFree(path: string): void {
    const f = this.getAbstractFileByPathInsensitive(path);
    if (f) throw new Error(f instanceof TFolder ? "Folder already exists." : "File already exists.");
  }

  async create(path: string, data: string, opts?: DataWriteOptions): Promise<TFile> {
    path = normalizePath(path);
    this.assertFree(path);
    await this.adapter.write(path, data, opts);
    return this.onCreated(path, data) as Promise<TFile>;
  }

  async createBinary(path: string, data: ArrayBuffer, opts?: DataWriteOptions): Promise<TFile> {
    path = normalizePath(path);
    this.assertFree(path);
    await this.adapter.writeBinary(path, data, opts);
    return this.onCreated(path) as Promise<TFile>;
  }

  private async onCreated(path: string, text?: string): Promise<TFile> {
    await this.ensureParents(path);
    const file = new TFile(this, path);
    await this.refreshStat(file);
    this.addChild(file);
    if (text !== undefined) this.contentCache.set(path, { mtime: file.stat.mtime, text });
    this.trigger("create", file);
    return file;
  }

  private async ensureParents(path: string): Promise<void> {
    const d = dirname(path);
    if (!d || this.fileMap[d]) return;
    await this.ensureParents(d);
    const folder = new TFolder(this, d);
    this.addChild(folder);
    this.trigger("create", folder);
  }

  async createFolder(path: string): Promise<TFolder> {
    path = normalizePath(path);
    this.assertFree(path);
    await this.adapter.mkdir(path);
    await this.ensureParents(path);
    const folder = new TFolder(this, path);
    this.addChild(folder);
    this.trigger("create", folder);
    return folder;
  }

  async modify(file: TFile, data: string, opts?: DataWriteOptions): Promise<void> {
    await this.adapter.write(file.path, data, opts);
    await this.refreshStat(file);
    this.contentCache.set(file.path, { mtime: file.stat.mtime, text: data });
    this.trigger("modify", file);
  }

  async modifyBinary(file: TFile, data: ArrayBuffer, opts?: DataWriteOptions): Promise<void> {
    await this.adapter.writeBinary(file.path, data, opts);
    await this.refreshStat(file);
    this.trigger("modify", file);
  }

  async append(file: TFile, data: string, opts?: DataWriteOptions): Promise<void> {
    await this.adapter.append(file.path, data, opts);
    await this.refreshStat(file);
    this.contentCache.delete(file.path);
    this.trigger("modify", file);
  }

  async appendBinary(file: TFile, data: ArrayBuffer, opts?: DataWriteOptions): Promise<void> {
    await this.adapter.appendBinary(file.path, data, opts);
    await this.refreshStat(file);
    this.trigger("modify", file);
  }

  async process(file: TFile, fn: (d: string) => string, opts?: DataWriteOptions): Promise<string> {
    const next = fn(await this.read(file));
    await this.modify(file, next, opts);
    return next;
  }

  async rename(file: TAbstractFile, newPath: string): Promise<void> {
    newPath = normalizePath(newPath);
    if (newPath === file.path) return;
    if (newPath.toLowerCase() !== file.path.toLowerCase()) this.assertFree(newPath);
    await this.adapter.rename(file.path, newPath);
    await this.ensureParents(newPath);
    this.applyRename(file, newPath);
  }

  /** Update the tree after a rename on disk (ours or detected), firing rename events. */
  applyRename(file: TAbstractFile, newPath: string): void {
    const oldPath = file.path;
    if (file.parent) file.parent.children.remove(file);
    delete this.fileMap[oldPath];
    file.setPath(newPath);
    const parentPath = dirname(newPath) || "/";
    const parent = this.fileMap[parentPath] as TFolder;
    file.parent = parent;
    parent.children.push(file);
    this.fileMap[newPath] = file;
    const cached = this.contentCache.get(oldPath);
    if (cached) {
      this.contentCache.delete(oldPath);
      this.contentCache.set(newPath, cached);
    }
    this.trigger("rename", file, oldPath);
    if (file instanceof TFolder) this.renameDescendants(file, oldPath);
  }

  private renameDescendants(folder: TFolder, _oldFolderPath: string): void {
    for (const c of folder.children) {
      const childOld = c.path;
      delete this.fileMap[childOld];
      c.setPath(folder.path + "/" + c.name);
      this.fileMap[c.path] = c;
      if (c instanceof TFolder) this.renameDescendants(c, childOld);
      this.trigger("rename", c, childOld);
    }
  }

  async copy<T extends TAbstractFile>(file: T, newPath: string): Promise<T> {
    newPath = normalizePath(newPath);
    this.assertFree(newPath);
    await this.adapter.copy(file.path, newPath);
    if (file instanceof TFile) return (await this.onCreated(newPath)) as unknown as T;
    await this.ensureParents(newPath);
    const folder = new TFolder(this, newPath);
    this.addChild(folder);
    this.trigger("create", folder);
    return folder as unknown as T;
  }

  async delete(file: TAbstractFile, force = false): Promise<void> {
    if (file instanceof TFolder) await this.adapter.rmdir(file.path, force || true);
    else await this.adapter.remove(file.path);
    this.onDeleted(file);
  }

  async trash(file: TAbstractFile, system: boolean): Promise<void> {
    if (system) {
      const ok = await this.adapter.trashSystem(file.path);
      if (!ok) await this.adapter.trashLocal(file.path);
    } else await this.adapter.trashLocal(file.path);
    this.onDeleted(file);
  }

  /** Remove from tree and fire delete events (children first, like Obsidian). */
  onDeleted(file: TAbstractFile): void {
    if (file.deleted) return;
    if (file instanceof TFolder) for (const c of file.children.slice()) this.onDeleted(c);
    this.removeChild(file);
    this.contentCache.delete(file.path);
    this.trigger("delete", file);
  }

  // ---------- external changes (watcher) ----------
  async onExternalChange(path: string): Promise<void> {
    path = normalizePath(path);
    this.trigger("raw", path);
    if (path.split("/").some((s) => s.startsWith("."))) return;
    const st = await this.adapter.stat(path);
    const existing = this.fileMap[path];
    if (!st) {
      if (existing) this.onDeleted(existing);
      return;
    }
    if (st.type === "folder") {
      if (existing instanceof TFolder) return;
      if (existing) this.onDeleted(existing);
      await this.ensureParents(path);
      const folder = new TFolder(this, path);
      this.addChild(folder);
      this.trigger("create", folder);
      // Pick up anything already inside (a folder moved in from elsewhere).
      const listed = await this.adapter.list(path).catch(() => ({ files: [], folders: [] }));
      for (const p of [...listed.folders, ...listed.files]) if (!p.split("/").pop()!.startsWith(".")) await this.onExternalChange(p);
      return;
    }
    if (existing instanceof TFile) {
      if (existing.stat.mtime === st.mtime && existing.stat.size === st.size) return; // our own write
      existing.stat = { ctime: st.ctime, mtime: st.mtime, size: st.size };
      this.contentCache.delete(path);
      this.trigger("modify", existing);
      return;
    }
    if (existing) this.onDeleted(existing);
    await this.ensureParents(path);
    const file = new TFile(this, path);
    file.stat = { ctime: st.ctime, mtime: st.mtime, size: st.size };
    this.addChild(file);
    this.trigger("create", file);
  }
}
