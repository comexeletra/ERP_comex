#!/usr/bin/env python3
"""Turn the Follow Up workbook into one SQL transaction for the HML database.

Rules and decisions are in docs/PLANO_CARGA_HISTORICA_PLANILHA.md. The script never
connects to a database: it reads the workbook and a catalog export, then writes the
SQL file and a JSON report. The SQL refuses any database other than erp_po_totvs_hml,
so it runs through psql like a migration and every database rule stays active.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from hashlib import sha256
import json
from pathlib import Path
import re
import unicodedata
from uuid import UUID, uuid5

MAPPING_VERSION = "follow-up-2026-v2"
NAMESPACE = UUID("3f0a6a2e-9f57-4a53-8b0e-5d1c6f2f7a41")
ACTOR = "migration:follow-up-load"
EXPECTED_DATABASE = "erp_po_totvs_hml"
PRE_SHEET = "Pré Embarque"
POST_SHEET = "Pós Embarque"
PO_DIGITS = 6
SC_DIGITS = 6

IMPORTERS = {
    "ELETRA MATRIZ": "ELETRA INDUSTRIA E COMERCIO DE MEDIDORES ELETRICOS L",
    "ELETRA CWB": "ELETRA CURITIBA",
    "ELETRA FOR": "ELETRA INDUSTRIA E COMERCIO( GALPAO-FORTALEZA )",
}
# The Pre sheet disagrees on these POs; the decisions are recorded in the plan.
PO_SUPPLIER_DECISIONS = {"018223": "HEXING", "018751": "ZLINK"}
NEW_SUPPLIERS = ("INFOVISTA", "D-FLOW")
ANALYSTS = {"NATHALIA": "Nathália"}

# Column keys every reader of migration.source_row uses (the approved 2026 layout), by header.
CANONICAL_PRE = {
    "Necessity": "B", "Priority": "C", "Alert": "D", "Status": "E", "Importer": "F", "Demand": "G", "Requester": "H",
    "SC Totvs": "I", "SC Appr. Date": "J", "Finalidade": "K", "Cost Center": "L", "Draft PO": "M", "PO Totvs": "N",
    "PO Date": "O", "PO Appr. Date": "P", "PO Sent Date": "Q", "Supplier": "R", "Category": "S", "Product Code": "T",
    "Product Description": "U", "NCM": "V", "Qty": "W", "Unit Price": "X", "Total Price": "Y", "Currency": "Z",
    "Remarks": "AA", "IP Number": "AB", "IP Date Totvs": "AC", "Mode": "AD", "Incoterm": "AE", "Broker": "AF", "POL": "AG",
    "POD": "AH", "ETD": "AI", "ETA": "AJ", "Transit Time": "AK", "Invoice": "AL", "BL Number": "AM", "BL Date": "AN",
    "Arrival": "AO", "Duimp": "AP", "Duimp Date": "AQ", "Channel": "AR", "Clearance": "AS", "ETE": "AT", "NF Request": "AU",
    "NF": "AV", "NF Issue Date": "AW", "Delivery Date": "AX", "SI": "BC", "Analyst": "BD", "Group": "BE",
}
CANONICAL_POST = {
    "IP Number": "B", "Priority": "C", "Alert": "D", "Status": "E", "Importer": "F", "Supplier": "G", "Invoice": "H",
    "Currency": "I", "Total Amount": "J", "Mode": "K", "Incoterm": "L", "POL": "M", "POD": "N", "Broker": "O",
    "BL Number": "P", "ETD": "Q", "Transit Time": "R", "ETA": "S", "ETE Eletra": "T", "BL Date": "U", "Freight Ccy.": "V",
    "Freight Cost": "W", "Container": "X", "Ctnr Type": "Y", "Ctnr Qty": "Z", "Forwarder": "AA", "Doc ok": "AB",
    "Arrival": "AC", "Due Storage": "AD", "Taxes Paid (R$)": "AE", "Duimp": "AF", "Duimp Date": "AG", "Channel": "AH",
    "Clearance": "AI", "NF Request": "AJ", "NF": "AK", "NF Issue Date": "AL", "NF Homolog.": "AM", "Delivery Date": "AN",
}
PRE_LAST_COLUMN = "BA"
POST_LAST_COLUMN = "AN"
PRE_HEADER_ROW = 3
POST_HEADER_ROW = 4
SELECTOR_LIMITS = {"PRIORITY": 20, "CATEGORY": 120, "DEMAND": 160, "REQUESTER": 160, "PURPOSE": 160, "COST_CENTER": 80,
                   "GROUP": 120, "BROKER": 160, "FORWARDER": 160, "INCOTERM": 20, "PORT_LOADING": 160,
                   "PORT_DISCHARGE": 160, "CONTAINER_TYPE": 80, "TRANSPORT_MODE": 40, "CUSTOMS_CHANNEL": 80, "ANALYST": 160}
# Same value in other spelling, decided by the user; everything else matches by parity.
SELECTOR_DECISIONS = {
    "PRIORITY": {"P": "Prioridade"},
    "CATEGORY": {"WATER": "WATER METER"},
    "DEMAND": {"SAMPLES": "Sample"},
    "REQUESTER": {"JESSICA - PCM": "PCM - JESSICA", "R&D": "R&D -", "R&D - BRENO": "R&D - BRENO CHAVES"},
    "PORT_LOADING": {"NBG": "NGB"},
    "CONTAINER_TYPE": {"40 GP": "40'GP"},
}
# Zero was typed as "nothing" in these columns.
ZERO_IS_EMPTY = {"CATEGORY", "BROKER", "INCOTERM", "PORT_LOADING", "PORT_DISCHARGE"}


def stable_id(*parts: object) -> UUID:
    return uuid5(NAMESPACE, "|".join(str(part) for part in parts))


def text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def is_blank_error(value: object) -> bool:
    """#N/A was typed by hand in the workbook: it means empty, not a calculation error."""
    return isinstance(value, str) and value.strip().upper() in {"#N/A", "#N/D"}


def cell_value(value: object) -> object:
    if is_blank_error(value):
        return None
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, float) and not (float("-inf") < value < float("inf")):
        return str(value)
    return value


def file_value(value: object) -> object:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, float) and not (float("-inf") < value < float("inf")):
        return str(value)
    return value


