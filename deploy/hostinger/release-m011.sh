#!/usr/bin/env bash
# Run on the selected VPS after local builds/tests and restored-copy validation.
set -euo pipefail

stage_dir=/tmp/erp-request-validation-20261001
source_dir=$stage_dir/apps/api
target_dir=/opt/import-erp/apps/api

test -f "$source_dir/src/requests.ts"
test -f "$source_dir/dist/requests.js"
test -f "$source_dir/migrations/M011_native_requests.sql"
systemctl is-active --quiet import-erp-api

status=$(MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
  /opt/node-v24/bin/node --env-file=/etc/import-erp/migration-release.env \
  "$source_dir/dist/migrate.js" status)
if [[ $status == *'Migrations: 10 aplicadas, 1 pendentes.'* \
   && $status == *'pendente  M011_native_requests.sql'* ]]; then
  # This makes a fresh protected backup and restores it into a disposable DB,
  # then applies M011 to that restored copy before touching the selected DB.
  python3 "$stage_dir/deploy/hostinger/validate-m011-on-copy.py"
  MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
    /opt/node-v24/bin/node --env-file=/etc/import-erp/migration-release.env \
    "$source_dir/dist/migrate.js" up
  status=$(MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
    /opt/node-v24/bin/node --env-file=/etc/import-erp/migration-release.env \
    "$source_dir/dist/migrate.js" status)
fi
[[ $status == *'Migrations: 11 aplicadas, 0 pendentes.'* ]]

rollback_dir=/var/backups/import-erp/rf03-m011-api-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$rollback_dir"
for file in src/authorization.ts src/server.ts dist/authorization.js dist/server.js package.json; do
  cp -p "$target_dir/$file" "$rollback_dir/$(basename "$file")"
done
if [[ -e $target_dir/src/requests.ts || -e $target_dir/dist/requests.js ]]; then
  echo 'Request route already exists in target; refusing an ambiguous release.' >&2
  exit 1
fi

restore_api() {
  trap - ERR
  cp -p "$rollback_dir/authorization.ts" "$target_dir/src/authorization.ts"
  cp -p "$rollback_dir/server.ts" "$target_dir/src/server.ts"
  cp -p "$rollback_dir/authorization.js" "$target_dir/dist/authorization.js"
  cp -p "$rollback_dir/server.js" "$target_dir/dist/server.js"
  cp -p "$rollback_dir/package.json" "$target_dir/package.json"
  rm -f -- "$target_dir/src/requests.ts" "$target_dir/dist/requests.js" \
    "$target_dir/migrations/M011_native_requests.sql"
  systemctl restart import-erp-api
  echo "API code restored from $rollback_dir. M011 remains applied." >&2
}
trap restore_api ERR
install -m 0644 "$source_dir/migrations/M011_native_requests.sql" "$target_dir/migrations/M011_native_requests.sql"
install -m 0644 "$source_dir/src/authorization.ts" "$target_dir/src/authorization.ts"
install -m 0644 "$source_dir/src/requests.ts" "$target_dir/src/requests.ts"
install -m 0644 "$source_dir/src/server.ts" "$target_dir/src/server.ts"
install -m 0644 "$source_dir/dist/authorization.js" "$target_dir/dist/authorization.js"
install -m 0644 "$source_dir/dist/requests.js" "$target_dir/dist/requests.js"
install -m 0644 "$source_dir/dist/server.js" "$target_dir/dist/server.js"
install -m 0644 "$source_dir/package.json" "$target_dir/package.json"
systemctl restart import-erp-api
ready=false
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if bash "$stage_dir/deploy/hostinger/verify-api-ready.sh" >/dev/null 2>&1; then ready=true; break; fi
  sleep 2
done
test "$ready" = true
/opt/node-v24/bin/node --env-file=/etc/import-erp/api.env --input-type=module <<'JS'
const origin = `https://${process.env.PUBLIC_API_HOST ?? 'api.72-60-250-212.sslip.io'}`;
const response = await fetch(`${origin}/api/v1/requests`, {
  headers: { 'x-import-erp-gateway-token': process.env.GATEWAY_TOKEN },
});
console.log(`anonymous request route: ${response.status}`);
if (response.status !== 401) process.exitCode = 1;
JS
trap - ERR
echo "M011 API installed; code rollback files: $rollback_dir"
