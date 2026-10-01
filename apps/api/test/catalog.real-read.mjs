// Run on VPS against the explicitly selected operational DB in READ ONLY mode.
import assert from "node:assert/strict";
import Fastify from "fastify";
import pg from "pg";
import { registerAuthorization } from "../dist/authorization.js";
import { registerCatalogRoutes } from "../dist/catalog.js";

const connectionString = process.env.DATABASE_URL;
const expected = process.env.CATALOG_READ_DB;
if (!connectionString || expected !== "erp_po_totvs_test"
  || new URL(connectionString).pathname !== `/${expected}`) {
  throw new Error("CATALOG_READ_DB deve confirmar o banco operacional selecionado.");
}
const client = new pg.Client({ connectionString });
await client.connect();
let app;
try {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const masterResult = await client.query(`SELECT u.id, u.issuer, u.subject FROM identity.erp_user AS u
    JOIN identity.erp_user_role AS role ON role.user_id = u.id
    WHERE role.role = 'Master' AND u.is_active ORDER BY u.id LIMIT 1`);
  assert.equal(masterResult.rowCount, 1);
  const master = masterResult.rows[0];
  const importerResult = await client.query("SELECT DISTINCT importer FROM procurement.purchase_order ORDER BY importer");
  assert.equal(importerResult.rows.length, 3);
  const importer = importerResult.rows[0].importer;
  const scopedPool = { query(sql, values) {
    if (sql.includes("FROM identity.erp_user AS u") && values?.[0] === "catalog-read-validation") {
      return Promise.resolve({ rows: values[1] === "scoped"
        ? [{ role: "Consulta", importer_code: importer }] : [] });
    }
    return client.query(sql, values);
  } };
  app = Fastify();
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, scopedPool);
  app.addHook("onRequest", async request => {
    const who = request.headers["x-test-identity"];
    if (who === "master") request.authContext = { issuer: master.issuer, subject: master.subject,
      userId: master.id, displayName: null, sessionToken: "read-validation" };
    if (who === "scoped" || who === "no-grant") request.authContext = {
      issuer: "catalog-read-validation", subject: who, userId: master.id,
      displayName: null, sessionToken: "read-validation" };
  });
  await registerCatalogRoutes(app, scopedPool);
  const get = (url, who = "master") => app.inject({ method: "GET", url,
    headers: who ? { "x-test-identity": who } : {} });
  assert.equal((await get("/api/v1/importers", "")).statusCode, 401);
  assert.equal((await get("/api/v1/importers", "no-grant")).statusCode, 403);
  const masterImporters = await get("/api/v1/importers");
  assert.equal(masterImporters.statusCode, 200, masterImporters.body);
  assert.equal(masterImporters.json().items.length, 3);
  assert.equal(masterImporters.json().items.reduce((sum, item) => sum + item.historicalPoCount, 0), 336);
  const scopedImporters = await get("/api/v1/importers", "scoped");
  assert.deepEqual(scopedImporters.json().items.map(item => item.code), [importer]);
  const suppliers = await get("/api/v1/suppliers/candidates");
  assert.equal(suppliers.statusCode, 200, suppliers.body);
  assert.ok(suppliers.json().totalCount >= 6);
  assert.ok(suppliers.json().items.every(item => item.sampleSheetName && item.sampleRowNumber > 0));
  const scopedSuppliers = await get(`/api/v1/suppliers/candidates?importer=${encodeURIComponent(importer)}`, "scoped");
  assert.equal(scopedSuppliers.statusCode, 200, scopedSuppliers.body);
  assert.ok(scopedSuppliers.json().items.every(item => item.importer === importer));
  const hidden = await get(`/api/v1/suppliers/candidates?importer=${encodeURIComponent(importerResult.rows[1].importer)}`, "scoped");
  assert.equal(hidden.json().totalCount, 0);
  for (const resource of ["suppliers", "products", "ncms"]) {
    const registered = await get(`/api/v1/${resource}`);
    assert.equal(registered.statusCode, 200, registered.body);
    assert.equal(registered.json().totalCount, 0);
  }
  assert.equal((await get("/api/v1/products/00000000-0000-4000-8000-000000000000")).statusCode, 404);
  console.log("M010 operational READ ONLY validation passed: 3 importers, 336 POs, historical candidates, empty reviewed catalog, scope and 401/403/404.");
} finally {
  if (app) await app.close();
  await client.query("ROLLBACK");
  await client.end();
}
