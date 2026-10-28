import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerIcmsRateRoutes } from "../dist/icms-rates.js";

const actorId = "00000000-0000-4000-8000-000000000040";
const rateId = "00000000-0000-4000-8000-000000000041";
const benefitId = "00000000-0000-4000-8000-000000000042";
const gecexVersion = "00000000-0000-4000-8000-000000000043";
const tipiVersion = "00000000-0000-4000-8000-000000000044";
const prRate = { id: rateId, uf: "PR", rate: "19.5", fcpRate: "0", legalBasis: "Lei do Paraná", validFrom: "2024-03-12",
  validTo: null, reviewed: false, version: "1" };
const prState = { uf: "PR", includeSiscomexFee: true, includeAfrmm: true, includeOtherExpenses: true, reviewed: false, version: "1" };

function readQuery(sql, values, options) {
  if (sql.includes("SELECT DISTINCT importer")) return { rows: [] };
  if (sql.includes("FROM catalog.ncm_official_item")) {
    return { rows: values[0] === "99999999" ? [] : [{ code: values[0], name: "Outros", validFrom: "2022-04-01", validTo: null }] };
  }
  if (sql.includes("FROM catalog.ncm_rate_version") && sql.includes("is_current")) return { rows: [
    { id: gecexVersion, source: "GECEX_272", sourceReference: "Gecex", sourceUrl: "https://www.gov.br/mdic/x.xlsx",
      sourceUpdatedAt: null, fetchedAt: new Date(), checkedAt: new Date(), itemCount: 10516 },
    { id: tipiVersion, source: "TIPI", sourceReference: "TIPI", sourceUrl: "https://www.gov.br/receitafederal/tipi.xlsx",
      sourceUpdatedAt: null, fetchedAt: new Date(), checkedAt: new Date(), itemCount: 11102 }] };
  if (sql.includes("FROM catalog.ncm_ii_rate")) return { rows: [{ code: "85044090", tecRate: "14", tecMarker: null,
    brazilRate: null, brazilBasis: null }] };
  if (sql.includes("FROM catalog.ncm_ii_exception")) return { rows: [] };
  if (sql.includes("FROM catalog.ncm_ipi_rate")) return { rows: [{ code: "85044090", exNumber: null, description: "Outros",
    rate: "9.75", notTaxed: false }] };
  if (sql.includes("FROM catalog.pis_cofins_general_rate")) return { rows: [{ pisRate: "2.1", cofinsRate: "9.65",
    legalBasis: "Lei nº 10.865/2004", validFrom: "2015-05-01", validTo: null }] };
  if (sql.includes("FROM catalog.ncm_pis_cofins_exception")) return { rows: [] };
  if (sql.includes("FROM catalog.icms_import_state")) return { rows: options.noState ? [] : [prState] };
  if (sql.includes("FROM catalog.icms_import_rate")) {
    if (sql.includes("daterange")) return { rows: options.overlap ? [{ id: "other" }] : [] };
    return { rows: options.noRate ? [] : [prRate] };
  }
  if (sql.includes("FROM catalog.icms_import_benefit")) {
    if (sql.includes("daterange")) return { rows: [] };
    return { rows: options.benefits ?? [] };
  }
  if (sql.includes("FULL JOIN catalog.icms_importer_state")) return { rows: [
    { importer: "Eletra Cwb", uf: "PR", version: "1" }, { importer: "ELETRA CURITIBA", uf: null, version: null }] };
  if (sql.includes("FROM catalog.icms_importer_state")) {
    return { rows: options.unmapped ? [] : [{ importer: "ELETRA CWB", uf: "PR", version: "1" }] };
  }
  if (sql.includes("FROM catalog.operational_value")) return { rows: values[0] === "SEM CADASTRO" ? [] : [{ value: values[0] }] };
  return undefined;
}

