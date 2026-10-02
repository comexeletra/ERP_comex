// Read-only route check using an active Master identity from the operational DB.
import assert from "node:assert/strict";
import Fastify from "fastify";
import pg from "pg";
import { registerAuthorization } from "../dist/authorization.js";
import { registerRequestRoutes } from "../dist/requests.js";

const connectionString = process.env.DATABASE_URL;
const expectedDatabase = process.env.REQUESTS_READ_DB;
if (!connectionString || expectedDatabase !== "erp_po_totvs_test"
  || new URL(connectionString).pathname !== `/${expectedDatabase}`) {
  throw new Error("REQUESTS_READ_DB deve confirmar o banco operacional selecionado.");
}

const client = new pg.Client({ connectionString });
await client.connect();
let app;
try {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const result = await client.query(`SELECT u.id, u.issuer, u.subject
    FROM identity.erp_user AS u
    JOIN identity.erp_user_role AS role ON role.user_id = u.id
    WHERE u.is_active AND role.role = 'Master'
    ORDER BY u.id LIMIT 1`);
  assert.equal(result.rowCount, 1, "An active Master identity must exist");
  const master = result.rows[0];

  app = Fastify();
  app.decorateRequest("authContext", null);
  await registerAuthorization(app, client);
  app.addHook("onRequest", async request => {
    if (request.headers["x-test-identity"] === "master") {
      request.authContext = {
        issuer: master.issuer,
        subject: master.subject,
        userId: master.id,
        displayName: null,
        sessionToken: "requests-read-validation",
      };
    }
  });
  await registerRequestRoutes(app, client);

  const anonymous = await app.inject({ method: "GET", url: "/api/v1/requests" });
  assert.equal(anonymous.statusCode, 401);

  const list = await app.inject({
    method: "GET",
    url: "/api/v1/requests?page=1&pageSize=5",
    headers: { "x-test-identity": "master" },
  });
  assert.equal(list.statusCode, 200, list.body);
  const body = list.json();
  assert.equal(body.page, 1);
  assert.equal(body.pageSize, 5);
  assert.ok(Number.isInteger(body.totalCount) && body.totalCount >= body.items.length);
  assert.ok(body.items.length <= 5);

  if (body.items[0]) {
    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/requests/${encodeURIComponent(body.items[0].id)}`,
      headers: { "x-test-identity": "master" },
    });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.equal(detail.json().id, body.items[0].id);
  }
  console.log(`RF03 Master READ ONLY route check passed: ${body.totalCount} requests; anonymous 401.`);
} finally {
  if (app) await app.close();
  await client.query("ROLLBACK");
  await client.end();
}
