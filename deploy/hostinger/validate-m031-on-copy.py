#!/usr/bin/env python3
"""Back up the operational database and validate M031 on a restored copy."""

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
if not (api / "migrations" / "M031_group_operational_value.sql").is_file():
    raise SystemExit("M031 is missing from the staged migrations")
node = "/opt/node-v24/bin/node"
stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
copy_name = f"erp_m031_{stamp.replace('T', '').replace('Z', '')}_ci"
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

if psql(container, "erp_po_totvs_test", "SELECT count(*) FROM migration.schema_migration") != "30":
    raise SystemExit("Expected M001-M030 before backup")
if psql(container, "erp_po_totvs_test",
        "SELECT count(*) FROM catalog.operational_value WHERE entity_key='GROUP'") != "0":
    raise SystemExit("GROUP values already exist; inspect before applying M031")

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
    if psql(container, copy_name, "SELECT count(*) FROM migration.schema_migration") != "30":
        raise RuntimeError("Restored ledger is not at M030")
    before_count = psql(container, copy_name, "SELECT count(*) FROM catalog.operational_value")
    environment = os.environ.copy()
    environment.update({"MIGRATION_ENV": "isolated", "MIGRATION_DATABASE_URL": copy_url,
                        "DATABASE_URL": copy_url})
    status = subprocess.check_output([node, "dist/migrate.js", "status"],
                                     cwd=api, env=environment, text=True)
    if ("Migrations: 30 aplicadas, 1 pendentes." not in status
            or "pendente  M031_group_operational_value.sql" not in status):
        raise RuntimeError("Unexpected staged migration status")
    run(node, "dist/migrate.js", "up", cwd=api, env=environment)
    if psql(container, copy_name, "SELECT count(*) FROM migration.schema_migration") != "31":
        raise RuntimeError("M031 did not reach the restored ledger")
    values = psql(container, copy_name,
                  "SELECT string_agg(value, ',' ORDER BY value) "
                  "FROM catalog.operational_value WHERE entity_key='GROUP'")
    if values != "Energy,Livoltek,Recloser,Water":
        raise RuntimeError(f"Unexpected GROUP values: {values}")
    after_count = psql(container, copy_name, "SELECT count(*) FROM catalog.operational_value")
    if int(after_count) != int(before_count) + 4:
        raise RuntimeError("Operational value count changed unexpectedly")
    print("M031 and four GROUP values passed on restored copy.", flush=True)
finally:
    if created:
        run("/usr/bin/docker", "exec", container, "sh", "-lc",
            'dropdb -U "${POSTGRES_USER:-postgres}" --if-exists --force "$1"',
            "sh", copy_name, stdout=subprocess.DEVNULL)
