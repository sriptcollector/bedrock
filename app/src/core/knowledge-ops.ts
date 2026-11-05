// Knowledge tools: an optional layer on the agent tools for people who run their vault as a second
// brain for an AI agent ("what do my notes know about X", "remember this", typed project and
// experiment fields). Off unless <app data>/agents/knowledge.json exists (see main/agents/settings.ts),
// so nobody gets these tools by default. Everything about how a vault is laid out (folder names, the
// taste notes, topic synonyms) comes from that file; this code knows nothing about any one person.
//
// A "portal" here is a folder holding a _vault.md note: a vault you step into inside the vault.
// Node only, same as agent-ops.ts.
import { AgentError, AgentOps, cleanFolderPath, isMd, type AgentOpsOptions } from "./agent-ops";
import { basename, dirname } from "./path";

export interface KnowledgeProfile {
  /** Folder whose sub-portals are projects (main note: <projects>/<name>/<name>.md). */
  projects: string;
  preferences: string;
  strategies: string;
  experiments: string;
  /** Account notes. Notes in `services` are about services, not accounts, so they get no account fields. */
  accounts: string;
  services: string;
  inbox: string;
  /** Past agent chats, one note each, with a "## How it ended" section. */
  chats: string;
  likes: string;
  dislikes: string;
  results: string;
  /** Headings new lines go under in the taste notes and the results note. */
  tasteHeading: string;
  resultsHeading: string;
  /** A note listing API key names (never values), or null. */
  keysNote: string | null;
  /** Folders get_context doesn't score notes from (chats are reported separately). */
  skipInContext: string[];
  /** Topic words that should also match other words, e.g. {"email": ["smtp"]}. */
  synonyms: Record<string, string[]>;
  /** Written as the source of remembered preferences. */
  ownerName: string;
  /** The last line of a get_context answer. */
  contextHint: string;
  /** Only offer these tools over MCP (the command line and REST keep every tool). Null: all of them. */
  mcpTools: string[] | null;
}

export const DEFAULT_KNOWLEDGE_PROFILE: KnowledgeProfile = {
  projects: "Projects",
  preferences: "Preferences",
  strategies: "Strategies",
  experiments: "Experiments",
  accounts: "Accounts",
  services: "Accounts/Services",
  inbox: "Inbox",
  chats: "Chats",
  likes: "Likes.md",
  dislikes: "Dislikes.md",
  results: "Results.md",
  tasteHeading: "Remembered",
  resultsHeading: "Remembered",
  keysNote: null,
  skipInContext: ["Chats"],
  synonyms: {},
  ownerName: "Agent",
  contextHint: "read_note any path above for the full text.",
  mcpTools: null,
};

/** Turn the settings file's JSON into a profile. Null when it's off; bad values fall back to the defaults. */
export function knowledgeProfileFrom(raw: unknown): KnowledgeProfile | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.enabled === false) return null;
  const d = DEFAULT_KNOWLEDGE_PROFILE;
  const str = (v: unknown, dflt: string) => (typeof v === "string" && v.trim() ? v.trim() : dflt);
  const folder = (v: unknown, dflt: string) => {
    try {
      return cleanFolderPath(v) || dflt;
    } catch {
      return dflt;
    }
  };
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : null);
  const synonyms: Record<string, string[]> = {};
  if (r.synonyms && typeof r.synonyms === "object") {
    for (const [k, v] of Object.entries(r.synonyms)) {
      const list = strings(v);
      if (list) synonyms[k.toLowerCase()] = list.map((w) => w.toLowerCase());
    }
  }
  return {
    projects: folder(r.projects, d.projects),
    preferences: folder(r.preferences, d.preferences),
    strategies: folder(r.strategies, d.strategies),
    experiments: folder(r.experiments, d.experiments),
    accounts: folder(r.accounts, d.accounts),
    services: folder(r.services, d.services),
    inbox: folder(r.inbox, d.inbox),
    chats: folder(r.chats, d.chats),
    likes: str(r.likes, d.likes),
    dislikes: str(r.dislikes, d.dislikes),
    results: str(r.results, d.results),
    tasteHeading: str(r.tasteHeading, d.tasteHeading),
    resultsHeading: str(r.resultsHeading, d.resultsHeading),
    keysNote: typeof r.keysNote === "string" && r.keysNote.trim() ? r.keysNote.trim() : null,
    skipInContext: (strings(r.skipInContext) ?? d.skipInContext).map((f) => f.replace(/^\/+|\/+$/g, "")),
    synonyms,
    ownerName: str(r.ownerName, d.ownerName),
    contextHint: str(r.contextHint, d.contextHint),
    mcpTools: strings(r.mcpTools),
  };
}

