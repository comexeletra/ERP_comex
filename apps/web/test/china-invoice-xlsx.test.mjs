import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { parseChinaInvoiceXlsx, parseInvoicePoAssignments } from "../lib/china-invoice-xlsx.ts";

test("parses one PO with the full line quantity", () => {
  assert.deepEqual(parseInvoicePoAssignments("PO030201", "1030"), [
    { poNumber: "030201", quantity: "1030", explicitQuantity: false },
  ]);
});

test("parses explicit multi-PO splits and preserves leading zeroes", () => {
  assert.deepEqual(parseInvoicePoAssignments("PO 030321 = 412 unit\nPO 032025 = 8 unit", "420"), [
    { poNumber: "030321", quantity: "412", explicitQuantity: true },
    { poNumber: "032025", quantity: "8", explicitQuantity: true },
  ]);
  assert.deepEqual(parseInvoicePoAssignments("PO 030321 = 29046 units\nPO 032025 = 154 units", "29200").map(item => item.quantity), ["29046", "154"]);
});

test("rejects incomplete, malformed, and inconsistent multi-PO assignments", () => {
  assert.throws(() => parseInvoicePoAssignments("", "12"), /interpretar a PO/);
  assert.throws(() => parseInvoicePoAssignments("PO ???", "12"), /interpretar a PO/);
  assert.throws(() => parseInvoicePoAssignments("PO 030321 = 4 unit\nPO 032025", "12"), /quantidade para cada PO/);
  assert.throws(() => parseInvoicePoAssignments("PO 030321 = 4 unit\nPO 032025 = 7 unit", "12"), /soma das quantidades/);
  assert.throws(() => parseInvoicePoAssignments("PO 030321 = 0 unit", "0"), /quantidade total válida/);
});

async function fixtureWorkbook({ includeInv = true } = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = includeInv ? workbook.addWorksheet("INV") : workbook.addWorksheet("Other");
  if (!includeInv) return new File([Buffer.from(await workbook.xlsx.writeBuffer())], "invoice.xlsx");
  const headerValues = ["No.", "NCM", "Material Code", "Product description", "Manufacturer",
    "Manufacturer's address", "Manufacturer's country", "QTY (PCS/KGS/MTS)", "QTY Unit",
    "Price (CNY)", "Net Weight (KG)", "Gross Weight (Kg)", "Total (CNY)", "PO"];
  sheet.getRow(15).values = [undefined, ...headerValues];
  sheet.getCell("A6").value = "Exporter Ltd";
  sheet.getCell("E6").value = "Importer Ltd CNPJ 12.345.678/0001-90";
  for (const [row, label, value] of [
    [4, "IP REF.:", "IPH034B/2026"], [5, "INVOICE:", "PWBR260205-10B"],
    [6, "DATE:", new Date("2026-10-15T00:00:00Z")], [7, "PO REF.:", "PO030201"],
    [9, "FROM:", "NINGBO,CHINA"], [10, "TO:", "PECEM,BRASIL"],
    [11, "INCOTERM 2020:", "DAP"], [12, "COUNTRY OF ORIGIN:", "CHINA"],
    [13, "COUNTRY OF ACQUISITION:", "CHINA"], [14, "COUNTRY OF PRECEDENCE:", "CHINA"],
  ]) {
    sheet.getCell(row, 10).value = label;
    sheet.getCell(row, 11).value = value;
  }
  sheet.getCell("C109").value = "75 days";
  sheet.getRow(16).values = [undefined, 1, 39269090, 3011100110, "Part A", "Maker", "Factory Road", "CHINA", 1030, "PCS", 0.2232524272, 9.3, 13.54, 229.95, "PO030321"];
  sheet.getRow(17).values = [undefined, 2, 40169300, 3080702860, "Part B", "Maker", "Factory Road", "CHINA", 420, "PCS", 1.5855, 0.4, 0.5, 665.91, "PO 030321 = 412 unit\nPO 032025 = 8 unit"];
  workbook.addWorksheet("Ignored").getCell("K4").value = "SHOULD NOT BE USED";
  return new File([Buffer.from(await workbook.xlsx.writeBuffer())], "invoice.xlsx");
}

test("maps header and product fields from INV and expands PO splits", async () => {
  const result = await parseChinaInvoiceXlsx(await fixtureWorkbook());
  assert.equal(result.ipNumber, "IPH034B/2026");
  assert.equal(result.invoiceNumber, "PWBR260205-10B");
  assert.equal(result.invoiceDate, "2026-10-15");
  assert.equal(result.headerPoNumber, "PO030201");
  assert.equal(result.importerText, "Importer Ltd CNPJ 12.345.678/0001-90");
  assert.equal(result.incoterm, "DAP");
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[1].poAssignments.length, 2);
  assert.equal(result.lines[1].issues.length, 0);
  assert.equal(result.totalQuantity, "1450");
  assert.equal(result.totalAmount, "895.86");
  assert.match(result.warnings[0], /mais de uma PO/);
});

test("requires the INV sheet and an XLSX file", async () => {
  await assert.rejects(parseChinaInvoiceXlsx(await fixtureWorkbook({ includeInv: false })), /aba obrigatória INV/);
  const invalidExtension = new File(["x"], "invoice.csv");
  await assert.rejects(parseChinaInvoiceXlsx(invalidExtension), /formato .xlsx/);
});
