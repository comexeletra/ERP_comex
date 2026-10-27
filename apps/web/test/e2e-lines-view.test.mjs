import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildE2eFlow, DEFAULT_E2E_FLOW_CONFIG } from "../lib/e2e-flow.ts";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [view, overview, panels, parts, tabs, page, modelPage, styles, flowLib] = await Promise.all([
  read("components/E2eLinesView.tsx"), read("components/E2eOverviewCharts.tsx"),
  read("components/E2eModelPanels.tsx"), read("components/E2eFlowParts.tsx"),
  read("components/E2eTabs.tsx"), read("app/end-to-end/page.tsx"), read("app/end-to-end/model/page.tsx"),
  read("app/styles/features/e2e.css"), read("lib/e2e-flow.ts")]);

test("the optional overview precedes the model and cross-filters by status and deadline", () => {
  assert.match(view, /overview\?: E2eOverview/u);
  assert.match(view, /\{counts\?\.overview && <E2eCollapsible title=\{t\.overview\.label\}/u);
  // The charts sit right above the product line filters, below the model panels.
  assert.ok(view.indexOf("<E2eModelDetails") < view.indexOf("<E2eOverviewCharts"));
  assert.ok(view.indexOf("<E2eOverviewCharts") < view.indexOf('<form className="portfolio-filter product-lines-filter"'));
  assert.ok(view.indexOf("t.overview.loading") > view.indexOf("<E2eModelDetails"));
  // Clicking the selected category again clears it.
  assert.match(view, /const filters: ProductLineFilters = \{ \.\.\.applied, status: applied\.status === status \? "" : status \};/u);
  assert.match(view, /setDraft\(filters\); applyFilters\(filters\);/u);
  assert.match(view, /const next = deadline === selected \? "" : selected;/u);
  assert.match(view, /setDeadline\(next\); syncUrl\(applied, \{ \.\.\.stage, deadline: next \}, 1\);/u);
  assert.match(view, /onStatusSelect=\{filterByStatus\}/u);
  assert.match(view, /onDeadlineSelect=\{selectDeadline\}/u);
  assert.match(view, /selectedDeadline=\{deadline\}/u);
  // Clear also removes the deadline chosen on the chart.
  assert.match(view, /setDeadline\(""\); setDelayRange\(""\);/u);
  assert.match(view, /applyFilters\(emptyProductLineFilters, \{ \.\.\.stage, deadline: "", delayRange: "" \}\);/u);
  // The delay range bars cross-filter the same way.
  assert.match(view, /const next = delayRange === selected \? "" : selected;/u);
  assert.match(view, /setDelayRange\(next\); syncUrl\(applied, \{ \.\.\.stage, delayRange: next \}, 1\);/u);
  assert.match(view, /selectedDelayRange=\{delayRange\} onDelayRangeSelect=\{selectDelayRange\}/u);
});

test("the overview charts and the product line filters can be collapsed", () => {
  assert.match(view, /<E2eCollapsible title=\{t\.overview\.label\} storageKey="erp-comex-e2e-charts-collapsed"/u);
  assert.match(view, /activeCount=\{\(applied\.status \? 1 : 0\) \+ \(deadline \? 1 : 0\) \+ \(delayRange \? 1 : 0\)\}/u);
  assert.match(view, /<E2eCollapsible className="card" title=\{t\.panels\.filtersTitle\} storageKey="erp-comex-e2e-filters-collapsed"/u);
  assert.match(view, /activeCount=\{activeProductLineFilterCount\(applied\)\}/u);
  // The charts stay inside their panel, and the filter form inside the other one.
  const charts = view.indexOf("storageKey=\"erp-comex-e2e-charts-collapsed\"");
  const filters = view.indexOf("storageKey=\"erp-comex-e2e-filters-collapsed\"");
  assert.ok(charts < view.indexOf("<E2eOverviewCharts") && view.indexOf("<E2eOverviewCharts") < filters);
  assert.ok(filters < view.indexOf('<form className="portfolio-filter product-lines-filter"'));
  for (const messages of [ptBR, en, zhCN]) {
    assert.equal(typeof messages.e2eLines.panels.active(2), "string");
    for (const key of ["filtersTitle", "show", "hide"]) assert.ok(messages.e2eLines.panels[key], key);
  }
});

test("a collapsed chart block still says it holds charts and shows their shape", () => {
  assert.match(view, /storageKey="erp-comex-e2e-charts-collapsed"[\s\S]*?icon="chart"/u);
  assert.match(view, /storageKey="erp-comex-e2e-filters-collapsed"[\s\S]*?icon="filter"/u);
  assert.match(view, /collapsedSummary=\{<E2eOverviewMini overview=\{counts\.overview\} locale=\{locale\} \/>\}/u);
  // The mini bar repeats the status colours but is only a picture: the full charts hold the filters.
  assert.match(overview, /export function E2eOverviewMini/u);
  assert.match(overview, /className="e2e-distribution e2e-distribution-mini" aria-hidden="true"/u);
  assert.match(overview, /o\.chartsHidden\(/u);
  for (const messages of [ptBR, en, zhCN]) assert.equal(typeof messages.e2eLines.overview.chartsHidden(3, "1"), "string");
});

test("the delay range bars are clickable rows sorted by quantity, with no image role", () => {
  assert.match(overview, /byDelayRange\?: Record<E2eDelayRange, OverviewPart>/u);
  assert.match(overview, /rankedIndexes\(/u);
  assert.match(overview, /<button type="button" className=\{`e2e-range-row/u);
  assert.match(overview, /aria-pressed=\{entry\.key === selected\}/u);
  assert.match(overview, /filterLabel=\{o\.filterByDelayRange\}/u);
  // The status chart spans the row; the deadline pie and the delay ranges share the next one.
  assert.match(overview, /"e2e-overview-card e2e-overview-card-wide"/u);
  assert.match(overview, /title=\{o\.statusTitle\} total=\{statusTotal\} selected=\{selectedStatus !== ""\} wide/u);
  for (const messages of [ptBR, en, zhCN]) {
    assert.equal(Object.keys(messages.e2eLines.overview.delayRanges).length, 9);
    assert.ok(messages.e2eLines.overview.delayRangeTitle);
  }
});

test("both overview charts are clickable through their legends and keep the keyboard out of the images", () => {
  assert.equal((overview.match(/role="img"/gu) ?? []).length, 2);
  assert.doesNotMatch(overview, /tabIndex|role="button"|formatNumber|e2e-pie-label|e2e-pie-guide/u);
  assert.match(overview, /<button type="button" className=\{`e2e-chart-legend-item/u);
  assert.match(overview, /aria-pressed=\{entry\.key === selected\}/u);
  assert.match(overview, /selected=\{selectedStatus\} onSelect=\{onStatusSelect\}/u);
  assert.match(overview, /selected=\{selectedDeadline\} onSelect=\{onDeadlineSelect\}/u);
  // Mouse shortcuts on the marks; the legend is the keyboard path.
  assert.match(overview, /className=\{`e2e-distribution-segment/u);
  assert.match(overview, /aria-hidden="true"/u);
  assert.match(overview, /m\.e2eLines\.overview\.clearSelection/u);
});

test("the first End to End screen shows the model and the product lines together", async () => {
  assert.match(page, /<E2eLinesView initialQuery=\{query\.toString\(\)\} \/>/u);
  assert.match(modelPage, /redirect\("\/end-to-end"\)/u);
  await assert.rejects(read("components/E2eFlowDemo.tsx"), { code: "ENOENT" });
  // One tab for the model and the lines, pointing to the first screen.
  assert.match(tabs, /\{ key: "model", href: "\/end-to-end" \}/u);
  assert.doesNotMatch(tabs, /key: "lines"/u);
  assert.match(view, /<E2eTabs current="model" \/>/u);
  // The scenario toggles change only the model; the stage drives both the model and the lines.
  assert.match(view, /const model = buildE2eFlow\(DEFAULT_E2E_FLOW_CONFIG, \{ mts, air \}, m\);/u);
  assert.match(view, /<E2eFlowRail phases=\{model\.phases\} current=\{current\} \/>/u);
  assert.match(view, /<E2eModelSummary flow=\{model\} current=\{current\} \/>/u);
  assert.match(view, /<E2eModelDetails flow=\{model\} current=\{current\} mts=\{mts\} air=\{air\} \/>/u);
  // It opens with no stage selected and stopped.
  assert.match(view, /useE2eStepper\(E2E_STAGE_CODES\.length, DEFAULT_E2E_FLOW_CONFIG\.intervaloMs, false,/u);
  assert.doesNotMatch(flowLib, /autoplay|E2E_PHASE_COUNT/u);
  // The panels accept no stage and ask for one.
  assert.match(panels, /current: number \| null/u);
  assert.match(panels, /t\.selectPhase/u);
  // Rail, icons and stepper stay shared.
  assert.match(view, /import \{ E2eFlowRail, Icon, useE2eStepper \} from "\.\/E2eFlowParts";/u);
  assert.match(panels, /import \{ Arrow \} from "\.\/E2eFlowParts";/u);
  assert.match(parts, /export function useE2eStepper/u);
});

test("each stage card joins the model phase and the line counts", () => {
  assert.match(view, /\{model\.phases\.map\(\(phase, k\) =>/u);
  assert.match(view, /<strong>\{phase\.name\}<\/strong>/u);
  assert.match(view, /<span className="e2e-label">\{phase\.owner\}<\/span><b>\{phase\.lt\}<\/b>/u);
  assert.match(view, /<span className="e2e-stage-count">/u);
  assert.match(view, /view === "current" \? flow\.inStage\(total\) : flow\.passed\(total\)/u);
  // Clicking the selected stage clears it.
  assert.match(view, /onClick=\{\(\) => select\(k === current \? null : k\)\}/u);
});

test("the lines follow the selected stage, view and late filter on the API routes", () => {
  // Contract with GET /api/v1/purchase-order-lines (stage, view, late) and its stage summary.
  assert.match(view, /apiFetch\(`\/api\/v1\/purchase-order-lines\?\$\{query\}`/u);
  assert.match(view, /productLineQuery\(applied, page, pageSize, stage\)/u);
  assert.match(view, /apiFetch\(`\/api\/v1\/purchase-order-lines\/e2e-stages\?\$\{summaryQuery\}`/u);
  assert.match(view, /const summaryQuery = e2eSummaryQuery\(applied, deadline, delayRange\)\.toString\(\);/u);
  assert.match(view, /const stage: E2eStageFilter = \{ stage: current === null \? "" : E2E_STAGE_CODES\[current\], view, late, deadline,\s+delayRange \};/u);
  // The export downloads what the table shows.
  assert.match(view, /downloadExcel\(applied, stage\)/u);
  // Loaded stages are kept, so the animation does not reload them on every pass.
  assert.match(view, /if \(cached\) return undefined;/u);
  // The accumulated view shows the delay accumulated up to the selected stage.
  assert.match(view, /e2e\?\.stages\[accumulatedStage\]\.accumulatedDelayDays/u);
});

test("the stage cards, the selected columns and the texts exist in every language", () => {
  for (const rule of [".e2e-stage-count", ".e2e-lines-table .is-selected", ".e2e-lines-table .e2e-stage-head.is-selected"]) {
    assert.ok(styles.includes(`${rule} {`), rule);
  }
  assert.ok(!styles.includes(".e2e-stage-card"));
  assert.equal(ptBR.e2eLines.flow.viewCurrent, "Na etapa");
  assert.equal(ptBR.e2eLines.flow.viewReached, "Acumulada");
  assert.equal(ptBR.e2eLines.flow.lateOnly, "Só atrasados");
  assert.equal(ptBR.e2e.selectPhase, "Selecione uma etapa nos cards acima para ver o prazo, a janela, a regra e os documentos.");
  for (const messages of [ptBR, en, zhCN]) {
    assert.deepEqual(Object.keys(messages.e2eTabs), ["label", "model", "po", "targets"]);
    for (const unused of ["eyebrow", "title", "intro", "toolbar"]) assert.equal(unused in messages.e2e, false, unused);
    assert.ok(messages.e2e.selectPhase);
    assert.match(messages.e2eLines.flow.inStage(3), /3/u);
    assert.match(messages.e2eLines.flow.accumulated("T3"), /T3/u);
  }
  assert.equal(ptBR.e2eLines.flow.inStage(1), "1 produto na etapa");
  assert.equal(ptBR.e2eLines.flow.late(2), "2 atrasados");
});

test("the stage columns use the company names shown on the model cards", () => {
  for (const messages of [ptBR, en, zhCN]) {
    for (const phase of buildE2eFlow(DEFAULT_E2E_FLOW_CONFIG, { mts: false, air: false }, messages).phases) {
      // The T4 card follows the sea/air toggle, while a column holds lines of both modes.
      if (phase.code !== "T4") assert.equal(messages.e2eLines.stageTitles[phase.code], `${phase.code} · ${phase.name}`);
    }
  }
  assert.equal(ptBR.e2eLines.stageTitles.T4, "T4 · Transporte");
  assert.equal(en.e2eLines.stageTitles.T4, "T4 · Transport");
  assert.equal(zhCN.e2eLines.stageTitles.T4, "T4 · 运输");
});
