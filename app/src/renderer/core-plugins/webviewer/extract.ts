// Web viewer: reader mode and "Save to vault". Our own article extraction (score blocks of text,
// keep the best container) and an HTML -> Markdown converter. Pure DOM code: works on any
// Document (the page's HTML is parsed with DOMParser in the renderer; scripts never run).

const NOISE = "script,style,noscript,template,iframe,object,embed,canvas,svg,form,button,input,select,textarea,nav,footer,aside,dialog,[hidden],[aria-hidden=true]";
const POSITIVE = /article|body|content|entry|main|page|post|text|blog|story|prose/i;
const NEGATIVE = /comment|footer|foot|sidebar|side-bar|nav|menu|masthead|header|banner|ad-|ads|advert|promo|share|social|related|recommend|subscribe|newsletter|cookie|consent|popup|modal|breadcrumb|pagination|widget/i;

export interface Article {
  title: string;
  byline: string;
  siteName: string;
  content: HTMLElement;
  /** True when no clear article was found and the whole body was used. */
  fallback: boolean;
}

function classScore(el: Element): number {
  const s = `${el.className && typeof el.className === "string" ? el.className : ""} ${el.id}`;
  let n = 0;
  if (POSITIVE.test(s)) n += 25;
  if (NEGATIVE.test(s)) n -= 25;
  return n;
}

function textLen(el: Element): number {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim().length;
}

function linkDensity(el: Element): number {
  const total = textLen(el) || 1;
  let links = 0;
  el.querySelectorAll("a").forEach((a) => (links += textLen(a)));
  return links / total;
}

function meta(doc: Document, ...names: string[]): string {
  for (const n of names) {
    const m = doc.querySelector(`meta[property="${n}"], meta[name="${n}"]`);
    const v = m?.getAttribute("content")?.trim();
    if (v) return v;
  }
  return "";
}

/** Find the main article of a page. The document is modified (noise removed). */
export function extractArticle(doc: Document): Article {
  const title = meta(doc, "og:title", "twitter:title") || doc.title?.trim() || doc.querySelector("h1")?.textContent?.trim() || "Untitled";
  const byline = meta(doc, "author", "article:author");
  const siteName = meta(doc, "og:site_name", "application-name");
  doc.querySelectorAll(NOISE).forEach((e) => e.remove());
  doc.querySelectorAll("[role=navigation],[role=banner],[role=contentinfo],[role=complementary]").forEach((e) => e.remove());
  const body = doc.body ?? doc.documentElement;

  // A page that marks its article is trusted first.
  const marked = [...doc.querySelectorAll("article, [itemprop=articleBody], main, [role=main]")].filter((e) => textLen(e) > 200);
  if (marked.length === 1) return { title, byline, siteName, content: marked[0] as HTMLElement, fallback: false };

  const scores = new Map<Element, number>();
  for (const p of body.querySelectorAll("p, pre, td, blockquote, li")) {
    const len = textLen(p);
    if (len < 25) continue;
    const s = 1 + (p.textContent ?? "").split(/[,，、]/).length + Math.min(3, Math.floor(len / 100));
    const parent = p.parentElement;
    const grand = parent?.parentElement;
    if (parent) scores.set(parent, (scores.get(parent) ?? classScore(parent)) + s);
    if (grand) scores.set(grand, (scores.get(grand) ?? classScore(grand)) + s / 2);
  }
  let best: Element | null = null;
  let bestScore = 0;
  for (const [el, s] of scores) {
    const adjusted = s * (1 - linkDensity(el));
    if (adjusted > bestScore) {
      best = el;
      bestScore = adjusted;
    }
  }
  if (!best || bestScore < 10) return { title, byline, siteName, content: body as HTMLElement, fallback: true };
  // Climb while the parent holds clearly more of the same kind of content.
  while (best.parentElement && best.parentElement !== body && (scores.get(best.parentElement) ?? 0) > bestScore * 0.75) best = best.parentElement;
  // Drop link-heavy and negative blocks inside the article.
  best.querySelectorAll("div, section, ul, table").forEach((e) => {
    if (classScore(e) < 0 && textLen(e) < 1000) e.remove();
    else if (e.tagName !== "TABLE" && linkDensity(e) > 0.6 && textLen(e) < 600) e.remove();
  });
  return { title, byline, siteName, content: best as HTMLElement, fallback: false };
}

