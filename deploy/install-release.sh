#!/usr/bin/env bash
# Run as root from an extracted, reviewed release on the target server.
set -euo pipefail
release=${1:?Usage: install-release.sh RELEASE_ID DOMAIN}
domain=${2:?Usage: install-release.sh RELEASE_ID DOMAIN}
[[ "$release" =~ ^[a-zA-Z0-9._-]+$ ]] || exit 2
[[ "$domain" =~ ^[a-zA-Z0-9.-]+$ ]] || exit 2
test "$(id -u)" -eq 0
base=/opt/awesome-my-workbench
source_dir="$base/releases/$release"
test -f "$source_dir/server.mjs"
test -x "$base/node/bin/node"
"$base/node/bin/node" "$source_dir/scripts/build-public.mjs"
test -f "/etc/letsencrypt/live/$domain/fullchain.pem"
getent passwd aw-workbench >/dev/null || useradd --system --home-dir /var/lib/awesome-my-workbench --shell /sbin/nologin aw-workbench
install -d -o aw-workbench -g aw-workbench -m 0700 /var/lib/awesome-my-workbench /var/backups/awesome-my-workbench
acme_root=/var/www/workbench-acme
renewal="/etc/letsencrypt/renewal/$domain.conf"
if test -f "$renewal"; then
  configured_root=$(sed -n 's/^webroot_path = \(.*\),$/\1/p' "$renewal" | head -1)
  if [[ "$configured_root" =~ ^/var/www/[a-zA-Z0-9/_-]+$ ]]; then acme_root=$configured_root; fi
fi
install -d -m 0755 "$acme_root/.well-known/acme-challenge"
if test ! -f /etc/awesome-my-workbench.env; then
  printf '%s\n' NODE_ENV=production AUTH_REQUIRED=1 HOST=127.0.0.1 PORT=3180 "APP_ORIGIN=https://$domain" TRUST_PROXY=1 HEALTH_DATA_DIR=/var/lib/awesome-my-workbench WORKBENCH_BACKUP_DIR=/var/backups/awesome-my-workbench WORKBENCH_BACKUP_KEEP=7 > /etc/awesome-my-workbench.env
  chown root:aw-workbench /etc/awesome-my-workbench.env
  chmod 0640 /etc/awesome-my-workbench.env
fi
# Do not replace arbitrary existing Nginx configuration.
conf=/etc/nginx/conf.d/awesome-my-workbench.conf
if test -e "$conf" && ! head -1 "$conf" | grep -q 'Awesome My Workbench managed'; then
  echo 'Existing unrelated Nginx configuration at target path; refusing overwrite' >&2
  exit 1
fi
previous=$(readlink -f "$base/current" 2>/dev/null || true)
if test -n "$previous" && test -f /var/lib/awesome-my-workbench/health.sqlite; then
  runuser -u aw-workbench -- env HEALTH_DATA_DIR=/var/lib/awesome-my-workbench WORKBENCH_BACKUP_DIR=/var/backups/awesome-my-workbench "$base/node/bin/node" "$previous/scripts/backup.mjs"
fi
{
  echo '# Awesome My Workbench managed'
  sed -e "s/WORKBENCH_DOMAIN/$domain/g" -e "s|/var/www/workbench-acme|$acme_root|g" "$source_dir/deploy/nginx.conf.template"
} > "$conf.new"
if test -e "$conf"; then cp -p "$conf" "$conf.previous"; fi
mv "$conf.new" "$conf"
if ! nginx -t; then
  if test -e "$conf.previous"; then mv "$conf.previous" "$conf"; else rm "$conf"; fi
  exit 1
fi
install -m 0644 "$source_dir/deploy/awesome-my-workbench.service" /etc/systemd/system/
install -m 0644 "$source_dir/deploy/awesome-my-workbench-backup.service" /etc/systemd/system/
install -m 0644 "$source_dir/deploy/awesome-my-workbench-backup.timer" /etc/systemd/system/
ln -sfn "$source_dir" "$base/current"
systemctl daemon-reload
systemctl enable awesome-my-workbench.service awesome-my-workbench-backup.timer
systemctl restart awesome-my-workbench.service
healthy=false
for attempt in $(seq 1 20); do
  if curl -fsS -H "Host: $domain" http://127.0.0.1:3180/healthz >/dev/null; then healthy=true; break; fi
  sleep 1
done
if ! "$healthy"; then
  if test -n "$previous"; then ln -sfn "$previous" "$base/current"; systemctl restart awesome-my-workbench.service; fi
  echo 'Release did not become healthy; inspect systemd logs' >&2
  exit 1
fi
systemctl reload nginx
systemctl start awesome-my-workbench-backup.timer
echo "Release healthy: $release"
