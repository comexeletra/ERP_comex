import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerRequestRoutes } from "../dist/requests.js";

const requestId = "00000000-0000-4000-8000-000000000101";
const importer = "ELETRA MATRIZ";

async function createApp() {
  const state = { historyReads: 0, visibilityChecks: 0 };
  const pool = {
    async query(sql, values = []) {
      if (sql.includes("identity.erp_user_role")) {
        return { rows: [{ role: "Importação", importer_code: values[1] === "hidden" ? "OUTRO" : importer }] };
      }
      if (sql.includes("SELECT id FROM procurement.import_request")) {
        state.visibilityChecks += 1;
        return { rows: values[0] === requestId && values[1].includes(importer) ? [{ id: requestId }] : [] };
      }
      if (sql.includes("audit.import_request_history")) {
        state.historyReads += 1;
        assert.deepEqual(values, [requestId, 25, 0]);
        return { rows: [{ total_count: 2, items: [
          { id: "event-2", operation: "UPDATE", field_name: "request",
            old_value: { requesterReference: "Antes", reason: "Motivo inicial", notes: "", items: [{ description: "A" }] },
            new_value: { requesterReference: "Depois", reason: "Motivo inicial", notes: "", items: [{ description: "B" }] },
            actor_id: "local#editor", occurred_at: "2026-10-02T12:00:00Z", reason: "Atualização" },
          { id: "event-1", operation: "CREATE", field_name: null, old_value: null,
            new_value: { requesterReference: "Antes" }, actor_id: "local#editor",
            occurred_at: "2026-10-01T12:00:00Z", reason: "Criação" },
        ] }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const app = Fastify();
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    const subject = request.headers["x-test-subject"];
    if (typeof subject === "string") request.authContext = {
      issuer: "test", subject, userId: `user:${subject}`, sessionToken: "test-only",
    };
  });
  await registerRequestRoutes(app, pool);
  return { app, state };
}

test("request history checks importer scope before reading audit and summarizes changes", async t => {
  const { app, state } = await createApp();
  t.after(() => app.close());
  const url = `/api/v1/requests/${requestId}/history`;
  const anonymous = await app.inject({ method: "GET", url });
  const hidden = await app.inject({ method: "GET", url, headers: { "x-test-subject": "hidden" } });
  const invalid = await app.inject({ method: "GET", url: `${url}?page=0`, headers: { "x-test-subject": "reader" } });
  assert.equal(anonymous.statusCode, 401);
  assert.equal(hidden.statusCode, 404);
  assert.equal(invalid.statusCode, 400);
  assert.equal(state.historyReads, 0);

  const visible = await app.inject({ method: "GET", url, headers: { "x-test-subject": "reader" } });
  assert.equal(visible.statusCode, 200);
  assert.equal(visible.json().totalCount, 2);
  assert.deepEqual(visible.json().items[0].changedFields, ["Solicitante", "Itens"]);
  assert.deepEqual(visible.json().items[1].changedFields, ["Criação"]);
  assert.equal(visible.json().items[0].oldValue, undefined);
  assert.equal(state.historyReads, 1);
  assert.equal(state.visibilityChecks, 2);
});
