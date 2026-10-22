import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerPurchaseRequestRoutes } from "../dist/purchase-requests.js";

const actorId = "00000000-0000-4000-8000-000000000010";
const scId = "00000000-0000-4000-8000-000000000011";
const poId = "00000000-0000-4000-8000-000000000012";

async function createFixture(t, { role = "PCM", version = "1", purchaseOrders = [], inScope = true } = {}) {
  const queries = [];
  let connects = 0;
  let scExists = true;
  const pool = {
    async query(sql, values = []) {
      if (sql.includes("identity.erp_user AS u")) {
        return { rows: [{ role, importer_code: "ELETRA MATRIZ" }] };
      }
      if (sql.includes("SELECT id FROM procurement.purchase_request WHERE id = $1")) {
        assert.match(sql, /audit\.purchase_request_history/u);
        assert.deepEqual(values[1], ["ELETRA MATRIZ"]);
        return { rows: inScope ? [{ id: scId }] : [], rowCount: inScope ? 1 : 0 };
      }
      if (sql.includes("FROM audit.purchase_request_history")) return { rows: [{ id: "event-id", operation: "DELETE" }] };
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      connects += 1;
      return {
        async query(sql, values = []) {
          queries.push({ sql, values });
          if (sql.includes("FROM procurement.purchase_request") && sql.includes("FOR UPDATE")) {
            return { rows: scExists && inScope ? [{ id: scId, importer: "ELETRA MATRIZ", sc_number: "SC-100",
              supplier_text: "SUP-1", sc_date: "2026-10-01", commercial_plan_received_date: null,
              requester: "Ana", approval_date: null, version }] : [], rowCount: scExists && inScope ? 1 : 0 };
          }
          if (sql.includes("FROM procurement.purchase_order") && sql.includes("purchase_request_id = $1")
            && sql.includes("FOR UPDATE")) return { rows: purchaseOrders, rowCount: purchaseOrders.length };
          if (sql.includes("UPDATE procurement.purchase_order") && sql.includes("purchase_request_id = NULL")) {
            return { rows: purchaseOrders.filter(po => po.lifecycle_status === "DELETED"), rowCount: purchaseOrders.length };
          }
          if (sql.includes("DELETE FROM procurement.purchase_request")) { scExists = false; return { rowCount: 1, rows: [] }; }
          return { rows: [], rowCount: 1 };
        },
        release() {},
      };
    },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    request.authContext = { issuer: "ci", subject: "pcm", userId: actorId, displayName: null, sessionToken: "ci" };
  });
  await registerPurchaseRequestRoutes(app, pool);
  return { app, pool, queries, get connects() { return connects; } };
}

test("deleting an SC unlinks deleted POs, removes the SC and records both audit events", async t => {
  const fixture = await createFixture(t, { purchaseOrders: [{ id: poId, external_number: "HMLVAL-PO-01",
    importer: "ELETRA MATRIZ", lifecycle_status: "DELETED" }] });
  const response = await fixture.app.inject({ method: "DELETE", url: `/api/v1/purchase-requests/${scId}`,
    headers: { "content-type": "application/json", "if-match": "1" }, payload: { reason: "SC sintética incorreta" } });

  assert.equal(response.statusCode, 204, response.body);
  const unlink = fixture.queries.find(query => query.sql.includes("UPDATE procurement.purchase_order"));
  assert.ok(unlink);
  assert.deepEqual(JSON.parse(fixture.queries.find(query => query.sql.includes("INSERT INTO audit.audit_log")
    && query.values[5] === "UPDATE").values[6]), { purchaseRequestId: scId });
  assert.deepEqual(JSON.parse(fixture.queries.find(query => query.sql.includes("INSERT INTO audit.audit_log")
    && query.values[5] === "DELETE").values[6]), { importer: "ELETRA MATRIZ", scNumber: "SC-100",
    supplierText: "SUP-1", scDate: "2026-10-01", commercialPlanReceivedDate: null,
    requester: "Ana", approvalDate: null });
  assert.ok(fixture.queries.some(query => query.sql.includes("DELETE FROM procurement.purchase_request")));
});

test("deletion refuses active, closed or cancelled POs and lists their numbers", async t => {
  const fixture = await createFixture(t, { purchaseOrders: [
    { id: poId, external_number: "PO-ACTIVE", lifecycle_status: "ACTIVE" },
    { id: "po-closed", external_number: "PO-CLOSED", lifecycle_status: "CLOSED" },
    { id: "po-cancelled", external_number: "PO-CANCELLED", lifecycle_status: "CANCELLED" },
  ] });
  const response = await fixture.app.inject({ method: "DELETE", url: `/api/v1/purchase-requests/${scId}`,
    headers: { "if-match": "1" }, payload: { reason: "Correção solicitada" } });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, "PURCHASE_REQUEST_IN_USE");
  for (const number of ["PO-ACTIVE", "PO-CLOSED", "PO-CANCELLED"]) assert.match(response.json().detail, new RegExp(number, "u"));
  assert.equal(fixture.queries.some(query => query.sql.includes("UPDATE procurement.purchase_order")), false);
  assert.equal(fixture.queries.some(query => query.sql.includes("DELETE FROM procurement.purchase_request")), false);
});

test("deletion checks version, importer scope, reason and purchase-requests.write", async t => {
  const stale = await createFixture(t, { version: "2" });
  const staleResponse = await stale.app.inject({ method: "DELETE", url: `/api/v1/purchase-requests/${scId}`,
    headers: { "if-match": "1" }, payload: { reason: "Motivo da exclusão" } });
  assert.equal(staleResponse.statusCode, 409);
  assert.equal(staleResponse.json().code, "VERSION_CONFLICT");

  const foreign = await createFixture(t, { inScope: false });
  assert.equal((await foreign.app.inject({ method: "DELETE", url: `/api/v1/purchase-requests/${scId}`,
    headers: { "if-match": "1" }, payload: { reason: "Motivo da exclusão" } })).statusCode, 404);

  const reader = await createFixture(t, { role: "Compras" });
  assert.equal((await reader.app.inject({ method: "DELETE", url: `/api/v1/purchase-requests/${scId}`,
    headers: { "if-match": "1" }, payload: { reason: "Motivo da exclusão" } })).statusCode, 403);
  assert.equal(reader.connects, 0);

  const noReason = await createFixture(t);
  assert.equal((await noReason.app.inject({ method: "DELETE", url: `/api/v1/purchase-requests/${scId}`,
    headers: { "if-match": "1" }, payload: { reason: " x " } })).statusCode, 400);
  assert.equal(noReason.connects, 0);
});

test("history remains available from the archived delete audit after the SC row is gone", async t => {
  const fixture = await createFixture(t);
  const response = await fixture.app.inject({ method: "GET", url: `/api/v1/purchase-requests/${scId}/history` });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().items[0].operation, "DELETE");
});
