#!/usr/bin/env bash
set -euo pipefail

stage_dir=/tmp/erp-m012-validation-20261002T183804Z
source_dir=$stage_dir/apps/api
target_dir=/opt/import-erp/apps/api

test -f "$source_dir/src/requests.ts"
test -f "$source_dir/dist/requests.js"
test -f "$source_dir/migrations/M012_native_request_editing.sql"
test -f "$source_dir/dist/migrate.js"
systemctl is-active --quiet import-erp-api

status=$(MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
  /opt/node-v24/bin/node --env-file=/etc/import-erp/migration-release.env \
  "$source_dir/dist/migrate.js" status)
[[ $status == *'Migrations: 11 aplicadas, 1 pendentes.'* \
   && $status == *'pendente  M012_native_request_editing.sql'* ]]

# Cria backup operacional novo, restaura uma cópia temporária e exercita a migration.
python3 "$stage_dir/deploy/hostinger/validate-m012-on-copy.py"

MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
  /opt/node-v24/bin/node --env-file=/etc/import-erp/migration-release.env \
  "$source_dir/dist/migrate.js" up
status=$(MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
  /opt/node-v24/bin/node --env-file=/etc/import-erp/migration-release.env \
  "$source_dir/dist/migrate.js" status)
[[ $status == *'Migrations: 12 aplicadas, 0 pendentes.'* ]]

# Arquivos da rota anterior são mantidos para rollback de código; M012 permanece.
rollback_dir=/var/backups/import-erp/m012-api-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$rollback_dir"
cp -p "$target_dir/src/requests.ts" "$rollback_dir/requests.ts"
cp -p "$target_dir/dist/requests.js" "$rollback_dir/requests.js"

restore_api() {
  trap - ERR
  cp -p "$rollback_dir/requests.ts" "$target_dir/src/requests.ts"
  cp -p "$rollback_dir/requests.js" "$target_dir/dist/requests.js"
  systemctl restart import-erp-api
  echo "Código anterior restaurado de $rollback_dir; M012 continua aplicada." >&2
}
trap restore_api ERR

install -m 0644 "$source_dir/migrations/M012_native_request_editing.sql" \
  "$target_dir/migrations/M012_native_request_editing.sql"
install -m 0644 "$source_dir/src/requests.ts" "$target_dir/src/requests.ts"
install -m 0644 "$source_dir/dist/requests.js" "$target_dir/dist/requests.js"
systemctl restart import-erp-api

ready=false
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if bash "$stage_dir/deploy/hostinger/verify-api-ready.sh" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
test "$ready" = true

/opt/node-v24/bin/node --env-file=/etc/import-erp/api.env --input-type=module <<'JS'
const origin = `https://${process.env.PUBLIC_API_HOST ?? 'api.72-60-250-212.sslip.io'}`;
const response = await fetch(`${origin}/api/v1/requests`, {
  headers: { 'x-import-erp-gateway-token': process.env.GATEWAY_TOKEN },
});
console.log(`request route without user session: ${response.status}`);
if (response.status !== 401) process.exitCode = 1;
JS

MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
  /opt/node-v24/bin/node --env-file=/etc/import-erp/migration-release.env \
  "$target_dir/dist/migrate.js" status
trap - ERR
echo "M012 API instalada; código anterior em $rollback_dir"
