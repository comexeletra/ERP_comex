import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerOperationalRoutes } from "../dist/operations.js";

const poId = "00000000-0000-4000-8000-000000000001";
const body = { importer: "ELETRA MATRIZ", number: "PO-TESTE", supplierText: null,
  orderDate: null, notes: "", reason: "Pedido conferido" };

test("operational commands reject reader, invalid quantity, foreign importer and missing version before database writes", async t => {
  let connections = 0;
  const pool = {
    async query(sql, params) {
      if (sql.includes("SELECT DISTINCT importer FROM procurement.purchase_order")) {
        return { rows: [{ importer: "ELETRA MATRIZ" }] };
      }
      return { rows: [{ role: params[1] === "reader" ? "Consulta" : "Importação",
        importer_code: "ELETRA MATRIZ" }] };
    },
    async connect() { connections += 1; throw new Error("Unexpected database write"); },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, pool);
  app.addHook("onRequest", async request => {
    const subject = request.headers["x-test-subject"];
    if (typeof subject === "string") request.authContext = {
      issuer: "ci", subject, userId: poId, displayName: null, sessionToken: "ci",
    };
  });
  await registerOperationalRoutes(app, pool);
  const call = (subject, method, url, payload, headers = {}) => app.inject({
    method, url, payload, headers: { "x-test-subject": subject, ...headers },
  });

  assert.equal((await call("reader", "POST", "/api/v1/purchase-orders", body,
    { "idempotency-key": "reader-key" })).statusCode, 403);
  assert.equal((await call("writer", "POST", "/api/v1/purchase-orders",
    { ...body, importer: "ELETRA FOR" }, { "idempotency-key": "foreign-key" })).statusCode, 404);
  assert.equal((await call("writer", "PATCH", `/api/v1/purchase-orders/${poId}`,
    { number: "PO-TESTE", supplierText: null, orderDate: null, notes: "", reason: "Correção" })).statusCode, 428);
  assert.equal((await call("writer", "POST", `/api/v1/purchase-orders/${poId}/allocations`,
    { itemId: poId, processId: poId, quantity: "101.123456789", notes: "", reason: "Teste" },
    { "idempotency-key": "invalid-quantity" })).statusCode, 400);
  assert.equal(connections, 0);
});
