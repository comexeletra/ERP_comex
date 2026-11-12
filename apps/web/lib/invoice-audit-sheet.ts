import type { ChinaInvoiceDraft } from "./china-invoice-xlsx";
import type { InvoiceAuditCandidate, InvoiceAuditDecisions, InvoiceAuditModel, InvoiceAuditUnreadLine } from "./china-invoice-mapping";
import type { InvoiceAuditSheet, InvoiceChangedCell, InvoiceLineCorrection } from "./invoice-correction-xlsx";
import type { Messages } from "./i18n/pt-BR";

/**
 * The AUDITORIA sheet of the audited invoice, shared by the audit page (POs of the Follow Up) and the audit of the IP
 * screen (POs of the platform), user decisions of 2026-11-12. Formatting and the flagged cells come as parameters,
 * because the modules of lib/ do not import values from one another.
 */

export const invoiceAuditSheetName = "AUDITORIA"; // i18n-ignore: sheet name kept in Portuguese, like the INV and PKL sheets

/** Where the POs of the audit came from. */
export type InvoiceAuditSourceSummary = { kind: "followUp"; fileName: string; fileSha256: string; sameIps: readonly string[] }
  | { kind: "platform"; systemIp: string };
type ReferenceSummary = { fileName: string; fileSha256: string; loadedAt: string; loadedBy: string } | null;
export type InvoiceAuditFormat = { number: (value: string) => string; percent: (value: number) => string;
  dateTime: (value: string) => string };

/** The audit texts of the source: the platform ones replace those that cite the Follow Up. */
export function invoiceAuditTexts(m: Messages, kind: InvoiceAuditSourceSummary["kind"]): Messages["invoiceAudit"] {
  const t = m.invoiceAudit;
  if (kind === "followUp") return t;
  const { platform } = t;
  return { ...t, column: platform.column, takes: platform.takes, followUpValue: platform.followUpValue,
    priceSeveral: platform.priceSeveral, insufficient: platform.insufficient, codeNotFound: platform.codeNotFound,
    poNotFound: platform.poNotFound, poSuggestionsTitle: platform.poSuggestionsTitle, poSuggestion: platform.poSuggestion,
    poChanged: platform.poChanged, poCellProposal: platform.poCellProposal, acceptSplit: platform.acceptSplit,
    supplierMismatch: platform.supplierMismatch,
    bulk: { ...t.bulk, actions: { ...t.bulk.actions, acceptSplit: platform.bulkAcceptSplit } } };
}

export type InvoiceAuditSheetInput<T extends InvoiceAuditCandidate> = {
  draft: ChinaInvoiceDraft; model: InvoiceAuditModel<T>; decisions: InvoiceAuditDecisions;
  corrections: readonly InvoiceLineCorrection[]; changedCells: Readonly<Record<number, readonly InvoiceChangedCell[]>>;
  ncmFlagCells: (sourceRow: number) => string[]; database: ReferenceSummary; manufacturerList: ReferenceSummary;
  source: InvoiceAuditSourceSummary; importer: string; user: string;
};

export function invoiceAuditSplitText(entry: InvoiceAuditUnreadLine, number: (value: string) => string): string {
  return entry.numbers.map((poNumber, index) => `PO ${poNumber} = ${number(entry.split[index])}`).join("; ");
}

