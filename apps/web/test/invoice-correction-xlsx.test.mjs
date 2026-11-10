import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { parseChinaInvoiceXlsx } from "../lib/china-invoice-xlsx.ts";
import { invoiceChangedCells, invoiceCorrectedTotals, invoiceLineCorrections, invoicePackingCorrections,
  writeCorrectedInvoice } from "../lib/invoice-correction-xlsx.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";

// User decision (2026-11-10): the audit page returns the invoice file itself, corrected with the analyst's
// decisions, plus an AUDITORIA sheet. Lines destined with 0 stay as they came; the PKL sheet is not changed.

async function invoiceBytes() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("INV");
  for (const [address, value] of [["J4", "IP REF.:"], ["K4", "IPH037A/2026"], ["J5", "INVOICE:"], ["K5", "PW-1"],
    ["A6", "HEXING ELECTRICAL CO.,LTD\nHANGZHOU"], ["E6", "ELETRA CNPJ 12.115.480/0001-15"],
    ["J12", "COUNTRY OF ORIGIN:"], ["K12", "CHINA.TAIWAN"]]) sheet.getCell(address).value = value;
  const header = ["No.", "NCM", "Material Code", "Product description", "Manufacturer", "Manufacturer's address",
    "Manufacturer's country", "QTY (PCS/KGS/MTS)", "QTY Unit", "Price (CNY)", "Net Weight (KG)", "Gross Weight (Kg)",
    "Total (CNY)", "PO"];
  header.forEach((value, index) => { sheet.getRow(15).getCell(index + 1).value = value; });
  const lines = [
    [1, "85423939", "A", "Part A", "Maker", "Road", "CHINA", 100, "PCS", 2, 10, 12, { formula: "H16*J16", result: 200 }, "PO030201"],
    [2, "85423939", "B", "Part B", "Maker", "Road", "CHINA", 50, "PCS", 1.5, 5, 6, 75, "PO030201"],
    [3, "85423939", "C", "Part C", "Maker", "Road", "CHINA", 10, "PCS", 3, 1, 1.5, 30, "PO030305"],
  ];
  lines.forEach((values, index) => values.forEach((value, column) => { sheet.getRow(16 + index).getCell(column + 1).value = value; }));
  sheet.getCell("D19").value = "TOTAL";
  for (const [letter, result] of [["H", 160], ["K", 16], ["L", 19.5], ["M", 305]]) {
    sheet.getCell(`${letter}19`).value = { formula: `SUM(${letter}16:${letter}18)`, result };
  }
  const packing = workbook.addWorksheet("PKL");
  for (const [address, value] of [["A12", "No."], ["B12", "NCM"], ["C12", "Product description"], ["H12", "QTY(PCS)"],
    ["I12", "Net Weight (KG)"], ["J12", "Gross Weight (KG)"],
    ["A13", 1], ["B13", "85423939"], ["C13", "Part A"], ["H13", 100], ["I13", 10], ["J13", 12],
    ["A14", 2], ["B14", "85423939"], ["C14", "Part B"], ["H14", 50], ["I14", 5.5], ["J14", 6],
    ["A15", 3], ["B15", "85423939"], ["C15", "PART C (DATABASE)"], ["H15", 10], ["I15", 1], ["J15", 1.5],
    ["A16", "Total"], ["H16", 160], ["I16", 16.5], ["J16", 19.5]]) {
    packing.getCell(address).value = value;
  }
  workbook.addWorksheet("Other").getCell("B2").value = "keep me";
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** One entry of the written zip, read from the central directory (ExcelJS does not read calcPr back). */
function zipEntryText(bytes, name) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let offset = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index += 1) {
    const nameLength = bytes.readUInt16LE(offset + 28);
    if (bytes.toString("utf8", offset + 46, offset + 46 + nameLength) === name) {
      const local = bytes.readUInt32LE(offset + 42);
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      const data = bytes.subarray(start, start + bytes.readUInt32LE(offset + 20));
      return (bytes.readUInt16LE(offset + 10) === 8 ? inflateRawSync(data) : data).toString("utf8");
    }
    offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  return "";
}

