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

**Sync is off until the person turns it on** (0.1.3+): Settings › Sync › Turn on sync. Nothing
from the vault is uploaded, and nothing is written to the Toolbay account, before that.

**The vault key.** 32 random bytes, made by the first computer that turns sync on. Toolbay never
receives it in usable form (true end-to-end since 0.1.3; `packages/sync/src/keywrap.ts`):

- The person picks a **sync passphrase** (at least 10 characters). KEK = scrypt(passphrase NFKC,
  16-byte random salt, N=2^17, r=8, p=1, 32 bytes). The key is wrapped with AES-256-GCM under the
  KEK (random 12-byte nonce; the KDF parameters and salt are bound as associated data).
- Only the wrapped object goes to the account: item `vault-key-wrapped` of the tool settings sync
  API (`PUT /api/v1/me/tools/bedrock/sync`): `{v:2, alg:"A256GCM", kdf:{name:"scrypt",N,r,p,salt,dkLen},
  nonce, ct, keyCheck, createdAt}`. toolbay.ai checks that shape strictly (a 48-byte ciphertext,
  N >= 2^15), so a raw key can't be stored under that name (`src/lib/tool-sync-policy.ts` there).
- Another computer downloads it and asks for the passphrase once; the opened key is kept in that
  computer's OS keychain (service `ai.toolbay.bedrock`, account `vault-key-2`).
- **Forgotten passphrase:** nobody can recover the synced copy, not Toolbay either. The files on
  the person's computers are never affected. "Forgot your passphrase?" starts over: a new key and
  passphrase, the synced copy is erased (`POST /v1/vault/rekey`) and refilled from the computers.
- **Race:** two computers turning sync on at the same moment both write with `baseVersion: 0`; the
  account accepts only the first, the second is told to enter the passphrase chosen there.
- **Wrong key guard:** the server keeps a public fingerprint of the key (`keyCheck`, an HMAC that
  reveals nothing about the key). Any computer whose key does not match is stopped before it
  uploads anything and asked for the (new) passphrase.
- No device-to-device key transfer exists; the passphrase is the only way to add a computer.

**Upgrade from 0.1.2 and older.** Those versions turned sync on by themselves for anyone signed in
to the hub and stored the raw key in the account (item `vault-key`), so Toolbay could have
decrypted synced notes. 0.1.3:

- turns sync off once per computer (`<userData>/sync/migration.json`) and shows a one-time choice
  ("Turn on sync…" / "Keep sync off") on computers that had synced; nothing uploads before that;
- deletes the raw `vault-key` item from the account as soon as a sign-in is available (toolbay.ai
  also hides it, purges it on any read or write and refuses new copies, so old clients stop
  syncing instead of re-uploading it);
- treats the old key as exposed: turning sync back on always makes a **new** key, and
  `rotateVault` (`packages/sync/src/rotate.ts`) re-encrypts the synced data under it. It downloads
  the current version of every synced file with the old key (still in that computer's keychain,
  account `vault-key`), has the server erase the old vault (`POST /v1/vault/rekey`, which also
  drops version history and deleted files made under the old key), re-uploads everything under
  the new key, then deletes the old key from the keychain. A journal makes it resumable. Without
  the old key the vault restarts empty and each computer uploads its own files again.

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
import { SyncEngine, AccountKeyStore, unwrapVaultKey } from '@bedrock/sync';

const wrapped = await new AccountKeyStore('https://toolbay.ai', token).getWrapped(); // null: sync never set up
const key = await unwrapVaultKey(wrapped!.key, passphrase); // then keep it in the OS keychain
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

Run in each package: `npx vitest run` (fast set, about 40 s for `packages/sync`, 1 s for
`server`). `npm run test:long -w packages/sync` (= `vitest run --mode long`) adds the 10k-note
vault, the 300 MB file and 30-round storms. Environment knobs: `BEDROCK_SCALE_NOTES`,
`BEDROCK_STORM_SEED`.

Measured on Orion's Windows 11 PC (Node 24.14, temp folders, server in the same process):

