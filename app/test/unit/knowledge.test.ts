// Knowledge tools: off for everyone unless knowledge.json turns them on, and everything about the
// vault's layout comes from that file.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentOps } from "../../src/core/agent-ops";
import { KnowledgeOps, knowledgeProfileFrom, type KnowledgeProfile } from "../../src/core/knowledge-ops";
import { AgentHttpServer, activeRoutes } from "../../src/main/agents/http";
import { buildOpenApi } from "../../src/main/agents/openapi";
import { loadKnowledgeProfile } from "../../src/main/agents/settings";
import { TOOLS, enableKnowledgeTools, mcpTools, runTool } from "../../src/main/agents/tools";

const KNOWLEDGE_NAMES = ["get_context", "remember", "update", "log_result", "decide", "list_vaults", "create_vault"];

function write(root: string, rel: string, text: string): void {
  const abs = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}
const read = (root: string, rel: string) => fs.readFileSync(path.join(root, ...rel.split("/")), "utf8");

// A layout on purpose unlike the defaults: nothing may be hard-coded.
const profile: KnowledgeProfile = knowledgeProfileFrom({
  projects: "Work",
  preferences: "Rules",
  strategies: "Growth/Plays",
  experiments: "Growth/Tests",
  accounts: "Logins",
  services: "Logins/Services",
  inbox: "Later",
  chats: "AI/Chats",
  likes: "Taste/Likes.md",
  dislikes: "Taste/Dislikes.md",
  results: "Taste/Results.md",
  resultsHeading: "Seen so far",
  keysNote: "Logins/Keys.md",
  skipInContext: ["AI"],
  synonyms: { email: ["smtp"] },
  ownerName: "Sam",
  contextHint: "Ask Sam.",
  mcpTools: ["get_context", "search"],
})!;

function seed(root: string): void {
  write(root, "Work/_vault.md", "---\ndescription: all work\n---\n");
  write(root, "Work/Alpha/_vault.md", "---\ndescription: the alpha project\n---\n");
  write(root, "Work/Alpha/Alpha.md", "---\nstatus: active\n---\nAlpha is the launch project.\n");
  write(root, "Work/Alpha/Launch plan.md", "Launch in spring.\n");
  write(root, "Rules/Short emails.md", "---\ntype: preference\n---\nKeep every email short.\n");
  write(root, "Rules/Dark rooms.md", "---\ntype: preference\n---\nNothing about this topic.\n");
  write(root, "Growth/Plays/Video ads.md", "---\nstatus: testing\n---\nVideo ads.\n");
  write(root, "Later/2026-01-01 Idea.md", "---\ntype: inbox\n---\nTry a newsletter.\n");
  write(root, "Later/2026-01-02 Done.md", "---\ndecision: no\n---\nAlready decided.\n");
  write(root, "Logins/Mailer.md", "---\ntype: account\n---\nThe smtp login for the mailer.\n");
  write(root, "Logins/Keys.md", "- MAILER_KEY: smtp sending key\n");
  write(root, "Taste/Likes.md", "# Likes\n\n## Remembered\n\n- short email subject lines\n");
  write(root, "Taste/Dislikes.md", "# Dislikes\n\n## Remembered\n\n- long email footers\n");
  write(root, "Taste/Results.md", "# Results\n\n## Seen so far\n\n- email list grew 10%\n");
  write(root, "AI/Chats/one.md", "We talked about email.\n\n## How it ended\n\nShipped it.\n");
}

let vault: string;
let ops: KnowledgeOps;

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-knowledge-"));
  seed(vault);
  ops = new KnowledgeOps({ vaultPath: vault, now: () => new Date("2026-03-04T12:00:00Z") }, profile);
});
afterEach(() => fs.rmSync(vault, { recursive: true, force: true }));

describe("off by default", () => {
  it("has no settings without a knowledge.json, or with enabled false or broken JSON", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bedrock-knowledge-data-"));
    try {
      expect(loadKnowledgeProfile(dir)).toBeNull();
      write(dir, "agents/knowledge.json", '{"enabled": false}');
      expect(loadKnowledgeProfile(dir)).toBeNull();
      write(dir, "agents/knowledge.json", "{not json");
      expect(loadKnowledgeProfile(dir)).toBeNull();
      write(dir, "agents/knowledge.json", '{"projects": "Work"}');
      expect(loadKnowledgeProfile(dir)?.projects).toBe("Work");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to the defaults for a folder that leaves the vault", () => {
    expect(knowledgeProfileFrom({ projects: "../outside" })?.projects).toBe("Projects");
  });
});