const parse = bytes => parseChinaInvoiceXlsx(new File([bytes], "IPH037A INV.xlsx"), ptBR);
const maker = { manufacturer: "Maker", manufacturerAddress: "Road", manufacturerCountry: "CHINA" };

// Line 16 split between two POs with 90 of 100, line 17 corrected to the PO price and the PKL weights, line 18 destined with 0.
const parts = [
  { sourceRow: 16, poNumber: "030201", quantity: "60" }, { sourceRow: 16, poNumber: "030305", quantity: "30" },
  { sourceRow: 17, poNumber: "030201", quantity: "50" }, { sourceRow: 18, poNumber: "030305", quantity: "0" },
];
const prices = { 17: "1.6" };
const weights = { 17: { netWeightKg: "5.5", grossWeightKg: "6" } };

test("each line gets the destined quantity, the PO cell, the corrected price, the PKL weights and the recalculated total", async () => {
  const draft = await parse(await invoiceBytes());
  const corrections = invoiceLineCorrections(draft.lines, parts, prices, weights);
  assert.deepEqual(corrections.map(entry => [entry.sourceRow, entry.destined, entry.changed, entry.corrected]), [
    [16, true, ["quantity", "poCell", "amount"], { quantity: "90", poCell: "PO 030201 = 60 units\nPO 030305 = 30 units",
      unitPrice: "2", netWeightKg: "10", grossWeightKg: "12", amount: "180", ncm: "85423939", description: "Part A", ...maker }],
    [17, true, ["unitPrice", "netWeightKg", "amount"], { quantity: "50", poCell: "PO030201", unitPrice: "1.6",
      netWeightKg: "5.5", grossWeightKg: "6", amount: "80", ncm: "85423939", description: "Part B", ...maker }],
    [18, false, [], { quantity: "10", poCell: "PO030305", unitPrice: "3", netWeightKg: "1", grossWeightKg: "1.5", amount: "30",
      ncm: "85423939", description: "Part C", ...maker }],
  ]);
  assert.deepEqual(invoiceCorrectedTotals(corrections), { quantity: "150", netWeightKg: "16.5", grossWeightKg: "19.5", amount: "290" });
});

test("the amount is rounded to cents and a PO cell with the same POs and quantities keeps its text", async () => {
  const draft = await parse(await invoiceBytes());
  const [line] = invoiceLineCorrections(draft.lines.slice(0, 1), [{ sourceRow: 16, poNumber: "PO 30201", quantity: "100" }],
    { 16: "0.364192307692308" }, {});
  assert.deepEqual(line.changed, ["unitPrice", "amount"]);
  assert.equal(line.corrected.poCell, "PO030201");
  assert.equal(line.corrected.amount, "36.42");
});

