import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ptBR } from "../lib/i18n/pt-BR.ts";

const component = await readFile(new URL("../components/NewOperationalRecord.tsx", import.meta.url), "utf8");
// Phase B2 (2026-11-12): the invoice lines are reviewed in the audit subsection, with the shared review of the audit page.
const review = await readFile(new URL("../components/InvoiceAuditReview.tsx", import.meta.url), "utf8");
const subsection = await readFile(new URL("../components/InvoicePlatformAudit.tsx", import.meta.url), "utf8");
const mapping = await readFile(new URL("../lib/china-invoice-mapping.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/styles/features/operations.css", import.meta.url), "utf8");
const processWorkspace = await readFile(new URL("../components/ProcessWorkspace.tsx", import.meta.url), "utf8");
const newProcessPage = await readFile(new URL("../app/processes/new/page.tsx", import.meta.url), "utf8");

test("invoice review uses a fluid, readable table layout", () => {
  assert.match(review, /className="totvs-import-table-wrap invoice-match-table-wrap"><table className="totvs-import-table invoice-match-table"/u);
  assert.match(styles, /\.ip-entry-section\s*\{[^}]*max-width:\s*none;[^}]*width:\s*100%/u);
  assert.match(styles, /\.invoice-match-table\s*\{[^}]*min-width:\s*0;[^}]*table-layout:\s*fixed;[^}]*width:\s*100%/u);
  assert.match(styles, /\.invoice-match-table-wrap\s*\{\s*max-height:\s*min\(62vh, 720px\);/u);
  assert.match(styles, /\.invoice-match-table td\s*\{[^}]*white-space:\s*normal/u);
});

