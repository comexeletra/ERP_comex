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
