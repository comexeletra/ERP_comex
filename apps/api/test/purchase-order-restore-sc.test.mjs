import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerOperationalRoutes } from "../dist/operations.js";

const poId = "00000000-0000-4000-8000-000000000001";
const itemIds = ["00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"];
const createdScId = "00000000-0000-4000-8000-000000000004";
const existingScId = "00000000-0000-4000-8000-000000000005";
const otherScId = "00000000-0000-4000-8000-000000000006";
const sha = "c".repeat(64);
const newPurchaseRequest = { scNumber: "020028", requester: "Solicitante HML", scDate: "2026-10-01",
  approvalDate: null, commercialPlanReceivedDate: null };
const compatibleSc = { id: existingScId, importer: "ELETRA MATRIZ", supplier_text: "SUP-1", supplier_code: "SUP-1",
  sc_number: "020028", sc_date: null, approval_date: "2026-10-02", requester: "PCM", commercial_plan_received_date: null };
const replacePayload = { header: { number: "PO-030201", supplierCode: "SUP-1" }, fileName: "PO 030201.xlsx",
  fileSha256: sha, currency: "CNY", items: [
    { externalLineReference: "0001", productCode: "PRODUCT-1", description: "Produto 1", orderedQuantity: "2",
      unitPrice: "5", unit: "UN", costCenter: "1202027" },
    { externalLineReference: "0002", productCode: "PRODUCT-2", description: "Produto 2", orderedQuantity: "1",
      unitPrice: "1", unit: "UN", costCenter: "1202027" },
    { externalLineReference: "0003", productCode: "PRODUCT-3", description: "Produto 3", orderedQuantity: "1",
      unitPrice: "1", unit: "UN", costCenter: "1202027" },
  ] };

