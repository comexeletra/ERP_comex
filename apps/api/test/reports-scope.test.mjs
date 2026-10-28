import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerSourceAuditRoutes } from "../dist/source-audit.js";

test("report scope queries and returns only the selected stage", async t => {
  const queries = [];
  const pool = { async query(sql) {
    queries.push(sql);
    return { rows: [sql.includes("WITH scoped_po")
      ? { total_records: 3, historical_records: 2, new_records: 1, statuses: [] }
      : { total_records: 5, historical_records: 4, new_records: 1, statuses: [] }] };
  } };
  const app = Fastify();
  t.after(() => app.close());
  await registerSourceAuditRoutes(app, pool);

  const pre = await app.inject("/api/v1/reports/summary?scope=pre");
  assert.equal(pre.statusCode, 200);
  assert.deepEqual(Object.keys(pre.json()), ["preShipment"]);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /WITH scoped_po/u);

  queries.length = 0;
  const post = await app.inject("/api/v1/reports/summary?scope=post");
  assert.equal(post.statusCode, 200);
  assert.deepEqual(Object.keys(post.json()), ["postShipment"]);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /WITH scoped_process/u);

  queries.length = 0;
  const invalid = await app.inject("/api/v1/reports/summary?scope=other");
  assert.equal(invalid.statusCode, 400);
  assert.equal(queries.length, 0);

  const combined = await app.inject("/api/v1/reports/summary");
  assert.equal(combined.statusCode, 200);
  assert.deepEqual(Object.keys(combined.json()), ["preShipment", "postShipment"]);
});

test("reports leave out deleted POs and IPs, like the operational lists", async t => {
  const queries = [];
  const pool = { async query(sql) { queries.push(sql); return { rows: [{ statuses: [] }] }; } };
  const app = Fastify();
  t.after(() => app.close());
  await registerSourceAuditRoutes(app, pool);

  assert.equal((await app.inject("/api/v1/reports/summary")).statusCode, 200);
  const pre = queries.find(sql => sql.includes("WITH scoped_po"));
  const post = queries.find(sql => sql.includes("WITH scoped_process"));
  assert.match(pre, /WHERE po\.importer = ANY\(\$1::text\[\]\)\s+AND po\.lifecycle_status <> 'DELETED'/u);
  assert.match(post, /WHERE process\.importer = ANY\(\$1::text\[\]\)\s+AND process\.record_status <> 'DELETED'/u);
  // An item only counts as linked while its allocation and its IP are both active.
  const activeIp = /allocation\.status = 'ACTIVE'\s+AND EXISTS \(SELECT 1 FROM imports\.import_process AS process\s+WHERE process\.id = allocation\.process_id AND process\.record_status = 'ACTIVE'\)/gu;
  assert.equal(pre.match(activeIp)?.length, 2);
  assert.equal(pre.match(/AND process\.importer = item\.importer\s+AND process\.record_status = 'ACTIVE'/gu)?.length, 2);
});
