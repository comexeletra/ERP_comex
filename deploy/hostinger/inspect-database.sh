#!/usr/bin/env bash
# Read-only metadata for the ERP database selected on the VPS.
set -euo pipefail
container=$(docker ps --filter name=postgres_postgres --format '{{.ID}}' | head -n 1)
if [[ -z ${container} ]]; then
  echo 'postgres_postgres container not found' >&2
  exit 1
fi
docker exec -i "$container" sh -lc 'exec psql -U "${POSTGRES_USER:-postgres}" -d erp_po_totvs_test -v ON_ERROR_STOP=1 -P pager=off' <<'SQL'
SELECT current_database() AS database_name,
       current_user AS connected_as,
       pg_size_pretty(pg_database_size(current_database())) AS database_size,
       current_setting('server_version') AS postgres_version;
SELECT version, checksum, applied_at FROM migration.schema_migration ORDER BY version;
SELECT 'purchase_orders' AS item, count(*) AS rows FROM procurement.purchase_order
UNION ALL SELECT 'import_batches', count(*) FROM migration.import_batch
UNION ALL SELECT 'data_issues', count(*) FROM migration.data_issue
UNION ALL SELECT 'erp_users', count(*) FROM identity.erp_user
UNION ALL SELECT 'auth_sessions', count(*) FROM identity.auth_session
UNION ALL SELECT 'outbox_messages', count(*) FROM audit.outbox_message;
SELECT rolname, rolcanlogin FROM pg_roles
WHERE rolname ~ 'erp|import|migrat' ORDER BY rolname;
SELECT nspname AS schema_name, pg_get_userbyid(nspowner) AS owner
FROM pg_namespace WHERE nspname IN ('migration', 'procurement', 'imports', 'costs', 'identity', 'audit')
ORDER BY nspname;
SELECT schemaname, tablename, tableowner FROM pg_tables
WHERE schemaname IN ('migration', 'procurement', 'imports', 'costs', 'identity', 'audit')
ORDER BY schemaname, tablename;
SQL
exit 0
