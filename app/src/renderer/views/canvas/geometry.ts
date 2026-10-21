// Canvas geometry: boxes, connection points, curved edge paths (cubic Bezier leaving each side
// perpendicular to it), automatic side choice, grid spacing and snapping. Pure functions.
import type { Side } from "./format";

export interface Point {
  x: number;
  y: number;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function bboxOf(r: Rect): BBox {
  return { minX: r.x, minY: r.y, maxX: r.x + r.width, maxY: r.y + r.height };
}

export function rectOf(b: BBox): Rect {
  return { x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY };
}

export function unionBBox(list: BBox[]): BBox {
  const out = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const b of list) {
    out.minX = Math.min(out.minX, b.minX);
    out.minY = Math.min(out.minY, b.minY);
    out.maxX = Math.max(out.maxX, b.maxX);
    out.maxY = Math.max(out.maxY, b.maxY);
  }
  return out;
}

export function expandBBox(b: BBox, by: number): BBox {
  return { minX: b.minX - by, minY: b.minY - by, maxX: b.maxX + by, maxY: b.maxY + by };
}

export function center(b: BBox): Point {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

export function intersects(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function contains(outer: BBox, inner: BBox): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Middle of one side of a box (where an edge attaches). */
export function sidePoint(b: BBox, side: Side): Point {
  switch (side) {
    case "top":
      return { x: (b.minX + b.maxX) / 2, y: b.minY };
    case "right":
      return { x: b.maxX, y: (b.minY + b.maxY) / 2 };
    case "bottom":
      return { x: (b.minX + b.maxX) / 2, y: b.maxY };
    case "left":
      return { x: b.minX, y: (b.minY + b.maxY) / 2 };
  }
}

/** A point `by` units outside a side (the curve starts a little away from the card, under the arrow). */
export function offsetFromSide(p: Point, side: Side, by: number): Point {
  switch (side) {
    case "top":
      return { x: p.x, y: p.y - by };
    case "bottom":
      return { x: p.x, y: p.y + by };
    case "left":
      return { x: p.x - by, y: p.y };
    case "right":
      return { x: p.x + by, y: p.y };
  }
}

export interface Bezier {
  from: Point;
  to: Point;
  cp1: Point;
  cp2: Point;
  path: string;
}

/** Cubic curve between two side points; control arms are half the distance, clamped to 70..150. */
export function edgeBezier(from: Point, fromSide: Side, to: Point, toSide: Side): Bezier {
  const arm = Math.min(150, Math.max(70, distance(from, to) / 2));
  const cp1 = offsetFromSide(from, fromSide, arm);
  const cp2 = offsetFromSide(to, toSide, arm);
  return { from, to, cp1, cp2, path: `M${from.x},${from.y} C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${to.x},${to.y}` };
}

export function bezierPoint(b: Bezier, t: number): Point {
  const u = 1 - t;
  const a = u * u * u, c1 = 3 * t * u * u, c2 = 3 * t * t * u, d = t * t * t;
  return { x: a * b.from.x + c1 * b.cp1.x + c2 * b.cp2.x + d * b.to.x, y: a * b.from.y + c1 * b.cp1.y + c2 * b.cp2.y + d * b.to.y };
}

/** Rotation (degrees) for an arrow head drawn pointing down, placed on a side. */
export const END_ROTATION: Record<Side, number> = { top: 180, bottom: 0, left: 90, right: 270 };

export const END_GAP = 7;

export interface EdgeGeometry {
  bezier: Bezier;
  /** full path, including the short straight piece under a missing arrow head */
  path: string;
  fromPoint: Point;
  toPoint: Point;
}

/** Path for an edge: the curve runs between points 7 units off each side; where there's no arrow head
 *  a straight stub joins the curve to the card. */
export function edgeGeometry(fromBox: BBox, fromSide: Side, toBox: BBox, toSide: Side, fromArrow: boolean, toArrow: boolean): EdgeGeometry {
  const a = sidePoint(fromBox, fromSide);
  const b = sidePoint(toBox, toSide);
  const a2 = offsetFromSide(a, fromSide, END_GAP);
  const b2 = offsetFromSide(b, toSide, END_GAP);
  const bez = edgeBezier(a2, fromSide, b2, toSide);
  let path = bez.path;
  if (!fromArrow) path = `M${a.x} ${a.y} L${a2.x} ${a2.y} ${path}`;
  if (!toArrow) path = `${path} M${b2.x} ${b2.y} L${b.x} ${b.y}`;
  return { bezier: bez, path, fromPoint: a, toPoint: b };
}

/** Which side of `from` faces `to`, splitting by the diagonals of `from`'s box. */
export function autoSide(from: BBox, to: BBox): Side {
  const c1 = center(from), c2 = center(to);
  const ang = Math.atan2(c2.y - c1.y, c2.x - c1.x);
  const diag = Math.atan2(from.maxY - from.minY, from.maxX - from.minX);
  if (ang > -diag && ang <= diag) return "right";
  if (ang > diag && ang <= Math.PI - diag) return "bottom";
  if (ang > Math.PI - diag || ang <= -(Math.PI - diag)) return "left";
  return "top";
}

/** Nearest side of a box to a point (for dropping an edge end on a card). */
export function nearestSide(b: BBox, p: Point): Side {
  let best: Side = "top";
  let bestD = Infinity;
  for (const s of ["top", "right", "bottom", "left"] as Side[]) {
    const d = distance(sidePoint(b, s), p);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** Background dot / snap grid spacing for a zoom level (zoom is log2 of the scale). */
export function gridSpacing(zoom: number): number {
  return zoom < -3.3 ? 160 : zoom < -2.16 ? 80 : zoom < -0.91 ? 40 : 20;
}

export function snapToGrid(v: number, grid: number): number {
  return Math.round(v / grid) * grid;
}

export interface SnapResult {
  dx: number;
  dy: number;
  /** guide lines to draw: vertical at x, horizontal at y */
  guidesX: number[];
  guidesY: number[];
}

/**
 * Snap a moving box: first to the edges/centres of other boxes within `dist`, then (per axis, when no
 * object snap happened) to the grid. Returns the extra offset to apply.
 */
export function snapBox(moving: BBox, others: BBox[], dist: number, grid: number | null, objects: boolean): SnapResult {
  const res: SnapResult = { dx: 0, dy: 0, guidesX: [], guidesY: [] };
  let snappedX = false, snappedY = false;
  if (objects && others.length) {
    const mx = [moving.minX, (moving.minX + moving.maxX) / 2, moving.maxX];
    const my = [moving.minY, (moving.minY + moving.maxY) / 2, moving.maxY];
    let bestX = dist + 1, bestY = dist + 1;
    for (const o of others) {
      const ox = [o.minX, (o.minX + o.maxX) / 2, o.maxX];
      const oy = [o.minY, (o.minY + o.maxY) / 2, o.maxY];
      for (const a of mx)
        for (const b of ox) {
          const d = b - a;
          if (Math.abs(d) < Math.abs(bestX)) {
            bestX = d;
            res.guidesX = [b];
          } else if (d === bestX && !res.guidesX.includes(b)) res.guidesX.push(b);
        }
      for (const a of my)
        for (const b of oy) {
          const d = b - a;
          if (Math.abs(d) < Math.abs(bestY)) {
            bestY = d;
            res.guidesY = [b];
          } else if (d === bestY && !res.guidesY.includes(b)) res.guidesY.push(b);
        }
    }
    if (Math.abs(bestX) <= dist) {
      res.dx = bestX;
      snappedX = true;
    } else res.guidesX = [];
    if (Math.abs(bestY) <= dist) {
      res.dy = bestY;
      snappedY = true;
    } else res.guidesY = [];
  }
  if (grid) {
    if (!snappedX) res.dx = snapToGrid(moving.minX, grid) - moving.minX;
    if (!snappedY) res.dy = snapToGrid(moving.minY, grid) - moving.minY;
  }
  return res;
}
