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

async function linesApp(t) {
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("identity.erp_user AS u")) return { rows: [{ role: "Consulta", importer_code: "ELETRA MATRIZ" }] };
      if (sql.includes("line_kind")) {
        return { rows: [{ total_count: 2, items: [
          { line_id: allocationId, line_kind: "ALLOCATION", line_quantity: "60.00000000",
            factory_ship_date: "2026-08-20", line_status: "AGUARDANDO CHEGADA", purchase_order: purchaseOrder, item,
            process: { id: processId, ip_number: "IP-1", importer: "ELETRA MATRIZ", transport_mode: "SEA",
              etd: "2026-09-01", bl_number: "BL-1", bl_date: "2026-09-03", arrival_date: null, logistics_status: null,
              freight_cost: 1500, taxes_paid_brl: 900, demurrage_brl: 10 } },
          { line_id: itemId, line_kind: "BALANCE", line_quantity: "40.00000000",
            factory_ship_date: null, line_status: "A DISTRIBUIR", purchase_order: purchaseOrder, item, process: null },
        ] }] };
      }
      if (sql.includes("FROM imports.process_document")) {
        return { rows: [{ id: "00000000-0000-4000-8000-000000000045", process_id: processId, kind: "INVOICE",
          status: "ACTIVE", number: "INV-1", purchase_order_item_id: null }] };
      }
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
});
