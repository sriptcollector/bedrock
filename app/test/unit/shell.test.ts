import { describe, expect, it } from "vitest";
import { parseAppUri, parseQuery, isAppUri, buildOpenUrl, vaultForPath } from "../../src/shared/uri";
import { migrateFrontmatter, needsFrontmatterMigration } from "../../src/core/frontmatter-migrate";

const S = ["bedrock", "obsidian"];

describe("URI parsing", () => {
  it("parses actions and parameters", () => {
    expect(parseAppUri("bedrock://open?vault=My%20Notes&file=Folder%2FNote", S)).toEqual({ action: "open", params: { vault: "My Notes", file: "Folder/Note" } });
    expect(parseAppUri("obsidian://new?vault=v&name=Idea&content=Hello%20there&silent", S)).toEqual({ action: "new", params: { vault: "v", name: "Idea", content: "Hello there", silent: "true" } });
    expect(parseAppUri("bedrock://search?query=tag%3A%23a", S)?.params.query).toBe("tag:#a");
  });
  it("keeps + in names (no form decoding)", () => {
    expect(parseQuery("file=C%2B%2B%20notes")).toEqual({ file: "C++ notes" });
    expect(parseQuery("file=a+b")).toEqual({ file: "a+b" });
  });
  it("handles the trailing slash Windows adds", () => {
    expect(parseAppUri("bedrock://open/?vault=v", S)).toEqual({ action: "open", params: { vault: "v" } });
  });
  it("parses the vault short form", () => {
    expect(parseAppUri("bedrock://vault/My%20Vault/Folder/Note%20A", S)).toEqual({ action: "open", params: { vault: "My Vault", file: "Folder/Note A" } });
  });
  it("parses absolute paths", () => {
    expect(parseAppUri("bedrock:///C:/Notes/a.md", S)).toEqual({ action: "open", params: { path: "C:/Notes/a.md" } });
    expect(parseAppUri("obsidian:///Users/me/Notes/a.md", S)).toEqual({ action: "open", params: { path: "/Users/me/Notes/a.md" } });
  });
  it("ignores other schemes", () => {
    expect(parseAppUri("https://example.com", S)).toBeNull();
    expect(isAppUri("bedrock://open", S)).toBe(true);
    expect(isAppUri("C:\\notes\\a.md", S)).toBe(false);
  });
  it("builds open URLs without .md", () => {
    expect(buildOpenUrl("bedrock", "My Vault", "People/Ada Lovelace.md")).toBe("bedrock://open?vault=My%20Vault&file=People%2FAda%20Lovelace");
  });
  it("finds the vault containing a path", () => {
    expect(vaultForPath("C:\\Docs\\Vault\\a\\b.md", ["C:\\Docs\\Other", "C:\\Docs\\Vault"])).toEqual({ vault: "C:\\Docs\\Vault", rel: "a/b.md" });
    expect(vaultForPath("c:/docs/vault/x.md", ["C:\\Docs\\Vault"])?.rel).toBe("x.md");
    expect(vaultForPath("C:/Elsewhere/x.md", ["C:\\Docs\\Vault"])).toBeNull();
  });
});

describe("frontmatter migration", () => {
  it("folds singular keys into list keys", () => {
    const fm: any = { tag: "a b", alias: "My alias", cssclass: "wide", title: "x" };
    expect(migrateFrontmatter(fm)).toBe(true);
    expect(fm).toEqual({ title: "x", tags: ["a", "b"], aliases: ["My alias"], cssclasses: ["wide"] });
  });
  it("turns string values into lists and strips # from tags", () => {
    const fm: any = { tags: "#one, two", aliases: "Only one" };
    migrateFrontmatter(fm);
    expect(fm).toEqual({ tags: ["one", "two"], aliases: ["Only one"] });
  });
  it("leaves strict frontmatter alone", () => {
    const fm: any = { tags: ["a"], aliases: ["b c"] };
    expect(needsFrontmatterMigration(fm)).toBe(false);
    expect(migrateFrontmatter(fm)).toBe(false);
  });
});
