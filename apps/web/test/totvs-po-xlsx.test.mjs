import assert from "node:assert/strict";
import test from "node:test";
import { makeTotvsPoFile, totvsPoHeaders } from "./fixtures/totvs-po-fixture.mjs";
import { parseTotvsPoXlsx } from "../lib/totvs-po-xlsx.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";

const parsePo = file => parseTotvsPoXlsx(file, ptBR);

test("derives unit prices from Valor Total and returns the PO header and totals", async () => {
  const result = await parsePo(await makeTotvsPoFile({ rows: [
    { item: "0001", productCode: 123, quantity: 2, unitPrice: 0.01, total: 10.12345678 },
    { item: "0002", productCode: "GADGET-RF.R120", quantity: 3, unitPrice: 0, total: 1.00000001 },
    { blank: true },
    { item: "0003", productCode: "HXAP1000R31044-CEMIG", quantity: 4, unitPrice: 99.99, total: 0 },
  ] }));

  assert.deepEqual(result.header, {
    number: "030201", importerCnpj: "12345678000190", supplierCode: "EX000135",
    supplierName: "FORNECEDOR SINTÉTICO", scNumber: "020028",
  });
  assert.deepEqual(result.rows.map(row => [row.externalLineReference, row.productCode, row.unitPrice]), [
    ["0001", "0000000123", "5.06172839"],
    ["0002", "GADGET-RF.R120", "0.33333334"],
    ["0003", "HXAP1000R31044-CEMIG", "0"],
  ]);
  assert.equal(result.spreadsheetTotal, "11.12345679");
  assert.equal(result.calculatedTotal, "11.1234568");
  assert.deepEqual(result.rows.map(row => row.totalWithinTolerance), [true, true, true]);
});

test("requires the complete TOTVS purchase order layout and names missing columns", async () => {
  const headersWithoutSupplierCode = totvsPoHeaders.filter(header => header !== "Codigo");
  await assert.rejects(
    parsePo(await makeTotvsPoFile({ columnHeaders: headersWithoutSupplierCode })),
    /coluna.*Codigo/i,
  );
  await assert.rejects(
    parsePo(await makeTotvsPoFile({ columnHeaders: ["Item", "Produto"] })),
    /cabeçalhos|colunas/i,
  );
});

test("rejects a file containing more than one purchase order number", async () => {
  await assert.rejects(parsePo(await makeTotvsPoFile({ rows: [
    { poNumber: "030201" }, { item: "0002", poNumber: "030202" },
  ] })), /PC \/ AE.*mais de um valor/i);
});

test("marks derived prices that differ from a line total by more than one cent", async () => {
  const result = await parsePo(await makeTotvsPoFile({ rows: [
    { item: "0001", quantity: 3_000_000, total: 0.015 },
  ] }));
  assert.equal(result.rows[0].totalWithinTolerance, false);
});
