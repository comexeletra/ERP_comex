import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { Pool } from "pg";
import { registerFollowupRoutes } from "../dist/followup.js";
import { registerOperationalRoutes } from "../dist/operations.js";
import { registerProcessReadRoutes } from "../dist/processes.js";
import { registerShipmentLineRoutes, shipmentLineStatuses } from "../dist/shipment-lines.js";

const databaseUrl = process.env.DATABASE_URL;
if (process.env.MIGRATION_ENV !== "isolated" || !databaseUrl
  || new URL(databaseUrl).pathname !== "/erp_po_totvs_hml") {
  throw new Error("Use MIGRATION_ENV=isolated with DATABASE_URL targeting only erp_po_totvs_hml.");
}

const pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5_000,
  application_name: "post-shipment-propagation-hml-validation" });
const app = Fastify();
const runId = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
const reason = "HML post-shipment propagation validation";

app.decorateRequest("authContext", null);
app.decorateRequest("authorizationContext", null);

const target = await pool.query("SELECT current_database() AS database, current_user AS role");
if (target.rows[0]?.database !== "erp_po_totvs_hml" || target.rows[0]?.role !== "import_erp_hml_app") {
  await pool.end();
  throw new Error("The HML integration requires erp_po_totvs_hml with role import_erp_hml_app.");
}
const context = await pool.query("SELECT id FROM identity.erp_user ORDER BY id LIMIT 1");
const source = await pool.query(
  `SELECT po.importer, po.supplier_text FROM procurement.purchase_order po
   WHERE EXISTS (SELECT 1 FROM catalog.operational_value importer
       WHERE importer.entity_key = 'IMPORTER' AND importer.value = po.importer
         AND importer.cnpj ~ '^[0-9]{2}[.][0-9]{3}[.][0-9]{3}/[0-9]{4}-[0-9]{2}$')
     AND EXISTS (SELECT 1 FROM catalog.entry supplier
       WHERE supplier.kind = 'SUPPLIER' AND supplier.importer IS NULL AND supplier.status = 'ACTIVE'
         AND supplier.normalized_code = upper(btrim(po.supplier_text)))
   ORDER BY po.lifecycle_status = 'ACTIVE' DESC, po.external_number LIMIT 1`);
const product = await pool.query(
  "SELECT code FROM catalog.entry WHERE kind = 'PRODUCT' AND importer IS NULL AND status = 'ACTIVE' ORDER BY normalized_code LIMIT 1");
const unit = await pool.query(
  "SELECT value FROM catalog.operational_value WHERE entity_key = 'UNIT_OF_MEASURE' ORDER BY normalized_value LIMIT 1");
if (!context.rows[0] || !source.rows[0] || !product.rows[0] || !unit.rows[0]) {
  await pool.end();
  throw new Error("HML lacks an actor, eligible importer/supplier, product or unit.");
}
const { importer, supplier_text: supplierText } = source.rows[0];

app.addHook("onRequest", async request => {
  request.authContext = { issuer: "hml-validation", subject: `post-shipment-${runId}`,
    userId: context.rows[0].id, displayName: "HML validation", sessionToken: "hml-validation" };
  request.authorizationContext = { roles: ["Master"], permissions: new Set([
    "purchase-orders.read", "purchase-orders.write", "purchase-orders.lifecycle.manage",
    "processes.read", "processes.write", "processes.lifecycle.manage",
  ]), importerScopes: [importer] };
});
await registerFollowupRoutes(app, pool);
await registerOperationalRoutes(app, pool);
await registerProcessReadRoutes(app, pool);
await registerShipmentLineRoutes(app, pool);

