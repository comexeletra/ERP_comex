#!/usr/bin/env bash
# Copy only the public server certificate for TLS verification on this VPS.
set -euo pipefail
container=$(docker ps --filter name=postgres_postgres --format '{{.ID}}' | head -n 1)
[[ -n ${container} ]]
target=/etc/import-erp/postgres-root.crt
if [[ -e ${target} ]]; then
  echo 'Pinned certificate already exists; refusing to replace it.' >&2
  exit 1
fi
docker cp "$container:/etc/postgres-ssl/server.crt" "$target"
chown root:import-erp "$target"
chmod 0640 "$target"
openssl x509 -in "$target" -noout -subject -issuer -fingerprint -sha256 -dates
exit 0
