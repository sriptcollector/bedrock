// JSON Canvas 1.0 (https://jsoncanvas.org, open spec): parse, normalise and serialise `.canvas` files.
// The writer produces the same text Obsidian writes for the same canvas: tab-indented, one line per
// node/edge, core keys in a fixed order after any extra keys, unknown fields kept, default edge ends
// omitted. That keeps canvases diff-clean when a vault is edited with both apps.

export type Side = "top" | "right" | "bottom" | "left";
export type EdgeEnd = "none" | "arrow";
export type CanvasColor = string; // "1".."6" or "#rrggbb"

export interface CanvasNodeData {
  id: string;
  type: "text" | "file" | "link" | "group" | string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: CanvasColor;
  text?: string;
  file?: string;
  subpath?: string;
  url?: string;
  label?: string;
  background?: string;
  backgroundStyle?: "cover" | "ratio" | "repeat" | string;
  [key: string]: any;
}

export interface CanvasEdgeData {
  id: string;
  fromNode: string;
  fromSide?: Side;
  fromEnd?: EdgeEnd;
  toNode: string;
  toSide?: Side;
  toEnd?: EdgeEnd;
  color?: CanvasColor;
  label?: string;
  [key: string]: any;
}

export interface CanvasData {
  nodes: CanvasNodeData[];
  edges: CanvasEdgeData[];
  [key: string]: any;
}

export const SIDES: Side[] = ["top", "right", "bottom", "left"];

/** Parse a .canvas file. Empty text is an empty canvas; anything that isn't an object is rejected. */
export function parseCanvas(text: string): CanvasData {
  if (!text || !text.trim()) return { nodes: [], edges: [] };
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("This file isn't a canvas (expected a JSON object).");
  // spread keeps the original key order of the top-level object (unknown keys survive)
  const out: CanvasData = { ...raw } as CanvasData;
  out.nodes = Array.isArray(raw.nodes) ? raw.nodes.filter(isNodeLike).map(cleanNode) : [];
  out.edges = Array.isArray(raw.edges) ? raw.edges.filter(isEdgeLike).map((e: any) => ({ ...e })) : [];
  return out;
}

function isNodeLike(n: any): boolean {
  return n && typeof n === "object" && typeof n.id === "string" && typeof n.type === "string";
}

function isEdgeLike(e: any): boolean {
  return e && typeof e === "object" && typeof e.id === "string" && typeof e.fromNode === "string" && typeof e.toNode === "string";
}

function cleanNode(n: any): CanvasNodeData {
  const out = { ...n };
  for (const k of ["x", "y", "width", "height"]) {
    const v = Number(out[k]);
    out[k] = Number.isFinite(v) ? v : k === "width" || k === "height" ? 100 : 0;
  }
  return out;
}

const NODE_CORE = ["x", "y", "width", "height", "color"];
const EDGE_CORE = ["fromNode", "fromSide", "toNode", "toSide", "fromEnd", "toEnd", "color", "label"];

function omit(o: Record<string, any>, keys: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(o)) if (!keys.includes(k)) out[k] = v;
  return out;
}

/** A node as it's written: extra keys first (original order), then geometry, colour and type keys. */
export function nodeForSave(n: CanvasNodeData): CanvasNodeData {
  let typeKeys: string[] = [];
  if (n.type === "group") typeKeys = ["label", "background"];
  const base: Record<string, any> = omit(n, [...NODE_CORE, ...typeKeys]);
  // `id` always present; for nodes created in this session the id/type come first
  const out: Record<string, any> = { ...base, id: n.id };
  out.x = Math.round(n.x);
  out.y = Math.round(n.y);
  out.width = Math.round(n.width);
  out.height = Math.round(n.height);
  if (n.color) out.color = n.color;
  switch (n.type) {
    case "text":
      out.type = "text";
      out.text = n.text ?? "";
      break;
    case "file":
      out.type = "file";
      out.file = n.file ?? "";
      out.subpath = n.subpath || undefined;
      break;
    case "link":
      out.type = "link";
      out.url = n.url ?? "";
      break;
    case "group":
      out.type = "group";
      if (n.label) out.label = n.label;
      if (n.background) {
        out.background = n.background;
        if (n.backgroundStyle && n.backgroundStyle !== "cover") out.backgroundStyle = n.backgroundStyle;
      }
      break;
  }
  return out as CanvasNodeData;
}

