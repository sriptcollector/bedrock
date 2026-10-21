// OpenAPI 3.1 description of the local REST API, built from the same tool list and routes the
// server uses, so it can't drift. `node app/scripts/agent-openapi.mjs` writes it into
// docs/AGENT-API.md; a unit test checks the copy there is current.
import * as z from "zod";
import { BRAND } from "../../shared/brand";
import { ROUTES } from "./http";
import { TOOLS, TOOL_BY_NAME } from "./tools";
import { DEFAULT_PORT } from "./settings";

const ERR = { $ref: "#/components/responses/Error" };

function schemaOf(name: string): any {
  const t = TOOL_BY_NAME.get(name)!;
  const s: any = z.toJSONSchema(z.object(t.shape));
  delete s.$schema;
  return s;
}

export function buildOpenApi(): any {
  const paths: Record<string, any> = {};
  for (const r of ROUTES) {
    const t = TOOL_BY_NAME.get(r.tool)!;
    const s = schemaOf(r.tool);
    for (const k of Object.keys(r.fixed ?? {})) delete s.properties?.[k];
    const op: any = {
      operationId: `${r.method.toLowerCase()}${r.path.replace(/^\/v1/, "").replace(/\/(\w)/g, (_m, c) => c.toUpperCase())}`,
      summary: t.title + (r.fixed ? " (read only)" : ""),
      description: t.description + (r.fixed?.create === false ? " This GET form never creates the note; POST does." : ""),
      tags: [t.readOnly ? "read" : "write"],
      responses: { "200": { description: "The result as JSON.", content: { "application/json": { schema: { type: "object" } } } }, "4XX": ERR, "503": ERR },
    };
    if (r.from === "query") {
      op.parameters = Object.entries<any>(s.properties ?? {}).map(([name, p]) => ({ name, in: "query", required: (s.required ?? []).includes(name), description: p.description, schema: { ...p, description: undefined } }));
    } else if (r.from === "body") {
      op.requestBody = { required: true, content: { "application/json": { schema: s } } };
    }
    (paths[r.path] ??= {})[r.method.toLowerCase()] = op;
  }
  paths["/v1/status"] = {
    get: { operationId: "getStatus", summary: "Status", description: "Version, the MCP and REST addresses, the vault name and whether the app window is connected.", tags: ["read"], responses: { "200": { description: "Status.", content: { "application/json": { schema: { type: "object" } } } }, "4XX": ERR } },
  };
  paths["/v1/tools"] = {
    get: { operationId: "listTools", summary: "List tools", description: "Every tool with its description and JSON input schema (the same list the MCP server offers).", tags: ["read"], responses: { "200": { description: "Tools.", content: { "application/json": { schema: { type: "object" } } } }, "4XX": ERR } },
  };
  paths["/v1/tools/{name}"] = {
    post: {
      operationId: "runTool",
      summary: "Run any tool",
      description: "Run a tool by name with its arguments as the JSON body. Same tools, arguments and results as the MCP server.",
      tags: ["write"],
      parameters: [{ name: "name", in: "path", required: true, schema: { type: "string", enum: TOOLS.map((t) => t.name) } }],
      requestBody: { required: false, content: { "application/json": { schema: { type: "object" } } } },
      responses: { "200": { description: "The result as JSON.", content: { "application/json": { schema: { type: "object" } } } }, "4XX": ERR, "503": ERR },
    },
  };
  paths["/mcp"] = {
    post: {
      operationId: "mcp",
      summary: "MCP (Streamable HTTP)",
      description: "Model Context Protocol endpoint, stateless Streamable HTTP. Use an MCP client; send the same bearer token.",
      tags: ["mcp"],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", description: "A JSON-RPC 2.0 message" } } } },
      responses: { "200": { description: "JSON-RPC response." }, "4XX": ERR },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: `${BRAND.productTitle} local API`,
      version: "1",
      description: `Local REST API of the running ${BRAND.productTitle}. Listens on 127.0.0.1 only; every request needs the bearer token from Settings › Connect an AI agent. Requests with a Host other than 127.0.0.1/localhost:<port> or a foreign Origin are refused, and no CORS headers are sent.`,
    },
    servers: [{ url: `http://127.0.0.1:${DEFAULT_PORT}`, description: "Default port; the real one is shown in Settings › Connect an AI agent." }],
    security: [{ bearer: [] }],
    tags: [
      { name: "read", description: "Read-only" },
      { name: "write", description: "Changes notes" },
      { name: "mcp", description: "Model Context Protocol" },
    ],
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "The API token from Settings › Connect an AI agent (starts with bdk_)." } },
      schemas: {
        Error: {
          type: "object",
          required: ["error", "message"],
          properties: {
            error: { type: "string", enum: ["bad_request", "not_found", "exists", "forbidden", "unavailable", "unauthorized", "forbidden_host", "forbidden_origin", "method_not_allowed", "internal"] },
            message: { type: "string", description: "What happened, in plain words." },
          },
        },
      },
      responses: { Error: { description: "Error (400 bad request, 401 token, 403 outside the vault / host / origin, 404 not found, 409 exists, 503 app not ready).", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } },
    },
  };
}
