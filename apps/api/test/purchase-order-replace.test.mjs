import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { calculatePurchaseOrderReplacePlan, registerOperationalRoutes } from "../dist/operations.js";

const poId = "00000000-0000-4000-8000-000000000001";
const sha = "b".repeat(64);
const itemIds = {
  updated: "00000000-0000-4000-8000-000000000011", removed: "00000000-0000-4000-8000-000000000012",
  cancelled: "00000000-0000-4000-8000-000000000013", changed: "00000000-0000-4000-8000-000000000014",
  same: "00000000-0000-4000-8000-000000000015",
};

function currentItems() {
  const base = { purchase_order_id: poId, unit: "UN", currency_code: "CNY", cost_center: "1202027", ncm: "39269090" };
  return [
    { ...base, id: itemIds.updated, line_number: 1, external_line_reference: "0001", product_code: "PRODUCT-1",
      description: "Produto 1", ordered_quantity: "2.00000000", unit_price: "4.00000000", source_status: null },
    { ...base, id: itemIds.removed, line_number: 2, external_line_reference: "0002", product_code: "PRODUCT-2",
      description: "Produto 2", ordered_quantity: "1.00000000", unit_price: "1.00000000", source_status: null },
    { ...base, id: itemIds.cancelled, line_number: 3, external_line_reference: "0003", product_code: "PRODUCT-3",
      description: "Produto 3", ordered_quantity: "1.00000000", unit_price: "1.00000000", source_status: "CANCELLED" },
    { ...base, id: itemIds.changed, line_number: 4, external_line_reference: "0004", product_code: "PRODUCT-4",
      description: "Produto 4", ordered_quantity: "1.00000000", unit_price: "1.00000000", source_status: null },
    { ...base, id: itemIds.same, line_number: 5, external_line_reference: "0005", product_code: "PRODUCT-5",
      description: "Produto 5", ordered_quantity: "1.00000000", unit_price: "1.00000000", source_status: null },
  ];
}

const incomingItems = [
  { externalLineReference: "0001", productCode: "PRODUCT-1", description: "Produto 1", orderedQuantity: "2",
    unitPrice: "5", unit: "UN", costCenter: "1202027" },
  { externalLineReference: "0003", productCode: "PRODUCT-3", description: "Produto 3", orderedQuantity: "3",
    unitPrice: "1", unit: "UN", costCenter: "1202027" },
  { externalLineReference: "0004", productCode: "PRODUCT-9", description: "Produto 9", orderedQuantity: "1",
    unitPrice: "2", unit: "UN", costCenter: "1202027" },
  { externalLineReference: "0005", productCode: "PRODUCT-5", description: "Produto 5", orderedQuantity: "1",
    unitPrice: "1", unit: "UN", costCenter: "1202027" },
  { externalLineReference: "0006", productCode: "PRODUCT-6", description: "Produto 6", orderedQuantity: "4",
    unitPrice: "3", unit: "UN", costCenter: "1202027" },
];

const replacePayload = { header: { number: "PO-030201", supplierCode: "SUP-1" }, fileName: "PO 030201.xlsx",
  fileSha256: sha, currency: "CNY", items: incomingItems };

test("replace plan classifies updated, added, removed, reactivated and product-changed lines", () => {
  const plan = calculatePurchaseOrderReplacePlan(currentItems(), incomingItems, "CNY");
  assert.deepEqual(plan.updated, [{ itemId: itemIds.updated, externalLineReference: "0001", productCode: "PRODUCT-1",
    changes: { unitPrice: { before: "4.00000000", after: "5" } } }]);
  assert.deepEqual(plan.added, [{ externalLineReference: "0006", productCode: "PRODUCT-6" }]);
  assert.deepEqual(plan.removed, [{ itemId: itemIds.removed, externalLineReference: "0002", productCode: "PRODUCT-2" }]);
  assert.deepEqual(plan.reactivated, [{ itemId: itemIds.cancelled, externalLineReference: "0003", productCode: "PRODUCT-3" }]);
  assert.deepEqual(plan.productChanged, [{ itemId: itemIds.changed, externalLineReference: "0004",
    currentProductCode: "PRODUCT-4", productCode: "PRODUCT-9" }]);
});

