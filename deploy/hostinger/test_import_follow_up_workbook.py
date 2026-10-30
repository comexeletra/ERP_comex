from datetime import date, datetime
from decimal import Decimal
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("follow_up", Path(__file__).with_name("import-follow-up-workbook.py"))
loader = importlib.util.module_from_spec(spec)
import sys
sys.modules["follow_up"] = loader
spec.loader.exec_module(loader)

PRE_HEADERS = {"B": "Necessity", "C": "Priority", "D": "Alert", "E": "Status", "F": "Importer", "G": "Demand", "H": "Requester",
               "I": "SC Totvs", "J": "SC Appr. Date", "K": "SI", "L": "Finalidade", "M": "Cost Center", "N": "Draft PO", "O": "Analyst",
               "P": "PO Totvs", "Q": "PO Date", "R": "PO Appr. Date", "S": "PO Sent Date", "T": "Supplier", "U": "Group",
               "V": "Category", "W": "Product Code", "X": "Product Description", "Y": "NCM", "Z": "Qty", "AA": "Unit Price",
               "AB": "Total Price", "AC": "Currency", "AD": "Remarks", "AE": "IP Number", "AF": "IP Date Totvs", "AG": "Mode",
               "AH": "Incoterm", "AI": "Broker", "AJ": "POL", "AK": "POD", "AL": "ETD", "AM": "ETA", "AN": "Transit Time",
               "AO": "Invoice", "AP": "BL Number", "AQ": "BL Date", "AR": "Arrival", "AS": "Duimp", "AT": "Duimp Date",
               "AU": "Channel", "AV": "Clearance", "AW": "ETE", "AX": "NF Request", "AY": "NF", "AZ": "NF Issue Date",
               "BA": "Delivery Date"}
POST_HEADERS = {"B": "IP Number", "C": "Priority", "D": "Alert", "E": "Status", "F": "Importer", "G": "Supplier", "H": "Invoice",
                "I": "Currency", "J": "Total Amount", "K": "Mode", "L": "Incoterm", "M": "POL", "N": "POD", "O": "Broker",
                "P": "BL Number", "Q": "ETD", "R": "Transit Time", "S": "ETA", "T": "ETE Eletra", "U": "BL Date",
                "V": "Freight Ccy.", "W": "Freight Cost", "X": "Container", "Y": "Forwarder", "Z": "Doc ok", "AA": "Arrival",
                "AB": "Due Storage", "AC": "Taxes Paid (R$)", "AD": "Duimp", "AE": "Duimp Date", "AF": "Channel", "AG": "Clearance",
                "AH": "NF Request", "AI": "Ctnr Type", "AJ": "Ctnr Qty", "AK": "NF", "AL": "NF Issue Date", "AM": "NF Homolog.",
                "AN": "Delivery Date"}
PRE = {header: letter for letter, header in PRE_HEADERS.items()}
POST = {header: letter for letter, header in POST_HEADERS.items()}
REGISTERED = {
    "PRIORITY": ["Normal", "Prioridade"], "CATEGORY": ["WATER METER", "BESS", "0"], "DEMAND": ["Sample"],
    "REQUESTER": ["PCM - JESSICA", "R&D -", "R&D - BRENO CHAVES"], "PURPOSE": ["Revenda"], "COST_CENTER": ["1202027"],
    "GROUP": ["Energy"], "BROKER": ["AGIL", "ÁGIL", "0"], "FORWARDER": ["SAVINO DEL BENE"], "INCOTERM": ["FOB", "0"],
    "PORT_LOADING": ["NGB"], "PORT_DISCHARGE": ["PEC"], "CONTAINER_TYPE": ["40'HQ", "40' NOR", "20'GP"],
    "TRANSPORT_MODE": ["SEA", "AIR", "COURIER"], "CUSTOMS_CHANNEL": ["GREEN"], "CURRENCY": ["CNY", "USD", "BRL", "EUR"],
}
SUPPLIERS = {"HEXING", "ZLINK", "NANJING HEXING"}


def pre_row(**fields):
    base = {"Status": "WAITING PRODUCTION", "Importer": "ELETRA MATRIZ", "SC Totvs": 11976, "PO Totvs": 30201, "Supplier": "HEXING",
            "Product Code": "ABC", "Product Description": "Produto", "Qty": 10, "Unit Price": 2.5, "Currency": "CNY"}
    base.update(fields)
    return {PRE[header.replace("_", " ")] if header.replace("_", " ") in PRE else PRE[header]: value for header, value in base.items()}


