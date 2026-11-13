import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { z } from "zod";
import { registerShipmentLineRoutes, shipmentLineQuery, shipmentLineStatuses, shipmentStatusSql } from "../dist/shipment-lines.js";

const actorId = "00000000-0000-4000-8000-000000000001";
const poId = "00000000-0000-4000-8000-000000000041";
const itemId = "00000000-0000-4000-8000-000000000042";
const processId = "00000000-0000-4000-8000-000000000043";
const allocationId = "00000000-0000-4000-8000-000000000044";
const item = { id: itemId, lineNumber: 1, productCode: "P-1", description: "Produto 1", orderedQuantity: "100.00000000",
  unit: "UN", unitPrice: "2.00000000", currencyCode: "USD", necessityDate: "2026-11-28", sourceStatus: null };
const purchaseOrder = { id: poId, number: "PO-1", importer: "ELETRA MATRIZ", supplierText: "SUP-1" };

const defaultRows = [
  { line_id: allocationId, line_kind: "ALLOCATION", line_quantity: "60.00000000",
    factory_ship_date: "2026-08-20", line_status: "AGUARDANDO CHEGADA", purchase_order: purchaseOrder, item,
    process: { id: processId, ip_number: "IP-1", importer: "ELETRA MATRIZ", transport_mode: "SEA",
      etd: "2026-09-01", bl_number: "BL-1", bl_date: "2026-09-03", arrival_date: null, logistics_status: null,
      freight_cost: 1500, taxes_paid_brl: 900, demurrage_brl: 10 } },
  { line_id: itemId, line_kind: "BALANCE", line_quantity: "40.00000000",
    factory_ship_date: null, line_status: "AGUARDANDO PRODUÇÃO", purchase_order: purchaseOrder, item, process: null },
];
const defaultDocuments = [{ id: "00000000-0000-4000-8000-000000000045", process_id: processId, kind: "INVOICE",
  status: "ACTIVE", number: "INV-1", purchase_order_item_id: null }];

async function linesApp(t, rows = defaultRows, documents = defaultDocuments) {
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("identity.erp_user AS u")) return { rows: [{ role: "Consulta", importer_code: "ELETRA MATRIZ" }] };
      if (sql.includes("filter_groups")) return { rows: [{ filter_groups: ["Water", "Energy"], filter_purposes: ["Revenda", "Despesa"],
        filter_importers: ["FOR", "ELETRA MATRIZ"], filter_purchase_orders: ["PO-10", "PO-9"], filter_ip_numbers: ["IP-2", "IP-1"],
        filter_products: [{ code: "P-10", description: null }, { code: "P-2", description: "Produto 2" }] }] };
      if (sql.includes("line_kind")) return { rows: [{ total_count: rows.length, items: rows }] };
      if (sql.includes("FROM imports.process_document")) return { rows: documents };
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
  await registerShipmentLineRoutes(app, pool);
  return { app, queries };
}

test("product lines repeat the IP dates on each allocation and show the remaining balance", async t => {
  const { app, queries } = await linesApp(t);
  const response = await app.inject({ method: "GET", url: "/api/v1/purchase-order-lines?situation=all" });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(body.totalCount, 2);
  const [allocation, balance] = body.lines;
  assert.equal(allocation.lineKind, "ALLOCATION");
  assert.equal(allocation.quantity, "60.00000000");
  assert.equal(allocation.factoryShipDate, "2026-08-20");
  assert.equal(allocation.process.ipNumber, "IP-1");
  assert.equal(allocation.process.blDate, "2026-09-03");
  assert.equal(allocation.process.blNumber, "BL-1");
  for (const cost of ["freightCost", "taxesPaidBrl", "demurrageBrl"]) assert.equal(cost in allocation.process, false);
  assert.equal(allocation.calculated.status, "AGUARDANDO CHEGADA");
  assert.equal(allocation.calculated.eta, "2026-10-26");
  assert.deepEqual(allocation.calculated.invoiceNumbers, ["INV-1"]);
  assert.equal(balance.lineKind, "BALANCE");
  assert.equal(balance.quantity, "40.00000000");
  assert.equal(balance.process, null);
  assert.deepEqual(Object.keys(balance.calculated), ["status", "e2e"]);
  // The balance without IP waits for production, as in the Follow Up and the BI (user decision of 2026-11-13).
  assert.equal(balance.calculated.status, "AGUARDANDO PRODUÇÃO");
  // The balance without IP still runs the E2E stages that do not depend on an IP.
  assert.equal(balance.calculated.e2e.stages.T0.deadline, "2026-08-01");
  assert.equal(balance.calculated.e2e.currentStatus, "AGUARDANDO PRODUÇÃO");
  assert.equal(balance.calculated.e2e.stages.T4.deadline, null);
  assert.equal(allocation.calculated.e2e.stages.T4.targetDays, 55);
  const documents = queries.find(query => query.sql.includes("WHERE process_id = ANY($1::uuid[])"));
  assert.deepEqual(documents.params[0], [processId]);
});

