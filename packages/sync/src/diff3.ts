// Line-based three-way merge (diff3), written from scratch.
//
// diff(base, side) uses Myers' O(ND) algorithm on interned lines. merge3 walks the base and finds
// "stable" lines that both sides kept; everything between two stable lines is a hunk that is
// taken from whichever side changed it. If both sides changed the same hunk differently it is a
// conflict, except when both sides only inserted lines at the same spot (base part empty): then we
// keep both insertions (ours first). That suits notes, where two devices appending to the same
// note is common and losing neither line is what people expect.

export interface Merge3Result {
  clean: boolean;
  conflicts: number;
  lines: string[];
}

const MAX_D = 3000; // cap on edit distance explored; beyond it we stop looking for matches (more conflicts, never wrong)

/** Returns pairs [i, j] with a[i] === b[j], strictly increasing in both, forming a (near) longest common subsequence. */
export function lcsMatches(a: readonly number[], b: readonly number[]): Array<[number, number]> {
  let start = 0;
  let endA = a.length;
  let endB = b.length;
  const out: Array<[number, number]> = [];
  while (start < endA && start < endB && a[start] === b[start]) {
    out.push([start, start]);
    start++;
  }
  const tail: Array<[number, number]> = [];
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
    tail.push([endA, endB]);
  }
  const mid = myers(a.slice(start, endA), b.slice(start, endB));
  for (const [i, j] of mid) out.push([i + start, j + start]);
  for (let t = tail.length - 1; t >= 0; t--) out.push(tail[t]);
  return out;
}

function myers(a: readonly number[], b: readonly number[]): Array<[number, number]> {
  const N = a.length;
  const M = b.length;
  if (N === 0 || M === 0) return [];
  const max = N + M;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let D = -1;
  const limit = Math.min(max, MAX_D);
  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2)); // state before step d, k in [-(d+1), d+1]
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= N && y >= M) {
        D = d;
        break;
      }
    }
    if (D >= 0) break;
  }
  if (D < 0) return []; // too different: treat the whole middle as changed
  const matches: Array<[number, number]> = [];
  let x = N;
  let y = M;
  for (let d = D; d > 0; d--) {
    const prev = trace[d];
    const at = (k: number) => prev[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    const xStart = prevK === k + 1 ? prevX : prevX + 1;
    while (x > xStart) {
      x--;
      y--;
      matches.push([x, y]);
    }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    matches.push([x, y]);
  }
  return matches.reverse();
}

function intern(...lists: string[][]): number[][] {
  const ids = new Map<string, number>();
  return lists.map((l) =>
    l.map((s) => {
      let id = ids.get(s);
      if (id === undefined) {
        id = ids.size;
        ids.set(s, id);
      }
      return id;
    }),
  );
}

function eq(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function startsWith(a: readonly string[], prefix: readonly string[]): boolean {
  if (prefix.length > a.length) return false;
  for (let i = 0; i < prefix.length; i++) if (a[i] !== prefix[i]) return false;
  return true;
}

export function merge3(base: string[], ours: string[], theirs: string[]): Merge3Result {
  const [O, A, B] = intern(base, ours, theirs);
  const mA = new Int32Array(O.length).fill(-1);
  const mB = new Int32Array(O.length).fill(-1);
  for (const [i, j] of lcsMatches(O, A)) mA[i] = j;
  for (const [i, j] of lcsMatches(O, B)) mB[i] = j;

  const out: string[] = [];
  let conflicts = 0;
  let i = 0;
  let j = 0;
  let k = 0;
  while (true) {
    // Find the next base line that both sides kept, at or after i.
    let o = i;
    while (o < O.length && (mA[o] < 0 || mB[o] < 0)) o++;
    const endA = o < O.length ? mA[o] : A.length;
    const endB = o < O.length ? mB[o] : B.length;
    if (o > i || endA > j || endB > k) {
      const pO = base.slice(i, o);
      const pA = ours.slice(j, endA);
      const pB = theirs.slice(k, endB);
      if (eq(pA, pO)) out.push(...pB);
      else if (eq(pB, pO) || eq(pA, pB)) out.push(...pA);
      else if (pO.length === 0) {
        // both inserted at the same place: keep both (ours first), without duplicating a shared prefix
        if (startsWith(pB, pA)) out.push(...pB);
        else if (startsWith(pA, pB)) out.push(...pA);
        else out.push(...pA, ...pB);
      } else {
        conflicts++;
        out.push(...pA);
      }
    }
    if (o >= O.length) break;
    out.push(base[o]);
    i = o + 1;
    j = endA + 1;
    k = endB + 1;
  }
  return { clean: conflicts === 0, conflicts, lines: out };
}

export interface TextMergeResult {
  clean: boolean;
  text: string;
}

function splitLines(s: string): string[] {
  return s.split(/\r?\n/);
}

function dominantEol(s: string): string | null {
  let crlf = 0;
  let lf = 0;
  for (let i = s.indexOf('\n'); i >= 0; i = s.indexOf('\n', i + 1)) {
    if (i > 0 && s.charCodeAt(i - 1) === 13) crlf++;
    else lf++;
  }
  if (crlf === 0 && lf === 0) return null;
  return crlf > lf ? '\r\n' : '\n';
}

/**
 * Three-way merge of whole texts. Line endings are compared without the CR, so a device that saved
 * the note with CRLF and one with LF still merge; the result uses our (local) line ending style.
 * A leading BOM is kept if ours had one.
 */
export function mergeText(base: string, ours: string, theirs: string): TextMergeResult {
  const strip = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
  const bom = ours.charCodeAt(0) === 0xfeff ? '﻿' : '';
  const eol = dominantEol(ours) ?? dominantEol(theirs) ?? dominantEol(base) ?? '\n';
  const r = merge3(splitLines(strip(base)), splitLines(strip(ours)), splitLines(strip(theirs)));
  return { clean: r.clean, text: bom + r.lines.join(eol) };
}
