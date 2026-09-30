#!/usr/bin/env bash
# Backup and restore-check the explicitly selected ERP database on the VPS.
set -euo pipefail

container=$(docker ps --filter name=postgres_postgres --format '{{.ID}}' | head -n 1)
if [[ -z ${container} ]]; then
  echo 'postgres_postgres container not found' >&2
  exit 1
fi
backup_dir=/var/backups/import-erp
install -d -o root -g root -m 0700 "$backup_dir"
expected_migrations=$(docker exec "$container" sh -lc 'psql -U "${POSTGRES_USER:-postgres}" -d erp_po_totvs_test -Atc "SELECT count(*) FROM migration.schema_migration"')
if [[ ! ${expected_migrations} =~ ^[0-9]+$ ]] || (( expected_migrations < 9 )); then
  echo "Unexpected migration ledger before backup: ${expected_migrations}." >&2
  exit 1
fi
backup="$backup_dir/erp_po_totvs_test_$(date -u +%Y%m%dT%H%M%SZ).dump"
temporary_file=$(mktemp "$backup_dir/.dump.XXXXXX")
restore_db="erp_restorecheck_$(date -u +%Y%m%d%H%M%S)_$$"
restore_created=false
cleanup() {
  rm -f -- "$temporary_file"
  if [[ ${restore_created} == true ]]; then
    docker exec "$container" sh -lc 'dropdb -U "${POSTGRES_USER:-postgres}" --if-exists --force "$1"' sh "$restore_db" >/dev/null
  fi
}
trap cleanup EXIT

docker exec "$container" sh -lc 'exec pg_dump -U "${POSTGRES_USER:-postgres}" -d erp_po_totvs_test -Fc --no-owner --no-acl' > "$temporary_file"
test -s "$temporary_file"
docker exec -i "$container" sh -lc 'exec pg_restore --list' < "$temporary_file" >/dev/null
chmod 0600 "$temporary_file"
mv -- "$temporary_file" "$backup"

docker exec "$container" sh -lc 'createdb -U "${POSTGRES_USER:-postgres}" "$1"' sh "$restore_db"
restore_created=true
docker exec -i "$container" sh -lc 'exec pg_restore -U "${POSTGRES_USER:-postgres}" -d "$1" --no-owner --no-acl' sh "$restore_db" < "$backup"
migration_count=$(docker exec "$container" sh -lc 'psql -U "${POSTGRES_USER:-postgres}" -d "$1" -Atc "SELECT count(*) FROM migration.schema_migration"' sh "$restore_db")
if [[ ${migration_count} != ${expected_migrations} ]]; then
  echo "Restore check expected ${expected_migrations} migrations, found ${migration_count}." >&2
  exit 1
fi
printf 'Backup: %s\n' "$backup"
printf 'SHA256: '
sha256sum "$backup" | cut -d ' ' -f 1
printf 'Restore check: %s migrations found in temporary database.\n' "$migration_count"
exit 0
