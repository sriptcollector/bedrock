// Vault operations for AI agents (MCP tools, the local REST API and the `bedrock` CLI).
// Node only, no Electron or DOM: it runs in the app's main process, in the stdio MCP server and
// in the CLI, and in unit tests against a temp vault.
//
// Files on disk are the source of truth. Reads always come from disk. Writes go through a
// `VaultWriter`: on disk directly (app not running; the app's watcher and the sync engine pick the
// change up later), or through the running app's vault (`app.vault`), so open editors update live.
// Either way the change lands in the one synced vault, so it syncs and gets version history.
import fs from "node:fs";
import nodePath from "node:path";
import moment from "moment";
import type { CachedMetadata } from "obsidian";
import { getAllTags, getFrontMatterInfo, parseMetadata, parseYaml, stringifyYaml } from "./parse";
import { LinkIndex, getLinkpath, parseLinktext, splitAlias } from "./links";
import { basename, dirname, extname } from "./path";
import { makeDoc, matchDoc, parseQuery, requiredNeedle } from "../renderer/views/sidebar/search-query";

// ------------------------------------------------------------------ errors

export type AgentErrorCode = "bad_request" | "not_found" | "exists" | "forbidden" | "unavailable" | "disabled";

export class AgentError extends Error {
  constructor(
    public code: AgentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentError";
  }
  get status(): number {
    return { bad_request: 400, not_found: 404, exists: 409, forbidden: 403, unavailable: 503, disabled: 503 }[this.code];
  }
}

// ------------------------------------------------------------------ paths

