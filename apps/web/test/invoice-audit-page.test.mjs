import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";

// User decision (2026-11-10): an invoice audit page against the Follow Up, read in the browser, that saves nothing
// and returns the corrected invoice file.

const source = path => readFile(new URL(path, import.meta.url), "utf8");

test("the page is a route in the menu and calls no API route other than the session", async () => {
  const page = await source("../app/invoices/audit/page.tsx");
  const component = await source("../components/InvoiceAuditWorkbench.tsx");
  const sidebar = await source("../components/AppSidebar.tsx");
  assert.match(page, /<InvoiceAuditWorkbench \/>/u);
  assert.match(sidebar, /\{ label: "invoiceAudit", href: "\/invoices\/audit", icon: "audit" \}/u);
  assert.deepEqual(component.match(/apiFetch\([^)]*\)/gu), ['apiFetch("/auth/me")']);
  assert.doesNotMatch(component, /method:/u);
  assert.match(component, /parseFollowUpXlsx\(file, getMessages\(\)\)/u);
  assert.match(component, /parseChinaInvoiceXlsx\(file, getMessages\(\)\)/u);
});

test("the download waits for every decision and writes the corrections with the AUDITORIA sheet", async () => {
  const component = await source("../components/InvoiceAuditWorkbench.tsx");
  assert.match(component, /const canDownload = ready && pending === 0 && rows\.some\(row => row\.allocations\.length > 0\);/u);
  assert.match(component, /disabled=\{!canDownload \|\| Boolean\(reading\)\}/u);
  assert.match(component, /invoicePriceChoiceReady\(point, priceChoices\[row\]\)/u);
  assert.match(component, /invoicePackingChoiceReady\(divergence, packingChoices\[divergence\.key\]\)/u);
  assert.match(component, /supplierMismatches\.filter\(supplier => !supplierConfirmed\[supplier\]\)/u);
  assert.match(component, /writeCorrectedInvoice\(invoice\.bytes, invoice\.draft\.layout, corrections, invoiceCorrectedTotals\(corrections\)/u);
  assert.match(component, /const auditSheetName = "AUDITORIA";/u);
});

test("the conference panel takes the page's own INV × PKL decision and keeps the IP screen's confirmation", async () => {
  const panel = await source("../components/InvoiceConference.tsx");
  assert.match(panel, /decisionReady \? decisionReady\(divergence\) : invoiceQuantityDecisionReady\(decision\)/u);
  assert.match(panel, /\{renderDecision \? renderDecision\(divergence\) : <>/u);
  const component = await source("../components/InvoiceAuditWorkbench.tsx");
  assert.match(component, /renderDecision=\{divergence => \{/u);
});

test("every class of the page has a style rule", async () => {
  const styles = await source("../app/styles/features/operations.css");
  for (const name of ["invoice-audit-page", "invoice-audit-files", "invoice-audit-importer", "invoice-audit-choice",
    "invoice-catalog", "invoice-catalog-table", "invoice-catalog-pending"]) {
    assert.match(styles, new RegExp(String.raw`\.${name}[\s,{.]`, "u"), name);
  }
});

test("the page texts exist in the three languages", () => {
  const keys = value => Object.keys(value).sort();
  for (const section of ["invoiceAudit", "followUpSheet"]) {
    assert.deepEqual(keys(en[section]), keys(ptBR[section]), section);
    assert.deepEqual(keys(zhCN[section]), keys(ptBR[section]), section);
  }
  assert.deepEqual(keys(en.invoiceAudit.sheet), keys(ptBR.invoiceAudit.sheet));
  assert.deepEqual(keys(zhCN.invoiceAudit.sheet), keys(ptBR.invoiceAudit.sheet));
  assert.equal(ptBR.invoiceAudit.sheet.columns.length, en.invoiceAudit.sheet.columns.length);
  assert.equal(ptBR.sidebar.items.invoiceAudit, "Auditoria de invoice");
  assert.equal(ptBR.invoiceAudit.correctPrice("35,85"), "Corrigir para o preço da PO (35,85 CNY)");
});

// Comparison of 2026-11-10: the page also checks NCM and description against the product DATABASE.
test("the DATABASE divergences and the products out of it wait for the analyst and go to the file", async () => {
  const component = await source("../components/InvoiceAuditWorkbench.tsx");
  assert.match(component, /parseProductDatabaseXlsx\(file, getMessages\(\)\)/u);
  assert.match(component, /catalog\.points\.filter\(point => !catalogChoices\[point\.key\]\)\.length/u);
  assert.match(component, /catalog\.missing\.filter\(entry => !invoiceQuantityDecisionReady\(missingDecisions\[entry\.sourceRow\] \?\? noDecision\)\)/u);
  assert.match(component, /onAll=\{\(\) => setCatalogChoices\(Object\.fromEntries\(catalog\.points\.map\(point => \[point\.key, "DATABASE" as const\]\)\)\)\}/u);
  assert.match(component, /invoiceCatalogCorrections\(catalog\.points, catalogChoices\)\);/u);
  assert.match(component, /messages\.invoiceAudit\.noteOriginal, invoice\.draft\.packingList\);/u);
  assert.match(component, /\{!database \? <p className="notice warning">\{t\.noDatabase\}<\/p>/u);
});
