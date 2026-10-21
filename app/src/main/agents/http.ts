// The local agent server inside the running app: MCP over Streamable HTTP at /mcp and the REST API
// at /v1/*, on 127.0.0.1 only. Every request needs `Authorization: Bearer <token>`. Requests whose
// Host isn't 127.0.0.1/localhost:<port>, or that carry an Origin from anywhere else, are refused
// (DNS rebinding protection), and no CORS headers are ever sent, so web pages can't call it.
// No Electron imports (unit-tested in plain Node).
import crypto from "node:crypto";
import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as z from "zod";
import { createMcpServer, type ToolCaller } from "./mcp";
import { TOOLS, TOOL_BY_NAME, errorInfo } from "./tools";
import { AgentError } from "../../core/agent-ops";

const MAX_BODY = 10 * 1024 * 1024;

export interface AgentServerOptions {
  call: ToolCaller;
  getToken: () => string;
  version: string;
  /** Extra fields for GET /v1/status. */
  status?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
}

type Route = { method: string; path: string; tool: string; from: "query" | "body" | "none"; fixed?: Record<string, unknown> };

/** REST routes: each maps to one tool. Documented in docs/AGENT-API.md (OpenAPI). */
export const ROUTES: Route[] = [
  { method: "GET", path: "/v1/search", tool: "search", from: "query" },
  { method: "GET", path: "/v1/notes", tool: "list_notes", from: "query" },
  { method: "GET", path: "/v1/note", tool: "read_note", from: "query" },
  { method: "POST", path: "/v1/note", tool: "create_note", from: "body" },
  { method: "PATCH", path: "/v1/note", tool: "edit_note", from: "body" },
  { method: "DELETE", path: "/v1/note", tool: "delete_note", from: "query" },
  { method: "POST", path: "/v1/note/append", tool: "append_to_note", from: "body" },
  { method: "POST", path: "/v1/note/move", tool: "move_note", from: "body" },
  { method: "GET", path: "/v1/folder", tool: "list_folder", from: "query" },
  { method: "GET", path: "/v1/backlinks", tool: "get_backlinks", from: "query" },
  { method: "GET", path: "/v1/links", tool: "get_outgoing_links", from: "query" },
  { method: "GET", path: "/v1/tags", tool: "list_tags", from: "query" },
  { method: "GET", path: "/v1/tags/notes", tool: "notes_with_tag", from: "query" },
  { method: "POST", path: "/v1/properties/query", tool: "query_properties", from: "body" },
  { method: "PUT", path: "/v1/properties", tool: "set_property", from: "body" },
  { method: "GET", path: "/v1/daily", tool: "get_daily_note", from: "query", fixed: { create: false } },
  { method: "POST", path: "/v1/daily", tool: "get_daily_note", from: "body" },
  { method: "GET", path: "/v1/active", tool: "get_active_note", from: "none" },
  { method: "POST", path: "/v1/open", tool: "open_note", from: "body" },
];

function coerceQuery(tool: string, q: URLSearchParams): Record<string, unknown> {
  const shape = TOOL_BY_NAME.get(tool)?.shape ?? {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of q) {
    const t = (shape as any)[k];
    const kind = t ? innerType(t) : "string";
    if (kind === "number") out[k] = v.trim() === "" ? undefined : Number(v);
    else if (kind === "boolean") out[k] = /^(1|true|yes|on)$/i.test(v);
    else out[k] = v;
  }
  return out;
}

function innerType(t: any): string {
  let cur = t;
  for (let i = 0; i < 5 && cur; i++) {
    if (cur instanceof z.ZodNumber) return "number";
    if (cur instanceof z.ZodBoolean) return "boolean";
    cur = cur.unwrap?.() ?? cur._def?.innerType;
  }
  return "string";
}

function safeEqual(a: string, b: string): boolean {
  const x = crypto.createHash("sha256").update(a).digest();
  const y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y) && a.length === b.length;
}

export class AgentHttpServer {
  readonly server: http.Server;
  port = 0;

