#!/usr/bin/env bash
# Provision the API role and environment for the user-selected ERP database.
set -euo pipefail
container=$(docker ps --filter name=postgres_postgres --format '{{.ID}}' | head -n 1)
[[ -n ${container} ]]
env_file=/etc/import-erp/api.env
cert_file=/etc/import-erp/postgres-root.crt
test -f "$cert_file"
if [[ -e ${env_file} ]]; then
  echo 'API environment already exists; refusing to overwrite.' >&2
  exit 1
fi
role_exists=$(docker exec "$container" sh -lc 'psql -U "${POSTGRES_USER:-postgres}" -d postgres -Atc "SELECT count(*) FROM pg_roles WHERE rolname = '\''import_erp_app'\''"')
if [[ ${role_exists} != 0 ]]; then
  echo 'import_erp_app already exists; refusing to rotate an unknown password.' >&2
  exit 1
fi

database_password=$(openssl rand -hex 32)
gateway_token=$(openssl rand -hex 32)
session_secret=$(openssl rand -hex 32)
docker exec -i "$container" sh -lc 'exec psql -U "${POSTGRES_USER:-postgres}" -d erp_po_totvs_test -v ON_ERROR_STOP=1' <<SQL >/dev/null
BEGIN;
CREATE ROLE import_erp_app LOGIN NOINHERIT CONNECTION LIMIT 10 PASSWORD '${database_password}';
GRANT CONNECT ON DATABASE erp_po_totvs_test TO import_erp_app;
GRANT USAGE ON SCHEMA migration, procurement, imports, costs, identity, audit TO import_erp_app;
GRANT SELECT ON
  identity.erp_user, identity.erp_user_role, identity.erp_user_importer_scope,
  identity.auth_session, identity.oidc_login_transaction,
  procurement.purchase_order, procurement.po_line_observation,
  procurement.process_purchase_order, imports.import_process, costs.process_cost,
  migration.data_issue, migration.source_row, migration.quality_review
TO import_erp_app;
GRANT INSERT, UPDATE, DELETE ON identity.auth_session TO import_erp_app;
GRANT INSERT, DELETE ON identity.oidc_login_transaction TO import_erp_app;
GRANT INSERT ON migration.quality_review TO import_erp_app;
GRANT UPDATE ON migration.data_issue TO import_erp_app;
GRANT INSERT ON audit.audit_log, audit.outbox_message TO import_erp_app;
COMMIT;
SQL

umask 077
temporary_file=$(mktemp /etc/import-erp/api.env.XXXXXX)
trap 'rm -f -- "$temporary_file"' EXIT
{
  printf 'DATABASE_URL=postgresql://import_erp_app:%s@127.0.0.1:5432/erp_po_totvs_test?uselibpqcompat=true&sslmode=verify-ca&sslrootcert=/etc/import-erp/postgres-root.crt\n' "$database_password"
  printf 'DATABASE_POOL_MAX=5\n'
  printf 'GATEWAY_TOKEN=%s\n' "$gateway_token"
  printf 'AUTH_SESSION_SECRET=%s\n' "$session_secret"
  printf 'APP_PUBLIC_ORIGIN=https://fup-comex-eletra.vercel.app\n'
  printf 'HOST=127.0.0.1\nPORT=4000\n'
} > "$temporary_file"
chown root:import-erp "$temporary_file"
chmod 0640 "$temporary_file"
mv -- "$temporary_file" "$env_file"
trap - EXIT

cd /opt/import-erp/apps/api
runuser -u import-erp -- /opt/node-v24/bin/node --env-file="$env_file" --input-type=module -e 'import pg from "pg"; const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, max: 1}); try { const r = await pool.query("SELECT current_user, current_database(), (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS tls, has_schema_privilege(current_user, '\''migration'\'', '\''CREATE'\'') AS can_create_schema_objects, has_table_privilege(current_user, '\''migration.quality_review'\'', '\''INSERT'\'') AS can_insert_review"); console.log(r.rows[0]); } finally { await pool.end(); }'
echo 'API role and /etc/import-erp/api.env created without printing secrets.'
exit 0
