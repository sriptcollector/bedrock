// Fuzzy / simple search (obsidian API: prepareFuzzySearch, prepareSimpleSearch, renderMatches...).

export type SearchMatchPart = [number, number];
export interface SearchResult {
  score: number;
  matches: SearchMatchPart[];
}

/** Subsequence match, case-insensitive. Rewards consecutive runs, word starts and early hits. */
export function prepareFuzzySearch(query: string): (text: string) => SearchResult | null {
  const q = query.toLowerCase().replace(/\s+/g, " ").trim();
  const words = q.split(" ").filter(Boolean);
  return (text: string) => {
    if (!words.length) return { score: 0, matches: [] };
    const t = text.toLowerCase();
    const matches: SearchMatchPart[] = [];
    let score = 0;
    let pos = 0;
    for (const w of words) {
      // Prefer a contiguous hit for the word.
      const direct = t.indexOf(w, 0);
      if (direct >= 0) {
        matches.push([direct, direct + w.length]);
        const wordStart = direct === 0 || /[\s\/\-_.]/.test(t[direct - 1]);
        score += 10 * w.length + (wordStart ? 8 : 0) - direct * 0.05;
        pos = direct + w.length;
        continue;
      }
      let run = 0;
      let start = -1;
      let i = 0;
      for (let qi = 0; qi < w.length; qi++) {
        const c = w[qi];
        const at = t.indexOf(c, i);
        if (at < 0) return null;
        if (at === i && qi > 0) {
          run++;
          score += 2 + run;
        } else {
          if (start >= 0) matches.push([start, i]);
          start = at;
          run = 0;
          score += /[\s\/\-_.]/.test(t[at - 1] ?? " ") ? 3 : 0.5;
        }
        i = at + 1;
      }
      if (start >= 0) matches.push([start, i]);
      pos = i;
    }
    void pos;
    matches.sort((a, b) => a[0] - b[0]);
    score -= t.length * 0.01;
    return { score: score / 10 - 1, matches: merge(matches) };
  };
}

export function prepareSimpleSearch(query: string): (text: string) => SearchResult | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return (text: string) => {
    const t = text.toLowerCase();
    const matches: SearchMatchPart[] = [];
    for (const w of words) {
      const i = t.indexOf(w);
      if (i < 0) return null;
      matches.push([i, i + w.length]);
    }
    return { score: 0, matches: merge(matches.sort((a, b) => a[0] - b[0])) };
  };
}

function merge(m: SearchMatchPart[]): SearchMatchPart[] {
  const out: SearchMatchPart[] = [];
  for (const x of m) {
    const last = out[out.length - 1];
    if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]);
    else out.push([x[0], x[1]]);
  }
  return out;
}

export function renderMatches(el: HTMLElement | DocumentFragment, text: string, matches: SearchMatchPart[] | null, offset = 0): void {
  let at = 0;
  for (const [s0, e0] of matches ?? []) {
    const s = s0 + offset;
    const e = e0 + offset;
    if (e <= 0 || s >= text.length) continue;
    const ss = Math.max(0, s);
    if (ss > at) el.appendChild(document.createTextNode(text.slice(at, ss)));
    const span = document.createElement("span");
    span.className = "suggestion-highlight";
    span.textContent = text.slice(ss, Math.min(e, text.length));
    el.appendChild(span);
    at = Math.min(e, text.length);
  }
  if (at < text.length) el.appendChild(document.createTextNode(text.slice(at)));
}

export function renderResults(el: HTMLElement, text: string, result: SearchResult, offset = 0): void {
  renderMatches(el, text, result.matches, offset);
}

export function sortSearchResults(results: { match: SearchResult }[]): void {
  results.sort((a, b) => b.match.score - a.match.score);
}
