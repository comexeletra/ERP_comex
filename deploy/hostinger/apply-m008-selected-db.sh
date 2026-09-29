#!/usr/bin/env bash
# Apply reviewed M008 only to the user-selected erp_po_totvs_test database.
set -euo pipefail
backup=/var/backups/import-erp/erp_po_totvs_test_20260929T144804Z.dump
expected_sha256=0b5ddab3fc8aa588538ddbceaff9ebe9daffe52f89b627a20eb2fa024b98f99c
[[ $(sha256sum "$backup" | cut -d ' ' -f 1) == "${expected_sha256}" ]]
container=$(docker ps --filter name=postgres_postgres --format '{{.ID}}' | head -n 1)
[[ -n ${container} ]]
review_count=$(docker exec "$container" sh -lc 'psql -U "${POSTGRES_USER:-postgres}" -d erp_po_totvs_test -Atc "SELECT count(*) FROM migration.quality_review"')
[[ ${review_count} == 0 ]]
cd /opt/import-erp/apps/api
env_file=/etc/import-erp/migration-release.env
status=$(MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true /opt/node-v24/bin/node --env-file="$env_file" dist/migrate.js status)
printf '%s\n' "$status"
if [[ ${status} != *'Migrations: 7 aplicadas, 1 pendentes.'* ]] || [[ ${status} != *'pendente  M008_quality_resolution_idempotency.sql'* ]]; then
  echo 'Unexpected migration status; no DDL applied.' >&2
  exit 1
fi
MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true /opt/node-v24/bin/node --env-file="$env_file" dist/migrate.js up
MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true /opt/node-v24/bin/node --env-file="$env_file" dist/migrate.js status
exit 0
