#!/usr/bin/env bash
set -euo pipefail

token=$(sed -n 's/^GATEWAY_TOKEN=//p' /etc/import-erp/api.env)
test "${#token}" -ge 32
status=$(printf 'header = "x-import-erp-gateway-token: %s"\n' "$token" |
  curl --config - --fail --silent --show-error --output /dev/null \
    --write-out '%{http_code}' \
    https://api.72-60-250-212.sslip.io/health/ready)
unset token
test "$status" = 200
printf 'public HTTPS ready: %s\n' "$status"
exit 0
