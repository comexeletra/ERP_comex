#!/usr/bin/env bash
set -euo pipefail

# Exercise the same runner first with the previous schema, then with the full
# checkout. Seeded outbox and source rows catch data loss and verify the latest
# migration's Excel error backfill without touching the operational database.
cd "$(dirname "$0")/../../apps/api"
mapfile -t migrations < <(find migrations -maxdepth 1 -type f -name 'M[0-9][0-9][0-9]_*.sql' | sort)
if (( ${#migrations[@]} < 2 )); then
  echo 'Upgrade check requires at least two migrations.' >&2
  exit 1
fi
latest_migration="${migrations[${#migrations[@]}-1]}"

stage="$(mktemp -d "$PWD/.migration-upgrade-ci.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/dist" "$stage/migrations"
cp dist/migrate.js "$stage/dist/migrate.js"
for migration in "${migrations[@]:0:${#migrations[@]}-1}"; do
  cp "$migration" "$stage/migrations/"
done

PGPASSWORD=ci-only-password createdb -h 127.0.0.1 -U import_erp_ci import_erp_upgrade_ci
export MIGRATION_DATABASE_URL='postgresql://import_erp_ci:ci-only-password@127.0.0.1:5432/import_erp_upgrade_ci'
node "$stage/dist/migrate.js" up

psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO audit.outbox_message
  (event_id, event_type, aggregate_type, aggregate_id, payload, occurred_at)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'CI.UPGRADE', 'CI',
   '00000000-0000-4000-8000-000000000002', '{"source":"migration-upgrade-ci"}', now());
SQL

if [[ $latest_migration == migrations/M015_excel_error_columns.sql ]]; then
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO migration.import_batch
  (id, file_name, file_sha256, mapping_version, state, source_row_count)
VALUES
  ('00000000-0000-4000-8000-000000000003', 'ci-fixture.xlsx', repeat('a', 64),
   'ci-upgrade', 'PROMOTED', 1);
INSERT INTO migration.source_row
  (id, batch_id, sheet_name, row_number, raw_values, row_hash)
VALUES
  ('00000000-0000-4000-8000-000000000004',
   '00000000-0000-4000-8000-000000000003', 'Pré Embarque', 5,
   '{"S":"#N/A","N":"PO-1"}', repeat('b', 64));
INSERT INTO migration.data_issue
  (id, batch_id, source_row_id, severity, issue_code, field_name, evidence)
VALUES
  ('00000000-0000-4000-8000-000000000005',
   '00000000-0000-4000-8000-000000000003',
   '00000000-0000-4000-8000-000000000004', 'WARNING',
   'EXCEL_CELL_ERROR', 'S', '{"column":"S","value":"#N/A"}');
SQL
fi

previous_count="$((${#migrations[@]} - 1))"
status="$(corepack pnpm migrate:status)"
printf '%s\n' "$status"
grep -Fq "Migrations: ${previous_count} aplicadas, 1 pendentes." <<< "$status"

corepack pnpm migrate:up
status="$(corepack pnpm migrate:status)"
printf '%s\n' "$status"
grep -Fq "Migrations: ${#migrations[@]} aplicadas, 0 pendentes." <<< "$status"

psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF (SELECT count(*) FROM audit.outbox_message
      WHERE event_id = '00000000-0000-4000-8000-000000000001'
        AND payload = '{"source":"migration-upgrade-ci"}'::jsonb) <> 1 THEN
    RAISE EXCEPTION 'Seeded outbox event was lost or changed by upgrade';
  END IF;
END;
$$;
SQL

if [[ $latest_migration == migrations/M015_excel_error_columns.sql ]]; then
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF (SELECT error_columns FROM migration.source_row
      WHERE id = '00000000-0000-4000-8000-000000000004') <> '["S"]'::jsonb THEN
    RAISE EXCEPTION 'Excel error column was not backfilled';
  END IF;
  IF (SELECT raw_values FROM migration.source_row
      WHERE id = '00000000-0000-4000-8000-000000000004') <>
      '{"S":"#N/A","N":"PO-1"}'::jsonb THEN
    RAISE EXCEPTION 'Raw workbook cells changed during upgrade';
  END IF;
END;
$$;
SQL
fi
