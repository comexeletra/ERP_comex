#!/usr/bin/env bash
# Validate M032-M034 on a restored copy, then publish the queued Excel export.
set -euo pipefail

stage_dir=${ERP_STAGE_DIR:?Set ERP_STAGE_DIR to the staged release under /tmp}
[[ $stage_dir == /tmp/erp-m032-* ]]
api_dir=$stage_dir/apps/api
target_dir=/opt/import-erp/apps/api
node=/opt/node-v24/bin/node
worker_unit=/etc/systemd/system/import-erp-export-worker.service

test -f "$api_dir/dist/migrate.js"
test -f "$api_dir/dist/server.js"
test -f "$api_dir/dist/export-jobs.js"
test -f "$api_dir/dist/purchase-order-exports.js"
test -f "$api_dir/dist/worker.js"
test -f "$api_dir/migrations/M032_export_jobs.sql"
test -f "$api_dir/migrations/M033_open_data_issue_source.sql"
test -f "$api_dir/migrations/M034_export_jobs_xlsx.sql"
grep -Fq '"exceljs"' "$api_dir/package.json"
systemctl is-active --quiet import-erp-api
if [[ -e $worker_unit ]]; then
  echo 'Export worker unit already exists; inspect it before this release.' >&2
  exit 1
fi

migrate() {
  MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
    "$node" --env-file=/etc/import-erp/migration-release.env \
    "$api_dir/dist/migrate.js" "$1"
}

status=$(migrate status)
if [[ $status != *'Migrations: 31 aplicadas, 3 pendentes.'* \
      || $status != *'pendente  M032_export_jobs.sql'* \
      || $status != *'pendente  M033_open_data_issue_source.sql'* \
      || $status != *'pendente  M034_export_jobs_xlsx.sql'* ]]; then
  echo 'Expected M001-M031 applied and only M032-M034 pending.' >&2
  exit 1
fi

python3 "$stage_dir/deploy/hostinger/validate-m032-on-copy.py"
migrate up
status=$(migrate status)
[[ $status == *'Migrations: 34 aplicadas, 0 pendentes.'* ]]

container=$(docker ps --filter name=postgres_postgres --format '{{.ID}}' | head -n 1)
schema_ok=$(docker exec "$container" sh -lc \
  'psql -U "${POSTGRES_USER:-postgres}" -d erp_po_totvs_test -Atc "SELECT (to_regclass('\''jobs.export_job'\'') IS NOT NULL) AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='\''jobs'\'' AND table_name='\''export_job'\'' AND column_name='\''result_binary'\'' AND data_type='\''bytea'\'')"')
[[ $schema_ok == t ]]

rollback_dir=/var/backups/import-erp/m032-api-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$rollback_dir"
cp -a "$target_dir/dist" "$target_dir/src" "$target_dir/package.json" \
  "$target_dir/pnpm-lock.yaml" "$target_dir/pnpm-workspace.yaml" "$rollback_dir/"

restore_api() {
  trap - ERR
  systemctl disable --now import-erp-export-worker >/dev/null 2>&1 || true
  rm -f "$worker_unit"
  systemctl daemon-reload || true
  cp -a "$rollback_dir/dist/." "$target_dir/dist/"
  cp -a "$rollback_dir/src/." "$target_dir/src/"
  cp -a "$rollback_dir/package.json" "$target_dir/package.json"
  cp -a "$rollback_dir/pnpm-lock.yaml" "$target_dir/pnpm-lock.yaml"
  cp -a "$rollback_dir/pnpm-workspace.yaml" "$target_dir/pnpm-workspace.yaml"
  systemctl restart import-erp-api || true
  echo "Previous API code restored from $rollback_dir; additive migrations remain applied." >&2
}
trap restore_api ERR

cp -a "$api_dir/dist/." "$target_dir/dist/"
cp -a "$api_dir/src/." "$target_dir/src/"
cp -a "$api_dir/migrations/." "$target_dir/migrations/"
install -m 0644 "$api_dir/package.json" "$api_dir/pnpm-lock.yaml" \
  "$api_dir/pnpm-workspace.yaml" "$target_dir/"
cd "$target_dir"
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm install --prod --frozen-lockfile

install -m 0644 "$stage_dir/deploy/hostinger/import-erp-export-worker.service" "$worker_unit"
systemctl daemon-reload
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

"$node" --input-type=module <<'JS'
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { purchaseOrderExportXlsx } from "./dist/purchase-order-exports.js";
const bytes = await purchaseOrderExportXlsx([]);
assert.equal(bytes.subarray(0, 2).toString("ascii"), "PK");
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(bytes);
assert.equal(workbook.getWorksheet("Carteira de POs")?.rowCount, 1);
JS

systemctl enable --now import-erp-export-worker
sleep 3
systemctl is-active --quiet import-erp-api
systemctl is-active --quiet import-erp-export-worker
trap - ERR
echo "M032-M034 applied and Excel export API/worker published; previous API files in $rollback_dir"
