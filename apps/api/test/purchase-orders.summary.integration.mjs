import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import pg from "pg";
import { registerAuthorization } from "../dist/authorization.js";
import { registerPurchaseOrderReadRoutes } from "../dist/purchase-orders.js";

const databaseUrl = process.env.DATABASE_URL;
if (process.env.MIGRATION_ENV !== "isolated" || !databaseUrl) {
  throw new Error("Set MIGRATION_ENV=isolated and DATABASE_URL to a disposable integration database.");
}
const database = new URL(databaseUrl);
const databaseName = decodeURIComponent(database.pathname.slice(1));
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(database.hostname)
  || !/(?:_ci|_test)$/iu.test(databaseName)) {
  throw new Error("Refusing integration test outside a local *_ci or *_test database.");
}

const importer = "CI Portfolio Importer";
const identity = { issuer: "issuer:portfolio-summary-ci", subject: randomUUID() };
const userId = randomUUID();
const batchId = randomUUID();
const purchaseOrders = [randomUUID(), randomUUID(), randomUUID()];
const processes = [randomUUID(), randomUUID(), randomUUID()];
const sourceRows = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const observations = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });
const client = await pool.connect();
const app = Fastify();
let fixturesCommitted = false;

app.decorateRequest("authContext", null);
await registerAuthorization(app, pool);
app.addHook("onRequest", async (request) => {
  if (request.headers["x-test-subject"] === identity.subject) {
    request.authContext = { ...identity, userId, displayName: "CI portfolio reader", sessionToken: "test-only" };
  }
});
await registerPurchaseOrderReadRoutes(app, pool);