const BAD_CHARS = /[<>:"|?*\u0000-\u001f]/;

/**
 * Turns whatever an agent sent into a clean vault path ("Folder/Note.md"), or throws.
 * Rejects absolute paths, drive letters, "..", hidden folders (.obsidian, .trash, .git) and
 * characters Windows can't store. A leading "/" means the vault root.
 */
export function cleanVaultPath(input: unknown, what = "path"): string {
  if (typeof input !== "string" || !input.trim()) throw new AgentError("bad_request", `A ${what} is required.`);
  let p = input.trim().replace(/\\/g, "/");
  if (/^[a-zA-Z]:/.test(p) || p.startsWith("//")) throw new AgentError("forbidden", `“${input}” is outside the vault. Use a path relative to the vault, like “Folder/Note.md”.`);
  p = p.replace(/^\/+/, "");
  const segs = p.split("/").filter((s) => s !== "" && s !== ".");
  if (!segs.length) throw new AgentError("bad_request", `A ${what} is required.`);
  if (segs.some((s) => s === "..")) throw new AgentError("forbidden", `“${input}” points outside the vault (“..” isn't allowed).`);
  if (segs.some((s) => s.startsWith("."))) throw new AgentError("forbidden", `“${input}” is in a hidden folder. Agents can only reach notes and files, not .obsidian, .trash or other hidden folders.`);
  const bad = segs.find((s) => BAD_CHARS.test(s));
  if (bad) throw new AgentError("bad_request", `“${bad}” has a character that can't be used in file names (< > : " | ? *).`);
  if (segs.some((s) => /[. ]$/.test(s))) throw new AgentError("bad_request", `File and folder names can't end with a dot or a space.`);
  return segs.join("/").normalize("NFC");
}

/** Like cleanVaultPath but "" / "/" mean the vault root. */
export function cleanFolderPath(input: unknown): string {
  if (input === undefined || input === null) return "";
  if (typeof input === "string" && ["", "/", "\\", ".", "./", ".\\"].includes(input.trim())) return "";
  return cleanVaultPath(input, "folder");
}

const withMd = (p: string) => (extname(p) ? p : p + ".md");
const isMd = (p: string) => /\.md$/i.test(p);

// ------------------------------------------------------------------ writers

export interface VaultWriter {
  /** Create or overwrite a file (parent folders are created). */
  write(path: string, text: string): Promise<void>;
  /** Move a file. The destination must not exist. */
  rename(from: string, to: string): Promise<void>;
  /** Move a file to the vault's .trash folder (never a permanent delete). Returns where it went. */
  trash(path: string): Promise<string>;
}

/** What only the running app can do. Absent when the app isn't running. */
export interface AppHooks {
  activeNote(): Promise<string | null>;
  open(path: string, opts: { newTab?: boolean; line?: number }): Promise<void>;
}

export class DiskWriter implements VaultWriter {
  constructor(private root: string) {}
  private abs(p: string): string {
    return nodePath.join(this.root, ...p.split("/"));
  }
  async write(p: string, text: string): Promise<void> {
    const abs = this.abs(p);
    await fs.promises.mkdir(nodePath.dirname(abs), { recursive: true });
    // Dot-named temp file next to the note: the app's watcher and the sync engine both skip it.
    const tmp = nodePath.join(nodePath.dirname(abs), `.${nodePath.basename(abs)}.${process.pid}.${Date.now().toString(36)}.tmp`);
    await fs.promises.writeFile(tmp, text, "utf8");
    try {
      await fs.promises.rename(tmp, abs);
    } catch (e) {
      await fs.promises.rm(tmp, { force: true });
      throw e;
    }
  }
  async rename(from: string, to: string): Promise<void> {
    const dest = this.abs(to);
    await fs.promises.mkdir(nodePath.dirname(dest), { recursive: true });
    const caseOnly = this.abs(from).toLowerCase() === dest.toLowerCase();
    if (fs.existsSync(dest) && !caseOnly) throw new AgentError("exists", `“${to}” already exists.`);
    if (caseOnly) {
      const tmp = dest + ".rename-tmp";
      await fs.promises.rename(this.abs(from), tmp);
      await fs.promises.rename(tmp, dest);
      return;
    }
    await fs.promises.rename(this.abs(from), dest);
  }
  async trash(p: string): Promise<string> {
    return trashOnDisk(this.root, p);
  }
}

/** Move a vault file into `.trash/` (the vault's own recycle folder), picking a free name. */
export async function trashOnDisk(root: string, p: string): Promise<string> {
  const name = basename(p);
  const ext = extname(name);
  const stem = ext ? name.slice(0, -(ext.length + 1)) : name;
  let dest = ".trash/" + name;
  for (let n = 1; fs.existsSync(nodePath.join(root, dest)); n++) dest = `.trash/${stem} ${n}${ext ? "." + ext : ""}`;
  await fs.promises.mkdir(nodePath.join(root, ".trash"), { recursive: true });
  await fs.promises.rename(nodePath.join(root, ...p.split("/")), nodePath.join(root, dest));
  return dest;
}

// ------------------------------------------------------------------ index

interface Entry {
  path: string;
  mtime: number;
  ctime: number;
  size: number;
  text?: string;
  meta?: CachedMetadata;
}

export interface NoteInfo {
  path: string;
  mtime: number;
  ctime: number;
  size: number;
}

export interface PropertyFilter {
  key: string;
  op: "equals" | "not_equals" | "contains" | "exists" | "missing" | "gt" | "gte" | "lt" | "lte" | "range";
  value?: unknown;
  min?: unknown;
  max?: unknown;
}

export type EditArgs =
  | { path: string; mode: "replace"; content: string }
  | { path: string; mode: "find_replace"; find: string; replace: string; all?: boolean; regex?: boolean; caseSensitive?: boolean }
  | { path: string; mode: "patch_heading"; heading: string; content: string; position?: "replace" | "append" | "prepend" };

export interface AgentOpsOptions {
  vaultPath: string;
  writer?: VaultWriter;
  app?: AppHooks | null;
  /** For tests: the current time. */
  now?: () => Date;
  /** Re-scan the folder at most this often for index-based operations (ms). */
  rescanMs?: number;
}

/**
 * Every agent operation. One instance per vault. Writes are serialised (one at a time), so two
 * agents editing the same note can't interleave half-applied changes.
 */
export class AgentOps {
  readonly root: string;
  writer: VaultWriter;
  app: AppHooks | null;
  private entries = new Map<string, Entry>();
  private folders = new Set<string>();
  private scannedAt = 0;
  private dirty = true;
  private queue: Promise<unknown> = Promise.resolve();
  private now: () => Date;
  private rescanMs: number;

  constructor(o: AgentOpsOptions) {
    this.root = nodePath.resolve(o.vaultPath);
    this.writer = o.writer ?? new DiskWriter(this.root);
    this.app = o.app ?? null;
    this.now = o.now ?? (() => new Date());
    this.rescanMs = o.rescanMs ?? 400;
  }

  // ---------------- plumbing

  private abs(p: string): string {
    return nodePath.join(this.root, ...p.split("/"));
  }

  /** Extra guard against symlinks/junctions that lead out of the vault. */
  private assertInside(p: string): void {
    let probe = this.abs(p);
    while (!fs.existsSync(probe) && probe !== this.root && nodePath.dirname(probe) !== probe) probe = nodePath.dirname(probe);
    let real: string;
    let rootReal: string;
    try {
      real = fs.realpathSync.native(probe);
      rootReal = fs.realpathSync.native(this.root);
    } catch {
      return;
    }
    const rel = nodePath.relative(rootReal, real);
    if (rel.startsWith("..") || nodePath.isAbsolute(rel)) throw new AgentError("forbidden", `“${p}” leads outside the vault.`);
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async readText(p: string): Promise<string> {
    return fs.promises.readFile(this.abs(p), "utf8");
  }

  private fileExists(p: string): boolean {
    try {
      return fs.statSync(this.abs(p)).isFile();
    } catch {
      return false;
    }
  }

  private folderExists(p: string): boolean {
    if (!p) return true;
    try {
      return fs.statSync(this.abs(p)).isDirectory();
    } catch {
      return false;
    }
  }

  /** Bring the in-memory index up to date with the folder (only changed notes are re-read). */
  async refresh(force = false): Promise<void> {
    if (!force && !this.dirty && Date.now() - this.scannedAt < this.rescanMs) return;
    const seen = new Set<string>();
    const folders = new Set<string>();
    const walk = async (rel: string): Promise<void> => {
      let ents: fs.Dirent[];
      try {
        ents = await fs.promises.readdir(rel ? this.abs(rel) : this.root, { withFileTypes: true });
      } catch {
        return;
      }
      await Promise.all(
        ents.map(async (e) => {
          if (e.name.startsWith(".")) return;
          const r = rel ? rel + "/" + e.name : e.name;
          if (e.isDirectory()) {
            folders.add(r);
            return walk(r);
          }
          if (!e.isFile() && !e.isSymbolicLink()) return;
          let st: fs.Stats;
          try {
            st = await fs.promises.stat(this.abs(r));
          } catch {
            return;
          }
          if (!st.isFile()) return;
          seen.add(r);
          const old = this.entries.get(r);
          if (old && old.mtime === Math.round(st.mtimeMs) && old.size === st.size) return;
          const ent: Entry = { path: r, mtime: Math.round(st.mtimeMs), ctime: Math.round(st.birthtimeMs || st.ctimeMs), size: st.size };
          if (isMd(r)) {
            try {
              ent.text = await fs.promises.readFile(this.abs(r), "utf8");
              ent.meta = parseMetadata(ent.text);
            } catch {
              return;
            }
          }
          this.entries.set(r, ent);
        }),
      );
    };
    await walk("");
    for (const k of [...this.entries.keys()]) if (!seen.has(k)) this.entries.delete(k);
    this.folders = folders;
    this.scannedAt = Date.now();
    this.dirty = false;
  }

  private linkIndex(paths: Iterable<string> = this.entries.keys()): LinkIndex {
    return new LinkIndex(paths);
  }

  private async config(): Promise<Record<string, any>> {
    try {
      return JSON.parse(await fs.promises.readFile(nodePath.join(this.root, ".obsidian", "app.json"), "utf8")) ?? {};
    } catch {
      return {};
    }
  }

  /**
   * Find a note from what an agent typed: an exact path, a path without ".md", or a link-style
   * name ("Meeting notes", "Projects/Plan") resolved the way [[links]] resolve.
   */
  async resolveNote(input: unknown, opts: { mustExist?: boolean } = {}): Promise<string> {
    const p = cleanVaultPath(input);
    this.assertInside(p);
    if (this.fileExists(p)) return p;
    if (!extname(p) && this.fileExists(p + ".md")) return p + ".md";
    await this.refresh();
    const hit = this.linkIndex().resolve(p, "");
    if (hit) return hit;
    if (opts.mustExist === false) return withMd(p);
    throw new AgentError("not_found", `There's no note called “${p}”. Use list_notes or search to find the right path.`);
  }

  private async metaOf(p: string): Promise<{ text: string; meta: CachedMetadata }> {
    const text = await this.readText(p);
    return { text, meta: parseMetadata(text) };
  }

  /** After a write: keep the index entry fresh without waiting for the next scan. */
  private touched(...paths: string[]): void {
    for (const p of paths) this.entries.delete(p);
    this.dirty = true;
  }

  // ---------------- read operations

  async status(): Promise<{ vaultPath: string; vaultName: string; appRunning: boolean; notes: number; files: number }> {
    await this.refresh();
    let notes = 0;
    for (const k of this.entries.keys()) if (isMd(k)) notes++;
    return { vaultPath: this.root, vaultName: nodePath.basename(this.root), appRunning: !!this.app, notes, files: this.entries.size };
  }

  async search(a: { query: string; limit?: number; matchCase?: boolean; folder?: string }) {
    const node = parseQuery(String(a.query ?? ""));
    if (!node) throw new AgentError("bad_request", "The search query is empty.");
    await this.refresh();
    const folder = a.folder ? cleanFolderPath(a.folder) : "";
    const limit = clampInt(a.limit, 1, 500, 20);
    const needle = requiredNeedle(node);
    const results: { path: string; nameMatch: boolean; matchCount: number; matches: { line: number; text: string }[] }[] = [];
    let total = 0;
    for (const e of this.entries.values()) {
      if (folder && !e.path.startsWith(folder + "/")) continue;
      const content = e.text ?? "";
      const lower = content.toLowerCase();
      const name = basename(e.path).toLowerCase();
      if (needle && !lower.includes(needle) && !name.includes(needle) && !e.path.toLowerCase().includes(needle)) continue;
      const doc = makeDoc(e.path, content, e.meta ?? null);
      const r = matchDoc(node, doc, !!a.matchCase);
      if (!r) continue;
      total++;
      const lines = lineMatches(content, r.content, 5);
      results.push({ path: e.path, nameMatch: r.name.length > 0 || r.path.length > 0, matchCount: r.content.length, matches: lines });
    }
    results.sort((x, y) => Number(y.nameMatch) - Number(x.nameMatch) || y.matchCount - x.matchCount || x.path.localeCompare(y.path));
    return { query: a.query, total, results: results.slice(0, limit) };
  }

  async readNote(a: { path: string }) {
    const p = await this.resolveNote(a.path);
    const st = await fs.promises.stat(this.abs(p));
    if (!isMd(p)) {
      if (st.size > 2_000_000) throw new AgentError("bad_request", `“${p}” is ${Math.round(st.size / 1e6)} MB, too big to read as text.`);
      const text = await this.readText(p);
      return { path: p, content: text, frontmatter: null, tags: [], headings: [], mtime: Math.round(st.mtimeMs), size: st.size };
    }
    const { text, meta } = await this.metaOf(p);
    return {
      path: p,
      content: text,
      frontmatter: meta.frontmatter ?? null,
      tags: [...new Set((getAllTags(meta) ?? []).map(normTag))],
      headings: (meta.headings ?? []).map((h) => ({ heading: h.heading, level: h.level, line: h.position.start.line + 1 })),
      mtime: Math.round(st.mtimeMs),
      size: st.size,
    };
  }

  async listNotes(a: { folder?: string; recursive?: boolean; limit?: number; allFiles?: boolean } = {}) {
    await this.refresh();
    const folder = cleanFolderPath(a.folder);
    if (folder && !this.folderExists(folder)) throw new AgentError("not_found", `There's no folder called “${folder}”.`);
    const recursive = a.recursive !== false;
    const limit = clampInt(a.limit, 1, 100000, 1000);
    const out: NoteInfo[] = [];
    for (const e of this.entries.values()) {
      if (!a.allFiles && !isMd(e.path)) continue;
      if (folder && !e.path.startsWith(folder + "/")) continue;
      const rest = folder ? e.path.slice(folder.length + 1) : e.path;
      if (!recursive && rest.includes("/")) continue;
      out.push({ path: e.path, mtime: e.mtime, ctime: e.ctime, size: e.size });
    }
    out.sort((x, y) => x.path.localeCompare(y.path));
    return { folder: folder || "/", total: out.length, notes: out.slice(0, limit) };
  }

  async listFolder(a: { path?: string } = {}) {
    await this.refresh();
    const folder = cleanFolderPath(a.path);
    if (folder && !this.folderExists(folder)) throw new AgentError("not_found", `There's no folder called “${folder}”.`);
    const folders: string[] = [];
    const files: NoteInfo[] = [];
    const parentOf = (p: string) => dirname(p);
    for (const f of this.folders) if (parentOf(f) === folder) folders.push(f);
    for (const e of this.entries.values()) if (parentOf(e.path) === folder) files.push({ path: e.path, mtime: e.mtime, ctime: e.ctime, size: e.size });
    folders.sort((x, y) => x.localeCompare(y));
    files.sort((x, y) => x.path.localeCompare(y.path));
    return { path: folder || "/", folders, files };
  }

  async getBacklinks(a: { path: string; unlinked?: boolean }) {
    const p = await this.resolveNote(a.path);
    await this.refresh();
    const idx = this.linkIndex();
    const backlinks: { source: string; count: number; lines: { line: number; text: string }[] }[] = [];
    for (const e of this.entries.values()) {
      if (!e.meta || e.path === p) continue;
      const lines: { line: number; text: string }[] = [];
      let count = 0;
      for (const ref of refsOf(e.meta)) {
        if (idx.resolve(getLinkpath(ref.link), e.path) !== p) continue;
        count++;
        const line = (ref as any).position?.start?.line;
        if (line !== undefined && lines.length < 5 && !lines.some((l) => l.line === line + 1)) lines.push({ line: line + 1, text: lineAt(e.text ?? "", line) });
      }
      if (count) backlinks.push({ source: e.path, count, lines });
    }
    backlinks.sort((x, y) => x.source.localeCompare(y.source));
    const out: any = { path: p, total: backlinks.length, backlinks };
    if (a.unlinked) {
      const name = basename(p).replace(/\.md$/i, "");
      const re = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRe(name)}(?=$|[^\\p{L}\\p{N}_])`, "iu");
      const linked = new Set(backlinks.map((b) => b.source));
      out.unlinkedMentions = [];
      for (const e of this.entries.values()) {
        if (!e.text || e.path === p || linked.has(e.path)) continue;
        const ls = e.text.split("\n");
        const hits: { line: number; text: string }[] = [];
        ls.forEach((l, i) => {
          if (hits.length < 5 && re.test(l) && !/\[\[/.test(l.replace(/\[\[[^\]]*\]\]/g, ""))) hits.push({ line: i + 1, text: l.trim().slice(0, 300) });
        });
        if (hits.length) out.unlinkedMentions.push({ source: e.path, lines: hits });
      }
    }
    return out;
  }

  async getOutgoingLinks(a: { path: string }) {
    const p = await this.resolveNote(a.path);
    await this.refresh();
    const idx = this.linkIndex();
    const { text, meta } = await this.metaOf(p);
    const links = refsOf(meta).map((ref: any) => {
      const target = idx.resolve(getLinkpath(ref.link), p);
      const line = ref.position?.start?.line;
      return {
        link: ref.link,
        target,
        resolved: !!target,
        embed: String(ref.original ?? "").startsWith("!"),
        displayText: ref.displayText ?? null,
        line: line !== undefined ? line + 1 : null,
        inFrontmatter: !ref.position,
        context: line !== undefined ? lineAt(text, line) : null,
      };
    });
    return { path: p, total: links.length, links };
  }

  async listTags(a: { limit?: number } = {}) {
    await this.refresh();
    const counts = new Map<string, number>();
    for (const e of this.entries.values()) {
      if (!e.meta) continue;
      for (const t of new Set((getAllTags(e.meta) ?? []).map(normTag))) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const tags = [...counts].map(([tag, count]) => ({ tag, count })).sort((x, y) => y.count - x.count || x.tag.localeCompare(y.tag));
    return { total: tags.length, tags: tags.slice(0, clampInt(a.limit, 1, 100000, 10000)) };
  }

  async notesWithTag(a: { tag: string; includeNested?: boolean }) {
    const want = normTag(String(a.tag ?? ""));
    if (want === "#") throw new AgentError("bad_request", "A tag is required, like “#project”.");
    await this.refresh();
    const nested = a.includeNested !== false;
    const notes: string[] = [];
    for (const e of this.entries.values()) {
      if (!e.meta) continue;
      const tags = (getAllTags(e.meta) ?? []).map((t) => normTag(t).toLowerCase());
      const w = want.toLowerCase();
      if (tags.some((t) => t === w || (nested && t.startsWith(w + "/")))) notes.push(e.path);
    }
    notes.sort((x, y) => x.localeCompare(y));
    return { tag: want, total: notes.length, notes };
  }

  async queryProperties(a: { filters?: PropertyFilter[]; match?: "all" | "any"; limit?: number; folder?: string }) {
    const filters = Array.isArray(a.filters) ? a.filters : [];
    for (const f of filters) {
      if (!f || typeof f.key !== "string" || !f.key) throw new AgentError("bad_request", "Each filter needs a property name in “key”.");
      if (!PROP_OPS.includes(f.op)) throw new AgentError("bad_request", `Unknown filter “${f.op}”. Use one of: ${PROP_OPS.join(", ")}.`);
    }
    await this.refresh();
    const folder = a.folder ? cleanFolderPath(a.folder) : "";
    const any = a.match === "any";
    const notes: { path: string; properties: Record<string, unknown> }[] = [];
    for (const e of this.entries.values()) {
      if (!e.meta) continue;
      if (folder && !e.path.startsWith(folder + "/")) continue;
      const fm = (e.meta.frontmatter ?? {}) as Record<string, unknown>;
      if (!filters.length) {
        if (Object.keys(fm).length) notes.push({ path: e.path, properties: fm });
        continue;
      }
      const results = filters.map((f) => propMatches(fm, f));
      if (any ? results.some(Boolean) : results.every(Boolean)) notes.push({ path: e.path, properties: fm });
    }
    notes.sort((x, y) => x.path.localeCompare(y.path));
    return { total: notes.length, notes: notes.slice(0, clampInt(a.limit, 1, 100000, 200)) };
  }

  async getActiveNote() {
    if (!this.app) throw new AgentError("unavailable", "Bedrock isn't running, so there's no open note. Start the app, or use read_note with a path.");
    const p = await this.app.activeNote();
    if (!p) return { path: null, content: null, message: "No note is open right now." };
    return this.readNote({ path: p });
  }

  // ---------------- write operations

  async createNote(a: { path: string; content?: string; overwrite?: boolean }) {
    return this.exclusive(async () => {
      const p = withMd(cleanVaultPath(a.path));
      this.assertInside(p);
      const existed = this.fileExists(p);
      if (existed && !a.overwrite) throw new AgentError("exists", `“${p}” already exists. Use edit_note or append_to_note to change it, or set overwrite.`);
      if (this.folderExists(p) && p !== "") throw new AgentError("exists", `“${p}” is a folder.`);
      await this.writer.write(p, String(a.content ?? ""));
      this.touched(p);
      return { path: p, created: !existed, overwritten: existed };
    });
  }

  async editNote(a: EditArgs) {
    return this.exclusive(async () => {
      const p = await this.resolveNote(a.path);
      const text = await this.readText(p);
      let next: string;
      let changes = 1;
      if (a.mode === "replace") {
        if (typeof a.content !== "string") throw new AgentError("bad_request", "“content” is required to replace the note.");
        next = a.content;
      } else if (a.mode === "find_replace") {
        if (typeof a.find !== "string" || a.find === "") throw new AgentError("bad_request", "“find” is required.");
        const replace = String(a.replace ?? "");
        const flags = (a.all ? "g" : "") + (a.caseSensitive === false ? "i" : "");
        let re: RegExp;
        try {
          re = new RegExp(a.regex ? a.find : escapeRe(a.find), flags);
        } catch (e: any) {
          throw new AgentError("bad_request", `The regular expression is not valid: ${e.message}`);
        }
        const hits = text.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"));
        if (!hits) throw new AgentError("not_found", `Couldn't find “${a.find}” in “${p}”. Nothing was changed.`);
        changes = a.all ? hits.length : 1;
        next = a.regex ? text.replace(re, replace) : text.replace(re, () => replace);
      } else if (a.mode === "patch_heading") {
        next = patchUnderHeading(text, String(a.heading ?? ""), String(a.content ?? ""), a.position ?? "replace", p);
      } else throw new AgentError("bad_request", `Unknown edit mode “${(a as any).mode}”. Use replace, find_replace or patch_heading.`);
      if (next !== text) await this.writer.write(p, next);
      this.touched(p);
      return { path: p, changed: next !== text, replacements: a.mode === "find_replace" ? changes : undefined };
    });
  }

  async appendToNote(a: { path: string; text: string; heading?: string; create?: boolean }) {
    return this.exclusive(async () => {
      if (typeof a.text !== "string") throw new AgentError("bad_request", "“text” is required.");
      let p: string;
      let text = "";
      let created = false;
      try {
        p = await this.resolveNote(a.path);
        text = await this.readText(p);
      } catch (e) {
        if (!(e instanceof AgentError) || e.code !== "not_found" || a.create === false) throw e;
        p = withMd(cleanVaultPath(a.path));
        created = true;
      }
      const next = a.heading ? patchUnderHeading(text, a.heading, a.text, "append", p) : appendBlock(text, a.text);
      await this.writer.write(p, next);
      this.touched(p);
      return { path: p, created };
    });
  }

  async moveNote(a: { from: string; to: string; updateLinks?: boolean }) {
    return this.exclusive(async () => {
      const from = await this.resolveNote(a.from);
      let to = cleanVaultPath(a.to, "destination");
      if (/[\\/]$/.test(String(a.to).trim()) || this.folderExists(to)) to = to + "/" + basename(from);
      if (!extname(to) && extname(from)) to += "." + extname(from);
      this.assertInside(to);
      if (to === from) return { from, to, updatedLinks: 0, updatedNotes: [] as string[] };
      if (this.fileExists(to) && to.toLowerCase() !== from.toLowerCase()) throw new AgentError("exists", `“${to}” already exists. Pick another name or move it first.`);

      await this.refresh(true);
      const update = a.updateLinks !== false;
      const oldIdx = this.linkIndex();
      type Hit = { source: string; ref: any; target: string };
      const hits: Hit[] = [];
      if (update) {
        for (const e of this.entries.values()) {
          if (!e.meta) continue;
          for (const ref of refsOf(e.meta)) {
            const target = oldIdx.resolve(getLinkpath(ref.link), e.path);
            if (target && (target === from || e.path === from)) hits.push({ source: e.path, ref, target });
          }
        }
      }
      await this.writer.rename(from, to);
      const map = (x: string) => (x === from ? to : x);
      const newIdx = this.linkIndex([...this.entries.keys()].filter((k) => k !== from).concat(to));
      const cfg = await this.config();
      const bySource = new Map<string, Hit[]>();
      for (const h of hits) {
        const s = map(h.source);
        (bySource.get(s) ?? bySource.set(s, []).get(s)!).push(h);
      }
      let updatedLinks = 0;
      const updatedNotes: string[] = [];
      for (const [src, list] of bySource) {
        let text: string;
        try {
          text = await this.readText(src);
        } catch {
          continue;
        }
        const edits: { from: number; to: number; text: string; orig: string }[] = [];
        const fmEdits: { orig: string; text: string }[] = [];
        let n = 0;
        for (const h of list) {
          const repl = rewriteLink(h.ref, map(h.target), src, newIdx, cfg);
          if (repl === h.ref.original) continue;
          if (h.ref.position) edits.push({ from: h.ref.position.start.offset, to: h.ref.position.end.offset, text: repl, orig: h.ref.original });
          else fmEdits.push({ orig: h.ref.original, text: repl });
        }
        // Body links first, last to first, so earlier offsets stay valid; the properties block
        // sits before all of them, so it is edited afterwards.
        edits.sort((x, y) => y.from - x.from);
        for (const e of edits)
          if (text.slice(e.from, e.to) === e.orig) {
            text = text.slice(0, e.from) + e.text + text.slice(e.to);
            n++;
          }
        if (fmEdits.length) {
          const info = getFrontMatterInfo(text);
          if (info.exists) {
            let fm = text.slice(info.from, info.to);
            for (const e of fmEdits)
              if (fm.includes(e.orig)) {
                fm = fm.replace(e.orig, e.text);
                n++;
              }
            text = text.slice(0, info.from) + fm + text.slice(info.to);
          }
        }
        if (!n) continue;
        await this.writer.write(src, text);
        updatedLinks += n;
        updatedNotes.push(src);
      }
      this.touched(from, to, ...updatedNotes);
      return { from, to, updatedLinks, updatedNotes };
    });
  }

  async deleteNote(a: { path: string }) {
    return this.exclusive(async () => {
      const p = await this.resolveNote(a.path);
      const dest = await this.writer.trash(p);
      this.touched(p);
      return { path: p, movedTo: dest, message: `Moved to the vault's ${dest.split("/")[0]} folder. It can be restored from there (and from Deleted files in Settings › Sync).` };
    });
  }

  async setProperty(a: { path: string; key: string; value: unknown }) {
    return this.exclusive(async () => {
      if (typeof a.key !== "string" || !a.key.trim()) throw new AgentError("bad_request", "A property name (“key”) is required.");
      const p = await this.resolveNote(a.path);
      if (!isMd(p)) throw new AgentError("bad_request", "Properties can only be set on Markdown notes.");
      const text = await this.readText(p);
      const next = setFrontmatterValue(text, a.key.trim(), a.value);
      if (next !== text) await this.writer.write(p, next);
      this.touched(p);
      const { meta } = { meta: parseMetadata(next) };
      return { path: p, properties: meta.frontmatter ?? {} };
    });
  }

  async getDailyNote(a: { date?: string; create?: boolean; append?: string } = {}) {
    const settings = await this.dailySettings();
    const m = a.date ? parseDate(a.date, this.now()) : moment(this.now());
    if (!m) throw new AgentError("bad_request", `“${a.date}” isn't a date I can read. Use YYYY-MM-DD, “today”, “yesterday” or “tomorrow”.`);
    const name = m.format(settings.format);
    const folder = settings.folder ? cleanFolderPath(settings.folder) : "";
    const p = cleanVaultPath((folder ? folder + "/" : "") + name + ".md");
    let created = false;
    if (!this.fileExists(p)) {
      if (a.create === false && !a.append) return { path: p, date: m.format("YYYY-MM-DD"), exists: false, created: false, content: null };
      await this.exclusive(async () => {
        if (this.fileExists(p)) return;
        const tpl = await this.templateText(settings.template);
        await this.writer.write(p, renderTemplate(tpl, basename(name), m));
        this.touched(p);
        created = true;
      });
    }
    if (a.append) await this.appendToNote({ path: p, text: a.append });
    const r = await this.readNote({ path: p });
    return { ...r, date: m.format("YYYY-MM-DD"), exists: true, created };
  }

  private async dailySettings(): Promise<{ folder: string; format: string; template: string }> {
    let s: any = {};
    try {
      s = JSON.parse(await fs.promises.readFile(nodePath.join(this.root, ".obsidian", "daily-notes.json"), "utf8")) ?? {};
    } catch {
      /* defaults */
    }
    return { folder: typeof s.folder === "string" ? s.folder : "", format: typeof s.format === "string" && s.format.trim() ? s.format.trim() : "YYYY-MM-DD", template: typeof s.template === "string" ? s.template : "" };
  }

  private async templateText(tpl: string): Promise<string> {
    if (!tpl.trim()) return "";
    try {
      const p = await this.resolveNote(tpl.replace(/\.md$/i, ""));
      return await this.readText(p);
    } catch {
      return "";
    }
  }

  async openNote(a: { path: string; newTab?: boolean; line?: number }) {
    if (!this.app) throw new AgentError("unavailable", "Bedrock isn't running. Start the app to open notes in it.");
    const p = await this.resolveNote(a.path);
    await this.app.open(p, { newTab: !!a.newTab, line: a.line });
    return { path: p, opened: true };
  }
}

