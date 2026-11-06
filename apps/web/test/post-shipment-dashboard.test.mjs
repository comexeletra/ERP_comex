import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";
import { atLeastTone, atMostTone, changeTone, emptyPostShipmentFilters, formatAverageDays, formatChange, formatContainers,
  formatMonth, formatShareOf, parsePostShipmentFilters, postShipmentChannelColors, postShipmentChannels,
  postShipmentFilterCount, postShipmentLinesQuery, postShipmentPriorities, postShipmentStatusColors, postShipmentStatuses,
  postShipmentFilterBody, postShipmentSlaTxtTarget, postShipmentSummaryQuery, postShipmentUrlQuery } from "../lib/post-shipment-dashboard.ts";
import { preShipmentStatusColors } from "../lib/pre-shipment-dashboard.ts";
import { choosableColumns, columnsBody } from "../lib/export-columns.ts";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [dashboard, charts, reports, page, styles] = await Promise.all([read("components/PostShipmentDashboard.tsx"),
  read("components/PostShipmentCharts.tsx"), read("components/ReportsView.tsx"), read("app/reports/post/page.tsx"),
  read("app/styles/features/analysis.css")]);

test("a link keeps the filters and the chart selections; invalid values are left out", () => {
  const filters = parsePostShipmentFilters(new URLSearchParams("status=ENTREGUE&status=OUTRO&status=DESEMBARA%C3%87O"
    + "&channel=none&channel=blue&channel=green&priority=normal&priority=high&clearance=onWater&modes=%20SEA%20&modes=SEA"
    + "&ipNumber=015B&dateFrom=2026-01-01&dateTo=31/01/2026&datePeriod=month:0:0"));
  // Categories in the order of the charts, whatever the order of the link.
  assert.deepEqual(filters.status, ["DESEMBARAÇO", "ENTREGUE"]);
  assert.deepEqual(filters.channel, ["green", "none"]);
  assert.deepEqual(filters.priority, ["normal"]);
  assert.deepEqual(filters.clearance, ["onWater"]);
  assert.deepEqual(filters.modes, ["SEA"]);
  assert.equal(filters.ipNumber, "015B");
  assert.deepEqual([filters.dateFrom, filters.dateTo, filters.datePeriod], ["2026-01-01", "", "month:0:0"]);
  assert.deepEqual(parsePostShipmentFilters(new URLSearchParams()), emptyPostShipmentFilters);
});

test("the API query repeats a list key per value and leaves out empty fields and the relative period", () => {
  const filters = { ...emptyPostShipmentFilters, status: ["ENTREGUE", "AGUARDANDO PRODUÇÃO"], importers: ["FOR", " ", "FOR"],
    ipNumber: "  015B ", dateFrom: "2026-01-01", dateTo: "2026-01-31", datePeriod: "month:0:0" };
  assert.equal(postShipmentSummaryQuery(filters).toString(),
    "status=AGUARDANDO+PRODU%C3%87%C3%83O&status=ENTREGUE&importers=FOR&ipNumber=015B&dateFrom=2026-01-01&dateTo=2026-01-31");
  const lines = postShipmentLinesQuery(filters, 2, 50);
  assert.deepEqual([lines.get("page"), lines.get("pageSize"), lines.get("datePeriod")], ["2", "50", null]);
  const url = postShipmentUrlQuery(filters, 1);
  assert.equal(url.get("datePeriod"), "month:0:0");
  assert.equal(url.has("page"), false);
  assert.equal(postShipmentUrlQuery(filters, 3).get("page"), "3");
  assert.equal(postShipmentFilterCount(emptyPostShipmentFilters), 0);
  assert.equal(postShipmentFilterCount({ ...emptyPostShipmentFilters, modes: ["SEA", "AIR"], dateFrom: "2026-01-01",
    dateTo: "2026-01-31" }), 2);
});

