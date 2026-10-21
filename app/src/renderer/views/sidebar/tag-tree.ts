// Tag tree model for the Tags view (pure, unit-tested).
export type TagSort = "alphabetical" | "alphabeticalReverse" | "frequency" | "frequencyReverse";
export interface TagNode {
  /** Full tag without '#', e.g. "garden/shopping". */
  tag: string;
  name: string;
  count: number;
  children: TagNode[];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Build the tag tree from per-file tag lists (each occurrence counts; parents include children). */
export function buildTagTree(tagLists: string[][], hierarchy: boolean): TagNode[] {
  const counts = new Map<string, { display: string; count: number }>();
  for (const list of tagLists)
    for (const raw of list) {
      const t = raw.replace(/^#/, "");
      if (!t) continue;
      const k = t.toLowerCase();
      const e = counts.get(k);
      if (e) e.count++;
      else counts.set(k, { display: t, count: 1 });
    }
  if (!hierarchy) return [...counts.values()].map((e) => ({ tag: e.display, name: e.display, count: e.count, children: [] }));
  const root: TagNode = { tag: "", name: "", count: 0, children: [] };
  const index = new Map<string, TagNode>();
  for (const [k, e] of counts) {
    const parts = e.display.split("/");
    let parent = root;
    let key = "";
    for (let i = 0; i < parts.length; i++) {
      key = key ? key + "/" + parts[i].toLowerCase() : parts[i].toLowerCase();
      let n = index.get(key);
      if (!n) {
        n = { tag: parts.slice(0, i + 1).join("/"), name: parts[i], count: 0, children: [] };
        index.set(key, n);
        parent.children.push(n);
      }
      n.count += e.count;
      parent = n;
    }
    void k;
  }
  return root.children;
}

export function sortTagTree(nodes: TagNode[], order: TagSort): TagNode[] {
  const cmp = (a: TagNode, b: TagNode) => {
    switch (order) {
      case "alphabetical":
        return collator.compare(a.name, b.name);
      case "alphabeticalReverse":
        return collator.compare(b.name, a.name);
      case "frequency":
        return b.count - a.count || collator.compare(a.name, b.name);
      case "frequencyReverse":
        return a.count - b.count || collator.compare(a.name, b.name);
    }
  };
  nodes.sort(cmp);
  for (const n of nodes) sortTagTree(n.children, order);
  return nodes;
}
