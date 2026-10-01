#!/usr/bin/env bash
# Explicit production release after approval. Run only on the selected VPS.
set -euo pipefail

[[ ${1:-} == '--apply-to-erp_po_totvs_test' ]] || {
  echo 'Pass --apply-to-erp_po_totvs_test after the production release is approved.' >&2
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
if [[ $status != *'Migrations: 9 aplicadas, 1 pendentes.'* \
   || $status != *'pendente  M010_catalog_review.sql'* ]]; then
  echo 'Unexpected migration ledger; no release applied.' >&2
  exit 1
fi

# This script dumps the operational database, checks the archive, restores it
# into a temporary database and checks its ledger before dropping that copy.
bash "$stage_dir/backup-erp-db.sh"

MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
  /opt/node-v24/bin/node --env-file=/etc/import-erp/migration-release.env \
  "$source_dir/dist/migrate.js" up
status=$(MIGRATION_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true \
  /opt/node-v24/bin/node --env-file=/etc/import-erp/migration-release.env \
  "$source_dir/dist/migrate.js" status)
[[ $status == *'Migrations: 10 aplicadas, 0 pendentes.'* ]]

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
bash "$stage_dir/verify-api-ready.sh"
bash "$stage_dir/verify-public-api.sh"
trap - ERR
echo "M010 API installed; API rollback files: $rollback_dir"
