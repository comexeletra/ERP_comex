#!/usr/bin/env bash
# Create the empty homologation database from the currently deployed migrations.
set -euo pipefail

readonly database=erp_po_totvs_hml
readonly runtime_role=import_erp_hml_app
readonly app_dir=/opt/import-erp/apps/api
readonly migration_env=/etc/import-erp/migration-release.env
readonly runtime_env=/etc/import-erp/homologation-db.env
readonly cert_file=/etc/import-erp/postgres-root.crt

[[ $EUID -eq 0 ]] || { echo 'Run this script as root.' >&2; exit 1; }
[[ -f $migration_env && -f $cert_file && -f $app_dir/dist/migrate.js ]]
[[ -d $app_dir/migrations ]]

container=$(docker ps --filter name=postgres_postgres --format '{{.ID}}' | head -n 1)
[[ -n $container ]] || { echo 'PostgreSQL container not found.' >&2; exit 1; }

expected_count=$(find "$app_dir/migrations" -maxdepth 1 -type f -name 'M[0-9][0-9][0-9]_*.sql' | wc -l)
[[ $expected_count -gt 0 ]] || { echo 'No migrations found.' >&2; exit 1; }
operational_count=$(docker exec "$container" psql -U "${POSTGRES_USER:-postgres}" \
  -d erp_po_totvs_test -Atc 'SELECT count(*) FROM migration.schema_migration')
operational_latest=$(docker exec "$container" psql -U "${POSTGRES_USER:-postgres}" \
  -d erp_po_totvs_test -Atc 'SELECT max(version) FROM migration.schema_migration')
repository_latest=$(find "$app_dir/migrations" -maxdepth 1 -type f -name 'M[0-9][0-9][0-9]_*.sql' \
  -printf '%f\n' | sort | tail -n 1)
[[ $operational_count == "$expected_count" && $operational_latest == "$repository_latest" ]] || {
  echo 'Operational ledger and deployed migration files are out of sync.' >&2
  exit 1
}

database_exists=$(docker exec "$container" psql -U "${POSTGRES_USER:-postgres}" \
  -d postgres -Atc "SELECT count(*) FROM pg_database WHERE datname='$database'")
role_exists=$(docker exec "$container" psql -U "${POSTGRES_USER:-postgres}" \
  -d postgres -Atc "SELECT count(*) FROM pg_roles WHERE rolname='$runtime_role'")
[[ $database_exists == 0 ]] || { echo "$database already exists; refusing to modify it." >&2; exit 1; }
[[ $role_exists == 0 ]] || { echo "$runtime_role already exists; refusing to rotate it." >&2; exit 1; }
[[ ! -e $runtime_env ]] || { echo "$runtime_env already exists; refusing to overwrite it." >&2; exit 1; }

database_password=$(openssl rand -hex 32)
gateway_token=$(openssl rand -hex 32)
session_secret=$(openssl rand -hex 32)

docker exec "$container" createdb -U "${POSTGRES_USER:-postgres}" \
  --owner=erp_po_totvs_migrator --encoding=UTF8 --template=template0 "$database"
docker exec "$container" psql -U "${POSTGRES_USER:-postgres}" -d "$database" \
  -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto' >/dev/null

docker exec -i "$container" psql -U "${POSTGRES_USER:-postgres}" -d postgres \
  -v ON_ERROR_STOP=1 <<SQL >/dev/null
CREATE ROLE $runtime_role LOGIN NOINHERIT CONNECTION LIMIT 10 PASSWORD '$database_password';
GRANT CONNECT ON DATABASE $database TO $runtime_role;
SQL

cd "$app_dir"
/opt/node-v24/bin/node --env-file="$migration_env" --input-type=module -e \
  'const url = new URL(process.env.MIGRATION_DATABASE_URL); url.pathname = "/erp_po_totvs_hml"; process.env.MIGRATION_DATABASE_URL = url.toString(); process.env.MIGRATION_ENV = "isolated"; process.argv[2] = "up"; await import("./dist/migrate.js");'

