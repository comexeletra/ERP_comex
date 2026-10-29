import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ExcelJS from "exceljs";
import { parseChinaInvoiceXlsx, parseInvoicePoAssignments } from "../lib/china-invoice-xlsx.ts";
import { classifyInvoiceDestination, invoiceAssignmentsFromLines, invoicePoCodeDiffers, invoicePoPriceDiffers, invoicePoUnitDiffers,
  invoiceSupplierMatchesExporter } from "../lib/china-invoice-mapping.ts";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";

const parseInvoice = file => parseChinaInvoiceXlsx(file, ptBR);

test("compares product codes and suppliers without case or surrounding spaces", () => {
  assert.equal(invoicePoCodeDiffers(" abc-1 ", "ABC-1"), false);
  assert.equal(invoicePoCodeDiffers("ABC-1", "ABC-2"), true);
  assert.equal(invoiceSupplierMatchesExporter(["SUP.001", "Exporter Ltd"], "exporter ltd"), true);
  assert.equal(invoiceSupplierMatchesExporter(["SUP.001"], "Other Ltd"), false);
});

test("identifies unit and CNY price differences for each PO destination", () => {
  assert.equal(invoicePoUnitDiffers("PCS", " pcs "), false);
  assert.equal(invoicePoUnitDiffers("PCS", "KG"), true);
  assert.equal(invoicePoPriceDiffers("0.2232524272", "0.22325243", "CNY"), false);
  assert.equal(invoicePoPriceDiffers("2", "3", "CNY"), true);
  assert.equal(invoicePoPriceDiffers("2", "3", "USD"), false);
});

test("classifies missing PO, missing product, and insufficient balance by invoice row", () => {
  const matching = [{ id: "a", productCode: "A", remainingQuantity: "3" }];
  assert.equal(classifyInvoiceDestination([], false, "5", undefined).kind, "PO_NOT_REGISTERED");
  assert.equal(classifyInvoiceDestination([], true, "5", undefined).kind, "ITEM_NOT_FOUND");
  assert.deepEqual(classifyInvoiceDestination(matching, true, "5", { allocations: [], available: "3", enough: false }),
    { kind: "INSUFFICIENT_BALANCE", requested: "5", available: "3" });
  assert.equal(classifyInvoiceDestination(matching, true, "3",
    { allocations: [{ itemId: "a", quantity: "3" }], available: "3", enough: true }), null);
});

test("rebuilds invoice PO assignments after an importer is selected manually", () => {
  assert.deepEqual(invoiceAssignmentsFromLines([{
    sourceRow: 16, productCode: "INV-01", description: "Part A",
    poAssignments: [{ poNumber: "PO030201", quantity: "100" }, { poNumber: "PO030205", quantity: "50" }],
  }]), [
    { key: "16:0", sourceRow: 16, sourcePoNumber: "PO030201", poNumber: "PO030201", quantity: "100", productCode: "INV-01", description: "Part A" },
    { key: "16:1", sourceRow: 16, sourcePoNumber: "PO030205", poNumber: "PO030205", quantity: "50", productCode: "INV-01", description: "Part A" },
  ]);
});

test("parses one PO with the full line quantity", () => {
  assert.deepEqual(parseInvoicePoAssignments("PO030201", "1030", ptBR), [
    { poNumber: "030201", quantity: "1030", explicitQuantity: false },
  ]);
});

test("parses explicit multi-PO splits and preserves leading zeroes", () => {
  assert.deepEqual(parseInvoicePoAssignments("PO 030321 = 412 unit\nPO 032025 = 8 unit", "420", ptBR), [
    { poNumber: "030321", quantity: "412", explicitQuantity: true },
    { poNumber: "032025", quantity: "8", explicitQuantity: true },
  ]);
  assert.deepEqual(parseInvoicePoAssignments("PO 030321 = 29046 units\nPO 032025 = 154 units", "29200", ptBR).map(item => item.quantity), ["29046", "154"]);
});

test("rejects incomplete, malformed, and inconsistent multi-PO assignments", () => {
  assert.throws(() => parseInvoicePoAssignments("", "12", ptBR), /interpretar a PO/);
  assert.throws(() => parseInvoicePoAssignments("PO ???", "12", ptBR), /interpretar a PO/);
  assert.throws(() => parseInvoicePoAssignments("PO 030321 = 4 unit\nPO 032025", "12", ptBR), /quantidade para cada PO/);
  assert.throws(() => parseInvoicePoAssignments("PO 030321 = 4 unit\nPO 032025 = 7 unit", "12", ptBR), /soma das quantidades/);
  assert.throws(() => parseInvoicePoAssignments("PO 030321 = 0 unit", "0", ptBR), /quantidade total válida/);
});

