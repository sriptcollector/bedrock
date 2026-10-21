# bedrock-sync

The Bedrock sync storage service. Stores encrypted chunks (Cloudflare R2 or local disk) and
encrypted file metadata (SQLite on a volume). It never sees file contents, names or the vault key.
Protocol, design decisions and costs: [`docs/SYNC.md`](../docs/SYNC.md).

## Run locally

```sh
npm install
npm run build -w server
DATA_DIR=./data DEV_AUTH=1 npm start -w server      # tokens "dev:<userId>" accepted
curl localhost:8080/healthz
npm test -w server                                   # or: cd server && npx vitest run
```

## Deploy (Railway)

Docker build from the **repo root**: `docker build -f server/Dockerfile .`
On Railway: root directory `/`, config file `server/railway.json`, a volume mounted at `/data`,
one replica. Step-by-step setup is in `docs/SYNC.md` section 10.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP port (Railway sets it) |
| `HOST` | `0.0.0.0` | bind address |
| `DATA_DIR` | `./data` | SQLite file (`bedrock-sync.sqlite`) and, with the disk backend, `blobs/` |
| `TOOLBAY_API` | `https://toolbay.ai` | where tokens are checked (`GET /api/v1/me`) |
| `DEV_AUTH` | off | `1` accepts `dev:<userId>` tokens. Tests and local only, never production |
| `S3_ENDPOINT` | | e.g. `https://<account>.r2.cloudflarestorage.com`. Setting `S3_BUCKET` switches blobs to S3/R2 |
| `S3_BUCKET` | | bucket name, e.g. `bedrock-vaults` |
| `S3_ACCESS_KEY_ID` | | R2 API token access key (Object Read & Write on that bucket only) |
| `S3_SECRET_ACCESS_KEY` | | R2 API token secret |
| `S3_REGION` | `auto` | |
| `S3_PREFIX` | empty | optional key prefix inside the bucket |
| `QUOTA_BYTES` | `10737418240` (10 GB) | default per-vault quota (encrypted bytes incl. history) |
| `MAX_FILE_BYTES` | `1073741824` (1 GB) | largest file that syncs |
| `RETENTION_DAYS` | `90` | how long old versions are kept (current versions are kept forever) |
| `GC_GRACE_HOURS` | `24` | unreferenced chunks younger than this are not deleted (in-flight uploads) |
| `RETENTION_INTERVAL_HOURS` | `6` | how often retention + GC runs |
| `RATE_LIMIT_PER_SEC` | `30` | requests per second per user |
| `RATE_LIMIT_BURST` | `300` | burst size per user |

No telemetry: the service logs only start-up, retention summaries and errors to stdout.
