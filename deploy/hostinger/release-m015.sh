#!/usr/bin/env bash
# Apply the derived Excel-error flags only after restored-copy validation.
set -euo pipefail

stage_dir=${ERP_STAGE_DIR:?Set ERP_STAGE_DIR to the staged release under /tmp}
[[ $stage_dir == /tmp/* ]]
api_dir=$stage_dir/apps/api
target_dir=/opt/import-erp/apps/api
importer_dir=/root/.config/import-erp/historical-import
node=/opt/node-v24/bin/node

test -f "$api_dir/dist/migrate.js"
test -f "$api_dir/migrations/M015_excel_error_columns.sql"
test -f "$stage_dir/deploy/hostinger/import-historical-workbook.py"
test -f "$stage_dir/deploy/hostinger/validate-m015-on-copy.py"
systemctl is-active --quiet import-erp-api
[[ $(sha256sum "$importer_dir/workbook.xlsx") == d2f025ce6dc53a15574126217cf2148fb875fbb41408f266d6a486aa5f0d7f44* ]]

"$importer_dir/venv/bin/python" \
  "$stage_dir/deploy/hostinger/import-historical-workbook.py" \
  --workbook "$importer_dir/workbook.xlsx"

status=$(MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
  "$node" --env-file=/etc/import-erp/migration-release.env \
  "$api_dir/dist/migrate.js" status)
if [[ $status == *'Migrations: 14 aplicadas, 1 pendentes.'* \
      && $status == *'pendente  M015_excel_error_columns.sql'* ]]; then
  python3 "$stage_dir/deploy/hostinger/validate-m015-on-copy.py"
  MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
    "$node" --env-file=/etc/import-erp/migration-release.env \
    "$api_dir/dist/migrate.js" up
elif [[ ${ERP_M015_RESUME:-false} == true \
        && $status == *'Migrations: 15 aplicadas, 0 pendentes.'* ]]; then
  backup=${ERP_M015_BACKUP:?Set the verified pre-release backup path}
  expected_sha=${ERP_M015_BACKUP_SHA256:?Set the verified backup SHA-256}
  [[ $backup == /var/backups/import-erp/erp_po_totvs_test_*.dump && -f $backup ]]
  actual_sha=$(sha256sum "$backup")
  [[ ${actual_sha%% *} == "$expected_sha" ]]
  echo "Resuming importer installation with verified backup $backup"
else
  echo 'Unexpected migration state; refusing M015 release.' >&2
  exit 1
fi

rollback_importer=/var/backups/import-erp/m015-importer-$(date -u +%Y%m%dT%H%M%SZ).py
cp -p "$importer_dir/import-historical-workbook.py" "$rollback_importer"
restore_importer() {
  trap - ERR
  cp -p "$rollback_importer" "$importer_dir/import-historical-workbook.py"
  echo "Previous importer restored from $rollback_importer; M015 remains applied." >&2
}
trap restore_importer ERR
install -m 0600 "$stage_dir/deploy/hostinger/import-historical-workbook.py" \
  "$importer_dir/import-historical-workbook.py"
install -m 0644 "$api_dir/migrations/M015_excel_error_columns.sql" \
  "$target_dir/migrations/M015_excel_error_columns.sql"

bash <(sed 's/\r$//' "$stage_dir/deploy/hostinger/verify-m015-operational.sh")
trap - ERR
echo "M015 installed; previous importer in $rollback_importer"
