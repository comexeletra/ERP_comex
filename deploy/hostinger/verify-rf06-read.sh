#!/usr/bin/env bash
# Read-only RF06 acceptance checks against the selected operational database.
set -euo pipefail

container=$(docker ps --filter name=postgres_postgres --format '{{.ID}}' | head -n 1)
if [[ -z ${container} ]]; then
  echo 'postgres_postgres container not found' >&2
  exit 1
fi
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
docker exec -i "$container" sh -lc \
  'exec psql -U "${POSTGRES_USER:-postgres}" -d erp_po_totvs_test -v ON_ERROR_STOP=1 -P pager=off' \
  < "$script_dir/verify-rf06-read.sql"
