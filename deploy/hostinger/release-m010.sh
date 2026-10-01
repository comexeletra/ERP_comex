#!/usr/bin/env bash
# Explicit production release after approval. Run only on the selected VPS.
set -euo pipefail

mode=${1:-}
[[ $mode == '--apply-to-erp_po_totvs_test' || $mode == '--resume-api-after-m010' ]] || {
  echo 'Pass --apply-to-erp_po_totvs_test or --resume-api-after-m010 after approval.' >&2
  exit 2
}
source_dir=/tmp/erp-catalog-validation-20261001/apps/api
target_dir=/opt/import-erp/apps/api
stage_dir=/tmp/erp-catalog-validation-20261001
rollback_dir=/var/backups/import-erp/m010-api-af9e297-$(date -u +%Y%m%dT%H%M%SZ)

test -f "$target_dir/dist/server.js"
test -f "$target_dir/src/server.ts"
test ! -e "$target_dir/dist/catalog.js"
systemctl is-active --quiet import-erp-api
cd "$source_dir"
printf '%s  %s\n' \
  cd9f31d8dc60c130e402b5f27c5b052f7297df29f1473f3be2d918585318f79e src/authorization.ts \
  bf018dc187c67f45f08028aadb0c22d128b7240f148ab9e4c8862d809e531d1f src/catalog.ts \
  077ee5d531cd57a368500fb07bc5d7850f62afe5235f44217c4f6137d8110171 src/server.ts \
  d5d54470b744136fa093fa10add180560da9ca115170f3eaba74af5f41696d4b dist/authorization.js \
  c8bb8ae794da95ec964d9f0e8979f889d7b636c4d6d7159d633c7971be859304 dist/catalog.js \
  cb1c0fcc651e4c2e82145d199fe63d028280a1b6a45b0414afc4699fc3a5a772 dist/server.js \
  63d3a0269264d6a21a8c8e66e2f0674d7ecafb6f442ee10be6add6d425c74f17 migrations/M010_catalog_review.sql \
  | sha256sum -c -

status=$(MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
  /opt/node-v24/bin/node --env-file=/etc/import-erp/migration-release.env \
  "$source_dir/dist/migrate.js" status)
if [[ $mode == '--apply-to-erp_po_totvs_test' ]]; then
  if [[ $status != *'Migrations: 9 aplicadas, 1 pendentes.'* \
     || $status != *'pendente  M010_catalog_review.sql'* ]]; then
    echo 'Unexpected migration ledger; no release applied.' >&2
    exit 1
  fi
  # The backup script dumps, restores and checks the operational database.
  bash "$stage_dir/backup-erp-db.sh"
  MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
    /opt/node-v24/bin/node --env-file=/etc/import-erp/migration-release.env \
    "$source_dir/dist/migrate.js" up
  status=$(MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
    /opt/node-v24/bin/node --env-file=/etc/import-erp/migration-release.env \
    "$source_dir/dist/migrate.js" status)
  [[ $status == *'Migrations: 10 aplicadas, 0 pendentes.'* ]]
else
  [[ $status == *'Migrations: 10 aplicadas, 0 pendentes.'* ]] || {
    echo 'M010 is not applied; refusing API-only resume.' >&2
    exit 1
  }
  printf '%s  %s\n' \
    4fcc31fdb6cb530f89f308bfbd7ac7a505d078891f0c46eb7a608ff3ed204e86 \
    /var/backups/import-erp/erp_po_totvs_test_20261001T113403Z.dump \
    | sha256sum -c -
fi

install -m 0644 "$source_dir/migrations/M010_catalog_review.sql" "$target_dir/migrations/M010_catalog_review.sql"
install -d -m 0700 "$rollback_dir"
cp -p "$target_dir/src/authorization.ts" "$rollback_dir/authorization.ts"
cp -p "$target_dir/src/server.ts" "$rollback_dir/server.ts"
cp -p "$target_dir/dist/authorization.js" "$rollback_dir/authorization.js"
cp -p "$target_dir/dist/server.js" "$rollback_dir/server.js"
cp -p "$target_dir/package.json" "$rollback_dir/package.json"

restore_api() {
  trap - ERR
  cp -p "$rollback_dir/authorization.ts" "$target_dir/src/authorization.ts"
  cp -p "$rollback_dir/server.ts" "$target_dir/src/server.ts"
  cp -p "$rollback_dir/authorization.js" "$target_dir/dist/authorization.js"
  cp -p "$rollback_dir/server.js" "$target_dir/dist/server.js"
  cp -p "$rollback_dir/package.json" "$target_dir/package.json"
  rm -f -- "$target_dir/src/catalog.ts" "$target_dir/dist/catalog.js"
  systemctl restart import-erp-api
  echo "API restored from $rollback_dir. M010 remains applied and empty." >&2
}
trap restore_api ERR
install -m 0644 "$source_dir/src/authorization.ts" "$target_dir/src/authorization.ts"
install -m 0644 "$source_dir/src/catalog.ts" "$target_dir/src/catalog.ts"
install -m 0644 "$source_dir/src/server.ts" "$target_dir/src/server.ts"
install -m 0644 "$source_dir/dist/authorization.js" "$target_dir/dist/authorization.js"
install -m 0644 "$source_dir/dist/catalog.js" "$target_dir/dist/catalog.js"
install -m 0644 "$source_dir/dist/server.js" "$target_dir/dist/server.js"
install -m 0644 "$source_dir/package.json" "$target_dir/package.json"
systemctl restart import-erp-api
ready=false
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if bash "$stage_dir/verify-api-ready.sh" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
test "$ready" = true
public_ready=false
for attempt in 1 2 3 4 5; do
  if bash "$stage_dir/verify-public-api.sh"; then
    public_ready=true
    break
  fi
  sleep 2
done
test "$public_ready" = true
trap - ERR
echo "M010 API installed; API rollback files: $rollback_dir"
