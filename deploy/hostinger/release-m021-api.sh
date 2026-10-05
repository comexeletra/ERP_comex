#!/usr/bin/env bash
# Install the API code that consumes the already-applied M021 schema.
set -euo pipefail

stage_dir=${ERP_STAGE_DIR:?Set ERP_STAGE_DIR to the staged release under /tmp}
api_dir=$stage_dir/apps/api
target_dir=/opt/import-erp/apps/api
node=/opt/node-v24/bin/node
[[ $stage_dir == /tmp/erp-m021-api-* ]]
test -f "$api_dir/dist/server.js"
test -f "$api_dir/dist/catalog.js"
test -f "$api_dir/dist/operations.js"
test -f "$api_dir/dist/followup.js"
test -d "$target_dir/node_modules"
systemctl is-active --quiet import-erp-api

status=$(MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
  "$node" --env-file=/etc/import-erp/migration-release.env \
  "$api_dir/dist/migrate.js" status)
if [[ $status != *'Migrations: 21 aplicadas, 0 pendentes.'* ]]; then
  echo 'Expected M001-M021 applied with no pending migrations.' >&2
  exit 1
fi

rollback_dir=/var/backups/import-erp/m021-api-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$rollback_dir"
cp -a "$target_dir/dist" "$rollback_dir/dist"
cp -a "$target_dir/src" "$rollback_dir/src"
new_dist=$target_dir/.dist-m021-release
new_src=$target_dir/.src-m021-release
old_dist=$target_dir/.dist-m021-previous
old_src=$target_dir/.src-m021-previous
for path in "$new_dist" "$new_src" "$old_dist" "$old_src"; do
  if [[ -e $path ]]; then
    echo "Temporary API release path already exists: $path" >&2
    exit 1
  fi
done
cp -a "$api_dir/dist" "$new_dist"
cp -a "$api_dir/src" "$new_src"
chmod -R a+rX "$new_dist" "$new_src"
test -f "$new_dist/server.js"
grep -q 'operational-values' "$new_dist/catalog.js"

restore_api() {
  trap - ERR
  rm -rf -- "$target_dir/dist" "$target_dir/src"
  if [[ -e $old_dist ]]; then mv "$old_dist" "$target_dir/dist"; else cp -a "$rollback_dir/dist" "$target_dir/dist"; fi
  if [[ -e $old_src ]]; then mv "$old_src" "$target_dir/src"; else cp -a "$rollback_dir/src" "$target_dir/src"; fi
  systemctl restart import-erp-api
  echo "Previous API restored from $rollback_dir; M021 remains applied." >&2
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

rm -rf -- "$old_dist" "$old_src"
trap - ERR
echo "M021 API routes published; previous API is in $rollback_dir"
