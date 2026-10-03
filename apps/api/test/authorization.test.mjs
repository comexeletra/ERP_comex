import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import {
  importerScopePredicate,
  permissionConfig,
  registerAuthorization,
} from "../dist/authorization.js";
import { registerPurchaseOrderReadRoutes } from "../dist/purchase-orders.js";

const fixtureOrders = [
  { id: "po-a", importer: "ELETRA MATRIZ", number: "100" },
  { id: "po-b", importer: "ELETRA FOR", number: "200" },
  { id: "po-c", importer: "OUTRO IMPORTADOR", number: "300" },
];

const identities = {
  reader: [{ role: "Consulta", importer_code: "ELETRA MATRIZ" }],
  buyer: [
    { role: "Compras", importer_code: "ELETRA MATRIZ" },
    { role: "Compras", importer_code: "ELETRA FOR" },
  ],
  noRole: [{ role: null, importer_code: "ELETRA MATRIZ" }],
  unknownRole: [{ role: "SuperUser", importer_code: "ELETRA MATRIZ" }],
  unscoped: [{ role: "Administrador", importer_code: null }],
  master: [{ role: "Master", importer_code: null }],
};

async function createApp(allImporters = ["ELETRA MATRIZ", "ELETRA FOR"]) {
  let policyQueries = 0;
  let resourceQueries = 0;
  const pool = {
    async query(sql, parameters) {
      policyQueries += 1;
      if (sql.includes("SELECT DISTINCT importer FROM procurement.purchase_order")) {
        return { rows: allImporters.map((importer) => ({ importer })) };
      }
      assert.match(sql, /WHERE u\.issuer = \$1 AND u\.subject = \$2 AND u\.is_active = true/u);
      assert.deepEqual(parameters, [`issuer:${parameters[1]}`, parameters[1]]);
      return { rows: identities[parameters[1]] ?? [] };
    },
  };
  const app = Fastify();
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async (request) => {
    const subject = request.headers["x-test-subject"];
    if (typeof subject === "string") {
      request.authContext = { issuer: `issuer:${subject}`, subject, userId: `user:${subject}`, displayName: null, sessionToken: "test-only" };
    }
  });

  app.get("/api/v1/purchase-orders", {
    config: permissionConfig("purchase-orders.read"),
  }, async (request) => {
    const scope = importerScopePredicate("po.importer", 1, request.authorizationContext.importerScopes);
    const scopedRows = fixtureOrders.filter((order) => scope.values[0]?.includes(order.importer));
    const page = Number(new URL(request.url, "http://localhost").searchParams.get("page") ?? "1");
    const pageSize = 1;
    resourceQueries += 1;
    return { totalCount: scopedRows.length, items: scopedRows.slice((page - 1) * pageSize, page * pageSize) };
  });

  app.get("/api/v1/purchase-orders/:id/overview", {
    config: permissionConfig("purchase-orders.read"),
  }, async (request, reply) => {
    const scope = importerScopePredicate("po.importer", 1, request.authorizationContext.importerScopes);
    const id = (request.params).id;
    const scopedOrder = fixtureOrders.find((order) => order.id === id && scope.values[0]?.includes(order.importer));
    resourceQueries += 1;
    if (!scopedOrder) return reply.code(404).send({ error: "Recurso não encontrado." });
    return scopedOrder;
  });

  app.get("/api/v1/test/missing-policy", async () => {
    resourceQueries += 1;
    return { ok: true };
  });
  app.get("/api/v1/test/resolve-quality", {
    config: permissionConfig("quality.resolve"),
  }, async () => {
    resourceQueries += 1;
    return { ok: true };
  });
  app.get("/api/v1/data-issues", {
    config: permissionConfig("quality.read"),
  }, async (request) => {
    resourceQueries += 1;
    return { importerScopes: request.authorizationContext.importerScopes };
  });
  app.get("/api/v1/users", {
    config: permissionConfig("users.manage", "global"),
  }, async () => {
    resourceQueries += 1;
    return { ok: true };
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: "Recurso não encontrado." }));

  return { app, counters: () => ({ policyQueries, resourceQueries }) };
}

test("requires an authenticated identity before the handler or grants query", async (t) => {
  const { app, counters } = await createApp();
  t.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/api/v1/purchase-orders" });
  assert.equal(response.statusCode, 401);
  assert.equal(counters().policyQueries, 0);
  assert.equal(counters().resourceQueries, 0);
});

test("keeps unknown API paths as 404 instead of treating them as protected resources", async (t) => {
  const { app } = await createApp();
  t.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/api/v1/does-not-exist", headers: { "x-test-subject": "reader" } });
  assert.equal(response.statusCode, 404);
});

