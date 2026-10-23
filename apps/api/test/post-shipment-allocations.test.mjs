import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { portalAutomaticReason, registerOperationalRoutes } from "../dist/operations.js";
import { automaticAuditReason } from "../../web/lib/audit.ts";

const actorId = "00000000-0000-4000-8000-000000000001";
const poId = "00000000-0000-4000-8000-000000000031";
const itemId = "00000000-0000-4000-8000-000000000032";
const processId = "00000000-0000-4000-8000-000000000033";
const allocationId = "00000000-0000-4000-8000-000000000034";

async function allocationApp(t, { shipped }) {
  const queries = [];
  const client = { async query(sql, params = []) {
    queries.push({ sql, params });
    if (sql.includes("SELECT * FROM procurement.purchase_order WHERE id = $1")) {
      return { rows: [{ id: poId, importer: "ELETRA MATRIZ", lifecycle_status: "ACTIVE", version: "4" }], rowCount: 1 };
    }
    if (sql.includes("SELECT payload_sha256")) return { rows: [], rowCount: 0 };
    if (sql.includes("FROM procurement.purchase_order_item") && sql.includes("WHERE id = $1 AND purchase_order_id = $2")) {
      return { rows: [{ id: itemId }], rowCount: 1 };
    }
    if (sql.includes("FROM imports.import_process WHERE id = $1")) {
      return { rows: [{ id: processId, bl_date: shipped ? "2026-10-01" : null, actual_port_departure_date: null }], rowCount: 1 };
    }
    if (sql.includes("SELECT a.* FROM procurement.po_item_allocation a")) {
      return { rows: [{ id: allocationId, process_id: processId, purchase_order_item_id: itemId,
        quantity: "60.00000000", notes: "", status: "ACTIVE", version: "1" }], rowCount: 1 };
    }
    if (sql.includes("RETURNING version::text")) return { rows: [{ version: "2" }], rowCount: 1 };
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
    request.authContext = { issuer: "ci", subject: "allocations", userId: actorId, displayName: null, sessionToken: "ci" };
  });
  await registerOperationalRoutes(app, pool);
  const audit = () => queries.filter(query => query.sql.includes("INSERT INTO audit.audit_log"));
  return { app, queries, audit };
}

const create = (key, extra = {}) => ({ method: "POST", url: `/api/v1/purchase-orders/${poId}/allocations`,
  headers: { "idempotency-key": key },
  payload: { itemId, processId, quantity: "10", notes: "", reason: automaticAuditReason, ...extra } });
const update = extra => ({ method: "PATCH", url: `/api/v1/purchase-orders/${poId}/allocations/${allocationId}`,
  headers: { "x-record-version": "1" }, payload: { reason: automaticAuditReason, ...extra } });
const cancel = extra => ({ method: "DELETE", url: `/api/v1/purchase-orders/${poId}/allocations/${allocationId}`,
  headers: { "x-record-version": "1" }, payload: { reason: automaticAuditReason, ...extra } });

test("the API knows the reason the portal sends when the user typed none", () => {
  assert.equal(portalAutomaticReason, automaticAuditReason);
});

test("allocations of an IP that has not shipped need no confirmation", async t => {
  const { app } = await allocationApp(t, { shipped: false });
  assert.equal((await app.inject(create("unshipped-create"))).statusCode, 201);
  assert.equal((await app.inject(update({ quantity: "50" }))).statusCode, 200);
  assert.equal((await app.inject(cancel())).statusCode, 200);
});

test("changing the shipped quantity of an IP requires confirmation and a typed reason", async t => {
  const { app, audit } = await allocationApp(t, { shipped: true });
  for (const request of [create("shipped-create"), update({ quantity: "50" }), cancel()]) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 409, `${request.method}: ${response.body}`);
    assert.equal(response.json().code, "IP_ALREADY_SHIPPED_UNCONFIRMED");
  }
  const automatic = await app.inject(update({ quantity: "50", confirmShippedChange: true }));
  assert.equal(automatic.statusCode, 409, automatic.body);
  assert.equal(audit().length, 0);

  const typed = { confirmShippedChange: true, reason: "Carga parcial embarcada no navio seguinte" };
  assert.equal((await app.inject(create("shipped-create-confirmed", typed))).statusCode, 201);
  assert.equal((await app.inject(update({ quantity: "50", ...typed }))).statusCode, 200);
  assert.equal((await app.inject(cancel(typed))).statusCode, 200);
  const confirmed = audit().filter(query => JSON.parse(query.params[7]).confirmShippedChange === true);
  assert.equal(confirmed.length, 3);
  assert.ok(audit().every(query => query.params[9] === typed.reason));
});

test("factory date and notes of a shipped IP allocation stay editable without confirmation", async t => {
  const { app } = await allocationApp(t, { shipped: true });
  assert.equal((await app.inject(update({ factoryShipDate: "2026-09-20" }))).statusCode, 200);
  assert.equal((await app.inject(update({ quantity: "60", notes: "Conferido" }))).statusCode, 200);
});
