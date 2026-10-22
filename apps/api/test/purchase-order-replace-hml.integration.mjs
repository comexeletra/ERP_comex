import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { Pool } from "pg";
import { registerFollowupRoutes } from "../dist/followup.js";
import { registerOperationalRoutes } from "../dist/operations.js";

const databaseUrl = process.env.DATABASE_URL;
if (process.env.MIGRATION_ENV !== "isolated" || !databaseUrl
  || new URL(databaseUrl).pathname !== "/erp_po_totvs_hml") {
  throw new Error("Use MIGRATION_ENV=isolated with DATABASE_URL targeting only erp_po_totvs_hml.");
}

const pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5_000,
  application_name: "purchase-order-replace-hml-validation" });
const app = Fastify();
const runId = randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
const poNumber = `HMLVAL-PO-REPLACE-${runId}`;
const reason = "HML replace validation";

app.decorateRequest("authContext", null);
app.decorateRequest("authorizationContext", null);

const target = await pool.query("SELECT current_database() AS database");
if (target.rows[0]?.database !== "erp_po_totvs_hml") {
  await pool.end();
  throw new Error("The HML integration requires erp_po_totvs_hml.");
}
const context = await pool.query("SELECT id FROM identity.erp_user LIMIT 1");
const source = await pool.query(
  `SELECT po.importer, po.supplier_text
   FROM procurement.purchase_order po
   WHERE EXISTS (SELECT 1 FROM catalog.operational_value importer
       WHERE importer.entity_key = 'IMPORTER' AND importer.value = po.importer
         AND importer.cnpj ~ '^[0-9]{2}[.][0-9]{3}[.][0-9]{3}/[0-9]{4}-[0-9]{2}$')
     AND EXISTS (SELECT 1 FROM catalog.entry supplier
       WHERE supplier.kind = 'SUPPLIER' AND supplier.importer IS NULL AND supplier.status = 'ACTIVE'
         AND supplier.normalized_code = upper(btrim(po.supplier_text)))
   ORDER BY po.lifecycle_status = 'ACTIVE' DESC, po.external_number LIMIT 1`);
const products = await pool.query(
  `SELECT code FROM catalog.entry WHERE kind = 'PRODUCT' AND importer IS NULL AND status = 'ACTIVE'
   ORDER BY normalized_code LIMIT 2`);
const unit = await pool.query(
  "SELECT value FROM catalog.operational_value WHERE entity_key = 'UNIT_OF_MEASURE' ORDER BY normalized_value LIMIT 1");
const costCenter = await pool.query(
  "SELECT value FROM catalog.operational_value WHERE entity_key = 'COST_CENTER' ORDER BY normalized_value LIMIT 1");
if (!context.rows[0] || !source.rows[0] || products.rows.length < 2 || !unit.rows[0] || !costCenter.rows[0]) {
  await pool.end();
  throw new Error("HML lacks an actor, eligible importer/supplier, two products, a unit or a cost center.");
}
const { importer, supplier_text: supplierText } = source.rows[0];
const [productA, productB] = products.rows.map(row => row.code);
const unitValue = unit.rows[0].value;
const costCenterValue = costCenter.rows[0].value;

app.addHook("onRequest", async request => {
  request.authContext = { issuer: "hml-validation", subject: `replace-${runId}`,
    userId: context.rows[0].id, displayName: "HML validation", sessionToken: "hml-validation" };
  request.authorizationContext = { roles: ["Master"], permissions: new Set([
    "purchase-orders.read", "purchase-orders.write", "purchase-orders.lifecycle.manage",
  ]), importerScopes: [importer] };
});
await registerFollowupRoutes(app, pool);
await registerOperationalRoutes(app, pool);

async function call(method, url, payload, headers = {}) {
  const response = await app.inject({ method, url,
    headers: { "content-type": "application/json", ...headers }, payload });
  return { status: response.statusCode, body: response.json() };
}
async function counts() {
  const result = await pool.query(
    `SELECT (SELECT count(*)::int FROM procurement.purchase_order) AS purchase_orders,
            (SELECT count(*)::int FROM procurement.purchase_order_item) AS items,
            (SELECT count(*)::int FROM procurement.po_item_allocation) AS allocations`);
  return result.rows[0];
}
async function poVersion(id) {
  return (await pool.query("SELECT version::text AS version FROM procurement.purchase_order WHERE id = $1", [id])).rows[0].version;
}
const line = (reference, productCode, orderedQuantity) => ({ base: { externalLineReference: reference, productCode,
  description: `HMLVAL ${reference} ${runId}`, orderedQuantity, unit: unitValue, unitPrice: "1", currency: "CNY", reason },
fields: { costCenter: costCenterValue } });
const sheet = (reference, productCode, orderedQuantity) => ({ externalLineReference: reference, productCode,
  description: `HMLVAL ${reference} ${runId}`, orderedQuantity, unitPrice: "1", unit: unitValue, costCenter: costCenterValue });

