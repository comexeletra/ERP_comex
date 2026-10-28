import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { nextNcmRateRefresh, refreshNcmRates, registerTaxRateRoutes } from "../dist/tax-rates.js";

const actorId = "00000000-0000-4000-8000-000000000030";
const exceptionId = "00000000-0000-4000-8000-000000000031";
const gecexVersion = "00000000-0000-4000-8000-000000000032";
const tipiVersion = "00000000-0000-4000-8000-000000000033";
const general = { pisRate: "2.1", cofinsRate: "9.65", legalBasis: "Lei nº 10.865/2004, art. 8º", validFrom: "2015-05-01", validTo: null };
const storedException = { id: exceptionId, code: "30049099", pisRate: "3.52", cofinsRate: "16.48",
  legalBasis: "Art. 8º, § 1º", validFrom: "2026-01-01", validTo: null, version: "1" };

// Answers the read queries of the rate routes by the table they read.
function readQuery(sql, values, { overlap = false } = {}) {
  if (sql.includes("identity.erp_user AS u")) return null;
  if (sql.includes("SELECT DISTINCT importer")) return { rows: [] };
  if (sql.includes("FROM catalog.ncm_official_item")) {
    if (sql.includes("count(*) OVER")) return { rows: [
      { code: "07032090", name: "Outros", validFrom: "2022-04-01", validTo: null, total: "2" },
      { code: "30049099", name: "Outros medicamentos", validFrom: "2022-04-01", validTo: null, total: "2" },
    ] };
    return { rows: values[0] === "99999999" ? [] : [{ code: values[0], name: "Outros", validFrom: "2022-04-01", validTo: null }] };
  }
  if (sql.includes("FROM catalog.ncm_rate_version") && sql.includes("is_current")) return { rows: [
    { id: gecexVersion, source: "GECEX_272", sourceReference: "Resolução Gecex nº 272/2021 — nº 926",
      sourceUrl: "https://www.gov.br/mdic/x.xlsx", sourceUpdatedAt: "2026-10-26", fetchedAt: new Date("2026-10-28T10:00:00Z"),
      checkedAt: new Date("2026-10-28T10:00:00Z"), itemCount: 10516 },
    { id: tipiVersion, source: "TIPI", sourceReference: "TIPI", sourceUrl: "https://www.gov.br/receitafederal/tipi.xlsx",
      sourceUpdatedAt: null, fetchedAt: new Date("2026-10-28T10:00:00Z"), checkedAt: new Date("2026-10-28T10:00:00Z"), itemCount: 11102 },
  ] };
  if (sql.includes("FROM catalog.ncm_ii_rate")) return { rows: [{ code: "07032090", tecRate: "9", tecMarker: null,
    brazilRate: "9", brazilBasis: null }, { code: "30049099", tecRate: "8", tecMarker: null, brazilRate: null, brazilBasis: null }] };
  if (sql.includes("FROM catalog.ncm_ii_exception")) return { rows: [{ annex: "V", ncm: "07032090", exNumber: null,
    rate: "35", quota: null, validFrom: "2022-04-01", validTo: null, act: "Resolução Gecex nº 318", description: "Outros" }] };
  if (sql.includes("FROM catalog.ncm_ipi_rate")) return { rows: [
    { code: "07032090", exNumber: null, description: "Outros", rate: null, notTaxed: true },
    { code: "30049099", exNumber: null, description: "Outros", rate: "0", notTaxed: false }] };
  if (sql.includes("FROM catalog.pis_cofins_general_rate")) return { rows: [general] };
  if (sql.includes("FROM catalog.ncm_pis_cofins_exception")) {
    if (sql.includes("daterange")) return { rows: overlap ? [{ id: "other" }] : [] };
    return { rows: [storedException] };
  }
  if (sql.includes("FROM catalog.ncm_rate_source_state")) return { rows: [
    { source: "GECEX_272", lastAttemptAt: null, lastSuccessAt: null, lastError: null },
    { source: "TIPI", lastAttemptAt: null, lastSuccessAt: null, lastError: "HTTP 503" }] };
  return undefined;
}

