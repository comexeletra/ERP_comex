// Run only on a restored, disposable PostgreSQL copy selected by CATALOG_TEST_DB.
import assert from "node:assert/strict";
import Fastify from "fastify";
import pg from "pg";
import { registerAuthorization } from "../dist/authorization.js";
import { registerCatalogRoutes } from "../dist/catalog.js";

const connectionString = process.env.DATABASE_URL;
const expected = process.env.CATALOG_TEST_DB;
if (!connectionString || !expected || !/^erp_catalog_validation_[0-9]+$/u.test(expected)
  || new URL(connectionString).pathname !== `/${expected}`) {
  throw new Error("CATALOG_TEST_DB deve apontar para uma cópia restaurada erp_catalog_validation_*. ");
}
const pool = new pg.Pool({ connectionString, max: 4 });
const masterQuery = await pool.query(`SELECT u.id, u.issuer, u.subject FROM identity.erp_user AS u
  JOIN identity.erp_user_role AS role ON role.user_id = u.id
  WHERE role.role = 'Master' AND u.is_active ORDER BY u.id LIMIT 1`);
assert.equal(masterQuery.rowCount, 1);
const master = masterQuery.rows[0];
const importerQuery = await pool.query("SELECT DISTINCT importer FROM procurement.purchase_order ORDER BY importer");
assert.ok(importerQuery.rows.length > 1);
const [importerA, importerB] = importerQuery.rows.map(row => row.importer);
const guardedPool = {
  query(sql, values) {
    if (sql.includes("FROM identity.erp_user AS u") && values?.[0] === "catalog-test") {
      const subject = values[1];
      return Promise.resolve({ rows: subject === "reader" ? [{ role: "Consulta", importer_code: importerA }]
        : subject === "buyer" ? [{ role: "Compras", importer_code: importerA }]
          : subject === "fiscal" ? [{ role: "Fiscal", importer_code: importerA }] : [] });
    }
    return pool.query(sql, values);
  },
  connect() { return pool.connect(); },
};
const app = Fastify();
app.decorateRequest("authContext", null);
await registerAuthorization(app, guardedPool);
app.addHook("onRequest", async request => {
  const who = request.headers["x-test-identity"];
  if (who === "master") request.authContext = { ...master, userId: master.id, displayName: null, sessionToken: "test" };
  if (["reader", "buyer", "fiscal", "no-grant"].includes(who)) {
    request.authContext = { issuer: "catalog-test", subject: who, userId: master.id,
      displayName: null, sessionToken: "test" };
  }
});
await registerCatalogRoutes(app, guardedPool);
const request = (method, url, who = "master", payload, headers = {}) => app.inject({ method, url,
  headers: { ...(who ? { "x-test-identity": who } : {}), ...headers }, payload });
const body = { importer: importerA, code: ` CAT-TEST-${Date.now()} `, name: "Produto revisado",
  evidence: "Documento de teste de integração", reason: "Validação do cadastro operacional" };
