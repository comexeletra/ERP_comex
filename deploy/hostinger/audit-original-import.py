#!/usr/bin/env python3
"""Compare the approved workbook to its promoted raw rows without writing data."""

from __future__ import annotations

import argparse
from collections import Counter
import importlib.util
import json
from pathlib import Path
import sys


importer_path = Path(__file__).with_name("import-historical-workbook.py")
spec = importlib.util.spec_from_file_location("historical_import", importer_path)
assert spec and spec.loader
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


def audit(workbook: Path, dsn_file: Path, database_name: str) -> dict:
    import psycopg

    expected = importer.read_workbook(workbook)
    expected_rows = {row[0]: row for row in expected["sources"]}
    expected_issues = Counter(row[4] for row in expected["issues"])
    connection = psycopg.connect(
        importer.migration_dsn(dsn_file, database_name),
        options="-c default_transaction_read_only=on",
    )
    with connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT file_name, trim(file_sha256), mapping_version, state, source_row_count "
                "FROM migration.import_batch WHERE id = %s", (expected["batch_id"],),
            )
            batch = cursor.fetchone()
            cursor.execute(
                "SELECT id, sheet_name, row_number, raw_values, error_columns, trim(row_hash) "
                "FROM migration.source_row WHERE batch_id = %s", (expected["batch_id"],),
            )
            actual_rows = {row[0]: row for row in cursor.fetchall()}
            cursor.execute(
                "SELECT issue_code, count(*) FROM migration.data_issue "
                "WHERE batch_id = %s GROUP BY issue_code", (expected["batch_id"],),
            )
            actual_issues = Counter({code: count for code, count in cursor.fetchall()})

    missing = expected_rows.keys() - actual_rows.keys()
    unexpected = actual_rows.keys() - expected_rows.keys()
    raw_mismatches = []
    hash_mismatches = []
    flag_mismatches = []
    for row_id in expected_rows.keys() & actual_rows.keys():
        _, _, sheet, row_number, raw, error_columns, row_hash = expected_rows[row_id]
        _, actual_sheet, actual_number, actual_raw, actual_errors, actual_hash = actual_rows[row_id]
        coordinate = f"{sheet}!{row_number}"
        if (actual_sheet, actual_number, actual_raw) != (sheet, row_number, raw):
            raw_mismatches.append(coordinate)
        if actual_hash != row_hash:
            hash_mismatches.append(coordinate)
        if set(actual_errors) != set(error_columns):
            flag_mismatches.append(coordinate)

    batch_matches = batch == (
        "Follow Up Import 2026.xlsx", expected["sha256"], importer.MAPPING_VERSION,
        "PROMOTED", len(expected_rows),
    )
    issues_match = expected_issues == actual_issues
    result = {
        "approvedSha256": expected["sha256"],
        "batchMatches": batch_matches,
        "sourceRowsExpected": len(expected_rows),
        "sourceRowsActual": len(actual_rows),
        "missingRows": len(missing),
        "unexpectedRows": len(unexpected),
        "rawMismatches": len(raw_mismatches),
        "rowHashMismatches": len(hash_mismatches),
        "errorFlagMismatches": len(flag_mismatches),
        "issueCountsExpected": dict(sorted(expected_issues.items())),
        "issueCountsActual": dict(sorted(actual_issues.items())),
        "issueCountsMatch": issues_match,
        "sampleMismatchPositions": sorted(set(raw_mismatches + hash_mismatches + flag_mismatches))[:10],
    }
    result["matches"] = (
        batch_matches and issues_match and not missing and not unexpected
        and not raw_mismatches and not hash_mismatches and not flag_mismatches
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workbook", type=Path, required=True)
    parser.add_argument("--dsn-file", type=Path,
                        default=Path("/etc/import-erp/migration-release.env"))
    parser.add_argument("--database-name", default="erp_po_totvs_test")
    args = parser.parse_args()
    result = audit(args.workbook, args.dsn_file, args.database_name)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    if not result["matches"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
