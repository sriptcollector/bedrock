// Snapshot tests for the reading-view renderer: one case per Obsidian syntax feature.
import { describe, expect, it } from "vitest";
import { createMarkdownIt } from "../../src/renderer/markdown/parser";

const md = createMarkdownIt();
const strict = createMarkdownIt({ strictLineBreaks: true });
const render = (s: string) => md.render(s, { lineOffset: 0, codeBlockProcessors: {} });

const CASES: Record<string, string> = {
  "headings": "# H1\n## H2 ^id\n###### H6\n\nSetext\n---",
  "emphasis": "**bold** *italic* _also_ ***both*** ~~strike~~ ==highlight== `code`",
  "highlight with inner markup": "==**bold** inside==",
  "wikilinks": "[[Note]] [[Note|Alias]] [[Note#Heading]] [[Note#^block]] [[#Local heading]]",
  "embeds": "![[Note]] ![[image.png|300]] ![[Note#Heading]] ![[Note#^block]] ![[clip.mp3]] ![[doc.pdf#page=2]]",
  "markdown links and images": "[ext](https://example.com) [local](Other%20Note.md) ![alt|200x100](pic.png) ![web](https://x.com/a.png)",
  "tags": "#tag #nested/tag #with-dash not#tag #123 (#paren)",
  "comments": "visible %%hidden%% visible\n\n%%\nblock comment\n%%\n\nafter",
  "inline math": "Euler: $e^{i\\pi}+1=0$ and not $ 5 or $5$",
  "block math": "$$\n\\frac{a}{b}\n$$",
  "task list": "- [ ] open\n- [x] done\n- [?] custom\n  - [ ] nested",
  "ordered and nested lists": "1. one\n2. two\n   - sub\n     - subsub",
  "callout": "> [!note]\n> Body text",
  "callout with title and fold": "> [!warning]- Be careful\n> Hidden **body**",
  "callout open fold": "> [!tip]+ Open\n> Content",
  "callout metadata": "> [!info|wide] Title\n> x",
  "nested callout": "> [!question] Outer\n> > [!example] Inner\n> > text",
  "plain blockquote": "> just a quote\n> second line",
  "table": "| A | B |\n|:--|--:|\n| [[x\\|y]] | 2 |",
  "footnotes": "Text[^1] and inline^[inline note].\n\n[^1]: The note.",
  "code fence": "```js\nconst a = 1;\n```",
  "mermaid": "```mermaid\ngraph TD; A-->B\n```",
  "horizontal rule": "a\n\n***\n\nb",
  "line breaks": "line one\nline two",
  "html": "<div class=\"x\">raw <b>html</b></div>",
  "block id hidden": "A paragraph ^abc123",
  "autolink": "Visit https://example.com today",
};

describe("markdown renderer", () => {
  for (const [name, src] of Object.entries(CASES)) {
    it(name, () => {
      expect(render(src)).toMatchSnapshot();
    });
  }

  it("strict line breaks off keeps single newlines", () => {
    expect(render("a\nb")).toContain("<br>");
    expect(strict.render("a\nb", {})).not.toContain("<br>");
  });

  it("callouts become .callout with type, fold state and title", () => {
    const html = render("> [!warning]- Be careful\n> body");
    expect(html).toContain('data-callout="warning"');
    expect(html).toContain('data-callout-fold="-"');
    expect(html).toContain("is-collapsed");
    expect(html).toContain('<div class="callout-title-inner">Be careful</div>');
  });

  it("wikilinks render as internal links with display text", () => {
    const html = render("[[Folder/Note#Sec|Shown]]");
    expect(html).toContain('data-href="Folder/Note#Sec"');
    expect(html).toContain('class="internal-link"');
    expect(html).toContain(">Shown<");
    expect(render("[[Note#Heading]]")).toContain(">Note &gt; Heading<");
  });

  it("tasks carry data-task and line numbers", () => {
    const html = md.render("x\n\n- [x] done", { lineOffset: 10 });
    expect(html).toContain('data-task="x"');
    expect(html).toContain('data-line="12"');
    expect(html).toContain("checked");
  });

  it("comments never reach the output", () => {
    expect(render("a %%secret%% b")).not.toContain("secret");
    expect(render("%%\nsecret\n%%")).not.toContain("secret");
  });

  it("math renders with KaTeX", () => {
    expect(render("$x^2$")).toContain("katex");
    expect(render("$$\nx\n$$")).toContain("katex-display");
  });
});
