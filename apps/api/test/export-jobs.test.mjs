import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerExportJobRoutes } from "../dist/export-jobs.js";
import { preShipmentQuery } from "../dist/pre-shipment-dashboard.js";
import { shipmentLineQuery } from "../dist/shipment-lines.js";

const actorId = "00000000-0000-4000-8000-000000000001";

async function exportApp(t) {
  const queries = [];
  const client = { async query(sql, params = []) {
    queries.push({ sql, params });
    if (sql.includes("user_active")) return { rows: [{ user_active: 0, total_active: 0 }] };
    return { rows: [], rowCount: 1 };
  }, release() {} };
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("identity.erp_user AS u")) return { rows: [{ role: "Consulta", importer_code: "ELETRA MATRIZ" }] };
      if (sql.includes("FROM jobs.export_job")) {
        return { rows: [{ id: "00000000-0000-4000-8000-000000000051", job_type: "purchase-order-lines-xlsx",
          status: "queued", importer_scopes: ["ELETRA MATRIZ"], requested_as_master: false, error_code: null,
          created_at: new Date("2026-10-23T10:00:00Z"), expires_at: null }] };
      }
      return { rows: [] };
    },
    async connect() { return client; },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    request.authContext = { issuer: "ci", subject: "reader", userId: actorId, displayName: null, sessionToken: "ci" };
  });
  await registerExportJobRoutes(app, pool);
  return { app, queries };
}

test("product line exports are queued with the carteira filters", async t => {
  const { app, queries } = await exportApp(t);
  const invalid = await app.inject({ method: "POST", url: "/api/v1/exports/purchase-order-lines",
    payload: { status: "QUALQUER" } });
  assert.equal(invalid.statusCode, 400, invalid.body);
  const queued = await app.inject({ method: "POST", url: "/api/v1/exports/purchase-order-lines",
    payload: { ipNumber: "IP-1", status: "AGUARDANDO CHEGADA" } });
  assert.equal(queued.statusCode, 202, queued.body);
  const insert = queries.find(query => query.sql.includes("INSERT INTO jobs.export_job"));
  assert.match(insert.sql, /'purchase-order-lines-xlsx'/u);
  // One status is stored as a list of one, the shape the worker parses again.
  assert.deepEqual(JSON.parse(insert.params[4]), { ipNumber: "IP-1", status: ["AGUARDANDO CHEGADA"], situation: "open" });
  // The End to End screen exports the stage it shows; the worker parses the stored filters again.
  const staged = await app.inject({ method: "POST", url: "/api/v1/exports/purchase-order-lines",
    payload: { stage: "T3", view: "reached", late: "true" } });
  assert.equal(staged.statusCode, 202, staged.body);
  const stored = JSON.parse(queries.filter(query => query.sql.includes("INSERT INTO jobs.export_job")).at(-1).params[4]);
  assert.deepEqual(stored, { stage: "T3", view: "reached", late: "true", situation: "open" });
  assert.equal(shipmentLineQuery.safeParse(stored).success, true);
  const badStage = await app.inject({ method: "POST", url: "/api/v1/exports/purchase-order-lines", payload: { stage: "T9" } });
  assert.equal(badStage.statusCode, 400, badStage.body);
});

