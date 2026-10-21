// Line diff for the version history view (Myers' O(ND) algorithm, written from scratch), plus
// the changed span inside a replaced line so it can be highlighted.

export type DiffOp = { type: "eq" | "del" | "add"; text: string };

const MAX_EDIT = 2000; // beyond this many changed lines, show "everything replaced"

export function diffLines(oldText: string, newText: string): DiffOp[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length;
  let eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
  }
  const eq = (t: string): DiffOp => ({ type: "eq", text: t });
  return [...a.slice(0, s).map(eq), ...myers(a.slice(s, ea), b.slice(s, eb)), ...a.slice(ea).map(eq)];
}

function splitLines(t: string): string[] {
  if (t === "") return [];
  const lines = t.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function myers(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const del = (t: string): DiffOp => ({ type: "del", text: t });
  const add = (t: string): DiffOp => ({ type: "add", text: t });
  if (!n) return b.map(add);
  if (!m) return a.map(del);
  const max = n + m;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  // trace[d] = the part of v (diagonals -d-1..d+1) as it was before step d; enough to walk back
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && d <= MAX_EDIT; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[k - 1 + off] < v[k + 1 + off]) ? v[k + 1 + off] : v[k - 1 + off] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k + off] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
    if (found) break;
  }
  if (!found) return [...a.map(del), ...b.map(add)];
  const out: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const w = trace[d];
    const at = (kk: number) => w[kk + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      out.push({ type: "eq", text: a[x - 1] });
      x--;
      y--;
    }
    if (x === prevX) out.push(add(b[y - 1]));
    else out.push(del(a[x - 1]));
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    out.push({ type: "eq", text: a[x - 1] });
    x--;
    y--;
  }
  return out.reverse();
}

/** [prefix, changed, suffix] of `line` compared with `other` (for highlighting inside a line). */
export function changedSpan(line: string, other: string): [string, string, string] {
  let s = 0;
  while (s < line.length && s < other.length && line[s] === other[s]) s++;
  let e = 0;
  while (e < line.length - s && e < other.length - s && line[line.length - 1 - e] === other[other.length - 1 - e]) e++;
  return [line.slice(0, s), line.slice(s, line.length - e), line.slice(line.length - e)];
}