def date_value(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


def decimal_value(value: object) -> Decimal | None:
    if value is None or is_blank_error(value) or text(value) == "":
        return None
    try:
        number = Decimal(text(value).replace(",", "."))
    except InvalidOperation:
        return None
    return number if number.is_finite() else None


def pad_number(value: object, digits: int) -> str:
    """Excel stored the numbers as integers and lost the zeros on the left."""
    number = text(value)
    return number.zfill(digits) if number.isdigit() else number


def split_list(value: object) -> list[str]:
    """One cell may hold several numbers, separated by a line break, a slash or a comma."""
    return [part.strip() for part in re.split(r"[\n/,;]+", text(value)) if part.strip()]


def sc_numbers(value: object) -> list[str]:
    numbers = []
    for part in split_list(value):
        if part.upper() == "NO SC":
            continue
        if not part.isdigit():
            raise ValueError(f"Unexpected SC number: {part!r}")
        padded = pad_number(part, SC_DIGITS)
        if padded not in numbers:
            numbers.append(padded)
    return numbers


def cancelled_ip(value: object) -> bool:
    return text(value).upper() in {"CANCELLED", "CANCELED"}


def valid_ip(value: object) -> str:
    candidate = text(value)
    if not candidate or cancelled_ip(candidate) or candidate.startswith("#"):
        return ""
    return candidate


def line_cancelled(status: object, ip: object) -> bool:
    return cancelled_ip(ip) or text(status).upper() in {"CANCELLED", "CANCELED"}


def parity_key(value: str) -> str:
    plain = unicodedata.normalize("NFD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z0-9]", "", plain.upper())


class Selectors:
    """Resolves a workbook value to the registered selector value, collecting the new ones."""

    def __init__(self, registered: dict[str, list[str]]):
        self.registered = {key: list(values) for key, values in registered.items()}
        self.new: dict[str, list[str]] = defaultdict(list)

    def resolve(self, entity: str, value: object) -> str | None:
        raw = "" if is_blank_error(value) else text(value)
        if not raw or (entity in ZERO_IS_EMPTY and raw == "0"):
            return None
        decided = SELECTOR_DECISIONS.get(entity, {}).get(raw.upper(), raw)
        values = self.registered.get(entity, []) + self.new[entity]
        exact = [item for item in values if item.upper() == decided.upper()]
        if exact:
            return exact[0]
        same = [item for item in values if parity_key(item) == parity_key(decided)]
        if same:
            return same[0]
        limit = SELECTOR_LIMITS[entity]
        if len(decided) > limit:
            raise ValueError(f"{entity} value exceeds {limit} characters: {decided!r}")
        self.new[entity].append(decided)
        return decided


def po_number(value: object) -> str:
    return pad_number(value, PO_DIGITS)


def importer_name(value: object) -> str:
    name = text(value)
    if name not in IMPORTERS:
        raise ValueError(f"Importer without a decision: {name!r}")
    return IMPORTERS[name]


def supplier_code(value: object, known: set[str]) -> str | None:
    name = text(value).upper()
    if not name:
        return None
    if name not in known:
        raise ValueError(f"Supplier not registered: {name!r}")
    return name


def most_common(values: list) -> object:
    """The most frequent value; a tie goes to the smallest, so the result never depends on row order."""
    counts = Counter(values)
    best = max(counts.values())
    return min(value for value, count in counts.items() if count == best)


def single(values: list) -> object:
    distinct = {value for value in values if value not in (None, "")}
    return distinct.pop() if len(distinct) == 1 else None


def canonical_row(cells: dict, headers: dict[str, str], layout: dict[str, str]) -> dict:
    """The row under the column keys the readers use. Headers without a key stay only in the file values."""
    return {layout[header]: cell_value(cells.get(letter)) for letter, header in headers.items() if header in layout}


def build_load(pre_rows: list[tuple[int, dict]], post_rows: list[tuple[int, dict]], pre_headers: dict[str, str],
               post_headers: dict[str, str], registered: dict[str, list[str]], suppliers: set[str], digest: str,
               typed_cells: set[tuple[int, str]], file_name: str) -> dict:
    """Build everything the SQL inserts. `typed_cells` holds the Post ETA/ETE cells that are not formulas."""
    known_suppliers = {code.upper() for code in suppliers} | set(NEW_SUPPLIERS)
    batch_id = stable_id(digest, MAPPING_VERSION)
    selectors = Selectors(registered)
    pre_letter = {header: letter for letter, header in pre_headers.items()}
    post_letter = {header: letter for letter, header in post_headers.items()}
    missing = (set(CANONICAL_PRE) - set(pre_letter)) | (set(CANONICAL_POST) - set(post_letter))
    if missing:
        raise ValueError(f"Workbook headers not found: {sorted(missing)}")

    def pre(row: dict, header: str) -> object:
        return row.get(pre_letter[header])

    def post(row: dict, header: str) -> object:
        return row.get(post_letter[header])

    issues: list[dict] = []

    def add_issue(source_id: UUID, code: str, field: str | None, evidence: dict) -> None:
        issues.append({"id": stable_id(batch_id, source_id, code, field or ""), "batch_id": batch_id,
                       "source_row_id": source_id, "severity": "WARNING", "code": code, "field": field,
                       "evidence": evidence})

    sources = []

    def add_source(sheet: str, number: int, cells: dict, headers: dict[str, str], layout: dict[str, str],
                   overrides: dict[str, object]) -> UUID:
        source_id = stable_id(batch_id, sheet, number)
        original = {letter: file_value(cells.get(letter)) for letter in headers}
        sources.append({"id": source_id, "sheet": sheet, "number": number, "file_values": original,
                        "raw_values": {**canonical_row(cells, headers, layout), **overrides},
                        "hash": sha256(json.dumps(original, ensure_ascii=False, sort_keys=True,
                                                  separators=(",", ":")).encode("utf-8")).hexdigest()})
        return source_id

    # IPs: the Post sheet is the reference; the Pre sheet fills what it leaves empty.
    post_by_ip: dict[str, tuple[int, dict]] = {}
    for number, row in post_rows:
        ip = valid_ip(post(row, "IP Number"))
        if not ip:
            raise ValueError(f"Post row {number} without IP")
        if ip.upper() in post_by_ip:
            raise ValueError(f"IP repeated in the Post sheet: {ip}")
        post_by_ip[ip.upper()] = (number, row)

    pre_by_ip: dict[str, list[tuple[int, dict]]] = defaultdict(list)
    lines = []
    for number, row in pre_rows:
        ip = valid_ip(pre(row, "IP Number"))
        po = po_number(pre(row, "PO Totvs")) if text(pre(row, "PO Totvs")) else ""
        cancelled = line_cancelled(pre(row, "Status"), pre(row, "IP Number"))
        if ip:
            pre_by_ip[ip.upper()].append((number, row))
        lines.append({"number": number, "row": row, "ip": ip, "po": po, "cancelled": cancelled,
                      "importer": importer_name(pre(row, "Importer")), "sc": sc_numbers(pre(row, "SC Totvs")),
                      "supplier": supplier_code(pre(row, "Supplier"), known_suppliers)})

    orphan_post = sorted(set(post_by_ip) - set(pre_by_ip))
    if orphan_post:
        raise ValueError(f"Post IPs absent from the Pre sheet: {orphan_post}")

    ip_supplier: dict[str, str | None] = {}
    for key in pre_by_ip:
        if key in post_by_ip:
            ip_supplier[key] = supplier_code(post(post_by_ip[key][1], "Supplier"), known_suppliers)
        else:
            names = {line["supplier"] for line in lines if line["ip"].upper() == key and line["supplier"]}
            if len(names) != 1:
                raise ValueError(f"IP {key} needs exactly one supplier, found {sorted(names)}")
            ip_supplier[key] = names.pop()

    # POs.
    po_lines: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for line in lines:
        if line["po"]:
            po_lines[(line["importer"], line["po"])].append(line)

    def resolve_po_supplier(number: str, members: list[dict]) -> str | None:
        if number in PO_SUPPLIER_DECISIONS:
            return PO_SUPPLIER_DECISIONS[number]
        names = {line["supplier"] for line in members if line["supplier"]}
        if len(names) > 1:
            raise ValueError(f"PO {number} has several suppliers and no decision: {sorted(names)}")
        if names:
            return names.pop()
        # The Pre sheet is filled gradually: the IP of the PO may already name the supplier.
        from_ips = {ip_supplier[line["ip"].upper()] for line in members if line["ip"]} - {None}
        if len(from_ips) > 1:
            raise ValueError(f"PO {number} has IPs of several suppliers: {sorted(from_ips)}")
        return from_ips.pop() if from_ips else None

    orders: dict[tuple[str, str], dict] = {}
    for (importer, number), members in po_lines.items():
        po_id = stable_id(batch_id, "PO", importer, number)
        supplier = resolve_po_supplier(number, members)
        analysts = set()
        for line in members:
            analyst = text(pre(line["row"], "Analyst"))
            if analyst:
                analysts.add(selectors.resolve("ANALYST", ANALYSTS.get(parity_key(analyst), analyst)))
        if len(analysts) > 1:
            raise ValueError(f"PO {number} has several analysts: {sorted(analysts)}")
        si_parts: list[str] = []
        for line in members:
            for part in split_list(pre(line["row"], "SI")):
                if part not in si_parts:
                    si_parts.append(part)
        si_number = ", ".join(si_parts) or None
        if si_number and len(si_number) > 120:
            raise ValueError(f"PO {number}: SI exceeds 120 characters")
        order_dates = {date_value(pre(line["row"], "PO Date")) for line in members} - {None}
        statuses = {text(pre(line["row"], "Status")).upper() for line in members}
        if all(line["cancelled"] for line in members):
            lifecycle = "CANCELLED"
        elif statuses <= {"DELIVERED", "CANCELLED", "CANCELED"}:
            lifecycle = "CLOSED"
        else:
            lifecycle = "ACTIVE"
        orders[(importer, number)] = {
            "id": po_id, "importer": importer, "number": number, "supplier": supplier,
            "order_date": min(order_dates) if len(order_dates) == 1 else None,
            "demand_type": "MTS" if any(text(pre(line["row"], "Demand")).upper() == "MTS" for line in members) else "Não MTS",
            "analyst": analysts.pop() if analysts else None, "si_number": si_number, "lifecycle": lifecycle,
            "purchase_request_id": None}
        if not supplier:
            add_later = members[0]
            orders[(importer, number)]["issue_line"] = add_later["number"]

    # Source rows, items and SCs read the resolved PO, so they come after the POs.
    sc_rows: dict[tuple[str, str], list[dict]] = defaultdict(list)
    items, observations, allocations, links = [], [], [], {}
    line_counter: Counter = Counter()
    for line in lines:
        row = line["row"]
        order = orders.get((line["importer"], line["po"])) if line["po"] else None
        category = selectors.resolve("CATEGORY", pre(row, "Category"))
        raw_demand = pre(row, "Demand")
        demand = None if text(raw_demand).upper() == "MTS" else selectors.resolve("DEMAND", raw_demand)
        requester = selectors.resolve("REQUESTER", pre(row, "Requester"))
        purpose = selectors.resolve("PURPOSE", pre(row, "Finalidade"))
        cost_center = selectors.resolve("COST_CENTER", pre(row, "Cost Center"))
        group = selectors.resolve("GROUP", pre(row, "Group"))
        priority = selectors.resolve("PRIORITY", pre(row, "Priority"))
        sc_text = ", ".join(line["sc"]) or None
        overrides = {"F": line["importer"], "I": sc_text, "S": category, "G": demand, "H": requester, "K": purpose,
                     "L": cost_center, "C": priority, "BE": group, "R": (order or {}).get("supplier") or line["supplier"]}
        if line["po"]:
            overrides["N"] = line["po"]
        source_id = add_source(PRE_SHEET, line["number"], row, pre_headers, CANONICAL_PRE, overrides)
        line["source_id"] = source_id
        for sc_number in line["sc"]:
            sc_rows[(line["importer"], sc_number)].append(line)
        for header in ("Necessity", "SC Appr. Date", "PO Date", "PO Appr. Date", "PO Sent Date", "IP Date Totvs"):
            value = pre(row, header)
            if value not in (None, "") and not is_blank_error(value) and date_value(value) is None:
                add_issue(source_id, "INVALID_DATE", CANONICAL_PRE[header], {"column": header, "value": text(value)})
        if not order:
            add_issue(source_id, "MISSING_PO", "N", {"importer": line["importer"], "ipNumber": line["ip"] or None,
                                                     "draftPo": text(pre(row, "Draft PO")) or None,
                                                     "productCode": text(pre(row, "Product Code")) or None})
            continue
        if not order["supplier"] and order.get("issue_line") == line["number"]:
            add_issue(source_id, "PO_WITHOUT_SUPPLIER", "R", {"purchaseOrder": order["number"]})
        code = text(pre(row, "Product Code"))
        quantity = decimal_value(pre(row, "Qty"))
        if not code or quantity is None or quantity <= 0:
            raise ValueError(f"Pre row {line['number']}: PO line needs a product code and a positive quantity")
        price = decimal_value(pre(row, "Unit Price"))
        currency_text = text(pre(row, "Currency")).upper()
        currency = currency_text if currency_text in registered.get("CURRENCY", []) else None
        if price is not None and not currency:
            add_issue(source_id, "PRICE_WITHOUT_CURRENCY", "Z", {"purchaseOrder": order["number"], "productCode": code,
                                                                 "unitPrice": str(price),
                                                                 "currency": text(pre(row, "Currency")) or None})
        line_counter[order["id"]] += 1
        status = "CANCELLED" if line["cancelled"] else text(pre(row, "Status")) or None
        necessity = date_value(pre(row, "Necessity"))
        description = text(pre(row, "Product Description")) or code
        observations.append({"id": stable_id(batch_id, "OBS", source_id), "po_id": order["id"], "source_id": source_id,
                             "number": line["number"], "code": code, "description": description, "quantity": quantity,
                             "price": price, "amount": decimal_value(pre(row, "Total Price")), "currency": currency,
                             "necessity": necessity, "status": status, "ip_text": text(pre(row, "IP Number")) or None,
                             "raw_values": sources[-1]["raw_values"]})
        items.append({"id": source_id, "po_id": order["id"], "line": line_counter[order["id"]], "code": code,
                      "description": description, "quantity": quantity, "price": price, "currency": currency,
                      "necessity": necessity, "status": status, "source_id": source_id, "priority": priority,
                      "demand": demand, "requester": requester, "sc_number": sc_text,
                      "sc_approval": date_value(pre(row, "SC Appr. Date")), "purpose": purpose, "cost_center": cost_center,
                      "draft_po": text(pre(row, "Draft PO")) or None, "po_approval": date_value(pre(row, "PO Appr. Date")),
                      "po_sent": date_value(pre(row, "PO Sent Date")), "category": category, "group": group,
                      "ncm": text(pre(row, "NCM")) or None, "remarks": text(pre(row, "Remarks")) or None})
        if not line["ip"] or line["cancelled"]:
            continue
        key = line["ip"].upper()
        if order["supplier"] != ip_supplier[key]:
            add_issue(source_id, "PO_IP_SUPPLIER_DIVERGENCE", "R", {"purchaseOrder": order["number"], "ipNumber": line["ip"],
                                                                    "poSupplier": order["supplier"],
                                                                    "ipSupplier": ip_supplier[key]})
            continue
        process_id = stable_id(batch_id, "IP", key)
        allocations.append({"id": stable_id(batch_id, "ALLOCATION", source_id), "item_id": source_id,
                            "process_id": process_id, "quantity": quantity})
        links[(order["id"], process_id)] = (order["id"], process_id)

    # SCs. One record per number; a PO points to it only when that is its only SC, with the same supplier.
    requests: dict[tuple[str, str], dict] = {}
    for (importer, number), members in sc_rows.items():
        requesters = [selectors.resolve("REQUESTER", pre(line["row"], "Requester")) for line in members]
        approvals = [date_value(pre(line["row"], "SC Appr. Date")) for line in members]
        names = set()
        for line in members:
            order = orders.get((line["importer"], line["po"])) if line["po"] else None
            supplier = (order or {}).get("supplier") or line["supplier"]
            if supplier:
                names.add(supplier)
        requester_values = [value for value in requesters if value]
        approval_values = [value for value in approvals if value]
        requests[(importer, number)] = {
            "id": stable_id(batch_id, "SC", importer, number), "importer": importer, "number": number,
            "requester": most_common(requester_values) if requester_values else None,
            "approval": most_common(approval_values) if approval_values else None,
            "supplier": names.pop() if len(names) == 1 else None}
        if len(names) > 1:
            add_issue(members[0]["source_id"], "SC_MULTIPLE_SUPPLIERS", "R", {"scNumber": number, "suppliers": sorted(names)})
    for (importer, number), order in orders.items():
        numbers = {sc for line in po_lines[(importer, number)] for sc in line["sc"]}
        if len(numbers) == 1:
            request = requests[(importer, numbers.pop())]
            if order["supplier"] and request["supplier"] == order["supplier"]:
                order["purchase_request_id"] = request["id"]

    # IPs, documents and costs.
    processes, documents, costs = [], [], []
    for key, members in pre_by_ip.items():
        post_number, post_row = post_by_ip.get(key, (None, None))

        def both(post_header: str, pre_header: str) -> object:
            value = post(post_row, post_header) if post_row else None
            if value not in (None, "") and not is_blank_error(value):
                return value
            return single([pre(row, pre_header) for _, row in members if not is_blank_error(pre(row, pre_header))])

        importer = single([importer_name(pre(row, "Importer")) for _, row in members])
        if not importer:
            raise ValueError(f"IP {key} has several importers")
        process_id = stable_id(batch_id, "IP", key)
        ip_text = text(pre(members[0][1], "IP Number"))
        if post_row:
            ip_text = text(post(post_row, "IP Number"))
            overrides = {}
        mode = text(both("Mode", "Mode")).upper() or None
        typed_eta = post(post_row, "ETA") if post_row and (post_number, post_letter["ETA"]) in typed_cells else None
        typed_ete = post(post_row, "ETE Eletra") if post_row and (post_number, post_letter["ETE Eletra"]) in typed_cells else None
        freight_cost = decimal_value(post(post_row, "Freight Cost")) if post_row else None
        freight_currency = text(post(post_row, "Freight Ccy.")).upper() if post_row else ""
        container_quantity = decimal_value(post(post_row, "Ctnr Qty")) if post_row else None
        status = text(post(post_row, "Status")) if post_row else single([text(pre(row, "Status")) for _, row in members])
        process = {
            "id": process_id, "importer": importer, "ip_number": ip_text, "normalized": ip_text.upper(),
            "status": status or None,
            "priority": selectors.resolve("PRIORITY", post(post_row, "Priority")) if post_row else
            selectors.resolve("PRIORITY", single([text(pre(row, "Priority")) for _, row in members])),
            "supplier": ip_supplier[key], "ip_totvs_date": date_value(single([pre(row, "IP Date Totvs") for _, row in members])),
            "mode": selectors.resolve("TRANSPORT_MODE", mode),
            "incoterm": selectors.resolve("INCOTERM", both("Incoterm", "Incoterm")),
            "broker": selectors.resolve("BROKER", both("Broker", "Broker")),
            "port_loading": selectors.resolve("PORT_LOADING", both("POL", "POL")),
            "port_discharge": selectors.resolve("PORT_DISCHARGE", both("POD", "POD")),
            "etd": date_value(both("ETD", "ETD")), "eta_confirmed": date_value(typed_eta), "ete_confirmed": date_value(typed_ete),
            "bl_number": text(both("BL Number", "BL Number")) or None, "bl_date": date_value(both("BL Date", "BL Date")),
            "arrival": date_value(both("Arrival", "Arrival")), "duimp_number": text(both("Duimp", "Duimp")) or None,
            "duimp_date": date_value(both("Duimp Date", "Duimp Date")),
            "channel": selectors.resolve("CUSTOMS_CHANNEL", both("Channel", "Channel")),
            "clearance": date_value(both("Clearance", "Clearance")), "nf_request": date_value(both("NF Request", "NF Request")),
            "delivery": date_value(both("Delivery Date", "Delivery Date")),
            "freight_currency": freight_currency if freight_cost is not None and freight_currency else None,
            "freight_cost": freight_cost if freight_cost is not None and freight_currency else None,
            "container_number": text(post(post_row, "Container")) or None if post_row else None,
            "container_type": selectors.resolve("CONTAINER_TYPE", post(post_row, "Ctnr Type")) if post_row else None,
            "container_quantity": container_quantity,
            "forwarder": selectors.resolve("FORWARDER", post(post_row, "Forwarder")) if post_row else None,
            "documents_ok_date": date_value(post(post_row, "Doc ok")) if post_row else None,
            "taxes": decimal_value(post(post_row, "Taxes Paid (R$)")) if post_row else None}
        processes.append(process)
        invoice = text(both("Invoice", "Invoice"))
        if post_row is None and not invoice:
            numbers = []
            for _, row in members:
                value = text(pre(row, "Invoice"))
                if value and value not in numbers:
                    numbers.append(value)
            invoice = ", ".join(numbers)
        if invoice:
            if len(invoice) > 120:
                raise ValueError(f"IP {key}: invoice exceeds 120 characters")
            currency = text(post(post_row, "Currency")).upper() if post_row else ""
            documents.append({"id": stable_id(batch_id, "DOC", key, "INVOICE"), "process_id": process_id, "kind": "INVOICE",
                              "number": invoice, "issue_date": None, "homologation_date": None,
                              "amount": decimal_value(post(post_row, "Total Amount")) if post_row else None,
                              "notes": f"Histórico da aba Pós Embarque; moeda {currency or 'não informada'}."})
        nf = text(both("NF", "NF"))
        if nf:
            if len(nf) > 120:
                raise ValueError(f"IP {key}: NF exceeds 120 characters")
            documents.append({"id": stable_id(batch_id, "DOC", key, "NF"), "process_id": process_id, "kind": "NF", "number": nf,
                              "issue_date": date_value(both("NF Issue Date", "NF Issue Date")),
                              "homologation_date": date_value(post(post_row, "NF Homolog.")) if post_row else None,
                              "amount": None, "notes": "Histórico da aba Pós Embarque."})

    for key, (number, row) in post_by_ip.items():
        process = next(item for item in processes if item["normalized"] == key)
        overrides = {"F": process["importer"], "G": process["supplier"], "C": process["priority"], "K": process["mode"],
                     "L": process["incoterm"], "M": process["port_loading"], "N": process["port_discharge"],
                     "O": process["broker"], "Y": process["container_type"], "AA": process["forwarder"], "AH": process["channel"]}
        source_id = add_source(POST_SHEET, number, row, post_headers, CANONICAL_POST, overrides)
        for header in ("ETD", "ETA", "ETE Eletra", "BL Date", "Doc ok", "Arrival", "Duimp Date", "Clearance", "NF Request",
                       "NF Issue Date", "NF Homolog.", "Delivery Date"):
            value = post(row, header)
            if value not in (None, "") and not is_blank_error(value) and date_value(value) is None:
                add_issue(source_id, "INVALID_DATE", CANONICAL_POST[header], {"column": header, "value": text(value)})
        if process["freight_cost"] is not None:
            costs.append({"id": stable_id(batch_id, "COST", source_id, "W"), "process_id": process["id"], "source_id": source_id,
                          "column": "W", "kind": "FREIGHT", "amount": process["freight_cost"],
                          "currency": process["freight_currency"]})
        if process["taxes"] is not None:
            costs.append({"id": stable_id(batch_id, "COST", source_id, "AE"), "process_id": process["id"], "source_id": source_id,
                          "column": "AE", "kind": "TAXES", "amount": process["taxes"], "currency": "BRL"})

    return {"digest": digest, "file_name": file_name, "batch_id": batch_id, "sources": sources,
            "requests": list(requests.values()), "orders": list(orders.values()), "processes": processes,
            "observations": observations, "items": items, "allocations": allocations, "links": list(links.values()),
            "documents": documents, "costs": costs, "issues": issues, "new_values": dict(selectors.new),
            "new_suppliers": [name for name in NEW_SUPPLIERS if name not in {code.upper() for code in suppliers}]}


def summary(load: dict) -> dict:
    sheets = Counter(source["sheet"] for source in load["sources"])
    return {
        "sha256": load["digest"], "mappingVersion": MAPPING_VERSION, "sourceRows": len(load["sources"]),
        "preRows": sheets[PRE_SHEET], "postRows": sheets[POST_SHEET], "purchaseRequests": len(load["requests"]),
        "purchaseRequestsWithoutRequester": sum(1 for item in load["requests"] if not item["requester"]),
        "purchaseOrders": len(load["orders"]), "lifecycles": dict(Counter(order["lifecycle"] for order in load["orders"])),
        "ordersLinkedToSc": sum(1 for order in load["orders"] if order["purchase_request_id"]),
        "ordersWithoutSupplier": sorted(order["number"] for order in load["orders"] if not order["supplier"]),
        "demandTypes": dict(Counter(order["demand_type"] for order in load["orders"])),
        "items": len(load["items"]), "cancelledItems": sum(1 for item in load["items"] if item["status"] == "CANCELLED"),
        "itemsWithPriceWithoutCurrency": sum(1 for item in load["items"] if item["price"] is not None and not item["currency"]),
        "importProcesses": len(load["processes"]), "allocations": len(load["allocations"]), "links": len(load["links"]),
        "documents": dict(Counter(document["kind"] for document in load["documents"])), "costs": len(load["costs"]),
        "issues": dict(Counter(issue["code"] for issue in load["issues"])), "newValues": load["new_values"],
        "newSuppliers": load["new_suppliers"],
        "orderTotals": {f"{order['importer']}|{order['number']}": str(sum(item["quantity"] for item in load["items"]
                                                                          if item["po_id"] == order["id"]))
                        for order in load["orders"]},
        "processStatuses": {process["normalized"]: process["status"] for process in load["processes"]},
    }


def sql_text(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, Decimal)):
        return str(value)
    if isinstance(value, (UUID, date, datetime)):
        return f"'{value}'"
    if isinstance(value, (dict, list)):
        return "'" + json.dumps(value, ensure_ascii=False, sort_keys=True).replace("'", "''") + "'::jsonb"
    return "'" + str(value).replace("'", "''") + "'"


