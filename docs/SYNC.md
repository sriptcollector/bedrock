# Bedrock sync

How Bedrock keeps one vault per Toolbay account the same on every computer, with no setup.
This file records every decision, in plain words. `docs/ARCHITECTURE.md` has the short version;
where this file differs, this file wins (the "Changes from ARCHITECTURE.md" section lists each one).

Code: `packages/sync/` (the engine the app runs in its main process) and `server/` (the
`bedrock-sync` service on Railway, blobs on Cloudflare R2).

---

## 1. The idea in five lines

1. Every file is split into chunks, each chunk is encrypted on the computer, and only encrypted
   chunks and encrypted file details ever leave it.
2. The server stores, per file, a list of versions. Each new version must say which version it was
   based on; if someone else got there first, the server says "409, here is the newer one".
3. Every change bumps a counter (`seq`) for the vault. Devices ask "what changed since seq N?"
   and the server also pings them over a websocket the moment the counter moves.
4. When the same note was changed on two computers, Bedrock merges the two edits line by line.
   If both changed the same lines, your copy stays in place and the other one is saved next to it
   as `Note (conflict Laptop 2026-10-21 0905).md`. Nothing is ever silently thrown away.
5. Deleted files go to a recycle bin on the server and old versions are kept 90 days.

---

## 2. Identity and keys

**Who you are.** The app passes the Toolbay sign-in token (`tb_live_...`) as `Authorization: Bearer`.
The server asks `GET {TOOLBAY_API}/api/v1/me` who that is and gets `{user:{id}}`. Answers are
cached: 5 minutes when the token is good, 30 seconds when it is not. If toolbay.ai cannot be
reached, the server answers 503 (the app shows "offline" and retries) and caches nothing, so a
toolbay.ai hiccup never looks like "you were signed out". One vault per user id, created on the
first request. No vault picker.

**The vault key.** 32 random bytes, made by the first computer that syncs. It is stored in the
Toolbay account through the tool settings sync API (`PUT /api/v1/me/tools/bedrock/sync`, item
`vault-key`) and cached on each computer in the OS keychain (service `ai.toolbay.bedrock`,
account `vault-key`). People never see or type it.

- The app calls `obtainVaultKey({ toolbayApi, token, keychain })`. It asks the account first
  (so a stale keychain entry is corrected), falls back to the keychain when offline, and creates
  a key only when the account has none.
- **Race:** two brand-new computers can both see "no key" and both make one. Both write it with
  `baseVersion: 0`; the account accepts only the first, the second gets the first key back under
  `conflicts` and uses it. Nothing was encrypted with the losing key, because syncing starts only
  after `obtainVaultKey` returns. (Tested with three computers at once.)
- **Wrong key guard (new):** the server keeps a public fingerprint of the key (`keyCheck`, an
  HMAC that reveals nothing about the key). The first computer sets it; any computer whose key
  does not match is stopped before it uploads anything, with the message "This computer's vault
  key does not match your Toolbay account's vault. Sign out and back in to Toolbay to fetch the
  right key." Without this, one computer with a wrong key would upload files nobody else can read.
- **Honest caveat for the website / FAQ:** whoever controls the Toolbay account can get the key.
  The sync server and the storage bucket alone cannot read anything: no file contents, no file
  names, no folder names.

**Encryption.** From the vault key K, HKDF-SHA256 (salt `bedrock-vault-v1`) makes three subkeys:
`meta` (file details), `chunk` (file contents), `chunk-id` (naming chunks), plus the key check.

- Chunk id = HMAC-SHA256(K_chunk-id, plaintext chunk), hex. The same content inside one vault
  gets the same id (so it is stored once); the id says nothing about the content and differs
  between vaults.
- Chunk blob = AES-256-GCM: `nonce(12) || ciphertext || tag(16)`, with the chunk id as
  "associated data". After decrypting, the client recomputes the id and refuses a chunk that does
  not match. So the server cannot swap, truncate or alter chunks without being caught.
