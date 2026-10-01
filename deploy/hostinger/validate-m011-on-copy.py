#!/usr/bin/env python3
"""Back up the operational database, restore a copy, and validate M011 there."""

import hashlib
import os
from datetime import datetime, timezone
from pathlib import Path
import subprocess
from urllib.parse import urlsplit, urlunsplit

api_dir = Path("/tmp/erp-request-validation-20261001/apps/api")
env_file = Path("/etc/import-erp/migration-release.env")
backup_dir = Path("/var/backups/import-erp")
node = "/opt/node-v24/bin/node"
name = "erp_request_validation_" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


container = subprocess.check_output(
    ["/usr/bin/docker", "ps", "--filter", "name=postgres_postgres", "--format", "{{.ID}}"],
    text=True,
).splitlines()[0]
credential_line = next(line for line in env_file.read_text().splitlines()
                       if line.startswith("MIGRATION_DATABASE_URL="))
source_url = credential_line.split("=", 1)[1]
if urlsplit(source_url).path != "/erp_po_totvs_test":
    raise SystemExit("Unexpected source database; refusing to continue.")
temporary_url = urlunsplit((*urlsplit(source_url)[:2], "/" + name, urlsplit(source_url).query, ""))
backup_dir.mkdir(mode=0o700, exist_ok=True)
backup = backup_dir / f"erp_po_totvs_test_{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.dump"
with backup.open("xb") as output:
    os.chmod(backup, 0o600)
    run("/usr/bin/docker", "exec", container, "sh", "-lc",
        'exec pg_dump -U "${POSTGRES_USER:-postgres}" -d erp_po_totvs_test -Fc --no-owner --no-acl', stdout=output)
if backup.stat().st_size == 0:
    raise SystemExit("Empty backup; refusing to continue.")
digest = hashlib.sha256(backup.read_bytes()).hexdigest()
with backup.open("rb") as source:
    run("/usr/bin/docker", "exec", "-i", container, "pg_restore", "--list", stdin=source,
        stdout=subprocess.DEVNULL)
print("Verified operational backup:", backup)
print("SHA256:", digest)

created = False
try:
    run("/usr/bin/docker", "exec", container, "sh", "-lc",
        'createdb -U "${POSTGRES_USER:-postgres}" -O erp_po_totvs_migrator "$1"', "sh", name)
    created = True
    with backup.open("rb") as source:
        run("/usr/bin/docker", "exec", "-i", container, "sh", "-lc",
            'exec pg_restore -U "${POSTGRES_USER:-postgres}" --role=erp_po_totvs_migrator '
            '--no-owner --no-acl -d "$1"', "sh", name, stdin=source)
    env = os.environ.copy()
    env.update({"MIGRATION_ENV": "isolated", "MIGRATION_DATABASE_URL": temporary_url,
                "DATABASE_URL": temporary_url})
    status = subprocess.check_output([node, "dist/migrate.js", "status"], cwd=api_dir, env=env, text=True)
    print(status)
    if "10 aplicadas, 1 pendentes" not in status or "M011_native_requests.sql" not in status:
        raise RuntimeError("Unexpected migration ledger; M011 not pending after M010.")
    run(node, "dist/migrate.js", "up", cwd=api_dir, env=env)
    final = subprocess.check_output([node, "dist/migrate.js", "status"], cwd=api_dir, env=env, text=True)
    if "11 aplicadas, 0 pendentes" not in final:
        raise RuntimeError("M011 did not reach 11 applied, zero pending.")
    print(final)
    grants_sql = ("SELECT has_schema_privilege('import_erp_app','procurement','USAGE') "
                  "AND has_table_privilege('import_erp_app','procurement.import_request','INSERT') "
                  "AND has_table_privilege('import_erp_app','procurement.import_request_item','INSERT') "
                  "AND has_sequence_privilege('import_erp_app','procurement.import_request_number_seq','USAGE')")
    grants = subprocess.check_output(["/usr/bin/docker", "exec", container, "sh", "-lc",
        'psql -U "${POSTGRES_USER:-postgres}" -d "$1" -Atc "$2"', "sh", name, grants_sql], text=True).strip()
    if grants != "t":
        raise RuntimeError("API runtime role lacks M011 privileges.")
    print("M011 schema, sequence, grants and restored-copy migration validation passed.")
finally:
    if created:
        run("/usr/bin/docker", "exec", container, "sh", "-lc",
            'dropdb -U "${POSTGRES_USER:-postgres}" --if-exists --force "$1"', "sh", name,
            stdout=subprocess.DEVNULL)
