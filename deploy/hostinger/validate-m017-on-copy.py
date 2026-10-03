#!/usr/bin/env python3
"""Back up the operational DB and verify M016-M017 on an isolated restored copy."""

from __future__ import annotations

from datetime import datetime, timezone
import os
from pathlib import Path
import subprocess
from urllib.parse import urlsplit, urlunsplit


stage_dir = Path(os.environ["ERP_STAGE_DIR"]).resolve(strict=True)
if not stage_dir.is_relative_to(Path("/tmp")):
    raise SystemExit("ERP_STAGE_DIR must be under /tmp")
api_dir = stage_dir / "apps" / "api"
node = "/opt/node-v24/bin/node"
stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
copy_name = f"erp_m017_validation_{stamp.replace('T', '').replace('Z', '')}"
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
print("Verified backup:", backup)

created = False
try:
    run("/usr/bin/docker", "exec", container, "sh", "-lc",
        'createdb -U "${POSTGRES_USER:-postgres}" -O erp_po_totvs_migrator "$1"', "sh", copy_name)
    created = True
    with backup.open("rb") as source:
        run("/usr/bin/docker", "exec", "-i", container, "sh", "-lc",
            'exec pg_restore -U "${POSTGRES_USER:-postgres}" --role=erp_po_totvs_migrator '
            '--no-owner --no-acl -d "$1"', "sh", copy_name, stdin=source)
    environment = os.environ.copy()
    environment.update({"MIGRATION_ENV": "isolated", "MIGRATION_DATABASE_URL": copy_url,
                        "DATABASE_URL": copy_url})
    status = subprocess.check_output([node, "dist/migrate.js", "status"],
                                     cwd=api_dir, env=environment, text=True)
    clean_15 = ("Migrations: 15 aplicadas, 2 pendentes." in status
                and "pendente  M016_import_batch_snapshot_read.sql" in status
                and "pendente  M017_catalog_entry_history.sql" in status)
    clean_16 = ("Migrations: 16 aplicadas, 1 pendentes." in status
                and "pendente  M017_catalog_entry_history.sql" in status)
    if not (clean_15 or clean_16):
        raise RuntimeError("Unexpected migration ledger on restored copy")
    run(node, "dist/migrate.js", "up", cwd=api_dir, env=environment)
    final = subprocess.check_output([node, "dist/migrate.js", "status"],
                                    cwd=api_dir, env=environment, text=True)
    if "Migrations: 17 aplicadas, 0 pendentes." not in final:
        raise RuntimeError("M016-M017 did not complete on restored copy")
    privileges = psql(container, copy_name,
        "SELECT has_schema_privilege('import_erp_app','audit','USAGE') "
        "AND has_table_privilege('import_erp_app','audit.catalog_entry_history','SELECT')")
    if privileges != "t":
        raise RuntimeError("Runtime role cannot read the catalog history view")
    psql(container, copy_name,
        "BEGIN; SET LOCAL ROLE import_erp_app; "
        "SELECT count(*) FROM audit.catalog_entry_history; ROLLBACK;")
    definition = psql(container, copy_name,
        "SELECT pg_get_viewdef('audit.catalog_entry_history'::regclass, true)")
    if "CATALOG_ENTRY" not in definition:
        raise RuntimeError("Catalog history view does not filter to catalog events")
    snapshot_grants = psql(container, copy_name,
        "SELECT has_column_privilege('import_erp_app','migration.import_batch','id','SELECT') "
        "AND has_column_privilege('import_erp_app','migration.import_batch','promoted_at','SELECT') "
        "AND NOT has_column_privilege('import_erp_app','migration.import_batch','file_name','SELECT')")
    if snapshot_grants != "t":
        raise RuntimeError("Runtime role snapshot column grants are not least-privilege")
    print("M016-M017 restored-copy migrations and least-privilege reads passed.")
finally:
    if created:
        run("/usr/bin/docker", "exec", container, "sh", "-lc",
            'dropdb -U "${POSTGRES_USER:-postgres}" --if-exists --force "$1"',
            "sh", copy_name, stdout=subprocess.DEVNULL)
