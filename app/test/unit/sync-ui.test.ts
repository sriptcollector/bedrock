// Sync UI helpers: the version-history line diff and the selective-sync rule.
import { describe, expect, it } from "vitest";
import { changedSpan, diffLines } from "../../src/renderer/sync-ui/diff";
import { configCategory, excludeRule } from "../../src/main/sync/selective";
import { DEFAULT_SYNC_SETTINGS, type SyncSettings } from "../../src/shared/sync";

const rebuild = (ops: ReturnType<typeof diffLines>, side: "old" | "new") =>
  ops.filter((o) => o.type === "eq" || o.type === (side === "old" ? "del" : "add")).map((o) => o.text);

describe("diffLines", () => {
  it("finds the changed lines", () => {
    const ops = diffLines("a\nb\nc\nd\n", "a\nB\nc\nd\ne\n");
    expect(ops).toEqual([
      { type: "eq", text: "a" },
      { type: "del", text: "b" },
      { type: "add", text: "B" },
      { type: "eq", text: "c" },
      { type: "eq", text: "d" },
      { type: "add", text: "e" },
    ]);
  });

  it("reconstructs both sides on random edits", () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
    for (let round = 0; round < 200; round++) {
      const a = Array.from({ length: rnd(40) }, () => "l" + rnd(8));
      const b = a.slice();
      for (let i = 0; i < rnd(10); i++) {
        const op = rnd(3);
        const at = rnd(b.length + 1);
        if (op === 0) b.splice(at, 0, "n" + rnd(8));
        else if (op === 1 && b.length) b.splice(at % b.length, 1);
        else if (b.length) b[at % b.length] = "x" + rnd(8);
      }
      const ops = diffLines(a.join("\n"), b.join("\n"));
      expect(rebuild(ops, "old")).toEqual(a);
      expect(rebuild(ops, "new")).toEqual(b);
    }
  });

  it("handles big notes and CRLF", () => {
    const a = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\r\n");
    const b = a.replace("line 2500", "line 2500 changed");
    const ops = diffLines(a, b);
    expect(ops.filter((o) => o.type !== "eq")).toEqual([
      { type: "del", text: "line 2500" },
      { type: "add", text: "line 2500 changed" },
    ]);
    expect(changedSpan("line 2500 changed", "line 2500")).toEqual(["line 2500", " changed", ""]);
  });
});

describe("selective sync rule", () => {
  const s = (p: Partial<SyncSettings>): SyncSettings => ({ ...DEFAULT_SYNC_SETTINGS, ...p, config: { ...DEFAULT_SYNC_SETTINGS.config, ...(p.config ?? {}) } });

  it("defaults: everything syncs except community plugins", () => {
    const r = excludeRule(DEFAULT_SYNC_SETTINGS)!;
    expect(r("Notes/a.md")).toBe(false);
    expect(r("img/a.png")).toBe(false);
    expect(r("x.zip")).toBe(false);
    expect(r(".obsidian/app.json")).toBe(false);
    expect(r(".obsidian/plugins/dataview/main.js")).toBe(true);
    expect(r(".obsidian/community-plugins.json")).toBe(true);
  });

  it("file types, folders and config categories", () => {
    const r = excludeRule(s({ images: false, pdf: false, other: false, excludedFolders: ["Private/", "Big Files"], config: { hotkeys: false, themes: false } as any }))!;
    expect(r("a.PNG")).toBe(true);
    expect(r("doc.pdf")).toBe(true);
    expect(r("song.mp3")).toBe(false);
    expect(r("archive.zip")).toBe(true);
    expect(r("note.md")).toBe(false);
    expect(r("board.canvas")).toBe(false);
    expect(r("Private")).toBe(true);
    expect(r("private/x.md")).toBe(true);
    expect(r("Privateer/x.md")).toBe(false);
    expect(r("Big Files/movie.mp4")).toBe(true);
    expect(r(".obsidian/hotkeys.json")).toBe(true);
    expect(r(".obsidian/snippets/a.css")).toBe(true);
    expect(r(".obsidian/app.json")).toBe(false);
    expect(r(".obsidian/graph.json")).toBe(false);
    expect(r("Folder")).toBe(false); // folders are never excluded by type
  });

  it("everything on = no rule", () => {
    expect(excludeRule(s({ config: { communityPlugins: true, communityPluginData: true } as any }))).toBeUndefined();
    expect(configCategory(".obsidian/daily-notes.json")).toBe("corePluginSettings");
    expect(configCategory("Notes/.obsidian.md")).toBe(null);
    // A vault with its own config folder (Settings › Files › Override config folder).
    expect(configCategory(".config/hotkeys.json", ".config")).toBe("hotkeys");
    expect(configCategory(".obsidian/hotkeys.json", ".config")).toBe(null);
    expect(excludeRule(s({ config: { hotkeys: false } as any }), ".config")!(".config/hotkeys.json")).toBe(true);
  });
});