test("IP review entry fixes the IP and shows allocation changes and orphan PO choices", () => {
  assert.match(processWorkspace, /href=\{`\/processes\/new\?reviewInvoice=\$\{encodeURIComponent\(id\)\}`\}/u);
  assert.match(newProcessPage, /reviewInvoiceId=/u);
  // The review only takes the invoice of that IP; phase B1 (2026-11-12) also accepts its IPH number for an IP of the Follow Up.
  assert.match(component, /if \(reviewTarget && invoiceSaveIpNumber\(draft\.ipNumber, \[reviewTarget\]\)\.toLocaleUpperCase\("en-US"\)\s+!== reviewTarget\.ipNumber\.trim\(\)\.toLocaleUpperCase\("en-US"\)\) \{\s+throw new Error\(t\.ipRefMustBe\(reviewTarget\.ipNumber\)\);/u);
  assert.match(component, /<h3>\{t\.beforeAfter\}<\/h3>/u);
  assert.equal(ptBR.newRecord.beforeAfter, "Resumo antes × depois");
  assert.match(component, /orphanPoDecisions: orphanPos\.map/u);
  assert.match(component, /\{t\.keepLink\}<\/label>/u);
  assert.equal(ptBR.newRecord.keepLink, "Manter vínculo sem alocação");
  assert.match(component, /\{t\.removeLink\}<\/label>/u);
  assert.equal(ptBR.newRecord.removeLink, "Remover vínculo");
});

// The action of each row is now in the audit: the PO balance, destine 0, the suggested PO or the importer of the PO; the
// links to open or create a PO in another tab left with the review below the subsection.
test("invoice review shows per-row PO action and duplicate confirmation", () => {
  assert.match(mapping, /classifyInvoiceDestination\(part\.keyItems, part\.poExists, part\.quantity, partDistribution, part\.poStatus\)/u);
  assert.match(review, /t\.insufficient\(formatNumber\(issue\.requested\), formatNumber\(issue\.available\)\)/u);
  assert.match(ptBR.invoiceAudit.platform.insufficient("10", "5"), /^Saldo insuficiente na PO: pedido 10, disponível 5\.$/u);
  assert.match(review, /onClick=\{\(\) => change\("poChoices", current => \(\{ \.\.\.current, \[part\.key\]: suggestion\.poNumber \}\)\)\}/u);
  assert.match(subsection, /onClick=\{readAgain\}>\{t\.readAgain\}<\/button>/u);
  assert.equal(ptBR.invoiceAudit.platform.readAgain, "Reler POs e saldos (refaz as decisões de destino, preço e pesos)");
  assert.match(component, /\{t\.confirmDuplicateInvoice\}<\/label>/u);
  assert.equal(ptBR.newRecord.confirmDuplicateInvoice, "Confirmo a duplicidade desta invoice.");
});

// The checklist of each row has the pending and settled states; the count of what is pending is the one of the whole audit.
test("invoice audit points form a checklist with pending and confirmed states", () => {
  assert.match(review, /className=\{`notice \$\{point\.confirmed \? "success" : "error"\}`\}/u);
  assert.match(review, /<dl className="invoice-audit-values">/u);
  assert.match(review, /<label className="invoice-audit-confirm"><input type="checkbox"/u);
  assert.match(review, /\{pending \? t\.pending\(pending\) : t\.ready\}/u);
  assert.equal(ptBR.newRecord.auditKind.SUPPLIER, "Fornecedor");
});

test("invoice audit confirmations and registry updates keep the checkbox beside its text", () => {
  // .stack-form label is a bold grid and .operational-fields inputs are full width; both must be undone here.
  assert.match(styles, /\.invoice-match-table \.invoice-audit-confirm(?:, [^{]+)?\s*\{[^}]*display:\s*flex;[^}]*font-weight:\s*400/u);
  assert.match(styles, /\.invoice-audit-confirm input\s*\{[^}]*flex:\s*0 0 auto;/u);
  assert.match(styles, /\.invoice-match-table td:nth-child\(4\) > \.operational-fields input\[type="checkbox"\]\s*\{[^}]*width:\s*auto/u);
});

// The invoice × PO × product comparison gave way to the audited values: the DATABASE and the manufacturer list correct the
// file, and each correction is listed with the invoice value and the reference value.
test("invoice comparison is a table with the invoice and the reference values", () => {
  assert.match(review, /<table className="totvs-import-table invoice-catalog-table">/u);
  assert.match(review, /<td>\{point\.invoiceValue \|\| "—"\}<\/td><td>\{point\.databaseValue\}<\/td>/u);
  assert.match(styles, /\.invoice-catalog-table[\s,{.]/u);
});

// The form stretches every label as a grid, so a bare checkbox in a notice became a field as wide as the notice.
test("confirmations inside the invoice notices keep the checkbox beside its text", () => {
  for (const text of ["confirmDuplicateInvoice", "confirmImporter"]) {
    assert.match(component, new RegExp(String.raw`<label className="invoice-audit-confirm"><input type="checkbox"[\s\S]{0,200}?/>\{t\.${text}\}</label>`, "u"), text);
  }
  assert.match(styles, /\.invoice-match-table \.invoice-audit-confirm, \.notice > \.invoice-audit-confirm \{[^}]*display: flex;/u);
});

test("the price point shows the difference in percent against the tolerance", () => {
  assert.match(review, /\{pricePoint\.difference && <><dt>\{m\.newRecord\.auditDifference\}<\/dt><dd>\{m\.newRecord\.priceDifference\(/u);
  assert.match(review, /formatPercentChange\(pricePoint\.difference\.percent\)/u);
  assert.equal(ptBR.newRecord.priceDifference("−16,09%", true, 20), "−16,09% · dentro da tolerância de 20%");
  assert.equal(ptBR.newRecord.priceDifference("+25,00%", false, 20), "+25,00% · acima da tolerância de 20%");
  assert.equal(ptBR.newRecord.priceDifference(null, false, 20), "PO sem preço · acima da tolerância de 20%");
});

test("the revision summary is one table with before and after side by side", () => {
  const summary = component.slice(component.indexOf("aria-label={t.beforeAfterAria}"), component.indexOf("{orphanPos.map("));
  assert.match(summary, /<table className="totvs-import-table invoice-before-after">/u);
  for (const column of ["po", "code", "rows", "before", "after", "difference"]) {
    assert.match(summary, new RegExp(String.raw`\{t\.beforeAfterColumn\.${column}\}`, "u"), column);
  }
  assert.match(summary, /className=\{row\.changed \? "invoice-before-after-changed" : undefined\}/u);
  assert.doesNotMatch(component, /t\.beforeLine|t\.afterLine/u);
  assert.match(styles, /\.invoice-before-after-changed td \{[^}]*background: var\(--color-warning-bg\);[^}]*\}/u);
  assert.equal(ptBR.newRecord.beforeAfterColumn.difference, "Diferença");
});