async function fixtureWorkbook({ includeInv = true, includeIpReference = true, mutate } = {}) {
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
    if (!includeIpReference && label === "IP REF.:") continue;
    sheet.getCell(row, 10).value = label;
    sheet.getCell(row, 11).value = value;
  }
  sheet.getCell("C109").value = "75 days";
  sheet.getRow(16).values = [undefined, 1, 39269090, 3011100110, "Part A", "Maker", "Factory Road", "CHINA", 1030, "PCS", 0.2232524272, 9.3, 13.54, 229.95, "PO030321"];
  sheet.getRow(17).values = [undefined, 2, 40169300, 3080702860, "Part B", "Maker", "Factory Road", "CHINA", 420, "PCS", 1.5855, 0.4, 0.5, 665.91, "PO 030321 = 412 unit\nPO 032025 = 8 unit"];
  sheet.getCell("D18").value = "TOTAL";
  sheet.getCell("I18").value = 1450;
  sheet.getCell("L18").value = 9.7;
  sheet.getCell("M18").value = 14.04;
  sheet.getCell("N18").value = 895.86;
  mutate?.(sheet);
  workbook.addWorksheet("Ignored").getCell("K4").value = "SHOULD NOT BE USED";
  return new File([Buffer.from(await workbook.xlsx.writeBuffer())], "invoice.xlsx");
}

test("maps header and product fields from INV and expands PO splits", async () => {
  const result = await parseInvoice(await fixtureWorkbook());
  assert.equal(result.ipNumber, "IPH034B/2026");
  assert.equal(result.invoiceNumber, "PWBR260205-10B");
  assert.equal(result.invoiceDate, "2026-10-15");
  assert.equal(result.headerPoNumber, "PO030201");
  assert.equal(result.importerText, "Importer Ltd CNPJ 12.345.678/0001-90");
  assert.equal(result.importerCnpj, "12345678000190");
  assert.equal(result.incoterm, "DAP");
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[1].poAssignments.length, 2);
  assert.equal(result.lines[1].issues.length, 0);
  assert.equal(result.totalQuantity, "1450");
  assert.equal(result.totalAmount, "895.86");
  assert.match(result.fileSha256, /^[a-f0-9]{64}$/);
  assert.match(result.warnings[0], /mais de uma PO/);
});

test("keeps numbered rows with missing material and reports total discrepancies", async () => {
  const file = await fixtureWorkbook({ mutate(sheet) {
    sheet.getCell("D17").value = null;
    sheet.getCell("I18").value = 1451;
  } });
  const result = await parseInvoice(file);
  assert.equal(result.lines.length, 2);
  assert.match(result.lines[1].issues.join(" "), /Material Code/);
  assert.match(result.issues.join(" "), /TOTAL.*quantidade/);
});

test("finds header labels outside J/K and reads textual dates and party labels", async () => {
  const result = await parseInvoice(await fixtureWorkbook({ mutate(sheet) {
    for (const row of [4, 5, 6, 7, 9, 10, 11, 12, 13, 14]) {
      sheet.getCell(row, 3).value = sheet.getCell(row, 10).value;
      sheet.getCell(row, 4).value = sheet.getCell(row, 11).value;
      sheet.getCell(row, 10).value = null;
      sheet.getCell(row, 11).value = null;
    }
    sheet.getCell("D6").value = "15/10/2026";
    sheet.getCell("A6").value = null;
    sheet.getCell("E6").value = null;
    sheet.getCell("B2").value = "Exporter:";
    sheet.getCell("C2").value = "Exporter Ltd";
    sheet.getCell("F2").value = "Importer:";
    sheet.getCell("G2").value = "Importer Ltd CNPJ 12.345.678/0001-90";
    sheet.getCell("C109").value = null;
    sheet.getCell("B3").value = "Payment terms:";
    sheet.getCell("C3").value = "75 days";
  } }));
  assert.equal(result.ipNumber, "IPH034B/2026");
  assert.equal(result.invoiceDate, "2026-10-15");
  assert.equal(result.exporterText, "Exporter Ltd");
  assert.equal(result.importerCnpj, "12345678000190");
  assert.equal(result.paymentTerms, "75 days");
});

