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
        leadTimeDays: null, ruptureRisk: "SEM RISCO",
        e2e: { totalTargetDays: 118, totalActualDays: 123, totalDelayDays: 5, bottleneck: "T1",
          currentStatus: "AGUARDANDO CHEGADA", arrivalYearMonth: "2026-10",
          stages: { T3: { deadline: "2026-07-12", actual: "2026-09-02", source: "actual", targetDays: 30, actualDays: 82, delayDays: 52 },
            T4: { deadline: "2026-10-27", actual: "2026-10-26", source: "forecast", targetDays: 55, actualDays: 54, delayDays: -1 } } } } },
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
  const e2eHeaders = ["T0", "T1", "T2", "T3", "T4", "T5"].flatMap(code => ["Deadline", "Actual", "Target Days",
    "Actual Days", "Delay Days"].map(name => `${code} ${name}`));
  assert.deepEqual(headers.slice(51), ["Departure", "Factory Ship Date", "Demand Type", ...e2eHeaders,
    "Total Target Days", "Total Actual Days", "Total Delay Days", "Bottleneck Stage", "Current Status", "Arrival YM",
    "E2E Forecast Stages", "Line Type"]);
  const cell = (row, header) => sheet.getRow(row).getCell(headers.indexOf(header) + 1).value;
  assert.equal(cell(2, "Status"), "AGUARDANDO CHEGADA");
  assert.equal(cell(2, "IP Number"), "IP-1");
  assert.equal(cell(2, "ETD"), "2026-09-01");
  assert.equal(cell(2, "BL Number"), "BL-1");
  assert.equal(cell(2, "BL Date"), "2026-09-03");
  assert.equal(cell(2, "Departure"), "2026-09-02");
  assert.equal(cell(2, "ETA"), "2026-10-26");
  assert.equal(cell(2, "Invoice"), "INV-1, INV-2");
  assert.equal(cell(2, "T3 Deadline"), "2026-07-12");
  assert.equal(cell(2, "T3 Delay Days"), 52);
  assert.equal(cell(2, "T4 Actual"), "2026-10-26");
  assert.equal(cell(2, "Total Delay Days"), 5);
  assert.equal(cell(2, "Bottleneck Stage"), "T1");
  assert.equal(cell(2, "E2E Forecast Stages"), "T4");
  assert.equal(cell(2, "T0 Deadline"), null);
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

test("PO export follows the screen lifecycle filter and table columns when columns are chosen", async () => {
  const { resolveExportColumns } = await import("../dist/export-columns.js");
  let sql = "";
  let params = [];
  await queryPurchaseOrderExport({
    async query(statement, values) { sql = statement; params = values; return { rows: [], rowCount: 0 }; },
  }, ["ELETRA MATRIZ"], { lifecycle: "closed" });
  assert.match(sql, /po\.lifecycle_status/u);
  assert.match(sql, /lower\(po\.lifecycle_status\) = \$6::text/u);
  assert.equal(params[5], "closed");

  const columns = resolveExportColumns("portfolio", [{ key: "lifecycleStatus", header: "Status" },
    { key: "itemCount", header: "Items" }], {});
  const bytes = await purchaseOrderExportXlsx([{ id: "po-1", number: "PO-1", importer: "Eletra", lifecycleStatus: "CLOSED",
    itemCount: 3, linkedProcessCount: 2, itemsWithIp: 1, itemsWithoutIp: 2, unresolvedIssueCount: 0 }], columns);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheet = workbook.getWorksheet("Carteira de POs");
  assert.deepEqual(sheet.getRow(1).values.slice(1), ["PO TOTVS", "Status", "Items"]);
  assert.deepEqual(sheet.getRow(2).values.slice(1), ["PO-1", "Encerrada", 3]);
  assert.deepEqual(sheet.autoFilter, { from: { row: 1, column: 1 }, to: { row: 1, column: 3 } });
});

test("product line exports write only the chosen table columns, in the table order", async () => {
  const { purchaseOrderLinesXlsx } = await import("../dist/purchase-order-exports.js");
  const { resolveExportColumns } = await import("../dist/export-columns.js");
  const line = { lineId: "a-1", lineKind: "ALLOCATION", quantity: "60.00000000", factoryShipDate: "2026-08-20",
    purchaseOrder: { id: "po-1", number: "PO-1", importer: "ELETRA MATRIZ" },
    item: { productCode: "P-1", description: "Produto 1", necessityDate: "2026-12-01", scNumber: "123", purpose: "Estoque",
      group: "G-1" },
    process: { ipNumber: "IP-1", transportMode: "SEA", etd: "2026-09-01", actualPortDepartureDate: "2026-09-02",
      blDate: "2026-09-03", arrivalDate: null, deliveryDate: null },
    calculated: { status: "AGUARDANDO CHEGADA", eta: "2026-10-26", ete: "2026-11-05", invoiceNumbers: ["INV-1", "INV-2"],
      e2e: { air: false, totalTargetDays: 118, totalActualDays: 123, totalDelayDays: 5, bottleneck: "T3",
        currentStatus: "AGUARDANDO CHEGADA", arrivalYearMonth: "2026-10",
        stages: { T3: { deadline: "2026-07-12", actual: "2026-09-02", source: "actual", targetDays: 30, actualDays: 82,
          delayDays: 52, accumulatedDelayDays: 40 },
        T4: { deadline: "2026-10-27", actual: "2026-10-26", source: "forecast", targetDays: 55, actualDays: 54,
          delayDays: -1, accumulatedDelayDays: 39 } } } } };
  const load = async bytes => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    return workbook.getWorksheet("Carteira por produto");
  };

  const lines = await load(await purchaseOrderLinesXlsx([line], resolveExportColumns("product-lines", [
    { key: "invoice", header: "Invoice" }, { key: "quantity", header: "Qty" }, { key: "product", header: "Product" },
    { key: "productDescription", header: "Description" }], {})));
  assert.deepEqual(lines.getRow(1).values.slice(1), ["PO", "Product", "Description", "Qty", "Invoice"]);
  assert.deepEqual(lines.getRow(2).values.slice(1), ["PO-1", "P-1", "Produto 1", 60, "INV-1, INV-2"]);
  assert.deepEqual(lines.autoFilter, { from: { row: 1, column: 1 }, to: { row: 1, column: 5 } });

  const filters = { stage: "T3", view: "reached" };
  const e2e = await load(await purchaseOrderLinesXlsx([line], resolveExportColumns("end-to-end", [
    { key: "modal", header: "Modal" }, { key: "group", header: "Grupo" }, { key: "accumulatedDelay", header: "Acumulado até T3" },
    { key: "t3Delay", header: "T3 Atraso" }, { key: "t4Actual", header: "T4 Real" }, { key: "totalDelay", header: "Atraso" },
    { key: "currentStatus", header: "Status atual" }], filters)));
  assert.deepEqual(e2e.getRow(1).values.slice(1), ["PO", "Produto", "Modal", "Grupo", "Acumulado até T3", "T3 Atraso",
    "T4 Real", "Atraso", "Status atual"]);
  assert.deepEqual(e2e.getRow(2).values.slice(1), ["PO-1", "P-1", "Marítimo", "G-1", 40, 52, "2026-10-26", 5,
    "AGUARDANDO CHEGADA"]);
  // Forecast dates are shown in italics, as on the screen.
  assert.equal(e2e.getRow(2).getCell(7).font?.italic, true);
  assert.notEqual(e2e.getRow(2).getCell(6).font?.italic, true);
});
