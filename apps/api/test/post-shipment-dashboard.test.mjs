import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { z } from "zod";
import { registerAuthorization } from "../dist/authorization.js";
import { channelKey, clearanceType, ltDocTarget, POST_SHIPMENT_CHANNELS, POST_SHIPMENT_CLEARANCE_TYPES,
  POST_SHIPMENT_STATUSES, postShipmentIp, postShipmentMonths, postShipmentQuery, registerPostShipmentDashboardRoutes,
  selectPostShipmentLines, summarizePostShipment } from "../dist/post-shipment-dashboard.js";
import { createWorkGate } from "../dist/work-gate.js";

const actorId = "00000000-0000-4000-8000-000000000001";
const today = "2026-11-06";
let sequence = 0;
/** A row of the IP query, as PostgreSQL returns it (dates as text). */
const ipRow = overrides => ({ id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  ip_number: `IP-${sequence}`, importer: "ELETRA MATRIZ", priority: null, incoterm: "DAP", transport_mode: "SEA",
  etd: null, eta_confirmed: null, ete_confirmed: null, arrival_date: null, documents_ok_date: null, duimp_date: null,
  delivery_date: null, ip_totvs_date: null, customs_channel: null, container_quantity: null, necessity_date: null,
  status: "AGUARDANDO PRODUÇÃO", ...overrides });
const ip = (overrides, day = today) => postShipmentIp(ipRow(overrides), day);

test("the lists of the dashboard: IP statuses in the order of the flow, channels and clearance types", () => {
  assert.deepEqual([...POST_SHIPMENT_STATUSES], ["AGUARDANDO PRODUÇÃO", "AGUARDANDO EMBARQUE", "AGUARDANDO CHEGADA",
    "DESEMBARAÇO", "ENTREGUE", "CANCELADO"]);
  assert.deepEqual([...POST_SHIPMENT_CHANNELS], ["green", "yellow", "red", "gray", "other", "none"]);
  assert.deepEqual([...POST_SHIPMENT_CLEARANCE_TYPES], ["onWater", "normal"]);
  for (const [text, key] of [["GREEN", "green"], [" verde ", "green"], ["Yellow", "yellow"], ["RED", "red"],
    ["CINZA", "gray"], ["Azul", "other"], [null, "none"], ["  ", "none"]]) assert.equal(channelKey(text), key, String(text));
});

test("LT DOC counts from the arrival to the documents (or today), with the target of the mode", () => {
  assert.equal(ltDocTarget("SEA"), 7);
  assert.equal(ltDocTarget(" Marítimo "), 7);
  assert.equal(ltDocTarget("air"), 2);
  assert.equal(ltDocTarget("COURIER"), null);
  assert.equal(ltDocTarget(null), null);
  const cases = [
    [{ transport_mode: "AIR", arrival_date: "2026-03-10", documents_ok_date: "2026-03-12" }, 2, 2, true],
    [{ transport_mode: "AIR", arrival_date: "2026-03-10", documents_ok_date: "2026-03-13" }, 3, 2, false],
    [{ transport_mode: "SEA", arrival_date: "2026-03-10", documents_ok_date: "2026-03-17" }, 7, 7, true],
    [{ transport_mode: "SEA", arrival_date: "2026-03-10", documents_ok_date: "2026-03-18" }, 8, 7, false],
    // Documents before the arrival: negative, within the target (as -31 and -13 in the BI).
    [{ transport_mode: "SEA", arrival_date: "2026-11-02", documents_ok_date: "2026-10-02" }, -31, 7, true],
    // A courier has no target: only the number.
    [{ transport_mode: "COURIER", arrival_date: "2026-03-10", documents_ok_date: "2026-03-30" }, 20, null, null],
    // Without the documents, it counts up to today.
    [{ transport_mode: "SEA", arrival_date: "2026-11-01" }, 5, 7, true],
    // Without the arrival there is no LT DOC.
    [{ transport_mode: "SEA", documents_ok_date: "2026-03-12" }, null, 7, null],
  ];
  for (const [row, days, target, onTarget] of cases) {
    const line = ip(row);
    assert.deepEqual([line.ltDoc, line.ltDocTarget, line.ltDocOnTarget], [days, target, onTarget], JSON.stringify(row));
  }
});

