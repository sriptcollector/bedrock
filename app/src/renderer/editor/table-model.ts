// Markdown (GFM) table model: parse, edit and format tables the way the original's table editor
// writes them back (cells padded to the column width, minimum 3, alignment-aware padding).
export type Align = "left" | "center" | "right" | null;

export interface TableModel {
  /** Header row first, then body rows. Cell text is trimmed source. */
  rows: string[][];
  aligns: Align[];
}

/** Split a table row into cells; pipes inside `code` or escaped as \| stay in the cell. */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  let tick = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "\\|";
      i++;
      continue;
    }
    if (ch === "`") {
      let n = 0;
      while (s[i + n] === "`") n++;
      if (!tick) tick = n;
      else if (tick === n) tick = 0;
      cur += "`".repeat(n);
      i += n - 1;
      continue;
    }
    if (ch === "|" && !tick) {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

export function isDelimiterRow(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function alignOf(cell: string): Align {
  const l = cell.startsWith(":");
  const r = cell.endsWith(":");
  return l && r ? "center" : r ? "right" : l ? "left" : null;
}

export function parseTable(text: string): TableModel | null {
  const lines = text.split("\n").filter((l, i, a) => !(i === a.length - 1 && !l.trim()));
  if (lines.length < 2 || !isDelimiterRow(lines[1])) return null;
  const header = splitRow(lines[0]);
  const aligns = splitRow(lines[1]).map(alignOf);
  const rows = [header, ...lines.slice(2).map(splitRow)];
  const cols = Math.max(header.length, aligns.length);
  for (const r of rows) while (r.length < cols) r.push("");
  for (const r of rows) r.length = Math.max(cols, r.length);
  while (aligns.length < cols) aligns.push(null);
  // Body rows can't add columns beyond the header in GFM; extra cells are dropped.
  for (const r of rows) r.length = cols;
  return { rows, aligns: aligns.slice(0, cols) };
}

/** Display width of a string (wide CJK / emoji count as 2 columns, like monospace editors). */
export function strWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    w += c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd)) ? 2 : 1;
  }
  return w;
}

function pad(cell: string, width: number, align: Align): string {
  const gap = width - strWidth(cell);
  if (gap <= 0) return cell;
  if (align === "right") return " ".repeat(gap) + cell;
  if (align === "center") {
    const left = Math.floor(gap / 2);
    return " ".repeat(left) + cell + " ".repeat(gap - left);
  }
  return cell + " ".repeat(gap);
}

function delimiter(width: number, align: Align): string {
  if (align === "center") return ":" + "-".repeat(Math.max(1, width - 2)) + ":";
  if (align === "left") return ":" + "-".repeat(Math.max(2, width - 1));
  if (align === "right") return "-".repeat(Math.max(2, width - 1)) + ":";
  return "-".repeat(width);
}

export function columnWidths(t: TableModel): number[] {
  return t.aligns.map((_a, c) => Math.max(3, ...t.rows.map((r) => strWidth(r[c] ?? ""))));
}

export function formatTable(t: TableModel): string {
  const widths = columnWidths(t);
  const row = (cells: string[]) => "| " + cells.map((c, i) => pad(c, widths[i], t.aligns[i])).join(" | ") + " |";
  const out = [row(t.rows[0]), "| " + widths.map((w, i) => delimiter(w, t.aligns[i])).join(" | ") + " |"];
  for (const r of t.rows.slice(1)) out.push(row(r));
  return out.join("\n");
}

/** Offset of cell (row, col) text start inside formatTable(t) output (row 0 = header). */
export function cellOffset(t: TableModel, row: number, col: number): number {
  const lines = formatTable(t).split("\n");
  const physical = row === 0 ? 0 : row + 1;
  let off = 0;
  for (let i = 0; i < physical; i++) off += lines[i].length + 1;
  const line = lines[physical];
  // Find the pipe that opens column `col`.
  let seen = -1;
  let tick = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "`") tick = tick ? 0 : 1;
    if (ch === "|" && !tick) {
      seen++;
      if (seen === col) {
        let j = i + 1;
        while (line[j] === " " && j < line.length - 1 && line[j + 1] !== "|") j++;
        if (line[j] === " ") j++;
        return off + j;
      }
    }
  }
  return off + line.length;
}

