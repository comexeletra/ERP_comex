import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ExcelJS from "exceljs";
import { followUpCandidates, followUpImporters, followUpIpMatches, followUpSameIps, parseFollowUpXlsx } from "../lib/follow-up-po-xlsx.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";

// User decision (2026-11-10): the invoice audit page reads the POs from the Follow Up in use, in the browser.

const headers = ["ID Registro", "Necessity", "Priority", "Alert", "Status", "Importer", "Demand", "Requester", "SC Totvs",
  "SC Appr. Date", "SI", "Finalidade", "Cost Center", "Draft PO", "Analyst", "PO Totvs", "PO Date", "PO Appr. Date",
  "PO Sent Date", "Supplier", "Group", "Category", "Product Code", "Product Description", "NCM", "Qty", "Unit Price",
  "Total Price", "Currency", "Remarks", "IP Number"];
const column = name => headers.indexOf(name) + 1;

async function followUpFile({ mutate, sheetName = "Pré Embarque" } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Capa").getCell("A1").value = "Follow Up";
  const sheet = workbook.addWorksheet(sheetName);
  sheet.getCell("C2").value = "PRE-SHIPMENT";
  headers.forEach((header, index) => { sheet.getRow(3).getCell(index + 1).value = header; });
  const rows = [
    // Status, Importer, PO, Supplier, Code, Qty, Price, Currency, IP
    ["WAITING PRODUCTION", "ELETRA MATRIZ", 30201, "HEXING", 2052500670, 69000, 0.4725, "CNY", null],
    ["WAITING SHIPMENT", "ELETRA MATRIZ", 30201, "HEXING", "2052500670", 1000, { formula: "0.4725", result: 0.47250000000000003 }, "CNY", "037A/2026"],
    ["WAITING ARRIVAL", "ELETRA MATRIZ", 30201, "hexing", 2052500670, 500, 0.4725, "CNY", "034A/2026"],
    ["CANCELLED", "ELETRA MATRIZ", 30201, "HEXING", 2052500670, 10, 0.4725, "CNY", null],
    ["WAITING PRODUCTION", "ELETRA MATRIZ", 30201, "HEXING", 2052500670, 20, 0.4725, "CNY", "Cancelled"],
    ["WAITING PRODUCTION", "ELETRA MATRIZ", 29720, "HEXING", "3080500380", 30, null, null, "#N/A"],
    ["WAITING PRODUCTION", "ELETRA FOR", 30201, "EX000135", "2052500670", 7, 0.5, "CNY", null],
    ["WAITING PRODUCTION", "ELETRA MATRIZ", 30201, "HEXING", "X-1", 0, 1, "CNY", null],
    ["WAITING PRODUCTION", "ELETRA MATRIZ", null, "HEXING", "NO-PO", 5, 1, "CNY", null],
  ];
  rows.forEach(([status, importer, po, supplier, code, qty, price, currency, ip], index) => {
    const row = sheet.getRow(4 + index);
    for (const [name, value] of [["Status", status], ["Importer", importer], ["PO Totvs", po], ["Supplier", supplier],
      ["Product Code", code], ["Qty", qty], ["Unit Price", price], ["Currency", currency], ["IP Number", ip],
      ["Product Description", "Circuito & regulador <SMD>"]]) {
      if (value !== null) row.getCell(column(name)).value = value;
    }
  });
  mutate?.(sheet);
  workbook.addWorksheet("End-to-End").getCell("A1").value = "ignored";
  return new File([Buffer.from(await workbook.xlsx.writeBuffer())], "Follow Up.xlsx");
}

