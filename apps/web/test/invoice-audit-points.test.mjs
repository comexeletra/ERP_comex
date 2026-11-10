import assert from "node:assert/strict";
import test from "node:test";
import { invoiceAuditPoints, invoiceAuditProgress, invoiceComparisonRows, invoiceExporterAliasSuggestion, invoicePoUnitDiffers,
  invoicePriceDifference, invoicePriceTolerancePercent, invoiceSupplierMatchesExporter } from "../lib/china-invoice-mapping.ts";
import { formatPercentChange } from "../lib/format-number.ts";

const unconfirmed = { supplier: false, unit: false, price: false };
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
  const points = invoiceAuditPoints({ productCode: "3080500380", exporter: "OTHER", line: { unit: "UN", unitPrice: "2" } },
    { ...poItem, currency: "USD" }, { ...unconfirmed, supplier: true });
  assert.deepEqual(points, [
    { kind: "SUPPLIER", invoiceValue: "OTHER", poValue: "HEXING ELECTRICAL CO.,LTD HANGZHOU · EX000135", confirmed: true },
    { kind: "CURRENCY", invoiceValue: "CNY", poValue: "USD", confirmed: null },
  ]);
  assert.deepEqual(invoiceAuditProgress(points), { required: 1, confirmed: 1 });
});

test("invoice audit flags a CNY price divergence and an empty supplier", () => {
  const points = invoiceAuditPoints({ ...invoice, exporter: "OTHER", line: { unit: "UN", unitPrice: "2" } },
    { ...poItem, supplierValues: [null, ""] }, { ...unconfirmed, price: true });
  assert.deepEqual(points, [
    { kind: "SUPPLIER", invoiceValue: "OTHER", poValue: "", confirmed: false },
    { kind: "PRICE", invoiceValue: "2 CNY", poValue: "1.5 CNY", confirmed: true,
      difference: { percent: 33.3333, withinTolerance: false } },
  ]);
  assert.deepEqual(invoiceAuditProgress(points), { required: 2, confirmed: 1 });
});

// User decision (2026-11-10): the difference is shown in percent against the 20% tolerance, and every
// difference still waits for the analyst's acceptance.
test("a price point shows the difference in percent and still needs the acceptance within the tolerance", () => {
  assert.equal(invoicePriceTolerancePercent, 20);
  const point = (invoicePrice, poPrice) => invoiceAuditPoints(
    { ...invoice, exporter: "HEXING ELECTRICAL CO.,LTD HANGZHOU", line: { unit: "UN", unitPrice: invoicePrice } },
    { ...poItem, unitPrice: poPrice }, unconfirmed).find(entry => entry.kind === "PRICE");
  // IPH034A row 149 (rounding of the line total) and row 36 (a real difference).
  assert.deepEqual(point("0.364192307692308", "0.36420000"),
    { kind: "PRICE", invoiceValue: "0.364192307692308 CNY", poValue: "0.36420000 CNY", confirmed: false,
      difference: { percent: -0.0021, withinTolerance: true } });
  assert.deepEqual(point("30.08", "35.85").difference, { percent: -16.0948, withinTolerance: true });
  // The limit is inclusive and exact: 0.6 against 0.5 is 20% (floating point would give 20.000000000000004).
  assert.deepEqual(invoicePriceDifference("0.6", "0.5"), { percent: 20, withinTolerance: true });
  assert.deepEqual(invoicePriceDifference("1.2001", "1"), { percent: 20.01, withinTolerance: false });
  assert.deepEqual(invoicePriceDifference("0.5", "0"), { percent: null, withinTolerance: false });
  assert.equal(invoicePriceDifference("0.3642", "0.36420000"), null);
});

test("the percent of a price difference is written with its sign, and tiny ones as below 0.01%", () => {
  assert.equal(formatPercentChange(-16.0948), "−16,09%");
  assert.equal(formatPercentChange(33.3333), "+33,33%");
  assert.equal(formatPercentChange(-0.0021), "< 0,01%");
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

// Items of the historical Follow Up load have no unit (3,071 in active HML POs); like the API, the review skips the unit check.
test("a PO item without unit is not a unit divergence and does not break the review", () => {
  for (const poUnit of [null, undefined, "", "  "]) {
    assert.equal(invoicePoUnitDiffers("PCS", poUnit), false, `PCS × ${poUnit}`);
    assert.equal(invoicePoUnitDiffers(poUnit, "UN"), false, `${poUnit} × UN`);
  }
  assert.deepEqual(invoiceAuditPoints(invoice, { ...poItem, unit: null }, unconfirmed).map(point => point.kind), ["SUPPLIER"]);
  const unitRow = invoiceComparisonRows({ description: "", ncm: "", unit: "PCS", unitPrice: "1.5", manufacturer: "" },
    { description: "", unit: null, ncmCode: null, unitPrice: "1.5", currency: "CNY" },
    { name: null, ncmCode: null, manufacturer: null }).find(row => row.field === "unit");
  assert.deepEqual(unitRow, { field: "unit", invoice: "PCS", poItem: "", product: "", differs: false });
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

test("the invoice only fills product fields that are still empty in the catalog", async () => {
  const { invoiceProductFillFields } = await import("../lib/china-invoice-mapping.ts");
  const line = { ncm: "40169990", manufacturer: "Hangzhou Shunhesheng", manufacturerAddress: "Hangzhou", manufacturerCountry: "CN" };
  const empty = { ncmCode: null, manufacturer: null, manufacturerAddress: " ", manufacturerCountry: null };
  assert.deepEqual(invoiceProductFillFields(line, empty), ["ncm", "manufacturer", "manufacturerAddress", "manufacturerCountry"]);
  assert.deepEqual(invoiceProductFillFields(line, { ...empty, ncmCode: "39269090", manufacturer: "Other" }),
    ["manufacturerAddress", "manufacturerCountry"]);
  // An NCM that is not 8 digits and blank invoice values fill nothing.
  assert.deepEqual(invoiceProductFillFields({ ncm: "4016", manufacturer: " ", manufacturerAddress: "", manufacturerCountry: "" }, empty), []);
});
