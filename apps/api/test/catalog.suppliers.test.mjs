import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerCatalogRoutes } from "../dist/catalog.js";

const supplierId = "00000000-0000-4000-8000-000000000767";
const originalSupplier = {
  id: supplierId, importer: null, kind: "SUPPLIER", code: "EX000767",
  name: "HEXING ELECTRICAL CO.,LTD", status: "ACTIVE", provenance: "MANUAL_REVIEW",
  evidence: "Fornecedor importado da base MATA020.", valid_from: null, valid_to: null,
  version: "1", created_at: new Date(), updated_at: new Date(),
};

async function createApp({ duplicateCode = false } = {}) {
  const state = { listValues: null, updateValues: null, aliases: [], auditFields: [], outbox: [] };
  const pool = {
    async query(sql, values = []) {
      if (sql.includes("FROM identity.erp_user AS u")) return { rows: [{ role: "Master", importer_code: null }] };
      if (sql.includes("SELECT DISTINCT importer FROM procurement.purchase_order")) {
        return { rows: [{ importer: "IMPORTER-A" }] };
      }
      if (sql.includes("WITH visible AS MATERIALIZED")) {
        state.listValues = values;
        return { rows: [{ total_count: 1, items: [{ ...originalSupplier }] }] };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, values = []) {
          if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
          if (sql.includes("SELECT * FROM catalog.entry WHERE id = $1 AND kind = $2 AND importer IS NULL FOR UPDATE")) {
            return { rows: [{ ...originalSupplier }], rowCount: 1 };
          }
          if (sql.includes("SELECT id FROM catalog.entry WHERE kind = 'SUPPLIER'")) {
            return { rows: duplicateCode ? [{ id: "another-supplier" }] : [], rowCount: Number(duplicateCode) };
          }
          if (sql.includes("UPDATE catalog.entry SET code=$2")) {
            state.updateValues = values;
            return { rows: [{ ...originalSupplier, code: values[1], name: values[2], status: values[3],
              evidence: values[4], version: "2", updated_at: new Date() }], rowCount: 1 };
          }
          if (sql.includes("INSERT INTO catalog.entry_alias")) { state.aliases.push(values); return { rows: [], rowCount: 1 }; }
          if (sql.includes("INSERT INTO audit.audit_log")) { state.auditFields.push(values[2]); return { rows: [], rowCount: 1 }; }
          if (sql.includes("INSERT INTO audit.outbox_message")) { state.outbox.push(values); return { rows: [], rowCount: 1 }; }
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
    if (typeof request.headers["x-test-subject"] === "string") request.authContext = {
      issuer: "test", subject: request.headers["x-test-subject"],
      userId: `user:${request.headers["x-test-subject"]}`, sessionToken: "test-only",
    };
  });
  await registerCatalogRoutes(app, pool);
  return { app, state };
}

test("searches the supplier catalog by code or legal name", async t => {
  const { app, state } = await createApp();
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/api/v1/suppliers?search=HEXING&page=2&pageSize=25",
    headers: { "x-test-subject": "buyer" } });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(state.listValues, ["SUPPLIER", "HEXING", 25, 25]);
  assert.equal(response.json().totalCount, 1);
  assert.equal(response.json().items[0].code, "EX000767");
});

test("updates supplier Protheus code and legal name with versioned audit", async t => {
  const { app, state } = await createApp();
  t.after(() => app.close());

  const response = await app.inject({ method: "PATCH", url: `/api/v1/suppliers/${supplierId}`,
    headers: { "x-test-subject": "buyer", "x-record-version": "1" },
    payload: { code: "EX000768", name: "Hexing corrigida", reason: "Correção confirmada pela base Protheus" } });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().code, "EX000768");
  assert.equal(response.json().name, "Hexing corrigida");
  assert.deepEqual(state.updateValues.slice(0, 4), [supplierId, "EX000768", "Hexing corrigida", "ACTIVE"]);
  assert.equal(state.aliases.length, 1);
  assert.equal(state.aliases[0][2], "EX000768");
  assert.deepEqual(state.auditFields.sort(), ["code", "name"]);
  assert.equal(state.outbox.length, 1);
});

test("rejects a supplier code already assigned to another entity", async t => {
  const { app, state } = await createApp({ duplicateCode: true });
  t.after(() => app.close());

  const response = await app.inject({ method: "PATCH", url: `/api/v1/suppliers/${supplierId}`,
    headers: { "x-test-subject": "buyer", "x-record-version": "1" },
    payload: { code: "EX000001", reason: "Correção confirmada pela base Protheus" } });

  assert.equal(response.statusCode, 409, response.body);
  assert.equal(state.updateValues, null);
  assert.deepEqual(state.auditFields, []);
});
