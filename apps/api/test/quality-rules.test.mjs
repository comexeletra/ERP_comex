import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { qualityRules, registerQualityRuleRoutes } from "../dist/quality-rules.js";

const actorId = "00000000-0000-4000-8000-000000000070";
const itemId = "00000000-0000-4000-8000-000000000071";
const waiverId = "00000000-0000-4000-8000-000000000072";
const hash = "a".repeat(64);
const rolesBySubject = {
  master: [{ role: "Master", importer_code: null }],
  buyer: [{ role: "Compras", importer_code: "ELETRA MATRIZ" }],
  reader: [{ role: "Consulta", importer_code: "ELETRA MATRIZ" }],
};
const ruleCode = sql => /SELECT '([A-Z_]+)'::text AS rule/u.exec(sql)?.[1];

async function fixture(t, { subject = "buyer", finding = true, activeWaiver = null, previousReceipt = null,
  waiver = { id: waiverId, status: "ACTIVE", importer: "ELETRA MATRIZ", rule_code: "ITEM_WITHOUT_NCM", entity_id: itemId } } = {}) {
  const reads = [];
  const writes = [];
  const pool = {
    async query(sql, values = []) {
      if (sql.includes("identity.erp_user AS u")) return { rows: rolesBySubject[subject] ?? [] };
      if (sql.includes("SELECT DISTINCT importer")) return { rows: [{ importer: "ELETRA MATRIZ" }] };
      reads.push({ sql, values });
      return { rows: [{ total_count: 1, counts_by_rule: [{ rule: "ITEM_WITHOUT_NCM", group: "REGISTRATION", open: 1, waived: 0 }],
        items: [{ rule: "ITEM_WITHOUT_NCM", entityId: itemId }] }] };
    },
    async connect() {
      return {
        async query(sql, values = []) {
          writes.push({ sql, values });
          if (sql.includes("FROM procurement.operational_command_receipt")) {
            return { rows: previousReceipt ? [previousReceipt] : [], rowCount: previousReceipt ? 1 : 0 };
          }
          if (sql.includes("AS found WHERE found.entity_id = $1")) {
            return { rows: finding ? [{ entity_id: itemId, importer: "ELETRA MATRIZ", checked: { ncm: null }, values_sha256: hash }] : [],
              rowCount: Number(finding) };
          }
          if (sql.includes("FROM migration.quality_rule_waiver") && sql.includes("status = 'ACTIVE'") && sql.includes("FOR UPDATE")) {
            return { rows: activeWaiver ? [activeWaiver] : [], rowCount: activeWaiver ? 1 : 0 };
          }
          if (sql.includes("FROM migration.quality_rule_waiver") && sql.includes("WHERE id = $1")) {
            return { rows: waiver ? [waiver] : [], rowCount: waiver ? 1 : 0 };
          }
          if (sql.includes("INSERT INTO migration.quality_rule_waiver")) {
            return { rows: [{ id: values[0], rule: values[1], status: "ACTIVE" }], rowCount: 1 };
          }
          if (sql.includes("UPDATE migration.quality_rule_waiver")) {
            return { rows: [{ id: values[0], status: "REVOKED" }], rowCount: 1 };
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
    request.authContext = { issuer: "ci", subject, userId: actorId, displayName: null, sessionToken: "ci" };
  });
  await registerQualityRuleRoutes(app, pool);
  return { app, reads, writes };
}

const waive = (app, payload = { rule: "ITEM_WITHOUT_NCM", entityId: itemId, reason: "Despacho antecipado conferido." },
  key = "waiver-key") => app.inject({ method: "POST", url: "/api/v1/quality/current/waivers",
  headers: { "idempotency-key": key }, payload });

test("M077 keeps waivers per rule and entity, unique while active and never deleted", async () => {
  const migration = (await readFile(new URL("../migrations/M077_quality_rule_waiver.sql", import.meta.url), "utf8"))
    .replace(/^--.*$/gmu, "");
  assert.match(migration, /CREATE TABLE migration\.quality_rule_waiver/u);
  assert.match(migration, /entity_type IN \('PURCHASE_ORDER', 'PURCHASE_ORDER_ITEM', 'IMPORT_PROCESS', 'PURCHASE_REQUEST'\)/u);
  assert.match(migration, /values_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/u);
  assert.match(migration, /status IN \('ACTIVE', 'REVOKED'\)/u);
  assert.match(migration, /CREATE UNIQUE INDEX [a-z_]+\s+ON migration\.quality_rule_waiver \(rule_code, entity_id\)\s+WHERE status = 'ACTIVE'/u);
  assert.match(migration, /Waiver identity or revoked waiver cannot be changed/u);
  assert.match(migration, /'import_erp_app', 'import_erp_hml_app'/u);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON migration\.quality_rule_waiver/u);
  assert.doesNotMatch(migration, /DELETE FROM|GRANT[^;]*DELETE|ALTER TABLE|DROP /u);
});

test("the catalog has the twelve rules of the plan, grouped and typed", () => {
  assert.deepEqual(qualityRules.map(rule => [rule.code, rule.group, rule.entityType]), [
    ["ITEM_WITHOUT_NCM", "REGISTRATION", "PURCHASE_ORDER_ITEM"],
    ["ITEM_NCM_NOT_REGISTERED", "REGISTRATION", "PURCHASE_ORDER_ITEM"],
    ["ITEM_PRODUCT_NOT_REGISTERED", "REGISTRATION", "PURCHASE_ORDER_ITEM"],
    ["ITEM_PRICE_WITHOUT_CURRENCY", "REGISTRATION", "PURCHASE_ORDER_ITEM"],
    ["ITEM_WITHOUT_PRICE", "REGISTRATION", "PURCHASE_ORDER_ITEM"],
    ["PO_WITHOUT_SUPPLIER", "REGISTRATION", "PURCHASE_ORDER"],
    ["ITEM_PO_APPROVED_BEFORE_SC", "DATES", "PURCHASE_ORDER_ITEM"],
    ["IP_CLEARED_BEFORE_ARRIVAL", "DATES", "IMPORT_PROCESS"],
    ["IP_WITHOUT_PO", "LINKS", "IMPORT_PROCESS"],
    ["ITEM_SHIPPED_WITHOUT_IP", "LINKS", "PURCHASE_ORDER_ITEM"],
    ["IP_PO_SUPPLIER_MISMATCH", "LINKS", "IMPORT_PROCESS"],
    ["SC_MULTIPLE_SUPPLIERS", "LINKS", "PURCHASE_REQUEST"],
  ]);
});

test("every rule skips cancelled or deleted records and only reads", () => {
  for (const rule of qualityRules) {
    assert.doesNotMatch(rule.sql, /\b(INSERT|UPDATE|DELETE)\b/u, rule.code);
    if (rule.entityType === "PURCHASE_ORDER_ITEM") {
      assert.match(rule.sql, /po\.lifecycle_status NOT IN \('CANCELLED', 'DELETED'\)/u, rule.code);
      assert.match(rule.sql, /coalesce\(item\.source_status, ''\) <> 'CANCELLED'/u, rule.code);
    }
    if (rule.entityType === "IMPORT_PROCESS") {
      assert.match(rule.sql, /ip\.deleted_at IS NULL AND ip\.record_status = 'ACTIVE'/u, rule.code);
    }
    if (rule.entityType === "PURCHASE_ORDER" || rule.entityType === "PURCHASE_REQUEST") {
      assert.match(rule.sql, /lifecycle_status NOT IN \('CANCELLED', 'DELETED'\)/u, rule.code);
    }
    for (const column of ["entity_id", "importer", "labels", "checked", "links"]) {
      assert.match(rule.sql, new RegExp(`AS ${column}\\b`, "u"), `${rule.code} ${column}`);
    }
  }
  const byCode = Object.fromEntries(qualityRules.map(rule => [rule.code, rule.sql]));
  assert.match(byCode.ITEM_PRODUCT_NOT_REGISTERED,
    /product\.kind = 'PRODUCT' AND product\.importer IS NULL AND product\.status = 'ACTIVE'\s+AND product\.normalized_code = upper\(btrim\(item\.product_code\)\)/u);
  assert.match(byCode.ITEM_NCM_NOT_REGISTERED, /ncm\.normalized_code = regexp_replace\(item\.ncm, '\[\^0-9\]', '', 'g'\)/u);
  assert.match(byCode.ITEM_PRICE_WITHOUT_CURRENCY, /item\.unit_price IS NOT NULL AND nullif\(btrim\(item\.currency_code\), ''\) IS NULL/u);
  assert.match(byCode.ITEM_SHIPPED_WITHOUT_IP, /'WAITING SHIPMENT', 'WAITING ARRIVAL', 'CUSTOMS CLEARANCE', 'DELIVERED'/u);
  assert.match(byCode.ITEM_SHIPPED_WITHOUT_IP, /allocation\.status = 'ACTIVE'/u);
  assert.match(byCode.IP_CLEARED_BEFORE_ARRIVAL, /ip\.clearance_date < ip\.arrival_date/u);
  assert.match(byCode.ITEM_PO_APPROVED_BEFORE_SC, /item\.po_approval_date < item\.sc_approval_date/u);
});

test("the current list scopes, searches as a parameter, hides waived findings and counts per rule", async t => {
  const { app, reads } = await fixture(t);
  const response = await app.inject({ method: "GET", url: "/api/v1/quality/current?search=%20031178%20&rule=ITEM_WITHOUT_NCM&pageSize=10" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().countsByRule, [{ rule: "ITEM_WITHOUT_NCM", group: "REGISTRATION", open: 1, waived: 0 }]);
  const { sql, values } = reads.at(-1);
  assert.deepEqual(qualityRules.map(rule => rule.code).filter(code => sql.includes(`'${code}'::text AS rule`)).length, 12);
  assert.match(sql, /finding\.importer = ANY\(\$1::text\[\]\)/u);
  assert.deepEqual(values.slice(0, 6), [["ELETRA MATRIZ"], "031178", "ITEM_WITHOUT_NCM", null, false, 10]);
  assert.match(sql, /strpos\(lower\(finding\.labels::text \|\| finding\.checked::text\), lower\(\$2\)\) > 0/u);
  assert.match(sql, /waiver\.values_sha256 = scoped\.values_sha256/u);
  assert.match(sql, /\(\$5::boolean OR waiver_id IS NULL\)/u);
  assert.doesNotMatch(sql, /031178/u);
});

test("master sees every importer and invalid filters are refused", async t => {
  const { app, reads } = await fixture(t, { subject: "master" });
  const ok = await app.inject({ method: "GET", url: "/api/v1/quality/current?group=DATES&includeWaived=true" });
  assert.equal(ok.statusCode, 200);
  assert.match(reads.at(-1).sql, /WHERE \(TRUE\)/u);
  assert.deepEqual(reads.at(-1).values.slice(0, 4), [null, null, "DATES", true]);
  for (const query of ["rule=UNKNOWN", "group=OTHER", `search=${"x".repeat(81)}`, "pageSize=201"]) {
    const refused = await app.inject({ method: "GET", url: `/api/v1/quality/current?${query}` });
    assert.equal(refused.statusCode, 400, query);
  }
});

test("a waiver recomputes the rule, stores the checked values hash and records audit", async t => {
  const { app, writes } = await fixture(t);
  const response = await waive(app);
  assert.equal(response.statusCode, 201);
  const check = writes.find(write => write.sql.includes("AS found WHERE found.entity_id = $1"));
  assert.equal(ruleCode(check.sql), undefined);
  assert.match(check.sql, /item\.id AS entity_id/u);
  assert.match(check.sql, /nullif\(btrim\(item\.ncm\), ''\) IS NULL/u);
  assert.deepEqual(check.values, [itemId, ["ELETRA MATRIZ"]]);
  const insert = writes.find(write => write.sql.includes("INSERT INTO migration.quality_rule_waiver"));
  assert.deepEqual(insert.values.slice(1, 7), ["ITEM_WITHOUT_NCM", "PURCHASE_ORDER_ITEM", itemId, "ELETRA MATRIZ",
    JSON.stringify({ ncm: null }), hash]);
  assert.ok(writes.some(write => write.sql.includes("INSERT INTO audit.audit_log")));
  assert.ok(writes.some(write => write.sql.includes("INSERT INTO audit.outbox_message")));
  assert.ok(writes.some(write => write.sql.includes("INSERT INTO procurement.operational_command_receipt")));
  assert.equal(writes.at(-1).sql, "COMMIT");
});

test("a waiver is refused when the rule is no longer violated or the same values are already waived", async t => {
  const notViolated = await fixture(t, { finding: false });
  const first = await waive(notViolated.app);
  assert.equal(first.statusCode, 409);
  assert.equal(first.json().code, "QUALITY_RULE_NOT_VIOLATED");
  assert.ok(!notViolated.writes.some(write => write.sql.includes("INSERT INTO migration.quality_rule_waiver")));
  const same = await fixture(t, { activeWaiver: { id: waiverId, values_sha256: hash } });
  const second = await waive(same.app);
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().code, "QUALITY_RULE_ALREADY_WAIVED");
});

test("a waiver over changed values revokes the previous one in the same transaction", async t => {
  const { app, writes } = await fixture(t, { activeWaiver: { id: waiverId, values_sha256: "b".repeat(64) } });
  const response = await waive(app);
  assert.equal(response.statusCode, 201);
  const revoke = writes.findIndex(write => write.sql.includes("UPDATE migration.quality_rule_waiver"));
  const insert = writes.findIndex(write => write.sql.includes("INSERT INTO migration.quality_rule_waiver"));
  assert.ok(revoke > 0 && revoke < insert);
  assert.equal(writes[revoke].values[0], waiverId);
});

test("waivers need quality.resolve, a known rule, a reason and an idempotency key", async t => {
  const reader = await fixture(t, { subject: "reader" });
  assert.equal((await waive(reader.app)).statusCode, 403);
  const { app, writes } = await fixture(t);
  assert.equal((await waive(app, { rule: "UNKNOWN", entityId: itemId, reason: "Despacho antecipado." })).statusCode, 400);
  assert.equal((await waive(app, { rule: "ITEM_WITHOUT_NCM", entityId: itemId, reason: "curto" })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/quality/current/waivers",
    payload: { rule: "ITEM_WITHOUT_NCM", entityId: itemId, reason: "Despacho antecipado." } })).statusCode, 400);
  assert.equal(writes.length, 0);
});

