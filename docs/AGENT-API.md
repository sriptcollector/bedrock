# Agent access: MCP, REST API and the `bedrock` command

AI agents (Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, scripts) can use the notes in the
one synced vault. Three ways in, all doing the same operations with the same code
(`app/src/core/agent-ops.ts`):

| Way in | Who starts it | Where it runs | Auth |
|---|---|---|---|
| **MCP over stdio** (`bedrock mcp`) | the agent app, when it needs it | a small Node-mode process of the app's own executable | none needed: only a program you set up can start it |
| **MCP over Streamable HTTP** `http://127.0.0.1:<port>/mcp` | the running app | inside the app | bearer token |
| **REST API** `http://127.0.0.1:<port>/v1/…` | the running app | inside the app | bearer token |
| **`bedrock` command** | you or an agent in a terminal | Node-mode process | none needed |

On by default; **Settings › Connect an AI agent** has the switch, the addresses, the token and
one-click setup. Turning it off stops the HTTP server and makes the stdio server refuse every call
("Agent access is turned off…"). The `bedrock` command keeps working for you.

## Where edits go

- **App running:** the stdio server and the CLI find the app through
  `<app data>/agents/running.json` and send every operation to its local API. Writes then go
  through the main window's vault (`app.vault`), so an open note updates at once and every view
  sees the change, exactly like an edit made in the app.
- **App not running:** they work on the vault folder directly (files on disk are the source of
  truth). Writes are atomic (temp file + rename). The app's watcher picks the changes up when it
  starts.
- Either way the change lands in the synced vault folder, so the sync engine uploads it and it
  gets **version history** like any other edit (tested end to end, see Tests below).
- `delete_note` moves the note to the vault's `.trash` folder. Nothing is deleted permanently; with
  sync on, the deletion is also restorable from Settings › Sync › Deleted files.
- Writes are serialised (one at a time per process), and the app applies them in order.

## Security

- The HTTP server binds to **127.0.0.1 only**. Every request needs
  `Authorization: Bearer <token>`. The token (`bdk_…`, 256 random bits) is made on first run and
  stored in `<app data>/agents/settings.json` (mode 0600 on macOS/Linux), never in the vault,
  never synced. **New token** in settings replaces it.
- **DNS rebinding:** requests whose `Host` isn't `127.0.0.1:<port>`, `localhost:<port>` or
  `[::1]:<port>` are refused (403), and so is any request with an `Origin` other than those.
  No CORS headers are ever sent and preflight requests are refused, so web pages can't call it.
- **Paths:** only vault-relative paths. Absolute paths, drive letters, `..`, hidden folders
  (`.obsidian`, `.trash`, `.git`…) and junctions/symlinks that lead outside the vault are refused
  (403 / an MCP error saying so).
- The stdio server only runs when an agent app launches it. No telemetry; nothing leaves the
  computer. The app changes files outside the vault only when you click **Connect** for an agent
  app, and then only that app's MCP settings file (backed up first as `<file>.bak-<time>`, other
  servers and settings kept).
- Port: `27125` by default. If it's taken, the app picks a free one and keeps it from then on.
  `<app data>` is `%APPDATA%\ai.toolbay.bedrock` (Windows), `~/Library/Application Support/ai.toolbay.bedrock`
  (macOS), `~/.config/ai.toolbay.bedrock` (Linux).

## Setup snippets

`<exe>` is the app's executable, e.g. `C:\Users\<you>\AppData\Local\Programs\bedrock\bedrock.exe`
or `/Applications/Bedrock.app/Contents/MacOS/Bedrock`; `<cli>` is its bundled CLI,
`<install dir>\resources\app.asar\dist\cli.js` (macOS: `Bedrock.app/Contents/Resources/app.asar/dist/cli.js`).
The settings page shows these with the real paths filled in, ready to copy.

The stdio server runs the CLI in Node mode (`ELECTRON_RUN_AS_NODE=1`). `<exe> --mcp` also works, but
the Electron binary writes an empty line to stdout before any app code runs, which MCP clients
log as a malformed message; Node mode keeps stdout clean and starts in about 140 ms instead of 400.

**Claude Code**

```
claude mcp add --env ELECTRON_RUN_AS_NODE=1 --scope user bedrock -- "<exe>" "<cli>" mcp
```

**Claude Desktop** (`%APPDATA%\Claude\claude_desktop_config.json`, macOS
`~/Library/Application Support/Claude/claude_desktop_config.json`), **Cursor** (`~/.cursor/mcp.json`),
**Windsurf** (`~/.codeium/windsurf/mcp_config.json`):

```json
{
  "mcpServers": {
    "bedrock": { "command": "<exe>", "args": ["<cli>", "mcp"], "env": { "ELECTRON_RUN_AS_NODE": "1" } }
  }
}
```

**VS Code** (Command Palette › "MCP: Open User Configuration", or `.vscode/mcp.json`):

