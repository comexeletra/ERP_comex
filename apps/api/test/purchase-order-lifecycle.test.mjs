import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerOperationalRoutes } from "../dist/operations.js";
import { registerPurchaseOrderReadRoutes } from "../dist/purchase-orders.js";

const poId = "00000000-0000-4000-8000-000000000001";

async function lifecycleApp(t, { status = "ACTIVE", version = "1", activeAllocations = false,
  writerRole = "Importa\u00e7\u00e3o" } = {}) {
  const queries = [];
  const state = { id: poId, importer: "ELETRA MATRIZ", external_number: "PO-LIFECYCLE",
    lifecycle_status: status, lifecycle_changed_at: status === "ACTIVE" ? null : "2026-10-20T12:00:00Z",
    lifecycle_changed_by: status === "ACTIVE" ? null : "ci#previous", lifecycle_reason: status === "ACTIVE" ? null : "Estado anterior", version };
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
        state.lifecycle_changed_at = params[1] === "ACTIVE" ? null : "2026-10-21T12:00:00Z";
        state.lifecycle_changed_by = params[1] === "ACTIVE" ? null : params[2];
        state.lifecycle_reason = params[1] === "ACTIVE" ? null : params[3];
        state.version = String(Number(state.version) + 1);
        return { rows: [{ id: state.id, lifecycle_status: state.lifecycle_status,
          lifecycle_changed_at: state.lifecycle_changed_at, lifecycle_changed_by: state.lifecycle_changed_by,
          lifecycle_reason: state.lifecycle_reason, version: state.version }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const pool = {
    async query(sql, params = []) {
      if (sql.includes("FROM identity.erp_user AS u")) {
        const role = params[1] === "reader" ? "Consulta" : params[1] === "master" ? "Master"
          : params[1] === "admin" ? "Administrador" : writerRole;
        return { rows: [{ role,
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

test("Master and Administrator can reactivate cancelled POs and restore deleted POs", async t => {
  for (const subject of ["master", "admin"]) {
    const cancelled = await lifecycleApp(t, { status: "CANCELLED" });
    const reactivated = await lifecycleRequest(cancelled.app, subject, "reactivate", "1", "Reativação aprovada");
    assert.equal(reactivated.statusCode, 200, reactivated.body);
    assert.equal(reactivated.json().lifecycleStatus, "ACTIVE");
    assert.equal(cancelled.state.lifecycle_status, "ACTIVE");
    assert.equal(cancelled.state.lifecycle_changed_at, null);
    assert.equal(cancelled.state.lifecycle_changed_by, null);
    assert.equal(cancelled.state.lifecycle_reason, null);

    const deleted = await lifecycleApp(t, { status: "DELETED" });
    const restored = await lifecycleRequest(deleted.app, subject, "restore", "1", "Restauração aprovada");
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal(restored.json().lifecycleStatus, "ACTIVE");
    assert.equal(deleted.state.lifecycle_status, "ACTIVE");
    assert.equal(deleted.state.lifecycle_changed_at, null);
    assert.equal(deleted.state.lifecycle_changed_by, null);
    assert.equal(deleted.state.lifecycle_reason, null);
  }
});

test("reactivation and restoration require their exact source state", async t => {
  const active = await lifecycleApp(t, { status: "ACTIVE" });
  const reactivateActive = await lifecycleRequest(active.app, "master", "reactivate", "1");
  assert.equal(reactivateActive.statusCode, 409);
  assert.equal(reactivateActive.json().code, "PO_NOT_CANCELLED");

  const closed = await lifecycleApp(t, { status: "CLOSED" });
  const restoreClosed = await lifecycleRequest(closed.app, "master", "restore", "1");
  assert.equal(restoreClosed.statusCode, 409);
  assert.equal(restoreClosed.json().code, "PO_NOT_DELETED");

  const cancelled = await lifecycleApp(t, { status: "CANCELLED" });
  const restoreCancelled = await lifecycleRequest(cancelled.app, "master", "restore", "1");
  assert.equal(restoreCancelled.statusCode, 409);
  assert.equal(restoreCancelled.json().code, "PO_NOT_DELETED");

  const deleted = await lifecycleApp(t, { status: "DELETED" });
  const reactivateDeleted = await lifecycleRequest(deleted.app, "master", "reactivate", "1");
  assert.equal(reactivateDeleted.statusCode, 409);
  assert.equal(reactivateDeleted.json().code, "PO_NOT_CANCELLED");
});

test("reactivation and restoration require Master or Administrator permission", async t => {
  for (const [subject, writerRole] of [["writer", "Importação"], ["buyer", "Compras"], ["reader", "Consulta"]]) {
    const cancelled = await lifecycleApp(t, { status: "CANCELLED", writerRole });
    const reactivated = await lifecycleRequest(cancelled.app, subject, "reactivate", "1");
    assert.equal(reactivated.statusCode, 403);
    assert.equal(cancelled.state.lifecycle_status, "CANCELLED");

    const deleted = await lifecycleApp(t, { status: "DELETED", writerRole });
    const restored = await lifecycleRequest(deleted.app, subject, "restore", "1");
    assert.equal(restored.statusCode, 403);
    assert.equal(deleted.state.lifecycle_status, "DELETED");
  }
});

test("reactivation and restoration require a reason and current record version", async t => {
  const { app, state, queries } = await lifecycleApp(t, { status: "CANCELLED" });
  const missingReason = await lifecycleRequest(app, "master", "reactivate", "1", "  ");
  assert.equal(missingReason.statusCode, 400);
  const stale = await lifecycleRequest(app, "master", "reactivate", "0");
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, "VERSION_CONFLICT");
  const missingVersion = await app.inject({ method: "POST", url: `/api/v1/purchase-orders/${poId}/reactivate`,
    headers: { "x-test-subject": "master" }, payload: { reason: "Reativação aprovada" } });
  assert.equal(missingVersion.statusCode, 428);
  assert.equal(state.lifecycle_status, "CANCELLED");
  assert.equal(queries.some(query => query.sql.includes("SET lifecycle_status")), false);
});

test("reactivation and restoration audit the previous status, clear active metadata, and emit outbox events", async t => {
  for (const [subject, action, status, reason, operation] of [
    ["master", "reactivate", "CANCELLED", "Reativação auditada", "REACTIVATE"],
    ["admin", "restore", "DELETED", "Restauração auditada", "RESTORE"],
  ]) {
    const { app, queries } = await lifecycleApp(t, { status });
    const response = await lifecycleRequest(app, subject, action, "1", reason);
    assert.equal(response.statusCode, 200, response.body);
    const audit = queries.find(query => query.sql.includes("INSERT INTO audit.audit_log"));
    assert.ok(audit);
    assert.equal(audit.params[5], operation);
    assert.equal(audit.params[9], reason);
    assert.equal(JSON.parse(audit.params[6]).lifecycle_status, status);
    const after = JSON.parse(audit.params[7]);
    assert.equal(after.lifecycle_status, "ACTIVE");
    assert.equal(after.lifecycle_changed_at, null);
    assert.equal(after.lifecycle_changed_by, null);
    assert.equal(after.lifecycle_reason, null);
    const outbox = queries.find(query => query.sql.includes("INSERT INTO audit.outbox_message"));
    assert.ok(outbox);
    assert.equal(outbox.params[1], `comex.purchase_order.${operation.toLowerCase()}`);
  }
});

test("purchase order list filters lifecycle while keeping deleted rows hidden by default", async t => {
  const captured = [];
  const pool = {
    async query(sql, params = []) {
      captured.push({ sql, params });
      if (sql.includes("WITH filtered AS MATERIALIZED")) {
        return { rows: [{ total_count: 0, items: [] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authorizationContext", null);
  app.addHook("preHandler", async request => { request.authorizationContext = { importerScopes: ["ELETRA MATRIZ"] }; });
  await registerPurchaseOrderReadRoutes(app, pool);

  for (const lifecycle of ["active", "cancelled", "closed", "deleted", "all"]) {
    const response = await app.inject({ method: "GET", url: `/api/v1/purchase-orders?lifecycle=${lifecycle}` });
    assert.equal(response.statusCode, 200, response.body);
  }
  const invalid = await app.inject({ method: "GET", url: "/api/v1/purchase-orders?lifecycle=unknown" });
  assert.equal(invalid.statusCode, 400);
  const defaultList = await app.inject({ method: "GET", url: "/api/v1/purchase-orders" });
  assert.equal(defaultList.statusCode, 200, defaultList.body);

  const listQueries = captured.filter(query => query.sql.includes("WITH filtered AS MATERIALIZED"));
  assert.equal(listQueries[0].params[5], "active");
  assert.match(listQueries[0].sql, /po\.lifecycle_status <> 'DELETED'/u);
  assert.match(listQueries[0].sql, /lower\(po\.lifecycle_status\) = \$6::text/u);
  assert.equal(listQueries[4].params[5], "all");
  assert.equal(listQueries.at(-1).params[5], null);
});
