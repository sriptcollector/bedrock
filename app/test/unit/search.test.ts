// Search query language: parser, matcher, explain text, and the result card builder.
import { describe, expect, it } from "vitest";
import { parseMetadata } from "../../src/core/parse";
import { explain, makeDoc, matchDoc, parseQuery, tokenize, type QueryNode } from "../../src/renderer/views/sidebar/search-query";
import { buildCards, cardParts } from "../../src/renderer/views/sidebar/snippets";

const garden = `---
tags: [project, garden]
due: 2026-11-30
priority: high
rating: 4
---
# Garden Planner

Plan for the spring garden. See [[Welcome]].

## Beds
Water beds A and B every morning; bed C every other day. ^schedule

## Tasks
- [ ] Order compost #garden
- [x] Buy seeds #garden/shopping

\`\`\`js
function water(bed) {}
\`\`\`
`;
const doc = (path: string, text: string) => makeDoc(path, text, parseMetadata(text));
const G = doc("Projects/Garden Planner.md", garden);
const W = doc("Welcome.md", "# Welcome\n\nThe Garden Planner is the main project. #index\n");
const q = (s: string) => parseQuery(s) as QueryNode;
const hit = (s: string, d = G, cs = false) => !!matchDoc(q(s), d, cs);

describe("tokenizer and parser", () => {
  it("splits words, phrases, regex, operators and properties", () => {
    const t = tokenize('foo "bar baz" /re+/ -x path:Projects tag:#a [k:v] (a OR b)');
    expect(t.map((x) => x.t)).toEqual(["word", "str", "re", "not", "word", "op", "op", "prop", "lp", "word", "or", "word", "rp"]);
  });
  it("ANDs words and gives OR lower precedence", () => {
    const n = q("a b OR c");
    expect(n.type).toBe("or");
    if (n.type === "or") expect(n.children[0].type).toBe("and");
  });
  it("parses operator with a group operand", () => {
    const n = q("line:(water bed)");
    expect(n).toMatchObject({ type: "op", op: "line", child: { type: "and" } });
  });
  it("parses properties with comparisons and EMPTY", () => {
    expect(q("[rating:>3]")).toMatchObject({ type: "prop", value: { kind: "compare", cmp: ">", value: "3" } });
    expect(q("[status:EMPTY]")).toMatchObject({ type: "prop", value: { kind: "empty" } });
    expect(q("[rating]")).toMatchObject({ type: "prop", value: null });
  });
  it("returns null for an empty query", () => {
    expect(parseQuery("   ")).toBeNull();
  });
});

describe("matching", () => {
  it("plain words are case-insensitive substrings, all required", () => {
    expect(hit("GARDEN water")).toBe(true);
    expect(hit("garden nonexistent")).toBe(false);
    expect(hit("sow", doc("x.md", "Sown on Monday"))).toBe(true);
  });
  it("matches file names for plain words", () => {
    const r = matchDoc(q("planner"), G)!;
    expect(r.name.length).toBe(1);
  });
  it("OR, negation and grouping", () => {
    expect(hit("nothing OR compost")).toBe(true);
    expect(hit("-garden")).toBe(false);
    expect(hit("(nothing OR compost) -zebra")).toBe(true);
  });
  it("quoted phrases match exactly", () => {
    expect(hit('"every other day"')).toBe(true);
    expect(hit('"other every"')).toBe(false);
    // Quoted terms match whole words only (observed: "water" skips "Watering").
    expect(hit('"water"', doc("x.md", "Watering and watered"))).toBe(false);
    expect(hit('"water"', doc("x.md", "Water beds"))).toBe(true);
  });
  it("regular expressions", () => {
    expect(hit("/wat.r/")).toBe(true);
    expect(hit("/^## Beds$/")).toBe(true);
    expect(hit("/zz+/")).toBe(false);
  });
  it("match-case and ignore-case", () => {
    expect(hit("match-case:Garden")).toBe(true);
    expect(hit("match-case:GARDEN")).toBe(false);
    expect(hit("GARDEN", G, true)).toBe(false);
    expect(hit("ignore-case:GARDEN", G, true)).toBe(true);
  });
  it("file:, path: and content:", () => {
    expect(hit("file:planner")).toBe(true);
    expect(hit("file:welcome")).toBe(false);
    expect(hit("path:Projects")).toBe(true);
    expect(hit('path:"Projects/Garden"')).toBe(true);
    expect(hit("content:planner")).toBe(true);
    expect(hit("content:projects")).toBe(false);
    const r = matchDoc(q("path:Projects"), G)!;
    expect(r.path).toEqual([[0, 8]]);
  });
  it("tag: matches frontmatter and inline tags, with nested children", () => {
    expect(hit("tag:#garden")).toBe(true);
    expect(hit("tag:garden")).toBe(true);
    expect(hit("tag:project")).toBe(true);
    expect(hit("tag:#garden/shopping")).toBe(true);
    expect(hit("tag:#gard")).toBe(false);
    expect(hit("tag:#index", W)).toBe(true);
    const r = matchDoc(q("tag:#garden"), G)!;
    expect(r.content.length).toBeGreaterThanOrEqual(3);
  });
  it("line: needs all terms on one line", () => {
    expect(hit("line:(water morning)")).toBe(true);
    expect(hit("line:(water compost)")).toBe(false);
  });
  it("block: and section:", () => {
    expect(hit("block:(beds morning)")).toBe(true);
    expect(hit("block:(spring morning)")).toBe(false);
    expect(hit("section:(beds morning)")).toBe(true);
    expect(hit("section:(compost morning)")).toBe(false);
  });
  it("task:, task-todo: and task-done:", () => {
    expect(hit("task:compost")).toBe(true);
    expect(hit("task-todo:compost")).toBe(true);
    expect(hit("task-done:compost")).toBe(false);
    expect(hit("task-done:seeds")).toBe(true);
    expect(hit("task:morning")).toBe(false);
    expect(hit("task:", W)).toBe(false);
  });
  it("properties", () => {
    expect(hit("[priority]")).toBe(true);
    expect(hit("[priority:high]")).toBe(true);
    expect(hit("[priority:low]")).toBe(false);
    expect(hit("[rating:>3]")).toBe(true);
    expect(hit("[rating:<3]")).toBe(false);
    expect(hit("[due:>2026-01-01]")).toBe(true);
    expect(hit("[tags:garden]")).toBe(true);
    expect(hit("[missing]")).toBe(false);
  });
  it("ranges are merged and sorted", () => {
    const r = matchDoc(q("garden OR gard"), G)!;
    for (let i = 1; i < r.content.length; i++) expect(r.content[i][0]).toBeGreaterThan(r.content[i - 1][1] - 1);
  });
});

