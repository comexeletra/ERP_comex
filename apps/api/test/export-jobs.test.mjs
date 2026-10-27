import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerExportJobRoutes } from "../dist/export-jobs.js";
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
  assert.deepEqual(JSON.parse(insert.params[4]), { ipNumber: "IP-1", status: "AGUARDANDO CHEGADA", situation: "open" });
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
  assert.deepEqual(stored, { status: "AGUARDANDO CHEGADA", deadline: "late", delayRange: "upTo30", demandType: "mts",
    modal: "air", situation: "open" });
  assert.equal(shipmentLineQuery.safeParse(stored).data.modal, "air");
  assert.equal(shipmentLineQuery.safeParse(stored).data.deadline, "late");
  assert.equal(shipmentLineQuery.safeParse(stored).data.delayRange, "upTo30");
  const invalid = await app.inject({ method: "POST", url: "/api/v1/exports/purchase-order-lines",
    payload: { deadline: "foo" } });
  assert.equal(invalid.statusCode, 400, invalid.body);
});

test("recent exports list both PO and product line exports with their type", async t => {
  const { app, queries } = await exportApp(t);
  const response = await app.inject({ method: "GET", url: "/api/v1/exports" });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().items[0].jobType, "purchase-order-lines-xlsx");
  const list = queries.find(query => query.sql.includes("FROM jobs.export_job"));
  assert.match(list.sql, /job_type IN \('purchase-order-xlsx', 'purchase-order-lines-xlsx'\)/u);
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
