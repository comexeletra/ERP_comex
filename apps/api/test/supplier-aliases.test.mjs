import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { exporterMatchesAlias, normalizeExporterText } from "../dist/exporter-alias.js";
import { registerSupplierAliasRoutes } from "../dist/supplier-aliases.js";

const actorId = "00000000-0000-4000-8000-000000000050";
const supplierId = "00000000-0000-4000-8000-000000000135";
const aliasId = "00000000-0000-4000-8000-000000000051";
const exporter = "HEXING ELECTRICAL CO.,LTD\nSHANGCHENG INDUSTRIAL ZONE, 1418,\nMOGANSHAN";
const hexingAlias = { id: aliasId, supplierId, alias: "HEXING ELECTRICAL CO.,LTD", normalizedAlias: "HEXINGELECTRICALCOLTD",
  status: "ACTIVE", version: "1", createdAt: "2026-10-29T12:00:00.000Z", createdBy: "ci#admin" };

async function fixture(t, { role = "Compras", supplierExists = true, duplicate = false, alias = hexingAlias,
  previousReceipt = null } = {}) {
  const writes = [];
  const reads = [];
  const answer = (sql, values) => {
    if (sql.includes("SELECT DISTINCT importer")) return { rows: [] };
    if (sql.includes("FROM catalog.entry") && sql.includes("kind = 'SUPPLIER'")) {
      return { rows: supplierExists ? [{ id: supplierId, code: "EX000135", name: "HEXING ELECTRICAL CO.,LTD HANGZHOU" }] : [],
        rowCount: Number(supplierExists) };
    }
    if (sql.includes("FROM procurement.operational_command_receipt")) {
      return { rows: previousReceipt ? [previousReceipt] : [], rowCount: previousReceipt ? 1 : 0 };
    }
    if (sql.includes("FROM catalog.supplier_exporter_alias") && sql.includes("normalized_alias = $2")) {
      return { rows: duplicate ? [{ id: aliasId }] : [], rowCount: Number(duplicate) };
    }
    if (sql.includes("FROM catalog.supplier_exporter_alias")) return { rows: alias ? [alias] : [], rowCount: alias ? 1 : 0 };
    return undefined;
  };
  const pool = {
    async query(sql, values = []) {
      if (sql.includes("identity.erp_user AS u")) return { rows: [{ role, importer_code: null }] };
      reads.push({ sql, values });
      const result = answer(sql, values);
      if (result) return result;
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, values = []) {
          writes.push({ sql, values });
          if (sql.includes("INSERT INTO catalog.supplier_exporter_alias")) {
            return { rows: [{ ...hexingAlias, id: values[0], alias: values[2] }], rowCount: 1 };
          }
          if (sql.includes("UPDATE catalog.supplier_exporter_alias")) {
            return { rows: [{ ...hexingAlias, status: "REMOVED", version: "2" }], rowCount: 1 };
          }
          return answer(sql, values) ?? { rows: [], rowCount: 1 };
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
  await registerSupplierAliasRoutes(app, pool);
  return { app, writes, reads };
}

const createUrl = `/api/v1/suppliers/${supplierId}/exporter-aliases`;
const removeUrl = `${createUrl}/${aliasId}/remove`;
const create = (app, payload, key = "alias-create") => app.inject({ method: "POST", url: createUrl,
  headers: { "idempotency-key": key }, payload });
const inserted = writes => writes.filter(write => write.sql.includes("INSERT INTO catalog.supplier_exporter_alias"));

test("M074 keeps Exporter aliases per global supplier, normalized, unique while active and never deleted", async () => {
  const migration = (await readFile(new URL("../migrations/M074_supplier_exporter_alias.sql", import.meta.url), "utf8"))
    .replace(/^--.*$/gmu, "");
  assert.match(migration, /CREATE TABLE catalog\.supplier_exporter_alias/u);
  assert.match(migration, /supplier_entry_id uuid NOT NULL REFERENCES catalog\.entry\(id\) ON DELETE RESTRICT/u);
  assert.match(migration, /normalized_alias text GENERATED ALWAYS AS \(upper\(regexp_replace\(alias, '\[\^A-Za-z0-9\]', '', 'g'\)\)\) STORED/u);
  assert.match(migration, /length\(normalized_alias\) >= 8/u);
  assert.match(migration, /status IN \('ACTIVE', 'REMOVED'\)/u);
  assert.match(migration, /CREATE UNIQUE INDEX [a-z_]+\s+ON catalog\.supplier_exporter_alias \(supplier_entry_id, normalized_alias\)\s+WHERE status = 'ACTIVE'/u);
  assert.match(migration, /kind = 'SUPPLIER' AND importer IS NULL/u);
  assert.match(migration, /Exporter alias identity or removed alias cannot be changed/u);
  assert.match(migration, /'import_erp_app', 'import_erp_hml_app'/u);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON catalog\.supplier_exporter_alias/u);
  assert.doesNotMatch(migration, /DELETE FROM|GRANT[^;]*DELETE|ALTER TABLE|DROP /u);
});

test("an Exporter matches a supplier alias by its normalized start, never by a short alias", () => {
  assert.equal(normalizeExporterText("Hexing Electrical Co.,Ltd"), "HEXINGELECTRICALCOLTD");
  assert.equal(exporterMatchesAlias(exporter, ["HEXING ELECTRICAL CO.,LTD"]), true);
  assert.equal(exporterMatchesAlias(exporter, ["hexing electrical co ltd"]), true);
  assert.equal(exporterMatchesAlias(exporter, ["HEXING ELECTRICAL CO.,LTD HANGZHOU"]), false);
  assert.equal(exporterMatchesAlias(exporter, ["HEXING"]), false);
  assert.equal(exporterMatchesAlias(exporter, []), false);
  assert.equal(exporterMatchesAlias("", ["HEXING ELECTRICAL CO.,LTD"]), false);
});

test("anyone who reads the catalog lists the active aliases of a supplier", async t => {
  const { app, reads } = await fixture(t, { role: "Consulta" });
  const response = await app.inject({ url: createUrl });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { items: [hexingAlias] });
  const list = reads.find(read => read.sql.includes("FROM catalog.supplier_exporter_alias"));
  assert.match(list.sql, /status = 'ACTIVE'/u);
  assert.deepEqual(list.values, [supplierId]);
});

