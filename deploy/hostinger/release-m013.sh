#!/usr/bin/env bash
# Apply M013 only after a verified backup and restored-copy validation.
set -euo pipefail

stage_dir=${ERP_STAGE_DIR:?Set ERP_STAGE_DIR to the staged release under /tmp}
source_dir=$stage_dir/apps/api
target_dir=/opt/import-erp/apps/api
node=/opt/node-v24/bin/node

[[ $stage_dir == /tmp/* ]]
test -f "$source_dir/dist/migrate.js"
test -f "$source_dir/dist/requests.js"
test -f "$source_dir/migrations/M013_request_history_read.sql"
systemctl is-active --quiet import-erp-api

status=$(MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
  "$node" --env-file=/etc/import-erp/migration-release.env \
  "$source_dir/dist/migrate.js" status)
[[ $status == *'Migrations: 12 aplicadas, 1 pendentes.'* \
   && $status == *'pendente  M013_request_history_read.sql'* ]]

python3 "$stage_dir/deploy/hostinger/validate-m013-on-copy.py"

MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
  "$node" --env-file=/etc/import-erp/migration-release.env \
  "$source_dir/dist/migrate.js" up

status=$(MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
  "$node" --env-file=/etc/import-erp/migration-release.env \
  "$source_dir/dist/migrate.js" status)
[[ $status == *'Migrations: 13 aplicadas, 0 pendentes.'* ]]

rollback_dir=/var/backups/import-erp/m013-api-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$rollback_dir"
cp -p "$target_dir/src/requests.ts" "$rollback_dir/requests.ts"
cp -p "$target_dir/dist/requests.js" "$rollback_dir/requests.js"

restore_api() {
  trap - ERR
  cp -p "$rollback_dir/requests.ts" "$target_dir/src/requests.ts"
  cp -p "$rollback_dir/requests.js" "$target_dir/dist/requests.js"
  systemctl restart import-erp-api
  echo "Previous API code restored from $rollback_dir; M013 remains applied." >&2
}
trap restore_api ERR

install -m 0644 "$source_dir/migrations/M013_request_history_read.sql" \
  "$target_dir/migrations/M013_request_history_read.sql"
install -m 0644 "$source_dir/src/requests.ts" "$target_dir/src/requests.ts"
install -m 0644 "$source_dir/dist/requests.js" "$target_dir/dist/requests.js"
systemctl restart import-erp-api

ready=false
for attempt in {1..15}; do
  if bash "$stage_dir/deploy/hostinger/verify-api-ready.sh" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
test "$ready" = true

"$node" --env-file=/etc/import-erp/api.env --input-type=module <<'JS'
const origin = `https://${process.env.PUBLIC_API_HOST ?? 'api.72-60-250-212.sslip.io'}`;
const response = await fetch(`${origin}/api/v1/requests/00000000-0000-4000-8000-000000000000/history`, {
  headers: { 'x-import-erp-gateway-token': process.env.GATEWAY_TOKEN },
});
console.log(`anonymous request-history route: ${response.status}`);
if (response.status !== 401) process.exitCode = 1;
JS

MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
  "$node" --env-file=/etc/import-erp/migration-release.env \
  "$target_dir/dist/migrate.js" status

trap - ERR
echo "M013 API installed; previous code in $rollback_dir"
