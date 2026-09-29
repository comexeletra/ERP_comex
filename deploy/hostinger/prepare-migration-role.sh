#!/usr/bin/env bash
# Rotate the dedicated migrator credential and verify localhost access.
set -euo pipefail
container=$(docker ps --filter name=postgres_postgres --format '{{.ID}}' | head -n 1)
[[ -n ${container} ]]
env_file=/etc/import-erp/migration-release.env
cert_file=/etc/import-erp/postgres-root.crt
test -f "$cert_file"
if [[ -e ${env_file} ]]; then
  echo 'Migration environment file already exists; refusing to overwrite.' >&2
  exit 1
fi
active=$(docker exec "$container" sh -lc 'psql -U "${POSTGRES_USER:-postgres}" -d postgres -Atc "SELECT count(*) FROM pg_stat_activity WHERE usename = '\''erp_po_totvs_migrator'\'' AND pid <> pg_backend_pid()"')
if [[ ${active} != 0 ]]; then
  echo "Migrator has ${active} active connection(s); refusing password rotation." >&2
  exit 1
fi
password=$(openssl rand -hex 32)
docker exec -i "$container" sh -lc 'exec psql -U "${POSTGRES_USER:-postgres}" -d postgres -v ON_ERROR_STOP=1' <<SQL >/dev/null
ALTER ROLE erp_po_totvs_migrator WITH PASSWORD '${password}';
SQL
umask 077
printf 'MIGRATION_DATABASE_URL=postgresql://erp_po_totvs_migrator:%s@127.0.0.1:5432/erp_po_totvs_test?uselibpqcompat=true&sslmode=verify-ca&sslrootcert=%s\n' "$password" "$cert_file" > "$env_file"
chown root:root "$env_file"
chmod 0600 "$env_file"
cd /opt/import-erp/apps/api
/opt/node-v24/bin/node --env-file="$env_file" --input-type=module -e 'import pg from "pg"; const pool = new pg.Pool({connectionString: process.env.MIGRATION_DATABASE_URL, max: 1}); try { const result = await pool.query("SELECT current_user, current_database()"); console.log(result.rows[0]); } finally { await pool.end(); }'
echo 'Migration credential is stored only in /etc/import-erp/migration-release.env.'
exit 0