test("a supplier editor registers an alias with receipt, audit and outbox", async t => {
  const { app, writes } = await fixture(t);
  const response = await create(app, { alias: "  HEXING ELECTRICAL CO.,LTD ", reason: "Exporter da IPH034A" });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().alias, "HEXING ELECTRICAL CO.,LTD");
  assert.deepEqual(inserted(writes)[0].values.slice(1), [supplierId, "HEXING ELECTRICAL CO.,LTD", "ci#admin"]);
  const duplicateCheck = writes.find(write => write.sql.includes("normalized_alias = $2"));
  assert.deepEqual(duplicateCheck.values, [supplierId, "HEXINGELECTRICALCOLTD"]);
  const audit = writes.find(write => write.sql.includes("INSERT INTO audit.audit_log"));
  assert.equal(audit.values[1], "CATALOG_ENTRY");
  assert.equal(audit.values[2], supplierId);
  assert.equal(audit.values[3], "SUPPLIER_EXPORTER_ALIAS");
  assert.equal(audit.values[5], "CREATE");
  assert.deepEqual(JSON.parse(audit.values[7]), { supplierId, supplierCode: "EX000135", alias: "HEXING ELECTRICAL CO.,LTD" });
  assert.equal(audit.values[9], "Exporter da IPH034A");
  assert.ok(writes.some(write => write.sql.includes("INSERT INTO audit.outbox_message")));
  assert.ok(writes.some(write => write.sql.includes("INSERT INTO procurement.operational_command_receipt")
    && write.values[3] === "SUPPLIER_EXPORTER_ALIAS"));
});

