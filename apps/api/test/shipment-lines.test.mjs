import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerShipmentLineRoutes, shipmentLineStatuses, shipmentStatusSql } from "../dist/shipment-lines.js";

const actorId = "00000000-0000-4000-8000-000000000001";
const poId = "00000000-0000-4000-8000-000000000041";
const itemId = "00000000-0000-4000-8000-000000000042";
const processId = "00000000-0000-4000-8000-000000000043";
const allocationId = "00000000-0000-4000-8000-000000000044";
const item = { id: itemId, lineNumber: 1, productCode: "P-1", description: "Produto 1", orderedQuantity: "100.00000000",
  unit: "UN", unitPrice: "2.00000000", currencyCode: "USD", necessityDate: "2026-12-01", sourceStatus: null };
const purchaseOrder = { id: poId, number: "PO-1", importer: "ELETRA MATRIZ", supplierText: "SUP-1" };

const defaultRows = [
  { line_id: allocationId, line_kind: "ALLOCATION", line_quantity: "60.00000000",
    factory_ship_date: "2026-08-20", line_status: "AGUARDANDO CHEGADA", purchase_order: purchaseOrder, item,
    process: { id: processId, ip_number: "IP-1", importer: "ELETRA MATRIZ", transport_mode: "SEA",
      etd: "2026-09-01", bl_number: "BL-1", bl_date: "2026-09-03", arrival_date: null, logistics_status: null,
      freight_cost: 1500, taxes_paid_brl: 900, demurrage_brl: 10 } },
  { line_id: itemId, line_kind: "BALANCE", line_quantity: "40.00000000",
    factory_ship_date: null, line_status: "A DISTRIBUIR", purchase_order: purchaseOrder, item, process: null },
];
const defaultDocuments = [{ id: "00000000-0000-4000-8000-000000000045", process_id: processId, kind: "INVOICE",
  status: "ACTIVE", number: "INV-1", purchase_order_item_id: null }];

async function linesApp(t, rows = defaultRows, documents = defaultDocuments) {
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("identity.erp_user AS u")) return { rows: [{ role: "Consulta", importer_code: "ELETRA MATRIZ" }] };
      if (sql.includes("line_kind")) return { rows: [{ total_count: rows.length, items: rows }] };
      if (sql.includes("FROM imports.process_document")) return { rows: documents };
      return { rows: [] };
    },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    request.authContext = { issuer: "ci", subject: "reader", userId: actorId, displayName: null, sessionToken: "ci" };
  });
  await registerShipmentLineRoutes(app, pool);
  return { app, queries };
}

test("product lines repeat the IP dates on each allocation and show the remaining balance", async t => {
  const { app, queries } = await linesApp(t);
  const response = await app.inject({ method: "GET", url: "/api/v1/purchase-order-lines?situation=all" });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(body.totalCount, 2);
  const [allocation, balance] = body.lines;
  assert.equal(allocation.lineKind, "ALLOCATION");
  assert.equal(allocation.quantity, "60.00000000");
  assert.equal(allocation.factoryShipDate, "2026-08-20");
  assert.equal(allocation.process.ipNumber, "IP-1");
  assert.equal(allocation.process.blDate, "2026-09-03");
  assert.equal(allocation.process.blNumber, "BL-1");
  for (const cost of ["freightCost", "taxesPaidBrl", "demurrageBrl"]) assert.equal(cost in allocation.process, false);
  assert.equal(allocation.calculated.status, "AGUARDANDO CHEGADA");
  assert.equal(allocation.calculated.eta, "2026-10-26");
  assert.deepEqual(allocation.calculated.invoiceNumbers, ["INV-1"]);
  assert.equal(balance.lineKind, "BALANCE");
  assert.equal(balance.quantity, "40.00000000");
  assert.equal(balance.process, null);
  assert.deepEqual(Object.keys(balance.calculated), ["status", "e2e"]);
  assert.equal(balance.calculated.status, "A DISTRIBUIR");
  // The balance without IP still runs the E2E stages that do not depend on an IP.
  assert.equal(balance.calculated.e2e.stages.T0.deadline, "2026-08-01");
  assert.equal(balance.calculated.e2e.currentStatus, "A DISTRIBUIR");
  assert.equal(balance.calculated.e2e.stages.T4.deadline, null);
  assert.equal(allocation.calculated.e2e.stages.T4.targetDays, 55);
  const documents = queries.find(query => query.sql.includes("WHERE process_id = ANY($1::uuid[])"));
  assert.deepEqual(documents.params[0], [processId]);
});

