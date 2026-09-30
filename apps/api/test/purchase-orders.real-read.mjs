// Read-only route integration against the selected VPS database. No login secret
// is needed: test identities are injected into Fastify after selecting existing
// grants. Run only in an isolated validation package, never in the live service.
import assert from "node:assert/strict";
import Fastify from "fastify";
import pg from "pg";
import { registerAuthorization } from "../dist/authorization.js";
import { registerPurchaseOrderReadRoutes } from "../dist/purchase-orders.js";

const connectionString = process.env.DATABASE_URL;
const expectedDatabase = process.env.RF06_READ_DB;
if (!connectionString || !expectedDatabase || new URL(connectionString).pathname !== `/${expectedDatabase}`) {
  throw new Error("Set DATABASE_URL and RF06_READ_DB to the same explicitly selected database.");
}

const client = new pg.Client({ connectionString });
await client.connect();
let app;
try {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const masterResult = await client.query(
    `SELECT u.issuer, u.subject, u.id
     FROM identity.erp_user AS u
     JOIN identity.erp_user_role AS role ON role.user_id = u.id
     WHERE u.is_active = true AND role.role = 'Master'
     ORDER BY u.id LIMIT 1`,
  );
  assert.equal(masterResult.rowCount, 1, "An active Master grant is required for read validation");
  const master = masterResult.rows[0];
  const restrictedResult = await client.query(
    `SELECT u.issuer, u.subject, u.id, array_agg(DISTINCT s.importer_code) AS scopes
     FROM identity.erp_user AS u
     JOIN identity.erp_user_role AS role ON role.user_id = u.id AND role.role <> 'Master'
     JOIN identity.erp_user_importer_scope AS s ON s.user_id = u.id
     WHERE u.is_active = true
       AND NOT EXISTS (SELECT 1 FROM identity.erp_user_role AS master_role
                       WHERE master_role.user_id = u.id AND master_role.role = 'Master')
     GROUP BY u.id, u.issuer, u.subject
     ORDER BY count(DISTINCT s.importer_code), u.id LIMIT 1`,
  );
  const restricted = restrictedResult.rows[0];
  const importersResult = await client.query(
    "SELECT importer FROM procurement.purchase_order GROUP BY importer ORDER BY importer",
  );
  assert.ok(importersResult.rows.length > 1, "At least two importers are required for scope validation");
  const syntheticImporter = importersResult.rows[0].importer;
  const scopedPool = {
    query(sql, values) {
      if (sql.includes("FROM identity.erp_user AS u")
        && values?.[0] === "rf06-validation" && values?.[1] === "scoped") {
        return Promise.resolve({ rows: [{ role: "Consulta", importer_code: syntheticImporter }] });
      }
      return client.query(sql, values);
    },
  };

  app = Fastify();
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, scopedPool);
  app.addHook("onRequest", async request => {
    const selector = request.headers["x-test-identity"];
    if (selector === "master") {
      request.authContext = { issuer: master.issuer, subject: master.subject, userId: master.id, displayName: null, sessionToken: "read-validation" };
    } else if (selector === "restricted" && restricted) {
      request.authContext = { issuer: restricted.issuer, subject: restricted.subject, userId: restricted.id, displayName: null, sessionToken: "read-validation" };
    } else if (selector === "scoped") {
      request.authContext = { issuer: "rf06-validation", subject: "scoped", userId: master.id, displayName: null, sessionToken: "read-validation" };
    } else if (selector === "no-grant") {
      request.authContext = { issuer: "rf06-validation", subject: "no-grant", userId: master.id, displayName: null, sessionToken: "read-validation" };
    }
  });
  await registerPurchaseOrderReadRoutes(app, scopedPool);

  const get = (url, identity = "master") => app.inject({ method: "GET", url, headers: identity ? { "x-test-identity": identity } : {} });
  assert.equal((await get("/api/v1/purchase-orders", "")).statusCode, 401);
  assert.equal((await get("/api/v1/purchase-orders", "no-grant")).statusCode, 403);

  const first = await get("/api/v1/purchase-orders?page=1&pageSize=50");
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().totalCount, 336);
  assert.equal(first.json().items.length, 50);
  const seventh = await get("/api/v1/purchase-orders?page=7&pageSize=50");
  assert.equal(seventh.statusCode, 200);
  assert.equal(seventh.json().totalCount, 336);
  assert.equal(seventh.json().items.length, 36);
  assert.equal((await get("/api/v1/purchase-orders?page=8&pageSize=50")).json().items.length, 0);

  for (const [number, historicalCount, linkedIps, suppliers] of [["18751", 8, 3, 2], ["18223", 2, 0, 2], ["6817", 2, 2, 1]]) {
    const list = await get(`/api/v1/purchase-orders?number=${number}`);
    assert.equal(list.statusCode, 200);
    const row = list.json().items.find(item => item.number === number && item.importer === "ELETRA MATRIZ");
    assert.ok(row, `Missing PO ${number}`);
    const overviewResponse = await get(`/api/v1/purchase-orders/${row.id}/overview`);
    assert.equal(overviewResponse.statusCode, 200);
    const overview = overviewResponse.json();
    assert.equal(overview.historicalItemCount, historicalCount);
    assert.equal(overview.processes.length, linkedIps);
    assert.equal(overview.officialItemsKnown, false);
    assert.equal(overview.balanceAvailable, false);
    assert.equal("costs" in overview, false, "IP costs must not be totaled as PO costs");
    const historyResponse = await get(`/api/v1/purchase-orders/${row.id}/history-items?page=1&pageSize=50`);
    assert.equal(historyResponse.statusCode, 200);
    const history = historyResponse.json();
    assert.equal(history.totalCount, historicalCount);
    assert.equal(history.items.length, historicalCount);
    assert.equal(new Set(history.items.map(item => item.sourceValues.R).filter(Boolean)).size, suppliers);
    assert.ok(history.items.every(item => item.sourceSheetName && item.sourceRowNumber > 0 && item.sourceValues));
    if (number === "18751") {
      const product = history.items.find(item => item.productCode || item.productDescription);
      assert.ok(product);
      const productTerm = product.productCode || product.productDescription.slice(0, 12);
      const filtered = await get(`/api/v1/purchase-orders?number=18751&product=${encodeURIComponent(productTerm)}`);
      assert.equal(filtered.statusCode, 200);
      assert.ok(filtered.json().items.some(item => item.id === row.id));
    }
    if (number === "6817") {
      const shared = overview.processes.find(process => process.ipNumber === "NH-017/2025");
      assert.ok(shared);
      assert.equal(shared.linkedPurchaseOrderCount, 4);
      assert.equal(shared.costs.length, 2);
      assert.ok(shared.costs.some(cost => cost.type === "FREIGHT" && Number(cost.amount) === 17520));
      assert.ok(shared.costs.some(cost => cost.type === "STORAGE" && Number(cost.amount) === 545.45));
    }
  }

  const ipFilter = await get("/api/v1/purchase-orders?ipNumber=NH-017%2F2025");
  assert.equal(ipFilter.statusCode, 200);
  assert.equal(ipFilter.json().totalCount, 4);
  const importerFilter = await get("/api/v1/purchase-orders?importer=matriz");
  assert.equal(importerFilter.statusCode, 200);
  assert.ok(importerFilter.json().totalCount > 0);
  assert.ok(importerFilter.json().items.every(item => item.importer.toLowerCase().includes("matriz")));

  const largest = await client.query(
    `SELECT po.id, count(obs.id)::int AS total
     FROM procurement.purchase_order AS po
     JOIN procurement.po_line_observation AS obs ON obs.purchase_order_id = po.id
     GROUP BY po.id ORDER BY total DESC, po.id LIMIT 1`,
  );
  const { id: largestId, total } = largest.rows[0];
  const seen = new Set();
  for (let page = 1; page <= Math.ceil(total / 50); page++) {
    const response = await get(`/api/v1/purchase-orders/${largestId}/history-items?page=${page}&pageSize=50`);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().totalCount, total);
    for (const item of response.json().items) seen.add(item.id);
  }
  assert.equal(seen.size, total, "All historical observations must be reachable through pagination");

  const missingId = "00000000-0000-4000-8000-000000000000";
  assert.equal((await get(`/api/v1/purchase-orders/${missingId}/overview`)).statusCode, 404);
  assert.equal((await get(`/api/v1/purchase-orders/${missingId}/history-items`)).statusCode, 404);
  const outsideSyntheticScope = await client.query(
    "SELECT id FROM procurement.purchase_order WHERE importer <> $1 ORDER BY id LIMIT 1",
    [syntheticImporter],
  );
  assert.equal(outsideSyntheticScope.rowCount, 1);
  const scopedList = await get("/api/v1/purchase-orders", "scoped");
  assert.equal(scopedList.statusCode, 200);
  assert.ok(scopedList.json().totalCount > 0 && scopedList.json().totalCount < 336);
  assert.ok(scopedList.json().items.every(item => item.importer === syntheticImporter));
  assert.equal((await get(`/api/v1/purchase-orders/${outsideSyntheticScope.rows[0].id}/overview`, "scoped")).statusCode, 404);
  assert.equal((await get(`/api/v1/purchase-orders/${outsideSyntheticScope.rows[0].id}/history-items`, "scoped")).statusCode, 404);
  console.log("Synthetic single-importer grant on real data: scoped list and hidden PO 404 passed.");
  if (restricted) {
    const hidden = await client.query(
      `SELECT id FROM procurement.purchase_order
       WHERE NOT (importer = ANY($1::text[])) ORDER BY id LIMIT 1`,
      [restricted.scopes],
    );
    if (hidden.rowCount) {
      const restrictedList = await get("/api/v1/purchase-orders", "restricted");
      assert.equal(restrictedList.statusCode, 200);
      assert.ok(restrictedList.json().totalCount < 336);
      assert.ok(restrictedList.json().items.every(item => restricted.scopes.includes(item.importer)));
      assert.equal((await get(`/api/v1/purchase-orders/${hidden.rows[0].id}/overview`, "restricted")).statusCode, 404);
      assert.equal((await get(`/api/v1/purchase-orders/${hidden.rows[0].id}/history-items`, "restricted")).statusCode, 404);
      console.log("Restricted importer grant: list scoped and hidden PO returns 404.");
    } else {
      console.log("Restricted importer grant covers all importers; hidden PO check skipped.");
    }
  } else {
    console.log("No active restricted importer grant; hidden PO check skipped.");
  }
  console.log(`RF06 read validation passed: 336 POs, 7 pages, ${total} historical lines on the largest PO, shared IP costs at IP grain, 401/403/404.`);
} finally {
  if (app) await app.close();
  await client.query("ROLLBACK");
  await client.end();
}
