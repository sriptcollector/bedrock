import { describe, expect, it } from "vitest";
import { parseMetadata, getFrontMatterInfo, getAllTags, parseFrontMatterTags, parseFrontMatterAliases } from "../../src/core/parse";

const NOTE = [
  "---", // 0
  "tags: [one, two/three]", // 1
  "aliases: Other name", // 2
  "related: '[[Target|Alias]]'", // 3
  "---", // 4
  "# Title #heading-tag", // 5
  "", // 6
  "Some text with [[Link]] and [[Folder/Note#Sec|shown]] and ![[image.png]].", // 7
  "A tag #inline and #nested/tag but not #123 or a#b or `#code`.", // 8
  "Markdown [link](Other%20Note.md) and [web](https://x.com/#frag).", // 9
  "Paragraph end ^para1", // 10
  "", // 11
  "## Sub heading", // 12
  "- [ ] task one", // 13
  "  - [x] nested done ^item2", // 14
  "- plain", // 15
  "", // 16
  "```js", // 17
  "const notALink = '[[Nope]]'; // #nottag", // 18
  "```", // 19
  "", // 20
  "> [!note] Callout", // 21
  "> body [[InCallout]]", // 22
  "", // 23
  "| a | b |", // 24
  "| - | - |", // 25
  "| 1 | [[InTable\\|alias]] |", // 26
  "", // 27
  "Text[^1] here", // 28
  "", // 29
  "[^1]: Footnote.", // 30
  "", // 31
  "Setext heading", // 32
  "===", // 33
  "", // 34
  "%% hidden [[Hidden]] %%", // 35
  "", // 36
  "---", // 37
].join("\n");

const m = parseMetadata(NOTE);

describe("frontmatter", () => {
  it("parses YAML and positions", () => {
    expect(m.frontmatter).toEqual({ tags: ["one", "two/three"], aliases: "Other name", related: "[[Target|Alias]]" });
    expect(m.frontmatterPosition!.start.line).toBe(0);
    expect(m.frontmatterPosition!.end.line).toBe(4);
  });
  it("collects links in frontmatter", () => {
    expect(m.frontmatterLinks).toEqual([{ key: "related", link: "Target", original: "[[Target|Alias]]", displayText: "Alias" }]);
  });
  it("getFrontMatterInfo finds the block", () => {
    const info = getFrontMatterInfo(NOTE);
    expect(info.exists).toBe(true);
    expect(info.frontmatter.startsWith("tags:")).toBe(true);
    expect(NOTE.slice(info.contentStart).startsWith("# Title")).toBe(true);
    expect(getFrontMatterInfo("no fm").exists).toBe(false);
  });
  it("tolerates invalid YAML", () => {
    const bad = parseMetadata("---\nkey: [unclosed\n---\ntext");
    expect(bad.frontmatter).toBeUndefined();
    expect(bad.frontmatterPosition).toBeDefined();
  });
  it("tag and alias helpers", () => {
    expect(parseFrontMatterTags(m.frontmatter)).toEqual(["#one", "#two/three"]);
    expect(parseFrontMatterAliases(m.frontmatter)).toEqual(["Other name"]);
    expect(parseFrontMatterTags({ tags: "a, b c" })).toEqual(["#a", "#b", "#c"]);
  });
});

describe("headings", () => {
  it("finds ATX and setext headings", () => {
    expect(m.headings!.map((h) => [h.heading, h.level, h.position.start.line])).toEqual([
      ["Title #heading-tag", 1, 5],
      ["Sub heading", 2, 12],
      ["Setext heading", 1, 32],
    ]);
  });
});

describe("links and embeds", () => {
  it("finds wikilinks with aliases and subpaths, skipping code and comments", () => {
    expect(m.links!.map((l) => l.link)).toEqual(["Link", "Folder/Note#Sec", "Other Note.md", "InCallout", "InTable"]);
    const aliased = m.links!.find((l) => l.link === "Folder/Note#Sec")!;
    expect(aliased.displayText).toBe("shown");
    expect(aliased.position.start).toEqual({ line: 7, col: 28, offset: NOTE.split("\n").slice(0, 7).join("\n").length + 1 + 28 });
    expect(m.links!.find((l) => l.link === "InTable")!.displayText).toBe("alias");
  });
  it("finds embeds", () => {
    expect(m.embeds!.map((e) => e.link)).toEqual(["image.png"]);
  });
});

describe("tags", () => {
  it("finds inline tags but not numbers, mid-word or code", () => {
    expect(m.tags!.map((t) => t.tag)).toEqual(["#heading-tag", "#inline", "#nested/tag"]);
  });
  it("getAllTags merges frontmatter and inline tags", () => {
    expect(getAllTags(m)).toEqual(["#one", "#two/three", "#heading-tag", "#inline", "#nested/tag"]);
  });
});

describe("blocks, lists, tasks, footnotes, sections", () => {
  it("finds block ids on paragraphs and list items", () => {
    expect(Object.keys(m.blocks!).sort()).toEqual(["item2", "para1"]);
    expect(m.blocks!.para1.position.start.line).toBe(7);
    expect(m.blocks!.item2.position.start.line).toBe(14);
  });
  it("finds list items with parents and task status", () => {
    const items = m.listItems!;
    expect(items.map((i) => [i.position.start.line, i.task, i.parent])).toEqual([
      [13, " ", -13],
      [14, "x", 13],
      [15, undefined, -13],
    ]);
    expect(items[1].id).toBe("item2");
  });
  it("finds footnotes and refs", () => {
    expect(m.footnotes!.map((f) => f.id)).toEqual(["1"]);
    expect((m as any).footnoteRefs.map((f: any) => f.id)).toEqual(["1"]);
  });
  it("splits sections by type", () => {
    expect(m.sections!.map((s) => s.type)).toEqual([
      "yaml",
      "heading",
      "paragraph",
      "heading",
      "list",
      "code",
      "callout",
      "table",
      "paragraph",
      "footnoteDefinition",
      "heading",
      "comment",
      "thematicBreak",
    ]);
  });
  it("a standalone ^id line names the block above", () => {
    const t = parseMetadata("| a |\n| - |\n| 1 |\n\n^table-id\n");
    expect(t.blocks!["table-id"].position.start.line).toBe(0);
  });
});

describe("performance", () => {
  it("parses a large note quickly", () => {
    const big = Array.from({ length: 2000 }, (_, i) => `## H${i}\nLine with [[Link ${i}]] and #tag${i % 50} ^b${i}\n- [ ] task ${i}\n`).join("\n");
    const t0 = performance.now();
    const r = parseMetadata(big);
    const ms = performance.now() - t0;
    expect(r.headings!.length).toBe(2000);
    expect(r.links!.length).toBe(2000);
    expect(ms).toBeLessThan(500);
  });
});
