// JSON Canvas parse/serialise round trips (demo vault and real canvases), Obsidian-compatible output,
// and edge geometry.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { edgeForSave, formatJson, nodeForSave, normalizeColor, parseCanvas, serializeCanvas, canvasLinkTargets } from "../../src/renderer/views/canvas/format";
import { autoSide, bboxOf, bezierPoint, edgeBezier, edgeGeometry, gridSpacing, nearestSide, sidePoint, snapBox } from "../../src/renderer/views/canvas/geometry";

const DEMO_CANVAS = "C:/Users/orion/tbv-scratch/demo-vault/Garden board.canvas";
const REAL_DIR = "C:/Users/orion/tbv-scratch/vault-copy";

function copyToTemp(file: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-canvas-"));
  const out = path.join(dir, path.basename(file));
  fs.copyFileSync(file, out);
  return out;
}

// What Obsidian 1.14.4 wrote for the demo canvas after moving the first text card by 10px
// (captured from the reference app; note the groups-first order, the dropped default toEnd and
// the one-line-per-object layout).
const OBSIDIAN_SAVED = `{
\t"nodes":[
\t\t{"id":"a1b2c3d4e5f60005","type":"group","x":460,"y":-220,"width":360,"height":360,"label":"Ideas"},
\t\t{"id":"a1b2c3d4e5f60001","type":"text","text":"# Garden board\\nPlan the beds here.","x":-390,"y":-200,"width":300,"height":140,"color":"4"},
\t\t{"id":"a1b2c3d4e5f60002","type":"file","file":"Projects/Garden Planner.md","x":0,"y":-200,"width":400,"height":300},
\t\t{"id":"a1b2c3d4e5f60003","type":"file","file":"Attachments/mountain.png","x":-400,"y":0,"width":320,"height":180},
\t\t{"id":"a1b2c3d4e5f60004","type":"link","url":"https://jsoncanvas.org","x":0,"y":160,"width":400,"height":120},
\t\t{"id":"a1b2c3d4e5f60006","type":"text","text":"Small steps every day","x":490,"y":-180,"width":300,"height":80,"color":"2"},
\t\t{"id":"a1b2c3d4e5f60007","type":"file","file":"Ideas/Zettel 0001 Linking thoughts.md","x":490,"y":-60,"width":300,"height":180}
\t],
\t"edges":[
\t\t{"id":"e000000000000001","fromNode":"a1b2c3d4e5f60001","fromSide":"right","toNode":"a1b2c3d4e5f60002","toSide":"left","label":"plans"},
\t\t{"id":"e000000000000002","fromNode":"a1b2c3d4e5f60006","fromSide":"bottom","toNode":"a1b2c3d4e5f60007","toSide":"top","color":"1"}
\t]
}`;

describe.skipIf(!fs.existsSync(DEMO_CANVAS))("demo vault canvas", () => {
  it("parses every node and edge type", () => {
    const d = parseCanvas(fs.readFileSync(copyToTemp(DEMO_CANVAS), "utf8"));
    expect(d.nodes.map((n) => n.type)).toEqual(["text", "file", "file", "link", "group", "text", "file"]);
    expect(d.edges).toHaveLength(2);
    expect(d.edges[1].toEnd).toBe("arrow");
    expect(canvasLinkTargets(d).map((t) => t.link)).toEqual(["Projects/Garden Planner.md", "Attachments/mountain.png", "Ideas/Zettel 0001 Linking thoughts.md"]);
  });

  it("writes exactly what Obsidian writes", () => {
    const d = parseCanvas(fs.readFileSync(copyToTemp(DEMO_CANVAS), "utf8"));
    d.nodes[0].x += 10;
    expect(serializeCanvas(d)).toBe(OBSIDIAN_SAVED);
  });

  it("is stable: parse(serialize(x)) serialises the same", () => {
    const once = serializeCanvas(parseCanvas(OBSIDIAN_SAVED));
    expect(once).toBe(OBSIDIAN_SAVED);
    expect(serializeCanvas(parseCanvas(once))).toBe(once);
  });
});

describe.skipIf(!fs.existsSync(REAL_DIR))("real canvases from a vault copy", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".canvas")) files.push(p);
    }
  };
  if (fs.existsSync(REAL_DIR)) walk(REAL_DIR);
  it("finds canvases", () => expect(files.length).toBeGreaterThan(0));
  for (const f of files) {
    it(`round-trips ${path.basename(f)}`, () => {
      const text = fs.readFileSync(copyToTemp(f), "utf8");
      const d = parseCanvas(text);
      const out = serializeCanvas(d);
      const again = parseCanvas(out);
      expect(again.nodes.length).toBe(d.nodes.length);
      expect(again.edges.length).toBe(d.edges.length);
      expect(serializeCanvas(again)).toBe(out);
      // nothing is lost: every original key survives (default edge ends aside)
      for (const n of d.nodes) {
        const m = again.nodes.find((x) => x.id === n.id)!;
        for (const k of Object.keys(n)) if (n[k] !== undefined && k !== "subpath") expect(m[k]).toEqual(typeof n[k] === "number" ? Math.round(n[k]) : n[k]);
      }
    });
  }
});

