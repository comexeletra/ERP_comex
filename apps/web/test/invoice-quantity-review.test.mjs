import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";

/*
 * Phase B2 (docs/PLANO_INVOICE_IP_AUDITORIA_DISTRIBUICAO.md, 2026-11-12): the review of the invoice lines on the IP screen is
 * the audit subsection (InvoicePlatformAudit with the shared InvoiceAuditReview and invoiceAuditModel). These are the rules
 * the review below the subsection had, checked where they are now.
 */
const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [component, review, mapping, styles] = await Promise.all([read("../components/NewOperationalRecord.tsx"),
  read("../components/InvoiceAuditReview.tsx"), read("../lib/china-invoice-mapping.ts"), read("../app/styles/features/operations.css")]);
const model = mapping.slice(mapping.indexOf("export function invoiceAuditModel"), mapping.indexOf("export function invoiceAuditCorrectionInput"));
const save = mapping.slice(mapping.indexOf("export function invoiceAuditSavePayload"));

test("each line goes only to the PO items with its code, filled in PO line order", () => {
  assert.match(model, /keyItems: invoiceKeyItems\(items, part\.productCode\)/u);
  assert.match(model, /const distribution = distributeInvoiceParts\(parts\.map\(part =>/u);
  // The manual choice of an item with another code and its confirmation are gone.
  for (const source of [component, review]) assert.doesNotMatch(source, /confirmCodeMismatch|invoiceItemAria|selectPoItem|itemId: ""/u);
  assert.match(review, /<ul className="invoice-key-items">/u);
});

test("the analyst types the quantity for the PO and can take the PO balance when it is short", () => {
  assert.match(review, /aria-label=\{t\.quantityAria\(part\.sourceRow\)\}/u);
  assert.match(review, /t\.invoiceQuantity\(/u);
  assert.match(review, /issue\.kind === "INSUFFICIENT_BALANCE" && <button className="button secondary" type="button"\s+onClick=\{\(\) => setQuantity\(part\.key, issue\.available\)\}>\s*\{t\.useBalance\(/u);
  assert.equal(ptBR.invoiceAudit.useBalance("8,00"), "Usar o saldo (8,00)");
});

test("a different quantity needs the line confirmation and reason; a missing code stays in the audit", () => {
  assert.match(model, /invoiceQuantityPoint\(part\.invoiceQuantity, part\.quantity, line\.unit, decision\)/u);
  assert.match(model, /invoiceCodePoint\(part\.productCode, !part\.poExists \|\| part\.poStatus !== "ACTIVE" \|\| part\.keyItems\.length > 0, part\.quantity,/u);
  assert.match(review, /<label className="invoice-audit-reason">\{m\.newRecord\.quantityReason\}<input required minLength=\{3\}/u);
  // The audit shows even when no PO item has the line code, and a code out of the PO is settled only by destining 0.
  assert.match(review, /point\.kind === "CODE" \? m\.newRecord\.codeNotInPo/u);
  assert.match(review, /onClick=\{\(\) => setQuantity\(part\.key, "0"\)\}>\{t\.destineZero\}/u);
  assert.equal(ptBR.newRecord.auditKind.CODE, "Código do produto");
  assert.equal(ptBR.newRecord.auditKind.QUANTITY, "Quantidade");
  assert.match(styles, /\.invoice-match-table \.invoice-audit-reason(?:, [^{]+)?\s*\{[^}]*font-weight:\s*400/u);
});

test("the save sends the line decisions and only the assignment fields the API accepts", () => {
  assert.match(save, /const lineDecisions = invoiceLineDecisions\(savedLines,/u);
  assert.match(save, /const \{ assignments, allocations \} = invoiceSavePayload\(input\.invoiceLabel,/u);
  for (const source of [component, save]) assert.doesNotMatch(source, /poSupplierText|poSupplierName|poSupplierCode/u);
  // Saving needs the audited invoice of the current decisions, which the audit downloads only with every point settled.
  assert.match(model, /const canDownload = ready && pending === 0 && rows\.some\(row => row\.allocations\.length > 0\);/u);
  assert.match(component, /if \(!auditedInvoice\) throw new Error\(t\.auditBeforeConfirm\);/u);
  assert.match(component, /\|\| Boolean\(invoiceDraft && \(invoiceError \|\| !invoiceIpReady\)\)\} formNoValidate>/u);
});

test("the summary by PO and code comes from the audited invoice and flags a negative balance", () => {
  assert.match(component, /const invoicePoSummary = invoicePoCodeSummary\(auditedInvoice\?\.model\.rows\.map\(row =>/u);
  assert.match(component, /<table className="totvs-import-table invoice-po-summary">/u);
  assert.match(component, /className=\{row\.overBalance \? "invoice-po-summary-over" : undefined\}/u);
  assert.match(styles, /\.invoice-po-summary-over td\s*\{[^}]*var\(--color-danger-bg\)/u);
});

test("a PO found under another importer names it and switching the importer audits the invoice again", () => {
  assert.match(review, /t\.platform\.poInOtherImporter\(part\.otherImporters\.map\(code => importerSwitch\?\.names\[code\] \|\| code\)/u);
  assert.match(review, /onClick=\{\(\) => importerSwitch\.change\(code\)\}>\{t\.platform\.useImporter\(/u);
  assert.match(component, /importerSwitch=\{reviewInvoiceId \? undefined : \{ names: importerNames, codes: importers, change: changeImporter \}\}/u);
  assert.match(component, /if \(invoiceDraft && value\) void reloadInvoiceProcess\(value\);/u);
  assert.match(component, /onChange=\{changeImporter\}/u);
  assert.match(ptBR.invoiceAudit.platform.poInOtherImporter("GALPAO"), /GALPAO/u);
});

test("the invoice review texts exist in the three languages", () => {
  for (const messages of [ptBR, en, zhCN]) {
    const t = messages.newRecord;
    for (const text of [t.confirmQuantity, t.quantityReason, t.codeNotInPo, t.poSummary, t.auditBeforeConfirm, t.ipChecksPending,
      t.confirmDistribution, t.productFillTitle, t.productFillHelp, t.productFillCount(3, 90), t.selectAllFills, t.clearAllFills,
      ...Object.values(t.productFillColumn),
      messages.invoiceAudit.invalidQuantity, messages.invoiceAudit.platform.readAgain, messages.invoiceAudit.platform.helpSave,
      messages.invoiceAudit.platform.downloadedConfirm, ...Object.values(t.poSummaryColumn)]) {
      assert.equal(typeof text, "string");
      assert.ok(text.trim().length > 0);
    }
  }
});
