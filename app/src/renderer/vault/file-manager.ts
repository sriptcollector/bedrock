// FileManager (obsidian.d.ts): renames that keep links working, frontmatter edits, link text.
import type { CachedMetadata } from "obsidian";
import type { App } from "../app";
import { TAbstractFile, TFile, TFolder } from "./files";
import { Vault } from "./vault";
import { getFrontMatterInfo, parseYaml, stringifyYaml } from "../../core/parse";
import { getLinkpath, parseLinktext, splitAlias } from "../../core/links";
import { dirname, normalizePath } from "../../core/path";

interface PendingEdit {
  from: number;
  to: number;
  text: string;
  orig: string;
}

export class FileManager {
  constructor(private app: App) {}

  private get vault(): Vault {
    return this.app.vault;
  }

  getNewFileParent(sourcePath: string, _newFilePath?: string): TFolder {
    const loc = this.vault.getConfig("newFileLocation");
    if (loc === "current" && sourcePath) {
      const f = this.vault.getAbstractFileByPath(sourcePath);
      if (f?.parent) return f.parent;
    }
    if (loc === "folder") {
      const folder = this.vault.getFolderByPath(this.vault.getConfig("newFileFolderPath") || "/");
      if (folder) return folder;
    }
    return this.vault.getRoot();
  }

  async createNewMarkdownFile(folder: TFolder, name = "Untitled", content = ""): Promise<TFile> {
    const base = folder.isRoot() ? name : folder.path + "/" + name;
    return this.vault.create(this.vault.getAvailablePath(base, "md"), content);
  }

  async promptForDeletion(file: TAbstractFile): Promise<boolean> {
    if (this.vault.getConfig("promptDelete")) {
      const ok = await this.app.ui.confirm({
        title: file instanceof TFolder ? "Delete folder" : "Delete file",
        body: `Are you sure you want to delete "${file.name}"?` + (file instanceof TFolder ? ` It contains ${file.getFileCount()} files.` : ""),
        cta: "Delete",
        danger: true,
        dontAskAgain: () => this.vault.setConfig("promptDelete", false),
      });
      if (!ok) return false;
    }
    await this.trashFile(file);
    return true;
  }

  async trashFile(file: TAbstractFile): Promise<void> {
    const opt = this.vault.getConfig("trashOption");
    if (opt === "none") await this.vault.delete(file, true);
    else await this.vault.trash(file, opt !== "local");
  }

  /** Text of a link to `file` from `sourcePath`, honouring the vault's link settings. */
  generateMarkdownLink(file: TFile, sourcePath: string, subpath = "", alias = ""): string {
    const embed = file.extension !== "md" ? "!" : "";
    if (this.vault.getConfig("useMarkdownLinks")) {
      const fmt = this.vault.getConfig("newLinkFormat");
      let target = this.app.metadataCache.linkIndex.linkText(file.path, sourcePath, fmt === "shortest" ? "absolute" : fmt);
      if (file.extension === "md" && !target.endsWith(".md")) target += ".md";
      return `${embed}[${alias || file.basename}](${encodeURI(target).replace(/#/g, "%23")}${subpath})`;
    }
    const text = this.app.metadataCache.fileToLinktext(file, sourcePath, true);
    return `${embed}[[${text}${subpath}${alias ? "|" + alias : ""}]]`;
  }

  async getAvailablePathForAttachment(filename: string, sourcePath = ""): Promise<string> {
    let folder = this.vault.getConfig("attachmentFolderPath") || "/";
    if (folder.startsWith("./")) folder = normalizePath(dirname(sourcePath) + "/" + folder.slice(2));
    if (folder === "/" || folder === ".") folder = "";
    if (folder && !this.vault.getAbstractFileByPath(folder)) await this.vault.createFolder(folder).catch(() => undefined);
    const dot = filename.lastIndexOf(".");
    const base = dot > 0 ? filename.slice(0, dot) : filename;
    const ext = dot > 0 ? filename.slice(dot + 1) : "";
    return this.vault.getAvailablePath(folder ? folder + "/" + base : base, ext);
  }

  async processFrontMatter(file: TFile, fn: (fm: any) => void, opts?: any): Promise<void> {
    await this.vault.process(
      file,
      (text) => {
        const info = getFrontMatterInfo(text);
        let fm: any = {};
        if (info.exists) {
          fm = parseYaml(info.frontmatter) ?? {};
          if (typeof fm !== "object" || Array.isArray(fm)) throw new Error("The frontmatter of this note is not a YAML map.");
        }
        fn(fm);
        const body = info.exists ? text.slice(info.contentStart) : text;
        if (!fm || Object.keys(fm).length === 0) return info.exists ? body : text;
        return "---\n" + stringifyYaml(fm) + "---\n" + body;
      },
      opts,
    );
  }