test("filters are validated and passed to the query; open lines are the default", async t => {
  const { app, queries } = await linesApp(t);
  const invalid = await app.inject({ method: "GET", url: "/api/v1/purchase-order-lines?status=QUALQUER" });
  assert.equal(invalid.statusCode, 400, invalid.body);
  const filtered = await app.inject({ method: "GET",
    url: "/api/v1/purchase-order-lines?status=AGUARDANDO%20CHEGADA&ipNumber=IP-1&etaFrom=2026-10-01&etaTo=2026-10-31&page=2&pageSize=25" });
  assert.equal(filtered.statusCode, 200, filtered.body);
  const lines = queries.filter(query => query.sql.includes("line_kind")).at(-1);
  assert.ok(lines.params.includes("AGUARDANDO CHEGADA"));
  assert.ok(lines.params.includes("IP-1"));
  assert.ok(lines.params.includes("2026-10-01") && lines.params.includes("2026-10-31"));
  assert.ok(lines.params.includes("open"));
  assert.ok(lines.params.includes(25) && lines.params.includes(25));
  assert.deepEqual(shipmentLineStatuses, ["A DISTRIBUIR", "AGUARDANDO PRODUÇÃO", "AGUARDANDO EMBARQUE",
    "AGUARDANDO CHEGADA", "DESEMBARAÇO", "ENTREGUE", "CANCELADO"]);
});

