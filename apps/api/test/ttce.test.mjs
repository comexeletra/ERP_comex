import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerTaxTreatmentRoutes } from "../dist/tax-treatments.js";
import { createTtceClient, createTtceRepository, selectTtceTreatments } from "../dist/ttce.js";

const id = "00000000-0000-4000-8000-000000000001";
const sourceHash = "A".repeat(64);
const referenceDate = "2026-10-19";
const payload = {
  dataFatoGerador: referenceDate, capitulo: "40", hash: sourceHash,
  intervalosNcm: [{ intervaloInicialNcm: "40000000", intervaloFinalNcm: "40099999",
    origensDestinosTratamentos: [
      { todosPaisesOrigem: false, paisesOrigem: ["023"], destinosTratamentos: [
        { destinos: [{ todasUfsMunicipios: false, ufsMunicipios: [
          { ufDestino: "SP", todosMunicipios: false, municipioDestino: ["3550308"] },
        ] }], chavesTratamentos: [1] },
      ] },
      { todosPaisesOrigem: true, destinosTratamentos: [
        { destinos: [{ todasUfsMunicipios: true }], chavesTratamentos: [2] },
      ] },
    ] }],
  listaChavesTratamentos: [
    { chave: 1, tratamentos: { tributo: { codigo: "1", nome: "Imposto de Importação" },
      regime: { codigo: "3", nome: "Isenção" },
      fundamentoLegal: { codigo: "1005", nome: "Peças de aeronaves", tipo: "Opcional" },
      atributos: [{ codigo: "ATT_1", descricaoCodigo: "Uso", formaPreenchimento: "Texto" }] } },
    { chave: 2, tratamentos: { tributo: { codigo: "20", nome: "CBS" },
      regime: { codigo: "1", nome: "Integral" },
      fundamentoLegal: { codigo: "2000", nome: "Regra com atributo", tipo: "Normal" },
      atributos: [] } },
  ],
};

test("TTCE selects only treatments matching NCM, origin, UF and city", () => {
  const sp = selectTtceTreatments(payload, {
    ncm: "40091100", originCountry: "23", destinationUf: "SP", destinationCity: "3550308",
  });
  assert.deepEqual(sp.treatments.map(item => item.tax.code), ["1", "20"]);
  assert.equal(sp.treatments[0].attributes[0].name, "Uso");
  const rj = selectTtceTreatments(payload, {
    ncm: "40091100", originCountry: "158", destinationUf: "RJ", destinationCity: "3304557",
  });
  assert.deepEqual(rj.treatments.map(item => item.tax.code), ["20"]);
  assert.equal(selectTtceTreatments(payload, {
    ncm: "40100000", originCountry: "23", destinationUf: "SP", destinationCity: "3550308",
  }).matchedIntervals, 0);
  assert.throws(() => selectTtceTreatments({ ...payload, capitulo: "41" }, {
    ncm: "40091100", originCountry: "23", destinationUf: "SP", destinationCity: "3550308",
  }), /capítulo diferente/u);
});

test("TTCE client authenticates with access key, renews CSRF, and validates chapter/hash", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, headers: options.headers });
    if (url.endsWith("/portal/api/autenticar/chave-acesso")) {
      return new Response(null, { status: 200, headers: {
        "set-token": "jwt-test", "x-csrf-token": "csrf-1", "x-csrf-expiration": String(Date.now() + 3_000_000),
      } });
    }
    if (url.includes("/hash?")) return Response.json({ data: referenceDate, capitulo: "40", hash: sourceHash },
      { headers: { "x-csrf-token": "csrf-2" } });
    return Response.json(payload);
  };
  const client = createTtceClient({ clientId: "id-test", clientSecret: "secret-test", roleType: "IMPEXP" }, fetcher);
  assert.equal(await client.getHash(referenceDate, "40"), sourceHash);
  assert.deepEqual(await client.download(referenceDate, "40", sourceHash), payload);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].headers["X-CSRF-Token"], "csrf-1");
  assert.equal(calls[2].headers["X-CSRF-Token"], "csrf-2");
  assert.equal(calls[0].headers["Client-Secret"], "secret-test");
  assert.equal(calls[1].headers.Authorization, "jwt-test");
});