- File details `{path, kind, size, mtime, ctime, hash, device}` are encrypted the same way with
  the file id as associated data (the server cannot move details from one file to another).
  `hash` is the SHA-256 of the whole file and is checked after every download.

---

## 3. What the server stores

All of it is opaque except ids, sizes, counters and times.

| Table | Columns | Notes |
|---|---|---|
| `vaults` | user_id, vault_id, created_at, used_bytes, quota_bytes, seq, key_check | one row per Toolbay user |
| `versions` | vault_id, file_id, version, seq, meta (encrypted), chunks (JSON ids), size, deleted, device_id, created_at | every version of every file (history) |
| `heads` | vault_id, file_id, version, seq, deleted | current version of each file; index on (vault_id, seq) for the changes feed |
| `version_chunks` | vault_id, chunk_id, file_id, version | which versions use which chunk (for garbage collection) |
| `chunks` | vault_id, chunk_id, size, created_at, touched_at | one row per stored blob; `touched_at` protects in-flight uploads from GC |

SQLite (`node:sqlite`, WAL mode) in `DATA_DIR/bedrock-sync.sqlite` on the Railway volume. Blobs
at `<vault_id>/<chunk_id>` in R2, or under `DATA_DIR/blobs/` with the disk backend.

`file_id` is a random UUID chosen by the client and stays the same through renames and moves,
so history follows the file.

**Usage and quota** count the encrypted bytes of every stored chunk, including history and the
recycle bin, because that is what costs money. Defaults: 10 GB per vault, 1 GB max per file,
90 days of history.

---

## 4. Protocol

All HTTPS + JSON, header `Authorization: Bearer <Toolbay token>`. Errors are
`{error, message}` where `message` is a sentence fit to show the user.

| Call | What it does |
|---|---|
| `GET /healthz` | `{ok:true}` (no auth) |
| `GET /v1/vault` | `{vaultId, seq, usedBytes, quotaBytes, retentionDays, maxFileBytes, keyCheck, direct, directThreshold}`; creates the vault on first call |
| `POST /v1/vault/key-check {keyCheck}` | sets the key fingerprint if none is set; returns the stored one |
| `POST /v1/chunks/check {ids[]}` | `{missing[]}`; also marks the present ones as "recently used" so GC leaves them alone |
| `POST /v1/chunks/batch` | many small chunks in one request (binary frames: 64-byte id, 4-byte length, bytes); max 16 MB |
| `PUT /v1/chunks/:id` | one chunk (max 8 MB) |
| `POST /v1/chunks/upload-urls {chunks:[{id,size}]}` | R2 only: presigned PUT URLs (size is signed) for chunks of 1 MB and up |
| `POST /v1/chunks/confirm {ids}` | after a direct upload: server checks the object exists and records it |
| `GET /v1/chunks/:id` | the chunk, or a 302 to a presigned R2 URL for big chunks |
| `POST /v1/chunks/fetch {ids[]}` | many small chunks in one response (same frames), up to 32 MB per response |
| `POST /v1/commit {commits:[...]}` | up to 1000 commits in one transaction; per item `{ok, version, seq}` or `{ok:false, status:409, current}` or `{status:400, missing}` |
| `POST /v1/files/:fileId/commit {baseVersion, meta, chunks, size, deleted, deviceId}` | single commit: 200 `{version, seq}` or 409 `{current}` |
| `GET /v1/changes?since=<seq>&limit=1000` | current version of every file changed after `since`, oldest first: `{changes, seq, more}` |
| `GET /v1/files/:fileId/versions` | history, newest first |
| `GET /v1/files/:fileId/versions/:v` | one version (to restore, commit it again as a new version) |
| `GET /v1/trash` | files whose current version is a deletion, with the last restorable version |
| `POST /v1/trash/empty {fileIds?}` | permanently removes the history of deleted files and frees the space |
| `WS /v1/live` | server sends `{type:"seq", seq}` on connect and whenever the vault changes, and `{type:"ping"}` every 25 s |