function abs(url: string | null, base: string): string {
  if (!url) return "";
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

const inlineEscape = (s: string) => s.replace(/([\\`*_[\]<>|])/g, "\\$1");

/** HTML element -> Markdown. Relative links and images are made absolute against `base`. */
export function htmlToMarkdown(root: Element, base: string): string {
  const out = blocks(root, base, 0).replace(/\n{3,}/g, "\n\n").trim();
  return out + "\n";
}

function inline(node: Node, base: string): string {
  if (node.nodeType === 3) return inlineEscape((node.textContent ?? "").replace(/\s+/g, " "));
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const kids = () => [...el.childNodes].map((c) => inline(c, base)).join("");
  switch (tag) {
    case "br":
      return "  \n";
    case "strong":
    case "b": {
      const t = kids().trim();
      return t ? `**${t}**` : "";
    }
    case "em":
    case "i": {
      const t = kids().trim();
      return t ? `*${t}*` : "";
    }
    case "del":
    case "s":
    case "strike": {
      const t = kids().trim();
      return t ? `~~${t}~~` : "";
    }
    case "mark":
      return `==${kids()}==`;
    case "code":
    case "kbd":
    case "samp": {
      const t = el.textContent ?? "";
      const fence = t.includes("`") ? "``" : "`";
      return t ? `${fence}${t}${fence}` : "";
    }
    case "a": {
      const href = el.getAttribute("href");
      const t = kids().trim();
      if (!href || href.startsWith("javascript:")) return t;
      const u = href.startsWith("#") ? href : abs(href, base);
      return t ? `[${t}](${u.replace(/ /g, "%20").replace(/\)/g, "%29")})` : "";
    }
    case "img": {
      const src = el.getAttribute("src") || el.getAttribute("data-src") || "";
      if (!src || src.startsWith("data:")) return "";
      const alt = (el.getAttribute("alt") ?? "").replace(/[[\]]/g, "");
      return `![${alt}](${abs(src, base).replace(/ /g, "%20")})`;
    }
    case "sup":
    case "sub":
    case "span":
    case "abbr":
    case "small":
    case "u":
    case "time":
    case "cite":
    case "q":
    case "label":
    case "font":
      return kids();
    default:
      // Block elements inside inline context: fall back to their text.
      return BLOCK.has(tag) ? " " + kids() + " " : kids();
  }
}

const BLOCK = new Set(["p", "div", "section", "article", "main", "header", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "pre", "blockquote", "hr", "table", "figure", "figcaption", "dl", "dt", "dd", "details", "summary"]);

function blocks(el: Element, base: string, depth: number): string {
  let out = "";
  let buf = "";
  const flush = () => {
    const t = buf.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
    if (t) out += t + "\n\n";
    buf = "";
  };
  for (const node of el.childNodes) {
    if (node.nodeType !== 1) {
      buf += inline(node, base);
      continue;
    }
    const c = node as Element;
    const tag = c.tagName.toLowerCase();
    if (!BLOCK.has(tag)) {
      buf += inline(c, base);
      continue;
    }
    flush();
    switch (tag) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const t = inline(c, base).replace(/\s+/g, " ").trim();
        if (t) out += `${"#".repeat(Number(tag[1]))} ${t}\n\n`;
        break;
      }
      case "hr":
        out += "---\n\n";
        break;
      case "pre": {
        const code = c.querySelector("code");
        const lang = /language-([\w+-]+)/.exec(code?.className ?? c.className)?.[1] ?? "";
        const t = (c.textContent ?? "").replace(/\n+$/, "");
        const fence = t.includes("```") ? "~~~" : "```";
        out += `${fence}${lang}\n${t}\n${fence}\n\n`;
        break;
      }
      case "blockquote": {
        const inner = blocks(c, base, depth).trim();
        if (inner) out += inner.split("\n").map((l) => (l ? "> " + l : ">")).join("\n") + "\n\n";
        break;
      }
      case "ul":
      case "ol":
        out += list(c, base, depth) + "\n";
        break;
      case "table":
        out += table(c, base) + "\n\n";
        break;
      case "figure":
      case "details":
      case "dl":
        out += blocks(c, base, depth);
        break;
      case "figcaption":
      case "summary":
      case "dt": {
        const t = inline(c, base).trim();
        if (t) out += `*${t}*\n\n`;
        break;
      }
      default:
        out += blocks(c, base, depth);
    }
  }
  flush();
  return out;
}

function list(el: Element, base: string, depth: number): string {
  const ordered = el.tagName.toLowerCase() === "ol";
  let n = Number(el.getAttribute("start") ?? 1) || 1;
  const pad = "    ".repeat(depth);
  let out = "";
  for (const li of el.children) {
    if (li.tagName.toLowerCase() !== "li") continue;
    const marker = ordered ? `${n++}. ` : "- ";
    let text = "";
    let nested = "";
    for (const node of li.childNodes) {
      const tag = node.nodeType === 1 ? (node as Element).tagName.toLowerCase() : "";
      if (tag === "ul" || tag === "ol") nested += list(node as Element, base, depth + 1);
      else if (tag && BLOCK.has(tag)) text += " " + blocks(node as Element, base, depth + 1).replace(/\n+/g, " ");
      else text += inline(node, base);
    }
    out += `${pad}${marker}${text.replace(/\s+/g, " ").trim()}\n${nested}`;
  }
  return out;
}

function table(el: Element, base: string): string {
  const rows = [...el.querySelectorAll("tr")].map((tr) => [...tr.children].map((td) => inline(td, base).replace(/\s+/g, " ").replace(/\|/g, "\\|").trim()));
  if (!rows.length) return "";
  const cols = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => "| " + Array.from({ length: cols }, (_, i) => r[i] ?? "").join(" | ") + " |";
  return [line(rows[0]), "| " + Array.from({ length: cols }, () => "---").join(" | ") + " |", ...rows.slice(1).map(line)].join("\n");
}

/** A file name from a page title (characters vault paths can't hold are dropped). */
export function safeFileName(title: string): string {
  const t = title.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return t || "Untitled";
}

/** What the address bar turns typed text into: a URL as-is, a host name, or a web search. */
export function addressToUrl(input: string, searchTemplate: string): string {
  const t = input.trim();
  if (!t) return "about:blank";
  if (/^(https?:|about:blank$)/i.test(t)) return t;
  if (!/\s/.test(t) && (/^localhost(:\d+)?(\/|$)/i.test(t) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(t))) return "https://" + t;
  return searchTemplate.replace("%s", encodeURIComponent(t));
}