def insert(table: str, columns: tuple[str, ...], rows: list[tuple], suffix: str = "", batch_size: int = 200) -> list[str]:
    statements = []
    for start in range(0, len(rows), batch_size):
        values = ",\n".join("(" + ",".join(sql_text(value) for value in row) + ")" for row in rows[start:start + batch_size])
        statements.append(f"INSERT INTO {table} ({','.join(columns)}) VALUES\n{values}{suffix};")
    return statements


WIPE_SIMULATION = """
SET LOCAL session_replication_role = replica;
DELETE FROM imports.process_document;
DELETE FROM procurement.po_item_allocation;
DELETE FROM procurement.process_purchase_order;
DELETE FROM costs.process_cost;
DELETE FROM catalog.product_price_observation;
DELETE FROM catalog.product_totvs_description_observation;
DELETE FROM procurement.purchase_order_item;
DELETE FROM procurement.po_line_observation;
DELETE FROM procurement.purchase_order;
DELETE FROM imports.import_process;
DELETE FROM procurement.purchase_request;
SET LOCAL session_replication_role = origin;
"""


def render_sql(load: dict, commit: bool, wipe_simulation: bool) -> str:
    digest, batch_id = load["digest"], load["batch_id"]
    expected = summary(load)
    parts = ["\\set ON_ERROR_STOP on", "BEGIN;", "SET LOCAL lock_timeout = '30s';",
             f"SET LOCAL app.actor_id = {sql_text(ACTOR)};",
             f"""DO $guard$
BEGIN
  IF current_database() <> '{EXPECTED_DATABASE}' THEN
    RAISE EXCEPTION 'Refusing to load into %: only {EXPECTED_DATABASE} is allowed', current_database();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM migration.schema_migration WHERE version LIKE '%M075%') THEN
    RAISE EXCEPTION 'M075 is not applied';
  END IF;
  IF EXISTS (SELECT 1 FROM migration.import_batch WHERE file_sha256 = {sql_text(digest)} AND mapping_version = {sql_text(MAPPING_VERSION)}) THEN
    RAISE EXCEPTION 'ALREADY_PROMOTED: this workbook and mapping version were already loaded';
  END IF;
END $guard$;"""]
    if wipe_simulation:
        parts.append(WIPE_SIMULATION)
    parts.append(f"""DO $empty$
BEGIN
  IF EXISTS (SELECT 1 FROM procurement.purchase_order) OR EXISTS (SELECT 1 FROM imports.import_process)
     OR EXISTS (SELECT 1 FROM procurement.purchase_request) THEN
    RAISE EXCEPTION 'The load expects no POs, IPs or SCs';
  END IF;
END $empty$;""")
    parts += insert("migration.import_batch", ("id", "file_name", "file_sha256", "mapping_version", "state", "source_row_count"),
                    [(batch_id, load["file_name"], digest, MAPPING_VERSION, "STAGED", len(load["sources"]))])
    parts += insert("migration.source_row", ("id", "batch_id", "sheet_name", "row_number", "raw_values", "file_values",
                                             "error_columns", "row_hash"),
                    [(item["id"], batch_id, item["sheet"], item["number"], item["raw_values"], item["file_values"], [], item["hash"])
                     for item in load["sources"]])
    creator = "(SELECT created_by FROM catalog.entry WHERE kind = 'SUPPLIER' AND code = 'HEXING' AND importer IS NULL)"
    for name in load["new_suppliers"]:
        parts.append("INSERT INTO catalog.entry (id, importer, kind, code, name, status, provenance, evidence, created_by, updated_by) "
                     f"SELECT {sql_text(stable_id('SUPPLIER', name))}, NULL, 'SUPPLIER', {sql_text(name)}, {sql_text(name)}, 'ACTIVE', "
                     f"'MANUAL_REVIEW', 'Fornecedor do histórico da planilha Follow Up, sem código EX.', {creator}, {creator};")
    for entity, values in sorted(load["new_values"].items()):
        for value in values:
            parts.append("INSERT INTO catalog.operational_value (id, entity_key, value, created_by) "
                         f"SELECT {sql_text(stable_id('VALUE', entity, value))}, {sql_text(entity)}, {sql_text(value)}, {creator};")
    parts += insert("procurement.purchase_request", ("id", "importer", "sc_number", "normalized_sc_number", "requester",
                                                     "approval_date", "supplier_text", "created_by"),
                    [(item["id"], item["importer"], item["number"], item["number"].upper(), item["requester"], item["approval"],
                      item["supplier"], ACTOR) for item in load["requests"]])
    parts += insert("procurement.purchase_order", ("id", "importer", "external_number", "normalized_number", "supplier_text",
                                                   "order_date", "purchase_request_id", "demand_type", "analyst", "si_number"),
                    [(item["id"], item["importer"], item["number"], item["number"].upper(), item["supplier"], item["order_date"],
                      item["purchase_request_id"], item["demand_type"], item["analyst"], item["si_number"])
                     for item in load["orders"]])
    parts += insert("imports.import_process", (
        "id", "importer", "ip_number", "normalized_ip_number", "logistics_status", "priority", "supplier_text", "ip_totvs_date",
        "transport_mode", "incoterm", "broker", "port_loading", "port_discharge", "etd", "eta_confirmed", "ete_confirmed",
        "bl_number", "bl_date", "arrival_date", "duimp_number", "duimp_date", "customs_channel", "clearance_date",
        "nf_request_date", "delivery_date", "freight_currency", "freight_cost", "container_number", "container_type",
        "container_quantity", "forwarder", "documents_ok_date", "taxes_paid_brl"),
        [(item["id"], item["importer"], item["ip_number"], item["normalized"], item["status"], item["priority"], item["supplier"],
          item["ip_totvs_date"], item["mode"], item["incoterm"], item["broker"], item["port_loading"], item["port_discharge"],
          item["etd"], item["eta_confirmed"], item["ete_confirmed"], item["bl_number"], item["bl_date"], item["arrival"],
          item["duimp_number"], item["duimp_date"], item["channel"], item["clearance"], item["nf_request"], item["delivery"],
          item["freight_currency"], item["freight_cost"], item["container_number"], item["container_type"],
          item["container_quantity"], item["forwarder"], item["documents_ok_date"], item["taxes"]) for item in load["processes"]])
    parts += insert("procurement.po_line_observation", (
        "id", "purchase_order_id", "source_row_id", "source_row_number", "product_code_snapshot", "description_snapshot",
        "quantity", "unit_price", "historical_amount", "currency_code", "necessity_date", "historical_status", "source_ip_text",
        "raw_values"),
        [(item["id"], item["po_id"], item["source_id"], item["number"], item["code"], item["description"], item["quantity"],
          item["price"], item["amount"], item["currency"], item["necessity"], item["status"], item["ip_text"], item["raw_values"])
         for item in load["observations"]])
    parts += insert("procurement.purchase_order_item", (
        "id", "purchase_order_id", "line_number", "product_code", "description", "ordered_quantity", "unit_price", "currency_code",
        "necessity_date", "source_kind", "source_status", "source_observation_id", "priority", "demand", "requester", "sc_number",
        "sc_approval_date", "purpose", "cost_center", "draft_po", "po_approval_date", "po_sent_date", "category", "item_group",
        "ncm", "remarks"),
        [(item["id"], item["po_id"], item["line"], item["code"], item["description"], item["quantity"], item["price"],
          item["currency"], item["necessity"], "IMPORTED_SOURCE_ITEM", item["status"], item["source_id"], item["priority"],
          item["demand"], item["requester"], item["sc_number"], item["sc_approval"], item["purpose"], item["cost_center"],
          item["draft_po"], item["po_approval"], item["po_sent"], item["category"], item["group"], item["ncm"], item["remarks"])
         for item in load["items"]])
    parts += insert("procurement.process_purchase_order", ("purchase_order_id", "process_id"), load["links"])
    parts += insert("procurement.po_item_allocation", ("id", "purchase_order_item_id", "process_id", "quantity"),
                    [(item["id"], item["item_id"], item["process_id"], item["quantity"]) for item in load["allocations"]])
    parts += insert("imports.process_document", ("id", "process_id", "kind", "number", "issue_date", "homologation_date", "amount", "notes"),
                    [(item["id"], item["process_id"], item["kind"], item["number"], item["issue_date"], item["homologation_date"],
                      item["amount"], item["notes"]) for item in load["documents"]])
    parts += insert("costs.process_cost", ("id", "process_id", "source_row_id", "source_column", "cost_type", "amount", "currency_code"),
                    [(item["id"], item["process_id"], item["source_id"], item["column"], item["kind"], item["amount"], item["currency"])
                     for item in load["costs"]])
    parts += insert("migration.data_issue", ("id", "batch_id", "source_row_id", "severity", "issue_code", "field_name", "evidence"),
                    [(item["id"], item["batch_id"], item["source_row_id"], item["severity"], item["code"], item["field"], item["evidence"])
                     for item in load["issues"]])
    # The reference price is the latest observation, so the history keeps the date of its own PO.
    parts.append("""UPDATE catalog.product_price_observation AS observation SET observed_at = po.order_date
  FROM procurement.purchase_order AS po WHERE po.id = observation.purchase_order_id AND po.order_date IS NOT NULL;
UPDATE catalog.product_totvs_description_observation AS observation SET observed_at = po.order_date
  FROM procurement.purchase_order AS po WHERE po.id = observation.purchase_order_id AND po.order_date IS NOT NULL;""")
    for status, reason in (("CANCELLED", "Histórico: todas as linhas da PO estão canceladas na planilha."),
                           ("CLOSED", "Histórico: todas as linhas da PO estão entregues ou canceladas na planilha.")):
        ids = [item["id"] for item in load["orders"] if item["lifecycle"] == status]
        if ids:
            parts.append(f"UPDATE procurement.purchase_order SET lifecycle_status = {sql_text(status)}, lifecycle_changed_at = now(), "
                         f"lifecycle_changed_by = {sql_text(ACTOR)}, lifecycle_reason = {sql_text(reason)}, updated_at = now() "
                         "WHERE id IN (" + ",".join(sql_text(value) for value in ids) + ");")
    parts.append(f"""INSERT INTO audit.audit_log (id, aggregate_type, aggregate_id, entity_type, entity_id, operation, new_value, actor_id, occurred_at, reason, correlation_id)
SELECT gen_random_uuid(), 'PURCHASE_ORDER', id, 'PURCHASE_ORDER', id, 'HISTORICAL_IMPORT',
       jsonb_build_object('batchId', {sql_text(batch_id)}, 'number', external_number), {sql_text(ACTOR)}, now(),
       'Carga histórica da planilha Follow Up.', {sql_text(batch_id)}::uuid
  FROM procurement.purchase_order;
INSERT INTO audit.audit_log (id, aggregate_type, aggregate_id, entity_type, entity_id, operation, new_value, actor_id, occurred_at, reason, correlation_id)
SELECT gen_random_uuid(), 'IMPORT_PROCESS', id, 'IMPORT_PROCESS', id, 'HISTORICAL_IMPORT',
       jsonb_build_object('batchId', {sql_text(batch_id)}, 'number', ip_number), {sql_text(ACTOR)}, now(),
       'Carga histórica da planilha Follow Up.', {sql_text(batch_id)}::uuid
  FROM imports.import_process;""")
    parts.append(f"UPDATE migration.import_batch SET state = 'PROMOTED', promoted_at = now() WHERE id = {sql_text(batch_id)};")
    checks = {
        "migration.source_row": expected["sourceRows"], "procurement.purchase_request": expected["purchaseRequests"],
        "procurement.purchase_order": expected["purchaseOrders"], "procurement.purchase_order_item": expected["items"],
        "imports.import_process": expected["importProcesses"], "procurement.po_item_allocation": expected["allocations"],
        "procurement.process_purchase_order": expected["links"], "costs.process_cost": expected["costs"],
        "migration.data_issue": len(load["issues"]), "imports.process_document": sum(expected["documents"].values()),
    }
    body = "\n".join(f"  SELECT count(*) INTO found FROM {table};\n  IF found <> {count} THEN RAISE EXCEPTION "
                     f"'Reconciliation failed for {table}: expected {count}, found %', found; END IF;"
                     for table, count in checks.items())
    parts.append(f"DO $reconcile$\nDECLARE found bigint;\nBEGIN\n{body}\nEND $reconcile$;")
    parts.append("COMMIT;" if commit else "ROLLBACK;")
    return "\n".join(parts) + "\n"


