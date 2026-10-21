// Graph data building (filters, colour groups, local depth, orphans), graph.json round trip, query
// matching and the force layout. Expected values were observed in Obsidian 1.14.4 on the demo vault.
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanVault } from "../../src/core/scan";
import { parseMetadata, getAllTags } from "../../src/core/parse";
import { LinkIndex } from "../../src/core/links";
import { resolveLinksFor } from "../../src/core/resolve";
import { buildGraphData, flatten, localGraph, markFocused, nodeDisplayText, nodeSize, removeOrphans, type GraphSource } from "../../src/renderer/views/graph/data";
import { defaultOptions, graphJsonText, hslToInt, mergeOptions, newGroupColor, serializeOptions, sliderToStrength, strengthToSlider } from "../../src/renderer/views/graph/options";
import { GraphQuery } from "../../src/renderer/views/graph/query";
import { createSimulation } from "../../src/renderer/views/graph/sim";
import { parseCanvas } from "../../src/renderer/views/canvas/format";
import { canvasLinkMaps } from "../../src/renderer/views/canvas/links";

const DEMO = "C:/Users/orion/tbv-scratch/demo-vault";
const hasDemo = fs.existsSync(DEMO);

let src: GraphSource;
let tmp = "";

async function loadVault(root: string): Promise<GraphSource> {
  const entries = (await scanVault(root)).filter((e) => !e.folder).map((e) => e.path);
  const index = new LinkIndex(entries);
  const metas = new Map<string, any>();
  const resolvedLinks: Record<string, Record<string, number>> = {};
  const unresolvedLinks: Record<string, Record<string, number>> = {};
  for (const p of entries) {
    if (p.endsWith(".md")) {
      const meta = parseMetadata(fs.readFileSync(path.join(root, p), "utf8"));
      metas.set(p, meta);
      const r = resolveLinksFor(p, meta, index);
      resolvedLinks[p] = r.resolved;
      unresolvedLinks[p] = r.unresolved;
    } else if (p.endsWith(".canvas")) {
      const r = canvasLinkMaps(parseCanvas(fs.readFileSync(path.join(root, p), "utf8")), p, index);
      resolvedLinks[p] = r.resolved;
      unresolvedLinks[p] = r.unresolved;
    }
  }
  return {
    files: entries,
    resolvedLinks,
    unresolvedLinks,
    fileTags: (p) => (metas.get(p) ? getAllTags(metas.get(p)) : null),
    vaultTags: () => [...new Set([...metas.values()].flatMap((m) => getAllTags(m) ?? []))],
    isUserIgnored: () => false,
    fileTime: (p) => entries.indexOf(p),
  };
}

beforeAll(async () => {
  if (!hasDemo) return;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-graph-"));
  fs.cpSync(DEMO, tmp, { recursive: true });
  src = await loadVault(tmp);
});

const opts = { showTags: false, showAttachments: false, hideUnresolved: false, showOrphans: true };