test("denies unknown/missing roles and routes without declared policy before resource access", async (t) => {
  const { app, counters } = await createApp();
  t.after(() => app.close());
  for (const subject of ["noRole", "unknownRole"]) {
    const response = await app.inject({ method: "GET", url: "/api/v1/purchase-orders", headers: { "x-test-subject": subject } });
    assert.equal(response.statusCode, 403);
  }
  const missingPolicy = await app.inject({ method: "GET", url: "/api/v1/test/missing-policy", headers: { "x-test-subject": "reader" } });
  assert.equal(missingPolicy.statusCode, 403);
  const unscoped = await app.inject({ method: "GET", url: "/api/v1/purchase-orders", headers: { "x-test-subject": "unscoped" } });
  assert.equal(unscoped.statusCode, 403);
  assert.equal(counters().resourceQueries, 0);
});

test("applies importer scope before pagination and reports only visible rows", async (t) => {
  const { app } = await createApp();
  t.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/api/v1/purchase-orders?page=1", headers: { "x-test-subject": "buyer" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    totalCount: 2,
    items: [{ id: "po-a", importer: "ELETRA MATRIZ", number: "100" }],
  });
});

test("master can open empty importer-scoped views before the first import", async (t) => {
  const { app } = await createApp([]);
  t.after(() => app.close());
  const headers = { "x-test-subject": "master" };
  const portfolio = await app.inject({ method: "GET", url: "/api/v1/purchase-orders", headers });
  const quality = await app.inject({ method: "GET", url: "/api/v1/data-issues", headers });
  assert.equal(portfolio.statusCode, 200);
  assert.deepEqual(portfolio.json(), { totalCount: 0, items: [] });
  assert.equal(quality.statusCode, 200);
  assert.deepEqual(quality.json(), { importerScopes: [] });

  const unscoped = await app.inject({
    method: "GET", url: "/api/v1/purchase-orders", headers: { "x-test-subject": "unscoped" },
  });
  assert.equal(unscoped.statusCode, 403);
});

test("hides an out-of-scope PO as 404 while allowing an in-scope PO", async (t) => {
  const { app } = await createApp();
  t.after(() => app.close());
  const visible = await app.inject({ method: "GET", url: "/api/v1/purchase-orders/po-a/overview", headers: { "x-test-subject": "reader" } });
  const hidden = await app.inject({ method: "GET", url: "/api/v1/purchase-orders/po-b/overview", headers: { "x-test-subject": "reader" } });
  assert.equal(visible.statusCode, 200);
  assert.equal(hidden.statusCode, 404);
});

test("enforces role permissions and keeps global user management master-only", async (t) => {
  const { app, counters } = await createApp();
  t.after(() => app.close());
  const deniedReview = await app.inject({ method: "GET", url: "/api/v1/test/resolve-quality", headers: { "x-test-subject": "reader" } });
  const deniedGlobal = await app.inject({ method: "GET", url: "/api/v1/users", headers: { "x-test-subject": "reader" } });
  assert.equal(deniedReview.statusCode, 403);
  assert.equal(deniedGlobal.statusCode, 403);
  const deniedAdmin = await app.inject({ method: "GET", url: "/api/v1/users", headers: { "x-test-subject": "unscoped" } });
  assert.equal(deniedAdmin.statusCode, 403);
  const allowedGlobal = await app.inject({ method: "GET", url: "/api/v1/users", headers: { "x-test-subject": "master" } });
  assert.equal(allowedGlobal.statusCode, 200);
  assert.equal(counters().resourceQueries, 1);
});

test("re-reads grants on each request so scope revocation takes effect immediately", async (t) => {
  const { app } = await createApp();
  t.after(() => app.close());
  const first = await app.inject({ method: "GET", url: "/api/v1/purchase-orders", headers: { "x-test-subject": "reader" } });
  identities.reader = [];
  const afterRevocation = await app.inject({ method: "GET", url: "/api/v1/purchase-orders", headers: { "x-test-subject": "reader" } });
  identities.reader = [{ role: "Consulta", importer_code: "ELETRA MATRIZ" }];
  assert.equal(first.statusCode, 200);
  assert.equal(afterRevocation.statusCode, 403);
});

test("rejects unsafe SQL identifiers and produces a no-row predicate for empty scope", () => {
  assert.deepEqual(importerScopePredicate("po.importer", 3, []), {
    sql: "po.importer = ANY($3::text[])",
    values: [[]],
  });
  assert.deepEqual(importerScopePredicate("po.importer", 2, ["A", "B", "A"]), {
    sql: "po.importer = ANY($2::text[])",
    values: [["A", "B"]],
  });
  assert.throws(() => importerScopePredicate("po.importer; DROP TABLE x", 1, ["A"]));
});

