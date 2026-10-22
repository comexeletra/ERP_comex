import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { Pool } from "pg";
import { registerFollowupRoutes } from "../dist/followup.js";
import { registerOperationalRoutes } from "../dist/operations.js";
import { registerPurchaseRequestRoutes } from "../dist/purchase-requests.js";

const databaseUrl = process.env.DATABASE_URL;
if (process.env.MIGRATION_ENV !== "isolated" || !databaseUrl
  || new URL(databaseUrl).pathname !== "/erp_po_totvs_hml") {
  throw new Error("Use MIGRATION_ENV=isolated with DATABASE_URL targeting only erp_po_totvs_hml.");
}

const pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5_000,
  application_name: "purchase-order-sc-link-hml-validation" });
const app = Fastify();
const runId = randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
const poNumber = `HMLVAL-PO-SCLINK-${runId}`;
const scNumber = `HMLVAL-SC-LINK-${runId}`;
const reason = "HML SC link validation";

app.decorateRequest("authContext", null);
app.decorateRequest("authorizationContext", null);

const target = await pool.query("SELECT current_database() AS database");
if (target.rows[0]?.database !== "erp_po_totvs_hml") {
  await pool.end();
  throw new Error("The HML integration requires erp_po_totvs_hml.");
}
const context = await pool.query("SELECT id FROM identity.erp_user LIMIT 1");
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
const requester = await pool.query(
  "SELECT value FROM catalog.operational_value WHERE entity_key = 'REQUESTER' ORDER BY normalized_value LIMIT 1");
if (!context.rows[0] || !source.rows[0] || !product.rows[0] || !unit.rows[0] || !requester.rows[0]) {
  await pool.end();
  throw new Error("HML lacks an actor, eligible importer/supplier, product, unit or requester.");
}
const { importer, supplier_text: supplierText } = source.rows[0];

app.addHook("onRequest", async request => {
  request.authContext = { issuer: "hml-validation", subject: `sc-link-${runId}`,
    userId: context.rows[0].id, displayName: "HML validation", sessionToken: "hml-validation" };
  request.authorizationContext = { roles: ["Compras"], permissions: new Set([
    "purchase-orders.read", "purchase-orders.write", "purchase-requests.read", "purchase-requests.write",
  ]), importerScopes: [importer] };
});
await registerFollowupRoutes(app, pool);
await registerOperationalRoutes(app, pool);
await registerPurchaseRequestRoutes(app, pool);

async function call(method, url, payload, headers = {}) {
  const response = await app.inject({ method, url, headers: { "content-type": "application/json", ...headers }, payload });
  return { status: response.statusCode, body: response.statusCode === 204 ? null : response.json() };
}
async function counts() {
  return (await pool.query(
    `SELECT (SELECT count(*)::int FROM procurement.purchase_request) AS purchase_requests,
            (SELECT count(*)::int FROM procurement.purchase_order) AS purchase_orders,
            (SELECT count(*)::int FROM procurement.purchase_order_item) AS items`)).rows[0];
}
async function poVersion(id) {
  return (await pool.query("SELECT version::text AS version FROM procurement.purchase_order WHERE id = $1", [id])).rows[0].version;
}

test("HML creates the SC of an existing PO, links it and copies it to the items", async t => {
  t.after(async () => { await app.close(); await pool.end(); });
  const before = await counts();
  const created = await call("POST", "/api/v1/purchase-orders/complete", {
    header: { importer, number: poNumber, supplierText, purchaseRequestId: null, orderDate: null, notes: "", reason },
    items: [{ base: { externalLineReference: "0001", productCode: product.rows[0].code, description: `HMLVAL ${runId}`,
      orderedQuantity: "1", unit: unit.rows[0].value, unitPrice: null, currency: null, reason }, fields: {} }],
  }, { "Idempotency-Key": `sc-link-create-${runId}` });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const poId = created.body.id;

  const linked = await call("POST", `/api/v1/purchase-orders/${poId}/purchase-request`, { scNumber,
    requester: requester.rows[0].value, scDate: "2026-10-01", approvalDate: null, commercialPlanReceivedDate: null, reason },
  { "X-Record-Version": await poVersion(poId) });
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  assert.equal(linked.body.created, true);
  const scId = linked.body.purchaseRequestId;

  const stored = await pool.query(
    `SELECT po.purchase_request_id::text AS sc_id, item.sc_number, item.requester, item.sc_date::text AS sc_date
     FROM procurement.purchase_order po JOIN procurement.purchase_order_item item ON item.purchase_order_id = po.id
     WHERE po.id = $1`, [poId]);
  assert.equal(stored.rows[0].sc_id, scId);
  assert.equal(stored.rows[0].sc_number, scNumber);
  assert.equal(stored.rows[0].requester, requester.rows[0].value);
  assert.equal(stored.rows[0].sc_date, "2026-10-01");
  const list = await call("GET", `/api/v1/purchase-requests?importer=${encodeURIComponent(importer)}`);
  assert.ok(list.body.items.some(item => item.id === scId && item.purchaseOrderCount === 1));

  const again = await call("POST", `/api/v1/purchase-orders/${poId}/purchase-request`, { scNumber,
    requester: requester.rows[0].value, scDate: null, approvalDate: null, commercialPlanReceivedDate: null, reason },
  { "X-Record-Version": await poVersion(poId) });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "PO_ALREADY_HAS_PURCHASE_REQUEST");

  const deletedPo = await call("DELETE", `/api/v1/purchase-orders/${poId}`, { reason }, { "X-Record-Version": await poVersion(poId) });
  assert.equal(deletedPo.status, 200, JSON.stringify(deletedPo.body));
  const deletedSc = await call("DELETE", `/api/v1/purchase-requests/${scId}`, { reason }, { "If-Match": '"1"' });
  assert.equal(deletedSc.status, 204, JSON.stringify(deletedSc.body));
  const after = await counts();
  assert.equal(after.purchase_requests, before.purchase_requests);
  assert.equal(after.purchase_orders, before.purchase_orders + 1);
  assert.equal(after.items, before.items + 1);
  console.log(`Validated HML SC link ${scNumber} on ${poNumber}; PO retained as DELETED and SC deleted.`);
});
