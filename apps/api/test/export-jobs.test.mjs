import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerExportJobRoutes } from "../dist/export-jobs.js";

const actorId = "00000000-0000-4000-8000-000000000001";

async function exportApp(t) {
  const queries = [];
  const client = { async query(sql, params = []) {
    queries.push({ sql, params });
    if (sql.includes("user_active")) return { rows: [{ user_active: 0, total_active: 0 }] };
    return { rows: [], rowCount: 1 };
  }, release() {} };
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("identity.erp_user AS u")) return { rows: [{ role: "Consulta", importer_code: "ELETRA MATRIZ" }] };
      if (sql.includes("FROM jobs.export_job")) {
        return { rows: [{ id: "00000000-0000-4000-8000-000000000051", job_type: "purchase-order-lines-xlsx",
          status: "queued", importer_scopes: ["ELETRA MATRIZ"], requested_as_master: false, error_code: null,
          created_at: new Date("2026-10-23T10:00:00Z"), expires_at: null }] };
      }
      return { rows: [] };
    },
    async connect() { return client; },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    request.authContext = { issuer: "ci", subject: "reader", userId: actorId, displayName: null, sessionToken: "ci" };
  });
  await registerExportJobRoutes(app, pool);
  return { app, queries };
}

test("product line exports are queued with the carteira filters", async t => {
  const { app, queries } = await exportApp(t);
  const invalid = await app.inject({ method: "POST", url: "/api/v1/exports/purchase-order-lines",
    payload: { status: "QUALQUER" } });
  assert.equal(invalid.statusCode, 400, invalid.body);
  const queued = await app.inject({ method: "POST", url: "/api/v1/exports/purchase-order-lines",
    payload: { ipNumber: "IP-1", status: "AGUARDANDO CHEGADA" } });
  assert.equal(queued.statusCode, 202, queued.body);
  const insert = queries.find(query => query.sql.includes("INSERT INTO jobs.export_job"));
  assert.match(insert.sql, /'purchase-order-lines-xlsx'/u);
  assert.deepEqual(JSON.parse(insert.params[4]), { ipNumber: "IP-1", status: "AGUARDANDO CHEGADA", situation: "open" });
});

test("recent exports list both PO and product line exports with their type", async t => {
  const { app, queries } = await exportApp(t);
  const response = await app.inject({ method: "GET", url: "/api/v1/exports" });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().items[0].jobType, "purchase-order-lines-xlsx");
  const list = queries.find(query => query.sql.includes("FROM jobs.export_job"));
  assert.match(list.sql, /job_type IN \('purchase-order-xlsx', 'purchase-order-lines-xlsx'\)/u);
});
