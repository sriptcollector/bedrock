// Markdown -> CachedMetadata (the shape of obsidian.d.ts). A fast line scanner, not a full
// CommonMark parser: it finds exactly what the metadata cache needs (frontmatter, headings,
// sections, list items, tasks, links, embeds, tags, block ids, footnotes) with Obsidian-style
// positions {line, col, offset}. Pure: no DOM, no Node APIs, so it runs in a worker and in tests.
import type {
  CachedMetadata,
  EmbedCache,
  FootnoteCache,
  FootnoteRefCache,
  FrontmatterLinkCache,
  HeadingCache,
  LinkCache,
  ListItemCache,
  Loc,
  Pos,
  ReferenceLinkCache,
  SectionCache,
  TagCache,
} from "obsidian";
import YAML from "yaml";
import { splitAlias } from "./links";

export interface FrontMatterInfo {
  exists: boolean;
  frontmatter: string;
  from: number;
  to: number;
  contentStart: number;
}

/** Locate the YAML block at the very top of a note. */
export function getFrontMatterInfo(content: string): FrontMatterInfo {
  const none = { exists: false, frontmatter: "", from: 0, to: 0, contentStart: 0 };
  if (!/^---\r?\n/.test(content) && content !== "---") return none;
  const first = content.indexOf("\n") + 1;
  const re = /^(---|\.\.\.)[ \t]*(\r?\n|$)/gm;
  re.lastIndex = first;
  // The closing fence may come right away (empty frontmatter).
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    if (m.index < first) continue;
    const to = m.index;
    return {
      exists: true,
      frontmatter: content.slice(first, to),
      from: first,
      to,
      contentStart: m.index + m[0].length,
    };
  }
  return none;
}

export function parseYaml(src: string): any {
  const doc = YAML.parseDocument(src, { uniqueKeys: false, prettyErrors: false } as any);
  if (doc.errors.length) throw doc.errors[0];
  return doc.toJS();
}

export function stringifyYaml(obj: any): string {
  return YAML.stringify(obj, { lineWidth: 0, defaultStringType: "PLAIN", defaultKeyType: "PLAIN" } as any);
}

