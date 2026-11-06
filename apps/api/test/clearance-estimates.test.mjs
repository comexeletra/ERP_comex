import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { CLEARANCE_PERIODS, CLEARANCE_REGISTERED, clearanceEstimateLine, clearanceEstimatesQuery, isRegistered,
  nextWeekRange, registerClearanceEstimateRoutes, selectClearanceEstimates } from "../dist/clearance-estimates.js";
import { POST_SHIPMENT_STATUSES } from "../dist/post-shipment-dashboard.js";

const actorId = "00000000-0000-4000-8000-000000000001";
const today = "2026-11-06";
let sequence = 0;
/** A row of the clearance query, as PostgreSQL returns it (dates and money as text). */
const row = overrides => ({ id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  ip_number: `IP-${sequence}`, importer: "ELETRA MATRIZ", clearance_analyst: null, registration_target_date: null,
  clearance_estimate_brl: null, supplier_name: null, transport_mode: "SEA", etd: null, eta_confirmed: null,
  ete_confirmed: null, duimp_number: null, duimp_date: null, status: "AGUARDANDO CHEGADA", ...overrides });
const line = overrides => clearanceEstimateLine(row(overrides));

test("the next week runs from the Monday after this week to the Sunday, as the BI WEEKDAY(today, 2)", () => {
  // Friday 2026-11-06: this week started on Monday 11-02, the next one is 11-09 to 11-15.
  assert.deepEqual(nextWeekRange("2026-11-06"), { from: "2026-11-09", to: "2026-11-15" });
  assert.deepEqual(nextWeekRange("2026-11-02"), { from: "2026-11-09", to: "2026-11-15" });
  assert.deepEqual(nextWeekRange("2026-11-08"), { from: "2026-11-09", to: "2026-11-15" });
  assert.deepEqual(nextWeekRange("2026-11-09"), { from: "2026-11-16", to: "2026-11-22" });
  // Across the month and the year.
  assert.deepEqual(nextWeekRange("2026-12-31"), { from: "2027-01-04", to: "2027-01-10" });
});

test("an IP is registered when it has the DUIMP number or date", () => {
  assert.equal(isRegistered("26BR0001964550-4", null), true);
  assert.equal(isRegistered(null, "2026-10-14"), true);
  assert.equal(isRegistered("  ", null), false);
  assert.equal(isRegistered(null, null), false);
  assert.deepEqual([...CLEARANCE_REGISTERED], ["yes", "no"]);
  assert.deepEqual([...CLEARANCE_PERIODS], ["nextWeek", "all"]);
});

test("each line keeps the estimate fields of the IP, the supplier, the calculated ETA and the registration", () => {
  const found = line({ ip_number: "024A/2026", clearance_analyst: " Leisiane ", registration_target_date: "2026-10-14",
    clearance_estimate_brl: "834389.97", supplier_name: "HEXING ELECTRICAL (HANGZHOU)", eta_confirmed: "2026-10-18",
    duimp_number: "26BR0001964550-4", status: "ENTREGUE" });
  assert.deepEqual({ ...found, id: undefined }, { id: undefined, ipNumber: "024A/2026", registrationTargetDate: "2026-10-14",
    analyst: "Leisiane", importer: "ELETRA MATRIZ", status: "ENTREGUE", supplier: "HEXING ELECTRICAL (HANGZHOU)",
    eta: "2026-10-18", registered: true, estimateBrl: "834389.97" });
  // Without a confirmed ETA, the ETA is calculated from the ETD, as in the other post-shipment screens.
  assert.equal(line({ etd: "2026-09-01" }).eta !== null, true);
  // A status outside the list falls back to the first one of the flow.
  assert.equal(line({ status: "OUTRO" }).status, "AGUARDANDO PRODUÇÃO");
  assert.equal(line({ clearance_analyst: "  " }).analyst, null);
});

