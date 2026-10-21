// Backlinks: linked-mention ranges, unlinked mentions and the link replacement text; plus the
// tag tree, outline section moves and bookmark tree helpers used by the sidebar panes.
import { describe, expect, it } from "vitest";
import { parseMetadata } from "../../src/core/parse";
import { findUnlinkedMentions, linkedRanges, mentionToLink } from "../../src/renderer/views/sidebar/mentions";
import { buildTagTree, sortTagTree } from "../../src/renderer/views/sidebar/tag-tree";
import { moveSection, type HeadingInfo } from "../../src/renderer/views/sidebar/outline-model";
import { moveBookmark, removeBookmark, type BookmarkItem } from "../../src/renderer/views/sidebar/bookmark-model";

const reading = `---
tags: [books]
---
# Reading List

2. Garden design basics, see [[Projects/Garden Planner]]
This line mentions Garden Planner without a link, to show unlinked mentions.
Gardens Planner is not a whole-word match. \`Garden Planner\` in code is skipped.
[Garden Planner](Projects/Garden%20Planner.md) is a markdown link.
`;

describe("linked mentions", () => {
  it("finds the ranges of links that resolve to the target", () => {
    const meta = parseMetadata(reading);
    const r = linkedRanges(meta, "Projects/Garden Planner.md", (lp) => (lp.toLowerCase().endsWith("garden planner") ? "Projects/Garden Planner.md" : null));
    expect(r.length).toBe(1);
    expect(reading.slice(r[0][0], r[0][1])).toBe("[[Projects/Garden Planner]]");
  });
});

describe("unlinked mentions", () => {
  it("whole words only, outside links, code and frontmatter", () => {
    const meta = parseMetadata(reading);
    const r = findUnlinkedMentions(reading, meta, ["Garden Planner"]);
    expect(r.length).toBe(1);
    expect(reading.slice(r[0][0], r[0][1])).toBe("Garden Planner");
    expect(reading.slice(r[0][0] - 9, r[0][0])).toBe("mentions ");
  });
  it("is case-insensitive and also finds aliases", () => {
    const t = "I met ada today. Countess of Lovelace too. [[Ada]] is linked.";
    const r = findUnlinkedMentions(t, parseMetadata(t), ["Ada Lovelace", "Ada", "Countess of Lovelace"]);
    expect(r.map(([a, b]) => t.slice(a, b))).toEqual(["ada", "Countess of Lovelace"]);
  });
  it("builds the link text", () => {
    expect(mentionToLink("Garden Planner", "Garden Planner")).toBe("[[Garden Planner]]");
    expect(mentionToLink("garden planner", "Projects/Garden Planner")).toBe("[[Projects/Garden Planner|garden planner]]");
  });
});

describe("tag tree", () => {
  it("counts every occurrence; parents include children", () => {
    const tree = sortTagTree(buildTagTree([["#garden", "#garden/shopping"], ["#garden", "#Garden"], ["#idea/habits"], ["#idea"]], true), "frequency");
    expect(tree.map((n) => [n.name, n.count])).toEqual([
      ["garden", 4],
      ["idea", 2],
    ]);
    expect(tree[0].children.map((n) => [n.name, n.count])).toEqual([["shopping", 1]]);
  });
  it("flat list without hierarchy", () => {
    const flat = sortTagTree(buildTagTree([["#a/b", "#a"]], false), "alphabetical");
    expect(flat.map((n) => n.name)).toEqual(["a", "a/b"]);
  });
});

describe("outline section move", () => {
  const text = "# A\na\n## B\nb\n## C\nc\n";
  const hs: HeadingInfo[] = [
    { heading: "A", level: 1, line: 0, start: 0, end: 3 },
    { heading: "B", level: 2, line: 2, start: 6, end: 11 },
    { heading: "C", level: 2, line: 4, start: 13, end: 17 },
  ];
  it("moves a section before another", () => {
    expect(moveSection(text, hs, 2, 1, "before")).toBe("# A\na\n## C\nc\n## B\nb\n");
  });
  it("moves a section after another", () => {
    expect(moveSection(text, hs, 1, 2, "after")).toBe("# A\na\n## C\nc\n## B\nb\n");
  });
  it("refuses to move a section into itself", () => {
    expect(moveSection(text, hs, 0, 1, "after")).toBeNull();
  });
});

describe("bookmark tree", () => {
  it("reorders and moves into groups", () => {
    const a: BookmarkItem = { type: "file", path: "a.md", ctime: 1 };
    const b: BookmarkItem = { type: "file", path: "b.md", ctime: 2 };
    const g: BookmarkItem = { type: "group", title: "G", ctime: 3, items: [] };
    const items = [a, b, g];
    moveBookmark(items, b, a, "before");
    expect(items.map((i) => i.ctime)).toEqual([2, 1, 3]);
    moveBookmark(items, a, g, "inside");
    expect(items.map((i) => i.ctime)).toEqual([2, 3]);
    expect(g.items!.map((i) => i.ctime)).toEqual([1]);
    expect(moveBookmark(items, g, a, "after")).toBe(false);
    removeBookmark(items, a);
    expect(g.items!.length).toBe(0);
  });
});
