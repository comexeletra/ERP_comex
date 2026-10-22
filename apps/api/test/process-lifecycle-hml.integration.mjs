import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { Pool } from "pg";
import { registerOperationalRoutes } from "../dist/operations.js";

const databaseUrl = process.env.DATABASE_URL;
if (process.env.MIGRATION_ENV !== "isolated" || !databaseUrl
  || new URL(databaseUrl).pathname !== "/erp_po_totvs_hml") {
  throw new Error("Use MIGRATION_ENV=isolated with DATABASE_URL targeting only erp_po_totvs_hml.");
}

const pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5_000,
  application_name: "process-lifecycle-hml-validation" });
const app = Fastify();
const runId = randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
const ipNumber = `TEST-IP-LIFECYCLE-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${runId}`;
const reason = "HML IP lifecycle validation";
const idempotencyKey = `ip-lifecycle-${runId}`;

app.decorateRequest("authContext", null);
app.decorateRequest("authorizationContext", null);

const target = await pool.query("SELECT current_database() AS database, current_user AS role");
if (target.rows[0]?.database !== "erp_po_totvs_hml" || target.rows[0]?.role !== "import_erp_hml_app") {
  await pool.end();
  throw new Error("The HML integration requires erp_po_totvs_hml with role import_erp_hml_app.");
}
const context = await pool.query("SELECT id FROM identity.erp_user ORDER BY id LIMIT 1");
const importerResult = await pool.query(
  "SELECT value FROM catalog.operational_value WHERE entity_key = 'IMPORTER' ORDER BY value LIMIT 1");
if (!context.rows[0] || !importerResult.rows[0]) {
  await pool.end();
  throw new Error("HML lacks an actor or configured importer for the lifecycle validation.");
}
const importer = importerResult.rows[0].value;

app.addHook("onRequest", async request => {
  request.authContext = { issuer: "hml-validation", subject: `ip-lifecycle-${runId}`,
    userId: context.rows[0].id, displayName: "HML validation", sessionToken: "hml-validation" };
  request.authorizationContext = { roles: ["Master"], permissions: new Set([
    "processes.read", "processes.write", "processes.lifecycle.manage",
  ]), importerScopes: [importer] };
});
await registerOperationalRoutes(app, pool);

async function call(method, url, payload, version) {
  const response = await app.inject({ method, url,
    headers: { "content-type": "application/json", ...(version ? { "X-Record-Version": version } : {}),
      ...(method === "POST" && url === "/api/v1/processes" ? { "Idempotency-Key": idempotencyKey } : {}) },
    payload });
  return { status: response.statusCode, body: response.statusCode === 204 ? null : response.json() };
}

async function currentProcess(id) {
  const result = await pool.query(
    `SELECT record_status, lifecycle_status, version::text AS version,
            record_status_before_delete, deleted_at, deleted_by, delete_reason
     FROM imports.import_process WHERE id = $1`, [id]);
  return result.rows[0];
}

async function transition(id, method, path, payload, expectedStatus = 200) {
  const before = await currentProcess(id);
  assert.ok(before, `synthetic IP ${id} exists`);
  const response = await call(method, `/api/v1/processes/${id}${path}`, payload, before.version);
  assert.equal(response.status, expectedStatus, JSON.stringify(response.body));
  return response.body;
}

async function ensureDeleted(id) {
  let process = await currentProcess(id);
  if (!process || process.record_status === "DELETED") return;
  if (process.record_status === "CANCELLED") {
    await transition(id, "POST", "/reactivate", { reason: `${reason}: cleanup` });
    process = await currentProcess(id);
  }
  if (process.lifecycle_status === "CLOSED") {
    await transition(id, "POST", "/reopen", { reason: `${reason}: cleanup` });
    process = await currentProcess(id);
  }
  if (process.record_status !== "DELETED") {
    await transition(id, "DELETE", "", { reason: `${reason}: cleanup` });
  }
}

test("HML exercises the complete IP lifecycle and records each transition", async t => {
  t.after(async () => { await app.close(); await pool.end(); });
  let processId;

  try {
    const created = await call("POST", "/api/v1/processes", {
      importer, ipNumber, supplierText: "HML LIFECYCLE VALIDATION", logisticsStatus: "WAITING SHIPMENT",
      priority: null, notes: "Synthetic IP; no invoice, documents, allocations or POs.", reason,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    processId = created.body.id;
    assert.equal(created.body.version, "1");

    await transition(processId, "DELETE", "", { reason });
    let process = await currentProcess(processId);
    assert.equal(process.record_status, "DELETED");
    assert.equal(process.record_status_before_delete, "ACTIVE");
    assert.ok(process.deleted_at);
    assert.equal(process.deleted_by, `hml-validation#ip-lifecycle-${runId}`);
    assert.equal(process.delete_reason, reason);

    await transition(processId, "POST", "/restore", { reason });
    process = await currentProcess(processId);
    assert.equal(process.record_status, "ACTIVE");
    assert.equal(process.deleted_at, null);
    assert.equal(process.deleted_by, null);
    assert.equal(process.delete_reason, null);
    assert.equal(process.record_status_before_delete, null);

    await transition(processId, "POST", "/cancel", { purchaseOrders: [], reason });
    process = await currentProcess(processId);
    assert.equal(process.record_status, "CANCELLED");

    await transition(processId, "POST", "/reactivate", { reason });
    process = await currentProcess(processId);
    assert.equal(process.record_status, "ACTIVE");
    assert.equal(process.lifecycle_status, "OPEN");

    await transition(processId, "POST", "/close", { reason });
    process = await currentProcess(processId);
    assert.equal(process.lifecycle_status, "CLOSED");

    await transition(processId, "POST", "/reopen", { reason });
    process = await currentProcess(processId);
    assert.equal(process.lifecycle_status, "OPEN");

    await transition(processId, "DELETE", "", { reason });
    process = await currentProcess(processId);
    assert.equal(process.record_status, "DELETED");
    assert.equal(process.record_status_before_delete, "ACTIVE");

    const audit = await pool.query(
      `SELECT operation FROM audit.audit_log
       WHERE aggregate_type = 'IMPORT_PROCESS' AND aggregate_id = $1 ORDER BY occurred_at, id`, [processId]);
    assert.deepEqual(audit.rows.map(row => row.operation).sort(),
      ["CREATE", "SOFT_DELETE", "RESTORE", "CANCEL", "REACTIVATE", "CLOSE", "REOPEN", "SOFT_DELETE"].sort());

    const outbox = await pool.query(
      `SELECT event_type FROM audit.outbox_message
       WHERE aggregate_type = 'IMPORT_PROCESS' AND aggregate_id = $1 ORDER BY occurred_at, event_id`, [processId]);
    assert.deepEqual(outbox.rows.map(row => row.event_type).sort(), [
      "comex.import_process.create", "comex.import_process.soft_delete", "comex.import_process.restore",
      "comex.import_process.cancel", "comex.import_process.reactivate", "comex.import_process.close",
      "comex.import_process.reopen", "comex.import_process.soft_delete",
    ].sort());

    console.log(`Validated IP ${ipNumber}; retained as DELETED so its immutable audit history remains intact.`);
  } finally {
    if (processId) await ensureDeleted(processId);
    else {
      const created = await pool.query(
        `SELECT id FROM imports.import_process WHERE importer = $1 AND normalized_ip_number = upper($2)`,
        [importer, ipNumber]);
      if (created.rows[0]) await ensureDeleted(created.rows[0].id);
    }
  }
});
