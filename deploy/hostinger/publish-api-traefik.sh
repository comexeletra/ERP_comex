#!/usr/bin/env bash
set -euo pipefail

# Run on the VPS after the API service and /etc/import-erp/api.env exist.
# The existing shared Traefik service discovers this separate Swarm service.
api_env=/etc/import-erp/api.env
edge_config=/opt/import-erp/edge.yml
hostname=api.72-60-250-212.sslip.io
gateway=172.18.0.1

test "$(id -u)" -eq 0
test -f "$api_env"
test -d /opt/import-erp
test "$(ip -4 -o addr show docker_gwbridge | awk '{print $4}' | cut -d/ -f1)" = "$gateway"
docker network inspect matheuspronet >/dev/null
if docker service inspect import_erp_edge >/dev/null 2>&1; then
  echo 'import_erp_edge already exists; inspect before changing it.' >&2
  exit 1
fi

cat > "$edge_config" <<YAML
http:
  routers:
    erp:
      rule: PathPrefix(\`/\`)
      entryPoints:
        - web
      service: erp
  services:
    erp:
      loadBalancer:
        servers:
          - url: http://${gateway}:4000
YAML
chown root:root "$edge_config"
chmod 0644 "$edge_config"

if grep -qx 'HOST=127.0.0.1' "$api_env"; then
  sed -i "s/^HOST=127\.0\.0\.1$/HOST=${gateway}/" "$api_env"
  systemctl restart import-erp-api
else
  grep -qx "HOST=${gateway}" "$api_env"
fi
systemctl is-active --quiet import-erp-api
curl --retry 5 --retry-delay 1 --retry-connrefused --fail --silent --show-error "http://${gateway}:4000/health/live" >/dev/null

docker service create \
  --name import_erp_edge \
  --network matheuspronet \
  --replicas 1 \
  --constraint 'node.role==manager' \
  --mount "type=bind,source=${edge_config},target=/etc/traefik/edge.yml,readonly" \
  --label 'traefik.enable=true' \
  --label "traefik.http.routers.import-erp.rule=Host(\`${hostname}\`)" \
  --label 'traefik.http.routers.import-erp.entrypoints=websecure' \
  --label 'traefik.http.routers.import-erp.tls.certresolver=letsencryptresolver' \
  --label 'traefik.http.routers.import-erp.service=import-erp' \
  --label 'traefik.http.services.import-erp.loadbalancer.server.port=8080' \
  traefik:v3.4.0 \
  --entrypoints.web.address=:8080 \
  --providers.file.filename=/etc/traefik/edge.yml \
  --log.level=INFO

echo "API hostname: https://${hostname}"
exit 0
