// The agent tools: one list shared by the MCP server (stdio and HTTP), the REST API and the CLI.
// Each tool has a name, a description written for a model to read, a zod input shape (MCP uses it
// as the JSON schema; REST and the CLI validate with it) and a function over AgentOps.
// No Electron imports: this file is bundled into the CLI too.
import * as z from "zod";
import { AgentError, type AgentOps } from "../../core/agent-ops";

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  shape: z.ZodRawShape;
  readOnly: boolean;
  destructive?: boolean;
  /** Needs the app to be running (open_note, get_active_note). */
  needsApp?: boolean;
  run(ops: AgentOps, args: any): Promise<unknown>;
}

const notePath = z.string().min(1).describe('Vault-relative path like "Projects/Plan.md". The ".md" may be left out, and a bare note name ("Plan") is resolved the way [[links]] resolve.');

export const TOOLS: ToolDef[] = [
  {
    name: "search",
    title: "Search notes",
    description:
      "Full-text search across every note in the vault, with the same query language as the app's Search pane. " +
      'Words are ANDed; use OR, -word to exclude, "exact phrase", /regex/, and operators: file:, path:, content:, tag:#x, line:(a b), block:(), section:(), task:, task-todo:, task-done:, match-case:, ignore-case:, and [property] / [property:value] / [property:>5] for frontmatter. ' +
      "Returns matching note paths, best first, with up to 5 matching lines each (1-based line numbers). Use read_note to get a whole note.",
    shape: {
      query: z.string().min(1).describe('Search query, e.g. "meeting tag:#work", "path:Projects -draft", "[status:active]"'),
      limit: z.number().int().min(1).max(500).optional().describe("Most results to return (default 20)"),
      folder: z.string().optional().describe("Only search inside this folder"),
      matchCase: z.boolean().optional().describe("Case-sensitive matching (default false)"),
    },
    readOnly: true,
    run: (ops, a) => ops.search(a),
  },
  {
    name: "read_note",
    title: "Read a note",
    description: "Read one note: its full Markdown text, its properties (YAML frontmatter) as JSON, its tags and its headings with line numbers. Also reads other text files in the vault.",
    shape: { path: notePath },
    readOnly: true,
    run: (ops, a) => ops.readNote(a),
  },
  {
    name: "create_note",
    title: "Create a note",
    description:
      'Create a new Markdown note. Folders in the path are created as needed and ".md" is added when the path has no extension. Fails if the note already exists unless overwrite is true. ' +
      "Use [[Note name]] to link to other notes and #tags for tags; put properties in a YAML block at the top (--- key: value ---) or set them afterwards with set_property.",
    shape: {
      path: z.string().min(1).describe('Where to create it, e.g. "Inbox/Idea.md"'),
      content: z.string().optional().describe("The Markdown text (default empty)"),
      overwrite: z.boolean().optional().describe("Replace the note if it already exists (default false)"),
    },
    readOnly: false,
    run: (ops, a) => ops.createNote(a),
  },
  {
    name: "edit_note",
    title: "Edit a note",
    description:
      "Change an existing note in one of three ways (mode): " +
      '"replace" swaps the whole text for `content`; ' +
      '"find_replace" replaces `find` with `replace` (first match, or every match with all: true; regex: true treats find as a JavaScript regular expression and allows $1 in replace) and fails without changing anything if `find` is not in the note; ' +
      '"patch_heading" rewrites only the section under `heading` (up to the next heading of the same or higher level): position "replace" (default), "append" or "prepend" `content` there. Write the heading text, optionally with its #s ("## Tasks").',
    shape: {
      path: notePath,
      mode: z.enum(["replace", "find_replace", "patch_heading"]).describe("How to edit"),
      content: z.string().optional().describe("New text (replace and patch_heading)"),
      find: z.string().optional().describe("Text to look for (find_replace)"),
      replace: z.string().optional().describe("Replacement text (find_replace)"),
      all: z.boolean().optional().describe("Replace every match, not just the first (find_replace)"),
      regex: z.boolean().optional().describe("Treat find as a regular expression (find_replace)"),
      caseSensitive: z.boolean().optional().describe("Match case (find_replace, default true)"),
      heading: z.string().optional().describe('Heading whose section to change, e.g. "Tasks" or "## Tasks" (patch_heading)'),
      position: z.enum(["replace", "append", "prepend"]).optional().describe("Where content goes in the section (patch_heading, default replace)"),
    },
    readOnly: false,
    destructive: true,
    run: (ops, a) => ops.editNote(a),
  },
  {
    name: "append_to_note",
    title: "Append to a note",
    description: "Add text to the end of a note (on a new line), or to the end of the section under `heading`. Creates the note if it doesn't exist yet (unless create is false). Good for logs, inboxes and journals.",
    shape: {
      path: notePath,
      text: z.string().describe("Markdown to add"),
      heading: z.string().optional().describe("Add at the end of this heading's section instead of the end of the note"),
      create: z.boolean().optional().describe("Create the note if it's missing (default true)"),
    },
    readOnly: false,
    run: (ops, a) => ops.appendToNote(a),
  },
  {
    name: "move_note",
    title: "Move or rename a note",
    description:
      "Rename a note or move it to another folder, and update every [[link]] and Markdown link to it across the vault (like renaming in the app), keeping aliases and #heading parts. " +
      'If `to` is an existing folder or ends with "/", the note keeps its name. Returns how many links were updated in which notes.',
    shape: {
      from: notePath,
      to: z.string().min(1).describe('New path, e.g. "Archive/Plan.md", or a folder like "Archive/"'),
      updateLinks: z.boolean().optional().describe("Update links in other notes (default true)"),
    },
    readOnly: false,
    run: (ops, a) => ops.moveNote(a),
  },
  {
    name: "delete_note",
    title: "Delete a note",
    description: "Move a note to the vault's .trash folder. Nothing is deleted permanently: the person can restore it from .trash, and from Deleted files in Settings › Sync when sync is on.",
    shape: { path: notePath },
    readOnly: false,
    destructive: true,
    run: (ops, a) => ops.deleteNote(a),
  },
  {
    name: "list_notes",
    title: "List notes",
    description: "List Markdown notes in the vault (or inside one folder), sorted by path, with modified/created times (ms since 1970) and sizes. Set allFiles to include attachments and other files.",
    shape: {
      folder: z.string().optional().describe("Only this folder (default: the whole vault)"),
      recursive: z.boolean().optional().describe("Include sub-folders (default true)"),
      allFiles: z.boolean().optional().describe("Include non-Markdown files (default false)"),
      limit: z.number().int().min(1).max(100000).optional().describe("Most notes to return (default 1000)"),
    },
    readOnly: true,
    run: (ops, a) => ops.listNotes(a),
  },
  {
    name: "list_folder",
    title: "List a folder",
    description: "List the sub-folders and files directly inside one folder of the vault (not recursive). Leave path empty for the vault's top level.",
    shape: { path: z.string().optional().describe('Folder path, e.g. "Projects" (default: top level)') },
    readOnly: true,
    run: (ops, a) => ops.listFolder(a),
  },
  {
    name: "get_backlinks",
    title: "Backlinks",
    description: "Notes that link to this note, with the lines that contain the links. Set unlinked to also find notes that mention the note's name without linking it.",
    shape: { path: notePath, unlinked: z.boolean().optional().describe("Also list unlinked mentions (default false)") },
    readOnly: true,
    run: (ops, a) => ops.getBacklinks(a),
  },
  {
    name: "get_outgoing_links",
    title: "Outgoing links",
    description: "Links and embeds inside this note (including links in properties), each with the note it resolves to, or resolved: false when the target doesn't exist yet.",
    shape: { path: notePath },
    readOnly: true,
    run: (ops, a) => ops.getOutgoingLinks(a),
  },
  {
    name: "list_tags",
    title: "List tags",
    description: "Every tag used in the vault (in text and in the tags property) with how many notes use it, most used first.",
    shape: { limit: z.number().int().min(1).optional().describe("Most tags to return") },
    readOnly: true,
    run: (ops, a) => ops.listTags(a),
  },
  {
    name: "notes_with_tag",
    title: "Notes with a tag",
    description: 'Notes that have a tag. "#project" also matches nested tags like "#project/alpha" unless includeNested is false. Case-insensitive.',
    shape: { tag: z.string().min(1).describe('The tag, with or without "#"'), includeNested: z.boolean().optional().describe("Include nested tags (default true)") },
    readOnly: true,
    run: (ops, a) => ops.notesWithTag(a),
  },
  {
    name: "query_properties",
    title: "Query properties",
    description:
      "Find notes by their properties (YAML frontmatter). Each filter has a key and an op: equals, not_equals, contains (substring, or an item of a list), exists, missing, gt, gte, lt, lte (numbers or YYYY-MM-DD dates) or range (min and/or max, inclusive). " +
      'Filters are combined with AND (match: "any" for OR). With no filters, returns every note that has properties. Returns each note\'s path and all its properties.',
    shape: {
      filters: z
        .array(
          z.object({
            key: z.string().min(1).describe("Property name (case-insensitive)"),
            op: z.enum(["equals", "not_equals", "contains", "exists", "missing", "gt", "gte", "lt", "lte", "range"]),
            value: z.union([z.string(), z.number(), z.boolean()]).optional().describe("Value to compare with"),
            min: z.union([z.string(), z.number()]).optional().describe("Lower bound (range)"),
            max: z.union([z.string(), z.number()]).optional().describe("Upper bound (range)"),
          }),
        )
        .optional(),
      match: z.enum(["all", "any"]).optional().describe("all = every filter must match (default), any = at least one"),
      folder: z.string().optional().describe("Only notes in this folder"),
      limit: z.number().int().min(1).optional().describe("Most notes to return (default 200)"),
    },
    readOnly: true,
    run: (ops, a) => ops.queryProperties(a),
  },
  {
    name: "set_property",
    title: "Set a property",
    description: "Set one property in a note's YAML frontmatter (creating the block if needed) without touching the rest of the note. value can be text, a number, true/false, or a list; null removes the property.",
    shape: {
      path: notePath,
      key: z.string().min(1).describe('Property name, e.g. "status"'),
      value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number(), z.boolean()])), z.null()]).describe("New value, or null to remove it"),
    },
    readOnly: false,
    run: (ops, a) => ops.setProperty(a),
  },
  {
    name: "get_daily_note",
    title: "Daily note",
    description:
      "Get the daily note for today (or another date), creating it if it's missing with the vault's Daily notes settings (folder, date format and template from .obsidian/daily-notes.json). " +
      "Pass append to add a line or block to it in the same call. Returns the note's path and text.",
    shape: {
      date: z.string().optional().describe('YYYY-MM-DD, "today" (default), "yesterday" or "tomorrow"'),
      create: z.boolean().optional().describe("Create it if missing (default true)"),
      append: z.string().optional().describe("Text to add to the end of the daily note"),
    },
    readOnly: false,
    run: (ops, a) => ops.getDailyNote(a),
  },
  {
    name: "get_active_note",
    title: "Active note",
    description: "The note open and focused in the app right now (path, text, properties). Only works while the app is running.",
    shape: {},
    readOnly: true,
    needsApp: true,
    run: (ops) => ops.getActiveNote(),
  },
  {
    name: "open_note",
    title: "Open a note in the app",
    description: "Open a note in the app's editor so the person can see it. Only works while the app is running.",
    shape: { path: notePath, newTab: z.boolean().optional().describe("Open in a new tab (default false)"), line: z.number().int().min(1).optional().describe("Line to scroll to") },
    readOnly: true,
    needsApp: true,
    run: (ops, a) => ops.openNote(a),
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Validate the arguments for a tool (throws AgentError "bad_request" with a readable message). */
export function validateArgs(tool: ToolDef, args: unknown): any {
  const r = z.object(tool.shape).safeParse(args ?? {});
  if (r.success) return r.data;
  const msg = r.error.issues.map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`).join("; ");
  throw new AgentError("bad_request", `Invalid arguments for ${tool.name}: ${msg}`);
}

/** Run a tool by name against an AgentOps. */
export async function runTool(ops: AgentOps, name: string, args: unknown): Promise<unknown> {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) throw new AgentError("not_found", `There's no tool called “${name}”. Tools: ${TOOLS.map((t) => t.name).join(", ")}.`);
  return tool.run(ops, validateArgs(tool, args));
}

/** Turn any thrown error into {code, message, status}. */
export function errorInfo(e: unknown): { code: string; message: string; status: number } {
  if (e instanceof AgentError) return { code: e.code, message: e.message, status: e.status };
  const err = e as any;
  if (err?.code === "ENOENT") return { code: "not_found", message: "That file or folder doesn't exist.", status: 404 };
  if (err?.code === "EACCES" || err?.code === "EPERM") return { code: "forbidden", message: "The file is locked or not allowed to be changed. Close any program using it and try again.", status: 403 };
  if (err?.code === "EBUSY") return { code: "unavailable", message: "The file is busy (another program has it open). Try again in a moment.", status: 503 };
  return { code: "internal", message: String(err?.message ?? err), status: 500 };
}