def post_row(**fields):
    base = {"IP Number": "IP-1", "Status": "WAITING ARRIVAL", "Importer": "ELETRA MATRIZ", "Supplier": "HEXING", "Invoice": "INV-1",
            "Currency": "CNY", "Total Amount": 100.5, "Mode": "Sea"}
    base.update(fields)
    return {POST[header]: value for header, value in base.items()}


def build(pre, post=(), typed=()):
    return loader.build_load(list(enumerate(pre, 4)), list(enumerate(post, 5)), PRE_HEADERS, POST_HEADERS, REGISTERED, SUPPLIERS,
                             "a" * 64, set(typed), "planilha.xlsx")


def issues(load, code):
    return [item for item in load["issues"] if item["code"] == code]


class Numbers(unittest.TestCase):
    def test_po_numbers_get_the_lost_zeros_up_to_six_digits(self):
        self.assertEqual(loader.po_number(30201), "030201")
        self.assertEqual(loader.po_number(1721), "001721")
        self.assertEqual(loader.po_number(531195), "531195")

    def test_sc_cells_are_split_and_padded(self):
        self.assertEqual(loader.sc_numbers("14723\n14746"), ["014723", "014746"])
        self.assertEqual(loader.sc_numbers("12581/12610"), ["012581", "012610"])
        self.assertEqual(loader.sc_numbers(460), ["000460"])
        self.assertEqual(loader.sc_numbers("NO SC"), [])
        self.assertEqual(loader.sc_numbers(None), [])
        with self.assertRaises(ValueError):
            loader.sc_numbers("ABC")

    def test_typed_na_is_empty_but_stays_in_the_file_values(self):
        self.assertIsNone(loader.cell_value("#N/A"))
        self.assertEqual(loader.file_value("#N/A"), "#N/A")
        self.assertIsNone(loader.decimal_value("#N/A"))


class Selectors(unittest.TestCase):
    def resolve(self, entity, value):
        return loader.Selectors(REGISTERED).resolve(entity, value)

    def test_decisions(self):
        self.assertEqual(self.resolve("PRIORITY", "P"), "Prioridade")
        self.assertEqual(self.resolve("PRIORITY", "p"), "Prioridade")
        self.assertEqual(self.resolve("CATEGORY", "Water"), "WATER METER")
        self.assertEqual(self.resolve("DEMAND", "SAMPLES"), "Sample")
        self.assertEqual(self.resolve("REQUESTER", "JESSICA - PCM"), "PCM - JESSICA")
        self.assertEqual(self.resolve("REQUESTER", "R&D"), "R&D -")
        self.assertEqual(self.resolve("REQUESTER", "R&D - BRENO"), "R&D - BRENO CHAVES")
        self.assertEqual(self.resolve("PORT_LOADING", "NBG"), "NGB")

    def test_parity_keeps_the_registered_spelling(self):
        self.assertEqual(self.resolve("BROKER", "Ágil"), "ÁGIL")
        self.assertEqual(self.resolve("FORWARDER", "Savino Del Bene"), "SAVINO DEL BENE")
        self.assertEqual(self.resolve("CONTAINER_TYPE", "40 HQ"), "40'HQ")
        self.assertEqual(self.resolve("CONTAINER_TYPE", "40 NOR"), "40' NOR")
        self.assertEqual(self.resolve("CONTAINER_TYPE", "20 GP"), "20'GP")

    def test_zero_and_na_are_empty_where_the_user_decided(self):
        for entity in ("CATEGORY", "BROKER", "INCOTERM", "PORT_LOADING", "PORT_DISCHARGE"):
            self.assertIsNone(self.resolve(entity, 0), entity)
            self.assertIsNone(self.resolve(entity, "0"), entity)
        self.assertIsNone(self.resolve("CATEGORY", "#N/A"))

    def test_new_values_are_collected_once(self):
        selectors = loader.Selectors(REGISTERED)
        self.assertEqual(selectors.resolve("BROKER", "PORTO PRIME"), "PORTO PRIME")
        self.assertEqual(selectors.resolve("BROKER", "Porto Prime"), "PORTO PRIME")
        self.assertEqual(selectors.resolve("CONTAINER_TYPE", "40 GP"), "40'GP")
        self.assertEqual(dict(selectors.new), {"BROKER": ["PORTO PRIME"], "CONTAINER_TYPE": ["40'GP"]})


