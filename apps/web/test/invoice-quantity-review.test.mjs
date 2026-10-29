import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";

const component = await readFile(new URL("../components/NewOperationalRecord.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/styles/features/operations.css", import.meta.url), "utf8");

test("each line goes only to the PO items with its code, filled in PO line order", () => {
  assert.match(component, /const candidates = invoiceKeyItems\(lookup\?\.items \?\? \[\], assignment\.productCode\);/u);
  assert.match(component, /distributeInvoiceParts\(invoiceMatches\.map\(match =>/u);
  // The manual choice of an item with another code and its confirmation are gone.
  assert.doesNotMatch(component, /confirmCodeMismatch|invoiceItemAria|selectPoItem|itemId: ""/u);
  assert.match(component, /<ul className="invoice-key-items">/u);
});

test("the analyst types the quantity for the PO and can take the PO balance when it is short", () => {
  assert.match(component, /aria-label=\{t\.destinedQuantityAria\(match\.sourceRow\)\}/u);
  assert.match(component, /t\.invoicePartQuantity\(/u);
  assert.match(component, /destinationIssue\.kind === "INSUFFICIENT_BALANCE" && <button className="button secondary" type="button"\s+onClick=\{\(\) => setQuantity\(destinationIssue\.available\)\}>\{t\.useBalance\(/u);
  assert.equal(ptBR.newRecord.useBalance("8,00"), "Usar o saldo da PO (8,00)");
});

test("a different quantity needs the line confirmation and reason; a missing code stays in the audit", () => {
  assert.match(component, /invoiceQuantityPoint\(match\.invoiceQuantity, match\.quantity/u);
  assert.match(component, /invoiceCodePoint\(match\.productCode, !poActive \|\| match\.candidates\.length > 0, match\.quantity, decision\)/u);
  assert.match(component, /\{point\.kind === "QUANTITY" && <>/u);
  assert.match(component, /<label className="invoice-audit-reason">\{t\.quantityReason\}<input required minLength=\{3\}/u);
  // The audit shows even when no PO item has the line code.
  assert.match(component, /\{auditPoints\.length > 0 && <section className="invoice-audit"/u);
  assert.match(component, /point\.kind === "CODE" \? t\.codeNotInPo/u);
  assert.equal(ptBR.newRecord.auditKind.CODE, "Código do produto");
  assert.equal(ptBR.newRecord.auditKind.QUANTITY, "Quantidade");
  assert.match(styles, /\.invoice-match-table \.invoice-audit-reason\s*\{[^}]*font-weight:\s*400/u);
});

test("the save sends the line decisions and only the assignment fields the API accepts", () => {
  assert.match(component, /lineDecisions: invoiceLineDecisions\(invoiceDraft\.lines, invoiceMatches, quantityDecisions\)/u);
  assert.match(component, /const \{ assignments, allocations \} = invoiceSavePayload\(/u);
  assert.doesNotMatch(component, /poSupplierText|poSupplierName|poSupplierCode/u);
  // Saving needs every point confirmed and at least one line reaching a PO.
  assert.match(component, /const invoiceLinesReady = invoiceAllocations\.length > 0/u);
  assert.match(component, /\|\| !invoiceLinesReady/u);
});

test("the summary by PO and code sits above the lines and flags a negative balance", () => {
  assert.match(component, /<table className="totvs-import-table invoice-po-summary">/u);
  assert.match(component, /className=\{row\.overBalance \? "invoice-po-summary-over" : undefined\}/u);
  assert.ok(component.indexOf("invoice-po-summary") < component.indexOf("invoice-match-table-wrap\">"));
  assert.match(styles, /\.invoice-po-summary-over td\s*\{[^}]*var\(--color-danger-bg\)/u);
});

test("a PO found under another importer names it and switching the importer revalidates the lines", () => {
  assert.match(component, /t\.poInOtherImporter\(match\.otherImporters\.map\(code => importerNames\[code\] \|\| code\)/u);
  assert.match(component, /onClick=\{\(\) => changeImporter\(code\)\}>\{t\.useImporter\(/u);
  assert.match(component, /if \(invoiceDraft && value\) void revalidateInvoiceMatches\(value\);/u);
  assert.match(component, /onChange=\{changeImporter\}/u);
  assert.equal(ptBR.newRecord.poInOtherImporter("GALPAO"), "PO cadastrada em outra importadora: GALPAO.");
});

test("the new invoice review texts exist in the three languages", () => {
  for (const messages of [ptBR, en, zhCN]) {
    const t = messages.newRecord;
    for (const text of [t.nothingDestined, t.invalidQuantity, t.confirmQuantity, t.quantityReason, t.codeNotInPo, t.poSummary,
      t.auditNote.QUANTITY, t.auditNote.CODE, ...Object.values(t.poSummaryColumn)]) {
      assert.equal(typeof text, "string");
      assert.ok(text.trim().length > 0);
    }
  }
});