test("production PO list applies the grant scope in SQL before its limit and offset", async (t) => {
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes("identity.erp_user_role")) {
        assert.match(sql, /u\.issuer = \$1 AND u\.subject = \$2/u);
        return { rows: [{ role: "Consulta", importer_code: "ELETRA MATRIZ" }] };
      }
      assert.ok(sql.indexOf("WHERE po.importer = ANY($1::text[])") < sql.indexOf("LIMIT $6 OFFSET $7"));
      assert.deepEqual(values, [["ELETRA MATRIZ"], null, null, null, null, 50, 0]);
      return { rows: [{ total_count: 1, items: [{ id: "po-visible", importer: "ELETRA MATRIZ" }] }] };
    },
  };
  const app = Fastify();
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async (request) => {
    if (request.headers["x-test-subject"] === "reader") {
      request.authContext = { issuer: "issuer:reader", subject: "reader", userId: "u1", displayName: null, sessionToken: "test" };
    }
  });
  await registerPurchaseOrderReadRoutes(app, pool);
  t.after(() => app.close());

  const denied = await app.inject({ method: "GET", url: "/api/v1/purchase-orders" });
  assert.equal(denied.statusCode, 401);
  assert.equal(queries.length, 0);

  const response = await app.inject({ method: "GET", url: "/api/v1/purchase-orders?pageSize=50", headers: { "x-test-subject": "reader" } });
  assert.equal(response.statusCode, 200);
  assert.equal(queries.length, 2);
  assert.equal(response.json().totalCount, 1);
  assert.deepEqual(response.json().items, [{ id: "po-visible", importer: "ELETRA MATRIZ" }]);
});

test("production PO list passes all four filters with pagination inside the importer scope", async (t) => {
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes("identity.erp_user_role")) {
        return { rows: [{ role: "Consulta", importer_code: "ELETRA MATRIZ" }] };
      }
      assert.match(sql, /WHERE po\.importer = ANY\(\$1::text\[\]\)/u);
      assert.match(sql, /strpos\(lower\(po\.importer\), lower\(\$3\)\) > 0/u);
      assert.match(sql, /strpos\(lower\(coalesce\(obs\.description_snapshot, ''\)\), lower\(\$4\)\) > 0/u);
      assert.match(sql, /process\.importer = ANY\(\$1::text\[\]\)/u);
      assert.deepEqual(values, [["ELETRA MATRIZ"], "18751", "eletra", "motor", "IP-20", 50, 50]);
      return { rows: [{ total_count: 75, items: [{ id: "po-visible" }] }] };
    },
  };
  const app = Fastify();
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    request.authContext = { issuer: "issuer:reader", subject: "reader", userId: "u1", displayName: null, sessionToken: "test" };
  });
  await registerPurchaseOrderReadRoutes(app, pool);
  t.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/api/v1/purchase-orders?page=2&pageSize=50&number=18751&importer=eletra&product=motor&ipNumber=IP-20" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().totalCount, 75);
  assert.equal(queries.length, 2);
});

test("portfolio summary uses the same filters and importer scope before aggregation", async t => {
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes("identity.erp_user_role")) {
        return { rows: [{ role: "Consulta", importer_code: "ELETRA MATRIZ" }] };
      }
      assert.match(sql, /WITH filtered_po AS MATERIALIZED/u);
      assert.match(sql, /WHERE po\.importer = ANY\(\$1::text\[\]\)/u);
      assert.match(sql, /process\.importer = ANY\(\$1::text\[\]\)/u);
      assert.deepEqual(values, [["ELETRA MATRIZ"], "18751", "eletra", "motor", "IP-20"]);
      return { rows: [{ purchase_orders: 1, linked_processes: 2, lines: 8,
        lines_without_ip: 1, source_snapshot_at: new Date("2026-01-15T12:00:00Z"),
        by_importer: [{ importer: "ELETRA MATRIZ", purchaseOrders: 1 }] }] };
    },
  };
  const app = Fastify();
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    if (request.headers["x-test-subject"] === "reader") {
      request.authContext = { issuer: "issuer:reader", subject: "reader", userId: "u1",
        displayName: null, sessionToken: "test" };
    }
  });
  await registerPurchaseOrderReadRoutes(app, pool);
  t.after(() => app.close());

  assert.equal((await app.inject({ method: "GET", url: "/api/v1/purchase-orders/summary" })).statusCode, 401);
  assert.equal(queries.length, 0);
  const response = await app.inject({ method: "GET",
    url: "/api/v1/purchase-orders/summary?number=18751&importer=eletra&product=motor&ipNumber=IP-20",
    headers: { "x-test-subject": "reader" } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(response.json(), { purchaseOrders: 1, linkedProcesses: 2, lines: 8,
    linesWithoutIp: 1, sourceSnapshotAt: "2026-01-15T12:00:00.000Z",
    byImporter: [{ importer: "ELETRA MATRIZ", purchaseOrders: 1 }] });
  assert.equal(queries.length, 2);
});

