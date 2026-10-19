#!/usr/bin/env bash
# Start a separate API process and HTTPS route for Vercel Preview.
set -euo pipefail

readonly env_file=/etc/import-erp/homologation-db.env
readonly unit_file=/etc/systemd/system/import-erp-hml-api.service
readonly edge_file=/opt/import-erp/homologation-edge.yml
readonly hostname=api-hml.72-60-250-212.sslip.io
readonly gateway=172.18.0.1

[[ $EUID -eq 0 ]] || { echo 'Run this script as root.' >&2; exit 1; }
[[ -n ${PREVIEW_PUBLIC_ORIGIN:-} ]] || {
  echo 'Set PREVIEW_PUBLIC_ORIGIN to the stable HTTPS Vercel Preview alias.' >&2
  exit 1
}
[[ $PREVIEW_PUBLIC_ORIGIN =~ ^https://[A-Za-z0-9.-]+\.vercel\.app$ ]] || {
  echo 'PREVIEW_PUBLIC_ORIGIN must be a bare HTTPS *.vercel.app origin.' >&2
  exit 1
}
[[ -f $env_file && -f /opt/import-erp/apps/api/dist/server.js ]]
docker network inspect matheuspronet >/dev/null
[[ $(ip -4 -o addr show docker_gwbridge | awk '{print $4}' | cut -d/ -f1) == "$gateway" ]]

database=$(node --env-file="$env_file" --input-type=module -e \
  'const url = new URL(process.env.DATABASE_URL); process.stdout.write(url.pathname.slice(1))')
[[ $database == erp_po_totvs_hml ]] || { echo 'Refusing to start against a non-homologation database.' >&2; exit 1; }

export PREVIEW_PUBLIC_ORIGIN
node --env-file="$env_file" --input-type=module -e \
  'const fs = await import("node:fs/promises"); const file = "/etc/import-erp/homologation-db.env"; const content = await fs.readFile(file, "utf8"); const current = content.match(/^APP_PUBLIC_ORIGIN=(.*)$/m)?.[1]; if (current && current !== process.env.PREVIEW_PUBLIC_ORIGIN) throw new Error("APP_PUBLIC_ORIGIN does not match the requested Preview origin."); if (!current) await fs.appendFile(file, `APP_PUBLIC_ORIGIN=${process.env.PREVIEW_PUBLIC_ORIGIN}\n`);'

if grep -qx 'HOST=127.0.0.1' "$env_file"; then
  sed -i "s/^HOST=127\.0\.0\.1$/HOST=${gateway}/" "$env_file"
else
  grep -qx "HOST=${gateway}" "$env_file"
fi

cat > "$edge_file" <<YAML
http:
  routers:
    erp-homologation:
      rule: PathPrefix(\`/\`)
      entryPoints:
        - web
      service: erp-homologation
  services:
    erp-homologation:
      loadBalancer:
        servers:
          - url: http://${gateway}:4001
YAML
chown root:root "$edge_file"
chmod 0644 "$edge_file"

install -o root -g root -m 0644 \
  "$(dirname "$0")/import-erp-hml-api.service" "$unit_file"
systemd-analyze verify "$unit_file"
systemctl daemon-reload
systemctl enable --now import-erp-hml-api
systemctl is-active --quiet import-erp-hml-api

cd /opt/import-erp/apps/api
ready=false
for attempt in {1..10}; do
  if /opt/node-v24/bin/node --env-file="$env_file" --input-type=module -e \
    'const origin = `http://${process.env.HOST}:${process.env.PORT}`; let response; try { response = await fetch(`${origin}/health/ready`, {headers: {"x-import-erp-gateway-token": process.env.GATEWAY_TOKEN}}); } catch {} process.exit(response?.ok ? 0 : 1);'; then
    ready=true
    break
  fi
  sleep 1
done
[[ $ready == true ]] || { echo 'Homologation API did not pass its authenticated readiness check.' >&2; exit 1; }

if ! docker service inspect import_erp_hml_edge >/dev/null 2>&1; then
  docker service create \
    --name import_erp_hml_edge \
    --network matheuspronet \
    --replicas 1 \
    --constraint 'node.role==manager' \
    --mount "type=bind,source=${edge_file},target=/etc/traefik/edge.yml,readonly" \
    --label 'traefik.enable=true' \
    --label "traefik.http.routers.import-erp-hml.rule=Host(\`${hostname}\`)" \
    --label 'traefik.http.routers.import-erp-hml.entrypoints=websecure' \
    --label 'traefik.http.routers.import-erp-hml.tls.certresolver=letsencryptresolver' \
    --label 'traefik.http.routers.import-erp-hml.service=import-erp-hml' \
    --label 'traefik.http.services.import-erp-hml.loadbalancer.server.port=8080' \
    traefik:v3.4.0 \
    --entrypoints.web.address=:8080 \
    --providers.file.filename=/etc/traefik/edge.yml \
    --log.level=INFO
else
  echo 'import_erp_hml_edge already exists; keeping the existing isolated route.'
fi

curl --retry 8 --retry-delay 2 --retry-connrefused --fail --silent --show-error \
  "https://${hostname}/health/live" >/dev/null
status=$(curl --silent --output /dev/null --write-out '%{http_code}' \
  "https://${hostname}/health/ready")
[[ $status == 401 ]] || { echo "Expected unauthenticated readiness 401, got $status." >&2; exit 1; }
echo "Homologation API is ready at https://${hostname}; Preview origin: ${PREVIEW_PUBLIC_ORIGIN}"
