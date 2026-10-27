import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationsUrl = new URL("../migrations/", import.meta.url);
const source = name => readFile(new URL(`../src/${name}`, import.meta.url), "utf8");

test("M069 adds the demand type list (MTS / Não MTS) and its own PO item field", async () => {
  const migration = await readFile(new URL("M069_purchase_order_item_demand_type.sql", migrationsUrl), "utf8");
  const previous = await readFile(new URL("M043_product_ncm_entities.sql", migrationsUrl), "utf8");

  // Every entity already allowed stays allowed; DEMAND_TYPE is added beside DEMAND.
  const allowed = sql => [...sql.matchAll(/'([A-Z_]+)'/gu)].map(match => match[1]);
  const before = allowed(previous.slice(previous.indexOf("ADD CONSTRAINT")));
  const after = allowed(migration.slice(migration.indexOf("ADD CONSTRAINT"), migration.indexOf("));")));
  assert.deepEqual(after.filter(key => !before.includes(key)), ["DEMAND_TYPE"]);
  assert.deepEqual(before.filter(key => !after.includes(key)), []);
  assert.match(migration, /md5\('DEMAND_TYPE\|' \|\| upper\(btrim\(seed\.value\)\)\)::uuid/u);
  assert.match(migration, /\('MTS'\), \('Não MTS'\)/u);
  assert.match(migration, /ON CONFLICT \(entity_key, normalized_value\) DO NOTHING/u);
  // The demand origin (DEMAND / item.demand) is untouched: the type is a separate column.
  assert.match(migration, /ADD COLUMN demand_type varchar\(40\)/u);
  assert.match(migration, /demand_type IS NULL OR length\(btrim\(demand_type\)\) > 0/u);
  assert.doesNotMatch(migration, /UPDATE procurement\.purchase_order_item/u);
  assert.doesNotMatch(migration, /DELETE FROM/u);
});

test("M071 moves the demand type to the PO, keeping only the values its products agree on", async () => {
  const migration = await readFile(new URL("M071_purchase_order_demand_type.sql", migrationsUrl), "utf8");
  const sql = migration.replace(/--.*$/gmu, "");

  assert.match(sql, /ALTER TABLE procurement\.purchase_order\s+ADD COLUMN demand_type varchar\(40\)/u);
  assert.match(sql, /CHECK \(demand_type IS NULL OR length\(btrim\(demand_type\)\) > 0\)/u);
  // Only POs whose typed products all agree get a type; mixed POs stay empty. Inactive POs are frozen (M063).
  assert.match(sql, /HAVING count\(DISTINCT item\.demand_type\) = 1/u);
  assert.match(sql, /po\.lifecycle_status = 'ACTIVE'/u);
  // The copy runs before the product column goes away.
  const copy = sql.indexOf("UPDATE procurement.purchase_order AS po");
  const drop = sql.indexOf("ALTER TABLE procurement.purchase_order_item DROP COLUMN demand_type");
  assert.ok(copy > 0 && drop > copy);
  // Nothing else is touched: the DEMAND_TYPE list and the demand origin stay as they are.
  assert.doesNotMatch(sql, /operational_value|DELETE FROM|INSERT INTO|\bdemand\b(?!_type)/u);
  assert.equal([...sql.matchAll(/\b(?:ALTER TABLE|UPDATE)\s+([a-z_.]+)/gu)].map(match => match[1]).sort().join(","),
    "procurement.purchase_order,procurement.purchase_order,procurement.purchase_order_item");
});

test("the demand type is a PO header field and no longer a product field", async () => {
  const [operations, followup, catalog, exports] = await Promise.all([
    source("operations.ts"), source("followup.ts"), source("catalog.ts"), source("purchase-order-exports.ts")]);
  assert.match(operations, /demandType: nullableText\(40\)\.optional\(\)/u);
  assert.doesNotMatch(followup, /demandType: \["demand_type"/u);
  assert.match(catalog, /"DEMAND_TYPE"/u);
  assert.match(catalog, /DEMAND_TYPE: 40/u);
  assert.match(exports, /\["Demand Type", line => text\(line\.item\.demandType\)\]/u);
});

test("every product reader takes the demand type from its PO", async () => {
  for (const name of ["operations.ts", "followup.ts", "shipment-lines.ts"]) {
    const code = await source(name);
    assert.doesNotMatch(code, /item\.demand_type/u, name);
    assert.match(code, /po\.demand_type/u, name);
  }
});
