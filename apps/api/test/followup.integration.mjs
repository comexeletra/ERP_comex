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
  const poId = randomUUID(); const itemId = randomUUID(); const secondItemId = randomUUID(); const processId = randomUUID();
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
  await client.query(`INSERT INTO procurement.purchase_order_item
    (id,purchase_order_id,line_number,product_code,description,ordered_quantity,unit)
    VALUES ($1,$2,2,'PROD-CI-2','Segundo produto',25,'PC')`, [secondItemId, poId]);
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
  const shared = await call("PATCH", `/api/v1/purchase-orders/${poId}/items/followup`,
    { itemIds: [itemId, secondItemId], fields: { scApprovalDate: "2026-08-02", requester: "Analista CI" },
      reason: "Campos conferidos na SC" }, { "if-match": '"2"' });
  assert.equal(shared.statusCode, 200, shared.body);
  assert.equal(shared.json().updatedCount, 2);
  const sharedRows = await client.query(`SELECT sc_approval_date,requester FROM procurement.purchase_order_item
    WHERE purchase_order_id=$1 ORDER BY line_number`, [poId]);
  assert.ok(sharedRows.rows.every(row => row.sc_approval_date.toISOString().slice(0, 10) === "2026-08-02"
    && row.requester === "Analista CI"));
  const changedSet = await call("PATCH", `/api/v1/purchase-orders/${poId}/items/followup`,
    { itemIds: [itemId], fields: { requester: "Outro analista" }, reason: "Lista incompleta" },
    { "if-match": '"3"' });
  assert.equal(changedSet.statusCode, 409, changedSet.body);
  const editedIp = await call("PATCH", `/api/v1/processes/${processId}/followup`,
    { fields: { transportMode: "SEA", etd: "2026-09-01", actualPortDepartureDate: "2026-09-03",
      arrivalDate: "2026-10-01" }, reason: "Conferido no embarque" },
    { "if-match": '"1"' });
  assert.equal(editedIp.statusCode, 200, editedIp.body);
  const editedSecondIp = await call("PATCH", `/api/v1/processes/${secondProcessId}/followup`,
    { fields: { transportMode: "SEA", etd: "2026-09-15", arrivalDate: "2026-11-10", deliveryDate: "2026-11-18" }, reason: "Conferido no segundo embarque" },
    { "if-match": '"1"' });
  assert.equal(editedSecondIp.statusCode, 200, editedSecondIp.body);
  const storedItem = await client.query("SELECT sc_approval_date FROM procurement.purchase_order_item WHERE id=$1", [itemId]);
  assert.equal(storedItem.rows[0].sc_approval_date.toISOString().slice(0, 10), "2026-08-02");
  const storedIps = await client.query(`SELECT id, etd, actual_port_departure_date, arrival_date, delivery_date
    FROM imports.import_process WHERE id=ANY($1::uuid[])`, [[processId, secondProcessId]]);
  const ipsById = new Map(storedIps.rows.map(row => [row.id, row]));
  assert.equal(ipsById.get(processId).actual_port_departure_date.toISOString().slice(0, 10), "2026-09-03");
  assert.equal(ipsById.get(secondProcessId).actual_port_departure_date, null);
  assert.equal(ipsById.get(secondProcessId).delivery_date.toISOString().slice(0, 10), "2026-11-18");

  const closed = await call("POST", `/api/v1/processes/${processId}/close`,
    { reason: "Embarque conferido e concluído" }, { "if-match": '"2"' });
  assert.equal(closed.statusCode, 200, closed.body);
  assert.equal(closed.json().lifecycleStatus, "CLOSED");
  const storedClosed = await client.query("SELECT lifecycle_status,closed_at FROM imports.import_process WHERE id=$1", [processId]);
  assert.equal(storedClosed.rows[0].lifecycle_status, "CLOSED");
  assert.ok(storedClosed.rows[0].closed_at);
  const editClosed = await call("PATCH", `/api/v1/processes/${processId}/followup`,
    { fields: { etd: "2026-09-02" }, reason: "Alteração após encerramento" }, { "if-match": '"3"' });
  assert.equal(editClosed.statusCode, 409, editClosed.body);
  const reopened = await call("POST", `/api/v1/processes/${processId}/reopen`,
    { reason: "Reaberto para completar documentos" }, { "if-match": '"3"' });
  assert.equal(reopened.statusCode, 200, reopened.body);
  assert.equal(reopened.json().lifecycleStatus, "OPEN");
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

  await client.query(`CREATE FUNCTION pg_temp.reject_second_item_update() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.id='${secondItemId}' THEN RAISE EXCEPTION 'CI forced item failure'; END IF;
    RETURN NEW; END $$`);
  await client.query(`CREATE TRIGGER ci_reject_shared_update BEFORE UPDATE ON procurement.purchase_order_item
    FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_second_item_update()`);
  const versionBeforeFailure = (await client.query("SELECT version::text FROM procurement.purchase_order WHERE id=$1", [poId])).rows[0].version;
  const failedBatch = await call("PATCH", `/api/v1/purchase-orders/${poId}/items/followup`,
    { itemIds: [itemId, secondItemId], fields: { requester: "Não pode persistir" }, reason: "Falha simulada" },
    { "if-match": `"${versionBeforeFailure}"` });
  assert.equal(failedBatch.statusCode, 500, failedBatch.body);
  const rolledBack = await client.query(`SELECT requester FROM procurement.purchase_order_item
    WHERE purchase_order_id=$1 ORDER BY line_number`, [poId]);
  assert.deepEqual(rolledBack.rows.map(row => row.requester), ["Analista CI", "Analista CI"]);
  assert.equal((await client.query("SELECT version::text FROM procurement.purchase_order WHERE id=$1", [poId])).rows[0].version,
    versionBeforeFailure);
});