async function restoreApp(t, { role = "Master", linkedScId = null, existing = null, supplier = "SUP-1",
  lastRestore = null } = {}) {
  const base = { purchase_order_id: poId, unit: "UN", currency_code: "CNY", cost_center: "1202027", ncm: "39269090",
    unit_price: "1.00000000", ordered_quantity: "1.00000000", source_status: null, sc_number: "020028", requester: null };
  const state = {
    po: { id: poId, importer: "ELETRA MATRIZ", external_number: "PO-030201", normalized_number: "PO-030201",
      source_kind: "MANUAL_TOTVS_REFERENCE", lifecycle_status: "DELETED", lifecycle_changed_at: "2026-10-22T15:24:21Z",
      lifecycle_changed_by: "ci#someone", lifecycle_reason: "teste", purchase_request_id: linkedScId,
      supplier_text: supplier, version: "3", created_at: "2026-10-21T22:50:27Z" },
    items: [
      { ...base, id: itemIds[0], line_number: 1, external_line_reference: "0001", product_code: "PRODUCT-1",
        description: "Produto 1" },
      { ...base, id: itemIds[1], line_number: 2, external_line_reference: "0002", product_code: "PRODUCT-2",
        description: "Produto 2" },
    ],
    scInserted: false,
  };
  const knownScs = { [existingScId]: existing ?? compatibleSc, [otherScId]: { ...compatibleSc, id: otherScId, sc_number: "999" } };
  const queries = [];
  const client = { async query(sql, params = []) {
    queries.push({ sql, params });
    if (sql.includes("SELECT * FROM procurement.purchase_order WHERE id = $1")) {
      return { rows: params[1].includes(state.po.importer) ? [{ ...state.po }] : [], rowCount: 1 };
    }
    if (sql.includes("SELECT * FROM procurement.purchase_order_item") && sql.includes("purchase_order_id=$1")) {
      return { rows: state.items.map(item => ({ ...item })), rowCount: state.items.length };
    }
    if (sql.includes("SELECT id FROM procurement.purchase_order_item")) {
      return { rows: state.items.map(item => ({ id: item.id })), rowCount: state.items.length };
    }
    if (sql.includes("FROM procurement.po_item_allocation") && sql.includes("ANY($1::uuid[])")) return { rows: [], rowCount: 0 };
    if (sql.includes("FROM catalog.entry") && sql.includes("kind='PRODUCT'")) {
      return { rows: params[0].map(normalized_code => ({ normalized_code, product_ncm_code: "85049090" })), rowCount: params[0].length };
    }
    if (sql.includes("entity_key='UNIT_OF_MEASURE'") || sql.includes("entity_key='COST_CENTER'")) {
      return { rows: params[0].map(normalized_value => ({ normalized_value })), rowCount: params[0].length };
    }
    if (sql.includes("INSERT INTO procurement.purchase_request")) {
      if (existing) return { rows: [], rowCount: 0 };
      state.scInserted = true;
      return { rows: [{ id: createdScId }], rowCount: 1 };
    }
    if (sql.includes("SELECT id FROM procurement.purchase_request") && sql.includes("normalized_sc_number")) {
      return { rows: existing ? [{ id: existing.id }] : [], rowCount: existing ? 1 : 0 };
    }
    if (sql.includes("FROM procurement.purchase_request AS request")) {
      const request = knownScs[params[0]] ?? (params[0] === createdScId ? { id: createdScId, importer: "ELETRA MATRIZ",
        supplier_text: "SUP-1", supplier_code: "SUP-1", sc_number: newPurchaseRequest.scNumber,
        sc_date: newPurchaseRequest.scDate, approval_date: null, requester: newPurchaseRequest.requester,
        commercial_plan_received_date: null } : null);
      return { rows: request ? [request] : [], rowCount: request ? 1 : 0 };
    }
    if (sql.includes("UPDATE procurement.purchase_order SET lifecycle_status")) {
      if (state.po.lifecycle_status === "DELETED" && params[1] === "ACTIVE") state.po.lifecycle_status = "ACTIVE";
      state.po.version = String(Number(state.po.version) + 1);
      return { rows: [{ version: state.po.version, lifecycle_changed_at: null, lifecycle_changed_by: null,
        lifecycle_reason: null }], rowCount: 1 };
    }
    if (sql.includes("UPDATE procurement.purchase_order SET purchase_request_id")) {
      assert.equal(state.po.lifecycle_status, "ACTIVE", "the SC is linked only after the PO is active again");
      state.po.purchase_request_id = params[1];
      state.po.version = String(Number(state.po.version) + 1);
      return { rows: [{ version: state.po.version }], rowCount: 1 };
    }
    if (sql.includes("UPDATE procurement.purchase_order SET version")) {
      state.po.version = String(Number(state.po.version) + 1);
      return { rows: [{ version: state.po.version }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO procurement.purchase_order_item")) {
      state.items.push({ ...base, id: params[0], line_number: params[2], external_line_reference: params[3],
        product_code: params[4], description: params[5], sc_number: null });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("UPDATE procurement.purchase_order_item SET") && sql.includes("sc_number")) {
      const item = state.items.find(row => row.id === params[0]);
      const columns = [...sql.matchAll(/(\w+)=\$(\d+)/gu)];
      for (const [, column, index] of columns) item[column] = params[Number(index) - 1];
      return { rows: [{ ...item }], rowCount: 1 };
    }
    if (sql.includes("UPDATE procurement.purchase_order_item SET description")) {
      const item = state.items.find(row => row.id === params[0]);
      Object.assign(item, { description: params[1], ordered_quantity: params[2], unit_price: params[3] });
      return { rows: [{ ...item }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  }, release() {} };
  const poolQueries = [];
  const pool = {
    async query(sql, params = []) {
      poolQueries.push({ sql, params });
      if (sql.includes("FROM identity.erp_user AS u")) return { rows: [{ role, importer_code: "ELETRA MATRIZ" }], rowCount: 1 };
      if (sql.includes("SELECT DISTINCT importer FROM procurement.purchase_order")) {
        return { rows: [{ importer: "ELETRA MATRIZ" }], rowCount: 1 };
      }
      if (sql.includes("FROM procurement.purchase_order po") && sql.includes("WHERE po.id = $1")) {
        return { rows: [{ id: poId, importer: "ELETRA MATRIZ", number: "PO-030201", lifecycleStatus: "ACTIVE",
          createdAt: state.po.created_at, lastRestore }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }, async connect() { return client; },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    request.authContext = { issuer: "ci", subject: "restorer", userId: poId, displayName: null, sessionToken: "ci" };
  });
  await registerOperationalRoutes(app, pool);
  return { app, queries, poolQueries, state };
}

function restore(app, { version = "3", purchaseRequest, reason = "Restauração pela planilha" } = {}) {
  return app.inject({ method: "POST", url: `/api/v1/purchase-orders/${poId}/restore`,
    headers: { "x-record-version": version },
    payload: { reason, ...(purchaseRequest === undefined ? {} : { purchaseRequest }) } });
}
function replace(app, { version = "3", purchaseRequest, reason = "Substituição pela planilha" } = {}) {
  return app.inject({ method: "POST", url: `/api/v1/purchase-orders/${poId}/replace`,
    headers: { "x-record-version": version },
    payload: { ...replacePayload, reason, ...(purchaseRequest === undefined ? {} : { purchaseRequest }) } });
}
const audits = queries => queries.filter(query => query.sql.includes("INSERT INTO audit.audit_log"))
  .map(query => `${query.params[3]}:${query.params[5]}`);
const linkWrites = queries => queries.filter(query => query.sql.includes("UPDATE procurement.purchase_order SET purchase_request_id"));

test("restoring with a new SC creates it, links the PO and copies requester and dates to every item", async t => {
  const { app, queries, state } = await restoreApp(t);
  const response = await restore(app, { purchaseRequest: { newPurchaseRequest } });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(body.lifecycleStatus, "ACTIVE");
  assert.equal(body.purchaseRequestId, createdScId);
  assert.equal(body.purchaseRequestCreated, true);
  assert.equal(body.version, state.po.version);
  assert.equal(state.scInserted, true);
  assert.equal(state.po.purchase_request_id, createdScId);
  assert.ok(state.items.every(item => item.requester === "Solicitante HML" && item.sc_date === "2026-10-01"));
  assert.deepEqual(audits(queries), ["PURCHASE_ORDER:RESTORE", "PURCHASE_REQUEST:CREATE", "PURCHASE_ORDER:UPDATE",
    "PURCHASE_ORDER_ITEM:FOLLOWUP_UPDATE", "PURCHASE_ORDER_ITEM:FOLLOWUP_UPDATE"]);
  assert.ok(queries.some(query => query.sql === "COMMIT"));
});

test("restoring with an existing compatible SC links it without creating another", async t => {
  const { app, queries, state } = await restoreApp(t);
  const response = await restore(app, { purchaseRequest: { purchaseRequestId: existingScId } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().purchaseRequestId, existingScId);
  assert.equal(response.json().purchaseRequestCreated, false);
  assert.equal(state.scInserted, false);
  assert.equal(state.po.purchase_request_id, existingScId);
  assert.ok(state.items.every(item => item.requester === "PCM" && item.sc_approval_date === "2026-10-02"));
  assert.equal(audits(queries).includes("PURCHASE_REQUEST:CREATE"), false);
});

test("a new SC number that already exists for the importer and supplier is reused", async t => {
  const { app, state } = await restoreApp(t, { existing: compatibleSc });
  const response = await restore(app, { purchaseRequest: { newPurchaseRequest } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().purchaseRequestId, existingScId);
  assert.equal(response.json().purchaseRequestCreated, false);
  assert.equal(state.scInserted, false);
});

test("replacing with a new SC links it and the lines added by the spreadsheet inherit its fields", async t => {
  const { app, queries, state } = await restoreApp(t);
  const response = await replace(app, { purchaseRequest: { newPurchaseRequest } });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(body.purchaseRequestId, createdScId);
  assert.equal(body.purchaseRequestCreated, true);
  assert.equal(body.version, state.po.version);
  assert.equal(state.po.lifecycle_status, "ACTIVE");
  assert.equal(state.po.purchase_request_id, createdScId);
  const added = state.items.find(item => item.external_line_reference === "0003");
  assert.ok(added, "line 0003 is added");
  assert.ok(state.items.every(item => item.requester === "Solicitante HML"));
  const operations = audits(queries);
  assert.ok(operations.includes("PURCHASE_REQUEST:CREATE"));
  assert.ok(operations.includes("PURCHASE_ORDER:UPDATE"));
  assert.ok(operations.indexOf("PURCHASE_ORDER:RESTORE") < operations.indexOf("PURCHASE_ORDER:UPDATE"));
});

test("replacing with an existing compatible SC links it", async t => {
  const { app, state } = await restoreApp(t);
  const response = await replace(app, { purchaseRequest: { purchaseRequestId: existingScId } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(state.po.purchase_request_id, existingScId);
  assert.ok(state.items.every(item => item.requester === "PCM"));
});

test("an SC with another supplier keeps the PO deleted and writes nothing that survives", async t => {
  const conflicting = { ...compatibleSc, supplier_text: "SUP-2", supplier_code: "SUP-2" };
  for (const [call, purchaseRequest] of [[restore, { newPurchaseRequest }], [replace, { newPurchaseRequest }],
    [restore, { purchaseRequestId: existingScId }]]) {
    const { app, queries } = await restoreApp(t, { existing: conflicting });
    const response = await call(app, { purchaseRequest });
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().code, "PURCHASE_REQUEST_SUPPLIER_MISMATCH");
    assert.deepEqual(linkWrites(queries), []);
    assert.ok(queries.some(query => query.sql === "ROLLBACK"));
    assert.equal(queries.some(query => query.sql === "COMMIT"), false);
  }
});

test("a deleted PO already linked to another SC is refused; the same SC is accepted without changes", async t => {
  const other = await restoreApp(t, { linkedScId: otherScId });
  const refused = await restore(other.app, { purchaseRequest: { purchaseRequestId: existingScId } });
  assert.equal(refused.statusCode, 409, refused.body);
  assert.equal(refused.json().code, "PO_ALREADY_HAS_PURCHASE_REQUEST");
  assert.ok(other.queries.some(query => query.sql === "ROLLBACK"));

  const otherNew = await restoreApp(t, { linkedScId: otherScId });
  const refusedNew = await replace(otherNew.app, { purchaseRequest: { newPurchaseRequest } });
  assert.equal(refusedNew.statusCode, 409, refusedNew.body);
  assert.equal(refusedNew.json().code, "PO_ALREADY_HAS_PURCHASE_REQUEST");

  const same = await restoreApp(t, { linkedScId: existingScId });
  const accepted = await restore(same.app, { purchaseRequest: { purchaseRequestId: existingScId } });
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal(accepted.json().purchaseRequestId, existingScId);
  assert.deepEqual(linkWrites(same.queries), []);
});

test("restore and replace without an SC keep their current behavior", async t => {
  const restored = await restoreApp(t);
  const response = await restore(restored.app);
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { id: poId, lifecycleStatus: "ACTIVE", version: "4" });
  assert.deepEqual(linkWrites(restored.queries), []);

  const replaced = await restoreApp(t);
  const replaceResponse = await replace(replaced.app);
  assert.equal(replaceResponse.statusCode, 200, replaceResponse.body);
  assert.equal(replaceResponse.json().purchaseRequestId, undefined);
  assert.deepEqual(linkWrites(replaced.queries), []);
});

test("invalid SC choices are refused before any write", async t => {
  const cases = [
    [restore, { newPurchaseRequest: { ...newPurchaseRequest, requester: " " } }, "INVALID_PO_LIFECYCLE"],
    [restore, { purchaseRequestId: existingScId, newPurchaseRequest }, "INVALID_PO_LIFECYCLE"],
    [restore, {}, "INVALID_PO_LIFECYCLE"],
    [replace, { newPurchaseRequest: { ...newPurchaseRequest, scNumber: "" } }, "INVALID_PO_REPLACE"],
    [replace, { purchaseRequestId: "not-a-uuid" }, "INVALID_PO_REPLACE"],
  ];
  for (const [call, purchaseRequest, code] of cases) {
    const { app, queries } = await restoreApp(t);
    const response = await call(app, { purchaseRequest });
    assert.equal(response.statusCode, 400, `${code}: ${response.body}`);
    assert.equal(response.json().code, code);
    assert.deepEqual(queries, []);
  }
});

test("restoring with an SC still requires lifecycle permission and the current version", async t => {
  for (const role of ["Compras", "Importação"]) {
    const { app } = await restoreApp(t, { role });
    assert.equal((await restore(app, { purchaseRequest: { newPurchaseRequest } })).statusCode, 403, role);
  }
  const stale = await restoreApp(t);
  const conflict = await restore(stale.app, { version: "2", purchaseRequest: { newPurchaseRequest } });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().code, "VERSION_CONFLICT");
  assert.equal(stale.state.scInserted, false);
});

test("the PO page receives its creation date and the last restoration from the audit history", async t => {
  const lastRestore = { at: "2026-10-22T15:26:31Z", by: "urn:import-erp:local#user@example.com", reason: "necessidade" };
  const { app, poolQueries } = await restoreApp(t, { lastRestore });
  const response = await app.inject({ method: "GET", url: `/api/v1/purchase-orders/${poId}/operational` });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().createdAt, "2026-10-21T22:50:27Z");
  assert.deepEqual(response.json().lastRestore, lastRestore);
  const poQuery = poolQueries.find(query => query.sql.includes("FROM procurement.purchase_order po") && query.sql.includes("WHERE po.id = $1"));
  assert.match(poQuery.sql, /po\.created_at AS "createdAt"/u);
  assert.match(poQuery.sql, /audit\.purchase_order_operational_history/u);
  assert.match(poQuery.sql, /operation\s*=\s*'RESTORE'/u);
});
