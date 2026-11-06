import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { processFollowupFieldKeys, registerFollowupRoutes } from "../dist/followup.js";
import { ipPostShipmentFields, newProcessDocumentKinds } from "../../web/lib/ip-post-shipment-fields.ts";

const actorId = "00000000-0000-4000-8000-000000000001";
const processId = "00000000-0000-4000-8000-000000000011";
const billId = "00000000-0000-4000-8000-000000000012";

async function followupApp(t, storedProcess = {}) {
  const writes = [];
  const client = { async query(sql, params = []) {
    if (sql.includes("FROM imports.import_process WHERE id=$1") && sql.includes("FOR UPDATE")) {
      return { rows: [{ id: processId, importer: "ELETRA MATRIZ", version: "3", record_status: "ACTIVE",
        lifecycle_status: "OPEN", ...storedProcess }], rowCount: 1 };
    }
    if (sql.includes("FROM imports.process_document d JOIN imports.import_process p")) {
      return { rows: [{ id: billId, process_id: processId, kind: "BL", number: "BL-OLD", version: "1" }], rowCount: 1 };
    }
    if (sql.includes("UPDATE imports.import_process SET")) {
      writes.push({ sql, params });
      return { rows: [{ version: "4" }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO imports.process_document") || sql.includes("UPDATE imports.process_document")) {
      writes.push({ sql, params });
    }
    return { rows: [], rowCount: 1 };
  }, release() {} };
  const pool = {
    async query(sql) {
      if (sql.includes("identity.erp_user AS u")) return { rows: [{ role: "Importação", importer_code: "ELETRA MATRIZ" }] };
      return { rows: [] };
    },
    async connect() { return client; },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    request.authContext = { issuer: "ci", subject: "post-shipment", userId: actorId, displayName: null, sessionToken: "ci" };
  });
  await registerFollowupRoutes(app, pool);
  return { app, writes };
}

test("the IP post-shipment form accepts BL number and BL date as IP fields", async t => {
  const { app, writes } = await followupApp(t);
  const response = await app.inject({ method: "PATCH", url: `/api/v1/processes/${processId}/followup`,
    headers: { "x-record-version": "3" },
    payload: { fields: { blNumber: " BL-2026-01 ", blDate: "2026-10-20" }, reason: "Atualização do BL" } });
  assert.equal(response.statusCode, 200, response.body);
  const update = writes.find(write => write.sql.includes("UPDATE imports.import_process SET"));
  assert.match(update.sql, /bl_number=\$2,bl_date=\$3/u);
  assert.deepEqual(update.params, [processId, "BL-2026-01", "2026-10-20"]);
});

test("BL can no longer be created or edited as a document because it belongs to the IP", async t => {
  const { app, writes } = await followupApp(t);
  const created = await app.inject({ method: "POST", url: `/api/v1/processes/${processId}/documents`,
    headers: { "idempotency-key": "new-bl-document" },
    payload: { kind: "BL", number: "BL-NEW", purchaseOrderItemId: null, issueDate: "2026-10-20",
      homologationDate: null, quantity: null, unitPrice: null, amount: null, currencyCode: null,
      notes: "", reason: "Cadastro de BL" } });
  assert.equal(created.statusCode, 400, created.body);
  assert.equal(created.json().code, "BL_IS_IP_FIELD");

  const edited = await app.inject({ method: "PATCH", url: `/api/v1/processes/${processId}/documents/${billId}`,
    headers: { "x-record-version": "1" },
    payload: { number: "BL-OLD-2", issueDate: "2026-10-21", homologationDate: null, quantity: null,
      unitPrice: null, amount: null, currencyCode: null, notes: "", reason: "Correção do BL" } });
  assert.equal(edited.statusCode, 400, edited.body);
  assert.equal(edited.json().code, "BL_IS_IP_FIELD");
  assert.equal(writes.length, 0);
});

test("the web IP field catalog matches the fields accepted by the API", () => {
  const webKeys = ipPostShipmentFields.map(field => field.key);
  assert.equal(new Set(webKeys).size, webKeys.length, "duplicate web field");
  assert.deepEqual([...webKeys].sort(), [...processFollowupFieldKeys].sort());
  assert.deepEqual(newProcessDocumentKinds, ["INVOICE", "NF"]);
});

const poId = "00000000-0000-4000-8000-000000000021";
const itemId = "00000000-0000-4000-8000-000000000022";
const allocationId = "00000000-0000-4000-8000-000000000023";
const ipRow = { id: processId, ip_number: "IP-1", importer: "ELETRA MATRIZ", version: "5", lifecycle_status: "OPEN",
  record_status: "ACTIVE", logistics_status: "WAITING SHIPMENT", transport_mode: "SEA", etd: "2026-09-01",
  bl_number: "BL-IP-1", bl_date: "2026-09-03", arrival_date: null, eta_confirmed: null, ete_confirmed: null };
const invoiceRow = { id: "00000000-0000-4000-8000-000000000024", process_id: processId, kind: "INVOICE",
  status: "ACTIVE", number: "INV-1", purchase_order_item_id: null, quantity: null, unit_price: null, amount: null,
  currency_code: null };

async function readApp(t) {
  const pool = {
    async query(sql) {
      if (sql.includes("identity.erp_user AS u")) return { rows: [{ role: "Consulta", importer_code: "ELETRA MATRIZ" }] };
      if (sql.includes("SELECT p.* FROM imports.import_process p") && sql.includes("WHERE p.id=$1")) return { rows: [{ ...ipRow }] };
      if (sql.includes("SELECT p.* FROM imports.import_process p WHERE p.importer=ANY")) return { rows: [{ ...ipRow }] };
      if (sql.includes("FROM procurement.purchase_order po") && sql.includes("LEFT JOIN catalog.entry supplier")) {
        return { rows: [{ id: poId, importer: "ELETRA MATRIZ", number: "PO-1", version: "2" }] };
      }
      if (sql.includes("SELECT item.*, to_jsonb(item)")) {
        return { rows: [{ id: itemId, line_number: 1, product_code: "P-1", ordered_quantity: "100", unit: "UN" }] };
      }
      if (sql.includes("SELECT a.id AS allocation_id")) {
        return { rows: [{ ...ipRow, allocation_id: allocationId, item_id: itemId, allocation_quantity: "60",
          allocation_notes: "", factory_ship_date: null, allocation_version: "1" }] };
      }
      if (sql.includes("SELECT a.id, a.quantity::text AS \"allocationQuantity\"")) {
        return { rows: [{ id: allocationId, allocationQuantity: "60", notes: "", factory_ship_date: null, item_id: itemId,
          line_number: 1, product_code: "P-1", description: "Produto", ordered_quantity: "100", unit: "UN",
          po_id: poId, po_number: "PO-1", importer: "ELETRA MATRIZ" }] };
      }
      if (sql.includes("FROM imports.process_document")) return { rows: [{ ...invoiceRow }] };
      if (sql.includes("FROM migration.data_issue")) return { rows: [{ open_conflicts: 2 }] };
      return { rows: [] };
    },
    async connect() { throw new Error("read routes must not open a transaction"); },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    request.authContext = { issuer: "ci", subject: "reader", userId: actorId, displayName: null, sessionToken: "ci" };
  });
  await registerFollowupRoutes(app, pool);
  return app;
}

