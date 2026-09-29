#!/usr/bin/env bash
# Install the reviewed unit and verify local API/PostgreSQL readiness.
set -euo pipefail
unit=/etc/systemd/system/import-erp-api.service
if [[ -e ${unit} ]]; then
  echo 'API systemd unit already exists; refusing to overwrite.' >&2
  exit 1
fi
systemd-analyze verify /tmp/import-erp-api.service
install -o root -g root -m 0644 /tmp/import-erp-api.service "$unit"
systemctl daemon-reload
systemctl enable --now import-erp-api
systemctl is-active import-erp-api
cd /opt/import-erp/apps/api
/opt/node-v24/bin/node --env-file=/etc/import-erp/api.env --input-type=module -e 'const origin = `http://${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? "4000"}`; const response = await fetch(`${origin}/health/ready`, {headers: {"x-import-erp-gateway-token": process.env.GATEWAY_TOKEN}}); console.log("ready", response.status, await response.text()); if (!response.ok) process.exitCode = 1;'
exit 0
