import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { purchaseOrderExportXlsx, queryPurchaseOrderExport } from "../dist/purchase-order-exports.js";

test("active PO export query excludes logically deleted orders", async () => {
  let sql = "";
  const result = await queryPurchaseOrderExport({
    async query(statement) { sql = statement; return { rows: [], rowCount: 0 }; },
  }, ["ELETRA MATRIZ"], {});

  assert.equal(result.totalCount, 0);
  assert.match(sql, /po\.lifecycle_status\s*<>\s*'DELETED'/u);
});

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

test("product line export follows the Pré Embarque columns and repeats the IP dates on each line", async () => {
  const { purchaseOrderLinesXlsx } = await import("../dist/purchase-order-exports.js");
  const purchaseOrder = { id: "po-1", number: "PO-1", importer: "ELETRA MATRIZ", supplierText: "SUP-1", orderDate: "2026-07-01" };
  const item = { id: "item-1", productCode: "P-1", description: "Produto 1", ncm: "85176241", unit: "UN",
    unitPrice: "2.50000000", currencyCode: "USD", necessityDate: "2026-12-01", requester: "PCM", scNumber: "123",
    priority: "ALTA", demand: "MRP", purpose: "Estoque", costCenter: "CC-1", draftPo: "D-1", category: "AP",
    remarks: "=cmd", scApprovalDate: "2026-06-01", poApprovalDate: "2026-06-10", poSentDate: "2026-06-12" };
  const bytes = await purchaseOrderLinesXlsx([
    { lineId: "a-1", lineKind: "ALLOCATION", quantity: "60.00000000", factoryShipDate: "2026-08-20", purchaseOrder, item,
      process: { id: "ip-1", ipNumber: "IP-1", ipTotvsDate: "2026-08-01", transportMode: "SEA", incoterm: "FOB",
        broker: "Ágil", portLoading: "NGB", portDischarge: "PEC", etd: "2026-09-01", actualPortDepartureDate: "2026-09-02",
        blNumber: "BL-1", blDate: "2026-09-03", arrivalDate: null, duimpNumber: null, duimpDate: null,
        customsChannel: null, clearanceDate: null, nfRequestDate: null, deliveryDate: null },
      calculated: { status: "AGUARDANDO CHEGADA", alert: "Conferir chegada da carga", eta: "2026-10-26",
        ete: "2026-11-05", transitDays: 55, invoiceNumbers: ["INV-1", "INV-2"], nfNumber: null, nfIssueDate: null,
        leadTimeDays: null, ruptureRisk: "SEM RISCO" } },
    { lineId: "item-1", lineKind: "BALANCE", quantity: "40.00000000", factoryShipDate: null, purchaseOrder, item,
      process: null, calculated: { status: "A DISTRIBUIR" } },
  ]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheet = workbook.getWorksheet("Carteira por produto");
  assert.ok(sheet);
  const headers = sheet.getRow(1).values.slice(1);
  assert.deepEqual(headers.slice(0, 51), ["Necessity", "Priority", "Alert", "Status", "Importer", "Demand", "Requester",
    "SC Totvs", "SC Appr. Date", "Finalidade", "Cost Center", "Draft PO", "PO Totvs", "PO Date", "PO Appr. Date",
    "PO Sent Date", "Supplier", "Category", "Product Code", "Product Description", "NCM", "Qty", "Unit Price",
    "Total Price", "Currency", "Remarks", "IP Number", "IP Date Totvs", "Mode", "Incoterm", "Broker", "POL", "POD",
    "ETD", "ETA", "Transit Time", "Invoice", "BL Number", "BL Date", "Arrival", "Duimp", "Duimp Date", "Channel",
    "Clearance", "ETE", "NF Request", "NF", "NF Issue Date", "Delivery Date", "LT Total", "Rupture Risk"]);
  assert.deepEqual(headers.slice(51), ["Departure", "Factory Ship Date", "Demand Type", "Line Type"]);
  const cell = (row, header) => sheet.getRow(row).getCell(headers.indexOf(header) + 1).value;
  assert.equal(cell(2, "Status"), "AGUARDANDO CHEGADA");
  assert.equal(cell(2, "IP Number"), "IP-1");
  assert.equal(cell(2, "ETD"), "2026-09-01");
  assert.equal(cell(2, "BL Number"), "BL-1");
  assert.equal(cell(2, "BL Date"), "2026-09-03");
  assert.equal(cell(2, "Departure"), "2026-09-02");
  assert.equal(cell(2, "ETA"), "2026-10-26");
  assert.equal(cell(2, "Invoice"), "INV-1, INV-2");
  assert.equal(cell(2, "Qty"), 60);
  assert.equal(cell(2, "Total Price"), 150);
  assert.equal(cell(2, "Remarks"), "=cmd");
  assert.equal(sheet.getRow(2).getCell(headers.indexOf("Remarks") + 1).type, ExcelJS.ValueType.String);
  assert.equal(cell(2, "Line Type"), "Distribuição no IP");
  assert.equal(cell(3, "Status"), "A DISTRIBUIR");
  assert.equal(cell(3, "Qty"), 40);
  assert.equal(cell(3, "IP Number"), null);
  assert.equal(cell(3, "Line Type"), "Saldo sem IP");
  for (const header of headers) assert.ok(!/freight|tax|demurrage|frete|imposto/iu.test(String(header)), header);
});
