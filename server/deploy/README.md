# Hosting: sync.toolbay.ai

Since 2026-10-29 the sync service runs on one Google VM (`bedrock-sync`, e2-small, us-central1-a)
in project `westward-apps-prod`, set up by `deploy/setup.sh` (its startup script). Railway is no
longer used (breached 2026-10-21).

| What | Where |
| --- | --- |
| Static IP | `bedrock-sync` (34.45.46.184) |
| DNS | Cloudflare A record `sync.toolbay.ai`, DNS only (grey cloud) |
| HTTPS | Caddy (Let's Encrypt), websockets pass through |
| Service | `bedrock-sync` systemd unit, user `bedrock`, port 8080 on 127.0.0.1 |
| Data | `/var/lib/bedrock-sync` on the VM's disk (`bedrock-sync`, 30 GB, kept if the VM is deleted): SQLite + encrypted chunks (disk backend, no S3/R2 keys) |
| Backups | Snapshot schedule `bedrock-sync-daily`: one snapshot a day at 10:00 UTC, kept 14 days (kept even if the disk is deleted) |
| Settings | `/etc/bedrock-sync/sync.env` (no secrets: tokens are checked against toolbay.ai) |
| Releases | `gs://westward-apps-prod-bedrock-sync/release.tgz`, read by service account `bedrock-sync-run` |

## Releasing

From `server/`: `tar -czf release.tgz package.json tsconfig.json tsconfig.build.json src` and upload
it to the bucket as `release.tgz`. Within two minutes `bedrock-sync-update.timer` builds it next to
the running one and swaps it in. Log: `/var/log/bedrock-sync-update.log`.