test("filters are validated and passed to the query; open lines are the default", async t => {
  const { app, queries } = await linesApp(t);
  const invalid = await app.inject({ method: "GET", url: "/api/v1/purchase-order-lines?status=QUALQUER" });
  assert.equal(invalid.statusCode, 400, invalid.body);
  const filtered = await app.inject({ method: "GET",
    url: "/api/v1/purchase-order-lines?status=AGUARDANDO%20CHEGADA&ipNumber=IP-1&etaFrom=2026-10-01&etaTo=2026-10-31&page=2&pageSize=25" });
  assert.equal(filtered.statusCode, 200, filtered.body);
  const lines = queries.filter(query => query.sql.includes("line_kind")).at(-1);
  assert.deepEqual(lines.params[5], ["AGUARDANDO CHEGADA"]);
  assert.ok(lines.params.includes("IP-1"));
  assert.ok(lines.params.includes("2026-10-01") && lines.params.includes("2026-10-31"));
  assert.ok(lines.params.includes("open"));
  assert.ok(lines.params.includes(25) && lines.params.includes(25));
  assert.deepEqual(shipmentLineStatuses, ["AGUARDANDO PRODUÇÃO", "AGUARDANDO EMBARQUE",
    "AGUARDANDO CHEGADA", "DESEMBARAÇO", "ENTREGUE", "CANCELADO"]);
});

test("the IP filter keeps the lines with an IP or only the balance without IP", async t => {
  const { app, queries } = await linesApp(t);
  const lineQuery = () => queries.filter(query => query.sql.includes("line_kind")).at(-1);
  for (const [query, value] of [["ip=without", "without"], ["ip=with", "with"], ["", null]]) {
    for (const route of ["/api/v1/purchase-order-lines", "/api/v1/purchase-order-lines/e2e-stages"]) {
      const response = await app.inject({ method: "GET", url: `${route}?${query}` });
      assert.equal(response.statusCode, 200, response.body);
      // The IP filter is the last parameter before the page.
      assert.equal(lineQuery().params.at(-3), value, `${route}?${query}`);
    }
  }
  assert.match(lineQuery().sql, /\$18::text IS NULL OR \(\$18::text = 'without'\) = \(l\.line_kind = 'BALANCE'\)/u);
  assert.match(lineQuery().sql, /LIMIT \$19 OFFSET \$20/u);
  // The balance status was merged into AGUARDANDO PRODUÇÃO: the old status and unknown IP values are refused.
  for (const query of ["ip=sem", "ip=", "status=A%20DISTRIBUIR"]) {
    const invalid = await app.inject({ method: "GET", url: `/api/v1/purchase-order-lines?${query}` });
    assert.equal(invalid.statusCode, 400, query);
  }
  assert.deepEqual(shipmentLineQuery.parse({ ip: "without" }), { ip: "without", situation: "open" });
});

test("a delivered or cancelled status reaches its lines even with the open lines default", async t => {
  const { app, queries } = await linesApp(t);
  const situationOf = () => queries.filter(query => query.sql.includes("line_kind")).at(-1).params[8];
  for (const status of ["ENTREGUE", "CANCELADO"]) {
    const lines = await app.inject({ method: "GET", url: `/api/v1/purchase-order-lines?status=${status}` });
    assert.equal(lines.statusCode, 200, lines.body);
    assert.equal(situationOf(), "all", status);
    // The summary drops the status in the database for its status chart, but not the situation it implies.
    const summary = await app.inject({ method: "GET", url: `/api/v1/purchase-order-lines/e2e-stages?status=${status}` });
    assert.equal(summary.statusCode, 200, summary.body);
    assert.equal(situationOf(), "all", status);
  }
  // An open status keeps the default, and without a status the open lines stay the default.
  await app.inject({ method: "GET", url: "/api/v1/purchase-order-lines?status=DESEMBARA%C3%87O" });
  assert.equal(situationOf(), "open");
  await app.inject({ method: "GET", url: "/api/v1/purchase-order-lines/e2e-stages" });
  assert.equal(situationOf(), "open");
});

test("list filters take one or more exact values in the query, the summary and the export", async t => {
  const { app, queries } = await linesApp(t);
  const lineQuery = () => queries.filter(query => query.sql.includes("line_kind")).at(-1);
  const response = await app.inject({ method: "GET", url: "/api/v1/purchase-order-lines?status=DESEMBARA%C3%87O"
    + "&status=ENTREGUE&group=Energy&group=%20Water%20&purpose=Despesa&importers=FOR&importers=ELETRA%20MATRIZ"
    + "&purchaseOrders=PO-1&ipNumbers=IP-1&ipNumbers=IP-1&productCodes=P-1&group=&page=2&pageSize=25" });
  assert.equal(response.statusCode, 200, response.body);
  const lines = lineQuery();
  // Values are trimmed, repeated ones count once and empty ones are dropped.
  assert.deepEqual(lines.params[5], ["DESEMBARAÇO", "ENTREGUE"]);
  assert.deepEqual(lines.params.slice(9, 11), [["Energy", "Water"], ["Despesa"]]);
  assert.deepEqual(lines.params.slice(13, 17), [["FOR", "ELETRA MATRIZ"], ["PO-1"], ["IP-1"], ["P-1"]]);
  assert.deepEqual(lines.params.slice(-2), [25, 25]);
  // A closed status among the chosen ones shows every situation.
  assert.equal(lines.params[8], "all");
  assert.match(lines.sql, /\$6::text\[\] IS NULL OR line_status = ANY\(\$6::text\[\]\)/u);
  for (const [column, index] of [["po\\.importer", 14], ["po\\.external_number", 15], ["p\\.ip_number", 16],
    ["item\\.product_code", 17]]) {
    assert.match(lines.sql, new RegExp(`lower\\(btrim\\(coalesce\\(${column}, ''\\)\\)\\) IN \\(SELECT lower\\(value\\) FROM unnest\\(\\$${index}::text\\[\\]\\) AS value\\)`, "u"));
  }
  // Without them the lists stay off; the text filters of the product lines screen keep matching a part.
  await app.inject({ method: "GET", url: "/api/v1/purchase-order-lines?purchaseOrder=PO-1&group=" });
  assert.deepEqual(lineQuery().params.slice(13, 17), [null, null, null, null]);
  assert.deepEqual([lineQuery().params[5], lineQuery().params[9]], [null, null]);
  assert.equal(lineQuery().params[2], "PO-1");
  // The summary takes the lists too and leaves the status to the calculation.
  const summary = await app.inject({ method: "GET",
    url: "/api/v1/purchase-order-lines/e2e-stages?status=ENTREGUE&status=DESEMBARA%C3%87O&importers=FOR" });
  assert.equal(summary.statusCode, 200, summary.body);
  assert.deepEqual([lineQuery().params[5], lineQuery().params[8], lineQuery().params[13]], [null, "all", ["FOR"]]);
  // The export body is JSON: a list is an array, and a single string still works.
  assert.deepEqual(shipmentLineQuery.parse({ status: ["ENTREGUE"], group: "Energy", productCodes: ["P-1", " P-2 "] }),
    { status: ["ENTREGUE"], group: ["Energy"], productCodes: ["P-1", "P-2"], situation: "open" });
  // Unknown statuses, values too long and more than 500 values are refused.
  const values = count => Array.from({ length: count }, (_, index) => `importers=I-${index}`).join("&");
  for (const query of ["status=ENTREGUE&status=QUALQUER", `productCodes=${"P".repeat(201)}`, values(501)]) {
    const invalid = await app.inject({ method: "GET", url: `/api/v1/purchase-order-lines?${query}` });
    assert.equal(invalid.statusCode, 400, query.slice(0, 40));
  }
  assert.equal((await app.inject({ method: "GET", url: `/api/v1/purchase-order-lines?${values(500)}` })).statusCode, 200);
});

