import importlib.util
from pathlib import Path
import sys
import unittest

spec = importlib.util.spec_from_file_location("clearance_estimates", Path(__file__).with_name("import-clearance-estimates.py"))
loader = importlib.util.module_from_spec(spec)
sys.modules["clearance_estimates"] = loader
spec.loader.exec_module(loader)


def row(ip="024A/2026", value=834389.97, analyst="Leisiane"):
    cells = [None] * 12
    cells[loader.IP_COLUMN], cells[1], cells[loader.VALUE_COLUMN] = ip, analyst, value
    return tuple(cells)


def load_of(*rows):
    return loader.build_plan([(index, cells) for index, cells in enumerate(rows, 2)])


class Plan(unittest.TestCase):
    def test_keeps_only_the_ip_as_the_system_does_and_the_value_need(self):
        self.assertEqual(load_of(row(ip=" Nh-010/2026 ", value=5560.72))["plan"],
                         [{"ip": "NH-010/2026", "clearanceEstimateBrl": "5560.72"}])

    def test_the_amount_keeps_two_decimals_and_whole_numbers_are_accepted(self):
        self.assertEqual(load_of(row(value=16935))["plan"][0]["clearanceEstimateBrl"], "16935.00")
        self.assertEqual(load_of(row(value=0.125))["plan"][0]["clearanceEstimateBrl"], "0.13")
        self.assertEqual(load_of(row(value=0))["plan"][0]["clearanceEstimateBrl"], "0.00")

    def test_month_groups_and_rows_without_value_need_are_left_out(self):
        load = load_of(row(ip="MAY POS"), row(ip="AUGUST/SEPTEMBER POS"), row(ip="#N/A"), row(ip="Z-022/2026", value="\xa0"),
                       row(ip="Z-023/2026", value=None), row(ip="FEBRUARY POS", value=-233), row())
        self.assertEqual([entry["ip"] for entry in load["plan"]], ["024A/2026"])
        self.assertEqual(load["ignoredRows"], 6)

    def test_an_ip_repeated_with_the_same_value_is_one_entry(self):
        load = load_of(row(), row(ip="024a/2026", analyst="Outro"))
        self.assertEqual(len(load["plan"]), 1)
        self.assertEqual(load["conflicts"], [])

    def test_an_ip_repeated_with_another_value_is_left_out_for_the_user(self):
        load = load_of(row(ip="Z-004B/2026", value=191619.89), row(), row(ip="Z-004B/2026", value=123145))
        self.assertEqual([entry["ip"] for entry in load["plan"]], ["024A/2026"])
        self.assertEqual(load["conflicts"], [{"ip": "Z-004B/2026", "rows": [2, 4]}])

    def test_an_unexpected_or_negative_value_of_an_ip_stops_the_load(self):
        for value, message in (("R$ 10", "unexpected estimate"), (True, "unexpected estimate"), (-1, "negative estimate")):
            with self.assertRaisesRegex(ValueError, message):
                load_of(row(value=value))

    def test_the_headers_must_be_the_expected_ones(self):
        header = [None] * 12
        header[0], header[10] = "IP Number", "Value needed for clearance (ESTIMATED)"
        loader.check_headers(tuple(header))
        header[10] = "Estimated CIF"
        with self.assertRaisesRegex(ValueError, "column K"):
            loader.check_headers(tuple(header))


class Sql(unittest.TestCase):
    plan = load_of(row(), row(ip="Z-025/2026", value=502679.69))["plan"]

    def test_rehearsal_ends_in_rollback_and_refuses_other_databases(self):
        sql = loader.render_sql(self.plan, "a" * 64, None, False)
        self.assertTrue(sql.rstrip().endswith("ROLLBACK;"))
        self.assertIn("IF current_database() <> 'erp_po_totvs_hml' THEN", sql)
        self.assertIn("ALREADY_PROMOTED", sql)
        self.assertNotIn("COMMIT;", sql)
        self.assertNotIn("DISABLE TRIGGER", sql.upper())

    def test_only_the_empty_estimate_is_filled_and_each_ip_is_audited(self):
        sql = loader.render_sql(self.plan, "a" * 64, 2, True)
        self.assertTrue(sql.rstrip().endswith("COMMIT;"))
        self.assertIn("WHERE p.clearance_estimate_brl IS NULL", sql)
        self.assertIn("SET clearance_estimate_brl = plan.estimate", sql)
        self.assertNotIn("taxes_paid_brl", sql)
        self.assertNotIn("clearance_analyst", sql)
        self.assertIn("p.record_status <> 'DELETED'", sql)
        self.assertIn("'HISTORICAL_IMPORT', 'clearance_estimate_brl'", sql)
        self.assertIn("Expected 2 IPs to fill", sql)
        self.assertIn("('024A/2026','834389.97'::numeric)", sql)
        self.assertIn("('Z-025/2026','502679.69'::numeric)", sql)

    def test_commit_needs_the_expected_ips(self):
        with self.assertRaisesRegex(ValueError, "--expected-ips"):
            loader.render_sql(self.plan, "a" * 64, None, True)

    def test_the_same_workbook_gives_the_same_batch(self):
        self.assertEqual(loader.render_sql(self.plan, "b" * 64, None, False), loader.render_sql(self.plan, "b" * 64, None, False))


if __name__ == "__main__":
    unittest.main()
