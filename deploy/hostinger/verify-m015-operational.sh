#!/usr/bin/env bash
# Check only ledger and derived flags; do not read or rewrite source values.
set -euo pipefail

url=$(sed -n 's/^MIGRATION_DATABASE_URL=//p' /etc/import-erp/migration-release.env)
[[ $url == *'/erp_po_totvs_test?'* ]]
psql_url=${url/uselibpqcompat=true&/}
check=$(psql "$psql_url" -X -v ON_ERROR_STOP=1 -Atc \
  "SELECT (SELECT count(*) FROM migration.schema_migration), \
          EXISTS (SELECT 1 FROM migration.schema_migration \
                  WHERE version='M015_excel_error_columns.sql'), \
          (SELECT count(*) FROM migration.source_row \
                  WHERE jsonb_array_length(error_columns)>0), \
          (SELECT coalesce(sum(jsonb_array_length(error_columns)),0) \
                  FROM migration.source_row), \
          (SELECT count(*) FROM migration.data_issue \
                  WHERE issue_code='EXCEL_CELL_ERROR')")
[[ $check == '15|t|277|306|306' ]]
echo 'M015 operational ledger and original Excel error flags passed: 277 rows, 306 cells.'
