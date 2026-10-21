// @vitest-environment happy-dom
// Vault + MetadataCache + FileManager against a real temp folder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installDomHelpers } from "../../src/renderer/dom/augment";
import { FileSystemAdapter } from "../../src/renderer/vault/adapter";
import { Vault } from "../../src/renderer/vault/vault";
import { MetadataCache } from "../../src/renderer/metadata/cache";
import { FileManager } from "../../src/renderer/vault/file-manager";
import { scanVault } from "../../src/core/scan";
import { TFile, TFolder } from "../../src/renderer/vault/files";

installDomHelpers(window as any);

let dir: string;
let app: any;
const write = (p: string, s: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
  fs.writeFileSync(path.join(dir, p), s);
};
const read = (p: string) => fs.readFileSync(path.join(dir, p), "utf8");
const settle = () => new Promise((r) => setTimeout(r, 120));

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-vault-test-"));
  write("A.md", "Links: [[B]], [[B#Goals|goals]], ![[B#^blk]], [md](B.md) and [[Sub/C]].\n");
  write("B.md", "---\ntags: [x]\n---\n# B\n## Goals\nText ^blk\n");
  write("Sub/C.md", "Back to [[A]] and [[../B]].\n");
  write("Sub/D.md", "Unresolved [[Ghost]].\n");
  write("img.png", "png");
  const vault = new Vault(new FileSystemAdapter(dir));
  await vault.loadConfig();
  vault.buildTree(await scanVault(dir));
  app = { vault } as any;
  app.metadataCache = new MetadataCache(vault);
  app.fileManager = new FileManager(app);
  app.ui = { confirm: async () => true };
  await app.metadataCache.initialIndex(undefined);
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("vault tree", () => {
  it("builds TFile/TFolder with parents and extensions", () => {
    const b = app.vault.getFileByPath("B.md") as TFile;
    expect(b).toBeInstanceOf(TFile);
    expect(b.basename).toBe("B");
    expect(b.extension).toBe("md");
    expect(b.stat.size).toBeGreaterThan(0);
    const sub = app.vault.getFolderByPath("Sub") as TFolder;
    expect(sub.children.map((c: any) => c.name).sort()).toEqual(["C.md", "D.md"]);
    expect(app.vault.getMarkdownFiles().length).toBe(4);
  });

  it("create / modify / cachedRead / delete fire events", async () => {
    const events: string[] = [];
    const refs = ["create", "modify", "delete"].map((e) => app.vault.on(e, (f: any) => events.push(`${e}:${f.path}`)));
    const f = await app.vault.create("New/E.md", "hello");
    expect(await app.vault.cachedRead(f)).toBe("hello");
    await app.vault.modify(f, "changed");
    expect(read("New/E.md")).toBe("changed");
    await app.vault.delete(f);
    expect(fs.existsSync(path.join(dir, "New/E.md"))).toBe(false);
    refs.forEach((r) => app.vault.offref(r));
    expect(events).toEqual(["create:New", "create:New/E.md", "modify:New/E.md", "delete:New/E.md"]);
  });

  it("picks up external changes", async () => {
    write("Ext.md", "from outside [[A]]");
    await app.vault.onExternalChange("Ext.md");
    await settle();
    const f = app.vault.getFileByPath("Ext.md");
    expect(f).toBeTruthy();
    expect(app.metadataCache.resolvedLinks["Ext.md"]).toEqual({ "A.md": 1 });
    fs.rmSync(path.join(dir, "Ext.md"));
    await app.vault.onExternalChange("Ext.md");
    expect(app.vault.getFileByPath("Ext.md")).toBeNull();
  });
});

describe("metadata cache", () => {
  it("resolves links and tracks unresolved ones", () => {
    expect(app.metadataCache.resolvedLinks["A.md"]).toEqual({ "B.md": 4, "Sub/C.md": 1 });
    expect(app.metadataCache.resolvedLinks["Sub/C.md"]).toEqual({ "A.md": 1, "B.md": 1 });
    expect(app.metadataCache.unresolvedLinks["Sub/D.md"]).toEqual({ Ghost: 1 });
  });
  it("getFirstLinkpathDest / fileToLinktext", () => {
    expect(app.metadataCache.getFirstLinkpathDest("C", "A.md")?.path).toBe("Sub/C.md");
    expect(app.metadataCache.fileToLinktext(app.vault.getFileByPath("Sub/C.md"), "A.md")).toBe("C");
  });
  it("tags, headings, blocks, backlinks", () => {
    const b = app.vault.getFileByPath("B.md");
    const c = app.metadataCache.getFileCache(b);
    expect(c.headings.map((h: any) => h.heading)).toEqual(["B", "Goals"]);
    expect(Object.keys(c.blocks)).toEqual(["blk"]);
    expect(app.metadataCache.getTags()).toEqual({ "#x": 1 });
    expect(app.metadataCache.getBacklinksForFile(b).keys().sort()).toEqual(["A.md", "Sub/C.md"]);
  });
  it("creating a missing note resolves links that pointed at it", async () => {
    await app.vault.create("Ghost.md", "boo");
    await settle();
    expect(app.metadataCache.resolvedLinks["Sub/D.md"]).toEqual({ "Ghost.md": 1 });
    expect(app.metadataCache.unresolvedLinks["Sub/D.md"]).toEqual({});
  });
});

