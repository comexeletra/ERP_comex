import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { z } from "zod";
import { registerAuthorization } from "../dist/authorization.js";
import { agingRange, PRE_SHIPMENT_AGING_RANGES, PRE_SHIPMENT_AGING_STATUSES, PRE_SHIPMENT_DIRECT_PURPOSES,
  preShipmentQuery, registerPreShipmentDashboardRoutes, summarizePreShipment } from "../dist/pre-shipment-dashboard.js";
import { shipmentLineStatuses } from "../dist/shipment-lines.js";
import { createWorkGate } from "../dist/work-gate.js";

const actorId = "00000000-0000-4000-8000-000000000001";
const line = { lineId: "00000000-0000-4000-8000-000000000044", lineKind: "ALLOCATION", status: "AGUARDANDO CHEGADA",
  quantity: "60.00000000", unit: "UN", necessityDate: "2026-02-01", mode: "SEA", requester: "PCM - JOSIVAN",
  scNumber: "238", purchaseOrder: { id: "00000000-0000-4000-8000-000000000041", number: "23588" },
  process: { id: "00000000-0000-4000-8000-000000000043", ipNumber: "H-For002/2026" }, etd: "2026-02-06",
  eta: "2026-04-02", ete: "2026-04-12", productCode: "2140103240", description: "Antena", supplier: "Hexing",
  importer: "ELETRA MATRIZ", purpose: "Estoque Insumos (Componente)", poSentDate: "2025-10-24", priority: null,
  demand: "MRP", group: "Energy" };
const summaryRows = [
  { line_status: "A DISTRIBUIR", aging_days: 30, products: 2, quantity: "20.00000000" },
  { line_status: "AGUARDANDO PRODUÇÃO", aging_days: 50, products: 3, quantity: "30.50000000" },
  { line_status: "AGUARDANDO PRODUÇÃO", aging_days: null, products: 1, quantity: "5.00000000" },
  { line_status: "AGUARDANDO EMBARQUE", aging_days: 130, products: 4, quantity: "40.00000000" },
  { line_status: "AGUARDANDO CHEGADA", aging_days: 200, products: 5, quantity: "50.00000000" },
  { line_status: "ENTREGUE", aging_days: 300, products: 10, quantity: "1000.00000000" },
  { line_status: "CANCELADO", aging_days: null, products: 1, quantity: "7.00000000" },
];

async function dashboardApp(t, { gate } = {}) {
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("identity.erp_user AS u")) return { rows: [{ role: "Consulta", importer_code: "ELETRA MATRIZ" }] };
      if (sql.includes("option_demands")) return { rows: [{ option_demands: ["MRP", "AP"], option_requesters: ["PCM - B", "PCM - A"],
        option_groups: ["Water", "Energy"], option_suppliers: ["ZLINK", "Hexing"], option_purposes: ["Despesa"],
        option_importers: ["FOR", "ELETRA MATRIZ"], option_modes: ["SEA", "AIR"] }] };
      if (sql.includes("GROUP BY line_status, aging_days")) return { rows: summaryRows };
      if (sql.includes("total_count")) return { rows: [{ total_count: 1, lines: [line] }] };
      return { rows: [] };
    },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    request.authContext = { issuer: "ci", subject: "reader", userId: actorId, displayName: null, sessionToken: "ci" };
  });
  await registerPreShipmentDashboardRoutes(app, pool, gate);
  return { app, queries };
}

test("the aging ranges follow the BI: the upper bound belongs to the range, and no sent date is no range", () => {
  assert.deepEqual(PRE_SHIPMENT_AGING_RANGES.map(range => range.key),
    ["upTo45", "days45To60", "days60To90", "days90To120", "days120Plus"]);
  const cases = [[-3, "upTo45"], [0, "upTo45"], [45, "upTo45"], [46, "days45To60"], [60, "days45To60"],
    [61, "days60To90"], [90, "days60To90"], [91, "days90To120"], [120, "days90To120"], [121, "days120Plus"],
    [900, "days120Plus"], [null, null]];
  for (const [days, range] of cases) assert.equal(agingRange(days), range, String(days));
  assert.deepEqual([...PRE_SHIPMENT_AGING_STATUSES], ["A DISTRIBUIR", "AGUARDANDO PRODUÇÃO", "AGUARDANDO EMBARQUE"]);
  assert.deepEqual([...PRE_SHIPMENT_DIRECT_PURPOSES], ["Estoque Insumos (Componente)", "Estoque Insumos (Policarbonato)"]);
});

