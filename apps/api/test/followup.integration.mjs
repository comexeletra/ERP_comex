import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { Pool } from "pg";
import { registerFollowupRoutes } from "../dist/followup.js";
import { registerOperationalRoutes } from "../dist/operations.js";

const connectionString = process.env.FOLLOWUP_TEST_DATABASE_URL;
test("followup persists item/IP inputs and individual documents in an isolated rollback", { skip: !connectionString }, async t => {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  await client.query("BEGIN");
  t.after(async () => { await client.query("ROLLBACK"); client.release(); await pool.end(); });
  const actor = await client.query("SELECT id FROM identity.erp_user LIMIT 1");
  assert.ok(actor.rows[0], "isolated copy needs an audit actor");
  const importer = "FOLLOWUP CI";
  const poId = randomUUID(); const itemId = randomUUID(); const processId = randomUUID();
  const secondProcessId = randomUUID(); const historicalIpId = randomUUID();
  const allocationId = randomUUID(); const secondAllocationId = randomUUID();
  await client.query(`INSERT INTO procurement.purchase_order
    (id,importer,external_number,normalized_number,source_kind,version) VALUES ($1,$2,'PO-CI','PO-CI','MANUAL_TOTVS_REFERENCE',1)`, [poId, importer]);
  await client.query(`INSERT INTO imports.import_process
    (id,importer,ip_number,normalized_ip_number,source_kind,version) VALUES ($1,$2,'IP-CI','IP-CI','MANUAL',1)`, [processId, importer]);
  await client.query(`INSERT INTO imports.import_process
    (id,importer,ip_number,normalized_ip_number,source_kind,version) VALUES ($1,$2,'IP-CI-2','IP-CI-2','MANUAL',1)`, [secondProcessId, importer]);
  await client.query(`INSERT INTO imports.import_process
    (id,importer,ip_number,normalized_ip_number,source_kind,version) VALUES ($1,$2,'IP-HIST','IP-HIST','HISTORICAL_EXCEL',1)`, [historicalIpId, importer]);
  await client.query(`INSERT INTO procurement.purchase_order_item
    (id,purchase_order_id,line_number,product_code,description,ordered_quantity,unit,unit_price,currency_code)
    VALUES ($1,$2,1,'PROD-CI','Produto',100,'PC',12.5,'USD')`, [itemId, poId]);
  await client.query(`INSERT INTO procurement.po_item_allocation
    (id,purchase_order_item_id,process_id,quantity) VALUES ($1,$2,$3,40)`, [allocationId, itemId, processId]);
  await client.query(`INSERT INTO procurement.po_item_allocation
    (id,purchase_order_item_id,process_id,quantity) VALUES ($1,$2,$3,60)`, [secondAllocationId, itemId, secondProcessId]);
  await client.query(`INSERT INTO procurement.process_purchase_order (purchase_order_id,process_id,source_kind)
    VALUES ($1,$2,'OPERATIONAL')`, [poId, processId]);
  await client.query(`INSERT INTO procurement.process_purchase_order (purchase_order_id,process_id,source_kind)
    VALUES ($1,$2,'HISTORICAL_EXCEL')`, [poId, historicalIpId]);
  const db = {
    query: (...args) => client.query(...args),
    async connect() {
      return { query: (sql, params) => {
        if (sql === "BEGIN") return client.query("SAVEPOINT followup_command");
        if (sql === "COMMIT") return client.query("RELEASE SAVEPOINT followup_command");
        if (sql === "ROLLBACK") return client.query("ROLLBACK TO SAVEPOINT followup_command");
        return client.query(sql, params);
      }, release() {} };
    },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null); app.decorateRequest("authorizationContext", null);
  app.addHook("onRequest", async request => {
    request.authContext = { userId: actor.rows[0].id, issuer: "ci", subject: "followup" };
    request.authorizationContext = { importerScopes: request.headers["x-test-foreign"] ? [] : [importer],
      roles: ["Importação"], permissions: new Set() };
  });
  await registerFollowupRoutes(app, db);
  await registerOperationalRoutes(app, db);
  const call = (method, path, payload, headers = {}) => app.inject({ method, url: path, payload,
    headers: { ...headers, ...(payload === undefined ? {} : { "content-type": "application/json" }) } });
  const initial = await call("GET", `/api/v1/purchase-orders/${poId}/followup`);
  assert.equal(initial.statusCode, 200, initial.body);
  assert.equal((await call("GET", `/api/v1/purchase-orders/${poId}/followup`, undefined,
    { "x-test-foreign": "1" })).statusCode, 404);
  assert.equal(initial.json().shipments.length, 2);
  assert.equal(initial.json().processes.length, 3);
  assert.deepEqual(initial.json().shipments.map(shipment => shipment.allocationQuantity).sort(), ["40.00000000", "60.00000000"]);
  assert.ok(initial.json().shipments.every(shipment => shipment.calculated.totalPrice === "1250.00000000"));
  const editedItem = await call("PATCH", `/api/v1/purchase-orders/${poId}/items/${itemId}/followup`,
    { fields: { necessityDate: "2026-11-01", scApprovalDate: "2026-08-01", targetOrderDays: 3 }, reason: "Conferido no TOTVS" },
    { "if-match": '"1"' });
  assert.equal(editedItem.statusCode, 200, editedItem.body);
  const editedIp = await call("PATCH", `/api/v1/processes/${processId}/followup`,
    { fields: { transportMode: "SEA", etd: "2026-09-01", arrivalDate: "2026-10-01" }, reason: "Conferido no embarque" },
    { "if-match": '"1"' });
  assert.equal(editedIp.statusCode, 200, editedIp.body);
  const editedSecondIp = await call("PATCH", `/api/v1/processes/${secondProcessId}/followup`,
    { fields: { transportMode: "SEA", etd: "2026-09-15", arrivalDate: "2026-11-10", deliveryDate: "2026-11-18" }, reason: "Conferido no segundo embarque" },
    { "if-match": '"1"' });
  assert.equal(editedSecondIp.statusCode, 200, editedSecondIp.body);
  const invoiceBody = { kind: "INVOICE", number: "INV-CI", purchaseOrderItemId: itemId, issueDate: "2026-09-01",
      homologationDate: null, quantity: "40", unitPrice: "12.50", amount: "500", currencyCode: "USD",
      notes: "", reason: "Conferido na invoice" };
  const key = randomUUID();
  const invoice = await call("POST", `/api/v1/processes/${processId}/documents`, invoiceBody, { "idempotency-key": key });
  assert.equal(invoice.statusCode, 201, invoice.body);
  const documentId = invoice.json().id;
  const replay = await call("POST", `/api/v1/processes/${processId}/documents`, invoiceBody, { "idempotency-key": key });
  assert.equal(replay.statusCode, 201, replay.body);
  assert.equal(replay.json().id, documentId);
  const secondInvoice = await call("POST", `/api/v1/processes/${secondProcessId}/documents`,
    { ...invoiceBody, number: "INV-CI-2", quantity: "60", amount: "750" },
    { "idempotency-key": randomUUID() });
  assert.equal(secondInvoice.statusCode, 201, secondInvoice.body);
  const result = await call("GET", `/api/v1/purchase-orders/${poId}/followup`);
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().processes[0].invoiceTotals.amounts[0].amount, "500.00000000");
  const shipments = new Map(result.json().shipments.map(shipment => [shipment.process.id, shipment]));
  assert.equal(shipments.get(processId).calculated.quantityMatchesInvoice, true);
  assert.equal(shipments.get(processId).calculated.eta, "2026-10-26");
  assert.equal(shipments.get(secondProcessId).calculated.quantityMatchesInvoice, true);
  assert.equal(shipments.get(secondProcessId).calculated.eta, "2026-11-09");
  assert.equal(shipments.get(processId).calculated.clearanceDays, null);
  assert.equal(shipments.get(secondProcessId).calculated.clearanceDays, 8);
  const blockedCancel = await call("DELETE", `/api/v1/purchase-orders/${poId}/allocations/${allocationId}`,
    { reason: "Troca de embarque" }, { "if-match": '"1"' });
  assert.equal(blockedCancel.statusCode, 409, blockedCancel.body);
  const removed = await call("DELETE", `/api/v1/processes/${processId}/documents/${documentId}`,
    { reason: "Documento substituído" }, { "if-match": '"1"' });
  assert.equal(removed.statusCode, 200, removed.body);
  const unlinked = await call("DELETE", `/api/v1/purchase-orders/${poId}/allocations/${allocationId}`,
    { reason: "Troca de embarque" }, { "if-match": '"1"' });
  assert.equal(unlinked.statusCode, 200, unlinked.body);
  const final = await call("GET", `/api/v1/purchase-orders/${poId}/followup`);
  assert.equal(final.json().shipments.length, 1);
  assert.equal(final.json().shipments[0].process.id, secondProcessId);
  assert.equal(final.json().shipments[0].allocationQuantity, "60.00000000");
  assert.equal(final.json().processes.length, 2);
  assert.ok(final.json().processes.some(entry => entry.process.ipNumber === "IP-HIST"));
  const events = final.json().events;
  const allocationCancellation = events.find(event => event.entityType === "PO_ITEM_ALLOCATION" && event.operation === "CANCEL");
  assert.ok(allocationCancellation);
  assert.equal(Number(allocationCancellation.oldValue.quantity), 40);
  assert.equal(allocationCancellation.newValue.status, "CANCELLED");
  assert.ok(events.some(event => event.aggregateType === "IMPORT_PROCESS" && event.aggregateLabel === "IP-CI"
    && event.operation === "FOLLOWUP_UPDATE"));
  assert.ok(events.some(event => event.entityType === "PURCHASE_ORDER_ITEM" && event.operation === "FOLLOWUP_UPDATE"));
});