test("product line exports keep the End to End deadline status filter", async t => {
  const { app, queries } = await exportApp(t);
  const queued = await app.inject({ method: "POST", url: "/api/v1/exports/purchase-order-lines",
    payload: { status: "AGUARDANDO CHEGADA", deadline: "late", delayRange: "upTo30", demandType: "mts", modal: "air" } });
  assert.equal(queued.statusCode, 202, queued.body);
  const stored = JSON.parse(queries.filter(query => query.sql.includes("INSERT INTO jobs.export_job")).at(-1).params[4]);
  assert.deepEqual(stored, { status: ["AGUARDANDO CHEGADA"], deadline: ["late"], delayRange: ["upTo30"], demandType: "mts",
    modal: "air", situation: "open" });
  assert.equal(shipmentLineQuery.safeParse(stored).data.modal, "air");
  assert.deepEqual(shipmentLineQuery.safeParse(stored).data.deadline, ["late"]);
  assert.deepEqual(shipmentLineQuery.safeParse(stored).data.delayRange, ["upTo30"]);
  // The charts can select several categories; the export keeps them all.
  const several = await app.inject({ method: "POST", url: "/api/v1/exports/purchase-order-lines",
    payload: { deadline: ["late", "noData"], delayRange: ["upTo30", "days30To45"] } });
  assert.equal(several.statusCode, 202, several.body);
  assert.deepEqual(JSON.parse(queries.filter(query => query.sql.includes("INSERT INTO jobs.export_job")).at(-1).params[4]),
    { deadline: ["late", "noData"], delayRange: ["upTo30", "days30To45"], situation: "open" });
  const invalid = await app.inject({ method: "POST", url: "/api/v1/exports/purchase-order-lines",
    payload: { deadline: "foo" } });
  assert.equal(invalid.statusCode, 400, invalid.body);
});

test("product line exports keep the group, purpose and necessity filters of the End to End summary", async t => {
  const { app, queries } = await exportApp(t);
  const queued = await app.inject({ method: "POST", url: "/api/v1/exports/purchase-order-lines",
    payload: { group: "Energy", purpose: "Despesa", necessityFrom: "2026-11-01", necessityTo: "2026-11-30" } });
  assert.equal(queued.statusCode, 202, queued.body);
  const stored = JSON.parse(queries.filter(query => query.sql.includes("INSERT INTO jobs.export_job")).at(-1).params[4]);
  assert.deepEqual(stored, { group: ["Energy"], purpose: ["Despesa"], necessityFrom: "2026-11-01", necessityTo: "2026-11-30",
    situation: "open" });
  assert.equal(shipmentLineQuery.strict().safeParse(stored).success, true);
  // The End to End lists go as arrays and are stored for the worker as they came.
  const lists = { status: ["DESEMBARAÇO", "ENTREGUE"], group: ["Energy", "Water"], importers: ["FOR"],
    purchaseOrders: ["PO-9", "PO-10"], ipNumbers: ["IP-1"], productCodes: ["P-2"] };
  const listed = await app.inject({ method: "POST", url: "/api/v1/exports/purchase-order-lines", payload: lists });
  assert.equal(listed.statusCode, 202, listed.body);
  const storedLists = JSON.parse(queries.filter(query => query.sql.includes("INSERT INTO jobs.export_job")).at(-1).params[4]);
  assert.deepEqual(storedLists, { ...lists, situation: "open" });
  assert.deepEqual(shipmentLineQuery.strict().parse(storedLists), { ...lists, situation: "open" });
  const invalid = await app.inject({ method: "POST", url: "/api/v1/exports/purchase-order-lines",
    payload: { necessityFrom: "01/11/2026" } });
  assert.equal(invalid.statusCode, 400, invalid.body);
});

test("recent exports list the PO, product line and pre-shipment exports with their type", async t => {
  const { app, queries } = await exportApp(t);
  const response = await app.inject({ method: "GET", url: "/api/v1/exports" });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().items[0].jobType, "purchase-order-lines-xlsx");
  const list = queries.find(query => query.sql.includes("FROM jobs.export_job"));
  assert.match(list.sql, /job_type IN \('purchase-order-xlsx', 'purchase-order-lines-xlsx', 'pre-shipment-xlsx', 'post-shipment-xlsx'\)/u);
});

