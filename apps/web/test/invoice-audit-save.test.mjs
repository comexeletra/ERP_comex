import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { emptyInvoiceAuditDecisions, invoiceAuditModel, invoiceAuditProductFills,
  invoiceAuditSavePayload } from "../lib/china-invoice-mapping.ts";
import { followUpAuditSource, parseFollowUpXlsx } from "../lib/audit-reference-xlsx.ts";
import { parseChinaInvoiceXlsx } from "../lib/china-invoice-xlsx.ts";
import { invoiceCorrectedTotals, invoiceLineCorrections } from "../lib/invoice-correction-xlsx.ts";
import { ptBR } from "../lib/i18n/pt-BR.ts";
import { settleInvoiceAudit, writeAuditedInvoice } from "./support/invoice-audit-settle.mjs";

// Phase B2 of docs/PLANO_INVOICE_IP_AUDITORIA_DISTRIBUICAO.md (user decisions, 2026-11-12): the IP is saved with the audited
// invoice the analyst downloaded, the original lines and every decision of the audit.

const line = (sourceRow, values = {}) => ({ sourceRow, lineNumber: String(sourceRow - 15), ncm: "85044090", productCode: "P1",
  description: "PART", manufacturer: "MAKER", manufacturerAddress: "ROAD 1", manufacturerCountry: "CHINA", quantity: "10",
  unit: "PCS", unitPrice: "2.1", netWeightKg: "1", grossWeightKg: "2", amount: "21", poCell: "PO 030201",
  poAssignments: [{ poNumber: "030201", quantity: "10", explicitQuantity: false }], issues: [], ...values });
const draft = lines => ({ fileName: "INV.xlsx", fileSha256: "a".repeat(64), ipNumber: "IPH900A/2026", exporterText: "HEXING ELECTRICAL CO.,LTD\nROAD",
  importerCnpj: "", countryOfOrigin: "CHINA", packingList: { status: "MISSING" }, lines, warnings: [] });
const item = (id, values = {}) => ({ id, lineNumber: 1, poNumber: "030201", productCode: "P1", remainingQuantity: "10", unit: "PCS",
  unitPrice: "2", currency: "CNY", supplier: "EX000135", supplierValues: ["EX000135"], exporterAliases: ["HEXING ELECTRICAL CO.,LTD"],
  productId: "product-1", productNcmCode: null, manufacturer: null, manufacturerAddress: "", manufacturerCountry: null, ...values });
const source = purchaseOrders => ({ purchaseOrder: poNumber => purchaseOrders[poNumber] ?? { poExists: false, items: [] },
  suggestions: () => [] });
const products = [{ productCode: "P1", ncm: "85044090", description: "PART" }];

function audited(lines, decisions, purchaseOrders, references = { productDatabaseLoadId: "load-db", manufacturerListLoadId: null }) {
  const model = invoiceAuditModel({ draft: draft(lines), source: source(purchaseOrders), products, manufacturers: null, decisions });
  const parts = model.rows.map(row => ({ sourceRow: row.part.sourceRow, poNumber: row.part.poNumber, quantity: row.part.quantity }));
  const prices = Object.fromEntries([...model.pricePoints].filter(([row]) => decisions.priceChoices[row] === "CORRECT")
    .map(([row, point]) => [row, point.poPrices[0]]));
  const corrections = invoiceLineCorrections(lines, parts, prices, {});
  return { model, decisions, corrections, totals: invoiceCorrectedTotals(corrections), sha256: "b".repeat(64),
    fileName: "INV - auditada.xlsx", references };
}

