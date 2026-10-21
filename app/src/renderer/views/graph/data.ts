// Builds the graph (nodes + directed links) from the metadata cache, applying the filters, colour
// groups, local-graph depth and orphan rules. Pure functions so they can be unit tested.
import type { GraphColor } from "./options";

export type NodeType = "" | "attachment" | "unresolved" | "tag" | "focused";
export type FilterType = "" | "attachment" | "unresolved" | "tag";

export interface GraphNodeData {
  type: NodeType;
  links: Record<string, true>;
  color?: GraphColor;
}

export interface GraphData {
  nodes: Record<string, GraphNodeData>;
  /** Local graph: per-node weight (focus = 30, falling off per jump); global graph uses link counts. */
  weights?: Record<string, number>;
  /** Number of link steps (used to pace the timelapse animation). */
  numLinks?: number;
}

/** Returns false to hide a node, true to show it, or a colour from a matching colour group. */
export type NodeFilter = (id: string, type: FilterType) => boolean | GraphColor;

export interface GraphSource {
  /** Every indexed file path (notes, canvases, bases and attachments). */
  files: string[];
  resolvedLinks: Record<string, Record<string, number>>;
  unresolvedLinks: Record<string, Record<string, number>>;
  /** Tags of a file ("#tag"), body and frontmatter. */
  fileTags(path: string): string[] | null;
  /** All tags in the vault (used to merge tags that differ only in case). */
  vaultTags(): string[];
  isUserIgnored(path: string): boolean;
  /** Creation time used to order the timelapse. */
  fileTime?(path: string): number;
}

const NON_ATTACHMENT = new Set(["md", "canvas", "base"]);

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isAttachmentPath(path: string): boolean {
  return !NON_ATTACHMENT.has(extensionOf(path));
}