// ------------------------------------------------------------------ helpers (exported for tests)

const PROP_OPS: PropertyFilter["op"][] = ["equals", "not_equals", "contains", "exists", "missing", "gt", "gte", "lt", "lte", "range"];

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normTag(t: string): string {
  const s = t.trim().replace(/^#+/, "");
  return "#" + s;
}

function refsOf(meta: CachedMetadata | undefined | null): any[] {
  if (!meta) return [];
  return [...(meta.links ?? []), ...(meta.embeds ?? []), ...((meta.frontmatterLinks as any[]) ?? [])];
}

function lineAt(text: string, line: number): string {
  let start = 0;
  for (let i = 0; i < line; i++) {
    const n = text.indexOf("\n", start);
    if (n < 0) return "";
    start = n + 1;
  }
  const end = text.indexOf("\n", start);
  return text.slice(start, end < 0 ? undefined : end).trim().slice(0, 300);
}

function lineMatches(text: string, ranges: [number, number][], max: number): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  const seen = new Set<number>();
  for (const [from] of ranges) {
    if (out.length >= max) break;
    let line = 0;
    for (let i = text.indexOf("\n"); i >= 0 && i < from; i = text.indexOf("\n", i + 1)) line++;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push({ line: line + 1, text: lineAt(text, line) });
  }
  return out;
}

