#!/usr/bin/env bash
set -euo pipefail

# Test the production-documented M021 baseline with existing PO/IP rows.
cd "$(dirname "$0")/../../apps/api"
stage="$(mktemp -d "$PWD/.migration-m021-ci.XXXXXX")"
trap 'rm -rf -- "$stage"' EXIT
mkdir -p "$stage/dist" "$stage/migrations"
cp dist/migrate.js "$stage/dist/migrate.js"
find migrations -maxdepth 1 -type f -name 'M[0-9][0-9][0-9]_*.sql' \
  | sort | while IFS= read -r migration; do
    number="${migration#*/M}"
    number="${number%%_*}"
    if (( 10#$number <= 21 )); then cp "$migration" "$stage/migrations/"; fi
  done

PGPASSWORD=ci-only-password createdb -h 127.0.0.1 -U import_erp_ci import_erp_m021_ci
export MIGRATION_ENV=isolated
export MIGRATION_DATABASE_URL='postgresql://import_erp_ci:ci-only-password@127.0.0.1:5432/import_erp_m021_ci'
node "$stage/dist/migrate.js" up

psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO procurement.purchase_order
  (id, importer, external_number, normalized_number, source_kind, version)
VALUES ('00000000-0000-4000-8000-000000000101', 'CI UPGRADE', 'PO-UPGRADE', 'PO-UPGRADE', 'MANUAL_TOTVS_REFERENCE', 7);
INSERT INTO procurement.purchase_order_item
  (id, purchase_order_id, line_number, product_code, description, ordered_quantity, unit, sc_approval_date)
VALUES ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000101', 1,
  'PROD-UPGRADE', 'Produto existente', 100, 'PC', '2026-08-01');
INSERT INTO imports.import_process
  (id, importer, ip_number, normalized_ip_number, source_kind, version, etd)
VALUES ('00000000-0000-4000-8000-000000000103', 'CI UPGRADE', 'IP-UPGRADE', 'IP-UPGRADE', 'MANUAL', 4, '2026-09-01');
INSERT INTO procurement.po_item_allocation
  (id, purchase_order_item_id, process_id, quantity)
VALUES ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103', 40);
SQL

cp migrations/M02{2,3,4}_*.sql "$stage/migrations/"
node "$stage/dist/migrate.js" up
status="$(node "$stage/dist/migrate.js" status)"
grep -Fq 'Migrations: 24 aplicadas, 0 pendentes.' <<< "$status"

psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM procurement.purchase_order po
    JOIN procurement.purchase_order_item item ON item.purchase_order_id=po.id
    JOIN procurement.po_item_allocation allocation ON allocation.purchase_order_item_id=item.id
    JOIN imports.import_process ip ON ip.id=allocation.process_id
    WHERE po.id='00000000-0000-4000-8000-000000000101'
      AND po.version=7 AND item.sc_approval_date='2026-08-01'
      AND item.ordered_quantity=100 AND allocation.quantity=40
      AND ip.version=4 AND ip.etd='2026-09-01'
      AND ip.lifecycle_status='OPEN' AND ip.actual_port_departure_date IS NULL
  ) THEN
    RAISE EXCEPTION 'M021 to M024 upgrade changed an existing PO/IP allocation or date';
  END IF;
  IF NOT has_table_privilege('import_erp_app', 'audit.purchase_order_operational_history', 'SELECT')
     OR NOT has_table_privilege('import_erp_app', 'audit.import_process_operational_history', 'SELECT') THEN
    RAISE EXCEPTION 'M022 operational history grants are missing';
  END IF;
END;
$$;
SQL

echo 'M021 → M024 upgrade preserved existing PO/IP data and grants.'
