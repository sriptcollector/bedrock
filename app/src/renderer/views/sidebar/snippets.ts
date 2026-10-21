// Turning match ranges into result "cards": one card per line holding matches (or per block with
// "Show more context"), with the text trimmed around long matches. Pure, unit-tested.
import type { Range } from "./search-query";

export interface MatchCard {
  /** Offsets of the card's text in the file. */
  start: number;
  end: number;
  /** Match ranges (file offsets) inside the card. */
  ranges: Range[];
}

export function lineStartAt(text: string, pos: number): number {
  const i = text.lastIndexOf("\n", pos - 1);
  return i < 0 ? 0 : i + 1;
}

export function lineEndAt(text: string, pos: number): number {
  const i = text.indexOf("\n", pos);
  return i < 0 ? text.length : i;
}

/** Block around a position: the run of non-blank lines containing it. */
export function blockAround(text: string, start: number, end: number): [number, number] {
  let s = lineStartAt(text, start);
  while (s > 0) {
    const prevStart = lineStartAt(text, s - 1);
    if (!text.slice(prevStart, s - 1).trim()) break;
    s = prevStart;
  }
  let e = lineEndAt(text, end);
  while (e < text.length) {
    const nextEnd = lineEndAt(text, e + 1);
    if (!text.slice(e + 1, nextEnd).trim()) break;
    e = nextEnd;
  }
  return [s, e];
}

/** Group ranges into cards: by line, or by block when `extraContext` is on. Overlapping cards merge. */
export function buildCards(text: string, ranges: Range[], extraContext = false): MatchCard[] {
  const cards: MatchCard[] = [];
  for (const r of ranges) {
    let s: number;
    let e: number;
    if (extraContext) [s, e] = blockAround(text, r[0], r[1]);
    else {
      s = lineStartAt(text, r[0]);
      e = lineEndAt(text, Math.max(r[0], r[1] - 1));
    }
    const last = cards[cards.length - 1];
    if (last && s <= last.end) {
      last.end = Math.max(last.end, e);
      last.ranges.push(r);
    } else cards.push({ start: s, end: e, ranges: [r] });
  }
  return cards;
}

/** Extend a card by one line before or after. */
export function extendCard(text: string, card: MatchCard, dir: "up" | "down"): MatchCard {
  if (dir === "up" && card.start > 0) return { ...card, start: lineStartAt(text, card.start - 1) };
  if (dir === "down" && card.end < text.length) return { ...card, end: lineEndAt(text, card.end + 1) };
  return card;
}

export interface SnippetPart {
  text: string;
  match: boolean;
}

const MAX_BEFORE = 120;
const MAX_TOTAL = 400;

/** Split a card into plain and highlighted parts, trimming very long text around the matches. */
export function cardParts(text: string, card: MatchCard): SnippetPart[] {
  let s = card.start;
  let e = card.end;
  const first = card.ranges[0];
  if (first && first[0] - s > MAX_BEFORE) {
    const cut = text.lastIndexOf(" ", first[0] - MAX_BEFORE / 2);
    s = cut > s ? cut + 1 : first[0] - MAX_BEFORE / 2;
  }
  if (e - s > MAX_TOTAL) {
    const lastR = card.ranges[card.ranges.length - 1];
    e = Math.max(Math.min(e, s + MAX_TOTAL), Math.min(e, lastR[1] + 40));
  }
  const parts: SnippetPart[] = [];
  if (s > card.start) parts.push({ text: "...", match: false });
  let pos = s;
  for (const [a0, b0] of card.ranges) {
    const a = Math.max(a0, s);
    const b = Math.min(b0, e);
    if (b <= a) continue;
    if (a > pos) parts.push({ text: text.slice(pos, a), match: false });
    parts.push({ text: text.slice(a, b), match: true });
    pos = b;
  }
  if (pos < e) parts.push({ text: text.slice(pos, e), match: false });
  if (e < card.end) parts.push({ text: "...", match: false });
  return parts;
}