**Websocket sign-in:** the token goes in `Sec-WebSocket-Protocol` as two values:
`bedrock.v1, bearer.<base64url(token)>`. The server answers with `bedrock.v1`. We chose this over
`?token=` because URLs end up in proxy and server logs; protocol headers do not. The server checks
the token again every 5 minutes and closes the socket (code 4401) if it stopped working.
The server also sends ws ping frames; the client treats 70 s of silence as a dead connection.

**Limits:** 30 requests/s per user with bursts of 300 (429 + `Retry-After`; the client waits and
retries), 10/s per IP for requests that fail sign-in, 8 MB per JSON body, 8 MB per chunk, 20 live
sockets per user.

---

## 5. The client engine (`packages/sync`)

```ts
import { SyncEngine, obtainVaultKey, TOOL_SLUG, KEYCHAIN_SERVICE } from '@bedrock/sync';

const key = await obtainVaultKey({ toolbayApi: 'https://toolbay.ai', token, keychain }); // keychain = {get, set} on the OS keychain
const engine = new SyncEngine({
  vaultPath, stateDir,              // stateDir in app data, NOT inside the vault
  serverUrl: 'https://sync.toolbay.ai',
  getToken: async () => currentToken ?? null,
  getVaultKey: async () => key,
  deviceId, deviceName,             // deviceName shows up in conflict copy names
  // optional: fetch, WebSocket (null disables live), watch, pollMs, fullScanMs, debounceMs, ignore, log
});
engine.on('status', (s) => ...);    // {state, message, pendingUploads, pendingDownloads, lastSyncedAt, errorKind}
engine.on('conflict', ({ path, conflictPath }) => ...);
engine.on('file', ({ path, action }) => ...);  // download | upload | delete | rename | merge | kept
engine.on('error', ({ path, message }) => ...); // a single file could not be synced (retried later)
await engine.start(); await engine.syncNow(); await engine.stop();
await engine.listVersions(path); await engine.restoreVersion(path, version);
await engine.listTrash(); await engine.restoreFromTrash(fileId); await engine.emptyTrash();
await engine.usage();               // {usedBytes, quotaBytes, retentionDays}
engine.notifyRename(from, to);      // optional hint when the app itself renames a file
```

`state` is one of `off`, `connecting`, `syncing`, `synced`, `offline`, `error`. `message` is
always a plain sentence for the status bar, for example "Offline. Changes are saved on this
computer and will sync when the connection is back." or "Your Toolbay sign-in has expired. Sign in
to Toolbay again to keep syncing." `errorKind` tells the app which one it is: `network` (offline),
`auth` (sign in again), `quota` (vault full), `key` (wrong vault key), `server`/`client` (other).

The package exports TypeScript source (`"exports": "./src/index.ts"`); the app's esbuild bundles
it. It uses only Node built-ins (`node:crypto`, `node:fs`, global `fetch` and `WebSocket`), no
native modules and no Electron APIs.

### 5.1 Local state

One JSON file, `stateDir/sync-state.json`, written atomically (temp file + rename) after each
batch, never per file. 10k files is about 3 MB and saves in about 40 ms. If the file is ever
damaged the engine starts fresh; files are then matched to the server by content, so nothing is
lost or duplicated.

For each file it remembers two things side by side:

- **what the server has** as of the last sync: version, path, content hash, deleted flag, chunk
  ids, size, and which device wrote it;
- **what is on this computer**: path, content hash, deleted flag, and the size, modification time
  and inode seen when that hash was computed (so unchanged files are never re-read).

A local change is simply "the two sides differ". That makes every decision below a comparison
of three things: last synced, here, and the server's new version.

### 5.2 One sync cycle