# M021/M031 seed workbook and example catalog values. Keep the structure, clear
# those rows so the homologation database starts with no business or catalog data.
docker exec "$container" psql -U "${POSTGRES_USER:-postgres}" -d "$database" \
  -v ON_ERROR_STOP=1 -c 'DELETE FROM catalog.operational_value' >/dev/null

docker exec -i "$container" psql -U "${POSTGRES_USER:-postgres}" -d "$database" \
  -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DO $$
DECLARE
  table_row record;
  has_rows boolean;
BEGIN
  FOR table_row IN
    SELECT schemaname, tablename
      FROM pg_tables
     WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
       AND NOT (schemaname = 'migration' AND tablename = 'schema_migration')
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I)', table_row.schemaname, table_row.tablename)
      INTO has_rows;
    IF has_rows THEN
      RAISE EXCEPTION 'Homologation database is not empty: %.%',
        table_row.schemaname, table_row.tablename;
    END IF;
  END LOOP;
END
$$;
SQL

for schema in migration procurement imports costs identity audit catalog jobs; do
  docker exec "$container" psql -U "${POSTGRES_USER:-postgres}" -d "$database" \
    -v ON_ERROR_STOP=1 -c "GRANT USAGE ON SCHEMA $schema TO $runtime_role" >/dev/null
  docker exec "$container" psql -U "${POSTGRES_USER:-postgres}" -d "$database" \
    -v ON_ERROR_STOP=1 -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA $schema TO $runtime_role" >/dev/null
  docker exec "$container" psql -U "${POSTGRES_USER:-postgres}" -d "$database" \
    -v ON_ERROR_STOP=1 -c "GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA $schema TO $runtime_role" >/dev/null
  docker exec "$container" psql -U "${POSTGRES_USER:-postgres}" -d "$database" \
    -v ON_ERROR_STOP=1 -c "ALTER DEFAULT PRIVILEGES FOR ROLE erp_po_totvs_migrator IN SCHEMA $schema GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO $runtime_role" >/dev/null
  docker exec "$container" psql -U "${POSTGRES_USER:-postgres}" -d "$database" \
    -v ON_ERROR_STOP=1 -c "ALTER DEFAULT PRIVILEGES FOR ROLE erp_po_totvs_migrator IN SCHEMA $schema GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO $runtime_role" >/dev/null
done

umask 077
temporary_file=$(mktemp /etc/import-erp/homologation-db.env.XXXXXX)
trap 'rm -f -- "$temporary_file"' EXIT
{
  printf 'DATABASE_URL=postgresql://%s:%s@127.0.0.1:5432/%s?uselibpqcompat=true&sslmode=verify-ca&sslrootcert=%s\n' \
    "$runtime_role" "$database_password" "$database" "$cert_file"
  printf 'DATABASE_POOL_MAX=5\n'
  printf 'GATEWAY_TOKEN=%s\n' "$gateway_token"
  printf 'AUTH_SESSION_SECRET=%s\n' "$session_secret"
  printf 'HOST=127.0.0.1\nPORT=4001\n'
} > "$temporary_file"
chown root:import-erp "$temporary_file"
chmod 0640 "$temporary_file"
mv -- "$temporary_file" "$runtime_env"
trap - EXIT

ledger_count=$(docker exec "$container" psql -U "${POSTGRES_USER:-postgres}" \
  -d "$database" -Atc 'SELECT count(*) FROM migration.schema_migration')
latest=$(docker exec "$container" psql -U "${POSTGRES_USER:-postgres}" \
  -d "$database" -Atc 'SELECT max(version) FROM migration.schema_migration')
catalog_count=$(docker exec "$container" psql -U "${POSTGRES_USER:-postgres}" \
  -d "$database" -Atc 'SELECT count(*) FROM catalog.operational_value')
[[ $ledger_count == "$expected_count" && $latest == "$repository_latest" && $catalog_count == 0 ]]

echo "Created empty $database at $latest ($ledger_count migrations); runtime config is $runtime_env."