```json
{ "servers": { "bedrock": { "type": "stdio", "command": "<exe>", "args": ["<cli>", "mcp"], "env": { "ELECTRON_RUN_AS_NODE": "1" } } } }
```

**Any MCP client over HTTP** (while the app is open):

```json
{ "mcpServers": { "bedrock": { "type": "http", "url": "http://127.0.0.1:27125/mcp", "headers": { "Authorization": "Bearer <token>" } } } }
```

```
claude mcp add --transport http bedrock http://127.0.0.1:27125/mcp --header "Authorization: Bearer <token>"
```

**REST:** `curl -H "Authorization: Bearer <token>" "http://127.0.0.1:27125/v1/search?query=meeting"`

## MCP tools

Server name `bedrock`. Every tool returns its result as JSON text; errors come back as
`isError: true` with a plain sentence. Paths are vault-relative; `.md` may be left out and a bare
name ("Plan") resolves the way `[[links]]` do.

| Tool | Does | Main arguments |
|---|---|---|
| `search` | Full-text search with the Search pane's language (`OR`, `-x`, `"phrase"`, `/regex/`, `file:` `path:` `content:` `tag:` `line:()` `block:()` `section:()` `task:` `task-todo:` `task-done:` `match-case:` `ignore-case:` `[prop]` `[prop:value]` `[prop:>5]`) | `query`, `limit`, `folder`, `matchCase` |
| `read_note` | Text, properties, tags, headings | `path` |
| `create_note` | New note (folders made, `.md` added) | `path`, `content`, `overwrite` |
| `edit_note` | `replace` the whole text; `find_replace` (first / `all`, `regex`, `caseSensitive`); `patch_heading` (`replace` / `append` / `prepend` under a heading) | `path`, `mode`, … |
| `append_to_note` | Add to the end, or to the end of a heading's section; creates the note if missing | `path`, `text`, `heading`, `create` |
| `move_note` | Rename/move and update every wikilink, embed, Markdown link and property link to it (aliases and `#heading` parts kept, the vault's link format respected) | `from`, `to`, `updateLinks` |
| `delete_note` | Move to `.trash` | `path` |
| `list_notes` | Notes (or all files) in the vault or a folder | `folder`, `recursive`, `allFiles`, `limit` |
| `list_folder` | Direct sub-folders and files of a folder | `path` |
| `get_backlinks` | Notes linking here, with lines; `unlinked` adds unlinked mentions | `path`, `unlinked` |
| `get_outgoing_links` | Links/embeds in a note and where they resolve | `path` |
| `list_tags` | Tags with counts | `limit` |
| `notes_with_tag` | Notes with a tag (nested tags included) | `tag`, `includeNested` |
| `query_properties` | Filter on frontmatter: `equals`, `not_equals`, `contains`, `exists`, `missing`, `gt`, `gte`, `lt`, `lte`, `range` (numbers and dates); `match: all/any` | `filters`, `match`, `folder`, `limit` |
| `set_property` | Set or (with `null`) remove one property | `path`, `key`, `value` |
| `get_daily_note` | Today's (or a date's) daily note, created from `.obsidian/daily-notes.json` (folder, moment format, template with `{{title}}`, `{{date}}`, `{{time}}`, `{{date:FMT}}`) | `date`, `create`, `append` |
| `get_active_note` | The note open in the app (app must be running) | none |
| `open_note` | Open a note in the app (shows the window) | `path`, `newTab`, `line` |

**Resources:** every note is `bedrock://note/<path>` (URL-encoded segments), `text/markdown`;
`resources/list` lists them.

## The `bedrock` command

Installed with the app on Windows (`<install dir>\bin\bedrock.cmd`, added to your user PATH by the
installer without admin rights; removed on uninstall). On macOS/Linux, Settings › Connect an AI
agent › **Install command line tool** writes a small `bedrock` script into `/usr/local/bin` (if
writable) or `~/.local/bin`, after asking. The app's executable also accepts `--cli <args>` and
`--mcp` directly, without opening a window or touching the running instance.

```
bedrock search <query> [--limit n]
bedrock read <path>
bedrock new <path> [--content <text> | -] [--overwrite]        (- reads stdin)
bedrock append <path> <text | -> [--heading <h>]
bedrock daily [--append <text | ->] [--date YYYY-MM-DD]
bedrock mv <from> <to> [--no-links]
bedrock rm <path>
bedrock ls [folder] [--all]
bedrock tags [tag]
bedrock backlinks <path> [--unlinked]
bedrock links <path>
bedrock props <filter>... [--any]     status=active  priority>=3  tags~work  due<2026-12-01  owner?  !owner
bedrock set <path> <key> <value>      (value is JSON when it parses, else text; null removes)
bedrock open <path>                   (starts the app on the note when it isn't running)
bedrock mcp                           (stdio MCP server)
bedrock tools | bedrock call <tool> [<json> | -]
Options: --json, --vault <folder> (work on another folder), --offline (never talk to the app)
Exit codes: 0 ok, 1 error, 2 unknown command, 3 not found.
```