test("a replayed waiver returns the first result, and the same key with other content is refused", async t => {
  const payload = { rule: "ITEM_WITHOUT_NCM", entityId: itemId, reason: "Despacho antecipado conferido." };
  const payloadHash = createHash("sha256").update(JSON.stringify({ type: "QUALITY_RULE_WAIVER", payload })).digest("hex");
  const previousReceipt = { payload_sha256: payloadHash, resource_type: "QUALITY_RULE_WAIVER", resource_id: waiverId };
  const { app, writes } = await fixture(t, { previousReceipt });
  const replay = await waive(app, payload);
  // Same status as the first answer, as in the other operations that use receipt().
  assert.equal(replay.statusCode, 201);
  assert.equal(replay.json().id, waiverId);
  const conflict = await waive(app, { ...payload, reason: "Outra justificativa conferida." });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().code, "IDEMPOTENCY_KEY_REUSED");
  assert.ok(!writes.some(write => write.sql.includes("INSERT INTO migration.quality_rule_waiver")));
});

test("revoking a waiver checks the scope, keeps the row and records audit", async t => {
  const { app, writes } = await fixture(t);
  const response = await app.inject({ method: "POST", url: `/api/v1/quality/current/waivers/${waiverId}/revoke`,
    payload: { reason: "Dado corrigido na origem." } });
  assert.equal(response.statusCode, 200);
  assert.ok(writes.some(write => write.sql.includes("UPDATE migration.quality_rule_waiver")
    && write.sql.includes("status = 'REVOKED'")));
  assert.ok(writes.some(write => write.sql.includes("INSERT INTO audit.audit_log")));
  const other = await fixture(t, { waiver: { id: waiverId, status: "ACTIVE", importer: "ELETRA FOR" } });
  const hidden = await other.app.inject({ method: "POST", url: `/api/v1/quality/current/waivers/${waiverId}/revoke`,
    payload: { reason: "Dado corrigido na origem." } });
  assert.equal(hidden.statusCode, 404);
  const revoked = await fixture(t, { waiver: { id: waiverId, status: "REVOKED", importer: "ELETRA MATRIZ" } });
  const again = await revoked.app.inject({ method: "POST", url: `/api/v1/quality/current/waivers/${waiverId}/revoke`,
    payload: { reason: "Dado corrigido na origem." } });
  assert.equal(again.statusCode, 409);
});