test("LT Clearance counts from the arrival to the delivery (or today) and SLA TXT from the IP date to the arrival", () => {
  assert.equal(ip({ arrival_date: "2026-01-20", delivery_date: "2026-02-26" }).leadTime, 37);
  assert.equal(ip({ arrival_date: "2026-08-11" }).leadTime, 87);
  assert.equal(ip({ delivery_date: "2026-02-26" }).leadTime, null);
  assert.equal(ip({ arrival_date: "2026-06-07", ip_totvs_date: "2026-06-02" }).slaTxt, 5);
  assert.equal(ip({ arrival_date: "2026-06-07" }).slaTxt, null);
  assert.equal(ip({ ip_totvs_date: "2026-06-02" }).slaTxt, null);
});

test("the clearance is on water when the DUIMP was registered before the arrival or before the cargo arrived", () => {
  assert.equal(clearanceType("2026-10-29", "2026-11-02"), "onWater");
  assert.equal(clearanceType("2026-10-29", null), "onWater");
  // Arrived without a DUIMP: the BI counts it as on water (a blank date is the smallest); the system does not.
  assert.equal(clearanceType(null, "2026-08-11"), "normal");
  assert.equal(clearanceType("2026-08-11", "2026-08-11"), "normal");
  assert.equal(clearanceType("2026-08-12", "2026-08-11"), "normal");
  assert.equal(clearanceType(null, null), "normal");
});

test("each IP keeps its dates, the calculated ETA and ETE, the reference date and the keys of the charts", () => {
  const line = ip({ ip_number: "015B/2026", priority: " Prioridade ", transport_mode: "SEA", etd: "2026-06-22",
    customs_channel: "GREEN", container_quantity: "0.50", necessity_date: "2026-02-01", status: "DESEMBARAÇO",
    arrival_date: "2026-08-11", documents_ok_date: "2026-08-12" });
  assert.equal(line.ipNumber, "015B/2026");
  assert.deepEqual([line.priority, line.priorityKey, line.channelKey], ["Prioridade", "priority", "green"]);
  // ETA = ETD + 55 days by sea, ETE = ETA + 10, as in the other screens.
  assert.deepEqual([line.eta, line.ete], ["2026-08-16", "2026-08-26"]);
  // Not delivered: the reference date is today.
  assert.equal(line.referenceDate, today);
  assert.equal(line.containerQuantity, "0.50");
  assert.equal(ip({ delivery_date: "2026-03-20" }).referenceDate, "2026-03-20");
  assert.equal(ip({ priority: "" }).priorityKey, "normal");
  assert.deepEqual([ip({ eta_confirmed: "2026-08-09", ete_confirmed: "2026-10-30", etd: "2026-06-22" }).eta,
    ip({ eta_confirmed: "2026-08-09", ete_confirmed: "2026-10-30" }).ete], ["2026-08-09", "2026-10-30"]);
});

const dataset = () => [
  ip({ status: "ENTREGUE", delivery_date: "2026-01-15", arrival_date: "2026-01-05", duimp_date: "2026-01-02",
    documents_ok_date: "2026-01-07", ip_totvs_date: "2025-12-01", customs_channel: "GREEN", container_quantity: "1.00" }),
  ip({ status: "ENTREGUE", delivery_date: "2026-01-25", arrival_date: "2026-01-05", duimp_date: "2026-01-06",
    documents_ok_date: "2026-01-15", ip_totvs_date: "2025-12-06", customs_channel: "YELLOW", container_quantity: "0.50",
    priority: "Prioridade" }),
  ip({ status: "ENTREGUE", delivery_date: "2026-03-10", arrival_date: "2026-03-01", duimp_date: "2026-03-01",
    customs_channel: "GREEN", container_quantity: "2.00" }),
  ip({ status: "DESEMBARAÇO", arrival_date: "2026-11-01", duimp_date: "2026-10-30", customs_channel: "RED",
    container_quantity: "1.00", priority: "Prioridade" }),
  ip({ status: "AGUARDANDO EMBARQUE", transport_mode: "AIR" }),
];

