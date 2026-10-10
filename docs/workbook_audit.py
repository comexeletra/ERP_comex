"""Read-only, dependency-free inventory of the local follow-up workbook."""

from collections import Counter, defaultdict
from hashlib import sha256
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
from zipfile import ZipFile


MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG = "{http://schemas.openxmlformats.org/package/2006/relationships}"


def column(cell_reference):
    return re.match(r"[A-Z]+", cell_reference).group()


def cell_value(cell, strings):
    kind = cell.get("t")
    value = cell.find(f"{MAIN}v")
    if kind == "inlineStr":
        return "".join(part.text or "" for part in cell.iter(f"{MAIN}t"))
    if value is None:
        return None
    if kind == "s":
        return strings[int(value.text)]
    return value.text


def valid_ip(value):
    value = str(value or "").strip()
    return value and value.upper() not in {"CANCELLED", "CANCELED"} and not value.startswith("#")


def main(path):
    with ZipFile(path) as book:
        strings = []
        if "xl/sharedStrings.xml" in book.namelist():
            root = ET.fromstring(book.read("xl/sharedStrings.xml"))
            strings = ["".join(text.text or "" for text in item.iter(f"{MAIN}t"))
                       for item in root.findall(f"{MAIN}si")]
        workbook = ET.fromstring(book.read("xl/workbook.xml"))
        relations = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
        targets = {item.get("Id"): item.get("Target") for item in relations.findall(f"{PKG}Relationship")}
        sheets = {}
        for sheet in workbook.find(f"{MAIN}sheets"):
            target = targets[sheet.get(f"{REL}id")]
            sheet_path = target.lstrip("/") if target.startswith("/") else f"xl/{target}"
            sheets[sheet.get("name")] = sheet_path
        result = {"sha256": sha256(Path(path).read_bytes()).hexdigest(), "sheets": list(sheets), "targetSheets": {}}
        po_ips = defaultdict(set)
        ip_pos = defaultdict(set)
        po_product_ips = defaultdict(set)
        post_ips = set()
        for name, sheet_path in sheets.items():
            if name not in {"Pré Embarque", "Pós Embarque"}:
                continue
            headers = {}
            header_row = None
            counts = Counter()
            rows_with_data = 0
            errors = Counter()
            with book.open(sheet_path) as stream:
                for _, row in ET.iterparse(stream, events=("end",)):
                    if row.tag != f"{MAIN}row":
                        continue
                    number = int(row.get("r"))
                    values = {column(cell.get("r")): cell_value(cell, strings)
                              for cell in row.findall(f"{MAIN}c")}
                    if values.get("B") == ("Necessity" if name == "Pré Embarque" else "IP Number"):
                        header_row = number
                        headers = {key: value for key, value in values.items() if value is not None}
                    if header_row is not None and number > header_row and any(value not in (None, "") for value in values.values()):
                        rows_with_data += 1
                        counts["lastDataRow"] = number
                        for cell in row.findall(f"{MAIN}c"):
                            if cell.get("t") == "e":
                                errors[column(cell.get("r"))] += 1
                        importer = str(values.get("F") or "").strip()
                        if name == "Pré Embarque":
                            po = str(values.get("N") or "").strip().upper()
                            ip = str(values.get("AB") or "").strip().upper()
                            counts["rowsWithPo" if po else "rowsWithoutPo"] += 1
                            counts["rowsWithIp" if valid_ip(ip) else "rowsWithoutIp"] += 1
                            if po and valid_ip(ip):
                                po_ips[(importer, po)].add(ip)
                                ip_pos[ip].add((importer, po))
                                product = str(values.get("T") or "").strip().upper()
                                if product:
                                    po_product_ips[(importer, po, product)].add(ip)
                            if po:
                                po_ips[(importer, po)]
                            if valid_ip(ip):
                                ip_pos[ip]
                        else:
                            ip = str(values.get("B") or "").strip().upper()
                            if valid_ip(ip):
                                counts["validIpRows"] += 1
                                post_ips.add(ip)
                    row.clear()
            result["targetSheets"][name] = {
                "dataRows": rows_with_data,
                "headerRow": header_row,
                "firstDataRow": header_row + 1 if header_row else None,
                "lastDataRow": counts["lastDataRow"],
                "counts": {key: value for key, value in counts.items() if key != "lastDataRow"},
                "excelErrorCellsByColumn": errors,
                "headers": headers,
            }
        result["relationships"] = {
            "distinctPo": len(po_ips),
            "distinctIpInPre": len(ip_pos),
            "distinctPoIpPairs": sum(map(len, po_ips.values())),
            "poWithMultipleIp": sum(len(ips) > 1 for ips in po_ips.values()),
            "ipWithMultiplePo": sum(len(pos) > 1 for pos in ip_pos.values()),
            "poIpCountDistribution": dict(sorted(Counter(map(len, po_ips.values())).items())),
            "poProductKeysInMultipleIp": sum(len(ips) > 1 for ips in po_product_ips.values()),
            "distinctIpInPost": len(post_ips),
            "ipOnlyInPre": len(ip_pos.keys() - post_ips),
            "ipOnlyInPost": len(post_ips - ip_pos.keys()),
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(Path(sys.argv[1]))
