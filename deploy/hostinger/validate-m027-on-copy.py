#!/usr/bin/env python3
"""Validate historical operational backfill on a verified restore of production."""

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
copy_name = f"erp_m027_{stamp.replace('T', '').replace('Z', '')}_ci"
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

ledger = psql(container, "erp_po_totvs_test", "SELECT count(*) FROM migration.schema_migration")
if ledger != "26":
    raise SystemExit("Expected M001-M026 before M027 validation")

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
digest = hashlib.sha256()
with backup.open("rb") as source:
    for chunk in iter(lambda: source.read(1024 * 1024), b""):
        digest.update(chunk)
checksum = digest.hexdigest()
print("Verified backup:", backup)
print("SHA256:", checksum)

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
    if psql(container, copy_name, "SELECT count(*) FROM migration.schema_migration") != "26":
        raise RuntimeError("Restored ledger is not at M026")

    snapshots = """
      CREATE SCHEMA m027_validation;
      CREATE TABLE m027_validation.po AS
        SELECT id, jsonb_strip_nulls(jsonb_build_object(
          'supplier_text', supplier_text, 'order_date', order_date)) AS values
        FROM procurement.purchase_order;
      CREATE TABLE m027_validation.item AS
        SELECT id, jsonb_strip_nulls(jsonb_build_object(
          'necessity_date', necessity_date, 'priority', priority, 'demand', demand,
          'requester', requester, 'sc_number', sc_number, 'sc_approval_date', sc_approval_date,
          'purpose', purpose, 'cost_center', cost_center, 'draft_po', draft_po,
          'po_approval_date', po_approval_date, 'po_sent_date', po_sent_date,
          'category', category, 'ncm', ncm, 'remarks', remarks)) AS values
        FROM procurement.purchase_order_item;
      CREATE TABLE m027_validation.process AS
        SELECT id, jsonb_strip_nulls(jsonb_build_object(
          'priority', priority, 'logistics_status', logistics_status, 'ip_totvs_date', ip_totvs_date,
          'transport_mode', transport_mode, 'incoterm', incoterm, 'broker', broker,
          'port_loading', port_loading, 'port_discharge', port_discharge, 'etd', etd,
          'eta_confirmed', eta_confirmed, 'ete_confirmed', ete_confirmed, 'arrival_date', arrival_date,
          'duimp_number', duimp_number, 'duimp_date', duimp_date, 'customs_channel', customs_channel,
          'clearance_date', clearance_date, 'nf_request_date', nf_request_date,
          'delivery_date', delivery_date, 'freight_currency', freight_currency,
          'freight_cost', freight_cost, 'container_number', container_number,
          'container_type', container_type, 'container_quantity', container_quantity,
          'forwarder', forwarder, 'documents_ok', documents_ok,
          'storage_due_override', storage_due_override, 'taxes_paid_brl', taxes_paid_brl,
          'fine_brl', fine_brl, 'storage_brl', storage_brl, 'demurrage_brl', demurrage_brl,
          'demurrage_container_quantity', demurrage_container_quantity)) AS values
        FROM imports.import_process;
    """
    run("/usr/bin/docker", "exec", "-i", container, "sh", "-lc",
        'psql -U "${POSTGRES_USER:-postgres}" -d "$1" -v ON_ERROR_STOP=1',
        "sh", copy_name, input=snapshots, text=True)

    before = {
        "source_rows": psql(container, copy_name, "SELECT count(*) FROM migration.source_row"),
        "purchase_orders": psql(container, copy_name, "SELECT count(*) FROM procurement.purchase_order"),
        "processes": psql(container, copy_name, "SELECT count(*) FROM imports.import_process"),
        "imported_items": psql(container, copy_name,
            "SELECT count(*)::text || ':' || coalesce(sum(ordered_quantity),0)::text "
            "FROM procurement.purchase_order_item WHERE source_kind='IMPORTED_SOURCE_ITEM'"),
        "active_allocations": psql(container, copy_name,
            "SELECT count(*)::text || ':' || coalesce(sum(quantity),0)::text "
            "FROM procurement.po_item_allocation WHERE status='ACTIVE'"),
        "documents": psql(container, copy_name, "SELECT count(*) FROM imports.process_document"),
        "manual_items": psql(container, copy_name,
            "SELECT count(*)::text || ':' || coalesce(sum(ordered_quantity),0)::text "
            "FROM procurement.purchase_order_item WHERE source_kind='MANUAL_TOTVS_TRANSCRIPTION'"),
    }

    environment = os.environ.copy()
    environment.update({"MIGRATION_ENV": "isolated", "MIGRATION_DATABASE_URL": copy_url,
                        "DATABASE_URL": copy_url})
    status = subprocess.check_output([node, "dist/migrate.js", "status"], cwd=api,
                                     env=environment, text=True)
    if ("Migrations: 26 aplicadas, 1 pendentes." not in status
            or "pendente  M027_operationalize_historical_workbook.sql" not in status):
        raise RuntimeError("Unexpected staged migration status")
    run(node, "dist/migrate.js", "up", cwd=api, env=environment)
    final = subprocess.check_output([node, "dist/migrate.js", "status"], cwd=api,
                                    env=environment, text=True)
    if "Migrations: 27 aplicadas, 0 pendentes." not in final:
        raise RuntimeError("M027 did not complete on the restored copy")

    after = {
        "source_rows": psql(container, copy_name, "SELECT count(*) FROM migration.source_row"),
        "purchase_orders": psql(container, copy_name, "SELECT count(*) FROM procurement.purchase_order"),
        "processes": psql(container, copy_name, "SELECT count(*) FROM imports.import_process"),
        "imported_items": psql(container, copy_name,
            "SELECT count(*)::text || ':' || coalesce(sum(ordered_quantity),0)::text "
            "FROM procurement.purchase_order_item WHERE source_kind='IMPORTED_SOURCE_ITEM'"),
        "active_allocations": psql(container, copy_name,
            "SELECT count(*)::text || ':' || coalesce(sum(quantity),0)::text "
            "FROM procurement.po_item_allocation WHERE status='ACTIVE'"),
        "documents": psql(container, copy_name, "SELECT count(*) FROM imports.process_document"),
        "manual_items": psql(container, copy_name,
            "SELECT count(*)::text || ':' || coalesce(sum(ordered_quantity),0)::text "
            "FROM procurement.purchase_order_item WHERE source_kind='MANUAL_TOTVS_TRANSCRIPTION'"),
    }
    for key in ("source_rows", "purchase_orders", "processes", "imported_items", "active_allocations", "manual_items"):
        if before[key] != after[key]:
            raise RuntimeError(f"M027 changed invariant {key}: {before[key]} -> {after[key]}")
    if int(after["documents"]) < int(before["documents"]):
        raise RuntimeError("M027 removed operational documents")

    preserved_values = psql(container, copy_name, """
      SELECT
        (SELECT count(*) FROM m027_validation.po snapshot
         JOIN procurement.purchase_order current_row USING (id)
         CROSS JOIN LATERAL jsonb_each(snapshot.values) old
         WHERE to_jsonb(current_row)->old.key IS DISTINCT FROM old.value)
        + (SELECT count(*) FROM m027_validation.item snapshot
           JOIN procurement.purchase_order_item current_row USING (id)
           CROSS JOIN LATERAL jsonb_each(snapshot.values) old
           WHERE to_jsonb(current_row)->old.key IS DISTINCT FROM old.value)
        + (SELECT count(*) FROM m027_validation.process snapshot
           JOIN imports.import_process current_row USING (id)
           CROSS JOIN LATERAL jsonb_each(snapshot.values) old
           WHERE to_jsonb(current_row)->old.key IS DISTINCT FROM old.value)
    """)
    if preserved_values != "0":
        raise RuntimeError(f"M027 overwrote {preserved_values} previously populated operational values")

    for test_file in ("test/reports-summary.integration.mjs",
                      "test/purchase-orders.summary.integration.mjs",
                      "test/operations.integration.mjs", "test/followup.integration.mjs"):
        run(node, test_file, cwd=api, env={**environment, "FOLLOWUP_TEST_DATABASE_URL": copy_url})
    print("M027 preserved source rows, PO/IP identities, quantities, active allocations, manual items and existing typed values; operational integration checks passed on the restored copy.")
finally:
    if created:
        run("/usr/bin/docker", "exec", container, "sh", "-lc",
            'dropdb -U "${POSTGRES_USER:-postgres}" --if-exists --force "$1"',
            "sh", copy_name, stdout=subprocess.DEVNULL)