test("the targets colour the numbers: green within, red outside, and a falling lead time is good", () => {
  assert.deepEqual([atLeastTone(0.7, 0.7), atLeastTone(0.1757, 0.7), atLeastTone(null, 0.7)], ["good", "bad", null]);
  assert.deepEqual([atMostTone(7, 7), atMostTone(-31, 7), atMostTone(8, 7), atMostTone(null, 7)], ["good", "good", "bad", null]);
  assert.deepEqual([changeTone(-0.1789), changeTone(0.5682), changeTone(0), changeTone(null)], ["good", "bad", null, null]);
  // SLA TXT: green up to 20 days (negatives included), red above, as the BI rule; the table cell uses it.
  assert.equal(postShipmentSlaTxtTarget, 20);
  assert.deepEqual([atMostTone(-9, 20), atMostTone(20, 20), atMostTone(21, 20)], ["good", "good", "bad"]);
  assert.match(dashboard, /<DaysBadge days=\{line\.slaTxt\}/u);
});

test("the numbers follow the BI formats in the interface language", () => {
  assert.equal(formatAverageDays(17.534, "pt-BR"), "17,53");
  assert.equal(formatAverageDays(null, "pt-BR"), "—");
  assert.match(formatShareOf(39 / 222, "pt-BR"), /^17,57\s?%$/u);
  assert.match(formatChange(-0.1789, "pt-BR"), /^-17,89\s?%$/u);
  assert.match(formatChange(0.5682, "en"), /^\+56\.82%$/u);
  assert.equal(formatContainers("229.5", "pt-BR"), "229,50");
  assert.equal(formatMonth("2026-01", "en"), "Jan/2026");
});

test("the statuses take the colours of the pre-shipment charts, and every category has a label in the three languages", () => {
  for (const status of postShipmentStatuses) assert.equal(postShipmentStatusColors[status], preShipmentStatusColors[status], status);
  assert.deepEqual(Object.keys(postShipmentChannelColors), [...postShipmentChannels]);
  for (const m of [ptBR, en, zhCN]) {
    for (const status of postShipmentStatuses) assert.ok(m.statuses[status], status);
    for (const channel of postShipmentChannels) assert.ok(m.reports.postDashboard.channels[channel], channel);
    for (const priority of postShipmentPriorities) assert.ok(m.reports.postDashboard.priorities[priority], priority);
  }
});

test("the charts cross-filter by status, channel and priority, and the on water card filters the clearance", () => {
  assert.match(charts, /onClick=\{event => onSelect\(entry\.key, additive\(event\)\)\}/u);
  assert.match(dashboard, /nextChartSelection\(applied\[chart\] as string\[\], value, additive\)/u);
  assert.match(dashboard, /clearance: onWaterSelected \? \[\] : \["onWater"\]/u);
  // The summary and the table read the same applied filters, and wait for the clicks to stop.
  assert.match(dashboard, /useDebouncedValue\(postShipmentSummaryQuery\(applied\)\.toString\(\), fetchDelayMs\)/u);
  assert.match(dashboard, /useDebouncedValue\(postShipmentLinesQuery\(applied, page, pageSize\)\.toString\(\), fetchDelayMs\)/u);
  assert.match(dashboard, /fetchRetryingTransient/u);
  // The charts keep the visual style of the other dashboards: their cards, legend, tiles and tooltips.
  assert.match(charts, /from "\.\/E2eOverviewCharts"/u);
  assert.match(charts, /import \{ DashboardCard \} from "\.\/PreShipmentCharts"/u);
  assert.match(charts, /<Legend entries=\{entries\}/u);
  assert.match(charts, /e2e-status-step-tile/u);
  // The status bars show the whole name: the three waiting statuses only differ at the end.
  assert.match(charts, /<ul className="e2e-range-bars is-wide-labels">/u);
});

test("the screen shows the filters, the number cards, the table and then the charts", () => {
  const positions = ["<E2eCollapsible title={p.filtersLabel}", "<PostShipmentIndicators", 'className="card pre-dashboard-table"',
    "<PostShipmentCharts"].map(mark => dashboard.indexOf(mark));
  assert.ok(positions.every(position => position > 0), JSON.stringify(positions));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(charts, /export function PostShipmentIndicators/u);
  assert.ok(styles.includes(".e2e-overview.post-dashboard-indicators {"));
  // The monthly charts say they keep the whole history, in the three languages.
  for (const m of [ptBR, en, zhCN]) {
    for (const key of ["monthHelp", "leadTimeHelp", "deliveredHelp"]) assert.ok(m.reports.postDashboard[key].length > 20, key);
  }
});

