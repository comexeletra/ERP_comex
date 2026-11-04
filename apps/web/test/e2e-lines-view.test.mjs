import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildE2eFlow, DEFAULT_E2E_FLOW_CONFIG } from "../lib/e2e-flow.ts";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";
import { e2eStatusColor } from "../lib/purchase-order-lines.ts";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [view, overview, panels, parts, tabs, page, modelPage, styles, flowLib] = await Promise.all([
  read("components/E2eLinesView.tsx"), read("components/E2eOverviewCharts.tsx"),
  read("components/E2eModelPanels.tsx"), read("components/E2eFlowParts.tsx"),
  read("components/E2eTabs.tsx"), read("app/end-to-end/page.tsx"), read("app/end-to-end/model/page.tsx"),
  read("app/styles/features/e2e.css"), read("lib/e2e-flow.ts")]);

test("the current status column takes the colours of the status chart", () => {
  assert.equal(e2eStatusColor("A DISTRIBUIR"), "--color-chart-status-1");
  assert.equal(e2eStatusColor("AGUARDANDO PRODUÇÃO"), "--color-chart-status-2");
  assert.equal(e2eStatusColor("AGUARDANDO EMBARQUE"), "--color-chart-status-3");
  assert.equal(e2eStatusColor("AGUARDANDO CHEGADA"), "--color-chart-status-4");
  assert.equal(e2eStatusColor("DESEMBARAÇO"), "--color-chart-status-5");
  assert.equal(e2eStatusColor("ENTREGUE"), "--color-chart-status-6");
  // Cancelled lines are outside the chart, and an unknown status has no colour to borrow.
  assert.equal(e2eStatusColor("CANCELADO"), undefined);
  assert.equal(e2eStatusColor("OUTRO"), undefined);
  // The chart and the table read the same list instead of keeping a copy each.
  assert.doesNotMatch(overview, /--color-chart-status-1/u);
  assert.match(overview, /\(_, index\) => e2eStatusColors\[index\]/u);
  assert.match(view, /<td>\{e2e \? <E2eStatus status=\{e2e\.currentStatus\} \/> : "—"\}<\/td>/u);
  assert.match(view, /<span className="e2e-chart-swatch" style=\{\{ background: `var\(\$\{color\}\)` \}\} \/>/u);
  assert.match(styles, /\.e2e-status \{/u);
});

test("the optional overview precedes the model and cross-filters by status and deadline", () => {
  assert.match(view, /overview\?: E2eOverview/u);
  // The summary panel is always there with its filter form; the charts wait for the summary.
  assert.match(view, /<E2eCollapsible title=\{t\.overview\.label\}/u);
  assert.match(view, /\{counts\?\.overview && <E2eOverviewCharts/u);
  // Below the model panels: the filter form, then the charts.
  assert.ok(view.indexOf("<E2eModelDetails") < view.indexOf('<form className="portfolio-filter product-lines-filter e2e-overview-filters"'));
  assert.ok(view.indexOf('<form className="portfolio-filter product-lines-filter e2e-overview-filters"') < view.indexOf("<E2eOverviewCharts"));
  assert.ok(view.indexOf("t.overview.loading") > view.indexOf("<E2eModelDetails"));
  // A click keeps only its status, Ctrl+click adds or removes it; a delivered status shows every situation.
  assert.match(view, /const filters = withProductLineStatus\(applied, nextChartSelection\(applied\.status, status, additive\)\);/u);
  assert.match(view, /onChange=\{values => setDraft\(withProductLineStatus\(draft, values as ProductLineStatus\[\]\)\)\}/u);
  assert.match(view, /onStatusSelect=\{filterByStatus\} onStatusClear=\{clearStatus\}/u);
  assert.match(overview, /const additive = \(event: MouseEvent<Element>\) => event\.ctrlKey \|\| event\.metaKey;/u);
  assert.match(overview, /onClick=\{event => onStatusSelect\(entry\.key, additive\(event\)\)\}/u);
  for (const messages of [ptBR, en, zhCN]) assert.ok(messages.e2eLines.overview.tipAdd);
  assert.match(view, /setDraft\(filters\); applyFilters\(filters\);/u);
  // The deadline pie and the delay range bars select the same way, and "clear selection" clears all of them.
  assert.match(view, /changeDeadline\(nextChartSelection\(deadline, selected, additive\)\);/u);
  assert.match(view, /setDeadline\(next\); syncUrl\(applied, \{ \.\.\.stage, deadline: next \}, 1\);/u);
  assert.match(view, /onStatusSelect=\{filterByStatus\}/u);
  assert.match(view, /selectedDeadlines=\{deadline\} onDeadlineSelect=\{selectDeadline\} onDeadlineClear=\{\(\) => changeDeadline\(\[\]\)\}/u);
  assert.match(overview, /onClick=\{event => onDeadlineSelect\(entry\.key, additive\(event\)\)\}/u);
  // Clear also removes the deadline and delay range chosen on the charts, the current stage and the demand type.
  assert.match(view, /setDraft\(emptyProductLineFilters\); setDeadline\(\[\]\); setDelayRange\(\[\]\);/u);
  assert.match(view, /stepper\.goTo\(null\); setDemandType\(""\);/u);
  assert.match(view, /applyFilters\(emptyProductLineFilters, \{ \.\.\.stage, stage: "", deadline: \[\], delayRange: \[\], demandType: "" \}\);/u);
  assert.match(view, /changeDelayRange\(nextChartSelection\(delayRange, selected, additive\)\);/u);
  assert.match(view, /setDelayRange\(next\); syncUrl\(applied, \{ \.\.\.stage, delayRange: next \}, 1\);/u);
  assert.match(view, /selectedDelayRanges=\{delayRange\} onDelayRangeSelect=\{selectDelayRange\} onDelayRangeClear=\{\(\) => changeDelayRange\(\[\]\)\}/u);
  assert.match(overview, /onClick=\{event => onSelect\(entry\.key, additive\(event\)\)\}\s+aria-label=\{`\$\{filterLabel\(entry\.label\)\}/u);
  // Every chart tip tells that Ctrl+click adds to the selection.
  assert.match(overview, /<div className="e2e-chart-tip-hint">\{m\.e2eLines\.overview\.tipAdd\}<\/div>/u);
});

test("the summary panel holds the filter form and the charts and can be collapsed", () => {
  assert.match(view, /<E2eCollapsible title=\{t\.overview\.label\} storageKey="erp-comex-e2e-charts-collapsed"/u);
  // The collapsed panel counts the form filters and the chart selections.
  assert.match(view, /activeCount=\{e2eOverviewFilterCount\(applied, stage\)\}/u);
  // There is no separate table filter panel any more: one form filters the table and the charts.
  assert.doesNotMatch(view, /erp-comex-e2e-filters-collapsed|panels\.filtersTitle/u);
  assert.equal((view.match(/<form /gu) ?? []).length, 1);
  const panel = view.indexOf("storageKey=\"erp-comex-e2e-charts-collapsed\"");
  assert.ok(panel < view.indexOf("<form ") && view.indexOf("<E2eOverviewCharts") < view.indexOf("</E2eCollapsible>", panel));
  for (const messages of [ptBR, en, zhCN]) {
    assert.equal(typeof messages.e2eLines.panels.active(2), "string");
    for (const key of ["show", "hide"]) assert.ok(messages.e2eLines.panels[key], key);
    assert.equal("filtersTitle" in messages.e2eLines.panels, false);
  }
});

test("a collapsed chart block still says it holds charts and shows their shape", () => {
  assert.match(view, /storageKey="erp-comex-e2e-charts-collapsed"[\s\S]*?icon="chart"/u);
  assert.match(view, /collapsedSummary=\{counts\?\.overview \? <E2eOverviewMini overview=\{counts\.overview\} locale=\{locale\} \/> : undefined\}/u);
  // The mini bar repeats the status colours but is only a picture: the full charts hold the filters.
  assert.match(overview, /export function E2eOverviewMini/u);
  assert.match(overview, /className="e2e-distribution e2e-distribution-mini" aria-hidden="true"/u);
  assert.match(overview, /o\.chartsHidden\(/u);
  for (const messages of [ptBR, en, zhCN]) assert.equal(typeof messages.e2eLines.overview.chartsHidden(3, "1"), "string");
});

test("the delay range bars are clickable rows in chronological order, grouped, with no image role", () => {
  assert.match(overview, /byDelayRange\?: Record<E2eDelayRange, OverviewPart>/u);
  // Chronological groups from the format library, never sorted by quantity.
  assert.match(overview, /delayRangeRows\(values, selected\)\.map\(group =>/u);
  assert.doesNotMatch(overview, /rankedIndexes|\.sort\(/u);
  assert.match(overview, /<button type="button" className=\{`e2e-range-row/u);
  assert.match(overview, /aria-pressed=\{selected\.includes\(entry\.key\)\}/u);
  assert.match(overview, /filterLabel=\{o\.filterByDelayRange\}/u);
  // The early ranges share the green of the deadline chart; the late ones follow the severity ramp.
  assert.match(overview, /inAdvance: "--color-chart-on-time-strong", onTime: "--color-chart-on-time", upTo30: "--color-chart-range-1"/u);
  assert.match(overview, /days120Plus: "--color-chart-range-6", noData: "--color-chart-no-data"/u);
  // An empty range draws no bar, so the minimum width only keeps tiny ranges visible.
  assert.match(overview, /\{entry\.share\.value > 0 && <span className="e2e-range-fill"/u);
  // The status chart spans the row; the deadline donut and the delay ranges share the next one.
  assert.match(overview, /"e2e-overview-card e2e-overview-card-wide"/u);
  assert.match(overview, /title=\{o\.statusTitle\} total=\{statusTotal\} selected=\{selectedStatuses\.length > 0\} wide/u);
  for (const messages of [ptBR, en, zhCN]) {
    assert.equal(Object.keys(messages.e2eLines.overview.delayRanges).length, 9);
    assert.deepEqual(Object.keys(messages.e2eLines.overview.delayGroups), ["noDelay", "late", "noInfo"]);
    assert.ok(messages.e2eLines.overview.delayRangeTitle);
  }
});

test("the status chart shows the flow steps in status order and highlights the largest one", () => {
  assert.match(overview, /<StatusSteps entries=\{statusEntries\} top=\{top\} selected=\{selectedStatuses\} onSelect=\{onStatusSelect\}/u);
  assert.match(overview, /const top = largestIndex\(statusEntries\.map\(entry => entry\.share\.value\)\);/u);
  assert.match(overview, /<ol className="e2e-status-steps">/u);
  assert.match(overview, /className=\{`e2e-status-step-tile\$\{index === top \? " is-top" : ""\}/u);
  assert.match(overview, /<span className="e2e-status-step-note">\{o\.noItems\}<\/span>/u);
  // The chip is keyed by the largest status, so it fades in again when another one takes the lead.
  assert.match(overview, /<InsightChip key=\{largest\.key\} color=\{largest\.color\} label=\{o\.largestShare\}/u);
  assert.match(overview, /value=\{<>\{largest\.label\} · <Counted value=\{largest\.share\.fraction\}/u);
  for (const messages of [ptBR, en, zhCN]) {
    const o = messages.e2eLines.overview;
    assert.match(o.step(2), /2/u);
    for (const text of [o.noItems, o.largestShare, o.over30, o.onTimeCenter]) assert.ok(text);
  }
  assert.equal(ptBR.e2eLines.overview.step(1), "Etapa 1");
});

test("the deadline donut shows the on-time share and the late callout reads the delay ranges", () => {
  assert.match(overview, /donutSegments\(deadlineEntries\.map\(entry => entry\.share\.value\), \{ radius: 70, gap: 3 \}\)/u);
  assert.match(overview, /<circle className="e2e-donut-track" cx="92" cy="92" r="70" \/>/u);
  assert.match(overview, /<span className="e2e-donut-center" aria-hidden="true"><strong><Counted value=\{onTime\.share\.fraction\}/u);
  // The callout and the chip above 30 days only appear when there is something late.
  assert.match(overview, /\{insight\.late > 0 && <LateCallout upTo30=\{insight\.upTo30\} late=\{insight\.late\} \/>\}/u);
  assert.match(overview, /<p className="e2e-overview-callout">/u);
  assert.match(overview, /insight=\{insight\.over30 > 0 && <InsightChip danger/u);
  assert.equal(ptBR.e2eLines.overview.lateUpTo30Lead("62%"), "62% dos atrasados");
  assert.equal(ptBR.e2eLines.overview.lateUpTo30Rest("2 mil", "3 mil"), "estão em até 30 dias · 2 mil de 3 mil");
  for (const messages of [en, zhCN]) {
    assert.match(messages.e2eLines.overview.lateUpTo30Lead("62%"), /62%/u);
    assert.match(messages.e2eLines.overview.lateUpTo30Rest("2", "3"), /2[\s\S]*3/u);
  }
});

test("the product and transport toggles have All and filter the data as well as the model", () => {
  // "All" (the default) keeps the default scenario of the model: not MTS and by sea.
  assert.match(view, /const mts = demandType === "mts";/u);
  assert.match(view, /const air = modal === "air";/u);
  assert.equal((view.match(/\{e\.allOption\}/gu) ?? []).length, 2);
  assert.match(view, /aria-pressed=\{demandType === ""\}/u);
  assert.match(view, /aria-pressed=\{modal === ""\}/u);
  assert.match(view, /setDemandType\(next\); syncUrl\(applied, \{ \.\.\.stage, demandType: next \}, 1\);/u);
  assert.match(view, /setModal\(next\); syncUrl\(applied, \{ \.\.\.stage, modal: next \}, 1\);/u);
  // Each summary loaded is kept, so the animation does not reload the charts at every stage.
  assert.match(view, /if \(summaryCached\) return undefined;/u);
  for (const messages of [ptBR, en, zhCN]) assert.ok(messages.e2e.allOption);
});

test("the filter form lists the available values with search and has the summary filters", () => {
  const form = view.slice(view.indexOf("<form "), view.indexOf("</form>"));
  // PO, importer, product, IP, status, group and purpose list the available values with checkboxes, a search
  // and "select all", as in Power BI.
  for (const label of ["p.poNumber", "m.processDirectory.importer", "m.followup.product", '"IP"', "m.calc.status", "f.group",
    "f.purpose"]) {
    assert.match(form, new RegExp(`<MultiSelectFilter ariaLabel=\\{?${label.replaceAll(".", "\\.")}\\}?`, "u"), label);
  }
  assert.doesNotMatch(form, /<input value=|<SearchableSelect /u);
  for (const list of ["purchaseOrders", "importers", "productCodes", "ipNumbers", "group", "purpose"]) {
    assert.match(form, new RegExp(`values=\\{draft\\.${list}\\}`, "u"), list);
  }
  // Apply sends every value checked as no filter; a text filter from an older link becomes one value of its list.
  assert.match(view, /const filters = effectiveFilters\(draft\);/u);
  assert.match(view, /productCodes: effectiveSelection\(filters\.productCodes, \(o\?\.products \?\? \[\]\)\.map\(product => product\.code\)\)/u);
  assert.match(view, /const filters = withE2eLists\(parseProductLineFilters\(query\)\);/u);
  assert.match(view, /apiFetch\("\/api\/v1\/purchase-order-lines\/filter-options", \{ signal: controller\.signal \}\)/u);
  assert.match(view, /label: product\.description \? `\$\{product\.code\} · \$\{product\.description\}` : product\.code/u);
  // Dropdowns of one value: current stage, MTS / not MTS and situation; ETA keeps two date fields.
  assert.equal((form.match(/<select /gu) ?? []).length, 3);
  for (const label of ["f.currentStage", "f.demandType", "p.situation"]) {
    assert.match(form, new RegExp(`\\{${label.replaceAll(".", "\\.")}\\}<select `, "u"), label);
  }
  assert.equal((form.match(/type="date"/gu) ?? []).length, 2);
  // The necessity is the period picker; its relative periods count from today in Brasília, also from a link.
  assert.match(form, /<label>\{f\.necessity\}<DateRangeFilter ariaLabel=\{f\.necessity\} today=\{today\} value=\{necessityValue\(draft\)\}/u);
  assert.match(view, /const today = e2eToday\(\);/u);
  assert.match(view, /necessityFields\(necessityValue\(filters\), e2eToday\(\)\)/u);
  assert.match(view, /setDraft\(\{ \.\.\.draft, \.\.\.fields \}\); applyFilters\(\{ \.\.\.applied, \.\.\.fields \}\);/u);
  // The relative period goes to the URL only; the API gets the dates.
  assert.match(view, /if \(filters\.necessityPeriod\) url\.set\("necessityPeriod", filters\.necessityPeriod\);/u);
  // The current stage and the demand type are the stage cards and the toolbar, so they apply at once.
  assert.match(form, /onChange=\{event => selectCurrentStage\(/u);
  assert.match(form, /onChange=\{event => changeDemandType\(/u);
  assert.match(view, /stepper\.goTo\(k\); setView\("current"\);/u);
  assert.match(form, /onClick=\{clearFilters\}/u);
  assert.match(styles, /\.e2e-overview-filters \{/u);
  for (const messages of [ptBR, en, zhCN]) {
    const f = messages.e2eLines.overview.filters;
    for (const key of ["label", "currentStage", "necessity", "demandType", "mts", "notMts", "group", "purpose"]) assert.ok(f[key], key);
  }
});

test("the period picker has every date, a fixed period on the calendar, a relative period and the shortcuts", async () => {
  const picker = await read("components/DateRangeFilter.tsx");
  const components = await read("app/styles/components.css");
  // Modes, the calendar, the unit tabs with the standard tabs and the shortcuts grouped by unit.
  assert.match(picker, /\{option\("all", t\.allTime\)\}/u);
  assert.match(picker, /\{option\("static", t\.staticPeriod\)\}/u);
  assert.match(picker, /\{option\("relative", t\.relativePeriod\)\}/u);
  assert.match(picker, /calendarWeeks\(view\.year, view\.month\)/u);
  assert.match(picker, /onClick=\{\(\) => setFixed\(pickCalendarDay\(fixed, day\.date\)\)\}/u);
  assert.match(picker, /className="tabs date-range-units" role="tablist"/u);
  assert.match(picker, /className=\{unit === range\.unit \? "tab active" : "tab"\}/u);
  assert.match(picker, /dateRangePresets\.filter\(preset => preset\.range\.unit === unit\)/u);
  // Nothing changes until Apply; a fixed period needs both dates in order; Escape and Cancel close it.
  assert.match(picker, /const valid = mode !== "static" \|\| \(isIsoDate\(fixed\.from\) && isIsoDate\(fixed\.to\) && fixed\.from <= fixed\.to\);/u);
  assert.match(picker, /<button type="button" className="button" disabled=\{!valid\} onClick=\{apply\}>\{t\.apply\}<\/button>/u);
  assert.match(picker, /<button type="button" className="button secondary" onClick=\{close\}>\{t\.cancel\}<\/button>/u);
  assert.match(picker, /if \(event\.key === "Escape"\)/u);
  // "Exclude open period" only for a relative period that includes the current one.
  assert.match(picker, /const canExclude = \(mode === "relative" \|\| mode === "preset"\) && includesOpenPeriod\(range\);/u);
  // The panel is a portal above the page, in the colours of the application.
  assert.match(picker, /createPortal\(<div className="date-range-panel" role="dialog"/u);
  assert.match(components, /\.date-range-panel \{[^}]*z-index: var\(--z-popover\)/u);
  assert.match(components, /\.date-range-day\.is-edge \{ background: var\(--color-primary\); color: var\(--color-on-primary\)/u);
  assert.match(components, /\.date-range-day\.is-in-range \{ background: var\(--color-primary-tint\)/u);
});

test("both overview charts are clickable through their legends and keep the keyboard out of the images", () => {
  assert.equal((overview.match(/role="img"/gu) ?? []).length, 2);
  assert.doesNotMatch(overview, /tabIndex|role="button"|formatNumber|e2e-pie-label|e2e-pie-guide/u);
  assert.match(overview, /<button type="button" className=\{`e2e-chart-legend-item/u);
  assert.match(overview, /aria-pressed=\{selected\.includes\(entry\.key\)\} onClick=\{event => onSelect\(entry\.key, additive\(event\)\)\}/u);
  assert.match(overview, /selected=\{selectedStatuses\} onSelect=\{onStatusSelect\}/u);
  assert.match(overview, /selected=\{selectedDeadlines\} onSelect=\{onDeadlineSelect\}/u);
  // Mouse shortcuts on the marks; the legend is the keyboard path.
  assert.match(overview, /className=\{`e2e-distribution-segment/u);
  assert.match(overview, /aria-hidden="true"/u);
  assert.match(overview, /m\.e2eLines\.overview\.clearSelection/u);
});

test("the overview numbers count to their new values and every category keeps its mark", async () => {
  const hook = await read("components/useTweenedNumber.ts");
  // Numbers count from the value on screen, with the easing of the stylesheet, and jump with reduced motion.
  assert.match(hook, /const from = current\.current;/u);
  assert.match(hook, /tweenAt\(from, target, now - start, length\)/u);
  assert.match(hook, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/u);
  assert.match(hook, /return \(\) => window\.cancelAnimationFrame\(frame\);/u);
  assert.match(overview, /function Counted\(\{ value, format \}/u);
  // Totals, quantities and shares of every chart are counted; the image labels keep the final text.
  assert.ok((overview.match(/<Counted /gu) ?? []).length >= 10);
  assert.match(overview, /format=\{value => m\.e2eLines\.overview\.totalItems\(formatTotal\(value, locale\)\)\}/u);
  assert.match(overview, /aria-label=\{o\.chartLabel\(o\.statusTitle, formatTotal\(statusTotal, locale\)\)\}/u);
  // An emptied status keeps its segment so it can shrink away; the donut arcs move through the stylesheet.
  assert.match(overview, /\{statusEntries\.map\(entry =>/u);
  assert.match(overview, /entry\.share\.value > 0 \? "" : " is-zero"/u);
  assert.match(overview, /strokeDasharray: segment\.dashArray, strokeDashoffset: segment\.dashOffset/u);
  // The steps enter one after the other.
  assert.match(overview, /"--step-index": index/u);
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
  assert.match(view, /const summaryQuery = e2eSummaryQuery\(applied, stage\)\.toString\(\);/u);
  assert.match(view, /const stage: E2eStageFilter = \{ stage: current === null \? "" : E2E_STAGE_CODES\[current\], view, late, deadline,\s+delayRange, demandType, modal \};/u);
  // The export downloads what the table shows.
  assert.match(view, /downloadExcel\(applied, stage, columns\)/u);
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