/** Which cell a position inside the (unformatted) table source falls in. */
export function cellAt(text: string, offset: number): { row: number; col: number } | null {
  const lines = text.split("\n");
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    const end = start + lines[i].length;
    if (offset <= end) {
      if (i === 1) return { row: 0, col: colAt(lines[i], offset - start) };
      return { row: i === 0 ? 0 : i - 1, col: colAt(lines[i], offset - start) };
    }
    start = end + 1;
  }
  return null;
}

function colAt(line: string, x: number): number {
  let col = -1;
  let tick = 0;
  const lead = /^\s*\|/.test(line);
  if (!lead) col = 0;
  for (let i = 0; i < Math.min(x, line.length); i++) {
    const ch = line[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "`") tick = tick ? 0 : 1;
    if (ch === "|" && !tick) col++;
  }
  return Math.max(0, col);
}

export type TableOp =
  | "row-before"
  | "row-after"
  | "row-up"
  | "row-down"
  | "row-copy"
  | "row-delete"
  | "col-before"
  | "col-after"
  | "col-left"
  | "col-right"
  | "col-copy"
  | "col-delete"
  | "col-align-left"
  | "col-align-center"
  | "col-align-right"
  | "sort-asc"
  | "sort-desc";

/** Apply a structural operation; returns the new model and the cell to focus, or null if not possible. */
export function applyTableOp(t: TableModel, op: TableOp, row: number, col: number): { t: TableModel; row: number; col: number } | null {
  const rows = t.rows.map((r) => r.slice());
  const aligns = t.aligns.slice();
  const cols = aligns.length;
  const empty = () => new Array(cols).fill("");
  switch (op) {
    case "row-before":
      if (row === 0) return null;
      rows.splice(row, 0, empty());
      return { t: { rows, aligns }, row, col };
    case "row-after":
      rows.splice(row + 1, 0, empty());
      return { t: { rows, aligns }, row: row + 1, col };
    case "row-up":
      if (row <= 1) return null;
      [rows[row - 1], rows[row]] = [rows[row], rows[row - 1]];
      return { t: { rows, aligns }, row: row - 1, col };
    case "row-down":
      if (row === 0 || row >= rows.length - 1) return null;
      [rows[row + 1], rows[row]] = [rows[row], rows[row + 1]];
      return { t: { rows, aligns }, row: row + 1, col };
    case "row-copy":
      if (row === 0) return null;
      rows.splice(row + 1, 0, rows[row].slice());
      return { t: { rows, aligns }, row: row + 1, col };
    case "row-delete":
      if (row === 0) return null;
      rows.splice(row, 1);
      return { t: { rows, aligns }, row: Math.min(row, rows.length - 1), col };
    case "col-before":
    case "col-after": {
      const at = op === "col-before" ? col : col + 1;
      for (const r of rows) r.splice(at, 0, "");
      aligns.splice(at, 0, null);
      return { t: { rows, aligns }, row, col: at };
    }
    case "col-left":
    case "col-right": {
      const other = op === "col-left" ? col - 1 : col + 1;
      if (other < 0 || other >= cols) return null;
      for (const r of rows) [r[col], r[other]] = [r[other], r[col]];
      [aligns[col], aligns[other]] = [aligns[other], aligns[col]];
      return { t: { rows, aligns }, row, col: other };
    }
    case "col-copy":
      for (const r of rows) r.splice(col + 1, 0, r[col]);
      aligns.splice(col + 1, 0, aligns[col]);
      return { t: { rows, aligns }, row, col: col + 1 };
    case "col-delete":
      if (cols <= 1) return null;
      for (const r of rows) r.splice(col, 1);
      aligns.splice(col, 1);
      return { t: { rows, aligns }, row, col: Math.min(col, cols - 2) };
    case "col-align-left":
    case "col-align-center":
    case "col-align-right": {
      const a = op.slice("col-align-".length) as Align;
      aligns[col] = a;
      return { t: { rows, aligns }, row, col };
    }
    case "sort-asc":
    case "sort-desc": {
      const body = rows.slice(1);
      const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
      body.sort((a, b) => coll.compare(a[col] ?? "", b[col] ?? "") * (op === "sort-asc" ? 1 : -1));
      return { t: { rows: [rows[0], ...body], aligns }, row, col };
    }
  }
  return null;
}
