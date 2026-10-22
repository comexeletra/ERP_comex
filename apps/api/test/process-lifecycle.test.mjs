import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerOperationalRoutes } from "../dist/operations.js";
import { registerProcessReadRoutes } from "../dist/processes.js";

const processId = "00000000-0000-4000-8000-000000000031";
const poId = "00000000-0000-4000-8000-000000000032";
const deletedTargetId = "00000000-0000-4000-8000-000000000033";

function roleFor(subject, writerRole = "Importação") {
  if (subject === "master") return "Master";
  if (subject === "admin") return "Administrador";
  if (subject === "reader") return "Consulta";
  return writerRole;
}

async function operationalApp(t, client, { writerRole = "Importação" } = {}) {
  const pool = {
    async query(sql, params = []) {
      if (sql.includes("FROM identity.erp_user AS u")) {
        return { rows: [{ role: roleFor(params[1], writerRole), importer_code: "ELETRA MATRIZ" }], rowCount: 1 };
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
      issuer: "ci", subject, userId: `user:${subject}`, displayName: null, sessionToken: "ci",
    };
  });
  await registerOperationalRoutes(app, pool);
  return app;
}

function lifecycleState({ recordStatus = "ACTIVE", lifecycleStatus = "OPEN", version = "1",
  beforeDeleteStatus = "ACTIVE" } = {}) {
  return {
    id: processId, importer: "ELETRA MATRIZ", ip_number: "IP-LIFECYCLE-TEST", normalized_ip_number: "IP-LIFECYCLE-TEST",
    record_status: recordStatus, lifecycle_status: lifecycleStatus,
    logistics_status: recordStatus === "CANCELLED" ? "CANCELLED" : recordStatus === "ACTIVE" ? "WAITING SHIPMENT" : null,
    version, deleted_at: recordStatus === "DELETED" ? "2026-10-22T12:00:00Z" : null,
    deleted_by: recordStatus === "DELETED" ? "ci#previous" : null,
    delete_reason: recordStatus === "DELETED" ? "Exclusão anterior" : null,
    record_status_before_delete: recordStatus === "DELETED" ? beforeDeleteStatus : null,
  };
}

