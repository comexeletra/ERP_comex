import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import pg from "pg";
import { registerAuthorization } from "../dist/authorization.js";
import { registerOperationalRoutes } from "../dist/operations.js";
import { registerPurchaseOrderReadRoutes } from "../dist/purchase-orders.js";
import { registerProcessReadRoutes } from "../dist/processes.js";
import { registerCatalogRoutes } from "../dist/catalog.js";

const databaseUrl = process.env.DATABASE_URL;
if (process.env.MIGRATION_ENV !== "isolated" || !databaseUrl) {
  throw new Error("Use MIGRATION_ENV=isolated and a disposable local PostgreSQL database.");
}
const target = new URL(databaseUrl);
if (!new Set(["localhost", "127.0.0.1", "::1"]).has(target.hostname)
  || !/(?:_ci|_test)$/u.test(decodeURIComponent(target.pathname.slice(1)))) {
  throw new Error("Refusing to test outside a local *_ci or *_test database.");
}

const importer = `CI COMEX ${randomUUID().slice(0, 8)}`;
const otherImporter = `CI OTHER ${randomUUID().slice(0, 8)}`;
const suffix = randomUUID().slice(0, 8);
const writer = { id: randomUUID(), issuer: "ci:operational", subject: randomUUID() };
const reader = { id: randomUUID(), issuer: "ci:operational", subject: randomUUID() };
const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
const app = Fastify();
app.decorateRequest("authContext", null);
await registerAuthorization(app, pool);
app.addHook("onRequest", async request => {
  const identity = request.headers["x-test-subject"] === writer.subject ? writer
    : request.headers["x-test-subject"] === reader.subject ? reader : null;
  if (identity) request.authContext = {
    userId: identity.id, issuer: identity.issuer, subject: identity.subject,
    displayName: null, sessionToken: "ci-only",
  };
});
await registerOperationalRoutes(app, pool);
await registerPurchaseOrderReadRoutes(app, pool);
await registerProcessReadRoutes(app, pool);
await registerCatalogRoutes(app, pool);

const call = (method, path, body, subject = writer.subject, version) => app.inject({
  method, url: `/api/v1${path}`, headers: {
    "x-test-subject": subject,
    ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}),
    ...(version ? { "if-match": `"${version}"` } : {}),
  }, ...(body === undefined ? {} : { payload: body }),
});
const reason = "Conferido no pedido de teste";
const poBody = (number) => ({ importer, number, supplierText: "Fornecedor CI",
  orderDate: "2026-10-04", notes: "", reason });
const ipBody = (ipNumber, chosenImporter = importer) => ({ importer: chosenImporter,
  ipNumber, logisticsStatus: "WAITING SHIPMENT", priority: null, notes: "", reason });
const itemBody = (orderedQuantity = "100") => ({ externalLineReference: "1",
  productCode: "PROD-CI", description: "Produto dividido entre embarques",
  orderedQuantity, unit: "PC", unitPrice: null, currency: null, reason });