test("the summary counts the IPs, the containers, the on water share and the averages of the filters", () => {
  const summary = summarizePostShipment(dataset(), {}, today);
  assert.equal(summary.totalIps, 5);
  assert.equal(summary.containers, "4.5");
  assert.equal(summary.onWater, 2);
  assert.equal(summary.dsa, 0.4);
  // LT DOC: 2, 10, today − 2026-03-01 (no documents: 250) and today − 2026-11-01 (5); the IP without arrival is out.
  assert.equal(summary.avgLtDoc, (2 + 10 + 250 + 5) / 4);
  // SLA TXT only of the IPs with the IP date and the arrival.
  assert.equal(summary.avgSlaTxt, (35 + 30) / 2);
  assert.deepEqual(summary.byStatus, { "AGUARDANDO PRODUÇÃO": 0, "AGUARDANDO EMBARQUE": 1, "AGUARDANDO CHEGADA": 0,
    DESEMBARAÇO: 1, ENTREGUE: 3, CANCELADO: 0 });
  assert.deepEqual(summary.byChannel, { green: 2, yellow: 1, red: 1, gray: 0, other: 0, none: 1 });
  assert.deepEqual(summary.byPriority, { priority: 2, normal: 3 });
  assert.deepEqual(summary.targets, { dsa: 0.7, avgLtDoc: 7, leadTime: 7, slaTxt: 20 });
  const empty = summarizePostShipment([], {}, today);
  assert.deepEqual([empty.totalIps, empty.containers, empty.dsa, empty.avgLtDoc, empty.avgSlaTxt], [0, "0", null, null, null]);
});

test("each chart ignores its own selection and follows the others; the on water share ignores the clearance", () => {
  const ips = dataset();
  const byStatus = summarizePostShipment(ips, { status: ["ENTREGUE"] }, today);
  assert.equal(byStatus.totalIps, 3);
  assert.equal(byStatus.byStatus.DESEMBARAÇO, 1);
  assert.deepEqual(byStatus.byChannel, { green: 2, yellow: 1, red: 0, gray: 0, other: 0, none: 0 });
  assert.deepEqual(byStatus.byPriority, { priority: 1, normal: 2 });

  const byChannel = summarizePostShipment(ips, { channel: ["red"], priority: ["priority"] }, today);
  assert.equal(byChannel.totalIps, 1);
  assert.equal(byChannel.byChannel.yellow, 1);
  assert.deepEqual(byChannel.byPriority, { priority: 1, normal: 0 });

  const onWater = summarizePostShipment(ips, { clearance: ["onWater"] }, today);
  assert.equal(onWater.totalIps, 2);
  assert.deepEqual([onWater.onWater, onWater.dsa], [2, 0.4]);
});

test("the date filter uses the reference date: the delivery, or today for the IPs not delivered", () => {
  const ips = dataset();
  assert.equal(summarizePostShipment(ips, { dateFrom: "2026-01-01", dateTo: "2026-01-31" }, today).totalIps, 2);
  assert.equal(summarizePostShipment(ips, { dateFrom: "2026-11-01" }, today).totalIps, 2);
  assert.equal(summarizePostShipment(ips, { dateTo: "2026-03-10" }, today).totalIps, 3);
});

