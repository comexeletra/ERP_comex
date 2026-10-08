#!/usr/bin/env bash
# Publish the API's Group selector change after M031 is applied.
set -euo pipefail

stage_dir=${ERP_STAGE_DIR:?Set ERP_STAGE_DIR to the staged release under /tmp}
[[ $stage_dir == /tmp/erp-m031-* ]]
target_dir=/opt/import-erp/apps/api
test -f "$stage_dir/apps/api/dist/catalog.js"
test -f "$stage_dir/apps/api/catalog.ts"
test -f "$stage_dir/deploy/hostinger/verify-api-ready.sh"
grep -Fq '"GROUP"' "$stage_dir/apps/api/dist/catalog.js"
systemctl is-active --quiet import-erp-api
container=$(docker ps --filter name=postgres_postgres --format '{{.ID}}' | head -n 1)
ledger=$(docker exec "$container" sh -lc \
  'psql -U "${POSTGRES_USER:-postgres}" -d erp_po_totvs_test -Atc "SELECT count(*) FROM migration.schema_migration"')
[[ $ledger == 31 ]]

rollback_dir=/var/backups/import-erp/m031-api-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$rollback_dir"
cp -a "$target_dir/dist/catalog.js" "$rollback_dir/catalog.js"
cp -a "$target_dir/src/catalog.ts" "$rollback_dir/catalog.ts"

restore_api() {
  trap - ERR
  cp -a "$rollback_dir/catalog.js" "$target_dir/dist/catalog.js"
  cp -a "$rollback_dir/catalog.ts" "$target_dir/src/catalog.ts"
  systemctl restart import-erp-api
  echo "Previous catalog API restored from $rollback_dir" >&2
}
trap restore_api ERR

install -m 0644 "$stage_dir/apps/api/dist/catalog.js" "$target_dir/dist/catalog.js"
install -m 0644 "$stage_dir/apps/api/catalog.ts" "$target_dir/src/catalog.ts"
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
echo "M031 catalog API published; previous files in $rollback_dir"