class Orders(unittest.TestCase):
    def test_importers_follow_the_decision_and_unknown_ones_stop_the_load(self):
        load = build([pre_row(), pre_row(Importer="ELETRA CWB", **{"PO Totvs": 2}), pre_row(Importer="ELETRA FOR", **{"PO Totvs": 3})])
        self.assertEqual({order["importer"] for order in load["orders"]}, {
            "ELETRA INDUSTRIA E COMERCIO DE MEDIDORES ELETRICOS L", "ELETRA CURITIBA",
            "ELETRA INDUSTRIA E COMERCIO( GALPAO-FORTALEZA )"})
        with self.assertRaises(ValueError):
            build([pre_row(Importer="OUTRA")])

    def test_demand_type_comes_from_the_demand_column(self):
        load = build([pre_row(Demand="MTS"), pre_row(**{"PO Totvs": 2, "Demand": "MRP"}), pre_row(**{"PO Totvs": 3})])
        types = {order["number"]: order["demand_type"] for order in load["orders"]}
        self.assertEqual(types, {"030201": "MTS", "000002": "Não MTS", "000003": "Não MTS"})
        self.assertIsNone(load["items"][0]["demand"])
        self.assertEqual(load["items"][1]["demand"], "MRP")

    def test_analyst_is_normalized_and_si_values_are_joined(self):
        load = build([pre_row(Analyst="NATHALIA", SI="908\n919"), pre_row(Analyst="Nathália", SI=919), pre_row(SI=902)])
        order = load["orders"][0]
        self.assertEqual(order["analyst"], "Nathália")
        self.assertEqual(order["si_number"], "908, 919, 902")
        self.assertEqual(load["new_values"]["ANALYST"], ["Nathália"])

    def test_two_analysts_stop_the_load(self):
        with self.assertRaises(ValueError):
            build([pre_row(Analyst="JOAO"), pre_row(Analyst="EVELINE")])

    def test_lifecycle_of_finished_orders(self):
        load = build([
            pre_row(Status="CANCELLED", **{"IP Number": "CANCELLED"}),
            pre_row(Status="DELIVERED", **{"PO Totvs": 2}), pre_row(Status="CANCELLED", **{"PO Totvs": 2, "IP Number": "Cancelled"}),
            pre_row(Status="DELIVERED", **{"PO Totvs": 3}), pre_row(Status="WAITING SHIPMENT", **{"PO Totvs": 3}),
        ])
        self.assertEqual({order["number"]: order["lifecycle"] for order in load["orders"]},
                         {"030201": "CANCELLED", "000002": "CLOSED", "000003": "ACTIVE"})


class Suppliers(unittest.TestCase):
    def test_po_18223_stays_hexing_with_its_cancelled_zlink_line(self):
        load = build([pre_row(**{"PO Totvs": 18223, "IP Number": "IP-1"}),
                      pre_row(Supplier="ZLINK", Status="CANCELLED", **{"PO Totvs": 18223, "IP Number": "CANCELLED"})],
                     [post_row()])
        self.assertEqual(load["orders"][0]["supplier"], "HEXING")
        self.assertEqual(len(load["allocations"]), 1)
        self.assertEqual(issues(load, "PO_IP_SUPPLIER_DIVERGENCE"), [])

    def test_po_18751_is_zlink_and_the_delivered_hexing_line_goes_to_quality(self):
        load = build([pre_row(Supplier="ZLINK", Status="DELIVERED", **{"PO Totvs": 18751, "IP Number": "Z-1"}),
                      pre_row(Status="DELIVERED", **{"PO Totvs": 18751, "IP Number": "H-1"})],
                     [post_row(**{"IP Number": "Z-1", "Supplier": "ZLINK", "Status": "DELIVERED"}),
                      post_row(**{"IP Number": "H-1", "Status": "DELIVERED"})])
        self.assertEqual(load["orders"][0]["supplier"], "ZLINK")
        self.assertEqual(len(load["allocations"]), 1)
        self.assertEqual(len(issues(load, "PO_IP_SUPPLIER_DIVERGENCE")), 1)
        self.assertEqual(len(load["items"]), 2)

    def test_a_po_with_two_suppliers_and_no_decision_stops_the_load(self):
        with self.assertRaises(ValueError):
            build([pre_row(), pre_row(Supplier="ZLINK")])

    def test_a_po_without_supplier_takes_the_one_of_its_ip(self):
        load = build([pre_row(Supplier=None, **{"PO Totvs": 32005, "IP Number": "D-FLOW01/2026"})],
                     [post_row(**{"IP Number": "D-FLOW01/2026", "Supplier": "D-FLOW"})])
        self.assertEqual(load["orders"][0]["supplier"], "D-FLOW")
        self.assertEqual(len(load["allocations"]), 1)
        self.assertEqual(issues(load, "PO_WITHOUT_SUPPLIER"), [])
        self.assertEqual(load["new_suppliers"], ["INFOVISTA", "D-FLOW"])

    def test_a_po_without_supplier_or_ip_goes_to_quality(self):
        load = build([pre_row(Supplier=None), pre_row(Supplier=None)])
        self.assertIsNone(load["orders"][0]["supplier"])
        self.assertEqual(len(issues(load, "PO_WITHOUT_SUPPLIER")), 1)
        self.assertEqual(len(load["items"]), 2)

    def test_an_unregistered_supplier_stops_the_load(self):
        with self.assertRaises(ValueError):
            build([pre_row(Supplier="DESCONHECIDO")])