test("product lines filter by group, purpose and necessity period in the query", async t => {
  const { app, queries } = await linesApp(t);
  const filtered = await app.inject({ method: "GET",
    url: "/api/v1/purchase-order-lines?group=Energy&purpose=Estoque%20Revenda&necessityFrom=2026-11-01&necessityTo=2026-11-30&page=2&pageSize=25" });
  assert.equal(filtered.statusCode, 200, filtered.body);
  const lines = queries.filter(query => query.sql.includes("line_kind")).at(-1);
  assert.deepEqual(lines.params.slice(9, 13), [["Energy"], ["Estoque Revenda"], "2026-11-01", "2026-11-30"]);
  // The page stays at the end of the parameters.
  assert.deepEqual(lines.params.slice(-2), [25, 25]);
  assert.match(lines.sql, /lower\(btrim\(coalesce\(to_jsonb\(item\)->>'item_group', ''\)\)\) IN \(SELECT lower\(value\) FROM unnest\(\$10::text\[\]\) AS value\)/u);
  assert.match(lines.sql, /lower\(btrim\(coalesce\(item\.purpose, ''\)\)\) IN \(SELECT lower\(value\) FROM unnest\(\$11::text\[\]\) AS value\)/u);
  assert.match(lines.sql, /item\.necessity_date >= \$12::date/u);
  assert.match(lines.sql, /item\.necessity_date <= \$13::date/u);
  // Without them the filters stay off.
  await app.inject({ method: "GET", url: "/api/v1/purchase-order-lines" });
  assert.deepEqual(queries.filter(query => query.sql.includes("line_kind")).at(-1).params.slice(9, 13), [null, null, null, null]);
  for (const query of ["necessityFrom=2026-13-01", "necessityTo=30/11/2026", `group=${"G".repeat(121)}`, `purpose=${"P".repeat(161)}`]) {
    const invalid = await app.inject({ method: "GET", url: `/api/v1/purchase-order-lines?${query}` });
    assert.equal(invalid.statusCode, 400, query);
  }
});

test("the E2E summary takes the group, purpose and necessity filters", async t => {
  const { app, queries } = await linesApp(t);
  const response = await app.inject({ method: "GET",
    url: "/api/v1/purchase-order-lines/e2e-stages?group=Water&purpose=Despesa&necessityFrom=2026-01-01&necessityTo=2026-12-31" });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(queries.filter(query => query.sql.includes("line_kind")).at(-1).params.slice(9, 13),
    [["Water"], ["Despesa"], "2026-01-01", "2026-12-31"]);
  // The options of the filter form have their own route, so the summary does not repeat them at every filter.
  assert.equal("filterOptions" in response.json(), false);
  assert.equal(queries.some(query => query.sql.includes("filter_groups")), false);
});

test("the filter options list the values of every product line of the user's importers", async t => {
  const { app, queries } = await linesApp(t);
  const response = await app.inject({ method: "GET", url: "/api/v1/purchase-order-lines/filter-options" });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers["cache-control"], "no-store");
  // Sorted, numbers in numeric order, products by code.
  assert.deepEqual(response.json(), { groups: ["Energy", "Water"], purposes: ["Despesa", "Revenda"],
    importers: ["ELETRA MATRIZ", "FOR"], purchaseOrders: ["PO-9", "PO-10"], ipNumbers: ["IP-1", "IP-2"],
    products: [{ code: "P-2", description: "Produto 2" }, { code: "P-10", description: null }] });
  const options = queries.find(query => query.sql.includes("filter_groups"));
  assert.deepEqual(options.params, [["ELETRA MATRIZ"]]);
  assert.match(options.sql, /po\.importer = ANY\(\$1::text\[\]\)/u);
  assert.match(options.sql, /po\.lifecycle_status IN \('ACTIVE', 'CLOSED'\)/u);
  assert.doesNotMatch(options.sql, /\$2/u);
});

