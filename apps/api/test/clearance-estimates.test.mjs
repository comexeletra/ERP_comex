import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { CLEARANCE_PERIODS, CLEARANCE_REGISTERED, clearanceEstimateLine, clearanceEstimatesQuery, isRegistered,
  nextWeekRange, referenceDate, registerClearanceEstimateRoutes, selectClearanceEstimates } from "../dist/clearance-estimates.js";
import { processFollowupFieldKeys } from "../dist/followup.js";
import { POST_SHIPMENT_STATUSES } from "../dist/post-shipment-dashboard.js";

const actorId = "00000000-0000-4000-8000-000000000001";
const today = "2026-11-06";
let sequence = 0;
/** A row of the clearance query, as PostgreSQL returns it (dates and money as text). */
const row = overrides => ({ id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  ip_number: `IP-${sequence}`, importer: "ELETRA MATRIZ", analysts: null, clearance_estimate_brl: null,
  taxes_paid_brl: null, supplier_name: null,
  transport_mode: "SEA", etd: null, eta_confirmed: null, ete_confirmed: null, duimp_number: null, duimp_date: null,
  status: "AGUARDANDO CHEGADA", ...overrides });
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

test("the reference date is the DUIMP date of a registered IP and, before the DUIMP, the ETA at the port", () => {
  assert.deepEqual(referenceDate("2026-10-14", "2026-10-18"), { date: "2026-10-14", source: "duimp" });
  assert.deepEqual(referenceDate(null, "2026-11-10"), { date: "2026-11-10", source: "eta" });
  assert.deepEqual(referenceDate(null, null), { date: null, source: null });
});

test("each line keeps the post-shipment data of the IP: taxes, analysts of the POs, supplier, ETA and DUIMP", () => {
  const found = line({ ip_number: "Z-021A/2026", analysts: ["GABRIELA", " ", "EVELINE"], taxes_paid_brl: "3833400.68",
    supplier_name: "ZLINK", eta_confirmed: "2026-10-18", duimp_number: "26BR0001993032-2", duimp_date: "2026-10-15",
    status: "DESEMBARAÇO" });
  assert.deepEqual({ ...found, id: undefined }, { id: undefined, ipNumber: "Z-021A/2026", referenceDate: "2026-10-15",
    referenceSource: "duimp", analysts: ["EVELINE", "GABRIELA"], importer: "ELETRA MATRIZ", status: "DESEMBARAÇO",
    supplier: "ZLINK", eta: "2026-10-18", registered: true, valueBrl: "3833400.68", valueSource: "paid" });
  // Without a DUIMP, the ETA; without a confirmed ETA, the ETA calculated from the ETD (SEA: ETD + 55 days).
  const waiting = line({ etd: "2026-09-16" });
  assert.deepEqual([waiting.referenceDate, waiting.referenceSource, waiting.registered], ["2026-11-10", "eta", false]);
  assert.equal(line({ status: "OUTRO" }).status, "AGUARDANDO PRODUÇÃO");
});

test("the amount is the estimate typed on the IP and, without it, the taxes paid, with where it came from", () => {
  const estimated = line({ clearance_estimate_brl: "1500000.00", taxes_paid_brl: "1480000.00" });
  assert.deepEqual([estimated.valueBrl, estimated.valueSource], ["1500000.00", "estimated"]);
  const paid = line({ taxes_paid_brl: "11007.81" });
  assert.deepEqual([paid.valueBrl, paid.valueSource], ["11007.81", "paid"]);
  const none = line({});
  assert.deepEqual([none.valueBrl, none.valueSource], [null, null]);
  // An IP waiting for the registration with only the estimate is in the section and in the total.
  const lines = [line({ ip_number: "026A/2026", eta_confirmed: "2026-11-10", clearance_estimate_brl: "1500000.00" }),
    line({ ip_number: "033/2026", duimp_date: "2026-11-11", taxes_paid_brl: "11007.81" })];
  const nextWeek = selectClearanceEstimates(lines, { period: "nextWeek" }, today);
  assert.deepEqual(nextWeek.lines.map(item => [item.ipNumber, item.valueSource]), [["026A/2026", "estimated"], ["033/2026", "paid"]]);
  assert.equal(nextWeek.totalBrl, "1511007.81");
});

