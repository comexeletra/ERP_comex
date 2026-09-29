#!/usr/bin/env bash
# Restore a backup into a temporary DB and apply the current migration runner.
set -euo pipefail
container=$(docker ps --filter name=postgres_postgres --format '{{.ID}}' | head -n 1)
[[ -n ${container} ]]
backup=/var/backups/import-erp/erp_po_totvs_test_20260929T144804Z.dump
expected_sha256=0b5ddab3fc8aa588538ddbceaff9ebe9daffe52f89b627a20eb2fa024b98f99c
actual_sha256=$(sha256sum "$backup" | cut -d ' ' -f 1)
[[ ${actual_sha256} == "${expected_sha256}" ]]
restore_db="erp_m008_check_$(date -u +%Y%m%d%H%M%S)_$$"
temp_env=$(mktemp /etc/import-erp/migration-validation.XXXXXX)
restore_created=false
cleanup() {
  rm -f -- "$temp_env"
  if [[ ${restore_created} == true ]]; then
    docker exec "$container" sh -lc 'dropdb -U "${POSTGRES_USER:-postgres}" --if-exists --force "$1"' sh "$restore_db" >/dev/null
  fi
}
trap cleanup EXIT

docker exec "$container" sh -lc 'createdb -U "${POSTGRES_USER:-postgres}" -O erp_po_totvs_migrator "$1"' sh "$restore_db"
restore_created=true
docker exec -i "$container" sh -lc 'exec pg_restore -U "${POSTGRES_USER:-postgres}" --role=erp_po_totvs_migrator --no-owner --no-acl -d "$1"' sh "$restore_db" < "$backup"

export RESTORE_DB="$restore_db" TEMP_ENV="$temp_env"
python3 - <<'PY'
import os
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
line = Path('/etc/import-erp/migration-release.env').read_text().strip()
if not line.startswith('MIGRATION_DATABASE_URL='):
    raise SystemExit('Unexpected migration credential file')
url = urlsplit(line.split('=', 1)[1])
test_url = urlunsplit((url.scheme, url.netloc, '/' + os.environ['RESTORE_DB'], url.query, ''))
Path(os.environ['TEMP_ENV']).write_text('MIGRATION_ENV=isolated\nMIGRATION_DATABASE_URL=' + test_url + '\n')
PY
chmod 0600 "$temp_env"
cd /opt/import-erp/apps/api
/opt/node-v24/bin/node --env-file="$temp_env" dist/migrate.js status
/opt/node-v24/bin/node --env-file="$temp_env" dist/migrate.js up
/opt/node-v24/bin/node --env-file="$temp_env" dist/migrate.js status
count=$(docker exec "$container" sh -lc 'psql -U "${POSTGRES_USER:-postgres}" -d "$1" -Atc "SELECT count(*) FROM migration.schema_migration"' sh "$restore_db")
[[ ${count} == 8 ]]
echo 'M008 passed on the restored copy; temporary database will be removed.'
exit 0
