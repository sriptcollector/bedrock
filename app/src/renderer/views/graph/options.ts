// Graph view options: defaults, slider mappings and the graph.json file shape (`.obsidian/graph.json`
// for the global graph; the local graph keeps the same object in its leaf state as `options`).
// Key order matches what Obsidian writes so a vault that round-trips through Bedrock stays diff-clean.

export interface GraphColor {
  a: number;
  rgb: number;
}

export interface ColorGroup {
  query: string;
  color: GraphColor;
}

export interface GraphOptions {
  "collapse-filter": boolean;
  search: string;
  showTags: boolean;
  showAttachments: boolean;
  hideUnresolved: boolean;
  showOrphans: boolean;
  "collapse-color-groups": boolean;
  colorGroups: ColorGroup[];
  "collapse-display": boolean;
  showArrow: boolean;
  textFadeMultiplier: number;
  nodeSizeMultiplier: number;
  lineSizeMultiplier: number;
  "collapse-forces": boolean;
  centerStrength: number;
  repelStrength: number;
  linkStrength: number;
  linkDistance: number;
  scale: number;
  close: boolean;
  // Local graph only.
  localJumps: number;
  localBacklinks: boolean;
  localForelinks: boolean;
  localInterlinks: boolean;
  [key: string]: any;
}

/** Slider position (0..1) -> force strength sent to the simulation (log scale, floor `t`). */
export function sliderToStrength(x: number, t = 0.01): number {
  return (Math.pow(t, 1 - x) - t) / (1 - t);
}

/** Inverse of sliderToStrength. */
export function strengthToSlider(s: number, t = 0.01): number {
  return 1 - Math.log(s * (1 - t) + t) / Math.log(t);
}

export const FILTER_DEFAULTS = {
  search: "",
  showTags: false,
  showAttachments: false,
  hideUnresolved: false,
  showOrphans: true,
};

export const LOCAL_FILTER_DEFAULTS = {
  localJumps: 1,
  localBacklinks: true,
  localForelinks: true,
  localInterlinks: false,
};

export const DISPLAY_DEFAULTS = {
  showArrow: false,
  textFadeMultiplier: 0,
  nodeSizeMultiplier: 1,
  lineSizeMultiplier: 1,
};

export const FORCE_DEFAULTS = {
  centerStrength: strengthToSlider(0.1),
  repelStrength: 10,
  linkStrength: strengthToSlider(1),
  linkDistance: 250,
};

const GLOBAL_ORDER = [
  "collapse-filter",
  "search",
  "showTags",
  "showAttachments",
  "hideUnresolved",
  "showOrphans",
  "collapse-color-groups",
  "colorGroups",
  "collapse-display",
  "showArrow",
  "textFadeMultiplier",
  "nodeSizeMultiplier",
  "lineSizeMultiplier",
  "collapse-forces",
  "centerStrength",
  "repelStrength",
  "linkStrength",
  "linkDistance",
  "scale",
  "close",
];

const LOCAL_ORDER = [
  "collapse-filter",
  "search",
  "localJumps",
  "localBacklinks",
  "localForelinks",
  "localInterlinks",
  "showTags",
  "showAttachments",
  "hideUnresolved",
  "collapse-color-groups",
  "colorGroups",
  "collapse-display",
  "showArrow",
  "textFadeMultiplier",
  "nodeSizeMultiplier",
  "lineSizeMultiplier",
  "collapse-forces",
  "centerStrength",
  "repelStrength",
  "linkStrength",
  "linkDistance",
  "scale",
  "close",
];

export function defaultOptions(local = false): GraphOptions {
  return {
    "collapse-filter": true,
    ...FILTER_DEFAULTS,
    ...LOCAL_FILTER_DEFAULTS,
    "collapse-color-groups": true,
    colorGroups: [],
    "collapse-display": true,
    ...DISPLAY_DEFAULTS,
    "collapse-forces": true,
    ...FORCE_DEFAULTS,
    scale: 1,
    close: local ? false : false,
  } as GraphOptions;
}

function sameType(a: any, b: any): boolean {
  if (Array.isArray(a)) return Array.isArray(b);
  return typeof a === typeof b;
}

/** Merge stored options over the defaults; wrong-typed values fall back to the default. */
export function mergeOptions(stored: any, local = false): GraphOptions {
  const out = defaultOptions(local);
  if (!stored || typeof stored !== "object") return out;
  for (const [k, v] of Object.entries(stored)) {
    if (k in out) {
      if (sameType(out[k], v) && !(typeof v === "number" && !Number.isFinite(v))) out[k] = k === "colorGroups" ? normalizeGroups(v) : v;
    } else out[k] = v; // unknown keys survive a round trip
  }
  return out;
}

function normalizeGroups(v: any): ColorGroup[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((g) => g && typeof g === "object")
    .map((g) => ({ query: typeof g.query === "string" ? g.query : "", color: { a: Number(g.color?.a ?? 1), rgb: Number(g.color?.rgb ?? 0) | 0 } }));
}

/** The object written to graph.json (global) or the leaf state (local), in Obsidian's key order. */
export function serializeOptions(o: GraphOptions, local = false): Record<string, any> {
  const order = local ? LOCAL_ORDER : GLOBAL_ORDER;
  const out: Record<string, any> = {};
  for (const k of order) if (o[k] !== undefined) out[k] = o[k];
  const known = new Set([...GLOBAL_ORDER, ...LOCAL_ORDER]);
  for (const [k, v] of Object.entries(o)) if (!known.has(k) && !(k in out)) out[k] = v;
  return out;
}

/** graph.json text as Obsidian writes it (two-space JSON). */
export function graphJsonText(o: GraphOptions): string {
  return JSON.stringify(serializeOptions(o, false), null, 2);
}

/** Colour of the n-th new group: hue steps of 40 degrees, a little more saturated in dark mode. */
export function newGroupColor(index: number, dark: boolean): GraphColor {
  return { a: 1, rgb: hslToInt(40 * index, dark ? 70 : 60, 60) };
}

export function hslToInt(h: number, s: number, l: number): number {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const r = Math.round(f(0) * 255), g = Math.round(f(8) * 255), b = Math.round(f(4) * 255);
  return (r << 16) | (g << 8) | b;
}

export function intToHex(rgb: number): string {
  return "#" + (rgb & 0xffffff).toString(16).padStart(6, "0");
}

export function hexToInt(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return parseInt(full, 16) || 0;
}