test("the corrected file changes only the corrected cells, marks them and is read again without issues", async () => {
  const original = await invoiceBytes();
  const draft = await parse(original);
  const corrections = invoiceLineCorrections(draft.lines, parts, prices, weights);
  const written = await writeCorrectedInvoice(original, draft.layout, corrections, invoiceCorrectedTotals(corrections), {
    sheetName: "AUDITORIA", summary: [["Invoice", "IPH037A INV.xlsx"], ["Follow Up", "Follow Up.xlsx"]],
    columns: ["Linha", "Ponto", "Decisão", "Motivo"], rows: [["16", "Quantidade", "90 de 100", "Saldo no próximo embarque"]],
  }, value => `Valor original: ${value}`);
  const reread = await parse(Buffer.from(written));
  assert.deepEqual(reread.issues, []);
  assert.deepEqual(reread.lines.map(line => [line.quantity, line.unitPrice, line.netWeightKg, line.amount, line.issues]), [
    ["90", "2", "10", "180", []], ["50", "1.6", "5.5", "80", []], ["10", "3", "1", "30", []]]);
  assert.deepEqual(reread.lines[0].poAssignments.map(entry => [entry.poNumber, entry.quantity]), [["030201", "60"], ["030305", "30"]]);
  assert.deepEqual(reread.declaredTotals, { quantity: "150", netWeightKg: "16.5", grossWeightKg: "19.5", amount: "290" });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(written);
  const inv = workbook.getWorksheet("INV");
  assert.equal(inv.getCell("H16").note.texts?.map(part => part.text).join("") ?? inv.getCell("H16").note, "Valor original: 100");
  assert.equal(inv.getCell("H16").fill.fgColor.argb, "FFFFFF00");
  assert.equal(inv.getCell("M16").formula, undefined);
  assert.equal(inv.getCell("J16").note, undefined);
  assert.equal(inv.getCell("H18").fill?.fgColor?.argb, undefined);
  assert.equal(inv.getCell("L19").note, undefined);
  assert.equal(inv.getCell("H19").value, 150);
  assert.equal(workbook.getWorksheet("PKL").getCell("I14").value, 5.5);
  assert.equal(workbook.getWorksheet("Other").getCell("B2").value, "keep me");
  assert.match(zipEntryText(Buffer.from(written), "xl/workbook.xml"), /<calcPr[^>]*fullCalcOnLoad="1"/u);
  const audit = workbook.getWorksheet("AUDITORIA");
  assert.deepEqual(audit.getRow(1).values.slice(1), ["Invoice", "IPH037A INV.xlsx"]);
  assert.deepEqual(audit.getRow(4).values.slice(1), ["Linha", "Ponto", "Decisão", "Motivo"]);
  assert.deepEqual(audit.getRow(5).values.slice(1), ["16", "Quantidade", "90 de 100", "Saldo no próximo embarque"]);
});

// Comparison of 2026-11-10: the analyst takes the DATABASE NCM and description in the INV and in the PKL.
test("the DATABASE NCM and description go to the INV and to the PKL line with the same No., also on a line destined with 0", async () => {
  const original = await invoiceBytes();
  const draft = await parse(original);
  const catalog = { 16: { ncm: "85322410" }, 18: { ncm: "85423939", description: "PART C (DATABASE)" } };
  const corrections = invoiceLineCorrections(draft.lines, parts, prices, weights, catalog);
  assert.deepEqual(corrections.map(entry => [entry.sourceRow, entry.changed]), [
    [16, ["quantity", "poCell", "amount", "ncm"]], [17, ["unitPrice", "netWeightKg", "amount"]], [18, ["description"]]]);
  assert.deepEqual(invoicePackingCorrections(corrections, draft.packingList),
    [{ sourceRow: 16, packingRow: 13, column: 2, field: "ncm", value: "85322410" }]);
  assert.deepEqual(invoiceChangedCells(corrections, draft.layout, draft.packingList),
    { 16: [{ field: "quantity", cell: "H16" }, { field: "poCell", cell: "N16" }, { field: "amount", cell: "M16" },
      { field: "ncm", cell: "B16" }, { field: "ncm", cell: "PKL!B13" }],
    17: [{ field: "unitPrice", cell: "J17" }, { field: "netWeightKg", cell: "K17" }, { field: "amount", cell: "M17" }],
    18: [{ field: "description", cell: "D18" }] });
  const written = await writeCorrectedInvoice(original, draft.layout, corrections, invoiceCorrectedTotals(corrections),
    { sheetName: "AUDITORIA", summary: [], columns: ["Linha"], rows: [] }, value => `Valor original: ${value}`, draft.packingList);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(written);
  const inv = workbook.getWorksheet("INV"), pkl = workbook.getWorksheet("PKL");
  assert.equal(inv.getCell("B16").value, "85322410");
  assert.equal(inv.getCell("B16").fill.fgColor.argb, "FFFFFF00");
  assert.equal(inv.getCell("D18").value, "PART C (DATABASE)");
  assert.equal(inv.getCell("H18").value, 10);
  assert.equal(pkl.getCell("B13").value, "85322410");
  assert.equal(pkl.getCell("B13").fill.fgColor.argb, "FFFFFF00");
  assert.equal(pkl.getCell("C15").fill?.fgColor?.argb, undefined);
  const reread = await parse(Buffer.from(written));
  assert.deepEqual(reread.issues, []);
  assert.equal(reread.lines[0].ncm, "85322410");
});

