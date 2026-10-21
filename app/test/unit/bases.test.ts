// @vitest-environment happy-dom
// .base parsing, expressions, filters, formulas, sort/group; community catalogue helpers.
import { describe, expect, it, vi } from "vitest";
import moment from "moment";

vi.mock("electron", () => ({ ipcRenderer: { invoke: async () => null, on() {}, removeListener() {} }, webFrame: {} }));

import { installDomHelpers } from "../../src/renderer/dom/augment";
import { parseBase, parseExpr, evaluate, runView, matchesFilter, columnLabel, fmt, type FileLike } from "../../src/renderer/core-plugins/bases/expr";
import { compareVersions, formatCount, isAllowedUrl, getPlugins, setFetcher, clearCatalogCache, installPlugin } from "../../src/renderer/plugins/browser/catalog";

installDomHelpers(window as any);

const file = (path: string, properties: Record<string, any> = {}, tags: string[] = [], links: string[] = []): FileLike => {
  const name = path.split("/").pop()!;
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  return { name, basename: name.replace(/\.[^.]+$/, ""), path, extension: ext, parentPath: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "", size: 10, ctime: 0, mtime: Date.parse("2026-10-01"), tags, links, properties };
};
const files = [
  file("Books/Dune.md", { status: "done", pages: 600, price: 12, rating: 5 }, ["book", "scifi"]),
  file("Books/Emma.md", { status: "reading", pages: 400, price: 8, rating: 4 }, ["book"], ["People/Jane.md"]),
  file("Books/Ulysses.md", { status: "todo", pages: 900, price: 20 }, ["book/classic"]),
  file("People/Jane.md", { born: "1775-12-16" }, ["person"]),
  file("img.png"),
];

describe(".base files", () => {
  it("parses YAML with filters, formulas, properties and views; keeps unknown keys", () => {
    const b = parseBase(`
filters:
  and:
    - file.hasTag("book")
formulas:
  ppp: "price / pages"
properties:
  status:
    displayName: Status
views:
  - type: table
    name: Reading
    order: [file.name, status, formula.ppp]
    sort:
      - property: pages
        direction: DESC
  - type: cards
    name: Gallery
extra: 1
`);
    expect(b.views.map((v) => v.name)).toEqual(["Reading", "Gallery"]);
    expect(b.formulas.ppp).toBe("price / pages");
    expect(b.extra).toEqual({ extra: 1 });
    expect(columnLabel(b, "status")).toBe("Status");
    expect(columnLabel(b, "file.name")).toBe("file name");
  });
  it("gives a default table view for an empty (new) base", () => {
    const b = parseBase("");
    expect(b.views).toEqual([{ type: "table", name: "View" }]);
    const r = runView(b, b.views[0], files);
    expect(r.rows.length).toBe(files.length);
    expect(r.columns).toEqual(["file.name"]);
  });
  it("rejects non-mapping YAML with a readable error", () => {
    expect(() => parseBase("- a\n- b")).toThrow(/mapping/);
  });
});

describe("expressions and filters", () => {
  const ctx = (f: FileLike, formulas: Record<string, string> = {}) => ({ file: f, formulas, errors: new Set<string>() });
  it("evaluates comparisons, arithmetic and logic", () => {
    const c = ctx(files[0]);
    expect(evaluate(parseExpr('status == "done" && pages > 500'), c)).toBe(true);
    expect(evaluate(parseExpr("price * 2 + 1"), c)).toBe(25);
    expect(evaluate(parseExpr("!(rating >= 5)"), c)).toBe(false);
    expect(evaluate(parseExpr("note.pages - 100"), c)).toBe(500);
    expect(evaluate(parseExpr('if(pages > 500, "long", "short")'), c)).toBe("long");
  });
  it("supports file functions and string/list methods", () => {
    expect(matchesFilter('file.hasTag("book")', ctx(files[2]))).toBe(true); // nested tag book/classic
    expect(matchesFilter('file.inFolder("Books")', ctx(files[3]))).toBe(false);
    expect(matchesFilter('file.hasLink("Jane")', ctx(files[1]))).toBe(true);
    expect(matchesFilter('file.name.startsWith("Du")', ctx(files[0]))).toBe(true);
    expect(matchesFilter('status.contains("ead")', ctx(files[1]))).toBe(true);
    expect(matchesFilter("file.tags.contains(\"#scifi\")", ctx(files[0]))).toBe(true);
    expect(matchesFilter({ or: ['status == "done"', 'status == "todo"'] }, ctx(files[1]))).toBe(false);
    expect(matchesFilter({ not: ['file.ext == "png"'] }, ctx(files[4]))).toBe(false);
  });
  it("evaluates dates", () => {
    const c = ctx(files[3]);
    expect(evaluate(parseExpr('date(born).year()'), c)).toBe(1775);
    expect(fmt(evaluate(parseExpr('date(born) + "1 day"'), c))).toBe("1775-12-17");
    expect(evaluate(parseExpr("file.mtime > date(\"2025-01-01\")"), c)).toBe(true);
  });
  it("reports syntax errors", () => {
    expect(() => parseExpr("pages >")).toThrow();
    expect(() => parseExpr('"open')).toThrow(/quote/);
  });
});