test("production history lookup applies PO scope in the ID query and returns 404 when hidden", async (t) => {
  const queries = [];
  const visibleId = "00000000-0000-4000-8000-000000000001";
  const hiddenId = "00000000-0000-4000-8000-000000000002";
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes("identity.erp_user_role")) {
        return { rows: [{ role: "Consulta", importer_code: "ELETRA MATRIZ" }] };
      }
      assert.match(sql, /WHERE po\.id = \$1 AND po\.importer = ANY\(\$2::text\[\]\)/u);
      return { rowCount: values[0] === visibleId ? 1 : 0, rows: values[0] === visibleId ? [{ id: visibleId }] : [] };
    },
  };
  const app = Fastify();
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async (request) => {
    if (request.headers["x-test-subject"] === "reader") {
      request.authContext = { issuer: "issuer:reader", subject: "reader", userId: "u1", displayName: null, sessionToken: "test" };
    }
  });
  await registerPurchaseOrderReadRoutes(app, pool);
  t.after(() => app.close());

  const hidden = await app.inject({ method: "GET", url: `/api/v1/purchase-orders/${hiddenId}/history-items`, headers: { "x-test-subject": "reader" } });
  assert.equal(hidden.statusCode, 404);
  assert.equal(queries.length, 2);
  assert.equal(queries[1].values[1][0], "ELETRA MATRIZ");

  queries.length = 0;
  const visible = await app.inject({ method: "GET", url: `/api/v1/purchase-orders/${visibleId}/history-items`, headers: { "x-test-subject": "reader" } });
  assert.equal(visible.statusCode, 200);
  assert.equal(queries.length, 3);
  assert.match(queries[2].sql, /WHERE po\.id = \$1 AND po\.importer = ANY\(\$2::text\[\]\)/u);
});

test("production PO overview scopes the PO before reading linked processes and preserves unknown values", async (t) => {
  const queries = [];
  const visibleId = "00000000-0000-4000-8000-000000000011";
  const hiddenId = "00000000-0000-4000-8000-000000000012";
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes("identity.erp_user_role")) {
        return { rows: [{ role: "Consulta", importer_code: "ELETRA MATRIZ" }] };
      }
      assert.match(sql, /WHERE po\.id = \$1 AND po\.importer = ANY\(\$2::text\[\]\)/u);
      assert.match(sql, /process\.importer = ANY\(\$2::text\[\]\)/u);
      assert.match(sql, /other_po\.importer = ANY\(\$2::text\[\]\)/u);
      assert.match(sql, /FROM costs\.process_cost AS cost WHERE cost\.process_id = process\.id/u);
      assert.deepEqual(values, [values[0], ["ELETRA MATRIZ"]]);
      if (values[0] === hiddenId) return { rowCount: 0, rows: [] };
      return {
        rowCount: 1,
        rows: [{ item: {
          id: visibleId,
          officialItemsKnown: false,
          balanceAvailable: false,
          historicalItemCount: 3,
          processes: [{ ipNumber: "IP-10", costs: [{ amount: "12.34000000", currency: "BRL" }] }],
        } }],
      };
    },
  };
  const app = Fastify();
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async (request) => {
    if (request.headers["x-test-subject"] === "reader") {
      request.authContext = { issuer: "issuer:reader", subject: "reader", userId: "u1", displayName: null, sessionToken: "test" };
    }
  });
  await registerPurchaseOrderReadRoutes(app, pool);
  t.after(() => app.close());

  const hidden = await app.inject({ method: "GET", url: `/api/v1/purchase-orders/${hiddenId}/overview`, headers: { "x-test-subject": "reader" } });
  assert.equal(hidden.statusCode, 404);
  const visible = await app.inject({ method: "GET", url: `/api/v1/purchase-orders/${visibleId}/overview`, headers: { "x-test-subject": "reader" } });
  assert.equal(visible.statusCode, 200);
  assert.deepEqual(visible.json(), {
    id: visibleId,
    officialItemsKnown: false,
    balanceAvailable: false,
    historicalItemCount: 3,
    processes: [{ ipNumber: "IP-10", costs: [{ amount: "12.34000000", currency: "BRL" }] }],
  });
  assert.equal(queries.length, 4);
});
