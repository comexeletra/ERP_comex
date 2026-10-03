#!/usr/bin/env python3
"""Back up the operational DB and verify M015 on an isolated restored copy."""

from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import os
from pathlib import Path
import subprocess
from urllib.parse import urlsplit, urlunsplit


APPROVED_SHA256 = "d2f025ce6dc53a15574126217cf2148fb875fbb41408f266d6a486aa5f0d7f44"
stage_dir = Path(os.environ["ERP_STAGE_DIR"]).resolve(strict=True)
if not stage_dir.is_relative_to(Path("/tmp")):
    raise SystemExit("ERP_STAGE_DIR must be under /tmp")
api_dir = stage_dir / "apps" / "api"
node = "/opt/node-v24/bin/node"
stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
copy_name = f"erp_m015_validation_{stamp.replace('T', '').replace('Z', '')}"
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
    if "Migrations: 14 aplicadas, 1 pendentes." not in status or "pendente  M015_excel_error_columns.sql" not in status:
        raise RuntimeError("Unexpected migration ledger on restored copy")
    batch_count = psql(container, copy_name,
                       "SELECT count(*) FROM migration.import_batch WHERE file_sha256 = '"
                       + APPROVED_SHA256 + "' AND state = 'PROMOTED' AND source_row_count = 7130")
    if batch_count != "1":
        raise RuntimeError("Approved original batch is absent or inconsistent")
    raw_before = psql(container, copy_name,
                      "SELECT md5(string_agg(id::text || raw_values::text || row_hash::text, '' ORDER BY id)) "
                      "FROM migration.source_row")
    run(node, "dist/migrate.js", "up", cwd=api_dir, env=environment)
    final = subprocess.check_output([node, "dist/migrate.js", "status"],
                                    cwd=api_dir, env=environment, text=True)
    if "Migrations: 15 aplicadas, 0 pendentes." not in final:
        raise RuntimeError("M015 did not complete on restored copy")
    raw_after = psql(container, copy_name,
                     "SELECT md5(string_agg(id::text || raw_values::text || row_hash::text, '' ORDER BY id)) "
                     "FROM migration.source_row")
    if raw_before != raw_after:
        raise RuntimeError("Raw source values or hashes changed")
    counts = psql(container, copy_name,
                  "SELECT count(*) FILTER (WHERE jsonb_array_length(error_columns)>0), "
                  "coalesce(sum(jsonb_array_length(error_columns)),0) "
                  "FROM migration.source_row")
    if counts != "277|306":
        raise RuntimeError(f"Unexpected Excel error flags: {counts}")
    print("M015 restored-copy backfill passed: 277 rows, 306 cells; raw source unchanged.")
finally:
    if created:
        run("/usr/bin/docker", "exec", container, "sh", "-lc",
            'dropdb -U "${POSTGRES_USER:-postgres}" --if-exists --force "$1"',
            "sh", copy_name, stdout=subprocess.DEVNULL)