test("the table follows the filters, in the order of the date to register (empty last) and the IP", () => {
  const lines = [
    line({ ip_number: "B", registration_target_date: "2026-11-10", clearance_estimate_brl: "100.50",
      clearance_analyst: "João", supplier_name: "NINGBO ZLINK", status: "AGUARDANDO CHEGADA" }),
    line({ ip_number: "A", registration_target_date: "2026-11-10", clearance_estimate_brl: "0.25",
      clearance_analyst: "Nathália", supplier_name: "HEXING", duimp_date: "2026-11-01", importer: "ELETRA CURITIBA" }),
    line({ ip_number: "C", registration_target_date: null, clearance_estimate_brl: "1000" }),
    line({ ip_number: "D", registration_target_date: "2026-11-16", clearance_estimate_brl: "7", status: "ENTREGUE" }),
    line({ ip_number: "E", registration_target_date: "2026-11-08", clearance_estimate_brl: null }),
  ];
  const all = selectClearanceEstimates(lines, {}, today);
  assert.deepEqual(all.lines.map(item => item.ipNumber), ["E", "A", "B", "D", "C"]);
  assert.equal(all.totalBrl, "1107.75");
  assert.deepEqual(all.nextWeek, { from: "2026-11-09", to: "2026-11-15" });
  // The next week is the BI filter: the date to register between Monday and Sunday of the next week.
  const nextWeek = selectClearanceEstimates(lines, { period: "nextWeek" }, today);
  assert.deepEqual(nextWeek.lines.map(item => item.ipNumber), ["A", "B"]);
  assert.equal(nextWeek.totalBrl, "100.75");
  const pick = filters => selectClearanceEstimates(lines, filters, today).lines.map(item => item.ipNumber);
  assert.deepEqual(pick({ registered: ["yes"] }), ["A"]);
  assert.deepEqual(pick({ registered: ["no"] }), ["E", "B", "D", "C"]);
  assert.deepEqual(pick({ registered: ["yes", "no"] }), ["E", "A", "B", "D", "C"]);
  assert.deepEqual(pick({ analysts: ["joão"] }), ["B"]);
  assert.deepEqual(pick({ suppliers: [" hexing "] }), ["A"]);
  assert.deepEqual(pick({ importers: ["ELETRA CURITIBA"] }), ["A"]);
  assert.deepEqual(pick({ status: ["ENTREGUE"] }), ["D"]);
  assert.deepEqual(pick({ ipNumber: "d" }), ["D"]);
  // Nothing to sum gives zero, not an empty total.
  assert.equal(selectClearanceEstimates([], {}, today).totalBrl, "0");
});

test("the options list the analysts, importers and suppliers of the IPs with an estimate, sorted", () => {
  const lines = [line({ clearance_analyst: "Nathália", supplier_name: "NINGBO ZLINK" }),
    line({ clearance_analyst: "João", supplier_name: "HEXING", importer: "ELETRA CURITIBA" }),
    line({ clearance_analyst: "João", supplier_name: null })];
  // The options do not depend on the filters: the screen keeps offering the other values.
  const { options } = selectClearanceEstimates(lines, { analysts: ["Nathália"] }, today);
  assert.deepEqual(options, { analysts: ["João", "Nathália"], importers: ["ELETRA CURITIBA", "ELETRA MATRIZ"],
    suppliers: ["HEXING", "NINGBO ZLINK"] });
});

async function clearanceApp(t) {
  const queries = [];
  const rows = [
    row({ ip_number: "Z-025/2026", registration_target_date: "2026-11-10", clearance_estimate_brl: "502679.69" }),
    row({ ip_number: "024A/2026", registration_target_date: "2026-10-14", clearance_estimate_brl: "834389.97",
      duimp_date: "2026-10-14", status: "ENTREGUE" }),
  ];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("identity.erp_user AS u")) return { rows: [{ role: "Consulta", importer_code: "ELETRA MATRIZ" }] };
      if (sql.includes("clearance_estimate_ip")) return { rows };
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
  await registerClearanceEstimateRoutes(app, pool, () => today);
  return { app, queries };
}

