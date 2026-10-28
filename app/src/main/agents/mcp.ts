// The MCP server (official MIT @modelcontextprotocol/sdk). The same server definition is used for
// both transports: stdio (`bedrock mcp`, `<exe> --mcp`) and Streamable HTTP inside the running app
// (http://127.0.0.1:<port>/mcp, bearer token). `call` runs a tool: in the app it is AgentOps directly;
// in the stdio process it is either the running app's REST API or AgentOps on the vault folder.
// No Electron imports (bundled into the CLI).
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BRAND } from "../../shared/brand";
import { TOOLS, errorInfo } from "./tools";

export type ToolCaller = (name: string, args: Record<string, unknown>) => Promise<unknown>;

const NOTE_URI = "bedrock://note/";

export function noteUri(path: string): string {
  return NOTE_URI + path.split("/").map(encodeURIComponent).join("/");
}

export function pathFromNoteUri(uri: string): string {
  if (!uri.startsWith(NOTE_URI)) throw new Error(`Not a note address: ${uri}`);
  return uri.slice(NOTE_URI.length).split("/").map(decodeURIComponent).join("/");
}

export const SERVER_INSTRUCTIONS =
  `Tools for the person's ${BRAND.productTitle} vault: a folder of Markdown notes (Obsidian-compatible) on their computer. ` +
  "Paths are relative to the vault, like \"Projects/Plan.md\". Notes link with [[Note name]], have #tags and may start with YAML properties. " +
  "Search before creating a note so you don't make duplicates. If the person turned sync on, edits sync to their other computers and keep version history; delete_note moves notes to .trash, nothing is deleted permanently.";

export function createMcpServer(o: { call: ToolCaller; version: string }): McpServer {
  const server = new McpServer({ name: BRAND.name, title: BRAND.productTitle, version: o.version }, { instructions: SERVER_INSTRUCTIONS, capabilities: { tools: {}, resources: {} } });

  for (const t of TOOLS) {
    server.registerTool(
      t.name,
      {
        title: t.title,
        description: t.description,
        inputSchema: t.shape,
        annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: !!t.destructive, idempotentHint: t.readOnly, openWorldHint: false },
      },
      (async (args: Record<string, unknown>) => {
        try {
          const result = await o.call(t.name, args ?? {});
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          const info = errorInfo(e);
          return { isError: true, content: [{ type: "text" as const, text: info.message }] };
        }
      }) as any,
    );
  }

  server.registerResource(
    "note",
    new ResourceTemplate(NOTE_URI + "{+path}", {
      list: async () => {
        const r = (await o.call("list_notes", { limit: 5000 })) as { notes: { path: string; size: number }[] };
        return {
          resources: r.notes.map((n) => ({ uri: noteUri(n.path), name: n.path.replace(/\.md$/i, ""), mimeType: "text/markdown", size: n.size })),
        };
      },
    }),
    { title: "Note", description: "A Markdown note in the vault (bedrock://note/<path>).", mimeType: "text/markdown" },
    async (uri) => {
      const r = (await o.call("read_note", { path: pathFromNoteUri(uri.href) })) as { path: string; content: string };
      return { contents: [{ uri: noteUri(r.path), mimeType: "text/markdown", text: r.content }] };
    },
  );
  return server;
}