  constructor(private o: AgentServerOptions) {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((e) => {
        if (!res.headersSent) this.json(res, 500, { error: "internal", message: String(e?.message ?? e) });
        else res.end();
      });
    });
    this.server.keepAliveTimeout = 5000;
  }

  /** Listen on 127.0.0.1:<port>. Port 0 = any free port. Rejects with EADDRINUSE when taken. */
  listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const onErr = (e: Error) => {
        this.server.off("listening", onOk);
        reject(e);
      };
      const onOk = () => {
        this.server.off("error", onErr);
        this.port = (this.server.address() as any).port;
        resolve(this.port);
      };
      this.server.once("error", onErr);
      this.server.once("listening", onOk);
      this.server.listen(port, "127.0.0.1");
    });
  }

  close(): Promise<void> {
    return new Promise((r) => {
      this.server.close(() => r());
      this.server.closeAllConnections?.();
    });
  }

  private json(res: http.ServerResponse, status: number, body: unknown): void {
    const s = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(s);
  }

  private hostOk(req: http.IncomingMessage): boolean {
    const host = String(req.headers.host ?? "").toLowerCase();
    const allowed = [`127.0.0.1:${this.port}`, `localhost:${this.port}`, `[::1]:${this.port}`];
    return allowed.includes(host);
  }

  private originOk(req: http.IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    const allowed = [`http://127.0.0.1:${this.port}`, `http://localhost:${this.port}`, `http://[::1]:${this.port}`];
    return allowed.includes(String(origin).toLowerCase());
  }

  private async readBody(req: http.IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > MAX_BODY) throw new AgentError("bad_request", "The request body is larger than 10 MB.");
      chunks.push(c as Buffer);
    }
    if (!size) return undefined;
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new AgentError("bad_request", "The request body is not valid JSON.");
    }
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // 1. DNS rebinding / browser protection, before anything else.
    if (!this.hostOk(req)) return this.json(res, 403, { error: "forbidden_host", message: "This server only answers requests addressed to 127.0.0.1 or localhost." });
    if (!this.originOk(req)) return this.json(res, 403, { error: "forbidden_origin", message: "Requests from web pages are not allowed." });
    if (req.method === "OPTIONS") return this.json(res, 403, { error: "forbidden_origin", message: "Cross-origin requests are not allowed." });
    // 2. Token.
    const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ""));
    if (!m || !safeEqual(m[1].trim(), this.o.getToken())) {
      res.setHeader("www-authenticate", 'Bearer realm="bedrock"');
      return this.json(res, 401, { error: "unauthorized", message: "Missing or wrong API token. Copy the token from Settings › Connect an AI agent." });
    }
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    // 3. MCP (Streamable HTTP, stateless: one server + transport per request).
    if (pathname === "/mcp") {
      let body: unknown;
      try {
        body = req.method === "POST" ? await this.readBody(req) : undefined;
      } catch (e) {
        const info = errorInfo(e);
        return this.json(res, info.status, { jsonrpc: "2.0", error: { code: -32700, message: info.message }, id: null });
      }
      const server = createMcpServer({ call: this.o.call, version: this.o.version });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req as any, res, body);
      return;
    }

    // 4. REST.
    if (pathname === "/v1/status" && req.method === "GET") {
      const extra = (await this.o.status?.()) ?? {};
      return this.json(res, 200, { ok: true, version: this.o.version, mcp: `http://127.0.0.1:${this.port}/mcp`, rest: `http://127.0.0.1:${this.port}/v1`, ...extra });
    }
    if (pathname === "/v1/tools" && req.method === "GET") {
      return this.json(res, 200, { tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, readOnly: t.readOnly, inputSchema: z.toJSONSchema(z.object(t.shape)) })) });
    }
    try {
      let tool: string | undefined;
      let args: Record<string, unknown> = {};
      const generic = /^\/v1\/tools\/([a-z_]+)$/.exec(pathname);
      if (generic) {
        if (req.method !== "POST") return this.json(res, 405, { error: "method_not_allowed", message: "Use POST to run a tool." });
        tool = generic[1];
        args = ((await this.readBody(req)) as any) ?? {};
      } else {
        const route = ROUTES.find((r) => r.path === pathname && r.method === req.method);
        if (!route) {
          const other = ROUTES.some((r) => r.path === pathname);
          return this.json(res, other ? 405 : 404, { error: other ? "method_not_allowed" : "not_found", message: other ? `${req.method} isn't supported on ${pathname}.` : `There's nothing at ${pathname}. See docs/AGENT-API.md.` });
        }
        tool = route.tool;
        if (route.from === "query") args = coerceQuery(route.tool, url.searchParams);
        else if (route.from === "body") args = ((await this.readBody(req)) as any) ?? {};
        Object.assign(args, route.fixed ?? {});
      }
      if (typeof args !== "object" || Array.isArray(args)) throw new AgentError("bad_request", "The request body must be a JSON object.");
      const result = await this.o.call(tool, args);
      return this.json(res, 200, result);
    } catch (e) {
      const info = errorInfo(e);
      return this.json(res, info.status, { error: info.code, message: info.message });
    }
  }
}
