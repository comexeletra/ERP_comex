import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerRequestRoutes } from "../dist/requests.js";

const requestId = "00000000-0000-4000-8000-000000000101";
const itemId = "00000000-0000-4000-8000-000000000102";
const importer = "ELETRA MATRIZ";
const access = {
  requester: [{ role: "Importação", importer_code: importer }],
  reader: [{ role: "Consulta", importer_code: importer }],
  other: [{ role: "Importação", importer_code: "ELETRA FOR" }],
};
const baseBody = { importer, requesterReference: "Equipe de importação", reason: "Reposição solicitada pela área usuária.",
  notes: "Entrega prevista para o segundo semestre.", items: [{ description: "Conjunto de vedação", purposeText: "Manutenção", costCenterText: "CC-12" }] };
const headers = (subject, key) => ({ ...(subject ? { "x-test-subject": subject } : {}),
  "idempotency-key": key, "content-type": "application/json" });

async function createApp({ failOutbox = false } = {}) {
  const state = { committed: null, receipt: null, queries: [], commits: 0, rollbacks: 0, listSql: "" };
  const pool = {
    async query(sql, values = []) {
      if (sql.includes("identity.erp_user_role")) return { rows: access[values[1]] ?? [] };
      if (sql.includes("SELECT DISTINCT importer FROM procurement.purchase_order")) return { rows: [{ importer }] };
      state.listSql = sql;
      return { rows: [{ total_count: state.committed ? 1 : 0, items: state.committed ? [state.committed.request] : [] }] };
    },
    async connect() {
      const stage = { request: null, lines: [], receipt: null };
      return {
        async query(sql, values = []) {
          state.queries.push({ sql, values });
          if (sql === "BEGIN" || sql.includes("pg_advisory_xact_lock")) return { rows: [] };
          if (sql.includes("FROM procurement.import_request_command_receipt")) {
            const receipt = state.receipt?.actor === values[0] && state.receipt?.key === values[1] ? state.receipt : null;
            return { rowCount: receipt ? 1 : 0, rows: receipt ? [{ payload_sha256: receipt.hash, request_id: receipt.id }] : [] };
          }
          if (sql.includes("SELECT * FROM procurement.import_request WHERE id = $1")) {
            const request = state.committed?.request;
            return { rowCount: request?.id === values[0] && values[1].includes(request.importer) ? 1 : 0,
              rows: request?.id === values[0] && values[1].includes(request.importer) ? [request] : [] };
          }
          if (sql.includes("SELECT importer FROM procurement.purchase_order")) return { rowCount: 1, rows: [{ importer }] };
          if (sql.includes("SELECT 'SR-'")) return { rows: [{ request_number: "SR-2026-000001" }] };
          if (sql.includes("INSERT INTO procurement.import_request\n")) {
            stage.request = { id: values[0], request_number: values[1], importer: values[2], requester_reference: values[3],
              reason: values[4], notes: values[5], status: "SUBMITTED", version: "1", created_at: new Date(), updated_at: new Date() };
            return { rows: [stage.request], rowCount: 1 };
          }
          if (sql.includes("INSERT INTO procurement.import_request_item")) {
            const line = { id: values[0], request_id: values[1], line_number: values[2], description: values[3],
              purpose_text: values[4], cost_center_text: values[5], created_at: new Date() };
            stage.lines.push(line); return { rows: [line], rowCount: 1 };
          }
          if (sql.includes("INSERT INTO procurement.import_request_command_receipt")) {
            stage.receipt = { actor: values[0], key: values[1], hash: values[2], id: values[3] }; return { rows: [], rowCount: 1 };
          }
          if (sql.includes("INSERT INTO audit.audit_log")) return { rows: [], rowCount: 1 };
          if (sql.includes("INSERT INTO audit.outbox_message")) {
            if (failOutbox) throw new Error("simulated outbox failure");
            return { rows: [], rowCount: 1 };
          }
          if (sql.includes("FROM procurement.import_request_item")) return { rows: state.committed?.lines ?? [] };
          if (sql === "COMMIT") {
            state.commits += 1;
            if (stage.request) state.committed = { request: stage.request, lines: stage.lines };
            if (stage.receipt) state.receipt = stage.receipt;
            return { rows: [] };
          }
          if (sql === "ROLLBACK") { state.rollbacks += 1; return { rows: [] }; }
          throw new Error(`Unexpected SQL: ${sql}`);
        }, release() {},
      };
    },
  };
  const app = Fastify();
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    const subject = request.headers["x-test-subject"];
    if (typeof subject === "string") request.authContext = { issuer: "test", subject, userId: `user:${subject}`, sessionToken: "test-only" };
  });
  await registerRequestRoutes(app, pool);
  return { app, state };
}