try {
  assert.equal((await request("GET", "/api/v1/importers", "")).statusCode, 401);
  assert.equal((await request("POST", "/api/v1/products", "reader", body)).statusCode, 403);
  assert.equal((await request("GET", "/api/v1/importers", "no-grant")).statusCode, 403);
  const scopedImporters = await request("GET", "/api/v1/importers", "buyer");
  assert.equal(scopedImporters.statusCode, 200, scopedImporters.body);
  assert.deepEqual(scopedImporters.json().items.map(item => item.code), [importerA]);
  const candidates = await request("GET", `/api/v1/suppliers/candidates?importer=${encodeURIComponent(importerA)}`, "buyer");
  assert.equal(candidates.statusCode, 200, candidates.body);
  assert.ok(candidates.json().totalCount > 0);
  assert.ok(candidates.json().items.every(item => item.importer === importerA && item.status === "HISTORICAL_CANDIDATE"));
  const hiddenCandidates = await request("GET", `/api/v1/suppliers/candidates?importer=${encodeURIComponent(importerB)}`, "buyer");
  assert.equal(hiddenCandidates.json().totalCount, 0);
  const hiddenCreate = await request("POST", "/api/v1/products", "buyer", { ...body, importer: importerB }, { "idempotency-key": "hidden" });
  assert.equal(hiddenCreate.statusCode, 404);
  const key = `catalog-test-${Date.now()}`;
  const created = await request("POST", "/api/v1/products", "buyer", body, { "idempotency-key": key });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id;
  assert.equal(created.json().code, body.code.trim());
  assert.equal(created.headers.etag, '"1"');
  const alias = await pool.query("SELECT raw_code FROM catalog.entry_alias WHERE entry_id=$1", [id]);
  assert.equal(alias.rows[0].raw_code, body.code);
  const replay = await request("POST", "/api/v1/products", "buyer", body, { "idempotency-key": key });
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.json().id, id);
  assert.equal((await request("POST", "/api/v1/products", "buyer", { ...body, name: "Outro" }, { "idempotency-key": key })).statusCode, 409);
  assert.equal((await request("POST", "/api/v1/products", "buyer", body, { "idempotency-key": `${key}-2` })).statusCode, 409);
  assert.equal((await request("GET", `/api/v1/products/${id}`, "reader")).statusCode, 200);
  assert.equal((await request("GET", `/api/v1/products/${id}`, "fiscal")).statusCode, 200);
  const outOfScopeId = await pool.query("INSERT INTO catalog.entry (id,importer,kind,code,name,evidence,created_by,updated_by) VALUES (gen_random_uuid(),$1,'PRODUCT',$2,'Teste','Documento de teste',$3,$3) RETURNING id",
    [importerB, `CAT-HIDDEN-${Date.now()}`, master.id]);
  assert.equal((await request("GET", `/api/v1/products/${outOfScopeId.rows[0].id}`, "buyer")).statusCode, 404);
  assert.equal((await request("PATCH", `/api/v1/products/${outOfScopeId.rows[0].id}`, "buyer", { name: "Novo", reason: "Revisão de teste" }, { "if-match": '"1"' })).statusCode, 404);
  assert.equal((await request("PATCH", `/api/v1/products/${id}`, "buyer", { name: "Novo", reason: "Revisão de teste" }, { "if-match": '"2"' })).statusCode, 409);
  const updated = await request("PATCH", `/api/v1/products/${id}`, "buyer", { name: "Produto atualizado", status: "INACTIVE", reason: "Revisão de teste" }, { "if-match": '"1"' });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().version, "2");
  assert.equal(updated.json().status, "INACTIVE");
  const audit = await pool.query("SELECT field_name FROM audit.audit_log WHERE aggregate_id=$1 ORDER BY occurred_at", [id]);
  assert.ok(audit.rows.some(row => row.field_name === "status"));
  const outbox = await pool.query("SELECT event_type FROM audit.outbox_message WHERE aggregate_id=$1", [id]);
  assert.deepEqual(new Set(outbox.rows.map(row => row.event_type)), new Set(["catalog.entry.created", "catalog.entry.updated"]));
  await pool.query(`CREATE FUNCTION catalog.test_fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'catalog test outbox failure'; END $$`);
  await pool.query(`CREATE TRIGGER catalog_test_outbox_failure BEFORE INSERT ON audit.outbox_message
    FOR EACH ROW WHEN (NEW.event_type = 'catalog.entry.created')
    EXECUTE FUNCTION catalog.test_fail_outbox()`);
  const rollbackCode = `CAT-ROLLBACK-${Date.now()}`;
  const failed = await request("POST", "/api/v1/products", "buyer", { ...body, code: rollbackCode },
    { "idempotency-key": `${key}-rollback` });
  assert.equal(failed.statusCode, 500);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM catalog.entry WHERE code=$1", [rollbackCode])).rows[0].count, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM catalog.command_receipt WHERE idempotency_key=$1", [`${key}-rollback`])).rows[0].count, 0);
  await pool.query("DROP TRIGGER catalog_test_outbox_failure ON audit.outbox_message");
  await pool.query("DROP FUNCTION catalog.test_fail_outbox()");
  assert.equal((await request("POST", "/api/v1/ncms", "buyer", { ...body, code: "12345678", validFrom: "2026-10-01" }, { "idempotency-key": `${key}-ncm` })).statusCode, 403);
  assert.equal((await request("POST", "/api/v1/ncms", "fiscal", { ...body, code: "#REF!", validFrom: "2026-10-01" }, { "idempotency-key": `${key}-invalid` })).statusCode, 400);
  console.log("Catalog restored-copy validation passed: scope, 401/403/404, candidates, create/replay/conflict, ETag, audit/outbox rollback and NCM validation.");
} finally {
  await app.close();
  await pool.end();
}