class Lines(unittest.TestCase):
    def test_cancelled_ip_means_a_cancelled_item_without_allocation(self):
        load = build([pre_row(Status="CANCELLED", **{"IP Number": "Cancelled"}), pre_row(Status="CANCELLED", **{"IP Number": "CANCELLED"})])
        self.assertEqual([item["status"] for item in load["items"]], ["CANCELLED", "CANCELLED"])
        self.assertEqual(load["allocations"], [])
        self.assertEqual(load["processes"], [])

    def test_a_cancelled_status_without_ip_is_also_cancelled(self):
        load = build([pre_row(Status="CANCELLED")])
        self.assertEqual(load["items"][0]["status"], "CANCELLED")

    def test_each_line_is_one_item_with_its_own_allocation(self):
        load = build([pre_row(**{"IP Number": "IP-1"}), pre_row(**{"IP Number": "IP-2"})],
                     [post_row(), post_row(**{"IP Number": "IP-2"})])
        self.assertEqual([item["line"] for item in load["items"]], [1, 2])
        self.assertEqual(len(load["allocations"]), 2)
        self.assertEqual(len(load["links"]), 2)

    def test_lines_without_po_stay_only_in_the_source_and_quality(self):
        load = build([pre_row(**{"PO Totvs": None, "Draft PO": "FORE008/2026"})])
        self.assertEqual(load["items"], [])
        self.assertEqual(len(load["sources"]), 1)
        self.assertEqual(issues(load, "MISSING_PO")[0]["evidence"]["draftPo"], "FORE008/2026")

    def test_price_without_usable_currency_is_kept_and_reported(self):
        load = build([pre_row(Currency=None), pre_row(Currency="US$")])
        self.assertEqual([item["price"] for item in load["items"]], [Decimal("2.5"), Decimal("2.5")])
        self.assertEqual([item["currency"] for item in load["items"]], [None, None])
        self.assertEqual(len(issues(load, "PRICE_WITHOUT_CURRENCY")), 2)

    def test_a_currency_without_price_is_not_kept_on_the_item(self):
        load = build([pre_row(**{"Unit Price": None})])
        self.assertIsNone(load["items"][0]["price"])
        self.assertIsNone(load["items"][0]["currency"])
        self.assertEqual(load["sources"][0]["file_values"]["AC"], "CNY")

    def test_description_falls_back_to_the_code(self):
        self.assertEqual(build([pre_row(**{"Product Description": None})])["items"][0]["description"], "ABC")

    def test_text_in_a_date_column_is_empty_and_reported(self):
        load = build([pre_row(**{"SC Appr. Date": "pend"})])
        self.assertIsNone(load["items"][0]["sc_approval"])
        self.assertEqual(issues(load, "INVALID_DATE")[0]["evidence"]["value"], "pend")

    def test_typed_na_is_empty_and_not_a_quality_issue(self):
        load = build([pre_row(Category="#N/A")])
        self.assertIsNone(load["items"][0]["category"])
        self.assertEqual(load["issues"], [])
        self.assertEqual(load["sources"][0]["file_values"]["V"], "#N/A")
        self.assertIsNone(load["sources"][0]["raw_values"]["S"])