try {
  await pool.query(
    `INSERT INTO identity.erp_user (id,issuer,subject) VALUES ($1,$2,$3),($4,$5,$6)`,
    [writer.id, writer.issuer, writer.subject, reader.id, reader.issuer, reader.subject]);
  await pool.query(
    `INSERT INTO identity.erp_user_role (user_id,role) VALUES ($1,'Importação'),($2,'Consulta')`,
    [writer.id, reader.id]);
  await pool.query(
    `INSERT INTO identity.erp_user_importer_scope (user_id,importer_code)
     VALUES ($1,$3),($2,$3)`, [writer.id, reader.id, importer]);
  await pool.query(
    `INSERT INTO procurement.purchase_order (id,importer,external_number,normalized_number)
     VALUES ($1,$2,'CI-SEED-A','CI-SEED-A'),($3,$4,'CI-SEED-B','CI-SEED-B')`,
    [randomUUID(), importer, randomUUID(), otherImporter]);

  const grants = await pool.query(`SELECT
    has_table_privilege('import_erp_app','procurement.purchase_order_item','INSERT') AS item_insert,
    has_table_privilege('import_erp_app','procurement.po_item_allocation','UPDATE') AS allocation_update,
    has_table_privilege('import_erp_app','procurement.operational_command_receipt','INSERT') AS receipt_insert`);
  assert.deepEqual(grants.rows[0], { item_insert: true, allocation_update: true, receipt_insert: true });

  assert.equal((await call("POST", "/purchase-orders", poBody("CI-PO-1"), reader.subject)).statusCode, 403);
  const poCreated = await call("POST", "/purchase-orders", poBody("CI-PO-1"));
  assert.equal(poCreated.statusCode, 201, poCreated.body);
  const poId = poCreated.json().id;
  const corrected = await call("PATCH", `/purchase-orders/${poId}`,
    { number: "CI-PO-1-CORRECTED", supplierText: "Fornecedor CI", orderDate: "2026-10-04",
      notes: "Número corrigido", reason }, writer.subject, "1");
  assert.equal(corrected.statusCode, 200, corrected.body);
  const ip1 = await call("POST", "/processes", ipBody(`CI-IP-1-${suffix}`));
  const ip2 = await call("POST", "/processes", ipBody(`CI-IP-2-${suffix}`));
  assert.equal(ip1.statusCode, 201, ip1.body);
  assert.equal(ip2.statusCode, 201, ip2.body);
  const correctedIp = await call("PATCH", `/processes/${ip1.json().id}`,
    { ipNumber: `CI-IP-1-CORRECTED-${suffix}`, logisticsStatus: "WAITING SHIPMENT",
      priority: "HIGH", notes: "Número corrigido", reason }, writer.subject, "1");
  assert.equal(correctedIp.statusCode, 200, correctedIp.body);
  const otherIp = await pool.query(
    `INSERT INTO imports.import_process (id,importer,ip_number,normalized_ip_number)
     VALUES ($1,$2,$3::text,upper($3::text)) RETURNING id`,
    [randomUUID(), otherImporter, `CI-IP-OTHER-${suffix}`]);

  const createdItem = await call("POST", `/purchase-orders/${poId}/items`, itemBody());
  assert.equal(createdItem.statusCode, 201, createdItem.body);
  const itemId = createdItem.json().id;
  const allocation = (processId, quantity) => ({ itemId, processId, quantity, notes: "", reason });
  assert.equal((await call("POST", `/purchase-orders/${poId}/allocations`,
    allocation(otherIp.rows[0].id, "1"))).statusCode, 404);
  const first = await call("POST", `/purchase-orders/${poId}/allocations`, allocation(ip1.json().id, "40"));
  const second = await call("POST", `/purchase-orders/${poId}/allocations`, allocation(ip2.json().id, "60"));
  assert.equal(first.statusCode, 201, first.body);
  assert.equal(second.statusCode, 201, second.body);
  const secondPo = await call("POST", "/purchase-orders", poBody("CI-PO-2"));
  assert.equal(secondPo.statusCode, 201, secondPo.body);
  const secondItem = await call("POST", `/purchase-orders/${secondPo.json().id}/items`, itemBody("25"));
  assert.equal(secondItem.statusCode, 201, secondItem.body);
  const sharedIp = await call("POST", `/purchase-orders/${secondPo.json().id}/allocations`,
    { itemId: secondItem.json().id, processId: ip2.json().id, quantity: "25", notes: "", reason });
  assert.equal(sharedIp.statusCode, 201, sharedIp.body);
  const sharedCount = await pool.query(
    `SELECT count(*)::int AS total FROM procurement.process_purchase_order WHERE process_id = $1`,
    [ip2.json().id]);
  assert.equal(sharedCount.rows[0].total, 2);
  assert.equal((await call("POST", `/purchase-orders/${poId}/allocations`,
    allocation(ip1.json().id, "1"))).statusCode, 409);

  let state = await call("GET", `/purchase-orders/${poId}/operational`);
  assert.equal(state.statusCode, 200, state.body);
  assert.equal(state.json().items[0].orderedQuantity, "100.00000000");
  assert.equal(state.json().items[0].allocatedQuantity, "100.00000000");
  assert.equal(state.json().items[0].remainingQuantity, "0.00000000");
  assert.equal(state.json().allocations.length, 2);
  const wrongUnit = await call("PATCH", `/purchase-orders/${poId}/items/${itemId}`,
    { ...itemBody("100"), unit: "KG" }, writer.subject, state.json().version);
  assert.equal(wrongUnit.statusCode, 409);
  const missingVersion = await call("PATCH", `/purchase-orders/${poId}/items/${itemId}`, itemBody("90"));
  assert.equal(missingVersion.statusCode, 428);
  assert.equal((await call("PATCH", `/purchase-orders/${poId}/items/${itemId}`,
    itemBody("90"), writer.subject, state.json().version)).statusCode, 409);
  const cancelBusyIp = await call("PATCH", `/processes/${ip2.json().id}`,
    { ipNumber: `CI-IP-2-${suffix}`, logisticsStatus: "CANCELLED",
      priority: null, notes: "", reason }, writer.subject, "1");
  assert.equal(cancelBusyIp.statusCode, 409);
  const cancelBusyIpAlternate = await call("PATCH", `/processes/${ip2.json().id}`,
    { ipNumber: `CI-IP-2-${suffix}`, logisticsStatus: "CANCELED",
      priority: null, notes: "", reason }, writer.subject, "1");
  assert.equal(cancelBusyIpAlternate.statusCode, 409);

  const decimalPo = await call("POST", "/purchase-orders", poBody("CI-PO-DECIMAL"));
  assert.equal(decimalPo.statusCode, 201, decimalPo.body);
  const decimalItem = await call("POST", `/purchase-orders/${decimalPo.json().id}/items`, itemBody("10,5"));
  assert.equal(decimalItem.statusCode, 201, decimalItem.body);
  const decimalAllocation = await call("POST", `/purchase-orders/${decimalPo.json().id}/allocations`,
    { itemId: decimalItem.json().id, processId: ip2.json().id,
      quantity: "3,25", notes: "", reason });
  assert.equal(decimalAllocation.statusCode, 201, decimalAllocation.body);
  const decimalState = await call("GET", `/purchase-orders/${decimalPo.json().id}/operational`);
  assert.equal(decimalState.json().items[0].remainingQuantity, "7.25000000");
  const productSearch = await call("GET", "/purchase-orders?product=PROD-CI");
  assert.equal(productSearch.statusCode, 200, productSearch.body);
  assert.ok(productSearch.json().items.some(item => item.id === decimalPo.json().id));
  const importerOptions = await call("GET", "/importers");
  assert.equal(importerOptions.statusCode, 200, importerOptions.body);
  assert.ok(importerOptions.json().items.some(item => item.code === importer));
  const processDetail = await call("GET", `/processes/${ip2.json().id}`);
  assert.equal(processDetail.statusCode, 200, processDetail.body);
  assert.ok(processDetail.json().purchaseOrders.some(item => item.id === poId));
  assert.ok(processDetail.json().purchaseOrders.some(item => item.id === secondPo.json().id));
  assert.ok(processDetail.json().operationalAllocations.some(item => item.poId === decimalPo.json().id));

  const concurrentPo = await call("POST", "/purchase-orders", poBody("CI-PO-CONCURRENT"));
  assert.equal(concurrentPo.statusCode, 201, concurrentPo.body);
  const concurrentItem = await call("POST", `/purchase-orders/${concurrentPo.json().id}/items`, itemBody());
  const ip3 = await call("POST", "/processes", ipBody(`CI-IP-3-${suffix}`));
  const ip4 = await call("POST", "/processes", ipBody(`CI-IP-4-${suffix}`));
  assert.equal(concurrentItem.statusCode, 201, concurrentItem.body);
  assert.equal(ip3.statusCode, 201, ip3.body);
  assert.equal(ip4.statusCode, 201, ip4.body);
  const concurrentResults = await Promise.all([ip3.json().id, ip4.json().id].map(processId =>
    call("POST", `/purchase-orders/${concurrentPo.json().id}/allocations`,
      { itemId: concurrentItem.json().id, processId, quantity: "60", notes: "", reason })));
  assert.deepEqual(concurrentResults.map(result => result.statusCode).sort(), [201, 409]);
  const concurrentState = await call("GET", `/purchase-orders/${concurrentPo.json().id}/operational`);
  assert.equal(concurrentState.json().items[0].allocatedQuantity, "60.00000000");
  assert.equal(concurrentState.json().items[0].remainingQuantity, "40.00000000");

  assert.equal((await call("PATCH", `/purchase-orders/${poId}/allocations/${first.json().id}`,
    { quantity: "50", notes: "", reason }, writer.subject, "1")).statusCode, 409);
  const reduced = await call("PATCH", `/purchase-orders/${poId}/allocations/${first.json().id}`,
    { quantity: "30", notes: "", reason }, writer.subject, "1");
  assert.equal(reduced.statusCode, 200, reduced.body);
  assert.equal((await call("DELETE", `/purchase-orders/${poId}/allocations/${first.json().id}`,
    { reason }, writer.subject, "1")).statusCode, 409);
  const cancelled = await call("DELETE", `/purchase-orders/${poId}/allocations/${first.json().id}`,
    { reason }, writer.subject, "2");
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  state = await call("GET", `/purchase-orders/${poId}/operational`);
  assert.equal(state.json().items[0].remainingQuantity, "40.00000000");
  assert.equal(state.json().allocations.length, 1);

  const activeLink = await pool.query(
    `SELECT process_id FROM procurement.process_purchase_order
     WHERE purchase_order_id = $1 ORDER BY process_id`, [poId]);
  assert.deepEqual(activeLink.rows.map(row => row.process_id), [ip2.json().id]);
  const audit = await pool.query(
    `SELECT count(*)::int AS total FROM audit.audit_log
     WHERE aggregate_type = 'PURCHASE_ORDER' AND aggregate_id = $1`, [poId]);
  assert.ok(audit.rows[0].total >= 6);
  console.log("Operational PO/IP PostgreSQL integration contract passed.");
} finally {
  await app.close();
  await pool.end();
}
