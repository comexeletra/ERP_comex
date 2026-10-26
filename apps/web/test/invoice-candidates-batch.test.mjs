import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL("../components/NewOperationalRecord.tsx", import.meta.url), "utf8");

test("invoice load and revalidation share the batch candidate endpoint", () => {
  assert.match(component, /async function loadInvoiceCandidates\(/u);
  assert.match(component, /\/api\/v1\/purchase-orders\/invoice-candidates\/batch/u);
  assert.equal((component.match(/await loadInvoiceCandidates\(/gu) ?? []).length, 2);
  assert.doesNotMatch(component, /invoice-candidates\?/u);
});
