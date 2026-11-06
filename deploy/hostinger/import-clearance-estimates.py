#!/usr/bin/env python3
"""Fill the clearance tax estimate of the IPs from the Import Clearance Estimations sheet, as one SQL transaction for HML.

Rules and decisions are in docs/PLANO_ESTIMATIVA_DESEMBARACO.md. The user asked to copy only the Value Need
(column K, "Value needed for clearance (ESTIMATED)") of each IP into imports.import_process.clearance_estimate_brl
(M080). The analyst, the date to register and the other columns of the sheet are not loaded. Only empty estimates
are filled: what someone typed in the system is never replaced.

Rows without an IP number (the month groups, such as "MAY POS") are left out. An IP repeated with other values
is left out and listed in the report, for the user to decide. The script never connects to a database. The SQL
refuses any database other than erp_po_totvs_hml and, without --commit, ends in ROLLBACK with every trigger active.
"""

from __future__ import annotations

import argparse
from decimal import ROUND_HALF_UP, Decimal
from hashlib import sha256
import json
from pathlib import Path
import re
from uuid import UUID, uuid5

NAMESPACE = UUID("4b7f6a52-2f0e-4d8e-9a43-6c1d2e8b5f31")
ACTOR = "migration:clearance-estimate-load"
EXPECTED_DATABASE = "erp_po_totvs_hml"
SHEET = "Import Clearance Estimations"
HEADER_ROW = 1
IP_COLUMN, VALUE_COLUMN = 0, 10
HEADERS = {IP_COLUMN: "IP NUMBER", VALUE_COLUMN: "VALUE NEEDED FOR CLEARANCE (ESTIMATED)"}
CENT = Decimal("0.01")
# An IP ends with its year ("024A/2026", "H-CWB007/2026"); month groups such as "AUGUST/SEPTEMBER POS" do not.
IP_PATTERN = re.compile(r"[A-Z0-9][A-Z0-9 .-]*/[0-9]{4}")


def text(value: object) -> str:
    """The cell as text; the non-breaking spaces the sheet uses for empty cells count as spaces."""
    return "" if value is None else " ".join(str(value).replace("\xa0", " ").split())


def sql_text(value: object) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def check_headers(header: tuple) -> None:
    for column, expected in HEADERS.items():
        found = text(header[column] if column < len(header) else None).upper()
        if found != expected:
            raise ValueError(f"Unexpected column {chr(65 + column)}: {found!r}, expected {expected!r}")


def ip_number(value: object) -> str:
    """The IP as the system keeps it (upper case, no outer spaces); a month group is not an IP."""
    candidate = text(value).upper()
    return candidate if IP_PATTERN.fullmatch(candidate) else ""


def estimate(value: object, row: int) -> str | None:
    if isinstance(value, bool):
        raise ValueError(f"Row {row}: unexpected estimate: {value!r}")
    if isinstance(value, (int, float)):
        amount = Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)
        if amount < 0:
            raise ValueError(f"Row {row}: negative estimate: {value!r}")
        return str(amount)
    if text(value) == "":
        return None
    raise ValueError(f"Row {row}: unexpected estimate: {value!r}")


def build_plan(rows: list[tuple[int, tuple]]) -> dict:
    """One entry per IP with a Value Need. An IP repeated with another value is a conflict, left out."""
    entries: dict[str, str] = {}
    rows_of: dict[str, list[int]] = {}
    conflicts: set[str] = set()
    ignored = 0
    for row_number, cells in rows:
        cells = tuple(cells) + (None,) * (VALUE_COLUMN + 1 - len(cells))
        ip = ip_number(cells[IP_COLUMN])
        amount = estimate(cells[VALUE_COLUMN], row_number) if ip else None
        if not ip or amount is None:
            ignored += 1
            continue
        rows_of.setdefault(ip, []).append(row_number)
        if entries.setdefault(ip, amount) != amount:
            conflicts.add(ip)
    plan = [{"ip": ip, "clearanceEstimateBrl": amount} for ip, amount in sorted(entries.items()) if ip not in conflicts]
    return {"plan": plan, "ignoredRows": ignored,
            "conflicts": [{"ip": ip, "rows": rows_of[ip]} for ip in sorted(conflicts)]}


def summary(load: dict, digest: str, expected_ips: int | None) -> dict:
    return {"sha256": digest, "actor": ACTOR, "sheet": SHEET, "plannedIps": len(load["plan"]),
            "ignoredRows": load["ignoredRows"], "conflicts": load["conflicts"], "expectedIps": expected_ips,
            "plan": load["plan"]}