test("the months are the whole history: from the earliest reference date to the month of today", () => {
  assert.deepEqual(postShipmentMonths([], today), []);
  assert.deepEqual(postShipmentMonths(["2026-01-05", "2025-11-20", "2026-01-31"], "2026-02-03"),
    ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.deepEqual(postShipmentMonths([today], today), ["2026-11"]);
});

test("the monthly charts ignore the date filter and follow the other filters and selections", () => {
  const summary = summarizePostShipment(dataset(), { dateFrom: "2026-01-01", dateTo: "2026-03-31" }, today);
  // The cards follow the period; the monthly charts keep the whole history.
  assert.equal(summary.totalIps, 3);
  assert.deepEqual(summary.months, summarizePostShipment(dataset(), {}, today).months);
  assert.equal(summary.months.length, 11);
  const month = key => summary.months.find(item => item.month === key);
  const [january, february, march, november] = ["2026-01", "2026-02", "2026-03", "2026-11"].map(month);
  assert.deepEqual([january.ips, january.onWater, january.dsa], [2, 1, 0.5]);
  // A month with IPs and none on water is 0%; a month without IPs has no value.
  assert.deepEqual([march.ips, march.onWater, march.dsa], [1, 0, 0]);
  assert.deepEqual([february.ips, february.dsa, february.leadTimeRealTime, february.leadTimeDelivered], [0, null, null, null]);
  assert.deepEqual([january.leadTimeRealTime, january.leadTimeDelivered], [15, 15]);
  assert.deepEqual([march.leadTimeRealTime, march.leadTimeDelivered], [9, 9]);
  // In the month of today, the IPs not delivered count with the lead time up to today; the delivered chart does not.
  assert.deepEqual([november.ips, november.onWater, november.dsa], [2, 1, 0.5]);
  assert.deepEqual([november.leadTimeRealTime, november.leadTimeDelivered], [5, null]);
  // Change against the month before: none when the month before has no value.
  assert.equal(january.leadTimeRealTimeChange, null);
  assert.equal(march.leadTimeRealTimeChange, null);
  assert.deepEqual(summary.monthlyAverages, { dsa: 1 / 3, leadTimeRealTime: 29 / 3, leadTimeDelivered: 12 });
  // The other filters still apply: only the priority IPs (one delivered in January, one in the clearance today).
  const priority = summarizePostShipment(dataset(), { priority: ["priority"] }, today);
  assert.deepEqual(priority.months.find(item => item.month === "2026-01").ips, 1);
  assert.deepEqual(priority.months.find(item => item.month === "2026-11").ips, 1);

  const day = "2026-02-20";
  const change = summarizePostShipment([
    ip({ status: "ENTREGUE", arrival_date: "2026-01-01", delivery_date: "2026-01-21" }, day),
    ip({ status: "ENTREGUE", arrival_date: "2026-02-01", delivery_date: "2026-02-16" }, day),
  ], {}, day);
  assert.equal(change.months[1].leadTimeRealTimeChange, -0.25);
  assert.equal(change.months[1].leadTimeDeliveredChange, -0.25);
});

test("the table follows every filter and selection, in the order of the flow, the necessity and the IP", () => {
  const ips = [
    ip({ ip_number: "B", status: "ENTREGUE", delivery_date: "2026-01-15", necessity_date: "2026-01-01" }),
    ip({ ip_number: "A", status: "ENTREGUE", delivery_date: "2026-01-15", necessity_date: "2026-01-01" }),
    ip({ ip_number: "C", status: "ENTREGUE", delivery_date: "2026-01-15", necessity_date: null }),
    ip({ ip_number: "D", status: "AGUARDANDO EMBARQUE", necessity_date: "2027-01-01" }),
    ip({ ip_number: "E", status: "DESEMBARAÇO", arrival_date: "2026-10-01", duimp_date: "2026-09-29" }),
  ];
  assert.deepEqual(selectPostShipmentLines(ips, {}).map(line => line.ipNumber), ["D", "E", "A", "B", "C"]);
  assert.deepEqual(selectPostShipmentLines(ips, { clearance: ["onWater"] }).map(line => line.ipNumber), ["E"]);
  assert.deepEqual(selectPostShipmentLines(ips, { status: ["ENTREGUE"], dateFrom: "2026-01-15" }).map(line => line.ipNumber),
    ["A", "B", "C"]);
});

async function dashboardApp(t, { gate } = {}) {
  const queries = [];
  const rows = [
    ipRow({ ip_number: "015B/2026", status: "DESEMBARAÇO", arrival_date: "2026-08-11", documents_ok_date: "2026-08-12" }),
    ipRow({ ip_number: "061E/2025", status: "ENTREGUE", arrival_date: "2026-01-20", delivery_date: "2026-02-26" }),
  ];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("identity.erp_user AS u")) return { rows: [{ role: "Consulta", importer_code: "ELETRA MATRIZ" }] };
      if (sql.includes("option_modes")) return { rows: [{ option_modes: ["SEA", "AIR"], option_importers: ["FOR", "ELETRA MATRIZ"] }] };
      if (sql.includes("post_shipment_ip")) return { rows };
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
  await registerPostShipmentDashboardRoutes(app, pool, gate);
  return { app, queries };
}

