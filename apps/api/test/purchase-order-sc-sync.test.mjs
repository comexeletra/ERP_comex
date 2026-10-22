import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerFollowupRoutes } from "../dist/followup.js";

const poId = "00000000-0000-4000-8000-000000000001";
const otherPoId = "00000000-0000-4000-8000-000000000002";
const itemIds = ["00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004"];
const scId = "00000000-0000-4000-8000-000000000005";
const otherScId = "00000000-0000-4000-8000-000000000006";

async function syncApp(t, { role = "Compras", linkedScId = scId, otherPoStatus = "ACTIVE" } = {}) {
  const state = {
    po: { id: poId, importer: "ELETRA MATRIZ", external_number: "030201", lifecycle_status: "ACTIVE",
      purchase_request_id: linkedScId, supplier_text: "SUP-1", version: "7", order_date: "2026-10-21" },
    sc: { id: scId, importer: "ELETRA MATRIZ", sc_number: "020028", supplier_text: "SUP-1", supplier_code: "SUP-1",
      sc_date: null, approval_date: null, requester: "- ALEX PINHEIRO", commercial_plan_received_date: null, version: "1" },
    otherSc: { id: otherScId, importer: "ELETRA MATRIZ", sc_number: "999", supplier_text: "SUP-1", supplier_code: "SUP-1",
      sc_date: "2026-09-01", approval_date: null, requester: "PCM", commercial_plan_received_date: null, version: "1" },
    linkedPos: [{ id: poId, lifecycle_status: "ACTIVE" }, { id: otherPoId, lifecycle_status: otherPoStatus }],
    itemWrites: [],
  };
  const queries = [];
  const client = { async query(sql, params = []) {
    queries.push({ sql, params });
    if (sql.includes("SELECT * FROM procurement.purchase_order WHERE id = $1")) {
      return { rows: params[1].includes(state.po.importer) ? [{ ...state.po }] : [], rowCount: 1 };
    }
    if (sql.includes("FROM procurement.purchase_order_item") && sql.includes("FOR UPDATE") && sql.includes("SELECT")) {
      const rows = itemIds.map((id, index) => ({ id, purchase_order_id: poId, line_number: index + 1,
        product_code: "PROD-1", unit: "UN", sc_number: "020028", sc_date: null, requester: "- ALEX PINHEIRO" }));
      return { rows: sql.includes("SELECT id FROM") ? rows.map(row => ({ id: row.id })) : rows, rowCount: rows.length };
    }
    if (sql.includes("FROM procurement.purchase_request AS request")) {
      const request = params[0] === otherScId ? state.otherSc : state.sc;
      return { rows: [{ ...request }], rowCount: 1 };
    }
    if (sql.includes("FROM procurement.purchase_request WHERE id = $1") && sql.includes("FOR UPDATE")) {
      return { rows: [{ ...state.sc }], rowCount: 1 };
    }
    if (sql.includes("SELECT id, lifecycle_status FROM procurement.purchase_order")) {
      return { rows: state.linkedPos.map(po => ({ ...po })), rowCount: state.linkedPos.length };
    }
    if (sql.includes("UPDATE procurement.purchase_request SET")) {
      for (const [, column, index] of sql.matchAll(/(\w+) = \$(\d+)/gu)) state.sc[column] = params[Number(index) - 1];
      state.sc.version = String(Number(state.sc.version) + 1);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("UPDATE procurement.purchase_order_item AS item")) {
      return { rows: [{ purchase_order_id: otherPoId }], rowCount: 1 };
    }
    if (sql.includes("UPDATE procurement.purchase_order_item SET")) {
      state.itemWrites.push({ sql, params });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("UPDATE procurement.purchase_order") && sql.includes("version")) {
      if (params[0] === poId) state.po.version = String(Number(state.po.version) + 1);
      return { rows: [{ version: state.po.version }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  }, release() {} };
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
    request.authContext = { issuer: "ci", subject: "sc-sync", userId: poId, displayName: null, sessionToken: "ci" };
  });
  await registerFollowupRoutes(app, pool);
  return { app, queries, state };
}

function applyShared(app, fields, version = "7") {
  return app.inject({ method: "PATCH", url: `/api/v1/purchase-orders/${poId}/items/followup`,
    headers: { "x-record-version": version }, payload: { itemIds, fields, reason: "Registro realizado pelo usuário" } });
}
function saveHeader(app, fields, { purchaseRequestId = scId } = {}) {
  return app.inject({ method: "PATCH", url: `/api/v1/purchase-orders/${poId}/complete`,
    headers: { "x-record-version": "7" }, payload: {
      header: { number: "030201", supplierText: "SUP-1", orderDate: null, notes: "", purchaseRequestId,
        reason: "Registro realizado pelo usuário" }, itemIds, fields } });
}
const audits = queries => queries.filter(query => query.sql.includes("INSERT INTO audit.audit_log"))
  .map(query => `${query.params[3]}:${query.params[5]}`);
const scWrites = queries => queries.filter(query => query.sql.includes("UPDATE procurement.purchase_request SET"));
const otherPoSync = queries => queries.find(query => query.sql.includes("UPDATE procurement.purchase_order_item AS item"));

test("applying SC fields on a PO with an SC updates the SC, audits it and propagates to its other POs", async t => {
  const { app, queries, state } = await syncApp(t);
  const response = await applyShared(app, { scDate: "2026-10-01", scApprovalDate: "2026-10-05",
    commercialPlanReceivedDate: "2026-10-11", requester: "- ALEX PINHEIRO", necessityDate: "2027-08-05" });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().purchaseRequestUpdated, true);
  assert.equal(state.sc.sc_date, "2026-10-01");
  assert.equal(state.sc.approval_date, "2026-10-05");
  assert.equal(state.sc.commercial_plan_received_date, "2026-10-11");
  assert.equal(state.sc.requester, "- ALEX PINHEIRO");
  assert.equal(state.sc.version, "2");
  const scAudit = queries.find(query => query.sql.includes("INSERT INTO audit.audit_log") && query.params[3] === "PURCHASE_REQUEST");
  assert.equal(scAudit.params[5], "UPDATE");
  assert.match(scAudit.params[6], /"scDate":null/u);
  assert.match(scAudit.params[7], /"scDate":"2026-10-01"/u);
  const sync = otherPoSync(queries);
  assert.ok(sync, "other POs of the SC are synchronized");
  assert.ok(sync.params.includes(poId), "the edited PO is excluded from the propagation");
  assert.ok(queries.some(query => query.sql.includes("UPDATE procurement.purchase_order") && query.params[0] === otherPoId));
  assert.equal(audits(queries).filter(entry => entry === "PURCHASE_ORDER_ITEM:FOLLOWUP_UPDATE").length, 2);
  assert.ok(queries.some(query => query.sql === "COMMIT"));
});