async function createUpdateApp({ status = "SUBMITTED", version = "1", failOutbox = false } = {}) {
  const request = { id: requestId, request_number: "SR-2026-000001", importer, source_kind: "NATIVE",
    requester_reference: "Equipe de importação", reason: "Reposição solicitada pela área usuária.", notes: "",
    status, version, created_at: new Date(), updated_at: new Date() };
  const lines = [
    { id: "00000000-0000-4000-8000-000000000201", request_id: requestId, line_number: 1,
      description: "Primeiro item", source_kind: "NATIVE", purpose_text: null, cost_center_text: null, created_at: new Date() },
    { id: "00000000-0000-4000-8000-000000000202", request_id: requestId, line_number: 2,
      description: "Segundo item", source_kind: "NATIVE", purpose_text: null, cost_center_text: null, created_at: new Date() },
  ];
  const state = { request, lines, calls: [], commits: 0, rollbacks: 0 };
  const pool = {
    async query(sql, values = []) {
      if (sql.includes("identity.erp_user_role")) return { rows: access[values[1]] ?? [] };
      return { rows: [] };
    },
    async connect() {
      const stage = { request: { ...state.request }, lines: state.lines.map(item => ({ ...item })) };
      return {
        async query(sql, values = []) {
          state.calls.push({ sql, values });
          if (sql === "BEGIN") return { rows: [] };
          if (sql.startsWith("SELECT * FROM procurement.import_request\n")) {
            const visible = state.request.id === values[0] && values[1].includes(state.request.importer);
            return { rows: visible ? [{ ...stage.request }] : [], rowCount: visible ? 1 : 0 };
          }
          if (sql.startsWith("SELECT * FROM procurement.import_request_item WHERE request_id")) {
            return { rows: stage.lines.sort((a, b) => a.line_number - b.line_number).map(item => ({ ...item })) };
          }
          if (sql.startsWith("UPDATE procurement.import_request\n")) {
            stage.request = { ...stage.request, requester_reference: values[1], reason: values[2], notes: values[3],
              version: String(Number(stage.request.version) + 1), updated_at: new Date() };
            return { rows: [{ ...stage.request }], rowCount: 1 };
          }
          if (sql.startsWith("UPDATE procurement.import_request_item SET line_number = line_number + 1000")) {
            stage.lines = stage.lines.map(item => ({ ...item, line_number: item.line_number + 1000 }));
            return { rows: [], rowCount: stage.lines.length };
          }
          if (sql.startsWith("UPDATE procurement.import_request_item\n")) {
            const item = stage.lines.find(value => value.id === values[0] && value.request_id === values[1]);
            Object.assign(item, { line_number: values[2], description: values[3], purpose_text: values[4], cost_center_text: values[5] });
            return { rows: [], rowCount: item ? 1 : 0 };
          }
          if (sql.startsWith("INSERT INTO procurement.import_request_item")) {
            stage.lines.push({ id: values[0], request_id: values[1], line_number: values[2], description: values[3],
              source_kind: "NATIVE", purpose_text: values[4], cost_center_text: values[5], created_at: new Date() });
            return { rows: [], rowCount: 1 };
          }
          if (sql.startsWith("DELETE FROM procurement.import_request_item")) {
            stage.lines = stage.lines.filter(item => values[1].includes(item.id));
            return { rows: [], rowCount: 0 };
          }
          if (sql.startsWith("INSERT INTO audit.audit_log")) return { rows: [], rowCount: 1 };
          if (sql.startsWith("INSERT INTO audit.outbox_message")) {
            if (failOutbox) throw new Error("simulated outbox failure");
            return { rows: [], rowCount: 1 };
          }
          if (sql === "COMMIT") {
            state.commits += 1; state.request = stage.request; state.lines = stage.lines;
            return { rows: [] };
          }
          if (sql === "ROLLBACK") { state.rollbacks += 1; return { rows: [] }; }
          throw new Error(`Unexpected SQL: ${sql}`);
        }, release() {},
      };
    },
  };
  const app = Fastify();
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    const subject = request.headers["x-test-subject"];
    if (typeof subject === "string") request.authContext = { issuer: "test", subject, userId: `user:${subject}`, sessionToken: "test-only" };
  });
  await registerRequestRoutes(app, pool);
  return { app, state };
}

test("request creation is scoped, idempotent, versioned and audited with outbox", async t => {
  const { app, state } = await createApp(); t.after(() => app.close());
  const url = "/api/v1/requests";
  const first = await app.inject({ method: "POST", url, headers: headers("requester", "request-1"), payload: baseBody });
  const replay = await app.inject({ method: "POST", url, headers: headers("requester", "request-1"), payload: baseBody });
  const conflict = await app.inject({ method: "POST", url, headers: headers("requester", "request-1"), payload: { ...baseBody, reason: "Outra justificativa diferente." } });
  assert.equal(first.statusCode, 201);
  assert.equal(first.headers.etag, '"1"');
  assert.equal(first.json().requestNumber, "SR-2026-000001");
  assert.equal(first.json().items[0].description, baseBody.items[0].description);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().id, first.json().id);
  assert.equal(conflict.statusCode, 409);
  assert.equal(state.commits, 3);
  assert.ok(state.queries.some(({ sql }) => sql.includes("INSERT INTO audit.audit_log")));
  assert.ok(state.queries.some(({ sql }) => sql.includes("INSERT INTO audit.outbox_message")));
});

