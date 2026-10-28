import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createNcmRatesUrl, describeIiSource, describeIpi, formatNcmCode, formatRate, normalizeRateInput,
  pisCofinsPayload, readNcmRateRefreshStart } from "../lib/ncm-rates.ts";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";

const page = readFileSync(new URL("../app/catalog/ncm-rates/page.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("../components/NcmRateDetail.tsx", import.meta.url), "utf8");
const values = readFileSync(new URL("../app/catalog/values/page.tsx", import.meta.url), "utf8");
const catalog = readFileSync(new URL("../app/catalog/page.tsx", import.meta.url), "utf8");

test("the rate list asks the API for one page of vigentes NCMs with search, chapter and date", () => {
  assert.equal(createNcmRatesUrl({ search: "  8504 ", chapter: "85", date: "2026-10-28", page: 2 }),
    "/api/v1/ncm-rates?page=2&pageSize=50&q=8504&chapter=85&date=2026-10-28");
  assert.equal(createNcmRatesUrl({ search: "", chapter: "8", date: "", page: 1 }), "/api/v1/ncm-rates?page=1&pageSize=50");
});

test("rates keep the API decimal text and show NT apart from zero", () => {
  assert.equal(formatRate("9.75", "pt-BR"), "9,75%");
  assert.equal(formatRate("9.75", "en"), "9.75%");
  assert.equal(formatRate(null, "pt-BR"), "—");
  assert.equal(describeIpi({ rate: null, notTaxed: true, status: "ok" }, ptBR, "pt-BR"), "NT (não tributado)");
  assert.equal(describeIpi({ rate: "0", notTaxed: false, status: "ok" }, ptBR, "pt-BR"), "0%");
  assert.equal(describeIiSource("ANEXO_V", ptBR), "Anexo V da Resolução Gecex nº 272/2021");
  assert.equal(describeIiSource("ANEXO_V", en), "Annex V of Gecex Resolution 272/2021");
  assert.equal(formatNcmCode("85044090"), "8504.40.90");
});

test("PIS/COFINS exceptions send percentages from 0 to 100 with a legal basis and a valid period", () => {
  assert.equal(normalizeRateInput("3,52"), "3.52");
  assert.equal(normalizeRateInput("100.5"), null);
  assert.equal(normalizeRateInput("1.23456"), null);
  const draft = { pisRate: "3,52", cofinsRate: "16,48", legalBasis: " Art. 8º, § 1º ", validFrom: "2026-01-01", validTo: "" };
  assert.deepEqual(pisCofinsPayload(draft, "Medicamento"), { pisRate: "3.52", cofinsRate: "16.48",
    legalBasis: "Art. 8º, § 1º", validFrom: "2026-01-01", validTo: null, reason: "Medicamento" });
  assert.equal(pisCofinsPayload({ ...draft, validTo: "2025-12-31" }, "x"), null);
  assert.equal(pisCofinsPayload({ ...draft, legalBasis: "" }, "x"), null);
});

test("manual refresh accepts only the asynchronous API answer", async () => {
  assert.equal(await readNcmRateRefreshStart(Response.json({ status: "started" }, { status: 202 }), ptBR), "started");
  await assert.rejects(readNcmRateRefreshStart(new Response("Bad Gateway", { status: 502 }), zhCN), /502/u);
  await assert.rejects(readNcmRateRefreshStart(Response.json({ ok: true }, { status: 200 }), ptBR), /não foi confirmada/u);
});

test("screens call only the rate routes the API registers and gate management to Master, Administrador and Fiscal", () => {
  for (const route of ["/api/v1/ncm-rates/status", "/api/v1/ncm-rates/refresh"]) assert.match(page, new RegExp(route, "u"));
  assert.match(page, /createNcmRatesUrl\(/u);
  assert.match(detail, /`\/api\/v1\/ncm-rates\/\$\{code\}\?/u);
  assert.match(detail, /"\/api\/v1\/ncm-rates\/pis-cofins-exceptions"/u);
  assert.match(detail, /`\/api\/v1\/ncm-rates\/pis-cofins-exceptions\/\$\{editing\.id\}`/u);
  assert.match(detail, /"x-record-version": editing\.version/u);
  assert.match(page, /\["Master", "Administrador", "Fiscal"\]/u);
  assert.match(values, /<NcmRateDetail code=\{ncm\.code\}/u);
  assert.match(catalog, /href="\/catalog\/ncm-rates"/u);
  // The screens never call the NCM update routes.
  for (const source of [page, detail]) assert.doesNotMatch(source, /refresh-official|sync-status|import-official/u);
});

test("the three dictionaries describe the rate screen", () => {
  for (const messages of [ptBR, en, zhCN]) {
    assert.ok(messages.ncmRates.title.length > 3);
    assert.ok(messages.ncmRates.disclaimer.length > 20);
    assert.equal(typeof messages.ncmRates.sourceAnnex("V"), "string");
  }
});