test("the table follows the filters, in the order of the reference date (empty last) and the IP", () => {
  const lines = [
    line({ ip_number: "B", eta_confirmed: "2026-11-10", taxes_paid_brl: "100.50", analysts: ["JOÃO"],
      supplier_name: "NINGBO ZLINK" }),
    line({ ip_number: "A", duimp_date: "2026-11-10", eta_confirmed: "2026-11-20", taxes_paid_brl: "0.25",
      analysts: ["Nathália", "JUNIOR"], supplier_name: "HEXING", importer: "ELETRA CURITIBA" }),
    line({ ip_number: "C", taxes_paid_brl: "1000" }),
    line({ ip_number: "D", eta_confirmed: "2026-11-16", taxes_paid_brl: "7", status: "ENTREGUE" }),
    line({ ip_number: "E", duimp_date: "2026-11-08" }),
    // Without a date nor an amount the IP is out of the section.
    line({ ip_number: "F", transport_mode: null }),
  ];
  const all = selectClearanceEstimates(lines, {}, today);
  assert.deepEqual(all.lines.map(item => item.ipNumber), ["E", "A", "B", "D", "C"]);
  assert.equal(all.totalBrl, "1107.75");
  assert.deepEqual(all.nextWeek, { from: "2026-11-09", to: "2026-11-15" });
  // The next week: the DUIMP date, or the ETA before the DUIMP, between Monday and Sunday of the next week.
  const nextWeek = selectClearanceEstimates(lines, { period: "nextWeek" }, today);
  assert.deepEqual(nextWeek.lines.map(item => item.ipNumber), ["A", "B"]);
  assert.equal(nextWeek.totalBrl, "100.75");
  const pick = filters => selectClearanceEstimates(lines, filters, today).lines.map(item => item.ipNumber);
  assert.deepEqual(pick({ registered: ["yes"] }), ["E", "A"]);
  assert.deepEqual(pick({ registered: ["no"] }), ["B", "D", "C"]);
  assert.deepEqual(pick({ registered: ["yes", "no"] }), ["E", "A", "B", "D", "C"]);
  // An IP with several PO analysts matches any of them.
  assert.deepEqual(pick({ analysts: ["junior"] }), ["A"]);
  assert.deepEqual(pick({ analysts: ["João", "Nathália"] }), ["A", "B"]);
  assert.deepEqual(pick({ suppliers: [" hexing "] }), ["A"]);
  assert.deepEqual(pick({ importers: ["ELETRA CURITIBA"] }), ["A"]);
  assert.deepEqual(pick({ status: ["ENTREGUE"] }), ["D"]);
  assert.deepEqual(pick({ ipNumber: "d" }), ["D"]);
  assert.equal(selectClearanceEstimates([], {}, today).totalBrl, "0");
});

test("the options list the analysts, importers and suppliers of the IPs of the section, sorted", () => {
  const lines = [line({ analysts: ["Nathália"], supplier_name: "NINGBO ZLINK", taxes_paid_brl: "1" }),
    line({ analysts: ["JOÃO", "Nathália"], supplier_name: "HEXING", importer: "ELETRA CURITIBA", taxes_paid_brl: "1" }),
    line({ analysts: ["IGNORADO"], supplier_name: "FORA" })];
  // The options do not depend on the filters, and IPs out of the section do not add options.
  const { options } = selectClearanceEstimates(lines, { analysts: ["Nathália"] }, today);
  assert.deepEqual(options, { analysts: ["JOÃO", "Nathália"], importers: ["ELETRA CURITIBA", "ELETRA MATRIZ"],
    suppliers: ["HEXING", "NINGBO ZLINK"] });
});

