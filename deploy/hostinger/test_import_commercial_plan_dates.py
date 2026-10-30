from datetime import date, datetime
import importlib.util
from pathlib import Path
import sys
import unittest

spec = importlib.util.spec_from_file_location("commercial_plan", Path(__file__).with_name("import-commercial-plan-dates.py"))
loader = importlib.util.module_from_spec(spec)
sys.modules["commercial_plan"] = loader
spec.loader.exec_module(loader)


def row(po=14619, received=datetime(2025, 7, 5), sc=11413):
    cells = [None] * 17
    cells[loader.PO_COLUMN], cells[loader.DATE_COLUMN], cells[loader.SC_COLUMN] = po, received, sc
    return tuple(cells)


def plan_of(*rows):
    return loader.build_plan([(index, cells) for index, cells in enumerate(rows, 3)])


class Plan(unittest.TestCase):
    def test_pads_po_and_sc_and_keeps_only_the_date(self):
        self.assertEqual(plan_of(row()), [{"po": "014619", "sc": "011413", "received": "2025-07-05"}])

    def test_rows_of_the_same_po_and_sc_are_one_entry(self):
        self.assertEqual(len(plan_of(row(), row())), 1)

    def test_one_sc_keeps_the_date_of_each_po(self):
        plan = plan_of(row(po=29570, received=datetime(2026, 7, 5), sc=19725), row(po=29165, received=datetime(2026, 7, 17), sc=19725))
        self.assertEqual([(entry["po"], entry["received"]) for entry in plan], [("029165", "2026-07-17"), ("029570", "2026-07-05")])

    def test_two_dates_on_the_same_po_and_sc_stop_the_load(self):
        with self.assertRaisesRegex(ValueError, "two dates"):
            plan_of(row(), row(received=datetime(2025, 7, 6)))

    def test_a_plain_date_is_accepted(self):
        self.assertEqual(plan_of(row(received=date(2025, 7, 5)))[0]["received"], "2025-07-05")

    def test_a_row_without_date_stops_the_load(self):
        for value in (None, "", "#N/A", 45841):
            with self.assertRaisesRegex(ValueError, "unexpected date"):
                plan_of(row(received=value))

    def test_a_row_without_a_valid_sc_or_po_stops_the_load(self):
        for fields in ({"sc": None}, {"sc": "ABC"}, {"po": None}, {"po": 14619.5}):
            with self.assertRaisesRegex(ValueError, "unexpected"):
                plan_of(row(**fields))

    def test_headers_must_be_the_columns_the_user_named(self):
        header = [None] * 17
        header[loader.PO_COLUMN], header[loader.DATE_COLUMN], header[loader.SC_COLUMN] = "PO", "RECEBIMENTO\nPLANO", "SC"
        loader.check_headers(tuple(header))
        header[loader.DATE_COLUMN] = "GERAÇÃO\nMRP"
        with self.assertRaisesRegex(ValueError, "Unexpected columns"):
            loader.check_headers(tuple(header))