test("the table shows the columns of the BI table, in its order", () => {
  const columns = [...dashboard.matchAll(/<th>\{c\.(\w+)\}<\/th>/gu)].map(match => match[1]);
  assert.deepEqual(columns, ["necessity", "ip", "priority", "incoterm", "mode", "status", "duimpDate", "documentsOk", "arrival",
    "ltDoc", "etd", "eta", "ete", "delivery", "containers", "ltClearance", "clearanceType", "slaTxt"]);
  for (const m of [ptBR, en, zhCN]) for (const column of columns) assert.ok(m.reports.postDashboard.columns[column], column);
});

test("the post-shipment page shows the dashboard and keeps the load metrics in a collapsible section", () => {
  assert.match(page, /<ReportsView scope="post" initialQuery=\{query\.toString\(\)\} \/>/u);
  assert.match(reports, /\{scope === "post" && <PostShipmentDashboard initialQuery=\{initialQuery\} \/>\}/u);
  assert.match(reports, /<E2eCollapsible title=\{t\.loadSection\} storageKey="erp-comex-post-load-collapsed"/u);
  for (const rule of [".post-month-chart", ".post-month-plot", ".post-month-line",
    ".post-month-columns", ".post-month-column", ".post-month-figures", ".post-month-bar", ".post-month-label"]) {
    assert.ok(styles.includes(`${rule} {`), rule);
  }
});

test("the monthly charts draw only the target line, with its label beside the columns", () => {
  // The average is the total at the top of each card: the charts do not repeat it as a line.
  assert.doesNotMatch(charts, /average=\{/u);
  assert.match(charts, /<MonthlyColumns title=\{p\.dsaMonthTitle\} values=\{dsaMonths\}\s+target=\{summary\.targets\.dsa\}/u);
  // The label takes a column of its own on the right, so the value of the last month is never under it.
  assert.match(styles, /\.post-month-plot \{[^}]*padding-right: var\(--line-label-space\)/u);
  assert.match(styles, /\.post-month-line \{[^}]*right: var\(--line-label-space\)/u);
  assert.match(styles, /\.post-month-line > span \{[^}]*left: calc\(100% \+ /u);
  for (const m of [ptBR, en, zhCN]) {
    assert.equal(typeof m.reports.postDashboard.target, "string");
    assert.equal("average" in m.reports.postDashboard, false);
  }
});

test("the export offers the columns of the table, in its order, with the IP always written", () => {
  const columns = [...dashboard.matchAll(/<th>\{c\.(\w+)\}<\/th>/gu)].map(match => ptBR.reports.postDashboard.columns[match[1]]);
  assert.deepEqual(choosableColumns("post-shipment", {}).map(column => column.label(ptBR, {})), columns);
  assert.deepEqual(columnsBody("post-shipment", ["ltDoc"], en, {}), { context: "post-shipment",
    columns: [{ key: "ipNumber", header: "IP" }, { key: "ltDoc", header: "LT Doc" }] });
});

test("the export sends the filters and the chart selections of the table as the API body", () => {
  assert.deepEqual(postShipmentFilterBody({ ...emptyPostShipmentFilters, status: ["ENTREGUE", "DESEMBARAÇO"],
    clearance: ["onWater"], modes: [" SEA ", "SEA"], ipNumber: " 015 ", datePeriod: "month:0:0" }),
  { status: ["DESEMBARAÇO", "ENTREGUE"], clearance: ["onWater"], modes: ["SEA"], ipNumber: "015" });
  assert.deepEqual(postShipmentFilterBody(emptyPostShipmentFilters), {});
  assert.match(dashboard, /runExport\("\/api\/v1\/exports\/post-shipment", \{ \.\.\.postShipmentFilterBody\(applied\), \.\.\.columns \}\)/u);
  assert.match(dashboard, /<ExportColumnsDialog context="post-shipment"/u);
  assert.match(dashboard, /useExcelExport\("pos-embarque"\)/u);
  for (const m of [ptBR, en, zhCN]) assert.ok(m.reports.postDashboard.export);
});
