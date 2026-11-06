import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { clearanceEstimatesQueryParams, emptyClearanceFilters, formatBrl } from "../lib/clearance-estimates.ts";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [section, dashboard, styles] = await Promise.all([read("components/ClearanceEstimates.tsx"),
  read("components/PostShipmentDashboard.tsx"), read("app/styles/features/analysis.css")]);

test("the query sends only the chosen filters; all periods and empty lists are the defaults", () => {
  assert.equal(clearanceEstimatesQueryParams(emptyClearanceFilters).toString(), "");
  const params = clearanceEstimatesQueryParams({ ...emptyClearanceFilters, ipNumber: " 024 ", analysts: ["João", " "],
    suppliers: ["HEXING"], registered: ["no"], period: "nextWeek" });
  assert.deepEqual([...params.entries()], [["ipNumber", "024"], ["analysts", "João"], ["suppliers", "HEXING"],
    ["registered", "no"], ["period", "nextWeek"]]);
});

test("the estimate is shown in reais with two decimals, and a dash without a value", () => {
  assert.equal(formatBrl("834389.97", "pt-BR").replace(/\s/gu, " "), "R$ 834.389,97");
  assert.equal(formatBrl("0", "pt-BR").replace(/\s/gu, " "), "R$ 0,00");
  assert.equal(formatBrl("1337069.66", "en"), "R$1,337,069.66");
  assert.equal(formatBrl(null, "pt-BR"), "—");
});

test("the section comes after the charts of the post-shipment dashboard", () => {
  const charts = dashboard.indexOf("<PostShipmentCharts");
  const estimates = dashboard.indexOf("<ClearanceEstimates />");
  assert.ok(charts > 0 && estimates > charts, JSON.stringify([charts, estimates]));
});

test("the table shows the columns of the BI, in its order, with the total of the estimates", () => {
  const columns = [...section.matchAll(/<th(?: className="[^"]*")?>\{c\.(\w+)\}<\/th>/gu)].map(match => match[1]);
  assert.deepEqual(columns, ["ip", "referenceDate", "analyst", "importer", "status", "supplier", "eta", "registered",
    "value"]);
  // The date tells whether it is the DUIMP or, before it, the ETA.
  assert.match(section, /t\.referenceSources\[line\.referenceSource\]/u);
  assert.match(section, /<tfoot><tr className="clearance-total">/u);
  // The IP, the registration date and the amount are the key columns, in green as in the BI.
  assert.equal((section.match(/<th className="clearance-key[^"]*">/gu) ?? []).length, 3);
  assert.match(section, /formatBrl\(data\.totalBrl, locale\)/u);
  for (const m of [ptBR, en, zhCN]) {
    const t = m.reports.clearanceEstimates;
    for (const column of columns) assert.ok(t.columns[column], column);
    assert.ok(t.periods.nextWeek && t.periods.all && t.registeredOptions.yes && t.registeredOptions.no);
    assert.ok(t.referenceSources.duimp && t.referenceSources.eta);
    assert.match(t.nextWeekRange("09/11/2026", "15/11/2026"), /09\/11\/2026.*15\/11\/2026/u);
  }
});

test("the period applies at once and starts on next week; the other filters wait for Apply", () => {
  // The period is the last filter of the band, a one-choice slicer as in the BI.
  assert.match(section, /<fieldset className="clearance-period">/u);
  assert.ok(section.indexOf('className="clearance-period"') > section.indexOf("t.registered}<MultiSelectFilter"));
  assert.match(section, /useState<ClearanceFilters>\(\{ \.\.\.emptyClearanceFilters, period: "nextWeek" \}\)/u);
  assert.match(section, /onClick=\{\(\) => choosePeriod\(period\)\}/u);
  assert.match(section, /useDebouncedValue\(clearanceEstimatesQueryParams\(applied\)\.toString\(\), fetchDelayMs\)/u);
  assert.match(section, /\/api\/v1\/reports\/post-shipment\/clearance-estimates\?/u);
});

test("the section has its own style rules", () => {
  for (const rule of [".clearance-title {", ".clearance-period {", ".clearance-period-option {", ".clearance-table {",
    ".clearance-key {", ".clearance-money {", ".clearance-total > th, .clearance-total > td {"]) {
    assert.ok(styles.includes(rule), rule);
  }
});