| Test | Result |
|---|---|
| Unit: crypto, chunking, diff3 (clean, overlapping, adds at end, CRLF vs LF, unicode/BOM, empty base, 5000-line file), paths/case, ignore list, state | all pass |
| Default suite `packages/sync` | 77 tests pass in 39 s |
| Default suite `server` (auth cache, 409, paging, quota, rate limit, websocket, retention + GC, presigned URLs) | 12 tests pass in 1.2 s |
| Long suite (`--mode long`) | 78 tests pass (the two that first failed were fixed: see below) |
| **10,000 notes** (14.4 MB, 100 folders) | initial upload **9.3 s** (62 HTTP requests); second computer initial download **8.3 s** (21 requests); no-op sync with a full rescan **413 ms / 216 ms** (1 request); one edited note: push 250 ms, pull 273 ms |
| 2,000 notes (default run) | upload 1.9 s, download 1.5 s, no-op 101 / 61 ms |
| **50 MB file** (13 chunks) | upload killed after 4 chunks, a fresh engine resumed with exactly the 9 missing; download 0.5 s; SHA-256 verified |
| **300 MB file** (75 chunks) | killed after 25 chunks, resumed with exactly the 50 missing; upload total 3.5 s, download 2.2 s; process memory 129 MB; SHA-256 verified |
| Storm, offline rounds, 8 x 8 ops x 3 devices (seeds 1-6 and 1234) | converged every round; no duplicates; no lost lines; 0-4 conflict copies per run |
| Storm, interleaved with mid-round syncs, 8 x 8 x 3 (seeds 1-4, 1234) | same, 31-46 mid-round syncs per run |
| Storm long, offline: 30 rounds x 14 ops x 3 devices (1,260 ops) | converged, 10 conflict copies, 147 s |
| Storm long, interleaved: 30 x 14 x 3 (1,325 ops, 261 mid-round syncs) | converged, 3 conflict copies, 209 s |
| Same note edited offline on 3 devices, different lines | merged cleanly, no conflict copy |
| Same line edited offline on 3 devices | exactly 2 conflict copies (one per losing device), all 3 versions present |
| Live: watcher + websocket | an edit on A appears on B after 172 ms (debounce set to 100 ms in the test; 1.5 s by default) |
| Server restart mid-sync, wrong vault key, token expiry (plain message, then recovery), quota full (clear message, then recovery after emptying the bin), delete vs edit both orders, version restore, recycle bin restore, case-only name clash, rename swap, edit typed during a download | all pass |

Bugs the tests found and that are fixed: a scheduling race where a sync request made right as the
previous cycle ended was dropped; swaps of two files with identical size and timestamp were not
noticed (now uses the inode); when a big upload failed, chunk uploads still in flight kept running
after the engine reported the failure; the server wrote batched chunks one at a time (10k-note
upload went from 36 s to 9 s after parallelizing server and client file work).

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

---

## 11. The app side: sync host, sign-in and UI

Code: `app/src/main/sync/` (host, keychain, selective sync rule), `app/src/renderer/sync-ui/`
(status bar icon, Settings › Sync, modals), `app/src/shared/sync.ts` (types),
`app/test/e2e/sync-e2e.mjs` (real-process test).

**Sync host (main process).** One `SyncEngine` for the one vault (`Documents\<displayName>`, or the
`main` entry of `vaults.json`). Folders opened with "Open another folder as vault" never sync.

- Runs only after the person turned it on (settings.enabled) and while a Toolbay sign-in exists;
  stops on sign-out and when the app quits. The token is re-read every 4 s: the hub's keychain session (`ai.toolbay.desktop` / `session`) first, the `TOOLBAY_TOKEN` the
  hub launched us with as a fallback. Once the keychain session has been seen and then disappears,
  the hub signed out, so the launch token is dropped too. A changed token restarts the engine.
- Vault key: the opened key from the OS keychain (`ai.toolbay.bedrock` / `vault-key-2`), used only
  while it matches the account's `vault-key-wrapped`; otherwise the status is "locked" and Settings ›
  Sync asks for the passphrase. Before the engine gets the key, data still held under an older key
  is moved to it (`rotateVault`).
- Server `https://sync.toolbay.ai`, or `BEDROCK_SYNC_URL`. Device id: a random UUID in
  `<userData>/sync/device.json`. Device name: the computer name, or the "Device name" setting.
- While the service can't be reached (it isn't deployed yet), the status says "Can't reach the sync
  service right now. Your notes are saved on this computer and will sync as soon as it's back." The
  app keeps working; the engine retries after 2, 4, 8 … 60 s.
- Per-computer files in `<userData>/sync/`: `settings.json` (pause, device name, selective sync),
  `log.json` (activity log, last 1,000 entries), `state-<id>/sync-state.json` (engine state).