describe("file manager", () => {
  it("renameFile updates links in other notes (wikilinks, aliases, subpaths, embeds, markdown links)", async () => {
    await app.fileManager.renameFile(app.vault.getFileByPath("B.md"), "Moved/Bee.md");
    await settle();
    expect(read("A.md")).toBe("Links: [[Bee]], [[Bee#Goals|goals]], ![[Bee#^blk]], [md](Moved/Bee.md) and [[Sub/C]].\n");
    expect(read("Sub/C.md")).toBe("Back to [[A]] and [[Bee]].\n");
    expect(app.metadataCache.resolvedLinks["A.md"]["Moved/Bee.md"]).toBe(4);
  });
  it("moving a folder keeps links working", async () => {
    await app.fileManager.renameFile(app.vault.getFolderByPath("Sub"), "Archive/Sub");
    await settle();
    expect(app.vault.getFileByPath("Archive/Sub/C.md")).toBeTruthy();
    expect(read("A.md")).toContain("[[C]]");
  });
  it("processFrontMatter edits YAML in place", async () => {
    const f = app.vault.getFileByPath("Moved/Bee.md");
    await app.fileManager.processFrontMatter(f, (fm: any) => {
      fm.tags.push("y");
      fm.status = "done";
    });
    expect(read("Moved/Bee.md")).toBe("---\ntags:\n  - x\n  - y\nstatus: done\n---\n# B\n## Goals\nText ^blk\n");
  });
  it("generateMarkdownLink follows settings", () => {
    const f = app.vault.getFileByPath("Moved/Bee.md");
    expect(app.fileManager.generateMarkdownLink(f, "A.md")).toBe("[[Bee]]");
    expect(app.fileManager.generateMarkdownLink(f, "A.md", "#Goals", "g")).toBe("[[Bee#Goals|g]]");
    expect(app.fileManager.generateMarkdownLink(app.vault.getFileByPath("img.png"), "A.md")).toBe("![[img.png]]");
    app.vault.config.useMarkdownLinks = true;
    expect(app.fileManager.generateMarkdownLink(f, "A.md")).toBe("[Bee](Moved/Bee.md)");
    app.vault.config.useMarkdownLinks = false;
  });
});

describe("indexing speed", () => {
  it("indexes 2,000 generated notes in batches", async () => {
    const big = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-big-"));
    for (let i = 0; i < 2000; i++) fs.writeFileSync(path.join(big, `n${i}.md`), `# Note ${i}\nLinks [[n${(i + 1) % 2000}]] #t${i % 20}\n`);
    const v = new Vault(new FileSystemAdapter(big));
    v.buildTree(await scanVault(big));
    const mc = new MetadataCache(v);
    const stats = await mc.initialIndex(undefined);
    expect(stats.notes).toBe(2000);
    expect(Object.keys(mc.resolvedLinks).length).toBe(2000);
    expect(stats.ms).toBeLessThan(15000);
    fs.rmSync(big, { recursive: true, force: true });
  });
});

describe("file manager: links in properties and body", () => {
  it("rename updates body links even when the note also links from its properties", async () => {
    await app.vault.create("Both.md", "---\nrelated: \"[[Target]]\"\n---\nSee [[Target]] and [[Target#Goals]].\n");
    await app.vault.create("Target.md", "# Target\n## Goals\n");
    await settle();
    await app.fileManager.renameFile(app.vault.getFileByPath("Target.md"), "Renamed Target.md");
    await settle();
    expect(read("Both.md")).toBe("---\nrelated: \"[[Renamed Target]]\"\n---\nSee [[Renamed Target]] and [[Renamed Target#Goals]].\n");
  });
});