class Sql(unittest.TestCase):
    plan = [{"po": "014619", "sc": "011413", "received": "2025-07-05"}]

    def render(self, commit=False):
        return loader.render_sql(self.plan, "a" * 64, 10, commit)

    def test_rehearsal_is_the_default_and_commit_is_explicit(self):
        self.assertTrue(self.render().endswith("ROLLBACK;\n"))
        self.assertTrue(self.render(True).endswith("COMMIT;\n"))
        self.assertNotIn("COMMIT;", self.render())

    def test_only_the_hml_database_is_allowed(self):
        self.assertIn("current_database() <> 'erp_po_totvs_hml'", self.render())

    def test_triggers_stay_active(self):
        sql = self.render().lower()
        self.assertNotIn("session_replication_role", sql)
        self.assertNotIn("disable trigger", sql)

    def test_a_repeat_or_an_existing_date_is_refused(self):
        sql = self.render()
        self.assertIn("ALREADY_PROMOTED", sql)
        self.assertIn("does not replace dates already recorded", sql)

    def test_the_date_goes_to_the_sc_and_to_its_lines(self):
        sql = self.render()
        self.assertIn("UPDATE procurement.purchase_request AS request\n   SET commercial_plan_received_date = plan.received", sql)
        self.assertIn("UPDATE procurement.purchase_order_item AS item SET commercial_plan_received_date = plan.received", sql)

    def test_lines_are_matched_by_sc_never_by_po_alone(self):
        sql = self.render()
        self.assertIn("JOIN plan_row AS plan ON plan.sc = item_sc.sc", sql)
        self.assertNotIn("plan.po = po.normalized_number", sql)

    def test_two_cell_scs_are_split_and_two_dates_use_the_po(self):
        sql = self.render()
        self.assertIn("string_to_array(replace(item.sc_number, ' ', ''), ',')", sql)
        self.assertIn("WHEN cardinality(po_dates) = 1 THEN po_dates[1]", sql)
        self.assertIn("A line has two dates and no date of its own PO", sql)

    def test_closed_pos_return_to_their_exact_state(self):
        sql = self.render()
        self.assertLess(sql.index("SET lifecycle_status = 'ACTIVE'"), sql.index("UPDATE procurement.purchase_order_item AS item SET commercial_plan_received_date"))
        self.assertLess(sql.index("UPDATE procurement.purchase_order_item AS item SET commercial_plan_received_date"), sql.index("SET lifecycle_status = state.lifecycle_status"))
        self.assertIn("did not return to their state", sql)

    def test_any_other_total_of_lines_stops_the_load(self):
        self.assertIn("Expected 10 lines with date", self.render())
        self.assertIn("Expected 1 SCs with date", self.render())

    def test_the_new_sc_only_fills_a_po_without_sc(self):
        sql = self.render()
        self.assertEqual(loader.NEW_REQUESTS, {"020328": "031362"})
        self.assertIn("is not the active PO without SC", sql)
        self.assertIn("item.sc_number IS NOT NULL);", sql)
        self.assertLess(sql.index("purchase_request (id, importer"), sql.index("CREATE TEMP TABLE plan_item"))


class SqlByPo(unittest.TestCase):
    plan = [{"po": "014619", "sc": "011413", "received": "2025-07-05"}]

    def render(self, commit=False):
        return loader.render_by_po_sql(self.plan, "a" * 64, 20, 5, commit)

    def test_rehearsal_is_the_default_and_triggers_stay_active(self):
        self.assertTrue(self.render().endswith("ROLLBACK;\n"))
        self.assertTrue(self.render(True).endswith("COMMIT;\n"))
        self.assertNotIn("session_replication_role", self.render())
        self.assertIn("current_database() <> 'erp_po_totvs_hml'", self.render())

    def test_it_needs_the_first_step_and_runs_once(self):
        sql = self.render()
        self.assertIn("The dates by SC must be loaded first", sql)
        self.assertIn("ALREADY_PROMOTED: the dates by PO were already loaded", sql)
        self.assertNotEqual(loader.uuid5(loader.NAMESPACE, "a" * 64), loader.uuid5(loader.NAMESPACE, ("a" * 64) + "|by-po"))

    def test_it_only_fills_scs_and_lines_without_date(self):
        sql = self.render()
        self.assertIn("WHERE request.commercial_plan_received_date IS NULL", sql)
        self.assertIn("item.sc_number IS NOT NULL AND item.commercial_plan_received_date IS NULL", sql)

    def test_the_date_comes_from_the_po_and_reaches_every_line_of_the_sc(self):
        sql = self.render()
        self.assertIn("ON plan.po = item_sc.po_number", sql)
        self.assertIn("WHERE request.sc = ANY (string_to_array(replace(item.sc_number, ' ', ''), ','))", sql)

    def test_two_dates_use_the_po_of_the_line_or_stop_the_load(self):
        sql = self.render()
        self.assertIn("WHEN cardinality(po_dates) = 1 THEN po_dates[1]", sql)
        self.assertIn("A line has two dates and no date of its own PO", sql)

    def test_it_never_changes_the_sc_of_a_line(self):
        self.assertNotIn("SET sc_number", self.render())

    def test_closed_pos_return_and_totals_are_reconciled(self):
        sql = self.render()
        self.assertIn("SET lifecycle_status = state.lifecycle_status", sql)
        self.assertIn("Expected 20 lines with date", sql)
        self.assertIn("Expected 5 SCs with date", sql)


if __name__ == "__main__":
    unittest.main()