1. **Scan** the folder (full scan on start, every 10 minutes and on `syncNow`; otherwise only
   the paths the watcher reported). Unchanged size + mtime + inode means unchanged; otherwise
   hash it. A file that disappeared and a new file with the same content are a **rename/move**
   (same file id, so history follows). A new file with the same inode in the same folder or
   with the same name counts as a rename even if it was also edited.
2. **Pull** `GET /v1/changes?since=lastSeq` (all pages), decrypt, apply (rules in 5.3).
3. **Push** what differs: deletions first, then renames, then contents, small files first. Small
   files go in batches (one "which chunks do you have?" call, one upload of all missing chunks,
   one commit of up to 500 files). Big files go chunk by chunk, 4 at a time.
4. If any commit got a 409, pull again and push again (up to 6 rounds).

Triggers: the folder watcher (after 1.5 s of quiet, at most every 10 s while typing), a websocket
`seq` message, a 30 s poll when the websocket is down, and `syncNow()`.

Failures: no network → `offline`, retry after 2, 4, 8 … up to 60 s. 401 → `error` with the
sign-in message, retry every 30 s (each retry calls `getToken()` again, so a refreshed token
recovers by itself). Vault full → `error` with the server's message, retry every 5 min, and the
files that do fit still sync. Restarting the app in the middle of an upload resumes it: the
server already has the chunks that made it, `chunks/check` skips them.

### 5.3 Applying a change from the server

Let "here changed" mean the local side differs from the last synced side.

