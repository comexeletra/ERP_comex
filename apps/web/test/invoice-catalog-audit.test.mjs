import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ExcelJS from "exceljs";
import { parseProductDatabaseXlsx } from "../lib/audit-reference-xlsx.ts";
import { invoiceCatalogCorrections, invoiceCatalogPoints, invoiceCatalogReady } from "../lib/china-invoice-mapping.ts";
import { parseChinaInvoiceXlsx } from "../lib/china-invoice-xlsx.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";

// Comparison of 2026-11-10: the analyst replaces the invoice NCM and description by the DATABASE ones (INV and PKL);
// the user decided the page checks both, the DATABASE rules without question, and a product out of it is confirmed.

const line = (sourceRow, lineNumber, productCode, ncm, description) => ({ sourceRow, lineNumber, productCode, ncm, description });
const products = [
  { sourceRow: 3, productCode: "2020100110", ncm: "85322410", description: "CAPACITOR (CONDENSDOR ELETRICO FIXO)" },
  { sourceRow: 4, productCode: "2010100040", ncm: "85332120", description: "RESISTOR (RESISTENCIA ELETRICA FIXA)" },
  { sourceRow: 5, productCode: "ABC-1", ncm: "", description: "" },
];

test("the NCM and the description of each line are set against the DATABASE by product code", () => {
  const { points, missing } = invoiceCatalogPoints([
    line(29, "14", "2020100110", "85322310", "CAPACITOR (CONDENSDOR ELeTRICO FIXO)"),
    line(19, "4", " 2010100040 ", "8533.21.20", "RESISTOR (RESISTENCIA ELETRICA FIXA) "),
    line(30, "15", "abc-1", "1", "x"),
    line(28, "13", "2011100161", "85334012", "TERMISTOR"),
  ], products);
  assert.deepEqual(points, [
    { key: "29:ncm", sourceRow: 29, lineNumber: "14", productCode: "2020100110", field: "ncm",
      invoiceValue: "85322310", databaseValue: "85322410", caseOnly: false },
    { key: "29:description", sourceRow: 29, lineNumber: "14", productCode: "2020100110", field: "description",
      invoiceValue: "CAPACITOR (CONDENSDOR ELeTRICO FIXO)", databaseValue: "CAPACITOR (CONDENSDOR ELETRICO FIXO)", caseOnly: true },
  ]);
  assert.deepEqual(missing, [{ sourceRow: 28, lineNumber: "13", productCode: "2011100161" }]);
});

test("every divergence takes the DATABASE and only a product out of it waits for a confirmation with reason", () => {
  const { points, missing } = invoiceCatalogPoints([line(29, "14", "2020100110", "85322310", "X"),
    line(28, "13", "2011100161", "85334012", "TERMISTOR")], products);
  assert.deepEqual(invoiceCatalogCorrections(points),
    { 29: { ncm: "85322410", description: "CAPACITOR (CONDENSDOR ELETRICO FIXO)" } });
  assert.equal(invoiceCatalogReady(missing, {}), false);
  assert.equal(invoiceCatalogReady(missing, { 28: { confirmed: true, reason: "ok" } }), false);
  assert.equal(invoiceCatalogReady(missing, { 28: { confirmed: true, reason: "NCM conferido no TOTVS" } }), true);
  assert.equal(invoiceCatalogReady([], {}), true);
});

// The real files (IPH037A, the DATABASE copy and the analyst's file of 2026-11-04) stay out of Git.
const folder = "../../../invoices_tests/";
const realFiles = ["IPH037A 2026       INV+PL.xlsx", "DATABASE - Renew.xlsx", "IPH037A 2026 INV+PL - Gabi 04.11.26.xlsx"]
  .map(name => new URL(folder + name, import.meta.url));
test("the DATABASE corrections reproduce the analyst's NCM and description of IPH037A",
  { skip: !realFiles.every(file => existsSync(file)) }, async () => {
    const draft = await parseChinaInvoiceXlsx(new File([await readFile(realFiles[0])], "IPH037A.xlsx"), ptBR);
    const database = await parseProductDatabaseXlsx(new File([await readFile(realFiles[1])], "DATABASE.xlsx"), ptBR);
    const { points, missing } = invoiceCatalogPoints(draft.lines, database.products);
    assert.equal(points.filter(point => point.field === "ncm").length, 18);
    assert.equal(points.filter(point => point.field === "description").length, 58);
    assert.equal(points.filter(point => point.field === "description" && point.caseOnly).length, 49);
    assert.deepEqual(missing.map(entry => entry.sourceRow), [28, 34, 36, 37]);
    const corrections = invoiceCatalogCorrections(points);
    const analyst = new ExcelJS.Workbook();
    await analyst.xlsx.load(await readFile(realFiles[2]));
    const inv = analyst.getWorksheet("INV");
    for (const entry of draft.lines) {
      const expected = corrections[entry.sourceRow] ?? {};
      assert.equal(expected.ncm ?? entry.ncm, String(inv.getCell(entry.sourceRow, 2).value), `NCM row ${entry.sourceRow}`);
      assert.equal((expected.description ?? entry.description).trim(), String(inv.getCell(entry.sourceRow, 4).value).trim(),
        `description row ${entry.sourceRow}`);
    }
  });