test("exports store the chosen screen columns with their context and reject invalid choices", async t => {
  const { app, queries } = await exportApp(t);
  const stored = () => JSON.parse(queries.filter(query => query.sql.includes("INSERT INTO jobs.export_job")).at(-1).params[4]);
  const post = (url, payload) => app.inject({ method: "POST", url, payload });

  const portfolio = await post("/api/v1/exports/purchase-orders", { number: "18751", lifecycle: "closed",
    context: "portfolio", columns: [{ key: "importer", header: "Importer" }] });
  assert.equal(portfolio.statusCode, 202, portfolio.body);
  assert.deepEqual(stored(), { number: "18751", lifecycle: "closed", context: "portfolio",
    columns: [{ key: "importer", header: "Importer" }] });

  const e2e = await post("/api/v1/exports/purchase-order-lines", { stage: "T3", view: "reached", context: "end-to-end",
    columns: [{ key: "accumulatedDelay", header: "Acumulado até T3" }, { key: "t3Delay", header: "T3 Atraso" }] });
  assert.equal(e2e.statusCode, 202, e2e.body);
  assert.deepEqual(stored().columns.map(column => column.key), ["accumulatedDelay", "t3Delay"]);
  assert.equal(stored().context, "end-to-end");
  // The worker parses the stored filters without the columns.
  const { context, columns, ...filters } = stored();
  assert.equal(shipmentLineQuery.strict().safeParse(filters).success, true, JSON.stringify({ context, columns }));

  const invalid = [
    ["/api/v1/exports/purchase-orders", { context: "portfolio", columns: [] }],
    ["/api/v1/exports/purchase-orders", { context: "portfolio", columns: [{ key: "eta", header: "ETA" }] }],
    ["/api/v1/exports/purchase-orders", { context: "end-to-end", columns: [{ key: "importer", header: "I" }] }],
    ["/api/v1/exports/purchase-orders", { columns: [{ key: "importer", header: "I" }] }],
    ["/api/v1/exports/purchase-orders", { context: "portfolio", columns: [{ key: "importer", header: "" }] }],
    ["/api/v1/exports/purchase-orders", { context: "portfolio", columns: [{ key: "importer", header: "x".repeat(81) }] }],
    ["/api/v1/exports/purchase-orders", { context: "portfolio", columns: [{ key: "importer", header: "a\u0007b" }] }],
    ["/api/v1/exports/purchase-orders", { lifecycle: "archived" }],
    ["/api/v1/exports/purchase-order-lines", { context: "portfolio", columns: [{ key: "importer", header: "I" }] }],
    ["/api/v1/exports/purchase-order-lines", { context: "product-lines", columns: [{ key: "t0Deadline", header: "T0" }] }],
    ["/api/v1/exports/purchase-order-lines", { context: "end-to-end",
      columns: Array.from({ length: 49 }, () => ({ key: "status", header: "Status" })) }],
  ];
  for (const [url, payload] of invalid) {
    const response = await post(url, payload);
    assert.equal(response.statusCode, 400, `${url} ${JSON.stringify(payload).slice(0, 120)}: ${response.body}`);
  }
  const legacy = await post("/api/v1/exports/purchase-orders", { number: "18751" });
  assert.equal(legacy.statusCode, 202, legacy.body);
  assert.deepEqual(stored(), { number: "18751" });
});

test("the worker types the failure status once, so a failed job does not crash it", async () => {
  const { readFile } = await import("node:fs/promises");
  const worker = await readFile(new URL("../src/worker.ts", import.meta.url), "utf8");
  const failJob = worker.slice(worker.indexOf("async function failJob"), worker.indexOf("async function processJob"));
  // `status` is varchar and the CASE compares with text: an untyped $3 fails with 42P08.
  assert.match(failJob, /SET status = \$3::text,/u);
  assert.match(failJob, /CASE WHEN \$3::text = 'queued'/u);
  assert.match(failJob, /CASE WHEN \$3::text = 'failed'/u);
});