test("the summary counts products and exact quantities by status and aging range", () => {
  const summary = summarizePreShipment(summaryRows, {});
  assert.equal(summary.totalProducts, 26);
  assert.equal(summary.totalQuantity, "1152.5");
  assert.deepEqual(Object.keys(summary.byStatus), [...shipmentLineStatuses]);
  assert.deepEqual(summary.byStatus["AGUARDANDO PRODUÇÃO"], { products: 4, quantity: "35.5" });
  assert.deepEqual(summary.byStatus.CANCELADO, { products: 1, quantity: "7" });
  assert.deepEqual(summary.byStatus.DESEMBARAÇO, { products: 0, quantity: "0" });
  // Only the lines waiting for the factory or the shipment have an aging; delivered and in transit do not.
  assert.deepEqual(summary.aging, { upTo45: { products: 2, quantity: "20" }, days45To60: { products: 3, quantity: "30.5" },
    days60To90: { products: 0, quantity: "0" }, days90To120: { products: 0, quantity: "0" },
    days120Plus: { products: 4, quantity: "40" } });
  assert.deepEqual(summary.agingWithoutSentDate, { products: 1, quantity: "5" });
});

test("each chart ignores its own selection and follows the other one", () => {
  const byAging = summarizePreShipment(summaryRows, { aging: ["days120Plus"] });
  // The status cards keep every status, limited to the chosen aging range.
  assert.equal(byAging.byStatus["AGUARDANDO EMBARQUE"].products, 4);
  assert.equal(byAging.byStatus.ENTREGUE.products, 0);
  assert.equal(byAging.byStatus["A DISTRIBUIR"].products, 0);
  // The aging chart keeps every range.
  assert.equal(byAging.aging.upTo45.products, 2);
  assert.equal(byAging.totalProducts, 4);

  const byStatus = summarizePreShipment(summaryRows, { status: ["AGUARDANDO PRODUÇÃO"] });
  assert.equal(byStatus.byStatus.ENTREGUE.products, 10);
  assert.deepEqual(byStatus.aging.upTo45, { products: 0, quantity: "0" });
  assert.equal(byStatus.aging.days45To60.products, 3);
  assert.equal(byStatus.agingWithoutSentDate.products, 1);
  assert.equal(byStatus.totalProducts, 4);

  // A status outside the aging leaves the aging chart empty instead of showing other lines.
  const delivered = summarizePreShipment(summaryRows, { status: ["ENTREGUE"] });
  assert.equal(Object.values(delivered.aging).reduce((sum, part) => sum + part.products, 0), 0);
});

test("the summary route takes the filters, keeps the scope and calculates the aging from today in Brasília", async t => {
  const { app, queries } = await dashboardApp(t);
  const url = "/api/v1/reports/pre-shipment/summary?status=ENTREGUE&aging=upTo45&priority=normal&direct=direct"
    + "&demand=MRP&requester=PCM%20-%20JOSIVAN&group=Energy&supplier=Hexing&purpose=Despesa&importers=FOR&modes=SEA"
    + "&scNumber=238&ipNumber=H-For&purchaseOrder=235&productCode=2140&productDescription=antena"
    + "&necessityFrom=2026-02-01&necessityTo=2026-02-28";
  const response = await app.inject({ method: "GET", url });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers["cache-control"], "no-store");
  const { sql, params } = queries.find(query => query.sql.includes("GROUP BY line_status, aging_days"));
  assert.deepEqual(params[0], ["ELETRA MATRIZ"]);
  assert.match(params[1], /^\d{4}-\d{2}-\d{2}$/u);
  // The status and aging selections are applied by the summary (cross-filter), not by the query.
  assert.equal(params.includes("ENTREGUE"), false);
  assert.match(sql, /nullif\(btrim\(item\.priority\), ''\) IS NULL/u);
  assert.match(sql, /lower\(btrim\(coalesce\(item\.purpose, ''\)\)\) IN \(SELECT lower\(value\) FROM unnest\(\$\d+::text\[\]\)/u);
  for (const value of [["MRP"], ["PCM - JOSIVAN"], ["Energy"], ["Hexing"], ["Despesa"], ["FOR"], ["SEA"], [...PRE_SHIPMENT_DIRECT_PURPOSES],
    "238", "H-For", "235", "2140", "antena", "2026-02-01", "2026-02-28"]) {
    assert.ok(params.some(param => JSON.stringify(param) === JSON.stringify(value)), JSON.stringify(value));
  }
  const body = response.json();
  assert.equal(body.byStatus.ENTREGUE.products, 0);
  assert.equal(body.aging.upTo45.products, 0);
});

