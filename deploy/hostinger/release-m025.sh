#!/usr/bin/env bash
# Release M025 and matching API after backup and restored-copy validation.
set -euo pipefail

stage_dir=${ERP_STAGE_DIR:?Set ERP_STAGE_DIR to the staged release under /tmp}
[[ $stage_dir == /tmp/erp-m025-* ]]
api_dir=$stage_dir/apps/api
target_dir=/opt/import-erp/apps/api
node=/opt/node-v24/bin/node
test -f "$api_dir/dist/server.js"
test -f "$api_dir/dist/migrate.js"
test -f "$api_dir/dist/followup.js"
test -f "$api_dir/migrations/M025_allocation_factory_ship_date.sql"
test -f "$api_dir/test/operations.integration.mjs"
test -f "$api_dir/test/followup.integration.mjs"
test -f "$stage_dir/deploy/hostinger/validate-m025-on-copy.py"
test -d "$target_dir/node_modules"
systemctl is-active --quiet import-erp-api

if [[ ! -e $api_dir/node_modules ]]; then
  ln -s "$target_dir/node_modules" "$api_dir/node_modules"
fi

migrate() {
  MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
    "$node" --env-file=/etc/import-erp/migration-release.env \
    "$api_dir/dist/migrate.js" "$1"
}
status=$(migrate status)
if [[ $status != *'Migrations: 24 aplicadas, 1 pendentes.'* \
      || $status != *'pendente  M025_allocation_factory_ship_date.sql'* ]]; then
  echo 'Expected M001-M024 applied and only M025 pending.' >&2
  exit 1
fi

python3 "$stage_dir/deploy/hostinger/validate-m025-on-copy.py"

rollback_dir=/var/backups/import-erp/m025-api-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$rollback_dir"
cp -a "$target_dir/dist" "$rollback_dir/dist"
cp -a "$target_dir/src" "$rollback_dir/src"
migrate up
status=$(migrate status)
[[ $status == *'Migrations: 25 aplicadas, 0 pendentes.'* ]]

new_dist=$target_dir/.dist-m025-release
new_src=$target_dir/.src-m025-release
old_dist=$target_dir/.dist-m025-previous
old_src=$target_dir/.src-m025-previous
for path in "$new_dist" "$new_src" "$old_dist" "$old_src"; do
  if [[ -e $path ]]; then
    echo "Temporary API release path already exists: $path" >&2
    exit 1
  fi
done
cp -a "$api_dir/dist" "$new_dist"
cp -a "$api_dir/src" "$new_src"
chmod -R a+rX "$new_dist" "$new_src"

restore_api() {
  trap - ERR
  if [[ -e $target_dir/dist ]]; then mv "$target_dir/dist" "$rollback_dir/failed-dist"; fi
  if [[ -e $target_dir/src ]]; then mv "$target_dir/src" "$rollback_dir/failed-src"; fi
  if [[ -e $old_dist ]]; then mv "$old_dist" "$target_dir/dist"; else cp -a "$rollback_dir/dist" "$target_dir/dist"; fi
  if [[ -e $old_src ]]; then mv "$old_src" "$target_dir/src"; else cp -a "$rollback_dir/src" "$target_dir/src"; fi
  systemctl restart import-erp-api
  echo "Previous API restored from $rollback_dir; M025 remains applied." >&2
}
trap restore_api ERR

mv "$target_dir/dist" "$old_dist"
mv "$new_dist" "$target_dir/dist"
mv "$target_dir/src" "$old_src"
mv "$new_src" "$target_dir/src"
systemctl restart import-erp-api

ready=false
for attempt in {1..15}; do
  if bash <(sed 's/\r$//' "$stage_dir/deploy/hostinger/verify-api-ready.sh") >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
test "$ready" = true

install -d "$target_dir/migrations"
install -m 0644 "$api_dir/migrations/M025_allocation_factory_ship_date.sql" "$target_dir/migrations/"
mv "$old_dist" "$rollback_dir/previous-dist"
mv "$old_src" "$rollback_dir/previous-src"
trap - ERR
echo "M025 and API published; previous API in $rollback_dir"
