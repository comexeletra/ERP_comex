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

const importerScope = process.env.HML_TEST_IMPORTER;
const pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5_000,
  application_name: "purchase-request-hml-validation" });
const app = Fastify();
const runId = randomUUID().replaceAll("-", "").toUpperCase();
const scNumber = `HMLVAL-SC-M066-${runId}`;
const poNumber = `HMLVAL-PO-M066-${runId}`;
let createdPoId;
let createdScId;

app.decorateRequest("authContext", null);
app.decorateRequest("authorizationContext", null);

const target = await pool.query(
  "SELECT current_database() AS database, max(version) AS latest FROM migration.schema_migration");
if (target.rows[0]?.database !== "erp_po_totvs_hml"
  || target.rows[0]?.latest !== "M066_purchase_request_delete.sql") {
  await pool.end();
  throw new Error("The HML integration requires erp_po_totvs_hml at M066.");
}

const context = await pool.query("SELECT id FROM identity.erp_user LIMIT 1");
if (!context.rows[0]) {
  await pool.end();
  throw new Error("HML has no test actor in identity.erp_user.");
}
const source = await pool.query(
  `SELECT po.importer, po.supplier_text, item.product_code, item.unit,
          (SELECT value FROM catalog.operational_value WHERE entity_key = 'REQUESTER' ORDER BY normalized_value LIMIT 1) AS requester
   FROM procurement.purchase_order po
   JOIN procurement.purchase_order_item item ON item.purchase_order_id = po.id
   JOIN catalog.entry product ON product.kind = 'PRODUCT' AND product.importer IS NULL
     AND product.status = 'ACTIVE' AND product.normalized_code = upper(btrim(item.product_code))
   JOIN catalog.operational_value unit ON unit.entity_key = 'UNIT_OF_MEASURE'
     AND unit.normalized_value = upper(btrim(item.unit))
   WHERE po.lifecycle_status = 'ACTIVE'
     AND EXISTS (SELECT 1 FROM catalog.operational_value importer
       WHERE importer.entity_key = 'IMPORTER' AND importer.value = po.importer
         AND importer.cnpj ~ '^[0-9]{2}[.][0-9]{3}[.][0-9]{3}/[0-9]{4}-[0-9]{2}$')
     AND EXISTS (SELECT 1 FROM catalog.entry supplier
       WHERE supplier.kind = 'SUPPLIER' AND supplier.importer IS NULL AND supplier.status = 'ACTIVE'
         AND supplier.normalized_code = upper(btrim(po.supplier_text)))
     AND ($1::text IS NULL OR po.importer = $1)
   ORDER BY po.external_number, item.line_number
   LIMIT 1`, [importerScope ?? null]);
if (!source.rows[0]) {
  await pool.end();
  throw new Error("HML has no active PO with an eligible importer, supplier, product and unit.");
}
const { importer, supplier_text: supplierText, product_code: productCode, unit, requester } = source.rows[0];
if (!requester) {
  await pool.end();
  throw new Error("HML has no requester value for SC validation.");
}

app.addHook("onRequest", async request => {
  request.authContext = { issuer: "hml-validation", subject: `m066-${runId}`,
    userId: context.rows[0].id, displayName: "HML validation", sessionToken: "hml-validation" };
  request.authorizationContext = { roles: ["PCM"], permissions: new Set([
    "purchase-orders.write", "purchase-requests.write", "purchase-requests.read",
  ]), importerScopes: [importer] };
});

await registerFollowupRoutes(app, pool);
await registerOperationalRoutes(app, pool);
await registerPurchaseRequestRoutes(app, pool);

async function call(method, url, payload, headers = {}) {
  const response = await app.inject({ method, url,
    headers: { "content-type": "application/json", ...headers }, payload });
  return { status: response.statusCode, body: response.statusCode === 204 ? null : response.json() };
}

async function counts() {
  const result = await pool.query(
    `SELECT (SELECT count(*)::int FROM procurement.purchase_request) AS purchase_requests,
            (SELECT count(*)::int FROM procurement.purchase_order) AS purchase_orders,
            (SELECT count(*)::int FROM procurement.purchase_order_item) AS items,
            (SELECT count(*)::int FROM procurement.po_item_allocation) AS allocations,
            (SELECT count(*)::int FROM audit.audit_log) AS audit_events,
            (SELECT count(*)::int FROM audit.outbox_message) AS outbox_messages`);
  return result.rows[0];
}

