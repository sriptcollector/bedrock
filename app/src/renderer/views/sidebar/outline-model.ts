// Outline model: heading tree and section moves (pure, unit-tested).
export interface HeadingInfo {
  heading: string;
  level: number;
  line: number;
  start: number;
  end: number;
}

export interface OutlineNode {
  h: HeadingInfo;
  index: number;
  children: OutlineNode[];
}

export function buildOutline(hs: HeadingInfo[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  hs.forEach((h, index) => {
    const n: OutlineNode = { h, index, children: [] };
    while (stack.length && stack[stack.length - 1].h.level >= h.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(n);
    else roots.push(n);
    stack.push(n);
  });
  return roots;
}

/** Text range of a heading's section: the heading line up to the next heading of the same or higher level. */
export function sectionRange(text: string, hs: HeadingInfo[], i: number): [number, number] {
  const h = hs[i];
  let end = text.length;
  for (let j = i + 1; j < hs.length; j++)
    if (hs[j].level <= h.level) {
      end = hs[j].start;
      break;
    }
  return [h.start, end];
}

/** Move section `from` before (or after) heading `to`'s section. Returns the new text or null. */
export function moveSection(text: string, hs: HeadingInfo[], from: number, to: number, where: "before" | "after"): string | null {
  if (from === to) return null;
  const [s, e] = sectionRange(text, hs, from);
  const [ts, te] = sectionRange(text, hs, to);
  const insertAt = where === "before" ? ts : te;
  if (insertAt >= s && insertAt <= e) return null; // into itself
  let chunk = text.slice(s, e);
  if (!chunk.endsWith("\n")) chunk += "\n";
  let rest = text.slice(0, s) + text.slice(e);
  let at = insertAt > s ? insertAt - (e - s) : insertAt;
  if (at > 0 && rest[at - 1] !== "\n") {
    rest = rest.slice(0, at) + "\n" + rest.slice(at);
    at++;
  }
  return rest.slice(0, at) + chunk + rest.slice(at);
}
