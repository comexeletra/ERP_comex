#!/usr/bin/env bash
# Install the scoped PO portfolio summary without changing the database.
set -euo pipefail

stage_dir=${ERP_STAGE_DIR:?Set ERP_STAGE_DIR to the staged release under /tmp}
[[ $stage_dir == /tmp/* ]]
source_dir=$stage_dir/apps/api
target_dir=/opt/import-erp/apps/api
node=/opt/node-v24/bin/node
test -f "$source_dir/src/purchase-orders.ts"
test -f "$source_dir/dist/purchase-orders.js"
systemctl is-active --quiet import-erp-api

rollback_dir=/var/backups/import-erp/portfolio-summary-api-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$rollback_dir"
cp -p "$target_dir/src/purchase-orders.ts" "$rollback_dir/purchase-orders.ts"
cp -p "$target_dir/dist/purchase-orders.js" "$rollback_dir/purchase-orders.js"

restore_api() {
  trap - ERR
  cp -p "$rollback_dir/purchase-orders.ts" "$target_dir/src/purchase-orders.ts"
  cp -p "$rollback_dir/purchase-orders.js" "$target_dir/dist/purchase-orders.js"
  systemctl restart import-erp-api
  echo "Previous PO API restored from $rollback_dir" >&2
}
trap restore_api ERR

install -m 0644 "$source_dir/src/purchase-orders.ts" "$target_dir/src/purchase-orders.ts"
install -m 0644 "$source_dir/dist/purchase-orders.js" "$target_dir/dist/purchase-orders.js"
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

"$node" --env-file=/etc/import-erp/api.env --input-type=module <<'JS'
const origin = `https://${process.env.PUBLIC_API_HOST ?? 'api.72-60-250-212.sslip.io'}`;
const response = await fetch(`${origin}/api/v1/purchase-orders/summary`, {
  headers: { 'x-import-erp-gateway-token': process.env.GATEWAY_TOKEN },
});
console.log(`anonymous portfolio summary: ${response.status}`);
if (response.status !== 401) process.exitCode = 1;
JS

trap - ERR
echo "Portfolio summary API installed; previous code in $rollback_dir"
