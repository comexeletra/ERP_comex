import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerCatalogRoutes } from "../dist/catalog.js";

const entryId = "00000000-0000-4000-8000-000000000101";
const importer = "ELETRA MATRIZ";

async function createApp() {
  const state = { visibilityChecks: 0, historyReads: 0 };
  const pool = {
    async query(sql, values = []) {
      if (sql.includes("identity.erp_user_role")) {
        const subject = values[1];
        if (subject === "no-permission") return { rows: [{ role: "none", importer_code: importer }] };
        return { rows: [{ role: "Consulta", importer_code: subject === "hidden" ? "OUTRO" : importer }] };
      }
      if (sql.includes("SELECT id FROM catalog.entry")) {
        state.visibilityChecks += 1;
        assert.deepEqual(values.slice(0, 2), [entryId, "SUPPLIER"]);
        return values[2].includes(importer) ? { rows: [{ id: entryId }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("audit.catalog_entry_history")) {
        state.historyReads += 1;
        assert.deepEqual(values, [entryId, 25, 0]);
        return { rows: [{ total_count: 1, items: [{
          id: "event-1", operation: "UPDATE", field_name: "name",
          old_value: "Fornecedor antigo", new_value: "Fornecedor atual",
          actor_id: "local#buyer", occurred_at: "2026-10-03T12:00:00Z", reason: "Cadastro aprovado",
        }] }] };
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
  await registerCatalogRoutes(app, pool);
  return { app, state };
}

test("catalog history enforces permission and importer scope before reading events", async t => {
  const { app, state } = await createApp();
  t.after(() => app.close());
  const url = `/api/v1/suppliers/${entryId}/history`;
  const get = (target, subject) => app.inject({ method: "GET", url: target,
    headers: subject ? { "x-test-subject": subject } : {} });

  assert.equal((await get(url)).statusCode, 401);
  assert.equal((await get(url, "no-permission")).statusCode, 403);
  assert.equal((await get(url, "hidden")).statusCode, 404);
  assert.equal((await get(`/api/v1/suppliers/not-a-uuid/history`, "reader")).statusCode, 400);
  assert.equal((await get(`${url}?page=0`, "reader")).statusCode, 400);
  assert.equal(state.historyReads, 0);
  assert.equal(state.visibilityChecks, 1);

  const visible = await get(url, "reader");
  assert.equal(visible.statusCode, 200, visible.body);
  assert.deepEqual(visible.json(), {
    page: 1, pageSize: 25, totalCount: 1,
    items: [{ id: "event-1", operation: "UPDATE", fieldName: "name",
      oldValue: "Fornecedor antigo", newValue: "Fornecedor atual", actor: "local#buyer",
      occurredAt: "2026-10-03T12:00:00Z", reason: "Cadastro aprovado" }],
  });
  assert.equal(state.visibilityChecks, 2);
  assert.equal(state.historyReads, 1);
});