test("M066 HML flow creates, blocks, unlinks and deletes an SC, then releases its number", async t => {
  t.after(async () => { await app.close(); await pool.end(); });
  const before = await counts();
  const created = await call("POST", "/api/v1/purchase-orders/complete", {
    header: { importer, number: poNumber, supplierText, purchaseRequestId: null,
      newPurchaseRequest: { scNumber, requester, scDate: null,
        approvalDate: null, commercialPlanReceivedDate: null }, orderDate: null, notes: "",
      reason: "HML M066 validation" },
    items: [{ base: { externalLineReference: null, productCode, description: `HMLVAL ${runId}`,
      orderedQuantity: "1", unit, unitPrice: null, currency: null, reason: "HML M066 validation" }, fields: {} }],
  }, { "Idempotency-Key": `m066-create-${runId}` });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  createdPoId = created.body.id;
  createdScId = created.body.purchaseRequestId;
  assert.ok(createdPoId);
  assert.ok(createdScId);

  const scList = await call("GET", `/api/v1/purchase-requests?importer=${encodeURIComponent(importer)}`);
  assert.equal(scList.status, 200);
  assert.ok(scList.body.items.some(item => item.id === createdScId && item.scNumber === scNumber));

  const blocked = await call("DELETE", `/api/v1/purchase-requests/${createdScId}`, { reason: "HML validation" },
    { "If-Match": '"1"' });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
  assert.equal(blocked.body.code, "PURCHASE_REQUEST_IN_USE");
  assert.match(blocked.body.detail, new RegExp(poNumber, "u"));

  const deletedPo = await call("DELETE", `/api/v1/purchase-orders/${createdPoId}`,
    { reason: "HML M066 validation" }, { "If-Match": '"1"' });
  assert.equal(deletedPo.status, 200, JSON.stringify(deletedPo.body));

  const deletedSc = await call("DELETE", `/api/v1/purchase-requests/${createdScId}`,
    { reason: "HML M066 validation" }, { "If-Match": '"1"' });
  assert.equal(deletedSc.status, 204, JSON.stringify(deletedSc.body));

  const history = await call("GET", `/api/v1/purchase-requests/${createdScId}/history`);
  assert.equal(history.status, 200, JSON.stringify(history.body));
  assert.ok(history.body.items.some(item => item.operation === "DELETE"
    && item.oldValue?.scNumber === scNumber && item.reason === "HML M066 validation"));

  const recreated = await call("POST", "/api/v1/purchase-requests", {
    importer, scNumber, supplierText, scDate: null, commercialPlanReceivedDate: null,
    requester, approvalDate: null, reason: "HML number release validation",
  }, { "Idempotency-Key": `m066-recreate-${runId}` });
  assert.equal(recreated.status, 201, JSON.stringify(recreated.body));
  const recreatedId = recreated.body.id;
  const cleanedRecreation = await call("DELETE", `/api/v1/purchase-requests/${recreatedId}`,
    { reason: "HML number release validation" }, { "If-Match": '"1"' });
  assert.equal(cleanedRecreation.status, 204, JSON.stringify(cleanedRecreation.body));

  const stored = await pool.query(
    `SELECT lifecycle_status, purchase_request_id FROM procurement.purchase_order WHERE id = $1`, [createdPoId]);
  assert.equal(stored.rows[0]?.lifecycle_status, "DELETED");
  assert.equal(stored.rows[0]?.purchase_request_id, null);
  const missingSc = await pool.query(
    `SELECT id FROM procurement.purchase_request WHERE importer = $1 AND normalized_sc_number = upper(btrim($2))`,
    [importer, scNumber]);
  assert.equal(missingSc.rowCount, 0);

  const eventCounts = await pool.query(
    `SELECT (SELECT count(*)::int FROM audit.audit_log WHERE aggregate_id = ANY($1::uuid[])) AS audit_events,
            (SELECT count(*)::int FROM audit.outbox_message WHERE aggregate_id = ANY($1::uuid[])) AS outbox_messages`,
    [[createdPoId, createdScId, recreatedId]]);
  assert.ok(eventCounts.rows[0].audit_events >= 7);
  assert.equal(eventCounts.rows[0].outbox_messages, eventCounts.rows[0].audit_events);

  const after = await counts();
  assert.equal(after.purchase_requests, before.purchase_requests);
  assert.equal(after.purchase_orders, before.purchase_orders + 1);
  assert.equal(after.items, before.items + 1);
  assert.equal(after.allocations, before.allocations);
  assert.equal(after.audit_events - before.audit_events, eventCounts.rows[0].audit_events);
  assert.equal(after.outbox_messages - before.outbox_messages, eventCounts.rows[0].outbox_messages);
  console.log(`Validated HML synthetic SC/PO ${scNumber} / ${poNumber}; PO retained as DELETED.`);
});
