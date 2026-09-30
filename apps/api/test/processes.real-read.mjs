// Run on the VPS against the explicitly selected database in a read-only transaction.
import assert from "node:assert/strict";
import Fastify from "fastify";
import pg from "pg";
import { registerAuthorization } from "../dist/authorization.js";
import { registerProcessReadRoutes } from "../dist/processes.js";

const connectionString = process.env.DATABASE_URL;
const expectedDatabase = process.env.PROCESS_READ_DB;
if (!connectionString || !expectedDatabase || new URL(connectionString).pathname !== `/${expectedDatabase}`) {
  throw new Error("DATABASE_URL and PROCESS_READ_DB must name the same selected database.");
}
const client = new pg.Client({ connectionString });
await client.connect();
let app;
try {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const masterResult = await client.query(`SELECT u.issuer, u.subject, u.id FROM identity.erp_user AS u
    JOIN identity.erp_user_role AS role ON role.user_id = u.id
    WHERE u.is_active = true AND role.role = 'Master' ORDER BY u.id LIMIT 1`);
  assert.equal(masterResult.rowCount, 1);
  const master = masterResult.rows[0];
  const importerResult = await client.query("SELECT DISTINCT importer FROM imports.import_process ORDER BY importer");
  assert.ok(importerResult.rows.length > 1);
  const importer = importerResult.rows[0].importer;
  const scopedPool = { query(sql, values) {
    if (sql.includes("FROM identity.erp_user AS u") && values?.[0] === "process-validation") {
      return Promise.resolve({ rows: values[1] === "scoped" ? [{ role: "Consulta", importer_code: importer }] : [] });
    }
    return client.query(sql, values);
  } };
  app = Fastify();
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, scopedPool);
  app.addHook("onRequest", async request => {
    const identity = request.headers["x-test-identity"];
    if (identity === "master") request.authContext = { issuer: master.issuer, subject: master.subject, userId: master.id, displayName: null, sessionToken: "validation" };
    if (identity === "scoped" || identity === "no-grant") request.authContext = { issuer: "process-validation", subject: identity, userId: master.id, displayName: null, sessionToken: "validation" };
  });
  await registerProcessReadRoutes(app, scopedPool);
  const get = (url, identity = "master") => app.inject({ method: "GET", url, headers: identity ? { "x-test-identity": identity } : {} });
  for (const route of ["/api/v1/processes", "/api/v1/pending-import-items", "/api/v1/unassigned-po-items"]) {
    assert.equal((await get(route, "")).statusCode, 401);
    assert.equal((await get(route, "no-grant")).statusCode, 403);
  }
  const first = await get("/api/v1/processes?page=1&pageSize=50");
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().totalCount, 200);
  assert.equal(first.json().items.length, 50);
  assert.equal((await get("/api/v1/processes?page=4&pageSize=50")).json().items.length, 50);
  const pending = await get("/api/v1/pending-import-items");
  assert.equal(pending.statusCode, 200, pending.body);
  assert.equal(pending.json().totalCount, 1772);
  const unassigned = await get("/api/v1/unassigned-po-items");
  assert.equal(unassigned.statusCode, 200, unassigned.body);
  assert.equal(unassigned.json().totalCount, 144);
  const withoutBoth = await client.query(`SELECT count(*)::int AS count FROM migration.source_row AS source
    WHERE source.sheet_name = 'Pré Embarque' AND NULLIF(btrim(source.raw_values->>'N'), '') IS NULL
      AND (NULLIF(btrim(source.raw_values->>'AB'), '') IS NULL
        OR upper(btrim(source.raw_values->>'AB')) IN ('CANCELLED', 'CANCELED')
        OR left(btrim(source.raw_values->>'AB'), 1) = '#')`);
  assert.equal(withoutBoth.rows[0].count, 128);
  const seen = new Set();
  for (let page = 1; page <= 3; page++) {
    const response = await get(`/api/v1/unassigned-po-items?page=${page}&pageSize=50`);
    for (const item of response.json().items) seen.add(item.id);
  }
  assert.equal(seen.size, 144);
  assert.equal((await get("/api/v1/unassigned-po-items?ipNumber=NH-017%2F2025")).statusCode, 200);

  const shared = await get("/api/v1/processes?ipNumber=NH-017%2F2025");
  assert.equal(shared.statusCode, 200, shared.body);
  assert.equal(shared.json().totalCount, 1);
  const sharedId = shared.json().items[0].id;
  const sharedDetail = await get(`/api/v1/processes/${sharedId}`);
  assert.equal(sharedDetail.statusCode, 200, sharedDetail.body);
  assert.equal(sharedDetail.json().purchaseOrders.length, 4);
  assert.ok(sharedDetail.json().purchaseOrders.some(order => order.number === "6817"));
  assert.equal(sharedDetail.json().historicalCosts.length, 2);
  assert.ok(sharedDetail.json().historicalCosts.some(cost => cost.type === "FREIGHT" && Number(cost.amount) === 17520));
  assert.ok(sharedDetail.json().historicalCosts.some(cost => cost.type === "STORAGE" && Number(cost.amount) === 545.45));
  assert.equal("costsByPurchaseOrder" in sharedDetail.json(), false);
  const sharedItems = await get(`/api/v1/processes/${sharedId}/items`);
  assert.equal(sharedItems.statusCode, 200, sharedItems.body);
  assert.ok(sharedItems.json().items.some(item => item.poNumber === "6817"));
  const other = await get("/api/v1/processes?ipNumber=NH-016%2F2025");
  assert.equal(other.json().totalCount, 1);
  const otherDetail = await get(`/api/v1/processes/${other.json().items[0].id}`);
  assert.ok(otherDetail.json().purchaseOrders.some(order => order.number === "6817"));

  const missing = "00000000-0000-4000-8000-000000000000";
  assert.equal((await get(`/api/v1/processes/${missing}`)).statusCode, 404);
  assert.equal((await get(`/api/v1/processes/${missing}/items`)).statusCode, 404);
  const outside = await client.query("SELECT id FROM imports.import_process WHERE importer <> $1 ORDER BY id LIMIT 1", [importer]);
  assert.equal((await get(`/api/v1/processes/${outside.rows[0].id}`, "scoped")).statusCode, 404);
  assert.equal((await get(`/api/v1/processes/${outside.rows[0].id}/items`, "scoped")).statusCode, 404);
  const scopedList = await get("/api/v1/processes", "scoped");
  assert.ok(scopedList.json().totalCount < 200);
  assert.ok(scopedList.json().items.every(item => item.importer === importer));
  for (const route of ["pending-import-items", "unassigned-po-items"]) {
    const response = await get(`/api/v1/${route}`, "scoped");
    assert.equal(response.statusCode, 200, response.body);
    assert.ok(response.json().items.every(item => item.importer === importer));
    assert.ok(response.json().totalCount < (route === "pending-import-items" ? 1772 : 144));
  }
  console.log("RF04/DEV14 read validation passed: 200 IPs, shared links/costs, 1772/144 queues with 128 overlap, 401/403/404 and importer scope.");
} finally {
  if (app) await app.close();
  await client.query("ROLLBACK");
  await client.end();
}