| Server says | Here | Result |
|---|---|---|
| new file | nothing at that path | download it |
| new file | a not-yet-synced file there with the **same content** | adopt it (no duplicate) |
| new file | a not-yet-synced file there with different content | yours is renamed to `name (conflict <this device> <date>)`, the server's goes in place |
| new file | another synced file at the same path (only possible case-insensitively, see 5.6) | the file with the larger file id gets the conflict name; every device picks the same one |
| edited | unchanged here | overwrite (atomic: temp file in the same folder, check hash, rename over) |
| edited | edited here, text | three-way merge with the last synced version as base (fetched from the server's history). Clean → write the merge and upload it. Overlapping → keep yours in place, save theirs as `name (conflict <their device> <date>).ext` |
| edited | edited here, binary or > 4 MB | keep yours, save theirs as a conflict copy |
| edited | deleted here | **the edit wins**: the file comes back |
| renamed | unchanged or edited here | file moves to the new path; your edits stay and are uploaded |
| renamed | renamed here too | the server's path wins |
| deleted | unchanged here | delete locally |
| deleted | edited or renamed here | **the edit wins**: kept, and uploaded again as a new version |

**Before overwriting anything** the engine re-checks the file on disk. If it changed since the
scan (someone is typing), that change is not applied now; the next cycle sees the local edit and
merges instead. Tested by editing a note in the middle of its download.

**Swaps and cycles** (a→b while b→a in one batch): files moving onto a path that another moving
file still holds first step aside to `.bedrock-move-<id>` in the vault root, then everyone moves
to their final place. If the app dies in between, the next start puts those files back.

**Folders.** Folders are implied by file paths. Only *empty* folders are synced, as `kind:"folder"`
entries, so an empty folder you create shows up everywhere. Folders emptied by a sync are removed
unless they are such an entry.

### 5.4 Merging

- Line-based three-way merge (diff3) written from scratch in `src/diff3.ts` (Myers diff, no
  dependency). Edits to different lines merge. Edits to the same or touching lines conflict (like
  git).
- **Both sides added lines at the same spot** (two computers appending to the same daily note):
  both are kept, this computer's lines first. Losing neither line is what people expect from notes.
- **CRLF vs LF:** lines are compared without line endings, so a note saved with Windows line
  endings on one computer and Unix ones on another still merges. The result uses the local file's
  style. A byte-order mark is kept if the local file had one.
- **`.obsidian/*.json` and plugin `data.json`:** merged key by key; a key changed on both sides
  takes the newer file's value.
- Text means: md, canvas, txt, css, json, csv, html, svg, yaml, and similar, up to 4 MB, valid UTF-8.
- If the merge base is gone (history pruned after 90 days offline), it is a conflict copy.

### 5.5 What is not synced

`.obsidian/workspace.json` and `.obsidian/workspace-*.json` (window layout, per computer),
`.obsidian/cache`, `.trash/` (Obsidian's local bin; Bedrock has a server recycle bin), `.git/`,
`.DS_Store`, `Thumbs.db`, `desktop.ini`, `$RECYCLE.BIN`, Office/LibreOffice/Emacs/Vim lock and
swap files, `*.tmp`, `*.part`, `*.crdownload`, `*~`, our own `.bedrock-*` temp files, the state
folder if someone puts it inside the vault, symlinks. `.obsidian/workspaces.json` (saved layouts)
**does** sync. The app can add patterns via `ignore`. Files over 1 GB are skipped with a message.

### 5.6 Names that work everywhere

- Paths are compared **case-insensitively and Unicode-normalized on every platform**, so
  `Readme.md` and `README.md` can never both exist in a synced vault. If two computers create
  them (possible on Linux), the larger file id is renamed to a conflict name on every device.
  Applying this rule even on Linux keeps all devices identical.
- Paths in metadata are NFC (macOS sometimes reports names in NFD).
- Remote names that Windows cannot create (`: ? * " < > |`, trailing dots or spaces, `CON`, `NUL`,
  …) are written with `_` instead, on every OS, and the rename is synced, so all devices agree.
  `..` and absolute paths are stripped (a damaged or hostile name can never escape the vault).

---

## 6. Server jobs

**Retention** (every 6 hours, and 1 minute after start): delete versions older than
`RETENTION_DAYS` (default 90), never a file's current version. A deleted file stays restorable
from the recycle bin until its last real version is older than 90 days; the deletion record itself
is kept forever (it is tiny) so a computer that was off for months still learns the file is gone.

**Garbage collection** (same job): delete chunks that no remaining version uses and that nobody
uploaded or asked about in the last `GC_GRACE_HOURS` (default 24). The grace period protects a
computer that uploaded chunks but has not committed the file yet. If GC ever wins that race anyway,
the commit is refused with "missing chunks" and the computer uploads them again, so it is safe.
While a blob is being deleted, an upload of the same chunk waits (503, retry).

**Empty recycle bin** (`POST /v1/trash/empty`): drops the old versions of deleted files right
away and frees their space. This is the answer to "my vault is full".

The service is meant to run as **one instance** (SQLite on one volume). One small instance
handles thousands of users; see costs below. Scaling past that means moving metadata to Postgres,
which the code keeps behind one `Db` class.

---

## 7. Changes from ARCHITECTURE.md (and why)

1. **Merge base comes from the server, not a local copy.** ARCHITECTURE said the client keeps a
   copy of the last synced text of every note. Instead the base is fetched from the server's
   history (`GET /v1/files/:id/versions/:v`) only when a merge is needed. That avoids a second copy
   of every note on disk; merges need the network anyway. Cost: after 90 days offline with edits on
   both sides, you get a conflict copy instead of a merge.
2. **Batch endpoints added:** `/v1/chunks/batch`, `/v1/chunks/fetch` and `/v1/commit` (many
   commits). With one request per note, a 10k-note vault took minutes; now it is about 60 requests.
3. **Key check** on the vault (see section 2), so a wrong key cannot pollute the vault.
4. **Chunk confirm** step for direct-to-R2 uploads (the server must learn the size for quota and GC).
5. **Empty recycle bin** endpoint, because quota counts history and deleted files.
6. **Ignore list:** `workspace*.json` became `workspace.json` + `workspace-*.json`, because
   `workspaces.json` holds saved layouts people want everywhere.
7. **Same-path collisions** (case-insensitive) get a deterministic winner by file id, so all
   devices converge without talking to each other.
8. **Remote delete vs local rename:** the rename counts as a change, so the file is kept (the
   architecture only said "edit wins").
9. **Same new file on two computers with identical content** is adopted, not duplicated (daily
   notes made from the same template on two computers).
10. **Insert/insert at the same spot merges** (both kept) instead of conflicting.
11. **Chunking:** fixed 4 MB for everything (so notes up to 4 MB are one chunk). Bigger text files
    are chunked too and never merged (conflict copy instead).
12. **Websocket auth** via `Sec-WebSocket-Protocol` (not `?token=`).
13. **Debounce:** watcher waits for 1.5 s of quiet (max 10 s) before syncing, to avoid a new
    version every keystroke-save while someone types.
14. Rename detection also uses the file's **inode**, which catches "renamed and edited before the
    next scan" and swaps of two files that have the same size and timestamp.

Known limits: a file renamed **and** edited while the app was closed, to a different name and a
different folder, shows up as delete + new file (no history link; no data lost). Downloads of
big files restart from the beginning if interrupted (uploads resume per chunk). Symlinks are not
synced. Two server instances cannot share one SQLite volume.

---

## 8. Tests and measured numbers

Run in each package: `npx vitest run` (fast set, about 45 s for `packages/sync`, 1 s for
`server`). `npm run test:long -w packages/sync` (= `vitest run --mode long`) adds the 10k-note
vault, the 300 MB file and 30-round storms. Environment knobs: `BEDROCK_SCALE_NOTES`,
`BEDROCK_STORM_SEED`.

Measured on Orion's Windows 11 PC (Node 24.14, temp folders, server in the same process):

RESULTS_PLACEHOLDER

---

## 9. Hosting cost

Prices checked 2026-10-21 on Cloudflare's R2 pricing page and Railway's pricing page:

- **R2 Standard:** storage $0.015 per GB-month; Class A (PutObject, ListObjects) $4.50 per
  million; Class B (GetObject, HeadObject) $0.36 per million; DeleteObject free; **egress free**.
  Free each month: 10 GB-month, 1 M Class A, 10 M Class B.
- **Railway:** Hobby $5/month incl. $5 usage, Pro $20/month incl. $20 usage; memory about
  $10/GB-month, CPU about $20/vCPU-month, volume $0.15/GB-month, egress $0.05/GB.

Assumptions:

- **Typical user:** 200 MB vault, 50 MB of changed files per month, 2 computers. Stored with
  90 days of history ≈ 0.35 GB. About 15,000 chunk uploads per month (notes average a few KB and
  each save while typing becomes a version; the 1.5 s / 10 s debounce keeps this down) and the same
  number of chunk downloads by the other computer. Small chunks pass through the API server
  (Railway egress ≈ 0.05 GB/month); chunks of 1 MB and more go straight to and from R2.
- **Heavy user:** 5 GB vault (mostly attachments), 1 GB changed per month, 3 computers. Stored
  ≈ 8 GB with history. ≈ 50,000 uploads and 100,000 downloads per month. Railway egress ≈ 0.4 GB.

Per user, per month, before free tiers:

| | R2 storage | R2 Class A | R2 Class B | Railway egress | Total |
|---|---|---|---|---|---|
| Typical | 0.35 GB → $0.005 | 15k → $0.068 | 15k → $0.005 | $0.003 | **≈ $0.08** |
| Heavy | 8 GB → $0.12 | 50k → $0.23 | 100k → $0.036 | $0.02 | **≈ $0.40** |

Totals per month (90% typical, 10% heavy, after R2 free tier; the API service sized as noted):

| Users | R2 storage | R2 Class A | R2 Class B | Railway API service | **Total / month** | Per user |
|---|---|---|---|---|---|---|
| 100 | 112 GB → $1.52 | 1.85 M → $3.83 | 2.35 M → $0 (free) | Hobby, fits in the $5 credit: $5 | **≈ $10** | $0.10 |
| 1,000 | 1.1 TB → $16.6 | 18.5 M → $78.8 | 23.5 M → $4.9 | Pro: $20 + ~1 GB RAM, 0.5 vCPU, 20 GB volume, 85 GB egress ≈ $35 | **≈ $135** | $0.14 |
| 10,000 | 11.2 TB → $167 | 185 M → $828 | 235 M → $81 | Pro: ~4 GB RAM, 2 vCPU, 200 GB volume, 850 GB egress ≈ $170 | **≈ $1,250** | $0.13 |

Reading the table: **Class A operations (one per uploaded chunk) are two thirds of the bill**,
not storage. The cheapest future improvement is to pack many small note chunks into one R2 object
(or keep chunks under ~64 KB in SQLite on the volume): that would cut Class A by 10 to 50 times and
bring the typical user to about $0.02/month. Not done yet because it complicates garbage collection.
The Railway numbers are estimates (Node idles at ~100 MB RAM and a few % of a CPU; SQLite metadata
is roughly 20 MB per typical user with 90 days of history).

---

## 10. What Orion needs to set up

Nothing below was created by the agent; no accounts, buckets, keys or DNS records exist yet.

**Cloudflare R2**

1. In the Cloudflare dashboard → R2 → Create bucket: name **`bedrock-vaults`**, location
   automatic, storage class Standard. Leave public access **off** (no r2.dev URL, no custom domain;
   all access is signed).
2. R2 → Manage API tokens → Create **Account API token** (or User API token) with permission
   **Object Read & Write**, scoped to **only the `bedrock-vaults` bucket**, no expiry (or a long
   one you rotate). Copy the **Access Key ID** and **Secret Access Key** (shown once) and the
   **S3 endpoint** `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
3. Bucket → Settings → CORS: not needed (the desktop app is not a browser).
4. Optional: a lifecycle rule "abort incomplete multipart uploads after 1 day" (we do not use
   multipart, harmless).

**Railway**

1. New project → service **`bedrock-sync`** from the GitHub repo (`sriptcollector/bedrock`).
   Settings → Root directory: repo root (`/`). Config-as-code file: **`server/railway.json`**
   (it points the builder at `server/Dockerfile`).
2. Add a **volume** mounted at **`/data`** (start with 5 GB; grows later).
3. Variables:

   | Variable | Value |
   |---|---|
   | `DATA_DIR` | `/data` |
   | `TOOLBAY_API` | `https://toolbay.ai` |
   | `S3_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
   | `S3_BUCKET` | `bedrock-vaults` |
   | `S3_ACCESS_KEY_ID` | from step R2.2 |
   | `S3_SECRET_ACCESS_KEY` | from step R2.2 |
   | `S3_REGION` | `auto` |
   | `RETENTION_DAYS` | `90` (optional) |
   | `QUOTA_BYTES` | `10737418240` (optional, 10 GB) |

   Do **not** set `DEV_AUTH` in production. `PORT` is provided by Railway.
4. Keep **1 replica** (SQLite on a volume). Health check path `/healthz` is in `railway.json`.

**Domain**

1. Railway service → Settings → Networking → Custom domain: **`sync.toolbay.ai`**. Railway shows
   a CNAME target (and a TXT record for verification).
2. In Cloudflare DNS for toolbay.ai: add `CNAME sync → <target from Railway>`, **DNS only (grey
   cloud)** at first so Railway can issue the certificate; proxying can be turned on later if
   websockets are allowed through (they are by default on Cloudflare).
3. The app's default server URL is `https://sync.toolbay.ai` (`DEFAULT_SERVER_URL` in
   `packages/sync/src/constants.ts`).

**toolbay.ai**

- Confirm the tool settings sync API accepts the slug **`bedrock`** (`TOOL_SLUG`, exported from
  `packages/sync`; one constant to change if the slug is renamed) and an item value of ~100 bytes.
- `GET /api/v1/me` must keep returning `{user:{id}}` with a stable id.
