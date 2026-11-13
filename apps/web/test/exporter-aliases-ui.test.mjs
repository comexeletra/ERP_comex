import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [aliases, invoice, values, catalogCss] = await Promise.all([
  read("../components/SupplierExporterAliases.tsx"), read("../components/InvoicePlatformAudit.tsx"),
  read("../app/catalog/values/page.tsx"), read("../app/styles/features/catalog.css"),
]);

test("the supplier aliases panel calls the alias routes with idempotency and the read version", () => {
  assert.match(aliases, /\/api\/v1\/suppliers\/\$\{supplierId\}\/exporter-aliases/u);
  assert.match(aliases, /"Idempotency-Key": crypto\.randomUUID\(\)/u);
  assert.match(aliases, /exporter-aliases\/\$\{alias\.id\}\/remove/u);
  assert.match(aliases, /"X-Record-Version": alias\.version/u);
  assert.match(aliases, /useConfirmDialog\(\)/u);
  assert.doesNotMatch(aliases, /window\.confirm/u);
});

test("each supplier of the catalog shows its Exporter aliases, editable by supplier editors only", () => {
  assert.match(values, /<SupplierExporterAliases supplierId=\{supplier\.id\} supplierCode=\{supplier\.code\} canWrite=\{canWrite\} \/>/u);
  assert.match(catalogCss, /\.supplier-alias \{/u);
});

// Phase B2: the audit subsection is the invoice review of the IP screen, and the alias is offered in its supplier notice.
test("the invoice review offers the Exporter name as an alias and reads the POs again after saving it", async () => {
  const screen = await read("../components/NewOperationalRecord.tsx");
  const review = await read("../components/InvoiceAuditReview.tsx");
  assert.match(invoice, /const aliasSuggestion = invoiceExporterAliasSuggestion\(draft\.exporterText\);/u);
  assert.match(invoice, /await createExporterAlias\(supplierId, aliasSuggestion\)/u);
  assert.match(invoice, /await createExporterAlias[\s\S]{0,200}setCandidates\(null\); setReload\(value => value \+ 1\);/u);
  assert.match(invoice, /supplierAlias=\{canEditSuppliers && aliasSuggestion\.replace\(\/\[\^A-Za-z0-9\]\/gu, ""\)\.length >= 8/u);
  assert.match(review, /\{m\.exporterAliases\.invoiceAdd\(supplierAlias\.suggestion, supplier\)\}/u);
  assert.match(screen, /\["Master", "Administrador", "Compras"\]/u);
  assert.match(screen, /canEditSuppliers=\{canEditSuppliers\}/u);
});
