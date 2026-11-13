import assert from "node:assert/strict";
import test from "node:test";
import { invoiceAuditAllowedPos, invoiceAuditCitedByPo, invoiceAuditFields, invoiceAuditPoPrices, invoiceOriginCountries,
  invoicePoCellNumbers } from "../dist/invoice-audit-check.js";
import { parseInvoicePoCell } from "../dist/invoice-po-cell.js";
// The rules of the audit on the IP screen; Node 24 strips the types on import. This file runs in the repository, not in a
// release of the VPS, which has only apps/api.
import { invoiceLinePricePoint, invoiceOriginCountries as webOriginCountries,
  invoicePoCellNumbers as webPoCellNumbers } from "../../web/lib/china-invoice-mapping.ts";
import { invoiceLineCorrections } from "../../web/lib/invoice-correction-xlsx.ts";

const cells = ["PO 030888&030201", "PO030201", "PO 030321 = 412 unit\nPO 032025 = 8 unit", "PO030888 / 030201 / 31178",
  "PO 1234 & 12345", "", "PO030201=1,000 pcs"];

test("the API reads the PO numbers of an unreadable cell as the web does", () => {
  for (const cell of cells) assert.deepEqual(invoicePoCellNumbers(cell), webPoCellNumbers(cell), cell);
});

test("the API completes the header country of origin as the web does", () => {
  for (const [header, countries] of [["CHINA", ["China", "TAIWAN"]], ["", ["CHINA"]], ["CHINA AND TAIWAN", ["Taiwan"]],
    ["EUA", ["USA", "JAPAN"]], ["China; Japão", ["JAPAN", " "]], ["CHINA", []]]) {
    assert.deepEqual(invoiceOriginCountries(header, countries), webOriginCountries(header, countries), header);
  }
});

test("the API takes the one CNY price of the PO items as the web does", () => {
  for (const items of [
    [{ unitPrice: "0.3642", currency: "CNY" }, { unitPrice: "0.36420000", currency: "CNY" }],
    [{ unitPrice: "1", currency: "CNY" }, { unitPrice: "2", currency: "CNY" }],
    [{ unitPrice: "1", currency: "USD" }, { unitPrice: "2", currency: "CNY" }, { unitPrice: null, currency: "CNY" }],
  ]) {
    assert.deepEqual(invoiceAuditPoPrices(items), invoiceLinePricePoint("9", items).poPrices, JSON.stringify(items));
  }
});

test("the API reads the split cell the web writes in the audited file", () => {
  const line = { sourceRow: 20, lineNumber: "5", quantity: "80", poCell: "PO 030888&030201", unitPrice: "1", netWeightKg: "1",
    grossWeightKg: "2", amount: "80", ncm: "85044090", description: "Part", manufacturer: "M", manufacturerAddress: "A",
    manufacturerCountry: "CHINA", poAssignments: [] };
  const [correction] = invoiceLineCorrections([line], [{ sourceRow: 20, poNumber: "030888", quantity: "20" },
    { sourceRow: 20, poNumber: "030201", quantity: "60" }], {}, {});
  assert.deepEqual(parseInvoicePoCell(correction.corrected.poCell),
    [{ poNumber: "030888", quantity: "20" }, { poNumber: "030201", quantity: "60" }]);
  assert.deepEqual([...invoiceAuditAllowedPos(line.poCell, [])].sort(), ["030201", "030888"]);
  // The fields the API compares are those of the audited file.
  assert.deepEqual([...invoiceAuditFields].sort(), Object.keys(correction.original).sort());
});

test("a PO change keeps the quantities the supplier wrote for the PO it replaces", () => {
  const units = value => BigInt(value.replace(".", ""));
  assert.deepEqual(invoiceAuditCitedByPo("PO030201=3 pcs, PO030305=2 pcs", [{ from: "PO030305", to: "PO 031178" }], units),
    new Map([["030201", 3n], ["031178", 2n]]));
  assert.equal(invoiceAuditCitedByPo("PO030201", [], units), null);
  assert.equal(invoiceAuditAllowedPos("PO030201", [{ from: "030305", to: "031178" }]), null);
  assert.deepEqual([...invoiceAuditAllowedPos("PO030201", [{ from: "030201", to: "PO031178" }])], ["030201", "031178"]);
});