test("the IP followup returns the IP status and ETA/ETE calculated from its own dates", async t => {
  const app = await readApp(t);
  const response = await app.inject({ method: "GET", url: `/api/v1/processes/${processId}/followup` });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.deepEqual(body.calculated, { status: "AGUARDANDO CHEGADA", statusSource: "calculated",
    informedStatus: "WAITING SHIPMENT", eta: "2026-10-26", etaSource: "calculated", ete: "2026-11-05",
    eteSource: "calculated", transitDays: 55, storageDueDate: null });
  assert.equal(body.allocations[0].calculated.billNumber, "BL-IP-1");
  assert.equal(body.allocations[0].calculated.billDate, "2026-09-03");
  assert.deepEqual(body.allocations[0].calculated.invoiceNumbers, ["INV-1"]);
  assert.equal(body.openSourceConflicts, 2);
  assert.deepEqual(body.dateWarnings, []);
});

test("opening an IP lists the date sequences already stored out of order", async t => {
  const app = await readApp(t);
  ipRow.arrival_date = "2026-08-30";
  t.after(() => { ipRow.arrival_date = null; });
  const response = await app.inject({ method: "GET", url: `/api/v1/processes/${processId}/followup` });
  assert.deepEqual(response.json().dateWarnings, ["Chegada efetiva antes do ETD"]);
});

test("each IP of a PO carries the same calculated summary as the IP screen", async t => {
  const app = await readApp(t);
  const response = await app.inject({ method: "GET", url: `/api/v1/purchase-orders/${poId}/followup` });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(body.processes[0].calculated.status, "AGUARDANDO CHEGADA");
  assert.equal(body.processes[0].calculated.eta, "2026-10-26");
  assert.equal(body.shipments[0].calculated.status, "AGUARDANDO CHEGADA");
  assert.equal(body.shipments[0].calculated.billNumber, "BL-IP-1");
  assert.equal(body.shipments[0].process.blDate, "2026-09-03");
});

test("the IP form rejects impossible date sequences and returns warnings for stored ones", async t => {
  const { app, writes } = await followupApp(t, { actual_port_departure_date: new Date("2026-09-10T03:00:00.000Z"),
    arrival_date: null, clearance_date: null, etd: "2026-09-12" });
  const rejected = await app.inject({ method: "PATCH", url: `/api/v1/processes/${processId}/followup`,
    headers: { "x-record-version": "3" }, payload: { fields: { arrivalDate: "2026-09-09" }, reason: "Chegada" } });
  assert.equal(rejected.statusCode, 400, rejected.body);
  assert.equal(rejected.json().code, "IP_DATE_SEQUENCE_INVALID");
  assert.match(rejected.json().detail, /Chegada efetiva antes da saída do porto/u);
  assert.equal(writes.length, 0);

  const accepted = await app.inject({ method: "PATCH", url: `/api/v1/processes/${processId}/followup`,
    headers: { "x-record-version": "3" }, payload: { fields: { arrivalDate: "2026-09-11" }, reason: "Chegada" } });
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.deepEqual(accepted.json().warnings, ["Chegada efetiva antes do ETD"]);
});