test("cancelled POs and the balance of items cancelled in TOTVS count as cancelled; deleted POs stay out", async t => {
  const { app, queries } = await dashboardApp(t);
  assert.equal((await app.inject("/api/v1/reports/pre-shipment/summary")).statusCode, 200);
  const { sql } = queries.find(query => query.sql.includes("GROUP BY line_status, aging_days"));
  assert.match(sql, /WHEN po\.lifecycle_status = 'CANCELLED' THEN 'CANCELADO'/u);
  assert.match(sql, /WHEN l\.line_kind = 'BALANCE' AND upper\(coalesce\(item\.source_status, ''\)\) IN \('CANCELLED', 'CANCELED'\) THEN 'CANCELADO'/u);
  assert.match(sql, /l\.line_kind = 'ALLOCATION' AND po\.lifecycle_status IN \('ACTIVE', 'CLOSED', 'CANCELLED'\)/u);
  assert.match(sql, /l\.line_kind = 'BALANCE' AND po\.lifecycle_status IN \('ACTIVE', 'CANCELLED'\)/u);
  assert.doesNotMatch(sql, /DELETED/u);
  // The aging counts the days since the PO was sent to the supplier.
  assert.match(sql, /\$2::date - item\.po_sent_date/u);
});

test("the lines route pages the table and applies the status and aging selections", async t => {
  const { app, queries } = await dashboardApp(t);
  const response = await app.inject("/api/v1/reports/pre-shipment/lines?status=AGUARDANDO%20PRODU%C3%87%C3%83O&aging=days45To60&aging=days120Plus&page=2&pageSize=25");
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.deepEqual([body.page, body.pageSize, body.totalCount], [2, 25, 1]);
  assert.deepEqual(body.lines, [line]);
  const { sql, params } = queries.find(query => query.sql.includes("total_count"));
  assert.ok(params.some(param => JSON.stringify(param) === JSON.stringify(["AGUARDANDO PRODUÇÃO"])));
  assert.match(sql, /aging_days > 45 AND aging_days <= 60/u);
  assert.match(sql, /aging_days > 120/u);
  // The status is a column of the query; each line of the table carries it.
  assert.match(sql, /jsonb_agg\(line \|\| jsonb_build_object\('status', line_status\) ORDER BY/u);
  assert.deepEqual(params.slice(-2), [25, 25]);
  assert.match(sql, /ORDER BY necessity_date NULLS LAST, normalized_number, po_id, line_number, line_kind, sort_ip_number NULLS LAST, line_id/u);
});

test("the routes refuse unknown or invalid parameters", async t => {
  const { app, queries } = await dashboardApp(t);
  for (const url of ["/api/v1/reports/pre-shipment/summary?other=1", "/api/v1/reports/pre-shipment/summary?aging=days200",
    "/api/v1/reports/pre-shipment/summary?priority=high", "/api/v1/reports/pre-shipment/summary?direct=yes",
    "/api/v1/reports/pre-shipment/lines?page=0", "/api/v1/reports/pre-shipment/lines?pageSize=500",
    "/api/v1/reports/pre-shipment/summary?necessityFrom=01/02/2026"]) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 400, url);
    assert.equal(response.json().code, "INVALID_QUERY");
  }
  assert.equal(queries.some(query => query.sql.includes("dashboard")), false);
});

test("the filter options list the sorted values of the user's importers", async t => {
  const { app, queries } = await dashboardApp(t);
  const response = await app.inject("/api/v1/reports/pre-shipment/filter-options");
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { demands: ["AP", "MRP"], requesters: ["PCM - A", "PCM - B"], groups: ["Energy", "Water"],
    suppliers: ["Hexing", "ZLINK"], purposes: ["Despesa"], importers: ["ELETRA MATRIZ", "FOR"], modes: ["AIR", "SEA"] });
  assert.deepEqual(queries.find(query => query.sql.includes("option_demands")).params, [["ELETRA MATRIZ"]]);
});

test("the summary and the table wait in the gate of the End to End calculations", async t => {
  const gate = createWorkGate(1);
  let release;
  const blocker = gate.run(() => new Promise(resolve => { release = resolve; }));
  const { app, queries } = await dashboardApp(t, { gate });
  const pending = [app.inject("/api/v1/reports/pre-shipment/summary"), app.inject("/api/v1/reports/pre-shipment/lines")];
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(queries.some(query => query.sql.includes("dashboard")), false);
  release(); await blocker;
  for (const response of await Promise.all(pending)) assert.equal(response.statusCode, 200, response.body);
});

