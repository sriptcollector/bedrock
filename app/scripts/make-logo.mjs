// Generates Bedrock's logo: a faceted stone drawn as a chunky 32x32 pixel block with a mottled,
// original pixel pattern (seeded, so it is the same on every run). Writes assets/icon.svg (app icon),
// assets/tray.svg (one-colour silhouette) and assets/logo/*.png + favicon. Then run `npm run icons -w app`.
// Drawn from scratch: no traced artwork and no game textures.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import png2icons from "png2icons";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const N = 32; // grid
const S = 32; // px per cell in the 1024 master

// Outline and facets in grid units.
const outline = [[16.5, 1.5], [24, 8.5], [24.5, 15], [28.5, 20.5], [24.5, 26], [23.5, 30.5], [10.5, 29.5], [3.5, 21.5], [7.5, 13], [8.5, 6.5]];
const facets = [
  { name: "top-left", pts: [[8.5, 6.5], [16.5, 1.5], [17.5, 5], [15.5, 12], [17, 19], [12.5, 19.5], [7.5, 13]],
    shades: ["#bcb6cf", "#aca5c2", "#9f98b6", "#cac4db", "#9288ad"] },
  { name: "right", pts: [[16.5, 1.5], [24, 8.5], [24.5, 15], [28.5, 20.5], [25, 25], [21, 19.5], [17, 19], [15.5, 12], [17.5, 5]],
    shades: ["#757089", "#68627d", "#807997", "#5b566e", "#7766a3"] },
  { name: "lower-left", pts: [[7.5, 13], [12.5, 19.5], [13, 24], [10.5, 29.5], [3.5, 21.5]],
    shades: ["#4b406a", "#40375d", "#574b7e", "#363050", "#2f2b3a"] },
  { name: "bottom", pts: [[12.5, 19.5], [17, 19], [21, 19.5], [25, 25], [24.5, 26], [23.5, 30.5], [10.5, 29.5], [13, 24]],
    shades: ["#2b2831", "#231f28", "#322e3a", "#1b191f", "#3d3056"] },
];

function inside(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// mulberry32
let seed = 0x5eed_b3d1;
const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (shades) => { const r = rand(); return r < 0.34 ? shades[0] : r < 0.6 ? shades[1] : r < 0.8 ? shades[2] : r < 0.93 ? shades[3] : shades[4]; };

const cells = [];
const filled = new Set();
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const cx = x + 0.5, cy = y + 0.5;
  if (!inside(outline, cx, cy)) continue;
  filled.add(`${x},${y}`);
  const f = facets.find((f) => inside(f.pts, cx, cy)) ?? facets[3];
  cells.push({ x, y, f, color: pick(f.shades) });
}
// Light seams where the top-left facet meets the others (the "cut" of the stone).
const facetAt = new Map(cells.map((c) => [`${c.x},${c.y}`, c.f]));
for (const c of cells) {
  if (c.f !== facets[0]) continue;
  const n = [[1, 0], [0, 1], [1, 1]].map(([dx, dy]) => facetAt.get(`${c.x + dx},${c.y + dy}`));
  if (n.some((f) => f && f !== facets[0])) c.color = rand() < 0.5 ? "#dcd6ea" : "#d0c9e2";
}
// Darken the outer ring a little so the block reads at small sizes.
const edge = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !filled.has(`${x + dx},${y + dy}`));
const darken = (hex, k) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, "0")).join("");
for (const c of cells) if (edge(c.x, c.y)) c.color = darken(c.color, 0.72);

const rects = cells.map((c) => `<rect x="${c.x * S}" y="${c.y * S}" width="${S}" height="${S}" fill="${c.color}"/>`).join("");
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" shape-rendering="crispEdges">${rects}</svg>\n`;
const traySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" shape-rendering="crispEdges">${cells.map((c) => `<rect x="${c.x * S}" y="${c.y * S}" width="${S}" height="${S}" fill="#000"/>`).join("")}</svg>\n`;

fs.writeFileSync(path.join(root, "assets", "icon.svg"), iconSvg);
fs.writeFileSync(path.join(root, "assets", "tray.svg"), traySvg);
const logoDir = path.join(root, "assets", "logo");
fs.mkdirSync(logoDir, { recursive: true });
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  fs.writeFileSync(path.join(logoDir, `bedrock-${size}.png`), new Resvg(iconSvg, { fitTo: { mode: "width", value: size } }).render().asPng());
}
const png256 = new Resvg(iconSvg, { fitTo: { mode: "width", value: 256 } }).render().asPng();
fs.writeFileSync(path.join(logoDir, "favicon.ico"), png2icons.createICO(png256, png2icons.BICUBIC2, 0, false, true));
fs.copyFileSync(path.join(root, "assets", "icon.svg"), path.join(logoDir, "bedrock.svg"));
console.log(`logo: ${cells.length} pixels -> assets/icon.svg, assets/tray.svg, assets/logo/`);
