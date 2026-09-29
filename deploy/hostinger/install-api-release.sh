#!/usr/bin/env bash
# Install the reviewed API snapshot on a VPS where /opt/import-erp is absent.
set -euo pipefail

archive=/tmp/import-erp-api-release-20260929-v2.tar.gz
expected_sha256=4440e0c2bb2492acc5b27806b07a6b2d4327e3d302092422bf5896d8d4946f12
actual_sha256=$(sha256sum "$archive" | cut -d ' ' -f 1)
if [[ ${actual_sha256} != "${expected_sha256}" ]]; then
  echo 'Release archive checksum mismatch.' >&2
  exit 1
fi
if [[ -e /opt/import-erp ]]; then
  echo '/opt/import-erp already exists; refusing to replace it.' >&2
  exit 1
fi
if ! id import-erp >/dev/null 2>&1; then
  useradd --system --home /var/lib/import-erp --create-home --shell /usr/sbin/nologin import-erp
fi
install -d -o root -g root -m 0755 /opt/import-erp
install -d -o root -g import-erp -m 0750 /etc/import-erp
tar -xzf "$archive" -C /opt/import-erp

export PATH=/opt/node-v24/bin:$PATH
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
cd /opt/import-erp/apps/api
node --version
corepack pnpm --version
corepack pnpm install --frozen-lockfile --prod
test -f dist/server.js
test -f migrations/M008_quality_resolution_idempotency.sql
echo 'API release installed; service has not been started.'
exit 0
