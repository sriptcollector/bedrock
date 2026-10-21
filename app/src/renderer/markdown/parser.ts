// markdown-it configured for Obsidian-flavoured Markdown: CommonMark + GFM (tables, strikethrough,
// task lists, autolinks) + wikilinks/embeds with aliases, headings and blocks, ==highlights==,
// %%comments%%, #tags, $math$/$$math$$ (KaTeX), footnotes (incl. inline ^[...]), callouts
// (> [!type]± title, foldable), mermaid fences, and `data-line` source positions on blocks.
import MarkdownItCtor, { type MarkdownIt, type StateInline, type StateBlock, type StateCore, type Token } from "markdown-it";
// @ts-ignore no types
import footnote from "markdown-it-footnote";
import katex from "katex";
import { splitAlias } from "../../core/links";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderMathToString(src: string, display: boolean): string {
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: false, output: "htmlAndMathml", trust: false, strict: "ignore" });
  } catch (e: any) {
    return `<span class="math-error">${escapeHtml(src)}</span>`;
  }
}

// ---------- inline rules ----------
function wikilinkRule(state: StateInline, silent: boolean): boolean {
  const s = state.src;
  let p = state.pos;
  const embed = s.charCodeAt(p) === 0x21; /* ! */
  if (embed) p++;
  if (s.charCodeAt(p) !== 0x5b || s.charCodeAt(p + 1) !== 0x5b) return false;
  const end = s.indexOf("]]", p + 2);
  if (end < 0) return false;
  const inner = s.slice(p + 2, end);
  if (!inner.trim() || inner.includes("\n") || inner.includes("[[")) return false;
  if (!silent) {
    const { link, alias } = splitAlias(inner);
    const t = state.push(embed ? "obsidian_embed" : "obsidian_link", "", 0);
    t.meta = { link, alias, original: s.slice(state.pos, end + 2) };
  }
  state.pos = end + 2;
  return true;
}

function highlightRule(state: StateInline, silent: boolean): boolean {
  const s = state.src;
  const start = state.pos;
  if (s.charCodeAt(start) !== 0x3d || s.charCodeAt(start + 1) !== 0x3d) return false;
  if (s.charCodeAt(start + 2) === 0x3d) return false;
  const end = s.indexOf("==", start + 2);
  if (end < 0 || end === start + 2) return false;
  if (/\s/.test(s[start + 2]) && /\s/.test(s[end - 1])) return false;
  if (!silent) {
    state.push("mark_open", "mark", 1);
    const oldMax = state.posMax;
    state.pos = start + 2;
    state.posMax = end;
    state.md.inline.tokenize(state);
    state.posMax = oldMax;
    state.push("mark_close", "mark", -1);
  }
  state.pos = end + 2;
  return true;
}

function commentInlineRule(state: StateInline, silent: boolean): boolean {
  const s = state.src;
  const start = state.pos;
  if (s.charCodeAt(start) !== 0x25 || s.charCodeAt(start + 1) !== 0x25) return false;
  const end = s.indexOf("%%", start + 2);
  const stop = end < 0 ? s.length : end + 2;
  if (!silent) {
    const t = state.push("obsidian_comment", "", 0);
    t.content = s.slice(start + 2, end < 0 ? s.length : end);
  }
  state.pos = stop;
  return true;
}