describe.skipIf(!hasDemo)("graph data on the demo vault (matches Obsidian 1.14.4)", () => {
  it("canvas file cards and text links count as links", () => {
    expect(src.resolvedLinks["Garden board.canvas"]).toEqual({
      "Projects/Garden Planner.md": 1,
      "Attachments/mountain.png": 1,
      "Ideas/Zettel 0001 Linking thoughts.md": 1,
    });
  });

  it("builds the global graph with unresolved notes and orphans", () => {
    const d = buildGraphData(src, opts);
    expect(Object.keys(d.nodes).sort()).toEqual(
      [
        "Daily/2026-10-20.md",
        "Daily/2026-10-21.md",
        "Garden board.canvas",
        "Ideas/Zettel 0001 Linking thoughts.md",
        "Ideas/Zettel 0002 Small steps.md",
        "Ideas/Zettel 0003 Embeds.md",
        "Inbox/Empty note.md",
        "Inbox/Quick capture.md",
        "Not created yet",
        "People/Ada Lovelace.md",
        "People/Alan Turing.md",
        "Projects/Garden Planner.md",
        "Projects/Reading List.md",
        "Templates/Daily template.md",
        "Templates/Meeting template.md",
        "The Timeless Way of Building",
        "Welcome.md",
      ].sort(),
    );
    expect(d.nodes["Not created yet"].type).toBe("unresolved");
    expect(d.nodes["Garden board.canvas"].type).toBe("");
    // attachments are hidden by default, so no links to them either
    expect(Object.keys(d.nodes["Garden board.canvas"].links).sort()).toEqual(["Ideas/Zettel 0001 Linking thoughts.md", "Projects/Garden Planner.md"]);
  });

  it("weights (links in + out) and node sizes match", () => {
    const f = flatten(buildGraphData(src, opts));
    const w = (id: string) => f.weight[f.index.get(id)!];
    expect(w("Welcome.md")).toBe(9);
    expect(w("Projects/Garden Planner.md")).toBe(9);
    expect(w("Projects/Reading List.md")).toBe(7);
    expect(w("Ideas/Zettel 0001 Linking thoughts.md")).toBe(6);
    expect(w("People/Ada Lovelace.md")).toBe(5);
    expect(w("Garden board.canvas")).toBe(2);
    expect(w("Inbox/Empty note.md")).toBe(0);
    expect(nodeSize(9, 1)).toBeCloseTo(9.486832980505138, 9);
    expect(nodeSize(7, 1)).toBeCloseTo(8.485281374238571, 9);
    expect(nodeSize(6, 1)).toBe(8);
    expect(nodeSize(30, 1)).toBeCloseTo(16.703293088490064, 9);
    expect(nodeSize(10000, 2)).toBe(60);
  });

  it("attachments, tags and existing-files-only filters", () => {
    const withAtt = buildGraphData(src, { ...opts, showAttachments: true });
    expect(withAtt.nodes["Attachments/mountain.png"].type).toBe("attachment");
    expect(withAtt.nodes["Garden board.canvas"].links["Attachments/mountain.png"]).toBe(true);
    const tags = buildGraphData(src, { ...opts, showTags: true });
    const tagIds = Object.keys(tags.nodes).filter((k) => tags.nodes[k].type === "tag");
    expect(tagIds.length).toBeGreaterThan(0);
    expect(tagIds.every((t) => t.startsWith("#"))).toBe(true);
    const existing = buildGraphData(src, { ...opts, hideUnresolved: true });
    expect(existing.nodes["Not created yet"]).toBeUndefined();
  });

  it("orphans off removes unlinked notes", () => {
    const d = buildGraphData(src, { ...opts, showOrphans: false });
    removeOrphans(d);
    expect(d.nodes["Inbox/Empty note.md"]).toBeUndefined();
    expect(d.nodes["Templates/Daily template.md"]).toBeUndefined();
    expect(d.nodes["Welcome.md"]).toBeDefined();
    expect(d.nodes["Not created yet"]).toBeDefined();
  });

  it("local graph: depth 1 around Garden Planner", () => {
    const local = localGraph(buildGraphData(src, opts), { localFile: "Projects/Garden Planner.md", localJumps: 1, localInterlinks: false, localForelinks: true, localBacklinks: true });
    markFocused(local, "Projects/Garden Planner.md");
    expect(Object.keys(local.nodes).sort()).toEqual(
      [
        "Projects/Garden Planner.md",
        "Garden board.canvas",
        "Welcome.md",
        "Daily/2026-10-21.md",
        "Ideas/Zettel 0003 Embeds.md",
        "People/Ada Lovelace.md",
        "Projects/Reading List.md",
        "Ideas/Zettel 0002 Small steps.md",
      ].sort(),
    );
    expect(local.weights!["Projects/Garden Planner.md"]).toBe(30);
    expect(local.weights!["Welcome.md"]).toBe(0);
    expect(local.nodes["Projects/Garden Planner.md"].type).toBe("focused");
    const f = flatten(local);
    expect(f.src.length).toBe(9);
  });

  it("local graph options: incoming only, outgoing only, neighbour links, depth 2", () => {
    const all = buildGraphData(src, opts);
    const base = { localFile: "Projects/Garden Planner.md", localJumps: 1, localInterlinks: false, localForelinks: true, localBacklinks: true };
    const outOnly = localGraph(all, { ...base, localBacklinks: false });
    expect(Object.keys(outOnly.nodes).sort()).toEqual(["Ideas/Zettel 0002 Small steps.md", "People/Ada Lovelace.md", "Projects/Garden Planner.md", "Welcome.md"]);
    const inOnly = localGraph(all, { ...base, localForelinks: false });
    expect(Object.keys(inOnly.nodes)).toContain("Garden board.canvas");
    expect(Object.keys(inOnly.nodes)).not.toContain("Ideas/Zettel 0002 Small steps.md");
    const inter = localGraph(all, { ...base, localInterlinks: true });
    expect(flatten(inter).src.length).toBeGreaterThan(9);
    const deep = localGraph(all, { ...base, localJumps: 2 });
    expect(Object.keys(deep.nodes).length).toBeGreaterThan(Object.keys(all.nodes).length - 6);
    expect(deep.weights!["Welcome.md"]).toBe(15);
  });

  it("search filter and colour groups", () => {
    const people = new GraphQuery("path:People");
    const filter = (id: string, type: string) => (type === "" ? people.match({ path: id, name: id.split("/").pop()!, tags: [], content: null }) : true);
    const d = buildGraphData(src, opts, filter as any);
    const files = Object.keys(d.nodes).filter((k) => d.nodes[k].type === "");
    expect(files.sort()).toEqual(["People/Ada Lovelace.md", "People/Alan Turing.md"]);
    const color = { a: 1, rgb: 0xff0000 };
    const colored = buildGraphData(src, opts, (id, type) => (type === "" && id.startsWith("Ideas/") ? color : true));
    expect(colored.nodes["Ideas/Zettel 0001 Linking thoughts.md"].color).toEqual(color);
    expect(colored.nodes["Welcome.md"].color).toBeUndefined();
  });

  it("timelapse progression shows the graph step by step", () => {
    const full = buildGraphData(src, opts);
    const partial = buildGraphData(src, opts, undefined, 3);
    expect(Object.keys(partial.nodes).length).toBeLessThan(Object.keys(full.nodes).length);
    expect(full.numLinks).toBeGreaterThan(10);
  });
});