async function fixture(t, { role = "Fiscal", overlap = false } = {}) {
  const writes = [];
  const pool = {
    async query(sql, values = []) {
      if (sql.includes("identity.erp_user AS u")) return { rows: [{ role, importer_code: null }] };
      const answer = readQuery(sql, values, { overlap });
      if (answer) return answer;
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, values = []) {
          writes.push({ sql, values });
          const answer = readQuery(sql, values, { overlap });
          if (answer) return answer;
          if (sql.includes("INSERT INTO catalog.ncm_pis_cofins_exception")) {
            return { rows: [{ ...storedException, code: values[1], pisRate: values[2], cofinsRate: values[3] }] };
          }
          if (sql.includes("UPDATE catalog.ncm_pis_cofins_exception")) return { rows: [{ ...storedException, version: "2" }] };
          return { rows: [], rowCount: 1 };
        },
        release() {},
      };
    },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    if (request.headers["x-anonymous"]) return;
    request.authContext = { issuer: "ci", subject: "fiscal", userId: actorId, displayName: null, sessionToken: "ci" };
  });
  await registerTaxRateRoutes(app, pool, { fetcher: async () => { throw new Error("Rede não usada neste teste"); } });
  return { app, writes };
}

test("M072 keeps rate versions, exceptions and the PIS/COFINS general rule apart from the NCM tables", async () => {
  const migration = await readFile(new URL("../migrations/M072_ncm_tax_rates.sql", import.meta.url), "utf8");
  for (const table of ["ncm_rate_version", "ncm_ii_rate", "ncm_ii_exception", "ncm_ipi_rate", "ncm_rate_source_state",
    "pis_cofins_general_rate", "ncm_pis_cofins_exception"]) assert.match(migration, new RegExp(`CREATE TABLE catalog\\.${table} `, "u"));
  assert.match(migration, /CREATE UNIQUE INDEX ux_ncm_rate_version_current ON catalog\.ncm_rate_version \(source\) WHERE is_current/u);
  assert.match(migration, /2\.10, 9\.65,\s+'Lei nº 10\.865\/2004, art\. 8º, I e II, com a redação da Lei nº 13\.137\/2015', DATE '2015-05-01'/u);
  const statements = migration.replace(/^--.*$/gmu, "");
  assert.doesNotMatch(statements, /ALTER TABLE|ncm_official_|ncm_siscomex_data|ncm_sync_state|ttce_chapter_cache|catalog\.entry\b|DELETE/u);
});

test("rate modules stay independent from the NCM update flow", async () => {
  for (const file of ["ncm-rates.ts", "tax-rates.ts"]) {
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from "\.\/(siscomex-ncm|mdic-ncm|ncm-sync|ncm-snapshot|ncm-scheduler|ttce|tax-treatments|catalog)\.js"/u, file);
    assert.doesNotMatch(source, /(INSERT INTO|UPDATE|DELETE FROM) catalog\.(ncm_official|ncm_last_siscomex|ncm_siscomex_data|ncm_sync_state|entry|ttce)/u, file);
  }
});

test("anyone with catalog.read lists the vigentes NCMs with composed II, IPI and PIS/COFINS", async t => {
  const { app } = await fixture(t, { role: "Consulta" });
  const response = await app.inject({ url: "/api/v1/ncm-rates?date=2026-10-28&q=0703&page=1&pageSize=50" });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(body.total, 2);
  assert.equal(body.referenceDate, "2026-10-28");
  const [garlic, medicine] = body.items;
  assert.deepEqual([garlic.ii.tec, garlic.ii.applied, garlic.ii.appliedSource, garlic.ipi.notTaxed, garlic.pisCofins.source],
    ["9", "35", "ANEXO_V", true, "GENERAL"]);
  assert.deepEqual([medicine.ii.applied, medicine.ii.appliedSource, medicine.ipi.rate, medicine.pisCofins.pis, medicine.pisCofins.reviewed],
    ["8", "TEC", "0", "3.52", true]);
  assert.deepEqual(body.sources.map(source => source.source), ["GECEX_272", "TIPI"]);
  assert.equal((await app.inject({ url: "/api/v1/ncm-rates?pageSize=900" })).statusCode, 400);
  assert.equal((await app.inject({ url: "/api/v1/ncm-rates", headers: { "x-anonymous": "1" } })).statusCode, 401);
});

