import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerCatalogRoutes } from "../dist/catalog.js";

const valueId = "00000000-0000-4000-8000-000000000146";

async function createApp({ entity = "CATEGORY", code = null, value = "Acessórios", inUse = false } = {}) {
  const state = { deleted: false, rollback: false, audit: null, outbox: null };
  const client = {
    async query(sql, parameters = []) {
      if (sql === "BEGIN") return { rows: [] };
      if (sql === "COMMIT") return { rows: [] };
      if (sql === "ROLLBACK") { state.rollback = true; return { rows: [] }; }
      if (sql.includes("SELECT entity_key, code, value FROM catalog.operational_value")) {
        return { rows: [{ entity_key: entity, code, value }], rowCount: 1 };
      }
      if (sql.includes("SELECT EXISTS (")) return { rows: [{ in_use: inUse }], rowCount: 1 };
      if (sql.includes("DELETE FROM catalog.operational_value")) {
        state.deleted = true;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO audit.audit_log")) { state.audit = { sql, parameters }; return { rows: [] }; }
      if (sql.includes("INSERT INTO audit.outbox_message")) { state.outbox = { sql, parameters }; return { rows: [] }; }
      throw new Error(`Unexpected client SQL: ${sql}`);
    },
    release() {},
  };
  const pool = {
    async query(sql) {
      if (sql.includes("FROM identity.erp_user AS u")) {
        return { rows: [{ role: "Compras", importer_code: "ELETRA CWB" }] };
      }
      throw new Error(`Unexpected pool SQL: ${sql}`);
    },
    async connect() { return client; },
  };
  const app = Fastify();
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    if (request.headers["x-test-subject"]) request.authContext = {
      issuer: "test", subject: "buyer", userId: "buyer-id", sessionToken: "test-only",
    };
  });
  await registerCatalogRoutes(app, pool);
  return { app, state };
}

test("deleting an operational value records audit and outbox and removes only the option", async t => {
  const { app, state } = await createApp();
  t.after(() => app.close());
  const response = await app.inject({ method: "DELETE", url: `/api/v1/operational-values/${valueId}`,
    headers: { "x-test-subject": "buyer" }, payload: { expectedValue: "Acessórios", reason: "Valor obsoleto revisado" } });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { id: valueId, entity: "category", deleted: true });
  assert.equal(state.deleted, true);
  assert.match(state.audit.sql, /'DELETE','value'/u);
  assert.equal(JSON.parse(state.audit.parameters[2]).value, "Acessórios");
  assert.match(state.outbox.sql, /catalog\.operational_value\.deleted/u);
});

test("deleting an operational value rejects stale values", async t => {
  const { app, state } = await createApp();
  t.after(() => app.close());
  const response = await app.inject({ method: "DELETE", url: `/api/v1/operational-values/${valueId}`,
    headers: { "x-test-subject": "buyer" }, payload: { expectedValue: "Valor antigo", reason: "Valor obsoleto revisado" } });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, "STALE_OPERATIONAL_VALUE");
  assert.equal(state.rollback, true);
  assert.equal(state.deleted, false);
  assert.equal(state.audit, null);
});

test("deleting an importer is blocked while it is referenced", async t => {
  const { app, state } = await createApp({ entity: "IMPORTER", value: "ELETRA CWB", inUse: true });
  t.after(() => app.close());
  const response = await app.inject({ method: "DELETE", url: `/api/v1/operational-values/${valueId}`,
    headers: { "x-test-subject": "buyer" }, payload: { expectedValue: "ELETRA CWB", reason: "Importadora obsoleta revisada" } });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, "OPERATIONAL_VALUE_IN_USE");
  assert.equal(state.rollback, true);
  assert.equal(state.deleted, false);
  assert.equal(state.audit, null);
});
