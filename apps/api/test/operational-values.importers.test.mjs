import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerCatalogRoutes } from "../dist/catalog.js";

const importerRows = [
  { id: "00000000-0000-4000-8000-000000000801", entity_key: "IMPORTER", code: "01",
    value: "ELETRA INDUSTRIA E COMERCIO DE MEDIDORES ELETRICOS L", import_cons: "Importador",
    cnpj: "12.115.480/0001-15", short_name: "ELETRA ENERGY-MATRIZ", created_by: "admin" },
  { id: "00000000-0000-4000-8000-000000000802", entity_key: "IMPORTER", code: null,
    value: "Eletra Cwb", import_cons: null, cnpj: null, short_name: null, created_by: "legacy" },
];

async function createApp() {
  const state = { inserted: null, audit: null, outbox: null };
  const pool = {
    async query(sql) {
      if (sql.includes("FROM identity.erp_user AS u")) return { rows: [{ role: "Master", importer_code: null }] };
      if (sql.includes("SELECT DISTINCT importer FROM procurement.purchase_order")) {
        return { rows: importerRows.map(row => ({ importer: row.value })) };
      }
      if (sql.includes("FROM catalog.operational_value") && sql.includes("ORDER BY entity_key")) {
        return { rows: importerRows };
      }
      if (sql.includes("information_schema.columns")) return { rows: [{ enabled: false }] };
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, values = []) {
          if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
          if (sql.includes("SELECT entity_key, code, value, import_cons, cnpj, short_name FROM catalog.operational_value")) {
            return { rows: [{ ...importerRows[0] }], rowCount: 1 };
          }
          if (sql.includes("INSERT INTO catalog.operational_value")) {
            state.inserted = { sql, values };
            return { rows: [{ id: values[0], entity_key: values[1], code: values[2], value: values[3],
              import_cons: values[4], cnpj: values[5], short_name: values[6] }], rowCount: 1 };
          }
          if (sql.includes("UPDATE catalog.operational_value SET code = $2")) {
            state.inserted = { sql, values };
            return { rows: [{ ...importerRows[0], code: values[1], import_cons: values[2], cnpj: values[3],
              short_name: values[4], value: values[5] }], rowCount: 1 };
          }
          if (sql.includes("INSERT INTO audit.audit_log")) { state.audit = values; return { rows: [], rowCount: 1 }; }
          if (sql.includes("INSERT INTO audit.outbox_message")) { state.outbox = values; return { rows: [], rowCount: 1 }; }
          throw new Error(`Unexpected client query: ${sql}`);
        },
        release() {},
      };
    },
  };
  const app = Fastify();
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    if (request.headers["x-test-subject"]) request.authContext = {
      issuer: "test", subject: "admin", userId: "admin", sessionToken: "test-only",
    };
  });
  await registerCatalogRoutes(app, pool);
  return { app, state };
}

test("operational importer options include Protheus code, full name, reduced name, type and CNPJ", async t => {
  const { app } = await createApp();
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/api/v1/operational-values",
    headers: { "x-test-subject": "admin" } });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().items[0], {
    id: importerRows[0].id, entity: "importer", code: "01", value: importerRows[0].value,
    importCons: "Importador", cnpj: "12.115.480/0001-15", shortName: "ELETRA ENERGY-MATRIZ",
  });
  assert.equal(response.json().items[1].value, "Eletra Cwb");
  assert.equal("shortName" in response.json().items[1], false);
});

test("creates importer references with the requested fields and audits their values", async t => {
  const { app, state } = await createApp();
  t.after(() => app.close());

  const response = await app.inject({ method: "POST", url: "/api/v1/operational-values",
    headers: { "x-test-subject": "admin" },
    payload: { entity: "importer", code: "01", value: importerRows[0].value, shortName: "ELETRA ENERGY-MATRIZ",
      importCons: "Importador", cnpj: "12.115.480/0001-15", reason: "Carga conferida com planilha Protheus" } });

  assert.equal(response.statusCode, 201, response.body);
  assert.deepEqual(state.inserted.values.slice(1), ["IMPORTER", "01", importerRows[0].value,
    "Importador", "12.115.480/0001-15", "ELETRA ENERGY-MATRIZ", "admin"]);
  assert.equal(response.json().shortName, "ELETRA ENERGY-MATRIZ");
  assert.equal(response.json().cnpj, "12.115.480/0001-15");
  assert.deepEqual(JSON.parse(state.audit[2]), {
    entity: "importer", code: "01", value: importerRows[0].value, importCons: "Importador",
    cnpj: "12.115.480/0001-15", shortName: "ELETRA ENERGY-MATRIZ",
  });
  assert.ok(state.outbox);
});

test("rejects an importer with malformed CNPJ before writing", async t => {
  const { app, state } = await createApp();
  t.after(() => app.close());

  const response = await app.inject({ method: "POST", url: "/api/v1/operational-values",
    headers: { "x-test-subject": "admin" },
    payload: { entity: "importer", code: "99", value: "Nome completo", shortName: "Nome curto",
      importCons: "Importador", cnpj: "12.115.480/0001-XX", reason: "Carga conferida com planilha Protheus" } });

  assert.equal(response.statusCode, 400);
  assert.equal(state.inserted, null);
});

test("edits an importer's reduced name and records it in the audit trail", async t => {
  const { app, state } = await createApp();
  t.after(() => app.close());
  const importer = importerRows[0];

  const response = await app.inject({ method: "PATCH", url: `/api/v1/operational-values/${importer.id}`,
    headers: { "x-test-subject": "admin" },
    payload: { expectedCode: importer.code, code: importer.code, expectedValue: importer.value, value: importer.value,
      expectedImportCons: importer.import_cons, importCons: importer.import_cons, expectedCnpj: importer.cnpj,
      cnpj: importer.cnpj, expectedShortName: importer.short_name, shortName: "ELETRA ENERGY MATRIZ",
      reason: "Nome reduzido revisado na planilha oficial" } });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().shortName, "ELETRA ENERGY MATRIZ");
  assert.equal(state.inserted.values[4], "ELETRA ENERGY MATRIZ");
  assert.equal(JSON.parse(state.audit[3]).shortName, "ELETRA ENERGY MATRIZ");
});
