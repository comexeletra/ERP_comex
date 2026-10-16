import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerCatalogRoutes } from "../dist/catalog.js";

const entryId = "00000000-0000-4000-8000-000000000001";

async function createApp() {
  const entry = {
    id: entryId, importer: null, kind: "NCM", code: "73151100", name: "Correntes de rolos",
    status: "INACTIVE", evidence: "Classif Receita Federal, vigência encerrada em 2024.",
    provenance: "MANUAL_REVIEW", valid_from: "2022-04-01", valid_to: "2024-09-30", version: "1",
    created_at: new Date(), updated_at: new Date(),
  };
  const writes = [];
  const pool = {
    async query(sql, values = []) {
      if (sql.includes("FROM identity.erp_user AS u")) {
        return { rows: [{ role: "Fiscal", importer_code: null }] };
      }
      if (sql.includes("WITH visible AS MATERIALIZED")) {
        assert.deepEqual(values, ["NCM", null, 25, 0]);
        return { rows: [{ total_count: 1, items: [entry] }] };
      }
      if (sql.includes("WITH candidates AS MATERIALIZED")) {
        assert.match(sql, /CASE WHEN \$5 = 'NCM' THEN NULL::text ELSE po\.importer END/u);
        assert.match(sql, /\$5 = 'NCM' OR po\.importer = ANY\(\$2::text\[\]\)/u);
        assert.deepEqual(values, ["V", [], null, null, "NCM", 25, 0]);
        return { rows: [{ total_count: 1, items: [{ importer: null, raw_code: "12345678",
          observation_count: 3, sample_source_row_id: "00000000-0000-4000-8000-000000000099",
          sample_sheet_name: "PO", sample_row_number: 9 }] }] };
      }
      if (sql.includes("SELECT entry.* FROM catalog.entry AS entry")) {
        return { rows: [entry] };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, values = []) {
          if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) || sql.includes("pg_advisory_xact_lock")) {
            return { rows: [], rowCount: 0 };
          }
          if (sql.includes("SELECT payload_sha256, entry_id FROM catalog.command_receipt")) {
            return { rows: [], rowCount: 0 };
          }
          if (sql.includes("INSERT INTO catalog.entry\n")) {
            writes.push({ sql, values });
            Object.assign(entry, { id: values[0], importer: values[1], kind: values[2], code: values[3],
              name: values[4], evidence: values[5], valid_from: values[6], valid_to: values[7],
              status: "ACTIVE", version: "1" });
            return { rows: [entry], rowCount: 1 };
          }
          if (sql.includes("SELECT * FROM catalog.entry WHERE id = $1 AND kind = $2 AND importer IS NULL FOR UPDATE")) {
            return { rows: [entry], rowCount: 1 };
          }
          if (sql.includes("UPDATE catalog.entry SET name=$2")) {
            Object.assign(entry, { name: values[1], status: values[2], evidence: values[3],
              valid_from: values[4], valid_to: values[5], version: "2" });
            return { rows: [entry], rowCount: 1 };
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
    if (typeof request.headers["x-test-subject"] === "string") {
      request.authContext = { issuer: "test", subject: "fiscal", userId: "user:fiscal", sessionToken: "test-only" };
    }
  });
  await registerCatalogRoutes(app, pool);
  return { app, entry, writes };
}

test("Fiscal users without importer scopes can list and edit the global NCM catalog", async t => {
  const { app, entry } = await createApp();
  t.after(() => app.close());
  const headers = { "x-test-subject": "fiscal" };
  const longDescription = `Descrição oficial ${"NCM ".repeat(70)}`.trim();

  const list = await app.inject({ method: "GET", url: "/api/v1/ncms?page=1&pageSize=25", headers });
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(list.json().items[0].importer, null);

  const edit = await app.inject({ method: "PATCH", url: `/api/v1/ncms/${entry.id}`,
    headers: { ...headers, "x-record-version": "1" },
    payload: { name: longDescription, reason: "Atualizar descrição oficial" } });
  assert.equal(edit.statusCode, 200, edit.body);
  assert.equal(edit.json().name, longDescription);
  assert.equal(edit.json().importer, null);

  const unknownPeriod = await app.inject({ method: "PATCH", url: `/api/v1/ncms/${entry.id}`,
    headers: { ...headers, "x-record-version": "2" },
    payload: { status: "INACTIVE", validFrom: null, validTo: null,
      reason: "Limpar vigência ainda não confirmada" } });
  assert.equal(unknownPeriod.statusCode, 200, unknownPeriod.body);
});

test("global NCM routes reject importer filters", async t => {
  const { app } = await createApp();
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/api/v1/ncms?importer=ELETRA%20CWB",
    headers: { "x-test-subject": "fiscal" } });
  assert.equal(response.statusCode, 400, response.body);
});

test("creates standalone NCM records and rejects importer ownership", async t => {
  const { app, writes } = await createApp();
  t.after(() => app.close());
  const headers = { "x-test-subject": "fiscal", "idempotency-key": "global-ncm-one" };
  const payload = { code: "12345678", name: `Classificação fiscal ${"NCM ".repeat(70)}`.trim(),
    evidence: "Receita Federal Classif; ato 123.",
    reason: "Carga inicial do catálogo NCM", validFrom: "2024-01-01" };

  const created = await app.inject({ method: "POST", url: "/api/v1/ncms", headers, payload });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().name, payload.name);
  assert.equal(created.json().importer, null);
  assert.equal(writes[0].values[1], null);

  const withImporter = await app.inject({ method: "POST", url: "/api/v1/ncms",
    headers: { ...headers, "idempotency-key": "global-ncm-two" }, payload: { ...payload, importer: "ELETRA CWB" } });
  assert.equal(withImporter.statusCode, 400);
  assert.equal(writes.length, 1);
});

test("NCM source candidates are aggregated globally and normalized to eight digits", async t => {
  const { app } = await createApp();
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/api/v1/ncms/candidates?page=1&pageSize=25",
    headers: { "x-test-subject": "fiscal" } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().items[0].rawCode, "12345678");
  assert.equal(response.json().items[0].eligibleFormat, true);
  assert.equal("importer" in response.json().items[0], false);
});