def read_workbook(path: Path) -> dict:
    from openpyxl import load_workbook
    from openpyxl.utils import column_index_from_string, get_column_letter

    def letters(last: str) -> list[str]:
        return [get_column_letter(index) for index in range(2, column_index_from_string(last) + 1)]

    def sheet_rows(workbook, sheet: str, header_row: int, columns: list[str], key_columns: tuple[str, ...]) -> tuple[dict, list]:
        worksheet = workbook[sheet]
        last = column_index_from_string(columns[-1])
        rows = worksheet.iter_rows(min_row=header_row, max_col=last, values_only=True)
        first = next(rows)
        headers = {get_column_letter(index + 1): text(value) for index, value in enumerate(first)
                   if get_column_letter(index + 1) in columns and text(value)}
        result = []
        for number, row in enumerate(rows, header_row + 1):
            cells = {get_column_letter(index + 1): value for index, value in enumerate(row)}
            if any(cells.get(letter) not in (None, "") for letter in key_columns):
                result.append((number, cells))
        return headers, result

    digest = sha256(path.read_bytes()).hexdigest()
    workbook = load_workbook(path, read_only=True, data_only=True)
    try:
        pre_headers, pre_rows = sheet_rows(workbook, PRE_SHEET, PRE_HEADER_ROW, letters(PRE_LAST_COLUMN), ("F", "P", "W", "AE", "Z"))
        post_headers, post_rows = sheet_rows(workbook, POST_SHEET, POST_HEADER_ROW, letters(POST_LAST_COLUMN), ("B",))
    finally:
        workbook.close()
    formulas = load_workbook(path, read_only=True, data_only=False)
    typed: set[tuple[int, str]] = set()
    try:
        columns = {letter for letter, header in post_headers.items() if header in ("ETA", "ETE Eletra")}
        worksheet = formulas[POST_SHEET]
        for row in worksheet.iter_rows(min_row=POST_HEADER_ROW + 1, max_col=column_index_from_string(POST_LAST_COLUMN)):
            for cell in row:
                letter = getattr(cell, "column_letter", None)
                if letter in columns and cell.value is not None:
                    is_formula = hasattr(cell.value, "text") or (isinstance(cell.value, str) and cell.value.startswith("="))
                    if not is_formula:
                        typed.add((cell.row, letter))
    finally:
        formulas.close()
    return {"digest": digest, "pre_headers": pre_headers, "pre_rows": pre_rows, "post_headers": post_headers,
            "post_rows": post_rows, "typed": typed}


