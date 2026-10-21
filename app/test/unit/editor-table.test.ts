// Table editing model: parse, format (padded like the original's table editor), cell lookup and
// structural operations.
import { describe, expect, it } from "vitest";
import { parseTable, formatTable, cellOffset, cellAt, applyTableOp, splitRow, strWidth } from "../../src/renderer/editor/table-model";

const src = "| a | b |\n| - | :-: |\n| 1 | 2 |";

describe("table model", () => {
  it("parses rows and alignment", () => {
    const t = parseTable(src)!;
    expect(t.rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(t.aligns).toEqual([null, "center"]);
  });

  it("formats like the original (pad to width 3+, centre-aligned columns centred)", () => {
    expect(formatTable(parseTable(src)!)).toBe("| a   |  b  |\n| --- | :-: |\n| 1   |  2  |");
    expect(formatTable(parseTable("|     |     |\n| --- | --- |\n|     |     |")!)).toBe("|     |     |\n| --- | --- |\n|     |     |");
    const t = parseTable("| x | y | z |\n| :-- | --: | --- |\n| long text | 2 | |")!;
    expect(formatTable(t)).toBe("| x         |   y | z   |\n| :-------- | --: | --- |\n| long text |   2 |     |");
  });

  it("keeps escaped pipes and pipes in code inside the cell", () => {
    expect(splitRow("| a \\| b | `x|y` |")).toEqual(["a \\| b", "`x|y`"]);
  });

  it("measures wide characters as two columns", () => {
    expect(strWidth("日本")).toBe(4);
    expect(strWidth("ab")).toBe(2);
  });

  it("finds cells by offset and offsets by cell", () => {
    const f = formatTable(parseTable(src)!);
    const t = parseTable(f)!;
    expect(cellAt(f, f.indexOf("1"))).toEqual({ row: 1, col: 0 });
    expect(cellAt(f, f.indexOf("b"))).toEqual({ row: 0, col: 1 });
    expect(f.slice(cellOffset(t, 1, 1), cellOffset(t, 1, 1) + 1)).toBe("2");
    const empty = parseTable("|     |     |\n| --- | --- |\n|     |     |")!;
    // Empty cells put the cursor just before the closing pipe, like the original.
    expect(formatTable(empty)[cellOffset(empty, 1, 0)]).toBe("|");
  });

  it("row and column operations", () => {
    const t = parseTable(src)!;
    expect(applyTableOp(t, "row-after", 1, 0)!.t.rows).toEqual([["a", "b"], ["1", "2"], ["", ""]]);
    expect(applyTableOp(t, "row-before", 0, 0)).toBeNull();
    expect(applyTableOp(t, "row-delete", 0, 0)).toBeNull();
    expect(applyTableOp(t, "col-after", 1, 0)!.t.rows).toEqual([["a", "", "b"], ["1", "", "2"]]);
    expect(applyTableOp(t, "col-right", 1, 0)!.t).toEqual({ rows: [["b", "a"], ["2", "1"]], aligns: ["center", null] });
    expect(applyTableOp(t, "col-align-right", 1, 0)!.t.aligns).toEqual(["right", "center"]);
    expect(applyTableOp(t, "col-delete", 1, 1)!.t.rows).toEqual([["a"], ["1"]]);
    const many = parseTable("| n |\n| - |\n| b |\n| a |\n| c |")!;
    expect(applyTableOp(many, "sort-asc", 1, 0)!.t.rows.map((r) => r[0])).toEqual(["n", "a", "b", "c"]);
    expect(applyTableOp(many, "sort-desc", 1, 0)!.t.rows.map((r) => r[0])).toEqual(["n", "c", "b", "a"]);
    expect(applyTableOp(many, "row-down", 1, 0)!.t.rows.map((r) => r[0])).toEqual(["n", "a", "b", "c"]);
    expect(applyTableOp(many, "row-copy", 2, 0)!.t.rows.map((r) => r[0])).toEqual(["n", "b", "a", "a", "c"]);
  });
});
