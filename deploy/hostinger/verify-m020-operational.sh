#!/usr/bin/env bash
set -euo pipefail

token=$(sed -n 's/^GATEWAY_TOKEN=//p' /etc/import-erp/api.env)
test "${#token}" -ge 32
base=https://api.72-60-250-212.sslip.io
ready=$(printf 'header = "x-import-erp-gateway-token: %s"\n' "$token" |
  curl --config - --silent --show-error --output /dev/null --write-out '%{http_code}' "$base/health/ready")
followup=$(printf 'header = "x-import-erp-gateway-token: %s"\n' "$token" |
  curl --config - --silent --show-error --output /dev/null --write-out '%{http_code}' \
    "$base/api/v1/purchase-orders/00000000-0000-4000-8000-000000000001/followup")
unset token
test "$ready" = 200
test "$followup" = 401
printf 'public HTTPS ready: %s; unauthenticated followup route: %s\n' "$ready" "$followup"
