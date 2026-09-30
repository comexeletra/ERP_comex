#!/usr/bin/env bash
# Deploy the RF06 read-only API change validated in the temporary package.
set -euo pipefail

source_dir=/tmp/rf06-validation-20260930/apps/api
target_dir=/opt/import-erp/apps/api
backup_dir=/var/backups/import-erp/rf06-api-$(date -u +%Y%m%dT%H%M%SZ)

test -f "$source_dir/src/purchase-orders.ts"
test -f "$source_dir/dist/purchase-orders.js"
test -f "$target_dir/src/purchase-orders.ts"
test -f "$target_dir/dist/purchase-orders.js"
printf '%s  %s\n' \
  66fc5aed902c8bbab69e43b7164a498ed28da08d48e138c8d76e2d2becea4378 "$source_dir/src/purchase-orders.ts" \
  fb38c52eacd88a66eb9467affa25fad559405fae2fb10f14bfc9f799696ec593 "$source_dir/dist/purchase-orders.js" \
  | sha256sum -c -
systemctl is-active --quiet import-erp-api
install -d -m 0700 "$backup_dir"
cp -p "$target_dir/src/purchase-orders.ts" "$backup_dir/purchase-orders.ts"
cp -p "$target_dir/dist/purchase-orders.js" "$backup_dir/purchase-orders.js"

restore() {
  cp -p "$backup_dir/purchase-orders.ts" "$target_dir/src/purchase-orders.ts"
  cp -p "$backup_dir/purchase-orders.js" "$target_dir/dist/purchase-orders.js"
  systemctl restart import-erp-api
  echo "RF06 API rolled back from $backup_dir" >&2
}
trap restore ERR
install -m 0644 "$source_dir/src/purchase-orders.ts" "$target_dir/src/purchase-orders.ts"
install -m 0644 "$source_dir/dist/purchase-orders.js" "$target_dir/dist/purchase-orders.js"
systemctl restart import-erp-api
systemctl is-active --quiet import-erp-api
ready=false
for attempt in 1 2 3 4 5; do
  if bash /tmp/rf06-validation-20260930/deploy/hostinger/verify-public-api.sh; then
    ready=true
    break
  fi
  sleep 2
done
test "$ready" = true
trap - ERR
echo "RF06 API installed; rollback files: $backup_dir"
