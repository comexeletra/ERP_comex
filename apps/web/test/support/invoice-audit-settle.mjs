// Test support (not a test file): settles every point of an invoice audit as the analysts did on the real invoices
// (docs/PLANO_INVOICE_IP_AUDITORIA_DISTRIBUICAO.md, "Avaliação com invoices reais") and writes the audited file, so the web
// and the API tests check the payload the IP screen builds from it. Used by test/invoice-audit-save.test.mjs and by
// apps/api/test/invoice-audit-check.test.mjs.
import { emptyInvoiceAuditDecisions, invoiceAuditCorrectionInput, invoiceAuditModel,
  invoiceManufacturerId } from "../../lib/china-invoice-mapping.ts";
import { invoiceAuditBulkGroups } from "../../lib/invoice-bulk-decisions.ts";
import { invoiceCorrectedTotals, invoiceLineCorrections, writeCorrectedInvoice } from "../../lib/invoice-correction-xlsx.ts";

const reason = "Conferido pela analista";
/** The bulk action taken for each group: the corrections that change the file, so the save checks them all. */
const preferred = { poCell: "acceptSplit", price: "correctPrice", packing: "usePacking", quantity: "confirmQuantity",
  supplier: "confirmSupplier", unit: "confirmUnit", catalog: "confirmCatalog", country: "useListCountry", manufacturer: "confirmManufacturer" };

export function settleInvoiceAudit({ draft, source, products, manufacturers, flagFirstMissingNcm = false }) {
  let decisions = emptyInvoiceAuditDecisions;
  const build = () => invoiceAuditModel({ draft, source, products, manufacturers, decisions });
  let model = build();
  for (let round = 0; round < 12 && model.pending > 0; round += 1) {
    const quantities = { ...decisions.quantities }, poChoices = { ...decisions.poChoices };
    for (const row of model.rows.filter(entry => entry.issue)) {
      if (row.suggestions.length && !poChoices[row.part.key]) poChoices[row.part.key] = row.suggestions[0].poNumber;
      else if (row.issue.kind === "INSUFFICIENT_BALANCE") quantities[row.part.key] = row.issue.available;
      else quantities[row.part.key] = "0";
    }
    const addressChoices = { ...decisions.addressChoices };
    for (const check of model.manufacturerChecks) {
      if (!check.entry && check.candidates.length && !addressChoices[check.sourceRow]) {
        addressChoices[check.sourceRow] = invoiceManufacturerId(check.candidates[0]);
      }
    }
    const flaggedNcms = flagFirstMissingNcm && model.catalog.missing.length && !Object.keys(decisions.flaggedNcms).length
      ? { [model.catalog.missing[0].sourceRow]: true } : decisions.flaggedNcms;
    decisions = { ...decisions, quantities, poChoices, addressChoices, flaggedNcms };
    model = build();
    for (const group of invoiceAuditBulkGroups(model.bulk, model.supplierMismatches, decisions)) {
      if (!group.pending) continue;
      const action = group.actions.find(entry => entry.id === preferred[group.id]) ?? group.actions[0];
      decisions = action.run(reason).next;
      // A price that cannot be corrected (several PO prices) is accepted.
      if (group.id === "price") decisions = invoiceAuditBulkGroups(model.bulk, model.supplierMismatches, decisions)
        .find(entry => entry.id === "price").actions.find(entry => entry.id === "acceptPrice").run("").next;
    }
    model = build();
  }
  return { model, decisions };
}

/** The audited file as the subsection downloads it, and the InvoiceAuditedFile the IP screen saves. */
export async function writeAuditedInvoice({ draft, bytes, model, decisions, references }) {
  const input = invoiceAuditCorrectionInput(model, decisions);
  const corrections = invoiceLineCorrections(draft.lines, input.parts, input.prices, input.weights, input.reference);
  const totals = invoiceCorrectedTotals(corrections);
  const written = await writeCorrectedInvoice(bytes, draft.layout, corrections, totals,
    { sheetName: "AUDITORIA", summary: [], columns: ["Linha"], rows: [] }, value => `Valor original: ${value}`,
    draft.packingList, model.origin.corrected, { rows: input.ncmFlagRows, text: "NCM não encontrada na DATABASE" });
  const { createHash } = await import("node:crypto");
  const sha256 = createHash("sha256").update(Buffer.from(written)).digest("hex");
  return { written, audited: { model, decisions, corrections, totals, sha256, fileName: `${draft.fileName} - auditada.xlsx`, references } };
}