test("reads the Pre sheet by header name, leaves cancelled lines out and keeps the sheet order", async () => {
  const result = await parseFollowUpXlsx(await followUpFile(), ptBR);
  assert.equal(result.cancelled, 2);
  assert.equal(result.ignored, 1);
  assert.match(result.fileSha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(result.lines, [
    { sourceRow: 4, importer: "ELETRA MATRIZ", poNumber: "030201", supplier: "HEXING", productCode: "2052500670",
      quantity: "69000", unitPrice: "0.4725", currency: "CNY", ipNumber: "", status: "WAITING PRODUCTION" },
    { sourceRow: 5, importer: "ELETRA MATRIZ", poNumber: "030201", supplier: "HEXING", productCode: "2052500670",
      quantity: "1000", unitPrice: "0.4725", currency: "CNY", ipNumber: "037A/2026", status: "WAITING SHIPMENT" },
    { sourceRow: 6, importer: "ELETRA MATRIZ", poNumber: "030201", supplier: "HEXING", productCode: "2052500670",
      quantity: "500", unitPrice: "0.4725", currency: "CNY", ipNumber: "034A/2026", status: "WAITING ARRIVAL" },
    { sourceRow: 9, importer: "ELETRA MATRIZ", poNumber: "029720", supplier: "HEXING", productCode: "3080500380",
      quantity: "30", unitPrice: null, currency: null, ipNumber: "", status: "WAITING PRODUCTION" },
    { sourceRow: 10, importer: "ELETRA FOR", poNumber: "030201", supplier: "EX000135", productCode: "2052500670",
      quantity: "7", unitPrice: "0.5", currency: "CNY", ipNumber: "", status: "WAITING PRODUCTION" },
  ]);
});

test("a missing column, a missing Pre sheet or another file type is refused with the reason", async () => {
  await assert.rejects(parseFollowUpXlsx(await followUpFile({ mutate(sheet) { sheet.getCell(3, column("Unit Price")).value = "Price"; } }), ptBR),
    /Unit Price/u);
  await assert.rejects(parseFollowUpXlsx(await followUpFile({ sheetName: "Pre" }), ptBR), /Pré Embarque/u);
  await assert.rejects(parseFollowUpXlsx(new File(["x"], "follow.csv"), ptBR), /\.xlsx/u);
  await assert.rejects(parseFollowUpXlsx(new File(["not a zip file at all, just text"], "follow.xlsx"), ptBR), /ler a planilha/u);
});

test("the invoice IP matches the Follow Up IP with or without the IPH prefix", () => {
  assert.equal(followUpIpMatches("034A/2026", "IPH034A/2026"), true);
  assert.equal(followUpIpMatches(" iph034a / 2026", "IPH034A/2026"), true);
  assert.equal(followUpIpMatches("Z-021B/2026", "Z-021B/2026"), true);
  assert.equal(followUpIpMatches("034B/2026", "IPH034A/2026"), false);
  assert.equal(followUpIpMatches("", "IPH034A/2026"), false);
});

test("the candidates of a PO are its lines without IP or on the invoice IP, in sheet order and per importer", async () => {
  const { lines } = await parseFollowUpXlsx(await followUpFile(), ptBR);
  assert.deepEqual(followUpImporters(lines, ["030201", "PO 29720"]), ["ELETRA FOR", "ELETRA MATRIZ"]);
  assert.deepEqual(followUpSameIps(lines, "IPH037A/2026"), ["037A/2026"]);
  const { poExists, items } = followUpCandidates(lines, "ELETRA MATRIZ", "30201", "IPH037A/2026");
  assert.equal(poExists, true);
  assert.deepEqual(items.map(item => [item.id, item.lineNumber, item.remainingQuantity, item.ipNumber]),
    [["fu:4", 4, "69000", ""], ["fu:5", 5, "1000", "037A/2026"]]);
  assert.deepEqual(followUpCandidates(lines, "ELETRA MATRIZ", "999999", "IPH037A/2026"), { poExists: false, items: [] });
  assert.deepEqual(followUpCandidates(lines, "ELETRA CWB", "030201", "IPH037A/2026").poExists, false);
});

// The local Follow Up copy (2026-10-29) stays out of Git (*.xlsx); the test runs where the file exists.
const realFollowUp = new URL("../../../Follow Up Import 2026 - atualizado .xlsx", import.meta.url);
test("reads the real Follow Up Pre sheet", { skip: !existsSync(realFollowUp) }, async () => {
  const result = await parseFollowUpXlsx(new File([await readFile(realFollowUp)], "Follow Up.xlsx"), ptBR);
  assert.ok(result.lines.length > 6000, String(result.lines.length));
  assert.equal(followUpSameIps(result.lines, "IPH034A/2026").join(), "034A/2026");
  assert.equal(result.lines.filter(line => line.ipNumber === "034A/2026").length, 196);
});
