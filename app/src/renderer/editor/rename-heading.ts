// "Rename this heading...": rewrite links that point at the old heading — [[Note#Old]],
// [[Note#Old|alias]], [[#Old]] in the note itself, and Markdown links [x](Note.md#Old%20heading).
import { parseLinktext, stripHeadingForLink } from "../../core/links";

const norm = (h: string) => stripHeadingForLink(h).toLowerCase();

/**
 * Rewrite heading links in `text`. `pointsAtTarget(path)` says whether a link path refers to the
 * renamed note ("" = the note itself when `isSelf`).
 */
export function rewriteHeadingLinks(text: string, oldHeading: string, newHeading: string, pointsAtTarget: (path: string) => boolean): string {
  const oldN = norm(oldHeading);
  const nh = stripHeadingForLink(newHeading);
  let out = text.replace(/(!?\[\[)([^\]|#\n]*)#([^\]|\n]+)(\|[^\]\n]*)?(\]\])/g, (m, open, path, sub, alias, close) => {
    if (sub.startsWith("^") || norm(sub) !== oldN || !pointsAtTarget(path)) return m;
    return `${open}${path}#${nh}${alias ?? ""}${close}`;
  });
  out = out.replace(/(!?\[[^\]\n]*\]\()([^)#\s]*)#([^)\s]+)(\))/g, (m, open, path, sub, close) => {
    let decodedPath = path;
    let decodedSub = sub;
    try {
      decodedPath = decodeURI(path);
      decodedSub = decodeURIComponent(sub);
    } catch {
      /* keep */
    }
    if (norm(decodedSub) !== oldN || !pointsAtTarget(decodedPath)) return m;
    return `${open}${path}#${encodeURIComponent(nh).replace(/%2F/g, "/")}${close}`;
  });
  return out;
}

/** Update every note that links to `file`'s `oldHeading`. Returns the number of notes changed. */
export async function renameHeadingLinks(app: any, file: any, oldHeading: string, newHeading: string): Promise<number> {
  let changed = 0;
  const sources = new Set<string>([file.path]);
  for (const [src, targets] of Object.entries(app.metadataCache.resolvedLinks as Record<string, Record<string, number>>)) if (targets[file.path]) sources.add(src);
  for (const src of sources) {
    const f = app.vault.getFileByPath?.(src) ?? app.vault.getAbstractFileByPath(src);
    if (!f) continue;
    const resolves = (path: string) => {
      if (!path) return src === file.path;
      const dest = app.metadataCache.getFirstLinkpathDest(parseLinktext(path).path, src);
      return dest === file;
    };
    if (src === file.path) {
      // The open editor already has the new heading; links inside the note are rewritten there too.
      const view = app.workspace.getLeavesOfType?.("markdown").map((l: any) => l.view).find((v: any) => v.file === file);
      if (view?.editor) {
        const before = view.editor.getValue();
        const after = rewriteHeadingLinks(before, oldHeading, newHeading, resolves);
        if (after !== before) {
          // Replace only the changed middle so the cursor stays put.
          let a = 0;
          while (a < before.length && a < after.length && before[a] === after[a]) a++;
          let b = 0;
          while (b < before.length - a && b < after.length - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b++;
          view.cm.dispatch({ changes: { from: a, to: before.length - b, insert: after.slice(a, after.length - b) } });
          changed++;
        }
        continue;
      }
    }
    let did = false;
    await app.vault.process(f, (data: string) => {
      const next = rewriteHeadingLinks(data, oldHeading, newHeading, resolves);
      did = next !== data;
      return next;
    });
    if (did) changed++;
  }
  return changed;
}
