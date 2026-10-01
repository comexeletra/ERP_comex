#!/usr/bin/env bash
# Install the read-only source audit endpoint from a compiled temporary package.
set -euo pipefail

stage_dir=${1:?usage: release-source-audit.sh STAGED_API_DIR}
source_dir=$stage_dir
target_dir=/opt/import-erp/apps/api

for file in src/server.ts src/source-audit.ts dist/server.js dist/source-audit.js; do
  test -f "$source_dir/$file"
done
systemctl is-active --quiet import-erp-api

rollback_dir=/var/backups/import-erp/source-audit-api-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$rollback_dir"
cp -p "$target_dir/src/server.ts" "$rollback_dir/server.ts"
cp -p "$target_dir/dist/server.js" "$rollback_dir/server.js"
had_previous=false
if [[ -e $target_dir/src/source-audit.ts && -e $target_dir/dist/source-audit.js ]]; then
  had_previous=true
  cp -p "$target_dir/src/source-audit.ts" "$rollback_dir/source-audit.ts"
  cp -p "$target_dir/dist/source-audit.js" "$rollback_dir/source-audit.js"
elif [[ -e $target_dir/src/source-audit.ts || -e $target_dir/dist/source-audit.js ]]; then
  echo 'Source audit files are inconsistent; refusing an ambiguous release.' >&2
  exit 1
fi

restore_api() {
  trap - ERR
  cp -p "$rollback_dir/server.ts" "$target_dir/src/server.ts"
  cp -p "$rollback_dir/server.js" "$target_dir/dist/server.js"
  if [[ $had_previous == true ]]; then
    cp -p "$rollback_dir/source-audit.ts" "$target_dir/src/source-audit.ts"
    cp -p "$rollback_dir/source-audit.js" "$target_dir/dist/source-audit.js"
  else
    rm -f -- "$target_dir/src/source-audit.ts" "$target_dir/dist/source-audit.js"
  fi
  systemctl restart import-erp-api
  echo "API restored from $rollback_dir" >&2
}
trap restore_api ERR

install -m 0644 "$source_dir/src/source-audit.ts" "$target_dir/src/source-audit.ts"
install -m 0644 "$source_dir/src/server.ts" "$target_dir/src/server.ts"
install -m 0644 "$source_dir/dist/source-audit.js" "$target_dir/dist/source-audit.js"
install -m 0644 "$source_dir/dist/server.js" "$target_dir/dist/server.js"
systemctl restart import-erp-api

ready=false
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if /opt/node-v24/bin/node --env-file=/etc/import-erp/api.env --input-type=module <<'JS'
const origin = `http://${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? '4000'}`;
const live = await fetch(`${origin}/health/live`);
const rejected = await fetch(`${origin}/health/ready`);
const ready = await fetch(`${origin}/health/ready`, {
  headers: { 'x-import-erp-gateway-token': process.env.GATEWAY_TOKEN },
});
if (live.status !== 200 || rejected.status !== 401 || ready.status !== 200) process.exitCode = 1;
JS
  then
    ready=true
    break
  fi
  sleep 2
done
test "$ready" = true

# A gateway-authenticated request without a user session must be rejected by
# the registered route's authorization layer (401), rather than return 404.
/opt/node-v24/bin/node --env-file=/etc/import-erp/api.env --input-type=module <<'JS'
const origin = `https://${process.env.PUBLIC_API_HOST ?? 'api.72-60-250-212.sslip.io'}`;
const response = await fetch(`${origin}/api/v1/source-rows?sheet=Pr%C3%A9%20Embarque`, {
  headers: { 'x-import-erp-gateway-token': process.env.GATEWAY_TOKEN },
});
console.log(`source audit without user session: ${response.status}`);
if (response.status !== 401) process.exitCode = 1;
JS

trap - ERR
echo "Source audit API installed; code rollback files: $rollback_dir"