## REST API

Same operations as the tools, JSON in and out. `GET` endpoints take query parameters; the others a
JSON body with the tool's arguments. `POST /v1/tools/{name}` runs any tool with its MCP arguments.
Errors are `{ "error": "<code>", "message": "<plain sentence>" }` with 400 (bad arguments),
401 (token), 403 (outside the vault, foreign Host/Origin), 404, 405, 409 (already exists),
503 (app window not ready, or a tool that needs the app).

| Method and path | Tool |
|---|---|
| `GET /v1/status`, `GET /v1/tools` | status, tool list with JSON schemas |
| `GET /v1/search?query=` | `search` |
| `GET /v1/notes?folder=&recursive=&allFiles=&limit=` | `list_notes` |
| `GET /v1/note?path=` · `POST /v1/note` · `PATCH /v1/note` · `DELETE /v1/note?path=` | `read_note` · `create_note` · `edit_note` · `delete_note` |
| `POST /v1/note/append` · `POST /v1/note/move` | `append_to_note` · `move_note` |
| `GET /v1/folder?path=` | `list_folder` |
| `GET /v1/backlinks?path=&unlinked=` · `GET /v1/links?path=` | `get_backlinks` · `get_outgoing_links` |
| `GET /v1/tags` · `GET /v1/tags/notes?tag=` | `list_tags` · `notes_with_tag` |
| `POST /v1/properties/query` · `PUT /v1/properties` | `query_properties` · `set_property` |
| `GET /v1/daily?date=` (never creates) · `POST /v1/daily` | `get_daily_note` |
| `GET /v1/active` · `POST /v1/open` | `get_active_note` · `open_note` |
| `POST /v1/tools/{name}` | any tool |
| `POST /mcp` | MCP Streamable HTTP (stateless) |

### OpenAPI

Generated from the code by `node app/scripts/agent-openapi.mjs`; a unit test fails if this copy is
out of date.

