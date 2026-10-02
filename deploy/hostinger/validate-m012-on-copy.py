#!/usr/bin/env python3
"""Back up the operational database, restore a copy, and validate M012 there."""

import hashlib
import os
from datetime import datetime, timezone
from pathlib import Path
import subprocess
from urllib.parse import urlsplit, urlunsplit

stage_dir = Path(__file__).resolve().parents[2]
api_dir = stage_dir / "apps" / "api"
env_file = Path("/etc/import-erp/migration-release.env")
backup_dir = Path("/var/backups/import-erp")
node = "/opt/node-v24/bin/node"
stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
name = f"erp_m012_validation_{stamp}"


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
provided_backup = os.environ.get("M012_VALIDATION_BACKUP")
if provided_backup:
    backup = Path(provided_backup).resolve(strict=True)
    if backup.parent != backup_dir.resolve(strict=True) or not backup.is_file():
        raise SystemExit("Provided backup is outside the protected backup directory.")
else:
    backup = backup_dir / f"erp_po_totvs_test_{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.dump"
    with backup.open("xb") as output:
        os.chmod(backup, 0o600)
        run("/usr/bin/docker", "exec", container, "sh", "-lc",
            'exec pg_dump -U "${POSTGRES_USER:-postgres}" -d erp_po_totvs_test -Fc --no-owner --no-acl',
            stdout=output)
    if backup.stat().st_size == 0:
        raise SystemExit("Empty backup; refusing to continue.")
digest = hashlib.sha256(backup.read_bytes()).hexdigest()
expected_digest = os.environ.get("M012_VALIDATION_BACKUP_SHA256")
if expected_digest and digest.lower() != expected_digest.lower():
    raise SystemExit("Provided backup checksum does not match.")
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
    if "11 aplicadas, 1 pendentes" not in status or "M012_native_request_editing.sql" not in status:
        raise RuntimeError("Unexpected migration ledger; M012 not pending after M011.")
    run(node, "dist/migrate.js", "up", cwd=api_dir, env=env)
    final = subprocess.check_output([node, "dist/migrate.js", "status"], cwd=api_dir, env=env, text=True)
    if "12 aplicadas, 0 pendentes" not in final:
        raise RuntimeError("M012 did not reach 12 applied, zero pending.")
    print(final)

    grants_sql = ("SELECT has_table_privilege('import_erp_app','procurement.import_request_item','UPDATE') "
                  "AND has_table_privilege('import_erp_app','procurement.import_request_item','DELETE')")
    grants = subprocess.check_output(["/usr/bin/docker", "exec", container, "sh", "-lc",
        'psql -U "${POSTGRES_USER:-postgres}" -d "$1" -Atc "$2"', "sh", name, grants_sql], text=True).strip()
    if grants != "t":
        raise RuntimeError("API runtime role lacks M012 privileges.")

    # pg_restore uses --no-acl, so replay the M011 baseline grants on this copy.
    baseline = ("GRANT USAGE ON SCHEMA procurement TO import_erp_app; "
                "GRANT SELECT, INSERT ON procurement.import_request_item TO import_erp_app;")
    run("/usr/bin/docker", "exec", container, "sh", "-lc",
        'psql -U "${POSTGRES_USER:-postgres}" -d "$1" -v ON_ERROR_STOP=1 -c "$2"',
        "sh", name, baseline, stdout=subprocess.DEVNULL)
    dml = ("BEGIN; SET LOCAL ROLE import_erp_app; "
           "UPDATE procurement.import_request_item SET line_number = 1 WHERE false; "
           "DELETE FROM procurement.import_request_item WHERE false; ROLLBACK;")
    run("/usr/bin/docker", "exec", container, "sh", "-lc",
        'psql -U "${POSTGRES_USER:-postgres}" -d "$1" -v ON_ERROR_STOP=1 -c "$2"',
        "sh", name, dml, stdout=subprocess.DEVNULL)
    print("M012 restored-copy migration and runtime UPDATE/DELETE privilege checks passed.")
finally:
    if created:
        run("/usr/bin/docker", "exec", container, "sh", "-lc",
            'dropdb -U "${POSTGRES_USER:-postgres}" --if-exists --force "$1"', "sh", name,
            stdout=subprocess.DEVNULL)
