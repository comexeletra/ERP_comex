import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("M066 grants scoped DELETE and narrowly allows clearing a DELETED PO SC link", async () => {
  const migration = await readFile(new URL("../migrations/M066_purchase_request_delete.sql", import.meta.url), "utf8");

  for (const role of ["import_erp_app", "import_erp_hml_app"]) {
    assert.match(migration, new RegExp(`rolname = '${role}'[\\s\\S]*?GRANT DELETE ON procurement\\.purchase_request TO ${role}`, "u"));
  }
  assert.match(migration, /OLD\.lifecycle_status = 'DELETED'[\s\S]*?NEW\.lifecycle_status = 'DELETED'/u);
  assert.match(migration, /OLD\.purchase_request_id IS NOT NULL AND NEW\.purchase_request_id IS NULL/u);
  assert.match(migration, /to_jsonb\(NEW\) - mutable_fields - 'purchase_request_id'[\s\S]*?IS NOT DISTINCT FROM/u);
  assert.match(migration, /IF OLD\.lifecycle_status <> 'ACTIVE'[\s\S]*?Only active POs allow business field changes/u);
  assert.doesNotMatch(migration, /\b(?:CREATE TABLE|ALTER TABLE|DROP|INSERT INTO|DELETE FROM)\b/iu);
  assert.doesNotMatch(migration, /GRANT (?!DELETE ON procurement\.purchase_request TO )/u);
});
