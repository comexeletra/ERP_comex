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
  application_name: "purchase-order-restore-sc-hml-validation" });
const app = Fastify();
const runId = randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
const reason = "HML SC on new and restored PO validation";

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
const requesterName = requester.rows[0].value;

app.addHook("onRequest", async request => {
  request.authContext = { issuer: "hml-validation", subject: `restore-sc-${runId}`,
    userId: context.rows[0].id, displayName: "HML validation", sessionToken: "hml-validation" };
  request.authorizationContext = { roles: ["Master"], permissions: new Set([
    "purchase-orders.read", "purchase-orders.write", "purchase-orders.lifecycle.manage",
    "purchase-requests.read", "purchase-requests.write",
  ]), importerScopes: [importer] };
});
await registerFollowupRoutes(app, pool);
await registerOperationalRoutes(app, pool);
await registerPurchaseRequestRoutes(app, pool);
test.after(async () => { await app.close(); await pool.end(); });

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
async function createPo(number, newPurchaseRequest) {
  const created = await call("POST", "/api/v1/purchase-orders/complete", {
    header: { importer, number, supplierText, purchaseRequestId: null, orderDate: null, notes: "", reason,
      ...(newPurchaseRequest ? { newPurchaseRequest } : {}) },
    items: [{ base: { externalLineReference: "0001", productCode: product.rows[0].code, description: `HMLVAL ${runId}`,
      orderedQuantity: "1", unit: unit.rows[0].value, unitPrice: null, currency: null, reason }, fields: {} }],
  }, { "Idempotency-Key": `restore-sc-${number}` });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body;
}
async function assertLinked(poId, scId, scNumber) {
  const stored = await pool.query(
    `SELECT po.purchase_request_id::text AS sc_id, item.sc_number, item.requester, item.sc_date::text AS sc_date
     FROM procurement.purchase_order po JOIN procurement.purchase_order_item item ON item.purchase_order_id = po.id
     WHERE po.id = $1`, [poId]);
  assert.ok(stored.rows.length > 0);
  for (const row of stored.rows) {
    assert.equal(row.sc_id, scId);
    assert.equal(row.sc_number, scNumber);
    assert.equal(row.requester, requesterName);
    assert.equal(row.sc_date, "2026-10-01");
  }
  const list = await call("GET", `/api/v1/purchase-requests?importer=${encodeURIComponent(importer)}`);
  assert.ok(list.body.items.some(item => item.id === scId && item.purchaseOrderCount === 1), "the SC is listed in the PCM");
}
async function deletePoAndSc(poId, scId) {
  const deletedPo = await call("DELETE", `/api/v1/purchase-orders/${poId}`, { reason }, { "X-Record-Version": await poVersion(poId) });
  assert.equal(deletedPo.status, 200, JSON.stringify(deletedPo.body));
  const deletedSc = await call("DELETE", `/api/v1/purchase-requests/${scId}`, { reason }, { "If-Match": '"1"' });
  assert.equal(deletedSc.status, 204, JSON.stringify(deletedSc.body));
}
const newRequest = scNumber => ({ scNumber, requester: requesterName, scDate: "2026-10-01", approvalDate: null,
  commercialPlanReceivedDate: null });

test("HML creates the spreadsheet SC together with a new PO", async () => {
  const before = await counts();
  const poNumber = `HMLVAL-PO-NEWSC-${runId}`;
  const scNumber = `HMLVAL-SC-NEW-${runId}`;
  const created = await createPo(poNumber, newRequest(scNumber));
  assert.ok(created.purchaseRequestId);
  await assertLinked(created.id, created.purchaseRequestId, scNumber);
  await deletePoAndSc(created.id, created.purchaseRequestId);
  const after = await counts();
  assert.equal(after.purchase_requests, before.purchase_requests);
  assert.equal(after.purchase_orders, before.purchase_orders + 1);
  console.log(`Validated new PO ${poNumber} with SC ${scNumber}; PO retained as DELETED and SC deleted.`);
});

test("HML links the spreadsheet SC when a deleted PO is restored or replaced", async () => {
  const before = await counts();
  const poNumber = `HMLVAL-PO-RESTSC-${runId}`;
  const created = await createPo(poNumber, null);
  const poId = created.id;
  const deleted = await call("DELETE", `/api/v1/purchase-orders/${poId}`, { reason }, { "X-Record-Version": await poVersion(poId) });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));

  const restoreSc = `HMLVAL-SC-REST-${runId}`;
  const restored = await call("POST", `/api/v1/purchase-orders/${poId}/restore`,
    { reason, purchaseRequest: { newPurchaseRequest: newRequest(restoreSc) } }, { "X-Record-Version": await poVersion(poId) });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.lifecycleStatus, "ACTIVE");
  assert.equal(restored.body.purchaseRequestCreated, true);
  await assertLinked(poId, restored.body.purchaseRequestId, restoreSc);
  const page = await call("GET", `/api/v1/purchase-orders/${poId}/operational`);
  assert.equal(page.status, 200, JSON.stringify(page.body));
  assert.ok(page.body.createdAt);
  assert.equal(page.body.lastRestore?.reason, reason);
  assert.ok(new Date(page.body.lastRestore.at) >= new Date(page.body.createdAt));
  await deletePoAndSc(poId, restored.body.purchaseRequestId);

  const replaceSc = `HMLVAL-SC-REPL-${runId}`;
  const replaced = await call("POST", `/api/v1/purchase-orders/${poId}/replace`, {
    header: { number: poNumber, supplierCode: supplierText }, fileName: `HMLVAL ${runId}.xlsx`,
    fileSha256: "d".repeat(64), currency: "USD", reason,
    items: [{ externalLineReference: "0001", productCode: product.rows[0].code, description: `HMLVAL ${runId}`,
      orderedQuantity: "2", unitPrice: "1", unit: unit.rows[0].value, costCenter: null }],
    purchaseRequest: { newPurchaseRequest: newRequest(replaceSc) },
  }, { "X-Record-Version": await poVersion(poId) });
  assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
  assert.equal(replaced.body.purchaseRequestCreated, true);
  await assertLinked(poId, replaced.body.purchaseRequestId, replaceSc);
  await deletePoAndSc(poId, replaced.body.purchaseRequestId);

  const after = await counts();
  assert.equal(after.purchase_requests, before.purchase_requests);
  assert.equal(after.purchase_orders, before.purchase_orders + 1);
  console.log(`Validated restore and replace of ${poNumber} with SCs ${restoreSc} and ${replaceSc}; PO retained as DELETED and SCs deleted.`);
});
