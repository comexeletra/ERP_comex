import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";
import { emptyPreShipmentFilters, formatProducts, parsePreShipmentFilters, preShipmentAgingColors, preShipmentAgingRanges,
  preShipmentFilterCount, preShipmentLinesQuery, preShipmentStatusColors, preShipmentStatuses, preShipmentSummaryQuery,
  preShipmentFilterBody, preShipmentUrlQuery } from "../lib/pre-shipment-dashboard.ts";
import { e2eStatusColors, productLineStatuses } from "../lib/purchase-order-lines.ts";
import { choosableColumns, columnsBody } from "../lib/export-columns.ts";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [dashboard, charts, reports, page, styles] = await Promise.all([read("components/PreShipmentDashboard.tsx"),
  read("components/PreShipmentCharts.tsx"), read("components/ReportsView.tsx"), read("app/reports/pre/page.tsx"),
  read("app/styles/features/analysis.css")]);

test("a link keeps the filters and the chart selections; invalid values are left out", () => {
  const filters = parsePreShipmentFilters(new URLSearchParams("status=ENTREGUE&status=OUTRO&status=A%20DISTRIBUIR"
    + "&status=AGUARDANDO%20PRODU%C3%87%C3%83O&aging=days120Plus&aging=days200&priority=normal&direct=yes&ip=without"
    + "&demand=%20MRP%20&demand=MRP&modes=SEA"
    + "&scNumber=238&necessityFrom=2026-02-01&necessityTo=01/03/2026&necessityPeriod=month:0:0"));
  // Statuses and ranges in the order of the charts, whatever the order of the link. A DISTRIBUIR of an older link
  // is now part of AGUARDANDO PRODUÇÃO, so it is dropped.
  assert.deepEqual(filters.status, ["AGUARDANDO PRODUÇÃO", "ENTREGUE"]);
  assert.deepEqual(filters.aging, ["days120Plus"]);
  assert.equal(filters.priority, "normal");
  assert.equal(filters.direct, "");
  assert.equal(filters.ip, "without");
  assert.equal(parsePreShipmentFilters(new URLSearchParams("ip=sem")).ip, "");
  assert.deepEqual(filters.demand, ["MRP"]);
  assert.deepEqual(filters.modes, ["SEA"]);
  assert.equal(filters.scNumber, "238");
  assert.equal(filters.necessityFrom, "2026-02-01");
  assert.equal(filters.necessityTo, "");
  assert.equal(filters.necessityPeriod, "month:0:0");
  assert.deepEqual(parsePreShipmentFilters(new URLSearchParams()), emptyPreShipmentFilters);
});

test("the API query repeats a list key per value and leaves out empty fields and the relative period", () => {
  const filters = { ...emptyPreShipmentFilters, status: ["ENTREGUE", "AGUARDANDO PRODUÇÃO"], ip: "without",
    purpose: ["Despesa", " ", "Despesa"], productDescription: "  antena ", necessityFrom: "2026-02-01", necessityTo: "2026-02-28",
    necessityPeriod: "month:0:0" };
  assert.equal(preShipmentSummaryQuery(filters).toString(), "status=AGUARDANDO+PRODU%C3%87%C3%83O&status=ENTREGUE&ip=without"
    + "&purpose=Despesa&productDescription=antena&necessityFrom=2026-02-01&necessityTo=2026-02-28");
  const lines = preShipmentLinesQuery(filters, 2, 50);
  assert.deepEqual([lines.get("page"), lines.get("pageSize"), lines.get("necessityPeriod")], ["2", "50", null]);
  // The screen URL keeps the relative period, and the first page is the default.
  const url = preShipmentUrlQuery(filters, 1);
  assert.equal(url.get("necessityPeriod"), "month:0:0");
  assert.equal(url.has("page"), false);
  assert.equal(preShipmentUrlQuery(filters, 3).get("page"), "3");
});

test("the collapsed filter panel counts each applied filter once, the period included", () => {
  assert.equal(preShipmentFilterCount(emptyPreShipmentFilters), 0);
  assert.equal(preShipmentFilterCount({ ...emptyPreShipmentFilters, demand: ["MRP", "AP"], direct: "direct",
    necessityFrom: "2026-02-01", necessityTo: "2026-02-28" }), 3);
  assert.equal(preShipmentFilterCount({ ...emptyPreShipmentFilters, ip: "with" }), 1);
});

test("the statuses take the colours of the End to End charts, and the cancelled ones grey", () => {
  assert.deepEqual([...preShipmentStatuses], [...productLineStatuses]);
  assert.deepEqual(preShipmentStatuses.slice(0, -1).map(status => preShipmentStatusColors[status]), [...e2eStatusColors]);
  assert.equal(preShipmentStatusColors.CANCELADO, "--color-chart-no-data");
  // The balance without IP is part of AGUARDANDO PRODUÇÃO; the IP filter of the form tells it apart.
  assert.equal("A DISTRIBUIR" in preShipmentStatusColors, false);
  assert.match(dashboard, /<label>\{p\.ipFilter\}<select value=\{draft\.ip\}/u);
  assert.match(dashboard, /<option value="with">\{p\.withIp\}<\/option>\s*<option value="without">\{p\.withoutIp\}<\/option>/u);
  assert.deepEqual(Object.keys(preShipmentAgingColors), [...preShipmentAgingRanges]);
});