test("the route reads the IPs of the user's importers that have an estimate, and keeps deleted IPs out", async t => {
  const { app, queries } = await clearanceApp(t);
  const response = await app.inject("/api/v1/reports/post-shipment/clearance-estimates?period=nextWeek");
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers["cache-control"], "no-store");
  const { sql, params } = queries.find(query => query.sql.includes("clearance_estimate_ip"));
  assert.deepEqual(params, [["ELETRA MATRIZ"]]);
  assert.match(sql, /p\.record_status <> 'DELETED'/u);
  assert.match(sql, /p\.registration_target_date IS NOT NULL OR p\.clearance_estimate_brl IS NOT NULL/u);
  assert.match(sql, /LEFT JOIN catalog\.entry AS supplier ON supplier\.id = p\.supplier_entry_id/u);
  assert.match(sql, /WHEN p\.record_status = 'CANCELLED' THEN 'CANCELADO'/u);
  assert.match(sql, /WHEN p\.delivery_date IS NOT NULL THEN 'ENTREGUE'/u);
  const body = response.json();
  assert.deepEqual(body.lines.map(item => item.ipNumber), ["Z-025/2026"]);
  assert.equal(body.totalBrl, "502679.69");
  assert.deepEqual(body.nextWeek, { from: "2026-11-09", to: "2026-11-15" });
  const all = (await app.inject("/api/v1/reports/post-shipment/clearance-estimates")).json();
  assert.deepEqual(all.lines.map(item => item.ipNumber), ["024A/2026", "Z-025/2026"]);
  assert.equal(all.totalBrl, "1337069.66");
});

test("the route refuses unknown or invalid parameters", async t => {
  const { app, queries } = await clearanceApp(t);
  for (const query of ["other=1", "period=thisWeek", "registered=maybe", "status=OUTRO", `ipNumber=${"9".repeat(81)}`]) {
    const response = await app.inject(`/api/v1/reports/post-shipment/clearance-estimates?${query}`);
    assert.equal(response.statusCode, 400, query);
    assert.equal(response.json().code, "INVALID_QUERY");
  }
  assert.equal(queries.some(query => query.sql.includes("clearance_estimate_ip")), false);
});

test("the route requires the permission to read IPs", async t => {
  const pool = { async query() { return { rows: [] }; } };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    request.authContext = { issuer: "ci", subject: "nobody", userId: actorId, displayName: null, sessionToken: "ci" };
  });
  await registerClearanceEstimateRoutes(app, pool);
  assert.equal((await app.inject("/api/v1/reports/post-shipment/clearance-estimates")).statusCode, 403);
});

test("the filters built by the web pass the API query schema, and the web lists match the API", async () => {
  const web = await import("../../web/lib/clearance-estimates.ts");
  const filters = { ...web.emptyClearanceFilters, ipNumber: " 024 ", analysts: ["João", "Nathália"], importers: ["FOR"],
    status: ["ENTREGUE"], suppliers: ["HEXING"], registered: ["no"], period: "nextWeek" };
  const params = web.clearanceEstimatesQueryParams(filters);
  const asQuery = Object.fromEntries([...new Set(params.keys())].map(key =>
    [key, params.getAll(key).length > 1 ? params.getAll(key) : params.get(key)]));
  const parsed = clearanceEstimatesQuery.strict().safeParse(asQuery);
  assert.equal(parsed.success, true, JSON.stringify(asQuery));
  assert.deepEqual([parsed.data.ipNumber, parsed.data.analysts, parsed.data.registered, parsed.data.period],
    ["024", ["João", "Nathália"], ["no"], "nextWeek"]);
  assert.equal(web.clearanceEstimatesQueryParams(web.emptyClearanceFilters).toString(), "");
  assert.deepEqual([...web.clearancePeriods], [...CLEARANCE_PERIODS]);
  assert.deepEqual([...web.clearanceRegistered], [...CLEARANCE_REGISTERED]);
  assert.deepEqual([...web.clearanceStatuses], [...POST_SHIPMENT_STATUSES]);
});