test("the End to End summary filters built by the web pass the API query schema", async () => {
  const { e2eSummaryQuery, emptyE2eStageFilter, emptyProductLineFilters, productLineQuery } =
    await import("../../web/lib/purchase-order-lines.ts");
  const { formatRelativeSpec, resolveDateRange } = await import("../../web/lib/date-range.ts");
  // "This month" from the period picker: the dates go to the API, the relative period stays on the screen.
  const thisMonth = { unit: "month", from: 0, to: 0 };
  const { from, to } = resolveDateRange({ kind: "relative", range: thisMonth, excludeOpen: false }, "2026-11-04");
  const filters = { ...emptyProductLineFilters, status: ["AGUARDANDO CHEGADA", "ENTREGUE"], group: [" Energy ", "Water"],
    purpose: ["Despesa"], importers: ["FOR"], purchaseOrders: ["PO-9", "PO-10"], ipNumbers: ["IP-1"], productCodes: ["P-2"],
    ip: "without", necessityFrom: from, necessityTo: to, necessityPeriod: formatRelativeSpec(thisMonth, false) };
  const stage = { ...emptyE2eStageFilter, stage: "T4", demandType: "mts" };
  // The query string repeats a key for each value, as Fastify reads it: one value is a string, more an array.
  const asQuery = params => Object.fromEntries([...new Set(params.keys())].map(key =>
    [key, params.getAll(key).length > 1 ? params.getAll(key) : params.get(key)]));
  const summary = asQuery(e2eSummaryQuery(filters, stage));
  const parsed = shipmentLineQuery.strict().safeParse(summary);
  assert.equal(parsed.success, true, JSON.stringify(summary));
  assert.deepEqual([parsed.data.status, parsed.data.group, parsed.data.purpose, parsed.data.importers,
    parsed.data.purchaseOrders, parsed.data.ipNumbers, parsed.data.productCodes, parsed.data.necessityFrom, parsed.data.necessityTo],
  [["AGUARDANDO CHEGADA", "ENTREGUE"], ["Energy", "Water"], ["Despesa"], ["FOR"], ["PO-9", "PO-10"], ["IP-1"], ["P-2"],
    "2026-11-01", "2026-11-30"]);
  assert.equal(parsed.data.ip, "without");
  const page = asQuery(productLineQuery(filters, 2, 50, stage));
  assert.equal(shipmentLineQuery.extend({ page: z.coerce.number(), pageSize: z.coerce.number() }).strict()
    .safeParse(page).success, true, JSON.stringify(page));
});