async function lifecycleApp(t, options = {}) {
  const { dependencies = {}, ...stateOptions } = options;
  const state = lifecycleState(stateOptions);
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("SELECT * FROM imports.import_process") && sql.includes("FOR UPDATE")) {
        return { rows: [{ ...state }], rowCount: 1 };
      }
      if (sql.includes("has_active_allocations") && sql.includes("has_active_documents")) {
        return { rows: [{ has_active_allocations: Boolean(dependencies.allocations),
          has_active_documents: Boolean(dependencies.documents), has_linked_purchase_orders: Boolean(dependencies.purchaseOrders) }], rowCount: 1 };
      }
      if (sql.includes("UPDATE imports.import_process SET record_status = 'DELETED'")) {
        state.record_status_before_delete = params[3];
        state.deleted_at = "2026-10-22T12:30:00Z";
        state.deleted_by = params[1];
        state.delete_reason = params[2];
        state.record_status = "DELETED";
        state.version = String(Number(state.version) + 1);
        return { rows: [{ version: state.version, deleted_at: state.deleted_at }], rowCount: 1 };
      }
      if (sql.includes("UPDATE imports.import_process SET record_status = 'ACTIVE'")) {
        state.record_status = "ACTIVE";
        state.lifecycle_status = "OPEN";
        state.logistics_status = null;
        state.version = String(Number(state.version) + 1);
        return { rows: [{ version: state.version }], rowCount: 1 };
      }
      if (sql.includes("UPDATE imports.import_process SET record_status = $2")) {
        state.record_status = params[1];
        state.deleted_at = null;
        state.deleted_by = null;
        state.delete_reason = null;
        state.record_status_before_delete = null;
        state.version = String(Number(state.version) + 1);
        return { rows: [{ version: state.version }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return { app: await operationalApp(t, client, options), client, queries, state };
}

function lifecycleRequest(app, subject, action, version = "1", reason = "Ação aprovada") {
  const method = action === "delete" ? "DELETE" : "POST";
  const suffix = action === "delete" ? "" : `/${action}`;
  return app.inject({ method, url: `/api/v1/processes/${processId}${suffix}`,
    headers: { "x-test-subject": subject, "x-record-version": version }, payload: { reason } });
}

test("IP deletion is logical, versioned, and writes metadata, audit, and outbox", async t => {
  const { app, queries, state } = await lifecycleApp(t);
  const response = await lifecycleRequest(app, "writer", "delete", "1", "IP sem vínculos duplicados");

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { id: processId, recordStatus: "DELETED", version: "2" });
  assert.equal(state.record_status, "DELETED");
  assert.equal(state.record_status_before_delete, "ACTIVE");
  assert.equal(state.deleted_by, "ci#writer");
  assert.equal(state.delete_reason, "IP sem vínculos duplicados");
  assert.ok(state.deleted_at);
  const audit = queries.find(query => query.sql.includes("INSERT INTO audit.audit_log"));
  assert.ok(audit);
  assert.equal(audit.params[5], "SOFT_DELETE");
  assert.equal(audit.params[9], "IP sem vínculos duplicados");
  assert.ok(queries.some(query => query.sql.includes("INSERT INTO audit.outbox_message")
    && query.params[1] === "comex.import_process.soft_delete"));
  assert.equal(queries.some(query => /^\s*DELETE\s+FROM\s+imports\.import_process/iu.test(query.sql)), false);
});

test("IP deletion rejects active allocations, active documents, linked POs, closed IPs, and repeat deletion", async t => {
  for (const dependencies of [{ allocations: true }, { documents: true }, { purchaseOrders: true }]) {
    const blocked = await lifecycleApp(t, { dependencies });
    const response = await lifecycleRequest(blocked.app, "writer", "delete");
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().code, "IP_HAS_DEPENDENCIES");
    assert.equal(blocked.state.record_status, "ACTIVE");
    assert.equal(blocked.queries.some(query => query.sql.includes("UPDATE imports.import_process SET record_status")), false);
    assert.equal(blocked.queries.some(query => query.sql.includes("INSERT INTO audit.audit_log")), false);
  }

  const closed = await lifecycleApp(t, { lifecycleStatus: "CLOSED" });
  const closedResponse = await lifecycleRequest(closed.app, "writer", "delete");
  assert.equal(closedResponse.statusCode, 409);
  assert.equal(closedResponse.json().code, "PROCESS_CLOSED");

  const deleted = await lifecycleApp(t, { recordStatus: "DELETED" });
  const repeated = await lifecycleRequest(deleted.app, "writer", "delete");
  assert.equal(repeated.statusCode, 409);
  assert.equal(repeated.json().code, "PROCESS_ALREADY_DELETED");
});

test("deleting DRAFT and CANCELLED IPs preserves their prior status when restored", async t => {
  for (const recordStatus of ["DRAFT", "CANCELLED"]) {
    const { app, queries, state } = await lifecycleApp(t, { recordStatus });
    const deleted = await lifecycleRequest(app, "writer", "delete");
    assert.equal(deleted.statusCode, 200, deleted.body);
    assert.equal(state.record_status_before_delete, recordStatus);

    const restored = await lifecycleRequest(app, "master", "restore", "2", "Restauração de teste");
    assert.equal(restored.statusCode, 200, restored.body);
    assert.deepEqual(restored.json(), { id: processId, recordStatus, version: "3" });
    assert.equal(state.record_status, recordStatus);
    assert.equal(state.deleted_at, null);
    assert.equal(state.deleted_by, null);
    assert.equal(state.delete_reason, null);
    assert.equal(state.record_status_before_delete, null);
    const audit = queries.filter(query => query.sql.includes("INSERT INTO audit.audit_log"));
    assert.equal(audit.at(-1).params[5], "RESTORE");
  }
});