describe("views", () => {
  it("filters, computes formulas, sorts and limits", () => {
    const b = parseBase(`
filters: 'file.hasTag("book")'
formulas:
  ppp: (price / pages * 100).round(2)
views:
  - type: table
    name: T
    order: [file.name, formula.ppp]
    sort: [{property: pages, direction: DESC}]
    limit: 2
`);
    const r = runView(b, b.views[0], files);
    expect(r.rows.map((x) => x.file.basename)).toEqual(["Ulysses", "Dune"]);
    expect(r.rows[1].values["formula.ppp"]).toBe(2);
    expect(r.errors).toEqual([]);
  });
  it("groups rows", () => {
    const b = parseBase(`views:\n  - type: table\n    name: T\n    filters: file.inFolder("Books")\n    groupBy: {property: status}\n`);
    const r = runView(b, b.views[0], files);
    expect(r.groups!.map((g) => g.key)).toEqual(["done", "reading", "todo"]);
  });
  it("records formula errors instead of failing", () => {
    const b = parseBase(`formulas:\n  bad: nosuchfn(1)\nviews:\n  - type: table\n    name: T\n    order: [formula.bad]\n`);
    const r = runView(b, b.views[0], files.slice(0, 1));
    expect(r.errors.join(" ")).toMatch(/nosuchfn/);
  });
});

describe("community catalogue", () => {
  it("compares versions and formats counts like the original", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.5.68", "0.5.68")).toBe(0);
    expect(compareVersions("2.0.0-beta.1", "2.0.0-beta.2")).toBeLessThan(0);
    expect(formatCount(5_176_995)).toBe("5.1M");
    expect(formatCount(5_950_000)).toBe("5.9M");
    expect(formatCount(745_812)).toBe("745k");
    expect(formatCount(950)).toBe("950");
  });
  it("only allows GitHub hosts", () => {
    expect(isAllowedUrl("https://raw.githubusercontent.com/a/b/HEAD/manifest.json")).toBe(true);
    expect(isAllowedUrl("https://github.com/a/b/releases/download/1.0.0/main.js")).toBe(true);
    expect(isAllowedUrl("https://releases.obsidian.md/stats/theme")).toBe(false);
    expect(isAllowedUrl("http://github.com/x")).toBe(false);
  });
  it("merges the plugin list with download stats and versions", async () => {
    clearCatalogCache();
    setFetcher(async (url: string) => {
      const body = url.endsWith("community-plugins.json")
        ? JSON.stringify([{ id: "x", name: "X", author: "me", description: "d", repo: "me/x" }])
        : url.endsWith("community-plugin-stats.json")
          ? JSON.stringify({ x: { downloads: 1234, updated: 1700000000000, "1.0.0": 1, "1.10.0": 2, "1.9.0": 3 } })
          : "{}";
      return { ok: true, status: 200, text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer };
    });
    const list = await getPlugins();
    expect(list[0]).toMatchObject({ id: "x", downloads: 1234, updated: 1700000000000, latestVersion: "1.10.0" });
  });
  it("installs a plugin release into .obsidian/plugins/<id>/", async () => {
    const written: Record<string, string> = {};
    const app: any = {
      vault: { adapter: { mkdir: async () => {}, write: async (p: string, d: string) => void (written[p] = d), remove: async () => {} } },
      plugins: { dir: ".obsidian/plugins", plugins: {}, enabledPlugins: new Set(), isEnabled: () => false, loadManifests: async () => {}, unloadPlugin: async () => {}, loadPlugin: async () => {} },
    };
    setFetcher(async (url: string) => {
      const files: Record<string, string> = { "manifest.json": JSON.stringify({ id: "x", name: "X", version: "1.2.0" }), "main.js": "module.exports = 1" };
      const name = url.split("/").pop()!;
      const body = files[name];
      return { ok: !!body, status: body ? 200 : 404, text: async () => body ?? "", arrayBuffer: async () => new TextEncoder().encode(body ?? "").buffer as ArrayBuffer };
    });
    const m = await installPlugin(app, "me/x", "1.2.0", { id: "x" });
    expect(m.version).toBe("1.2.0");
    expect(Object.keys(written).sort()).toEqual([".obsidian/plugins/x/main.js", ".obsidian/plugins/x/manifest.json"]);
    await expect(installPlugin(app, "me/x", "1.2.0", { id: "other" })).rejects.toThrow(/not “other”/);
  });
});

void moment;
