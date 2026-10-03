#!/usr/bin/env bash
# Read-only check of the operational ledger, view grant and runtime query.
set -euo pipefail

migration_url=$(sed -n 's/^MIGRATION_DATABASE_URL=//p' /etc/import-erp/migration-release.env)
api_url=$(sed -n 's/^DATABASE_URL=//p' /etc/import-erp/api.env)
[[ $migration_url == *'/erp_po_totvs_test?'* && $api_url == *'/erp_po_totvs_test?'* ]]
migration_psql_url=${migration_url/uselibpqcompat=true&/}
api_psql_url=${api_url/uselibpqcompat=true&/}

check=$(psql "$migration_psql_url" -X -v ON_ERROR_STOP=1 -Atc \
  "SELECT (SELECT count(*) FROM migration.schema_migration), \
          EXISTS (SELECT 1 FROM migration.schema_migration \
                  WHERE version = 'M013_request_history_read.sql'), \
          to_regclass('audit.import_request_history') IS NOT NULL, \
          has_schema_privilege('import_erp_app','audit','USAGE'), \
          has_table_privilege('import_erp_app','audit.import_request_history','SELECT')")
[[ $check == '13|t|t|t|t' ]]

event_count=$(psql "$api_psql_url" -X -v ON_ERROR_STOP=1 -Atc \
  'SELECT count(*) FROM audit.import_request_history')
[[ $event_count =~ ^[0-9]+$ ]]
echo "M013 operational ledger and runtime view read passed; events: $event_count"
