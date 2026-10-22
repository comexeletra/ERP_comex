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
  application_name: "purchase-order-sc-sync-hml-validation" });
const app = Fastify();
const runId = randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
const scNumber = `HMLVAL-SC-SYNC-${runId}`;
const reason = "HML SC sync from PO validation";

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
  request.authContext = { issuer: "hml-validation", subject: `sc-sync-${runId}`,
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
            (SELECT count(*)::int FROM procurement.purchase_order) AS purchase_orders`)).rows[0];
}
async function poVersion(id) {
  return (await pool.query("SELECT version::text AS version FROM procurement.purchase_order WHERE id = $1", [id])).rows[0].version;
}
async function createPo(suffix, header) {
  const created = await call("POST", "/api/v1/purchase-orders/complete", {
    header: { importer, number: `HMLVAL-PO-SYNC${suffix}-${runId}`, supplierText, orderDate: null, notes: "", reason, ...header },
    items: [{ base: { externalLineReference: "0001", productCode: product.rows[0].code, description: `HMLVAL ${runId}`,
      orderedQuantity: "1", unit: unit.rows[0].value, unitPrice: null, currency: null, reason }, fields: {} }],
  }, { "Idempotency-Key": `sc-sync-${suffix}-${runId}` });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body;
}
async function itemValues(poId) {
  return (await pool.query(
    `SELECT sc_date::text AS sc_date, sc_approval_date::text AS approval_date, requester
     FROM procurement.purchase_order_item WHERE purchase_order_id = $1`, [poId])).rows;
}

test("HML updates the SC in the PCM when its fields are applied on a PO", async t => {
  t.after(async () => { await app.close(); await pool.end(); });
  const before = await counts();
  const first = await createPo("A", { purchaseRequestId: null, newPurchaseRequest: { scNumber,
    requester: requester.rows[0].value, scDate: null, approvalDate: null, commercialPlanReceivedDate: null } });
  const scId = first.purchaseRequestId;
  const second = await createPo("B", { purchaseRequestId: scId });

  const applied = await call("PATCH", `/api/v1/purchase-orders/${first.id}/items/followup`, {
    itemIds: first.itemIds, fields: { scDate: "2026-10-01", scApprovalDate: "2026-10-05" }, reason,
  }, { "X-Record-Version": await poVersion(first.id) });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  assert.equal(applied.body.purchaseRequestUpdated, true);

  const sc = (await pool.query(
    `SELECT sc_date::text AS sc_date, approval_date::text AS approval_date, version::text AS version
     FROM procurement.purchase_request WHERE id = $1`, [scId])).rows[0];
  assert.deepEqual([sc.sc_date, sc.approval_date], ["2026-10-01", "2026-10-05"]);
  for (const poId of [first.id, second.id]) {
    for (const row of await itemValues(poId)) {
      assert.deepEqual([row.sc_date, row.approval_date], ["2026-10-01", "2026-10-05"], poId);
    }
  }
  const history = await pool.query(
    `SELECT count(*)::int AS updates FROM audit.purchase_request_history
     WHERE aggregate_id = $1 AND operation = 'UPDATE'`, [scId]);
  assert.equal(history.rows[0].updates, 1);

  const locked = await call("PATCH", `/api/v1/purchase-orders/${first.id}/items/followup`, {
    itemIds: first.itemIds, fields: { scNumber: `${scNumber}-X` }, reason,
  }, { "X-Record-Version": await poVersion(first.id) });
  assert.equal(locked.status, 409);
  assert.equal(locked.body.code, "PURCHASE_REQUEST_NUMBER_LOCKED");

  for (const poId of [first.id, second.id]) {
    const deleted = await call("DELETE", `/api/v1/purchase-orders/${poId}`, { reason }, { "X-Record-Version": await poVersion(poId) });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  }
  const deletedSc = await call("DELETE", `/api/v1/purchase-requests/${scId}`, { reason }, { "If-Match": `"${sc.version}"` });
  assert.equal(deletedSc.status, 204, JSON.stringify(deletedSc.body));
  const after = await counts();
  assert.equal(after.purchase_requests, before.purchase_requests);
  assert.equal(after.purchase_orders, before.purchase_orders + 2);
  console.log(`Validated SC ${scNumber} sync from PO; both POs retained as DELETED and SC deleted.`);
});
