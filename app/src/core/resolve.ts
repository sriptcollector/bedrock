// Build resolvedLinks / unresolvedLinks maps from parsed metadata (shared by renderer & selftest).
import type { CachedMetadata } from "obsidian";
import { LinkIndex, getLinkpath } from "./links";

export type LinkMap = Record<string, Record<string, number>>;

export function resolveLinksFor(
  sourcePath: string,
  meta: CachedMetadata | undefined,
  index: LinkIndex,
): { resolved: Record<string, number>; unresolved: Record<string, number> } {
  const resolved: Record<string, number> = {};
  const unresolved: Record<string, number> = {};
  if (!meta) return { resolved, unresolved };
  const refs = [...(meta.links ?? []), ...(meta.embeds ?? []), ...(meta.frontmatterLinks ?? [])];
  for (const ref of refs) {
    const lp = getLinkpath(ref.link);
    const dest = index.resolve(lp, sourcePath);
    if (dest) resolved[dest] = (resolved[dest] ?? 0) + 1;
    else if (lp) unresolved[lp] = (unresolved[lp] ?? 0) + 1;
  }
  return { resolved, unresolved };
}
