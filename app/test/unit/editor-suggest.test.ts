// @vitest-environment happy-dom
// [[link]] / #tag suggestion ranking and completion text, against a small fake vault.
import { describe, expect, it } from "vitest";
import { installDomHelpers } from "../../src/renderer/dom/augment";
installDomHelpers(window as any);
import { LinkSuggest, TagSuggest, HighlightColorSuggest } from "../../src/renderer/editor/suggest";

function file(path: string, mtime: number) {
  const name = path.split("/").pop()!;
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "/";
  return { path, name, extension: ext, basename: name.replace(/\.[^.]+$/, ""), stat: { mtime, ctime: mtime, size: 1 }, parent: { path: parentPath } };
}

const files = [
  file("Welcome.md", 10),
  file("Projects/Garden Planner.md", 20),
  file("Garden board.canvas", 30),
  file("People/Ada Lovelace.md", 40),
  file("Attachments/mountain.png", 5),
  file("Inbox/Quick capture.md", 50),
];
const caches: Record<string, any> = {
  "Welcome.md": { frontmatter: { aliases: ["Home", "Start"] }, headings: [{ heading: "Welcome to the demo vault", level: 1 }, { heading: "Map of notes", level: 2 }, { heading: "Tasks", level: 2 }] },
  "People/Ada Lovelace.md": { frontmatter: { aliases: ["Ada", "Countess of Lovelace"] } },
};
const app: any = {
  vault: { getFiles: () => files, getConfig: () => undefined },
  metadataCache: {
    getFileCache: (f: any) => caches[f.path] ?? {},
    unresolvedLinks: { "Welcome.md": { "Not created yet": 1 } },
    getFirstLinkpathDest: (p: string) => files.find((f) => f.basename === p || f.path === p) ?? null,
    fileToLinktext: (f: any) => (f.extension === "md" ? f.basename : f.name),
    getTags: () => ({ "#garden": 2, "#garden/shopping": 1, "#books": 1, "#demo": 1 }),
  },
};

const titles = (items: any[]) => items.map((i) => i.title);
const ctx = (query: string) => ({ query, start: { line: 0, ch: 2 }, end: { line: 0, ch: 2 + query.length }, editor: null as any, file: files[0] });

describe("link suggest", () => {
  const s = new LinkSuggest(app);
  it("triggers after [[ and ![[ (not after | or ]])", () => {
    const ed = (line: string) => ({ getLine: () => line });
    expect(s.onTrigger({ line: 0, ch: 5 }, ed("[[gar"), null)?.query).toBe("gar");
    expect(s.onTrigger({ line: 0, ch: 8 }, ed("x ![[mou"), null)?.query).toBe("mou");
    expect(s.onTrigger({ line: 0, ch: 8 }, ed("[[a|alia"), null)).toBeNull();
    expect(s.onTrigger({ line: 0, ch: 7 }, ed("[[a]] b"), null)).toBeNull();
  });
  it("ranks notes by fuzzy match, notes before other files", () => {
    expect(titles(s.getSuggestions(ctx("gar")) as any[]).slice(0, 2)).toEqual(["Garden Planner", "Garden board.canvas"]);
  });
  it("empty query lists files newest first", () => {
    expect(titles(s.getSuggestions(ctx("")) as any[]).slice(0, 3)).toEqual(["Quick capture", "Ada Lovelace", "Garden board.canvas"]);
  });
  it("offers aliases and unresolved notes", () => {
    const items = s.getSuggestions(ctx("Home")) as any[];
    expect(items[0]).toMatchObject({ title: "Home", alias: "Home" });
    expect(titles(s.getSuggestions(ctx("not cre")) as any[])).toEqual(["Not created yet"]);
    expect((s.getSuggestions(ctx("ada")) as any[])[0]).toMatchObject({ title: "Ada", alias: "Ada" });
  });
  it("suggests headings after #", () => {
    expect(titles(s.getSuggestions(ctx("Welcome#")) as any[])).toEqual(["Welcome to the demo vault", "Map of notes", "Tasks"]);
    expect(titles(s.getSuggestions(ctx("Welcome#map")) as any[])).toEqual(["Map of notes"]);
  });
});

describe("tag suggest", () => {
  const t = new TagSuggest(app);
  it("triggers after # at a word start", () => {
    const ed = (line: string) => ({ getLine: () => line, posToOffset: () => 0, cm: { state: {} } });
    expect(t.onTrigger({ line: 0, ch: 4 }, ed("#gar"), null)?.query).toBe("gar");
    expect(t.onTrigger({ line: 0, ch: 5 }, ed("a#gar"), null)).toBeNull();
  });
  it("ranks by match then length; empty query is alphabetical", () => {
    expect((t.getSuggestions(ctx("gar")) as any[]).map((x) => x.tag)).toEqual(["garden", "garden/shopping"]);
    expect((t.getSuggestions(ctx("")) as any[]).map((x) => x.tag)).toEqual(["books", "demo", "garden", "garden/shopping"]);
  });
});

describe("highlight colour suggest", () => {
  const h = new HighlightColorSuggest(app);
  it("opens after an opening == only", () => {
    const ed = (line: string) => ({ getLine: () => line });
    expect(h.onTrigger({ line: 0, ch: 4 }, ed("a =="), null)).not.toBeNull();
    expect(h.onTrigger({ line: 0, ch: 8 }, ed("a ==b =="), null)).toBeNull();
    expect((h.getSuggestions() as any[]).map((x) => x[0])).toEqual(["Default", "Red", "Orange", "Yellow", "Green", "Blue", "Purple"]);
  });
});
