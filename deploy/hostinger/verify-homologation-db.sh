#!/usr/bin/env bash
# Verify that every current ERP database has the complete migration ledger and
# that homologation contains only the two authentication accounts needed to log in.
set -euo pipefail

readonly expected_databases=(
  erp_po_totvs_test
  erp_po_totvs_gatewayflow_20261010_test
  erp_po_totvs_hml
)
readonly runtime_env=/etc/import-erp/homologation-db.env

container=$(docker ps --filter name=postgres_postgres --format '{{.ID}}' | head -n 1)
[[ -n $container ]] || { echo 'PostgreSQL container not found.' >&2; exit 1; }
readonly migrations_dir=${ERP_MIGRATIONS_DIR:-$(dirname "$0")/../../apps/api/migrations}
expected_count=$(find "$migrations_dir" -maxdepth 1 \
  -type f -name 'M[0-9][0-9][0-9]_*.sql' | wc -l)
expected_latest=$(find "$migrations_dir" -maxdepth 1 \
  -type f -name 'M[0-9][0-9][0-9]_*.sql' -printf '%f\n' | sort | tail -n 1)

for database in "${expected_databases[@]}"; do
  count=$(docker exec "$container" psql -U "${POSTGRES_USER:-postgres}" -d "$database" \
    -Atc 'SELECT count(*) FROM migration.schema_migration')
  latest=$(docker exec "$container" psql -U "${POSTGRES_USER:-postgres}" -d "$database" \
    -Atc 'SELECT max(version) FROM migration.schema_migration')
  [[ $count == "$expected_count" && $latest == "$expected_latest" ]] || {
    echo "$database is behind: $count migrations, latest $latest; expected $expected_count and $expected_latest." >&2
    exit 1
  }
  printf '%s: %s/%s (%s)\n' "$database" "$count" "$expected_count" "$latest"
done

docker exec "$container" psql -U "${POSTGRES_USER:-postgres}" -d erp_po_totvs_hml \
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
       AND NOT (schemaname = 'identity' AND tablename IN
         ('erp_user', 'local_credential', 'erp_user_role', 'user_admin_event'))
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
DO $$
BEGIN
  IF (SELECT count(*) FROM identity.erp_user) <> 2
     OR (SELECT count(*) FROM identity.local_credential) <> 2
     OR (SELECT count(*) FROM identity.erp_user_role WHERE role = 'Master') <> 2
     OR (SELECT count(*) FROM identity.user_admin_event WHERE action = 'bootstrap') <> 2 THEN
    RAISE EXCEPTION 'Homologation must contain exactly two bootstrapped Master accounts.';
  END IF;
END
$$;
SQL

seed_count=$(docker exec "$container" psql -U "${POSTGRES_USER:-postgres}" -d erp_po_totvs_hml \
  -Atc 'SELECT count(*) FROM catalog.operational_value')
[[ $seed_count == 0 ]] || { echo 'Homologation catalog has seeded data.' >&2; exit 1; }
homologation_select=$(docker exec "$container" psql -U "${POSTGRES_USER:-postgres}" \
  -d erp_po_totvs_hml -Atc "SELECT has_table_privilege('import_erp_hml_app','procurement.purchase_order','SELECT')")
production_select=$(docker exec "$container" psql -U "${POSTGRES_USER:-postgres}" \
  -d erp_po_totvs_test -Atc "SELECT has_table_privilege('import_erp_hml_app','procurement.purchase_order','SELECT')")
[[ $homologation_select == t && $production_select == f ]] || {
  echo 'Homologation runtime grants are missing or include operational PO access.' >&2
  exit 1
}
[[ -f $runtime_env ]] || { echo 'Homologation runtime environment is missing.' >&2; exit 1; }
[[ $(stat -c '%a %U:%G' "$runtime_env") == '640 root:import-erp' ]] || {
  echo 'Homologation runtime environment has unexpected ownership or permissions.' >&2
  exit 1
}
echo 'Homologation has no business/catalog data; only two Master authentication accounts and the migration ledger are populated.'