test("NCM detail returns the exceptions and the PIS/COFINS periods; unknown codes are 404", async t => {
  const { app } = await fixture(t, { role: "Consulta" });
  const detail = await app.inject({ url: "/api/v1/ncm-rates/07032090?date=2026-10-28" });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().ii.exceptions[0].condition, "applied");
  const medicine = await app.inject({ url: "/api/v1/ncm-rates/30049099?date=2026-10-28" });
  assert.deepEqual([medicine.json().pisCofins.source, medicine.json().pisCofinsExceptions.length], ["EXCEPTION", 1]);
  assert.equal((await app.inject({ url: "/api/v1/ncm-rates/99999999" })).statusCode, 404);
  assert.equal((await app.inject({ url: "/api/v1/ncm-rates/0703" })).statusCode, 400);
  const status = await app.inject({ url: "/api/v1/ncm-rates/status" });
  assert.equal(status.statusCode, 200, status.body);
  assert.equal(status.json().sources[1].lastError, "HTTP 503");
});

test("only Master, Administrador and Fiscal refresh rates or keep PIS/COFINS exceptions", async t => {
  const reader = await fixture(t, { role: "Compras" });
  assert.equal((await reader.app.inject({ method: "POST", url: "/api/v1/ncm-rates/refresh" })).statusCode, 403);
  const payload = { code: "30049099", pisRate: "3.52", cofinsRate: "16.48", legalBasis: "Art. 8º, § 1º",
    validFrom: "2026-01-01", validTo: null, reason: "Medicamento com alíquota diferenciada" };
  assert.equal((await reader.app.inject({ method: "POST", url: "/api/v1/ncm-rates/pis-cofins-exceptions", payload })).statusCode, 403);

  const { app, writes } = await fixture(t);
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/ncm-rates/pis-cofins-exceptions",
    payload: { ...payload, pisRate: "101" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/ncm-rates/pis-cofins-exceptions",
    payload: { ...payload, validTo: "2025-01-01" } })).statusCode, 400);
  const created = await app.inject({ method: "POST", url: "/api/v1/ncm-rates/pis-cofins-exceptions", payload });
  assert.equal(created.statusCode, 201, created.body);
  assert.ok(writes.some(write => write.sql.includes("pg_advisory_xact_lock")));
  const audit = writes.find(write => write.sql.includes("INSERT INTO audit.audit_log"));
  assert.deepEqual([audit.values[1], audit.values[5], audit.values[9]],
    ["NCM_PIS_COFINS_EXCEPTION", "CREATE", "Medicamento com alíquota diferenciada"]);
  assert.ok(writes.some(write => write.sql.includes("INSERT INTO audit.outbox_message")));

  const overlapping = await fixture(t, { overlap: true });
  const conflict = await overlapping.app.inject({ method: "POST", url: "/api/v1/ncm-rates/pis-cofins-exceptions", payload });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().code, "PIS_COFINS_PERIOD_OVERLAP");
});