test("the payload saves the lines of the audited file, the original lines and the decisions with their reasons", () => {
  const lines = [line(16), line(17, { productCode: "P2", quantity: "5", amount: "10.5" }),
    line(18, { quantity: "80", amount: "168", poCell: "PO 030888&030201", poAssignments: [] })];
  const decisions = { ...emptyInvoiceAuditDecisions, priceChoices: { 16: "CORRECT" }, quantities: { "17:0": "0" },
    quantityDecisions: { 17: { confirmed: true, reason: "Código fora da PO" } },
    poCellKept: { 18: { confirmed: true, reason: "Aguardando a HEXING" } },
    missingDecisions: { 17: { confirmed: true, reason: "Produto novo" } } };
  const file = audited(lines, decisions, { "030201": { poExists: true, items: [item("i1")] } });
  assert.equal(file.model.pending, 0);
  const saved = invoiceAuditSavePayload({ lines, countryOfOrigin: "CHINA", invoiceLabel: "INV-1", audited: file, fills: [] });
  // Line 16 takes the PO price; lines 17 and 18 go to no PO and keep their values.
  assert.deepEqual(saved.lines.map(entry => [entry.sourceRow, entry.unitPrice, entry.amount, entry.quantity]),
    [[16, "2", "20", "10"], [17, "2.1", "10.5", "5"], [18, "2.1", "168", "80"]]);
  assert.equal(saved.amount, "198.5");
  assert.deepEqual(saved.assignments.map(entry => [entry.sourceRow, entry.itemId, entry.quantity, entry.confirmPriceMismatch]),
    [[16, "i1", "10", false]]);
  assert.deepEqual(saved.lineDecisions.filter(entry => entry.destinedQuantity === "0").map(entry =>
    [entry.sourceRow, entry.confirmQuantityMismatch, entry.quantityMismatchReason]),
  [[17, true, "Código fora da PO"], [18, true, "Aguardando a HEXING"]]);
  assert.deepEqual(saved.audit.decisions.prices, [{ sourceRow: 16, choice: "CORRECT" }]);
  assert.deepEqual(saved.audit.decisions.poCells, [{ sourceRow: 18, action: "KEEP", reason: "Aguardando a HEXING" }]);
  assert.deepEqual(saved.audit.decisions.catalogMissing, [{ sourceRow: 17, action: "KEEP", reason: "Produto novo" }]);
  assert.equal(saved.audit.originalLines[0].unitPrice, "2.1");
  assert.equal(saved.audit.auditedFileSha256, "b".repeat(64));
  assert.deepEqual(saved.audit.references, { productDatabaseLoadId: "load-db", manufacturerListLoadId: null });
});

test("a PO taken from the suggestion is recorded from → to, and an accepted price keeps the confirmation", () => {
  const lines = [line(16, { poCell: "PO030305", poAssignments: [{ poNumber: "030305", quantity: "10", explicitQuantity: false }] })];
  const decisions = { ...emptyInvoiceAuditDecisions, poChoices: { "16:0": "030201" }, priceChoices: { 16: "ACCEPT" } };
  const file = audited(lines, decisions, { "030201": { poExists: true, items: [item("i1")] } });
  const saved = invoiceAuditSavePayload({ lines, countryOfOrigin: "CHINA", invoiceLabel: "INV-1", audited: file, fills: [] });
  assert.equal(saved.lines[0].poCell, "PO030201");
  assert.deepEqual(saved.audit.decisions.poChanges, [{ sourceRow: 16, from: "030305", to: "030201" }]);
  assert.deepEqual(saved.assignments.map(entry => [entry.sourcePoNumber, entry.poNumber, entry.confirmPriceMismatch]),
    [["030201", "030201", true]]);
});

test("the product is completed with the audited values of its empty fields, never with a flagged NCM", () => {
  const lines = [line(16, { productCode: "P9" })];
  const decisions = { ...emptyInvoiceAuditDecisions, flaggedNcms: { 16: true } };
  const file = audited(lines, decisions, { "030201": { poExists: true, items: [item("i1", { productCode: "P9", unitPrice: "2.1" })] } });
  const fills = invoiceAuditProductFills(file);
  assert.deepEqual(fills.map(fill => [fill.productCode, fill.fields, fill.values]), [["P9",
    ["manufacturer", "manufacturerAddress", "manufacturerCountry"],
    { ncmCode: null, manufacturer: "MAKER", manufacturerAddress: "ROAD 1", manufacturerCountry: "CHINA" }]]);
  const saved = invoiceAuditSavePayload({ lines, countryOfOrigin: "CHINA", invoiceLabel: "INV-1", audited: file, fills });
  assert.deepEqual(saved.catalogUpdates.products, [{ productCode: "P9", ncmCode: null, manufacturer: "MAKER",
    manufacturerAddress: "ROAD 1", manufacturerCountry: "CHINA" }]);
  assert.deepEqual(saved.audit.decisions.catalogMissing, [{ sourceRow: 16, action: "FLAG", reason: "" }]);
});

