import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { purchaseOrderExportXlsx } from "../dist/purchase-order-exports.js";

test("purchase-order export is an Excel workbook with text and count columns", async () => {
  const bytes = await purchaseOrderExportXlsx([{
    id: "po-1",
    number: "=HYPERLINK(\"https://example.test\")",
    importer: "Eletra",
    itemCount: 3,
    linkedProcessCount: 2,
    itemsWithIp: 1,
    itemsWithoutIp: 2,
    unresolvedIssueCount: 0,
  }]);

  assert.equal(bytes.subarray(0, 2).toString("ascii"), "PK");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheet = workbook.getWorksheet("Carteira de POs");
  assert.ok(sheet);
  assert.equal(sheet.getRow(1).getCell(2).value, "PO TOTVS");
  assert.equal(sheet.getRow(2).getCell(2).value, "=HYPERLINK(\"https://example.test\")");
  assert.equal(sheet.getRow(2).getCell(2).type, ExcelJS.ValueType.String);
  assert.equal(sheet.getRow(2).getCell(4).value, 3);
});
