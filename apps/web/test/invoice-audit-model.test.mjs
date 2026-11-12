import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { emptyInvoiceAuditDecisions, invoiceAuditCorrectionInput, invoiceAuditModel, invoiceAuditPathReset,
  invoiceAuditSupplierMismatches, invoiceLineUnitPoint, invoiceSupplierMismatches } from "../lib/china-invoice-mapping.ts";
import { invoiceAuditBulkGroups } from "../lib/invoice-bulk-decisions.ts";
import { invoiceAuditSheet, invoiceAuditTexts } from "../lib/invoice-audit-sheet.ts";
import { followUpAuditSource, followUpCandidates, parseFollowUpXlsx } from "../lib/audit-reference-xlsx.ts";
import { parseChinaInvoiceXlsx } from "../lib/china-invoice-xlsx.ts";
import { en } from "../lib/i18n/en.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { zhCN } from "../lib/i18n/zh-CN.ts";

// Stage 1 of docs/PLANO_INVOICE_IP_AUDITORIA_DISTRIBUICAO.md (user decisions, 2026-11-12): one audit model for the audit
// page (POs of the Follow Up) and the audit of the IP screen (POs of the platform), with the same rules and decisions.

const line = (sourceRow, values = {}) => ({ sourceRow, lineNumber: String(sourceRow - 15), ncm: "85044090", productCode: "P1",
  description: "PART", manufacturer: "MAKER", manufacturerAddress: "ROAD 1", manufacturerCountry: "CHINA", quantity: "10",
  unit: "PCS", unitPrice: "2", netWeightKg: "1", grossWeightKg: "2", amount: "20", poCell: "PO 030201",
  poAssignments: [{ poNumber: "030201", quantity: "10", explicitQuantity: false }], issues: [], ...values });
const draft = lines => ({ fileName: "INV.xlsx", fileSha256: "a".repeat(64), ipNumber: "IPH900A/2026", exporterText: "HEXING ELECTRICAL CO.,LTD\nROAD",
  importerCnpj: "", countryOfOrigin: "CHINA", packingList: { status: "MISSING" }, lines, warnings: [] });
const item = (id, values = {}) => ({ id, lineNumber: 1, poNumber: "030201", productCode: "P1", remainingQuantity: "10", unit: "UN",
  unitPrice: "2", currency: "CNY", supplier: "EX000135", supplierValues: ["HEXING ELECTRICAL CO.,LTD HANGZHOU", "EX000135"],
  exporterAliases: ["HEXING ELECTRICAL CO.,LTD"], ...values });
const platform = (purchaseOrders, suggestions = () => []) => ({
  purchaseOrder: poNumber => purchaseOrders[poNumber] ?? { poExists: false, items: [] }, suggestions });
const build = (lines, source, decisions = emptyInvoiceAuditDecisions) =>
  invoiceAuditModel({ draft: draft(lines), source, products: null, manufacturers: null, decisions });

test("a platform PO item in another measure gives a unit point; an equivalent unit or the Follow Up gives none", () => {
  assert.equal(invoiceLineUnitPoint("PCS", [{ unit: "UN" }, { unit: null }]), null);
  assert.deepEqual(invoiceLineUnitPoint("PCS", [{ unit: "KG" }, { unit: "UN" }, { unit: "KG" }]), { invoiceUnit: "PCS", poUnits: ["KG"] });
  const model = build([line(16), line(17, { productCode: "P2" })], platform({ "030201": { poExists: true, items: [
    item("a", { unit: "KG" }), item("b", { productCode: "P2", lineNumber: 2 })] } }));
  assert.deepEqual([...model.unitPoints.keys()], [16]);
  assert.equal(model.pending, 1);
  assert.equal(model.canDownload, false);
  const confirmed = build([line(16)], platform({ "030201": { poExists: true, items: [item("a", { unit: "KG" })] } }),
    { ...emptyInvoiceAuditDecisions, unitConfirmed: { 16: true } });
  assert.equal(confirmed.pending, 0);
  assert.equal(confirmed.canDownload, true);
  const followUp = build([line(16)], platform({ "030201": { poExists: true, items: [item("fu:9", { unit: null })] } }));
  assert.equal(followUp.unitPoints.size, 0);
});

test("the supplier is confirmed once per supplier, and an Exporter alias of the platform supplier matches it", () => {
  const items = [item("a", { exporterAliases: [] }), item("b", { exporterAliases: [] }),
    item("c", { supplier: "EX000767", supplierValues: ["OTHER", "EX000767"], exporterAliases: [] })];
  assert.deepEqual(invoiceAuditSupplierMismatches("HEXING ELECTRICAL CO.,LTD SHANGCHENG ZONE", items), ["EX000135", "EX000767"]);
  assert.deepEqual(invoiceAuditSupplierMismatches("HEXING ELECTRICAL CO.,LTD SHANGCHENG ZONE",
    items.map(entry => ({ ...entry, exporterAliases: ["HEXING ELECTRICAL CO.,LTD"] }))), []);
  // The Follow Up has only the supplier code: the result is the one of the audit page before the shared model.
  const followUp = [{ supplier: "hexing" }, { supplier: "HEXING" }, { supplier: "OTHER" }];
  assert.deepEqual(invoiceAuditSupplierMismatches("HEXING ELECTRICAL", followUp),
    invoiceSupplierMismatches("HEXING ELECTRICAL", followUp.map(entry => entry.supplier)));
});