function appendBlock(text: string, add: string): string {
  if (!text) return add.endsWith("\n") ? add : add + "\n";
  const sep = text.endsWith("\n") ? "" : "\n";
  const out = text + sep + add;
  return out.endsWith("\n") ? out : out + "\n";
}

/**
 * Replace, append to or prepend to the section under a heading. The section runs from the line
 * after the heading to the next heading of the same or a higher level. `heading` may include the
 * leading #s ("## Tasks") to pick a level, and is matched case-insensitively.
 */
export function patchUnderHeading(text: string, heading: string, content: string, position: "replace" | "append" | "prepend", p = "the note"): string {
  const want = heading.trim();
  if (!want) throw new AgentError("bad_request", "“heading” is required.");
  const m = /^(#{1,6})\s+(.*)$/.exec(want);
  const wantLevel = m ? m[1].length : 0;
  const wantText = (m ? m[2] : want).trim().toLowerCase();
  const meta = parseMetadata(text);
  const hs = meta.headings ?? [];
  const i = hs.findIndex((h) => h.heading.trim().toLowerCase() === wantText && (!wantLevel || h.level === wantLevel));
  if (i < 0) {
    const list = hs.map((h) => "#".repeat(h.level) + " " + h.heading).join(", ");
    throw new AgentError("not_found", `“${p}” has no heading “${want}”.${list ? ` Its headings are: ${list}.` : " It has no headings."}`);
  }
  const h = hs[i];
  const lineEnd = text.indexOf("\n", h.position.end.offset);
  const bodyStart = lineEnd < 0 ? text.length : lineEnd + 1;
  const next = hs.slice(i + 1).find((x) => x.level <= h.level);
  const bodyEnd = next ? next.position.start.offset : text.length;
  const before = text.slice(0, bodyStart);
  const body = text.slice(bodyStart, bodyEnd);
  const after = text.slice(bodyEnd);
  const block = content.endsWith("\n") ? content : content + "\n";
  const headSep = lineEnd < 0 ? "\n" : "";
  let newBody: string;
  if (position === "replace") newBody = block + (next ? "\n" : "");
  else if (position === "prepend") newBody = block + body;
  else {
    const trimmed = body.replace(/\s+$/, "");
    newBody = (trimmed ? trimmed + "\n" : "") + block + (next ? "\n" : "");
  }
  return before + headSep + newBody + after;
}

/** Set (or with null/undefined, remove) one frontmatter property, keeping the rest of the note. */
export function setFrontmatterValue(text: string, key: string, value: unknown): string {
  const info = getFrontMatterInfo(text);
  let fm: Record<string, unknown> = {};
  if (info.exists) {
    try {
      fm = parseYaml(info.frontmatter) ?? {};
    } catch (e: any) {
      throw new AgentError("bad_request", `The properties block of this note isn't valid YAML, so it wasn't changed (${e.message}).`);
    }
    if (typeof fm !== "object" || Array.isArray(fm)) throw new AgentError("bad_request", "The properties block of this note isn't a list of key: value pairs, so it wasn't changed.");
  }
  if (value === null || value === undefined) delete fm[key];
  else fm[key] = value;
  const body = info.exists ? text.slice(info.contentStart) : text;
  if (!Object.keys(fm).length) return body;
  return "---\n" + stringifyYaml(fm) + "---\n" + body;
}

function scalar(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
}

function cmpValues(a: unknown, b: unknown): number | null {
  const x = scalar(a);
  const y = scalar(b);
  if (x === null || y === null) return null;
  const nx = typeof x === "number" ? x : Number(x);
  const ny = typeof y === "number" ? y : Number(y);
  if (Number.isFinite(nx) && Number.isFinite(ny) && String(x).trim() !== "" && String(y).trim() !== "") return nx - ny;
  const dx = Date.parse(String(x));
  const dy = Date.parse(String(y));
  if (/^\d{4}-\d{2}/.test(String(x)) && /^\d{4}-\d{2}/.test(String(y)) && Number.isFinite(dx) && Number.isFinite(dy)) return dx - dy;
  return String(x).localeCompare(String(y), undefined, { sensitivity: "base", numeric: true });
}

function looseEq(a: unknown, b: unknown): boolean {
  if (Array.isArray(a)) return a.some((x) => looseEq(x, b));
  const x = scalar(a);
  const y = scalar(b);
  if (x === null || y === null) return x === y;
  if (typeof x === "boolean" || typeof y === "boolean") return String(x).toLowerCase() === String(y).toLowerCase();
  const c = cmpValues(x, y);
  if (c === 0 && (typeof x === "number" || typeof y === "number")) return true;
  return String(x).replace(/^#/, "").toLowerCase() === String(y).replace(/^#/, "").toLowerCase();
}

function findKey(fm: Record<string, unknown>, key: string): string | undefined {
  if (key in fm) return key;
  const l = key.toLowerCase();
  return Object.keys(fm).find((k) => k.toLowerCase() === l);
}

export function propMatches(fm: Record<string, unknown>, f: PropertyFilter): boolean {
  const k = findKey(fm, f.key);
  const has = k !== undefined && fm[k] !== null && fm[k] !== "" && !(Array.isArray(fm[k]) && (fm[k] as unknown[]).length === 0);
  const v = k !== undefined ? fm[k] : undefined;
  switch (f.op) {
    case "exists":
      return has;
    case "missing":
      return !has;
    case "equals":
      return k !== undefined && looseEq(v, f.value);
    case "not_equals":
      return !(k !== undefined && looseEq(v, f.value));
    case "contains": {
      if (!has) return false;
      const needle = String(scalar(f.value) ?? "").replace(/^#/, "").toLowerCase();
      if (Array.isArray(v)) return v.some((x) => String(scalar(x) ?? "").replace(/^#/, "").toLowerCase().includes(needle));
      return String(scalar(v) ?? "").toLowerCase().includes(needle);
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (!has) return false;
      const vals = Array.isArray(v) ? v : [v];
      return vals.some((x) => {
        const c = cmpValues(x, f.value);
        if (c === null) return false;
        return f.op === "gt" ? c > 0 : f.op === "gte" ? c >= 0 : f.op === "lt" ? c < 0 : c <= 0;
      });
    }
    case "range": {
      if (!has) return false;
      const vals = Array.isArray(v) ? v : [v];
      return vals.some((x) => {
        const lo = f.min === undefined || f.min === null ? 0 : cmpValues(x, f.min);
        const hi = f.max === undefined || f.max === null ? 0 : cmpValues(x, f.max);
        return lo !== null && hi !== null && lo >= 0 && hi <= 0;
      });
    }
  }
  return false;
}

/** New text for a link so it points at `target` from `source`, keeping its style, alias and heading. */
export function rewriteLink(ref: { link: string; original: string; displayText?: string }, target: string, source: string, idx: LinkIndex, cfg: Record<string, any>): string {
  const { subpath } = parseLinktext(ref.link);
  const orig = ref.original;
  const embed = orig.startsWith("!") ? "!" : "";
  const fmt = cfg.newLinkFormat === "relative" || cfg.newLinkFormat === "absolute" ? cfg.newLinkFormat : "shortest";
  if (/^!?\[\[/.test(orig)) {
    const inner = orig.replace(/^!?\[\[|\]\]$/g, "");
    const { alias } = splitAlias(inner);
    let text = idx.linkText(target, source, fmt);
    if (/\.md(#|$)/i.test(getLinkpath(ref.link)) && isMd(target)) text += ".md";
    return `${embed}[[${text}${subpath}${alias !== undefined ? "|" + alias : ""}]]`;
  }
  if (!/^!?\[/.test(orig)) return orig.replace(ref.link, idx.linkText(target, source, fmt) + subpath); // frontmatter plain value
  const m = orig.match(/^(!?)\[([\s\S]*?)\]\(/);
  const label = m ? m[2] : ref.displayText ?? basename(target);
  let p = idx.linkText(target, source, fmt === "shortest" ? "absolute" : fmt);
  if (isMd(target)) p += ".md";
  const angle = /\]\(</.test(orig);
  return `${embed}[${label}](${angle ? "<" + p + ">" : encodeURI(p)}${subpath})`;
}

function parseDate(s: string, now: Date): moment.Moment | null {
  const t = s.trim().toLowerCase();
  if (t === "today") return moment(now);
  if (t === "yesterday") return moment(now).subtract(1, "day");
  if (t === "tomorrow") return moment(now).add(1, "day");
  const m = moment(s.trim(), ["YYYY-MM-DD", "YYYY/MM/DD", "YYYYMMDD", moment.ISO_8601], true);
  return m.isValid() ? m : null;
}

/** Obsidian-style template variables: {{title}}, {{date}}, {{time}}, {{date:FORMAT}}, {{time:FORMAT}}. */
export function renderTemplate(tpl: string, title: string, m: moment.Moment): string {
  return tpl.replace(/\{\{\s*(title|date|time)\s*(?::([^}]*))?\}\}/gi, (_all, kind: string, fmt?: string) => {
    const k = kind.toLowerCase();
    if (k === "title") return title;
    const f = fmt?.trim() || (k === "date" ? "YYYY-MM-DD" : "HH:mm");
    return m.format(f);
  });
}
