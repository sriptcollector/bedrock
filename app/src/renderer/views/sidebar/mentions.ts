// Backlink helpers (pure, unit-tested): linked-mention ranges, unlinked mentions of a note's
// name/aliases (whole words, outside links), and the text that turns a mention into a link.
import type { CachedMetadata } from "obsidian";
import type { Range } from "./search-query";
import { normalizeRanges } from "./search-query";

const WORD = /[\p{L}\p{N}_]/u;

/** Ranges of the links in `meta` that point at the target (resolve(linkpath) === targetPath). */
export function linkedRanges(meta: CachedMetadata | null, targetPath: string, resolve: (linkpath: string) => string | null): Range[] {
  const out: Range[] = [];
  for (const l of [...(meta?.links ?? []), ...(meta?.embeds ?? [])]) {
    const lp = l.link.split("#")[0].split("|")[0];
    if (resolve(lp || "") === targetPath && l.position) out.push([l.position.start.offset, l.position.end.offset]);
  }
  return normalizeRanges(out);
}

/** Areas a mention may not sit in: frontmatter, links, embeds, inline/fenced code. */
export function excludedRanges(content: string, meta: CachedMetadata | null): Range[] {
  const out: Range[] = [];
  for (const s of meta?.sections ?? []) if (s.type === "yaml" || s.type === "code") out.push([s.position.start.offset, s.position.end.offset]);
  for (const l of [...(meta?.links ?? []), ...(meta?.embeds ?? [])]) if (l.position) out.push([l.position.start.offset, l.position.end.offset]);
  if (!meta) {
    const fm = /^---\n[\s\S]*?\n---/.exec(content);
    if (fm) out.push([0, fm[0].length]);
    const re = /!?\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) out.push([m.index, m.index + m[0].length]);
  }
  // Markdown links [text](url) and inline code.
  const re2 = /`[^`\n]+`|\[[^\]\n]*\]\([^)\n]*\)/g;
  let m2: RegExpExecArray | null;
  while ((m2 = re2.exec(content))) out.push([m2.index, m2.index + m2[0].length]);
  return normalizeRanges(out);
}

/** Whole-word, case-insensitive occurrences of any of `names` outside excluded ranges. */
export function findUnlinkedMentions(content: string, meta: CachedMetadata | null, names: string[]): Range[] {
  const lower = content.toLowerCase();
  const excl = excludedRanges(content, meta);
  const inExcl = (a: number, b: number) => excl.some(([s, e]) => a < e && b > s);
  const out: Range[] = [];
  const uniq = [...new Set(names.map((n) => n.trim().toLowerCase()).filter((n) => n.length > 0))].sort((a, b) => b.length - a.length);
  for (const n of uniq) {
    let from = 0;
    for (;;) {
      const i = lower.indexOf(n, from);
      if (i < 0) break;
      from = i + n.length;
      const before = i > 0 ? content[i - 1] : "";
      const after = content[i + n.length] ?? "";
      if ((before && WORD.test(before)) || (after && WORD.test(after))) continue;
      if (inExcl(i, i + n.length)) continue;
      if (out.some(([s, e]) => i < e && i + n.length > s)) continue;
      out.push([i, i + n.length]);
    }
  }
  return normalizeRanges(out);
}

/** Wikilink text that replaces an unlinked mention: [[linktext]] or [[linktext|mention]]. */
export function mentionToLink(mention: string, linktext: string): string {
  const base = linktext.split("/").pop()!;
  if (mention === linktext) return `[[${linktext}]]`;
  if (mention.toLowerCase() === linktext.toLowerCase() && !linktext.includes("/")) return `[[${linktext}|${mention}]]`;
  if (mention === base) return `[[${linktext}|${mention}]]`;
  return `[[${linktext}|${mention}]]`;
}
