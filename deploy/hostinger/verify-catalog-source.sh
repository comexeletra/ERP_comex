#!/usr/bin/env bash
set -euo pipefail
catalog_migration_url=$(sed -n 's/^MIGRATION_DATABASE_URL=//p' /etc/import-erp/migration-release.env)
test -n "$catalog_migration_url"
if [[ $catalog_migration_url != *'/erp_po_totvs_test?'* ]]; then
  echo 'Unexpected database target.' >&2
  exit 1
fi
catalog_psql_url=${catalog_migration_url/uselibpqcompat=true&/}
psql "$catalog_psql_url" -X -v ON_ERROR_STOP=1 \
  -f /tmp/erp-catalog-validation-20261001/verify-catalog-source.sql