test("SC fields equal to the SC and fields outside the SC do not change it", async t => {
  const { app, queries } = await syncApp(t);
  const response = await applyShared(app, { requester: "- ALEX PINHEIRO", scNumber: " 020028 ", necessityDate: "2027-08-05" });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().purchaseRequestUpdated, false);
  assert.deepEqual(scWrites(queries), []);
});

test("a PO without SC keeps writing only its items", async t => {
  const { app, queries } = await syncApp(t, { linkedScId: null });
  const response = await applyShared(app, { scDate: "2026-10-01" });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().purchaseRequestUpdated, false);
  assert.deepEqual(scWrites(queries), []);
  assert.equal(queries.some(query => query.sql.includes("FROM procurement.purchase_request")), false);
});

test("SC number changes, an empty requester and inactive linked POs are refused without writes", async t => {
  const cases = [
    [{}, { scNumber: "020029" }, "PURCHASE_REQUEST_NUMBER_LOCKED"],
    [{}, { requester: "" }, "PURCHASE_REQUEST_REQUESTER_REQUIRED"],
    [{ otherPoStatus: "DELETED" }, { scDate: "2026-10-01" }, "PO_NOT_ACTIVE"],
  ];
  for (const [fixture, fields, code] of cases) {
    const { app, queries, state } = await syncApp(t, fixture);
    const response = await applyShared(app, fields);
    assert.equal(response.statusCode, 409, `${code}: ${response.body}`);
    assert.equal(response.json().code, code);
    assert.deepEqual(scWrites(queries), [], code);
    assert.deepEqual(state.itemWrites, [], code);
    assert.ok(queries.some(query => query.sql === "ROLLBACK"), code);
  }
});

test("saving the PO with shared SC fields keeps the edited values in the SC and in the items", async t => {
  const { app, state } = await syncApp(t);
  const response = await saveHeader(app, { scDate: "2026-10-01", scApprovalDate: "2026-10-05" });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().purchaseRequestUpdated, true);
  assert.equal(state.sc.sc_date, "2026-10-01");
  assert.equal(state.itemWrites.length, 2);
  assert.ok(state.itemWrites.every(write => write.params.includes("2026-10-01") && write.params.includes("2026-10-05")));
});

test("saving the PO with another SC applies the new SC data and does not change either SC", async t => {
  const { app, queries, state } = await syncApp(t);
  const response = await saveHeader(app, { scDate: "2026-10-01" }, { purchaseRequestId: otherScId });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().purchaseRequestUpdated, false);
  assert.deepEqual(scWrites(queries), []);
  assert.ok(state.itemWrites.every(write => write.params.includes("2026-09-01") && !write.params.includes("2026-10-01")));
});

test("a single item cannot diverge from the linked SC", async t => {
  const item = (app, fields) => app.inject({ method: "PATCH", url: `/api/v1/purchase-orders/${poId}/items/${itemIds[0]}/followup`,
    headers: { "x-record-version": "7" }, payload: { fields, reason: "Registro realizado pelo usuário" } });
  const refused = await syncApp(t);
  const response = await item(refused.app, { scDate: "2026-10-01" });
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().code, "PURCHASE_REQUEST_FIELDS_SHARED");
  assert.deepEqual(refused.state.itemWrites, []);

  const same = await syncApp(t);
  assert.equal((await item(same.app, { requester: "- ALEX PINHEIRO", remarks: "ok" })).statusCode, 200);
  const withoutSc = await syncApp(t, { linkedScId: null });
  assert.equal((await item(withoutSc.app, { scDate: "2026-10-01" })).statusCode, 200);
});
