import assert from "node:assert/strict";
import test from "node:test";
import { replaceOfficialNcmSnapshot } from "../dist/ncm-snapshot.js";

const items = Array.from({ length: 9_500 }, (_, index) => ({
  code: String(index + 1).padStart(8, "0"), name: `Teste ${index}`,
  validFrom: null, validTo: null, mandatoryImportAttributes: [],
}));

function fakePool(previousCount = 9_500) {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes("SELECT item_count FROM catalog.ncm_official_snapshot")) {
        return { rows: [{ item_count: previousCount }] };
      }
      if (sql.includes("RETURNING synced_at")) return { rows: [{ synced_at: new Date() }] };
      return { rows: [] };
    }, release() {},
  };
  return { statements, async connect() { return client; } };
}

test("an incomplete source cannot replace the persisted catalog", async () => {
  const pool = fakePool();
  await assert.rejects(replaceOfficialNcmSnapshot(pool, {
    source: "MDIC_GECEX", verifiedComplete: false, items,
  }), /incompleto/u);
  assert.deepEqual(pool.statements, []);
});

test("a suspiciously smaller source rolls back before deleting the valid snapshot", async () => {
  const pool = fakePool(10_516);
  await assert.rejects(replaceOfficialNcmSnapshot(pool, {
    source: "MDIC_GECEX", verifiedComplete: true, items,
  }), /diminuiu mais de 5%/u);
  assert.ok(pool.statements.includes("ROLLBACK"));
  assert.equal(pool.statements.some(sql => sql.includes("DELETE FROM catalog.ncm_official_item")), false);
});

test("MDIC refresh keeps the separate last good Siscomex snapshot", async () => {
  const pool = fakePool();
  await replaceOfficialNcmSnapshot(pool, {
    source: "MDIC_GECEX", sourceReference: "MDIC", sourceUpdatedAt: "2026-10-05",
    attributesVersion: "not-provided", verifiedComplete: true, items,
  });
  assert.ok(pool.statements.includes("COMMIT"));
  assert.equal(pool.statements.some(sql => sql.includes("DELETE FROM catalog.ncm_last_siscomex_item")), false);
});