const RE_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const RE_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RE_HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const RE_SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const RE_LIST = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const RE_TASK = /^\[(.)\][ \t]/;
const RE_QUOTE = /^ {0,3}>/;
const RE_CALLOUT = /^ {0,3}>[ \t]*\[![^\]]+\]/;
const RE_FOOTDEF = /^\[\^([^\]\s]+)\]:[ \t]?/;
const RE_REFDEF = /^ {0,3}\[([^\]^][^\]]*)\]:[ \t]*(\S+)/;
const RE_TABLE_DELIM = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const RE_HTML = /^ {0,3}<(?:[a-zA-Z][a-zA-Z0-9-]*|!--|\/[a-zA-Z])/;
const RE_BLOCKID_EOL = /(?:^|\s)\^([A-Za-z0-9-]+)[ \t]*$/;
const RE_BLOCKID_LINE = /^\^([A-Za-z0-9-]+)[ \t]*$/;
// Tag body: letters/numbers in any script, _, -, / ; must contain one non-digit.
const RE_TAG = /(^|[\s(\[{,;])#([\p{L}\p{N}\p{M}_\-\/·’]+)/gu;

function indentWidth(ws: string): number {
  let w = 0;
  for (const c of ws) w += c === "\t" ? 4 : 1;
  return w;
}

export function parseMetadata(text: string): CachedMetadata {
  const lines = text.split("\n");
  const starts: number[] = new Array(lines.length);
  {
    let off = 0;
    for (let i = 0; i < lines.length; i++) {
      starts[i] = off;
      off += lines[i].length + 1;
      if (lines[i].endsWith("\r")) lines[i] = lines[i].slice(0, -1);
    }
  }
  const loc = (line: number, col: number): Loc => ({ line, col, offset: starts[line] + col });
  const pos = (l1: number, c1: number, l2: number, c2: number): Pos => ({ start: loc(l1, c1), end: loc(l2, c2) });

  const cache: CachedMetadata = {};
  const links: LinkCache[] = [];
  const embeds: EmbedCache[] = [];
  const tags: TagCache[] = [];
  const headings: HeadingCache[] = [];
  const sections: SectionCache[] = [];
  const listItems: ListItemCache[] = [];
  const footnotes: FootnoteCache[] = [];
  const footnoteRefs: FootnoteRefCache[] = [];
  const referenceLinks: ReferenceLinkCache[] = [];
  const blocks: Record<string, { id: string; position: Pos }> = {};

  let i = 0;
  // ---- frontmatter ----
  if (lines[0] === "---" || lines[0]?.trimEnd() === "---") {
    let j = 1;
    while (j < lines.length && !/^(---|\.\.\.)[ \t]*$/.test(lines[j])) j++;
    if (j < lines.length) {
      const p = pos(0, 0, j, lines[j].length);
      cache.frontmatterPosition = p;
      sections.push({ type: "yaml", position: p });
      const src = lines.slice(1, j).join("\n");
      try {
        const fm = src.trim() ? parseYaml(src) : {};
        if (fm && typeof fm === "object" && !Array.isArray(fm)) {
          cache.frontmatter = fm;
          const fml = frontmatterLinks(fm);
          if (fml.length) cache.frontmatterLinks = fml;
        }
      } catch {
        /* invalid YAML: Obsidian shows it as text and skips properties */
      }
      i = j + 1;
    }
  }

  // ---- blocks ----
  type Block = { type: string; start: number; end: number; fence?: string; list?: boolean };
  let cur: Block | null = null;
  const listStack: { indent: number; line: number; idx: number }[] = [];
  let listRoot = 0;
  let lastItem: ListItemCache | null = null;

  const flush = () => {
    if (!cur) return;
    const sec: SectionCache = { type: cur.type, position: pos(cur.start, 0, cur.end, lines[cur.end].length) };
    // Block id at the end of the last line of a paragraph / quote / callout / table.
    if (cur.type !== "list" && cur.type !== "code" && cur.type !== "heading" && cur.type !== "yaml") {
      const m = lines[cur.end].match(RE_BLOCKID_EOL);
      if (m) {
        sec.id = m[1];
        blocks[m[1]] = { id: m[1], position: sec.position };
      }
    }
    sections.push(sec);
    cur = null;
    listStack.length = 0;
    lastItem = null;
  };
  const start = (type: string, line: number) => {
    flush();
    cur = { type, start: line, end: line };
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    // Inside fenced code / math / comment blocks: only look for the closer.
    if (cur && (cur.type === "code" || cur.type === "math" || cur.type === "comment") && cur.fence) {
      cur.end = i;
      if (cur.type === "code") {
        const m = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
        if (m && m[1][0] === cur.fence[0] && m[1].length >= cur.fence.length) {
          cur.fence = undefined;
          flush();
        }
      } else if (line.includes(cur.fence)) {
        cur.fence = undefined;
        flush();
      }
      continue;
    }
    if (line.trim() === "") {
      // Lists continue over blank lines when the next non-blank line is indented or another item.
      if (cur && cur.type === "list") {
        let k = i + 1;
        while (k < lines.length && lines[k].trim() === "") k++;
        if (k < lines.length && (RE_LIST.test(lines[k]) || /^[ \t]+\S/.test(lines[k]))) continue;
      }
      flush();
      continue;
    }

    let m: RegExpMatchArray | null;
    if ((m = line.match(RE_FENCE)) && !(m[1][0] === "`" && m[2].includes("`"))) {
      if (!(cur && cur.type === "list" && /^[ \t]+/.test(line))) {
        start("code", i);
        cur!.fence = m[1];
        continue;
      }
    }
    if (/^ {0,3}\$\$/.test(line)) {
      start("math", i);
      const rest = line.trim().slice(2);
      if (!rest.includes("$$")) cur!.fence = "$$";
      else flush();
      continue;
    }
    if (/^ {0,3}%%/.test(line) && (cur === null || (cur as Block).type !== "paragraph")) {
      start("comment", i);
      const rest = line.trim().slice(2);
      if (!rest.includes("%%")) cur!.fence = "%%";
      else flush();
      continue;
    }
    if ((m = line.match(RE_SETEXT)) && cur && cur.type === "paragraph") {
      const level = m[1][0] === "=" ? 1 : 2;
      const text = lines.slice(cur.start, i).map((l) => l.trim()).join(" ");
      headings.push({ heading: text, level, position: pos(cur.start, 0, i, line.length) });
      cur.type = "heading";
      cur.end = i;
      flush();
      continue;
    }
    if ((m = line.match(RE_HEADING))) {
      start("heading", i);
      const text = (m[2] ?? "").trim();
      headings.push({ heading: text.replace(RE_BLOCKID_EOL, "").trim() || text, level: m[1].length, position: pos(i, 0, i, line.length) });
      scanInline(line, i);
      flush();
      continue;
    }
    if (RE_HR.test(line)) {
      start("thematicBreak", i);
      flush();
      continue;
    }
    if ((m = line.match(RE_BLOCKID_LINE)) && !cur) {
      // A standalone "^id" line names the block just above it.
      const prev = sections[sections.length - 1];
      if (prev) {
        prev.id = m[1];
        blocks[m[1]] = { id: m[1], position: prev.position };
      }
      continue;
    }
    if (RE_QUOTE.test(line)) {
      if (!cur || (cur.type !== "blockquote" && cur.type !== "callout")) start(RE_CALLOUT.test(line) ? "callout" : "blockquote", i);
      cur!.end = i;
      scanInline(line, i);
      continue;
    }
    if ((m = line.match(RE_FOOTDEF))) {
      start("footnoteDefinition", i);
      footnotes.push({ id: m[1], position: pos(i, 0, i, line.length) });
      scanInline(line, i, m[0].length);
      continue;
    }
    if ((m = line.match(RE_REFDEF)) && (!cur || cur.type !== "paragraph")) {
      referenceLinks.push({ id: m[1].toLowerCase(), link: m[2], position: pos(i, 0, i, line.length) } as any);
      continue;
    }
    const listM = line.match(RE_LIST);
    if (listM && (!cur || cur.type !== "paragraph" || listM[3] !== "")) {
      if (!cur || cur.type !== "list") {
        start("list", i);
        listRoot = i;
      }
      cur!.end = i;
      const indent = indentWidth(listM[1]);
      while (listStack.length && listStack[listStack.length - 1].indent >= indent) listStack.pop();
      const parent = listStack.length ? listStack[listStack.length - 1].line : 0;
      const after = line.slice(listM[0].length);
      const tm = after.match(RE_TASK);
      // Root items: negative first line of the list (Obsidian's convention; -1 when it starts at line 0).
      const item: ListItemCache = { parent: listStack.length ? parent : -listRoot || -1, position: pos(i, listM[1].length, i, line.length) };
      if (tm) item.task = tm[1];
      const bid = line.match(RE_BLOCKID_EOL);
      if (bid) {
        item.id = bid[1];
        blocks[bid[1]] = { id: bid[1], position: item.position };
      }
      listItems.push(item);
      listStack.push({ indent, line: i, idx: listItems.length - 1 });
      lastItem = item;
      scanInline(line, i, listM[0].length);
      continue;
    }
    if (cur && cur.type === "list" && lastItem) {
      // Continuation line of the last list item.
      cur.end = i;
      lastItem.position = { start: lastItem.position.start, end: loc(i, line.length) };
      const bid = line.match(RE_BLOCKID_EOL);
      if (bid) {
        lastItem.id = bid[1];
        blocks[bid[1]] = { id: bid[1], position: lastItem.position };
      }
      scanInline(line, i);
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && RE_TABLE_DELIM.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      start("table", i);
      scanInline(line, i);
      i++;
      cur!.end = i;
      while (i + 1 < lines.length && lines[i + 1].includes("|") && lines[i + 1].trim() !== "") {
        i++;
        cur!.end = i;
        scanInline(lines[i], i);
      }
      continue;
    }
    if (RE_HTML.test(line) && (!cur || cur.type !== "paragraph")) {
      start("html", i);
      continue;
    }
    if (cur && (cur.type === "paragraph" || cur.type === "blockquote" || cur.type === "callout" || cur.type === "footnoteDefinition" || cur.type === "html")) {
      cur.end = i;
    } else start("paragraph", i);
    scanInline(line, i);
  }
  flush();

  // ---- inline scanning ----
  function scanInline(raw: string, line: number, from = 0): void {
    // Mask inline code and %%comments%% (keep offsets by replacing with spaces).
    let s = raw.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (x) => " ".repeat(x.length));
    s = s.replace(/%%[\s\S]*?%%/g, (x) => " ".repeat(x.length));
    if (s.includes("%%")) s = s.slice(0, s.indexOf("%%"));
    let mm: RegExpExecArray | null;
    // Wikilinks and embeds.
    const reWiki = /(!?)\[\[([^\[\]]+?)\]\]/g;
    while ((mm = reWiki.exec(s))) {
      if (mm.index < from) continue;
      const original = mm[0];
      const { link, alias } = splitAlias(mm[2]);
      const ref = {
        link,
        original,
        displayText: alias ?? link,
        position: pos(line, mm.index, line, mm.index + original.length),
      };
      (mm[1] ? embeds : links).push(ref);
    }
    let masked = s.replace(/!?\[\[[^\[\]]+?\]\]/g, (x) => " ".repeat(x.length));
    // Markdown links to local files: [text](path.md) / ![alt](image.png).
    const reMd = /(!?)\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/g;
    while ((mm = reMd.exec(masked))) {
      let target = mm[3].replace(/^<|>$/g, "");
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#") && !mm[1]) {
        continue;
      }
      try {
        target = decodeURI(target);
      } catch {
        /* keep */
      }
      const ref = {
        link: target,
        original: mm[0],
        displayText: mm[2],
        position: pos(line, mm.index, line, mm.index + mm[0].length),
      };
      (mm[1] ? embeds : links).push(ref);
    }
    masked = masked.replace(/!?\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\(([^)]*)\)/g, (x, t) => "[" + t + "]" + " ".repeat(x.length - t.length - 2));
    masked = masked.replace(/<?\b[a-z][a-z0-9+.-]*:\/\/[^\s>]+>?/gi, (x) => " ".repeat(x.length));
    // Footnote refs.
    const reFn = /\[\^([^\]\s]+)\](?!:)/g;
    while ((mm = reFn.exec(masked))) footnoteRefs.push({ id: mm[1], position: pos(line, mm.index, line, mm.index + mm[0].length) });
    // Tags.
    RE_TAG.lastIndex = 0;
    while ((mm = RE_TAG.exec(masked))) {
      const body = mm[2];
      if (!/[^\d]/.test(body)) continue;
      const at = mm.index + mm[1].length;
      tags.push({ tag: "#" + body, position: pos(line, at, line, at + body.length + 1) });
    }
  }

  if (links.length) cache.links = links;
  if (embeds.length) cache.embeds = embeds;
  if (tags.length) cache.tags = tags;
  if (headings.length) cache.headings = headings;
  if (sections.length) cache.sections = sections.sort((a, b) => a.position.start.offset - b.position.start.offset);
  if (listItems.length) cache.listItems = listItems;
  if (footnotes.length) cache.footnotes = footnotes;
  if (footnoteRefs.length) (cache as any).footnoteRefs = footnoteRefs;
  if (referenceLinks.length) (cache as any).referenceLinks = referenceLinks;
  if (Object.keys(blocks).length) cache.blocks = blocks as any;
  return cache;
}