/** Words too common to match on in get_context. */
const STOP = new Set(["app", "apps", "set", "setup", "sending", "send", "thing", "things", "it's", "can", "should", "would", "will", "just", "like", "all", "now", "then", "there", "here", "them", "they", "one", "out", "up", "the", "and", "for", "with", "that", "this", "what", "how", "my", "our", "you", "your", "from", "into", "about", "make", "build", "want", "need", "use", "using", "new", "add", "get"]);

const FIELD_SCHEMAS: Record<string, Record<string, "string" | "number" | "date" | "link" | "links" | string[]>> = {
  project: { status: ["idea", "active", "paused", "done", "dropped"], last_activity: "date", site: "string", repo: "string", folder: "string", summary: "string", revenue: "number", value_per_lead: "number" },
  strategy: { status: ["testing", "working", "losing", "dropped"], channel: "string", summary: "string", ventures: "links", net: "number", revenue: "number", spent: "number", hours: "number", per_hour: "number", experiments: "number" },
  experiment: { strategy: "link", venture: "link", verdict: ["running", "worked", "failed", "inconclusive"], revenue: "number", spent: "number", hours: "number", leads: "number", result: "string", started: "date", ended: "date" },
  account: { platform: "string", handle: "string", venture: "link", purpose: "string", status: "string", login: "string", auth: ["google", "email-code", "password", "github", "sso"], password_location: "string", twofa: "string" },
  preference: { area: "string", source: "string", confidence: ["low", "medium", "high"] },
  inbox: { decision: ["yes", "no", "later"], decided: "date", score: "number", url: "string" },
};