test("the summary route reads the IPs of the user's importers with the filters, and keeps deleted IPs out", async t => {
  const { app, queries } = await dashboardApp(t);
  const response = await app.inject("/api/v1/reports/post-shipment/summary?status=ENTREGUE&channel=green&priority=normal"
    + "&clearance=onWater&importers=FOR&modes=SEA&modes=AIR&ipNumber=015&dateFrom=2026-01-01&dateTo=2026-12-31");
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers["cache-control"], "no-store");
  const { sql, params } = queries.find(query => query.sql.includes("post_shipment_ip"));
  assert.deepEqual(params[0], ["ELETRA MATRIZ"]);
  for (const value of [["FOR"], ["SEA", "AIR"], "015"]) {
    assert.ok(params.some(param => JSON.stringify(param) === JSON.stringify(value)), JSON.stringify(value));
  }
  // The selections and the date are applied by the summary (cross-filter), not by the query.
  assert.equal(params.some(param => JSON.stringify(param).includes("ENTREGUE")), false);
  assert.match(sql, /p\.record_status <> 'DELETED'/u);
  assert.match(sql, /WHEN p\.record_status = 'CANCELLED' THEN 'CANCELADO'/u);
  // The status of the IP comes from its own dates, as in the other screens.
  assert.match(sql, /WHEN p\.delivery_date IS NOT NULL THEN 'ENTREGUE'/u);
  // The necessity is the earliest of the products allocated to the IP.
  assert.match(sql, /min\(item\.necessity_date\)/u);
  assert.match(sql, /a\.status = 'ACTIVE'/u);
  const body = response.json();
  assert.equal(typeof body.totalIps, "number");
  assert.ok(Array.isArray(body.months));
});

test("the lines route pages the filtered IPs", async t => {
  const { app } = await dashboardApp(t);
  const response = await app.inject("/api/v1/reports/post-shipment/lines?page=1&pageSize=1");
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.deepEqual([body.page, body.pageSize, body.totalCount, body.lines.length], [1, 1, 2, 1]);
  assert.equal(body.lines[0].ipNumber, "015B/2026");
  assert.equal(body.lines[0].ltDoc, 1);
  const second = (await app.inject("/api/v1/reports/post-shipment/lines?page=2&pageSize=1")).json();
  assert.equal(second.lines[0].ipNumber, "061E/2025");
  assert.equal(second.lines[0].leadTime, 37);
});

test("the routes refuse unknown or invalid parameters", async t => {
  const { app, queries } = await dashboardApp(t);
  for (const url of ["/api/v1/reports/post-shipment/summary?other=1", "/api/v1/reports/post-shipment/summary?status=OUTRO",
    "/api/v1/reports/post-shipment/summary?channel=blue", "/api/v1/reports/post-shipment/summary?priority=high",
    "/api/v1/reports/post-shipment/summary?clearance=late", "/api/v1/reports/post-shipment/summary?dateFrom=01/02/2026",
    "/api/v1/reports/post-shipment/lines?page=0", "/api/v1/reports/post-shipment/lines?pageSize=500"]) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 400, url);
    assert.equal(response.json().code, "INVALID_QUERY");
  }
  assert.equal(queries.some(query => query.sql.includes("post_shipment_ip")), false);
});

