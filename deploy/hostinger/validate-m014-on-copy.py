#!/usr/bin/env python3
"""Back up production, restore an isolated copy and verify M014 and its grant."""

from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import os
from pathlib import Path
import subprocess
from urllib.parse import urlsplit, urlunsplit


stage_dir = Path(os.environ["ERP_STAGE_DIR"]).resolve(strict=True)
if not stage_dir.is_relative_to(Path("/tmp")):
    raise SystemExit("ERP_STAGE_DIR must be under /tmp")
api_dir = stage_dir / "apps" / "api"
env_file = Path("/etc/import-erp/migration-release.env")
backup_dir = Path("/var/backups/import-erp")
node = "/opt/node-v24/bin/node"
stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
copy_name = f"erp_m014_validation_{stamp.replace('T', '').replace('Z', '')}"


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
credential_line = next(line for line in env_file.read_text().splitlines()
                       if line.startswith("MIGRATION_DATABASE_URL="))
source_url = credential_line.split("=", 1)[1]
parts = urlsplit(source_url)
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
print("SHA256:", sha256(backup.read_bytes()).hexdigest())

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
    environment = os.environ.copy()
    environment.update({"MIGRATION_ENV": "isolated", "MIGRATION_DATABASE_URL": copy_url,
                        "DATABASE_URL": copy_url})
    status = subprocess.check_output([node, "dist/migrate.js", "status"],
                                     cwd=api_dir, env=environment, text=True)
    if "Migrations: 13 aplicadas, 1 pendentes." not in status or "pendente  M014_outbox_monitor.sql" not in status:
        raise RuntimeError("Unexpected migration ledger on restored copy")
    run(node, "dist/migrate.js", "up", cwd=api_dir, env=environment)
    final = subprocess.check_output([node, "dist/migrate.js", "status"],
                                    cwd=api_dir, env=environment, text=True)
    if "Migrations: 14 aplicadas, 0 pendentes." not in final:
        raise RuntimeError("M014 did not complete on restored copy")
    privileges = psql(container, copy_name,
                      "SELECT has_schema_privilege('import_erp_app','audit','USAGE') "
                      "AND has_table_privilege('import_erp_app','audit.outbox_monitor','SELECT')")
    if privileges != "t":
        raise RuntimeError("Runtime role cannot read the history view")
    psql(container, copy_name,
         "BEGIN; SET LOCAL ROLE import_erp_app; "
         "SELECT count(*) FROM audit.outbox_monitor; ROLLBACK;")
    print("M014 restored-copy migration and runtime view read passed.")
finally:
    if created:
        run("/usr/bin/docker", "exec", container, "sh", "-lc",
            'dropdb -U "${POSTGRES_USER:-postgres}" --if-exists --force "$1"',
            "sh", copy_name, stdout=subprocess.DEVNULL)
