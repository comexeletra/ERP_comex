import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createEstimateUrl, customsValueFromForeign, formatMoney, normalizeMoneyInput,
  stateForImporter } from "../lib/import-estimate.ts";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";

const estimate = readFileSync(new URL("../components/ImportTaxEstimate.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../components/IcmsRatesPanel.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("../components/NcmRateDetail.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/catalog/ncm-rates/page.tsx", import.meta.url), "utf8");

test("money typed in Brazilian or dotted format reaches the API with at most 2 decimals", () => {
  assert.equal(normalizeMoneyInput("1.234,56"), "1234.56");
  assert.equal(normalizeMoneyInput("1234.5"), "1234.5");
  assert.equal(normalizeMoneyInput("0"), "0");
  assert.equal(normalizeMoneyInput("12,345"), null);
  assert.equal(normalizeMoneyInput("-5"), null);
  assert.equal(normalizeMoneyInput(""), null);
});

test("customs value from FOB, freight and insurance uses exact decimal conversion", () => {
  // (1.000,00 + 150,00 + 10,00) × 5,4321 = 6.301,236 → 6.301,24
  assert.equal(customsValueFromForeign("1000", "150", "10", "5,4321"), "6301.24");
  assert.equal(customsValueFromForeign("1000", "", "", "5"), "5000.00");
  assert.equal(customsValueFromForeign("abc", "0", "0", "5"), null);
});

test("the estimate asks the API with the state, date and values", () => {
  assert.equal(createEstimateUrl("85044090", { uf: "PR", date: "2026-10-28", customsValue: "10000.00",
    siscomexFee: "154.23", afrmm: "", otherExpenses: "" }),
  "/api/v1/ncm-rates/85044090/estimate?uf=PR&customsValue=10000.00&siscomexFee=154.23&afrmm=0&otherExpenses=0&date=2026-10-28");
  assert.equal(formatMoney("3352.72", "pt-BR").replace(/\s/gu, " "), "R$ 3.352,72");
  assert.equal(formatMoney(null, "pt-BR"), "—");
});

test("the importer suggests its state: Matriz and FOR are Ceará", () => {
  const importers = [{ importer: "Eletra Matriz", uf: "CE" }, { importer: "Eletra Cwb", uf: "PR" }, { importer: "X", uf: "SP" },
    { importer: "ELETRA CURITIBA", uf: null }];
  assert.equal(stateForImporter("Eletra Matriz", importers), "CE");
  assert.equal(stateForImporter("Eletra Cwb", importers), "PR");
  assert.equal(stateForImporter("ELETRA CURITIBA", importers), null);
  assert.equal(stateForImporter("X", importers), null);
});

test("screens call only the ICMS routes the API registers and keep management to Master and Administrador", () => {
  assert.match(estimate, /createEstimateUrl\(code,/u);
  assert.match(estimate, /"\/api\/v1\/icms-rates"/u);
  assert.match(panel, /"\/api\/v1\/icms-rates\/rates"/u);
  assert.match(panel, /`\/api\/v1\/icms-rates\/rates\/\$\{/u);
  assert.match(panel, /`\/api\/v1\/icms-rates\/states\/\$\{/u);
  assert.match(panel, /"\/api\/v1\/icms-rates\/benefits"/u);
  assert.match(panel, /`\/api\/v1\/icms-rates\/importers\/\$\{encodeURIComponent\(/u);
  assert.match(page, /\["Master", "Administrador"\]\.includes\(role\)/u);
  assert.match(detail, /<ImportTaxEstimate code=\{code\}/u);
  for (const source of [estimate, panel]) assert.doesNotMatch(source, /refresh-official|sync-status|import-official/u);
});

test("each form opens on the line of its edit button, not at the top of the panel", () => {
  assert.match(panel, /editing && placeOf\(editing\) === place/u);
  assert.match(panel, /here\(`importer:\$\{item\.importer\}`\)/u);
  assert.match(panel, /here\(`rate:\$\{row\.id\}`\)/u);
  assert.match(panel, /here\(`benefit:\$\{row\.id\}`\)/u);
  // New rate, new benefit and the expenses open below the state buttons.
  assert.match(panel, /here\(`uf:\$\{state\.uf\}`\)/u);
  assert.doesNotMatch(panel, /\n\s*\{form\}\n/u);
});

test("the review badge appears only in the situation column of each rate", () => {
  assert.equal(panel.match(/t\.notReviewed/gu)?.length, 1);
  assert.match(panel, /row\.reviewed \? t\.reviewed : t\.notReviewed/u);
  assert.doesNotMatch(panel, /state\.reviewed \?/u);
  // Each state is its own spaced block, with its rate table and buttons apart.
  assert.match(panel, /className="ncm-rate-section icms-state"/u);
  assert.match(panel, /className="icms-rates-table"/u);
});

test("a state saved in the panel reaches the simulator without reloading the page", () => {
  assert.match(panel, /window\.dispatchEvent\(new Event\(ICMS_RATES_CHANGED\)\)/u);
  assert.match(estimate, /window\.addEventListener\(ICMS_RATES_CHANGED, /u);
  assert.match(estimate, /window\.removeEventListener\(ICMS_RATES_CHANGED, /u);
  // The importer already chosen takes its new state.
  assert.match(estimate, /stateForImporter\(current, body\.importers\)/u);
  assert.match(estimate, /t\.importerWithoutState/u);
});

test("the three dictionaries describe the estimate and the ICMS panel", () => {
  for (const messages of [ptBR, en, zhCN]) {
    assert.ok(messages.importEstimate.title.length > 3);
    assert.ok(messages.importEstimate.disclaimer.length > 20);
    assert.ok(messages.importEstimate.importerWithoutState.length > 3);
    assert.equal(typeof messages.importEstimate.warnings.ICMS_NOT_REVIEWED, "string");
    assert.ok(messages.icmsRates.title.length > 3);
  }
});
