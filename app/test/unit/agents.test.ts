// Agent access: vault operations (core/agent-ops), the local HTTP server (REST + MCP over
// Streamable HTTP, token, Host/Origin checks), the "Connect" config writers and the CLI, all
// against temp folders. Nothing here touches the real Claude / Cursor configs or app data.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AgentError, AgentOps, cleanVaultPath, patchUnderHeading, propMatches, setFrontmatterValue } from "../../src/core/agent-ops";
import { runTool, TOOLS } from "../../src/main/agents/tools";
import { AgentHttpServer } from "../../src/main/agents/http";
import { clientStates, connectClient, disconnectClient, mergeServerEntry, snippets } from "../../src/main/agents/clients";
import { loadSettings, readRunning, saveSettings, writeRunning } from "../../src/main/agents/settings";
import { parseArgs, parsePropFilter, runCli } from "../../src/cli/main";

const fixture = path.resolve(__dirname, "../fixtures/vault");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-agents-test-"));
let n = 0;

function makeVault(extra: Record<string, string> = {}): string {
  const dir = path.join(tmpRoot, `v${++n}`);
  fs.cpSync(fixture, dir, { recursive: true });
  for (const [p, s] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), s);
  }
  return dir;
}
const read = (dir: string, p: string) => fs.readFileSync(path.join(dir, p), "utf8");
const exists = (dir: string, p: string) => fs.existsSync(path.join(dir, p));

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ------------------------------------------------------------------ paths

