#!/usr/bin/env python3
"""Back up the live database, restore a copy, and validate M021."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
import subprocess
from urllib.parse import urlsplit, urlunsplit


stage = Path(os.environ["ERP_STAGE_DIR"]).resolve(strict=True)
if not stage.is_relative_to(Path("/tmp")):
    raise SystemExit("ERP_STAGE_DIR must be under /tmp")
api = stage / "apps" / "api"
node = "/opt/node-v24/bin/node"
stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
copy_name = f"erp_m021_{stamp.replace('T', '').replace('Z', '')}_ci"
backup_dir = Path("/var/backups/import-erp")


def run(*args: str, **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(args, check=True, **kwargs)


def psql(container: str, database: str, statement: str) -> str:
    return subprocess.check_output(
        ["/usr/bin/docker", "exec", container, "sh", "-lc",
         'psql -U "${POSTGRES_USER:-postgres}" -d "$1" -v ON_ERROR_STOP=1 -Atc "$2"',
         "sh", database, statement], text=True,
    ).strip()


container = subprocess.check_output(
    ["/usr/bin/docker", "ps", "--filter", "name=postgres_postgres", "--format", "{{.ID}}"],
    text=True,
).splitlines()[0]
credential_line = next(
    line for line in Path("/etc/import-erp/migration-release.env").read_text().splitlines()
    if line.startswith("MIGRATION_DATABASE_URL=")
)
parts = urlsplit(credential_line.split("=", 1)[1])
if parts.path != "/erp_po_totvs_test":
    raise SystemExit("Unexpected operational database")
copy_url = urlunsplit((parts.scheme, parts.netloc, "/" + copy_name, parts.query, parts.fragment))

if psql(container, "erp_po_totvs_test", "SELECT count(*) FROM migration.schema_migration") != "20":
    raise SystemExit("Expected M001-M020 before backup")
backup_dir.mkdir(mode=0o700, exist_ok=True)
backup = backup_dir / f"erp_po_totvs_test_{stamp}.dump"
with backup.open("xb") as output:
    os.chmod(backup, 0o600)
    run("/usr/bin/docker", "exec", container, "sh", "-lc",
        'exec pg_dump -U "${POSTGRES_USER:-postgres}" -d erp_po_totvs_test -Fc --no-owner --no-acl',
        stdout=output)
if backup.stat().st_size == 0:
    raise SystemExit("Empty backup")
with backup.open("rb") as source:
    run("/usr/bin/docker", "exec", "-i", container, "pg_restore", "--list",
        stdin=source, stdout=subprocess.DEVNULL)
with backup.open("rb") as source:
    checksum = hashlib.sha256()
    for chunk in iter(lambda: source.read(1024 * 1024), b""):
        checksum.update(chunk)
    digest = checksum.hexdigest()
print("Verified backup:", backup)
print("SHA256:", digest)

created = False
try:
    run("/usr/bin/docker", "exec", container, "sh", "-lc",
        'createdb -U "${POSTGRES_USER:-postgres}" -O erp_po_totvs_migrator "$1"',
        "sh", copy_name)
    created = True
    with backup.open("rb") as source:
        run("/usr/bin/docker", "exec", "-i", container, "sh", "-lc",
            'exec pg_restore -U "${POSTGRES_USER:-postgres}" --role=erp_po_totvs_migrator '
            '--no-owner --no-acl -d "$1"', "sh", copy_name, stdin=source)
    if psql(container, copy_name,
            "SELECT count(*) FROM migration.schema_migration") != "20":
        raise RuntimeError("Restored ledger is not at M020")
    old_source_rows = psql(container, copy_name, "SELECT count(*) FROM migration.source_row")
    environment = os.environ.copy()
    environment.update({"MIGRATION_ENV": "isolated", "MIGRATION_DATABASE_URL": copy_url,
                        "DATABASE_URL": copy_url})
    status = subprocess.check_output([node, "dist/migrate.js", "status"],
                                     cwd=api, env=environment, text=True)
    if ("Migrations: 20 aplicadas, 1 pendentes." not in status
            or "pendente  M021_operational_selectors.sql" not in status):
        raise RuntimeError("Unexpected staged migration status")
    run(node, "dist/migrate.js", "up", cwd=api, env=environment)
    final = subprocess.check_output([node, "dist/migrate.js", "status"],
                                    cwd=api, env=environment, text=True)
    if "Migrations: 21 aplicadas, 0 pendentes." not in final:
        raise RuntimeError("M021 did not complete on restored copy")
    if psql(container, copy_name,
            "SELECT count(*) FROM migration.source_row") != old_source_rows:
        raise RuntimeError("Historical source rows changed")
    checks = psql(container, copy_name,
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
        "WHERE table_schema='procurement' AND table_name='purchase_order_item' "
        "AND column_name='product_group') "
        "AND to_regclass('catalog.operational_value') IS NOT NULL "
        "AND has_table_privilege('import_erp_app','catalog.operational_value','SELECT') "
        "AND has_table_privilege('import_erp_app','catalog.operational_value','INSERT') "
        "AND (SELECT count(*) > 0 FROM catalog.operational_value)")
    if checks != "t":
        raise RuntimeError("M021 schema, seed values, or runtime grants are incomplete")
    print("M021 passed on restored copy; source rows and runtime grants verified.")
finally:
    if created:
        run("/usr/bin/docker", "exec", container, "sh", "-lc",
            'dropdb -U "${POSTGRES_USER:-postgres}" --if-exists --force "$1"',
            "sh", copy_name, stdout=subprocess.DEVNULL)