function frontmatterLinks(fm: Record<string, any>): FrontmatterLinkCache[] {
  const out: FrontmatterLinkCache[] = [];
  const visit = (key: string, v: any) => {
    if (typeof v === "string") {
      const re = /\[\[([^\[\]]+?)\]\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(v))) {
        const { link, alias } = splitAlias(m[1]);
        out.push({ key, link, original: m[0], displayText: alias ?? link });
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => visit(`${key}.${i}`, x));
    else if (v && typeof v === "object") for (const k of Object.keys(v)) visit(`${key}.${k}`, v[k]);
  };
  for (const k of Object.keys(fm)) visit(k, fm[k]);
  return out;
}

// ---- frontmatter helpers (obsidian API) ----

export function parseFrontMatterEntry(fm: any, key: string | RegExp): any {
  if (!fm) return null;
  if (typeof key === "string") return fm[key] ?? null;
  for (const k of Object.keys(fm)) if (key.test(k)) return fm[k];
  return null;
}

export function parseFrontMatterStringArray(fm: any, key: string | RegExp, nospaces = false): string[] | null {
  let v = parseFrontMatterEntry(fm, key);
  if (v == null) return null;
  if (typeof v === "string") v = nospaces ? v.split(/[\s,]+/) : v.split(",");
  if (!Array.isArray(v)) v = [v];
  const out = v.filter((x: any) => x != null && x !== "").map((x: any) => String(x).trim()).filter(Boolean);
  return out.length ? out : null;
}

export function parseFrontMatterTags(fm: any): string[] | null {
  const raw = parseFrontMatterStringArray(fm, /^tags?$/i, true);
  return raw ? raw.map((t) => (t.startsWith("#") ? t : "#" + t)) : null;
}

export function parseFrontMatterAliases(fm: any): string[] | null {
  return parseFrontMatterStringArray(fm, /^alias(es)?$/i);
}

export function getAllTags(cache: CachedMetadata): string[] | null {
  const out: string[] = [];
  const fmTags = parseFrontMatterTags(cache.frontmatter);
  if (fmTags) out.push(...fmTags);
  if (cache.tags) for (const t of cache.tags) out.push(t.tag);
  return out.length ? out : null;
}
