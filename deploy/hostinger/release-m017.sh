#!/usr/bin/env bash
# Apply M016-M017 only after a verified backup and restored-copy validation.
set -euo pipefail

stage_dir=${ERP_STAGE_DIR:?Set ERP_STAGE_DIR to the staged release under /tmp}
api_dir=$stage_dir/apps/api
target_dir=/opt/import-erp/apps/api
node=/opt/node-v24/bin/node
[[ $stage_dir == /tmp/* ]]
test -f "$api_dir/dist/migrate.js"
test -f "$api_dir/dist/server.js"
test -f "$api_dir/dist/catalog.js"
test -f "$api_dir/migrations/M016_import_batch_snapshot_read.sql"
test -f "$api_dir/migrations/M017_catalog_entry_history.sql"
test -f "$stage_dir/deploy/hostinger/validate-m017-on-copy.py"
systemctl is-active --quiet import-erp-api

status=$(MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
  "$node" --env-file=/etc/import-erp/migration-release.env \
  "$api_dir/dist/migrate.js" status)
if [[ ($status == *'Migrations: 15 aplicadas, 2 pendentes.'* \
       && $status == *'pendente  M016_import_batch_snapshot_read.sql'* \
       && $status == *'pendente  M017_catalog_entry_history.sql'*) \
      || ($status == *'Migrations: 16 aplicadas, 1 pendentes.'* \
          && $status == *'pendente  M017_catalog_entry_history.sql'*) ]]; then
  python3 "$stage_dir/deploy/hostinger/validate-m017-on-copy.py"
  MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
    "$node" --env-file=/etc/import-erp/migration-release.env \
    "$api_dir/dist/migrate.js" up
elif [[ ${ERP_M017_RESUME:-false} == true \
        && $status == *'Migrations: 17 aplicadas, 0 pendentes.'* ]]; then
  backup=${ERP_M017_BACKUP:?Set the verified pre-release backup path}
  expected_sha=${ERP_M017_BACKUP_SHA256:?Set the verified backup SHA-256}
  [[ $backup == /var/backups/import-erp/erp_po_totvs_test_*.dump && -f $backup ]]
  actual_sha=$(sha256sum "$backup")
  [[ ${actual_sha%% *} == "$expected_sha" ]]
  echo "Resuming API installation with verified backup $backup"
else
  echo 'Unexpected migration state; refusing M016-M017 release.' >&2
  exit 1
fi

rollback_dir=/var/backups/import-erp/m017-api-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$rollback_dir"
cp -p "$target_dir/src/catalog.ts" "$rollback_dir/catalog.ts"
cp -p "$target_dir/dist/catalog.js" "$rollback_dir/catalog.js"
restore_api() {
  trap - ERR
  cp -p "$rollback_dir/catalog.ts" "$target_dir/src/catalog.ts"
  cp -p "$rollback_dir/catalog.js" "$target_dir/dist/catalog.js"
  systemctl restart import-erp-api
  echo "Previous API code restored from $rollback_dir; applied migrations remain in place." >&2
}
trap restore_api ERR

install -m 0644 "$api_dir/migrations/M016_import_batch_snapshot_read.sql" "$target_dir/migrations/M016_import_batch_snapshot_read.sql"
install -m 0644 "$api_dir/migrations/M017_catalog_entry_history.sql" "$target_dir/migrations/M017_catalog_entry_history.sql"
install -m 0644 "$api_dir/src/catalog.ts" "$target_dir/src/catalog.ts"
install -m 0644 "$api_dir/dist/catalog.js" "$target_dir/dist/catalog.js"
systemctl restart import-erp-api
ready=false
for attempt in {1..15}; do
  if bash <(sed 's/\r$//' "$stage_dir/deploy/hostinger/verify-api-ready.sh") >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
test "$ready" = true
bash <(sed 's/\r$//' "$stage_dir/deploy/hostinger/verify-m017-operational.sh")
trap - ERR
echo "M016-M017 API installed; previous code in $rollback_dir"
