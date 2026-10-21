// List continuation, indentation, renumbering and checkbox toggles. Expected values are the
// original app's results measured with the parity harness (docs/PARITY-EDITOR.md).
import { describe, expect, it } from "vitest";
import { insertNewlineContinueList, insertListContinuationLine, indentLines, outdentLines, toggleChecklistStatus, cycleListChecklist, toggleLinePrefix, setHeading, parseListLine, renumberChanges } from "../../src/renderer/editor/lists";
import { makeView, marked, run, runView, type } from "./editor-helpers";
import { Text } from "@codemirror/state";

const enter = (src: string, opts?: any) => runView(src, insertNewlineContinueList as any, opts);

describe("Enter in lists", () => {
  it.each([
    ["- one‸", "- one\n- ‸"],
    ["* one‸", "* one\n* ‸"],
    ["1. one‸", "1. one\n2. ‸"],
    ["1) one‸", "1) one\n2) ‸"],
    ["- [ ] one‸", "- [ ] one\n- [ ] ‸"],
    ["- [x] one‸", "- [x] one\n- [ ] ‸"],
    ["- [/] a‸", "- [/] a\n- [ ] ‸"],
    ["> one‸", "> one\n> ‸"],
    ["> - a‸", "> - a\n> - ‸"],
    ["- one\n- ‸", "- one\n‸"],
    ["- [ ] one\n- [ ] ‸", "- [ ] one\n‸"],
    ["> one\n> ‸", "> one\n\n‸"],
    ["- one\n\t- ‸", "- one\n- ‸"],
    ["1. a\n2. ‸", "1. a\n‸"],
    ["1. a\n\t1. ‸", "1. a\n2. ‸"],
    ["- one‸two", "- one\n- ‸two"],
    ["- ‸one", "- \n- ‸one"],
    ["- a\n  b‸", "- a\n  b\n- ‸"],
    ["- [ ] a\n      b‸", "- [ ] a\n      b\n- [ ] ‸"],
    ["5. a‸", "5. a\n6. ‸"],
    ["\tx‸", "\tx\n\t‸"],
    ["# a‸", "# a\n‸"],
    ["-‸", "-\n‸"],
    ["```\n\tx‸\n```", "```\n\tx\n\t‸\n```"],
    ["1. a‸\n2. b\n3. c", "1. a\n2. ‸\n3. b\n4. c"],
    ["1. ab‸cd\n2. e", "1. ab\n2. ‸cd\n3. e"],
  ])("%j", (src, want) => {
    expect(enter(src)).toBe(want);
  });

  it("Smart lists off: plain newline", () => {
    expect(enter("- a‸", { smart: false })).toBe("- a\n‸");
  });
});

describe("Shift+Enter", () => {
  it.each([
    ["- one‸", "- one\n  ‸"],
    ["1. a‸", "1. a\n   ‸"],
    ["- [ ] a‸", "- [ ] a\n      ‸"],
  ])("%j", (src, want) => {
    expect(runView(src, insertListContinuationLine as any)).toBe(want);
  });
});

describe("Tab / Shift+Tab", () => {
  it.each([
    ["- a\n- b‸", "- a\n\t- b‸"],
    ["- a\n- ‸b", "- a\n\t- ‸b"],
    ["- a\n- b‸\n\t- c", "- a\n\t- b‸\n\t- c"],
    ["ab‸cd", "\tab‸cd"],
    ["# a‸", "\t# a‸"],
    ["«a\nb»", "\t«a\n\tb»"],
    ["1. a\n2. b‸\n3. c", "1. a\n\t1. b‸\n2. c"],
    ["1. a\n\t1. x\n2. b‸", "1. a\n\t1. x\n\t2. b‸"],
  ])("Tab %j", (src, want) => {
    expect(runView(src, indentLines as any)).toBe(want);
  });
  it.each([
    ["- a\n\t- b‸", "- a\n- b‸"],
    ["\tab‸", "ab‸"],
    ["- a‸", "- a‸"],
    ["- a\n    - b‸", "- a\n- b‸"],
    ["1. a\n\t1. b‸\n2. c", "1. a\n2. b‸\n3. c"],
    ["1. a\n\t1. b\n\t2. c‸\n2. d", "1. a\n\t1. b\n2. c‸\n3. d"],
  ])("Shift+Tab %j", (src, want) => {
    expect(runView(src, outdentLines as any)).toBe(want);
  });
  it("indents with spaces when tabs are off", () => {
    expect(runView("- a\n- b‸", indentLines as any, { useTab: false })).toBe("- a\n    - b‸");
  });
  it("Smart lists off: no renumbering", () => {
    expect(runView("1. a\n2. b‸", indentLines as any, { smart: false })).toBe("1. a\n\t2. b‸");
  });
});

