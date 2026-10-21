import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerOperationalRoutes } from "../dist/operations.js";
import { registerFollowupRoutes } from "../dist/followup.js";

const poId = "00000000-0000-4000-8000-000000000001";
const itemId = "00000000-0000-4000-8000-000000000002";
const sha = "a".repeat(64);

async function appWithState(t, { role = "Master", activeAllocations = false, destinationCnpj = "12.345.678/0002-80",
  duplicateDestination = false, itemStatus = null } = {}) {
  const state = { po: { id: poId, importer: "ELETRA MATRIZ", external_number: "PO-030201",
    normalized_number: "PO-030201", source_kind: "MANUAL_TOTVS_REFERENCE", lifecycle_status: "ACTIVE",
    purchase_request_id: null, supplier_text: "SUP-1", version: "3" },
  item: { id: itemId, purchase_order_id: poId, external_line_reference: "0001", product_code: "PRODUCT-1",
    description: "Descrição atual", ordered_quantity: "2.00000000", unit_price: "4.00000000",
    currency_code: "CNY", source_status: itemStatus, version: "1" } };
  const queries = [];
  const client = { async query(sql, params = []) {
    queries.push({ sql, params });
    if (sql.includes("entity_key='IMPORTER'")) assert.doesNotMatch(sql, /\bstatus\s*=/iu);
    if (sql.includes("SELECT * FROM procurement.purchase_order WHERE") && sql.includes("FOR UPDATE")) {
      return { rows: state.po.importer === params[1][0] || params[1].includes(state.po.importer) ? [{ ...state.po }] : [], rowCount: 1 };
    }
    if (sql.includes("SELECT * FROM procurement.purchase_order_item WHERE id=$1") && sql.includes("FOR UPDATE")) {
      return { rows: state.item.id === params[0] ? [{ ...state.item }] : [], rowCount: state.item.id === params[0] ? 1 : 0 };
    }
    if (sql.includes("SELECT * FROM procurement.purchase_order_item") && sql.includes("WHERE purchase_order_id")) {
      return { rows: [{ ...state.item }], rowCount: 1 };
    }
    if (sql.includes("SELECT EXISTS") && sql.includes("po_item_allocation")) {
      return { rows: [{ has_active_allocations: activeAllocations }], rowCount: 1 };
    }
    if (sql.includes("entity_key='IMPORTER'")) return { rows: [{ cnpj: destinationCnpj }], rowCount: 1 };
    if (sql.includes("UPDATE procurement.purchase_order AS po SET supplier_text")) {
      state.po.importer = params.at(-1);
      state.po.version = String(Number(state.po.version) + 1);
      return { rows: [{ id: poId, version: state.po.version }], rowCount: 1 };
    }
    if (sql.includes("UPDATE procurement.purchase_order AS po") && sql.includes("SET external_number=$2")) {
      state.po.importer = params.at(-1);
      state.po.version = String(Number(state.po.version) + 1);
      return { rows: [{ version: state.po.version }], rowCount: 1 };
    }
    if (sql.includes("normalized_number") && sql.includes("purchase_order")) {
      return { rows: duplicateDestination ? [{ id: "duplicate-po" }] : [], rowCount: duplicateDestination ? 1 : 0 };
    }
    if (sql.includes("UPDATE procurement.purchase_order_item SET source_status")) {
      state.item.source_status = "CANCELLED";
      return { rows: [{ ...state.item }], rowCount: 1 };
    }
    if (sql.includes("UPDATE procurement.purchase_order_item SET description")) {
      state.item.description = params[1]; state.item.ordered_quantity = params[2];
      state.item.unit_price = params[3]; state.item.currency_code = params[4];
      return { rows: [{ ...state.item }], rowCount: 1 };
    }
    if (sql.includes("UPDATE procurement.purchase_order SET version")) {
      state.po.version = String(Number(state.po.version) + 1);
      return { rows: [{ version: state.po.version }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  }, release() {} };
  const pool = {
    async query(sql, params = []) {
      if (sql.includes("FROM identity.erp_user AS u")) return { rows: [
        { role, importer_code: "ELETRA MATRIZ" }, { role, importer_code: "ELETRA MANAUS" }], rowCount: 2 };
      if (sql.includes("SELECT DISTINCT importer FROM procurement.purchase_order")) {
        return { rows: [{ importer: "ELETRA MATRIZ" }, { importer: "ELETRA MANAUS" }], rowCount: 2 };
      }
      if (sql.includes("FROM procurement.purchase_order_item") && sql.includes("purchase_order_id=$1")) {
        return { rows: [{ ...state.item }], rowCount: 1 };
      }
      if (sql.includes("FROM procurement.purchase_order WHERE id=$1")) return { rows: [{ ...state.po }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }, async connect() { return client; },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    request.authContext = { issuer: "ci", subject: "reconciler", userId: poId,
      displayName: null, sessionToken: "ci" };
  });
  await registerOperationalRoutes(app, pool);
  await registerFollowupRoutes(app, pool);
  return { app, queries, state };
}

const reimportPayload = { header: { number: "PO-030201" }, fileName: "PO 030201.xlsx", fileSha256: sha,
  currency: "CNY", reason: "Conferência da planilha", items: [{ externalLineReference: "0001",
    productCode: "PRODUCT-1", description: "Descrição atual", orderedQuantity: "2", unitPrice: "4" }] };

test("reimport preview matches external line references and reports only changed values", async t => {
  const { app } = await appWithState(t);
  const { reason: _unusedReason, ...previewPayload } = reimportPayload;
  const same = await app.inject({ method: "POST", url: `/api/v1/purchase-orders/${poId}/reimport/preview`, payload: previewPayload });
  assert.equal(same.statusCode, 200, same.body);
  assert.deepEqual(same.json().differences, []);
  const changed = await app.inject({ method: "POST", url: `/api/v1/purchase-orders/${poId}/reimport/preview`,
    payload: { ...previewPayload, items: [{ ...reimportPayload.items[0], unitPrice: "5" }] } });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.deepEqual(changed.json().differences, [{ externalLineReference: "0001", productCode: "PRODUCT-1",
    changes: { unitPrice: { before: "4.00000000", after: "5" } } }]);
});

test("reimport apply updates the diff in one transaction with source file audit and outbox", async t => {
  const { app, queries, state } = await appWithState(t);
  const response = await app.inject({ method: "POST", url: `/api/v1/purchase-orders/${poId}/reimport`,
    headers: { "x-record-version": "3" },
    payload: { ...reimportPayload, items: [{ ...reimportPayload.items[0], unitPrice: "5" }] } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(state.item.unit_price, "5");
  assert.ok(queries.some(query => query.sql === "COMMIT"));
  assert.ok(queries.some(query => query.sql.includes("INSERT INTO audit.audit_log")
    && query.params[5] === "UPDATE" && query.params[7].includes("PO 030201.xlsx")
    && query.params[7].includes(sha)));
  assert.ok(queries.some(query => query.sql.includes("INSERT INTO audit.outbox_message")));
});

test("item removal is logical, versioned, reasoned, and blocked by active allocations", async t => {
  const blocked = await appWithState(t, { activeAllocations: true });
  const denied = await blocked.app.inject({ method: "POST", url: `/api/v1/purchase-orders/${poId}/items/${itemId}/remove`,
    headers: { "x-record-version": "3" }, payload: { reason: "Item duplicado" } });
  assert.equal(denied.statusCode, 409);
  assert.equal(denied.json().code, "PO_ITEM_HAS_ACTIVE_ALLOCATIONS");
  assert.equal(blocked.state.item.source_status, null);

  const allowed = await appWithState(t);
  const response = await allowed.app.inject({ method: "POST", url: `/api/v1/purchase-orders/${poId}/items/${itemId}/remove`,
    headers: { "x-record-version": "3" }, payload: { reason: "Item duplicado" } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(allowed.state.item.source_status, "CANCELLED");
  assert.ok(allowed.queries.some(query => query.sql.includes("INSERT INTO audit.audit_log") && query.params[5] === "REMOVE"));
  assert.ok(allowed.queries.some(query => query.sql.includes("INSERT INTO audit.outbox_message")));
});

test("importer change is limited to Master/Administrator and checks active allocations, CNPJ, and destination duplicates", async t => {
  const body = { number: "PO-030201", importer: "ELETRA MANAUS", supplierText: "SUP-1",
    orderDate: null, notes: "", purchaseRequestId: null, reason: "Correção de importadora" };
  const writer = await appWithState(t, { role: "Compras" });
  const forbidden = await writer.app.inject({ method: "PATCH", url: `/api/v1/purchase-orders/${poId}`,
    headers: { "x-record-version": "3" }, payload: body });
  assert.equal(forbidden.statusCode, 403);
  assert.equal(writer.state.po.importer, "ELETRA MATRIZ");

  for (const options of [{ activeAllocations: true }, { destinationCnpj: null }, { duplicateDestination: true }]) {
    const blocked = await appWithState(t, options);
    const response = await blocked.app.inject({ method: "PATCH", url: `/api/v1/purchase-orders/${poId}`,
      headers: { "x-record-version": "3" }, payload: body });
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(blocked.state.po.importer, "ELETRA MATRIZ");
  }

  const allowed = await appWithState(t);
  const response = await allowed.app.inject({ method: "PATCH", url: `/api/v1/purchase-orders/${poId}`,
    headers: { "x-record-version": "3" }, payload: body });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(allowed.state.po.importer, "ELETRA MANAUS");
  assert.ok(allowed.queries.some(query => query.sql.includes("INSERT INTO audit.audit_log") && query.params[5] === "UPDATE"));
  assert.ok(allowed.queries.some(query => query.sql.includes("INSERT INTO audit.outbox_message")));
});

test("the complete PO save applies an approved importer change with its shared fields in one transaction", async t => {
  const { app, queries, state } = await appWithState(t);
  const response = await app.inject({ method: "PATCH", url: `/api/v1/purchase-orders/${poId}/complete`,
    headers: { "x-record-version": "3" }, payload: { header: { number: "PO-030201", importer: "ELETRA MANAUS",
      supplierText: "SUP-1", orderDate: null, notes: "", purchaseRequestId: null, reason: "Correção de importadora" },
    itemIds: [], fields: {} } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(state.po.importer, "ELETRA MANAUS");
  assert.ok(queries.some(query => query.sql === "COMMIT"));
  assert.ok(queries.some(query => query.sql.includes("UPDATE procurement.purchase_order AS po")
    && query.sql.includes("SET external_number=$2") && query.params.at(-1) === "ELETRA MANAUS"));
});
