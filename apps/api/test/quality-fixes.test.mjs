import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAuthorization } from "../dist/authorization.js";
import { registerQualityFixRoutes } from "../dist/quality-fixes.js";

const actorId = "00000000-0000-4000-8000-000000000080";
const poId = "00000000-0000-4000-8000-000000000081";
const otherPoId = "00000000-0000-4000-8000-000000000082";
const itemA = "00000000-0000-4000-8000-000000000083";
const itemB = "00000000-0000-4000-8000-000000000084";
const itemClosed = "00000000-0000-4000-8000-000000000085";
const rolesBySubject = {
  buyer: [{ role: "Compras", importer_code: "ELETRA MATRIZ" }],
  importer: [{ role: "Importação", importer_code: "ELETRA MATRIZ" }],
  reader: [{ role: "Consulta", importer_code: "ELETRA MATRIZ" }],
};
const items = {
  [itemA]: { id: itemA, purchase_order_id: poId, lifecycle_status: "ACTIVE", importer: "ELETRA MATRIZ",
    supplier_entry_id: "s-1", purchase_request_id: null, product_code: "2010103280", currency_code: null, unit_price: "1.5", ncm: null },
  [itemB]: { id: itemB, purchase_order_id: poId, lifecycle_status: "ACTIVE", importer: "ELETRA MATRIZ",
    supplier_entry_id: "s-1", purchase_request_id: null, product_code: "2010103281", currency_code: null, unit_price: "2", ncm: null },
  [itemClosed]: { id: itemClosed, purchase_order_id: otherPoId, lifecycle_status: "CLOSED", importer: "ELETRA MATRIZ",
    supplier_entry_id: "s-1", purchase_request_id: null, product_code: "2010103282", currency_code: null, unit_price: "3", ncm: null },
};
const pos = {
  [poId]: { id: poId, lifecycle_status: "ACTIVE", importer: "ELETRA MATRIZ", supplier_entry_id: null, supplier_text: null,
    purchase_request_id: null },
  [otherPoId]: { id: otherPoId, lifecycle_status: "ACTIVE", importer: "ELETRA MATRIZ", supplier_entry_id: null,
    supplier_text: null, purchase_request_id: "sc-1" },
};