async function call(method, url, payload, headers = {}) {
  const response = await app.inject({ method, url, headers: { "content-type": "application/json", ...headers }, payload });
  return { status: response.statusCode, body: response.statusCode === 204 ? null : response.json() };
}
const key = name => ({ "Idempotency-Key": `post-shipment-${runId}-${name}` });
async function version(table, id) {
  return (await pool.query(`SELECT version::text AS version FROM ${table} WHERE id = $1`, [id])).rows[0]?.version;
}
async function createPo(suffix, quantity) {
  const created = await call("POST", "/api/v1/purchase-orders/complete", {
    header: { importer, number: `HMLVAL-PO-SHIP${suffix}-${runId}`, supplierText, orderDate: null, notes: "", reason },
    items: [{ base: { externalLineReference: "0001", productCode: product.rows[0].code, description: `HMLVAL ${runId}`,
      orderedQuantity: quantity, unit: unit.rows[0].value, unitPrice: "2.5", currency: "USD", reason }, fields: {} }],
  }, key(`po-${suffix}`));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return { id: created.body.id, itemId: created.body.itemIds[0] };
}
async function createIp(suffix) {
  const created = await call("POST", "/api/v1/processes", { importer, ipNumber: `HMLVAL-IP-SHIP${suffix}-${runId}`,
    supplierText, logisticsStatus: null, priority: null, notes: "Synthetic post-shipment validation.", reason },
  key(`ip-${suffix}`));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.id;
}
async function allocate(po, processId, quantity, name) {
  const created = await call("POST", `/api/v1/purchase-orders/${po.id}/allocations`,
    { itemId: po.itemId, processId, quantity, notes: "", reason }, key(`allocation-${name}`));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.id;
}
async function updateIp(processId, fields, expected = 200) {
  const response = await call("PATCH", `/api/v1/processes/${processId}/followup`, { fields, reason },
    { "X-Record-Version": await version("imports.import_process", processId) });
  assert.equal(response.status, expected, JSON.stringify(response.body));
  return response.body;
}
async function shipments(po) {
  const response = await call("GET", `/api/v1/purchase-orders/${po.id}/followup`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.shipments;
}

test("HML propagates each IP's post-shipment data to the product shares inside it", async t => {
  t.after(async () => { await app.close(); await pool.end(); });
  const created = { pos: [], ips: [], allocations: [], documents: [] };
  try {
    const poA = await createPo("A", "100"); created.pos.push(poA);
    const poB = await createPo("B", "50"); created.pos.push(poB);
    const ip1 = await createIp("1"); created.ips.push(ip1);
    const ip2 = await createIp("2"); created.ips.push(ip2);
    const a1 = await allocate(poA, ip1, "60", "a1");
    const a2 = await allocate(poA, ip2, "40", "a2");
    const b1 = await allocate(poB, ip1, "50", "b1");
    created.allocations.push({ po: poA, id: a1, processId: ip1 }, { po: poA, id: a2, processId: ip2 },
      { po: poB, id: b1, processId: ip1 });
    const invoice = await call("POST", `/api/v1/processes/${ip1}/documents`, { kind: "INVOICE", number: `HMLVAL-INV-${runId}`,
      purchaseOrderItemId: null, issueDate: null, homologationDate: null, quantity: null, unitPrice: null, amount: null,
      currencyCode: null, notes: "", reason }, key("invoice"));
    assert.equal(invoice.status, 201, JSON.stringify(invoice.body));
    created.documents.push({ processId: ip1, id: invoice.body.id });
    const itemsBefore = (await pool.query(`SELECT id, updated_at FROM procurement.purchase_order_item
      WHERE id = ANY($1::uuid[]) ORDER BY id`, [[poA.itemId, poB.itemId]])).rows;

    await updateIp(ip1, { transportMode: "SEA", etd: "2026-09-01", blNumber: `HMLVAL-BL-${runId}`, blDate: "2026-09-03" });
    await updateIp(ip2, { transportMode: "AIR", etd: "2026-10-10" });

    const [aShipments, bShipments] = [await shipments(poA), await shipments(poB)];
    const aIp1 = aShipments.find(entry => entry.process.id === ip1);
    const aIp2 = aShipments.find(entry => entry.process.id === ip2);
    const bIp1 = bShipments.find(entry => entry.process.id === ip1);
    assert.equal(aIp1.allocationQuantity, "60.00000000");
    assert.equal(bIp1.allocationQuantity, "50.00000000");
    for (const shipment of [aIp1, bIp1]) {
      assert.equal(shipment.process.blDate, "2026-09-03");
      assert.equal(shipment.calculated.billNumber, `HMLVAL-BL-${runId}`);
      assert.equal(shipment.calculated.eta, "2026-10-26");
      assert.equal(shipment.calculated.status, "AGUARDANDO CHEGADA");
    }
    assert.equal(aIp2.process.blDate, null);
    assert.equal(aIp2.calculated.eta, "2026-10-20");
    assert.equal(aIp2.calculated.status, "AGUARDANDO PRODUÇÃO");

    await updateIp(ip1, { etaConfirmed: "2026-10-30" });
    assert.equal((await shipments(poA)).find(entry => entry.process.id === ip1).calculated.eta, "2026-10-30");
    assert.equal((await shipments(poB)).find(entry => entry.process.id === ip1).calculated.eta, "2026-10-30");
    const itemsAfter = (await pool.query(`SELECT id, updated_at FROM procurement.purchase_order_item
      WHERE id = ANY($1::uuid[]) ORDER BY id`, [[poA.itemId, poB.itemId]])).rows;
    assert.deepEqual(itemsAfter, itemsBefore, "editing the IP must not write the PO items");

    await updateIp(ip1, { actualPortDepartureDate: "2026-09-04" });
    const rejected = await updateIp(ip1, { arrivalDate: "2026-09-02" }, 400);
    assert.equal(rejected.code, "IP_DATE_SEQUENCE_INVALID");

    const blocked = await call("PATCH", `/api/v1/purchase-orders/${poA.id}/allocations/${a1}`,
      { quantity: "50", reason }, { "X-Record-Version": await version("procurement.po_item_allocation", a1) });
    assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
    assert.equal(blocked.body.code, "IP_ALREADY_SHIPPED_UNCONFIRMED");
    const confirmed = await call("PATCH", `/api/v1/purchase-orders/${poA.id}/allocations/${a1}`,
      { quantity: "50", reason: "Parte da carga ficou para o próximo embarque", confirmShippedChange: true },
      { "X-Record-Version": await version("procurement.po_item_allocation", a1) });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));

    const purchaseOrder = `HMLVAL-PO-SHIP`;
    const lines = await call("GET", `/api/v1/purchase-order-lines?purchaseOrder=${purchaseOrder}&product=${encodeURIComponent(`HMLVAL ${runId}`)}&situation=all&pageSize=200`);
    assert.equal(lines.status, 200, JSON.stringify(lines.body));
    const ours = lines.body.lines.filter(line => line.item.description === `HMLVAL ${runId}`);
    assert.deepEqual(ours.map(line => [line.purchaseOrder.number.slice(0, 15), line.lineKind, line.quantity,
      line.process?.id ?? null, line.calculated.status]).sort(), [
      ["HMLVAL-PO-SHIPA", "ALLOCATION", "40.00000000", ip2, "AGUARDANDO PRODUÇÃO"],
      ["HMLVAL-PO-SHIPA", "ALLOCATION", "50.00000000", ip1, "AGUARDANDO CHEGADA"],
      ["HMLVAL-PO-SHIPA", "BALANCE", "10.00000000", null, "A DISTRIBUIR"],
      ["HMLVAL-PO-SHIPB", "ALLOCATION", "50.00000000", ip1, "AGUARDANDO CHEGADA"],
    ].sort());
    for (const line of ours.filter(entry => entry.process)) {
      for (const cost of ["freightCost", "taxesPaidBrl", "demurrageBrl"]) assert.equal(cost in line.process, false);
    }
    // The SQL status used by the filter must select exactly the lines the API labels with that status.
    for (const status of shipmentLineStatuses) {
      const filtered = await call("GET", `/api/v1/purchase-order-lines?purchaseOrder=${purchaseOrder}&product=${encodeURIComponent(`HMLVAL ${runId}`)}&situation=all&pageSize=200&status=${encodeURIComponent(status)}`);
      assert.equal(filtered.status, 200, JSON.stringify(filtered.body));
      const mine = filtered.body.lines.filter(line => line.item.description === `HMLVAL ${runId}`);
      assert.deepEqual(mine.map(line => line.calculated.status).filter(value => value !== status), [], status);
      assert.equal(mine.length, ours.filter(line => line.calculated.status === status).length, status);
    }

    await updateIp(ip1, { arrivalDate: "2026-10-28", deliveryDate: "2026-11-05" });
    assert.equal((await shipments(poB)).find(entry => entry.process.id === ip1).calculated.status, "ENTREGUE");
    const ipFollowup = await call("GET", `/api/v1/processes/${ip1}/followup`);
    assert.equal(ipFollowup.body.calculated.status, "ENTREGUE");
    const listed = await call("GET", `/api/v1/processes?ipNumber=HMLVAL-IP-SHIP1-${runId}&status=ENTREGUE`);
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    assert.deepEqual(listed.body.items.map(item => [item.id, item.calculatedStatus, item.shipped]), [[ip1, "ENTREGUE", true]]);

    console.log(`Validated post-shipment propagation with run ${runId}.`);
  } finally {
    for (const allocation of created.allocations) {
      const current = await version("procurement.po_item_allocation", allocation.id);
      const active = (await pool.query("SELECT status FROM procurement.po_item_allocation WHERE id = $1", [allocation.id])).rows[0];
      if (!current || active?.status !== "ACTIVE") continue;
      const cancelled = await call("DELETE", `/api/v1/purchase-orders/${allocation.po.id}/allocations/${allocation.id}`,
        { reason: `${reason}: cleanup`, confirmShippedChange: true }, { "X-Record-Version": current });
      assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    }
    for (const document of created.documents) {
      const cancelled = await call("DELETE", `/api/v1/processes/${document.processId}/documents/${document.id}`,
        { reason: `${reason}: cleanup` }, { "X-Record-Version": await version("imports.process_document", document.id) });
      assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    }
    for (const processId of created.ips) {
      const deleted = await call("DELETE", `/api/v1/processes/${processId}`, { reason: `${reason}: cleanup` },
        { "X-Record-Version": await version("imports.import_process", processId) });
      assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    }
    for (const po of created.pos) {
      const deleted = await call("DELETE", `/api/v1/purchase-orders/${po.id}`, { reason: `${reason}: cleanup` },
        { "X-Record-Version": await version("procurement.purchase_order", po.id) });
      assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    }
  }
});