test("the SQL status follows the same order of rules as the API calculation", () => {
  const sql = shipmentStatusSql("p", "l.item_id");
  const order = ["'CANCELADO'", "'ENTREGUE'", "'AGUARDANDO PRODUÇÃO'", "'AGUARDANDO EMBARQUE'",
    "'AGUARDANDO CHEGADA'", "'DESEMBARAÇO'"].map(status => sql.indexOf(status));
  assert.ok(order.every(index => index > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(sql, /p\.delivery_date IS NOT NULL/u);
  assert.match(sql, /p\.bl_date IS NULL/u);
  assert.match(sql, /document\.purchase_order_item_id = l\.item_id/u);
  assert.doesNotMatch(shipmentStatusSql("process", null), /purchase_order_item_id/u);
  assert.throws(() => shipmentStatusSql("p; DROP TABLE x", null));
  assert.throws(() => shipmentStatusSql("p", "1=1 OR x"));
});

test("the web status lists match the statuses the API calculates", async () => {
  const { processStatuses } = await import("../dist/shipment-lines.js");
  const { productLineStatuses } = await import("../../web/lib/purchase-order-lines.ts");
  const { processCalculatedStatuses } = await import("../../web/lib/ip-lifecycle.ts");
  assert.deepEqual([...productLineStatuses], [...shipmentLineStatuses]);
  assert.deepEqual([...processCalculatedStatuses], [...processStatuses]);
  const { e2eStageCodes } = await import("../../web/lib/purchase-order-lines.ts");
  const { E2E_STAGE_CODES } = await import("../dist/followup-calculations.js");
  assert.deepEqual([...e2eStageCodes], [...E2E_STAGE_CODES]);
});

// E2E stage filters. Dates far in the past or future keep "late" independent of the day the test runs.
const pastItem = { ...item, id: "00000000-0000-4000-8000-000000000052", necessityDate: "2020-12-01",
  commercialPlanReceivedDate: "2020-08-03", scApprovalDate: "2020-08-21", poSentDate: "2020-08-24", demandType: "MTS" };
const futureItem = { ...item, id: "00000000-0000-4000-8000-000000000053", necessityDate: "2099-12-01" };
const shipped = { importer: "ELETRA MATRIZ", transport_mode: "SEA", etd: "2020-09-28", bl_date: "2020-09-29",
  actual_port_departure_date: "2020-09-30", arrival_date: null, logistics_status: null };
const stageProcess = (id, ipNumber, extra = {}) => ({ id, ip_number: ipNumber, ...shipped, ...extra });
const allocation = (id, process) => ({ line_id: id, line_kind: "ALLOCATION", line_quantity: "1.00000000",
  factory_ship_date: null, line_status: "", purchase_order: purchaseOrder, item: pastItem, process });
const processIds = ["00000000-0000-4000-8000-000000000071", "00000000-0000-4000-8000-000000000072",
  "00000000-0000-4000-8000-000000000073"];
const stageRows = [
  // In T4 since 2020 (deadline 2020-11-24): late; T3 took 37 of 30 days (+7).
  allocation("00000000-0000-4000-8000-000000000061", stageProcess(processIds[0], "IP-SEA")),
  // Balance planned for 2099: in T0 and on time.
  { line_id: futureItem.id, line_kind: "BALANCE", line_quantity: "5.00000000", factory_ship_date: null,
    line_status: "A DISTRIBUIR", purchase_order: purchaseOrder, item: futureItem, process: null },
  // Delivered: out of the current stages, but it went through T3 (+7) and T4 (on time).
  allocation("00000000-0000-4000-8000-000000000062", stageProcess(processIds[1], "IP-DONE",
    { arrival_date: "2020-11-20", delivery_date: "2020-11-28" })),
  // Cancelled: never shown, even though it went through T3.
  allocation("00000000-0000-4000-8000-000000000063", stageProcess(processIds[2], "IP-CANCEL",
    { logistics_status: "CANCELLED" })),
];
const stageDocuments = processIds.map((processId, index) => ({ id: `00000000-0000-4000-8000-00000000008${index}`,
  process_id: processId, kind: "INVOICE", status: "ACTIVE", number: "INV", purchase_order_item_id: null }));
const ips = body => body.lines.map(line => line.process?.ipNumber ?? "saldo");

test("product lines filter by the current E2E stage or by the stages already reached", async t => {
  const { app, queries } = await linesApp(t, stageRows, stageDocuments);
  const get = async query => {
    const response = await app.inject({ method: "GET", url: `/api/v1/purchase-order-lines?situation=all&${query}` });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  const sea = (await get("stage=T4")).lines[0];
  assert.deepEqual([sea.calculated.e2e.currentStage, sea.calculated.e2e.currentStageLate], ["T4", true]);
  assert.equal(sea.calculated.e2e.stages.T3.accumulatedDelayDays, 7);
  assert.deepEqual(ips(await get("stage=T4")), ["IP-SEA"]);
  assert.deepEqual(ips(await get("stage=T0")), ["saldo"]);
  assert.deepEqual(ips(await get("stage=T0&late=true")), []);
  assert.deepEqual(ips(await get("late=true")), ["IP-SEA"]);
  // Reached = the stage has an actual date; a line still in that stage is not included.
  assert.deepEqual(ips(await get("view=reached&stage=T3")), ["IP-SEA", "IP-DONE"]);
  assert.deepEqual(ips(await get("view=reached&stage=T3&late=true")), ["IP-SEA", "IP-DONE"]);
  assert.deepEqual(ips(await get("view=reached&stage=T4")), ["IP-DONE"]);
  assert.deepEqual(ips(await get("view=reached&stage=T4&late=true")), []);
  // Filtering after the calculation loads every line and pages the filtered ones.
  const paged = await get("view=reached&stage=T3&page=2&pageSize=1");
  assert.deepEqual([paged.totalCount, ips(paged)], [2, ["IP-DONE"]]);
  assert.deepEqual(queries.filter(query => query.sql.includes("line_kind")).at(-1).params.slice(-2), [null, 0]);
  // Without stage or late filters the database still pages.
  await get("view=reached&page=2&pageSize=1");
  assert.deepEqual(queries.filter(query => query.sql.includes("line_kind")).at(-1).params.slice(-2), [1, 1]);
  for (const query of ["stage=T6", "view=all&stage=T3", "late=1"]) {
    const invalid = await app.inject({ method: "GET", url: `/api/v1/purchase-order-lines?${query}` });
    assert.equal(invalid.statusCode, 400, query);
  }
});

test("the E2E stage summary counts the lines in each stage and those that already passed it", async t => {
  const { app, queries } = await linesApp(t, stageRows, stageDocuments);
  const response = await app.inject({ method: "GET", url: "/api/v1/purchase-order-lines/e2e-stages?situation=all&ipNumber=IP" });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.deepEqual([body.totalCount, body.delivered], [3, 1]);
  assert.deepEqual(body.stages.T0, { current: 1, currentLate: 0, reached: 2, reachedLate: 0 });
  assert.deepEqual(body.stages.T3, { current: 0, currentLate: 0, reached: 2, reachedLate: 2 });
  assert.deepEqual(body.stages.T4, { current: 1, currentLate: 1, reached: 1, reachedLate: 0 });
  assert.deepEqual(body.stages.T5, { current: 0, currentLate: 0, reached: 1, reachedLate: 0 });
  assert.ok(queries.filter(query => query.sql.includes("line_kind")).at(-1).params.includes("IP"));
  const invalid = await app.inject({ method: "GET", url: "/api/v1/purchase-order-lines/e2e-stages?stage=T3" });
  assert.equal(invalid.statusCode, 400, invalid.body);
});