test("the SQL status follows the same order of rules as the API calculation", () => {
  const sql = shipmentStatusSql("p", "l.item_id");
  const order = ["'CANCELADO'", "'ENTREGUE'", "'AGUARDANDO PRODUÇÃO'", "'AGUARDANDO EMBARQUE'",
    "'AGUARDANDO CHEGADA'", "'DESEMBARAÇO'"].map(status => sql.indexOf(status));
  assert.ok(order.every(index => index > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(sql, /p\.delivery_date IS NOT NULL/u);
  assert.match(sql, /p\.bl_date IS NULL/u);
  assert.match(sql, /document\.purchase_order_item_id = l\.item_id/u);
  assert.doesNotMatch(shipmentStatusSql("process", null), /purchase_order_item_id/u);
  assert.throws(() => shipmentStatusSql("p; DROP TABLE x", null));
  assert.throws(() => shipmentStatusSql("p", "1=1 OR x"));
});

test("the web status lists match the statuses the API calculates", async () => {
  const { processStatuses } = await import("../dist/shipment-lines.js");
  const { productLineStatuses } = await import("../../web/lib/purchase-order-lines.ts");
  const { processCalculatedStatuses } = await import("../../web/lib/ip-lifecycle.ts");
  assert.deepEqual([...productLineStatuses], [...shipmentLineStatuses]);
  assert.deepEqual([...processCalculatedStatuses], [...processStatuses]);
  const { e2eStageCodes } = await import("../../web/lib/purchase-order-lines.ts");
  const { E2E_STAGE_CODES } = await import("../dist/followup-calculations.js");
  assert.deepEqual([...e2eStageCodes], [...E2E_STAGE_CODES]);
  const { e2eDelayRanges } = await import("../../web/lib/purchase-order-lines.ts");
  const { E2E_DELAY_RANGES } = await import("../dist/followup-calculations.js");
  assert.deepEqual([...e2eDelayRanges], [...E2E_DELAY_RANGES]);
});

// E2E stage filters. Dates far in the past or future keep "late" independent of the day the test runs.
const pastItem = { ...item, id: "00000000-0000-4000-8000-000000000052", necessityDate: "2020-11-28",
  commercialPlanReceivedDate: "2020-08-03", scApprovalDate: "2020-08-21", poSentDate: "2020-08-24", demandType: "MTS" };
const futureItem = { ...item, id: "00000000-0000-4000-8000-000000000053", necessityDate: "2099-12-01" };
const shipped = { importer: "ELETRA MATRIZ", transport_mode: "SEA", etd: "2020-09-28", bl_date: "2020-09-29",
  actual_port_departure_date: "2020-09-30", arrival_date: null, logistics_status: null };
const stageProcess = (id, ipNumber, extra = {}) => ({ id, ip_number: ipNumber, ...shipped, ...extra });
const allocation = (id, process) => ({ line_id: id, line_kind: "ALLOCATION", line_quantity: "1.00000000",
  factory_ship_date: null, line_status: "", purchase_order: purchaseOrder, item: pastItem, process });
const processIds = ["00000000-0000-4000-8000-000000000071", "00000000-0000-4000-8000-000000000072",
  "00000000-0000-4000-8000-000000000073"];
const stageRows = [
  // In T4 since 2020 (deadline 2020-11-24): late; T3 took 37 of 30 days (+7).
  allocation("00000000-0000-4000-8000-000000000061", stageProcess(processIds[0], "IP-SEA")),
  // Balance planned for 2099: in T0 and on time.
  { line_id: futureItem.id, line_kind: "BALANCE", line_quantity: "5.00000000", factory_ship_date: null,
    line_status: "AGUARDANDO PRODUÇÃO", purchase_order: purchaseOrder, item: futureItem, process: null },
  // Delivered: out of the current stages, but it went through T3 (+7) and T4 (on time).
  allocation("00000000-0000-4000-8000-000000000062", stageProcess(processIds[1], "IP-DONE",
    { arrival_date: "2020-11-20", delivery_date: "2020-11-28" })),
  // Cancelled: never shown, even though it went through T3.
  allocation("00000000-0000-4000-8000-000000000063", stageProcess(processIds[2], "IP-CANCEL",
    { logistics_status: "CANCELLED" })),
];
const stageDocuments = processIds.map((processId, index) => ({ id: `00000000-0000-4000-8000-00000000008${index}`,
  process_id: processId, kind: "INVOICE", status: "ACTIVE", number: "INV", purchase_order_item_id: null }));
const ips = body => body.lines.map(line => line.process?.ipNumber ?? "saldo");

test("product lines filter by the current E2E stage or by the stages already reached", async t => {
  const { app, queries } = await linesApp(t, stageRows, stageDocuments);
  const get = async query => {
    const response = await app.inject({ method: "GET", url: `/api/v1/purchase-order-lines?situation=all&${query}` });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  const sea = (await get("stage=T4")).lines[0];
  assert.deepEqual([sea.calculated.e2e.currentStage, sea.calculated.e2e.currentStageLate], ["T4", true]);
  assert.equal(sea.calculated.e2e.stages.T3.accumulatedDelayDays, 7);
  assert.deepEqual(ips(await get("stage=T4")), ["IP-SEA"]);
  assert.deepEqual(ips(await get("stage=T0")), ["saldo"]);
  assert.deepEqual(ips(await get("stage=T0&late=true")), []);
  assert.deepEqual(ips(await get("late=true")), ["IP-SEA"]);
  // Reached = the stage has an actual date; a line still in that stage is not included.
  assert.deepEqual(ips(await get("view=reached&stage=T3")), ["IP-SEA", "IP-DONE"]);
  assert.deepEqual(ips(await get("view=reached&stage=T3&late=true")), ["IP-SEA", "IP-DONE"]);
  assert.deepEqual(ips(await get("view=reached&stage=T4")), ["IP-DONE"]);
  assert.deepEqual(ips(await get("view=reached&stage=T4&late=true")), []);
  // Filtering after the calculation loads every line and pages the filtered ones.
  const paged = await get("view=reached&stage=T3&page=2&pageSize=1");
  assert.deepEqual([paged.totalCount, ips(paged)], [2, ["IP-DONE"]]);
  assert.deepEqual(queries.filter(query => query.sql.includes("line_kind")).at(-1).params.slice(-2), [null, 0]);
  // Without stage or late filters the database still pages.
  await get("view=reached&page=2&pageSize=1");
  assert.deepEqual(queries.filter(query => query.sql.includes("line_kind")).at(-1).params.slice(-2), [1, 1]);
  for (const query of ["stage=T6", "view=all&stage=T3", "late=1"]) {
    const invalid = await app.inject({ method: "GET", url: `/api/v1/purchase-order-lines?${query}` });
    assert.equal(invalid.statusCode, 400, query);
  }
});

test("the E2E stage summary counts stages and exact item quantities by status and deadline", async t => {
  const decimalRow = { ...stageRows[0], line_id: "00000000-0000-4000-8000-000000000064", line_quantity: "0.20000000" };
  const summaryRows = [{ ...stageRows[0], line_quantity: "0.10000000" }, ...stageRows.slice(1), decimalRow];
  const { app, queries } = await linesApp(t, summaryRows, stageDocuments);
  const response = await app.inject({ method: "GET", url: "/api/v1/purchase-order-lines/e2e-stages?situation=all&ipNumber=IP" });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.deepEqual([body.totalCount, body.delivered], [4, 1]);
  assert.deepEqual(body.stages.T0, { current: 1, currentLate: 0, reached: 3, reachedLate: 0 });
  assert.deepEqual(body.stages.T3, { current: 0, currentLate: 0, reached: 3, reachedLate: 3 });
  assert.deepEqual(body.stages.T4, { current: 2, currentLate: 2, reached: 1, reachedLate: 0 });
  assert.deepEqual(body.stages.T5, { current: 0, currentLate: 0, reached: 1, reachedLate: 0 });
  assert.deepEqual(Object.keys(body.overview.byStatus), ["AGUARDANDO PRODUÇÃO",
    "AGUARDANDO EMBARQUE", "AGUARDANDO CHEGADA", "DESEMBARAÇO", "ENTREGUE"]);
  assert.deepEqual(Object.keys(body.overview.byDeadline), ["onTime", "onLimit", "late", "noData"]);
  assert.deepEqual(body.overview.byStatus["AGUARDANDO PRODUÇÃO"], { quantity: "5", lines: 1 });
  assert.deepEqual(body.overview.byStatus["AGUARDANDO CHEGADA"], { quantity: "0.3", lines: 2 });
  assert.deepEqual(body.overview.byStatus.ENTREGUE, { quantity: "1", lines: 1 });
  assert.deepEqual(body.overview.byDeadline.noData, { quantity: "5", lines: 1 });
  assert.deepEqual(body.overview.byDeadline.late, { quantity: "1.3", lines: 3 });
  assert.equal(Object.values(body.overview.byStatus).reduce((sum, part) => sum + part.lines, 0), body.totalCount);
  assert.equal(Object.values(body.overview.byDeadline).reduce((sum, part) => sum + part.lines, 0), body.totalCount);
  assert.ok(queries.filter(query => query.sql.includes("line_kind")).at(-1).params.includes("IP"));
  // The charts follow the table, so the summary takes the stage filters too; an unknown stage is refused.
  const invalid = await app.inject({ method: "GET", url: "/api/v1/purchase-order-lines/e2e-stages?stage=T9" });
  assert.equal(invalid.statusCode, 400, invalid.body);
});

test("product lines filter by the total deadline status after the calculation", async t => {
  const { app, queries } = await linesApp(t, stageRows, stageDocuments);
  const get = async query => {
    const response = await app.inject({ method: "GET", url: `/api/v1/purchase-order-lines?situation=all&${query}` });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  assert.deepEqual(ips(await get("deadline=late")), ["IP-SEA", "IP-DONE"]);
  assert.deepEqual(ips(await get("deadline=noData")), ["saldo"]);
  assert.deepEqual(ips(await get("deadline=onTime")), []);
  assert.deepEqual(ips(await get("deadline=late&stage=T4")), ["IP-SEA"]);
  const paged = await get("deadline=late&page=2&pageSize=1");
  assert.deepEqual([paged.totalCount, ips(paged)], [2, ["IP-DONE"]]);
  assert.deepEqual(queries.filter(query => query.sql.includes("line_kind")).at(-1).params.slice(-2), [null, 0]);
  const invalid = await app.inject({ method: "GET", url: "/api/v1/purchase-order-lines?deadline=foo" });
  assert.equal(invalid.statusCode, 400, invalid.body);
});

test("product lines filter by the total delay range after the calculation", async t => {
  const { app, queries } = await linesApp(t, stageRows, stageDocuments);
  const get = async query => {
    const response = await app.inject({ method: "GET", url: `/api/v1/purchase-order-lines?situation=all&${query}` });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  // IP-SEA is 5 days late in total and IP-DONE 1 day; the balance has no total delay; the cancelled line never shows.
  assert.deepEqual(ips(await get("delayRange=upTo30")), ["IP-SEA", "IP-DONE"]);
  assert.deepEqual(ips(await get("delayRange=noData")), ["saldo"]);
  assert.deepEqual(ips(await get("delayRange=inAdvance")), []);
  assert.deepEqual(ips(await get("delayRange=upTo30&deadline=late&stage=T4")), ["IP-SEA"]);
  assert.deepEqual(queries.filter(query => query.sql.includes("line_kind")).at(-1).params.slice(-2), [null, 0]);
  const invalid = await app.inject({ method: "GET", url: "/api/v1/purchase-order-lines?delayRange=late" });
  assert.equal(invalid.statusCode, 400, invalid.body);
});

test("the delay range chart cross-filters with the status and deadline charts", async t => {
  const { app } = await linesApp(t, stageRows, stageDocuments);
  const get = async query => {
    const response = await app.inject({ method: "GET", url: `/api/v1/purchase-order-lines/e2e-stages?situation=all&${query}` });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  const all = await get("");
  assert.deepEqual(Object.keys(all.overview.byDelayRange), ["inAdvance", "onTime", "upTo30", "days30To45", "days45To60",
    "days60To90", "days90To120", "days120Plus", "noData"]);
  assert.deepEqual(all.overview.byDelayRange.upTo30, { quantity: "2", lines: 2 });
  assert.deepEqual(all.overview.byDelayRange.noData, { quantity: "5", lines: 1 });
  assert.deepEqual(all.overview.byDelayRange.inAdvance, { quantity: "0", lines: 0 });

  const upTo30 = await get("delayRange=upTo30");
  assert.deepEqual(upTo30.overview.byDelayRange, all.overview.byDelayRange);
  assert.deepEqual(upTo30.overview.byStatus["AGUARDANDO PRODUÇÃO"], { quantity: "0", lines: 0 });
  assert.deepEqual(upTo30.overview.byStatus["AGUARDANDO CHEGADA"], { quantity: "1", lines: 1 });
  assert.deepEqual(upTo30.overview.byDeadline.late, { quantity: "2", lines: 2 });
  assert.deepEqual([upTo30.totalCount, upTo30.delivered], [2, 1]);

  const balance = await get("status=AGUARDANDO%20PRODU%C3%87%C3%83O");
  assert.deepEqual(balance.overview.byDelayRange.noData, { quantity: "5", lines: 1 });
  assert.deepEqual(balance.overview.byDelayRange.upTo30, { quantity: "0", lines: 0 });

  const late = await get("deadline=late&delayRange=noData");
  assert.deepEqual(late.overview.byDelayRange.upTo30, { quantity: "2", lines: 2 });
  assert.deepEqual(late.overview.byDeadline.noData, { quantity: "5", lines: 1 });
  assert.equal(late.totalCount, 0);

  const invalid = await app.inject({ method: "GET", url: "/api/v1/purchase-order-lines/e2e-stages?delayRange=late" });
  assert.equal(invalid.statusCode, 400, invalid.body);
});

test("product lines filter by demand type and transport mode after the calculation", async t => {
  const { app, queries } = await linesApp(t, stageRows, stageDocuments);
  const get = async query => {
    const response = await app.inject({ method: "GET", url: `/api/v1/purchase-order-lines?situation=all&${query}` });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  // The IPs are MTS and by sea; the balance has no demand type and no transport mode; the cancelled line never shows.
  assert.deepEqual(ips(await get("demandType=mts")), ["IP-SEA", "IP-DONE"]);
  assert.deepEqual(ips(await get("demandType=notMts")), []);
  assert.deepEqual(ips(await get("modal=sea")), ["IP-SEA", "IP-DONE"]);
  assert.deepEqual(ips(await get("modal=air")), []);
  assert.deepEqual(ips(await get("demandType=mts&modal=sea&stage=T4")), ["IP-SEA"]);
  assert.deepEqual(queries.filter(query => query.sql.includes("line_kind")).at(-1).params.slice(-2), [null, 0]);
  for (const query of ["demandType=MTS", "modal=SEA", "modal=road"]) {
    const invalid = await app.inject({ method: "GET", url: `/api/v1/purchase-order-lines?${query}` });
    assert.equal(invalid.statusCode, 400, query);
  }
});

test("the charts follow the table filters while the stage cards keep every stage", async t => {
  const { app } = await linesApp(t, stageRows, stageDocuments);
  const get = async query => {
    const response = await app.inject({ method: "GET", url: `/api/v1/purchase-order-lines/e2e-stages?situation=all&${query}` });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  const all = await get("");
  // Demand type and transport mode filter everything, the stage cards included.
  const sea = await get("modal=sea");
  assert.deepEqual([sea.totalCount, sea.delivered, sea.stages.T0.current, sea.stages.T4.current], [2, 1, 0, 1]);
  assert.deepEqual(sea.overview.byStatus["AGUARDANDO PRODUÇÃO"], { quantity: "0", lines: 0 });
  assert.deepEqual(sea.overview.byStatus["AGUARDANDO CHEGADA"], { quantity: "1", lines: 1 });
  const notMts = await get("demandType=notMts");
  assert.deepEqual([notMts.totalCount, notMts.overview.byDeadline.late.lines], [0, 0]);

  // The stage, the view and the late toggle filter the charts like the table, but not the stage cards.
  const t4 = await get("stage=T4");
  assert.deepEqual(t4.stages, all.stages);
  assert.deepEqual([t4.totalCount, t4.delivered], [all.totalCount, all.delivered]);
  assert.deepEqual(t4.overview.byStatus["AGUARDANDO CHEGADA"], { quantity: "1", lines: 1 });
  assert.equal(Object.values(t4.overview.byStatus).reduce((sum, part) => sum + part.lines, 0), 1);
  const reachedT3 = await get("stage=T3&view=reached");
  assert.equal(Object.values(reachedT3.overview.byStatus).reduce((sum, part) => sum + part.lines, 0), 2);
  assert.deepEqual(reachedT3.overview.byStatus.ENTREGUE, { quantity: "1", lines: 1 });
  const lateNow = await get("late=true");
  assert.deepEqual(lateNow.overview.byDelayRange.upTo30, { quantity: "1", lines: 1 });
  assert.deepEqual(lateNow.overview.byDelayRange.noData, { quantity: "0", lines: 0 });
});

test("each summary chart ignores its own filter and follows the other one", async t => {
  const decimalRow = { ...stageRows[0], line_id: "00000000-0000-4000-8000-000000000064", line_quantity: "0.20000000" };
  const summaryRows = [{ ...stageRows[0], line_quantity: "0.10000000" }, ...stageRows.slice(1), decimalRow];
  const { app, queries } = await linesApp(t, summaryRows, stageDocuments);
  const get = async query => {
    const response = await app.inject({ method: "GET", url: `/api/v1/purchase-order-lines/e2e-stages?situation=all&${query}` });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  const all = await get("");
  const arriving = await get("status=AGUARDANDO%20CHEGADA");
  // The status filter is applied after the calculation, so the database returns every status.
  assert.equal(queries.filter(query => query.sql.includes("line_kind")).at(-1).params[5], null);
  assert.deepEqual(arriving.overview.byStatus, all.overview.byStatus);
  assert.deepEqual(arriving.overview.byDeadline.late, { quantity: "0.3", lines: 2 });
  assert.deepEqual(arriving.overview.byDeadline.noData, { quantity: "0", lines: 0 });
  assert.deepEqual([arriving.totalCount, arriving.delivered, arriving.stages.T4.current], [2, 0, 2]);

  const late = await get("deadline=late");
  assert.deepEqual(late.overview.byDeadline, all.overview.byDeadline);
  assert.deepEqual(late.overview.byStatus["AGUARDANDO PRODUÇÃO"], { quantity: "0", lines: 0 });
  assert.deepEqual(late.overview.byStatus["AGUARDANDO CHEGADA"], { quantity: "0.3", lines: 2 });
  assert.deepEqual(late.overview.byStatus.ENTREGUE, { quantity: "1", lines: 1 });
  assert.deepEqual([late.totalCount, late.delivered, late.stages.T0.current], [3, 1, 0]);

  const both = await get("status=ENTREGUE&deadline=noData");
  assert.deepEqual(both.overview.byStatus["AGUARDANDO PRODUÇÃO"], { quantity: "5", lines: 1 });
  assert.equal(Object.values(both.overview.byStatus).reduce((sum, part) => sum + part.lines, 0), 1);
  assert.deepEqual(both.overview.byDeadline.late, { quantity: "1", lines: 1 });
  assert.equal(Object.values(both.overview.byDeadline).reduce((sum, part) => sum + part.lines, 0), 1);
  assert.deepEqual([both.totalCount, both.delivered], [0, 0]);

  const invalid = await app.inject({ method: "GET", url: "/api/v1/purchase-order-lines/e2e-stages?deadline=foo" });
  assert.equal(invalid.statusCode, 400, invalid.body);
});

test("the summary keeps the lines of any chosen status", async t => {
  const { app } = await linesApp(t, stageRows, stageDocuments);
  const response = await app.inject({ method: "GET",
    url: "/api/v1/purchase-order-lines/e2e-stages?situation=all&status=AGUARDANDO%20CHEGADA&status=ENTREGUE" });
  assert.equal(response.statusCode, 200, response.body);
  // IP-SEA is arriving and IP-DONE delivered; the balance and the cancelled line stay out.
  assert.deepEqual([response.json().totalCount, response.json().delivered], [2, 1]);
});

test("the deadline and delay range filters take one or more values, in the table and the summary", async t => {
  const { app, queries } = await linesApp(t, stageRows, stageDocuments);
  const get = async (route, query) => {
    const response = await app.inject({ method: "GET", url: `/api/v1/purchase-order-lines${route}?situation=all&${query}` });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  // IP-SEA and IP-DONE are late and up to 30 days; the balance has no data; the cancelled line never shows.
  assert.deepEqual(ips(await get("", "deadline=late&deadline=noData")), ["IP-SEA", "saldo", "IP-DONE"]);
  assert.deepEqual(ips(await get("", "deadline=onTime&deadline=noData")), ["saldo"]);
  assert.deepEqual(ips(await get("", "delayRange=upTo30&delayRange=noData")), ["IP-SEA", "saldo", "IP-DONE"]);
  assert.deepEqual(ips(await get("", "delayRange=inAdvance&delayRange=noData&deadline=late")), []);
  // An empty list is no filter: the database pages the lines as without it.
  await get("", "deadline=&delayRange=&page=1&pageSize=50");
  assert.deepEqual(queries.filter(query => query.sql.includes("line_kind")).at(-1).params.slice(-2), [50, 0]);
  // Each chart ignores its own list and follows the others.
  const all = await get("/e2e-stages", "");
  const both = await get("/e2e-stages", "deadline=late&deadline=noData");
  assert.deepEqual(both.overview.byDeadline, all.overview.byDeadline);
  assert.equal(both.totalCount, 3);
  assert.equal(Object.values(both.overview.byStatus).reduce((sum, part) => sum + part.lines, 0), 3);
  const ranges = await get("/e2e-stages", "delayRange=upTo30&delayRange=inAdvance");
  assert.deepEqual(ranges.overview.byDelayRange, all.overview.byDelayRange);
  assert.deepEqual(ranges.overview.byStatus["AGUARDANDO PRODUÇÃO"], { quantity: "0", lines: 0 });
  assert.equal(ranges.totalCount, 2);
  for (const query of ["deadline=late&deadline=foo", "delayRange=upTo30&delayRange=late"]) {
    const invalid = await app.inject({ method: "GET", url: `/api/v1/purchase-order-lines?${query}` });
    assert.equal(invalid.statusCode, 400, query);
  }
});

test("the End to End routes run at most two calculations at once, so the pool keeps room for light requests", async t => {
  let inFlight = 0;
  let peak = 0;
  const waiting = [];
  const pool = {
    async query(sql) {
      if (sql.includes("identity.erp_user AS u")) return { rows: [{ role: "Consulta", importer_code: "ELETRA MATRIZ" }] };
      if (sql.includes("line_kind")) {
        inFlight++; peak = Math.max(peak, inFlight);
        await new Promise(resolve => waiting.push(resolve));
        inFlight--;
        return { rows: [{ total_count: defaultRows.length, items: defaultRows }] };
      }
      if (sql.includes("FROM imports.process_document")) return { rows: defaultDocuments };
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
  await registerShipmentLineRoutes(app, pool);
  // A burst of chart clicks: the table and the summary of each, with and without the calculated filters.
  const urls = ["/api/v1/purchase-order-lines?situation=all", "/api/v1/purchase-order-lines/e2e-stages?situation=all",
    "/api/v1/purchase-order-lines?situation=all&deadline=late", "/api/v1/purchase-order-lines/e2e-stages?situation=all&deadline=late",
    "/api/v1/purchase-order-lines?situation=all&delayRange=upTo30"];
  const responses = urls.map(url => app.inject({ method: "GET", url }));
  const settle = () => new Promise(resolve => setTimeout(resolve, 20));
  await settle();
  assert.equal(inFlight, 2);
  // Each finished calculation lets exactly one more in, in arrival order.
  while (waiting.length) { waiting.shift()(); await settle(); }
  for (const response of await Promise.all(responses)) assert.equal(response.statusCode, 200, response.body);
  assert.equal(peak, 2);
});

test("a queued End to End request whose client left is dropped instead of calculated", async () => {
  const source = await readFile(new URL("../src/shipment-lines.ts", import.meta.url), "utf8");
  // The signal follows the response: it aborts only when the connection closes before the reply was sent.
  assert.match(source, /reply\.raw\.once\("close", \(\) => \{ if \(!reply\.raw\.writableFinished\) controller\.abort\(\); \}\);/u);
  assert.equal((source.match(/gate\.run\(\(\) => query/gu) ?? []).length, 2);
  assert.equal((source.match(/if \(error instanceof WorkCancelledError\) return cancelled\(request, reply\);/gu) ?? []).length, 2);
  assert.match(source, /export const E2E_CALCULATION_CONCURRENCY = 2;/u);
});
