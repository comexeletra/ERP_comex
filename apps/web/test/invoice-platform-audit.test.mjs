import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { emptyInvoiceAuditDecisions, invoiceAuditModel, invoiceIpSearchText, invoicePlatformAuditSource, invoicePlatformPoKey,
  invoicePlatformRequests, invoiceSystemIp } from "../lib/china-invoice-mapping.ts";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";

// Stages 2 and 3 of docs/PLANO_INVOICE_IP_AUDITORIA_DISTRIBUICAO.md (user decisions, 2026-11-12): the IP screen audits the
// invoice against the platform POs, with the rules of the audit page, and saves nothing; Compras audits without saving.

const source = path => readFile(new URL(path, import.meta.url), "utf8");
const line = (sourceRow, values = {}) => ({ sourceRow, lineNumber: String(sourceRow - 15), ncm: "", productCode: "P1", description: "",
  manufacturer: "", manufacturerAddress: "", manufacturerCountry: "", quantity: "100", unit: "PCS", unitPrice: "1", netWeightKg: "1",
  grossWeightKg: "1", amount: "100", poCell: "PO 030201", poAssignments: [{ poNumber: "030201", quantity: "100", explicitQuantity: false }],
  issues: [], ...values });
const item = (id, values = {}) => ({ id, lineNumber: 1, poNumber: "030201", productCode: "P1", remainingQuantity: "100", unit: "UN",
  unitPrice: "1", currency: "CNY", poStatus: "ACTIVE", supplierText: "HEXING", supplierName: "HEXING ELECTRICAL", supplierCode: "EX000135",
  supplierExporterAliases: [], linkedToRevisingIp: false, ...values });

test("the routes are asked once for the cited POs (also those of an unreadable cell) and once per product", () => {
  const requests = invoicePlatformRequests([line(16), line(17, { poCell: "PO 30201", poAssignments: [{ poNumber: "30201", quantity: "100" }] }),
    line(18, { productCode: "p1 ", quantity: "5" }), line(19, { productCode: "P2", poCell: "PO 030888&030201", poAssignments: [] }),
    line(20, { productCode: "P3", quantity: "abc" })]);
  assert.deepEqual(requests.poNumbers, ["030201", "30201", "030888"]);
  assert.deepEqual(requests.products, [{ productCode: "P1", quantity: "100" }, { productCode: "P2", quantity: "100" }]);
  assert.equal(invoicePlatformPoKey("PO 030201"), "030201");
  // A code or PO the routes refuse (more than 80 characters) does not refuse the whole call.
  const long = invoicePlatformRequests([line(16, { productCode: "X".repeat(81) }), line(17)]);
  assert.deepEqual(long.products, [{ productCode: "P1", quantity: "100" }]);
});

// User decision (2026-11-12): the load of the Follow Up keeps the HEXING IPs without the IPH prefix (034B/2026), and the
// audit reads the balance of that IP, as the audit page does with the Follow Up.
test("the IP of the invoice is the one the system keeps, with or without the IPH prefix", () => {
  assert.equal(invoiceIpSearchText(" IPH034B/2026 "), "034B/2026");
  assert.equal(invoiceIpSearchText("Z-021B/2026"), "Z-021B/2026");
  const stored = [{ ipNumber: "034B/2026", recordStatus: "ACTIVE" }, { ipNumber: "1034B/2026", recordStatus: "ACTIVE" }];
  assert.equal(invoiceSystemIp("IPH034B/2026", stored), "034B/2026");
  assert.equal(invoiceSystemIp("iph 034b/2026", stored), "034B/2026");
  assert.equal(invoiceSystemIp("IPH034B/2026", [...stored, { ipNumber: "IPH034B/2026", recordStatus: "ACTIVE" }]), "IPH034B/2026");
  assert.equal(invoiceSystemIp("IPH034B/2026", [{ ipNumber: "034B/2026", recordStatus: "CANCELLED" },
    { ipNumber: "IPH034B/2026", recordStatus: "CANCELLED" }]), "IPH034B/2026");
  assert.equal(invoiceSystemIp("IPH034B/2026", [{ ipNumber: "IPH034B/2026", recordStatus: "DELETED" }, stored[0]]), "034B/2026");
  assert.equal(invoiceSystemIp("IPH099A/2026", stored), "IPH099A/2026");
  assert.equal(invoiceSystemIp("Z-021B/2026", [{ ipNumber: "021B/2026" }]), "Z-021B/2026");
});

