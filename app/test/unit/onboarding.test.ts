// First-run onboarding: the prompts (with the real vault path), the "Instructions for Claude" file
// writer, and the graph colour groups the gradient schemes turn into. Also the graph's use of the
// `icon` / `color` note properties.
import { describe, expect, it } from "vitest";
import {
  AREAS,
  DEFAULT_SCHEME,
  GRADIENT_SCHEMES,
  INSTRUCTIONS_HEADER,
  THEME_REQUEST_BODY,
  THEME_REQUEST_TITLE,
  addRequest,
  areaColorGroups,
  areaLevelColor,
  buildDailyPrompt,
  buildWikiPrompt,
  getScheme,
  instructionsAbsPath,
  mergeAreaColorGroups,
  newInstructionsFile,
  openRequests,
  preferredSchemeName,
  setPreferences,
  APP_PRESETS,
} from "../../src/core/onboarding";
import { buildGraphData, flatten, localGraph, nodeIcon, propColor, type GraphSource } from "../../src/renderer/views/graph/data";
import { GraphQuery } from "../../src/renderer/views/graph/query";
import { bookThemeCss } from "../../src/renderer/onboarding/themes";

const WIN = "C:\\Users\\sam\\Documents\\Bedrock";
const MAC = "/Users/sam/Documents/Bedrock";

describe("prompts", () => {
  it("prompt 1 names the real vault path and the instructions file", () => {
    const p = buildWikiPrompt(WIN, DEFAULT_SCHEME, "2026-10-26");
    expect(p).toContain(`\n${WIN}\n`);
    expect(p).toContain(`"C:\\Users\\sam\\Documents\\Bedrock\\Bedrock\\Instructions for Claude.md"`);
    // reads the instructions first, then gathers, then writes
    expect(p.indexOf("READ BEDROCK'S INSTRUCTIONS FIRST")).toBeLessThan(p.indexOf("LEARN ABOUT ME"));
    for (const s of ["Home.md", "About me.md", "Projects/", "People/", "Companies/", "Skills/", "Timeline.md", "[[wikilinks]]", "gh repo list", "CLAUDE.md", "Never copy secrets", "area/work", "activity/4", "icon:", "color:", "updated: 2026-10-26", ".obsidian/graph.json", "create_note"]) expect(p).toContain(s);
    for (const a of AREAS) expect(p).toContain(a.name);
    // default colours come from the scheme
    expect(p).toContain(`Work ${DEFAULT_SCHEME.colors[0]}`);
  });

  it("prompt 1 on macOS uses forward slashes", () => {
    const p = buildWikiPrompt(MAC);
    expect(p).toContain(`"${MAC}/Bedrock/Instructions for Claude.md"`);
    expect(instructionsAbsPath(MAC + "/")).toBe(`${MAC}/Bedrock/Instructions for Claude.md`);
  });

  it("prompt 2 sets up a local daily job with the vault path", () => {
    const p = buildDailyPrompt(WIN);
    expect(p).toContain(`at ${WIN} with today's activity`);
    expect(p).toContain(instructionsAbsPath(WIN));
    for (const s of ["once a day", "local scheduled task", "Daily/YYYY-MM-DD.md", "commits, pull requests, issues and reviews", "calendar", "Never store secrets", "activity/3 after 7 days"]) expect(p).toContain(s);
  });
});

