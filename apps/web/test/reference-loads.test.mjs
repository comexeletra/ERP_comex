import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseManufacturerListXlsx, parseProductDatabaseXlsx } from "../lib/audit-reference-xlsx.ts";
import { invoiceCatalogCorrections, invoiceCatalogPoints, invoiceManufacturerChecks, invoiceManufacturerCorrections }
  from "../lib/china-invoice-mapping.ts";
import { parseChinaInvoiceXlsx } from "../lib/china-invoice-xlsx.ts";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";
import { manufacturerListPayload, productDatabasePayload, registrableNcms } from "../lib/reference-loads.ts";

// Stage 1f of docs/PLANO_AUDITORIA_INVOICE_AVULSA.md (user decisions, 2026-11-11): Master and Administrador load the
// DATABASE and the manufacturer list; one load enriches the catalog and keeps the rows, apart from the catalog, as
// the reference of the invoice audit, which must keep its parity with the analysts' audit.

const source = path => readFile(new URL(path, import.meta.url), "utf8");

test("the load screen is a catalog route for Master and Administrador only", async () => {
  const page = await source("../app/catalog/reference-loads/page.tsx");
  const panel = await source("../components/ReferenceLoadsPanel.tsx");
  const catalog = await source("../app/catalog/page.tsx");
  assert.match(page, /<ReferenceLoadsPanel \/>/u);
  assert.match(panel, /const managerRoles = new Set\(\["Master", "Administrador"\]\);/u);
  assert.match(catalog, /const canLoadReferences = roles\.some\(role => \["Master", "Administrador"\]\.includes\(role\)\);/u);
  assert.match(catalog, /\{canLoadReferences && <Link className="button secondary" href="\/catalog\/reference-loads">/u);
});

test("the screen reads the spreadsheet in the browser, previews, and saves only on confirmation", async () => {
  const panel = await source("../components/ReferenceLoadsPanel.tsx");
  assert.match(panel, /productDatabasePayload\(await parseProductDatabaseXlsx\(file, getMessages\(\)\)\)/u);
  assert.match(panel, /manufacturerListPayload\(await parseManufacturerListXlsx\(file, getMessages\(\)\)\)/u);
  const preview = panel.indexOf('apiFetch("/api/v1/reference-loads/preview"');
  const save = panel.indexOf('apiFetch("/api/v1/reference-loads", { method: "POST"');
  assert.ok(preview > 0 && save > preview);
  assert.ok(panel.slice(save - 400, save).includes("async function confirm()"));
  assert.match(panel, /disabled=\{busy \|\| refused\.length > 0\} onClick=\{onConfirm\}/u);
  // The NCMs are registered through the official catalog route, only those valid in the persisted catalog.
  assert.match(panel, /const codes = registrableNcms\(pendingNcms\);/u);
  assert.match(panel, /apiFetch\("\/api\/v1\/ncms\/import-official"/u);
  assert.deepEqual(registrableNcms([{ code: "39206100", status: "OFFICIAL_VALID", officialName: "x", products: 1 },
    { code: "11111111", status: "NOT_IN_OFFICIAL", officialName: null, products: 1 },
    { code: "22222222", status: "OFFICIAL_NOT_VALID", officialName: "y", products: 2 }]), ["39206100"]);
});

test("the screen texts exist in the three languages and its classes have style rules", async () => {
  const keys = value => Object.keys(value).sort();
  for (const section of [ptBR.referenceLoads, ptBR.referenceLoads.kinds, ptBR.referenceLoads.column,
    ptBR.referenceLoads.refusedReason, ptBR.referenceLoads.ncmStatus]) assert.ok(keys(section).length);
  for (const other of [en, zhCN]) {
    assert.deepEqual(keys(other.referenceLoads), keys(ptBR.referenceLoads));
    assert.deepEqual(keys(other.referenceLoads.column), keys(ptBR.referenceLoads.column));
    assert.deepEqual(keys(other.referenceLoads.refusedReason), keys(ptBR.referenceLoads.refusedReason));
    assert.deepEqual(keys(other.referenceLoads.ncmStatus), keys(ptBR.referenceLoads.ncmStatus));
    assert.equal(typeof other.catalog.referenceLoads, "string");
  }
  const styles = await source("../app/styles/features/catalog.css");
  for (const name of ["reference-load", "reference-load-preview"]) {
    assert.match(styles, new RegExp(String.raw`\.${name}[\s,{]`, "u"), name);
  }
});

const folder = "../../../invoices_tests/";
const local = name => new URL(folder + name, import.meta.url);
const realFiles = { database: local("DATABASE - Renew.xlsx"),
  list: local("TOTVS-HEXING -LIST MANUFACTURER - Ultima Versão!!!.xlsx"),
  invoices: [local("IPH037A 2026       INV+PL.xlsx"), local("IPH034B 2026       INV+PL.xlsx")] };
const haveRealFiles = [realFiles.database, realFiles.list, ...realFiles.invoices].every(file => existsSync(file));
const readReal = async (url, name) => new File([await readFile(url)], name);

/** Everything the audit decides from the references, for one invoice. */
function auditOutcome(draft, products, manufacturers) {
  const catalog = invoiceCatalogPoints(draft.lines, products);
  const checks = invoiceManufacturerChecks(draft.lines, manufacturers);
  return { catalog, catalogCorrections: invoiceCatalogCorrections(catalog.points), checks,
    manufacturerCorrections: invoiceManufacturerCorrections(draft.lines, checks, {}, {}) };
}

// The load sends the rows the reader returns; the API keeps them as they are and returns them in row order.
test("the rows a load keeps give the audit the same results as the spreadsheets (IPH037A and IPH034B)",
  { skip: !haveRealFiles }, async () => {
    const database = await parseProductDatabaseXlsx(await readReal(realFiles.database, "DATABASE - Renew.xlsx"), ptBR);
    const list = await parseManufacturerListXlsx(await readReal(realFiles.list, "LIST.xlsx"), ptBR);
    const kept = payload => JSON.parse(JSON.stringify(payload.rows));
    const products = kept(productDatabasePayload(database));
    const manufacturers = kept(manufacturerListPayload(list));
    assert.deepEqual(products, database.products);
    assert.deepEqual(manufacturers, list.manufacturers);
    assert.equal(products.length, 486);
    assert.equal(manufacturers.length, 575);
    for (const invoice of realFiles.invoices) {
      const draft = await parseChinaInvoiceXlsx(await readReal(invoice, "INV.xlsx"), ptBR);
      assert.deepEqual(auditOutcome(draft, products, manufacturers), auditOutcome(draft, database.products, list.manufacturers));
    }
  });

// After the real load, the reference is read back from HML (GET /api/v1/reference-loads/audit-reference, run with
// the release code against HML) into invoices_tests/reference-hml.json, outside Git. It must equal the spreadsheets.
const hmlReference = local("reference-hml.json");
test("the reference read back from HML equals the spreadsheets row by row and keeps the audit results",
  { skip: !haveRealFiles || !existsSync(hmlReference) }, async () => {
    const reference = JSON.parse(await readFile(hmlReference, "utf8"));
    const database = await parseProductDatabaseXlsx(await readReal(realFiles.database, "DATABASE - Renew.xlsx"), ptBR);
    const list = await parseManufacturerListXlsx(await readReal(realFiles.list, "LIST.xlsx"), ptBR);
    assert.equal(reference.productDatabase.fileSha256, database.fileSha256);
    assert.equal(reference.manufacturerList.fileSha256, list.fileSha256);
    assert.equal(reference.productDatabase.duplicated, database.duplicated);
    assert.deepEqual(reference.productDatabase.products, database.products);
    assert.deepEqual(reference.manufacturerList.manufacturers, list.manufacturers);
    for (const invoice of realFiles.invoices) {
      const draft = await parseChinaInvoiceXlsx(await readReal(invoice, "INV.xlsx"), ptBR);
      assert.deepEqual(auditOutcome(draft, reference.productDatabase.products, reference.manufacturerList.manufacturers),
        auditOutcome(draft, database.products, list.manufacturers));
    }
  });