class Requests(unittest.TestCase):
    def test_one_record_per_number_with_the_most_common_requester_and_the_po_link(self):
        load = build([pre_row(Requester="PCM - JESSICA"), pre_row(Requester="PCM - JESSICA"), pre_row(Requester="R&D - BRENO")])
        self.assertEqual(len(load["requests"]), 1)
        request = load["requests"][0]
        self.assertEqual(request["number"], "011976")
        self.assertEqual(request["requester"], "PCM - JESSICA")
        self.assertEqual(request["supplier"], "HEXING")
        self.assertEqual(load["orders"][0]["purchase_request_id"], request["id"])

    def test_a_po_with_two_scs_keeps_them_on_the_items_without_a_link(self):
        load = build([pre_row(), pre_row(**{"SC Totvs": "13074\n13075"})])
        self.assertEqual(len(load["requests"]), 3)
        self.assertIsNone(load["orders"][0]["purchase_request_id"])
        self.assertEqual(load["items"][1]["sc_number"], "013074, 013075")

    def test_an_sc_with_two_suppliers_has_none_and_goes_to_quality(self):
        load = build([pre_row(), pre_row(Supplier="ZLINK", **{"PO Totvs": 2})])
        self.assertIsNone(load["requests"][0]["supplier"])
        self.assertEqual(len(issues(load, "SC_MULTIPLE_SUPPLIERS")), 1)
        self.assertTrue(all(order["purchase_request_id"] is None for order in load["orders"]))

    def test_an_sc_of_a_line_without_po_is_created_too(self):
        load = build([pre_row(**{"PO Totvs": None})])
        self.assertEqual(len(load["requests"]), 1)

    def test_an_sc_may_have_no_requester(self):
        self.assertIsNone(build([pre_row()])["requests"][0]["requester"])


class Processes(unittest.TestCase):
    def full_post(self, **fields):
        return post_row(**{"ETD": datetime(2026, 1, 1), "BL Date": datetime(2026, 1, 3), "BL Number": "BL-1", "ETA": datetime(2026, 2, 25),
                           "ETE Eletra": datetime(2026, 3, 7), "Doc ok": datetime(2026, 3, 1), "Arrival": datetime(2026, 2, 26),
                           "Due Storage": datetime(2026, 3, 7), "Freight Ccy.": "CNY", "Freight Cost": 1000, "Container": "TCKU1",
                           "Forwarder": "Savino Del Bene", "Ctnr Type": "40 HQ", "Ctnr Qty": 2.0, "Taxes Paid (R$)": "#N/A",
                           "NF": "8961", "NF Issue Date": datetime(2026, 3, 2), "Delivery Date": datetime(2026, 3, 5), **fields})

    def test_the_post_sheet_fills_the_ip(self):
        load = build([pre_row(**{"IP Number": "IP-1"})], [self.full_post()])
        process = load["processes"][0]
        self.assertEqual(process["mode"], "SEA")
        self.assertEqual(process["bl_date"], date(2026, 1, 3))
        self.assertEqual(process["bl_number"], "BL-1")
        self.assertEqual(process["documents_ok_date"], date(2026, 3, 1))
        self.assertEqual(process["forwarder"], "SAVINO DEL BENE")
        self.assertEqual(process["container_type"], "40'HQ")
        self.assertEqual(process["container_quantity"], 2)
        self.assertIsNone(process["taxes"])

    def test_a_shared_container_keeps_its_half(self):
        load = build([pre_row(**{"IP Number": "IP-1"})], [self.full_post(**{"Ctnr Qty": 0.5})])
        self.assertEqual(load["processes"][0]["container_quantity"], Decimal("0.5"))

    def test_only_typed_eta_and_ete_are_confirmed(self):
        calculated = build([pre_row(**{"IP Number": "IP-1"})], [self.full_post()])["processes"][0]
        self.assertIsNone(calculated["eta_confirmed"])
        self.assertIsNone(calculated["ete_confirmed"])
        typed = build([pre_row(**{"IP Number": "IP-1"})], [self.full_post()], {(5, "S"), (5, "T")})["processes"][0]
        self.assertEqual(typed["eta_confirmed"], date(2026, 2, 25))
        self.assertEqual(typed["ete_confirmed"], date(2026, 3, 7))

    def test_documents_and_costs(self):
        load = build([pre_row(**{"IP Number": "IP-1"})], [self.full_post(**{"Taxes Paid (R$)": 50})])
        kinds = {document["kind"]: document for document in load["documents"]}
        self.assertEqual(kinds["INVOICE"]["number"], "INV-1")
        self.assertEqual(kinds["INVOICE"]["amount"], Decimal("100.5"))
        self.assertEqual(kinds["NF"]["number"], "8961")
        self.assertEqual({cost["kind"]: cost["column"] for cost in load["costs"]}, {"FREIGHT": "W", "TAXES": "AE"})

    def test_an_ip_only_in_the_pre_sheet_uses_it(self):
        load = build([pre_row(**{"IP Number": "039/2026", "Mode": "Air", "ETD": datetime(2026, 5, 1), "Invoice": "INV-9"})])
        process = load["processes"][0]
        self.assertEqual(process["mode"], "AIR")
        self.assertEqual(process["etd"], date(2026, 5, 1))
        self.assertEqual(process["supplier"], "HEXING")
        self.assertEqual(load["documents"][0]["number"], "INV-9")

    def test_a_post_ip_missing_from_the_pre_sheet_stops_the_load(self):
        with self.assertRaises(ValueError):
            build([pre_row()], [post_row()])

    def test_a_repeated_post_ip_stops_the_load(self):
        with self.assertRaises(ValueError):
            build([pre_row(**{"IP Number": "IP-1"})], [post_row(), post_row()])

    def test_the_source_row_keeps_the_real_letters_and_the_reader_keys(self):
        load = build([pre_row(**{"IP Number": "IP-1", "SI": 472, "Analyst": "JOAO", "Group": "Energy"})], [self.full_post()])
        source = next(item for item in load["sources"] if item["sheet"] == loader.PRE_SHEET)
        self.assertEqual(source["file_values"]["AE"], "IP-1")
        self.assertEqual(source["file_values"]["P"], 30201)
        self.assertEqual(source["raw_values"]["AB"], "IP-1")
        self.assertEqual(source["raw_values"]["N"], "030201")
        self.assertEqual(source["raw_values"]["F"], "ELETRA INDUSTRIA E COMERCIO DE MEDIDORES ELETRICOS L")
        self.assertEqual(source["raw_values"]["BC"], 472)
        self.assertEqual(source["raw_values"]["BD"], "JOAO")
        self.assertEqual(source["raw_values"]["BE"], "Energy")
        post = next(item for item in load["sources"] if item["sheet"] == loader.POST_SHEET)
        self.assertEqual(post["raw_values"]["B"], "IP-1")
        self.assertEqual(post["raw_values"]["AC"], "2026-02-26T00:00:00")
        self.assertEqual(post["raw_values"]["Y"], "40'HQ")