/** An edge as it's written: default ends ("none" at the start, "arrow" at the end) are left out. */
export function edgeForSave(e: CanvasEdgeData): CanvasEdgeData {
  const out: Record<string, any> = { ...omit(e, EDGE_CORE), id: e.id };
  out.fromNode = e.fromNode;
  if (e.fromSide) out.fromSide = e.fromSide;
  out.toNode = e.toNode;
  if (e.toSide) out.toSide = e.toSide;
  if (e.fromEnd && e.fromEnd !== "none") out.fromEnd = e.fromEnd;
  if (e.toEnd && e.toEnd !== "arrow") out.toEnd = e.toEnd;
  if (e.color) out.color = e.color;
  if (e.label) out.label = e.label;
  return out as CanvasEdgeData;
}

/** Groups first (largest area first, so they sit behind), then the other nodes in stacking order. */
export function orderNodes(nodes: CanvasNodeData[]): CanvasNodeData[] {
  const groups = nodes.filter((n) => n.type === "group").sort((a, b) => b.width * b.height - a.width * a.height);
  const rest = nodes.filter((n) => n.type !== "group");
  return [...groups, ...rest];
}

/** The text of a .canvas file for `data` (nodes in the given stacking order). */
export function serializeCanvas(data: CanvasData, opts: { reorder?: boolean } = {}): string {
  const nodes = opts.reorder === false ? data.nodes : orderNodes(data.nodes);
  const out: Record<string, any> = { ...data, nodes: nodes.map(nodeForSave), edges: data.edges.map(edgeForSave) };
  return formatJson(out);
}

// ---------- compact JSON writer ----------

function isScalar(v: any): boolean {
  return typeof v !== "object";
}

/** Objects/arrays whose values are all scalars go on one line; everything else is expanded with tabs. */
export function formatJson(value: any, indent = "\t"): string {
  return lines(value, indent).join("\n");
}

function lines(v: any, indent: string): string[] {
  if (v === undefined) return ["null"];
  if (isScalar(v) || !v || Object.prototype.toString.call(v) === "[object Date]") return [JSON.stringify(v)];
  if (Array.isArray(v)) {
    if (v.every(isScalar)) return [JSON.stringify(v)];
    const out = ["["];
    v.forEach((item, i) => {
      const sub = lines(item, indent);
      sub.forEach((s, j) => out.push(indent + s + (j === sub.length - 1 && i !== v.length - 1 ? "," : "")));
    });
    out.push("]");
    return out;
  }
  const keys = Object.keys(v);
  if (keys.every((k) => isScalar(v[k]))) return [JSON.stringify(v)];
  const live = keys.filter((k) => v[k] !== undefined);
  const out = ["{"];
  live.forEach((k, i) => {
    const sub = lines(v[k], indent);
    sub[0] = JSON.stringify(k) + ":" + sub[0];
    sub.forEach((s, j) => out.push(indent + s + (j === sub.length - 1 && i !== live.length - 1 ? "," : "")));
  });
  out.push("}");
  return out;
}

// ---------- ids and colours ----------

/** 16 hex characters, like the ids Obsidian creates. */
export function randomId(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** "1".."6" preset, "#rrggbb" custom, anything else -> no colour. */
export function normalizeColor(c: any): CanvasColor {
  if (typeof c !== "string") return "";
  const s = c.trim();
  if (/^[1-6]$/.test(s)) return s;
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(s)) return s.toLowerCase();
  return "";
}

/** Every vault path a canvas refers to: file nodes, group backgrounds and [[links]] in text nodes. */
export function canvasLinkTargets(data: CanvasData): { link: string; kind: "file" | "text" | "background" }[] {
  const out: { link: string; kind: "file" | "text" | "background" }[] = [];
  for (const n of data.nodes) {
    if (n.type === "file" && typeof n.file === "string" && n.file) out.push({ link: n.file, kind: "file" });
    else if (n.type === "text" && typeof n.text === "string") {
      for (const m of n.text.matchAll(/!?\[\[([^\]|#^]*)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g)) if (m[1].trim()) out.push({ link: m[1].trim(), kind: "text" });
      for (const m of n.text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const target = decodeURIComponentSafe(m[1]);
        if (!/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith("#")) out.push({ link: target.split("#")[0], kind: "text" });
      }
    } else if (n.type === "group" && typeof n.background === "string" && n.background) out.push({ link: n.background, kind: "background" });
  }
  return out;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
