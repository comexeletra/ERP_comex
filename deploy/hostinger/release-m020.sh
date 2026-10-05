#!/usr/bin/env bash
# Publish PO follow-up migrations and API after a restored-copy test.
set -euo pipefail

stage_dir=${ERP_STAGE_DIR:?Set ERP_STAGE_DIR to the staged release under /tmp}
api_dir=$stage_dir/apps/api
target_dir=/opt/import-erp/apps/api
node=/opt/node-v24/bin/node
[[ $stage_dir == /tmp/erp-m020-* ]]
test -f "$api_dir/dist/server.js"
test -f "$api_dir/dist/operations.js"
test -f "$api_dir/dist/followup.js"
test -f "$api_dir/dist/followup-calculations.js"
test -f "$api_dir/dist/migrate.js"
test -f "$api_dir/test/followup.integration.mjs"
test -f "$api_dir/migrations/M019_followup_operational.sql"
test -f "$api_dir/migrations/M020_process_document_amount.sql"
test -d "$target_dir/node_modules"
systemctl is-active --quiet import-erp-api

if [[ ! -e $api_dir/node_modules ]]; then
  ln -s "$target_dir/node_modules" "$api_dir/node_modules"
fi

status=$(MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
  "$node" --env-file=/etc/import-erp/migration-release.env \
  "$api_dir/dist/migrate.js" status)
if [[ $status != *'Migrations: 18 aplicadas, 2 pendentes.'* \
      || $status != *'pendente  M019_followup_operational.sql'* \
      || $status != *'pendente  M020_process_document_amount.sql'* ]]; then
  echo 'Expected M001-M018 applied and only M019-M020 pending.' >&2
  exit 1
fi

python3 "$stage_dir/deploy/hostinger/validate-m020-on-copy.py"

MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
  "$node" --env-file=/etc/import-erp/migration-release.env \
  "$api_dir/dist/migrate.js" up

status=$(MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
  "$node" --env-file=/etc/import-erp/migration-release.env \
  "$api_dir/dist/migrate.js" status)
[[ $status == *'Migrations: 20 aplicadas, 0 pendentes.'* ]]

rollback_dir=/var/backups/import-erp/m020-api-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$rollback_dir"
cp -a "$target_dir/dist" "$rollback_dir/dist"
cp -a "$target_dir/src" "$rollback_dir/src"

restore_api() {
  trap - ERR
  cp -a "$rollback_dir/dist/." "$target_dir/dist/"
  cp -a "$rollback_dir/src/." "$target_dir/src/"
  rm -f -- "$target_dir/dist/followup.js" "$target_dir/dist/followup-calculations.js" \
    "$target_dir/src/followup.ts" "$target_dir/src/followup-calculations.ts"
  systemctl restart import-erp-api
  echo "Previous API restored from $rollback_dir; M019-M020 remain applied." >&2
}
trap restore_api ERR

install -m 0644 "$api_dir/migrations/M019_followup_operational.sql" \
  "$target_dir/migrations/M019_followup_operational.sql"
install -m 0644 "$api_dir/migrations/M020_process_document_amount.sql" \
  "$target_dir/migrations/M020_process_document_amount.sql"
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
  'psql -U "${POSTGRES_USER:-postgres}" -d erp_po_totvs_test -v ON_ERROR_STOP=1 -Atc "SELECT (SELECT count(*) FROM migration.schema_migration), has_table_privilege('\''import_erp_app'\'','\''procurement.purchase_order_item'\'','\''UPDATE'\''), has_table_privilege('\''import_erp_app'\'','\''imports.process_document'\'','\''INSERT'\''), has_table_privilege('\''import_erp_app'\'','\''imports.process_document'\'','\''UPDATE'\'')"')
[[ $check == '20|t|t|t' ]]

trap - ERR
echo "M019-M020 and API published; previous API in $rollback_dir"