class Sql(unittest.TestCase):
    def setUp(self):
        self.load = build([pre_row(Remarks="O'Brien", **{"IP Number": "IP-1"})], [post_row()])

    def test_it_only_runs_on_the_hml_database_and_refuses_a_repeated_load(self):
        sql = loader.render_sql(self.load, False, False)
        self.assertIn("IF current_database() <> 'erp_po_totvs_hml'", sql)
        self.assertIn("ALREADY_PROMOTED", sql)
        self.assertIn("M075 is not applied", sql)

    def test_the_default_is_a_rehearsal(self):
        self.assertTrue(loader.render_sql(self.load, False, False).endswith("ROLLBACK;\n"))
        self.assertTrue(loader.render_sql(self.load, True, False).endswith("COMMIT;\n"))

    def test_quotes_are_escaped(self):
        self.assertIn("'O''Brien'", loader.render_sql(self.load, False, False))

    def test_the_simulation_is_only_wiped_on_request(self):
        self.assertNotIn("DELETE FROM", loader.render_sql(self.load, False, False))
        wiped = loader.render_sql(self.load, False, True)
        self.assertIn("DELETE FROM procurement.purchase_order;", wiped)
        self.assertNotIn("DELETE FROM catalog.entry", wiped)
        self.assertNotIn("DELETE FROM catalog.operational_value", wiped)
        self.assertNotIn("DELETE FROM audit", wiped)
        self.assertIn("SET LOCAL session_replication_role = origin;", wiped)

    def test_allocations_are_inserted_before_the_lifecycle_changes(self):
        load = build([pre_row(Status="DELIVERED", **{"IP Number": "IP-1"})], [post_row(Status="DELIVERED")])
        sql = loader.render_sql(load, False, False)
        self.assertLess(sql.index("INSERT INTO procurement.po_item_allocation"), sql.index("UPDATE procurement.purchase_order SET lifecycle_status"))
        self.assertLess(sql.index("INSERT INTO procurement.purchase_request"), sql.index("INSERT INTO procurement.purchase_order "))

    def test_counts_are_reconciled_before_commit(self):
        sql = loader.render_sql(self.load, True, False)
        self.assertIn("Reconciliation failed for procurement.purchase_order_item", sql)
        self.assertLess(sql.index("$reconcile$"), sql.index("COMMIT;"))


if __name__ == "__main__":
    unittest.main()
