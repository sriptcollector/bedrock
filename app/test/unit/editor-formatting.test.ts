// Inline formatting toggles and insert commands; expectations measured on the original app.
import { describe, expect, it } from "vitest";
import { toggleInline, toggleHighlightColor, clearFormatting, insertMarkdownLink, insertWrapped, insertTag, insertFencedBlock, insertCallout, insertTable, insertHorizontalRule, insertFootnote } from "../../src/renderer/editor/formatting";
import { run } from "./editor-helpers";

describe("toggle inline formatting", () => {
  it.each([
    ["a wo‸rd b", "bold", "a **wo‸rd** b"],
    ["a ‸ b", "bold", "a **‸** b"],
    ["a «word» b", "bold", "a **«word»** b"],
    ["a **«word»** b", "bold", "a «word» b"],
    ["a **wo‸rd** b", "bold", "a wo‸rd b"],
    ["a «wo»rd b", "bold", "a **«wo»**rd b"],
    ["a «**word**» b", "bold", "a «word» b"],
    ["a «word» b", "italic", "a *«word»* b"],
    ["**a «word» b**", "italic", "**a *«word»* b**"],
    ["a _w‸x_ b", "italic", "a w‸x b"],
    ["a «word» b", "strikethrough", "a ~~«word»~~ b"],
    ["a «word» b", "highlight", "a ==«word»== b"],
    ["a «word» b", "code", "a `«word»` b"],
    ["a ‸ b", "code", "a `‸` b"],
    ["a `w‸x` b", "code", "a w‸x b"],
    ["«a\nb»", "code", "`«a`\n`b»`"],
    ["a «x» b", "math", "a $«x»$ b"],
    ["a ‸", "math", "a $‸$"],
    ["a «word» b", "comment", "a %%«word»%% b"],
    ["a wo‸rd b", "comment", "a %%«word»%% b"],
    ["«a\nb»", "comment", "%%«a\nb»%%"],
  ])("%j %s", (src, kind, want) => {
    expect(run(src, (s) => toggleInline(s, kind as any))).toBe(want);
  });

  it.each([
    ["a «word» b", "red", "a ==🔴«word»== b"],
    ["a wo‸rd b", "red", "a ==🔴wo‸rd== b"],
    ["a ==🔴wo‸rd== b", "blue", "a ==🔵wo‸rd== b"],
  ])("colour highlight %j %s", (src, color, want) => {
    expect(run(src, (s) => toggleHighlightColor(s, color))).toBe(want);
  });

  it("plain highlight toggle removes a coloured highlight", () => {
    expect(run("a ==🔴wo‸rd== b", (s) => toggleInline(s, "highlight"))).toBe("a wo‸rd b");
  });

  it("clear formatting removes whole markup inside the selection only", () => {
    expect(run("«**a** *b* ==c== `d` ~~e~~»", clearFormatting)).toBe("«a b c d e»");
    expect(run("**a «b» c**", clearFormatting)).toBe("**a «b» c**");
  });
});

describe("insert commands", () => {
  it.each([
    ["a «word» b", "a [word](‸) b"],
    ["a ‸", "a [‸]()"],
    ["a «https://example.com» b", "a [https://example.com](‸) b"],
  ])("insert link %j", (src, want) => {
    expect(run(src, insertMarkdownLink)).toBe(want);
  });
  it("internal link / embed / tag", () => {
    expect(run("a ‸", (s) => insertWrapped(s, "[[", "]]"))).toBe("a [[‸]]");
    expect(run("a «word» b", (s) => insertWrapped(s, "[[", "]]"))).toBe("a [[word‸]] b");
    expect(run("a «w» b", (s) => insertWrapped(s, "![[", "]]"))).toBe("a ![[w‸]] b");
    expect(run("a «w» b", insertTag)).toBe("a #‸w b");
  });
  it.each([
    ["a‸", "> [!«NOTE»]\n> a"],
    ["«a\nb»", "> [!«NOTE»]\n> a\n> b"],
    ["a\n‸", "a\n\n> [!«NOTE»] Title\n> Contents\n"],
  ])("callout %j", (src, want) => {
    expect(run(src, insertCallout)).toBe(want);
  });
  it.each([
    ["a‸", "a\n\n|‸     |     |\n| --- | --- |\n|     |     |\n"],
    ["ab‸cd", "abcd\n\n|‸     |     |\n| --- | --- |\n|     |     |\n"],
    ["‸", "\n|‸     |     |\n| --- | --- |\n|     |     |\n"],
  ])("table %j", (src, want) => {
    expect(run(src, insertTable)).toBe(want);
  });
  it.each([
    ["a‸", "```", "```\na‸\n```"],
    ["«a»", "```", "```\n«a»\n```"],
    ["a\n‸", "```", "a\n```\n‸\n```"],
    ["a‸", "$$", "$$\na‸\n$$"],
    ["«x»", "$$", "$$\n«x»\n$$"],
  ])("fenced %j %s", (src, fence, want) => {
    expect(run(src, (s) => insertFencedBlock(s, fence))).toBe(want);
  });
  it.each([
    ["a‸", "a\n\n---\n‸"],
    ["a\n‸", "a\n\n---\n‸"],
    ["ab‸cd", "ab\n\n---\n‸cd"],
  ])("horizontal rule %j", (src, want) => {
    expect(run(src, insertHorizontalRule)).toBe(want);
  });
  it.each([
    ["a‸\n\nb", "a[^1]‸\n\nb\n\n[^1]: \n"],
    ["a‸", "a[^1]‸\n\n[^1]: \n"],
    ["a[^1] b‸\n\n[^1]: x", "a[^1] b[^2]‸\n\n[^1]: x\n\n[^2]: \n"],
  ])("footnote %j", (src, want) => {
    expect(run(src, insertFootnote)).toBe(want);
  });
});