<!-- openapi:start -->
```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "Bedrock notes app local API",
    "version": "1",
    "description": "Local REST API of the running Bedrock notes app. Listens on 127.0.0.1 only; every request needs the bearer token from Settings › Connect an AI agent. Requests with a Host other than 127.0.0.1/localhost:<port> or a foreign Origin are refused, and no CORS headers are sent."
  },
  "servers": [
    {
      "url": "http://127.0.0.1:27125",
      "description": "Default port; the real one is shown in Settings › Connect an AI agent."
    }
  ],
  "security": [
    {
      "bearer": []
    }
  ],
  "tags": [
    {
      "name": "read",
      "description": "Read-only"
    },
    {
      "name": "write",
      "description": "Changes notes"
    },
    {
      "name": "mcp",
      "description": "Model Context Protocol"
    }
  ],
  "paths": {
    "/mcp": {
      "post": {
        "operationId": "mcp",
        "summary": "MCP (Streamable HTTP)",
        "description": "Model Context Protocol endpoint, stateless Streamable HTTP. Use an MCP client; send the same bearer token.",
        "tags": [
          "mcp"
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "description": "A JSON-RPC 2.0 message"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "JSON-RPC response."
          },
          "4XX": {
            "$ref": "#/components/responses/Error"
          }
        }
      }
    },
    "/v1/active": {
      "get": {
        "operationId": "getActive",
        "summary": "Active note",
        "description": "The note open and focused in the app right now (path, text, properties). Only works while the app is running.",
        "tags": [
          "read"
        ],
        "responses": {
          "200": {
            "description": "The result as JSON.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "503": {
            "$ref": "#/components/responses/Error"
          },
          "4XX": {
            "$ref": "#/components/responses/Error"
          }
        }
      }
    },
    "/v1/backlinks": {
      "get": {
        "operationId": "getBacklinks",
        "summary": "Backlinks",
        "description": "Notes that link to this note, with the lines that contain the links. Set unlinked to also find notes that mention the note's name without linking it.",
        "tags": [
          "read"
        ],
        "responses": {
          "200": {
            "description": "The result as JSON.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "503": {
            "$ref": "#/components/responses/Error"
          },
          "4XX": {
            "$ref": "#/components/responses/Error"
          }
        },
        "parameters": [
          {
            "name": "path",
            "in": "query",
            "required": true,
            "description": "Vault-relative path like \"Projects/Plan.md\". The \".md\" may be left out, and a bare note name (\"Plan\") is resolved the way [[links]] resolve.",
            "schema": {
              "type": "string",
              "minLength": 1
            }
          },
          {
            "name": "unlinked",
            "in": "query",
            "required": false,
            "description": "Also list unlinked mentions (default false)",
            "schema": {
              "type": "boolean"
            }
          }
        ]
      }
    },
    "/v1/daily": {
      "get": {
        "operationId": "getDaily",
        "summary": "Daily note (read only)",
        "description": "Get the daily note for today (or another date), creating it if it's missing with the vault's Daily notes settings (folder, date format and template from .obsidian/daily-notes.json). Pass append to add a line or block to it in the same call. Returns the note's path and text. This GET form never creates the note; POST does.",
        "tags": [
          "write"
        ],
        "responses": {
          "200": {
            "description": "The result as JSON.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "503": {
            "$ref": "#/components/responses/Error"
          },
          "4XX": {
            "$ref": "#/components/responses/Error"
          }
        },
        "parameters": [
          {
            "name": "date",
            "in": "query",
            "required": false,
            "description": "YYYY-MM-DD, \"today\" (default), \"yesterday\" or \"tomorrow\"",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "append",
            "in": "query",
            "required": false,
            "description": "Text to add to the end of the daily note",
            "schema": {
              "type": "string"
            }
          }
        ]
      },
      "post": {
        "operationId": "postDaily",
        "summary": "Daily note",
        "description": "Get the daily note for today (or another date), creating it if it's missing with the vault's Daily notes settings (folder, date format and template from .obsidian/daily-notes.json). Pass append to add a line or block to it in the same call. Returns the note's path and text.",
        "tags": [
          "write"
        ],
        "responses": {
          "200": {
            "description": "The result as JSON.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "503": {
            "$ref": "#/components/responses/Error"
          },
          "4XX": {
            "$ref": "#/components/responses/Error"
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "date": {
                    "description": "YYYY-MM-DD, \"today\" (default), \"yesterday\" or \"tomorrow\"",
                    "type": "string"
                  },
                  "create": {
                    "description": "Create it if missing (default true)",
                    "type": "boolean"
                  },
                  "append": {
                    "description": "Text to add to the end of the daily note",
                    "type": "string"
                  }
                },
                "additionalProperties": false
              }
            }
          }
        }
      }
    },
    "/v1/folder": {
      "get": {
        "operationId": "getFolder",
        "summary": "List a folder",
        "description": "List the sub-folders and files directly inside one folder of the vault (not recursive). Leave path empty for the vault's top level.",
        "tags": [
          "read"
        ],
        "responses": {
          "200": {
            "description": "The result as JSON.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "503": {
            "$ref": "#/components/responses/Error"
          },
          "4XX": {
            "$ref": "#/components/responses/Error"
          }
        },
        "parameters": [
          {
            "name": "path",
            "in": "query",
            "required": false,
            "description": "Folder path, e.g. \"Projects\" (default: top level)",
            "schema": {
              "type": "string"
            }
          }
        ]
      }
    },
    "/v1/links": {
      "get": {
        "operationId": "getLinks",
        "summary": "Outgoing links",
        "description": "Links and embeds inside this note (including links in properties), each with the note it resolves to, or resolved: false when the target doesn't exist yet.",
        "tags": [
          "read"
        ],
        "responses": {
          "200": {
            "description": "The result as JSON.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "503": {
            "$ref": "#/components/responses/Error"
          },
          "4XX": {
            "$ref": "#/components/responses/Error"
          }
        },
        "parameters": [
          {
            "name": "path",
            "in": "query",
            "required": true,
            "description": "Vault-relative path like \"Projects/Plan.md\". The \".md\" may be left out, and a bare note name (\"Plan\") is resolved the way [[links]] resolve.",
            "schema": {
              "type": "string",
              "minLength": 1
            }
          }
        ]
      }
    },
    "/v1/note": {
      "get": {
        "operationId": "getNote",
        "summary": "Read a note",
        "description": "Read one note: its full Markdown text, its properties (YAML frontmatter) as JSON, its tags and its headings with line numbers. Also reads other text files in the vault.",
        "tags": [
          "read"
        ],
        "responses": {
          "200": {
            "description": "The result as JSON.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "503": {
            "$ref": "#/components/responses/Error"
          },
          "4XX": {
            "$ref": "#/components/responses/Error"
          }
        },
        "parameters": [
          {
            "name": "path",
            "in": "query",
            "required": true,
            "description": "Vault-relative path like \"Projects/Plan.md\". The \".md\" may be left out, and a bare note name (\"Plan\") is resolved the way [[links]] resolve.",
            "schema": {
              "type": "string",
              "minLength": 1
            }
          }
        ]
      },
      "post": {
        "operationId": "postNote",
        "summary": "Create a note",
        "description": "Create a new Markdown note. Folders in the path are created as needed and \".md\" is added when the path has no extension. Fails if the note already exists unless overwrite is true. Use [[Note name]] to link to other notes and #tags for tags; put properties in a YAML block at the top (--- key: value ---) or set them afterwards with set_property.",
        "tags": [
          "write"
        ],
        "responses": {
          "200": {
            "description": "The result as JSON.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "503": {
            "$ref": "#/components/responses/Error"
          },
          "4XX": {
            "$ref": "#/components/responses/Error"
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "path": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Where to create it, e.g. \"Inbox/Idea.md\""
                  },
                  "content": {
                    "description": "The Markdown text (default empty)",
                    "type": "string"
                  },
                  "overwrite": {
                    "description": "Replace the note if it already exists (default false)",
                    "type": "boolean"
                  }
                },
                "required": [
                  "path"
                ],
                "additionalProperties": false
              }
            }
          }
        }
      },
      "patch": {
        "operationId": "patchNote",
        "summary": "Edit a note",
        "description": "Change an existing note in one of three ways (mode): \"replace\" swaps the whole text for `content`; \"find_replace\" replaces `find` with `replace` (first match, or every match with all: true; regex: true treats find as a JavaScript regular expression and allows $1 in replace) and fails without changing anything if `find` is not in the note; \"patch_heading\" rewrites only the section under `heading` (up to the next heading of the same or higher level): position \"replace\" (default), \"append\" or \"prepend\" `content` there. Write the heading text, optionally with its #s (\"## Tasks\").",
        "tags": [
          "write"
        ],
        "responses": {
          "200": {
            "description": "The result as JSON.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "503": {
            "$ref": "#/components/responses/Error"
          },
          "4XX": {
            "$ref": "#/components/responses/Error"
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "path": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Vault-relative path like \"Projects/Plan.md\". The \".md\" may be left out, and a bare note name (\"Plan\") is resolved the way [[links]] resolve."
                  },
                  "mode": {
                    "type": "string",
                    "enum": [
                      "replace",
                      "find_replace",
                      "patch_heading"
                    ],
                    "description": "How to edit"
                  },
                  "content": {
                    "description": "New text (replace and patch_heading)",
                    "type": "string"
                  },
                  "find": {
                    "description": "Text to look for (find_replace)",
                    "type": "string"
                  },
                  "replace": {
                    "description": "Replacement text (find_replace)",
                    "type": "string"
                  },
                  "all": {
                    "description": "Replace every match, not just the first (find_replace)",
                    "type": "boolean"
                  },
                  "regex": {
                    "description": "Treat find as a regular expression (find_replace)",
                    "type": "boolean"
                  },
                  "caseSensitive": {
                    "description": "Match case (find_replace, default true)",
                    "type": "boolean"
                  },
                  "heading": {
                    "description": "Heading whose section to change, e.g. \"Tasks\" or \"## Tasks\" (patch_heading)",
                    "type": "string"
                  },
                  "position": {
                    "description": "Where content goes in the section (patch_heading, default replace)",
                    "type": "string",
                    "enum": [
                      "replace",
                      "append",
                      "prepend"
                    ]
                  }
                },
                "required": [
                  "path",
                  "mode"
                ],
                "additionalProperties": false
              }
            }
          }
        }
      },
      "delete": {
        "operationId": "deleteNote",
        "summary": "Delete a note",
        "description": "Move a note to the vault's .trash folder. Nothing is deleted permanently: the person can restore it from .trash, and from Deleted files in Settings › Sync when sync is on.",
        "tags": [
          "write"
        ],
        "responses": {
          "200": {
            "description": "The result as JSON.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "503": {
            "$ref": "#/components/responses/Error"
          },
          "4XX": {
            "$ref": "#/components/responses/Error"
          }
        },
        "parameters": [
          {
            "name": "path",
            "in": "query",
            "required": true,
            "description": "Vault-relative path like \"Projects/Plan.md\". The \".md\" may be left out, and a bare note name (\"Plan\") is resolved the way [[links]] resolve.",
            "schema": {
              "type": "string",
              "minLength": 1
            }
          }
        ]
      }
    },
    "/v1/note/append": {
      "post": {
        "operationId": "postNoteAppend",
        "summary": "Append to a note",
        "description": "Add text to the end of a note (on a new line), or to the end of the section under `heading`. Creates the note if it doesn't exist yet (unless create is false). Good for logs, inboxes and journals.",
        "tags": [
          "write"
        ],
        "responses": {
          "200": {
            "description": "The result as JSON.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "503": {
            "$ref": "#/components/responses/Error"
          },
          "4XX": {
            "$ref": "#/components/responses/Error"
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "path": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Vault-relative path like \"Projects/Plan.md\". The \".md\" may be left out, and a bare note name (\"Plan\") is resolved the way [[links]] resolve."
                  },
                  "text": {
                    "type": "string",
                    "description": "Markdown to add"
                  },
                  "heading": {
                    "description": "Add at the end of this heading's section instead of the end of the note",
                    "type": "string"
                  },
                  "create": {
                    "description": "Create the note if it's missing (default true)",
                    "type": "boolean"
                  }
                },
                "required": [
                  "path",
                  "text"
                ],
                "additionalProperties": false
              }
            }
          }
        }
      }
    },
    "/v1/note/move": {
      "post": {
        "operationId": "postNoteMove",
        "summary": "Move or rename a note",
        "description": "Rename a note or move it to another folder, and update every [[link]] and Markdown link to it across the vault (like renaming in the app), keeping aliases and #heading parts. If `to` is an existing folder or ends with \"/\", the note keeps its name. Returns how many links were updated in which notes.",
        "tags": [
          "write"
        ],
        "responses": {
          "200": {
            "description": "The result as JSON.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "503": {
            "$ref": "#/components/responses/Error"
          },
          "4XX": {
            "$ref": "#/components/responses/Error"
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "from": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Vault-relative path like \"Projects/Plan.md\". The \".md\" may be left out, and a bare note name (\"Plan\") is resolved the way [[links]] resolve."
                  },
                  "to": {
                    "type": "string",
                    "minLength": 1,
                    "description": "New path, e.g. \"Archive/Plan.md\", or a folder like \"Archive/\""
                  },
                  "updateLinks": {
                    "description": "Update links in other notes (default true)",
                    "type": "boolean"
                  }
                },
                "required": [
                  "from",
                  "to"
                ],
                "additionalProperties": false
              }
            }
          }
        }
      }
    },
    "/v1/notes": {
      "get": {
        "operationId": "getNotes",
        "summary": "List notes",
        "description": "List Markdown notes in the vault (or inside one folder), sorted by path, with modified/created times (ms since 1970) and sizes. Set allFiles to include attachments and other files.",
        "tags": [
          "read"
        ],
        "responses": {
          "200": {
            "description": "The result as JSON.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "503": {
            "$ref": "#/components/responses/Error"
          },
          "4XX": {
            "$ref": "#/components/responses/Error"
          }
        },
        "parameters": [
          {
            "name": "folder",
            "in": "query",
            "required": false,
            "description": "Only this folder (default: the whole vault)",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "recursive",
            "in": "query",
            "required": false,
            "description": "Include sub-folders (default true)",
            "schema": {
              "type": "boolean"
            }
          },
          {
            "name": "allFiles",
            "in": "query",
            "required": false,
            "description": "Include non-Markdown files (default false)",
            "schema": {
              "type": "boolean"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "description": "Most notes to return (default 1000)",
            "schema": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100000
            }
          }
        ]
      }
    },
    "/v1/open": {
      "post": {
        "operationId": "postOpen",
        "summary": "Open a note in the app",
        "description": "Open a note in the app's editor so the person can see it. Only works while the app is running.",
        "tags": [
          "read"
        ],
        "responses": {
          "200": {
            "description": "The result as JSON.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "503": {
            "$ref": "#/components/responses/Error"
          },
          "4XX": {
            "$ref": "#/components/responses/Error"
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "path": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Vault-relative path like \"Projects/Plan.md\". The \".md\" may be left out, and a bare note name (\"Plan\") is resolved the way [[links]] resolve."
                  },
                  "newTab": {
                    "description": "Open in a new tab (default false)",
                    "type": "boolean"
                  },
                  "line": {
                    "description": "Line to scroll to",
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 9007199254740991
                  }
                },
                "required": [
                  "path"
                ],
                "additionalProperties": false
              }
            }
          }
        }
      }
    },
    "/v1/properties": {
      "put": {
        "operationId": "putProperties",
        "summary": "Set a property",
        "description": "Set one property in a note's YAML frontmatter (creating the block if needed) without touching the rest of the note. value can be text, a number, true/false, or a list; null removes the property.",
        "tags": [
          "write"
        ],
        "responses": {
          "200": {
            "description": "The result as JSON.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "503": {
            "$ref": "#/components/responses/Error"
          },
          "4XX": {
            "$ref": "#/components/responses/Error"
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "path": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Vault-relative path like \"Projects/Plan.md\". The \".md\" may be left out, and a bare note name (\"Plan\") is resolved the way [[links]] resolve."
                  },
                  "key": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Property name, e.g. \"status\""
                  },
                  "value": {
                    "anyOf": [
                      {
                        "type": "string"
                      },
                      {
                        "type": "number"
                      },
                      {
                        "type": "boolean"
                      },
                      {
                        "type": "array",
                        "items": {
                          "type": [
                            "string",
                            "number",
                            "boolean"
                          ]
                        }
                      },
                      {
                        "type": "null"
                      }
                    ],
                    "description": "New value, or null to remove it"
                  }
                },
                "required": [
                  "path",
                  "key",
                  "value"
                ],
                "additionalProperties": false
              }
            }
          }
        }
      }
    },
    "/v1/properties/query": {
      "post": {
        "operationId": "postPropertiesQuery",
        "summary": "Query properties",
        "description": "Find notes by their properties (YAML frontmatter). Each filter has a key and an op: equals, not_equals, contains (substring, or an item of a list), exists, missing, gt, gte, lt, lte (numbers or YYYY-MM-DD dates) or range (min and/or max, inclusive). Filters are combined with AND (match: \"any\" for OR). With no filters, returns every note that has properties. Returns each note's path and all its properties.",
        "tags": [
          "read"
        ],
        "responses": {
          "200": {
            "description": "The result as JSON.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "503": {
            "$ref": "#/components/responses/Error"
          },
          "4XX": {
            "$ref": "#/components/responses/Error"
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "filters": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "key": {
                          "type": "string",
                          "minLength": 1,
                          "description": "Property name (case-insensitive)"
                        },
                        "op": {
                          "type": "string",
                          "enum": [
                            "equals",
                            "not_equals",
                            "contains",
                            "exists",
                            "missing",
                            "gt",
                            "gte",
                            "lt",
                            "lte",
                            "range"
                          ]
                        },
                        "value": {
                          "description": "Value to compare with",
                          "type": [
                            "string",
                            "number",
                            "boolean"
                          ]
                        },
                        "min": {
                          "description": "Lower bound (range)",
                          "type": [
                            "string",
                            "number"
                          ]
                        },
                        "max": {
                          "description": "Upper bound (range)",
                          "type": [
                            "string",
                            "number"
                          ]
                        }
                      },
                      "required": [
                        "key",
                        "op"
                      ],
                      "additionalProperties": false
                    }
                  },
                  "match": {
                    "description": "all = every filter must match (default), any = at least one",
                    "type": "string",
                    "enum": [
                      "all",
                      "any"
                    ]
                  },
                  "folder": {
                    "description": "Only notes in this folder",
                    "type": "string"
                  },
                  "limit": {
                    "description": "Most notes to return (default 200)",
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 9007199254740991
                  }
                },
                "additionalProperties": false
              }
            }
          }
        }
      }
    },
    "/v1/search": {
      "get": {
        "operationId": "getSearch",
        "summary": "Search notes",
        "description": "Full-text search across every note in the vault, with the same query language as the app's Search pane. Words are ANDed; use OR, -word to exclude, \"exact phrase\", /regex/, and operators: file:, path:, content:, tag:#x, line:(a b), block:(), section:(), task:, task-todo:, task-done:, match-case:, ignore-case:, and [property] / [property:value] / [property:>5] for frontmatter. Returns matching note paths, best first, with up to 5 matching lines each (1-based line numbers). Use read_note to get a whole note.",
        "tags": [
          "read"
        ],
        "responses": {
          "200": {
            "description": "The result as JSON.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "503": {
            "$ref": "#/components/responses/Error"
          },
          "4XX": {
            "$ref": "#/components/responses/Error"
          }
        },
        "parameters": [
          {
            "name": "query",
            "in": "query",
            "required": true,
            "description": "Search query, e.g. \"meeting tag:#work\", \"path:Projects -draft\", \"[status:active]\"",
            "schema": {
              "type": "string",
              "minLength": 1
            }
          },
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "description": "Most results to return (default 20)",
            "schema": {
              "type": "integer",
              "minimum": 1,
              "maximum": 500
            }
          },
          {
            "name": "folder",
            "in": "query",
            "required": false,
            "description": "Only search inside this folder",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "matchCase",
            "in": "query",
            "required": false,
            "description": "Case-sensitive matching (default false)",
            "schema": {
              "type": "boolean"
            }
          }
        ]
      }
    },
    "/v1/status": {
      "get": {
        "operationId": "getStatus",
        "summary": "Status",
        "description": "Version, the MCP and REST addresses, the vault name and whether the app window is connected.",
        "tags": [
          "read"
        ],
        "responses": {
          "200": {
            "description": "Status.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "4XX": {
            "$ref": "#/components/responses/Error"
          }
        }
      }
    },
    "/v1/tags": {
      "get": {
        "operationId": "getTags",
        "summary": "List tags",
        "description": "Every tag used in the vault (in text and in the tags property) with how many notes use it, most used first.",
        "tags": [
          "read"
        ],
        "responses": {
          "200": {
            "description": "The result as JSON.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "503": {
            "$ref": "#/components/responses/Error"
          },
          "4XX": {
            "$ref": "#/components/responses/Error"
          }
        },
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "description": "Most tags to return",
            "schema": {
              "type": "integer",
              "minimum": 1,
              "maximum": 9007199254740991
            }
          }
        ]
      }
    },
    "/v1/tags/notes": {
      "get": {
        "operationId": "getTagsNotes",
        "summary": "Notes with a tag",
        "description": "Notes that have a tag. \"#project\" also matches nested tags like \"#project/alpha\" unless includeNested is false. Case-insensitive.",
        "tags": [
          "read"
        ],
        "responses": {
          "200": {
            "description": "The result as JSON.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "503": {
            "$ref": "#/components/responses/Error"
          },
          "4XX": {
            "$ref": "#/components/responses/Error"
          }
        },
        "parameters": [
          {
            "name": "tag",
            "in": "query",
            "required": true,
            "description": "The tag, with or without \"#\"",
            "schema": {
              "type": "string",
              "minLength": 1
            }
          },
          {
            "name": "includeNested",
            "in": "query",
            "required": false,
            "description": "Include nested tags (default true)",
            "schema": {
              "type": "boolean"
            }
          }
        ]
      }
    },
    "/v1/tools": {
      "get": {
        "operationId": "listTools",
        "summary": "List tools",
        "description": "Every tool with its description and JSON input schema (the same list the MCP server offers).",
        "tags": [
          "read"
        ],
        "responses": {
          "200": {
            "description": "Tools.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "4XX": {
            "$ref": "#/components/responses/Error"
          }
        }
      }
    },
    "/v1/tools/{name}": {
      "post": {
        "operationId": "runTool",
        "summary": "Run any tool",
        "description": "Run a tool by name with its arguments as the JSON body. Same tools, arguments and results as the MCP server.",
        "tags": [
          "write"
        ],
        "parameters": [
          {
            "name": "name",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "enum": [
                "search",
                "read_note",
                "create_note",
                "edit_note",
                "append_to_note",
                "move_note",
                "delete_note",
                "list_notes",
                "list_folder",
                "get_backlinks",
                "get_outgoing_links",
                "list_tags",
                "notes_with_tag",
                "query_properties",
                "set_property",
                "get_daily_note",
                "get_active_note",
                "open_note"
              ]
            }
          }
        ],
        "requestBody": {
          "required": false,
          "content": {
            "application/json": {
              "schema": {
                "type": "object"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "The result as JSON.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "503": {
            "$ref": "#/components/responses/Error"
          },
          "4XX": {
            "$ref": "#/components/responses/Error"
          }
        }
      }
    }
  },
  "components": {
    "securitySchemes": {
      "bearer": {
        "type": "http",
        "scheme": "bearer",
        "description": "The API token from Settings › Connect an AI agent (starts with bdk_)."
      }
    },
    "schemas": {
      "Error": {
        "type": "object",
        "required": [
          "error",
          "message"
        ],
        "properties": {
          "error": {
            "type": "string",
            "enum": [
              "bad_request",
              "not_found",
              "exists",
              "forbidden",
              "unavailable",
              "unauthorized",
              "forbidden_host",
              "forbidden_origin",
              "method_not_allowed",
              "internal"
            ]
          },
          "message": {
            "type": "string",
            "description": "What happened, in plain words."
          }
        }
      }
    },
    "responses": {
      "Error": {
        "description": "Error (400 bad request, 401 token, 403 outside the vault / host / origin, 404 not found, 409 exists, 503 app not ready).",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/Error"
            }
          }
        }
      }
    }
  }
}
```
<!-- openapi:end -->

