#!/usr/bin/env bash
# Install an export worker pinned to the same immutable release used by the HML API.
set -euo pipefail

readonly env_file=/etc/import-erp/homologation-db.env
readonly unit_name=import-erp-hml-export-worker
readonly unit_file=/etc/systemd/system/import-erp-hml-export-worker.service
readonly dropin_dir=/etc/systemd/system/import-erp-hml-export-worker.service.d
readonly checker_file=/opt/import-erp/apps/api/check-hml-database.mjs
readonly source_dir=$(cd "$(dirname "$0")" && pwd)
release_sha=${1:-}

[[ $EUID -eq 0 ]] || { echo 'Run this script as root.' >&2; exit 1; }
[[ $release_sha =~ ^[0-9a-f]{7,40}$ ]] || {
  echo 'Usage: enable-homologation-export-worker.sh <release-sha>' >&2
  exit 1
}

readonly worker_file=/opt/import-erp/apps/api/hml-release-${release_sha}/dist/worker.js
readonly dropin_file=${dropin_dir}/release-${release_sha}.conf

[[ -f $env_file ]] || { echo "Missing ${env_file}." >&2; exit 1; }
[[ -f $worker_file ]] || { echo "Missing ${worker_file}." >&2; exit 1; }
[[ -f $source_dir/import-erp-hml-export-worker.service ]]
[[ -f $source_dir/check-hml-database.mjs ]]

# Validate the configured target before installing or enabling anything.
/opt/node-v24/bin/node --env-file="$env_file" "$source_dir/check-hml-database.mjs"
api_exec_start=$(systemctl show --property=ExecStart --value import-erp-hml-api)
[[ $api_exec_start == *"/hml-release-${release_sha}/dist/server.js"* ]] || {
  echo "Refusing to start: import-erp-hml-api is not using release ${release_sha}." >&2
  exit 1
}

was_active=false
if systemctl is-active --quiet "$unit_name"; then
  was_active=true
fi

install -o root -g root -m 0644 "$source_dir/check-hml-database.mjs" "$checker_file"
install -o root -g root -m 0644 "$source_dir/import-erp-hml-export-worker.service" "$unit_file"
install -d -o root -g root -m 0755 "$dropin_dir"

for existing_dropin in "$dropin_dir"/release-*.conf; do
  [[ -e $existing_dropin ]] || continue
  rm -- "$existing_dropin"
done

cat > "$dropin_file" <<EOF
[Service]
ExecStart=
ExecStart=/opt/node-v24/bin/node ${worker_file}
EOF
chown root:root "$dropin_file"
chmod 0644 "$dropin_file"

systemd-analyze verify "$unit_file"
systemctl daemon-reload
readonly started_at=$(date '+%Y-%m-%d %H:%M:%S')
systemctl enable --now import-erp-hml-export-worker
if [[ $was_active == true ]]; then
  systemctl restart import-erp-hml-export-worker
fi
systemctl is-active --quiet import-erp-hml-export-worker

started=false
for attempt in {1..10}; do
  if journalctl -u import-erp-hml-export-worker --since "$started_at" --no-pager \
      | grep -Fq '"event":"export_worker_started"'; then
    started=true
    break
  fi
  sleep 1
done
[[ $started == true ]] || { echo 'HML export worker did not log export_worker_started.' >&2; exit 1; }

echo "HML export worker is active on release ${release_sha}."
