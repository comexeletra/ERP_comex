#!/usr/bin/env bash
set -euo pipefail

stage_dir=${ERP_STAGE_DIR:?Set ERP_STAGE_DIR to the staged release under /tmp}
[[ $stage_dir == /tmp/erp-m026-api-* ]]
api_dir=$stage_dir/apps/api
target_dir=/opt/import-erp/apps/api
node=/opt/node-v24/bin/node
test -f "$api_dir/dist/server.js"
test -f "$api_dir/dist/migrate.js"
test -f "$stage_dir/deploy/hostinger/validate-m026-api-on-copy.py"
test -d "$target_dir/node_modules"
systemctl is-active --quiet import-erp-api

if [[ ! -e $api_dir/node_modules ]]; then
  ln -s "$target_dir/node_modules" "$api_dir/node_modules"
fi

status=$(ALLOW_PRODUCTION_MIGRATIONS=true MIGRATION_ENV=production \
  "$node" --env-file=/etc/import-erp/migration-release.env \
  "$api_dir/dist/migrate.js" status)
[[ $status == *'Migrations: 26 aplicadas, 0 pendentes.'* ]]
ERP_STAGE_DIR=$stage_dir python3 "$stage_dir/deploy/hostinger/validate-m026-api-on-copy.py"

new_dist=$target_dir/.dist-m026-api-release
new_src=$target_dir/.src-m026-api-release
old_dist=$target_dir/.dist-m026-api-previous
old_src=$target_dir/.src-m026-api-previous
for path in "$new_dist" "$new_src" "$old_dist" "$old_src"; do
  if [[ -e $path ]]; then
    echo "Temporary API release path already exists: $path" >&2
    exit 1
  fi
done

rollback_dir=/var/backups/import-erp/m026-api-followup-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$rollback_dir"
cp -a "$target_dir/dist" "$rollback_dir/dist"
cp -a "$target_dir/src" "$rollback_dir/src"
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
  echo "Previous API restored from $rollback_dir." >&2
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

mv "$old_dist" "$rollback_dir/previous-dist"
mv "$old_src" "$rollback_dir/previous-src"
trap - ERR
echo "Follow-up API released; previous code is in $rollback_dir"
