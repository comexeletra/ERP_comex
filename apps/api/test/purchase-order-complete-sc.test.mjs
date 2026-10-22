import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerFollowupRoutes } from "../dist/followup.js";

const actorId = "00000000-0000-4000-8000-000000000010";
const generatedScId = "00000000-0000-4000-8000-000000000011";
const poId = "00000000-0000-4000-8000-000000000012";
const itemId = "00000000-0000-4000-8000-000000000013";
const existingScId = "00000000-0000-4000-8000-000000000014";

const newRequest = { scNumber: "HMLVAL-SC-01", requester: "Solicitante sintético", scDate: null,
  approvalDate: null, commercialPlanReceivedDate: null };
const payload = { header: { importer: "ELETRA MATRIZ", number: "HMLVAL-PO-01", supplierText: "SUP-1",
  purchaseRequestId: null, newPurchaseRequest: newRequest, orderDate: null, notes: "", reason: "Validação HML" },
items: [{ base: { externalLineReference: "0001", productCode: "PROD-1", description: "Produto teste",
  orderedQuantity: "1", unit: "UN", unitPrice: "2", currency: "CNY", reason: "Validação HML" }, fields: {} }] };

async function createFixture(t, { existingRequest = null, role = "Compras" } = {}) {
  const queries = [];
  const receipts = new Map();
  let purchaseRequestInsertCount = 0;
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("SELECT payload_sha256, resource_type, resource_id")) {
        const receipt = receipts.get(params[1]);
        return { rows: receipt ? [receipt] : [], rowCount: receipt ? 1 : 0 };
      }
      if (sql.includes("SELECT id FROM procurement.purchase_order_item")) {
        return { rows: [{ id: itemId }], rowCount: 1 };
      }
      if (sql.includes("SELECT purchase_request_id FROM procurement.purchase_order")) {
        return { rows: [{ purchase_request_id: existingRequest?.id ?? generatedScId }], rowCount: 1 };
      }
      if (sql.includes("entity_key='IMPORTER'")) return { rows: [{ cnpj: "12.345.678/0001-90" }], rowCount: 1 };
      if (sql.includes("FROM procurement.purchase_order") && sql.includes("normalized_number")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM catalog.entry") && sql.includes("kind='SUPPLIER'")) {
        return { rows: [{ id: "supplier-id", code: "SUP-1", name: "Fornecedor" }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO procurement.purchase_request")) {
        if (existingRequest) return { rows: [], rowCount: 0 };
        purchaseRequestInsertCount += 1;
        return { rows: [{ id: generatedScId }], rowCount: 1 };
      }
      if (sql.includes("SELECT id FROM procurement.purchase_request") && sql.includes("normalized_sc_number")) {
        return { rows: existingRequest ? [{ id: existingRequest.id }] : [], rowCount: existingRequest ? 1 : 0 };
      }
      if (sql.includes("FROM procurement.purchase_request AS request")) {
        const request = existingRequest ?? { id: generatedScId, importer: "ELETRA MATRIZ", supplier_text: "SUP-1",
          supplier_code: "SUP-1", sc_number: newRequest.scNumber, sc_date: null, approval_date: null,
          requester: newRequest.requester, commercial_plan_received_date: null };
        return { rows: [request], rowCount: 1 };
      }
      if (sql.includes("FROM catalog.entry") && sql.includes("kind='PRODUCT'")) {
        return { rows: [{ normalized_code: "PROD-1", product_ncm_code: null }], rowCount: 1 };
      }
      if (sql.includes("entity_key='UNIT_OF_MEASURE'")) return { rows: [{ normalized_value: "UN" }], rowCount: 1 };
      if (sql.includes("INSERT INTO procurement.purchase_order") && sql.includes("purchase_request_id")) {
        return { rows: [{ orderDate: "2026-10-21" }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO procurement.operational_command_receipt")) {
        receipts.set(params[1], { payload_sha256: params[2], resource_type: params[3], resource_id: params[4] });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const pool = {
    async query(sql) {
      if (sql.includes("identity.erp_user AS u")) return { rows: [{ role, importer_code: "ELETRA MATRIZ" }] };
      return { rows: [] };
    },
    async connect() { return client; },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    request.authContext = { issuer: "ci", subject: "buyer", userId: actorId, displayName: null, sessionToken: "ci" };
  });
  await registerFollowupRoutes(app, pool);
  return { app, queries, get purchaseRequestInsertCount() { return purchaseRequestInsertCount; } };
}

test("PO writer creates a new SC in the PO transaction and audits it with the PO reason", async t => {
  const fixture = await createFixture(t);
  const response = await fixture.app.inject({ method: "POST", url: "/api/v1/purchase-orders/complete",
    headers: { "content-type": "application/json", "idempotency-key": "complete-sc-create" }, payload });

  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().purchaseRequestId, generatedScId);
  assert.equal(fixture.purchaseRequestInsertCount, 1);
  const insert = fixture.queries.find(query => query.sql.includes("INSERT INTO procurement.purchase_request"));
  assert.ok(insert.sql.includes("ON CONFLICT (importer, normalized_sc_number) DO NOTHING"));
  assert.equal(insert.params[0], "ELETRA MATRIZ");
  assert.equal(insert.params[1], newRequest.scNumber);
  assert.equal(insert.params[2], "SUP-1");
  assert.equal(insert.params[7], "ci#buyer");
  const itemScFields = fixture.queries.find(query => query.sql.includes("UPDATE procurement.purchase_order_item SET sc_number"));
  assert.deepEqual(itemScFields.params.slice(1), [newRequest.scNumber, null, null, newRequest.requester, null]);
  const audit = fixture.queries.find(query => query.sql.includes("INSERT INTO audit.audit_log")
    && query.params[5] === "CREATE" && query.params[3] === "PURCHASE_REQUEST");
  assert.equal(audit.params[9], "Validação HML");
});

test("a same-supplier SC is reused and the PO response includes its id", async t => {
  const existingRequest = { id: existingScId, importer: "ELETRA MATRIZ", supplier_text: "SUP-1", supplier_code: "SUP-1",
    sc_number: "HMLVAL-SC-01", sc_date: null, approval_date: null, requester: "Solicitante existente",
    commercial_plan_received_date: null };
  const fixture = await createFixture(t, { existingRequest });
  const response = await fixture.app.inject({ method: "POST", url: "/api/v1/purchase-orders/complete",
    headers: { "content-type": "application/json", "idempotency-key": "complete-sc-existing" }, payload });

  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().purchaseRequestId, existingScId);
  assert.equal(fixture.purchaseRequestInsertCount, 0);
});

test("a same-number SC with another supplier is rejected without creating a PO", async t => {
  const fixture = await createFixture(t, { existingRequest: { id: existingScId, importer: "ELETRA MATRIZ",
    supplier_text: "SUP-2", supplier_code: "SUP-2", sc_number: newRequest.scNumber } });
  const response = await fixture.app.inject({ method: "POST", url: "/api/v1/purchase-orders/complete",
    headers: { "content-type": "application/json", "idempotency-key": "complete-sc-mismatch" }, payload });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, "PURCHASE_REQUEST_SUPPLIER_MISMATCH");
  assert.equal(fixture.queries.some(query => query.sql.includes("INSERT INTO procurement.purchase_order (")), false);
  assert.equal(fixture.queries.some(query => query.sql.includes("INSERT INTO audit.audit_log")), false);
});

