import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerAdminOutboxRoutes } from "../dist/admin-outbox.js";

test("outbox monitor is Master-only and never returns payload or error text", async t => {
  let queueReads = 0;
  const pool = {
    async query(sql, values = []) {
      if (sql.includes("identity.erp_user_role")) {
        return { rows: [{ role: values[1] === "master" ? "Master" : "Consulta", importer_code: null }] };
      }
      if (sql.includes("SELECT DISTINCT importer FROM procurement.purchase_order")) return { rows: [] };
      if (sql.includes("FROM audit.outbox_monitor")) {
        queueReads += 1;
        if (sql.includes("count(*) FILTER")) return { rows: [{
          published: 2, dead_lettered: 1, leased: 0, retry_waiting: 1, ready: 3,
          oldest_unpublished_at: new Date("2026-10-02T12:00:00Z"),
        }] };
        return { rows: [{
          event_id: "event-1", event_type: "procurement.request.created",
          aggregate_type: "IMPORT_REQUEST", occurred_at: new Date("2026-10-02T12:00:00Z"),
          attempt_count: 2, next_attempt_at: null, lease_expires_at: null,
          dead_lettered_at: null, payload: { secret: "never-expose" },
          last_error: "never-expose",
        }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    const subject = request.headers["x-test-subject"];
    if (typeof subject === "string") request.authContext = {
      issuer: "test", subject, userId: `user:${subject}`, sessionToken: "test-only",
    };
  });
  await registerAdminOutboxRoutes(app, pool);

  const url = "/api/v1/admin/outbox";
  assert.equal((await app.inject({ method: "GET", url })).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url,
    headers: { "x-test-subject": "reader" } })).statusCode, 403);
  assert.equal(queueReads, 0);

  const response = await app.inject({ method: "GET", url,
    headers: { "x-test-subject": "master" } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.json().counts.ready, 3);
  assert.equal(response.json().items[0].status, "READY");
  assert.equal(response.json().items[0].payload, undefined);
  assert.equal(response.json().items[0].lastError, undefined);
  assert.equal(queueReads, 2);
});