- Engine debounce is 400 ms (not the engine's 1.5 s default): the editor already waits for 2 s of
  quiet before it saves, so versions can't pile up faster than the editor saves.
- **First sync on a computer** whose account already has notes: the untouched welcome note and the
  empty `.obsidian/app.json` this computer made on its first start are removed first, so the
  account's copies come down instead of conflict copies. If the computer had notes of its own, the
  two sets are combined by the engine (nothing replaced; a different note with the same name
  becomes a conflict copy) and one notice says so.
- "Import an existing vault into my synced vault" copies files into the one vault; the watcher
  picks them up and they sync like any other change (tested with the 517-note vault copy, section 12).
- Test hooks (not for users): `BEDROCK_KEYCHAIN_DIR` (keychain entries become files in that folder,
  so several instances run side by side without touching the real keychain), `BEDROCK_HUB_INSTALLED`,
  `BEDROCK_SYNC=0`, `BEDROCK_SYNC_DEBOUNCE_MS`, `BEDROCK_SYNC_DEBUG`. Smoke tests (`--smoke-test`)
  only sync when `BEDROCK_SYNC_URL` is set.

**Sign-in decision: the hub owns sign-in; Bedrock never stores a token.**

- The hub registers only `toolbay://` (`toolbay-desktop/src-tauri/src/auth.rs`). `toolbay://signin`
  starts its browser sign-in; the hub stores the session in its keychain entry and does not tell
  running tools, so we poll the keychain.
- `toolbay.ai/desktop/auth` always redirects to `toolbay://auth` (there is no `redirect_uri`
  parameter), so a `bedrock://` callback is not possible without changing toolbay.ai. It would also
  mean Bedrock keeping its own token copy, which the tool rules forbid, and registering
  `toolbay://` ourselves would hijack the hub's scheme. So we don't.
- Signed out: Settings › Sync shows **"Sign in to Toolbay"** (the status bar menu: "Sign in to
  Toolbay to sync" once sync is on), which
  opens `toolbay://signin` when the hub is installed (`app.getApplicationNameForProtocol`). Without
  the hub the button is **"Get the Toolbay app"** and opens `https://toolbay.ai/download`. After
  signing in, the person turns sync on in Settings › Sync. The app works fully while signed out.

**Selective sync (engine change).** Excluding paths with the engine's plain `ignore` option would
have made already-synced files look deleted and removed them on every other computer. The engine
gained `exclude` / `setExclude()`: excluded paths are neither uploaded nor downloaded on that
computer, files that already synced are left alone on both sides, and including them again re-reads
the server's list (`lastSeq` reset) so they come back. Rules (`app/src/main/sync/selective.ts`):

- Notes (`.md`), canvases and bases always sync.
- Toggles: images (bmp png jpg jpeg gif svg webp avif), audio (mp3 wav m4a 3gp flac ogg oga opus),
  videos (mp4 webm ogv mov mkv), PDFs, all other types. All on by default. Obsidian turns "other
  types" off; with one vault per account we sync everything unless told otherwise.
- Excluded folders (and everything under them).
- Settings categories, split the way Obsidian splits `.obsidian/`: main settings (`app.json`,
  `types.json`), appearance (`appearance.json`), themes and snippets (`themes/`, `snippets/`),
  hotkeys (`hotkeys.json`), active core plugin list (`core-plugins.json`), core plugin settings
  (every other `.obsidian/*.json`), active community plugin list (`community-plugins.json`),
  installed community plugins (`plugins/`). The first six are on by default and the two community
  plugin ones are off, as in Obsidian: plugin code from another computer should not arrive unasked.

**Empty-vault guard (engine change).** A full scan that finds the vault folder missing, or empty
while 3 or more synced files should be there, stops with "The vault folder is empty or missing, so
sync is paused to keep your notes safe on your other computers…" instead of deleting everything on
the other computers. Deleting a few notes on purpose still syncs.

**Engine additions** (all additive): `exclude` option, `setExclude()`, `versionContent(path, v)`,
`trashContent(fileId)` (bytes for the history diff and the deleted-files preview),
`EMPTY_VAULT_MESSAGE`. Tests: `packages/sync/test/selective.test.ts`.

**UI** (Obsidian's look, our own code and words):

- Status bar icon (`.status-bar-item.plugin-sync`, `.sync-status-icon.mod-success|mod-working|mod-error`):
  synced (green), syncing and connecting (accent, spinning), offline (cloud-off), paused, error
  (refresh-cw-off, red), signed out. The tooltip states the status in one sentence. Clicking opens a
  menu with the status, Sync now, Pause / Resume, Version history of this file, Deleted files,
  Activity log and Sync settings (signed out: Sign in to Toolbay to sync).
- Settings › Sync (core plugins group): account, status with Pause/Resume, storage used with a bar,
  device name, deleted files, activity log, Selective sync (excluded folders + 5 toggles), Vault
  configuration sync (8 toggles) and a short privacy note. Signed out: an explanation and the
  sign-in button. There is no remote vault picker, encryption password or region.
- Version history (command "Open version history for the current file", file menu "Open version
  history", status menu): versions grouped Today / Yesterday / This week / Older with time, size,
  device and renames; the text of the selected version; "Show changes" shows an inline diff from
  that version to the note now (removed lines red, added green, changed part highlighted); Copy;
  Restore (commits the old version again as a new version, so nothing is lost).
- Deleted files: list with search, preview, Restore, check boxes for "Restore N files", and Empty
  (all or the checked ones) behind a confirmation that says it is permanent and frees space.
- Activity log: uploads, downloads, moves, deletes, merges, conflicts and problems, with a filter
  and Copy log.
- Conflict notice: "“Note.md” was changed on two computers at the same time and the changes
  overlap. Both versions are kept…" with **Open both** (the note and its copy side by side).
- Commands: `sync:view-version-history`, `sync:open-sync-log`, `sync:open-sync-view` (opens the
  activity log), `sync:setup` (opens Settings › Sync), plus our own `sync:open-deleted-files`,
  `sync:sync-now` and `sync:toggle-pause`.
- No device list: the server has no endpoint for it.

## 12. End-to-end test (real processes)

`node app/test/e2e/sync-e2e.mjs [--vault <dir>]` after `npm run build -w app` and
`npm run build -w server`. It runs the real server (`DEV_AUTH=1`, disk backend, temp `DATA_DIR`) as
a child process, a fake toolbay.ai in the test process, and three Bedrock instances with separate
`BEDROCK_USER_DATA`, keychain folders and vaults, all signed in as `dev:u1`. `--vault` copies the
given vault to a temp folder, imports the copy on a fourth instance (user `dev:u2`) and checks that it
arrives byte-identical on a fifth. Screenshots: `app/test/out/sync-*.png`; results and timings:
`app/test/out/sync-e2e-results.json`.

Measured 2026-10-21 on Orion's Windows 11 PC (all processes local), 42/42 checks passed:

| Check | Result |
|---|---|
| Typing in A's editor → visible in B's open editor, measured from A's save (the editor saves after 2 s of quiet, so from the last keystroke add 2 s) | p50 **541 ms**, p95 **548 ms** (8 edits) |
| File written on A → on B's disk | p50 **438 ms**, p95 **450 ms** (20 writes) |
| Server stopped, different lines of one note edited on A and B plus a new note on each, server restarted | status "offline" on both; merged on both 1.6 s after the server came back, no conflict copy |
| Same line edited on both while offline | exactly one `Ideas (conflict <device> <date>).md`, both texts kept; the conflict notice appeared on the side that got the copy, and "Open both" opened the two side by side |
| Rename, move into a folder and delete on A (through the app's file manager) | mirrored on B in 0.46 s; history follows the moved file |
| 20 MB PNG + 20 MB PDF dropped into a note on A | on B byte-identical 1.3 s after A saved them |
| Version history: oldest of 3 versions selected, "Show changes", Restore | old text back on A and B |
| Deleted files on B: select, Restore | note back on A and B |
| Pause / resume, sign-in rejected (error) then a fresh token, sign-out (hub keychain entry removed) then sign-in | status icon paused / error / signed-out as expected; nothing synced while paused or signed out; caught up afterwards |
| B starts with its own note, account already has notes | combined, one notice; a fresh computer C gets no conflict copies of its welcome note or settings file and no notice |
| Third computer | all three trees identical 1.2 s after its app started |
| **Copy of Orion's vault** (`tbv-scratch\vault-copy`, copied again to a temp folder) imported on D, second computer E | 819 files imported in 2.2 s; D uploaded everything in 4.4 s; E byte-identical 14.7 s after the import (816 files, 129.8 MB). The 5 files of an installed community plugin stayed on D by design (off by default) |

Screenshots of every state: `app/test/out/sync-01-A-synced.png` … `sync-16-real-vault-on-E.png`.
