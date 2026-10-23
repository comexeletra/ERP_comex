import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { processFollowupFieldKeys, registerFollowupRoutes } from "../dist/followup.js";
import { ipPostShipmentFields, newProcessDocumentKinds } from "../../web/lib/ip-post-shipment-fields.ts";

const actorId = "00000000-0000-4000-8000-000000000001";
const processId = "00000000-0000-4000-8000-000000000011";
const billId = "00000000-0000-4000-8000-000000000012";

async function followupApp(t) {
  const writes = [];
  const client = { async query(sql, params = []) {
    if (sql.includes("FROM imports.import_process WHERE id=$1") && sql.includes("FOR UPDATE")) {
      return { rows: [{ id: processId, importer: "ELETRA MATRIZ", version: "3", record_status: "ACTIVE",
        lifecycle_status: "OPEN" }], rowCount: 1 };
    }
    if (sql.includes("FROM imports.process_document d JOIN imports.import_process p")) {
      return { rows: [{ id: billId, process_id: processId, kind: "BL", number: "BL-OLD", version: "1" }], rowCount: 1 };
    }
    if (sql.includes("UPDATE imports.import_process SET")) {
      writes.push({ sql, params });
      return { rows: [{ version: "4" }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO imports.process_document") || sql.includes("UPDATE imports.process_document")) {
      writes.push({ sql, params });
    }
    return { rows: [], rowCount: 1 };
  }, release() {} };
  const pool = {
    async query(sql) {
      if (sql.includes("identity.erp_user AS u")) return { rows: [{ role: "Importação", importer_code: "ELETRA MATRIZ" }] };
      return { rows: [] };
    },
    async connect() { return client; },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    request.authContext = { issuer: "ci", subject: "post-shipment", userId: actorId, displayName: null, sessionToken: "ci" };
  });
  await registerFollowupRoutes(app, pool);
  return { app, writes };
}

test("the IP post-shipment form accepts BL number and BL date as IP fields", async t => {
  const { app, writes } = await followupApp(t);
  const response = await app.inject({ method: "PATCH", url: `/api/v1/processes/${processId}/followup`,
    headers: { "x-record-version": "3" },
    payload: { fields: { blNumber: " BL-2026-01 ", blDate: "2026-10-20" }, reason: "Atualização do BL" } });
  assert.equal(response.statusCode, 200, response.body);
  const update = writes.find(write => write.sql.includes("UPDATE imports.import_process SET"));
  assert.match(update.sql, /bl_number=\$2,bl_date=\$3/u);
  assert.deepEqual(update.params, [processId, "BL-2026-01", "2026-10-20"]);
});

test("BL can no longer be created or edited as a document because it belongs to the IP", async t => {
  const { app, writes } = await followupApp(t);
  const created = await app.inject({ method: "POST", url: `/api/v1/processes/${processId}/documents`,
    headers: { "idempotency-key": "new-bl-document" },
    payload: { kind: "BL", number: "BL-NEW", purchaseOrderItemId: null, issueDate: "2026-10-20",
      homologationDate: null, quantity: null, unitPrice: null, amount: null, currencyCode: null,
      notes: "", reason: "Cadastro de BL" } });
  assert.equal(created.statusCode, 400, created.body);
  assert.equal(created.json().code, "BL_IS_IP_FIELD");

  const edited = await app.inject({ method: "PATCH", url: `/api/v1/processes/${processId}/documents/${billId}`,
    headers: { "x-record-version": "1" },
    payload: { number: "BL-OLD-2", issueDate: "2026-10-21", homologationDate: null, quantity: null,
      unitPrice: null, amount: null, currencyCode: null, notes: "", reason: "Correção do BL" } });
  assert.equal(edited.statusCode, 400, edited.body);
  assert.equal(edited.json().code, "BL_IS_IP_FIELD");
  assert.equal(writes.length, 0);
});

test("the web IP field catalog matches the fields accepted by the API", () => {
  const webKeys = ipPostShipmentFields.map(field => field.key);
  assert.equal(new Set(webKeys).size, webKeys.length, "duplicate web field");
  assert.deepEqual([...webKeys].sort(), [...processFollowupFieldKeys].sort());
  assert.deepEqual(newProcessDocumentKinds, ["INVOICE", "NF"]);
});
