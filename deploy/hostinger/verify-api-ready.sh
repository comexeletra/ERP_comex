#!/usr/bin/env bash
set -euo pipefail
cd /opt/import-erp/apps/api
/opt/node-v24/bin/node --env-file=/etc/import-erp/api.env --input-type=module <<'JS'
const origin = `http://${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? '4000'}`;
const live = await fetch(`${origin}/health/live`);
const rejected = await fetch(`${origin}/health/ready`);
const ready = await fetch(`${origin}/health/ready`, {
  headers: { 'x-import-erp-gateway-token': process.env.GATEWAY_TOKEN },
});
console.log({ live: live.status, unauthenticatedReady: rejected.status, authenticatedReady: ready.status });
if (live.status !== 200 || rejected.status !== 401 || ready.status !== 200) process.exitCode = 1;
JS
systemctl is-enabled import-erp-api
systemctl is-active import-erp-api
exit 0