test("HML replaces a deleted synthetic PO from a spreadsheet in one transaction", async t => {
  t.after(async () => { await app.close(); await pool.end(); });
  const before = await counts();
  const created = await call("POST", "/api/v1/purchase-orders/complete", {
    header: { importer, number: poNumber, supplierText, purchaseRequestId: null, orderDate: null, notes: "", reason },
    items: [line("0001", productA, "1"), line("0002", productA, "2"), line("0003", productB, "1"), line("0005", productA, "1")],
  }, { "Idempotency-Key": `replace-create-${runId}` });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const poId = created.body.id;
  const removed = await call("POST", `/api/v1/purchase-orders/${poId}/items/${created.body.itemIds[2]}/remove`,
    { reason }, { "X-Record-Version": await poVersion(poId) });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  const deleted = await call("DELETE", `/api/v1/purchase-orders/${poId}`, { reason }, { "X-Record-Version": await poVersion(poId) });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));

  const payload = { header: { number: poNumber, supplierCode: supplierText }, fileName: `HMLVAL ${runId}.xlsx`,
    fileSha256: "c".repeat(64), currency: "CNY",
    items: [sheet("0001", productA, "5"), sheet("0002", productB, "2"), sheet("0003", productB, "1"), sheet("0004", productA, "3")] };
  const preview = await call("POST", `/api/v1/purchase-orders/${poId}/replace/preview`, payload);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.canApply, true, JSON.stringify(preview.body.blockers));
  assert.deepEqual([preview.body.updated.length, preview.body.added.length, preview.body.removed.length,
    preview.body.reactivated.length, preview.body.productChanged.length], [1, 1, 1, 1, 1]);

  const replaced = await call("POST", `/api/v1/purchase-orders/${poId}/replace`, { ...payload, reason },
    { "X-Record-Version": preview.body.version });
  assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
  const stored = await pool.query(
    `SELECT po.lifecycle_status, item.external_line_reference AS reference, item.product_code, item.ordered_quantity::text,
            item.source_status, item.cost_center
     FROM procurement.purchase_order po JOIN procurement.purchase_order_item item ON item.purchase_order_id = po.id
     WHERE po.id = $1 ORDER BY item.line_number`, [poId]);
  const byReference = Object.fromEntries(stored.rows.map(row => [row.reference, row]));
  assert.equal(stored.rows[0].lifecycle_status, "ACTIVE");
  assert.equal(Number(byReference["0001"].ordered_quantity), 5);
  assert.equal(byReference["0002"].product_code, productB);
  assert.equal(byReference["0003"].source_status, null);
  assert.equal(byReference["0004"].cost_center, costCenterValue);
  assert.equal(byReference["0005"].source_status, "CANCELLED");

  const events = await pool.query(
    `SELECT (SELECT count(*)::int FROM audit.audit_log WHERE aggregate_id = $1) AS audit_events,
            (SELECT count(*)::int FROM audit.outbox_message WHERE aggregate_id = $1) AS outbox_messages,
            (SELECT count(*)::int FROM audit.audit_log WHERE aggregate_id = $1 AND operation = 'RESTORE') AS restores`, [poId]);
  assert.equal(events.rows[0].restores, 1);
  assert.equal(events.rows[0].outbox_messages, events.rows[0].audit_events);

  const cleaned = await call("DELETE", `/api/v1/purchase-orders/${poId}`, { reason }, { "X-Record-Version": await poVersion(poId) });
  assert.equal(cleaned.status, 200, JSON.stringify(cleaned.body));
  const after = await counts();
  assert.equal(after.purchase_orders, before.purchase_orders + 1);
  assert.equal(after.items, before.items + 5);
  assert.equal(after.allocations, before.allocations);
  console.log(`Validated HML synthetic replacement ${poNumber}; PO retained as DELETED.`);
});