test("TTCE cache rechecks hash without redownloading and keeps a valid copy on failure", async () => {
  let checked = 0, downloaded = 0, fail = false;
  let row = { payload, source_hash: sourceHash, fetched_at: new Date("2026-10-19T10:00:00Z"),
    checked_at: new Date("2026-10-19T10:00:00Z") };
  const sqls = [];
  const pool = { async query(sql) {
    sqls.push(sql);
    if (sql.includes("SELECT payload")) return { rows: [row] };
    if (sql.includes("UPDATE catalog.ttce_chapter_cache")) { row = { ...row,
      checked_at: new Date("2026-10-19T12:00:00Z") }; return { rows: [] }; }
    throw new Error(`Unexpected query: ${sql}`);
  } };
  let now = Date.parse("2026-10-19T12:00:00Z");
  const client = { async getHash() { checked++; if (fail) throw new Error("TTCE offline"); return sourceHash; },
    async download() { downloaded++; throw new Error("Hash unchanged: download must not run"); } };
  const repo = createTtceRepository(pool, client, () => now);
  const first = await repo(referenceDate, "40");
  assert.equal(first.stale, false);
  assert.equal(checked, 1);
  assert.equal(downloaded, 0);
  fail = true;
  now += 2 * 60 * 60 * 1000;
  const fallback = await repo(referenceDate, "40");
  assert.equal(fallback.stale, true);
  assert.equal(fallback.sourceHash, sourceHash);
  assert.equal(sqls.some(sql => sql.includes("ncm_official") || sql.includes("ncm_sync_state")), false);
});

test("TTCE saves a changed chapter hash without replacing its historical copy", async () => {
  const replacementHash = "B".repeat(64);
  const rows = [{ payload, source_hash: sourceHash,
    fetched_at: new Date("2026-10-19T10:00:00Z"), checked_at: new Date("2026-10-19T10:00:00Z") }];
  const pool = { async query(sql, parameters) {
    if (sql.includes("SELECT payload")) return { rows: [rows.at(-1)] };
    if (sql.includes("INSERT INTO catalog.ttce_chapter_cache")) {
      rows.push({ payload: parameters[3], source_hash: parameters[2],
        fetched_at: new Date("2026-10-19T12:00:00Z"), checked_at: new Date("2026-10-19T12:00:00Z") });
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const changed = { ...payload, hash: replacementHash };
  const client = { async getHash() { return replacementHash; },
    async download(date, chapter, expected) {
      assert.equal(date, referenceDate);
      assert.equal(chapter, "40");
      assert.equal(expected, replacementHash);
      return changed;
    } };
  const selected = await createTtceRepository(pool, client,
    () => Date.parse("2026-10-19T12:00:00Z"))(referenceDate, "40");
  assert.equal(selected.sourceHash, replacementHash);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].source_hash, sourceHash);
});

test("TTCE respects an official release time and avoids repeated calls during the block", async () => {
  let calls = 0;
  const now = Date.parse("2026-10-19T17:00:00Z"); // 14:00 in Brasília
  const fetcher = async url => {
    calls++;
    if (url.endsWith("/portal/api/autenticar/chave-acesso")) return new Response(null, {
      status: 200, headers: { "set-token": "jwt-test", "x-csrf-token": "csrf-test" },
    });
    return Response.json({ message: "Limite atingido; tente após às 17:59:59." }, { status: 422 });
  };
  const client = createTtceClient({ clientId: "id", clientSecret: "secret", roleType: "IMPEXP" },
    fetcher, () => now);
  await assert.rejects(client.getHash(referenceDate, "40"), error => {
    assert.equal(error.status, 503);
    assert.equal(error.retryAt, Date.parse("2026-10-19T20:59:59Z"));
    return true;
  });
  await assert.rejects(client.getHash(referenceDate, "40"), /suspensa/u);
  assert.equal(calls, 2);
});

test("tax route keeps the current NCM consultation independent and explains unconfigured TTCE", async t => {
  let ncmQueries = 0;
  let validFrom = "2020-01-01";
  const pool = { async query(sql) {
    if (sql.includes("FROM identity.erp_user AS u")) return { rows: [{ role: "Consulta", importer_code: null }] };
    if (sql.includes("FROM catalog.entry")) { ncmQueries++; return { rows: [{ code: "40091100", name: "Tubos",
      valid_from: validFrom, valid_to: null }] }; }
    if (sql.includes("FROM catalog.ttce_chapter_cache")) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    if (request.headers["x-test-subject"] === "reader") {
      request.authContext = { issuer: "test", subject: "reader", userId: id, sessionToken: "test" };
    }
  });
  await registerTaxTreatmentRoutes(app, pool);
  const url = `/api/v1/ncms/${id}/tax-treatments?date=${referenceDate}`;
  const needs = await app.inject({ url, headers: { "x-test-subject": "reader" } });
  assert.equal(needs.statusCode, 200);
  assert.equal(needs.json().status, "needs_input");
  validFrom = null;
  const withoutKnownStart = await app.inject({ url, headers: { "x-test-subject": "reader" } });
  assert.equal(withoutKnownStart.statusCode, 200);
  assert.equal(withoutKnownStart.json().status, "needs_input");
  const unavailable = await app.inject({ url: `${url}&originCountry=23&destinationUf=SP&destinationCity=3550308`,
    headers: { "x-test-subject": "reader" } });
  assert.equal(unavailable.statusCode, 503);
  assert.match(unavailable.json().detail, /credenciais/u);
  assert.equal(ncmQueries, 3);
  assert.equal((await app.inject({ url })).statusCode, 401);
});
