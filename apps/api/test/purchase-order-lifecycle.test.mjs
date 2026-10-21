import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerOperationalRoutes } from "../dist/operations.js";

const poId = "00000000-0000-4000-8000-000000000001";

async function lifecycleApp(t, { status = "ACTIVE", version = "1", activeAllocations = false,
  writerRole = "Importa\u00e7\u00e3o" } = {}) {
  const queries = [];
  const state = { id: poId, importer: "ELETRA MATRIZ", external_number: "PO-LIFECYCLE",
    lifecycle_status: status, version };
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("SELECT * FROM procurement.purchase_order WHERE id = $1")) {
        return { rows: [{ ...state }], rowCount: 1 };
      }
      if (sql.includes("SELECT EXISTS") && sql.includes("po_item_allocation")) {
        return { rows: [{ has_active_allocations: activeAllocations }], rowCount: 1 };
      }
      if (sql.includes("UPDATE procurement.purchase_order") && sql.includes("lifecycle_status")) {
        state.lifecycle_status = params[1];
        state.version = String(Number(state.version) + 1);
        return { rows: [{ id: state.id, lifecycle_status: state.lifecycle_status, version: state.version }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const pool = {
    async query(sql, params = []) {
      if (sql.includes("FROM identity.erp_user AS u")) {
        return { rows: [{ role: params[1] === "reader" ? "Consulta" : writerRole,
          importer_code: "ELETRA MATRIZ" }], rowCount: 1 };
      }
      if (sql.includes("SELECT DISTINCT importer FROM procurement.purchase_order")) {
        return { rows: [{ importer: "ELETRA MATRIZ" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    async connect() { return client; },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    const subject = request.headers["x-test-subject"];
    if (typeof subject === "string") request.authContext = {
      issuer: "ci", subject, userId: poId, displayName: null, sessionToken: "ci",
    };
  });
  await registerOperationalRoutes(app, pool);
  return { app, queries, state };
}

function lifecycleRequest(app, subject, action, version, reason = "Revisão da PO") {
  const method = action === "delete" ? "DELETE" : "POST";
  const suffix = action === "delete" ? "" : `/${action}`;
  return app.inject({ method, url: `/api/v1/purchase-orders/${poId}${suffix}`,
    headers: { "x-test-subject": subject, "x-record-version": version }, payload: { reason } });
}

test("PO cancellation requires no active allocations and writes an audited terminal state", async t => {
  const blocked = await lifecycleApp(t, { activeAllocations: true });
  const rejected = await lifecycleRequest(blocked.app, "writer", "cancel", "1");
  assert.equal(rejected.statusCode, 409);
  assert.equal(rejected.json().code, "PO_HAS_ACTIVE_ALLOCATIONS");
  assert.equal(blocked.queries.some(query => query.sql.includes("SET lifecycle_status")), false);

  const allowed = await lifecycleApp(t);
  const response = await lifecycleRequest(allowed.app, "writer", "cancel", "1");
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().lifecycleStatus, "CANCELLED");
  assert.equal(allowed.state.lifecycle_status, "CANCELLED");
  assert.ok(allowed.queries.some(query => query.sql.includes("INSERT INTO audit.audit_log")
    && query.params.includes("CANCEL")));
  assert.ok(allowed.queries.some(query => query.sql.includes("INSERT INTO audit.outbox_message")));
});

test("closing a PO keeps allocations and balance; reopening requires the current version", async t => {
  const { app, state, queries } = await lifecycleApp(t, { activeAllocations: true });
  const closed = await lifecycleRequest(app, "writer", "close", "1");
  assert.equal(closed.statusCode, 200, closed.body);
  assert.equal(closed.json().lifecycleStatus, "CLOSED");
  assert.equal(state.lifecycle_status, "CLOSED");

  const edit = await app.inject({ method: "PATCH", url: `/api/v1/purchase-orders/${poId}`,
    headers: { "x-test-subject": "writer", "x-record-version": "2" },
    payload: { number: "PO-CHANGED", supplierText: null, orderDate: null, notes: "", reason: "Tentativa de edição" },
  });
  assert.equal(edit.statusCode, 409);
  assert.equal(edit.json().code, "PO_NOT_ACTIVE");
  const allocation = await app.inject({ method: "POST", url: `/api/v1/purchase-orders/${poId}/allocations`,
    headers: { "x-test-subject": "writer", "idempotency-key": "closed-po-allocation" },
    payload: { itemId: poId, processId: poId, quantity: "1", notes: "", reason: "Tentativa de alocação" },
  });
  assert.equal(allocation.statusCode, 409);
  assert.equal(allocation.json().code, "PO_NOT_ACTIVE");
  assert.equal(queries.some(query => query.sql.includes("UPDATE procurement.purchase_order AS po SET supplier_text")), false);
  assert.equal(queries.some(query => query.sql.includes("INSERT INTO procurement.po_item_allocation")), false);

  const stale = await lifecycleRequest(app, "writer", "reopen", "1");
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, "VERSION_CONFLICT");
  const reopened = await lifecycleRequest(app, "writer", "reopen", "2", "Reabertura autorizada");
  assert.equal(reopened.statusCode, 200, reopened.body);
  assert.equal(reopened.json().lifecycleStatus, "ACTIVE");
  assert.equal(state.lifecycle_status, "ACTIVE");
});

test("PO deletion is logical, preserves records, and refuses active allocations", async t => {
  const blocked = await lifecycleApp(t, { activeAllocations: true });
  const rejected = await lifecycleRequest(blocked.app, "writer", "delete", "1");
  assert.equal(rejected.statusCode, 409);
  assert.equal(rejected.json().code, "PO_HAS_ACTIVE_ALLOCATIONS");

  const allowed = await lifecycleApp(t);
  const response = await lifecycleRequest(allowed.app, "writer", "delete", "1");
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().lifecycleStatus, "DELETED");
  assert.equal(allowed.state.lifecycle_status, "DELETED");
  assert.equal(allowed.queries.some(query => /^\s*DELETE\s+FROM\s+procurement\.purchase_order/i.test(query.sql)), false);
});

test("PO lifecycle commands require purchase-order write permission and a reason", async t => {
  const { app, queries } = await lifecycleApp(t);
  const reader = await lifecycleRequest(app, "reader", "close", "1");
  assert.equal(reader.statusCode, 403);
  const missingReason = await lifecycleRequest(app, "writer", "close", "1", " ");
  assert.equal(missingReason.statusCode, 400);
  assert.equal(queries.some(query => query.sql.includes("SET lifecycle_status")), false);
});

test("cancelled and deleted POs cannot be reopened or transitioned again", async t => {
  const cancelled = await lifecycleApp(t, { status: "CANCELLED" });
  const reopenCancelled = await lifecycleRequest(cancelled.app, "writer", "reopen", "1");
  assert.equal(reopenCancelled.statusCode, 409);
  assert.equal(reopenCancelled.json().code, "PO_NOT_CLOSED");

  const deleted = await lifecycleApp(t, { status: "DELETED" });
  const deleteAgain = await lifecycleRequest(deleted.app, "writer", "delete", "1");
  assert.equal(deleteAgain.statusCode, 409);
  assert.equal(deleteAgain.json().code, "PO_ALREADY_DELETED");
});
