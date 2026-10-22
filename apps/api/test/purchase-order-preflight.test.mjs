import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerPurchaseOrderReadRoutes } from "../dist/purchase-orders.js";

async function preflightApp(t, duplicates = [{ importer: "ELETRA MANAUS", lifecycle_status: "ACTIVE" }]) {
  const pool = { async query(sql, params = []) {
    if (sql.includes("catalog.operational_value")) assert.doesNotMatch(sql, /\bstatus\s*=/iu);
    if (sql.includes("FROM identity.erp_user AS u")) return { rows: [{ role: "Master", importer_code: "ELETRA MATRIZ" }] };
    if (sql.includes("SELECT DISTINCT importer FROM procurement.purchase_order")) {
      return { rows: [{ importer: "ELETRA MATRIZ" }] };
    }
    if (sql.includes("normalized_number")) {
      assert.match(sql, /lifecycle_status/u);
      return { rows: duplicates };
    }
    if (sql.includes("entity_key='IMPORTER'")) return { rows: [{ cnpj: "12.345.678/0001-90" }] };
    if (sql.includes("kind='SUPPLIER'")) return { rows: [] };
    if (sql.includes("kind='PRODUCT'")) return { rows: [{ normalized_code: "PRESENT", product_ncm_code: "39269090",
      latest_totvs_description: "Descrição TOTVS", reference_prices: [{ currency: "CNY", unitPrice: "12.5",
        purchaseOrderNumber: "PO-1", observedAt: "2026-10-21T12:00:00.000Z" }] }] };
    if (sql.includes("entity_key='UNIT_OF_MEASURE'")) return { rows: [{ normalized_value: "UN" }] };
    if (sql.includes("entity_key='COST_CENTER'")) return { rows: [{ normalized_value: "1202027" }] };
    return { rows: [] };
  } };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    request.authContext = { issuer: "ci", subject: "master", userId: "00000000-0000-4000-8000-000000000001",
      displayName: null, sessionToken: "ci" };
  });
  await registerPurchaseOrderReadRoutes(app, pool);
  return app;
}

test("PO preflight returns scoped duplicates and catalog gaps", async t => {
  const app = await preflightApp(t);
  const response = await app.inject({ method: "POST", url: "/api/v1/purchase-orders/preflight",
    headers: { "content-type": "application/json", "x-test-subject": "master" },
    payload: { importer: "ELETRA MATRIZ", number: "030201", supplierCode: "SUP-MISSING",
      productCodes: ["PRESENT", "MISSING"], units: ["UN", "BOX"], costCenters: ["1202027", "999"] },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().otherImporterDuplicates, ["ELETRA MANAUS"]);
  assert.equal(response.json().sameImporterDuplicate, false);
  assert.equal(response.json().sameImporterDeleted, false);
  assert.equal(response.json().sameImporterDeletedPurchaseOrder, null);
  assert.equal(response.json().supplierFound, false);
  assert.deepEqual(response.json().missingProducts, ["MISSING"]);
  assert.deepEqual(response.json().productReferences, [{ productCode: "PRESENT", ncmCode: "39269090",
    latestTotvsDescription: "Descrição TOTVS", referencePrices: [{ currency: "CNY", unitPrice: "12.5",
      purchaseOrderNumber: "PO-1", observedAt: "2026-10-21T12:00:00.000Z" }] }]);
  assert.deepEqual(response.json().missingUnits, ["BOX"]);
  assert.deepEqual(response.json().missingCostCenters, ["999"]);
});

test("PO preflight ignores deleted POs and reports a deleted PO in the same importer", async t => {
  const app = await preflightApp(t, [{ id: "deleted-other", importer: "ELETRA MANAUS", lifecycle_status: "DELETED",
    version: "2", source_kind: "MANUAL_TOTVS_REFERENCE" },
  { id: "00000000-0000-4000-8000-000000000009", importer: "ELETRA MATRIZ", lifecycle_status: "DELETED",
    version: "4", source_kind: "MANUAL_TOTVS_REFERENCE" }]);
  const response = await app.inject({ method: "POST", url: "/api/v1/purchase-orders/preflight",
    headers: { "content-type": "application/json", "x-test-subject": "master" },
    payload: { importer: "ELETRA MATRIZ", number: "030201" },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().otherImporterDuplicates, []);
  assert.equal(response.json().sameImporterDuplicate, false);
  assert.equal(response.json().sameImporterDeleted, true);
  assert.deepEqual(response.json().sameImporterDeletedPurchaseOrder,
    { id: "00000000-0000-4000-8000-000000000009", version: "4", replaceSupported: true });
});

test("PO preflight reports historical deleted POs as not replaceable", async t => {
  const app = await preflightApp(t, [{ id: "00000000-0000-4000-8000-000000000008", importer: "ELETRA MATRIZ",
    lifecycle_status: "DELETED", version: "7", source_kind: "HISTORICAL_SNAPSHOT" }]);
  const response = await app.inject({ method: "POST", url: "/api/v1/purchase-orders/preflight",
    headers: { "content-type": "application/json", "x-test-subject": "master" },
    payload: { importer: "ELETRA MATRIZ", number: "030201" },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().sameImporterDeletedPurchaseOrder,
    { id: "00000000-0000-4000-8000-000000000008", version: "7", replaceSupported: false });
});

test("PO preflight rejects invalid requests and importers outside scope", async t => {
  const app = await preflightApp(t);
  const invalid = await app.inject({ method: "POST", url: "/api/v1/purchase-orders/preflight",
    headers: { "content-type": "application/json", "x-test-subject": "master" }, payload: { number: "030201" } });
  assert.equal(invalid.statusCode, 400);
  const outsideScope = await app.inject({ method: "POST", url: "/api/v1/purchase-orders/preflight",
    headers: { "content-type": "application/json", "x-test-subject": "master" },
    payload: { importer: "OUTSIDE", number: "030201" },
  });
  assert.equal(outsideScope.statusCode, 404);
});
