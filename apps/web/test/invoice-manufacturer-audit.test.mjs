import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ExcelJS from "exceljs";
import { parseManufacturerListXlsx } from "../lib/audit-reference-xlsx.ts";
import { invoiceCountryMatches, invoiceManufacturerChecks, invoiceManufacturerCorrections, invoiceManufacturerPending,
  invoiceOriginCountries } from "../lib/china-invoice-mapping.ts";
import { parseChinaInvoiceXlsx } from "../lib/china-invoice-xlsx.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";

// User decisions (2026-11-10): the manufacturer list rules the address; a name with several addresses is chosen by
// the analyst; a manufacturer out of the list is confirmed; a country that differs from the list is decided by the
// analyst; the country goes in capitals; the header country of origin gets the missing countries.

const line = (sourceRow, manufacturer, manufacturerAddress, manufacturerCountry) =>
  ({ sourceRow, lineNumber: String(sourceRow - 15), manufacturer, manufacturerAddress, manufacturerCountry });
const list = [
  { sourceRow: 2, name: "JoulWatt Technology Co., Ltd.", address: "7 Floor, Chuangye Building", country: "China", code: "EX000452" },
  { sourceRow: 3, name: "ZHEJIANG YAJING ELECTRONICS CO., LTD", address: "Floors 3-4, Building 1, No. 757", country: "CHINA", code: "EX000283" },
  { sourceRow: 4, name: "Wujiang LF-OHM Electronic Co.,Ltd", address: "No.101, Building 24", country: "China", code: "EX000269" },
  { sourceRow: 5, name: "Hexing Meter", address: "Road A", country: "China", code: "EX000001" },
  { sourceRow: 6, name: "Hexing Meter", address: "Road B", country: "EUA", code: "EX000002" },
];

test("the manufacturer is found by address, then by name, and a name with several addresses waits for a choice", () => {
  const checks = invoiceManufacturerChecks([
    line(16, "JoulWatt Technology Co., Ltd. ", "7 Floor, Chuangye Building", "CHINA"),
    line(55, "Zhejiang Yajing Electronics Co., LTD", "Building 1, No. 757", "CHINA"),
    line(27, "Wujiang LF-OHM Electronic Co.,Ltd", "No.101,  Building 24", "Taiwan"),
    line(40, "HEXING METER", "Road C", "CHINA"),
    line(41, "Unknown Ltd", "Nowhere", "CHINA"),
  ], list);
  assert.deepEqual(checks.map(check => [check.sourceRow, check.status, check.entry?.code ?? null, check.candidates.map(entry => entry.code)]), [
    [16, "ADDRESS", "EX000452", []], [55, "NAME", "EX000283", []], [27, "ADDRESS", "EX000269", []],
    [40, "CHOICE", null, ["EX000001", "EX000002"]], [41, "MISSING", null, []]]);
});

test("countries match without case, accents or the known spellings", () => {
  assert.equal(invoiceCountryMatches("China", "CHINA"), true);
  assert.equal(invoiceCountryMatches("EUA", "USA"), true);
  assert.equal(invoiceCountryMatches("Japão", "JAPAN"), true);
  assert.equal(invoiceCountryMatches("Hong kong", "HONG KONG"), true);
  assert.equal(invoiceCountryMatches("Taiwan", "China"), false);
});

test("the list address and name replace the invoice, the country waits for the analyst and goes in capitals", () => {
  const lines = [line(16, "JoulWatt Technology Co., Ltd.", "7 Floor, Chuangye Building", "China"),
    line(55, "Zhejiang Yajing Electronics Co., LTD", "Building 1, No. 757", "CHINA"),
    line(27, "Wujiang LF-OHM Electronic Co.,Ltd", "No.101,  Building 24", "Taiwan"),
    line(40, "HEXING METER", "Road C", "CHINA"), line(41, "Unknown Ltd", "Nowhere", "Indonesia")];
  const checks = invoiceManufacturerChecks(lines, list);
  assert.equal(invoiceManufacturerPending(checks, {}, {}, {}), 3);
  const choices = { address: { 40: "EX000002" }, country: { 27: { source: "INVOICE", reason: "Origem Taiwan no BL" } },
    missing: { 41: { confirmed: true, reason: "Fabricante novo, cadastro pedido" } } };
  assert.equal(invoiceManufacturerPending(checks, choices.address, {}, choices.missing), 2);
  assert.equal(invoiceManufacturerPending(checks, choices.address, choices.country, choices.missing), 1);
  const ready = { ...choices.country, 40: { source: "LIST", reason: "Cadastro da lista" } };
  assert.equal(invoiceManufacturerPending(checks, choices.address, ready, choices.missing), 0);
  assert.deepEqual(invoiceManufacturerCorrections(lines, checks, choices.address, ready), {
    16: { manufacturerCountry: "CHINA" },
    55: { manufacturerAddress: "Floors 3-4, Building 1, No. 757" },
    27: { manufacturerAddress: "No.101, Building 24", manufacturerCountry: "TAIWAN" },
    40: { manufacturerAddress: "Road B", manufacturerCountry: "EUA" },
    41: { manufacturerCountry: "INDONESIA" },
  });
  assert.deepEqual(invoiceManufacturerCorrections(lines, [], {}, {})[27], { manufacturerCountry: "TAIWAN" });
});

