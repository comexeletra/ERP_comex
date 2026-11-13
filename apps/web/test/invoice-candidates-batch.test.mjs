import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [component, subsection] = await Promise.all([read("../components/NewOperationalRecord.tsx"),
  read("../components/InvoicePlatformAudit.tsx")]);

// Phase B2: the audit subsection reads the candidates of the invoice once per load and per "read again"; the IP screen no
// longer has a second reading of the same POs.
test("invoice load and read again share the batch candidate endpoint of the audit subsection", () => {
  assert.equal((subsection.match(/\/api\/v1\/purchase-orders\/invoice-candidates\/batch/gu) ?? []).length, 1);
  assert.match(subsection, /\}, \[importer, ipNumber, requests, reload\]\);/u);
  assert.match(subsection, /setDecisions\(invoiceAuditPathReset\); setReload\(value => value \+ 1\);/u);
  assert.doesNotMatch(component, /invoice-candidates|loadInvoiceCandidates/u);
  assert.doesNotMatch(subsection, /invoice-candidates\?/u);
});