test("replace plan removes active items without a line reference", () => {
  const rows = [{ ...currentItems()[0], id: itemIds.removed, external_line_reference: null, line_number: 7 }];
  const plan = calculatePurchaseOrderReplacePlan(rows, [incomingItems[0]], "CNY");
  assert.deepEqual(plan.removed, [{ itemId: itemIds.removed, externalLineReference: "linha 7 sem Item", productCode: "PRODUCT-1" }]);
  assert.deepEqual(plan.added, [{ externalLineReference: "0001", productCode: "PRODUCT-1" }]);
});

async function replaceApp(t, { role = "Master", status = "DELETED", sourceKind = "MANUAL_TOTVS_REFERENCE",
  supplier = "SUP-1", allocatedItemIds = [], products = ["PRODUCT-1", "PRODUCT-3", "PRODUCT-5", "PRODUCT-6", "PRODUCT-9"] } = {}) {
  const state = {
    po: { id: poId, importer: "ELETRA MATRIZ", external_number: "PO-030201", normalized_number: "PO-030201",
      source_kind: sourceKind, lifecycle_status: status, lifecycle_changed_at: null, lifecycle_changed_by: null,
      lifecycle_reason: null, purchase_request_id: null, supplier_text: supplier, version: "3" },
    items: currentItems(),
  };
  const queries = [];
  const client = { async query(sql, params = []) {
    queries.push({ sql, params });
    if (sql.includes("SELECT * FROM procurement.purchase_order WHERE id = $1")) {
      return { rows: params[1].includes(state.po.importer) ? [{ ...state.po }] : [], rowCount: 1 };
    }
    if (sql.includes("SELECT * FROM procurement.purchase_order_item") && sql.includes("purchase_order_id=$1")) {
      return { rows: state.items.map(item => ({ ...item })), rowCount: state.items.length };
    }
    if (sql.includes("FROM procurement.po_item_allocation") && sql.includes("ANY($1::uuid[])")) {
      const rows = params[0].filter(id => allocatedItemIds.includes(id)).map(item_id => ({ item_id }));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("FROM catalog.entry") && sql.includes("kind='PRODUCT'")) {
      const rows = params[0].filter(code => products.includes(code))
        .map(normalized_code => ({ normalized_code, product_ncm_code: "85049090" }));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("entity_key='UNIT_OF_MEASURE'")) {
      return { rows: params[0].map(normalized_value => ({ normalized_value })), rowCount: params[0].length };
    }
    if (sql.includes("entity_key='COST_CENTER'")) {
      return { rows: params[0].map(normalized_value => ({ normalized_value })), rowCount: params[0].length };
    }
    if (sql.includes("UPDATE procurement.purchase_order SET lifecycle_status")) {
      state.po.lifecycle_status = params[1];
      state.po.version = String(Number(state.po.version) + 1);
      return { rows: [{ version: state.po.version, lifecycle_changed_at: null, lifecycle_changed_by: null,
        lifecycle_reason: null }], rowCount: 1 };
    }
    if (sql.includes("UPDATE procurement.purchase_order SET version")) {
      state.po.version = String(Number(state.po.version) + 1);
      return { rows: [{ version: state.po.version }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO procurement.purchase_order_item")) {
      state.items.push({ id: params[0], purchase_order_id: params[1], line_number: params[2],
        external_line_reference: params[3], product_code: params[4], description: params[5],
        ordered_quantity: params[6], unit: params[7], unit_price: params[8], currency_code: params[9],
        ncm: params[10], cost_center: params[11], source_status: null });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("UPDATE procurement.purchase_order_item SET source_status='CANCELLED'")) {
      const item = state.items.find(row => row.id === params[0]);
      item.source_status = "CANCELLED";
      return { rows: [{ ...item }], rowCount: 1 };
    }
    if (sql.includes("UPDATE procurement.purchase_order_item SET product_code")) {
      const item = state.items.find(row => row.id === params[0]);
      Object.assign(item, { product_code: params[1], description: params[2], ordered_quantity: params[3],
        unit: params[4], unit_price: params[5], currency_code: params[6], source_status: null });
      return { rows: [{ ...item }], rowCount: 1 };
    }
    if (sql.includes("UPDATE procurement.purchase_order_item SET description")) {
      const item = state.items.find(row => row.id === params[0]);
      Object.assign(item, { description: params[1], ordered_quantity: params[2], unit_price: params[3],
        currency_code: params[4] });
      return { rows: [{ ...item }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  }, release() {} };
  const pool = {
    async query(sql, params = []) {
      if (sql.includes("FROM identity.erp_user AS u")) return { rows: [{ role, importer_code: "ELETRA MATRIZ" }], rowCount: 1 };
      if (sql.includes("SELECT DISTINCT importer FROM procurement.purchase_order")) {
        return { rows: [{ importer: "ELETRA MATRIZ" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }, async connect() { return client; },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    request.authContext = { issuer: "ci", subject: "replacer", userId: poId, displayName: null, sessionToken: "ci" };
  });
  await registerOperationalRoutes(app, pool);
  return { app, queries, state };
}

const writes = queries => queries.filter(query => /^\s*(INSERT|UPDATE|DELETE)/u.test(query.sql));
const auditOperations = queries => queries.filter(query => query.sql.includes("INSERT INTO audit.audit_log"))
  .map(query => query.params[5]);

function preview(app, payload = replacePayload) {
  return app.inject({ method: "POST", url: `/api/v1/purchase-orders/${poId}/replace/preview`, payload });
}
function apply(app, { version = "3", payload = replacePayload, reason = "Substituição pela planilha nova" } = {}) {
  return app.inject({ method: "POST", url: `/api/v1/purchase-orders/${poId}/replace`,
    headers: { "x-record-version": version }, payload: { ...payload, reason } });
}

test("replace preview lists the plan without writing and refuses POs that are not deleted", async t => {
  const { app, queries } = await replaceApp(t);
  const response = await preview(app);
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(body.version, "3");
  assert.equal(body.canApply, true);
  assert.deepEqual(body.blockers, []);
  assert.deepEqual([body.updated.length, body.added.length, body.removed.length, body.reactivated.length,
    body.productChanged.length], [1, 1, 1, 1, 1]);
  assert.deepEqual(writes(queries), []);

  const active = await replaceApp(t, { status: "ACTIVE" });
  const refused = await preview(active.app);
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.json().code, "PO_NOT_DELETED");
});

test("replace preview reports allocations, supplier, number, source and catalog blockers", async t => {
  const allocated = await replaceApp(t, { allocatedItemIds: [itemIds.removed, itemIds.changed] });
  const allocationBody = (await preview(allocated.app)).json();
  assert.equal(allocationBody.canApply, false);
  assert.ok(allocationBody.blockers.some(blocker => blocker.code === "PO_REPLACE_ITEM_HAS_ACTIVE_ALLOCATIONS"
    && blocker.message.includes("0002") && blocker.message.includes("0004")));

  const supplier = await replaceApp(t, { supplier: "SUP-2" });
  assert.ok((await preview(supplier.app)).json().blockers.some(blocker => blocker.code === "PO_REPLACE_SUPPLIER_MISMATCH"));

  const historical = await replaceApp(t, { sourceKind: "HISTORICAL_SNAPSHOT" });
  assert.ok((await preview(historical.app)).json().blockers.some(blocker => blocker.code === "PO_REPLACE_UNSUPPORTED_SOURCE"));

  const number = await replaceApp(t);
  const numberBody = (await preview(number.app, { ...replacePayload, header: { ...replacePayload.header, number: "OTHER" } })).json();
  assert.ok(numberBody.blockers.some(blocker => blocker.code === "PO_REPLACE_NUMBER_MISMATCH"));

  const catalog = await replaceApp(t, { products: ["PRODUCT-1", "PRODUCT-3", "PRODUCT-5", "PRODUCT-9"] });
  assert.ok((await preview(catalog.app)).json().blockers.some(blocker => blocker.code === "UNKNOWN_PRODUCT"));

  const costCenter = await replaceApp(t);
  const missingCostCenter = { ...replacePayload, items: incomingItems.map(item =>
    item.externalLineReference === "0006" ? { ...item, costCenter: null } : item) };
  assert.ok((await preview(costCenter.app, missingCostCenter)).json().blockers
    .some(blocker => blocker.code === "PO_REPLACE_COST_CENTER_REQUIRED" && blocker.message.includes("0006")));
});

test("replace restores the PO and synchronizes items in one audited transaction", async t => {
  const { app, queries, state } = await replaceApp(t);
  const response = await apply(app);
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().counts, { updated: 1, added: 1, removed: 1, reactivated: 1, productChanged: 1 });
  assert.equal(state.po.lifecycle_status, "ACTIVE");
  assert.equal(response.json().version, state.po.version);
  assert.equal(Number(state.po.version), 5);
  const byReference = Object.fromEntries(state.items.map(item => [item.external_line_reference, item]));
  assert.equal(byReference["0001"].unit_price, "5");
  assert.equal(byReference["0002"].source_status, "CANCELLED");
  assert.equal(byReference["0003"].source_status, null);
  assert.equal(byReference["0003"].ordered_quantity, "3");
  assert.equal(byReference["0004"].product_code, "PRODUCT-9");
  assert.equal(byReference["0006"].product_code, "PRODUCT-6");
  assert.equal(byReference["0006"].line_number, 6);
  assert.equal(byReference["0006"].cost_center, "1202027");
  assert.equal(byReference["0006"].ncm, "85049090");
  const operations = auditOperations(queries);
  assert.ok(operations.includes("RESTORE"));
  assert.ok(operations.includes("CREATE"));
  assert.ok(operations.includes("REMOVE"));
  assert.equal(operations.filter(operation => operation === "UPDATE").length, 3);
  assert.ok(queries.some(query => query.sql.includes("INSERT INTO audit.audit_log") && query.params[5] === "UPDATE"
    && query.params[7].includes("PO 030201.xlsx") && query.params[7].includes(sha)));
  assert.ok(queries.some(query => query.sql === "COMMIT"));
});

test("replace with blockers keeps the PO deleted and writes nothing", async t => {
  const { app, queries, state } = await replaceApp(t, { allocatedItemIds: [itemIds.removed] });
  const response = await apply(app);
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().code, "PO_REPLACE_BLOCKED");
  assert.equal(state.po.lifecycle_status, "DELETED");
  assert.deepEqual(writes(queries), []);
  assert.ok(queries.some(query => query.sql === "ROLLBACK"));
});

test("replace requires lifecycle permission, a reason and the current version", async t => {
  for (const role of ["Compras", "Importação"]) {
    const { app } = await replaceApp(t, { role });
    assert.equal((await preview(app)).statusCode, 403);
    assert.equal((await apply(app)).statusCode, 403);
  }
  const admin = await replaceApp(t, { role: "Administrador" });
  assert.equal((await preview(admin.app)).statusCode, 200);

  const stale = await replaceApp(t);
  const conflict = await apply(stale.app, { version: "2" });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().code, "VERSION_CONFLICT");
  assert.equal(stale.state.po.lifecycle_status, "DELETED");

  const noReason = await replaceApp(t);
  assert.equal((await apply(noReason.app, { reason: "" })).statusCode, 400);
});