test("accepts ISO and English month dates", async () => {
  for (const [input, expected] of [["2026-10-15", "2026-10-15"], ["OCT. 15, 2026", "2026-10-15"]]) {
    const result = await parseInvoice(await fixtureWorkbook({ mutate(sheet) { sheet.getCell("K6").value = input; } }));
    assert.equal(result.invoiceDate, expected);
  }
});

test("reads INV labels and values combined in one cell, including comma month dates", async () => {
  const result = await parseInvoice(await fixtureWorkbook({ mutate(sheet) {
    sheet.getCell("J4").value = "IP REF.:  IPH034B/2026";
    sheet.getCell("K4").value = null;
    sheet.getCell("J5").value = "INVOICE: PWBR260205-10B";
    sheet.getCell("K5").value = null;
    sheet.getCell("J6").value = "DATE:OCT, 15 th 2026";
    sheet.getCell("K6").value = null;
  } }));
  assert.equal(result.ipNumber, "IPH034B/2026");
  assert.equal(result.invoiceNumber, "PWBR260205-10B");
  assert.equal(result.invoiceDate, "2026-10-15");
});

test("reads English month dates with an 'of' separator", async () => {
  const result = await parseInvoice(await fixtureWorkbook({ mutate(sheet) {
    sheet.getCell("J6").value = "DATE:OCT, 09 of 2026";
    sheet.getCell("K6").value = null;
  } }));
  assert.equal(result.invoiceDate, "2026-10-09");
});

test("reads formula totals immediately after the last product before later TOTAL text", async () => {
  const result = await parseInvoice(await fixtureWorkbook({ mutate(sheet) {
    sheet.getCell("D18").value = null;
    for (const [column, value] of [["I", 1450], ["L", 9.7], ["M", 14.04], ["N", 895.86]]) {
      sheet.getCell(`${column}18`).value = { formula: `SUM(${column}16:${column}17)`, result: value };
    }
    sheet.getCell("A22").value = "TOTAL CARTONS";
    sheet.getCell("O22").value = "TOTAL IGNORE OUTSIDE A:N";
  } }));
  assert.deepEqual(result.issues, []);
});

test("parses the anonymized A:N layout derived from the long INV example", async () => {
  const bytes = await readFile(new URL("./fixtures/inv-layout-a-n-anonymized.xlsx", import.meta.url));
  const result = await parseInvoice(new File([bytes], "inv-layout-a-n-anonymized.xlsx"));
  assert.equal(result.lines.length, 91);
  assert.equal(result.ipNumber, "IPH-ANON-2026");
  assert.equal(result.invoiceDate, "2026-10-15");
  assert.equal(result.totalQuantity, "91");
  assert.equal(result.totalAmount, "182");
  assert.deepEqual(result.issues, []);
  assert.equal(result.lines.reduce((count, line) => count + line.issues.length, 0), 0);
});

test("reports invalid NCM and warns when net weight exceeds gross weight", async () => {
  const result = await parseInvoice(await fixtureWorkbook({ mutate(sheet) {
    sheet.getCell("C16").value = 123;
    sheet.getCell("L16").value = 14;
    sheet.getCell("L18").value = 14.4;
  } }));
  assert.match(result.lines[0].issues.join(" "), /NCM.*8 dígitos/);
  assert.match(result.warnings.join(" "), /peso líquido.*bruto/);
});

test("rejects price and total columns in a currency other than CNY", async () => {
  await assert.rejects(parseInvoice(await fixtureWorkbook({ mutate(sheet) {
    sheet.getCell("K15").value = "Price (USD)";
    sheet.getCell("N15").value = "Total (USD)";
  } })), /CNY/);
});

test("requires the INV sheet and an XLSX file", async () => {
  await assert.rejects(parseInvoice(await fixtureWorkbook({ includeInv: false })), /aba obrigatória INV/);
  const invalidExtension = new File(["x"], "invoice.csv");
  await assert.rejects(parseInvoice(invalidExtension), /formato .xlsx/);
});

test("requires IP REF in the INV header", async () => {
  await assert.rejects(parseInvoice(await fixtureWorkbook({ includeIpReference: false })), /IP REF header is required/);
});

test("invoice parsing messages follow the chosen language", () => {
  assert.throws(() => parseInvoicePoAssignments("PO ???", "12", en), /Could not interpret the PO on this line/);
  assert.throws(() => parseInvoicePoAssignments("PO ???", "12", zhCN), /无法识别该行的 PO/);
});
