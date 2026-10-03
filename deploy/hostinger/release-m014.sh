#!/usr/bin/env bash
# Apply M014 only after a verified backup and restored-copy validation.
set -euo pipefail

stage_dir=${ERP_STAGE_DIR:?Set ERP_STAGE_DIR to the staged release under /tmp}
source_dir=$stage_dir/apps/api
target_dir=/opt/import-erp/apps/api
node=/opt/node-v24/bin/node

[[ $stage_dir == /tmp/* ]]
test -f "$source_dir/dist/migrate.js"
test -f "$source_dir/dist/server.js"
test -f "$source_dir/dist/admin-outbox.js"
test -f "$source_dir/migrations/M014_outbox_monitor.sql"
systemctl is-active --quiet import-erp-api

status=$(MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
  "$node" --env-file=/etc/import-erp/migration-release.env \
  "$source_dir/dist/migrate.js" status)
if [[ $status == *'Migrations: 13 aplicadas, 1 pendentes.'* \
      && $status == *'pendente  M014_outbox_monitor.sql'* ]]; then
  python3 "$stage_dir/deploy/hostinger/validate-m014-on-copy.py"
  MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
    "$node" --env-file=/etc/import-erp/migration-release.env \
    "$source_dir/dist/migrate.js" up
  status=$(MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
    "$node" --env-file=/etc/import-erp/migration-release.env \
    "$source_dir/dist/migrate.js" status)
  [[ $status == *'Migrations: 14 aplicadas, 0 pendentes.'* ]]
elif [[ ${ERP_M014_RESUME:-false} == true \
        && $status == *'Migrations: 14 aplicadas, 0 pendentes.'* ]]; then
  backup=${ERP_M014_BACKUP:?Set the verified pre-release backup path}
  expected_sha=${ERP_M014_BACKUP_SHA256:?Set the verified backup SHA-256}
  [[ $backup == /var/backups/import-erp/erp_po_totvs_test_*.dump && -f $backup ]]
  actual_sha=$(sha256sum "$backup")
  [[ ${actual_sha%% *} == "$expected_sha" ]]
  echo "Resuming API installation with verified backup $backup"
else
  echo "Unexpected migration state; refusing M014 release." >&2
  exit 1
fi

rollback_dir=/var/backups/import-erp/m014-api-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$rollback_dir"
cp -p "$target_dir/src/server.ts" "$rollback_dir/server.ts"
cp -p "$target_dir/dist/server.js" "$rollback_dir/server.js"

restore_api() {
  trap - ERR
  cp -p "$rollback_dir/server.ts" "$target_dir/src/server.ts"
  cp -p "$rollback_dir/server.js" "$target_dir/dist/server.js"
  systemctl restart import-erp-api
  echo "Previous API code restored from $rollback_dir; M014 remains applied." >&2
}
trap restore_api ERR

install -m 0644 "$source_dir/migrations/M014_outbox_monitor.sql" \
  "$target_dir/migrations/M014_outbox_monitor.sql"
install -m 0644 "$source_dir/src/admin-outbox.ts" "$target_dir/src/admin-outbox.ts"
install -m 0644 "$source_dir/dist/admin-outbox.js" "$target_dir/dist/admin-outbox.js"
install -m 0644 "$source_dir/src/server.ts" "$target_dir/src/server.ts"
install -m 0644 "$source_dir/dist/server.js" "$target_dir/dist/server.js"
systemctl restart import-erp-api

ready=false
for attempt in {1..15}; do
  # Windows checkouts may package CRLF shell scripts; normalize only the stream.
  if bash <(sed 's/\r$//' "$stage_dir/deploy/hostinger/verify-api-ready.sh") >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
test "$ready" = true

"$node" --env-file=/etc/import-erp/api.env --input-type=module <<'JS'
const origin = `https://${process.env.PUBLIC_API_HOST ?? 'api.72-60-250-212.sslip.io'}`;
const response = await fetch(`${origin}/api/v1/admin/outbox`, {
  headers: { 'x-import-erp-gateway-token': process.env.GATEWAY_TOKEN },
});
console.log(`anonymous outbox route: ${response.status}`);
if (response.status !== 401) process.exitCode = 1;
JS

MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
  "$node" --env-file=/etc/import-erp/migration-release.env \
  "$target_dir/dist/migrate.js" status

trap - ERR
echo "M014 API installed; previous code in $rollback_dir"