test("only lifecycle managers can restore or reactivate; reactivation returns a cancelled IP empty and open", async t => {
  for (const subject of ["master", "admin"]) {
    const deleted = await lifecycleApp(t, { recordStatus: "DELETED", beforeDeleteStatus: "CANCELLED" });
    const restored = await lifecycleRequest(deleted.app, subject, "restore");
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal(restored.json().recordStatus, "CANCELLED");

    const cancelled = await lifecycleApp(t, { recordStatus: "CANCELLED" });
    const reactivated = await lifecycleRequest(cancelled.app, subject, "reactivate");
    assert.equal(reactivated.statusCode, 200, reactivated.body);
    assert.deepEqual(reactivated.json(), { id: processId, recordStatus: "ACTIVE", version: "2" });
    assert.equal(cancelled.state.record_status, "ACTIVE");
    assert.equal(cancelled.state.lifecycle_status, "OPEN");
    assert.equal(cancelled.state.logistics_status, null);
    assert.ok(cancelled.queries.some(query => query.sql.includes("has_linked_purchase_orders")));
    const audit = cancelled.queries.find(query => query.sql.includes("INSERT INTO audit.audit_log"));
    assert.equal(audit.params[5], "REACTIVATE");
    assert.ok(cancelled.queries.some(query => query.sql.includes("INSERT INTO audit.outbox_message")
      && query.params[1] === "comex.import_process.reactivate"));
  }

  for (const action of ["restore", "reactivate"]) {
    const denied = await lifecycleApp(t, { recordStatus: action === "restore" ? "DELETED" : "CANCELLED" });
    const response = await lifecycleRequest(denied.app, "writer", action);
    assert.equal(response.statusCode, 403);
    assert.equal(denied.state.record_status, action === "restore" ? "DELETED" : "CANCELLED");
  }
});

test("reactivation and restoration require their exact source state, a reason, and a current version", async t => {
  for (const [recordStatus, action, code] of [
    ["ACTIVE", "reactivate", "IP_NOT_CANCELLED"],
    ["DRAFT", "reactivate", "IP_NOT_CANCELLED"],
    ["CANCELLED", "restore", "IP_NOT_DELETED"],
    ["ACTIVE", "restore", "IP_NOT_DELETED"],
  ]) {
    const { app } = await lifecycleApp(t, { recordStatus });
    const response = await lifecycleRequest(app, "master", action);
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().code, code);
  }

  const { app, queries, state } = await lifecycleApp(t, { recordStatus: "CANCELLED" });
  assert.equal((await lifecycleRequest(app, "master", "reactivate", "1", " ")).statusCode, 400);
  assert.equal((await lifecycleRequest(app, "master", "reactivate", "0")).json().code, "VERSION_CONFLICT");
  const noVersion = await app.inject({ method: "POST", url: `/api/v1/processes/${processId}/reactivate`,
    headers: { "x-test-subject": "master" }, payload: { reason: "Reativação aprovada" } });
  assert.equal(noVersion.statusCode, 428);
  assert.equal(state.record_status, "CANCELLED");
  assert.equal(queries.some(query => query.sql.includes("UPDATE imports.import_process SET record_status")), false);
});

test("process list hides deleted IPs by default and supports recordStatus filters; details expose delete metadata", async t => {
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("WITH filtered AS MATERIALIZED")) return { rows: [{ total_count: 0, items: [] }] };
      return { rows: [{ item: { id: processId, deletedAt: "2026-10-22T12:00:00Z", deletedBy: "ci#master",
        deleteReason: "Restauração pendente" } }], rowCount: 1 };
    },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authorizationContext", null);
  app.addHook("preHandler", async request => { request.authorizationContext = { importerScopes: ["ELETRA MATRIZ"] }; });
  await registerProcessReadRoutes(app, pool);

  for (const [query, parameter] of [["", null], ["?recordStatus=active", "active"],
    ["?recordStatus=draft", "draft"], ["?recordStatus=cancelled", "cancelled"],
    ["?recordStatus=deleted", "deleted"], ["?recordStatus=all", "all"]]) {
    const response = await app.inject({ method: "GET", url: `/api/v1/processes${query}` });
    assert.equal(response.statusCode, 200, response.body);
    const call = queries.at(-1);
    assert.match(call.sql, /record_status <> 'DELETED'/u);
    assert.equal(call.params[5], parameter);
  }
  const detail = await app.inject({ method: "GET", url: `/api/v1/processes/${processId}` });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().deletedAt, "2026-10-22T12:00:00Z");
  assert.equal(detail.json().deletedBy, "ci#master");
  assert.equal(detail.json().deleteReason, "Restauração pendente");
  assert.match(queries.at(-1).sql, /'deletedAt', process\.deleted_at/u);
  assert.match(queries.at(-1).sql, /'deletedBy', process\.deleted_by/u);
  assert.match(queries.at(-1).sql, /'deleteReason', process\.delete_reason/u);
});