async function fixture(t, { role = "Administrador", ...options } = {}) {
  const writes = [];
  const pool = {
    async query(sql, values = []) {
      if (sql.includes("identity.erp_user AS u")) return { rows: [{ role, importer_code: null }] };
      const answer = readQuery(sql, values, options);
      if (answer) return answer;
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, values = []) {
          writes.push({ sql, values });
          const answer = readQuery(sql, values, options);
          if (answer) return answer;
          if (sql.includes("INSERT INTO catalog.icms_import_rate")) return { rows: [{ ...prRate, id: values[0], rate: values[2] }] };
          if (sql.includes("UPDATE catalog.icms_import_rate")) return { rows: [{ ...prRate, rate: values[1], version: "2" }] };
          if (sql.includes("UPDATE catalog.icms_import_state")) return { rows: [{ ...prState, includeAfrmm: false, version: "2" }] };
          if (sql.includes("INSERT INTO catalog.icms_import_benefit")) return { rows: [{ id: benefitId, uf: "PR" }] };
          if (sql.includes("INSERT INTO catalog.icms_importer_state")) return { rows: [{ importer: values[0], uf: values[1], version: "1" }] };
          if (sql.includes("UPDATE catalog.icms_importer_state")) return { rows: [{ importer: "ELETRA CWB", uf: "CE", version: "2" }] };
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
    request.authContext = { issuer: "ci", subject: "admin", userId: actorId, displayName: null, sessionToken: "ci" };
  });
  await registerIcmsRateRoutes(app, pool);
  return { app, writes };
}

const estimateUrl = "/api/v1/ncm-rates/85044090/estimate?uf=PR&date=2026-10-28&customsValue=10000.00&siscomexFee=154.23&afrmm=0&otherExpenses=0";

test("M073 keeps ICMS per state for CE, AM and PR only, unreviewed, with the importer states", async () => {
  const migration = (await readFile(new URL("../migrations/M073_icms_import_rates.sql", import.meta.url), "utf8"))
    .replace(/^--.*$/gmu, "");
  assert.match(migration, /uf char\(2\) PRIMARY KEY CHECK \(uf IN \('AM', 'CE', 'PR'\)\)/u);
  assert.match(migration, /'PR', 19\.5, 0,/u);
  assert.match(migration, /'CE', 20, 0,/u);
  assert.match(migration, /'AM', 20, 0,/u);
  assert.match(migration, /\('ELETRA MATRIZ', 'CE', 'migration:M073'\)/u);
  assert.match(migration, /\('ELETRA CWB', 'PR', 'migration:M073'\)/u);
  assert.match(migration, /\('ELETRA MAO', 'AM', 'migration:M073'\)/u);
  assert.doesNotMatch(migration, /reviewed boolean NOT NULL DEFAULT true|ALTER TABLE|DELETE|ncm_official_|ncm_sync_state|operational_value/u);
});

test("anyone with catalog.read sees the ICMS per state and the importer states", async t => {
  const { app } = await fixture(t, { role: "Consulta" });
  const response = await app.inject({ url: "/api/v1/icms-rates" });
  assert.equal(response.statusCode, 200, response.body);
  const pr = response.json().states.find(state => state.uf === "PR");
  assert.deepEqual([pr.rates[0].rate, pr.rates[0].reviewed, pr.includeAfrmm], ["19.5", false, true]);
  // The registered importers are listed with the state matched regardless of case; unmapped ones have no state.
  assert.deepEqual(response.json().importers, [{ importer: "Eletra Cwb", uf: "PR", version: "1" },
    { importer: "ELETRA CURITIBA", uf: null, version: null }]);
});

test("the estimate composes the NCM rates with the state ICMS and flags what is not reviewed", async t => {
  const { app } = await fixture(t, { role: "Consulta" });
  const response = await app.inject({ url: estimateUrl });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.deepEqual([body.status, body.icms.amount, body.total, body.uf], ["complete", "3352.72", "7039.22", "PR"]);
  assert.ok(body.warnings.includes("ICMS_NOT_REVIEWED"));
  assert.ok(body.warnings.includes("PIS_COFINS_GENERAL_RULE"));
  assert.equal(body.icmsLegalBasis, "Lei do Paraná");
  const withBenefit = await fixture(t, { role: "Consulta", benefits: [
    { id: benefitId, uf: "PR", ncm: null, kind: "BASE_REDUCTION", percent: "50", legalBasis: "Redução geral",
      validFrom: "2026-01-01", validTo: null, version: "1" },
    { id: "b2", uf: "PR", ncm: "85044090", kind: "BASE_REDUCTION", percent: "40", legalBasis: "Redução da NCM",
      validFrom: "2026-01-01", validTo: null, version: "1" }] });
  const reduced = (await withBenefit.app.inject({ url: estimateUrl })).json();
  assert.equal(reduced.icms.baseReduction, "40");
  assert.ok(reduced.warnings.includes("BASE_REDUCTION_RULE_TO_CONFIRM"));
});