test("the platform source gives the cited PO from the batch and another PO from the items of the product", () => {
  const platform = invoicePlatformAuditSource(
    [{ sourcePoNumber: "PO030201", poExists: true, poStatus: "ACTIVE", items: [item("a", { remainingQuantity: "40" })] },
      { sourcePoNumber: "029999", poExists: true, poStatus: "CLOSED", items: [] },
      { sourcePoNumber: "028888", poExists: false, poStatus: null, items: [] }],
    [{ productCode: "P1", items: [item("a", { remainingQuantity: "40" }), item("b", { poNumber: "030700", lineNumber: 4 }),
      item("c", { poNumber: "030500", lineNumber: 2, remainingQuantity: "150" }),
      item("d", { poNumber: "030600", lineNumber: 9, remainingQuantity: "120", linkedToRevisingIp: true })] }],
    "IPH900A/2026");
  assert.deepEqual(platform.purchaseOrder("030201").items.map(entry => [entry.id, entry.supplier, entry.supplierValues]),
    [["a", "EX000135", ["HEXING", "HEXING ELECTRICAL", "EX000135"]]]);
  assert.deepEqual(platform.purchaseOrder("029999"), { poExists: true, poStatus: "CLOSED", items: [] });
  assert.equal(platform.purchaseOrder("028888").poExists, false);
  assert.deepEqual(platform.purchaseOrder("PO 030700").items.map(entry => entry.id), ["b"]);
  assert.deepEqual(platform.purchaseOrder("031111"), { poExists: false, items: [] });
  // The PO on the IP under review first, then the exact balance, then the order of the route; the cited PO never.
  assert.deepEqual(platform.suggestions("p1", "030201", "100", []).map(entry => [entry.poNumber, entry.available, entry.ipNumber]),
    [["030600", "120", "IPH900A/2026"], ["030700", "100", ""], ["030500", "150", ""]]);
  // Among the POs that are not exact, the PO number decides, not the order of the route.
  const tie = invoicePlatformAuditSource([], [{ productCode: "P1", items: [item("e", { poNumber: "030900", remainingQuantity: "300" }),
    item("f", { poNumber: "030100", remainingQuantity: "200" })] }], "");
  assert.deepEqual(tie.suggestions("P1", "030201", "100", []).map(entry => entry.poNumber), ["030100", "030900"]);
  // What the other parts of the invoice took is discounted, and a PO that no longer covers the part leaves.
  assert.deepEqual(platform.suggestions("P1", "030201", "100", [{ itemId: "d", quantity: "30" }, { itemId: "c", quantity: "50" }])
    .map(entry => [entry.poNumber, entry.available, entry.sourceRows]), [["030500", "100", [2]], ["030700", "100", [4]]]);
  assert.deepEqual(platform.suggestions("P1", "030201", "0", []), []);
});

test("the audit with the platform source: the suggestion of another PO receives the part with its items", () => {
  const platform = invoicePlatformAuditSource(
    [{ sourcePoNumber: "030201", poExists: true, poStatus: "ACTIVE", items: [item("a", { remainingQuantity: "40" })] }],
    [{ productCode: "P1", items: [item("a", { remainingQuantity: "40" }), item("b", { poNumber: "030700", lineNumber: 4 })] }], "");
  const draft = { lines: [line(16)], ipNumber: "IPH900A/2026", exporterText: "HEXING", packingList: { status: "MISSING" }, countryOfOrigin: "" };
  const before = invoiceAuditModel({ draft, source: platform, products: null, manufacturers: null, decisions: emptyInvoiceAuditDecisions });
  assert.equal(before.rows[0].issue.kind, "INSUFFICIENT_BALANCE");
  assert.equal(before.rows[0].suggestions[0].poNumber, "030700");
  const after = invoiceAuditModel({ draft, source: platform, products: null, manufacturers: null,
    decisions: { ...emptyInvoiceAuditDecisions, poChoices: { "16:0": "030700" } } });
  assert.equal(after.rows[0].issue, null);
  assert.deepEqual(after.rows[0].allocations.map(entry => [entry.item.id, entry.quantity]), [["b", "100"]]);
  assert.deepEqual([...after.unitPoints.keys()], []);
});

