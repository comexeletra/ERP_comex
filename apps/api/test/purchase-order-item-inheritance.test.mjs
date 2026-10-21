import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerOperationalRoutes } from "../dist/operations.js";

const poId = "00000000-0000-4000-8000-000000000001";
const requestId = "00000000-0000-4000-8000-000000000002";

test("legacy item creation copies fields from its linked SC and audits them", async t => {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("SELECT * FROM procurement.purchase_order WHERE id = $1")) {
        return { rows: [{ id: poId, importer: "ELETRA MATRIZ", version: "1", lifecycle_status: "ACTIVE",
          purchase_request_id: requestId, supplier_text: "SUP-1" }], rowCount: 1 };
      }
      if (sql.includes("FROM procurement.purchase_request AS request")) {
        return { rows: [{ id: requestId, importer: "ELETRA MATRIZ", supplier_code: "SUP-1",
          sc_number: "SC-28", sc_date: "2026-10-01", approval_date: "2026-10-02",
          requester: "Pessoa solicitante", commercial_plan_received_date: "2026-10-03" }], rowCount: 1 };
      }
      if (sql.includes("FROM catalog.entry") && sql.includes("kind='PRODUCT'")) {
        return { rows: [{ normalized_code: "PRODUCT-1", product_ncm_code: null }], rowCount: 1 };
      }
      if (sql.includes("entity_key='UNIT_OF_MEASURE'")) return { rows: [{ normalized_value: "UN" }], rowCount: 1 };
      if (sql.includes("max(line_number)")) return { rows: [{ line_number: 1 }], rowCount: 1 };
      if (sql.includes("UPDATE procurement.purchase_order SET version")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const pool = {
    async query(sql) {
      if (sql.includes("FROM identity.erp_user AS u")) {
        return { rows: [{ role: "Compras", importer_code: "ELETRA MATRIZ" }] };
      }
      return { rows: [] };
    },
    async connect() { return client; },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    request.authContext = { issuer: "ci", subject: "buyer", userId: poId, displayName: null, sessionToken: "ci" };
  });
  await registerOperationalRoutes(app, pool);

  const response = await app.inject({ method: "POST", url: `/api/v1/purchase-orders/${poId}/items`,
    headers: { "content-type": "application/json", "idempotency-key": "po-item-with-sc" },
    payload: { externalLineReference: "0001", productCode: "PRODUCT-1", description: "Item da PO",
      orderedQuantity: "2", unit: "UN", unitPrice: "4.25", currency: "CNY", reason: "Item conferido" },
  });

  assert.equal(response.statusCode, 201, response.body);
  const scUpdate = queries.find(query => query.sql.includes("SET sc_number=$2"));
  assert.ok(scUpdate, "deve gravar os campos compartilhados da SC no item novo");
  assert.deepEqual(scUpdate.params.slice(1), ["SC-28", "2026-10-01", "2026-10-02", "Pessoa solicitante", "2026-10-03"]);
  const auditedFields = queries.find(query => query.sql.includes("INSERT INTO audit.audit_log")
    && query.params[5] === "FOLLOWUP_UPDATE");
  assert.ok(auditedFields, "deve auditar a cópia dos campos da SC");
  assert.deepEqual(JSON.parse(auditedFields.params[7]), { scNumber: "SC-28", scDate: "2026-10-01",
    scApprovalDate: "2026-10-02", requester: "Pessoa solicitante", commercialPlanReceivedDate: "2026-10-03" });
});
