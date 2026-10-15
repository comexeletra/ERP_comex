#!/usr/bin/env python3
"""Back up production and exercise M032-M034 on a restored disposable copy."""

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
for migration in (
    "M032_export_jobs.sql",
    "M033_open_data_issue_source.sql",
    "M034_export_jobs_xlsx.sql",
):
    if not (api / "migrations" / migration).is_file():
        raise SystemExit(f"Missing staged migration: {migration}")

node = "/opt/node-v24/bin/node"
stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
copy_name = f"erp_m032_{stamp.replace('T', '').replace('Z', '')}_ci"
backup_dir = Path("/var/backups/import-erp")


def run(*args: str, **kwargs: object) -> subprocess.CompletedProcess:
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

if psql(container, "erp_po_totvs_test", "SELECT count(*) FROM migration.schema_migration") != "31":
    raise SystemExit("Expected M001-M031 before backup")

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
checksum = hashlib.sha256()
with backup.open("rb") as source:
    for chunk in iter(lambda: source.read(1024 * 1024), b""):
        checksum.update(chunk)
print("Verified backup:", backup, flush=True)
print("SHA256:", checksum.hexdigest(), flush=True)

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
    if psql(container, copy_name, "SELECT count(*) FROM migration.schema_migration") != "31":
        raise RuntimeError("Restored ledger is not at M031")

    counts_before = psql(
        container, copy_name,
        "SELECT (SELECT count(*) FROM imports.import_process)::text || ',' || "
        "(SELECT count(*) FROM procurement.purchase_order)::text || ',' || "
        "(SELECT count(*) FROM procurement.purchase_order_item)::text || ',' || "
        "(SELECT count(*) FROM migration.data_issue)::text",
    )
    environment = os.environ.copy()
    environment.update({"MIGRATION_ENV": "isolated", "MIGRATION_DATABASE_URL": copy_url,
                        "DATABASE_URL": copy_url})
    status = subprocess.check_output([node, "dist/migrate.js", "status"],
                                     cwd=api, env=environment, text=True)
    if ("Migrations: 31 aplicadas, 3 pendentes." not in status
            or "pendente  M032_export_jobs.sql" not in status
            or "pendente  M033_open_data_issue_source.sql" not in status
            or "pendente  M034_export_jobs_xlsx.sql" not in status):
        raise RuntimeError("Expected only M032-M034 to be pending on the restored copy")
    run(node, "dist/migrate.js", "up", cwd=api, env=environment)
    if psql(container, copy_name, "SELECT count(*) FROM migration.schema_migration") != "34":
        raise RuntimeError("M032-M034 did not reach the restored ledger")

    schema_ok = psql(
        container, copy_name,
        "SELECT (to_regclass('jobs.export_job') IS NOT NULL) AND "
        "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='jobs' "
        "AND table_name='export_job' AND column_name='result_binary' AND data_type='bytea')",
    )
    if schema_ok != "t":
        raise RuntimeError("Excel binary storage was not created")
    grants_ok = psql(
        container, copy_name,
        "SELECT has_schema_privilege('import_erp_app', 'jobs', 'USAGE') AND "
        "has_table_privilege('import_erp_app', 'jobs.export_job', 'SELECT,INSERT,UPDATE,DELETE')",
    )
    if grants_ok != "t":
        raise RuntimeError("Runtime role cannot access the export queue")
    counts_after = psql(
        container, copy_name,
        "SELECT (SELECT count(*) FROM imports.import_process)::text || ',' || "
        "(SELECT count(*) FROM procurement.purchase_order)::text || ',' || "
        "(SELECT count(*) FROM procurement.purchase_order_item)::text || ',' || "
        "(SELECT count(*) FROM migration.data_issue)::text",
    )
    if counts_after != counts_before:
        raise RuntimeError("M032-M034 unexpectedly changed operational data")
    print("M032-M034, queue grants and operational row counts passed on restored copy.", flush=True)
finally:
    if created:
        run("/usr/bin/docker", "exec", container, "sh", "-lc",
            'dropdb -U "${POSTGRES_USER:-postgres}" --if-exists --force "$1"',
            "sh", copy_name, stdout=subprocess.DEVNULL)