test("a closed platform PO blocks its part, and the model asks the source for another PO", () => {
  const asked = [];
  const model = build([line(16)], platform({ "030201": { poExists: true, poStatus: "CLOSED", items: [item("a")] } },
    (...args) => { asked.push(args); return [{ poNumber: "030305", available: "10", ipNumber: "", sourceRows: [3] }]; }));
  assert.deepEqual(model.rows[0].issue, { kind: "PO_NOT_ACTIVE", status: "CLOSED" });
  assert.deepEqual(model.rows[0].allocations, []);
  assert.equal(model.rows[0].points.length, 0);
  assert.deepEqual(asked, [["P1", "030201", "10", []]]);
  assert.equal(model.rows[0].suggestions[0].poNumber, "030305");
  assert.equal(ptBR.invoiceAudit.platform.poNotActive.length > 0, true);
  // The batch route lists no item of a PO that is not active: still only PO_NOT_ACTIVE, without "code out of the PO".
  const empty = build([line(16)], platform({ "030201": { poExists: true, poStatus: "CANCELLED", items: [] } }));
  assert.deepEqual(empty.rows[0].issue, { kind: "PO_NOT_ACTIVE", status: "CANCELLED" });
  assert.deepEqual(empty.rows[0].points, []);
  // Nor does its balance enter the split of an unreadable PO cell.
  const unread = line(17, { quantity: "80", poCell: "PO 030888&030201", poAssignments: [] });
  const split = build([unread], platform({ "030888": { poExists: true, poStatus: "CLOSED", items: [item("x", { poNumber: "030888" })] },
    "030201": { poExists: true, items: [item("y", { remainingQuantity: "60" })] } }));
  assert.deepEqual(split.unreadLines[0].split, ["0", "80"]);
});

test("an unreadable PO cell is split by the balance of the source and the chosen PO goes to the parts", () => {
  const unread = line(16, { quantity: "80", poCell: "PO 030888&030201", poAssignments: [] });
  const source = platform({ "030888": { poExists: true, items: [item("x", { poNumber: "030888", remainingQuantity: "20" })] },
    "030201": { poExists: true, items: [item("y", { remainingQuantity: "60" })] } });
  const pending = build([unread], source);
  assert.deepEqual(pending.unreadLines.map(entry => entry.split), [["20", "60"]]);
  assert.equal(pending.rows.length, 0);
  assert.deepEqual(pending.bulk.splittableRows, [16]);
  const split = build([unread], source, { ...emptyInvoiceAuditDecisions, splitAccepted: { 16: true } });
  assert.deepEqual(split.rows.map(row => [row.part.poNumber, row.part.quantity, row.allocations.length]), [["030888", "20", 1], ["030201", "60", 1]]);
  assert.equal(split.pending, 0);
  assert.deepEqual(invoiceAuditCorrectionInput(split, { ...emptyInvoiceAuditDecisions, splitAccepted: { 16: true } }).parts,
    [{ sourceRow: 16, poNumber: "030888", quantity: "20" }, { sourceRow: 16, poNumber: "030201", quantity: "60" }]);
});

test("the bulk unit action confirms only the units without a decision and the other actions keep the decisions", () => {
  const model = build([line(16), line(17)], platform({ "030201": { poExists: true, items: [item("a", { unit: "KG", remainingQuantity: "20" })] } }));
  assert.deepEqual(model.bulk.unitRows, [16, 17]);
  const decisions = { ...emptyInvoiceAuditDecisions, unitConfirmed: { 16: true }, flaggedNcms: { 3: true } };
  const groups = invoiceAuditBulkGroups(model.bulk, model.supplierMismatches, decisions);
  const unit = groups.find(group => group.id === "unit");
  assert.equal(unit.pending, 1);
  const outcome = unit.actions[0].run("");
  assert.deepEqual(outcome.next.unitConfirmed, { 16: true, 17: true });
  assert.deepEqual([outcome.applied, outcome.left], [1, 0]);
  assert.deepEqual(outcome.next.flaggedNcms, { 3: true });
  for (const dictionary of [ptBR, en, zhCN]) {
    assert.equal(typeof dictionary.invoiceAudit.bulk.groups.unit, "string");
    assert.equal(typeof dictionary.invoiceAudit.bulk.actions.confirmUnit, "string");
    assert.equal(typeof dictionary.invoiceAudit.bulk.left.unit(1), "string");
  }
});