describe("instructions file", () => {
  it("starts with a header that explains the format", () => {
    const t = newInstructionsFile();
    expect(t.startsWith("# Instructions for Claude")).toBe(true);
    expect(t).toContain("Bedrock writes requests here");
    expect(t).toContain("## Requests");
  });

  it("adds requests at the end of Requests and does not repeat an open one", () => {
    let t = addRequest(null, THEME_REQUEST_TITLE, THEME_REQUEST_BODY, "2026-10-26");
    expect(t.startsWith(INSTRUCTIONS_HEADER)).toBe(true);
    expect(openRequests(t)).toEqual([`Theme request (2026-10-26): ${THEME_REQUEST_BODY}`]);
    expect(t).toContain("`.obsidian/snippets/claude-theme.css`");
    expect(t).toContain("`.obsidian/appearance.json`");
    t = addRequest(t, "Other", "do something.", "2026-10-26");
    t = addRequest(t, THEME_REQUEST_TITLE, "again.", "2026-10-27");
    expect(openRequests(t)).toEqual(["Theme request (2026-10-27): again.", "Other (2026-10-26): do something."]);
    // a finished request stays and a new one is added after it
    t = t.replace("- [ ] Other", "- [x] Other");
    t = addRequest(t, "Other", "once more.", "2026-10-28");
    expect(t).toContain("- [x] Other (2026-10-26): do something.");
    expect(openRequests(t)).toContain("Other (2026-10-28): once more.");
  });

  it("keeps text the person or Claude added and writes Preferences before Requests", () => {
    const start = "# Instructions for Claude\n\nMy own note.\n\n## Requests\n\n- [x] Old (2026-01-01): done (done 2026-01-02)\n\n## Notes from Claude\n\nSomething.\n";
    const sunset = getScheme("sunset");
    let t = setPreferences(start, { scheme: sunset, preset: APP_PRESETS[1], mode: "obsidian", theme: "pixelated", date: "2026-10-26" });
    expect(t).toContain("My own note.");
    expect(t).toContain("- [x] Old (2026-01-01)");
    expect(t).toContain("## Notes from Claude\n\nSomething.");
    expect(t.indexOf("## Preferences")).toBeLessThan(t.indexOf("## Requests"));
    expect(t).toContain("- Graph colors: Sunset");
    expect(t).toContain("- App colors: Ocean (accent #2f7ddb, dark mode)");
    expect(t).toContain("- Book theme: Pixelated");
    expect(t).toContain(`| Work | area/work | ${sunset.colors[0]} |`);
    expect(preferredSchemeName(t)).toBe("Sunset");
    // replacing preferences keeps one section
    t = setPreferences(t, { scheme: getScheme("forest"), theme: "claude", date: "2026-10-27" });
    expect(t.match(/## Preferences/g)?.length).toBe(1);
    expect(preferredSchemeName(t)).toBe("Forest");
    expect(t).toContain("- Book theme: Let Claude decide");
    expect(t.match(/## Requests/g)?.length).toBe(1);
  });
});

describe("graph colour groups", () => {
  it("one group per area and activity level, strong to faint, then a catch-all", () => {
    const g = areaColorGroups(DEFAULT_SCHEME);
    expect(g.length).toBe(AREAS.length * 5);
    expect(g[0].query).toBe("tag:#area/work tag:#activity/4");
    expect(g[0].color.rgb).toBe(parseInt(DEFAULT_SCHEME.colors[0].slice(1), 16));
    expect(g[4].query).toBe("tag:#area/work");
    expect(areaLevelColor(DEFAULT_SCHEME, 0, 4)).toBe(DEFAULT_SCHEME.colors[0]);
    expect(areaLevelColor(DEFAULT_SCHEME, 0, 1)).not.toBe(DEFAULT_SCHEME.colors[0]);
    // the queries match the tags the prompts tell Claude to write
    const q = new GraphQuery(g[0].query);
    expect(q.match({ path: "Projects/A.md", name: "A.md", tags: ["#area/work", "#activity/4"], content: null })).toBe(true);
    expect(q.match({ path: "Projects/A.md", name: "A.md", tags: ["#area/work", "#activity/3"], content: null })).toBe(false);
  });

  it("replaces only its own groups and keeps the person's groups first", () => {
    const mine = { query: "path:Daily", color: { a: 1, rgb: 1 } };
    const once = mergeAreaColorGroups([mine], getScheme("ocean"));
    const twice = mergeAreaColorGroups(once, getScheme("candy"));
    expect(twice[0]).toEqual(mine);
    expect(twice.length).toBe(1 + AREAS.length * 5);
    expect(twice[1].color.rgb).toBe(parseInt(getScheme("candy").colors[0].slice(1), 16));
  });

  it("every scheme has one colour per area", () => {
    for (const s of GRADIENT_SCHEMES) {
      expect(s.colors.length).toBe(AREAS.length);
      for (const c of s.colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("graph icons and colours from note properties", () => {
  const props: Record<string, any> = {
    "Home.md": { icon: "🏠", color: "#ff0000" },
    "Projects/A.md": { icon: "🚀 rocket", color: "zzz" },
    "B.md": { color: "0a0" },
  };
  const src: GraphSource = {
    files: ["Home.md", "Projects/A.md", "B.md"],
    resolvedLinks: { "Home.md": { "Projects/A.md": 1, "B.md": 1 }, "Projects/A.md": {}, "B.md": {} },
    unresolvedLinks: {},
    fileTags: () => [],
    vaultTags: () => [],
    isUserIgnored: () => false,
    fileProps: (p) => props[p] ?? null,
  };

  it("uses `icon` and falls back to `color` when no colour group matches", () => {
    const d = buildGraphData(src, { showTags: false, showAttachments: false, hideUnresolved: false, showOrphans: true });
    expect(d.nodes["Home.md"].icon).toBe("🏠");
    expect(d.nodes["Home.md"].color).toEqual({ a: 1, rgb: 0xff0000 });
    expect(d.nodes["Projects/A.md"].icon).toBe("🚀");
    expect(d.nodes["Projects/A.md"].color).toBeUndefined();
    expect(d.nodes["B.md"].color).toEqual({ a: 1, rgb: 0x00aa00 });
    const f = flatten(d);
    expect(f.icons[f.index.get("Home.md")!]).toBe("🏠");
    expect(f.icons[f.index.get("B.md")!]).toBe("");
    const local = localGraph(d, { localFile: "Home.md", localJumps: 1, localInterlinks: false, localForelinks: true, localBacklinks: true });
    expect(local.nodes["Home.md"].icon).toBe("🏠");
    expect(local.nodes["Projects/A.md"].icon).toBe("🚀");
  });

  it("a matching colour group wins over the `color` property", () => {
    const group = { a: 1, rgb: 0x123456 };
    const d = buildGraphData(src, { showTags: false, showAttachments: false, hideUnresolved: false, showOrphans: true }, (id) => (id === "Home.md" ? group : true));
    expect(d.nodes["Home.md"].color).toEqual(group);
  });

  it("parses icon and colour values defensively", () => {
    expect(nodeIcon("👩‍💻 dev")).toBe("👩‍💻");
    expect(nodeIcon(5)).toBe("");
    expect(nodeIcon("a very long piece of text here")).toBe("");
    expect(propColor("#ABCDEF")).toEqual({ a: 1, rgb: 0xabcdef });
    expect(propColor("red")).toBeNull();
  });
});

describe("book themes", () => {
  it("each non-Claude theme is a CSS snippet with square corners or decorations", () => {
    expect(bookThemeCss("pixelated")).toContain("--radius-m: 0");
    expect(bookThemeCss("minimal")).toContain("--file-line-width");
    expect(bookThemeCss("animals")).toContain("data:image/svg+xml");
    expect(bookThemeCss("halloween")).toContain("theme-dark");
    expect(bookThemeCss("none")).toBe("");
    expect(bookThemeCss("claude")).toBe("");
  });
});
