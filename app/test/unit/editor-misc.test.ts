// List item drag (block detection and move), heading-rename link rewriting, fold ranges.
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { itemBlock, moveBlock } from "../../src/renderer/editor/list-drag";
import { rewriteHeadingLinks } from "../../src/renderer/editor/rename-heading";
import { foldRangeAt } from "../../src/renderer/editor/folding";

const st = (doc: string) => EditorState.create({ doc, extensions: [EditorState.tabSize.of(4)] });
const apply = (s: EditorState, spec: any) => s.update(spec).state.doc.toString();

describe("list drag", () => {
  it("an item block includes its children and inner blank lines", () => {
    const s = st("- a\n\t- a1\n\n\t- a2\n- b");
    expect(itemBlock(s, 1)).toEqual({ first: 1, last: 4 });
    expect(itemBlock(s, 5)).toEqual({ first: 5, last: 5 });
  });
  it("moves a block down and up, keeping children", () => {
    const s = st("- a\n\t- a1\n- b\n- c");
    expect(apply(s, moveBlock(s, 1, 2, 5, null))).toBe("- b\n- c\n- a\n\t- a1");
    expect(apply(s, moveBlock(s, 4, 4, 1, null))).toBe("- c\n- a\n\t- a1\n- b");
    expect(moveBlock(s, 1, 2, 2, null)).toBeNull();
  });
  it("re-indents to the drop target", () => {
    const s = st("- a\n\t- x\n- b");
    expect(moveBlock(s, 3, 3, 3, "\t")).toBeNull();
    expect(apply(s, moveBlock(s, 3, 3, 2, "\t"))).toBe("- a\n\t- b\n\t- x");
  });
});

describe("rename heading links", () => {
  const all = () => true;
  it("rewrites wikilinks, aliases, embeds and same-note links", () => {
    const text = "[[Note#Old]] [[Note#Old|see]] ![[Note#Old]] [[#Old]] [[Note#Other]] [[Note#^old]]";
    expect(rewriteHeadingLinks(text, "Old", "New name", all)).toBe("[[Note#New name]] [[Note#New name|see]] ![[Note#New name]] [[#New name]] [[Note#Other]] [[Note#^old]]");
  });
  it("rewrites markdown links with encoded headings", () => {
    expect(rewriteHeadingLinks("[x](Note.md#Old%20heading)", "Old heading", "Fresh one", all)).toBe("[x](Note.md#Fresh%20one)");
  });
  it("leaves links to other notes alone", () => {
    expect(rewriteHeadingLinks("[[Other#Old]]", "Old", "New", (p) => p === "Note")).toBe("[[Other#Old]]");
  });
});

describe("fold ranges", () => {
  it("headings fold to the next heading of the same or higher level", () => {
    const s = st("# A\nx\n## B\ny\n# C\nz");
    expect(foldRangeAt(s, 0)).toEqual({ from: 3, to: s.doc.line(4).to });
    expect(foldRangeAt(s, s.doc.line(3).from)).toEqual({ from: s.doc.line(3).to, to: s.doc.line(4).to });
  });
  it("list items fold their children", () => {
    const s = st("- a\n\t- b\n\t\t- c\n- d");
    expect(foldRangeAt(s, 0)).toEqual({ from: 3, to: s.doc.line(3).to });
    expect(foldRangeAt(s, s.doc.line(4).from)).toBeNull();
  });
  it("respects the settings", () => {
    const s = st("# A\nx\n- a\n\t- b");
    expect(foldRangeAt(s, 0, false, true)).toBeNull();
    expect(foldRangeAt(s, s.doc.line(3).from, true, false)).toBeNull();
  });
});
