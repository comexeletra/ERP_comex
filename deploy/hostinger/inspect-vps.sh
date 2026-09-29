#!/usr/bin/env bash
# Read-only deployment inspection; never prints service environment variables.
set -u

printf 'DISK\n'
df -h / /var/lib/docker
printf 'NODE\n'
command -v node || true
node --version || true
if [[ -x /opt/node-v24/bin/node ]]; then /opt/node-v24/bin/node --version; fi
printf 'SWARM\n'
docker info --format '{{.Swarm.LocalNodeState}}'
docker service ls --format '{{.Name}} {{.Replicas}} {{.Ports}}' | grep -Ei 'postgres|traefik' || true
printf 'POSTGRES\n'
docker service inspect postgres_postgres --format '{{json .Endpoint.Ports}} {{range .Spec.TaskTemplate.Networks}}{{.Target}} {{end}}'
docker ps --filter name=postgres_postgres --format '{{.ID}} {{.Names}}'
printf 'TRAEFIK\n'
docker service inspect traefik_traefik --format '{{json .Endpoint.Ports}} {{range .Spec.TaskTemplate.Networks}}{{.Target}} {{end}}'
docker service inspect traefik_traefik --format '{{range .Spec.TaskTemplate.ContainerSpec.Args}}{{println .}}{{end}}' | grep -Ei 'providers|entrypoints|certificatesresolvers|acme' || true
printf 'NETWORKS\n'
docker network ls --format '{{.ID}} {{.Name}}' | head -n 30
exit 0