// Keep these first and in this order: enableKnowledgeTools() lasts for the process.
describe("tool list", () => {
  it("offers none of them, no route and no vault argument until enabled", async () => {
    const names = TOOLS.map((t) => t.name);
    for (const n of KNOWLEDGE_NAMES) expect(names).not.toContain(n);
    expect(activeRoutes().some((r) => r.path === "/v1/context")).toBe(false);
    expect(buildOpenApi().paths["/v1/context"]).toBeUndefined();
    expect(Object.keys(TOOLS.find((t) => t.name === "search")!.shape)).not.toContain("vault");
    expect(mcpTools()).toBe(TOOLS);
    await expect(runTool(new AgentOps({ vaultPath: vault }), "get_context", { topic: "x" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("names nobody in what an agent reads", () => {
    enableKnowledgeTools();
    const text = JSON.stringify(TOOLS.map((t) => [t.name, t.description]));
    expect(text).not.toMatch(/Orion|Westward|FitCut|Toolbay|Playbook/);
  });

  it("adds them once enabled, and can narrow what MCP offers", () => {
    enableKnowledgeTools({ mcpTools: profile.mcpTools });
    enableKnowledgeTools({ mcpTools: profile.mcpTools });
    const names = TOOLS.map((t) => t.name);
    for (const n of KNOWLEDGE_NAMES) expect(names.filter((x) => x === n)).toEqual([n]);
    expect(names).toContain("delete_note");
    expect(mcpTools().map((t) => t.name).sort()).toEqual(["get_context", "search"]);
    expect(activeRoutes().some((r) => r.path === "/v1/context")).toBe(true);
    expect(buildOpenApi().paths["/v1/context"].get).toBeTruthy();
    expect(Object.keys(TOOLS.find((t) => t.name === "search")!.shape)).toContain("vault");
    enableKnowledgeTools();
    expect(mcpTools()).toBe(TOOLS);
  });

  it("runs through runTool with validation", async () => {
    enableKnowledgeTools();
    await expect(runTool(ops, "get_context", {})).rejects.toMatchObject({ code: "bad_request" });
    expect(((await runTool(ops, "list_vaults", {})) as any).vaults.length).toBe(2);
  });
});

describe("REST", () => {
  it("serves the brief context with a token, and needs the token", async () => {
    enableKnowledgeTools();
    const token = "t".repeat(40);
    const server = new AgentHttpServer({ call: (name, args) => runTool(ops, name, args), getToken: () => token, version: "test" });
    const port = await server.listen(0);
    try {
      const url = `http://127.0.0.1:${port}/v1/context?topic=email`;
      expect((await fetch(url)).status).toBe(401);
      const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      expect(r.status).toBe(200);
      const body: any = await r.json();
      expect(body.preferences).toEqual(["Short emails.md: Keep every email short."]);
    } finally {
      await server.close();
    }
  });
});

describe("portals", () => {
  it("lists vaults with parents and note counts", async () => {
    const { vaults } = await ops.listVaults();
    expect(vaults.map((v) => [v.vault, v.parent, v.subVaults, v.notes])).toEqual([
      ["Work", null, 1, 2],
      ["Work/Alpha", "Work", 0, 2],
    ]);
    expect(vaults[1].description).toBe("the alpha project");
  });

  it("creates a vault once, inside a parent found by name", async () => {
    expect(await ops.createVault({ name: "Beta", parent: "work", icon: "rocket", color: "#111111" })).toEqual({ vault: "Work/Beta", created: true });
    expect(read(vault, "Work/Beta/_vault.md")).toContain('icon: "rocket"');
    expect(await ops.createVault({ name: "Beta", parent: "work" })).toEqual({ vault: "Work/Beta", created: false });
    await expect(ops.createVault({ name: "X", parent: "nope" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("searches and lists inside a vault by name", async () => {
    const hits = await ops.search({ query: "launch", vault: "Alpha" });
    expect(hits.results.map((r) => [r.path, r.vault]).sort()).toEqual([["Work/Alpha/Alpha.md", "Work/Alpha"], ["Work/Alpha/Launch plan.md", "Work/Alpha"]]);
    const all = await ops.search({ query: "launch" });
    expect(all.total).toBe(2);
    expect((await ops.listNotes({ vault: "Work/Alpha" })).notes.length).toBe(3);
  });
});

describe("get_context", () => {
  it("gathers everything from the configured layout", async () => {
    const c = await ops.getContext({ topic: "email for Alpha" });
    expect(c.project?.vault).toBe("Work/Alpha");
    expect(c.project?.note).toContain("launch project");
    expect(c.project?.otherNotes).toEqual(["Work/Alpha/Launch plan.md"]);
    expect(c.preferences).toContain("Short emails.md: Keep every email short.");
    expect(c.preferences).toContain("Dark rooms.md: Nothing about this topic.");
    expect(c.likes).toEqual(["- short email subject lines"]);
    expect(c.dislikes).toEqual(["- long email footers"]);
    expect(c.results).toEqual(["- email list grew 10%"]);
    expect(c.chats).toEqual([{ path: "AI/Chats/one.md", ended: "Shipped it." }]);
    expect(c.notes.some((n) => n.path.startsWith("AI/"))).toBe(false);
    expect(c.next).toBe("Ask Sam.");
  });

  it("widens with configured synonyms, and hides the keys note from accounts", async () => {
    const c = await ops.getContext({ topic: "email" });
    expect(c.accounts).toEqual(["Logins/Mailer.md"]);
    expect(c.apiKeys).toEqual(["- MAILER_KEY: smtp sending key"]);
    const plain = new KnowledgeOps({ vaultPath: vault }, { ...profile, synonyms: {} });
    expect((await plain.getContext({ topic: "email" })).accounts).toEqual([]);
  });

  it("brief keeps only the preferences that touch the topic and scopes to a vault", async () => {
    const c = await ops.getContext({ topic: "email", brief: true });
    expect(c.preferences).toEqual(["Short emails.md: Keep every email short."]);
    const scoped = await ops.getContext({ topic: "launch", vault: "Alpha" });
    expect(scoped.notes.every((n) => n.path.startsWith("Work/Alpha/"))).toBe(true);
  });

  it("wants a topic", async () => {
    await expect(ops.getContext({ topic: " " })).rejects.toMatchObject({ code: "bad_request" });
  });
});

describe("remember", () => {
  it("files each kind in its configured place", async () => {
    expect(await ops.remember({ text: "Always send short subject lines" })).toEqual({ kind: "preference", path: "Rules/Always send short subject lines.md" });
    expect(read(vault, "Rules/Always send short subject lines.md")).toContain('source: "Sam, 2026-03-04"');
    expect(await ops.remember({ text: "That layout is perfect", kind: "like" })).toEqual({ kind: "like", path: "Taste/Likes.md" });
    expect(read(vault, "Taste/Likes.md")).toContain("**That layout is perfect**");
    expect((await ops.remember({ text: "Ads brought 5 leads", kind: "result" })).path).toBe("Taste/Results.md");
    expect(read(vault, "Taste/Results.md")).toMatch(/## Seen so far[\s\S]*Ads brought 5 leads/);
    expect((await ops.remember({ text: "Moved the launch", project: "alpha", kind: "project" })).path).toBe("Work/Alpha/Alpha.md");
    expect(read(vault, "Work/Alpha/Alpha.md")).toMatch(/## Log\s+- 2026-03-04 Moved the launch/);
    expect(await ops.remember({ text: "Try a podcast", kind: "inbox" })).toEqual({ kind: "inbox", path: "Later/2026-03-04 Try a podcast.md" });
    expect((await ops.remember({ text: "New mailer login", kind: "account" })).path).toBe("Logins/New mailer login.md");
  });

  it("refuses what looks like a secret and writes nothing", async () => {
    await expect(ops.remember({ text: "the key is sk-abcdef123456", kind: "inbox" })).rejects.toThrow(/secret/);
    await expect(ops.remember({ text: "password: hunter2", kind: "inbox" })).rejects.toThrow(/secret/);
    expect(fs.readdirSync(path.join(vault, "Later")).length).toBe(2);
  });
});

describe("decide", () => {
  it("lists undecided inbox items, then records an answer", async () => {
    const before = await ops.decide({});
    expect(before.waiting!.map((w) => w.path)).toEqual(["Later/2026-01-01 Idea.md"]);
    expect(before.waiting![0].summary).toBe("Try a newsletter.");
    expect(await ops.decide({ path: "Later/2026-01-01 Idea.md", answer: "yes", note: "go" })).toEqual({ path: "Later/2026-01-01 Idea.md", decision: "yes" });
    expect(read(vault, "Later/2026-01-01 Idea.md")).toMatch(/decision: yes[\s\S]*decided: .*2026-03-04[\s\S]*Decision note: go/);
    expect((await ops.decide({})).waiting).toEqual([]);
    await expect(ops.decide({ path: "Later/2026-01-02 Done.md", answer: "maybe" })).rejects.toMatchObject({ code: "bad_request" });
  });
});

describe("update and log_result", () => {
  it("checks typed fields and finds a project by bare name", async () => {
    expect(await ops.update({ path: "alpha", fields: { status: "paused", last_activity: "2026-03-01T10:00" }, log: "Paused it" })).toEqual({ path: "Work/Alpha/Alpha.md", type: "project", changed: ["status", "last_activity"] });
    const t = read(vault, "Work/Alpha/Alpha.md");
    expect(t).toContain("status: paused");
    expect(t).toMatch(/## Log\s+- 2026-03-04 Paused it/);
    await expect(ops.update({ path: "alpha", fields: { status: "nonsense" } })).rejects.toMatchObject({ code: "bad_request" });
    await expect(ops.update({ path: "alpha", fields: { revenue: "lots" } })).rejects.toMatchObject({ code: "bad_request" });
  });

  it("ranks the other strategies when one note's properties are broken, and names it", async () => {
    write(vault, "Growth/Plays/Broken.md", "---\nsummary: a: b: c\n---\nBroken.\n");
    write(vault, "Growth/Tests/Old.md", '---\ntype: experiment\nstrategy: "[[Broken]]"\nrevenue: 5\n---\n');
    const before = read(vault, "Growth/Plays/Broken.md");
    const r = await ops.logResult({ experiment: "Spring ads", strategy: "Video ads", revenue: 10, verdict: "worked" });
    expect(r.notRanked).toEqual(["Growth/Plays/Broken.md"]);
    expect(r.strategiesTop.map((s) => s.strategy)).toEqual(["Video ads"]);
    expect(read(vault, "Growth/Plays/Broken.md")).toBe(before);
  });

  it("leaves every other strategy's status alone, and doesn't touch notes with no experiments", async () => {
    write(vault, "Growth/Plays/Untested.md", "---\nstatus: untested\n---\nNo tests yet.\n");
    write(vault, "Growth/Plays/Collected.md", "---\nstatus: collected\n---\nHas an old test.\n");
    write(vault, "Growth/Tests/Old.md", '---\ntype: experiment\nstrategy: "[[Collected]]"\nrevenue: 0\nspent: 25\nverdict: failed\n---\n');
    const untested = read(vault, "Growth/Plays/Untested.md");
    const r = await ops.logResult({ experiment: "Spring ads", strategy: "Video ads", revenue: 500, verdict: "worked" });
    expect(read(vault, "Growth/Plays/Untested.md")).toBe(untested);
    expect(r.strategiesTop.find((s) => s.strategy === "Untested")).toEqual({ strategy: "Untested", net: 0, status: "untested" });
    const collected = read(vault, "Growth/Plays/Collected.md");
    expect(collected).toContain("status: collected");
    expect(collected).toContain("net: -25");
    expect(read(vault, "Growth/Plays/Video ads.md")).toContain("status: working");
  });

  it("keeps a strategy's status while its experiment is still running, then moves it on a verdict", async () => {
    write(vault, "Growth/Plays/Pending.md", "---\nstatus: specced\n---\nPlanned.\n");
    await ops.logResult({ experiment: "Slow test", strategy: "Pending", spent: 10, verdict: "running" });
    expect(read(vault, "Growth/Plays/Pending.md")).toContain("status: specced");
    await ops.logResult({ experiment: "Slow test", verdict: "failed" });
    expect(read(vault, "Growth/Plays/Pending.md")).toContain("status: losing");
  });

  it("makes the experiment, then ranks strategies by net money", async () => {
    const r = await ops.logResult({ experiment: "Spring ads", strategy: "Video ads", venture: "Alpha", revenue: 500, spent: 100, hours: 4, verdict: "worked", note: "Worth it" });
    expect(r.experiment).toBe("Growth/Tests/2026-03-04 Spring ads.md");
    expect(r.strategiesTop).toEqual([{ strategy: "Video ads", net: 400, status: "working" }]);
    const play = read(vault, "Growth/Plays/Video ads.md");
    expect(play).toContain("net: 400");
    expect(play).toContain("per_hour: 100");
    const exp = read(vault, r.experiment);
    expect(exp).toContain('strategy: "[[Video ads]]"');
    expect(exp).toMatch(/ended: .*2026-03-04/);
    const again = await ops.logResult({ experiment: "spring ads", spent: 1000 });
    expect(again.experiment).toBe(r.experiment);
    expect(again.strategiesTop[0].net).toBe(-500);
  });
});
