import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerCatalogRoutes } from "../dist/catalog.js";

const importer = "IMPORTER-A";

async function createApp() {
  const globalCodes = new Set();
  const writes = [];
  const pool = {
    async query(sql, values = []) {
      if (sql.includes("FROM identity.erp_user AS u")) {
        return { rows: [{ role: "Compras", importer_code: importer }] };
      }
      if (sql.includes("WITH visible AS MATERIALIZED")) {
        return { rows: [{ total_count: 1, items: [{ id: "product-1", importer: null,
          kind: "PRODUCT", code: "GLOBAL-1", name: "Produto global", status: "ACTIVE",
          evidence: "Cadastro global via teste.", provenance: "MANUAL_REVIEW", valid_from: null,
          valid_to: null, version: "1", created_at: new Date(), updated_at: new Date() }] }] };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, values = []) {
          if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK"
            || sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 0 };
          if (sql.includes("SELECT payload_sha256, entry_id FROM catalog.command_receipt")) return { rows: [], rowCount: 0 };
          if (sql.includes("SELECT * FROM catalog.entry WHERE id = $1 AND kind = $2")) {
            return { rows: [{ id: values[0], importer: null, kind: "PRODUCT", code: "EDIT-1",
              name: "Produto original", status: "ACTIVE", evidence: "Cadastro global via teste.",
              provenance: "MANUAL_REVIEW", valid_from: null, valid_to: null, version: "1",
              created_at: new Date(), updated_at: new Date() }], rowCount: 1 };
          }
          if (sql.includes("UPDATE catalog.entry SET name=$2")) {
            return { rows: [{ id: values[0], importer: null, kind: "PRODUCT", code: "EDIT-1",
              name: values[1], status: values[2], evidence: values[3], provenance: "MANUAL_REVIEW",
              valid_from: values[4], valid_to: values[5], version: "2",
              created_at: new Date(), updated_at: new Date() }], rowCount: 1 };
          }
          if (sql.includes("INSERT INTO catalog.entry\n")) {
            const bulk = sql.includes("ON CONFLICT");
            const code = bulk ? values[1] : values[3];
            writes.push({ code, importer: bulk ? null : values[1], bulk });
            const normalized = code.trim().toUpperCase();
            if (globalCodes.has(normalized)) {
              if (bulk) return { rows: [], rowCount: 0 };
              const error = new Error("duplicate product code");
              error.code = "23505";
              throw error;
            }
            globalCodes.add(normalized);
            const name = bulk ? values[2] : values[4];
            const evidence = bulk ? values[3] : values[5];
            return { rows: [{ id: values[0], importer: null, kind: "PRODUCT", code: code.trim(),
              name, status: "ACTIVE", provenance: "MANUAL_REVIEW", evidence, valid_from: null,
              valid_to: null, version: "1", created_at: new Date(), updated_at: new Date() }], rowCount: 1 };
          }
          if (sql.includes("INSERT INTO catalog.entry_alias") || sql.includes("INSERT INTO catalog.command_receipt")
            || sql.includes("INSERT INTO audit.audit_log") || sql.includes("INSERT INTO audit.outbox_message")) {
            return { rows: [], rowCount: 1 };
          }
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
    const subject = request.headers["x-test-subject"];
    if (typeof subject === "string") request.authContext = {
      issuer: "test", subject, userId: `user:${subject}`, sessionToken: "test-only",
    };
  });
  await registerCatalogRoutes(app, pool);
  return { app, writes };
}

test("creates products globally from only code and description", async t => {
  const { app, writes } = await createApp();
  t.after(() => app.close());

  const response = await app.inject({ method: "POST", url: "/api/v1/products",
    headers: { "x-test-subject": "buyer", "idempotency-key": "product-one" },
    payload: { code: " P-001 ", name: " Produto um " } });

  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().importer, null);
  assert.equal(response.json().code, "P-001");
  assert.equal(response.json().name, "Produto um");
  assert.equal(writes[0].importer, null);
  assert.equal(writes[0].bulk, false);

  const duplicate = await app.inject({ method: "POST", url: "/api/v1/products",
    headers: { "x-test-subject": "buyer", "idempotency-key": "product-two" },
    payload: { importer: "OTHER-IMPORTER", code: "p-001", name: "Outro nome" } });
  assert.equal(duplicate.statusCode, 409);
});

test("creates products with source descriptions longer than the old limit", async t => {
  const { app } = await createApp();
  t.after(() => app.close());
  const description = "D".repeat(878);

  const response = await app.inject({ method: "POST", url: "/api/v1/products",
    headers: { "x-test-subject": "buyer", "idempotency-key": "long-product" },
    payload: { code: "LONG-CREATE", name: description } });

  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().name.length, 878);
});

test("lists the global product catalog without requiring an importer filter", async t => {
  const { app } = await createApp();
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/api/v1/products?page=1&pageSize=25",
    headers: { "x-test-subject": "reader" } });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().totalCount, 1);
  assert.equal(response.json().items[0].importer, null);
  assert.equal(response.json().items[0].code, "GLOBAL-1");
});

test("imports product JSON in one request and skips repeated codes", async t => {
  const { app, writes } = await createApp();
  t.after(() => app.close());

  const response = await app.inject({ method: "POST", url: "/api/v1/products/bulk",
    headers: { "x-test-subject": "buyer" }, payload: { items: [
      { code: "P-100", description: "Produto cem" },
      { code: "P-101", description: "Produto cento e um" },
      { code: "P-100", description: "Duplicado" },
    ] } });

  assert.equal(response.statusCode, 201, response.body);
  assert.deepEqual(response.json(), { createdCount: 2, skippedCount: 1 });
  assert.ok(writes.every(write => write.importer === null && write.bulk));
});

test("accepts long source descriptions in the product JSON import", async t => {
  const { app, writes } = await createApp();
  t.after(() => app.close());
  const description = "D".repeat(878);

  const response = await app.inject({ method: "POST", url: "/api/v1/products/bulk",
    headers: { "x-test-subject": "buyer" }, payload: { items: [{ code: "LONG-1", description }] } });

  assert.equal(response.statusCode, 201, response.body);
  assert.equal(writes.length, 1);
});

test("updates product descriptions longer than the old limit", async t => {
  const { app } = await createApp();
  t.after(() => app.close());
  const description = "D".repeat(878);

  const response = await app.inject({ method: "PATCH", url: "/api/v1/products/00000000-0000-4000-8000-000000000001",
    headers: { "x-test-subject": "buyer", "x-record-version": "1" },
    payload: { name: description, status: "INACTIVE", reason: "Ajustar descricao do produto" } });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().name.length, 878);
  assert.equal(response.json().status, "INACTIVE");
});

test("rejects malformed product JSON payloads before writing", async t => {
  const { app, writes } = await createApp();
  t.after(() => app.close());

  const response = await app.inject({ method: "POST", url: "/api/v1/products/bulk",
    headers: { "x-test-subject": "buyer" }, payload: { items: [{ code: "P-1", description: " " }] } });

  assert.equal(response.statusCode, 400);
  assert.equal(writes.length, 0);
});