test("pre-shipment exports store the dashboard filters, chart selections and columns for the worker", async t => {
  const { app, queries } = await exportApp(t);
  const post = payload => app.inject({ method: "POST", url: "/api/v1/exports/pre-shipment", payload });
  const stored = () => JSON.parse(queries.filter(query => query.sql.includes("INSERT INTO jobs.export_job")).at(-1).params[4]);
  const queued = await post({ status: ["AGUARDANDO PRODUÇÃO"], aging: ["days120Plus"], direct: "direct", demand: ["MRP"],
    productDescription: "antena", context: "pre-shipment",
    columns: [{ key: "eta", header: "ETA" }, { key: "supplier", header: "Supplier" }] });
  assert.equal(queued.statusCode, 202, queued.body);
  const insert = queries.filter(query => query.sql.includes("INSERT INTO jobs.export_job")).at(-1);
  assert.match(insert.sql, /'pre-shipment-xlsx'/u);
  const { context, columns, ...filters } = stored();
  assert.equal(context, "pre-shipment");
  assert.deepEqual(columns.map(column => column.key), ["eta", "supplier"]);
  // The worker parses the stored filters again with the dashboard schema.
  assert.deepEqual(preShipmentQuery.strict().parse(filters), { status: ["AGUARDANDO PRODUÇÃO"], aging: ["days120Plus"],
    direct: "direct", demand: ["MRP"], productDescription: "antena" });
  for (const payload of [
    { aging: ["days200"] }, { situation: "all" },
    { context: "end-to-end", columns: [{ key: "eta", header: "ETA" }] },
    { context: "pre-shipment", columns: [{ key: "t0Deadline", header: "T0" }] },
    { context: "pre-shipment", columns: [] },
  ]) {
    const response = await post(payload);
    assert.equal(response.statusCode, 400, `${JSON.stringify(payload)}: ${response.body}`);
  }
});

test("the worker writes the pre-shipment export from the dashboard table query", async () => {
  const { readFile } = await import("node:fs/promises");
  const worker = await readFile(new URL("../src/worker.ts", import.meta.url), "utf8");
  const branch = worker.slice(worker.indexOf('job.job_type === "pre-shipment-xlsx"'), worker.indexOf('job.job_type !== "purchase-order-xlsx"'));
  assert.match(branch, /preShipmentQuery\.safeParse\(parameters\)/u);
  assert.match(branch, /queryPreShipmentLines\(pool, job\.importer_scopes, filters\.data, maxExportLines \+ 1, 0\)/u);
  assert.match(branch, /preShipmentXlsx\(result\.lines, chosen, \{ filters: filters\.data, today: todayInBrasilia\(\) \}\)/u);
});

test("the pre-shipment export body built by the web is accepted by the route", async t => {
  const { app } = await exportApp(t);
  const { emptyPreShipmentFilters, preShipmentFilterBody } = await import("../../web/lib/pre-shipment-dashboard.ts");
  const { columnsBody } = await import("../../web/lib/export-columns.ts");
  const { ptBR } = await import("../../web/lib/i18n/pt-BR.ts");
  const filters = { ...emptyPreShipmentFilters, status: ["CANCELADO"], aging: ["days45To60"], direct: "notDirect",
    supplier: ["Hexing"], productCode: "3090", necessityFrom: "2026-02-01", necessityTo: "2026-02-28" };
  const allKeys = ["necessity", "mode", "status", "requester", "scNumber", "ipNumber", "etd", "eta", "ete", "description",
    "quantity", "supplier", "importer", "purpose", "poSentDate"];
  const response = await app.inject({ method: "POST", url: "/api/v1/exports/pre-shipment",
    payload: { ...preShipmentFilterBody(filters), ...columnsBody("pre-shipment", allKeys, ptBR, {}) } });
  assert.equal(response.statusCode, 202, response.body);
});