// User decisions (2026-11-10): the manufacturer list rules the address; the header country of origin gets the
// missing countries, written in the same cell after its label.
test("the manufacturer values and the header country of origin are written and marked", async () => {
  const original = await invoiceBytes();
  const draft = await parse(original);
  assert.deepEqual(draft.layout.countryOfOrigin, { row: 12, column: 11, prefix: "" });
  const reference = { 17: { manufacturerAddress: "Floors 3-4, Road", manufacturerCountry: "INDONESIA" }, 18: { manufacturer: "Maker" } };
  const corrections = invoiceLineCorrections(draft.lines, parts, {}, {}, reference);
  assert.deepEqual(corrections.map(entry => entry.changed), [["quantity", "poCell", "amount"],
    ["manufacturerAddress", "manufacturerCountry"], []]);
  const written = await writeCorrectedInvoice(original, draft.layout, corrections, invoiceCorrectedTotals(corrections),
    { sheetName: "AUDITORIA", summary: [], columns: ["Linha"], rows: [] }, value => `Valor original: ${value}`, draft.packingList,
    "CHINA, TAIWAN, INDONESIA");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(written);
  const inv = workbook.getWorksheet("INV");
  assert.equal(inv.getCell("F17").value, "Floors 3-4, Road");
  assert.equal(inv.getCell("G17").value, "INDONESIA");
  assert.equal(inv.getCell("G17").fill.fgColor.argb, "FFFFFF00");
  assert.equal(inv.getCell("K12").value, "CHINA, TAIWAN, INDONESIA");
  assert.equal(inv.getCell("J12").value, "COUNTRY OF ORIGIN:");
  const reread = await parse(Buffer.from(written));
  assert.equal(reread.countryOfOrigin, "CHINA, TAIWAN, INDONESIA");
  assert.deepEqual(reread.issues, []);
});

test("an existing AUDITORIA sheet is kept and the new one gets another name", async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await invoiceBytes());
  workbook.addWorksheet("AUDITORIA").getCell("A1").value = "previous";
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const draft = await parse(bytes);
  const corrections = invoiceLineCorrections(draft.lines, [], {}, {});
  const written = await writeCorrectedInvoice(bytes, draft.layout, corrections, invoiceCorrectedTotals(corrections),
    { sheetName: "AUDITORIA", summary: [], columns: ["Linha"], rows: [] }, value => value);
  const result = new ExcelJS.Workbook();
  await result.xlsx.load(written);
  assert.equal(result.getWorksheet("AUDITORIA").getCell("A1").value, "previous");
  assert.ok(result.getWorksheet("AUDITORIA 2"));
});

// The real IPH037A invoice (2026-11-10) stays out of Git; the test runs where the file exists.
const realIph037a = new URL("../../../invoices_tests/IPH037A 2026       INV+PL.xlsx", import.meta.url);
test("writes the real IPH037A without changes and reads it again", { skip: !existsSync(realIph037a) }, async () => {
  const bytes = await readFile(realIph037a);
  const draft = await parse(bytes);
  const unchanged = draft.lines.flatMap(line => line.poAssignments.map(entry => ({ sourceRow: line.sourceRow,
    poNumber: entry.poNumber, quantity: entry.quantity })));
  const corrections = invoiceLineCorrections(draft.lines, unchanged, {}, {});
  assert.equal(corrections.every(entry => entry.changed.length === 0), true);
  const written = await writeCorrectedInvoice(bytes, draft.layout, corrections, invoiceCorrectedTotals(corrections),
    { sheetName: "AUDITORIA", summary: [["Invoice", "IPH037A"]], columns: ["Linha"], rows: [] }, value => value);
  const reread = await parse(Buffer.from(written));
  assert.equal(reread.lines.length, 62);
  assert.deepEqual(reread.issues, []);
  assert.deepEqual(reread.declaredTotals, draft.declaredTotals);
});