/** Label shown under a node: the file name without folders, ".md" dropped. Tags keep their "#". */
export function nodeDisplayText(id: string): string {
  const name = id.slice(id.lastIndexOf("/") + 1);
  return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

export interface BuildOptions {
  showTags: boolean;
  showAttachments: boolean;
  hideUnresolved: boolean;
  showOrphans: boolean;
}

/**
 * Global graph data. `progression` > 0 limits the graph to the first `progression` link steps of
 * files sorted by creation time (the timelapse animation).
 */
export function buildGraphData(src: GraphSource, o: BuildOptions, filter: NodeFilter = () => true, progression = 0): GraphData {
  const tagCase: Record<string, string> = {};
  if (o.showTags) for (const t of src.vaultTags()) tagCase[t.toLowerCase()] = t;
  const nodes: Record<string, GraphNodeData> = {};
  let files = src.files;
  if (progression) {
    const time = new Map(files.map((f) => [f, src.fileTime ? src.fileTime(f) : 0] as const));
    files = files.slice().sort((a, b) => time.get(a)! - time.get(b)!);
  }
  let count = 0;
  let stopAt = "";
  const step = (path: string): boolean => {
    let ok = false;
    if (!progression || count < progression) ok = true;
    else if (count === progression) stopAt = path;
    count++;
    return ok;
  };
  for (const path of files) {
    const att = isAttachmentPath(path);
    if (!o.showAttachments && att) continue;
    const type: FilterType = att ? "attachment" : "";
    const f = filter(path, type);
    if (!f || src.isUserIgnored(path)) continue;
    const node: GraphNodeData = (nodes[path] = { type, links: {} });
    if (o.showOrphans) {
      if (count === progression) stopAt = path;
      count++;
    }
    if (f !== true) node.color = f;
    const res = src.resolvedLinks[path];
    if (res) {
      for (const target of Object.keys(res)) {
        const tAtt = isAttachmentPath(target);
        if (!o.showAttachments && tAtt) continue;
        if (!filter(target, tAtt ? "attachment" : "")) continue;
        if (step(path)) node.links[target] = true;
      }
    }
    if (!o.hideUnresolved) {
      const un = src.unresolvedLinks[path];
      if (un)
        for (const target of Object.keys(un)) {
          if (!filter(target, "unresolved")) continue;
          if (step(path)) {
            node.links[target] = true;
            if (!nodes[target]) nodes[target] = { type: "unresolved", links: {} };
          }
        }
    }
    if (o.showTags) {
      const tags = src.fileTags(path);
      if (tags)
        for (const tag of tags) {
          if (!filter(tag, "tag")) continue;
          const canon = tagCase[tag.toLowerCase()] ?? tag;
          if (step(path)) node.links[canon] = true;
          if (!nodes[canon]) nodes[canon] = { type: "tag", links: {} };
        }
    }
  }
  if (progression && stopAt) {
    const idx = files.indexOf(stopAt);
    if (idx !== -1) for (let j = idx + 1; j < files.length; j++) delete nodes[files[j]];
  }
  return { nodes, numLinks: count };
}

export interface LocalOptions {
  localFile: string;
  localJumps: number;
  localInterlinks: boolean;
  localForelinks: boolean;
  localBacklinks: boolean;
}

const NO_EXPAND = new Set<string>(["tag"]);

function cloneNode(n: GraphNodeData | undefined): GraphNodeData {
  if (!n) return { type: "", links: {} };
  const c: GraphNodeData = { type: n.type, links: {} };
  if (n.color) c.color = n.color;
  return c;
}

/** Restrict graph data to the neighbourhood of one file, `localJumps` links deep. */
export function localGraph(data: GraphData, o: LocalOptions): GraphData {
  const all = data.nodes;
  const out: Record<string, GraphNodeData> = {};
  const weights: Record<string, number> = {};
  const focus = o.localFile;
  weights[focus] = 30;
  if (!all[focus]) {
    out[focus] = { type: "", links: {} };
    return { nodes: out, weights, numLinks: data.numLinks };
  }
  out[focus] = { type: all[focus].type, links: {} };
  const jumps = Math.max(1, Math.round(o.localJumps));
  const stepW = 30 / jumps;
  for (let p = 0; p < jumps; p++) {
    const added: Record<string, GraphNodeData> = {};
    for (const id of Object.keys(all)) {
      const n = all[id];
      if (n.type === "tag") continue;
      for (const target of Object.keys(n.links)) {
        if (o.localForelinks && out[id] && !out[target] && !NO_EXPAND.has(out[id].type)) {
          added[target] = added[target] ?? cloneNode(all[target]);
          out[id].links[target] = true;
        } else if (o.localBacklinks && out[target] && !out[id] && !NO_EXPAND.has(out[target].type)) {
          added[id] = added[id] ?? cloneNode(all[id]);
          added[id].links[target] = true;
        }
      }
    }
    for (const k of Object.keys(added)) {
      out[k] = added[k];
      weights[k] = 30 - stepW * (p + 1);
    }
  }
  if (o.localInterlinks) for (const k of Object.keys(out)) if (all[k]) out[k] = all[k];
  return { nodes: out, weights, numLinks: data.numLinks };
}

/** Drop nodes that have no links in or out (the "Orphans" toggle turned off). */
export function removeOrphans(data: GraphData): void {
  const nodes = data.nodes;
  const targeted = new Set<string>();
  for (const id of Object.keys(nodes)) for (const t of Object.keys(nodes[id].links)) if (t !== id) targeted.add(t);
  for (const id of Object.keys(nodes)) {
    const links = nodes[id].links;
    let linked = false;
    for (const t of Object.keys(links))
      if (t !== id && nodes[t]) {
        linked = true;
        break;
      }
    if (!linked && !targeted.has(id)) delete nodes[id];
  }
}

/** Mark the open file's node so it's drawn in the focus colour. */
export function markFocused(data: GraphData, path: string): void {
  const n = path ? data.nodes[path] : undefined;
  if (n) n.type = "focused";
}

// ---------- flat arrays for the simulation and renderer ----------

export interface FlatGraph {
  ids: string[];
  index: Map<string, number>;
  types: NodeType[];
  colors: (GraphColor | null)[];
  /** link i goes from src[i] to dst[i] */
  src: Uint32Array;
  dst: Uint32Array;
  /** links out + links in per node */
  weight: Float32Array;
}

export function flatten(data: GraphData): FlatGraph {
  const ids = Object.keys(data.nodes);
  const index = new Map<string, number>();
  ids.forEach((id, i) => index.set(id, i));
  const types: NodeType[] = [];
  const colors: (GraphColor | null)[] = [];
  const s: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    const n = data.nodes[ids[i]];
    types.push(n.type);
    colors.push(n.color ?? null);
    for (const t of Object.keys(n.links)) {
      const j = index.get(t);
      if (j === undefined || j === i) continue;
      s.push(i);
      d.push(j);
    }
  }
  const src = Uint32Array.from(s);
  const dst = Uint32Array.from(d);
  const weight = new Float32Array(ids.length);
  if (data.weights) {
    for (let i = 0; i < ids.length; i++) weight[i] = data.weights[ids[i]] ?? 0;
  } else {
    // links in + links out (a pair linked both ways counts twice, like Obsidian)
    for (let k = 0; k < src.length; k++) {
      weight[src[k]]++;
      weight[dst[k]]++;
    }
  }
  return { ids, index, types, colors, src, dst, weight };
}

/** Node radius before zoom scaling: grows with the square root of its link count, 8..30. */
export function nodeSize(weight: number, mult: number): number {
  return mult * Math.max(8, Math.min(3 * Math.sqrt(weight + 1), 30));
}