test("missing requester and conflicting SC choices return 400; Compras needs no SC-write permission", async t => {
  const fixture = await createFixture(t, { role: "Compras" });
  const headers = { "content-type": "application/json", "idempotency-key": "complete-sc-invalid" };
  const conflict = await fixture.app.inject({ method: "POST", url: "/api/v1/purchase-orders/complete", headers,
    payload: { ...payload, header: { ...payload.header, purchaseRequestId: existingScId } } });
  assert.equal(conflict.statusCode, 400);
  assert.equal(conflict.json().code, "PURCHASE_REQUEST_CHOICE_CONFLICT");

  const noRequester = await fixture.app.inject({ method: "POST", url: "/api/v1/purchase-orders/complete",
    headers: { ...headers, "idempotency-key": "complete-sc-no-requester" },
    payload: { ...payload, header: { ...payload.header, newPurchaseRequest: { ...newRequest, requester: " " } } } });
  assert.equal(noRequester.statusCode, 400);
  assert.equal(fixture.queries.some(query => query.sql.includes("INSERT INTO procurement.purchase_request")), false);
});

test("replaying the same idempotency key returns the same PO and SC id", async t => {
  const fixture = await createFixture(t);
  const headers = { "content-type": "application/json", "idempotency-key": "complete-sc-replay" };
  const first = await fixture.app.inject({ method: "POST", url: "/api/v1/purchase-orders/complete", headers, payload });
  const second = await fixture.app.inject({ method: "POST", url: "/api/v1/purchase-orders/complete", headers, payload });

  assert.equal(first.statusCode, 201, first.body);
  assert.equal(second.statusCode, 201, second.body);
  assert.equal(second.json().id, first.json().id);
  assert.equal(second.json().purchaseRequestId, generatedScId);
  assert.equal(fixture.purchaseRequestInsertCount, 1);
});