test("a repeated idempotency key returns the alias already registered, and other content is refused", async t => {
  const payload = { alias: "HEXING ELECTRICAL CO.,LTD", reason: "Exporter da IPH034A" };
  const hash = createHash("sha256").update(JSON.stringify({ type: "SUPPLIER_EXPORTER_ALIAS",
    payload: { supplierId, ...payload } })).digest("hex");
  const replay = await fixture(t, { previousReceipt: { payload_sha256: hash, resource_type: "SUPPLIER_EXPORTER_ALIAS",
    resource_id: aliasId } });
  const repeated = await create(replay.app, payload);
  assert.equal(repeated.statusCode, 201, repeated.body);
  assert.deepEqual(repeated.json(), hexingAlias);
  assert.equal(inserted(replay.writes).length, 0);

  const reused = await fixture(t, { previousReceipt: { payload_sha256: "x".repeat(64),
    resource_type: "SUPPLIER_EXPORTER_ALIAS", resource_id: aliasId } });
  const response = await create(reused.app, payload);
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().code, "IDEMPOTENCY_KEY_REUSED");
  assert.equal(inserted(reused.writes).length, 0);
});

test("short, duplicate or unknown-supplier aliases are refused before writing", async t => {
  const short = await fixture(t);
  const tooShort = await create(short.app, { alias: "HEXING", reason: "Exporter da IPH034A" });
  assert.equal(tooShort.statusCode, 400, tooShort.body);
  assert.equal(tooShort.json().code, "INVALID_EXPORTER_ALIAS");
  const noReason = await create(short.app, { alias: "HEXING ELECTRICAL CO.,LTD" }, "alias-no-reason");
  assert.equal(noReason.statusCode, 400, noReason.body);
  assert.equal(short.writes.length, 0);

  const duplicate = await fixture(t, { duplicate: true });
  const repeated = await create(duplicate.app, { alias: "Hexing Electrical Co Ltd", reason: "Exporter da IPH034A" });
  assert.equal(repeated.statusCode, 409, repeated.body);
  assert.equal(repeated.json().code, "EXPORTER_ALIAS_DUPLICATE");
  assert.equal(inserted(duplicate.writes).length, 0);

  const unknown = await fixture(t, { supplierExists: false });
  const missing = await create(unknown.app, { alias: "HEXING ELECTRICAL CO.,LTD", reason: "Exporter da IPH034A" });
  assert.equal(missing.statusCode, 404, missing.body);
  assert.equal(inserted(unknown.writes).length, 0);
});

for (const role of ["Importação", "Fiscal", "Consulta"]) {
  test(`${role} cannot register or remove an alias`, async t => {
    const { app, writes } = await fixture(t, { role });
    const created = await create(app, { alias: "HEXING ELECTRICAL CO.,LTD", reason: "Exporter da IPH034A" });
    assert.equal(created.statusCode, 403, created.body);
    const removed = await app.inject({ method: "POST", url: removeUrl, headers: { "x-record-version": "1" },
      payload: { reason: "Apelido errado" } });
    assert.equal(removed.statusCode, 403, removed.body);
    assert.equal(writes.length, 0);
  });
}

test("removing an alias keeps the row as REMOVED with version, reason and audit", async t => {
  const { app, writes } = await fixture(t, { role: "Administrador" });
  const stale = await app.inject({ method: "POST", url: removeUrl, headers: { "x-record-version": "7" },
    payload: { reason: "Apelido errado" } });
  assert.equal(stale.statusCode, 409, stale.body);
  assert.equal(stale.json().code, "VERSION_CONFLICT");
  const response = await app.inject({ method: "POST", url: removeUrl, headers: { "x-record-version": "1" },
    payload: { reason: "Apelido errado" } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().status, "REMOVED");
  const update = writes.find(write => write.sql.includes("UPDATE catalog.supplier_exporter_alias"));
  assert.match(update.sql, /status = 'REMOVED'/u);
  assert.deepEqual(update.values, [aliasId, "ci#admin", "Apelido errado"]);
  const audit = writes.find(write => write.sql.includes("INSERT INTO audit.audit_log"));
  assert.equal(audit.values[5], "REMOVE");
  assert.equal(writes.some(write => /DELETE FROM/u.test(write.sql)), false);
});

test("an alias already removed cannot be removed again", async t => {
  const { app, writes } = await fixture(t, { alias: { ...hexingAlias, status: "REMOVED", version: "2" } });
  const response = await app.inject({ method: "POST", url: removeUrl, headers: { "x-record-version": "2" },
    payload: { reason: "Apelido errado" } });
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().code, "EXPORTER_ALIAS_REMOVED");
  assert.equal(writes.some(write => write.sql.includes("UPDATE catalog.supplier_exporter_alias")), false);
});
