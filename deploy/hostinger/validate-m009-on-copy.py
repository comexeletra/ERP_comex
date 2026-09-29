#!/usr/bin/env python3
"""Back up the operational ERP DB, restore it, then test M009 and local login.

Runs only on the VPS. The restored database is always dropped after the check.
The verified backup is retained for a possible production migration.
"""

import hashlib
import os
from pathlib import Path
import subprocess
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit

api_dir = Path("/root/import-eletra-web-release/apps/api")
env_file = Path("/etc/import-erp/migration-release.env")
backup_dir = Path("/var/backups/import-erp")
node = "/opt/node-v24/bin/node"
name = "erp_m009_check_" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


container = subprocess.check_output(
    ["docker", "ps", "--filter", "name=postgres_postgres", "--format", "{{.ID}}"],
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
reuse = os.environ.get("M009_VERIFIED_BACKUP")
backup = Path(reuse) if reuse else backup_dir / f"erp_po_totvs_test_{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.dump"
if reuse:
    if backup.parent != backup_dir or not os.environ.get("M009_BACKUP_SHA256"):
        raise SystemExit("A reused backup needs its expected SHA256 and the approved backup directory.")
else:
    with backup.open("xb") as output:
        os.chmod(backup, 0o600)
        run(
            "docker", "exec", container, "sh", "-lc",
            'exec pg_dump -U "${POSTGRES_USER:-postgres}" -d erp_po_totvs_test -Fc --no-owner --no-acl',
            stdout=output,
        )
if backup.stat().st_size == 0:
    raise SystemExit("Empty backup; refusing to continue.")
digest = hashlib.sha256(backup.read_bytes()).hexdigest()
if reuse and digest != os.environ["M009_BACKUP_SHA256"]:
    raise SystemExit("Reused backup SHA256 mismatch; refusing to continue.")
with backup.open("rb") as source:
    run("docker", "exec", "-i", container, "pg_restore", "--list", stdin=source,
        stdout=subprocess.DEVNULL)
print("Verified backup:", backup)
print("SHA256:", digest)

created = False
try:
    run(
        "docker", "exec", container, "sh", "-lc",
        'createdb -U "${POSTGRES_USER:-postgres}" -O erp_po_totvs_migrator "$1"',
        "sh", name,
    )
    created = True
    with backup.open("rb") as source:
        run(
            "docker", "exec", "-i", container, "sh", "-lc",
            'exec pg_restore -U "${POSTGRES_USER:-postgres}" '
            '--role=erp_po_totvs_migrator --no-owner --no-acl -d "$1"',
            "sh", name, stdin=source,
        )
    environment = os.environ.copy()
    environment.update({
        "MIGRATION_ENV": "isolated",
        "MIGRATION_DATABASE_URL": temporary_url,
        "MANUAL_AUTH_TEST_DB": "isolated",
        "MANUAL_AUTH_TEST_DATABASE_URL": temporary_url,
    })
    status = subprocess.check_output([node, "dist/migrate.js", "status"],
                                     cwd=api_dir, env=environment, text=True)
    print(status)
    if "8 aplicadas, 1 pendentes" not in status or "M009_local_credentials.sql" not in status:
        raise RuntimeError("Unexpected migration status; M009 was not applied.")
    run(node, "dist/migrate.js", "up", cwd=api_dir, env=environment)
    run(node, "test/manual-auth.integration.mjs", cwd=api_dir, env=environment)
    final = subprocess.check_output([node, "dist/migrate.js", "status"],
                                    cwd=api_dir, env=environment, text=True)
    if "9 aplicadas, 0 pendentes" not in final:
        raise RuntimeError("M009 status did not reach 9 applied, 0 pending.")
    print(final)
finally:
    if created:
        run(
            "docker", "exec", container, "sh", "-lc",
            'dropdb -U "${POSTGRES_USER:-postgres}" --if-exists --force "$1"',
            "sh", name, stdout=subprocess.DEVNULL,
        )
