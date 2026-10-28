# Bedrock architecture (the name lives only in brand.json)

A free, open-source rebuild of Obsidian with sync built in. One vault per Toolbay account, synced
automatically. Clean-room: we never copy Obsidian's code, CSS, icons, fonts, sounds or wording.
We DO match its public interfaces so existing vaults, themes, CSS snippets and community plugins work:
- the plugin API, typed by the MIT `obsidian` npm package (`obsidian.d.ts`) — our implementation is our own;
- the documented CSS variables and DOM class names themes target (`--background-primary`,
  `.workspace-leaf`, `.nav-file-title`, `.markdown-preview-view`, `.cm-*` ...);
- the vault format: plain `.md`, `[[wikilinks]]`, `![[embeds]]`, YAML frontmatter, `.canvas`
  (JSON Canvas, open spec), `.obsidian/` config files (app.json, appearance.json, hotkeys.json,
  core-plugins.json, community-plugins.json, workspace.json, bookmarks.json, plugins/<id>/, themes/, snippets/).

## Repo layout (monorepo, npm workspaces)

```
app/                    Electron app (the product)
  src/main/             main process: windows, single instance, hub contract, keychain, sync host
  src/preload/          preload (exposes the small native bridge; renderer runs with nodeIntegration
                        like Obsidian so community plugins can `require('fs')`/`require('electron')`)
  src/renderer/         the UI, vanilla TypeScript + DOM (no React: plugins manipulate the DOM directly)
    api/                `obsidian` module implementation (App, Plugin, Vault, Workspace, MetadataCache,
                        Modal, Setting, Notice, ItemView, MarkdownRenderer, Editor, requestUrl, ...)
    dom/                DOM helpers (createEl/createDiv/addClass/setIcon/... on HTMLElement prototype)
    editor/             CodeMirror 6: live preview, source mode, reading view renderer
    views/              file explorer, search, backlinks, outgoing links, tags, outline, graph, canvas,
                        bookmarks, properties, daily notes, templates, command palette, quick switcher
    settings/           settings modal + tabs
    theme/              our CSS (default theme written from scratch on the public variable names)
    sync-ui/            sync status bar item, version history modal, recycle bin, conflict notices
  test/
packages/sync/          sync engine (pure TS, no Electron): crypto, chunker, local state, watcher,
                        three-way merge, conflict copies, offline queue. Runs in the main process.
server/                 sync storage service (Node, deployed on Railway): metadata in SQLite (node:sqlite,
                        on a volume), blobs in S3-compatible storage (Cloudflare R2) or local disk.
toolbay.json brand.json docs/
```

## Sync design (summary; full detail in docs/SYNC.md)

Identity: the hub's Toolbay sign-in (`TOOLBAY_TOKEN` env from the hub, or keychain `ai.toolbay.desktop`/`session`).
The sync service verifies a bearer token by calling `GET https://toolbay.ai/api/v1/me` (cached 5 min),
which returns `{user:{id,...}}`. One vault per user id. No vault picker.

Encryption (end to end; storage never sees plaintext or file names):
- Sync is off until the person turns it on (Settings › Sync).
- Vault key K (32 random bytes) is created by the first device that turns sync on. The account only holds K
  wrapped with the person's sync passphrase (scrypt N=2^17,r=8,p=1 + AES-256-GCM; item `vault-key-wrapped` of
  `PUT toolbay.ai/api/v1/me/tools/<slug>/sync`). Toolbay can't open it; a forgotten passphrase can't be
  recovered (local files are untouched). Each device keeps the opened K in the OS keychain (service
  `ai.toolbay.<slug>`, account `vault-key-2`). 0.1.2 and older stored K unprotected (item `vault-key`); 0.1.3
  deletes it and rotates to a new key when sync is turned back on (docs/SYNC.md, "Upgrade from 0.1.2").
- Subkeys via HKDF-SHA256: K_meta (file metadata), K_chunk (chunk contents), K_id (chunk ids).
- Chunk id = HMAC-SHA256(K_id, plaintext chunk) hex (dedup inside the vault, reveals nothing across vaults).
- Chunk blob = AES-256-GCM(K_chunk, random 12-byte nonce, chunk) => nonce||ciphertext||tag.
- File metadata `{path, size, mtime, ctime, hash, kind}` encrypted the same way with K_meta.

