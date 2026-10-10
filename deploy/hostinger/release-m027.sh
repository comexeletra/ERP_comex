#!/usr/bin/env bash
# Validate historical operational backfill on a restored copy, apply M027,
# then install the API bundle that exposes the matching reports endpoint.
set -euo pipefail

stage_dir=${ERP_STAGE_DIR:?Set ERP_STAGE_DIR to the staged release under /tmp}
[[ $stage_dir == /tmp/erp-m027-* ]]
api_dir=$stage_dir/apps/api
target_dir=/opt/import-erp/apps/api
node=/opt/node-v24/bin/node
for file in dist/server.js dist/source-audit.js dist/migrate.js \
  src/server.ts src/source-audit.ts migrations/M027_operationalize_historical_workbook.sql \
  test/reports-summary.integration.mjs test/operations.integration.mjs \
  test/followup.integration.mjs; do
  test -f "$api_dir/$file"
done
test -f "$stage_dir/deploy/hostinger/validate-m027-on-copy.py"
test -d "$target_dir/node_modules"
systemctl is-active --quiet import-erp-api

if [[ ! -e $api_dir/node_modules ]]; then
  ln -s "$target_dir/node_modules" "$api_dir/node_modules"
fi

migrate() {
  MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
    "$node" --env-file=/etc/import-erp/migration-release.env \
    "$api_dir/dist/migrate.js" "$1"
}
status=$(migrate status)
if [[ $status != *'Migrations: 26 aplicadas, 1 pendentes.'* \
      || $status != *'pendente  M027_operationalize_historical_workbook.sql'* ]]; then
  echo 'Expected M001-M026 applied and only M027 pending.' >&2
  exit 1
fi

# The validator creates and verifies a protected production backup, restores it,
# applies M027 only to the disposable copy, checks data invariants, and exercises
# the report SQL and operational read/write contracts against that restored copy.
python3 "$stage_dir/deploy/hostinger/validate-m027-on-copy.py"

rollback_dir=/var/backups/import-erp/m027-api-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$rollback_dir"
for file in src/server.ts src/source-audit.ts dist/server.js dist/source-audit.js; do
  cp -p "$target_dir/$file" "$rollback_dir/$(basename "$file")"
done

migrate up
status=$(migrate status)
[[ $status == *'Migrations: 27 aplicadas, 0 pendentes.'* ]]

restore_api() {
  trap - ERR
  cp -p "$rollback_dir/server.ts" "$target_dir/src/server.ts"
  cp -p "$rollback_dir/source-audit.ts" "$target_dir/src/source-audit.ts"
  cp -p "$rollback_dir/server.js" "$target_dir/dist/server.js"
  cp -p "$rollback_dir/source-audit.js" "$target_dir/dist/source-audit.js"
  systemctl restart import-erp-api
  echo "Previous API restored from $rollback_dir; M027 remains applied." >&2
}
trap restore_api ERR

install -m 0644 "$api_dir/src/server.ts" "$target_dir/src/.server-m027.ts"
install -m 0644 "$api_dir/src/source-audit.ts" "$target_dir/src/.source-audit-m027.ts"
install -m 0644 "$api_dir/dist/server.js" "$target_dir/dist/.server-m027.js"
install -m 0644 "$api_dir/dist/source-audit.js" "$target_dir/dist/.source-audit-m027.js"
install -m 0644 "$api_dir/migrations/M027_operationalize_historical_workbook.sql" "$target_dir/migrations/M027_operationalize_historical_workbook.sql"
mv -f "$target_dir/src/.server-m027.ts" "$target_dir/src/server.ts"
mv -f "$target_dir/src/.source-audit-m027.ts" "$target_dir/src/source-audit.ts"
mv -f "$target_dir/dist/.server-m027.js" "$target_dir/dist/server.js"
mv -f "$target_dir/dist/.source-audit-m027.js" "$target_dir/dist/source-audit.js"
grep -qF 'reports/summary' "$target_dir/dist/source-audit.js"
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

trap - ERR
echo "M027 and reports API published; API rollback files in $rollback_dir"