describe("graph options and graph.json", () => {
  it("defaults match Obsidian", () => {
    const o = defaultOptions();
    expect(o.centerStrength).toBeCloseTo(0.518713248970312, 12);
    expect(o.repelStrength).toBe(10);
    expect(o.linkStrength).toBe(1);
    expect(o.linkDistance).toBe(250);
    expect(o.showOrphans).toBe(true);
    expect(o.showTags).toBe(false);
    expect(o.textFadeMultiplier).toBe(0);
    expect(o.localJumps).toBe(1);
    expect(o.localInterlinks).toBe(false);
    expect(sliderToStrength(o.centerStrength)).toBeCloseTo(0.1, 12);
    expect(strengthToSlider(sliderToStrength(0.3))).toBeCloseTo(0.3, 12);
  });

  // The observed file comes from a local reference capture; skipped where it doesn't exist (CI).
  const OBSERVED = "C:/Users/orion/tbv-scratch/data/graph.observed.json";
  it.skipIf(!fs.existsSync(OBSERVED))("round-trips Obsidian's graph.json byte for byte", () => {
    const observed = fs.readFileSync(OBSERVED, "utf8");
    expect(graphJsonText(mergeOptions(JSON.parse(observed)))).toBe(observed.replace(/\r\n/g, "\n").trimEnd());
  });

  it("keeps unknown keys and fixes wrong types", () => {
    const o = mergeOptions({ search: 5, showTags: true, futureKey: { a: 1 }, colorGroups: [{ query: "tag:#x", color: { a: 1, rgb: 255 } }] });
    expect(o.search).toBe("");
    expect(o.showTags).toBe(true);
    const out = serializeOptions(o);
    expect(out.futureKey).toEqual({ a: 1 });
    expect(out.colorGroups).toEqual([{ query: "tag:#x", color: { a: 1, rgb: 255 } }]);
    expect(Object.keys(out).slice(0, 3)).toEqual(["collapse-filter", "search", "showTags"]);
    const local = serializeOptions(mergeOptions({}, true), true);
    expect(Object.keys(local).slice(0, 6)).toEqual(["collapse-filter", "search", "localJumps", "localBacklinks", "localForelinks", "localInterlinks"]);
  });

  it("new group colours step the hue by 40 degrees", () => {
    expect(newGroupColor(0, false).rgb).toBe(14048348);
    expect(newGroupColor(1, false).rgb).toBe(14069084);
    expect(newGroupColor(2, false).rgb).toBe(11392604);
    expect(hslToInt(0, 0, 100)).toBe(0xffffff);
  });

  it("display text drops folders and .md only", () => {
    expect(nodeDisplayText("Projects/Garden Planner.md")).toBe("Garden Planner");
    expect(nodeDisplayText("Garden board.canvas")).toBe("Garden board.canvas");
    expect(nodeDisplayText("Not created yet")).toBe("Not created yet");
  });
});