async function fixture(t, { subject = "buyer", violated = () => true, suggestion = "CNY", refuse = null } = {}) {
  const writes = [];
  const pool = {
    async query(sql, values = []) {
      if (sql.includes("identity.erp_user AS u")) return { rows: rolesBySubject[subject] ?? [] };
      if (sql.includes("SELECT DISTINCT importer")) return { rows: [{ importer: "ELETRA MATRIZ" }] };
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, values = []) {
          writes.push({ sql, values });
          if (sql.includes("FROM procurement.operational_command_receipt")) return { rows: [], rowCount: 0 };
          if (sql.includes("entity_key = 'CURRENCY'")) return { rows: [{ ok: 1 }], rowCount: 1 };
          if (sql.includes("kind = 'SUPPLIER'")) return { rows: [{ id: "s-9", code: "EX000135" }], rowCount: 1 };
          if (sql.includes("kind = 'NCM'") && sql.includes("normalized_code = $1")) return { rows: [{ ok: 1 }], rowCount: 1 };
          if (sql.includes("FROM procurement.purchase_order_item AS item") && sql.includes("FOR UPDATE")) {
            const row = items[values[0]];
            return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
          }
          if (sql.includes("FROM procurement.purchase_order AS po") && sql.includes("FOR UPDATE")) {
            const row = pos[values[0]];
            return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
          }
          if (sql.includes("AS found WHERE found.entity_id = $1")) {
            return violated(values[0]) ? { rows: [{ entity_id: values[0], checked: {} }], rowCount: 1 } : { rows: [], rowCount: 0 };
          }
          if (sql.includes("AS suggestion")) return { rows: [{ suggestion }], rowCount: 1 };
          if (/^UPDATE /u.test(sql.trim()) && refuse && sql.includes(refuse)) {
            throw Object.assign(new Error("refused"), { code: "23514" });
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
  await registerQualityFixRoutes(app, pool);
  return { app, writes };
}

const fix = (app, payload, key = "fix-key") => app.inject({ method: "POST", url: "/api/v1/quality/current/fixes",
  headers: key ? { "idempotency-key": key } : {}, payload });
const reason = "Moeda conferida no pedido do Protheus.";
const updates = writes => writes.filter(write => /^UPDATE /u.test(write.sql.trim()));

test("the fix request is validated before any transaction", async t => {
  const { app, writes } = await fixture(t);
  for (const payload of [
    { action: "ITEM_DATE", entityIds: [itemA], value: {}, reason, preview: true },
    { action: "ITEM_CURRENCY", entityIds: [itemA, itemA], value: {}, reason, preview: true },
    { action: "ITEM_CURRENCY", entityIds: [], value: {}, reason, preview: true },
    { action: "ITEM_PRICE", entityIds: [itemA], value: { currency: "USD" }, reason, preview: true },
    { action: "ITEM_PRICE", entityIds: [itemA], value: { unitPrice: "0", currency: "USD" }, reason, preview: true },
    { action: "PO_SUPPLIER", entityIds: [poId], value: {}, reason, preview: true },
    { action: "ITEM_CURRENCY", entityIds: [itemA], value: {}, reason: "curto", preview: true },
    { action: "ITEM_CURRENCY", entityIds: [itemA], value: { quantity: "1" }, reason, preview: true },
  ]) assert.equal((await fix(app, payload)).statusCode, 400, JSON.stringify(payload));
  const noKey = await fix(app, { action: "ITEM_CURRENCY", entityIds: [itemA], value: {}, reason, preview: false }, null);
  assert.equal(noKey.statusCode, 400);
  assert.equal(writes.length, 0);
});

test("only roles that edit POs fix, and the product NCM also needs a product writer", async t => {
  const reader = await fixture(t, { subject: "reader" });
  assert.equal((await fix(reader.app, { action: "ITEM_CURRENCY", entityIds: [itemA], value: {}, reason, preview: true })).statusCode, 403);
  const importer = await fixture(t, { subject: "importer" });
  const denied = await fix(importer.app, { action: "ITEM_NCM", entityIds: [itemA], value: { ncm: "85371090", alsoProduct: true },
    reason, preview: true });
  assert.equal(denied.statusCode, 403);
  assert.equal(importer.writes.length, 0);
});

test("a preview runs the fix and always rolls back", async t => {
  const { app, writes } = await fixture(t);
  const response = await fix(app, { action: "ITEM_CURRENCY", entityIds: [itemA, itemB], value: {}, reason, preview: true }, null);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().applied, [
    { entityId: itemA, before: { currency: null }, after: { currency: "CNY" } },
    { entityId: itemB, before: { currency: null }, after: { currency: "CNY" } },
  ]);
  assert.deepEqual(response.json().skipped, []);
  assert.equal(writes.at(-1).sql, "ROLLBACK");
  assert.ok(!writes.some(write => write.sql === "COMMIT"));
  assert.ok(!writes.some(write => write.sql.includes("INSERT INTO procurement.operational_command_receipt")));
});

test("applying writes only the currency, audits each item and bumps the PO version once", async t => {
  const { app, writes } = await fixture(t);
  const response = await fix(app, { action: "ITEM_CURRENCY", entityIds: [itemB, itemA], value: { currency: "USD" }, reason,
    preview: false });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().applied.length, 2);
  const changed = updates(writes);
  assert.equal(changed.filter(write => write.sql.includes("SET currency_code = $2")).length, 2);
  for (const write of changed.filter(write => write.sql.includes("procurement.purchase_order_item"))) {
    assert.match(write.sql, /SET currency_code = \$2, updated_at = now\(\)\s+WHERE id = \$1 AND nullif\(btrim\(currency_code\), ''\) IS NULL/u);
  }
  const versions = changed.filter(write => write.sql.includes("SET version = version + 1"));
  assert.equal(versions.length, 1);
  assert.deepEqual(versions[0].values, [[poId]]);
  assert.equal(writes.filter(write => write.sql.includes("INSERT INTO audit.audit_log")).length, 2);
  assert.ok(writes.some(write => write.sql.includes("INSERT INTO procurement.operational_command_receipt")));
  assert.ok(writes.some(write => write.sql.includes("set_config('app.actor_id'")));
  assert.equal(writes.at(-1).sql, "COMMIT");
  // Items are locked in a stable order to avoid deadlocks between two batches.
  const locks = writes.filter(write => write.sql.includes("FOR UPDATE OF item, po"));
  assert.deepEqual(locks.map(write => write.values[0]), [itemA, itemB]);
});

test("records that are closed, no longer in error or without a suggestion are skipped with a reason", async t => {
  const closed = await fixture(t);
  const first = await fix(closed.app, { action: "ITEM_CURRENCY", entityIds: [itemA, itemClosed], value: {}, reason, preview: true });
  assert.deepEqual(first.json().skipped, [{ entityId: itemClosed, code: "PO_NOT_ACTIVE" }]);
  const fixed = await fixture(t, { violated: id => id !== itemB });
  const second = await fix(fixed.app, { action: "ITEM_CURRENCY", entityIds: [itemA, itemB], value: {}, reason, preview: true });
  assert.deepEqual(second.json().skipped, [{ entityId: itemB, code: "NOT_VIOLATED" }]);
  const none = await fixture(t, { suggestion: null });
  const third = await fix(none.app, { action: "ITEM_NCM", entityIds: [itemA], value: {}, reason, preview: true });
  assert.deepEqual(third.json().skipped, [{ entityId: itemA, code: "NO_SUGGESTION" }]);
  assert.equal(updates(none.writes).length, 0);
});

test("a refusal from the database skips that record and keeps the others", async t => {
  const { app, writes } = await fixture(t, { refuse: "SET ncm = $2" });
  const response = await fix(app, { action: "ITEM_NCM", entityIds: [itemA], value: { ncm: "85371090" }, reason, preview: false });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().skipped, [{ entityId: itemA, code: "DATABASE_REFUSED" }]);
  assert.ok(writes.some(write => write.sql.startsWith("ROLLBACK TO SAVEPOINT")));
  assert.equal(writes.at(-1).sql, "COMMIT");
});

