// Bookmark tree model (bookmarks.json items) and helpers (pure, unit-tested).
export interface BookmarkItem {
  type: "file" | "folder" | "search" | "heading" | "block" | "graph" | "url" | "group" | string;
  ctime: number;
  title?: string;
  path?: string;
  subpath?: string;
  query?: string;
  url?: string;
  options?: any;
  items?: BookmarkItem[];
  [k: string]: any;
}

/** Pure helpers over the bookmark tree (unit-tested). */
export function walkBookmarks(items: BookmarkItem[], cb: (item: BookmarkItem, parent: BookmarkItem[]) => boolean | void, parentList = items): boolean {
  for (const it of parentList) {
    if (cb(it, parentList) === true) return true;
    if (it.type === "group" && it.items && walkBookmarks(items, cb, it.items)) return true;
  }
  return false;
}

export function removeBookmark(items: BookmarkItem[], target: BookmarkItem): boolean {
  let done = false;
  walkBookmarks(items, (it, list) => {
    if (it === target) {
      list.splice(list.indexOf(it), 1);
      done = true;
      return true;
    }
  });
  return done;
}

/** Move `item` before/after `target` or into group `target`. */
export function moveBookmark(items: BookmarkItem[], item: BookmarkItem, target: BookmarkItem | null, where: "before" | "after" | "inside"): boolean {
  if (item === target) return false;
  if (target && item.type === "group") {
    let inside = false;
    walkBookmarks(item.items ?? [], (it) => {
      if (it === target) inside = true;
    });
    if (inside) return false;
  }
  removeBookmark(items, item);
  if (!target) {
    items.push(item);
    return true;
  }
  if (where === "inside" && target.type === "group") {
    (target.items ??= []).push(item);
    return true;
  }
  let placed = false;
  walkBookmarks(items, (it, list) => {
    if (it === target) {
      list.splice(list.indexOf(it) + (where === "after" ? 1 : 0), 0, item);
      placed = true;
      return true;
    }
  });
  if (!placed) items.push(item);
  return true;
}