test("editing a PIS/COFINS exception requires its version and keeps the previous values in the audit", async t => {
  const { app, writes } = await fixture(t, { role: "Master" });
  const url = `/api/v1/ncm-rates/pis-cofins-exceptions/${exceptionId}`;
  const payload = { pisRate: "2.1", cofinsRate: "10.65", legalBasis: "Art. 8º, § 21", validFrom: "2026-01-01",
    validTo: "2026-12-31", reason: "Adicional de COFINS" };
  assert.equal((await app.inject({ method: "PATCH", url, payload })).statusCode, 428);
  const stale = await app.inject({ method: "PATCH", url, payload, headers: { "x-record-version": "5" } });
  assert.equal(stale.json().code, "VERSION_CONFLICT");
  const saved = await app.inject({ method: "PATCH", url, payload, headers: { "x-record-version": "1" } });
  assert.equal(saved.statusCode, 200, saved.body);
  const audit = writes.filter(write => write.sql.includes("INSERT INTO audit.audit_log")).at(-1);
  assert.equal(JSON.parse(audit.values[6]).cofinsRate, "16.48");
  assert.equal(JSON.parse(audit.values[7]).cofinsRate, "10.65");
});

function refreshPool({ currentHash = null } = {}) {
  const statements = [];
  const client = {
    async query(sql, values = []) {
      statements.push({ sql, values });
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      if (sql.includes("FROM catalog.ncm_rate_version")) {
        return { rows: currentHash ? [{ id: gecexVersion, sha256: currentHash, isCurrent: true }] : [] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {}, on() {}, off() {},
  };
  return { pool: { connect: async () => client, query: client.query }, statements };
}

test("a failed download keeps the current version and records the error only in the rate state", async () => {
  const { pool, statements } = refreshPool();
  const urls = [];
  const result = await refreshNcmRates(pool, async url => { urls.push(String(url)); return new Response("x", { status: 503 }); },
    { issuer: "system", subject: "ncm-rate-scheduler" }, "Atualização automática");
  assert.deepEqual(result.map(item => [item.source, item.status]), [["GECEX_272", "failed"], ["TIPI", "failed"]]);
  assert.ok(urls.every(url => url.startsWith("https://www.gov.br/")));
  assert.ok(urls.every(url => !/siscomex|portalunico/u.test(url)));
  assert.equal(statements.some(statement => /is_current\s*=\s*true/u.test(statement.sql)), false);
  assert.ok(statements.some(statement => statement.sql.includes("UPDATE catalog.ncm_rate_source_state")
    && statement.values.some(value => /HTTP 503/u.test(String(value)))));
  assert.equal(statements.some(statement => /ncm_official|ncm_sync_state|ncm_siscomex|ttce|catalog\.entry/u.test(statement.sql)), false);
  assert.ok(statements.some(statement => statement.sql.includes("pg_advisory_unlock")));
});

test("an unchanged file only refreshes the check time", async () => {
  const bytes = new TextEncoder().encode("same file");
  const { createHash } = await import("node:crypto");
  const { pool, statements } = refreshPool({ currentHash: createHash("sha256").update(bytes).digest("hex") });
  const result = await refreshNcmRates(pool, async url => String(url).endsWith(".xlsx") ? new Response(bytes)
    : new Response('<a href="https://www.gov.br/mdic/arquivos-listas/26-10-2026-anexos-i-a-x-resolucao-gecex-272-21.xlsx">x</a>'),
  { issuer: "system", subject: "ncm-rate-scheduler" }, "Atualização automática");
  assert.deepEqual(result.map(item => item.status), ["unchanged", "unchanged"]);
  assert.equal(statements.some(statement => statement.sql.includes("INSERT INTO catalog.ncm_ii_rate")), false);
  assert.ok(statements.some(statement => statement.sql.includes("SET checked_at")));
});

test("the daily rate refresh runs at its own Brasília time", () => {
  assert.equal(new Date(nextNcmRateRefresh(Date.parse("2026-10-28T09:00:00Z"), "07:00")).toISOString(), "2026-10-28T10:00:00.000Z");
  assert.equal(new Date(nextNcmRateRefresh(Date.parse("2026-10-28T10:00:00Z"), "07:00")).toISOString(), "2026-10-29T10:00:00.000Z");
  assert.throws(() => nextNcmRateRefresh(Date.now(), "7h"), /HH:mm/u);
});