describe("format details", () => {
  it("keeps unknown fields and top-level keys", () => {
    const src = { meta: { v: 1 }, nodes: [{ id: "a", type: "text", text: "x", x: 1.6, y: 2, width: 3, height: 4, custom: [1, { z: 2 }] }], edges: [{ id: "e", fromNode: "a", toNode: "a", fromEnd: "arrow", toEnd: "none", weird: true }] };
    const out = parseCanvas(serializeCanvas(parseCanvas(JSON.stringify(src))));
    expect(out.meta).toEqual({ v: 1 });
    expect(out.nodes[0].custom).toEqual([1, { z: 2 }]);
    expect(out.nodes[0].x).toBe(2);
    expect(out.edges[0].fromEnd).toBe("arrow");
    expect(out.edges[0].toEnd).toBe("none");
    expect(out.edges[0].weird).toBe(true);
  });

  it("empty and invalid files", () => {
    expect(parseCanvas("")).toEqual({ nodes: [], edges: [] });
    expect(parseCanvas("{}")).toEqual({ nodes: [], edges: [] });
    expect(() => parseCanvas("[1]")).toThrow();
    expect(serializeCanvas({ nodes: [], edges: [] })).toBe('{\n\t"nodes":[],\n\t"edges":[]\n}');
  });

  it("field order for new nodes and edges", () => {
    expect(Object.keys(nodeForSave({ id: "n", type: "group", x: 0, y: 0, width: 10, height: 10, label: "L", background: "a.png", backgroundStyle: "ratio" }))).toEqual(["id", "type", "backgroundStyle", "x", "y", "width", "height", "label", "background"]);
    expect(nodeForSave({ id: "n", type: "file", file: "a.md", subpath: "", x: 0, y: 0, width: 1, height: 1 }).subpath).toBeUndefined();
    expect(Object.keys(edgeForSave({ id: "e", fromNode: "a", toNode: "b", fromSide: "left", toSide: "right", toEnd: "arrow", fromEnd: "none" }))).toEqual(["id", "fromNode", "fromSide", "toNode", "toSide"]);
  });

  it("compact JSON layout", () => {
    expect(formatJson({ a: [1, 2], b: { c: [{ d: 1 }] } })).toBe('{\n\t"a":[1,2],\n\t"b":{\n\t\t"c":[\n\t\t\t{"d":1}\n\t\t]\n\t}\n}');
    expect(normalizeColor("4")).toBe("4");
    expect(normalizeColor("#AbCdEf")).toBe("#abcdef");
    expect(normalizeColor("7")).toBe("");
  });

  it("links in text cards", () => {
    const d = parseCanvas(JSON.stringify({ nodes: [{ id: "a", type: "text", text: "see [[Welcome]], [[Missing one|x]] and [md](Folder/Note.md) and [web](https://x.y)", x: 0, y: 0, width: 1, height: 1 }], edges: [] }));
    expect(canvasLinkTargets(d).map((t) => t.link)).toEqual(["Welcome", "Missing one", "Folder/Note.md"]);
  });
});

describe("edge geometry", () => {
  const a = bboxOf({ x: -400, y: -200, width: 300, height: 140 });
  const b = bboxOf({ x: 0, y: -200, width: 400, height: 300 });
  it("side points and auto sides", () => {
    expect(sidePoint(a, "right")).toEqual({ x: -100, y: -130 });
    expect(sidePoint(b, "top")).toEqual({ x: 200, y: -200 });
    expect(autoSide(a, b)).toBe("right");
    expect(autoSide(b, a)).toBe("left");
    expect(autoSide(bboxOf({ x: 0, y: 0, width: 100, height: 100 }), bboxOf({ x: 0, y: 500, width: 100, height: 100 }))).toBe("bottom");
    expect(nearestSide(b, { x: 410, y: -40 })).toBe("right");
  });
  it("curve arms are half the distance clamped to 70..150", () => {
    const short = edgeBezier({ x: 0, y: 0 }, "right", { x: 50, y: 0 }, "left");
    expect(short.cp1).toEqual({ x: 70, y: 0 });
    expect(short.cp2).toEqual({ x: -20, y: 0 });
    const long = edgeBezier({ x: 0, y: 0 }, "bottom", { x: 0, y: 1000 }, "top");
    expect(long.cp1).toEqual({ x: 0, y: 150 });
    expect(long.cp2).toEqual({ x: 0, y: 850 });
    expect(bezierPoint(long, 0.5)).toEqual({ x: 0, y: 500 });
  });
  it("path with and without arrow heads", () => {
    const g = edgeGeometry(a, "right", b, "left", false, true);
    expect(g.path).toBe("M-100 -130 L-93 -130 M-93,-130 C-23,-130 -77,-50 -7,-50");
    const both = edgeGeometry(a, "right", b, "left", false, false);
    expect(both.path.endsWith("M-7 -50 L0 -50")).toBe(true);
  });
  it("grid spacing by zoom and snapping", () => {
    expect(gridSpacing(0)).toBe(20);
    expect(gridSpacing(-1)).toBe(40);
    expect(gridSpacing(-2.5)).toBe(80);
    expect(gridSpacing(-4)).toBe(160);
    const s = snapBox({ minX: 103, minY: 7, maxX: 203, maxY: 57 }, [{ minX: 0, minY: 0, maxX: 100, maxY: 50 }], 15, 20, true);
    expect(s.dx).toBe(-3);
    expect(s.dy).toBe(-7);
    const g = snapBox({ minX: 13, minY: 27, maxX: 50, maxY: 50 }, [], 15, 20, false);
    expect(g).toMatchObject({ dx: 7, dy: -7 });
  });
});