describe("path safety", () => {
  it("cleans ordinary paths", () => {
    expect(cleanVaultPath("Projects/Alpha.md")).toBe("Projects/Alpha.md");
    expect(cleanVaultPath("Projects\\Alpha.md")).toBe("Projects/Alpha.md");
    expect(cleanVaultPath("/Projects//./Alpha")).toBe("Projects/Alpha");
  });
  it.each(["../x.md", "..\\x.md", "a/../../x.md", "a/b/../../../x", "C:\\Windows\\win.ini", "c:/x.md", "\\\\server\\share\\x.md", "//server/x"])("rejects %s", (p) => {
    expect(() => cleanVaultPath(p)).toThrow(AgentError);
    try {
      cleanVaultPath(p);
    } catch (e: any) {
      expect(e.code).toBe("forbidden");
    }
  });
  it.each([".obsidian/app.json", ".trash/x.md", "a/.git/config"])("rejects hidden folder %s", (p) => {
    expect(() => cleanVaultPath(p)).toThrow(/hidden folder/);
  });
  it("rejects bad characters and empty paths", () => {
    expect(() => cleanVaultPath("a<b.md")).toThrow(AgentError);
    expect(() => cleanVaultPath("")).toThrow(AgentError);
    expect(() => cleanVaultPath("  ")).toThrow(AgentError);
    expect(() => cleanVaultPath(42 as any)).toThrow(AgentError);
  });

  it("refuses links (junctions/symlinks) that lead out of the vault", async () => {
    const vault = makeVault();
    const outside = path.join(tmpRoot, "outside-" + n);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "secret.md"), "secret");
    try {
      fs.symlinkSync(outside, path.join(vault, "Escape"), process.platform === "win32" ? "junction" : "dir");
    } catch {
      return; // no permission to make links here
    }
    const ops = new AgentOps({ vaultPath: vault });
    await expect(ops.readNote({ path: "Escape/secret.md" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(ops.createNote({ path: "Escape/new.md", content: "x" })).rejects.toMatchObject({ code: "forbidden" });
    expect(fs.existsSync(path.join(outside, "new.md"))).toBe(false);
  });

  it("every tool rejects traversal", async () => {
    const vault = makeVault();
    const ops = new AgentOps({ vaultPath: vault });
    const attempts: [string, any][] = [
      ["read_note", { path: "../../etc/passwd" }],
      ["create_note", { path: "../evil.md", content: "x" }],
      ["edit_note", { path: "..\\Welcome.md", mode: "replace", content: "x" }],
      ["append_to_note", { path: "../evil.md", text: "x" }],
      ["move_note", { from: "Beta.md", to: "../Beta.md" }],
      ["move_note", { from: "Beta.md", to: ".obsidian/Beta.md" }],
      ["delete_note", { path: "../Welcome.md" }],
      ["set_property", { path: "C:/Windows/x.md", key: "a", value: 1 }],
      ["list_folder", { path: "../" }],
      ["list_notes", { folder: ".." }],
    ];
    for (const [tool, args] of attempts) await expect(runTool(ops, tool, args), `${tool} ${JSON.stringify(args)}`).rejects.toMatchObject({ code: "forbidden" });
    expect(exists(path.dirname(vault), "evil.md")).toBe(false);
    expect(exists(vault, "Beta.md")).toBe(true);
  });
});

// ------------------------------------------------------------------ operations

describe("AgentOps", () => {
  let vault: string;
  let ops: AgentOps;
  beforeEach(() => {
    vault = makeVault({
      "Projects/Gamma.md": "---\nstatus: active\npriority: 2\ndue: 2026-11-05\ntags: [project, project/gamma]\nowner: Sam\n---\n# Gamma\nLinks to [[Beta|the beta]] and [b](../Beta.md).\n",
      "Projects/Delta.md": "---\nstatus: done\npriority: 5\ndue: 2026-09-01\ntags:\n  - project\n---\n# Delta\nMentions Beta without a link. #work\n",
      "Notes/Rel.md": "---\nrelated: \"[[Beta]]\"\n---\nSee [[Beta#Goals]] and ![[Beta]].\n",
    });
    ops = new AgentOps({ vaultPath: vault, now: () => new Date(2026, 9, 21, 9, 30) });
  });

  it("reads notes by path, by path without .md and by link name", async () => {
    const a = await ops.readNote({ path: "Welcome.md" });
    expect(a.path).toBe("Welcome.md");
    expect(a.frontmatter).toMatchObject({ title: "Welcome", rating: 4 });
    expect(a.tags).toEqual(expect.arrayContaining(["#intro", "#demo", "#nested/tag"]));
    expect(a.headings[0]).toMatchObject({ heading: "Welcome to the test vault", level: 1, line: 10 });
    expect((await ops.readNote({ path: "Projects/Alpha" })).path).toBe("Projects/Alpha.md");
    expect((await ops.readNote({ path: "Gamma" })).path).toBe("Projects/Gamma.md");
    await expect(ops.readNote({ path: "Nope" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("creates notes (adds .md, makes folders, refuses to overwrite)", async () => {
    const r = await ops.createNote({ path: "Inbox/Deep/Idea", content: "# Idea\n" });
    expect(r).toMatchObject({ path: "Inbox/Deep/Idea.md", created: true });
    expect(read(vault, "Inbox/Deep/Idea.md")).toBe("# Idea\n");
    await expect(ops.createNote({ path: "Inbox/Deep/Idea.md", content: "x" })).rejects.toMatchObject({ code: "exists" });
    await ops.createNote({ path: "Inbox/Deep/Idea.md", content: "y", overwrite: true });
    expect(read(vault, "Inbox/Deep/Idea.md")).toBe("y");
    // no temp files left behind
    expect(fs.readdirSync(path.join(vault, "Inbox/Deep"))).toEqual(["Idea.md"]);
  });

  it("edits: replace, find/replace and patch under a heading", async () => {
    await ops.editNote({ path: "Beta", mode: "find_replace", find: "Ship the editor", replace: "Ship it" });
    expect(read(vault, "Beta.md")).toContain("- Ship it\n");
    await expect(ops.editNote({ path: "Beta", mode: "find_replace", find: "not there", replace: "x" })).rejects.toMatchObject({ code: "not_found" });
    const r = await ops.editNote({ path: "Beta", mode: "find_replace", find: "- (\\w+)", replace: "* $1", regex: true, all: true });
    expect(r.replacements).toBe(2);
    expect(read(vault, "Beta.md")).toContain("* Ship it\n* Keep links working");

    await ops.editNote({ path: "Welcome", mode: "patch_heading", heading: "## Tasks", content: "- [ ] New task", position: "append" });
    const w = read(vault, "Welcome.md");
    expect(w).toMatch(/- \[x\] Set up the vault\n- A plain bullet\n {2}- Nested bullet \^bullet-id\n\n1\. First\n2\. Second\n[\s\S]*- \[ \] New task\n/);
    await ops.editNote({ path: "Beta", mode: "patch_heading", heading: "Goals", content: "Only this." });
    expect(read(vault, "Beta.md")).toBe("# Beta\n\nBack to [[Welcome]].\n\n## Goals\nOnly this.\n");
    await ops.editNote({ path: "Beta", mode: "patch_heading", heading: "Beta", content: "Intro line.", position: "prepend" });
    expect(read(vault, "Beta.md")).toBe("# Beta\nIntro line.\n\nBack to [[Welcome]].\n\n## Goals\nOnly this.\n");
    await expect(ops.editNote({ path: "Beta", mode: "patch_heading", heading: "Nope", content: "x" })).rejects.toThrow(/headings are: # Beta, ## Goals/);
    await ops.editNote({ path: "Beta", mode: "replace", content: "new" });
    expect(read(vault, "Beta.md")).toBe("new");
  });

  it("patches a heading in the middle and keeps the next section", () => {
    const t = "# A\none\n## B\ntwo\n## C\nthree\n";
    expect(patchUnderHeading(t, "B", "TWO", "replace")).toBe("# A\none\n## B\nTWO\n\n## C\nthree\n");
    expect(patchUnderHeading(t, "B", "more", "append")).toBe("# A\none\n## B\ntwo\nmore\n\n## C\nthree\n");
    expect(patchUnderHeading("# Last", "Last", "x", "append")).toBe("# Last\nx\n");
  });

  it("appends (creating the note when missing)", async () => {
    await ops.appendToNote({ path: "Beta", text: "- appended" });
    expect(read(vault, "Beta.md").endsWith("- Keep links working\n- appended\n")).toBe(true);
    const r = await ops.appendToNote({ path: "Log/Agent log", text: "first" });
    expect(r).toMatchObject({ path: "Log/Agent log.md", created: true });
    expect(read(vault, "Log/Agent log.md")).toBe("first\n");
    await expect(ops.appendToNote({ path: "Missing", text: "x", create: false })).rejects.toMatchObject({ code: "not_found" });
  });

  it("moves a note and updates every kind of link to it", async () => {
    const r = await ops.moveNote({ from: "Beta.md", to: "Archive/Beta renamed.md" });
    expect(r.from).toBe("Beta.md");
    expect(r.to).toBe("Archive/Beta renamed.md");
    expect(exists(vault, "Beta.md")).toBe(false);
    expect(exists(vault, "Archive/Beta renamed.md")).toBe(true);
    expect(read(vault, "Welcome.md")).toContain("[[Beta renamed]], [[Beta renamed#Goals]], [[Missing note]]");
    expect(read(vault, "Welcome.md")).toContain("![[Beta renamed#Goals]]");
    expect(read(vault, "Projects/Alpha.md")).toContain("See [[Beta renamed]] and");
    expect(read(vault, "Projects/Gamma.md")).toContain("[[Beta renamed|the beta]]");
    expect(read(vault, "Projects/Gamma.md")).toContain("[b](Archive/Beta%20renamed.md)");
    const rel = read(vault, "Notes/Rel.md");
    expect(rel).toContain('related: "[[Beta renamed]]"');
    expect(rel).toContain("See [[Beta renamed#Goals]] and ![[Beta renamed]].");
    expect(r.updatedNotes.sort()).toEqual(["Notes/Rel.md", "Projects/Alpha.md", "Projects/Gamma.md", "Welcome.md"]);
    // backlinks follow
    const bl = await ops.getBacklinks({ path: "Beta renamed" });
    expect(bl.backlinks.map((b: any) => b.source).sort()).toEqual(["Notes/Rel.md", "Projects/Alpha.md", "Projects/Gamma.md", "Welcome.md"]);
  });

  it("moves into a folder keeping the name, and honours updateLinks:false", async () => {
    fs.mkdirSync(path.join(vault, "Archive"));
    const r = await ops.moveNote({ from: "Beta", to: "Archive", updateLinks: false });
    expect(r.to).toBe("Archive/Beta.md");
    expect(read(vault, "Projects/Alpha.md")).toContain("See [[Beta]] and");
    await expect(ops.moveNote({ from: "Welcome", to: "Projects/Alpha.md" })).rejects.toMatchObject({ code: "exists" });
  });

  it("uses the vault's link format when it rewrites links", async () => {
    fs.writeFileSync(path.join(vault, ".obsidian", "app.json"), JSON.stringify({ newLinkFormat: "relative" }));
    await ops.moveNote({ from: "Beta", to: "Deep/Er/Beta" });
    expect(read(vault, "Projects/Alpha.md")).toContain("See [[../Deep/Er/Beta]] and");
  });

  it("moves its own relative links along", async () => {
    fs.writeFileSync(path.join(vault, "Projects/Rel2.md"), "[[./Gamma]] and [g](Gamma.md)\n");
    await ops.moveNote({ from: "Projects/Rel2.md", to: "Elsewhere/Rel2.md" });
    const t = read(vault, "Elsewhere/Rel2.md");
    expect(t).toContain("[[Gamma]]");
    expect(t).toContain("[g](Projects/Gamma.md)");
  });

  it("deletes to .trash, never permanently", async () => {
    const r = await ops.deleteNote({ path: "Beta" });
    expect(r.movedTo).toBe(".trash/Beta.md");
    expect(exists(vault, "Beta.md")).toBe(false);
    expect(read(vault, ".trash/Beta.md")).toContain("# Beta");
    fs.writeFileSync(path.join(vault, "Beta.md"), "again");
    expect((await ops.deleteNote({ path: "Beta" })).movedTo).toBe(".trash/Beta 1.md");
    expect((await ops.listNotes()).notes.map((x) => x.path)).not.toContain(".trash/Beta.md");
  });

  it("lists notes and folders", async () => {
    const all = await ops.listNotes();
    expect(all.notes.map((x) => x.path)).toEqual(["Beta.md", "Daily/2026-10-21.md", "Notes/Rel.md", "Projects/Alpha.md", "Projects/Delta.md", "Projects/Gamma.md", "Welcome.md"]);
    expect((await ops.listNotes({ folder: "Projects", recursive: false })).total).toBe(3);
    expect((await ops.listNotes({ allFiles: true })).notes.map((x) => x.path)).toContain("pixel.png");
    const f = await ops.listFolder({});
    expect(f.folders).toEqual(["Daily", "Notes", "Projects"]);
    expect(f.files.map((x) => x.path)).toEqual(["Beta.md", "pixel.png", "Welcome.md"]);
    await expect(ops.listFolder({ path: "Nope" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("backlinks (with unlinked mentions) and outgoing links", async () => {
    const bl = await ops.getBacklinks({ path: "Beta", unlinked: true });
    expect(bl.backlinks.map((b: any) => b.source)).toEqual(["Notes/Rel.md", "Projects/Alpha.md", "Projects/Gamma.md", "Welcome.md"]);
    const w = bl.backlinks.find((b: any) => b.source === "Welcome.md");
    expect(w.count).toBe(3);
    expect(w.lines.map((l: any) => l.line)).toEqual([13, 57]);
    expect(bl.unlinkedMentions.map((m: any) => m.source)).toEqual(["Projects/Delta.md"]);
    const out = await ops.getOutgoingLinks({ path: "Welcome" });
    const byLink = Object.fromEntries(out.links.map((l: any) => [l.link, l]));
    expect(byLink["Projects/Alpha"].target).toBe("Projects/Alpha.md");
    expect(byLink["Missing note"]).toMatchObject({ resolved: false, target: null });
    expect(byLink["pixel.png"]).toMatchObject({ embed: true, target: "pixel.png" });
  });

  it("tags and notes with a tag (nested included)", async () => {
    const t = await ops.listTags();
    const counts = Object.fromEntries(t.tags.map((x) => [x.tag, x.count]));
    expect(counts["#project"]).toBe(2);
    expect(counts["#project/gamma"]).toBe(1);
    expect(counts["#work"]).toBe(1);
    expect((await ops.notesWithTag({ tag: "project" })).notes).toEqual(["Projects/Delta.md", "Projects/Gamma.md"]);
    expect((await ops.notesWithTag({ tag: "#Project/Gamma" })).notes).toEqual(["Projects/Gamma.md"]);
    expect((await ops.notesWithTag({ tag: "nested" })).notes).toEqual(["Welcome.md"]);
    expect((await ops.notesWithTag({ tag: "nested", includeNested: false })).notes).toEqual([]);
  });

  it("queries properties: equals, contains, exists, missing, comparisons and ranges", async () => {
    const q = async (filters: any[], match?: "all" | "any") => (await ops.queryProperties({ filters, match })).notes.map((x) => x.path);
    expect(await q([{ key: "status", op: "equals", value: "active" }])).toEqual(["Projects/Gamma.md"]);
    expect(await q([{ key: "Status", op: "equals", value: "ACTIVE" }])).toEqual(["Projects/Gamma.md"]);
    expect(await q([{ key: "tags", op: "contains", value: "gamma" }])).toEqual(["Projects/Gamma.md"]);
    expect(await q([{ key: "tags", op: "equals", value: "project" }])).toEqual(["Projects/Delta.md", "Projects/Gamma.md"]);
    expect(await q([{ key: "owner", op: "exists" }])).toEqual(["Projects/Gamma.md"]);
    expect(await q([{ key: "owner", op: "missing" }, { key: "priority", op: "exists" }])).toEqual(["Projects/Delta.md"]);
    expect(await q([{ key: "priority", op: "gt", value: 2 }])).toEqual(["Projects/Delta.md"]);
    expect(await q([{ key: "priority", op: "lte", value: "2" }])).toEqual(["Projects/Gamma.md"]);
    expect(await q([{ key: "due", op: "range", min: "2026-10-01", max: "2026-12-31" }])).toEqual(["Projects/Gamma.md"]);
    expect(await q([{ key: "due", op: "lt", value: "2026-10-21" }])).toEqual(["Projects/Delta.md"]);
    expect(await q([{ key: "rating", op: "range", min: 1, max: 4 }])).toEqual(["Welcome.md"]);
    expect(await q([{ key: "done", op: "equals", value: false }])).toEqual(["Welcome.md"]);
    expect(await q([{ key: "status", op: "equals", value: "done" }, { key: "owner", op: "exists" }], "any")).toEqual(["Projects/Delta.md", "Projects/Gamma.md"]);
    expect((await ops.queryProperties({})).total).toBe(4);
    await expect(ops.queryProperties({ filters: [{ key: "a", op: "weird" as any }] })).rejects.toMatchObject({ code: "bad_request" });
    expect(propMatches({ n: [1, 9] }, { key: "n", op: "gt", value: 5 })).toBe(true);
  });

  it("sets and removes properties without touching the body", async () => {
    await ops.setProperty({ path: "Beta", key: "status", value: "draft" });
    expect(read(vault, "Beta.md")).toBe("---\nstatus: draft\n---\n# Beta\n\nBack to [[Welcome]].\n\n## Goals\n- Ship the editor\n- Keep links working\n");
    await ops.setProperty({ path: "Beta", key: "tags", value: ["a", "b"] });
    expect((await ops.readNote({ path: "Beta" })).frontmatter).toEqual({ status: "draft", tags: ["a", "b"] });
    await ops.setProperty({ path: "Beta", key: "status", value: null });
    await ops.setProperty({ path: "Beta", key: "tags", value: null });
    expect(read(vault, "Beta.md")).toBe("# Beta\n\nBack to [[Welcome]].\n\n## Goals\n- Ship the editor\n- Keep links working\n");
    expect(setFrontmatterValue("---\na: 1\n---\nbody", "b", true)).toBe("---\na: 1\nb: true\n---\nbody");
    fs.writeFileSync(path.join(vault, "Bad.md"), "---\na: [unclosed\n---\nbody");
    await expect(ops.setProperty({ path: "Bad", key: "x", value: 1 })).rejects.toMatchObject({ code: "bad_request" });
    expect(read(vault, "Bad.md")).toBe("---\na: [unclosed\n---\nbody");
  });

  it("creates the daily note from the Daily notes settings (folder, format, template)", async () => {
    fs.writeFileSync(path.join(vault, ".obsidian", "daily-notes.json"), JSON.stringify({ folder: "Journal", format: "YYYY/MM/DD dddd", template: "Templates/Day" }));
    fs.mkdirSync(path.join(vault, "Templates"));
    fs.writeFileSync(path.join(vault, "Templates/Day.md"), "# {{title}}\nCreated {{date}} {{time}} ({{date:MMM D}})\n## Log\n");
    const r = await ops.getDailyNote({});
    expect(r).toMatchObject({ path: "Journal/2026/10/21 Wednesday.md", created: true, date: "2026-10-21" });
    expect(r.content).toBe("# 21 Wednesday\nCreated 2026-10-21 09:30 (Oct 21)\n## Log\n");
    const again = await ops.getDailyNote({ append: "- did a thing" });
    expect(again.created).toBe(false);
    expect(read(vault, "Journal/2026/10/21 Wednesday.md")).toBe("# 21 Wednesday\nCreated 2026-10-21 09:30 (Oct 21)\n## Log\n- did a thing\n");
    const y = await ops.getDailyNote({ date: "yesterday", create: false });
    expect(y).toMatchObject({ exists: false, path: "Journal/2026/10/20 Tuesday.md" });
    expect(exists(vault, "Journal/2026/10/20 Tuesday.md")).toBe(false);
    await expect(ops.getDailyNote({ date: "next blursday" })).rejects.toMatchObject({ code: "bad_request" });
  });

  it("creates the daily note with defaults when there are no settings", async () => {
    const r = await ops.getDailyNote({ date: "2026-01-02" });
    expect(r).toMatchObject({ path: "2026-01-02.md", created: true, content: "" });
  });

  it("searches with the app's query language", async () => {
    const s = await ops.search({ query: "links" });
    expect(s.results.map((r) => r.path)).toContain("Beta.md");
    expect((await ops.search({ query: "tag:#project" })).results.map((r) => r.path).sort()).toEqual(["Projects/Delta.md", "Projects/Gamma.md"]);
    expect((await ops.search({ query: "[status:active]" })).results.map((r) => r.path)).toEqual(["Projects/Gamma.md"]);
    expect((await ops.search({ query: "path:Projects -Delta beta" })).results.map((r) => r.path).sort()).toEqual(["Projects/Alpha.md", "Projects/Gamma.md"]);
    expect((await ops.search({ query: '"Keep links working"' })).results[0]).toMatchObject({ path: "Beta.md", matches: [{ line: 7, text: "- Keep links working" }] });
    expect((await ops.search({ query: "/Sh.p/" })).results.map((r) => r.path)).toEqual(["Beta.md"]);
    expect((await ops.search({ query: "beta", limit: 1 })).results.length).toBe(1);
    await expect(ops.search({ query: "   " })).rejects.toMatchObject({ code: "bad_request" });
  });

  it("sees changes made outside (the app, sync, an editor)", async () => {
    await ops.listTags();
    fs.writeFileSync(path.join(vault, "Outside.md"), "fresh #outside\n");
    await new Promise((r) => setTimeout(r, 450));
    expect((await ops.notesWithTag({ tag: "outside" })).notes).toEqual(["Outside.md"]);
  });

  it("needs the app for get_active_note and open_note", async () => {
    await expect(ops.getActiveNote()).rejects.toMatchObject({ code: "unavailable" });
    await expect(ops.openNote({ path: "Beta" })).rejects.toMatchObject({ code: "unavailable" });
    const opened: string[] = [];
    const withApp = new AgentOps({ vaultPath: vault, app: { activeNote: async () => "Beta.md", open: async (p) => void opened.push(p) } });
    expect((await withApp.getActiveNote()).path).toBe("Beta.md");
    await withApp.openNote({ path: "Gamma" });
    expect(opened).toEqual(["Projects/Gamma.md"]);
  });

  it("validates tool arguments", async () => {
    await expect(runTool(ops, "read_note", {})).rejects.toMatchObject({ code: "bad_request" });
    await expect(runTool(ops, "edit_note", { path: "Beta", mode: "explode" })).rejects.toThrow(/Invalid arguments for edit_note/);
    await expect(runTool(ops, "nope", {})).rejects.toMatchObject({ code: "not_found" });
    expect(TOOLS.map((t) => t.name)).toEqual([
      "search", "read_note", "create_note", "edit_note", "append_to_note", "move_note", "delete_note", "list_notes", "list_folder",
      "get_backlinks", "get_outgoing_links", "list_tags", "notes_with_tag", "query_properties", "set_property", "get_daily_note", "get_active_note", "open_note",
    ]);
  });

  it("serialises concurrent writes to one note", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => ops.appendToNote({ path: "Many", text: `line ${i}` })));
    const lines = read(vault, "Many.md").trim().split("\n");
    expect(lines.length).toBe(20);
    expect(new Set(lines).size).toBe(20);
  });
});

// ------------------------------------------------------------------ HTTP server

function rawRequest(port: number, o: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method: o.method ?? "GET", path: o.path, headers: o.headers }, (res) => {
      let s = "";
      res.on("data", (c) => (s += c));
      res.on("end", () => {
        let body: any = s;
        try {
          body = JSON.parse(s);
        } catch {
          /* text */
        }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on("error", reject);
    if (o.body) req.write(o.body);
    req.end();
  });
}

describe("local HTTP server (REST + MCP)", () => {
  let vault: string;
  let server: AgentHttpServer;
  let port: number;
  const token = "bdk_test_" + "x".repeat(40);
  let base: string;
  const auth = { authorization: `Bearer ${token}` };
  const api = async (method: string, p: string, body?: unknown) => {
    const r = await fetch(base + p, { method, headers: { ...auth, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };

  beforeAll(async () => {
    vault = makeVault();
    const ops = new AgentOps({ vaultPath: vault });
    server = new AgentHttpServer({ call: (name, args) => runTool(ops, name, args), getToken: () => token, version: "test" });
    port = await server.listen(0);
    base = `http://127.0.0.1:${port}`;
  });
  afterAll(() => server.close());

  it("binds to 127.0.0.1 only", () => {
    expect((server.server.address() as any).address).toBe("127.0.0.1");
  });

  it("requires the token", async () => {
    expect((await fetch(base + "/v1/status")).status).toBe(401);
    expect((await fetch(base + "/v1/status", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    expect((await fetch(base + "/mcp", { method: "POST", body: "{}" })).status).toBe(401);
    const ok = await api("GET", "/v1/status");
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, mcp: `${base}/mcp` });
  });

  it("rejects non-local Host headers (DNS rebinding) and foreign Origins, with no CORS", async () => {
    const evilHost = await rawRequest(port, { path: "/v1/status", headers: { host: "evil.example:" + port, ...auth } });
    expect(evilHost.status).toBe(403);
    expect(evilHost.body.error).toBe("forbidden_host");
    const wrongPort = await rawRequest(port, { path: "/v1/status", headers: { host: "127.0.0.1:1", ...auth } });
    expect(wrongPort.status).toBe(403);
    const okLocalhost = await rawRequest(port, { path: "/v1/status", headers: { host: "localhost:" + port, ...auth } });
    expect(okLocalhost.status).toBe(200);
    const evilOrigin = await fetch(base + "/v1/status", { headers: { ...auth, origin: "https://evil.example" } });
    expect(evilOrigin.status).toBe(403);
    expect(evilOrigin.headers.get("access-control-allow-origin")).toBeNull();
    const preflight = await fetch(base + "/v1/note", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    expect(preflight.status).toBe(403);
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("REST: every operation, JSON in and out", async () => {
    expect((await api("GET", "/v1/note?path=Welcome")).body.frontmatter.title).toBe("Welcome");
    expect((await api("POST", "/v1/note", { path: "API/New", content: "hello #api" })).body).toMatchObject({ path: "API/New.md", created: true });
    expect((await api("POST", "/v1/note", { path: "API/New", content: "x" })).status).toBe(409);
    expect((await api("PATCH", "/v1/note", { path: "API/New", mode: "find_replace", find: "hello", replace: "hi" })).status).toBe(200);
    expect((await api("POST", "/v1/note/append", { path: "API/New", text: "more" })).status).toBe(200);
    expect(read(vault, "API/New.md")).toBe("hi #api\nmore\n");
    expect((await api("GET", "/v1/search?query=hi%20tag:%23api&limit=5")).body.results[0].path).toBe("API/New.md");
    expect((await api("GET", "/v1/notes?folder=API")).body.total).toBe(1);
    expect((await api("GET", "/v1/folder?path=API")).body.files[0].path).toBe("API/New.md");
    expect((await api("GET", "/v1/tags")).body.tags.map((t: any) => t.tag)).toContain("#api");
    expect((await api("GET", "/v1/tags/notes?tag=api")).body.notes).toEqual(["API/New.md"]);
    expect((await api("PUT", "/v1/properties", { path: "API/New", key: "status", value: "open" })).body.properties).toEqual({ status: "open" });
    expect((await api("POST", "/v1/properties/query", { filters: [{ key: "status", op: "equals", value: "open" }] })).body.notes[0].path).toBe("API/New.md");
    const mv = await api("POST", "/v1/note/move", { from: "Beta", to: "Moved/Beta2" });
    expect(mv.body).toMatchObject({ to: "Moved/Beta2.md", updatedLinks: 4 });
    expect((await api("GET", "/v1/backlinks?path=Moved/Beta2")).body.total).toBe(2);
    expect((await api("GET", "/v1/links?path=Projects/Alpha")).body.links[0].target).toBe("Moved/Beta2.md");
    expect((await api("GET", "/v1/daily?date=2026-03-04")).body).toMatchObject({ exists: false });
    expect((await api("POST", "/v1/daily", { date: "2026-03-04", append: "x" })).body).toMatchObject({ path: "2026-03-04.md", created: true });
    expect((await api("DELETE", "/v1/note?path=API/New")).body.movedTo).toBe(".trash/New.md");
    expect((await api("GET", "/v1/active")).status).toBe(503);
    expect((await api("POST", "/v1/tools/list_tags", {})).status).toBe(200);
    expect((await api("GET", "/v1/tools")).body.tools.length).toBe(TOOLS.length);
  });

  it("REST: errors are JSON with a plain message", async () => {
    const t = await api("GET", "/v1/note?path=../../secret");
    expect(t.status).toBe(403);
    expect(t.body.error).toBe("forbidden");
    expect(t.body.message).toMatch(/outside the vault/);
    expect((await api("GET", "/v1/note?path=Nope")).status).toBe(404);
    expect((await api("GET", "/v1/nothing")).status).toBe(404);
    expect((await api("DELETE", "/v1/tags")).status).toBe(405);
    const bad = await fetch(base + "/v1/note", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: "{not json" });
    expect(bad.status).toBe(400);
    expect((await api("POST", "/v1/note", { content: "no path" })).status).toBe(400);
  });

  it("MCP over Streamable HTTP with the SDK client", async () => {
    const client = new Client({ name: "test", version: "1" });
    const transport = new StreamableHTTPClientTransport(new URL(base + "/mcp"), { requestInit: { headers: auth } });
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    const search = tools.tools.find((t) => t.name === "search")!;
    expect(search.inputSchema.properties).toHaveProperty("query");
    expect(search.annotations?.readOnlyHint).toBe(true);
    const r: any = await client.callTool({ name: "create_note", arguments: { path: "MCP/From MCP", content: "made by [[Welcome]]" } });
    expect(JSON.parse(r.content[0].text)).toMatchObject({ path: "MCP/From MCP.md", created: true });
    const bl: any = await client.callTool({ name: "get_backlinks", arguments: { path: "Welcome" } });
    expect(JSON.parse(bl.content[0].text).backlinks.map((b: any) => b.source)).toContain("MCP/From MCP.md");
    const err: any = await client.callTool({ name: "read_note", arguments: { path: "../../x" } });
    expect(err.isError).toBe(true);
    expect(err.content[0].text).toMatch(/outside the vault/);
    const res = await client.listResources();
    expect(res.resources.map((x) => x.uri)).toContain("bedrock://note/MCP/From%20MCP.md");
    const rr: any = await client.readResource({ uri: "bedrock://note/MCP/From%20MCP.md" });
    expect(rr.contents[0].text).toBe("made by [[Welcome]]");
    await client.close();
  });

  it("MCP endpoint refuses requests without the token or from a foreign host", async () => {
    const client = new Client({ name: "test", version: "1" });
    const transport = new StreamableHTTPClientTransport(new URL(base + "/mcp"));
    await expect(client.connect(transport)).rejects.toThrow();
    const r = await rawRequest(port, { method: "POST", path: "/mcp", headers: { host: "attacker.test", ...auth, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(r.status).toBe(403);
  });
});

// ------------------------------------------------------------------ settings + discovery files

describe("agent settings (app data, never the vault)", () => {
  it("creates a token on first run, keeps it, and is on by default", () => {
    const dir = path.join(tmpRoot, "ud-" + ++n);
    expect(loadSettings(dir)).toBeNull();
    const s = loadSettings(dir, true)!;
    expect(s.enabled).toBe(true);
    expect(s.token).toMatch(/^bdk_[A-Za-z0-9_-]{40,}$/);
    expect(loadSettings(dir)!.token).toBe(s.token);
    saveSettings(dir, { ...s, enabled: false });
    expect(loadSettings(dir)!.enabled).toBe(false);
  });
  it("ignores a running file left by a crashed app", () => {
    const dir = path.join(tmpRoot, "ud-" + ++n);
    writeRunning(dir, { pid: process.pid, port: 1234, vaultPath: "x", version: "t", startedAt: "" });
    expect(readRunning(dir)?.port).toBe(1234);
    writeRunning(dir, { pid: 2 ** 22 + 12345, port: 1234, vaultPath: "x", version: "t", startedAt: "" });
    expect(readRunning(dir)).toBeNull();
  });
});

// ------------------------------------------------------------------ Connect buttons

describe("connect AI apps (temp config files only)", () => {
  const cmd = { command: "C:\\Programs\\Bedrock\\bedrock.exe", args: ["C:\\Programs\\Bedrock\\resources\\app.asar\\dist\\cli.js", "mcp"], env: { ELECTRON_RUN_AS_NODE: "1" } };
  const entry = { command: cmd.command, args: cmd.args, env: cmd.env };
  let dir: string;
  beforeEach(() => {
    dir = path.join(tmpRoot, "clients-" + ++n);
    fs.mkdirSync(dir, { recursive: true });
    process.env.BEDROCK_CLAUDE_CODE_CONFIG = path.join(dir, "claude.json");
    process.env.BEDROCK_CLAUDE_DESKTOP_CONFIG = path.join(dir, "Claude", "claude_desktop_config.json");
    process.env.BEDROCK_CURSOR_CONFIG = path.join(dir, ".cursor", "mcp.json");
    process.env.BEDROCK_CLAUDE_CLI = "none";
  });
  afterAll(() => {
    for (const k of ["BEDROCK_CLAUDE_CODE_CONFIG", "BEDROCK_CLAUDE_DESKTOP_CONFIG", "BEDROCK_CURSOR_CONFIG", "BEDROCK_CLAUDE_CLI"]) delete process.env[k];
  });

  it("merges into Claude Desktop's config without clobbering other servers, backing it up first", async () => {
    const file = process.env.BEDROCK_CLAUDE_DESKTOP_CONFIG!;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const before = { mcpServers: { other: { command: "x", args: ["y"] } }, globalShortcut: "Ctrl+Space" };
    fs.writeFileSync(file, JSON.stringify(before));
    expect(clientStates(cmd).find((c) => c.id === "claude-desktop")).toMatchObject({ installed: true, connected: false });
    const msg = await connectClient("claude-desktop", cmd);
    expect(msg).toMatch(/Restart Claude Desktop/);
    const after = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(after.mcpServers.other).toEqual(before.mcpServers.other);
    expect(after.globalShortcut).toBe("Ctrl+Space");
    expect(after.mcpServers.bedrock).toEqual(entry);
    const backups = fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith("claude_desktop_config.json.bak-"));
    expect(backups.length).toBe(1);
    expect(JSON.parse(fs.readFileSync(path.join(path.dirname(file), backups[0]), "utf8"))).toEqual(before);
    expect(clientStates(cmd).find((c) => c.id === "claude-desktop")).toMatchObject({ connected: true, stale: false });
    expect(clientStates({ ...cmd, command: "D:\\old\\bedrock.exe" }).find((c) => c.id === "claude-desktop")).toMatchObject({ connected: true, stale: true });
    await disconnectClient("claude-desktop");
    const gone = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(gone.mcpServers).toEqual({ other: before.mcpServers.other });
  });

  it("writes Cursor's and Claude Code's files (no CLI) and creates them when missing", async () => {
    await connectClient("cursor", cmd);
    expect(JSON.parse(fs.readFileSync(process.env.BEDROCK_CURSOR_CONFIG!, "utf8"))).toEqual({ mcpServers: { bedrock: entry } });
    fs.writeFileSync(process.env.BEDROCK_CLAUDE_CODE_CONFIG!, JSON.stringify({ numStartups: 7, projects: { a: {} }, mcpServers: { keep: { type: "http", url: "x" } } }));
    await connectClient("claude-code", cmd);
    const cc = JSON.parse(fs.readFileSync(process.env.BEDROCK_CLAUDE_CODE_CONFIG!, "utf8"));
    expect(cc.numStartups).toBe(7);
    expect(cc.mcpServers.keep).toEqual({ type: "http", url: "x" });
    expect(cc.mcpServers.bedrock).toEqual({ type: "stdio", ...entry });
    expect(clientStates(cmd).filter((c) => c.connected).map((c) => c.id).sort()).toEqual(["claude-code", "cursor"]);
  });

  it("leaves a broken config file alone", async () => {
    fs.writeFileSync(process.env.BEDROCK_CURSOR_CONFIG = path.join(dir, "broken.json"), "{ nope");
    await expect(connectClient("cursor", cmd)).rejects.toThrow(/isn't valid JSON/);
    expect(fs.readFileSync(path.join(dir, "broken.json"), "utf8")).toBe("{ nope");
    expect(() => mergeServerEntry(path.join(dir, "broken.json"), { command: "x" })).toThrow();
  });

  it("offers snippets for other apps", () => {
    const s = snippets(cmd, { url: "http://127.0.0.1:27125", token: "tok" });
    const ids = s.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(["vscode", "windsurf", "generic-http", "claude-code-cli", "rest"]));
    expect(JSON.parse(s.find((x) => x.id === "vscode")!.text)).toEqual({ servers: { bedrock: { type: "stdio", ...entry } } });
    expect(JSON.parse(s.find((x) => x.id === "generic-http")!.text).mcpServers.bedrock).toEqual({ type: "http", url: "http://127.0.0.1:27125/mcp", headers: { Authorization: "Bearer tok" } });
  });
});

// ------------------------------------------------------------------ CLI

describe("bedrock CLI (on the folder)", () => {
  let vault: string;
  const run = async (...args: string[]) => {
    let out = "";
    let err = "";
    const code = await runCli([...args, "--vault", vault, "--offline"], { write: (s) => void (out += s) }, { write: (s) => void (err += s) });
    return { code, out, err };
  };
  beforeAll(() => {
    process.env.BEDROCK_USER_DATA = path.join(tmpRoot, "cli-ud");
  });
  afterAll(() => {
    delete process.env.BEDROCK_USER_DATA;
  });
  beforeEach(() => {
    vault = makeVault();
  });

  it("parses arguments and property filters", () => {
    expect(parseArgs(["new", "A", "--content", "x y", "--json"])).toMatchObject({ cmd: "new", pos: ["A"] });
    expect(parsePropFilter("status=active")).toEqual({ key: "status", op: "equals", value: "active" });
    expect(parsePropFilter("priority>=3")).toEqual({ key: "priority", op: "gte", value: 3 });
    expect(parsePropFilter("tags~work")).toEqual({ key: "tags", op: "contains", value: "work" });
    expect(parsePropFilter("due<2026-11-01")).toEqual({ key: "due", op: "lt", value: "2026-11-01" });
    expect(parsePropFilter("owner?")).toEqual({ key: "owner", op: "exists" });
    expect(parsePropFilter("!owner")).toEqual({ key: "owner", op: "missing" });
  });

  it("runs the commands", async () => {
    expect((await run("search", "links")).out).toContain("Beta.md");
    expect((await run("read", "Beta")).out).toContain("# Beta");
    expect((await run("new", "CLI/Note", "--content", "from the cli")).out).toBe("Created CLI/Note.md\n");
    expect((await run("append", "CLI/Note", "second", "line")).out).toBe("Appended to CLI/Note.md\n");
    expect(read(vault, "CLI/Note.md")).toBe("from the cli\nsecond line\n");
    expect((await run("mv", "Beta", "Old/Beta2")).out).toMatch(/Moved Beta.md -> Old\/Beta2.md \(updated 4 links in 2 notes\)/);
    expect((await run("tags")).out).toContain("#demo\t1");
    expect((await run("tags", "demo")).out).toBe("Welcome.md\n");
    expect((await run("backlinks", "Old/Beta2")).out).toContain("Projects/Alpha.md");
    expect((await run("props", "rating>3")).out).toMatch(/^Welcome\.md\t/);
    expect((await run("set", "Welcome", "rating", "5")).code).toBe(0);
    expect((await run("read", "Welcome", "--json")).out).toContain('"rating": 5');
    const d = await run("daily", "--append", "from cli");
    expect(d.out).toMatch(/^Created \d{4}-\d{2}-\d{2}\.md\n$/);
    const j = JSON.parse((await run("ls", "--json")).out);
    expect(j.notes.map((x: any) => x.path)).toContain("CLI/Note.md");
    expect(JSON.parse((await run("call", "list_tags", "{}")).out).total).toBeGreaterThan(0);
  });

  it("reports errors in plain words with an exit code", async () => {
    const r = await run("read", "../outside");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/outside the vault/);
    const nf = await run("read", "Nope");
    expect(nf.code).toBe(3);
    const j = await run("read", "Nope", "--json");
    expect(JSON.parse(j.out)).toMatchObject({ error: "not_found" });
    expect((await run("frobnicate")).code).toBe(2);
    expect((await run("get_active_note")).code).toBe(2);
    expect((await runCli(["help"], { write: () => {} }, { write: () => {} }))).toBe(0);
  });
});

// ------------------------------------------------------------------ docs

describe("docs/AGENT-API.md", () => {
  it("has the current OpenAPI description (run node app/scripts/agent-openapi.mjs)", async () => {
    const { buildOpenApi } = await import("../../src/main/agents/openapi");
    const doc = fs.readFileSync(path.resolve(__dirname, "../../../docs/AGENT-API.md"), "utf8");
    const m = /<!-- openapi:start -->\n```json\n([\s\S]*?)\n```\n<!-- openapi:end -->/.exec(doc.replace(/\r\n/g, "\n"));
    expect(m, "openapi block").toBeTruthy();
    const spec = buildOpenApi();
    expect(JSON.parse(m![1])).toEqual(JSON.parse(JSON.stringify(spec)));
    const routes = Object.keys(spec.paths);
    for (const p of ["/v1/search", "/v1/note", "/v1/note/move", "/v1/properties/query", "/v1/daily", "/v1/tools/{name}", "/mcp"]) expect(routes).toContain(p);
  });
});