## Code and tests

- `app/src/core/agent-ops.ts` – the operations (no Electron), path checks, link rewriting, property
  filters, daily notes, heading patches.
- `app/src/main/agents/` – `tools.ts` (tool list + zod schemas), `mcp.ts` (MCP server, official
  MIT `@modelcontextprotocol/sdk`), `http.ts` (REST + `/mcp`, token, Host/Origin checks),
  `settings.ts` (token, port, discovery files), `clients.ts` (Connect buttons, snippets),
  `host.ts` (Electron side: server lifecycle, bridge to the window, settings IPC), `openapi.ts`.
- `app/src/cli/` – the `bedrock` command and the stdio server; `backend.ts` picks app or folder.
- `app/src/renderer/settings/agents-tab.ts` (Settings › Connect an AI agent) and
  `agents-bridge.ts` (writes through `app.vault` in the main window).
- `app/build-res/installer.nsh` – PATH entry for the CLI (per user, no admin).
- Unit tests: `app/test/unit/agents.test.ts` (every tool against a temp vault, link-updating
  rename, property queries, daily notes, traversal and junction escapes, token, non-local Host and
  Origin, REST, MCP over HTTP with the SDK client, Connect writers on temp files, CLI).
- End to end: `node app/test/e2e/agents-e2e.mjs` (after `npm run build -w app` and
  `npm run build -w server`): two app instances on the real sync server, the SDK client over HTTP,
  the stdio server started like an MCP client starts it (with and without the app), an MCP edit
  arriving on the second computer and in its version history, `--cli`, the settings page and the
  on/off switch. Connect buttons only ever write temp files there (`BEDROCK_CLAUDE_CODE_CONFIG`,
  `BEDROCK_CLAUDE_DESKTOP_CONFIG`, `BEDROCK_CURSOR_CONFIG`, `BEDROCK_CLAUDE_CLI=none`).
  Other test env: `BEDROCK_AGENT_PORT` (0 = any free port), `BEDROCK_AGENTS=0` (off).
