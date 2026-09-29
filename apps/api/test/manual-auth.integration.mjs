import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { Pool } from "pg";
import { registerAuthRoutes } from "../dist/auth.js";
import { registerAuthorization } from "../dist/authorization.js";
import { registerAdminUserRoutes } from "../dist/admin-users.js";
import { hashPassword } from "../dist/password.js";

const databaseUrl = process.env.MANUAL_AUTH_TEST_DATABASE_URL;
if (!databaseUrl || process.env.MANUAL_AUTH_TEST_DB !== "isolated") {
  throw new Error("Defina MANUAL_AUTH_TEST_DB=isolated e a URL do banco temporário da VPS.");
}
const url = new URL(databaseUrl);
if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)
  || !url.pathname.startsWith("/erp_m009_check_")) {
  throw new Error("Teste limitado ao banco temporário erp_m009_check_ na VPS.");
}
process.env.APP_PUBLIC_ORIGIN = "https://fup-comex-eletra.vercel.app";
process.env.AUTH_SESSION_SECRET = "integration-test-only-session-secret-32-bytes";

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const app = Fastify();
await app.register(cookie);
await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
await registerAuthorization(app, pool);
await registerAuthRoutes(app, pool);
await registerAdminUserRoutes(app, pool);

function sessionCookie(response) {
  const header = response.headers["set-cookie"];
  return (Array.isArray(header) ? header[0] : header)?.split(";", 1)[0];
}
async function post(urlPath, payload, cookieValue, csrf) {
  return app.inject({
    method: "POST", url: urlPath,
    headers: {
      origin: process.env.APP_PUBLIC_ORIGIN,
      ...(cookieValue ? { cookie: cookieValue } : {}),
      ...(csrf ? { "x-csrf-token": csrf } : {}),
    }, payload,
  });
}
try {
  const importer = `AUTH TEST ${randomUUID()}`;
  await pool.query(
    `INSERT INTO procurement.purchase_order
       (id, importer, external_number, normalized_number)
     VALUES ($1, $2, '1', '1')`, [randomUUID(), importer],
  );
  const masterEmail = `master-${randomUUID()}@example.test`;
  const masterPassword = "initial-master-test-password-123";
  const masterId = randomUUID();
  await pool.query(
    `INSERT INTO identity.erp_user (id, issuer, subject, display_name)
     VALUES ($1, 'urn:import-erp:local', $2, 'Test Master')`, [masterId, masterEmail],
  );
  await pool.query(
    `INSERT INTO identity.local_credential (user_id, email, password_hash)
     VALUES ($1, $2, $3)`, [masterId, masterEmail, await hashPassword(masterPassword)],
  );
  await pool.query("INSERT INTO identity.erp_user_role (user_id, role) VALUES ($1, 'Master')", [masterId]);

  const invalid = await post("/auth/local/login", { email: masterEmail, password: "wrong-password-123456" });
  assert.equal(invalid.statusCode, 401);
  const login = await post("/auth/local/login", { email: masterEmail, password: masterPassword });
  assert.equal(login.statusCode, 200, login.body);
  assert.equal(login.json().mustChangePassword, true);
  const masterCookie = sessionCookie(login);
  assert.ok(masterCookie?.startsWith("erp_session="));
  const forced = await app.inject({ method: "GET", url: "/api/v1/admin/users", headers: { cookie: masterCookie } });
  assert.equal(forced.statusCode, 403);
  const csrfResponse = await app.inject({ method: "GET", url: "/auth/csrf", headers: { cookie: masterCookie } });
  assert.equal(csrfResponse.statusCode, 200, csrfResponse.body);
  const csrf = csrfResponse.json().token;
  const changed = await post("/auth/local/password", {
    currentPassword: masterPassword, newPassword: "new-master-test-password-12345",
  }, masterCookie, csrf);
  assert.equal(changed.statusCode, 204, changed.body);
  const masters = await app.inject({ method: "GET", url: "/api/v1/admin/users", headers: { cookie: masterCookie } });
  assert.equal(masters.statusCode, 200, masters.body);
  const protectedMaster = await app.inject({
    method: "PATCH", url: `/api/v1/admin/users/${masterId}`,
    headers: { cookie: masterCookie, origin: process.env.APP_PUBLIC_ORIGIN, "x-csrf-token": csrf },
    payload: { isActive: false },
  });
  assert.equal(protectedMaster.statusCode, 403);

  const employeeEmail = `employee-${randomUUID()}@example.test`;
  const created = await post("/api/v1/admin/users", {
    email: employeeEmail, displayName: "Test Employee", role: "Consulta", importerScopes: [importer],
  }, masterCookie, csrf);
  assert.equal(created.statusCode, 201, created.body);
  const pendingScopes = await post("/api/v1/admin/users", {
    email: `pending-${randomUUID()}@example.test`, displayName: "Pending Scopes",
    role: "Consulta", importerScopes: [],
  }, masterCookie, csrf);
  assert.equal(pendingScopes.statusCode, 201, pendingScopes.body);
  const temporaryPassword = created.json().temporaryPassword;
  assert.ok(temporaryPassword.length >= 15);
  const employeeLogin = await post("/auth/local/login", { email: employeeEmail, password: temporaryPassword });
  assert.equal(employeeLogin.statusCode, 200, employeeLogin.body);
  const employeeCookie = sessionCookie(employeeLogin);
  const employeeCsrf = (await app.inject({
    method: "GET", url: "/auth/csrf", headers: { cookie: employeeCookie },
  })).json().token;
  const employeeChanged = await post("/auth/local/password", {
    currentPassword: temporaryPassword, newPassword: "new-employee-test-password-12345",
  }, employeeCookie, employeeCsrf);
  assert.equal(employeeChanged.statusCode, 204, employeeChanged.body);
  const employeeAdmin = await app.inject({
    method: "GET", url: "/api/v1/admin/users", headers: { cookie: employeeCookie },
  });
  assert.equal(employeeAdmin.statusCode, 403);
  const deactivated = await app.inject({
    method: "PATCH", url: `/api/v1/admin/users/${created.json().id}`,
    headers: { cookie: masterCookie, origin: process.env.APP_PUBLIC_ORIGIN, "x-csrf-token": csrf },
    payload: { isActive: false },
  });
  assert.equal(deactivated.statusCode, 204, deactivated.body);
  const revoked = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: employeeCookie } });
  assert.equal(revoked.statusCode, 401);
  console.log("Local login, first password change, master provisioning, role isolation and revocation passed.");
} finally {
  await app.close();
  await pool.end();
}
