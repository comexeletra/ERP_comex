import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("M065 creates empty product price and TOTVS description histories with item triggers", async () => {
  const migration = await readFile(new URL("../migrations/M065_product_price_observations.sql", import.meta.url), "utf8");

  assert.match(migration, /CREATE TABLE catalog\.product_price_observation/u);
  assert.match(migration, /unit_price numeric\(24,8\) NOT NULL CHECK \(unit_price > 0\)/u);
  assert.match(migration, /currency_code char\(3\) NOT NULL/u);
  assert.match(migration, /purchase_order_item_id uuid NOT NULL REFERENCES procurement\.purchase_order_item/u);
  assert.match(migration, /CREATE INDEX ix_product_price_observation_latest\s+ON catalog\.product_price_observation\s*\(product_id, currency_code, observed_at DESC, id DESC\)/u);
  assert.match(migration, /CREATE TABLE catalog\.product_totvs_description_observation/u);
  assert.match(migration, /CREATE VIEW catalog\.product_price_reference/u);
  assert.match(migration, /CREATE VIEW catalog\.product_totvs_description_reference/u);
  assert.match(migration, /CREATE TRIGGER purchase_order_item_product_observations\s+AFTER INSERT OR UPDATE OF product_code, description, unit_price, currency_code/u);
  assert.match(migration, /NEW\.unit_price > 0/u);
  assert.match(migration, /catalog\.entry[\s\S]*kind = 'PRODUCT'[\s\S]*importer IS NULL/u);
  assert.match(migration, /nullif\(btrim\(NEW\.description\), ''\) IS NOT NULL/u);
  assert.match(migration, /current_setting\('app\.actor_id', true\)/u);
  assert.match(migration, /GRANT SELECT, INSERT ON catalog\.product_price_observation,\s+catalog\.product_totvs_description_observation/u);
  assert.doesNotMatch(migration, /INSERT INTO catalog\.product_price_observation\s+SELECT/u);
  assert.doesNotMatch(migration, /INSERT INTO catalog\.product_totvs_description_observation\s+SELECT/u);
});