// Acceptance 7 (phase B2): the real invoices, audited with the rules and the bulk actions of the screen, pass every check of
// the API. The files stay out of Git (invoices_tests/); the test runs where they exist.
const { existsSync } = await import("node:fs");
const { readFile } = await import("node:fs/promises");
const { checkInvoiceAudit } = await import("../dist/invoice-audit-check.js");
const folder = "../../../invoices_tests/";
const realFiles = { followUp: new URL(`${folder}Follow Up Import 2026 (4).xlsx`, import.meta.url),
  reference: new URL(`${folder}reference-hml.json`, import.meta.url) };
const realInvoices = ["IPH034B 2026       INV+PL.xlsx", "IPH034C 2026       INV+PL.xlsx", "IPH037D 2026       INV+PL.xlsx"]
  .map(name => new URL(folder + name, import.meta.url));

test("the real invoices audited by the screen pass the audit checks of the API",
  { skip: ![realFiles.followUp, realFiles.reference, ...realInvoices].every(file => existsSync(file)) }, async () => {
    const { invoiceAuditSavePayload } = await import("../../web/lib/china-invoice-mapping.ts");
    const { followUpAuditSource, parseFollowUpXlsx } = await import("../../web/lib/audit-reference-xlsx.ts");
    const { parseChinaInvoiceXlsx } = await import("../../web/lib/china-invoice-xlsx.ts");
    const { ptBR } = await import("../../web/lib/i18n/pt-BR.ts");
    const { settleInvoiceAudit, writeAuditedInvoice } = await import("../../web/test/support/invoice-audit-settle.mjs");
    const { lines: followUp } = await parseFollowUpXlsx(new File([await readFile(realFiles.followUp)], "Follow Up.xlsx"), ptBR);
    const reference = JSON.parse(await readFile(realFiles.reference, "utf8"));
    const products = new Map(reference.productDatabase.products.map(row => [row.productCode.trim().toLocaleUpperCase("en-US"),
      { ncm: row.ncm, description: row.description }]));
    const manufacturers = new Map(reference.manufacturerList.manufacturers.map(row => [row.sourceRow, row]));
    for (const file of realInvoices) {
      const bytes = await readFile(file);
      const invoice = await parseChinaInvoiceXlsx(new File([bytes], "invoice.xlsx"), ptBR);
      const { model, decisions } = settleInvoiceAudit({ draft: invoice, source: followUpAuditSource(followUp, "ELETRA MATRIZ",
        invoice.ipNumber), products: reference.productDatabase.products, manufacturers: reference.manufacturerList.manufacturers,
        flagFirstMissingNcm: true });
      const { audited } = await writeAuditedInvoice({ draft: invoice, bytes, model, decisions,
        references: { productDatabaseLoadId: reference.productDatabase.loadId, manufacturerListLoadId: reference.manufacturerList.loadId } });
      const saved = invoiceAuditSavePayload({ lines: invoice.lines, countryOfOrigin: invoice.countryOfOrigin,
        invoiceLabel: invoice.invoiceNumber, audited, fills: [] });
      const itemsByRow = new Map();
      for (const row of model.rows) for (const { item } of row.allocations) {
        itemsByRow.set(row.part.sourceRow, [...(itemsByRow.get(row.part.sourceRow) ?? []), item]);
      }
      const { problem, changedFields } = checkInvoiceAudit({ lines: saved.lines, countryOfOrigin: saved.countryOfOrigin,
        audit: saved.audit, lineDecisions: new Map(saved.lineDecisions.map(decision => [decision.sourceRow, decision])),
        products, manufacturers, itemsByRow });
      assert.equal(problem, null, `${invoice.ipNumber}: ${JSON.stringify(problem)}`);
      assert.ok(Object.keys(changedFields).length > 0, invoice.ipNumber);
      // The same audit with a changed value out of the DATABASE is refused.
      const forged = structuredClone(saved.lines);
      const inDatabase = forged.find(entry => products.has(entry.productCode.trim().toLocaleUpperCase("en-US")));
      inDatabase.ncm = inDatabase.ncm === "11111111" ? "22222222" : "11111111";
      assert.equal(checkInvoiceAudit({ lines: forged, countryOfOrigin: saved.countryOfOrigin, audit: saved.audit,
        lineDecisions: new Map(), products, manufacturers, itemsByRow }).problem?.code, "INVOICE_AUDIT_CHANGE_UNJUSTIFIED");
    }
  });