const SECRET_RE = /(sk-|sk_live|re_[A-Za-z0-9]{6,}_|ghp_|AKIA|password\s*[:=])/i;
const UNSAFE_NAME_RE = /[\\/:*?"<>|#^[\]]/g;
const asLink = (v: unknown) => (/^\[\[/.test(String(v)) ? String(v) : `[[${v}]]`);

export class KnowledgeOps extends AgentOps {
  readonly profile: KnowledgeProfile;

  constructor(o: AgentOpsOptions, profile: KnowledgeProfile) {
    super(o);
    this.profile = profile;
  }

  private day(): string {
    return this.now().toISOString().slice(0, 10);
  }

  // ---------- portals

  private vaultPaths(): string[] {
    const out: string[] = [];
    for (const k of this.entries.keys()) if (k.endsWith("/_vault.md")) out.push(dirname(k));
    return out.sort((x, y) => x.localeCompare(y));
  }

  /** The innermost portal holding a path ("" = none). */
  private vaultOf(p: string, all = this.vaultPaths()): string {
    let best = "";
    for (const v of all) if (p.startsWith(v + "/") && v.length > best.length) best = v;
    return best;
  }

  /** A portal by folder path ("Projects/Alpha") or name ("Alpha"), case-insensitive. */
  private async resolveVault(input: unknown): Promise<string> {
    const q = String(input ?? "").trim().replace(/^\/+|\/+$/g, "");
    if (!q || /^home$/i.test(q)) return "";
    await this.refresh();
    const all = this.vaultPaths();
    const lq = q.toLowerCase();
    const hit = all.find((v) => v.toLowerCase() === lq) ?? all.find((v) => basename(v).toLowerCase() === lq) ?? all.find((v) => v.toLowerCase().endsWith("/" + lq));
    if (!hit) throw new AgentError("not_found", `There's no vault called “${q}”. Use list_vaults to see them all.`);
    return hit;
  }

  async listVaults() {
    await this.refresh();
    const all = this.vaultPaths();
    const vaults: { vault: string; name: string; description: string; parent: string | null; subVaults: number; notes: number }[] = [];
    for (const v of all) {
      const { meta } = await this.metaOf(v + "/_vault.md");
      const fm = (meta.frontmatter ?? {}) as Record<string, unknown>;
      let notes = 0;
      for (const k of this.entries.keys()) if (isMd(k) && k.startsWith(v + "/") && !k.endsWith("/_vault.md")) notes++;
      vaults.push({ vault: v, name: String(fm.title ?? basename(v)), description: String(fm.description ?? ""), parent: this.vaultOf(v, all) || null, subVaults: all.filter((x) => this.vaultOf(x, all) === v).length, notes });
    }
    return {
      howTo: "Each vault is a folder. Pass a vault's name or path as `vault` to search and list_notes to work inside it. Search with no vault looks everywhere.",
      vaults,
    };
  }

  /** Make a folder a portal (created if missing) with its _vault.md: icon, color, description. */
  async createVault(a: { name: string; parent?: string; icon?: string; color?: string; description?: string; order?: number }) {
    const name = String(a.name ?? "").replace(UNSAFE_NAME_RE, " ").trim();
    if (!name) throw new AgentError("bad_request", "Give the vault a name.");
    const parent = a.parent ? await this.resolveVault(a.parent) : "";
    const folder = parent ? `${parent}/${name}` : name;
    const marker = `${folder}/_vault.md`;
    if (this.fileExists(marker)) return { vault: folder, created: false };
    const q = (s: string) => JSON.stringify(s);
    const lines = ["---", `icon: ${q(a.icon || "folder-open")}`];
    if (a.color) lines.push(`color: ${q(a.color)}`);
    lines.push(`description: ${q(a.description ?? "")}`);
    if (typeof a.order === "number") lines.push(`order: ${a.order}`);
    lines.push("---", "", `This note makes **${name}** a vault. Edit the properties above to change its icon, color and description.`, "");
    await this.createNote({ path: marker, content: lines.join("\n") });
    return { vault: folder, created: true };
  }

  override async search(a: { query: string; limit?: number; matchCase?: boolean; folder?: string; vault?: string }) {
    const folder = a.vault ? await this.resolveVault(a.vault) : a.folder;
    const r = await super.search({ ...a, folder });
    const all = this.vaultPaths();
    return { ...r, results: r.results.map(({ path, ...rest }) => ({ path, vault: this.vaultOf(path, all) || null, ...rest })) };
  }

  override async listNotes(a: { folder?: string; vault?: string; recursive?: boolean; limit?: number; allFiles?: boolean } = {}) {
    return super.listNotes({ ...a, folder: a.vault ? await this.resolveVault(a.vault) : a.folder });
  }

  // ---------- typed fields

  private typeOf(path: string, fm: Record<string, unknown>): string | null {
    const p = this.profile;
    if (typeof fm.type === "string" && FIELD_SCHEMAS[fm.type]) return fm.type;
    const inProjects = path.startsWith(p.projects + "/") ? path.slice(p.projects.length + 1).split("/") : [];
    if (inProjects.length === 2 && inProjects[1] === inProjects[0] + ".md") return "project";
    if (path.startsWith(p.strategies + "/")) return "strategy";
    if (path.startsWith(p.experiments + "/")) return "experiment";
    if (path.startsWith(p.preferences + "/")) return "preference";
    if (path.startsWith(p.inbox + "/")) return "inbox";
    if (path.startsWith(p.accounts + "/") && !path.startsWith(p.services + "/")) return "account";
    return null;
  }

  private checkField(type: string, key: string, value: unknown): unknown {
    const rule = FIELD_SCHEMAS[type]?.[key];
    if (!rule) return value; // free-form fields are allowed
    if (Array.isArray(rule)) {
      if (!rule.includes(String(value))) throw new AgentError("bad_request", `“${key}” for a ${type} must be one of: ${rule.join(", ")}.`);
      return String(value);
    }
    if (rule === "number") {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new AgentError("bad_request", `“${key}” must be a number.`);
      return n;
    }
    if (rule === "date") {
      const s = String(value).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new AgentError("bad_request", `“${key}” must be a date like 2026-11-02.`);
      return s;
    }
    if (rule === "link") return asLink(value);
    if (rule === "links") return (Array.isArray(value) ? value : [value]).map(asLink);
    return String(value);
  }

  /** Add a line under a heading, making the heading when the note doesn't have it yet. */
  private async addLogLine(path: string, heading: string, line: string): Promise<void> {
    await this.appendToNote({ path, text: line, heading }).catch(() => this.appendToNote({ path, text: `\n## ${heading}\n\n${line}` }));
  }

  /** Change typed fields on a note (project, strategy, experiment, account, preference, inbox). */
  async update(a: { path: string; fields: Record<string, unknown>; log?: string }) {
    await this.refresh();
    // A bare project name means that project's main note.
    const bare = String(a.path).replace(/\.md$/i, "").toLowerCase();
    const projectMain = this.vaultPaths().find((v) => v.startsWith(this.profile.projects + "/") && basename(v).toLowerCase() === bare);
    const p = projectMain ? `${projectMain}/${basename(projectMain)}.md` : await this.resolveNote(a.path);
    const { meta } = await this.metaOf(p);
    const type = this.typeOf(p, (meta.frontmatter ?? {}) as Record<string, unknown>);
    const changed: string[] = [];
    for (const [k, v] of Object.entries(a.fields ?? {})) {
      const val = type ? this.checkField(type, k, v) : v;
      await this.setProperty({ path: p, key: k, value: val });
      changed.push(k);
    }
    if (a.log) await this.addLogLine(p, "Log", `- ${this.day()} ${a.log}`);
    if (type === "experiment" && changed.some((k) => ["revenue", "spent", "hours", "verdict"].includes(k))) await this.rerankStrategies();
    return { path: p, type, changed };
  }

  /**
   * Money ranks the strategies: recompute each strategy from its experiments. A note whose properties
   * can't be changed (broken YAML) is left alone and named in `skipped`, so one bad note can't stop the rest.
   */
  async rerankStrategies() {
    await this.refresh(true);
    const { experiments, strategies } = this.profile;
    const exps: { strategy: string; revenue: number; spent: number; hours: number; done: boolean }[] = [];
    for (const k of this.entries.keys()) {
      if (!k.startsWith(experiments + "/") || !isMd(k)) continue;
      const fm = ((await this.metaOf(k)).meta.frontmatter ?? {}) as Record<string, any>;
      const strategy = String(fm.strategy ?? "").replace(/^\[\[|\]\]$/g, "").split("|")[0];
      if (!strategy) continue;
      exps.push({ strategy, revenue: Number(fm.revenue) || 0, spent: Number(fm.spent) || 0, hours: Number(fm.hours) || 0, done: !!fm.verdict && fm.verdict !== "running" });
    }
    const ranking: { strategy: string; net: number; status: string }[] = [];
    const skipped: string[] = [];
    for (const k of [...this.entries.keys()]) {
      if (!k.startsWith(strategies + "/") || !isMd(k) || k.endsWith("/_vault.md")) continue;
      const name = basename(k).replace(/\.md$/i, "");
      const mine = exps.filter((e) => e.strategy.toLowerCase() === name.toLowerCase());
      const revenue = mine.reduce((s, e) => s + e.revenue, 0);
      const spent = mine.reduce((s, e) => s + e.spent, 0);
      const hours = mine.reduce((s, e) => s + e.hours, 0);
      const net = revenue - spent;
      const finished = mine.filter((e) => e.done).length;
      const status = net > 0 ? "working" : finished === 0 ? "testing" : finished === 1 ? "losing" : "dropped";
      try {
        for (const [key, value] of Object.entries({ revenue, spent, hours, net, per_hour: hours ? Math.round((net / hours) * 100) / 100 : 0, experiments: mine.length, status })) await this.setProperty({ path: k, key, value });
        ranking.push({ strategy: name, net, status });
      } catch (e) {
        if (!(e instanceof AgentError)) throw e;
        skipped.push(k);
      }
    }
    return { ranking: ranking.sort((x, y) => y.net - x.net), skipped };
  }

  /** Record money and time from a marketing or growth test and re-rank the strategies. */
  async logResult(a: { experiment: string; strategy?: string; venture?: string; revenue?: number; spent?: number; hours?: number; leads?: number; verdict?: string; note?: string }) {
    await this.refresh();
    const { experiments } = this.profile;
    const day = this.day();
    let p = [...this.entries.keys()].find((k) => k.startsWith(experiments + "/") && basename(k).toLowerCase().includes(String(a.experiment).toLowerCase()));
    if (!p) {
      p = `${experiments}/${day} ${String(a.experiment).replace(UNSAFE_NAME_RE, " ").trim()}.md`;
      await this.createNote({ path: p, content: `---\ntype: experiment\nstarted: ${day}\nverdict: running\n---\n\n` });
    }
    const fields: Record<string, unknown> = {};
    for (const k of ["strategy", "venture", "revenue", "spent", "hours", "leads", "verdict"] as const) if (a[k] !== undefined) fields[k] = a[k];
    if (a.verdict && a.verdict !== "running") fields.ended = day;
    const r = await this.update({ path: p, fields, log: a.note });
    const { ranking, skipped } = await this.rerankStrategies();
    return { experiment: r.path, strategiesTop: ranking.slice(0, 5), notRanked: skipped };
  }

  // ---------- remember and decide

  /** Save something the person said or the agent learned in the right place, or the inbox when unsure. */
  async remember(a: { text: string; kind?: string; project?: string; title?: string }) {
    await this.refresh();
    const p = this.profile;
    const text = String(a.text ?? "").trim();
    if (!text) throw new AgentError("bad_request", "Nothing to remember.");
    if (SECRET_RE.test(text)) throw new AgentError("bad_request", "That looks like a secret. Keep secrets out of notes.");
    const day = this.day();
    const lower = text.toLowerCase();
    const projects = this.vaultPaths().filter((v) => v.startsWith(p.projects + "/") && !v.slice(p.projects.length + 1).includes("/"));
    const proj = a.project ? projects.find((v) => basename(v).toLowerCase() === String(a.project).toLowerCase()) : projects.find((v) => lower.includes(basename(v).toLowerCase()));
    const kind =
      a.kind ??
      (/\b(always|never|from now on|i prefer|i want .* (every|all)|don't ever|stop)\b/.test(lower)
        ? "preference"
        : /\b(hate|don't like|dislike|annoy|trash|terrible)\b/.test(lower)
          ? "dislike"
          : /\b(love|like|perfect|great)\b/.test(lower)
            ? "like"
            : /\$\d|\brevenue|\bviews\b|\bleads?\b|\bconversion/.test(lower)
              ? "result"
              : proj
                ? "project"
                : "inbox");
    const title = (a.title ?? text.split(/[.!?\n]/)[0]).replace(UNSAFE_NAME_RE, " ").trim().slice(0, 70) || "Note";
    let path: string;
    switch (kind) {
      case "preference":
        path = `${p.preferences}/${title}.md`;
        if (this.fileExists(path)) await this.appendToNote({ path, text: `\n(${day}) ${text}` });
        else await this.createNote({ path, content: `---\ntype: preference\narea: general\nsource: ${JSON.stringify(`${p.ownerName}, ${day}`)}\nconfidence: high\n---\n${text}\n` });
        break;
      case "like":
      case "dislike":
      case "result": {
        path = kind === "like" ? p.likes : kind === "dislike" ? p.dislikes : p.results;
        const heading = kind === "result" ? p.resultsHeading : p.tasteHeading;
        const quote = text.length > title.length ? `"${text.slice(0, 200)}"` : "";
        await this.appendToNote({ path, text: `- **${title}**: seen 1× (last ${day}). ${quote}`, heading }).catch(async () => {
          await this.appendToNote({ path, text: `\n## ${heading}\n\n- **${title}**: seen 1× (last ${day}).` });
        });
        break;
      }
      case "account":
        path = `${p.accounts}/${title}.md`;
        if (this.fileExists(path)) await this.appendToNote({ path, text: `- ${day} ${text}` });
        else await this.createNote({ path, content: `---\ntype: account\n---\n${text}\n` });
        break;
      case "project": {
        if (!proj) throw new AgentError("bad_request", "Which project? Pass project.");
        path = `${proj}/${basename(proj)}.md`;
        await this.addLogLine(path, "Log", `- ${day} ${text}`);
        break;
      }
      default:
        path = `${p.inbox}/${day} ${title}.md`;
        if (!this.fileExists(path)) await this.createNote({ path, content: `---\ntype: inbox\n---\n${text}\n` });
    }
    return { kind, path };
  }

  /** What's waiting on the person (inbox items without a decision), or record their answer to one. */
  async decide(a: { path?: string; answer?: string; note?: string }) {
    await this.refresh();
    if (a.path && a.answer) {
      const p = await this.resolveNote(a.path);
      const answer = this.checkField("inbox", "decision", a.answer) as string;
      await this.setProperty({ path: p, key: "decision", value: answer });
      await this.setProperty({ path: p, key: "decided", value: this.day() });
      if (a.note) await this.appendToNote({ path: p, text: `\nDecision note: ${a.note}` });
      return { path: p, decision: answer };
    }
    const { inbox } = this.profile;
    const nowMs = this.now().getTime();
    const waiting: { path: string; title: string; summary: string; age_days: number }[] = [];
    for (const k of [...this.entries.keys()].filter((k) => k.startsWith(inbox + "/") && isMd(k) && !k.endsWith("/_vault.md") && !basename(k).startsWith("_")).sort()) {
      const { text, meta } = await this.metaOf(k);
      if (meta.frontmatter?.decision) continue;
      const line = text.replace(/^---[\s\S]*?---\s*/, "").split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? "";
      waiting.push({ path: k, title: basename(k), summary: line.trim().slice(0, 200), age_days: Math.round((nowMs - (this.entries.get(k)?.ctime ?? nowMs)) / 86400e3) });
    }
    return { waiting, howTo: "Ask the person, then call decide with path and answer (yes, no or later)." };
  }

  // ---------- get_context

  /**
   * Everything the vault knows about a topic, in one call: the matching project, the best-matching
   * notes across portals, standing preferences, related likes/dislikes and results, matching accounts
   * and key names, and past chats about it.
   */
  async getContext(a: { topic: string; vault?: string; project?: string; brief?: boolean }) {
    const B = !!a.brief;
    const P = this.profile;
    await this.refresh();
    const topic = String(a.topic ?? "").trim();
    if (!topic) throw new AgentError("bad_request", "Say what you need context on.");
    const scope = a.vault ? await this.resolveVault(a.vault) : "";
    const base = [...new Set(topic.toLowerCase().split(/[^a-z0-9.+#-]+/).filter((w) => w.length >= 3 && !STOP.has(w)))].slice(0, 40);
    // Meaning, not just words: a configured synonym widens the match.
    const words = [...new Set(base.flatMap((w) => [w, ...(P.synonyms[w] ?? [])]))];
    const textOf = async (p: string) => this.entries.get(p)?.text ?? (await this.readText(p).catch(() => ""));
    const linesMatching = async (p: string | null, max: number) => {
      if (!p || !this.entries.has(p)) return [];
      const t = await textOf(p);
      return t.split("\n").filter((l) => /^\s*[-*]/.test(l) && words.some((w) => l.toLowerCase().includes(w))).slice(0, max).map((l) => l.trim().slice(0, 300));
    };
    const allVaults = this.vaultPaths();

    // The project, if the topic names one.
    const projects = allVaults.filter((v) => v.startsWith(P.projects + "/") && this.vaultOf(v + "/x", allVaults) === v);
    const lt = topic.toLowerCase();
    const proj = (a.project ? projects.find((v) => basename(v).toLowerCase() === String(a.project).toLowerCase()) : undefined) ?? projects.find((v) => lt.includes(basename(v).toLowerCase())) ?? projects.find((v) => words.some((w) => basename(v).toLowerCase() === w));
    let project: { vault: string; note: string | null; otherNotes: string[] } | null = null;
    if (proj) {
      const main = `${proj}/${basename(proj)}.md`;
      const notes = [...this.entries.keys()].filter((k) => k.startsWith(proj + "/") && isMd(k) && !k.endsWith("/_vault.md"));
      project = { vault: proj, note: this.entries.has(main) ? (await textOf(main)).slice(0, B ? 900 : 6000) : null, otherNotes: notes.filter((n) => n !== main).slice(0, B ? 8 : 30) };
    }

    // Best notes across the vault (chats and the taste notes are reported separately).
    const scored: { path: string; score: number }[] = [];
    for (const e of this.entries.values()) {
      if (!isMd(e.path) || e.path.endsWith("/_vault.md") || P.skipInContext.some((f) => e.path.startsWith(f + "/"))) continue;
      if (scope && !e.path.startsWith(scope + "/")) continue;
      const name = basename(e.path).toLowerCase();
      const body = (e.text ?? "").toLowerCase();
      let score = 0;
      for (const w of words) score += (name.includes(w) ? 5 : 0) + (e.path.toLowerCase().includes(w) ? 2 : 0) + Math.min(5, body.split(w).length - 1);
      if (score > 0) scored.push({ path: e.path, score });
    }
    scored.sort((x, y) => y.score - x.score || x.path.localeCompare(y.path)); // the folder scan's order changes per run
    const notes: { path: string; vault: string | null; lines: string[] }[] = [];
    for (const s of scored.slice(0, B ? 4 : 8)) {
      const t = await textOf(s.path);
      const hit = t.split("\n").filter((l) => words.some((w) => l.toLowerCase().includes(w))).slice(0, B ? 2 : 3).map((l) => l.trim().slice(0, B ? 180 : 240));
      notes.push({ path: s.path, vault: this.vaultOf(s.path, allVaults) || null, lines: hit });
    }

    // Standing preferences, always (title + first line each). Brief: only the ones that touch this topic.
    const preferences: string[] = [];
    for (const k of [...this.entries.keys()].filter((k) => k.startsWith(P.preferences + "/") && isMd(k)).sort()) {
      const body = (await textOf(k)).replace(/^---[\s\S]*?---\s*/, "").split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? "";
      const line = `${basename(k)}: ${body.trim().slice(0, 200)}`;
      if (!B || words.some((w) => line.toLowerCase().includes(w))) preferences.push(line);
    }
    if (B) preferences.splice(5);

    // Past chats about it (newest first).
    const chats: { path: string; ended: string }[] = [];
    const chatPaths = [...this.entries.values()].filter((e) => e.path.startsWith(P.chats + "/") && isMd(e.path)).sort((x, y) => y.mtime - x.mtime);
    for (const e of chatPaths) {
      if (chats.length >= (B ? 2 : 5)) break;
      const t = (e.text ?? "").toLowerCase();
      if (!words.some((w) => t.includes(w))) continue;
      const full = await textOf(e.path);
      const ended = (full.split("## How it ended")[1] ?? "").trim().slice(0, B ? 160 : 300);
      chats.push({ path: e.path, ended });
    }

    const accounts = scored.filter((s) => s.path.startsWith(P.accounts + "/") && s.path !== P.keysNote).slice(0, 6).map((s) => s.path);
    return {
      topic,
      project,
      notes,
      preferences,
      likes: await linesMatching(P.likes, B ? 4 : 8),
      dislikes: await linesMatching(P.dislikes, B ? 4 : 8),
      results: await linesMatching(P.results, B ? 3 : 6),
      accounts,
      apiKeys: await linesMatching(P.keysNote, 6),
      chats,
      next: P.contextHint,
    };
  }
}