describe("explain", () => {
  it("describes each part", () => {
    const e = explain(q('tag:#garden path:Projects "water"'));
    expect(e.text).toBe("Match all of:");
    expect(e.children.map((c) => c.text)).toEqual(["Match tag: #garden", "Match file path:", 'Contains exact text: "water"']);
    expect(e.children[1].children[0].text).toBe('Matches text: "Projects"');
    expect(explain(q("-a")).text).toBe("Excluding:");
    expect(explain(q("a OR b")).text).toBe("Match any of:");
    expect(explain(q("[rating:>3]")).children[1].children[0].text).toBe("Greater than: 3");
  });
});

describe("result cards", () => {
  it("one card per line, several matches on a line share a card", () => {
    const t = "alpha garden\nnothing\ngarden and garden";
    const r = matchDoc(q("garden"), makeDoc("a.md", t, null))!;
    const cards = buildCards(t, r.content);
    expect(cards.length).toBe(2);
    expect(cards[1].ranges.length).toBe(2);
    const parts = cardParts(t, cards[1]);
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(["garden", "garden"]);
  });
  it("more context expands to the paragraph", () => {
    const t = "one\ntwo garden\nthree\n\nfour";
    const cards = buildCards(t, [[8, 14]], true);
    expect(t.slice(cards[0].start, cards[0].end)).toBe("one\ntwo garden\nthree");
  });
  it("trims very long lines around the match", () => {
    const t = "x ".repeat(400) + "needle" + " y".repeat(400);
    const i = t.indexOf("needle");
    const parts = cardParts(t, buildCards(t, [[i, i + 6]])[0]);
    expect(parts[0].text).toBe("...");
    expect(parts.map((p) => p.text).join("").length).toBeLessThan(600);
  });
});

describe("performance", () => {
  it("searches 10,000 notes quickly", () => {
    const words = ["garden", "water", "planner", "seed", "tomato", "bean", "book", "idea", "link", "note"];
    const docs = Array.from({ length: 10000 }, (_, i) => {
      let s = `# Note ${i}\n\n`;
      for (let l = 0; l < 30; l++) s += Array.from({ length: 12 }, (_, w) => words[(i * 7 + l * 3 + w) % words.length]).join(" ") + ` #tag${i % 50}\n`;
      return makeDoc(`folder${i % 20}/Note ${i}.md`, s, null);
    });
    const node = q("tomato bean -zebra");
    const t0 = performance.now();
    let n = 0;
    for (const d of docs) if (matchDoc(node, d)) n++;
    const ms = performance.now() - t0;
    expect(n).toBeGreaterThan(0);
    expect(ms).toBeLessThan(1500);
  });
});
