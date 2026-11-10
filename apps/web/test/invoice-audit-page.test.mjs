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
    "invoice-catalog", "invoice-catalog-table", "invoice-manufacturer-candidates"]) {
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

// Comparison of 2026-11-10: the page also checks NCM and description against the product DATABASE, which rules
// without question (user decision): its divergences are only listed; a product out of it waits for the analyst.
test("the DATABASE corrections go to the file without a choice and a product out of it waits for the analyst", async () => {
  const component = await source("../components/InvoiceAuditWorkbench.tsx");
  assert.match(component, /parseProductDatabaseXlsx\(file, getMessages\(\)\)/u);
  assert.match(component, /catalog\.missing\.filter\(entry => !invoiceQuantityDecisionReady\(missingDecisions\[entry\.sourceRow\] \?\? noDecision\)\)/u);
  assert.doesNotMatch(component, /catalogChoices|useDatabaseAll|name=\{`catalog-/u);
  assert.match(component, /\{ \.\.\.invoiceCatalogCorrections\(catalog\.points\) \};/u);
  assert.match(component, /<details><summary>\{t\.catalogDetails\(points\.length\)\}<\/summary>/u);
  assert.match(component, /messages\.invoiceAudit\.noteOriginal, invoice\.draft\.packingList, origin\.corrected\);/u);
  assert.match(component, /\{!database \? <p className="notice warning">\{t\.noDatabase\}<\/p>/u);
});

// User decisions (2026-11-10): the manufacturer list rules the address; the analyst chooses among several addresses,
// decides a country that differs from the list and confirms a manufacturer out of it.
test("the manufacturer list decisions wait for the analyst and the corrections go to the file with the header", async () => {
  const component = await source("../components/InvoiceAuditWorkbench.tsx");
  const section = await source("../components/InvoiceManufacturerAudit.tsx");
  assert.match(component, /parseManufacturerListXlsx\(file, getMessages\(\)\)/u);
  assert.match(component, /\+ invoiceManufacturerPending\(manufacturerChecks, addressChoices, countryChoices, manufacturerMissing\);/u);
  assert.match(component, /messages\.invoiceAudit\.noteOriginal, invoice\.draft\.packingList, origin\.corrected\);/u);
  assert.match(component, /referenceCorrections\[Number\(row\)\] = \{ \.\.\.referenceCorrections\[Number\(row\)\], \.\.\.values \};/u);
  assert.match(section, /name=\{`address-\$\{check\.sourceRow\}`\}/u);
  assert.match(section, /name=\{`country-\$\{check\.sourceRow\}`\}/u);
  assert.match(section, /<label className="invoice-audit-confirm"><input type="checkbox" checked=\{decision\.confirmed\}/u);
  assert.deepEqual(Object.keys(en.manufacturerListSheet).sort(), Object.keys(ptBR.manufacturerListSheet).sort());
  assert.deepEqual(Object.keys(zhCN.manufacturerListSheet).sort(), Object.keys(ptBR.manufacturerListSheet).sort());
});
