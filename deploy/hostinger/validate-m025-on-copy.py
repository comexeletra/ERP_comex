#!/usr/bin/env python3
"""Restore the operational M024 database, apply M025 and test shipment dates."""

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
copy_name = f"erp_m025_{stamp.replace('T', '').replace('Z', '')}_ci"
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

if psql(container, "erp_po_totvs_test", "SELECT count(*) FROM migration.schema_migration") != "24":
    raise SystemExit("Expected M001-M024 before backup")
backup_dir.mkdir(mode=0o700, exist_ok=True)
backup = backup_dir / f"erp_po_totvs_test_{stamp}.dump"
with backup.open("xb") as output:
    os.chmod(backup, 0o600)
    run("/usr/bin/docker", "exec", container, "sh", "-lc",
        'exec pg_dump -U "${POSTGRES_USER:-postgres}" -d erp_po_totvs_test -Fc --no-owner',
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
print("Verified backup:", backup)
print("SHA256:", checksum.hexdigest())

created = False
try:
    run("/usr/bin/docker", "exec", container, "sh", "-lc",
        'createdb -U "${POSTGRES_USER:-postgres}" -O erp_po_totvs_migrator "$1"',
        "sh", copy_name)
    created = True
    with backup.open("rb") as source:
        run("/usr/bin/docker", "exec", "-i", container, "sh", "-lc",
            'exec pg_restore -U "${POSTGRES_USER:-postgres}" --role=erp_po_totvs_migrator '
            '--no-owner -d "$1"', "sh", copy_name, stdin=source)
    if psql(container, copy_name,
            "SELECT count(*) FROM migration.schema_migration") != "24":
        raise RuntimeError("Restored ledger is not at M024")
    source_rows = psql(container, copy_name, "SELECT count(*) FROM migration.source_row")
    allocation_totals = psql(container, copy_name,
        "SELECT count(*)::text || ':' || coalesce(sum(quantity),0)::text "
        "FROM procurement.po_item_allocation WHERE status='ACTIVE'")
    environment = os.environ.copy()
    environment.update({"MIGRATION_ENV": "isolated", "MIGRATION_DATABASE_URL": copy_url,
                        "DATABASE_URL": copy_url})
    status = subprocess.check_output([node, "dist/migrate.js", "status"],
                                     cwd=api, env=environment, text=True)
    if ("Migrations: 24 aplicadas, 1 pendentes." not in status
            or "pendente  M025_allocation_factory_ship_date.sql" not in status):
        raise RuntimeError("Unexpected staged migration status")
    run(node, "dist/migrate.js", "up", cwd=api, env=environment)
    final = subprocess.check_output([node, "dist/migrate.js", "status"],
                                    cwd=api, env=environment, text=True)
    if "Migrations: 25 aplicadas, 0 pendentes." not in final:
        raise RuntimeError("M025 did not complete on restored copy")
    if psql(container, copy_name, "SELECT count(*) FROM migration.source_row") != source_rows:
        raise RuntimeError("Historical source rows changed")
    if psql(container, copy_name,
            "SELECT count(*)::text || ':' || coalesce(sum(quantity),0)::text "
            "FROM procurement.po_item_allocation WHERE status='ACTIVE'") != allocation_totals:
        raise RuntimeError("Active PO/IP quantities changed")
    column = psql(container, copy_name,
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
        "WHERE table_schema='procurement' AND table_name='po_item_allocation' "
        "AND column_name='factory_ship_date')")
    if column != "t":
        raise RuntimeError("Allocation factory date column is missing")
    run(node, "test/operations.integration.mjs", cwd=api, env=environment)
    environment["FOLLOWUP_TEST_DATABASE_URL"] = copy_url
    run(node, "test/followup.integration.mjs", cwd=api, env=environment)
    print("M025, immutable source rows, active PO/IP balances and per-allocation dates passed on restored copy.")
finally:
    if created:
        run("/usr/bin/docker", "exec", container, "sh", "-lc",
            'dropdb -U "${POSTGRES_USER:-postgres}" --if-exists --force "$1"',
            "sh", copy_name, stdout=subprocess.DEVNULL)
