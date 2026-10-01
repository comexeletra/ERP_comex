#!/usr/bin/env python3
"""Back up the selected operational database, restore a disposable copy, test M010.

Run on the VPS after the API build, with this script and application snapshot
staged at /tmp/erp-catalog-validation-20261001. The verified backup is retained.
"""

import hashlib
import os
from pathlib import Path
import subprocess
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit

api_dir = Path("/tmp/erp-catalog-validation-20261001/apps/api")
env_file = Path("/etc/import-erp/migration-release.env")
backup_dir = Path("/var/backups/import-erp")
node = "/opt/node-v24/bin/node"
name = "erp_catalog_validation_" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


container = subprocess.check_output(
    ["/usr/bin/docker", "ps", "--filter", "name=postgres_postgres", "--format", "{{.ID}}"],
    text=True,
).splitlines()[0]
credential_line = next(
    line for line in env_file.read_text().splitlines()
    if line.startswith("MIGRATION_DATABASE_URL=")
)
source_url = credential_line.split("=", 1)[1]
if urlsplit(source_url).path != "/erp_po_totvs_test":
    raise SystemExit("Unexpected source database; refusing to continue.")
temporary_url = urlunsplit(
    (*urlsplit(source_url)[:2], "/" + name, urlsplit(source_url).query, "")
)
backup_dir.mkdir(mode=0o700, exist_ok=True)
backup = backup_dir / f"erp_po_totvs_test_{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.dump"
with backup.open("xb") as output:
    os.chmod(backup, 0o600)
    run(
        "/usr/bin/docker", "exec", container, "sh", "-lc",
        'exec pg_dump -U "${POSTGRES_USER:-postgres}" -d erp_po_totvs_test -Fc --no-owner --no-acl',
        stdout=output,
    )
if backup.stat().st_size == 0:
    raise SystemExit("Empty backup; refusing to continue.")
digest = hashlib.sha256(backup.read_bytes()).hexdigest()
with backup.open("rb") as source:
    run("/usr/bin/docker", "exec", "-i", container, "pg_restore", "--list", stdin=source,
        stdout=subprocess.DEVNULL)
print("Verified backup:", backup)
print("SHA256:", digest)

created = False
try:
    run(
        "/usr/bin/docker", "exec", container, "sh", "-lc",
        'createdb -U "${POSTGRES_USER:-postgres}" -O erp_po_totvs_migrator "$1"',
        "sh", name,
    )
    created = True
    with backup.open("rb") as source:
        run(
            "/usr/bin/docker", "exec", "-i", container, "sh", "-lc",
            'exec pg_restore -U "${POSTGRES_USER:-postgres}" '
            '--role=erp_po_totvs_migrator --no-owner --no-acl -d "$1"',
            "sh", name, stdin=source,
        )
    environment = os.environ.copy()
    environment.update({
        "MIGRATION_ENV": "isolated",
        "MIGRATION_DATABASE_URL": temporary_url,
        "DATABASE_URL": temporary_url,
        "CATALOG_TEST_DB": name,
    })
    status = subprocess.check_output([node, "dist/migrate.js", "status"],
                                     cwd=api_dir, env=environment, text=True)
    print(status)
    if "9 aplicadas, 1 pendentes" not in status or "M010_catalog_review.sql" not in status:
        raise RuntimeError("Unexpected migration status; M010 was not applied.")
    run(node, "dist/migrate.js", "up", cwd=api_dir, env=environment)
    final = subprocess.check_output([node, "dist/migrate.js", "status"],
                                    cwd=api_dir, env=environment, text=True)
    if "10 aplicadas, 0 pendentes" not in final:
        raise RuntimeError("M010 status did not reach 10 applied, 0 pending.")
    print(final)
    grants_sql = ("SELECT has_schema_privilege('import_erp_app', 'catalog', 'USAGE') "
                  "AND has_table_privilege('import_erp_app', 'catalog.entry', 'INSERT')")
    grants = subprocess.check_output(
        ["/usr/bin/docker", "exec", container, "sh", "-lc",
         'psql -U "${POSTGRES_USER:-postgres}" -d "$1" -Atc "$2"',
         "sh", name, grants_sql], text=True).strip()
    if grants != "t":
        raise RuntimeError("API role did not receive catalog privileges.")
    run(node, "test/catalog.real-write.mjs", cwd=api_dir, env=environment)
    print("Restored-copy M010 validation complete.")
finally:
    if created:
        run(
            "/usr/bin/docker", "exec", container, "sh", "-lc",
            'dropdb -U "${POSTGRES_USER:-postgres}" --if-exists --force "$1"',
            "sh", name, stdout=subprocess.DEVNULL,
        )
