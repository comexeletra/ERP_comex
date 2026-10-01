#!/usr/bin/env bash
set -euo pipefail
request_migration_url=$(sed -n 's/^MIGRATION_DATABASE_URL=//p' /etc/import-erp/migration-release.env)
test -n "$request_migration_url"
[[ $request_migration_url == *'/erp_po_totvs_test?'* ]]
request_psql_url=${request_migration_url/uselibpqcompat=true&/}
psql "$request_psql_url" -X -v ON_ERROR_STOP=1 \
  -f /tmp/erp-request-validation-20261001/deploy/hostinger/verify-m011-operational.sql