try {
  await client.query("BEGIN");
  const runtimeRole = await client.query(
    "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'import_erp_app') AS present",
  );
  if (runtimeRole.rows[0].present) {
    const snapshotGrant = await client.query(`SELECT
      has_column_privilege('import_erp_app', 'migration.import_batch', 'id', 'SELECT') AS id_read,
      has_column_privilege('import_erp_app', 'migration.import_batch', 'promoted_at', 'SELECT') AS promoted_at_read,
      has_column_privilege('import_erp_app', 'migration.import_batch', 'file_name', 'SELECT') AS file_name_read`);
    assert.deepEqual(snapshotGrant.rows[0], { id_read: true, promoted_at_read: true, file_name_read: false });
  } else if (databaseName.endsWith("_ci")) {
    assert.fail("API CI must provision import_erp_app to verify snapshot column grants");
  }
  await client.query(
    `INSERT INTO identity.erp_user (id, issuer, subject, display_name)
     VALUES ($1, $2, $3, $4)`,
    [userId, identity.issuer, identity.subject, "CI portfolio reader"],
  );
  await client.query("INSERT INTO identity.erp_user_role (user_id, role) VALUES ($1, 'Consulta')", [userId]);
  await client.query("INSERT INTO identity.erp_user_importer_scope (user_id, importer_code) VALUES ($1, $2)", [userId, importer]);
  await client.query(
    `INSERT INTO migration.import_batch (id, file_name, file_sha256, mapping_version, state, promoted_at)
     VALUES ($1, 'portfolio-summary-ci.xlsx', $2, 'portfolio-summary-ci-v1', 'PROMOTED', '2026-01-15T12:00:00Z')`,
    [batchId, randomUUID().replaceAll("-", "").padEnd(64, "0")],
  );
  await client.query(
    `INSERT INTO procurement.purchase_order (id, importer, external_number, normalized_number)
     VALUES ($1, $2, 'PO-100', 'PO-100'), ($3, $2, 'PO-200', 'PO-200'),
            ($4, 'Other Importer', 'PO-300', 'PO-300')`,
    [purchaseOrders[0], importer, purchaseOrders[1], purchaseOrders[2]],
  );
  await client.query(
    `INSERT INTO imports.import_process (id, importer, ip_number, normalized_ip_number)
     VALUES ($1, $2, 'IP-001', 'IP-001'), ($3, $2, 'IP-002', 'IP-002'),
            ($4, 'Other Importer', 'IP-003', 'IP-003')`,
    [processes[0], importer, processes[1], processes[2]],
  );
  await client.query(
    `INSERT INTO procurement.process_purchase_order (purchase_order_id, process_id)
     VALUES ($1, $2), ($3, $4), ($5, $6)`,
    [purchaseOrders[0], processes[0], purchaseOrders[1], processes[1], purchaseOrders[2], processes[2]],
  );
  for (let index = 0; index < sourceRows.length; index += 1) {
    await client.query(
      `INSERT INTO migration.source_row (id, batch_id, sheet_name, row_number, raw_values, row_hash)
       VALUES ($1, $2, 'CI', $3, '{}'::jsonb, $4)`,
      [sourceRows[index], batchId, index + 1, randomUUID().replaceAll("-", "").padEnd(64, "0")],
    );
  }
  await client.query(
    `INSERT INTO procurement.po_line_observation
       (id, purchase_order_id, source_row_id, source_row_number, product_code_snapshot, description_snapshot, source_ip_text, raw_values)
     VALUES ($1, $2, $3, 1, 'MOTOR-01', 'Motor industrial', 'IP-001', '{}'::jsonb),
            ($4, $2, $5, 2, 'MOTOR-02', 'Motor especial', NULL, '{}'::jsonb),
            ($6, $7, $8, 3, 'GEAR-01', 'Engrenagem', 'CANCELLED', '{}'::jsonb),
            ($9, $10, $11, 4, 'OTHER-01', 'Item fora do escopo', 'IP-003', '{}'::jsonb)`,
    [observations[0], purchaseOrders[0], sourceRows[0], observations[1], sourceRows[1],
      observations[2], purchaseOrders[1], sourceRows[2], observations[3], purchaseOrders[2], sourceRows[3]],
  );
  await client.query("COMMIT");
  fixturesCommitted = true;

  const get = (url, authenticated = true) => app.inject({
    method: "GET",
    url,
    headers: authenticated ? { "x-test-subject": identity.subject } : {},
  });
  assert.equal((await get("/api/v1/purchase-orders/summary", false)).statusCode, 401);

  const summaryResponse = await get("/api/v1/purchase-orders/summary");
  assert.equal(summaryResponse.statusCode, 200);
  assert.deepEqual(summaryResponse.json(), {
    purchaseOrders: 2,
    linkedProcesses: 2,
    lines: 3,
    linesWithoutIp: 2,
    sourceSnapshotAt: "2026-01-15T12:00:00.000Z",
    byImporter: [{ importer, purchaseOrders: 2 }],
  });

  const filtered = await get("/api/v1/purchase-orders/summary?number=100&product=motor");
  assert.equal(filtered.statusCode, 200);
  assert.deepEqual(filtered.json(), {
    purchaseOrders: 1,
    linkedProcesses: 1,
    lines: 2,
    linesWithoutIp: 1,
    sourceSnapshotAt: "2026-01-15T12:00:00.000Z",
    byImporter: [{ importer, purchaseOrders: 1 }],
  });

  const outsideScope = await get("/api/v1/purchase-orders/summary?importer=other");
  assert.equal(outsideScope.statusCode, 200);
  assert.deepEqual(outsideScope.json(), {
    purchaseOrders: 0, linkedProcesses: 0, lines: 0, linesWithoutIp: 0,
    sourceSnapshotAt: null, byImporter: [],
  });
  assert.equal((await get("/api/v1/purchase-orders/summary?page=1")).statusCode, 400);
  console.log("PO portfolio summary PostgreSQL integration contract passed.");
} finally {
  await app.close();
  if (fixturesCommitted) {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM procurement.process_purchase_order
       WHERE purchase_order_id = ANY($1::uuid[]) OR process_id = ANY($2::uuid[])`,
      [purchaseOrders, processes],
    );
    await client.query("DELETE FROM procurement.po_line_observation WHERE purchase_order_id = ANY($1::uuid[])", [purchaseOrders]);
    await client.query("DELETE FROM migration.source_row WHERE batch_id = $1", [batchId]);
    await client.query("DELETE FROM procurement.purchase_order WHERE id = ANY($1::uuid[])", [purchaseOrders]);
    await client.query("DELETE FROM imports.import_process WHERE id = ANY($1::uuid[])", [processes]);
    await client.query("DELETE FROM migration.import_batch WHERE id = $1", [batchId]);
    await client.query("DELETE FROM identity.erp_user_importer_scope WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM identity.erp_user_role WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM identity.erp_user WHERE id = $1", [userId]);
    await client.query("COMMIT");
  } else {
    try { await client.query("ROLLBACK"); } catch {}
  }
  client.release();
  await pool.end();
}
