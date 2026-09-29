#!/usr/bin/env bash
# Read-only PostgreSQL TLS metadata; does not print keys or credentials.
set -euo pipefail
container=$(docker ps --filter name=postgres_postgres --format '{{.ID}}' | head -n 1)
[[ -n ${container} ]]
docker exec -i "$container" sh -lc 'exec psql -U "${POSTGRES_USER:-postgres}" -d postgres -v ON_ERROR_STOP=1 -P pager=off' <<'SQL'
SELECT name, setting FROM pg_settings
WHERE name IN ('ssl', 'ssl_cert_file', 'ssl_ca_file') ORDER BY name;
SQL
openssl version
exit 0