const TAG_RE = /^#([\p{L}\p{N}\p{M}_\-\/·’]+)/u;
function tagRule(state: StateInline, silent: boolean): boolean {
  const s = state.src;
  const start = state.pos;
  if (s.charCodeAt(start) !== 0x23) return false;
  const prev = start > 0 ? s[start - 1] : " ";
  if (!/[\s(\[{,;]/.test(prev) && start !== 0) return false;
  const m = s.slice(start).match(TAG_RE);
  if (!m || !/[^\d]/.test(m[1])) return false;
  if (!silent) {
    const t = state.push("obsidian_tag", "", 0);
    t.content = m[1];
  }
  state.pos = start + m[0].length;
  return true;
}

function mathInlineRule(state: StateInline, silent: boolean): boolean {
  const s = state.src;
  const start = state.pos;
  if (s.charCodeAt(start) !== 0x24 /* $ */) return false;
  if (s.charCodeAt(start + 1) === 0x24) {
    // $$...$$ inline (display math inside a paragraph)
    const end = s.indexOf("$$", start + 2);
    if (end < 0) return false;
    if (!silent) {
      const t = state.push("math_block_inline", "", 0);
      t.content = s.slice(start + 2, end);
    }
    state.pos = end + 2;
    return true;
  }
  const next = s[start + 1];
  if (!next || /\s/.test(next)) return false;
  let end = start + 1;
  while ((end = s.indexOf("$", end)) >= 0) {
    if (s[end - 1] !== "\\" && !/\s/.test(s[end - 1])) break;
    end++;
  }
  if (end < 0 || end === start + 1) return false;
  if (/\d/.test(s[end + 1] ?? "")) return false;
  if (!silent) {
    const t = state.push("math_inline", "", 0);
    t.content = s.slice(start + 1, end);
  }
  state.pos = end + 1;
  return true;
}

// ---------- block rules ----------
function mathBlockRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  let max = state.eMarks[startLine];
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  if (state.src.slice(pos, pos + 2) !== "$$") return false;
  const firstLine = state.src.slice(pos + 2, max);
  if (silent) return true;
  let content = "";
  let line = startLine;
  if (firstLine.trim().endsWith("$$") && firstLine.trim().length >= 2) {
    content = firstLine.trim().slice(0, -2);
  } else {
    content = firstLine + "\n";
    line++;
    for (; line < endLine; line++) {
      pos = state.bMarks[line] + state.tShift[line];
      max = state.eMarks[line];
      const text = state.src.slice(pos, max);
      const i = text.indexOf("$$");
      if (i >= 0) {
        content += text.slice(0, i);
        break;
      }
      content += state.src.slice(state.bMarks[line], max) + "\n";
    }
  }
  const t = state.push("math_block", "div", 0);
  t.block = true;
  t.content = content;
  t.map = [startLine, line + 1];
  state.line = line + 1;
  return true;
}

function commentBlockRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const pos = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  if (state.src.slice(pos, pos + 2) !== "%%") return false;
  const rest = state.src.slice(pos + 2, max);
  if (rest.includes("%%")) {
    // single-line comment block: only if nothing follows the closing %%
    if (rest.slice(rest.indexOf("%%") + 2).trim()) return false;
    if (silent) return true;
    state.line = startLine + 1;
    const t = state.push("obsidian_comment_block", "", 0);
    t.map = [startLine, startLine + 1];
    return true;
  }
  if (silent) return true;
  let line = startLine + 1;
  for (; line < endLine; line++) {
    const text = state.src.slice(state.bMarks[line], state.eMarks[line]);
    if (text.includes("%%")) break;
  }
  state.line = Math.min(line + 1, endLine);
  const t = state.push("obsidian_comment_block", "", 0);
  t.map = [startLine, state.line];
  return true;
}

// ---------- core rules ----------
const CALLOUT_RE = /^\[!([^\]\s]+)\]([+-]?)(?:[ \t]+(.*))?$/;

function calloutRule(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "blockquote_open") continue;
    const p = tokens[i + 1];
    const inline = tokens[i + 2];
    if (!p || p.type !== "paragraph_open" || !inline || inline.type !== "inline") continue;
    const firstNl = inline.content.indexOf("\n");
    const first = firstNl < 0 ? inline.content : inline.content.slice(0, firstNl);
    const m = first.trim().match(CALLOUT_RE);
    if (!m) continue;
    const [typeAndMeta] = [m[1]];
    const [type, ...meta] = typeAndMeta.split("|");
    const fold = m[2] || "";
    const title = (m[3] ?? "").trim();
    t.meta = { callout: type.toLowerCase(), metadata: meta.join("|"), fold, title, rawTitle: !title };
    // Remove the [!type] line from the first paragraph.
    const restText = firstNl < 0 ? "" : inline.content.slice(firstNl + 1);
    inline.content = restText;
    inline.children = [];
    state.md.inline.parse(restText, state.md, state.env, inline.children);
    if (!restText.trim()) {
      p.hidden = true;
      tokens[i + 3].hidden = true;
      inline.content = "";
      inline.children = [];
      p.meta = { emptyCalloutPara: true };
    }
    // Mark the matching close.
    let depth = 0;
    for (let j = i; j < tokens.length; j++) {
      if (tokens[j].type === "blockquote_open") depth++;
      else if (tokens[j].type === "blockquote_close" && --depth === 0) {
        tokens[j].meta = { callout: true };
        break;
      }
    }
  }
}

function taskListRule(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i];
    if (inline.type !== "inline" || tokens[i - 1].type !== "paragraph_open" || tokens[i - 2].type !== "list_item_open") continue;
    const m = inline.content.match(/^\[(.)\][ \t]/) ?? inline.content.match(/^\[(.)\]$/);
    if (!m) continue;
    const li = tokens[i - 2];
    const ch = m[1];
    li.attrJoin("class", "task-list-item" + (ch !== " " ? " is-checked" : ""));
    li.attrSet("data-task", ch);
    li.meta = { ...(li.meta ?? {}), task: ch };
    const first = inline.children?.[0];
    if (first && first.type === "text") first.content = first.content.replace(/^\[(.)\][ \t]?/, "");
    const cb = new state.Token("task_checkbox", "input", 0);
    cb.meta = { checked: ch !== " ", line: li.map ? li.map[0] : -1 };
    inline.children?.unshift(cb);
    // mark the parent list
    for (let j = i - 3; j >= 0; j--) {
      if (tokens[j].type === "bullet_list_open" || tokens[j].type === "ordered_list_open") {
        if (tokens[j].level === li.level - 1) {
          tokens[j].attrJoin("class", "contains-task-list");
          break;
        }
      }
    }
  }
}

