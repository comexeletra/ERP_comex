from datetime import date, datetime
import importlib.util
from pathlib import Path
import sys
import unittest

spec = importlib.util.spec_from_file_location("clearance_estimates", Path(__file__).with_name("import-clearance-estimates.py"))
loader = importlib.util.module_from_spec(spec)
sys.modules["clearance_estimates"] = loader
spec.loader.exec_module(loader)


def row(ip="024A/2026", analyst="Leisiane", registered=datetime(2026, 10, 14), value=834389.97):
    cells = [None] * 12
    cells[loader.IP_COLUMN], cells[loader.ANALYST_COLUMN] = ip, analyst
    cells[loader.DATE_COLUMN], cells[loader.VALUE_COLUMN] = registered, value
    return tuple(cells)


def load_of(*rows):
    return loader.build_plan([(index, cells) for index, cells in enumerate(rows, 2)])


class Plan(unittest.TestCase):
    def test_keeps_the_ip_as_the_system_does_with_analyst_date_and_amount(self):
        load = load_of(row(ip=" Nh-010/2026 ", analyst=" João "))
        self.assertEqual(load["plan"], [{"ip": "NH-010/2026", "analyst": "João", "registrationTargetDate": "2026-10-14",
                                         "clearanceEstimateBrl": "834389.97"}])

    def test_non_breaking_spaces_and_blank_cells_are_empty(self):
        entry = load_of(row(analyst="\xa0", registered="\xa0", value=5560.72))["plan"][0]
        self.assertEqual((entry["analyst"], entry["registrationTargetDate"], entry["clearanceEstimateBrl"]),
                         (None, None, "5560.72"))

    def test_the_amount_keeps_two_decimals_and_whole_numbers_are_accepted(self):
        self.assertEqual(load_of(row(value=16935))["plan"][0]["clearanceEstimateBrl"], "16935.00")
        self.assertEqual(load_of(row(value=0.125))["plan"][0]["clearanceEstimateBrl"], "0.13")

    def test_a_plain_date_is_accepted(self):
        self.assertEqual(load_of(row(registered=date(2026, 11, 10)))["plan"][0]["registrationTargetDate"], "2026-11-10")

    def test_month_groups_and_rows_without_values_are_left_out(self):
        load = load_of(row(ip="MAY POS"), row(ip="AUGUST/SEPTEMBER POS"), row(ip="#N/A"), row(ip="Z-022/2026", analyst=None, registered=None, value=None), row())
        self.assertEqual([entry["ip"] for entry in load["plan"]], ["024A/2026"])
        self.assertEqual(load["ignoredRows"], 4)

    def test_an_ip_repeated_with_the_same_values_is_one_entry(self):
        load = load_of(row(), row(ip="024a/2026"))
        self.assertEqual(len(load["plan"]), 1)
        self.assertEqual(load["conflicts"], [])

    def test_an_ip_repeated_with_other_values_is_left_out_for_the_user(self):
        load = load_of(row(ip="Z-004B/2026", value=191619.89), row(), row(ip="Z-004B/2026", value=123145))
        self.assertEqual([entry["ip"] for entry in load["plan"]], ["024A/2026"])
        self.assertEqual(load["conflicts"], [{"ip": "Z-004B/2026", "rows": [2, 4]}])

    def test_an_unexpected_or_negative_value_stops_the_load(self):
        for fields, message in (({"registered": "10/11/2026"}, "unexpected date"), ({"value": "R$ 10"}, "unexpected estimate"),
                                ({"value": True}, "unexpected estimate"), ({"value": -233}, "negative estimate")):
            with self.assertRaisesRegex(ValueError, message):
                load_of(row(**fields))

    def test_the_headers_must_be_the_expected_ones(self):
        header = [None] * 12
        header[0], header[1], header[9], header[10] = "IP Number", "Analyst", "Date to register", "Value needed for clearance (ESTIMATED)"
        loader.check_headers(tuple(header))
        header[9] = "ETA port"
        with self.assertRaisesRegex(ValueError, "column J"):
            loader.check_headers(tuple(header))


class Sql(unittest.TestCase):
    plan = load_of(row(), row(ip="Z-025/2026", analyst="O'Neil", registered=None, value=502679.69))["plan"]

    def test_rehearsal_ends_in_rollback_and_refuses_other_databases(self):
        sql = loader.render_sql(self.plan, "a" * 64, None, False)
        self.assertTrue(sql.rstrip().endswith("ROLLBACK;"))
        self.assertIn("IF current_database() <> 'erp_po_totvs_hml' THEN", sql)
        self.assertIn("ALREADY_PROMOTED", sql)
        self.assertNotIn("COMMIT;", sql)
        self.assertNotIn("DISABLE TRIGGER", sql.upper())

    def test_only_empty_fields_are_filled_and_each_ip_is_audited(self):
        sql = loader.render_sql(self.plan, "a" * 64, 2, True)
        self.assertTrue(sql.rstrip().endswith("COMMIT;"))
        self.assertIn("CASE WHEN p.clearance_analyst IS NULL THEN plan.analyst END", sql)
        self.assertIn("CASE WHEN p.registration_target_date IS NULL THEN plan.target END", sql)
        self.assertIn("CASE WHEN p.clearance_estimate_brl IS NULL THEN plan.estimate END", sql)
        self.assertIn("p.record_status <> 'DELETED'", sql)
        self.assertIn("'HISTORICAL_IMPORT', 'clearance_estimate'", sql)
        self.assertIn("Expected 2 IPs to fill", sql)
        self.assertIn("('Z-025/2026','O''Neil',NULL,'502679.69'::numeric)", sql)
        self.assertIn("('024A/2026','Leisiane','2026-10-14'::date,'834389.97'::numeric)", sql)

    def test_commit_needs_the_expected_ips(self):
        with self.assertRaisesRegex(ValueError, "--expected-ips"):
            loader.render_sql(self.plan, "a" * 64, None, True)

    def test_the_same_workbook_gives_the_same_batch(self):
        self.assertEqual(loader.render_sql(self.plan, "b" * 64, None, False), loader.render_sql(self.plan, "b" * 64, None, False))


if __name__ == "__main__":
    unittest.main()
