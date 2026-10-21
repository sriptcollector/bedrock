// "Export as image": draws the whole canvas (groups, cards with their text, images, edges with arrows
// and labels) onto a 2D canvas at 2x and returns PNG bytes. Colours come from the theme variables.
import type { Canvas } from "./canvas";
import { FileNode } from "./nodes";
import { IMAGE_EXTS } from "./nodes";
import { bezierPoint, edgeGeometry, END_ROTATION, expandBBox, unionBBox } from "./geometry";

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
}

function colorOf(color: string | undefined): string {
  if (!color) return cssVar("--canvas-color", "#c0c0c0");
  if (/^[1-6]$/.test(color)) return cssVar(`--canvas-color-${color}`, "#c0c0c0");
  return color;
}

function withAlpha(c: string, a: number): string {
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.fillStyle = c;
  const v = ctx.fillStyle as string; // #rrggbb or rgba()
  if (v.startsWith("#")) {
    const n = parseInt(v.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  return v.replace(/rgba?\(([^)]+)\)/, (_m, inner) => `rgba(${inner.split(",").slice(0, 3).join(",")},${a})`);
}

function plain(md: string): string[] {
  return md
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .replace(/!\[\[([^\]]+)\]\]/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .split("\n");
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? line + " " + word : word;
    if (ctx.measureText(next).width > width && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  out.push(line);
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export async function renderCanvasPng(c: Canvas): Promise<ArrayBuffer> {
  const nodes = [...c.nodes.values()].sort((a, b) => a.renderZ() - b.renderZ());
  const box = expandBBox(unionBBox(nodes.map((n) => n.getBBox())), 40);
  const pixel = 2;
  const W = Math.ceil(box.maxX - box.minX), H = Math.ceil(box.maxY - box.minY);
  const max = 16384 / pixel;
  const fit = Math.min(1, max / W, max / H);
  const el = document.createElement("canvas");
  el.width = Math.ceil(W * pixel * fit);
  el.height = Math.ceil(H * pixel * fit);
  const ctx = el.getContext("2d")!;
  ctx.scale(pixel * fit, pixel * fit);
  ctx.translate(-box.minX, -box.minY);
  const bg = cssVar("--canvas-background", "#ffffff");
  const text = cssVar("--text-normal", "#222222");
  const muted = cssVar("--text-muted", "#5c5c5c");
  const font = cssVar("--font-text", "sans-serif");
  ctx.fillStyle = bg;
  ctx.fillRect(box.minX, box.minY, W, H);
  // nodes (groups are first in z order)
  for (const n of nodes) {
    const d = n.data;
    const col = colorOf(d.color);
    if (d.type === "group") {
      roundRect(ctx, d.x, d.y, d.width, d.height, 8);
      ctx.fillStyle = withAlpha(col, 0.07);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.stroke();
      if (d.label) {
        ctx.font = `22px ${font}`;
        const w = ctx.measureText(d.label).width + 16;
        roundRect(ctx, d.x, d.y - 34, w, 30, 4);
        ctx.fillStyle = withAlpha(col, 0.1);
        ctx.fill();
        ctx.fillStyle = muted;
        ctx.textBaseline = "middle";
        ctx.fillText(d.label, d.x + 8, d.y - 19);
      }
      continue;
    }
    roundRect(ctx, d.x, d.y, d.width, d.height, 8);
    ctx.fillStyle = bg;
    ctx.fill();
    if (d.color) {
      ctx.fillStyle = withAlpha(col, 0.07);
      ctx.fill();
    }
    ctx.save();
    roundRect(ctx, d.x, d.y, d.width, d.height, 8);
    ctx.clip();
    ctx.fillStyle = text;
    ctx.textBaseline = "top";
    let lines: string[] = [];
    if (d.type === "text") lines = plain(d.text ?? "");
    else if (d.type === "link") lines = [d.url ?? ""];
    else if (d.type === "file" && n instanceof FileNode && n.file) {
      if (IMAGE_EXTS.includes(n.file.extension)) {
        // read the bytes ourselves so the drawing canvas isn't tainted by a file:// image
        const bytes: ArrayBuffer = await c.app.vault.readBinary(n.file);
        const mime = n.file.extension === "svg" ? "image/svg+xml" : `image/${n.file.extension === "jpg" ? "jpeg" : n.file.extension}`;
        const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        const img = await loadImage(url);
        URL.revokeObjectURL(url);
        if (img) {
          const s = Math.min(d.width / img.naturalWidth, d.height / img.naturalHeight);
          const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
          ctx.drawImage(img, d.x + (d.width - iw) / 2, d.y + (d.height - ih) / 2, iw, ih);
        }
      } else if (n.file.extension === "md") {
        lines = ["# " + n.file.basename, ...plain(await c.app.vault.cachedRead(n.file))];
      } else lines = [n.file.name];
    }
    let y = d.y + 16;
    for (const raw of lines) {
      const h = /^(#{1,6})\s+(.*)$/.exec(raw);
      const size = h ? Math.max(18, 28 - h[1].length * 2) : 16;
      ctx.font = `${h ? "bold " : ""}${size}px ${font}`;
      for (const l of wrap(ctx, h ? h[2] : raw, d.width - 32)) {
        if (y > d.y + d.height) break;
        ctx.fillText(l, d.x + 16, y);
        y += size * 1.5;
      }
    }
    ctx.restore();
    roundRect(ctx, d.x, d.y, d.width, d.height, 8);
    ctx.strokeStyle = d.color ? col : cssVar("--canvas-color", "#c0c0c0");
    ctx.lineWidth = d.color ? 2 : 1;
    ctx.stroke();
    if (d.type === "file" || d.type === "link") {
      ctx.font = `15px ${font}`;
      ctx.fillStyle = cssVar("--canvas-card-label-color", "#ababab");
      ctx.textBaseline = "bottom";
      const label = d.type === "file" ? (d.file ?? "").split("/").pop()!.replace(/\.md$/i, "") : d.url ?? "";
      ctx.fillText(label, d.x, d.y - 4);
    }
  }
  // edges on top
  for (const e of c.edges.values()) {
    const col = colorOf(e.data.color);
    const g = edgeGeometry(e.from.node.getBBox(), e.from.side, e.to.node.getBBox(), e.to.side, e.from.end === "arrow", e.to.end === "arrow");
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.stroke(new Path2D(g.path));
    const arrow = (p: { x: number; y: number }, side: string) => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(((END_ROTATION as any)[side] * Math.PI) / 180);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(6.5, 10.4);
      ctx.lineTo(-6.5, 10.4);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
      ctx.restore();
    };
    if (e.from.end === "arrow") arrow(g.fromPoint, e.from.side);
    if (e.to.end === "arrow") arrow(g.toPoint, e.to.side);
    if (e.data.label) {
      const m = bezierPoint(g.bezier, 0.5);
      ctx.font = `20px ${font}`;
      const w = ctx.measureText(e.data.label).width + 12;
      ctx.fillStyle = bg;
      roundRect(ctx, m.x - w / 2, m.y - 16, w, 32, 4);
      ctx.fill();
      ctx.fillStyle = text;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillText(e.data.label, m.x, m.y);
      ctx.textAlign = "start";
    }
  }
  const blob: Blob = await new Promise((res, rej) => el.toBlob((b) => (b ? res(b) : rej(new Error("the image couldn't be created"))), "image/png"));
  return blob.arrayBuffer();
}
