import assert from "node:assert/strict";
import test from "node:test";
import { replaceOfficialNcmSnapshot } from "../dist/ncm-snapshot.js";

const items = Array.from({ length: 9_500 }, (_, index) => ({
  code: String(index + 1).padStart(8, "0"), name: `Teste ${index}`,
  validFrom: null, validTo: null, mandatoryImportAttributes: [],
}));

function fakePool(previousCount = 9_500) {
  const statements = [];
  const writes = [];
  const client = {
    async query(sql, values = []) {
      statements.push(sql);
      writes.push({ sql, values });
      if (sql.includes("SELECT item_count FROM catalog.ncm_last_siscomex_snapshot")) {
        return { rows: [{ item_count: previousCount }] };
      }
      if (sql.includes("RETURNING synced_at")) return { rows: [{ synced_at: new Date() }] };
      return { rows: [] };
    }, release() {},
  };
  return { statements, writes, async connect() { return client; } };
}

test("snapshot persists the creation act with the required attribute details", async () => {
  const pool = fakePool();
  const creationAct = { tipoOrgaoAtoIni: "Resolução", numeroAtoIni: "42", anoAtoIni: "2022" };
  await replaceOfficialNcmSnapshot(pool, { source: "SISCOMEX", sourceReference: "Siscomex",
    sourceUpdatedAt: "2026-10-19", attributesVersion: "360", verifiedComplete: true,
    items: [{ ...items[0], creationAct }, ...items.slice(1)] });
  const insert = pool.writes.find(write => write.sql.includes("INSERT INTO catalog.ncm_official_item"));
  assert.ok(insert);
  assert.equal(insert.values[5], JSON.stringify(creationAct));
  assert.equal(pool.statements.includes("COMMIT"), true);
});

test("large attribute domains are split into memory-bounded PostgreSQL statements", async () => {
  const pool = fakePool();
  const large = { ...items[0], mandatoryImportAttributes: [{
    code: "ATT_1", domain: [{ code: "1", description: "x".repeat(20_000) }],
  }] };
  await replaceOfficialNcmSnapshot(pool, { source: "SISCOMEX", sourceReference: "Siscomex",
    sourceUpdatedAt: "2026-10-19", attributesVersion: "360", verifiedComplete: true,
    items: [...Array.from({ length: 40 }, (_, index) => ({ ...large, code: items[index].code })),
      ...items.slice(40)] });
  const batches = pool.writes.filter(write => write.sql.includes("INSERT INTO catalog.ncm_official_item"));
  assert.ok(batches.length > 475);
  for (const batch of batches) {
    assert.ok(batch.values.length <= 20 * 6);
    const bytes = batch.values.reduce((sum, value) => sum + Buffer.byteLength(String(value ?? "")), 0);
    assert.ok(bytes <= 256 * 1024, `Oversized batch: ${bytes} bytes`);
  }
  assert.equal(pool.statements.includes("COMMIT"), true);
});

test("an incomplete source cannot replace the persisted catalog", async () => {
  const pool = fakePool();
  await assert.rejects(replaceOfficialNcmSnapshot(pool, {
    source: "SISCOMEX", verifiedComplete: false, items,
  }), /incompleto/u);
  assert.deepEqual(pool.statements, []);
});

test("a suspiciously smaller source rolls back before deleting the valid snapshot", async () => {
  const pool = fakePool(10_516);
  await assert.rejects(replaceOfficialNcmSnapshot(pool, {
    source: "SISCOMEX", verifiedComplete: true, items,
  }), /diminuiu mais de 5%/u);
  assert.ok(pool.statements.includes("ROLLBACK"));
  assert.equal(pool.statements.some(sql => sql.includes("DELETE FROM catalog.ncm_official_item")), false);
});

test("MDIC cannot replace or modify the persisted Siscomex snapshot", async () => {
  const pool = fakePool();
  await assert.rejects(replaceOfficialNcmSnapshot(pool, {
    source: "MDIC_GECEX", sourceReference: "MDIC", sourceUpdatedAt: "2026-10-05",
    attributesVersion: "not-provided", verifiedComplete: true, items,
  }), /MDIC está inativa/u);
  assert.deepEqual(pool.statements, []);
});