test("the filters built by the web pass the API query schema", async () => {
  const { emptyPreShipmentFilters, preShipmentLinesQuery, preShipmentSummaryQuery } =
    await import("../../web/lib/pre-shipment-dashboard.ts");
  const filters = { ...emptyPreShipmentFilters, status: ["AGUARDANDO PRODUÇÃO", "CANCELADO"], aging: ["days120Plus"],
    priority: "priority", direct: "notDirect", demand: ["MRP"], requester: ["PCM - JOSIVAN"], group: ["Energy"],
    supplier: ["Hexing"], purpose: ["Despesa", "Software"], importers: ["FOR"], modes: ["SEA"], scNumber: " 238 ",
    ipNumber: "H-For", purchaseOrder: "235", productCode: "2140", productDescription: "antena",
    necessityFrom: "2026-02-01", necessityTo: "2026-02-28", necessityPeriod: "month:0:0" };
  const asQuery = params => Object.fromEntries([...new Set(params.keys())].map(key =>
    [key, params.getAll(key).length > 1 ? params.getAll(key) : params.get(key)]));
  const summary = asQuery(preShipmentSummaryQuery(filters));
  const parsed = preShipmentQuery.strict().safeParse(summary);
  assert.equal(parsed.success, true, JSON.stringify(summary));
  assert.deepEqual([parsed.data.status, parsed.data.aging, parsed.data.purpose, parsed.data.scNumber, parsed.data.necessityTo],
    [["AGUARDANDO PRODUÇÃO", "CANCELADO"], ["days120Plus"], ["Despesa", "Software"], "238", "2026-02-28"]);
  const page = asQuery(preShipmentLinesQuery(filters, 3, 50));
  assert.equal(preShipmentQuery.extend({ page: z.coerce.number(), pageSize: z.coerce.number() }).strict()
    .safeParse(page).success, true, JSON.stringify(page));
  assert.deepEqual(asQuery(preShipmentSummaryQuery(emptyPreShipmentFilters)), {});
});

test("the web lists of statuses and aging ranges match the API", async () => {
  const { preShipmentAgingRanges, preShipmentStatuses } = await import("../../web/lib/pre-shipment-dashboard.ts");
  assert.deepEqual([...preShipmentStatuses], [...shipmentLineStatuses]);
  assert.deepEqual([...preShipmentAgingRanges], PRE_SHIPMENT_AGING_RANGES.map(range => range.key));
});

const pivotLine = (status, quantity, poSentDate) => ({ ...line, status, quantity, poSentDate });
const pivotLines = [
  pivotLine("A DISTRIBUIR", "20.00000000", "2026-09-21"), // 45 days before 2026-11-05: up to 45
  pivotLine("AGUARDANDO PRODUÇÃO", "10.50000000", "2026-09-20"), // 46 days: 45 to 60
  pivotLine("AGUARDANDO PRODUÇÃO", "5.00000000", null), // no sent date
  pivotLine("AGUARDANDO EMBARQUE", "40.00000000", "2026-07-07"), // 121 days: over 120
  pivotLine("ENTREGUE", "1000.00000000", "2025-01-01"), // delivered: no aging
  pivotLine("CANCELADO", "7.00000000", null),
];

test("the export summary is a pivot of the exported lines, with the aging of the dashboard", async () => {
  const { summarizePreShipmentLines } = await import("../dist/pre-shipment-dashboard.js");
  const pivot = summarizePreShipmentLines(pivotLines, "2026-11-05");
  assert.equal(pivot.totalProducts, 6);
  assert.equal(pivot.totalQuantity, "1082.5");
  assert.deepEqual(pivot.byStatus["AGUARDANDO PRODUÇÃO"], { products: 2, quantity: "15.5" });
  assert.deepEqual(pivot.byStatus.DESEMBARAÇO, { products: 0, quantity: "0" });
  assert.deepEqual(Object.fromEntries(Object.entries(pivot.aging).map(([range, part]) => [range, part.products])),
    { upTo45: 1, days45To60: 1, days60To90: 0, days90To120: 0, days120Plus: 1 });
  assert.deepEqual(pivot.agingWithoutSentDate, { products: 1, quantity: "5" });
  // Aging by status: the waiting statuses by range, and those without a sent date.
  assert.deepEqual(Object.keys(pivot.agingByStatus), [...PRE_SHIPMENT_AGING_STATUSES]);
  assert.equal(pivot.agingByStatus["A DISTRIBUIR"].upTo45.products, 1);
  assert.equal(pivot.agingByStatus["AGUARDANDO PRODUÇÃO"].days45To60.products, 1);
  assert.equal(pivot.agingByStatus["AGUARDANDO PRODUÇÃO"].none.products, 1);
  assert.equal(pivot.agingByStatus["AGUARDANDO EMBARQUE"].days120Plus.products, 1);
});

