#!/usr/bin/env python3
"""Restore the operational M025 database, promote real PO lines and test balances."""

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
copy_name = f"erp_m026_{stamp.replace('T', '').replace('Z', '')}_ci"
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

if psql(container, "erp_po_totvs_test", "SELECT count(*) FROM migration.schema_migration") != "25":
    raise SystemExit("Expected M001-M025 before backup")
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
            "SELECT count(*) FROM migration.schema_migration") != "25":
        raise RuntimeError("Restored ledger is not at M025")

    source_rows = psql(container, copy_name,
        "SELECT count(*)::text || ':' || coalesce(sum(quantity),0)::text "
        "FROM procurement.po_line_observation")
    source_ip_totals = psql(container, copy_name,
        "SELECT count(*)::text || ':' || coalesce(sum(observation.quantity),0)::text "
        "FROM procurement.po_line_observation observation "
        "WHERE nullif(btrim(observation.source_ip_text),'') IS NOT NULL")
    manual_items = psql(container, copy_name,
        "SELECT count(*)::text || ':' || coalesce(sum(ordered_quantity),0)::text "
        "FROM procurement.purchase_order_item WHERE source_kind='MANUAL_TOTVS_TRANSCRIPTION'")
    manual_allocations = psql(container, copy_name,
        "SELECT count(*)::text || ':' || coalesce(sum(allocation.quantity),0)::text "
        "FROM procurement.po_item_allocation allocation "
        "JOIN procurement.purchase_order_item item ON item.id=allocation.purchase_order_item_id "
        "WHERE allocation.status='ACTIVE' AND item.source_kind='MANUAL_TOTVS_TRANSCRIPTION'")

    environment = os.environ.copy()
    environment.update({"MIGRATION_ENV": "isolated", "MIGRATION_DATABASE_URL": copy_url,
                        "DATABASE_URL": copy_url})
    status = subprocess.check_output([node, "dist/migrate.js", "status"],
                                     cwd=api, env=environment, text=True)
    if ("Migrations: 25 aplicadas, 1 pendentes." not in status
            or "pendente  M026_source_observations_as_po_items.sql" not in status):
        raise RuntimeError("Unexpected staged migration status")
    run(node, "dist/migrate.js", "up", cwd=api, env=environment)
    final = subprocess.check_output([node, "dist/migrate.js", "status"],
                                    cwd=api, env=environment, text=True)
    if "Migrations: 26 aplicadas, 0 pendentes." not in final:
        raise RuntimeError("M026 did not complete on restored copy")
    if psql(container, copy_name,
            "SELECT count(*)::text || ':' || coalesce(sum(quantity),0)::text "
            "FROM procurement.po_line_observation") != source_rows:
        raise RuntimeError("Original PO line observations changed")
    if psql(container, copy_name,
            "SELECT count(*)::text || ':' || coalesce(sum(ordered_quantity),0)::text "
            "FROM procurement.purchase_order_item WHERE source_kind='MANUAL_TOTVS_TRANSCRIPTION'") != manual_items:
        raise RuntimeError("Existing manually registered PO items changed")

    imported_totals = psql(container, copy_name,
        "SELECT count(*)::text || ':' || coalesce(sum(item.ordered_quantity),0)::text "
        "FROM procurement.purchase_order_item item WHERE item.source_kind='IMPORTED_SOURCE_ITEM'")
    if imported_totals != source_rows:
        raise RuntimeError("Promoted PO item count or quantities differ from source lines")
    mapping_errors = psql(container, copy_name,
        "SELECT count(*) FROM procurement.po_line_observation observation "
        "LEFT JOIN procurement.purchase_order_item item "
        "ON item.source_observation_id=observation.source_row_id "
        "WHERE item.id IS NULL OR item.purchase_order_id<>observation.purchase_order_id "
        "OR item.product_code<>observation.product_code_snapshot "
        "OR item.ordered_quantity<>observation.quantity")
    if mapping_errors != "0":
        raise RuntimeError("One or more source PO lines were not promoted faithfully")

    seeded_allocations = psql(container, copy_name,
        "SELECT count(*)::text || ':' || coalesce(sum(allocation.quantity),0)::text "
        "FROM procurement.po_item_allocation allocation "
        "JOIN procurement.purchase_order_item item ON item.id=allocation.purchase_order_item_id "
        "WHERE item.source_kind='IMPORTED_SOURCE_ITEM' AND allocation.status='ACTIVE'")
    if seeded_allocations != source_ip_totals:
        raise RuntimeError("Imported PO/IP allocations do not match source IP quantities")
    unchanged_allocations = psql(container, copy_name,
        "SELECT count(*)::text || ':' || coalesce(sum(quantity),0)::text "
        "FROM procurement.po_item_allocation WHERE status='ACTIVE' "
        "AND purchase_order_item_id IN (SELECT id FROM procurement.purchase_order_item "
        "WHERE source_kind='MANUAL_TOTVS_TRANSCRIPTION')")
    if unchanged_allocations != manual_allocations:
        raise RuntimeError("Existing PO/IP allocations changed")
    quantity_errors = psql(container, copy_name,
        "SELECT count(*) FROM procurement.purchase_order_item item "
        "JOIN procurement.po_line_observation observation "
        "ON observation.source_row_id=item.source_observation_id "
        "LEFT JOIN procurement.po_item_allocation allocation "
        "ON allocation.purchase_order_item_id=item.id AND allocation.status='ACTIVE' "
        "WHERE (nullif(btrim(observation.source_ip_text),'') IS NOT NULL "
        "AND (allocation.id IS NULL OR allocation.quantity<>observation.quantity)) "
        "OR (nullif(btrim(observation.source_ip_text),'') IS NULL "
        "AND coalesce(allocation.quantity,0)<>0)")
    if quantity_errors != "0":
        raise RuntimeError("A PO item balance does not match its IP split")

    run(node, "test/operations.integration.mjs", cwd=api, env=environment)
    environment["FOLLOWUP_TEST_DATABASE_URL"] = copy_url
    run(node, "test/followup.integration.mjs", cwd=api, env=environment)
    environment["RF06_READ_DB"] = copy_name
    run(node, "test/purchase-orders.real-read.mjs", cwd=api, env=environment)
    print("M026 preserved source lines and manual balances; PO reads, PO/IP quantities, residuals and follow-up passed on the restored copy.")
finally:
    if created:
        run("/usr/bin/docker", "exec", container, "sh", "-lc",
            'dropdb -U "${POSTGRES_USER:-postgres}" --if-exists --force "$1"',
            "sh", copy_name, stdout=subprocess.DEVNULL)
