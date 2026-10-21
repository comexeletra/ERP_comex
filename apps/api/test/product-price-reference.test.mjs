import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerCatalogRoutes } from "../dist/catalog.js";

const productId = "00000000-0000-4000-8000-000000000101";

async function createApp(t) {
  const pool = {
    async query(sql, values = []) {
      if (sql.includes("FROM identity.erp_user AS u")) {
        return { rows: [{ role: "Compras", importer_code: "IMPORTER-A" }] };
      }
      if (sql.includes("WITH historical AS")) {
        return { rows: [{ code: "P-1", name: "Produto do catálogo", status: "ACTIVE" }] };
      }
      if (sql.includes("catalog.product_price_reference") && sql.includes("normalized_code")) {
        return { rows: [{ normalized_code: "P-1", ncm_code: "39269090", latest_totvs_description: "Descrição TOTVS",
          latest_totvs_description_purchase_order_number: "030201",
          latest_totvs_description_observed_at: "2026-10-21T12:00:00.000Z",
          reference_prices: [{ currency: "CNY", unitPrice: "12.34000000",
            purchaseOrderNumber: "030201", observedAt: "2026-10-21T12:00:00.000Z" }] }] };
      }
      if (sql.includes("SELECT id FROM catalog.entry") && sql.includes("kind='PRODUCT'")) {
        assert.deepEqual(values, [productId]);
        return { rows: [{ id: productId }], rowCount: 1 };
      }
      if (sql.includes("FROM catalog.product_price_observation") && sql.includes("total_count")) {
        assert.deepEqual(values, [productId, 25, 0]);
        return { rows: [{ total_count: 1, items: [{ id: "price-1", currency: "CNY",
          unitPrice: "12.34000000", purchaseOrderItemId: "item-1", purchaseOrderNumber: "030201",
          observedAt: "2026-10-21T12:00:00.000Z", actor: "hml#buyer" }] }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    if (request.headers["x-test-subject"]) request.authContext = {
      issuer: "hml", subject: String(request.headers["x-test-subject"]),
      userId: "00000000-0000-4000-8000-000000000001", sessionToken: "test-only",
    };
  });
  await registerCatalogRoutes(app, pool);
  return app;
}

test("product options expose the current TOTVS description and prices by currency", async t => {
  const app = await createApp(t);
  const response = await app.inject({ method: "GET", url: "/api/v1/products/options?importer=IMPORTER-A",
    headers: { "x-test-subject": "buyer" } });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().items[0], { code: "P-1", name: "Produto do catálogo", status: "ACTIVE",
    ncmCode: "39269090", latestTotvsDescription: "Descrição TOTVS",
    latestTotvsDescriptionPurchaseOrderNumber: "030201", latestTotvsDescriptionObservedAt: "2026-10-21T12:00:00.000Z",
    referencePrices: [{ currency: "CNY", unitPrice: "12.34000000",
      purchaseOrderNumber: "030201", observedAt: "2026-10-21T12:00:00.000Z" }] });
});

test("product price history validates product visibility and returns its origin", async t => {
  const app = await createApp(t);
  const response = await app.inject({ method: "GET", url: `/api/v1/products/${productId}/price-history`,
    headers: { "x-test-subject": "buyer" } });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { page: 1, pageSize: 25, totalCount: 1,
    items: [{ id: "price-1", currency: "CNY", unitPrice: "12.34000000", purchaseOrderItemId: "item-1",
      purchaseOrderNumber: "030201",
      observedAt: "2026-10-21T12:00:00.000Z", actor: "hml#buyer" }] });
});
