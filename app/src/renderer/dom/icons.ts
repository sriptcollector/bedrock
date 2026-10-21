// Icons: the full Lucide set (ISC licence) addressable as "name" or "lucide-name", plus custom
// icons registered with addIcon (Obsidian API). Lucide is what Obsidian plugins and themes expect.
import { icons as lucide } from "lucide";

type IconNode = [string, Record<string, string | number>][];

const custom = new Map<string, string>();
// Our own drawings for the app's few non-Lucide icons (100x100 box like addIcon): a window
// outline with a solid panel on the side the button toggles.
const sidePanel = (x: number) =>
  `<rect x="10" y="16" width="80" height="68" rx="12" fill="none" stroke="currentColor" stroke-width="8.5"/>` +
  `<rect x="${x}" y="27" width="17" height="46" rx="4" fill="currentColor"/>`;
custom.set("sidebar-toggle-button-icon", sidePanel(22));
custom.set("sidebar-left", sidePanel(22));
custom.set("sidebar-right", sidePanel(61));
const pascalToKebab = new Map<string, string>();
const kebabToPascal = new Map<string, string>();
for (const k of Object.keys(lucide)) {
  const kebab = k
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-zA-Z])(\d)/g, "$1-$2")
    .toLowerCase();
  pascalToKebab.set(k, kebab);
  kebabToPascal.set(kebab, k);
  kebabToPascal.set(kebab.replace(/-(\d)/g, "$1"), k);
}

// Names older Obsidian plugins use for built-in icons.
const LEGACY: Record<string, string> = {
  "left-arrow": "arrow-left",
  "right-arrow": "arrow-right",
  "up-arrow-with-tail": "arrow-up",
  "down-arrow-with-tail": "arrow-down",
  "left-arrow-with-tail": "arrow-left",
  "right-arrow-with-tail": "arrow-right",
  "right-triangle": "chevron-right",
  "cross": "x",
  "cross-in-box": "x-square",
  "documents": "files",
  "document": "file",
  "dice": "dices",
  "gear": "settings",
  "install": "download",
  "pencil": "pencil",
  "pane-layout": "layout",
  "popup-open": "external-link",
  "reset": "rotate-ccw",
  "sheets-in-box": "archive",
  "star": "star",
  "trash": "trash-2",
  "vertical-split": "columns-2",
  "horizontal-split": "rows-2",
  "checkmark": "check",
  "check-small": "check",
  "bullet-list": "list",
  "enter": "corner-down-left",
  "help": "help-circle",
  "info": "info",
  "link": "link",
  "lines-of-text": "align-left",
  "magnifying-glass": "search",
  "open-vault": "folder-open",
  "paper-plane": "send",
  "plus-with-circle": "plus-circle",
  "presentation": "presentation",
  "uppercase-lowercase-a": "case-sensitive",
  "go-to-file": "file-search",
  "hashtag": "hash",
  "image-file": "image",
  "audio-file": "file-audio",
  "pdf-file": "file-text",
  "dot-network": "git-fork",
  "blocks": "blocks",
  "switch": "shuffle",
};

export function iconNodeFor(id: string): IconNode | null {
  let name = id.startsWith("lucide-") ? id.slice(7) : id;
  name = LEGACY[name] ?? name;
  const pascal = kebabToPascal.get(name) ?? ((lucide as any)[name] ? name : undefined);
  const node = pascal ? (lucide as any)[pascal] : undefined;
  return node ?? null;
}

export function getIcon(id: string): SVGSVGElement | null {
  const svgNs = "http://www.w3.org/2000/svg";
  if (custom.has(id)) {
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.innerHTML = custom.get(id)!;
    svg.classList.add("svg-icon", id);
    return svg;
  }
  const node = iconNodeFor(id);
  if (!node) return null;
  const svg = document.createElementNS(svgNs, "svg");
  const attrs: Record<string, string> = {
    xmlns: svgNs,
    width: "24",
    height: "24",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  for (const [tag, a] of node) {
    const child = document.createElementNS(svgNs, tag);
    for (const [k, v] of Object.entries(a)) child.setAttribute(k, String(v));
    svg.appendChild(child);
  }
  const base = id.startsWith("lucide-") ? id : "lucide-" + (LEGACY[id] ?? id);
  svg.classList.add("svg-icon", base);
  return svg;
}

export function setIcon(parent: HTMLElement, id: string, _size?: number): void {
  parent.querySelectorAll(":scope > svg.svg-icon").forEach((e) => e.remove());
  const svg = getIcon(id);
  if (svg) parent.prepend(svg);
}

export function addIcon(id: string, svgContent: string): void {
  custom.set(id, svgContent);
}

export function removeIcon(id: string): void {
  custom.delete(id);
}

export function getIconIds(): string[] {
  return [...custom.keys(), ...[...pascalToKebab.values()].map((k) => "lucide-" + k)];
}