// User request (2026-11-12): a PO registered under another importer says where it is and offers to switch the importer,
// as the review that saves the IP does, instead of only "not registered".
test("a PO of another importer carries the importers where it is registered, and the screen offers the switch", async () => {
  const platform = invoicePlatformAuditSource(
    [{ sourcePoNumber: "030201", poExists: false, poStatus: null, otherImporters: ["ELETRA FILIAL"], items: [] },
      { sourcePoNumber: "030202", poExists: true, poStatus: "ACTIVE", otherImporters: [], items: [item("a", { poNumber: "030202" })] }],
    [{ productCode: "P1", items: [item("a", { poNumber: "030202" })] }], "");
  assert.deepEqual(platform.purchaseOrder("030201"), { poExists: false, poStatus: undefined, items: [], otherImporters: ["ELETRA FILIAL"] });
  const draft = { lines: [line(16), line(17, { poCell: "PO 030202", poAssignments: [{ poNumber: "030202", quantity: "100", explicitQuantity: false }] })],
    ipNumber: "IPH900A/2026", exporterText: "HEXING", packingList: { status: "MISSING" }, countryOfOrigin: "" };
  const model = invoiceAuditModel({ draft, source: platform, products: null, manufacturers: null, decisions: emptyInvoiceAuditDecisions });
  assert.equal(model.rows[0].issue.kind, "PO_NOT_REGISTERED");
  assert.deepEqual(model.rows[0].part.otherImporters, ["ELETRA FILIAL"]);
  assert.deepEqual(model.rows[1].part.otherImporters, []);
  // A suggested PO of this importer replaces the one of the other importer, and the line no longer cites it.
  const moved = invoiceAuditModel({ draft, source: platform, products: null, manufacturers: null,
    decisions: { ...emptyInvoiceAuditDecisions, poChoices: { "16:0": "030202" } } });
  assert.deepEqual(moved.rows[0].part.otherImporters, []);
  assert.equal(ptBR.invoiceAudit.platform.poInOtherImporter("ELETRA FILIAL"),
    "PO não cadastrada nesta importadora: ela está cadastrada em ELETRA FILIAL. Confira a importadora da invoice.");

  const review = await source("../components/InvoiceAuditReview.tsx");
  const subsection = await source("../components/InvoicePlatformAudit.tsx");
  const screen = await source("../components/NewOperationalRecord.tsx");
  assert.match(review, /issue\.kind === "PO_NOT_REGISTERED" && part\.otherImporters\.length\s+\? t\.platform\.poInOtherImporter\(/u);
  assert.match(review, /part\.otherImporters\.filter\(code => importerSwitch\.codes\.includes\(code\)\)/u);
  assert.match(review, /onClick=\{\(\) => importerSwitch\.change\(code\)\}>\{t\.platform\.useImporter\(/u);
  assert.match(subsection, /importerSwitch=\{importerSwitch\}/u);
  // The switch is the one of the Importer field: the subsection mounts again (key) and reads the POs of that importer.
  assert.match(screen, /importerSwitch=\{reviewInvoiceId \? undefined : \{ names: importerNames, codes: importers, change: changeImporter \}\}/u);
});

test("the IP screen shows the audit subsection, and Compras audits without the review that saves the IP", async () => {
  const screen = await source("../components/NewOperationalRecord.tsx");
  const subsection = await source("../components/InvoicePlatformAudit.tsx");
  const directory = await source("../components/ProcessDirectory.tsx");
  assert.match(screen, /const ipAuditRoles = new Set\(\[\.\.\.ipRoles, "Compras"\]\);/u);
  assert.match(screen, /const allowed = roles\.some\(role => \(kind === "po" \? poRoles : ipAuditRoles\)\.has\(role\)\);/u);
  assert.match(screen, /const canSaveIp = roles\.some\(role => ipRoles\.has\(role\)\);/u);
  assert.match(screen, /if \(!canSaveIp\) \{ setInvoiceError\(!invoiceImporter \? importerWarning : ""\); return; \}/u);
  assert.match(screen, /<InvoicePlatformAudit key=\{`\$\{invoiceDraft\.fileSha256\}\|\$\{importer\}`\} draft=\{invoiceDraft\}/u);
  assert.match(screen, /\{canSaveIp && <button className="button" disabled=\{saving/u);
  // Until stage 6 the IP is still saved by the review that exists today (user decision, 2026-11-12).
  assert.match(screen, /invoiceSavePayload\(/u);
  assert.doesNotMatch(subsection, /method: "PUT"|import-invoice/u);
  assert.match(subsection, /"\/api\/v1\/purchase-orders\/invoice-candidates\/batch", \{ importer, revisingIpNumber: systemIp \|\| undefined, poNumbers \}/u);
  assert.match(subsection, /"\/api\/v1\/purchase-orders\/invoice-candidates\/by-product", \{ importer, revisingIpNumber: systemIp \|\| undefined, products \}/u);
  assert.match(subsection, /const systemIp = invoiceSystemIp\(ipNumber, stored\);/u);
  assert.match(subsection, /ipNumber: invoiceIpSearchText\(ipNumber\), importer,/u);
  assert.match(subsection, /summary=\{\{ kind: "platform", systemIp: candidates!\.systemIp \}\}/u);
  // The subsection is inside the form that saves the IP: its reasons do not block saving, and Enter in it does not save.
  assert.match(subsection, /if \(event\.key === "Enter" && event\.target instanceof HTMLInputElement\) event\.preventDefault\(\);/u);
  assert.match(screen, /if \(element\.closest\("\.invoice-platform-audit"\) \|\| element\.checkValidity\(\)\) continue;/u);
  assert.match(screen, /if \(kind === "ip" && \(!canSaveIp \|\| !reportIpFormValidity\(event\.currentTarget\)\)\) return;/u);
  assert.match(screen, /\|\| \(importerCnpjMismatch && !confirmImporterCnpjMismatch\)\)\)\} formNoValidate>/u);
  // Compras sees the CNPJ that differs from the chosen importer, without the confirmation of who saves.
  assert.match(screen, /\{!canSaveIp && importerCnpjMismatch && <p className="notice warning" role="alert">/u);
  assert.match(subsection, /\}, \[importer, ipNumber, requests\]\);/u);
  assert.match(directory, /: roles\.includes\("Compras"\) && <Link className="button" href="\/processes\/new">\{t\.auditInvoice\}<\/Link>/u);
  const styles = await source("../app/styles/features/operations.css");
  assert.match(styles, /\.invoice-platform-audit \{/u);
});

test("the subsection texts exist in the three languages", () => {
  for (const dictionary of [en, zhCN]) {
    assert.deepEqual(Object.keys(dictionary.invoiceAudit.platform).sort(), Object.keys(ptBR.invoiceAudit.platform).sort());
    assert.deepEqual(Object.keys(dictionary.invoiceAudit.platform.sheet).sort(), Object.keys(ptBR.invoiceAudit.platform.sheet).sort());
    assert.equal(typeof dictionary.newRecord.auditOnly, "string");
    assert.equal(typeof dictionary.processDirectory.auditInvoice, "string");
  }
  assert.equal(ptBR.invoiceAudit.platform.sheet.poSourceValue, "POs da plataforma (HML)");
});