test("the routes require the permission to read IPs", async t => {
  const pool = { async query(sql) {
    if (sql.includes("identity.erp_user AS u")) return { rows: [] };
    return { rows: [] };
  } };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    request.authContext = { issuer: "ci", subject: "nobody", userId: actorId, displayName: null, sessionToken: "ci" };
  });
  await registerPostShipmentDashboardRoutes(app, pool);
  for (const url of ["/api/v1/reports/post-shipment/summary", "/api/v1/reports/post-shipment/lines",
    "/api/v1/reports/post-shipment/filter-options"]) {
    assert.equal((await app.inject(url)).statusCode, 403, url);
  }
});

test("the filter options list the sorted modes and importers of the user's IPs", async t => {
  const { app, queries } = await dashboardApp(t);
  const response = await app.inject("/api/v1/reports/post-shipment/filter-options");
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { modes: ["AIR", "SEA"], importers: ["ELETRA MATRIZ", "FOR"] });
  assert.deepEqual(queries.find(query => query.sql.includes("option_modes")).params, [["ELETRA MATRIZ"]]);
});

test("the summary and the table wait in the shared gate of the heavy calculations", async t => {
  const gate = createWorkGate(1);
  let release;
  const blocker = gate.run(() => new Promise(resolve => { release = resolve; }));
  const { app, queries } = await dashboardApp(t, { gate });
  const pending = [app.inject("/api/v1/reports/post-shipment/summary"), app.inject("/api/v1/reports/post-shipment/lines")];
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(queries.some(query => query.sql.includes("post_shipment_ip")), false);
  release(); await blocker;
  for (const response of await Promise.all(pending)) assert.equal(response.statusCode, 200, response.body);
});

test("the filters built by the web pass the API query schema", async () => {
  const { emptyPostShipmentFilters, postShipmentLinesQuery, postShipmentSummaryQuery } =
    await import("../../web/lib/post-shipment-dashboard.ts");
  const filters = { ...emptyPostShipmentFilters, status: ["DESEMBARAÇO", "ENTREGUE"], channel: ["green", "none"],
    priority: ["priority"], clearance: ["onWater"], importers: ["FOR"], modes: ["SEA", "AIR"], ipNumber: " 015B ",
    dateFrom: "2026-01-01", dateTo: "2026-01-31", datePeriod: "month:0:0" };
  const asQuery = params => Object.fromEntries([...new Set(params.keys())].map(key =>
    [key, params.getAll(key).length > 1 ? params.getAll(key) : params.get(key)]));
  const summary = asQuery(postShipmentSummaryQuery(filters));
  const parsed = postShipmentQuery.strict().safeParse(summary);
  assert.equal(parsed.success, true, JSON.stringify(summary));
  assert.deepEqual([parsed.data.status, parsed.data.channel, parsed.data.priority, parsed.data.ipNumber, parsed.data.dateTo],
    [["DESEMBARAÇO", "ENTREGUE"], ["green", "none"], ["priority"], "015B", "2026-01-31"]);
  const page = asQuery(postShipmentLinesQuery(filters, 3, 50));
  assert.equal(postShipmentQuery.extend({ page: z.coerce.number(), pageSize: z.coerce.number() }).strict()
    .safeParse(page).success, true, JSON.stringify(page));
  assert.deepEqual(asQuery(postShipmentSummaryQuery(emptyPostShipmentFilters)), {});
});

test("the web lists of statuses, channels and clearance types match the API", async () => {
  const { postShipmentChannels, postShipmentClearanceTypes, postShipmentStatuses } =
    await import("../../web/lib/post-shipment-dashboard.ts");
  assert.deepEqual([...postShipmentStatuses], [...POST_SHIPMENT_STATUSES]);
  assert.deepEqual([...postShipmentChannels], [...POST_SHIPMENT_CHANNELS]);
  assert.deepEqual([...postShipmentClearanceTypes], [...POST_SHIPMENT_CLEARANCE_TYPES]);
});