test("the estimate is incomplete without a state rate and refuses invalid input", async t => {
  const { app } = await fixture(t, { role: "Consulta", noRate: true });
  const missing = (await app.inject({ url: estimateUrl })).json();
  assert.deepEqual([missing.status, missing.missing, missing.total], ["incomplete", ["ICMS"], null]);
  assert.equal((await app.inject({ url: estimateUrl.replace("uf=PR", "uf=SP") })).statusCode, 400);
  assert.equal((await app.inject({ url: estimateUrl.replace("customsValue=10000.00", "customsValue=10,00") })).statusCode, 400);
  assert.equal((await app.inject({ url: estimateUrl.replace("85044090", "99999999") })).statusCode, 404);
});

test("only Master and Administrador keep ICMS rates, base expenses, benefits and importer states", async t => {
  const payload = { uf: "PR", rate: "19.5", fcpRate: "0", legalBasis: "Lei do Paraná", validFrom: "2027-01-01",
    validTo: null, reviewed: true, reason: "Conferido na lei estadual" };
  for (const role of ["Fiscal", "Compras"]) {
    const denied = await fixture(t, { role });
    assert.equal((await denied.app.inject({ method: "POST", url: "/api/v1/icms-rates/rates", payload })).statusCode, 403, role);
  }
  const { app, writes } = await fixture(t, { role: "Master" });
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/icms-rates/rates",
    payload: { ...payload, rate: "99", fcpRate: "2" } })).statusCode, 400);
  const created = await app.inject({ method: "POST", url: "/api/v1/icms-rates/rates", payload });
  assert.equal(created.statusCode, 201, created.body);
  const audit = writes.find(write => write.sql.includes("INSERT INTO audit.audit_log"));
  assert.deepEqual([audit.values[1], audit.values[5], audit.values[9]], ["ICMS_IMPORT_RATE", "CREATE", "Conferido na lei estadual"]);
  const overlapping = await fixture(t, { overlap: true });
  const conflict = await overlapping.app.inject({ method: "POST", url: "/api/v1/icms-rates/rates", payload });
  assert.equal(conflict.json().code, "ICMS_PERIOD_OVERLAP");

  const rateUrl = `/api/v1/icms-rates/rates/${rateId}`;
  const { uf: _uf, ...rateChange } = payload;
  assert.equal((await app.inject({ method: "PATCH", url: rateUrl, payload: rateChange })).statusCode, 428);
  assert.equal((await app.inject({ method: "PATCH", url: rateUrl, payload: rateChange,
    headers: { "x-record-version": "9" } })).json().code, "VERSION_CONFLICT");
  assert.equal((await app.inject({ method: "PATCH", url: rateUrl, payload: rateChange,
    headers: { "x-record-version": "1" } })).statusCode, 200);

  const state = await app.inject({ method: "PATCH", url: "/api/v1/icms-rates/states/PR", headers: { "x-record-version": "1" },
    payload: { includeSiscomexFee: true, includeAfrmm: false, includeOtherExpenses: true, reviewed: true, reason: "AFRMM fora da base" } });
  assert.equal(state.statusCode, 200, state.body);
  const benefit = await app.inject({ method: "POST", url: "/api/v1/icms-rates/benefits", payload: { uf: "PR", ncm: null,
    kind: "DEFERRAL", percent: "30", legalBasis: "Diferimento parcial", validFrom: "2026-01-01", validTo: null, reason: "Regime" } });
  assert.equal(benefit.statusCode, 201, benefit.body);
  const importer = await app.inject({ method: "PATCH", url: `/api/v1/icms-rates/importers/${encodeURIComponent("ELETRA CWB")}`,
    headers: { "x-record-version": "1" }, payload: { uf: "CE", reason: "Teste" } });
  assert.equal(importer.statusCode, 200, importer.body);
  const unmapped = await fixture(t, { role: "Administrador", unmapped: true });
  const url = `/api/v1/icms-rates/importers/${encodeURIComponent("ELETRA CURITIBA")}`;
  assert.equal((await unmapped.app.inject({ method: "PATCH", url, headers: { "x-record-version": "1" },
    payload: { uf: "PR", reason: "Curitiba" } })).json().code, "VERSION_CONFLICT");
  const first = await unmapped.app.inject({ method: "PATCH", url, headers: { "x-record-version": "0" },
    payload: { uf: "PR", reason: "Curitiba" } });
  assert.equal(first.statusCode, 200, first.body);
  assert.deepEqual(first.json(), { importer: "ELETRA CURITIBA", uf: "PR", version: "1" });
  assert.equal((await unmapped.app.inject({ method: "PATCH", url: `/api/v1/icms-rates/importers/${encodeURIComponent("Sem cadastro")}`,
    headers: { "x-record-version": "0" }, payload: { uf: "PR", reason: "Teste" } })).statusCode, 404);
});
