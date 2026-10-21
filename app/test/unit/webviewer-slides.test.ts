// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { addressToUrl, extractArticle, htmlToMarkdown, safeFileName } from "../../src/renderer/core-plugins/webviewer/extract";
import { splitSlides } from "../../src/renderer/core-plugins/slides";
import { isBlockedHost, parseFilterList } from "../../src/main/webviewer";

const DDG = "https://duckduckgo.com/?q=%s";

describe("web viewer address bar", () => {
  it("keeps URLs, adds https to host names, searches everything else", () => {
    expect(addressToUrl("https://example.com/a", DDG)).toBe("https://example.com/a");
    expect(addressToUrl("example.com", DDG)).toBe("https://example.com");
    expect(addressToUrl("localhost:3000/x", DDG)).toBe("https://localhost:3000/x");
    expect(addressToUrl("obsidian markdown", DDG)).toBe("https://duckduckgo.com/?q=obsidian%20markdown");
    expect(addressToUrl("file:///C:/secret.txt", DDG)).toContain("duckduckgo.com");
    expect(addressToUrl("", DDG)).toBe("about:blank");
  });
});

describe("web viewer article extraction and Markdown", () => {
  const html = `<html><head><title>Garden news</title><meta property="og:site_name" content="Site"></head><body>
    <nav><a href="/">Home</a><a href="/about">About</a></nav>
    <div class="sidebar"><p>Subscribe to our newsletter, today, now, please.</p></div>
    <article><h1>Spring planting</h1>
      <p>Tomatoes, peppers, and beans go in <strong>after</strong> the last frost, see <a href="/frost">frost dates</a>.</p>
      <p>Water deeply, but not every day, and mulch the beds to keep moisture in.</p>
      <ul><li>Tomatoes<ul><li>Cherry</li></ul></li><li>Beans</li></ul>
      <pre><code class="language-js">plant("bean");</code></pre>
      <blockquote><p>Plant in spring.</p></blockquote>
      <table><tr><th>Bed</th><th>Crop</th></tr><tr><td>1</td><td>Beans</td></tr></table>
      <img src="/img/bed.png" alt="Bed">
    </article><footer>Copyright</footer><script>alert(1)</script></body></html>`;

  it("finds the article and converts it", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const a = extractArticle(doc);
    expect(a.title).toBe("Garden news");
    expect(a.siteName).toBe("Site");
    const md = htmlToMarkdown(a.content, "https://garden.test/news/1");
    expect(md).toContain("# Spring planting");
    expect(md).toContain("**after**");
    expect(md).toContain("[frost dates](https://garden.test/frost)");
    expect(md).toContain("- Tomatoes\n    - Cherry\n- Beans");
    expect(md).toContain("```js\nplant(\"bean\");\n```");
    expect(md).toContain("> Plant in spring.");
    expect(md).toContain("| Bed | Crop |\n| --- | --- |\n| 1 | Beans |");
    expect(md).toContain("![Bed](https://garden.test/img/bed.png)");
    expect(md).not.toContain("newsletter");
    expect(md).not.toContain("alert");
    expect(md).not.toContain("Copyright");
  });

  it("makes safe file names", () => {
    expect(safeFileName('A: "B" / C?')).toBe("A B C");
    expect(safeFileName("  ")).toBe("Untitled");
  });
});

describe("slides", () => {
  it("splits at --- outside code fences and drops frontmatter", () => {
    const s = splitSlides("---\ntags: [a]\n---\n# One\n\n---\n\n## Two\n```\n---\n```\n---\nThree");
    expect(s).toHaveLength(3);
    expect(s[0].trim()).toBe("# One");
    expect(s[1]).toContain("```\n---\n```");
    expect(s[2].trim()).toBe("Three");
  });
});

describe("ad blocker filter lists", () => {
  it("reads domain rules and matches subdomains", () => {
    const hosts = parseFilterList("! comment\n||ads.example.com^\n||track.test^$third-party\n||x.test^$domain=a.com\nexample.org##.banner\n@@||ok.test^\n/regex/");
    expect(hosts).toEqual(["ads.example.com", "track.test"]);
    const set = new Set(hosts);
    expect(isBlockedHost("cdn.ads.example.com", set)).toBe(true);
    expect(isBlockedHost("example.com", set)).toBe(false);
  });
});