test("the export has a Resumo sheet before the lines, with the filters and the pivot tables", async () => {
  const ExcelJS = (await import("exceljs")).default;
  const { preShipmentXlsx } = await import("../dist/purchase-order-exports.js");
  const { resolveExportColumns } = await import("../dist/export-columns.js");
  const columns = resolveExportColumns("pre-shipment", [{ key: "status", header: "Status" }], {});
  const buffer = await preShipmentXlsx(pivotLines, columns, { today: "2026-11-05",
    filters: { status: ["AGUARDANDO PRODUÇÃO", "ENTREGUE"], aging: ["days120Plus"], direct: "direct", demand: ["MRP"],
      productCode: "3090", necessityFrom: "2026-02-01", necessityTo: "2026-02-28" } });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ["Resumo", "Pré Embarque"]);
  const summary = workbook.getWorksheet("Resumo");
  const rows = [];
  summary.eachRow(row => rows.push(row.values.slice(1).map(cell => cell ?? null)));
  const find = label => rows.find(row => row[0] === label);
  assert.equal(rows[0][0], "Resumo do Pré Embarque");
  // The filters of the export, as the screen applied them.
  assert.deepEqual(find("Status"), ["Status", "AGUARDANDO PRODUÇÃO, ENTREGUE"]);
  assert.deepEqual(find("Aging"), ["Aging", "Acima de 120 dias"]);
  assert.deepEqual(find("Direct"), ["Direct", "Direct"]);
  assert.deepEqual(find("Demanda"), ["Demanda", "MRP"]);
  assert.deepEqual(find("Código do produto (contém)"), ["Código do produto (contém)", "3090"]);
  assert.deepEqual(find("Necessidade"), ["Necessidade", "2026-02-01 a 2026-02-28"]);
  // Products and quantity by status, with shares and the total.
  const production = find("AGUARDANDO PRODUÇÃO");
  assert.deepEqual(production.slice(0, 5).map(value => typeof value === "number" ? Number(value.toFixed(4)) : value),
    ["AGUARDANDO PRODUÇÃO", 2, 0.3333, 15.5, 0.0143]);
  const totals = rows.filter(row => row[0] === "Total");
  assert.deepEqual(totals[0].slice(0, 5), ["Total", 6, 1, 1082.5, 1]);
  // Aging by range, out of the total the products without a PO sent date.
  assert.deepEqual(find("Acima de 120 dias").slice(0, 2), ["Acima de 120 dias", 1]);
  assert.deepEqual(totals[1].slice(0, 2), ["Total", 3]);
  assert.deepEqual(find("Sem PO Sent Date").slice(0, 2), ["Sem PO Sent Date", 1]);
  // The matrix of the waiting statuses by range.
  const header = rows.find(row => row[0] === "Status / Faixa");
  assert.deepEqual(header, ["Status / Faixa", "Até 45 dias", "45 a 60 dias", "60 a 90 dias", "90 a 120 dias",
    "Acima de 120 dias", "Sem PO Sent Date", "Total"]);
  const matrixProduction = rows.filter(row => row[0] === "AGUARDANDO PRODUÇÃO").at(-1);
  assert.deepEqual(matrixProduction, ["AGUARDANDO PRODUÇÃO", 0, 1, 0, 0, 0, 1, 2]);
  // The lines sheet keeps the chosen columns.
  assert.equal(workbook.getWorksheet("Pré Embarque").actualRowCount, pivotLines.length + 1);
});

test("the worker writes the summary with the filters of the job and today in Brasília", async () => {
  const { readFile } = await import("node:fs/promises");
  const worker = await readFile(new URL("../src/worker.ts", import.meta.url), "utf8");
  assert.match(worker, /preShipmentXlsx\(result\.lines, chosen, \{ filters: filters\.data, today: todayInBrasilia\(\) \}\)/u);
});
