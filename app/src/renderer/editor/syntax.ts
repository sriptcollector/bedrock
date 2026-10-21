// Lezer Markdown extensions for Obsidian syntax in the editor: frontmatter, [[wikilinks]],
// ![[embeds]], ==highlight==, #tags, %%comments%%, $inline math$ and $$block math$$.
// Plus the highlighters that put Obsidian-compatible `cm-*` classes on the text.
import { markdown, commonmarkLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting } from "@codemirror/language";
import { GFM, type MarkdownConfig, type InlineContext, type BlockContext, type Line } from "@lezer/markdown";
import { Tag, tags, tagHighlighter, styleTags } from "@lezer/highlight";

export const obsidianTags = {
  wikilink: Tag.define(),
  embed: Tag.define(),
  linkMark: Tag.define(),
  highlight: Tag.define(),
  highlightMark: Tag.define(),
  hashtag: Tag.define(),
  comment: Tag.define(),
  math: Tag.define(),
  frontmatter: Tag.define(),
  footref: Tag.define(),
};

const HighlightDelim = { resolve: "Highlight", mark: "HighlightMark" };
const PUNCT = /[!"#$%&'()*+,\-.\/:;<=>?@\[\\\]^_`{|}~\xA1‐-‧]/;
const TAG_BODY = /^#([\p{L}\p{N}\p{M}_\-\/·’]+)/u;

export const ObsidianSyntax: MarkdownConfig = {
  defineNodes: [
    { name: "Frontmatter", block: true },
    { name: "WikiLink" },
    { name: "Embed" },
    { name: "WikiLinkMark" },
    { name: "Highlight" },
    { name: "HighlightMark" },
    { name: "Hashtag" },
    { name: "Comment" },
    { name: "CommentBlock", block: true },
    { name: "InlineMath" },
    { name: "BlockMath", block: true },
    { name: "FootnoteReference" },
    { name: "FootnoteDefinition", block: true },
    { name: "FootnoteMark" },
    { name: "FootnoteLabel" },
  ],
  props: [
    styleTags({
      Frontmatter: obsidianTags.frontmatter,
      "WikiLink/...": obsidianTags.wikilink,
      "Embed/...": obsidianTags.embed,
      WikiLinkMark: obsidianTags.linkMark,
      "Highlight/...": obsidianTags.highlight,
      HighlightMark: obsidianTags.highlightMark,
      Hashtag: obsidianTags.hashtag,
      "Comment CommentBlock": obsidianTags.comment,
      "InlineMath BlockMath": obsidianTags.math,
      "FootnoteReference/...": obsidianTags.footref,
      FootnoteMark: obsidianTags.linkMark,
    }),
  ],
  parseBlock: [
    {
      // [^label]: text — claimed before link reference definitions.
      name: "FootnoteDefinition",
      before: "LinkReference",
      leaf(_cx: BlockContext, leaf: any) {
        const m = /^\[\^([^\]\s]+)\]:[ \t]?/.exec(leaf.content);
        if (!m) return null;
        return {
          nextLine: () => false,
          finish(cx: BlockContext, lf: any) {
            const s = lf.start;
            const label = m[1];
            const markEnd = s + 2 + label.length + 2;
            const children = [cx.elt("FootnoteMark", s, s + 2), cx.elt("FootnoteLabel", s + 2, s + 2 + label.length), cx.elt("FootnoteMark", s + 2 + label.length, markEnd)];
            const rest = lf.content.slice(m[0].length);
            children.push(...cx.parser.parseInline(rest, s + m[0].length));
            cx.addLeafElement(lf, cx.elt("FootnoteDefinition", s, s + lf.content.length, children));
            return true;
          },
        };
      },
    } as any,
    {
      name: "Frontmatter",
      before: "HorizontalRule",
      parse(cx: BlockContext, line: Line): boolean {
        if (cx.lineStart !== 0 || line.text.trimEnd() !== "---") return false;
        const start = cx.lineStart;
        while (cx.nextLine()) {
          if (/^(---|\.\.\.)\s*$/.test(line.text)) {
            const end = cx.lineStart + line.text.length;
            cx.nextLine();
            cx.addElement(cx.elt("Frontmatter", start, end));
            return true;
          }
        }
        // Unclosed: not frontmatter. Can't rewind, so mark what we consumed.
        cx.addElement(cx.elt("Frontmatter", start, cx.lineStart));
        return true;
      },
    },
    {
      name: "BlockMath",
      before: "FencedCode",
      parse(cx: BlockContext, line: Line): boolean {
        if (!/^\s{0,3}\$\$/.test(line.text)) return false;
        const start = cx.lineStart;
        const rest = line.text.slice(line.text.indexOf("$$") + 2);
        if (rest.includes("$$")) {
          const end = cx.lineStart + line.text.length;
          cx.nextLine();
          cx.addElement(cx.elt("BlockMath", start, end));
          return true;
        }
        while (cx.nextLine()) {
          if (line.text.includes("$$")) {
            const end = cx.lineStart + line.text.length;
            cx.nextLine();
            cx.addElement(cx.elt("BlockMath", start, end));
            return true;
          }
        }
        cx.addElement(cx.elt("BlockMath", start, cx.lineStart));
        return true;
      },
    },
    {
      name: "CommentBlock",
      before: "FencedCode",
      parse(cx: BlockContext, line: Line): boolean {
        if (!/^\s{0,3}%%/.test(line.text)) return false;
        const start = cx.lineStart;
        const rest = line.text.slice(line.text.indexOf("%%") + 2);
        if (rest.includes("%%")) {
          if (rest.slice(rest.indexOf("%%") + 2).trim()) return false;
          const end = cx.lineStart + line.text.length;
          cx.nextLine();
          cx.addElement(cx.elt("CommentBlock", start, end));
          return true;
        }
        while (cx.nextLine()) {
          if (line.text.includes("%%")) {
            const end = cx.lineStart + line.text.length;
            cx.nextLine();
            cx.addElement(cx.elt("CommentBlock", start, end));
            return true;
          }
        }
        cx.addElement(cx.elt("CommentBlock", start, cx.lineStart));
        return true;
      },
    },
  ],
  parseInline: [
    {
      name: "FootnoteReference",
      before: "Link",
      parse(cx: InlineContext, next: number, pos: number): number {
        if (next !== 91 /* [ */ || cx.char(pos + 1) !== 94 /* ^ */) return -1;
        const rest = cx.slice(pos + 2, Math.min(cx.end, pos + 200));
        const m = /^([^\]\s]+)\]/.exec(rest);
        if (!m) return -1;
        const end = pos + 2 + m[0].length;
        return cx.addElement(cx.elt("FootnoteReference", pos, end, [cx.elt("FootnoteMark", pos, pos + 2), cx.elt("FootnoteLabel", pos + 2, end - 1), cx.elt("FootnoteMark", end - 1, end)]));
      },
    },
    {
      name: "WikiLink",
      before: "Link",
      parse(cx: InlineContext, next: number, pos: number): number {
        let p = pos;
        const embed = next === 33; /* ! */
        if (embed) p++;
        if (cx.char(p) !== 91 || cx.char(p + 1) !== 91) return -1;
        const rest = cx.slice(p + 2, cx.end);
        const close = rest.indexOf("]]");
        if (close <= 0) return -1;
        const inner = rest.slice(0, close);
        if (inner.includes("[[") || inner.includes("\n")) return -1;
        const end = p + 2 + close + 2;
        return cx.addElement(cx.elt(embed ? "Embed" : "WikiLink", pos, end, [cx.elt("WikiLinkMark", pos, p + 2), cx.elt("WikiLinkMark", end - 2, end)]));
      },
    },
    {
      name: "Comment",
      before: "Emphasis",
      parse(cx: InlineContext, next: number, pos: number): number {
        if (next !== 37 || cx.char(pos + 1) !== 37) return -1;
        const rest = cx.slice(pos + 2, cx.end);
        const close = rest.indexOf("%%");
        const end = close < 0 ? cx.end : pos + 2 + close + 2;
        return cx.addElement(cx.elt("Comment", pos, end));
      },
    },
    {
      name: "InlineMath",
      before: "Emphasis",
      parse(cx: InlineContext, next: number, pos: number): number {
        if (next !== 36) return -1;
        if (cx.char(pos + 1) === 36) {
          const rest = cx.slice(pos + 2, cx.end);
          const close = rest.indexOf("$$");
          if (close < 0) return -1;
          return cx.addElement(cx.elt("InlineMath", pos, pos + 2 + close + 2));
        }
        const after = cx.slice(pos + 1, pos + 2);
        if (!after || /\s/.test(after)) return -1;
        const rest = cx.slice(pos + 1, cx.end);
        let i = 0;
        while ((i = rest.indexOf("$", i)) >= 0) {
          if (rest[i - 1] !== "\\" && !/\s/.test(rest[i - 1] ?? " ")) break;
          i++;
        }
        if (i <= 0) return -1;
        if (/\d/.test(rest[i + 1] ?? "")) return -1;
        return cx.addElement(cx.elt("InlineMath", pos, pos + 1 + i + 1));
      },
    },
    {
      name: "Highlight",
      before: "Emphasis",
      parse(cx: InlineContext, next: number, pos: number): number {
        if (next !== 61 || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const sBefore = /\s|^$/.test(before);
        const sAfter = /\s|^$/.test(after);
        const pBefore = PUNCT.test(before);
        const pAfter = PUNCT.test(after);
        return cx.addDelimiter(HighlightDelim, pos, pos + 2, !sAfter && (!pAfter || sBefore || pBefore), !sBefore && (!pBefore || sAfter || pAfter));
      },
    },
    {
      name: "Hashtag",
      before: "Emphasis",
      parse(cx: InlineContext, next: number, pos: number): number {
        if (next !== 35) return -1;
        const prev = pos > cx.offset ? cx.slice(pos - 1, pos) : " ";
        if (!/[\s(\[{,;]/.test(prev)) return -1;
        const m = cx.slice(pos, Math.min(cx.end, pos + 200)).match(TAG_BODY);
        if (!m || !/[^\d]/.test(m[1])) return -1;
        return cx.addElement(cx.elt("Hashtag", pos, pos + m[0].length));
      },
    },
  ],
};

/** The markdown language used by the editor (CommonMark + GFM + Obsidian syntax, nested code). */
export function markdownSupport() {
  return markdown({ base: commonmarkLanguage, codeLanguages: languages, extensions: [GFM, ObsidianSyntax], addKeymap: false });
}

/** Classes for markdown structure (names follow Obsidian's editor so themes apply). */
export const markdownHighlighter = tagHighlighter([
  { tag: tags.heading1, class: "cm-header cm-header-1" },
  { tag: tags.heading2, class: "cm-header cm-header-2" },
  { tag: tags.heading3, class: "cm-header cm-header-3" },
  { tag: tags.heading4, class: "cm-header cm-header-4" },
  { tag: tags.heading5, class: "cm-header cm-header-5" },
  { tag: tags.heading6, class: "cm-header cm-header-6" },
  { tag: tags.strong, class: "cm-strong" },
  { tag: tags.emphasis, class: "cm-em" },
  { tag: tags.strikethrough, class: "cm-strikethrough" },
  { tag: tags.link, class: "cm-link" },
  { tag: tags.url, class: "cm-url" },
  { tag: tags.quote, class: "cm-quote" },
  { tag: tags.monospace, class: "cm-inline-code" },
  { tag: tags.processingInstruction, class: "cm-formatting" },
  { tag: tags.contentSeparator, class: "cm-hr" },
  { tag: tags.list, class: "cm-list" },
  { tag: obsidianTags.wikilink, class: "cm-hmd-internal-link" },
  { tag: obsidianTags.embed, class: "cm-hmd-internal-link cm-hmd-embed" },
  { tag: obsidianTags.linkMark, class: "cm-formatting cm-formatting-link" },
  { tag: obsidianTags.highlight, class: "cm-highlight" },
  { tag: obsidianTags.highlightMark, class: "cm-formatting cm-formatting-highlight" },
  { tag: obsidianTags.hashtag, class: "cm-hashtag" },
  { tag: obsidianTags.comment, class: "cm-comment" },
  { tag: obsidianTags.math, class: "cm-math" },
  { tag: obsidianTags.frontmatter, class: "cm-hmd-frontmatter" },
  { tag: obsidianTags.footref, class: "cm-footref cm-hmd-barelink" },
]);

/** Classes for code inside fenced blocks (CodeMirror 5-style names, as Obsidian themes expect). */
export const codeHighlighter = tagHighlighter([
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.modifier], class: "cm-keyword" },
  { tag: [tags.string, tags.special(tags.string), tags.character, tags.docString], class: "cm-string" },
  { tag: tags.regexp, class: "cm-string-2" },
  { tag: [tags.lineComment, tags.blockComment, tags.docComment], class: "cm-comment" },
  { tag: [tags.number, tags.integer, tags.float], class: "cm-number" },
  { tag: [tags.bool, tags.null, tags.atom], class: "cm-atom" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: "cm-def" },
  { tag: tags.definition(tags.variableName), class: "cm-def" },
  { tag: tags.variableName, class: "cm-variable" },
  { tag: [tags.className, tags.typeName, tags.namespace], class: "cm-type" },
  { tag: [tags.propertyName, tags.attributeName], class: "cm-property" },
  { tag: tags.tagName, class: "cm-tag" },
  { tag: [tags.operator, tags.arithmeticOperator, tags.logicOperator, tags.compareOperator], class: "cm-operator" },
  { tag: [tags.bracket, tags.paren, tags.brace, tags.squareBracket], class: "cm-bracket" },
  { tag: tags.meta, class: "cm-meta" },
  { tag: tags.self, class: "cm-builtin" },
]);

export const syntaxHighlightExtensions = [syntaxHighlighting(markdownHighlighter), syntaxHighlighting(codeHighlighter)];
