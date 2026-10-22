import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerOperationalRoutes } from "../dist/operations.js";

const poId = "00000000-0000-4000-8000-000000000001";
const itemIds = ["00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"];
const createdScId = "00000000-0000-4000-8000-000000000004";
const existingScId = "00000000-0000-4000-8000-000000000005";
const body = { scNumber: "020028", requester: "Solicitante HML", scDate: "2026-10-01", approvalDate: null,
  commercialPlanReceivedDate: null, reason: "Vínculo da SC da planilha" };

async function linkApp(t, { role = "Compras", status = "ACTIVE", linkedScId = null, supplier = "SUP-1",
  existing = null } = {}) {
  const state = { po: { id: poId, importer: "ELETRA MATRIZ", lifecycle_status: status, version: "3",
    purchase_request_id: linkedScId, supplier_text: supplier }, scInserted: false };
  const queries = [];
  const client = { async query(sql, params = []) {
    queries.push({ sql, params });
    if (sql.includes("SELECT * FROM procurement.purchase_order WHERE id = $1")) {
      return { rows: params[1].includes(state.po.importer) ? [{ ...state.po }] : [], rowCount: 1 };
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
      const request = existing ?? { id: createdScId, importer: "ELETRA MATRIZ", supplier_text: "SUP-1",
        supplier_code: "SUP-1", sc_number: body.scNumber, sc_date: body.scDate, approval_date: null,
        requester: body.requester, commercial_plan_received_date: null };
      return { rows: [request], rowCount: 1 };
    }
    if (sql.includes("UPDATE procurement.purchase_order SET purchase_request_id")) {
      state.po.purchase_request_id = params[1];
      state.po.version = String(Number(state.po.version) + 1);
      return { rows: [{ version: state.po.version }], rowCount: 1 };
    }
    if (sql.includes("SELECT id FROM procurement.purchase_order_item")) {
      return { rows: itemIds.map(id => ({ id })), rowCount: itemIds.length };
    }
    return { rows: [], rowCount: 1 };
  }, release() {} };
  const pool = {
    async query(sql) {
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
    request.authContext = { issuer: "ci", subject: "sc-linker", userId: poId, displayName: null, sessionToken: "ci" };
  });
  await registerOperationalRoutes(app, pool);
  return { app, queries, state };
}

function link(app, { version = "3", payload = body } = {}) {
  return app.inject({ method: "POST", url: `/api/v1/purchase-orders/${poId}/purchase-request`,
    headers: { "x-record-version": version }, payload });
}
const audits = queries => queries.filter(query => query.sql.includes("INSERT INTO audit.audit_log"))
  .map(query => `${query.params[3]}:${query.params[5]}`);
const poLinkWrites = queries => queries.filter(query => query.sql.includes("UPDATE procurement.purchase_order SET purchase_request_id"));

test("creating the SC links it to the PO and copies its fields to every item with audit", async t => {
  const { app, queries, state } = await linkApp(t);
  const response = await link(app);
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { purchaseRequestId: createdScId, created: true, version: "4" });
  assert.equal(state.scInserted, true);
  assert.equal(state.po.purchase_request_id, createdScId);
  const itemUpdates = queries.filter(query => query.sql.includes("UPDATE procurement.purchase_order_item SET")
    && query.sql.includes("sc_number"));
  assert.deepEqual(itemUpdates.map(query => query.params[0]), itemIds);
  assert.ok(itemUpdates.every(query => query.params.includes("020028") && query.params.includes("Solicitante HML")));
  assert.deepEqual(audits(queries), ["PURCHASE_REQUEST:CREATE", "PURCHASE_ORDER:UPDATE",
    "PURCHASE_ORDER_ITEM:FOLLOWUP_UPDATE", "PURCHASE_ORDER_ITEM:FOLLOWUP_UPDATE"]);
  assert.ok(queries.some(query => query.sql === "COMMIT"));
});

test("an existing SC with the same supplier is reused instead of created", async t => {
  const existing = { id: existingScId, importer: "ELETRA MATRIZ", supplier_text: "SUP-1", supplier_code: "SUP-1",
    sc_number: "020028", sc_date: null, approval_date: null, requester: "PCM", commercial_plan_received_date: null };
  const { app, queries, state } = await linkApp(t, { existing });
  const response = await link(app);
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { purchaseRequestId: existingScId, created: false, version: "4" });
  assert.equal(state.po.purchase_request_id, existingScId);
  assert.equal(audits(queries).includes("PURCHASE_REQUEST:CREATE"), false);
});

test("supplier conflicts, linked or inactive POs, stale versions and missing data are refused without writes", async t => {
  const conflicting = { id: existingScId, importer: "ELETRA MATRIZ", supplier_text: "SUP-2", supplier_code: "SUP-2",
    sc_number: "020028", sc_date: null, approval_date: null, requester: "PCM", commercial_plan_received_date: null };
  const cases = [
    [{ existing: conflicting }, {}, 409, "PURCHASE_REQUEST_SUPPLIER_MISMATCH"],
    [{ linkedScId: existingScId }, {}, 409, "PO_ALREADY_HAS_PURCHASE_REQUEST"],
    [{ status: "DELETED" }, {}, 409, "PO_NOT_ACTIVE"],
    [{ supplier: null }, {}, 409, "PO_SUPPLIER_REQUIRED"],
    [{}, { version: "2" }, 409, "VERSION_CONFLICT"],
    [{}, { payload: { ...body, requester: "" } }, 400, "INVALID_PO_PURCHASE_REQUEST"],
  ];
  for (const [fixture, request, status, code] of cases) {
    const { app, queries } = await linkApp(t, fixture);
    const response = await link(app, request);
    assert.equal(response.statusCode, status, `${code}: ${response.body}`);
    assert.equal(response.json().code, code);
    assert.deepEqual(poLinkWrites(queries), [], code);
  }
});

test("PO writers can link an SC; read-only roles cannot", async t => {
  for (const role of ["Compras", "Importação", "Master"]) {
    const { app } = await linkApp(t, { role });
    assert.equal((await link(app)).statusCode, 200, role);
  }
  const reader = await linkApp(t, { role: "Consulta" });
  assert.equal((await link(reader.app)).statusCode, 403);
});
