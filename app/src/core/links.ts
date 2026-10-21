// Link text parsing and Obsidian-compatible link resolution.
import { basename, dirname, extname, resolveRelative } from "./path";

export function parseLinktext(linktext: string): { path: string; subpath: string } {
  const i = linktext.indexOf("#");
  if (i < 0) return { path: linktext, subpath: "" };
  return { path: linktext.slice(0, i), subpath: linktext.slice(i) };
}

export function getLinkpath(linktext: string): string {
  return parseLinktext(linktext).path;
}

/** Split `target|alias` (wikilink inner text); escaped `\|` (in tables) counts as a pipe. */
export function splitAlias(inner: string): { link: string; alias?: string } {
  const m = inner.match(/^(.*?)(?:\\?\|(.*))?$/s)!;
  return { link: m[1].trim(), alias: m[2] !== undefined ? m[2].trim() : undefined };
}

export function stripHeading(h: string): string {
  return h.replace(/[!"#$%&()*+,.:;<=>?@^`{|}~\/\[\]\\]/g, " ").replace(/\s+/g, " ").trim();
}

export function stripHeadingForLink(h: string): string {
  return h.replace(/[#|^\\%\[\]:]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Index for resolving link paths. Files are looked up by lowercase name (with and without the
 * extension). Resolution order (matches Obsidian's observable behaviour):
 *  1. "./x" or "../x": relative to the source note's folder.
 *  2. the path relative to the source note's folder (with ".md" added when it has no extension);
 *  3. an exact vault path;
 *  4. any file whose name matches and whose path ends with the link path; when several match,
 *     prefer one in the source note's folder, then the shortest path, then alphabetical.
 * Links are case-insensitive.
 */
export class LinkIndex {
  private byPath = new Map<string, string>(); // lower path -> path
  private byName = new Map<string, string[]>(); // lower name (and name sans .md) -> paths

  constructor(paths: Iterable<string> = []) {
    for (const p of paths) this.add(p);
  }

  add(path: string): void {
    this.byPath.set(path.toLowerCase(), path);
    for (const k of this.keys(path)) {
      const arr = this.byName.get(k);
      if (arr) {
        if (!arr.includes(path)) arr.push(path);
      } else this.byName.set(k, [path]);
    }
  }

  remove(path: string): void {
    this.byPath.delete(path.toLowerCase());
    for (const k of this.keys(path)) {
      const arr = this.byName.get(k);
      if (!arr) continue;
      const i = arr.indexOf(path);
      if (i >= 0) arr.splice(i, 1);
      if (!arr.length) this.byName.delete(k);
    }
  }

  has(path: string): boolean {
    return this.byPath.has(path.toLowerCase());
  }

  private keys(path: string): string[] {
    const name = basename(path).toLowerCase();
    const ext = extname(name);
    return ext === "md" ? [name, name.slice(0, -3)] : [name];
  }

  private exact(p: string): string | null {
    const l = p.toLowerCase();
    return this.byPath.get(l + ".md") ?? this.byPath.get(l) ?? null;
  }

  /** Returns the vault path a link points to, or null if unresolved. */
  resolve(linkpath: string, sourcePath: string): string | null {
    let lp = linkpath.trim();
    try {
      if (/%[0-9a-f]{2}/i.test(lp)) lp = decodeURIComponent(lp);
    } catch {
      /* keep raw */
    }
    lp = lp.replace(/\\/g, "/");
    if (lp === "") return sourcePath || null;
    const folder = dirname(sourcePath);
    if (lp.startsWith("./") || lp.startsWith("../")) {
      return this.exact(resolveRelative(folder, lp));
    }
    if (lp.startsWith("/")) lp = lp.replace(/^\/+/, "");
    if (folder) {
      const rel = this.exact(folder + "/" + lp);
      if (rel) return rel;
    }
    const direct = this.exact(lp);
    if (direct) return direct;
    const name = basename(lp).toLowerCase();
    const cands = this.byName.get(name);
    if (!cands || !cands.length) return null;
    const hasExt = extname(name) !== "" && cands.some((c) => basename(c).toLowerCase() === name);
    const suffix = lp.toLowerCase();
    const matches = cands.filter((c) => {
      const lc = c.toLowerCase();
      const cmp = hasExt ? lc : lc.replace(/\.md$/, "");
      return cmp === suffix || cmp.endsWith("/" + suffix);
    });
    if (!matches.length) return null;
    if (matches.length === 1) return matches[0];
    const sameFolder = matches.find((m) => dirname(m) === folder);
    if (sameFolder) return sameFolder;
    // Prefer markdown over a same-named attachment when the link has no extension.
    const pool = !hasExt && matches.some((m) => m.endsWith(".md")) ? matches.filter((m) => m.endsWith(".md")) : matches;
    return [...pool].sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))[0];
  }

  /** All files sharing this file's name (to decide if the shortest link is unique). */
  sameName(path: string): string[] {
    return this.byName.get(basename(path).toLowerCase()) ?? [];
  }

  /**
   * The link text to use for a file per "New link format" (shortest | relative | absolute).
   * Markdown files drop their ".md".
   */
  linkText(target: string, sourcePath: string, format: "shortest" | "relative" | "absolute" = "shortest"): string {
    const isMd = target.toLowerCase().endsWith(".md");
    const strip = (p: string) => (isMd ? p.slice(0, -3) : p);
    if (format === "absolute") return strip(target);
    if (format === "relative") {
      const from = dirname(sourcePath).split("/").filter(Boolean);
      const to = target.split("/");
      let i = 0;
      while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
      const up = from.length - i;
      const rel = (up ? "../".repeat(up) : "") + to.slice(i).join("/");
      return strip(rel);
    }
    const name = basename(target);
    const key = strip(name);
    // Verified against Obsidian 1.14.4: the bare name only when no other file shares it
    // (even a same-folder target gets its full path when the name is ambiguous).
    if (this.sameName(target).length <= 1) return key;
    return strip(target);
  }
}