test("new POs clear only the decisions on the path of the lines", () => {
  const decisions = { ...emptyInvoiceAuditDecisions, quantities: { "16:0": "1" }, poChoices: { "16:0": "030305" }, unitConfirmed: { 16: true },
    flaggedNcms: { 16: true }, addressChoices: { 16: "EX1" } };
  const next = invoiceAuditPathReset(decisions);
  assert.deepEqual([next.quantities, next.poChoices, next.unitConfirmed], [{}, {}, {}]);
  assert.deepEqual([next.flaggedNcms, next.addressChoices], [{ 16: true }, { 16: "EX1" }]);
});

test("the AUDITORIA sheet names its source: the Follow Up file or the platform POs", () => {
  const model = build([line(16)], platform({ "030201": { poExists: true, items: [item("a", { lineNumber: 7 })] } }));
  const format = { number: value => value, percent: value => `${value}%`, dateTime: value => value };
  const input = source => ({ draft: draft([line(16)]), model, decisions: emptyInvoiceAuditDecisions, corrections: [], changedCells: {},
    ncmFlagCells: () => [], database: null, manufacturerList: null, source, importer: "ELETRA MATRIZ", user: "Analista" });
  const followUp = invoiceAuditSheet(ptBR, input({ kind: "followUp", fileName: "FUP.xlsx", fileSha256: "b".repeat(64), sameIps: ["900A/2026"] }), format);
  assert.deepEqual(followUp.summary[1], ["Follow Up", `FUP.xlsx (SHA-256 ${"b".repeat(64)})`]);
  assert.ok(followUp.summary.some(([label, value]) => label === ptBR.invoiceAudit.sheet.sameIps && value === "900A/2026"));
  assert.ok(followUp.rows.some(row => row[4] === "linha 7 do Follow Up: 10"));
  const fromPlatform = invoiceAuditSheet(ptBR, input({ kind: "platform" }), format);
  assert.deepEqual(fromPlatform.summary[1], ["Fonte das POs", "POs da plataforma (HML)"]);
  assert.ok(!fromPlatform.summary.some(([label]) => label === ptBR.invoiceAudit.sheet.sameIps));
  assert.ok(fromPlatform.rows.some(row => row[4] === "PO 030201, item 7: 10"));
  assert.equal(fromPlatform.sheetName, "AUDITORIA");
  // The texts that cite the Follow Up are replaced on the IP screen; the others are the same.
  const t = invoiceAuditTexts(ptBR, "platform");
  assert.equal(t.followUpValue, "PO");
  assert.equal(t.bulk.actions.acceptSplit, ptBR.invoiceAudit.platform.bulkAcceptSplit);
  assert.equal(t.download, ptBR.invoiceAudit.download);
  assert.equal(invoiceAuditTexts(ptBR, "followUp"), ptBR.invoiceAudit);
});

const folder = "../../../invoices_tests/";
const real = { invoice: new URL(`${folder}IPH034B 2026       INV+PL.xlsx`, import.meta.url),
  followUp: new URL(`${folder}Follow Up Import 2026 (4).xlsx`, import.meta.url), reference: new URL(`${folder}reference-hml.json`, import.meta.url) };
const haveReal = Object.values(real).every(file => existsSync(file));

// Acceptance 9: the audit page rebuilds the audit on every key typed in a reason (2026-11-11: 274 ms per key).
test("the real IPH034B against the Follow Up: suggestion of line 92, and 20 builds with the reference in less than 2 s",
  { skip: !haveReal }, async () => {
    const invoice = await parseChinaInvoiceXlsx(new File([await readFile(real.invoice)], "IPH034B.xlsx"), ptBR);
    const { lines } = await parseFollowUpXlsx(new File([await readFile(real.followUp)], "Follow Up.xlsx"), ptBR);
    const reference = JSON.parse(await readFile(real.reference, "utf8"));
    const source = followUpAuditSource(lines, "ELETRA MATRIZ", invoice.ipNumber);
    assert.deepEqual(source.purchaseOrder("030631"), followUpCandidates(lines, "ELETRA MATRIZ", "030631", invoice.ipNumber));
    const input = decisions => ({ draft: invoice, source, products: reference.productDatabase.products,
      manufacturers: reference.manufacturerList.manufacturers, decisions });
    const model = invoiceAuditModel(input(emptyInvoiceAuditDecisions));
    const row92 = model.rows.find(row => row.part.key === "92:0");
    assert.equal(row92.issue.kind, "INSUFFICIENT_BALANCE");
    assert.equal(row92.suggestions[0].poNumber, "030631");
    const chosen = invoiceAuditModel(input({ ...emptyInvoiceAuditDecisions, poChoices: { "92:0": "030631" } }));
    assert.equal(chosen.rows.find(row => row.part.key === "92:0").issue, null);
    assert.ok(model.catalog.points.length > 0);
    const started = performance.now();
    for (let index = 0; index < 20; index += 1) {
      invoiceAuditModel(input({ ...emptyInvoiceAuditDecisions, quantityDecisions: { 16: { confirmed: true, reason: "x".repeat(index) } } }));
    }
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 2000, `20 builds took ${Math.round(elapsed)} ms`);
  });