function lineNumbersRule(state: StateCore): void {
  const off = (state.env as any)?.lineOffset ?? 0;
  for (const t of state.tokens) {
    if (t.map && t.nesting >= 0 && t.type !== "inline") t.attrSet("data-line", String(t.map[0] + off));
  }
}

function headingDataRule(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === "heading_open") {
      const inline = tokens[i + 1];
      const text = inline?.content ?? "";
      tokens[i].attrSet("data-heading", text.replace(/\s*\^[A-Za-z0-9-]+\s*$/, ""));
      tokens[i].attrSet("dir", "auto");
    }
  }
}

function blockIdRule(state: StateCore): void {
  // Hide trailing " ^block-id" markers in rendered text (they stay in the source).
  for (const t of state.tokens) {
    if (t.type !== "inline" || !t.children?.length) continue;
    const last = t.children[t.children.length - 1];
    if (last.type === "text") {
      const m = last.content.match(/(^|\s)\^([A-Za-z0-9-]+)\s*$/);
      if (m) {
        last.content = last.content.slice(0, last.content.length - m[0].length + m[1].length).replace(/\s+$/, "");
      }
    }
  }
}

// ---------- renderer ----------
export interface ParserOptions {
  strictLineBreaks?: boolean;
}

export function createMarkdownIt(opts: ParserOptions = {}): MarkdownIt {
  const md = new (MarkdownItCtor as any)({ html: true, linkify: true, breaks: !opts.strictLineBreaks, typographer: false });
  md.use(footnote);
  md.inline.ruler.before("link", "obsidian_wikilink", wikilinkRule);
  md.inline.ruler.before("emphasis", "obsidian_highlight", highlightRule);
  md.inline.ruler.before("obsidian_wikilink", "obsidian_comment", commentInlineRule);
  md.inline.ruler.after("obsidian_highlight", "obsidian_tag", tagRule);
  md.inline.ruler.after("escape", "math_inline", mathInlineRule);
  md.block.ruler.before("fence", "math_block", mathBlockRule, { alt: ["paragraph", "reference", "blockquote", "list"] });
  md.block.ruler.before("math_block", "obsidian_comment_block", commentBlockRule, { alt: ["paragraph", "reference", "blockquote", "list"] });
  md.core.ruler.after("inline", "obsidian_callout", calloutRule);
  md.core.ruler.after("obsidian_callout", "task_list", taskListRule);
  md.core.ruler.after("task_list", "block_ids", blockIdRule);
  md.core.ruler.push("heading_data", headingDataRule);
  md.core.ruler.push("line_numbers", lineNumbersRule);

  const r = md.renderer.rules;
  r.obsidian_link = (tokens, idx) => {
    const { link, alias } = tokens[idx].meta;
    const display = alias ?? link.replace(/#\^?/g, (m: string) => (m === "#" ? " > " : " > ^")).replace(/^ > /, "");
    return `<a data-href="${escapeHtml(link)}" href="${escapeHtml(link)}" class="internal-link" target="_blank" rel="noopener nofollow">${escapeHtml(display)}</a>`;
  };
  r.obsidian_embed = (tokens, idx) => {
    const { link, alias } = tokens[idx].meta;
    return `<span alt="${escapeHtml(alias ?? link.replace("#", " > "))}" src="${escapeHtml(link)}" class="internal-embed" tabindex="-1"></span>`;
  };
  r.obsidian_tag = (tokens, idx) => {
    const tag = tokens[idx].content;
    return `<a href="#${escapeHtml(tag)}" class="tag" target="_blank" rel="noopener nofollow">#${escapeHtml(tag)}</a>`;
  };
  r.obsidian_comment = () => "";
  r.obsidian_comment_block = () => "";
  r.mark_open = () => "<mark>";
  r.mark_close = () => "</mark>";
  r.math_inline = (tokens, idx) => `<span class="math math-inline is-loaded">${renderMathToString(tokens[idx].content, false)}</span>`;
  r.math_block_inline = (tokens, idx) => `<span class="math math-block is-loaded">${renderMathToString(tokens[idx].content, true)}</span>`;
  r.math_block = (tokens, idx) => `<div class="math math-block is-loaded" data-line="${tokens[idx].attrGet("data-line") ?? ""}">${renderMathToString(tokens[idx].content, true)}</div>\n`;
  r.task_checkbox = (tokens, idx) =>
    `<input data-line="${tokens[idx].meta.line}" type="checkbox" class="task-list-item-checkbox"${tokens[idx].meta.checked ? " checked" : ""}>`;

  const defaultBqOpen = r.blockquote_open ?? ((tokens: Token[], idx: number, o: any, _e: any, self: any) => self.renderToken(tokens, idx, o));
  const defaultBqClose = r.blockquote_close ?? ((tokens: Token[], idx: number, o: any, _e: any, self: any) => self.renderToken(tokens, idx, o));
  r.blockquote_open = (tokens, idx, o, e, self) => {
    const t = tokens[idx];
    if (!t.meta?.callout) return defaultBqOpen(tokens, idx, o, e, self);
    const { callout, metadata, fold, title } = t.meta;
    const displayTitle = title ? md.renderInline(title, {}) : escapeHtml(callout.charAt(0).toUpperCase() + callout.slice(1));
    const collapsed = fold === "-";
    const line = t.attrGet("data-line") ?? "";
    return (
      `<div data-callout-metadata="${escapeHtml(metadata)}" data-callout-fold="${fold}" data-callout="${escapeHtml(callout)}" data-line="${line}" class="callout${fold ? " is-collapsible" : ""}${collapsed ? " is-collapsed" : ""}">` +
      `<div class="callout-title" dir="auto"><div class="callout-icon"></div><div class="callout-title-inner">${displayTitle}</div>` +
      (fold ? `<div class="callout-fold${collapsed ? " is-collapsed" : ""}"></div>` : "") +
      `</div><div class="callout-content"${collapsed ? ' style="display: none;"' : ""}>`
    );
  };
  r.blockquote_close = (tokens, idx, o, e, self) => (tokens[idx].meta?.callout ? "</div></div>\n" : defaultBqClose(tokens, idx, o, e, self));

  const defaultFence = r.fence!;
  r.fence = (tokens, idx, o, e, self) => {
    const t = tokens[idx];
    const lang = (t.info || "").trim().split(/\s+/)[0];
    const line = t.attrGet("data-line") ?? "";
    if (lang === "mermaid" && (e as any)?.mermaid !== false) return `<div class="mermaid-pending" data-line="${line}" data-source="${escapeHtml(t.content)}"></div>\n`;
    const procs: Record<string, any> = (e as any)?.codeBlockProcessors ?? {};
    if (lang && procs[lang]) return `<div class="block-language-${escapeHtml(lang)}" data-line="${line}" data-codeblock-lang="${escapeHtml(lang)}" data-source="${escapeHtml(t.content)}"></div>\n`;
    const html = defaultFence(tokens, idx, o, e, self);
    return html.replace("<pre>", `<pre class="language-${escapeHtml(lang || "plaintext")}" data-line="${line}">`).replace('<code class="language-', '<code class="is-loaded language-');
  };

  // External links open in the browser; relative links to vault files become internal links.
  const defaultLinkOpen = r.link_open ?? ((tokens: Token[], idx: number, o: any, _e: any, self: any) => self.renderToken(tokens, idx, o));
  r.link_open = (tokens, idx, o, e, self) => {
    const t = tokens[idx];
    const href = t.attrGet("href") ?? "";
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      t.attrJoin("class", "external-link");
      t.attrSet("target", "_blank");
      t.attrSet("rel", "noopener nofollow");
    } else {
      let target = href;
      try {
        target = decodeURI(href);
      } catch {
        /* keep */
      }
      t.attrSet("data-href", target);
      t.attrJoin("class", "internal-link");
      t.attrSet("target", "_blank");
      t.attrSet("rel", "noopener nofollow");
    }
    return defaultLinkOpen(tokens, idx, o, e, self);
  };

  // ![alt|200x100](path) sizing; local images are resolved to vault files later.
  r.image = (tokens, idx, o, e, self) => {
    const t = tokens[idx];
    const alt = self.renderInlineAsText(t.children ?? [], o, e);
    const src = t.attrGet("src") ?? "";
    const m = alt.match(/^(.*?)\|(\d+)(?:x(\d+))?$/);
    const altText = m ? m[1] : alt;
    let attrs = `alt="${escapeHtml(altText)}"`;
    if (m) attrs += ` width="${m[2]}"` + (m[3] ? ` height="${m[3]}"` : "");
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^file:/i.test(src)) return `<img src="${escapeHtml(src)}" ${attrs} referrerpolicy="no-referrer">`;
    let p = src;
    try {
      p = decodeURI(src);
    } catch {
      /* keep */
    }
    return `<span class="internal-embed" src="${escapeHtml(p)}" alt="${escapeHtml(m ? altText + "|" + m[2] + (m[3] ? "x" + m[3] : "") : altText)}" data-md-image="1"></span>`;
  };
  return md;
}