async function clearanceApp(t) {
  const queries = [];
  const rows = [
    row({ ip_number: "Z-025/2026", eta_confirmed: "2026-11-10", taxes_paid_brl: "502679.69" }),
    row({ ip_number: "024A/2026", duimp_date: "2026-10-14", eta_confirmed: "2026-10-18", taxes_paid_brl: "834389.97",
      status: "ENTREGUE" }),
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

test("the route reads the post-shipment data of the user's IPs, and keeps deleted IPs out", async t => {
  const { app, queries } = await clearanceApp(t);
  const response = await app.inject("/api/v1/reports/post-shipment/clearance-estimates?period=nextWeek");
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers["cache-control"], "no-store");
  const { sql, params } = queries.find(query => query.sql.includes("clearance_estimate_ip"));
  assert.deepEqual(params, [["ELETRA MATRIZ"]]);
  assert.match(sql, /p\.record_status <> 'DELETED'/u);
  assert.match(sql, /p\.taxes_paid_brl::text AS taxes_paid_brl/u);
  // The analysts are those of the POs allocated to the IP.
  assert.match(sql, /array_agg\(DISTINCT po\.analyst\)/u);
  assert.match(sql, /a\.status = 'ACTIVE'/u);
  assert.match(sql, /LEFT JOIN catalog\.entry AS supplier ON supplier\.id = p\.supplier_entry_id/u);
  assert.match(sql, /WHEN p\.record_status = 'CANCELLED' THEN 'CANCELADO'/u);
  assert.match(sql, /WHEN p\.delivery_date IS NOT NULL THEN 'ENTREGUE'/u);
  // The estimate typed on the IP (M080); the other removed fields of M078 are not read.
  assert.match(sql, /p\.clearance_estimate_brl::text AS clearance_estimate_brl/u);
  assert.doesNotMatch(sql, /clearance_analyst|registration_target_date/u);
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

test("M080 adds only the clearance estimate of the IP, and the IP form accepts it", async () => {
  const sql = (await readFile(new URL("../migrations/M080_ip_clearance_estimate_value.sql", import.meta.url), "utf8"))
    .replace(/--.*$/gmu, "");
  assert.match(sql, /ADD COLUMN clearance_estimate_brl numeric\(18,2\)/u);
  assert.match(sql, /clearance_estimate_brl IS NULL OR clearance_estimate_brl >= 0/u);
  for (const role of ["import_erp_app", "import_erp_hml_app"]) assert.match(sql, new RegExp(`TO ${role};`, "u"));
  assert.doesNotMatch(sql, /clearance_analyst|registration_target_date/u);
  assert.doesNotMatch(sql, /\bUPDATE imports|\bDELETE\b|INSERT INTO|DROP COLUMN|ALTER COLUMN/u);
  assert.equal(processFollowupFieldKeys.includes("clearanceEstimateBrl"), true);
});

test("M079 removes the empty clearance fields of M078, and the IP form no longer accepts them", async () => {
  const sql = (await readFile(new URL("../migrations/M079_drop_ip_clearance_estimate.sql", import.meta.url), "utf8"))
    .replace(/--.*$/gmu, "");
  for (const column of ["clearance_analyst", "registration_target_date", "clearance_estimate_brl"]) {
    assert.match(sql, new RegExp(`DROP COLUMN ${column}`, "u"));
    assert.match(sql, new RegExp(`${column} IS NOT NULL`, "u"));
  }
  assert.match(sql, /RAISE EXCEPTION/u);
  assert.doesNotMatch(sql, /\bUPDATE\b|\bDELETE\b|INSERT INTO/u);
  // The estimate came back alone in M080; the planned date and the clearance analyst stay out.
  for (const key of ["clearanceAnalyst", "registrationTargetDate"]) {
    assert.equal(processFollowupFieldKeys.includes(key), false, key);
  }
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