test("the item NCM can also fill an empty product NCM, never overwriting it", async t => {
  const { app, writes } = await fixture(t);
  const response = await fix(app, { action: "ITEM_NCM", entityIds: [itemA], value: { ncm: "85371090", alsoProduct: true },
    reason, preview: false });
  assert.equal(response.statusCode, 200);
  const product = updates(writes).find(write => write.sql.includes("UPDATE catalog.entry"));
  assert.match(product.sql, /SET product_ncm_code = \$2/u);
  assert.match(product.sql, /nullif\(btrim\(product_ncm_code\), ''\) IS NULL/u);
  assert.match(product.sql, /kind = 'PRODUCT' AND importer IS NULL/u);
});

test("the PO supplier is set only on a PO without SC, through the supplier code", async t => {
  const { app, writes } = await fixture(t);
  const response = await fix(app, { action: "PO_SUPPLIER", entityIds: [poId, otherPoId], value: { supplierCode: "EX000135" },
    reason, preview: false });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().applied, [{ entityId: poId, before: { supplier: null }, after: { supplier: "EX000135" } }]);
  assert.deepEqual(response.json().skipped, [{ entityId: otherPoId, code: "PO_HAS_SC" }]);
  const update = updates(writes).find(write => write.sql.includes("UPDATE procurement.purchase_order SET supplier_text"));
  assert.match(update.sql, /SET supplier_text = \$2, version = version \+ 1, updated_at = now\(\)/u);
  assert.match(update.sql, /supplier_entry_id IS NULL AND nullif\(btrim\(supplier_text\), ''\) IS NULL/u);
});

test("fixes never write columns outside the plan", async t => {
  const allowed = new Set(["currency_code", "unit_price", "ncm", "product_ncm_code", "supplier_text", "version", "updated_at", "updated_by"]);
  for (const [action, value] of [["ITEM_CURRENCY", {}], ["ITEM_PRICE", { unitPrice: "1.25", currency: "USD" }],
    ["ITEM_NCM", { ncm: "85371090", alsoProduct: true }], ["PO_SUPPLIER", { supplierCode: "EX000135" }]]) {
    const { app, writes } = await fixture(t);
    const ids = action === "PO_SUPPLIER" ? [poId] : [itemA];
    await fix(app, { action, entityIds: ids, value, reason, preview: false }, `key-${action}`);
    for (const write of updates(writes)) {
      const set = /SET (.*?) WHERE/su.exec(write.sql)[1];
      for (const column of set.split(",").map(part => part.trim().split(/\s*=/u)[0])) assert.ok(allowed.has(column), `${action}: ${column}`);
    }
  }
});