Server data model (all opaque to the server except ids, sizes, sequence numbers, timestamps):
- vault(user_id PK, vault_id, created_at, used_bytes, quota_bytes, seq)
- file(vault_id, file_id (random uuid chosen by client, stable through renames), version, seq,
       meta (enc blob, base64), chunks (json array of chunk ids), size, deleted, device_id, created_at)
  current row = highest version. All versions kept (history), pruned after retention.
- chunk(vault_id, chunk_id, size, refcount/last_used) ; blob at `<vault_id>/<chunk_id>` in the bucket.

Protocol (HTTPS JSON + one websocket, all with `Authorization: Bearer <token>`):
- `GET  /v1/vault` -> {vaultId, seq, usedBytes, quotaBytes, retentionDays}   (creates on first call)
- `POST /v1/chunks/check` {ids[]} -> {missing[]}
- `PUT  /v1/chunks/:id` (body = encrypted bytes, max 8 MB)  or presigned R2 URL via `POST /v1/chunks/upload-urls`
- `GET  /v1/chunks/:id` -> bytes (or 302 to a presigned URL)
- `POST /v1/files/:fileId/commit` {baseVersion, meta, chunks[], size, deleted, deviceId}
     -> 200 {version, seq} | 409 {current:{version, meta, chunks, size, deleted, seq}}  (optimistic concurrency)
- `GET  /v1/changes?since=<seq>&limit=1000` -> {changes:[{fileId, version, seq, meta, chunks, size, deleted}], seq, more}
- `GET  /v1/files/:fileId/versions` -> [{version, seq, meta, size, deleted, createdAt, deviceId}]
- `GET  /v1/files/:fileId/versions/:v` -> one version (to restore: commit it again as a new version)
- `GET  /v1/trash` -> files whose current version is deleted (recycle bin), restorable
- `WS   /v1/live` -> server pushes `{type:"seq", seq}` whenever the vault's seq moves; client pulls /changes.
  Client falls back to polling /changes every 30 s if the socket is down.

Client algorithm (packages/sync):
- Local state DB (in app data, not in the vault): per path -> {fileId, version (last synced), hash, mtime, size}
  plus a copy of the last-synced text of markdown files (merge base), and `lastSeq`.
- Push: watcher (and a full scan on start) finds files whose hash differs from state -> chunk (fixed 4 MB;
  markdown is one chunk) -> encrypt -> upload missing chunks -> commit with baseVersion = state.version.
  On 409: pull the server version and resolve, then commit again.
- Pull: /changes since lastSeq -> for each change not from us: download chunks, decrypt, then
  - local unchanged since last sync -> overwrite (atomic write via temp file + rename);
  - local changed too -> resolve conflict.
- Conflicts: markdown/text -> three-way merge (base = last-synced text, ours, theirs; diff3 by line).
  Clean merge -> write and commit. Overlapping hunks -> keep ours in place and write theirs as
  `<name> (conflict <device> <YYYY-MM-DD HHmm>).md`, plus a Notice. Binary/other -> keep both copies the same way.
  `.obsidian/*.json` settings -> JSON key-level merge, newer wins per key.
- Renames/moves: same fileId, new path in meta (detected by watcher rename events, or by delete+create with an
  identical hash inside a short window). Folders are implicit (created from file paths; empty folders synced as
  `kind:"folder"` entries).
- Deletes: commit `deleted:true` (tombstone). The recycle bin lists them; restore = commit the previous version.
- Offline: everything queues in the state DB; on reconnect, pull first, then push (merge as above).
- Ignore: `.obsidian/workspace*.json`, `.trash/`, `.DS_Store`, `Thumbs.db`, temp files. Device-specific files never sync.
- Quota: default 10 GB per vault, max file 1 GB (chunked), history kept 90 days (configurable on the server).

## Hub contract (same as every Toolbay tool, see code/toolbay-flow/AGENTS.md)
toolbay.json with each release; `--from-toolbay --show --hide --quit`; single instance; `running.json`
{pid, visible, window, updatedAt} in the app data dir rewritten on every show/hide (`--hide` minimizes); no tray, no login item, last window closed = quit; `TOOLBAY_TOKEN`
memory only; per-user NSIS install (`/S`), DMG on Mac; self-update from GitHub releases; no telemetry.