test("the header country of origin keeps its countries and gets the missing ones", () => {
  assert.deepEqual(invoiceOriginCountries("CHINA.TAIWAN", ["CHINA", "TAIWAN", "INDONESIA", "CHINA"]),
    { missing: ["INDONESIA"], corrected: "CHINA, TAIWAN, INDONESIA" });
  assert.deepEqual(invoiceOriginCountries("China, Taiwan", ["CHINA", "TAIWAN"]), { missing: [], corrected: null });
  assert.deepEqual(invoiceOriginCountries("", ["CHINA"]), { missing: ["CHINA"], corrected: "CHINA" });
});

// The real files (IPH037A, the manufacturer list and the analyst's file of 2026-11-04) stay out of Git.
const folder = "../../../invoices_tests/";
const realFiles = ["IPH037A 2026       INV+PL.xlsx", "TOTVS-HEXING -LIST MANUFACTURER - Ultima Versão!!!.xlsx",
  "IPH037A 2026 INV+PL - Gabi 04.11.26.xlsx"].map(name => new URL(folder + name, import.meta.url));
test("keeping the invoice country of row 27, the list reproduces the analyst's manufacturer columns and header",
  { skip: !realFiles.every(file => existsSync(file)) }, async () => {
    const draft = await parseChinaInvoiceXlsx(new File([await readFile(realFiles[0])], "IPH037A.xlsx"), ptBR);
    const { manufacturers } = await parseManufacturerListXlsx(new File([await readFile(realFiles[1])], "LIST.xlsx"), ptBR);
    const checks = invoiceManufacturerChecks(draft.lines, manufacturers);
    assert.deepEqual(checks.filter(check => check.status !== "ADDRESS").map(check => [check.sourceRow, check.status]), [[55, "NAME"]]);
    const country = { 27: { source: "INVOICE", reason: "Gabi: TAIWAN OR CHINA?" } };
    assert.equal(invoiceManufacturerPending(checks, {}, {}, {}), 1);
    assert.equal(invoiceManufacturerPending(checks, {}, country, {}), 0);
    const corrections = invoiceManufacturerCorrections(draft.lines, checks, {}, country);
    const analyst = new ExcelJS.Workbook();
    await analyst.xlsx.load(await readFile(realFiles[2]));
    const inv = analyst.getWorksheet("INV");
    const text = cell => String(cell.value ?? "").trim();
    for (const entry of draft.lines) {
      const expected = corrections[entry.sourceRow] ?? {};
      assert.equal((expected.manufacturer ?? entry.manufacturer).trim(), text(inv.getCell(entry.sourceRow, 5)), `E${entry.sourceRow}`);
      assert.equal((expected.manufacturerAddress ?? entry.manufacturerAddress).trim(), text(inv.getCell(entry.sourceRow, 6)), `F${entry.sourceRow}`);
      if (entry.sourceRow !== 27) {
        assert.equal(expected.manufacturerCountry ?? entry.manufacturerCountry, text(inv.getCell(entry.sourceRow, 7)), `G${entry.sourceRow}`);
      }
    }
    const countries = draft.lines.map(entry => corrections[entry.sourceRow]?.manufacturerCountry ?? entry.manufacturerCountry);
    assert.equal(invoiceOriginCountries(draft.countryOfOrigin, countries).corrected, text(inv.getCell("K12")));
  });