test("request writes require role, scope, required reason, item and idempotency key", async t => {
  const { app, state } = await createApp(); t.after(() => app.close());
  const url = "/api/v1/requests";
  const unauth = await app.inject({ method: "POST", url, headers: headers(undefined, "a"), payload: baseBody });
  const reader = await app.inject({ method: "POST", url, headers: headers("reader", "b"), payload: baseBody });
  const hidden = await app.inject({ method: "POST", url, headers: headers("other", "c"), payload: baseBody });
  const invalid = await app.inject({ method: "POST", url, headers: headers("requester", "d"), payload: { ...baseBody, reason: "bad", items: [] } });
  assert.equal(unauth.statusCode, 401);
  assert.equal(reader.statusCode, 403);
  assert.equal(hidden.statusCode, 404);
  assert.equal(invalid.statusCode, 400);
  assert.equal(state.commits, 0);
});

test("failed transactional outbox rolls request and items back", async t => {
  const { app, state } = await createApp({ failOutbox: true }); t.after(() => app.close());
  const response = await app.inject({ method: "POST", url: "/api/v1/requests", headers: headers("requester", "rollback"), payload: baseBody });
  assert.equal(response.statusCode, 500);
  assert.equal(state.commits, 0);
  assert.equal(state.rollbacks, 1);
  assert.equal(state.committed, null);
});

test("request edit enforces importer scope, submitted state and If-Match", async t => {
  const { app, state } = await createUpdateApp(); t.after(() => app.close());
  const payload = { requesterReference: "Equipe revisada", reason: "Reposição atualizada pela área usuária.", notes: "Alterado",
    items: [
      { id: state.lines[1].id, description: "Segundo item revisado", purposeText: "Produção" },
      { id: state.lines[0].id, description: "Primeiro item revisado" },
      { description: "Novo item" },
    ] };
  const response = await app.inject({ method: "PATCH", url: `/api/v1/requests/${requestId}`,
    headers: { ...headers("requester", "unused"), "if-match": '"1"' }, payload });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.etag, '"2"');
  assert.deepEqual(response.json().items.map(item => item.description), ["Segundo item revisado", "Primeiro item revisado", "Novo item"]);
  assert.equal(state.request.version, "2");
  assert.equal(state.commits, 1);
  assert.ok(state.calls.some(({ sql }) => sql.includes("INSERT INTO audit.audit_log")));
  assert.ok(state.calls.some(({ sql }) => sql.includes("INSERT INTO audit.outbox_message")));

  const stale = await app.inject({ method: "PATCH", url: `/api/v1/requests/${requestId}`,
    headers: { ...headers("requester", "unused"), "if-match": '"1"' }, payload });
  const otherScope = await app.inject({ method: "PATCH", url: `/api/v1/requests/${requestId}`,
    headers: { ...headers("other", "unused"), "if-match": '"2"' }, payload });
  assert.equal(stale.statusCode, 409);
  assert.equal(otherScope.statusCode, 404);
  assert.equal(state.commits, 1);
});

test("request edit refuses missing If-Match, readers and non-submitted status", async t => {
  const { app } = await createUpdateApp({ status: "APPROVED" }); t.after(() => app.close());
  const payload = { requesterReference: "Equipe revisada", reason: "Reposição atualizada pela área usuária.", notes: "",
    items: [{ id: "00000000-0000-4000-8000-000000000201", description: "Primeiro item" }] };
  const missing = await app.inject({ method: "PATCH", url: `/api/v1/requests/${requestId}`,
    headers: headers("requester", "unused"), payload });
  const reader = await app.inject({ method: "PATCH", url: `/api/v1/requests/${requestId}`,
    headers: { ...headers("reader", "unused"), "if-match": '"1"' }, payload });
  const approved = await app.inject({ method: "PATCH", url: `/api/v1/requests/${requestId}`,
    headers: { ...headers("requester", "unused"), "if-match": '"1"' }, payload });
  assert.equal(missing.statusCode, 428);
  assert.equal(reader.statusCode, 403);
  assert.equal(approved.statusCode, 409);
  assert.equal(approved.json().code, "REQUEST_NOT_EDITABLE");
});

test("request edit rolls back item and request changes when outbox fails", async t => {
  const { app, state } = await createUpdateApp({ failOutbox: true }); t.after(() => app.close());
  const payload = { requesterReference: "Equipe revisada", reason: "Reposição atualizada pela área usuária.", notes: "Alterado",
    items: [{ id: state.lines[0].id, description: "Primeiro item revisado" }] };
  const response = await app.inject({ method: "PATCH", url: `/api/v1/requests/${requestId}`,
    headers: { ...headers("requester", "unused"), "if-match": '"1"' }, payload });
  assert.equal(response.statusCode, 500);
  assert.equal(state.commits, 0);
  assert.equal(state.rollbacks, 1);
  assert.equal(state.request.version, "1");
  assert.equal(state.lines.length, 2);
});
