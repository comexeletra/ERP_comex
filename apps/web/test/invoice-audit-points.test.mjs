import assert from "node:assert/strict";
import test from "node:test";
import { invoiceAuditPoints, invoiceAuditProgress, invoiceComparisonRows, invoiceExporterAliasSuggestion, invoicePoUnitDiffers,
  invoiceSupplierMatchesExporter } from "../lib/china-invoice-mapping.ts";

const unconfirmed = { code: false, supplier: false, unit: false, price: false };
const poItem = { productCode: "3080500380", unit: "UN", unitPrice: "1.5", currency: "CNY",
  supplierValues: ["HEXING ELECTRICAL CO.,LTD HANGZHOU", null, "EX000135"] };
const invoice = { productCode: "3080500380", exporter: "HEXING ELECTRICAL CO.,LTD SHANGCHENG",
  line: { unit: "KG", unitPrice: "1.5" } };

test("invoice audit lists each divergence with both values side by side", () => {
  assert.deepEqual(invoiceAuditPoints(invoice, poItem, unconfirmed), [
    { kind: "SUPPLIER", invoiceValue: "HEXING ELECTRICAL CO.,LTD SHANGCHENG",
      poValue: "HEXING ELECTRICAL CO.,LTD HANGZHOU · EX000135", confirmed: false },
    { kind: "UNIT", invoiceValue: "KG", poValue: "UN", confirmed: false },
  ]);
});

test("invoice audit keeps confirmations per point and marks a foreign PO currency as informative", () => {
  const points = invoiceAuditPoints({ productCode: "ABC", exporter: "HEXING ELECTRICAL CO.,LTD HANGZHOU", line: { unit: "UN", unitPrice: "2" } },
    { ...poItem, currency: "USD" }, { ...unconfirmed, code: true });
  assert.deepEqual(points, [
    { kind: "CODE", invoiceValue: "ABC", poValue: "3080500380", confirmed: true },
    { kind: "CURRENCY", invoiceValue: "CNY", poValue: "USD", confirmed: null },
  ]);
  assert.deepEqual(invoiceAuditProgress(points), { required: 1, confirmed: 1 });
});

test("invoice audit flags a CNY price divergence and an empty supplier", () => {
  const points = invoiceAuditPoints({ ...invoice, exporter: "OTHER", line: { unit: "UN", unitPrice: "2" } },
    { ...poItem, supplierValues: [null, ""] }, { ...unconfirmed, price: true });
  assert.deepEqual(points, [
    { kind: "SUPPLIER", invoiceValue: "OTHER", poValue: "", confirmed: false },
    { kind: "PRICE", invoiceValue: "2 CNY", poValue: "1.5 CNY", confirmed: true },
  ]);
  assert.deepEqual(invoiceAuditProgress(points), { required: 2, confirmed: 1 });
});

test("invoice audit skips line checks while the invoice line is unknown", () => {
  assert.deepEqual(invoiceAuditPoints({ ...invoice, exporter: "HEXING ELECTRICAL CO.,LTD HANGZHOU", line: null }, poItem, unconfirmed), []);
  assert.deepEqual(invoiceAuditProgress([]), { required: 0, confirmed: 0 });
});

test("invoice comparison lines up invoice, PO item and product and highlights divergent fields", () => {
  const rows = invoiceComparisonRows(
    { description: "SILICONE BUTTON", ncm: "4016.99.90", unit: "KG", unitPrice: "1.5", manufacturer: "HEXING" },
    { description: "BOTAO SILICONE", unit: "UN", ncmCode: "40169990", unitPrice: "1.5", currency: "CNY" },
    { name: "BOTAO SILICONE DO SENSOR", ncmCode: "40169100", manufacturer: null },
  );
  assert.deepEqual(rows, [
    { field: "description", invoice: "SILICONE BUTTON", poItem: "BOTAO SILICONE", product: "BOTAO SILICONE DO SENSOR", differs: false },
    { field: "ncm", invoice: "4016.99.90", poItem: "40169990", product: "40169100", differs: true },
    { field: "unit", invoice: "KG", poItem: "UN", product: "", differs: true },
    { field: "price", invoice: "1.5 CNY", poItem: "1.5 CNY", product: "", differs: false },
    { field: "manufacturer", invoice: "HEXING", poItem: "", product: "", differs: false },
  ]);
});

test("invoice comparison tolerates a missing invoice line and missing PO values", () => {
  const rows = invoiceComparisonRows(null,
    { description: "ITEM", unit: "UN", ncmCode: null, unitPrice: null, currency: null },
    { name: null, ncmCode: null, manufacturer: null });
  assert.deepEqual(rows.map(row => [row.field, row.invoice, row.poItem, row.differs]), [
    ["description", "", "ITEM", false], ["ncm", "", "", false], ["unit", "", "UN", false],
    ["price", "", "", false], ["manufacturer", "", "", false],
  ]);
});

test("equivalent units of the same measure are not a divergence", () => {
  for (const [invoiceUnit, poUnit] of [["PCS", "UN"], ["pc", "UN"], ["Pç", "UNID"], ["PEÇA", "PCS"], ["KGS", "KG"],
    ["MTS", "M"], ["u.n.", "UN"]]) {
    assert.equal(invoicePoUnitDiffers(invoiceUnit, poUnit), false, `${invoiceUnit} × ${poUnit}`);
  }
  for (const [invoiceUnit, poUnit] of [["PCS", "KG"], ["KG", "M"], ["BOX", "PCS"], ["SET", "UN"]]) {
    assert.equal(invoicePoUnitDiffers(invoiceUnit, poUnit), true, `${invoiceUnit} × ${poUnit}`);
  }
  assert.deepEqual(invoiceAuditPoints({ ...invoice, line: { unit: "PCS", unitPrice: "1.5" } }, poItem, unconfirmed)
    .map(point => point.kind), ["SUPPLIER"]);
  assert.equal(invoiceComparisonRows({ description: "", ncm: "", unit: "PCS", unitPrice: "1.5", manufacturer: "" },
    { description: "", unit: "UN", ncmCode: null, unitPrice: "1.5", currency: "CNY" },
    { name: null, ncmCode: null, manufacturer: null }).find(row => row.field === "unit").differs, false);
});

test("an Exporter alias of the PO supplier removes the supplier point; a short one does not", () => {
  const withAddress = { ...invoice, exporter: "HEXING ELECTRICAL CO.,LTD\nSHANGCHENG INDUSTRIAL ZONE, 1418", line: null };
  assert.deepEqual(invoiceAuditPoints(withAddress, { ...poItem, exporterAliases: ["Hexing Electrical Co., Ltd"] }, unconfirmed), []);
  assert.deepEqual(invoiceAuditPoints(withAddress, { ...poItem, exporterAliases: ["HEXING"] }, unconfirmed)
    .map(point => point.kind), ["SUPPLIER"]);
  assert.equal(invoiceSupplierMatchesExporter(["EX000135"], withAddress.exporter, ["HEXING ELECTRICAL CO.,LTD"]), true);
  assert.equal(invoiceSupplierMatchesExporter(["EX000135"], withAddress.exporter), false);
  assert.equal(invoiceExporterAliasSuggestion(withAddress.exporter), "HEXING ELECTRICAL CO.,LTD");
  assert.equal(invoiceExporterAliasSuggestion("  Exporter Ltd, Shangcheng  "), "Exporter Ltd, Shangcheng");
});