test("product counts are whole numbers in the interface language", () => {
  assert.equal(formatProducts(7695, "pt-BR"), "7.695");
  assert.equal(formatProducts(7694.6, "en"), "7,695");
});

test("every status and aging range has a label in the three languages", () => {
  for (const m of [ptBR, en, zhCN]) {
    for (const range of preShipmentAgingRanges) assert.ok(m.reports.dashboard.agingRanges[range], range);
    for (const status of preShipmentStatuses) assert.ok(m.statuses[status], status);
  }
});

test("the charts cross-filter by status and aging range, and the table follows both", () => {
  assert.match(charts, /onClick=\{event => onSelect\(entry\.key, additive\(event\)\)\}/u);
  assert.match(dashboard, /status: nextChartSelection\(applied\.status, status, additive\)/u);
  assert.match(dashboard, /aging: nextChartSelection\(applied\.aging, range, additive\)/u);
  // The summary and the table read the same applied filters, and wait for the clicks to stop.
  assert.match(dashboard, /useDebouncedValue\(preShipmentSummaryQuery\(applied\)\.toString\(\), fetchDelayMs\)/u);
  assert.match(dashboard, /useDebouncedValue\(preShipmentLinesQuery\(applied, page, pageSize\)\.toString\(\), fetchDelayMs\)/u);
  assert.match(dashboard, /fetchRetryingTransient/u);
  // The charts reuse the End to End parts instead of copies of them.
  assert.match(charts, /from "\.\/E2eOverviewCharts"/u);
  assert.match(charts, /<Legend entries=\{entries\}/u);
});

test("the table shows the columns of the BI table, in its order", () => {
  const columns = [...dashboard.matchAll(/<th>\{c\.(\w+)\}<\/th>/gu)].map(match => match[1]);
  assert.deepEqual(columns, ["necessity", "mode", "status", "requester", "sc", "po", "ip", "etd", "eta", "ete", "productCode",
    "description", "quantity", "supplier", "importer", "purpose", "poSentDate"]);
});

test("the pre-shipment page shows the dashboard and keeps the load metrics in a collapsible section", () => {
  assert.match(page, /<ReportsView scope="pre" initialQuery=\{query\.toString\(\)\} \/>/u);
  assert.match(reports, /\{scope === "pre" && <PreShipmentDashboard initialQuery=\{initialQuery\} \/>\}/u);
  assert.match(reports, /<E2eCollapsible title=\{t\.loadSection\} storageKey="erp-comex-pre-load-collapsed"/u);
  for (const rule of [".e2e-overview.pre-dashboard", ".pre-dashboard-tiles", ".pre-dashboard-help",
    ".e2e-donut-center.pre-dashboard-center-neutral strong", ".pre-dashboard-table"]) {
    assert.ok(styles.includes(`${rule} {`), rule);
  }
});

test("the export offers the data columns of the table, in its order, with PO and product always written", () => {
  const columns = [...dashboard.matchAll(/<th>\{c\.(\w+)\}<\/th>/gu)].map(match => ptBR.reports.dashboard.columns[match[1]]);
  assert.deepEqual(choosableColumns("pre-shipment", {}).map(column => column.label(ptBR, {})), columns);
  const body = columnsBody("pre-shipment", ["eta"], en, {});
  assert.deepEqual(body, { context: "pre-shipment", columns: [{ key: "poNumber", header: "PO" }, { key: "eta", header: "ETA" },
    { key: "productCode", header: "Product code" }] });
});

test("the export sends the filters and the chart selections of the table as the API body", () => {
  assert.deepEqual(preShipmentFilterBody({ ...emptyPreShipmentFilters, status: ["ENTREGUE", "AGUARDANDO PRODUÇÃO"],
    aging: ["upTo45"], priority: "priority", ip: "without", demand: [" MRP ", "MRP"], scNumber: " 238 ", necessityPeriod: "month:0:0" }),
  { status: ["AGUARDANDO PRODUÇÃO", "ENTREGUE"], aging: ["upTo45"], priority: "priority", ip: "without", demand: ["MRP"],
    scNumber: "238" });
  assert.deepEqual(preShipmentFilterBody(emptyPreShipmentFilters), {});
  assert.match(dashboard, /runExport\("\/api\/v1\/exports\/pre-shipment", \{ \.\.\.preShipmentFilterBody\(applied\), \.\.\.columns \}\)/u);
  assert.match(dashboard, /<ExportColumnsDialog context="pre-shipment"/u);
  assert.match(dashboard, /useExcelExport\("pre-embarque"\)/u);
});
