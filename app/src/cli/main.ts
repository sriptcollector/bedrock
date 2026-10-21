// The `bedrock` command line. Works with the running app when there is one (edits show live) and
// on the vault folder when there isn't. `bedrock mcp` runs the stdio MCP server.
//
// Shipped as dist/cli.js. The installed `bedrock` shim runs it with the app's own executable in
// Node mode (ELECTRON_RUN_AS_NODE=1), so no window opens and it starts fast; `<exe> --cli <args>`
// and `<exe> --mcp` do the same from the app's main process (see main/index.ts).
import path from "node:path";
import { spawn } from "node:child_process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Backend, VERSION } from "./backend";
import { createMcpServer } from "../main/agents/mcp";
import { TOOLS, errorInfo } from "../main/agents/tools";
import { AgentError, type PropertyFilter } from "../core/agent-ops";
import { BRAND } from "../shared/brand";

const CMD = BRAND.exeName;

const HELP = `${BRAND.productTitle} ${VERSION} – command line

Usage: ${CMD} <command> [arguments] [--json] [--vault <folder>]

  search <query> [--limit n]         Full-text search (same query language as the app)
  read <path>                         Print a note
  new <path> [--content <text> | -]  Create a note (- reads the text from stdin) [--overwrite]
  append <path> <text | ->            Add text to the end of a note [--heading <h>]
  daily [--append <text | ->]         Today's daily note (created if missing) [--date YYYY-MM-DD]
  mv <from> <to>                      Rename or move a note and update links to it [--no-links]
  rm <path>                           Move a note to the vault's .trash folder
  ls [folder]                         List notes [--all]
  tags [tag]                          List tags, or the notes with one tag
  backlinks <path>                    Notes that link to a note [--unlinked]
  links <path>                        Links inside a note
  props <filter>...                   Notes whose properties match, e.g. status=active "due<2026-11-01"
                                      (= != ~contains > >= < <=, key? exists, !key missing; --any = OR)
  set <path> <key> <value>            Set a property (value is JSON or text; "null" removes it)
  open <path>                         Open a note in the app (starts it if needed)
  mcp                                 Run the MCP server on stdin/stdout (for AI agent apps)
  tools                               List the agent tools
  call <tool> [<json> | -]            Run any agent tool with JSON arguments

Options: --json prints JSON. --vault <folder> works on that folder instead of your ${BRAND.displayName} vault.
`;

interface Parsed {
  cmd: string;
  pos: string[];
  flags: Map<string, string | true>;
}

const VALUE_FLAGS = new Set(["--content", "--limit", "--heading", "--append", "--date", "--vault", "--folder"]);

export function parseArgs(argv: string[]): Parsed {
  const pos: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--") && a.length > 2) {
      const eq = a.indexOf("=");
      if (eq > 0) flags.set(a.slice(0, eq), a.slice(eq + 1));
      else if (VALUE_FLAGS.has(a) && i + 1 < argv.length) flags.set(a, argv[++i]);
      else flags.set(a, true);
    } else if (a === "-h") flags.set("--help", true);
    else pos.push(a);
  }
  return { cmd: pos.shift() ?? "", pos, flags };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const textArg = async (v: string | true | undefined): Promise<string | undefined> => (v === "-" ? readStdin() : typeof v === "string" ? v : undefined);

/** "status=active", "due<2026-11-01", "tags~work", "draft?", "!archived" -> a filter. */
export function parsePropFilter(s: string): PropertyFilter {
  if (s.startsWith("!")) return { key: s.slice(1), op: "missing" };
  if (s.endsWith("?")) return { key: s.slice(0, -1), op: "exists" };
  const m = /^(.+?)(!=|>=|<=|=|~|>|<)(.*)$/.exec(s);
  if (!m) return { key: s, op: "exists" };
  const op = { "=": "equals", "!=": "not_equals", "~": "contains", ">": "gt", ">=": "gte", "<": "lt", "<=": "lte" }[m[2]] as PropertyFilter["op"];
  const raw = m[3];
  const value: unknown = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw === "true" ? true : raw === "false" ? false : raw;
  return { key: m[1].trim(), op, value };
}

