import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { loadE2eTargetSets, registerE2eTargetRoutes } from "../dist/e2e-targets.js";
import { DEFAULT_E2E_TARGET_SET } from "../dist/followup-calculations.js";

const actorId = "00000000-0000-4000-8000-000000000020";
const setId = "00000000-0000-4000-8000-000000000021";
const stored = { id: setId, ...DEFAULT_E2E_TARGET_SET, version: "1", updatedAt: "2026-10-26T12:00:00.000Z" };
const body = { validFrom: "2027-01-01", t0Days: 8, t1Days: 8, t2Days: 7, t3MtsDays: 25, t3NotMtsDays: 40,
  t4SeaDays: 50, t4AirDays: 10, t5Days: 10, reason: "Nova negociação de frete" };

async function fixture(t, { role = "Administrador", taken = false } = {}) {
  const writes = [];
  const pool = {
    async query(sql) {
      if (sql.includes("identity.erp_user AS u")) return { rows: [{ role, importer_code: "ELETRA MATRIZ" }] };
      if (sql.includes("FROM catalog.e2e_target_set ORDER BY valid_from")) return { rows: [stored] };
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, values = []) {
          writes.push({ sql, values });
          if (sql.includes("INSERT INTO catalog.e2e_target_set")) {
            return { rows: taken ? [] : [{ ...body, id: "00000000-0000-4000-8000-000000000022", version: "1" }] };
          }
          if (sql.includes("FOR UPDATE")) return { rows: [stored] };
          if (sql.includes("UPDATE catalog.e2e_target_set")) return { rows: [{ ...stored, ...body, version: "2" }] };
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
    request.authContext = { issuer: "ci", subject: "admin", userId: actorId, displayName: null, sessionToken: "ci" };
  });
  await registerE2eTargetRoutes(app, pool);
  return { app, writes };
}

test("M070 stores dated E2E target sets seeded with the process defaults", async () => {
  const migration = await readFile(new URL("../migrations/M070_e2e_target_sets.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE catalog\.e2e_target_set/u);
  assert.match(migration, /CONSTRAINT e2e_target_set_valid_from_unique UNIQUE \(valid_from\)/u);
  assert.match(migration, /t0_days BETWEEN 0 AND 365/u);
  assert.match(migration, /VALUES \(md5\('E2E_TARGET_SET\|2000-01-01'\)::uuid, DATE '2000-01-01', 8, 8, 7, 30, 45, 55, 10, 10, 'migration:M070'\)/u);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON catalog\.e2e_target_set TO import_erp_hml_app/u);
  assert.doesNotMatch(migration, /DELETE|GRANT [^;]*DELETE/u);
  assert.equal(DEFAULT_E2E_TARGET_SET.validFrom, "2000-01-01");
});

test("anyone who reads POs lists the target sets; the calculation falls back to the defaults", async t => {
  const { app } = await fixture(t, { role: "Consulta" });
  const response = await app.inject({ method: "GET", url: "/api/v1/e2e-targets" });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().items.map(set => [set.validFrom, set.t3MtsDays, set.t3NotMtsDays]), [["2000-01-01", 30, 45]]);
  assert.deepEqual(await loadE2eTargetSets({ query: async () => ({ rows: [] }) }), [DEFAULT_E2E_TARGET_SET]);
});

test("only Master and Administrador create a set, with a reason, an audit row and a unique start", async t => {
  const denied = await fixture(t, { role: "Compras" });
  const forbidden = await denied.app.inject({ method: "POST", url: "/api/v1/e2e-targets", payload: body });
  assert.equal(forbidden.statusCode, 403);

  const { app, writes } = await fixture(t);
  const invalid = await app.inject({ method: "POST", url: "/api/v1/e2e-targets", payload: { ...body, t4SeaDays: 400 } });
  assert.equal(invalid.statusCode, 400);
  const created = await app.inject({ method: "POST", url: "/api/v1/e2e-targets", payload: body });
  assert.equal(created.statusCode, 201, created.body);
  const insert = writes.find(write => write.sql.includes("INSERT INTO catalog.e2e_target_set"));
  assert.deepEqual(insert.values, ["2027-01-01", 8, 8, 7, 25, 40, 50, 10, 10, "ci#admin"]);
  const audit = writes.find(write => write.sql.includes("INSERT INTO audit.audit_log"));
  assert.equal(audit.values[1], "E2E_TARGET_SET");
  assert.equal(audit.values[5], "CREATE");
  assert.equal(audit.values[9], "Nova negociação de frete");
  assert.ok(writes.some(write => write.sql.includes("INSERT INTO audit.outbox_message")));

  const duplicate = await (await fixture(t, { taken: true })).app.inject({ method: "POST", url: "/api/v1/e2e-targets", payload: body });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().code, "E2E_TARGETS_DATE_TAKEN");
});

test("editing a set requires its current version and keeps the previous values in the audit", async t => {
  const { app, writes } = await fixture(t);
  const url = `/api/v1/e2e-targets/${setId}`;
  assert.equal((await app.inject({ method: "PATCH", url, payload: body })).statusCode, 428);
  const stale = await app.inject({ method: "PATCH", url, payload: body, headers: { "x-record-version": "7" } });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, "VERSION_CONFLICT");
  const saved = await app.inject({ method: "PATCH", url, payload: body, headers: { "x-record-version": "1" } });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().version, "2");
  const audit = writes.filter(write => write.sql.includes("INSERT INTO audit.audit_log")).at(-1);
  assert.equal(audit.values[5], "UPDATE");
  assert.equal(JSON.parse(audit.values[6]).t3MtsDays, 30);
  assert.equal(JSON.parse(audit.values[7]).t3MtsDays, 25);
});