def read_catalog(path: Path) -> tuple[dict[str, list[str]], set[str]]:
    """Lines of `VALUE<TAB>entity<TAB>value` and `SUPPLIER<TAB>code` exported read-only from HML."""
    registered: dict[str, list[str]] = defaultdict(list)
    suppliers: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split("\t")
        if parts[0] == "VALUE" and len(parts) == 3:
            registered[parts[1]].append(parts[2])
        elif parts[0] == "SUPPLIER" and len(parts) == 2:
            suppliers.add(parts[1])
    return dict(registered), suppliers


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workbook", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, required=True, help="Catalog export read from HML")
    parser.add_argument("--expected-sha256", required=True, help="SHA-256 of the workbook approved for this load")
    parser.add_argument("--sql", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--commit", action="store_true", help="End the SQL with COMMIT; the default is ROLLBACK, a rehearsal")
    parser.add_argument("--wipe-simulation", action="store_true", help="Delete the POs, IPs and SCs of the HML simulation first")
    args = parser.parse_args()
    data = read_workbook(args.workbook)
    if data["digest"] != args.expected_sha256:
        raise SystemExit(f"Workbook SHA-256 {data['digest']} differs from the approved {args.expected_sha256}")
    registered, suppliers = read_catalog(args.catalog)
    load = build_load(data["pre_rows"], data["post_rows"], data["pre_headers"], data["post_headers"], registered, suppliers,
                      data["digest"], data["typed"], args.workbook.name)
    args.sql.write_text(render_sql(load, args.commit, args.wipe_simulation), encoding="utf-8")
    report = summary(load)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key not in ("orderTotals", "processStatuses")},
                     ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