describe("graph query", () => {
  const t = (p: string, content: string | null = null, tags: string[] = []) => ({ path: p, name: p.split("/").pop()!, tags, content });
  it("words, phrases, operators and OR", () => {
    expect(new GraphQuery("garden").match(t("Projects/Garden Planner.md"))).toBe(true);
    expect(new GraphQuery("garden -planner").match(t("Projects/Garden Planner.md"))).toBe(false);
    expect(new GraphQuery('"small steps"').match(t("x.md", "Take small steps daily"))).toBe(true);
    expect(new GraphQuery("path:Ideas OR path:People").match(t("People/Ada.md"))).toBe(true);
    expect(new GraphQuery("file:ada").match(t("People/Ada Lovelace.md"))).toBe(true);
    expect(new GraphQuery("tag:#project").match(t("a.md", null, ["#project/sub"]))).toBe(true);
    expect(new GraphQuery("tag:proj").match(t("a.md", null, ["#project"]))).toBe(false);
    expect(new GraphQuery("/^Zettel \\d+/").match(t("Ideas/Zettel 0001.md"))).toBe(true);
    expect(new GraphQuery("content:beds").match(t("a.md", "Plan the beds"))).toBe(true);
    expect(new GraphQuery("match-case:Beds").match(t("a.md", "Plan the beds"))).toBe(false);
    expect(new GraphQuery("").empty).toBe(true);
    expect(new GraphQuery("tag:#garden").matchTag("#garden")).toBe(true);
    expect(new GraphQuery("path:Attachments").matchFilename("Attachments/mountain.png")).toBe(true);
  });
});

describe("force layout", () => {
  it("separates nodes, pulls linked nodes towards the link distance and settles", () => {
    const sim = createSimulation();
    const n = 50;
    const pos = new Float32Array(n * 2).fill(NaN);
    const links: number[] = [];
    for (let i = 1; i < n; i++) links.push(0, i);
    sim.setGraph(n, pos, Uint32Array.from(links));
    let ticks = 0;
    while (sim.running() && ticks < 2000) {
      sim.tick();
      ticks++;
    }
    expect(sim.running()).toBe(false);
    expect(ticks).toBeGreaterThan(100);
    // star: leaves spread around the hub
    let minD = Infinity;
    for (let i = 1; i < n; i++)
      for (let j = i + 1; j < n; j++) minD = Math.min(minD, Math.hypot(sim.x[i] - sim.x[j], sim.y[i] - sim.y[j]));
    expect(minD).toBeGreaterThan(20);
    for (let i = 0; i < n; i++) expect(Number.isFinite(sim.x[i]) && Number.isFinite(sim.y[i])).toBe(true);
  });

  it("fixed nodes stay where they are pinned", () => {
    const sim = createSimulation();
    sim.setGraph(3, Float32Array.from([0, 0, 10, 0, 0, 10]), Uint32Array.from([0, 1, 1, 2]));
    sim.fix(1, 500, 500);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(sim.x[1]).toBe(500);
    expect(sim.y[1]).toBe(500);
  });

  it("ticks a 10k-node / 160k-link graph fast enough for 60 fps layout", () => {
    const n = 10000;
    const sim = createSimulation();
    const links = new Uint32Array(160000 * 2);
    let seed = 1;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let k = 0; k < 160000; k++) {
      const a = Math.floor(rnd() * n);
      let b = Math.floor(rnd() * n);
      if (b === a) b = (a + 1) % n;
      links[k * 2] = a;
      links[k * 2 + 1] = b;
    }
    sim.setGraph(n, new Float32Array(n * 2).fill(NaN), links);
    sim.tick();
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) sim.tick();
    const per = (performance.now() - t0) / 10;
    console.log(`[bench] 10k nodes / 160k links: ${per.toFixed(1)} ms per layout tick`);
    expect(per).toBeLessThan(250);
  });
});