/** The AUDITORIA sheet: the files used and, per invoice line, each point with its decision and the changed cells. */
export function invoiceAuditSheet<T extends InvoiceAuditCandidate>(m: Messages, input: InvoiceAuditSheetInput<T>,
  format: InvoiceAuditFormat): InvoiceAuditSheet {
  const s = m.invoiceAudit.sheet;
  const platform = input.source.kind === "platform" ? m.invoiceAudit.platform.sheet : null;
  const { draft, model, decisions } = input;
  const lineNumber = (row: number | null) => draft.lines.find(line => line.sourceRow === row)?.lineNumber ?? "";
  const cells = (row: number, fields: readonly string[]) => (input.changedCells[row] ?? [])
    .filter(entry => fields.includes(entry.field)).map(entry => entry.cell).join(", ");
  const rows: string[][] = [];
  for (const entry of model.unreadLines) {
    const row = entry.line.sourceRow;
    const split = Boolean(decisions.splitAccepted[row]);
    rows.push([String(row), entry.line.lineNumber, s.poCell, entry.line.poCell,
      entry.split.length ? invoiceAuditSplitText(entry, format.number) : "—",
      split ? platform?.splitByBalance ?? s.splitByBalance : s.keptWithoutDestination,
      split ? "" : decisions.poCellKept[row]?.reason.trim() ?? "", split ? cells(row, ["poCell"]) : ""]);
  }
  for (const { part, line, decision, points, allocations } of model.rows) {
    if (part.poNumber !== part.sourcePoNumber) {
      rows.push([String(part.sourceRow), line.lineNumber, s.poChanged, `PO ${part.sourcePoNumber}`, `PO ${part.poNumber}`,
        platform?.tookSuggestedPo ?? s.tookSuggestedPo, "", cells(part.sourceRow, ["poCell"])]);
    }
    rows.push([String(part.sourceRow), line.lineNumber, s.destination, `PO ${part.poNumber} · ${part.productCode}`,
      allocations.map(({ item, quantity }) => platform
        ? platform.destinationValue(item.poNumber, item.lineNumber, format.number(quantity))
        : s.destinationValue(item.lineNumber, format.number(quantity))).join("; ") || "—",
      s.destined(format.number(part.quantity)), "", part.key.endsWith(":0") ? cells(part.sourceRow, ["quantity", "poCell", "amount"]) : ""]);
    for (const point of points) {
      rows.push([String(part.sourceRow), line.lineNumber, m.newRecord.auditKind[point.kind], point.invoiceValue, point.poValue || "—",
        s.confirmed, decision.reason.trim(), ""]);
    }
  }
  for (const [row, point] of model.pricePoints) {
    rows.push([String(row), lineNumber(row), m.newRecord.auditKind.PRICE, `${point.invoicePrice} CNY`,
      point.poPrices.map(price => `${price} CNY`).join(" · ") + (point.difference?.percent != null
        ? ` (${format.percent(point.difference.percent)})` : ""),
      decisions.priceChoices[row] === "CORRECT" ? s.corrected : s.accepted, "", cells(row, ["unitPrice"])]);
  }
  // The Follow Up has no unit: only the platform POs give this point.
  for (const [row, point] of model.unitPoints) {
    rows.push([String(row), lineNumber(row), m.newRecord.auditKind.UNIT, point.invoiceUnit, point.poUnits.join(" · "),
      s.confirmed, "", ""]);
  }
  for (const point of model.catalog.points) {
    rows.push([String(point.sourceRow), point.lineNumber, m.invoiceAudit.catalogField[point.field], point.invoiceValue,
      point.databaseValue, s.tookDatabase, "",
      cells(point.sourceRow, [point.field])]);
  }
  for (const entry of model.catalog.missing) {
    const flagged = Boolean(decisions.flaggedNcms[entry.sourceRow]);
    rows.push([String(entry.sourceRow), entry.lineNumber, entry.reason === "NO_NCM" ? s.noNcmInDatabase : s.notInDatabase,
      entry.productCode, "—", flagged ? s.ncmFlagged : s.confirmed,
      flagged ? "" : decisions.missingDecisions[entry.sourceRow]?.reason.trim() ?? "",
      flagged ? input.ncmFlagCells(entry.sourceRow).join(", ") : ""]);
  }
  for (const check of model.manufacturerChecks) {
    const row = String(check.sourceRow);
    const correction = input.corrections.find(entry => entry.sourceRow === check.sourceRow);
    const { chosen, listCountry } = model.manufacturerChoices.get(check.sourceRow) ?? { chosen: null, listCountry: null };
    if (check.status === "MISSING" && !chosen) {
      rows.push([row, check.lineNumber, s.notInList, check.invoice.name, "—", s.confirmed,
        decisions.manufacturerMissing[check.sourceRow]?.reason.trim() ?? "", ""]);
      continue;
    }
    for (const field of ["manufacturer", "manufacturerAddress"] as const) {
      if (!correction?.changed.includes(field)) continue;
      rows.push([row, check.lineNumber, m.invoiceAudit.manufacturerField[field], correction.original[field],
        correction.corrected[field], chosen ? (check.status === "MISSING" ? s.chosenManufacturer(chosen.code || "—")
          : s.chosenAddress(chosen.code || "—")) : check.status === "NAME" ? s.listByName : s.listValue,
        "", cells(check.sourceRow, [field])]);
    }
    if (listCountry) {
      const choice = decisions.countryChoices[check.sourceRow];
      rows.push([row, check.lineNumber, s.manufacturerCountry, check.invoice.country, listCountry,
        choice?.source === "LIST" ? s.tookListCountry : s.keptInvoiceCountry, choice?.reason.trim() ?? "",
        cells(check.sourceRow, ["manufacturerCountry"])]);
    }
  }
  for (const correction of input.corrections) {
    const listCountry = Boolean(model.manufacturerChoices.get(correction.sourceRow)?.listCountry);
    if (correction.changed.includes("manufacturerCountry") && !listCountry) {
      rows.push([String(correction.sourceRow), correction.lineNumber, s.manufacturerCountry, correction.original.manufacturerCountry,
        correction.corrected.manufacturerCountry, s.capitals, "", cells(correction.sourceRow, ["manufacturerCountry"])]);
    }
  }
  if (model.origin.corrected) {
    rows.push(["—", "", s.originCountry, draft.countryOfOrigin, model.origin.corrected, s.originAdded(model.origin.missing.join(", ")), "",
      "COUNTRY OF ORIGIN"]); // i18n-ignore: invoice header label
  }
  for (const supplier of model.supplierMismatches) {
    rows.push(["—", "", m.newRecord.auditKind.SUPPLIER, draft.exporterText.split(/\r?\n/u)[0], supplier, s.confirmed, "", ""]);
  }
  for (const divergence of model.divergences) {
    const choice = decisions.packingChoices[divergence.key];
    const values = (side: typeof divergence.invoice) => side
      ? divergence.fields.map(field => `${m.newRecord.conference.field[field]} ${side[field]}`).join("; ") : "—";
    rows.push([divergence.invoiceRow === null ? "—" : String(divergence.invoiceRow), divergence.lineNumber, s.packing,
      values(divergence.invoice), values(divergence.packing), choice?.source === "PACKING" ? s.tookPacking : s.keptInvoice,
      choice?.reason.trim() ?? "", divergence.invoiceRow === null ? "" : cells(divergence.invoiceRow, ["netWeightKg", "grossWeightKg"])]);
  }
  for (const correction of input.corrections) {
    if (!correction.destined) rows.push([String(correction.sourceRow), lineNumber(correction.sourceRow), s.notDestined, "", "", s.keptAsCame, "", ""]);
    else if (correction.changed.includes("quantity")) {
      rows.push([String(correction.sourceRow), lineNumber(correction.sourceRow), s.notice, "", "", s.weightsNotRecalculated, "", ""]);
    }
  }
  rows.sort((left, right) => (Number(left[0]) || Number.MAX_SAFE_INTEGER) - (Number(right[0]) || Number.MAX_SAFE_INTEGER));
  const reference = (load: ReferenceSummary, empty: string) => load
    ? s.referenceLoad(load.fileName, load.fileSha256, format.dateTime(load.loadedAt), load.loadedBy) : empty;
  const sourceRows: [string, string][] = input.source.kind === "followUp"
    ? [[s.followUp, `${input.source.fileName} (SHA-256 ${input.source.fileSha256})`]]
    : [[m.invoiceAudit.platform.sheet.poSource, m.invoiceAudit.platform.sheet.poSourceValue],
      [m.invoiceAudit.platform.sheet.systemIp, input.source.systemIp]];
  return { sheetName: invoiceAuditSheetName, columns: s.columns, rows, summary: [
    [s.invoice, `${draft.fileName} (SHA-256 ${draft.fileSha256})`], ...sourceRows,
    [s.database, reference(input.database, s.noDatabase)],
    [s.manufacturerList, reference(input.manufacturerList, s.noManufacturerList)],
    [s.ipRef, draft.ipNumber],
    ...(input.source.kind === "followUp" ? [[s.sameIps, input.source.sameIps.join(", ") || "—"] as [string, string]] : []),
    [s.importer, input.importer], [s.date, new Date().toISOString()], [s.user, input.user], [s.note, s.noteText],
  ] };
}