test("cancellation cannot route a PO to a deleted IP", async t => {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("SELECT * FROM imports.import_process WHERE id = $1")) {
        return { rows: [{ id: processId, importer: "ELETRA MATRIZ", ip_number: "IP-CURRENT",
          record_status: "ACTIVE", lifecycle_status: "OPEN", version: "1" }], rowCount: 1 };
      }
      if (sql.includes("SELECT po.id AS purchase_order_id")) {
        return { rows: [{ purchase_order_id: poId, number: "PO-1", lifecycle_status: "ACTIVE" }], rowCount: 1 };
      }
      if (sql.includes("SELECT id, importer, record_status, lifecycle_status FROM imports.import_process")) {
        return { rows: [{ id: deletedTargetId, importer: "ELETRA MATRIZ", record_status: "DELETED", lifecycle_status: "OPEN" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const app = await operationalApp(t, client);
  const response = await app.inject({ method: "POST", url: `/api/v1/processes/${processId}/cancel`,
    headers: { "x-test-subject": "writer", "x-record-version": "1" },
    payload: { reason: "Encaminhar PO", purchaseOrders: [
      { purchaseOrderId: poId, destinationType: "EXISTING", processId: deletedTargetId },
    ] },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, "DELETED_IP_REFERENCE");
  assert.equal(queries.some(query => query.sql.includes("SET record_status = 'CANCELLED'")), false);
});

test("a deleted IP cannot be cancelled or have POs routed", async t => {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("SELECT * FROM imports.import_process WHERE id = $1")) {
        return { rows: [{ id: processId, importer: "ELETRA MATRIZ", record_status: "DELETED",
          lifecycle_status: "OPEN", version: "1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const app = await operationalApp(t, client);
  const response = await app.inject({ method: "POST", url: `/api/v1/processes/${processId}/cancel`,
    headers: { "x-test-subject": "writer", "x-record-version": "1" },
    payload: { reason: "Não alterar IP excluído", purchaseOrders: [] },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, "DELETED_IP_REFERENCE");
  assert.equal(queries.some(query => query.sql.includes("SET record_status = 'CANCELLED'")), false);
});

test("manual IP creation refuses a number reserved by a deleted IP", async t => {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("SELECT payload_sha256")) return { rows: [], rowCount: 0 };
      if (sql.includes("UNION SELECT importer FROM imports.import_process")) return { rows: [{ importer: "ELETRA MATRIZ" }], rowCount: 1 };
      if (sql.includes("normalized_ip_number") && sql.includes("FROM imports.import_process")) {
        return { rows: [{ id: deletedTargetId, importer: "ELETRA MATRIZ", record_status: "DELETED" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const app = await operationalApp(t, client);
  const response = await app.inject({ method: "POST", url: "/api/v1/processes",
    headers: { "x-test-subject": "writer", "idempotency-key": "create-deleted-ip-reference" },
    payload: { importer: "ELETRA MATRIZ", ipNumber: "IP-DELETED", supplierText: "Supplier",
      logisticsStatus: null, priority: null, notes: "", reason: "Criação manual" },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, "DELETED_IP_REFERENCE");
  assert.equal(queries.some(query => query.sql.includes("INSERT INTO imports.import_process")), false);
});