def render_sql(plan: list[dict], digest: str, expected_ips: int | None, commit: bool) -> str:
    if commit and expected_ips is None:
        raise ValueError("--commit needs --expected-ips")
    batch_id = str(uuid5(NAMESPACE, digest))
    values = ",\n".join(f"({sql_text(entry['ip'])},{sql_text(entry['clearanceEstimateBrl'])}::numeric)" for entry in plan)
    reconcile = "" if expected_ips is None else f"""
  IF found <> {expected_ips} THEN RAISE EXCEPTION 'Expected {expected_ips} IPs to fill, found %', found; END IF;"""
    parts = ["\\set ON_ERROR_STOP on", "BEGIN;", "SET LOCAL lock_timeout = '30s';", f"SET LOCAL app.actor_id = {sql_text(ACTOR)};",
             f"""DO $guard$
BEGIN
  IF current_database() <> '{EXPECTED_DATABASE}' THEN
    RAISE EXCEPTION 'Refusing to load into %: only {EXPECTED_DATABASE} is allowed', current_database();
  END IF;
  IF EXISTS (SELECT 1 FROM audit.audit_log WHERE correlation_id = {sql_text(batch_id)}::uuid) THEN
    RAISE EXCEPTION 'ALREADY_PROMOTED: this workbook was already loaded';
  END IF;
END $guard$;""",
             "CREATE TEMP TABLE plan_row (ip text PRIMARY KEY, estimate numeric(18,2) NOT NULL) ON COMMIT DROP;",
             f"""INSERT INTO plan_row (ip, estimate) VALUES
{values};""" if plan else "-- The sheet has no IP to load.",
             f"""-- Only empty estimates are filled: what someone typed in the system stays.
CREATE TEMP TABLE plan_ip ON COMMIT DROP AS
SELECT p.id, plan.ip, plan.estimate
  FROM plan_row AS plan
  JOIN imports.import_process AS p ON p.normalized_ip_number = plan.ip AND p.record_status <> 'DELETED'
 WHERE p.clearance_estimate_brl IS NULL;
DO $report$
DECLARE missing text; typed bigint; found bigint;
BEGIN
  SELECT string_agg(plan.ip, ', ' ORDER BY plan.ip) INTO missing FROM plan_row AS plan
   WHERE NOT EXISTS (SELECT 1 FROM imports.import_process AS p
                      WHERE p.normalized_ip_number = plan.ip AND p.record_status <> 'DELETED');
  SELECT count(*) INTO typed FROM plan_row AS plan JOIN imports.import_process AS p
      ON p.normalized_ip_number = plan.ip AND p.record_status <> 'DELETED' AND p.clearance_estimate_brl IS NOT NULL;
  SELECT count(*) INTO found FROM plan_ip;
  RAISE NOTICE 'IPs of the sheet: %, to fill: %, already typed (kept): %, not in the system: %',
    (SELECT count(*) FROM plan_row), found, typed, coalesce(missing, 'none');{reconcile}
END $report$;
UPDATE imports.import_process AS p
   SET clearance_estimate_brl = plan.estimate, version = p.version + 1, updated_at = now()
  FROM plan_ip AS plan WHERE p.id = plan.id;
INSERT INTO audit.audit_log (id, aggregate_type, aggregate_id, entity_type, entity_id, operation, field_name, new_value, actor_id, occurred_at, reason, correlation_id)
SELECT gen_random_uuid(), 'IMPORT_PROCESS', id, 'IMPORT_PROCESS', id, 'HISTORICAL_IMPORT', 'clearance_estimate_brl',
       jsonb_build_object('sha256', {sql_text(digest)}, 'clearanceEstimateBrl', estimate),
       {sql_text(ACTOR)}, now(), 'Value Need da aba Import Clearance Estimations do Follow Up, a pedido do usuário.',
       {sql_text(batch_id)}::uuid
  FROM plan_ip;
DO $check$
DECLARE wrong bigint;
BEGIN
  SELECT count(*) INTO wrong FROM plan_ip AS plan JOIN imports.import_process AS p ON p.id = plan.id
   WHERE p.clearance_estimate_brl IS DISTINCT FROM plan.estimate;
  IF wrong <> 0 THEN RAISE EXCEPTION '% IPs did not take the estimate', wrong; END IF;
END $check$;""",
             "COMMIT;" if commit else "ROLLBACK;"]
    return "\n".join(parts) + "\n"


def read_workbook(path: Path) -> tuple[str, list[tuple[int, tuple]]]:
    from openpyxl import load_workbook

    digest = sha256(path.read_bytes()).hexdigest()
    workbook = load_workbook(path, read_only=True, data_only=True)
    try:
        rows = workbook[SHEET].iter_rows(min_row=HEADER_ROW, max_col=VALUE_COLUMN + 1, values_only=True)
        check_headers(next(rows))
        return digest, [(index, row) for index, row in enumerate(rows, HEADER_ROW + 1)
                        if any(text(value) for value in row)]
    finally:
        workbook.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workbook", type=Path, required=True)
    parser.add_argument("--expected-sha256", required=True, help="SHA-256 of the workbook approved for this load")
    parser.add_argument("--expected-ips", type=int, help="IPs that must be filled; required with --commit")
    parser.add_argument("--sql", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--commit", action="store_true", help="End the SQL with COMMIT; the default is ROLLBACK, a rehearsal")
    args = parser.parse_args()
    digest, rows = read_workbook(args.workbook)
    if digest != args.expected_sha256:
        raise SystemExit(f"Workbook SHA-256 {digest} differs from the approved {args.expected_sha256}")
    load = build_plan(rows)
    try:
        sql = render_sql(load["plan"], digest, args.expected_ips, args.commit)
    except ValueError as error:
        raise SystemExit(str(error)) from error
    args.sql.write_text(sql, encoding="utf-8", newline="\n")
    report = summary(load, digest, args.expected_ips)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
    print(json.dumps({key: value for key, value in report.items() if key != "plan"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
