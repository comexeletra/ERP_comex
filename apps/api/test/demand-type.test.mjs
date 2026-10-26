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

test("the API accepts the demand type as a PO item field and as an operational entity", async () => {
  const [followup, catalog, exports] = await Promise.all([source("followup.ts"), source("catalog.ts"), source("purchase-order-exports.ts")]);
  assert.match(followup, /demandType: \["demand_type", "text", 40\]/u);
  assert.match(catalog, /"DEMAND_TYPE"/u);
  assert.match(catalog, /DEMAND_TYPE: 40/u);
  assert.match(exports, /\["Demand Type", line => text\(line\.item\.demandType\)\]/u);
});
