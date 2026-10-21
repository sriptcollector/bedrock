// Custom icon ids the sidebar panes use (themes target their class names). Drawn by us in a
// 100x100 box with Lucide-like strokes.
import { addIcon } from "../../dom/icons";

const S = 'fill="none" stroke="currentColor" stroke-width="8.33" stroke-linecap="round" stroke-linejoin="round"';

// Link glyph (two chain halves) scaled into the top-left 70% of the box.
const CHAIN = `<g transform="translate(4 4) scale(2.9)"><path ${S.replace("8.33", "2.6")} d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path ${S.replace("8.33", "2.6")} d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></g>`;

export function registerSidebarIcons(): void {
  addIcon("right-triangle", `<path ${S} d="M37 22 L65 50 L37 78"/>`);
  addIcon("links-coming-in", `${CHAIN}<path ${S} d="M92 62 L66 88 M66 64 L66 88 L90 88"/>`);
  addIcon("links-going-out", `${CHAIN}<path ${S} d="M66 88 L92 62 M70 62 L92 62 L92 84"/>`);
  addIcon("heading-glyph", `<path ${S} d="M28 20 V80 M72 20 V80 M28 50 H72"/>`);
  addIcon("vault", `<path ${S} d="M20 14 H80 A6 6 0 0 1 86 20 V80 A6 6 0 0 1 80 86 H20 A6 6 0 0 1 14 80 V20 A6 6 0 0 1 20 14 Z"/><circle ${S} cx="50" cy="50" r="16"/><path ${S} d="M50 34 V26 M50 66 V74 M34 50 H26 M66 50 H74"/>`);
}