describe("renumbering", () => {
  it("renumbers after any edit in the list", () => {
    const v = makeView("1. a\n5. b‸");
    type(v, "x");
    expect(marked(v.state)).toBe("1. a\n2. bx‸");
  });
  it("first item keeps its number", () => {
    const v = makeView("‸");
    type(v, "5. a");
    expect(marked(v.state)).toBe("5. a‸");
  });
  it("a cursor inside a rewritten number moves to its start", () => {
    const v = makeView("1. a\n2‸. b\n3. c");
    type(v, "0");
    expect(marked(v.state)).toBe("1. a\n‸2. b\n3. c");
  });
  it("editing the first number moves the rest", () => {
    const v = makeView("1‸. a\n2. b");
    type(v, "0");
    expect(v.state.doc.toString()).toBe("10. a\n11. b");
  });
  it("a blank line keeps one list, a paragraph splits it", () => {
    let v = makeView("1. a\n\n1. b‸");
    type(v, "x");
    expect(v.state.doc.toString()).toBe("1. a\n\n2. bx");
    v = makeView("1. a\n\nfoo\n\n1. b‸");
    type(v, "x");
    expect(v.state.doc.toString()).toBe("1. a\n\nfoo\n\n1. bx");
  });
  it("a bullet sibling restarts numbering", () => {
    const v = makeView("1. a\n- b\n3. c‸");
    type(v, "x");
    expect(v.state.doc.toString()).toBe("1. a\n- b\n1. cx");
  });
  it("nested bullets don't break the outer list", () => {
    const v = makeView("1. a\n\t- x\n5. b‸");
    type(v, "y");
    expect(v.state.doc.toString()).toBe("1. a\n\t- x\n2. by");
  });
  it("renumberChanges works on a plain Text", () => {
    const doc = Text.of(["3. a", "7. b", "1. c"]);
    expect(renumberChanges(doc, 4)).toEqual([
      { from: 5, to: 6, insert: "4" },
      { from: 10, to: 11, insert: "5" },
    ]);
  });
});

describe("checkboxes and list toggles", () => {
  it.each([
    ["- [ ] a‸", "- [x] a‸"],
    ["- [x] a‸", "- [ ] a‸"],
    ["- [X] a‸", "- [ ] a‸"],
    ["a‸", "- [ ] a‸"],
    ["- a‸", "- [ ] a‸"],
    ["‸", "- [ ] ‸"],
    ["> a‸", "> - [ ] a‸"],
    ["\t- a‸", "\t- [ ] a‸"],
    ["1. a‸", "1. [ ] a‸"],
    ["- [/] a‸", "- [ ] a‸"],
    ["«- [ ] a\n- [ ] b»", "«- [x] a\n- [x] b»"],
    ["«- [ ] a\n- [x] b»", "«- [x] a\n- [x] b»"],
    ["«- [x] a\n- [-] b»", "«- [ ] a\n- [ ] b»"],
    ["«a\nb»", "- [ ] «a\n- [ ] b»"],
  ])("Ctrl+L %j", (src, want) => {
    expect(run(src, toggleChecklistStatus)).toBe(want);
  });
  it("cycle bullet/checkbox", () => {
    let s = "a‸";
    const seq = ["- a‸", "- [ ] a‸", "- [x] a‸", "- a‸"];
    for (const want of seq) {
      s = run(s, cycleListChecklist);
      expect(s).toBe(want);
    }
    expect(run("1. a‸", cycleListChecklist)).toBe("1. [ ] a‸");
  });
  it.each([
    ["«a\nb»", "bullet", "- «a\n- b»"],
    ["- a‸", "bullet", "a‸"],
    ["1. a‸", "bullet", "- a‸"],
    ["- [ ] a‸", "bullet", "- a‸"],
    ["«- a\nb»", "bullet", "«- a\n- b»"],
    ["\ta‸", "bullet", "\t- a‸"],
    ["«a\nb\nc»", "numbered", "1. «a\n2. b\n3. c»"],
    ["1. a‸", "numbered", "a‸"],
    ["«- a\n- b»", "numbered", "«1. a\n2. b»"],
    ["«a\nb»", "quote", "> «a\n> b»"],
    ["> a‸", "quote", "a‸"],
    ["«> a\nb»", "quote", "«> a\n> b»"],
  ])("toggle %j %s", (src, kind, want) => {
    expect(run(src, (s) => toggleLinePrefix(s, kind as any))).toBe(want);
  });
  it.each([
    ["Title‸", 2, "## Title‸"],
    ["#### Title‸", 2, "## Title‸"],
    ["## Title‸", 0, "Title‸"],
    ["- a‸", 1, "# - a‸"],
  ])("set heading %j -> %d", (src, level, want) => {
    expect(run(src, (s) => setHeading(s, level))).toBe(want);
  });
});

describe("parseListLine", () => {
  it("parses markers, tasks and quotes", () => {
    expect(parseListLine("- [ ] a")).toMatchObject({ bullet: "-", task: " ", contentStart: 6 });
    expect(parseListLine("> 12) x")).toMatchObject({ quote: "> ", bullet: "12", delim: ")", contentStart: 6 });
    expect(parseListLine("\t* x")).toMatchObject({ indent: "\t", bullet: "*" });
    expect(parseListLine("-")).toBeNull();
    expect(parseListLine("**bold**")).toBeNull();
    expect(parseListLine("1.5 apples")).toBeNull();
  });
});
