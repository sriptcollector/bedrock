// "Format converter: Frontmatter migration": bring tags / aliases / cssclasses into the strict
// list format (and fold the old single-value keys tag / alias / cssclass into them). Pure.

const PAIRS: [string, string][] = [
  ["tag", "tags"],
  ["alias", "aliases"],
  ["cssclass", "cssclasses"],
];

function toList(v: any, splitSpaces: boolean): string[] {
  if (v === null || v === undefined || v === "") return [];
  if (Array.isArray(v)) return v.flatMap((x) => toList(x, splitSpaces));
  return String(v)
    .split(splitSpaces ? /[,\s]+/ : /,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Does this frontmatter need converting? */
export function needsFrontmatterMigration(fm: Record<string, any> | null | undefined): boolean {
  if (!fm) return false;
  for (const k of Object.keys(fm)) {
    const lk = k.toLowerCase();
    if (PAIRS.some(([old]) => old === lk)) return true;
    if (PAIRS.some(([, neu]) => neu === lk) && fm[k] !== null && !Array.isArray(fm[k])) return true;
    if (PAIRS.some(([, neu]) => neu === lk) && Array.isArray(fm[k]) && fm[k].some((x: any) => typeof x !== "string" || (lk === "tags" && /^#/.test(x)))) return true;
  }
  return false;
}

/** Convert in place. Returns true when something changed. */
export function migrateFrontmatter(fm: Record<string, any>): boolean {
  if (!needsFrontmatterMigration(fm)) return false;
  for (const [old, neu] of PAIRS) {
    const oldKeys = Object.keys(fm).filter((k) => k.toLowerCase() === old);
    const target = Object.keys(fm).find((k) => k.toLowerCase() === neu) ?? neu;
    if (!oldKeys.length && !(target in fm)) continue;
    const splitSpaces = neu !== "aliases"; // aliases may contain spaces; tags and classes can't
    let list = [...toList(fm[target], splitSpaces), ...oldKeys.flatMap((k) => toList(fm[k], splitSpaces))];
    if (neu === "tags") list = list.map((t) => t.replace(/^#/, ""));
    for (const k of oldKeys) delete fm[k];
    fm[target] = Array.from(new Set(list));
  }
  return true;
}