function parseValue(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function need(p: Parsed, n: number, usage: string): void {
  if (p.pos.length < n) throw new AgentError("bad_request", `Usage: ${CMD} ${usage}`);
}

/** Start the app on a note when it isn't running. */
function launchApp(abs: string): boolean {
  if (!process.versions.electron) return false;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const packaged = __filename.includes("app.asar");
  const args = packaged ? [abs] : [path.resolve(__dirname, ".."), abs];
  const child = spawn(process.execPath, args, { detached: true, stdio: "ignore", env });
  child.unref();
  return true;
}

type Out = { write(s: string): void };

export async function runCli(argv: string[], out: Out = process.stdout, err: Out = process.stderr): Promise<number> {
  const p = parseArgs(argv);
  const json = p.flags.has("--json");
  if (p.flags.has("--version") || p.cmd === "version") {
    out.write(VERSION + "\n");
    return 0;
  }
  if (!p.cmd || p.cmd === "help" || p.flags.has("--help")) {
    out.write(HELP);
    return p.cmd || p.flags.has("--help") ? 0 : 1;
  }
  const vault = typeof p.flags.get("--vault") === "string" ? (p.flags.get("--vault") as string) : undefined;
  const backend = new Backend({ vault, diskOnly: p.flags.has("--offline") });
  if (p.cmd === "mcp") return runMcpStdio(backend);

  const print = (human: string, data: unknown) => out.write(json ? JSON.stringify(data, null, 2) + "\n" : human.endsWith("\n") || !human ? human : human + "\n");
  try {
    switch (p.cmd) {
      case "search": {
        need(p, 1, "search <query>");
        const limit = p.flags.get("--limit");
        const r: any = await backend.call("search", { query: p.pos.join(" "), ...(typeof limit === "string" ? { limit: Number(limit) } : {}) });
        const lines = r.results.map((x: any) => [x.path, ...x.matches.map((m: any) => `  ${m.line}: ${m.text}`)].join("\n"));
        print(r.total ? lines.join("\n") + (r.total > r.results.length ? `\n(${r.total - r.results.length} more; use --limit)` : "") : "No matches.", r);
        return 0;
      }
      case "read":
      case "cat": {
        need(p, 1, "read <path>");
        const r: any = await backend.call("read_note", { path: p.pos.join(" ") });
        print(r.content, r);
        return 0;
      }
      case "new":
      case "create": {
        need(p, 1, "new <path> [--content <text> | -]");
        const content = (await textArg(p.flags.get("--content"))) ?? (p.pos[1] === "-" ? await readStdin() : p.pos.slice(1).join(" ") || "");
        const r: any = await backend.call("create_note", { path: p.pos[0], content, overwrite: p.flags.has("--overwrite") });
        print(`${r.overwritten ? "Replaced" : "Created"} ${r.path}`, r);
        return 0;
      }
      case "append": {
        need(p, 2, "append <path> <text | ->");
        const text = p.pos[1] === "-" ? await readStdin() : p.pos.slice(1).join(" ");
        const heading = p.flags.get("--heading");
        const r: any = await backend.call("append_to_note", { path: p.pos[0], text, ...(typeof heading === "string" ? { heading } : {}) });
        print(`${r.created ? "Created" : "Appended to"} ${r.path}`, r);
        return 0;
      }
      case "daily": {
        const append = await textArg(p.flags.get("--append"));
        const date = p.flags.get("--date");
        const r: any = await backend.call("get_daily_note", { ...(append ? { append } : {}), ...(typeof date === "string" ? { date } : {}) });
        print(append ? `${r.created ? "Created" : "Appended to"} ${r.path}` : r.content || `${r.path} (empty)`, r);
        return 0;
      }
      case "mv":
      case "move": {
        need(p, 2, "mv <from> <to>");
        const r: any = await backend.call("move_note", { from: p.pos[0], to: p.pos[1], updateLinks: !p.flags.has("--no-links") });
        print(`Moved ${r.from} -> ${r.to}${r.updatedLinks ? ` (updated ${r.updatedLinks} link${r.updatedLinks === 1 ? "" : "s"} in ${r.updatedNotes.length} note${r.updatedNotes.length === 1 ? "" : "s"})` : ""}`, r);
        return 0;
      }
      case "rm":
      case "delete": {
        need(p, 1, "rm <path>");
        const r: any = await backend.call("delete_note", { path: p.pos.join(" ") });
        print(`Moved ${r.path} to ${r.movedTo}`, r);
        return 0;
      }
      case "ls":
      case "list": {
        const r: any = await backend.call("list_notes", { ...(p.pos[0] ? { folder: p.pos.join(" ") } : {}), allFiles: p.flags.has("--all") });
        print(r.notes.map((n: any) => n.path).join("\n") || "No notes.", r);
        return 0;
      }
      case "tags": {
        if (p.pos.length) {
          const r: any = await backend.call("notes_with_tag", { tag: p.pos[0] });
          print(r.notes.join("\n") || `No notes with ${r.tag}.`, r);
        } else {
          const r: any = await backend.call("list_tags", {});
          print(r.tags.map((t: any) => `${t.tag}\t${t.count}`).join("\n") || "No tags.", r);
        }
        return 0;
      }
      case "backlinks": {
        need(p, 1, "backlinks <path>");
        const r: any = await backend.call("get_backlinks", { path: p.pos.join(" "), unlinked: p.flags.has("--unlinked") });
        const lines = r.backlinks.map((b: any) => [b.source, ...b.lines.map((l: any) => `  ${l.line}: ${l.text}`)].join("\n"));
        if (r.unlinkedMentions?.length) lines.push("", "Unlinked mentions:", ...r.unlinkedMentions.map((b: any) => b.source));
        print(lines.join("\n") || `Nothing links to ${r.path}.`, r);
        return 0;
      }
      case "links": {
        need(p, 1, "links <path>");
        const r: any = await backend.call("get_outgoing_links", { path: p.pos.join(" ") });
        print(r.links.map((l: any) => `${l.link}${l.target ? ` -> ${l.target}` : " (not created yet)"}`).join("\n") || "No links.", r);
        return 0;
      }
      case "props":
      case "properties": {
        const filters = p.pos.map(parsePropFilter);
        const r: any = await backend.call("query_properties", { filters, match: p.flags.has("--any") ? "any" : "all" });
        print(r.notes.map((n: any) => `${n.path}\t${JSON.stringify(n.properties)}`).join("\n") || "No matching notes.", r);
        return 0;
      }
      case "set": {
        need(p, 3, "set <path> <key> <value>");
        const r: any = await backend.call("set_property", { path: p.pos[0], key: p.pos[1], value: parseValue(p.pos.slice(2).join(" ")) });
        print(`Updated ${r.path}`, r);
        return 0;
      }
      case "open": {
        need(p, 1, "open <path>");
        const target = p.pos.join(" ");
        if ((await backend.mode()) === "app") {
          const r: any = await backend.call("open_note", { path: target });
          print(`Opened ${r.path}`, r);
          return 0;
        }
        const r: any = await backend.call("read_note", { path: target });
        const abs = path.join(backend.vaultPath, ...r.path.split("/"));
        if (!launchApp(abs)) throw new AgentError("unavailable", `${BRAND.displayName} isn't running. Start it, then try again.`);
        print(`Starting ${BRAND.displayName} on ${r.path}`, { path: r.path, opened: true, started: true });
        return 0;
      }
      case "tools": {
        print(TOOLS.map((t) => `${t.name.padEnd(20)} ${t.title}`).join("\n"), TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description })));
        return 0;
      }
      case "call": {
        need(p, 1, "call <tool> [<json> | -]");
        const raw = p.pos[1] === "-" ? await readStdin() : p.pos.slice(1).join(" ");
        let args: any = {};
        if (raw.trim()) {
          try {
            args = JSON.parse(raw);
          } catch {
            throw new AgentError("bad_request", "The arguments must be JSON, like '{\"path\":\"Note.md\"}'.");
          }
        }
        const r = await backend.call(p.pos[0], args);
        out.write(JSON.stringify(r, null, 2) + "\n");
        return 0;
      }
      default:
        err.write(`Unknown command “${p.cmd}”. Run “${CMD} help” for the list.\n`);
        return 2;
    }
  } catch (e) {
    const info = errorInfo(e);
    if (json) out.write(JSON.stringify({ error: info.code, message: info.message }, null, 2) + "\n");
    else err.write(info.message + "\n");
    return info.code === "not_found" ? 3 : 1;
  }
}

/** The stdio MCP server. Resolves when the client closes stdin. */
export async function runMcpStdio(backend = new Backend()): Promise<number> {
  const server = createMcpServer({
    version: VERSION,
    call: async (name, args) => {
      if (!backend.enabled()) throw new AgentError("disabled", `Agent access is turned off. Turn it on in ${BRAND.displayName} › Settings › Connect an AI agent.`);
      return backend.call(name, args);
    },
  });
  const transport = new StdioServerTransport();
  const closed = new Promise<void>((r) => {
    transport.onclose = () => r();
    process.stdin.once("end", () => r());
    process.stdin.once("close", () => r());
  });
  await server.connect(transport);
  await closed;
  await server.close().catch(() => undefined);
  return 0;
}