  /**
   * Rename/move a file or folder and, when "Automatically update internal links" is on,
   * rewrite every link that pointed at it (and relative links inside moved notes).
   */
  async renameFile(file: TAbstractFile, newPath: string): Promise<void> {
    newPath = normalizePath(newPath);
    const mc = this.app.metadataCache;
    // "Automatically update internal links" off (the default) means: ask each time.
    let update = true;
    const moved: TFile[] = [];
    if (file instanceof TFile) moved.push(file);
    else if (file instanceof TFolder) Vault.recurseChildren(file, (f) => f instanceof TFile && moved.push(f));
    const movedOld = new Set(moved.map((f) => f.path));

    // Before: which links (in which notes) resolve to the moved files; and what links inside the
    // moved notes resolve to, so we can keep them pointing at the same targets after the move.
    type Hit = { source: string; ref: any; target: string };
    const hits: Hit[] = [];
    if (update) {
      for (const [src, targets] of Object.entries(mc.resolvedLinks)) {
        const touches = Object.keys(targets).some((t) => movedOld.has(t)) || movedOld.has(src);
        if (!touches) continue;
        const meta = mc.getCache(src);
        for (const ref of refsOf(meta)) {
          const target = mc.linkIndex.resolve(getLinkpath(ref.link), src);
          if (target && (movedOld.has(target) || movedOld.has(src))) hits.push({ source: src, ref, target });
        }
      }
    }
    if (hits.length && !this.vault.getConfig("alwaysUpdateLinks")) {
      const notes = new Set(hits.map((h) => h.source)).size;
      update = await this.app.ui.confirm({
        title: "Update links",
        body: `Update ${hits.length} link${hits.length === 1 ? "" : "s"} in ${notes} note${notes === 1 ? "" : "s"}?`,
        cta: "Update",
        dontAskAgain: () => this.vault.setConfig("alwaysUpdateLinks", true),
      });
    }
    const oldPrefix = file.path;
    await this.vault.rename(file, newPath);
    if (!update || !hits.length) return;

    const mapPath = (p: string) => (p === oldPrefix ? newPath : p.startsWith(oldPrefix + "/") ? newPath + p.slice(oldPrefix.length) : p);
    const bySource = new Map<string, Hit[]>();
    for (const h of hits) {
      const src = mapPath(h.source);
      (bySource.get(src) ?? bySource.set(src, []).get(src)!).push(h);
    }
    for (const [src, list] of bySource) {
      const srcFile = this.vault.getFileByPath(src);
      if (!srcFile) continue;
      await this.vault.process(srcFile, (text) => {
        const edits: PendingEdit[] = [];
        let fmText: string | null = null;
        for (const h of list) {
          const targetFile = this.vault.getFileByPath(mapPath(h.target));
          if (!targetFile) continue;
          const replacement = this.rewriteRef(h.ref, targetFile, src);
          if (replacement === h.ref.original) continue;
          if (h.ref.position) edits.push({ from: h.ref.position.start.offset, to: h.ref.position.end.offset, text: replacement, orig: h.ref.original });
          else {
            // frontmatter link: replace inside the YAML block
            fmText ??= text;
            fmText = fmText.replace(h.ref.original, replacement);
          }
        }
        if (fmText !== null) text = fmText;
        edits.sort((a, b) => b.from - a.from);
        for (const e of edits) if (text.slice(e.from, e.to) === e.orig) text = text.slice(0, e.from) + e.text + text.slice(e.to);
        return text;
      });
    }
  }

  /** New text for a link reference so it points at `target` from `source`, keeping its style. */
  private rewriteRef(ref: { link: string; original: string; displayText?: string }, target: TFile, source: string): string {
    const { subpath } = parseLinktext(ref.link);
    const orig = ref.original;
    const embed = orig.startsWith("!") ? "!" : "";
    if (/^!?\[\[/.test(orig)) {
      const inner = orig.replace(/^!?\[\[|\]\]$/g, "");
      const { alias } = splitAlias(inner);
      let text = this.app.metadataCache.fileToLinktext(target, source, true);
      // Keep an explicit ".md" if the original had one.
      if (/\.md(#|$)/i.test(getLinkpath(ref.link)) && target.extension === "md") text += ".md";
      return `${embed}[[${text}${subpath}${alias !== undefined ? "|" + alias : ""}]]`;
    }
    // Markdown link: [text](path)
    const m = orig.match(/^(!?)\[([\s\S]*?)\]\(/);
    const label = m ? m[2] : ref.displayText ?? target.basename;
    const fmt = this.vault.getConfig("newLinkFormat");
    let p = this.app.metadataCache.linkIndex.linkText(target.path, source, fmt === "shortest" ? "absolute" : fmt);
    if (target.extension === "md") p += ".md";
    const enc = /%20/.test(orig) || !/</.test(orig) ? encodeURI(p) : p;
    return `${embed}[${label}](${/</.test(orig) ? "<" + p + ">" : enc}${subpath})`;
  }
}

function refsOf(meta: CachedMetadata | null): any[] {
  if (!meta) return [];
  return [...(meta.links ?? []), ...(meta.embeds ?? []), ...((meta.frontmatterLinks as any[]) ?? [])];
}
