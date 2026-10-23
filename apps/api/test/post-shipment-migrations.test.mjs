import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationsUrl = new URL("../migrations/", import.meta.url);

test("M068 moves BL number and date to the IP and seeds them from the single active BL", async () => {
  const migration = await readFile(new URL("M068_ip_bill_of_lading_fields.sql", migrationsUrl), "utf8");

  assert.match(migration, /ADD COLUMN bl_number varchar\(120\)/u);
  assert.match(migration, /ADD COLUMN bl_date date/u);
  assert.match(migration, /bl_number IS NULL OR length\(btrim\(bl_number\)\) > 0/u);
  // An IP is one shipment: two different active BLs must be resolved before the copy.
  assert.match(migration, /count\(DISTINCT upper\(btrim\(number\)\)\) > 1/u);
  assert.match(migration, /count\(DISTINCT issue_date\) > 1/u);
  assert.match(migration, /RAISE EXCEPTION 'Resolve IPs with more than one active BL before M068'/u);
  // Only empty IP fields are filled; legacy BL documents stay untouched as history.
  assert.match(migration, /bl_number = coalesce\(process\.bl_number, bl\.number\)/u);
  assert.match(migration, /bl_date = coalesce\(process\.bl_date, bl\.issue_date\)/u);
  assert.match(migration, /WHERE kind = 'BL' AND status = 'ACTIVE'/u);
  assert.doesNotMatch(migration, /UPDATE imports\.process_document/u);
  assert.doesNotMatch(migration, /DELETE FROM/u);
  // The copy is audited like the M027 historical backfill.
  assert.match(migration, /'HISTORICAL_BACKFILL'/u);
  assert.match(migration, /'migration:M068'/u);
  assert.match(migration, /GRANT SELECT \(bl_number, bl_date\),\s+INSERT \(bl_number, bl_date\),\s+UPDATE \(bl_number, bl_date\)/u);
  assert.match(migration, /import_erp_app/u);
  assert.match(migration, /import_erp_hml_app/u);
});