test("post-shipment exports store the dashboard filters, chart selections and columns for the worker", async t => {
  const { app, queries } = await exportApp(t);
  const { postShipmentQuery } = await import("../dist/post-shipment-dashboard.js");
  const post = payload => app.inject({ method: "POST", url: "/api/v1/exports/post-shipment", payload });
  const stored = () => JSON.parse(queries.filter(query => query.sql.includes("INSERT INTO jobs.export_job")).at(-1).params[4]);
  const queued = await post({ status: ["ENTREGUE"], channel: ["green"], priority: ["priority"], clearance: ["onWater"],
    modes: ["SEA"], ipNumber: "015", dateFrom: "2026-01-01", dateTo: "2026-01-31", context: "post-shipment",
    columns: [{ key: "ltDoc", header: "LT Doc" }, { key: "slaTxt", header: "SLA TXT" }] });
  assert.equal(queued.statusCode, 202, queued.body);
  const insert = queries.filter(query => query.sql.includes("INSERT INTO jobs.export_job")).at(-1);
  assert.match(insert.sql, /'post-shipment-xlsx'/u);
  const { context, columns, ...filters } = stored();
  assert.equal(context, "post-shipment");
  assert.deepEqual(columns.map(column => column.key), ["ltDoc", "slaTxt"]);
  // The worker parses the stored filters again with the dashboard schema.
  assert.deepEqual(postShipmentQuery.strict().parse(filters), { status: ["ENTREGUE"], channel: ["green"],
    priority: ["priority"], clearance: ["onWater"], modes: ["SEA"], ipNumber: "015", dateFrom: "2026-01-01",
    dateTo: "2026-01-31" });
  for (const payload of [
    { channel: ["blue"] }, { aging: ["days120Plus"] },
    { context: "pre-shipment", columns: [{ key: "ltDoc", header: "LT Doc" }] },
    { context: "post-shipment", columns: [{ key: "poNumber", header: "PO" }] },
    { context: "post-shipment", columns: [] },
  ]) {
    const response = await post(payload);
    assert.equal(response.statusCode, 400, `${JSON.stringify(payload)}: ${response.body}`);
  }
});

test("the worker writes the post-shipment export from the dashboard table and the download names it", async () => {
  const { readFile } = await import("node:fs/promises");
  const worker = await readFile(new URL("../src/worker.ts", import.meta.url), "utf8");
  const branch = worker.slice(worker.indexOf('job.job_type === "post-shipment-xlsx"'), worker.indexOf('job.job_type !== "purchase-order-xlsx"'));
  assert.match(branch, /postShipmentQuery\.safeParse\(parameters\)/u);
  assert.match(branch, /queryPostShipmentLines\(pool, job\.importer_scopes, filters\.data, maxExportLines \+ 1, 0\)/u);
  assert.match(branch, /postShipmentXlsx\(result\.lines, chosen\)/u);
  const routes = await readFile(new URL("../src/export-jobs.ts", import.meta.url), "utf8");
  assert.match(routes, /"post-shipment-xlsx": "pos-embarque\.xlsx"/u);
  // The post-shipment dashboard reads IPs: its export asks for the same permission.
  assert.match(routes, /\["\/api\/v1\/exports\/post-shipment", "post-shipment-xlsx", postShipmentExportBody, "processes\.read"\]/u);
});

test("the post-shipment export writes the chosen columns of the table in the Pós Embarque sheet", async () => {
  const ExcelJS = (await import("exceljs")).default;
  const { postShipmentXlsx } = await import("../dist/purchase-order-exports.js");
  const { resolveExportColumns } = await import("../dist/export-columns.js");
  const columns = resolveExportColumns("post-shipment", [{ key: "status", header: "Status" },
    { key: "ltClearance", header: "LT Clearance" }], {});
  const lines = [{ ipNumber: "061E/2025", status: "ENTREGUE", leadTime: 37 },
    { ipNumber: "015B/2026", status: "DESEMBARAÇO", leadTime: null }];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await postShipmentXlsx(lines, columns));
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ["Pós Embarque"]);
  const rows = [];
  workbook.getWorksheet("Pós Embarque").eachRow(row => rows.push(row.values.slice(1).map(cell => cell ?? null)));
  assert.deepEqual(rows, [["IP", "Status", "LT Clearance"], ["061E/2025", "ENTREGUE", 37], ["015B/2026", "DESEMBARAÇO"]]);
});

