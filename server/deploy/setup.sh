#!/bin/bash
# Server setup for sync.toolbay.ai (Bedrock sync) on a Debian 12 Google VM in westward-apps-prod.
# Runs at every boot (VM startup script) and is safe to run again. Installs Node 24 and Caddy,
# then installs the newest release from the storage bucket and checks for new ones every two
# minutes. SQLite and the encrypted chunks live on the VM's disk in /var/lib/bedrock-sync (the
# disk blob backend: no S3/R2 keys needed). Caddy serves HTTPS, websockets included.
set -euo pipefail
exec >>/var/log/bedrock-sync-setup.log 2>&1
echo "=== setup $(date -Is)"

DOMAIN="${DOMAIN:-sync.toolbay.ai}"

# ---------------------------------------------------------------- packages (first boot only)
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi
if ! command -v node >/dev/null || ! node -v | grep -q '^v24'; then
  apt-get update
  apt-get install -y ca-certificates curl gnupg debian-keyring debian-archive-keyring apt-transport-https
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

id bedrock >/dev/null 2>&1 || useradd --system --home /var/lib/bedrock-sync --shell /usr/sbin/nologin bedrock
mkdir -p /opt/bedrock-sync /var/lib/bedrock-sync /etc/bedrock-sync
chown bedrock:bedrock /var/lib/bedrock-sync
chmod 700 /var/lib/bedrock-sync

[ -f /etc/bedrock-sync/sync.env ] || cat >/etc/bedrock-sync/sync.env <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=8080
DATA_DIR=/var/lib/bedrock-sync
TOOLBAY_API=https://toolbay.ai
EOF
chmod 600 /etc/bedrock-sync/sync.env

cat >/etc/systemd/system/bedrock-sync.service <<'EOF'
[Unit]
Description=Bedrock sync service
After=network-online.target

[Service]
User=bedrock
WorkingDirectory=/opt/bedrock-sync/current
EnvironmentFile=/etc/bedrock-sync/sync.env
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning /opt/bedrock-sync/current/dist/main.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode zstd gzip
	request_body {
		max_size 1100MB
	}
	reverse_proxy 127.0.0.1:8080
}
EOF

# ---------------------------------------------------------------- releases
cat >/usr/local/bin/bedrock-sync-update.sh <<'EOF'
#!/bin/bash
# Install the newest release from the bucket if it is new. Builds next to the old one, then swaps.
set -euo pipefail
exec >>/var/log/bedrock-sync-update.log 2>&1
BUCKET="${BUCKET:-westward-apps-prod-bedrock-sync}"
TOKEN=$(curl -s -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token | sed -E 's/.*"access_token":"([^"]+)".*/\1/')
META=$(curl -s -H "Authorization: Bearer $TOKEN" "https://storage.googleapis.com/storage/v1/b/$BUCKET/o/release.tgz")
GEN=$(echo "$META" | sed -nE 's/.*"generation": "([0-9]+)".*/\1/p')
[ -n "$GEN" ] || { echo "$(date -Is) no release yet"; exit 0; }
[ "$GEN" = "$(cat /opt/bedrock-sync/generation 2>/dev/null)" ] && exit 0
echo "=== $(date -Is) installing release $GEN"
NEW=/opt/bedrock-sync/r-$GEN
rm -rf "$NEW" && mkdir -p "$NEW"
curl -sf -H "Authorization: Bearer $TOKEN" "https://storage.googleapis.com/storage/v1/b/$BUCKET/o/release.tgz?alt=media" -o /tmp/bedrock-sync-release.tgz
tar -xzf /tmp/bedrock-sync-release.tgz -C "$NEW"
cd "$NEW"
npm install --no-audit --no-fund --ignore-scripts
npx tsc -p tsconfig.build.json
npm prune --omit=dev
chown -R bedrock:bedrock "$NEW"
ln -sfn "$NEW" /opt/bedrock-sync/current
echo "$GEN" >/opt/bedrock-sync/generation
systemctl daemon-reload
systemctl enable bedrock-sync >/dev/null 2>&1 || true
systemctl restart bedrock-sync
ls -1dt /opt/bedrock-sync/r-* | tail -n +3 | xargs -r rm -rf
echo "=== $(date -Is) release $GEN live"
EOF
chmod +x /usr/local/bin/bedrock-sync-update.sh

cat >/etc/systemd/system/bedrock-sync-update.service <<'EOF'
[Unit]
Description=Install a new bedrock-sync release if there is one
[Service]
Type=oneshot
ExecStart=/usr/local/bin/bedrock-sync-update.sh
EOF
cat >/etc/systemd/system/bedrock-sync-update.timer <<'EOF'
[Unit]
Description=Check for a new bedrock-sync release every two minutes
[Timer]
OnBootSec=30s
OnUnitActiveSec=2min
[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now bedrock-sync-update.timer
systemctl enable bedrock-sync >/dev/null 2>&1 || true
systemctl reload caddy || systemctl restart caddy
/usr/local/bin/bedrock-sync-update.sh || true
echo "=== setup done $(date -Is)"
