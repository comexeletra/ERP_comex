#!/usr/bin/env bash
# Confirm the migration ledger and least-privilege reads.
set -euo pipefail

url=$(sed -n 's/^MIGRATION_DATABASE_URL=//p' /etc/import-erp/migration-release.env)
[[ $url == *'/erp_po_totvs_test?'* ]]
psql_url=${url/uselibpqcompat=true&/}
check=$(psql "$psql_url" -X -v ON_ERROR_STOP=1 -Atc \
  "SELECT (SELECT count(*) FROM migration.schema_migration), \
          EXISTS (SELECT 1 FROM migration.schema_migration \
                  WHERE version='M016_import_batch_snapshot_read.sql'), \
          EXISTS (SELECT 1 FROM migration.schema_migration \
                  WHERE version='M017_catalog_entry_history.sql'), \
          has_table_privilege('import_erp_app','audit.catalog_entry_history','SELECT'), \
          position('CATALOG_ENTRY' in pg_get_viewdef('audit.catalog_entry_history'::regclass, true)) > 0, \
          has_column_privilege('import_erp_app','migration.import_batch','id','SELECT'), \
          has_column_privilege('import_erp_app','migration.import_batch','promoted_at','SELECT'), \
          NOT has_column_privilege('import_erp_app','migration.import_batch','file_name','SELECT')")
[[ $check == '17|t|t|t|t|t|t|t' ]]
echo 'M016-M017 operational ledger and least-privilege reads passed.'