test("the post-shipment export colors LT Doc, LT Clearance and priority as the table badges", async () => {
  const ExcelJS = (await import("exceljs")).default;
  const { readFile } = await import("node:fs/promises");
  const { exportToneColors, postShipmentXlsx } = await import("../dist/purchase-order-exports.js");
  const { resolveExportColumns } = await import("../dist/export-columns.js");
  // The light theme of the screen badges (apps/web/app/styles/tokens.css), the colors of a printed sheet.
  const tokens = await readFile(new URL("../../web/app/styles/tokens.css", import.meta.url), "utf8");
  const light = tokens.slice(tokens.indexOf(":root {"), tokens.indexOf(':root[data-theme="dark"]'));
  const token = name => `FF${new RegExp(`${name}:\\s*#([0-9a-f]{6})`, "u").exec(light)[1].toUpperCase()}`;
  for (const [tone, name] of [["good", "success"], ["bad", "danger"], ["warning", "warning"]]) {
    assert.deepEqual(exportToneColors[tone], { fill: token(`--color-${name}-bg`), font: token(`--color-${name}-text`) }, tone);
  }
  const columns = resolveExportColumns("post-shipment", [{ key: "priority", header: "Prioridade" },
    { key: "ltDoc", header: "LT Doc" }, { key: "ltClearance", header: "LT Clearance" }, { key: "slaTxt", header: "SLA TXT" }], {});
  const lines = [
    { ipNumber: "A", priority: "Prioridade", priorityKey: "priority", ltDoc: 2, ltDocOnTarget: true, leadTime: 7, slaTxt: 5 },
    { ipNumber: "B", priority: null, priorityKey: "normal", ltDoc: 8, ltDocOnTarget: false, leadTime: 8, slaTxt: 40 },
    // A courier has no LT Doc target, and without an arrival there is no LT Clearance: no color.
    { ipNumber: "C", priority: null, priorityKey: "normal", ltDoc: 20, ltDocOnTarget: null, leadTime: null, slaTxt: null },
  ];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await postShipmentXlsx(lines, columns));
  const sheet = workbook.getWorksheet("Pós Embarque");
  const fill = (row, column) => sheet.getRow(row).getCell(column).fill?.fgColor?.argb ?? null;
  const font = (row, column) => sheet.getRow(row).getCell(column).font?.color?.argb ?? null;
  // Columns: IP, Prioridade, LT Doc, LT Clearance, SLA TXT.
  assert.deepEqual([2, 3, 4].map(row => [fill(row, 2), fill(row, 3), fill(row, 4), fill(row, 5)]), [
    [exportToneColors.warning.fill, exportToneColors.good.fill, exportToneColors.good.fill, null],
    [null, exportToneColors.bad.fill, exportToneColors.bad.fill, null],
    [null, null, null, null],
  ]);
  assert.deepEqual([font(2, 3), font(3, 4)], [exportToneColors.good.font, exportToneColors.bad.font]);
});

test("the post-shipment export body built by the web is accepted by the route", async t => {
  const { app } = await exportApp(t);
  const { emptyPostShipmentFilters, postShipmentFilterBody } = await import("../../web/lib/post-shipment-dashboard.ts");
  const { columnsBody, choosableColumns } = await import("../../web/lib/export-columns.ts");
  const { ptBR } = await import("../../web/lib/i18n/pt-BR.ts");
  const filters = { ...emptyPostShipmentFilters, status: ["DESEMBARAÇO"], channel: ["none"], priority: ["normal"],
    clearance: ["onWater"], importers: ["FOR"], modes: ["AIR"], ipNumber: "Nh", dateFrom: "2026-01-01", dateTo: "2026-03-31",
    datePeriod: "quarter:0:0" };
  const allKeys = choosableColumns("post-shipment", {}).map(column => column.key);
  const response = await app.inject({ method: "POST", url: "/api/v1/exports/post-shipment",
    payload: { ...postShipmentFilterBody(filters), ...columnsBody("post-shipment", allKeys, ptBR, {}) } });
  assert.equal(response.statusCode, 202, response.body);
});
