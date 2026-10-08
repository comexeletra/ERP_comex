import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerPurchaseRequestRoutes } from "../dist/purchase-requests.js";
import { BusinessError, validatePurchaseRequest } from "../dist/operations.js";

const actorId = "00000000-0000-4000-8000-000000000010";
const scId = "00000000-0000-4000-8000-000000000011";

async function createApp(t) {
  let writes = 0;
  const pool = {
    async query(sql, values) {
      if (sql.includes("identity.erp_user_role")) {
        const role = values[1] === "pcm" ? "PCM" : values[1] === "buyer" ? "Compras" : "Consulta";
        return { rows: [{ role, importer_code: "ELETRA MATRIZ" }] };
      }
      if (sql.includes("FROM procurement.purchase_request sc")) {
        assert.deepEqual(values[0], ["ELETRA MATRIZ"]);
        assert.ok(values[1] === "ELETRA MATRIZ" || values[1] === null);
        return { rows: [{ id: scId, importer: "ELETRA MATRIZ", scNumber: "SC-100", requester: "Ana",
          commercialPlanReceivedDate: "2026-10-10", approvalDate: null, version: "1", purchaseOrderCount: 0 }] };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, values) {
          writes += 1;
          if (sql.includes("SELECT importer FROM procurement.purchase_order")) {
            return { rows: [{ importer: "ELETRA MATRIZ" }], rowCount: 1 };
          }
          if (sql.includes("SELECT payload_sha256, resource_type, resource_id")) return { rows: [] };
          if (sql.includes("INSERT INTO procurement.purchase_request")) {
            return { rows: [{ id: scId, importer: values[1], scNumber: values[2],
              commercialPlanReceivedDate: values[3], requester: values[4], approvalDate: values[5], version: "1" }] };
          }
          return { rows: [], rowCount: 1 };
        },
        release() {},
      };
    },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    const subject = request.headers["x-test-subject"];
    if (typeof subject === "string") request.authContext = {
      issuer: "ci", subject, userId: actorId, displayName: null, sessionToken: "ci",
    };
  });
  await registerPurchaseRequestRoutes(app, pool);
  return { app, get writes() { return writes; } };
}

test("PCM manages SCs; PO writers can read them; importer scope is enforced", async t => {
  const fixture = await createApp(t);
  const call = (subject, method, url, payload, headers = {}) => fixture.app.inject({
    method, url, payload, headers: { "x-test-subject": subject, ...headers },
  });

  const list = await call("pcm", "GET", "/api/v1/purchase-requests?importer=ELETRA%20MATRIZ");
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(list.json().items[0].scNumber, "SC-100");
  assert.equal((await call("buyer", "GET", "/api/v1/purchase-requests")).statusCode, 200);
  assert.equal((await call("reader", "POST", "/api/v1/purchase-requests", {},
    { "idempotency-key": "reader" })).statusCode, 403);

  const payload = { importer: "ELETRA MATRIZ", scNumber: "SC-200", requester: "Bruno",
    commercialPlanReceivedDate: null, approvalDate: "2026-10-12", reason: "Cadastro validado" };
  const created = await call("pcm", "POST", "/api/v1/purchase-requests", payload,
    { "idempotency-key": "pcm-sc-200" });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().scNumber, "SC-200");

  const beforeOutOfScope = fixture.writes;
  const outOfScope = await call("pcm", "POST", "/api/v1/purchase-requests",
    { ...payload, importer: "ELETRA FILIAL" }, { "idempotency-key": "pcm-foreign-sc" });
  assert.equal(outOfScope.statusCode, 404);
  assert.equal(fixture.writes, beforeOutOfScope);
});

test("a PO can only link an SC from the same importer", async () => {
  const calls = [];
  const client = { async query(sql, values) {
    calls.push({ sql, values });
    return { rows: values[1] === "ELETRA MATRIZ" ? [{ id: scId }] : [] };
  } };
  await validatePurchaseRequest(client, scId, "ELETRA MATRIZ");
  await assert.rejects(validatePurchaseRequest(client, scId, "ELETRA FILIAL"),
    error => error instanceof BusinessError && error.status === 404);
  assert.deepEqual(calls.map(call => call.values[1]), ["ELETRA MATRIZ", "ELETRA FILIAL"]);
});
