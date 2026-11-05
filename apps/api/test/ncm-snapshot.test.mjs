import assert from "node:assert/strict";
import test from "node:test";
import { createPersistedOfficialNcmLookup, replaceOfficialNcmSnapshot } from "../dist/ncm-snapshot.js";

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

const siscomexSnapshot = {
  catalog_source: "SISCOMEX", source_reference: "Portal Único Siscomex / Classif",
  source_updated_at: "2026-11-05", attributes_source_version: "361", item_count: 10_516,
  synced_at: new Date("2026-11-05T15:01:15Z"),
};
const persistedRow = {
  code: "85444900", name: "Outros cabos", valid_from: "2022-04-01", valid_to: "9999-12-31",
  mandatory_import_attributes: [{ code: "ATT_1" }], creation_act: { numeroAtoIni: "272" },
};

function lookupPool({ current = siscomexSnapshot, archived = null, totalCount = 1, rows = [persistedRow] } = {}) {
  const queries = [];
  return {
    queries,
    async connect() { throw new Error("The lookup must not hold a dedicated connection."); },
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.includes("FROM catalog.ncm_official_snapshot")) return { rows: current ? [current] : [] };
      if (sql.includes("FROM catalog.ncm_last_siscomex_snapshot")) return { rows: archived ? [archived] : [] };
      if (sql.includes("count(*)")) return { rows: [{ total_count: totalCount }] };
      if (sql.includes("mandatory_import_attributes")) return { rows };
      throw new Error(`Unexpected lookup query: ${sql}`);
    },
  };
}

const searchQuery = { search: "cabo", codeSearch: "", today: "2026-11-05", limit: 25, offset: 0 };

test("official search filters, counts and pages in PostgreSQL instead of loading the catalog", async () => {
  const pool = lookupPool({ totalCount: 23 });
  const result = await createPersistedOfficialNcmLookup(pool).search(searchQuery);
  assert.equal(result.totalCount, 23);
  assert.deepEqual(result.snapshot, { source: "SISCOMEX", sourceReference: "Portal Único Siscomex / Classif",
    sourceUpdatedAt: "2026-11-05", attributesVersion: "361", syncedAt: "2026-11-05T15:01:15.000Z" });
  assert.deepEqual(result.items, [{ code: "85444900", name: "Outros cabos", validFrom: "2022-04-01",
    validTo: "9999-12-31", creationAct: { numeroAtoIni: "272" }, mandatoryImportAttributes: [{ code: "ATT_1" }] }]);
  const [count, page] = pool.queries.filter(query => query.sql.includes("FROM catalog.ncm_official_item"));
  for (const query of [count, page]) {
    assert.match(query.sql, /strpos\(lower\(name\), \$2\) > 0/u);
    assert.match(query.sql, /valid_from <= \$1::date/u);
    assert.match(query.sql, /valid_to IS NULL OR valid_to >= \$1::date/u);
    assert.deepEqual(query.values.slice(0, 3), ["2026-11-05", "cabo", ""]);
  }
  assert.doesNotMatch(count.sql, /mandatory_import_attributes/u);
  assert.match(page.sql, /ORDER BY \(code = \$3\) DESC, code\s+LIMIT \$4 OFFSET \$5/u);
  assert.deepEqual(page.values.slice(3), [25, 0]);
});

test("official search passes the typed text as a parameter, so % and _ are literal", async () => {
  const pool = lookupPool({ totalCount: 0, rows: [] });
  await createPersistedOfficialNcmLookup(pool).search({ ...searchQuery, search: "50%_'x", codeSearch: "50" });
  for (const query of pool.queries) assert.equal(query.sql.includes("50%_'x"), false);
  const count = pool.queries.find(query => query.sql.includes("count(*)"));
  assert.deepEqual(count.values, ["2026-11-05", "50%_'x", "50"]);
});

test("official search skips the page query when the page is past the last match", async () => {
  const pool = lookupPool({ totalCount: 3 });
  const result = await createPersistedOfficialNcmLookup(pool).search({ ...searchQuery, offset: 25 });
  assert.equal(result.totalCount, 3);
  assert.deepEqual(result.items, []);
  assert.equal(pool.queries.some(query => query.sql.includes("LIMIT")), false);
});

test("an archived Siscomex copy is searched while the current snapshot is MDIC", async () => {
  const pool = lookupPool({ current: { ...siscomexSnapshot, catalog_source: "MDIC_GECEX" },
    archived: { ...siscomexSnapshot, synced_at: new Date("2026-10-30T09:00:00Z") } });
  const result = await createPersistedOfficialNcmLookup(pool).search(searchQuery);
  assert.equal(result.snapshot.source, "SISCOMEX");
  assert.equal(result.snapshot.syncedAt, "2026-10-30T09:00:00.000Z");
  const reads = pool.queries.filter(query => query.sql.includes("_item"));
  assert.ok(reads.length >= 2);
  for (const query of reads) {
    assert.match(query.sql, /FROM catalog\.ncm_last_siscomex_item/u);
    assert.doesNotMatch(query.sql, /ncm_official_item/u);
  }
});

test("without a persisted Siscomex snapshot the lookup reports none and reads no items", async () => {
  for (const pool of [lookupPool({ current: null }),
    lookupPool({ current: { ...siscomexSnapshot, catalog_source: "MDIC_GECEX" }, archived: null })]) {
    const lookup = createPersistedOfficialNcmLookup(pool);
    assert.equal(await lookup.search(searchQuery), null);
    assert.equal(await lookup.find("85444900"), null);
    assert.equal(pool.queries.some(query => query.sql.includes("_item")), false);
  }
});

test("adding an official NCM reads only the selected code", async () => {
  const pool = lookupPool();
  const found = await createPersistedOfficialNcmLookup(pool).find("85444900");
  assert.equal(found.item.code, "85444900");
  assert.equal(found.snapshot.attributesVersion, "361");
  const read = pool.queries.find(query => query.sql.includes("FROM catalog.ncm_official_item"));
  assert.match(read.sql, /WHERE code = \$1/u);
  assert.deepEqual(read.values, ["85444900"]);

  const missing = await createPersistedOfficialNcmLookup(lookupPool({ rows: [] })).find("00000000");
  assert.equal(missing.item, null);
});
