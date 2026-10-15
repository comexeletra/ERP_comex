#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
log_dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/import-erp-system-e2e"
mkdir -p "$log_dir"
: >"$log_dir/api.log"
: >"$log_dir/web.log"
: >"$log_dir/worker.log"

: "${DATABASE_URL:?Set DATABASE_URL to a disposable local *_ci or *_test database}"
: "${GATEWAY_FLOW_DB_URL:=$DATABASE_URL}"
: "${GATEWAY_FLOW_WEB_ORIGIN:=http://127.0.0.1:3000}"
: "${GATEWAY_TOKEN:=ci-only-gateway-token-at-least-32-characters}"
: "${API_DEV_TOKEN:=$GATEWAY_TOKEN}"
: "${API_DEV_ORIGIN:=http://127.0.0.1:4000}"
: "${APP_PUBLIC_ORIGIN:=$GATEWAY_FLOW_WEB_ORIGIN}"
: "${AUTH_SESSION_SECRET:=ci-only-session-secret-at-least-32-characters-long}"
export DATABASE_URL GATEWAY_FLOW_DB_URL GATEWAY_FLOW_WEB_ORIGIN
export GATEWAY_TOKEN API_DEV_TOKEN API_DEV_ORIGIN APP_PUBLIC_ORIGIN AUTH_SESSION_SECRET
export NODE_ENV=development

node --input-type=module <<'NODE'
for (const name of ["DATABASE_URL", "GATEWAY_FLOW_DB_URL"]) {
  const value = process.env[name];
  const url = new URL(value);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(url.hostname)
    || !/(?:_ci|_test)$/u.test(database)) {
    throw new Error(`${name} must point to a local disposable *_ci or *_test database.`);
  }
}
const apiDatabase = new URL(process.env.DATABASE_URL);
const testDatabase = new URL(process.env.GATEWAY_FLOW_DB_URL);
if (apiDatabase.hostname !== testDatabase.hostname || apiDatabase.port !== testDatabase.port
  || apiDatabase.pathname !== testDatabase.pathname) {
  throw new Error("DATABASE_URL and GATEWAY_FLOW_DB_URL must point to the same local test database.");
}
NODE

api_pid=""
web_pid=""
worker_pid=""
cleanup() {
  for pid in "$web_pid" "$worker_pid" "$api_pid"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  for pid in "$web_pid" "$worker_pid" "$api_pid"; do
    if [[ -n "$pid" ]]; then wait "$pid" 2>/dev/null || true; fi
  done
}
trap cleanup EXIT

(
  cd "$repo_root/apps/api"
  exec node dist/server.js
) >"$log_dir/api.log" 2>&1 &
api_pid=$!

(
  cd "$repo_root/apps/api"
  exec node dist/worker.js
) >"$log_dir/worker.log" 2>&1 &
worker_pid=$!

(
  cd "$repo_root/apps/web"
  export API_DEV_ORIGIN API_DEV_TOKEN NEXT_TELEMETRY_DISABLED=1
  exec node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3000
) >"$log_dir/web.log" 2>&1 &
web_pid=$!

wait_for_url() {
  local url="$1"
  local label="$2"
  for _ in $(seq 1 60); do
    if curl --fail --silent --show-error "$url" >/dev/null 2>&1; then
      printf '%s is ready\n' "$label"
      return 0
    fi
    if ! kill -0 "$api_pid" 2>/dev/null || ! kill -0 "$web_pid" 2>/dev/null; then
      break
    fi
    sleep 2
  done
  printf '%s did not become ready. Logs follow.\n' "$label" >&2
  tail -n 100 "$log_dir/api.log" "$log_dir/web.log" >&2 || true
  return 1
}

wait_for_url http://127.0.0.1:4000/health/live "API"
wait_for_url http://127.0.0.1:3000/login "Next.js"

for _ in $(seq 1 30); do
  if grep -Fq '"event":"export_worker_started"' "$log_dir/worker.log"; then
    printf 'Export worker is ready\n'
    break
  fi
  if ! kill -0 "$worker_pid" 2>/dev/null; then
    printf 'Export worker stopped before becoming ready. Logs follow.\n' >&2
    tail -n 100 "$log_dir/api.log" "$log_dir/web.log" "$log_dir/worker.log" >&2 || true
    exit 1
  fi
  sleep 1
done
if ! grep -Fq '"event":"export_worker_started"' "$log_dir/worker.log"; then
  printf 'Export worker did not become ready. Logs follow.\n' >&2
  tail -n 100 "$log_dir/api.log" "$log_dir/web.log" "$log_dir/worker.log" >&2 || true
  exit 1
fi

cd "$repo_root/apps/api"
node test/gateway-flow.integration.mjs
