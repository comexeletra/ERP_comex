import assert from "node:assert/strict";
import Fastify from "fastify";
import pg from "pg";
import { registerSourceAuditRoutes } from "../dist/source-audit.js";

const databaseUrl = process.env.DATABASE_URL;
if (process.env.MIGRATION_ENV !== "isolated" || !databaseUrl) {
  throw new Error("Set MIGRATION_ENV=isolated and DATABASE_URL to a disposable integration database.");
}
const database = new URL(databaseUrl);
const databaseName = decodeURIComponent(database.pathname.slice(1));
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(database.hostname)
  || !/(?:_ci|_test)$/iu.test(databaseName)) {
  throw new Error("Refusing reports integration check outside a local *_ci or *_test database.");
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const app = Fastify();
app.decorateRequest("authorizationContext", null);
app.addHook("preHandler", async request => {
  const result = await pool.query(`
    SELECT importer FROM procurement.purchase_order
    UNION SELECT importer FROM imports.import_process WHERE importer IS NOT NULL
  `);
  request.authorizationContext = { importerScopes: result.rows.map(row => row.importer) };
});
await registerSourceAuditRoutes(app, pool);

try {
  const response = await app.inject({ method: "GET", url: "/api/v1/reports/summary" });
  assert.equal(response.statusCode, 200, response.body);
  const result = response.json();
  const scopes = await pool.query(`
    SELECT importer FROM procurement.purchase_order
    UNION SELECT importer FROM imports.import_process WHERE importer IS NOT NULL
  `);
  const importers = scopes.rows.map(row => row.importer);
  const [pre, post] = await Promise.all([
    pool.query(`
      WITH scoped_po AS (
        SELECT * FROM procurement.purchase_order WHERE importer = ANY($1::text[])
      ), items AS (
        SELECT item.*, po.importer FROM procurement.purchase_order_item item
        JOIN scoped_po po ON po.id = item.purchase_order_id
      )
      SELECT (SELECT count(*)::int FROM scoped_po) AS "totalRecords",
        (SELECT count(*)::int FROM scoped_po WHERE source_kind = 'HISTORICAL_EXCEL') AS "historicalRecords",
        (SELECT count(*)::int FROM scoped_po WHERE source_kind <> 'HISTORICAL_EXCEL') AS "newRecords",
        (SELECT count(*)::int FROM items) AS "operationalItems",
        (SELECT count(*)::int FROM items item WHERE EXISTS (
          SELECT 1 FROM procurement.po_item_allocation allocation
          WHERE allocation.purchase_order_item_id = item.id AND allocation.status = 'ACTIVE'
        ) OR EXISTS (
          SELECT 1 FROM procurement.po_line_observation observation
          JOIN imports.import_process process
            ON process.normalized_ip_number = upper(btrim(observation.source_ip_text))
           AND process.importer = item.importer
          WHERE observation.source_row_id = item.source_observation_id
            AND NULLIF(btrim(observation.source_ip_text), '') IS NOT NULL
            AND upper(btrim(observation.source_ip_text)) NOT IN ('CANCELLED', 'CANCELED')
            AND left(btrim(observation.source_ip_text), 1) <> '#'
        )) AS "allocatedItems",
        (SELECT count(*)::int FROM items item
         WHERE upper(coalesce(item.source_status, '')) NOT IN ('CANCELLED', 'CANCELED')
           AND NOT EXISTS (SELECT 1 FROM procurement.po_item_allocation allocation
             WHERE allocation.purchase_order_item_id = item.id AND allocation.status = 'ACTIVE')
           AND NOT EXISTS (
             SELECT 1 FROM procurement.po_line_observation observation
             JOIN imports.import_process process
               ON process.normalized_ip_number = upper(btrim(observation.source_ip_text))
              AND process.importer = item.importer
             WHERE observation.source_row_id = item.source_observation_id
               AND NULLIF(btrim(observation.source_ip_text), '') IS NOT NULL
               AND upper(btrim(observation.source_ip_text)) NOT IN ('CANCELLED', 'CANCELED')
               AND left(btrim(observation.source_ip_text), 1) <> '#'
           )) AS "unallocatedItems",
        (SELECT coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', status_count)
          ORDER BY status_count DESC, status), '[]'::jsonb)
         FROM (SELECT coalesce(identity_status, 'Sem status') AS status, count(*)::int AS status_count
               FROM scoped_po GROUP BY 1) counts) AS statuses
    `, [importers]),
    pool.query(`
      WITH scoped_ip AS (
        SELECT * FROM imports.import_process WHERE importer = ANY($1::text[])
      )
      SELECT count(*)::int AS "totalRecords",
        count(*) FILTER (WHERE source_kind = 'HISTORICAL_EXCEL')::int AS "historicalRecords",
        count(*) FILTER (WHERE source_kind <> 'HISTORICAL_EXCEL')::int AS "newRecords",
        count(*) FILTER (WHERE lifecycle_status = 'OPEN')::int AS "openRecords",
        count(*) FILTER (WHERE arrival_date IS NOT NULL)::int AS "rowsWithArrival",
        count(*) FILTER (WHERE duimp_number IS NOT NULL)::int AS "rowsWithDuimp",
        count(*) FILTER (WHERE delivery_date IS NOT NULL)::int AS "rowsWithDelivery",
        count(*) FILTER (WHERE coalesce(fine_brl, 0) > 0 OR coalesce(storage_brl, 0) > 0
          OR coalesce(demurrage_brl, 0) > 0)::int AS "rowsWithAdditionalCosts",
        coalesce((SELECT jsonb_agg(jsonb_build_object('status', status, 'count', status_count)
          ORDER BY status_count DESC, status)
          FROM (SELECT coalesce(nullif(btrim(logistics_status), ''), 'Sem status') AS status,
                       count(*)::int AS status_count FROM scoped_ip GROUP BY 1) counts), '[]'::jsonb) AS statuses
      FROM scoped_ip
    `, [importers]),
  ]);
  assert.deepEqual(result, {
    preShipment: pre.rows[0],
    postShipment: post.rows[0],
  }, "Every dashboard metric and status bucket must match records currently in PostgreSQL.");
  assert.deepEqual((await app.inject({ method: "GET", url: "/api/v1/reports/summary?scope=pre" })).json(), {
    preShipment: result.preShipment,
  });
  assert.deepEqual((await app.inject({ method: "GET", url: "/api/v1/reports/summary?scope=post" })).json(), {
    postShipment: result.postShipment,
  });
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/reports/summary?scope=invalid" })).statusCode, 400);
  for (const metrics of [result.preShipment, result.postShipment]) {
    for (const value of Object.values(metrics).filter(value => typeof value === "number")) {
      assert.ok(Number.isSafeInteger(value) && value >= 0);
    }
  }
  console.log("Pre/Post dashboards match PostgreSQL counts, metrics, status buckets, and scope selection.");
} finally {
  await app.close();
  await pool.end();
}
