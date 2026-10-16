import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerCatalogRoutes } from "../dist/catalog.js";

const selectedCode = "20000002";
const selectedAttributes = [{
  code: "ATT_1", name: "Material principal", displayName: "Material principal", fillType: "TEXTO",
  required: true, multivalued: false, startsOn: "2025-01-01", endsOn: null,
  objectives: ["DUIMP"], organs: [], conditionalAttributes: [],
}];
const official = {
  sourceUpdatedAt: "2026-10-15", attributesVersion: "359",
  items: [
    { code: "10000001", name: "Componente de teste A", validFrom: "2022-04-01", validTo: "9999-12-31", mandatoryImportAttributes: [] },
    { code: selectedCode, name: "Componente eletrônico de teste", validFrom: "2022-04-01", validTo: "9999-12-31",
      mandatoryImportAttributes: selectedAttributes },
  ],
};

function makeEntry(code, name, overrides = {}) {
  return { id: `00000000-0000-4000-8000-${code.slice(-12).padStart(12, "0")}`,
    importer: null, kind: "NCM", code, normalized_code: code, name, status: "INACTIVE",
    provenance: "MANUAL_REVIEW", evidence: "Registro anterior do catálogo fiscal.",
    valid_from: "2022-04-01", valid_to: "2024-12-31", version: "1",
    mandatory_import_attributes: null, source_updated_at: null, attributes_source_version: null,
    attributes_sha256: null, synced_at: null, created_at: new Date(), updated_at: new Date(), ...overrides };
}

async function createApp({ provider = async () => official, existing = [], registeredCodes = [] } = {}) {
  const writes = [];
  const audit = [];
  const outbox = [];
  const pool = {
    async query(sql, values = []) {
      if (sql.includes("FROM identity.erp_user AS u")) return { rows: [{ role: "Fiscal", importer_code: null }] };
      if (sql.includes("SELECT normalized_code FROM catalog.entry")) {
        return { rows: registeredCodes.filter(code => values[0].includes(code)).map(normalized_code => ({ normalized_code })) };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, values = []) {
          if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) || sql.includes("pg_advisory_xact_lock")) {
            writes.push({ sql, values }); return { rows: [], rowCount: 0 };
          }
          if (sql.includes("SELECT payload_sha256, entry_id FROM catalog.command_receipt")) return { rows: [], rowCount: 0 };
          if (sql.includes("SELECT id FROM catalog.entry WHERE kind='NCM'")) {
            const current = existing.find(row => row.code === values[0]) ?? writes.find(row => row.entry?.code === values[0])?.entry;
            return { rows: current ? [{ id: current.id }] : [], rowCount: current ? 1 : 0 };
          }
          if (sql.includes("SELECT entry.*, entry.normalized_code")) return { rows: existing, rowCount: existing.length };
          if (sql.includes("INSERT INTO catalog.entry\n")) {
            const entry = makeEntry(values[1], values[2], {
              id: values[0], name: values[2], status: "ACTIVE", provenance: "OFFICIAL_SISCOMEX",
              evidence: values[3], valid_from: values[4], valid_to: values[5], version: "1",
            });
            writes.push({ sql, values, entry });
            return { rows: [entry], rowCount: 1 };
          }
          if (sql.includes("UPDATE catalog.entry SET name=$2")) {
            const entry = existing.find(row => row.id === values[0]);
            Object.assign(entry, { name: values[1], status: values[2], evidence: values[3],
              valid_from: values[4], valid_to: values[5], provenance: values[6], version: "2" });
            writes.push({ sql, values });
            return { rows: [entry], rowCount: 1 };
          }
          if (sql.includes("INSERT INTO catalog.ncm_siscomex_data")) {
            writes.push({ sql, values }); return { rows: [], rowCount: 1 };
          }
          if (sql.includes("INSERT INTO catalog.command_receipt")) {
            writes.push({ sql, values }); return { rows: [], rowCount: 1 };
          }
          if (sql.includes("INSERT INTO audit.audit_log")) {
            audit.push({ sql, values }); return { rows: [], rowCount: 1 };
          }
          if (sql.includes("INSERT INTO audit.outbox_message")) {
            outbox.push({ sql, values }); return { rows: [], rowCount: 1 };
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
    if (request.headers["x-test-subject"] === "fiscal") {
      request.authContext = { issuer: "test", subject: "fiscal", userId: "user:fiscal", sessionToken: "test-only" };
    }
  });
  await registerCatalogRoutes(app, pool, { officialNcmProvider: provider });
  return { app, writes, audit, outbox, existing };
}

test("searching the official table marks existing NCMs without adding all search results", async t => {
  const { app, writes } = await createApp({ registeredCodes: [selectedCode] });
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/api/v1/ncms/official-search?search=Componente&page=1&pageSize=25",
    headers: { "x-test-subject": "fiscal" } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().totalCount, 2);
  assert.equal(response.json().items.find(item => item.code === selectedCode).alreadyRegistered, true);
  assert.equal(response.json().items.find(item => item.code === "10000001").alreadyRegistered, false);
  assert.equal(writes.length, 0);
});

test("a user can add one selected official NCM with its mandatory attributes", async t => {
  const { app, writes, audit, outbox } = await createApp();
  t.after(() => app.close());

  const response = await app.inject({ method: "POST", url: "/api/v1/ncms/import-official",
    headers: { "x-test-subject": "fiscal", "idempotency-key": "select-one-ncm" }, payload: { code: selectedCode } });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().code, selectedCode);
  assert.equal(response.json().name, "Componente eletrônico de teste");
  assert.equal(response.json().mandatoryImportAttributes[0].name, "Material principal");
  assert.equal("importer" in response.json(), false);
  assert.equal(writes.filter(write => write.sql.includes("INSERT INTO catalog.entry\n")).length, 1);
  assert.equal(writes.filter(write => write.sql.includes("INSERT INTO catalog.ncm_siscomex_data")).length, 1);
  assert.equal(audit.some(event => event.values[2] === JSON.stringify(selectedAttributes)), true);
  assert.equal(outbox.length, 1);
});

test("refresh updates only already registered NCMs and preserves unmatched historical rows", async t => {
  const current = makeEntry("10000001", "Nome antigo");
  const historical = makeEntry("99999999", "NCM histórico");
  const { app, writes, existing } = await createApp({ existing: [current, historical] });
  t.after(() => app.close());

  const response = await app.inject({ method: "POST", url: "/api/v1/ncms/refresh-official",
    headers: { "x-test-subject": "fiscal" }, payload: {} });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().matchedCount, 1);
  assert.equal(response.json().updatedCount, 1);
  assert.equal(response.json().attributesUpdatedCount, 1);
  assert.equal(response.json().preservedUnmatchedCount, 1);
  assert.equal(current.name, "Componente de teste A");
  assert.equal(historical.name, "NCM histórico");
  assert.equal(writes.some(write => write.sql.includes("INSERT INTO catalog.entry\n")), false);
  assert.equal(existing.length, 2);
});
