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
  source: "SISCOMEX", sourceReference: "Siscomex",
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
  const syncState = {
    last_attempt_at: null, last_success_at: null, last_source: null,
    last_siscomex_success_at: null, last_error: null,
    next_attempt_at: new Date(0), retry_mode: false,
  };
  const pool = {
    async query(sql, values = []) {
      if (sql.includes("FROM catalog.ncm_sync_state")) return { rows: [syncState] };
      if (sql.includes("FROM catalog.ncm_official_snapshot")) return { rows: [{
        catalog_source: "MDIC_GECEX", item_count: 10516,
        synced_at: new Date("2026-10-17T19:59:27Z") }] };
      if (sql.includes("FROM catalog.ncm_last_siscomex_snapshot")) return { rows: [] };
      if (sql.includes("FROM identity.erp_user AS u")) return { rows: [{ role: "Fiscal", importer_code: null }] };
      if (sql.includes("SELECT normalized_code FROM catalog.entry")) {
        return { rows: registeredCodes.filter(code => values[0].includes(code)).map(normalized_code => ({ normalized_code })) };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, values = []) {
          if (sql.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
          if (sql.includes("pg_advisory_unlock")) return { rows: [{ pg_advisory_unlock: true }] };
          if (sql.includes("FROM catalog.ncm_sync_state")) return { rows: [syncState] };
          if (sql.includes("UPDATE catalog.ncm_sync_state")) {
            if (values.length === 4) {
              syncState.last_source = values[0];
              syncState.next_attempt_at = values[2];
              syncState.retry_mode = values[3];
            }
            return { rows: [], rowCount: 1 };
          }
          if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) || sql.includes("pg_advisory_xact_lock")) {
            writes.push({ sql, values }); return { rows: [], rowCount: 0 };
          }
          if (sql.includes("SELECT payload_sha256, entry_id FROM catalog.command_receipt")) return { rows: [], rowCount: 0 };
          if (sql.includes("SELECT id FROM catalog.entry WHERE kind='NCM'")) {
            const current = existing.find(row => row.code === values[0]) ?? writes.find(row => row.entry?.code === values[0])?.entry;
            return { rows: current ? [{ id: current.id }] : [], rowCount: current ? 1 : 0 };
          }
          if (sql.includes("SELECT entry.*, entry.normalized_code")) return { rows: existing.map(row => ({ ...row })), rowCount: existing.length };
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

test("sync status returns durable schedule and both snapshot sources without private configuration", async t => {
  const { app } = await createApp();
  t.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/api/v1/ncms/sync-status",
    headers: { "x-test-subject": "fiscal" } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().snapshot.source, "MDIC_GECEX");
  assert.equal(response.json().snapshot.itemCount, 10516);
  assert.equal(response.json().lastSiscomexSnapshot, null);
  assert.ok(response.json().nextAttemptAt);
  assert.equal(response.headers["cache-control"], "no-store");
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
  const { app, writes, audit, existing } = await createApp({ existing: [current, historical] });
  t.after(() => app.close());

  const response = await app.inject({ method: "POST", url: "/api/v1/ncms/refresh-official",
    headers: { "x-test-subject": "fiscal" }, payload: {} });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().matchedCount, 1);
  assert.equal(response.json().updatedCount, 1);
  assert.equal(response.json().attributesUpdatedCount, 1);
  assert.equal(response.json().preservedUnmatchedCount, 1);
  assert.equal(current.name, "Componente de teste A");
  assert.equal(current.status, "ACTIVE");
  assert.equal(current.valid_from, "2022-04-01");
  assert.equal(current.valid_to, "9999-12-31");
  assert.equal(current.provenance, "OFFICIAL_SISCOMEX");
  assert.equal(historical.name, "NCM histórico");
  assert.equal(writes.some(write => write.sql.includes("INSERT INTO catalog.entry\n")), false);
  assert.equal(writes.some(write => write.sql.includes("INSERT INTO catalog.ncm_siscomex_data")), true);
  assert.equal(audit.some(event => event.values[2] === "valid_to"), true);
  assert.equal(audit.some(event => event.sql.includes("mandatoryImportAttributes")), true);
  assert.equal(existing.length, 2);
});

test("a complete MDIC list cannot overwrite or inactivate registered Siscomex codes", async t => {
  const current = makeEntry("10000001", "Nome antigo", { status: "ACTIVE" });
  const absent = makeEntry("99999999", "NCM anterior", { status: "ACTIVE" });
  const provider = async () => ({ ...official, source: "MDIC_GECEX",
    verifiedComplete: true, siscomexFailure: "Siscomex HTTP 422; catálogo MDIC carregado.",
    items: [{ ...official.items[0], validFrom: null, validTo: null }] });
  const { app, existing, audit, outbox, writes } = await createApp({ provider, existing: [current, absent] });
  t.after(() => app.close());
  const response = await app.inject({ method: "POST", url: "/api/v1/ncms/refresh-official",
    headers: { "x-test-subject": "fiscal" }, payload: {} });
  assert.equal(response.statusCode, 500, response.body);
  assert.equal(current.name, "Nome antigo");
  assert.equal(absent.status, "ACTIVE");
  assert.equal(absent.valid_from, "2022-04-01");
  assert.equal(existing.length, 2);
  assert.equal(writes.some(write => write.sql.includes("UPDATE catalog.entry")), false);
  assert.equal(audit.length, 0);
  assert.equal(outbox.length, 0);
});

test("an MDIC search result is rejected while Siscomex is the only active source", async t => {
  const absent = makeEntry("99999999", "NCM anterior", { status: "ACTIVE" });
  const provider = async () => ({ ...official, source: "MDIC_GECEX", verifiedComplete: false,
    items: [{ ...official.items[0], validFrom: null, validTo: null }] });
  const { app } = await createApp({ provider, existing: [absent] });
  t.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/api/v1/ncms/official-search?search=10000001",
    headers: { "x-test-subject": "fiscal" } });
  assert.equal(response.statusCode, 502, response.body);
  assert.equal(response.json().code, "SISCOMEX_UNAVAILABLE");
  assert.equal(absent.status, "ACTIVE");
});

test("official NCM failures return the retry window for search and refresh without writing", async t => {
  const retryAt = Date.now() + 60_000;
  const provider = async () => { throw Object.assign(new Error("rate limited"), { retryAt }); };
  const { app, writes } = await createApp({ provider });
  t.after(() => app.close());

  const search = await app.inject({ method: "GET", url: "/api/v1/ncms/official-search?search=70",
    headers: { "x-test-subject": "fiscal" } });
  assert.equal(search.statusCode, 503, search.body);
  assert.equal(search.headers["retry-after"], "60");
  assert.match(search.json().detail, /horário de Brasília/u);

  const refresh = await app.inject({ method: "POST", url: "/api/v1/ncms/refresh-official",
    headers: { "x-test-subject": "fiscal" }, payload: {} });
  assert.equal(refresh.statusCode, 503, refresh.body);
  assert.ok(Number(refresh.headers["retry-after"]) > 0);
  assert.equal(writes.length, 0);
});
