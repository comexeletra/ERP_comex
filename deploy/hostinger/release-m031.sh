#!/usr/bin/env bash
# Validate M031 on a restored copy, then apply it to the selected operational DB.
set -euo pipefail

stage_dir=${ERP_STAGE_DIR:?Set ERP_STAGE_DIR to the staged release under /tmp}
[[ $stage_dir == /tmp/erp-m031-* ]]
api_dir=$stage_dir/apps/api
node=/opt/node-v24/bin/node
test -f "$api_dir/dist/migrate.js"
test -f "$api_dir/migrations/M031_group_operational_value.sql"
test -d "$api_dir/node_modules"
systemctl is-active --quiet import-erp-api

migrate() {
  MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
    "$node" --env-file=/etc/import-erp/migration-release.env \
    "$api_dir/dist/migrate.js" "$1"
}

status=$(migrate status)
if [[ $status != *'Migrations: 30 aplicadas, 1 pendentes.'* \
      || $status != *'pendente  M031_group_operational_value.sql'* ]]; then
  echo 'Expected M001-M030 applied and only M031 pending.' >&2
  exit 1
fi

python3 "$stage_dir/deploy/hostinger/validate-m031-on-copy.py"
migrate up
status=$(migrate status)
[[ $status == *'Migrations: 31 aplicadas, 0 pendentes.'* ]]

container=$(docker ps --filter name=postgres_postgres --format '{{.ID}}' | head -n 1)
values=$(docker exec "$container" sh -lc \
  'psql -U "${POSTGRES_USER:-postgres}" -d erp_po_totvs_test -Atc "SELECT string_agg(value, '\''|'\'' ORDER BY value) FROM catalog.operational_value WHERE entity_key='\''GROUP'\''"')
[[ $values == 'Energy|Livoltek|Recloser|Water' ]]

install -m 0644 "$api_dir/migrations/M031_group_operational_value.sql" \
  /opt/import-erp/apps/api/migrations/
echo 'M031 applied; GROUP values: Energy, Livoltek, Recloser, Water.'
