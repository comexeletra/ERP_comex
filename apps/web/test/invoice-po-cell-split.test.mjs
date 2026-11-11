import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ExcelJS from "exceljs";
import { invoiceAssignmentsFromSplit, invoicePoCellNumbers, invoicePoCellSplit } from "../lib/china-invoice-mapping.ts";
import { parseChinaInvoiceXlsx, parseInvoicePoAssignments } from "../lib/china-invoice-xlsx.ts";
import { invoiceLineCorrections } from "../lib/invoice-correction-xlsx.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";

// User decision (2026-11-11, IPH037D): a PO cell the page cannot read ("PO 030888&030201") left its line without a
// destination and did not block the download. The line is now a pending point; when the cell cites several POs
// without quantities, the page proposes the split by the Follow Up balance in cell order, as the analyst did (20 + 60),
// and the cell is written in the analyst's format ("PO 030888 = 20 UNIT", one PO per line).

test("the POs of a cell the reader cannot split are found in cell order, without repeats", () => {
  assert.deepEqual(invoicePoCellNumbers("PO 030888&030201"), ["030888", "030201"]);
  assert.deepEqual(invoicePoCellNumbers("PO030201 / PO 030305, 030201"), ["030201", "030305"]);
  assert.deepEqual(invoicePoCellNumbers("PO 030201"), ["030201"]);
  assert.deepEqual(invoicePoCellNumbers(""), []);
  assert.deepEqual(invoicePoCellNumbers("TBD"), []);
  // A cell that already gives quantities is not guessed: its numbers are not all POs.
  assert.deepEqual(invoicePoCellNumbers("PO 030888 = 20 UNIT\nPO 030201 = 70 UNIT"), []);
});

test("the line quantity fills each PO up to its balance, in cell order, and the rest goes to the last PO", () => {
  assert.deepEqual(invoicePoCellSplit("80", ["20", "60"]), ["20", "60"]);
  assert.deepEqual(invoicePoCellSplit("50", ["20", "60"]), ["20", "30"]);
  assert.deepEqual(invoicePoCellSplit("100", ["20", "60"]), ["20", "80"]);
  assert.deepEqual(invoicePoCellSplit("80", ["0", "0"]), ["0", "80"]);
  assert.deepEqual(invoicePoCellSplit("12.5", ["10", "60"]), ["10", "2.5"]);
  assert.deepEqual(invoicePoCellSplit("x", ["10"]), []);
  const line = { sourceRow: 20, productCode: "HXAP", description: "Meter" };
  assert.deepEqual(invoiceAssignmentsFromSplit(line, ["030888", "030201"], ["20", "60"]), [
    { key: "20:0", sourceRow: 20, sourcePoNumber: "030888", poNumber: "030888", quantity: "20", productCode: "HXAP", description: "Meter" },
    { key: "20:1", sourceRow: 20, sourcePoNumber: "030201", poNumber: "030201", quantity: "60", productCode: "HXAP", description: "Meter" },
  ]);
});

test("a split cell is written in the analyst's format and read again", () => {
  const line = { sourceRow: 20, lineNumber: "5", quantity: "80", poCell: "PO 030888&030201", unitPrice: "1579.01",
    netWeightKg: "1", grossWeightKg: "2", amount: "126320.8", ncm: "85176241", description: "Meter", manufacturer: "M",
    manufacturerAddress: "A", manufacturerCountry: "CHINA", poAssignments: [] };
  const [correction] = invoiceLineCorrections([line], [{ sourceRow: 20, poNumber: "030888", quantity: "20" },
    { sourceRow: 20, poNumber: "030201", quantity: "60" }], {}, {});
  assert.equal(correction.corrected.poCell, "PO 030888 = 20 UNIT\nPO 030201 = 60 UNIT");
  assert.deepEqual(correction.changed, ["poCell"]);
  assert.deepEqual(parseInvoicePoAssignments(correction.corrected.poCell, "80", ptBR).map(entry => [entry.poNumber, entry.quantity]),
    [["030888", "20"], ["030201", "60"]]);
});

// The real IPH037D and the analyst's file of 2026-11-11 stay out of Git; the test runs where they exist.
const folder = "../../../invoices_tests/";
const real = ["IPH037D 2026       INV+PL.xlsx", "IPH037D 2026 INV+PL - Gabi 11.11.26.xlsx"]
  .map(name => new URL(folder + name, import.meta.url));
test("IPH037D: line 20 is the only line without a destination and its split matches the analyst's cell",
  { skip: !real.every(file => existsSync(file)) }, async () => {
    const draft = await parseChinaInvoiceXlsx(new File([await readFile(real[0])], "IPH037D.xlsx"), ptBR);
    const unread = draft.lines.filter(line => line.poAssignments.length === 0);
    assert.deepEqual(unread.map(line => [line.sourceRow, line.poCell]), [[20, "PO 030888&030201"]]);
    const numbers = invoicePoCellNumbers(unread[0].poCell);
    // Follow Up Import 2026 (3), IP 037D: PO 030888 holds 20 of the product (row 6778), PO 030201 holds 60 (row 6453).
    const split = invoicePoCellSplit(unread[0].quantity, ["20", "60"]);
    const [correction] = invoiceLineCorrections(unread, numbers.map((poNumber, index) =>
      ({ sourceRow: 20, poNumber, quantity: split[index] })), {}, {});
    const analyst = new ExcelJS.Workbook();
    await analyst.xlsx.load(await readFile(real[1]));
    assert.equal(correction.corrected.poCell, analyst.getWorksheet("INV").getCell("N20").value);
  });
