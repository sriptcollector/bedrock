import { describe, expect, it } from "vitest";
import { LinkIndex, parseLinktext, splitAlias, getLinkpath } from "../../src/core/links";
import { normalizePath } from "../../src/core/path";

const files = [
  "Note.md",
  "Folder/Note.md",
  "Folder/Sub/Deep.md",
  "Other/Deep.md",
  "Projects/Alpha.md",
  "Attachments/image.png",
  "Attachments/Note.png",
  "v1.2 release.md",
  "Daily/2026-10-21.md",
];
const idx = new LinkIndex(files);

describe("parseLinktext / splitAlias", () => {
  it("splits path and subpath", () => {
    expect(parseLinktext("Note#Heading")).toEqual({ path: "Note", subpath: "#Heading" });
    expect(parseLinktext("Note#^block")).toEqual({ path: "Note", subpath: "#^block" });
    expect(parseLinktext("#Heading")).toEqual({ path: "", subpath: "#Heading" });
    expect(getLinkpath("A/B#c")).toBe("A/B");
  });
  it("splits aliases, including escaped pipes in tables", () => {
    expect(splitAlias("Note|Shown")).toEqual({ link: "Note", alias: "Shown" });
    expect(splitAlias("Note\\|Shown")).toEqual({ link: "Note", alias: "Shown" });
    expect(splitAlias("Note")).toEqual({ link: "Note", alias: undefined });
  });
  it("normalizes paths", () => {
    expect(normalizePath("\\a//b/")).toBe("a/b");
    expect(normalizePath("")).toBe("/");
  });
});

describe("LinkIndex.resolve (Obsidian's shortest-path resolution)", () => {
  it("resolves an exact vault path with or without .md", () => {
    expect(idx.resolve("Folder/Note", "x.md")).toBe("Folder/Note.md");
    expect(idx.resolve("Folder/Note.md", "x.md")).toBe("Folder/Note.md");
  });
  it("prefers the root file for a bare name from the root", () => {
    expect(idx.resolve("Note", "Projects/Alpha.md")).toBe("Note.md");
  });
  it("prefers a file in the source note's folder", () => {
    expect(idx.resolve("Note", "Folder/Other.md")).toBe("Folder/Note.md");
  });
  it("resolves relative to the source folder", () => {
    expect(idx.resolve("Sub/Deep", "Folder/x.md")).toBe("Folder/Sub/Deep.md");
  });
  it("matches partial paths by suffix", () => {
    expect(idx.resolve("Sub/Deep", "Daily/x.md")).toBe("Folder/Sub/Deep.md");
  });
  it("breaks ties by shortest path", () => {
    expect(idx.resolve("Deep", "Daily/x.md")).toBe("Other/Deep.md");
  });
  it("handles ./ and ../", () => {
    expect(idx.resolve("./Note", "Folder/a.md")).toBe("Folder/Note.md");
    expect(idx.resolve("../Note", "Folder/a.md")).toBe("Note.md");
  });
  it("is case-insensitive", () => {
    expect(idx.resolve("projects/alpha", "x.md")).toBe("Projects/Alpha.md");
    expect(idx.resolve("ALPHA", "x.md")).toBe("Projects/Alpha.md");
  });
  it("resolves attachments by name with extension, and prefers notes for bare names", () => {
    expect(idx.resolve("image.png", "Note.md")).toBe("Attachments/image.png");
    expect(idx.resolve("Note.png", "x.md")).toBe("Attachments/Note.png");
  });
  it("treats dots in note names as part of the name", () => {
    expect(idx.resolve("v1.2 release", "x.md")).toBe("v1.2 release.md");
  });
  it("decodes %20 in markdown-style links", () => {
    expect(idx.resolve("Projects/Alpha%20", "x.md")).toBe(null);
    expect(idx.resolve("v1.2%20release.md", "x.md")).toBe("v1.2 release.md");
  });
  it("returns null for missing notes", () => {
    expect(idx.resolve("Nope", "x.md")).toBe(null);
  });
  it("follows adds and removes", () => {
    const i2 = new LinkIndex(["A.md"]);
    expect(i2.resolve("B", "A.md")).toBe(null);
    i2.add("Dir/B.md");
    expect(i2.resolve("B", "A.md")).toBe("Dir/B.md");
    i2.remove("Dir/B.md");
    expect(i2.resolve("B", "A.md")).toBe(null);
  });
});

describe("LinkIndex.linkText (new link format)", () => {
  it("uses the bare name when unique (shortest)", () => {
    expect(idx.linkText("Projects/Alpha.md", "Daily/x.md")).toBe("Alpha");
  });
  it("uses the full path when the name is ambiguous", () => {
    expect(idx.linkText("Folder/Note.md", "Daily/x.md")).toBe("Folder/Note");
    expect(idx.linkText("Note.md", "Daily/x.md")).toBe("Note");
  });
  it("supports relative and absolute formats", () => {
    expect(idx.linkText("Projects/Alpha.md", "Daily/x.md", "relative")).toBe("../Projects/Alpha");
    expect(idx.linkText("Projects/Alpha.md", "Daily/x.md", "absolute")).toBe("Projects/Alpha");
    expect(idx.linkText("Attachments/image.png", "Daily/x.md", "absolute")).toBe("Attachments/image.png");
  });
});

// Parity cases captured from Obsidian 1.14.4 (isolated instance, metadataCache.getFirstLinkpathDest
// and fileToLinktext on the same file set) on 2026-10-21.
describe("parity with Obsidian 1.14.4", () => {
  const observed: [string, string, string | null][] = [
    ["Note", "Projects/Alpha.md", "Note.md"],
    ["Note", "Folder/Other.md", "Folder/Note.md"],
    ["Sub/Deep", "Folder/Other.md", "Folder/Sub/Deep.md"],
    ["Sub/Deep", "Projects/Alpha.md", "Folder/Sub/Deep.md"],
    ["Deep", "Projects/Alpha.md", "Other/Deep.md"],
    ["./Note", "Folder/Other.md", "Folder/Note.md"],
    ["../Note", "Folder/Other.md", "Note.md"],
    ["projects/alpha", "x.md", "Projects/Alpha.md"],
    ["ALPHA", "x.md", "Projects/Alpha.md"],
    ["image.png", "Note.md", "Attachments/image.png"],
    ["Note.png", "x.md", "Attachments/Note.png"],
    ["v1.2 release", "x.md", "v1.2 release.md"],
    ["Folder/Note", "x.md", "Folder/Note.md"],
    ["Nope", "x.md", null],
  ];
  for (const [link, src, want] of observed) it(`${link} from ${src}`, () => expect(idx.resolve(link, src)).toBe(want));
  it("fileToLinktext uses the full path when the name is shared, even from the same folder", () => {
    const i2 = new LinkIndex(["P/Note.md", "P/Folder/Note.md", "P/Folder/Other.md", "P/Projects/Alpha.md"]);
    expect(i2.linkText("P/Projects/Alpha.md", "P/Daily/x.md")).toBe("Alpha");
    expect(i2.linkText("P/Folder/Note.md", "P/Daily/x.md")).toBe("P/Folder/Note");
    expect(i2.linkText("P/Note.md", "P/Daily/x.md")).toBe("P/Note");
    expect(i2.linkText("P/Folder/Note.md", "P/Folder/Other.md")).toBe("P/Folder/Note");
  });
});
