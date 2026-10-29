import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [aliases, invoice, values, catalogCss] = await Promise.all([
  read("../components/SupplierExporterAliases.tsx"), read("../components/NewOperationalRecord.tsx"),
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

test("the invoice review offers the Exporter name as an alias and revalidates the lines after saving it", () => {
  assert.match(invoice, /invoiceExporterAliasSuggestion\(invoiceDraft\?\.exporterText \?\? ""\)/u);
  assert.match(invoice, /await createExporterAlias\(supplierId, exporterAliasSuggestion\)/u);
  assert.match(invoice, /await createExporterAlias[\s\S]{0,400}await revalidateInvoiceMatches\(\)/u);
  assert.match(invoice, /\["Master", "Administrador", "Compras"\]/u);
});