// Acceptance 2 and 3: with the real invoices, read back by the reader, the downloaded file has the lines and totals of the
// payload. The files stay out of Git (invoices_tests/); the test runs where they exist.
const folder = "../../../invoices_tests/";
const real = { followUp: new URL(`${folder}Follow Up Import 2026 (4).xlsx`, import.meta.url),
  reference: new URL(`${folder}reference-hml.json`, import.meta.url) };
const invoices = ["IPH034B 2026       INV+PL.xlsx", "IPH034C 2026       INV+PL.xlsx", "IPH037D 2026       INV+PL.xlsx"]
  .map(name => new URL(folder + name, import.meta.url));
const numeric = ["quantity", "unitPrice", "netWeightKg", "grossWeightKg", "amount"];
const textual = ["poCell", "ncm", "description", "manufacturer", "manufacturerAddress", "manufacturerCountry"];

test("the real invoices: the payload has the lines and totals of the downloaded file",
  { skip: ![real.followUp, real.reference, ...invoices].every(file => existsSync(file)) }, async () => {
    const { lines: followUp } = await parseFollowUpXlsx(new File([await readFile(real.followUp)], "Follow Up.xlsx"), ptBR);
    const reference = JSON.parse(await readFile(real.reference, "utf8"));
    for (const file of invoices) {
      const bytes = await readFile(file);
      const invoice = await parseChinaInvoiceXlsx(new File([bytes], "invoice.xlsx"), ptBR);
      const { model, decisions } = settleInvoiceAudit({ draft: invoice, source: followUpAuditSource(followUp, "ELETRA MATRIZ",
        invoice.ipNumber), products: reference.productDatabase.products, manufacturers: reference.manufacturerList.manufacturers });
      assert.equal(model.pending, 0, `${invoice.ipNumber}: points left`);
      const { written, audited: file2 } = await writeAuditedInvoice({ draft: invoice, bytes, model, decisions,
        references: { productDatabaseLoadId: reference.productDatabase.loadId, manufacturerListLoadId: reference.manufacturerList.loadId } });
      const saved = invoiceAuditSavePayload({ lines: invoice.lines, countryOfOrigin: invoice.countryOfOrigin,
        invoiceLabel: invoice.invoiceNumber, audited: file2, fills: [] });
      const reread = await parseChinaInvoiceXlsx(new File([written], "auditada.xlsx"), ptBR);
      assert.deepEqual(reread.lines.map(entry => entry.sourceRow), saved.lines.map(entry => entry.sourceRow), invoice.ipNumber);
      for (const [index, entry] of reread.lines.entries()) {
        const payloadLine = saved.lines[index];
        for (const field of numeric) {
          assert.equal(Number(entry[field]), Number(payloadLine[field]), `${invoice.ipNumber} row ${entry.sourceRow} ${field}`);
        }
        for (const field of textual) {
          assert.equal(entry[field].trim(), payloadLine[field].trim(), `${invoice.ipNumber} row ${entry.sourceRow} ${field}`);
        }
      }
      assert.equal(Number(reread.totalAmount), Number(saved.amount), `${invoice.ipNumber} amount`);
      assert.equal(Number(reread.totalQuantity), Number(saved.totalQuantity), `${invoice.ipNumber} quantity`);
      assert.equal(reread.countryOfOrigin.trim(), saved.countryOfOrigin.trim(), `${invoice.ipNumber} country of origin`);
      // The audit changed the file, and every allocation goes to a PO cited by the saved cell.
      assert.ok(file2.corrections.some(entry => entry.changed.length), invoice.ipNumber);
      if (invoice.ipNumber.includes("037D")) {
        // Acceptance 3: the unreadable cell of line 20 no longer blocks the invoice and is split 20 + 60.
        const row20 = saved.assignments.filter(entry => entry.sourceRow === 20)
          .map(entry => [entry.sourcePoNumber, entry.quantity]);
        assert.deepEqual(row20, [["030888", "20"], ["030201", "60"]]);
        assert.deepEqual(saved.audit.decisions.poCells, [{ sourceRow: 20, action: "SPLIT", reason: "" }]);
        assert.equal(saved.lines.find(entry => entry.sourceRow === 20).poCell, "PO 030888 = 20 UNIT\nPO 030201 = 60 UNIT");
      }
    }
  });
