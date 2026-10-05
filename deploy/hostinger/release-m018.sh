#!/usr/bin/env bash
# Publish the operational PO/IP migration and API after a restored-copy test.
set -euo pipefail

stage_dir=${ERP_STAGE_DIR:?Set ERP_STAGE_DIR to the staged release under /tmp}
api_dir=$stage_dir/apps/api
target_dir=/opt/import-erp/apps/api
node=/opt/node-v24/bin/node
[[ $stage_dir == /tmp/erp-m018-* ]]
test -f "$api_dir/dist/server.js"
test -f "$api_dir/dist/operations.js"
test -f "$api_dir/dist/migrate.js"
test -f "$api_dir/test/operations.integration.mjs"
test -f "$api_dir/migrations/M018_operational_po_ip.sql"
test -d "$target_dir/node_modules"
systemctl is-active --quiet import-erp-api

if [[ ! -e $api_dir/node_modules ]]; then
  ln -s "$target_dir/node_modules" "$api_dir/node_modules"
fi

status=$(MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
  "$node" --env-file=/etc/import-erp/migration-release.env \
  "$api_dir/dist/migrate.js" status)
if [[ $status != *'Migrations: 17 aplicadas, 1 pendentes.'* \
      || $status != *'pendente  M018_operational_po_ip.sql'* ]]; then
  echo 'Expected M001-M017 applied and only M018 pending.' >&2
  exit 1
fi

python3 "$stage_dir/deploy/hostinger/validate-m018-on-copy.py"

MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
  "$node" --env-file=/etc/import-erp/migration-release.env \
  "$api_dir/dist/migrate.js" up

status=$(MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
  "$node" --env-file=/etc/import-erp/migration-release.env \
  "$api_dir/dist/migrate.js" status)
[[ $status == *'Migrations: 18 aplicadas, 0 pendentes.'* ]]

rollback_dir=/var/backups/import-erp/m018-api-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$rollback_dir"
cp -a "$target_dir/dist" "$rollback_dir/dist"
cp -a "$target_dir/src" "$rollback_dir/src"

restore_api() {
  trap - ERR
  cp -a "$rollback_dir/dist/." "$target_dir/dist/"
  cp -a "$rollback_dir/src/." "$target_dir/src/"
  rm -f -- "$target_dir/dist/operations.js" "$target_dir/src/operations.ts"
  systemctl restart import-erp-api
  echo "Previous API restored from $rollback_dir; M018 remains applied." >&2
}
trap restore_api ERR

install -m 0644 "$api_dir/migrations/M018_operational_po_ip.sql" \
  "$target_dir/migrations/M018_operational_po_ip.sql"
cp -a "$api_dir/dist/." "$target_dir/dist/"
cp -a "$api_dir/src/." "$target_dir/src/"
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

container=$(docker ps --filter name=postgres_postgres --format '{{.ID}}' | head -n 1)
check=$(docker exec "$container" sh -lc \
  'psql -U "${POSTGRES_USER:-postgres}" -d erp_po_totvs_test -v ON_ERROR_STOP=1 -Atc "SELECT (SELECT count(*) FROM migration.schema_migration), has_table_privilege('\''import_erp_app'\'','\''procurement.purchase_order_item'\'','\''INSERT'\''), has_table_privilege('\''import_erp_app'\'','\''procurement.po_item_allocation'\'','\''UPDATE'\'')"')
[[ $check == '18|t|t' ]]

trap - ERR
echo "M018 and API published; previous API in $rollback_dir"
