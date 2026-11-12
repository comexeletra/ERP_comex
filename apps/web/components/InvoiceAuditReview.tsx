"use client";

import { useMemo, useState } from "react";
import type { ChinaInvoiceDraft } from "../lib/china-invoice-xlsx";
import { invoiceAuditCorrectionInput, invoiceAuditModel, type InvoiceAuditCandidate, type InvoiceAuditDecisions,
  type InvoiceAuditSource, InvoiceCatalogMissing, InvoiceCatalogPoint, InvoicePackingChoice, invoicePackingChoiceReady,
  invoicePoCellSettled, invoicePriceChoiceReady, invoicePriceTolerancePercent, InvoiceQuantityDecision, invoiceQuantityDecisionReady,
  invoiceManufacturerId, classifyInvoiceDestination } from "../lib/china-invoice-mapping";
import { invoiceAuditBulkGroups } from "../lib/invoice-bulk-decisions";
import { invoiceAuditSheet, invoiceAuditSplitText, invoiceAuditTexts, type InvoiceAuditSourceSummary } from "../lib/invoice-audit-sheet";
import { invoiceChangedCells, invoiceCorrectedTotals, invoiceLineCorrections, invoiceNcmFlagCells,
  writeCorrectedInvoice } from "../lib/invoice-correction-xlsx";
import type { AuditReference } from "../lib/reference-loads";
import { formatUsDateTime } from "../lib/date-format";
import { formatDecimal, formatNumber, formatPercentChange } from "../lib/format-number";
import type { Messages } from "../lib/i18n/pt-BR";
import { getMessages, useI18n } from "./I18nProvider";
import InvoiceBulkDecisions from "./InvoiceBulkDecisions";
import InvoiceConference from "./InvoiceConference";
import InvoiceManufacturerAudit from "./InvoiceManufacturerAudit";

const noDecision: InvoiceQuantityDecision = { confirmed: false, reason: "" };
export type InvoiceAuditDecisionsUpdate = (update: (current: InvoiceAuditDecisions) => InvoiceAuditDecisions) => void;

/**
 * The invoice audit shared by the audit page (POs of the Follow Up) and the IP screen (POs of the platform), user
 * decisions of 2026-11-12: the same rules (lib/china-invoice-mapping.ts), the same points and the same audited file.
 * The decisions belong to the screen that shows it, which clears them when the invoice or the POs change.
 */
export default function InvoiceAuditReview<T extends InvoiceAuditCandidate>({ draft, bytes, source, summary, reference,
  importer, user, decisions, onDecisions, onDownloaded }: {
  draft: ChinaInvoiceDraft; bytes: ArrayBuffer; source: InvoiceAuditSource<T>; summary: InvoiceAuditSourceSummary;
  reference: AuditReference | null; importer: string; user: string; decisions: InvoiceAuditDecisions;
  onDecisions: InvoiceAuditDecisionsUpdate; onDownloaded?: () => void;
}) {
  const { m } = useI18n();
  const t = invoiceAuditTexts(m, summary.kind);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const database = reference?.productDatabase ?? null;
  const manufacturerList = reference?.manufacturerList ?? null;
  const model = useMemo(() => invoiceAuditModel({ draft, source, products: database?.products ?? null,
    manufacturers: manufacturerList?.manufacturers ?? null, decisions }), [draft, source, database, manufacturerList, decisions]);
  const { rows, pricePoints, unitPoints, supplierMismatches, divergences, catalog, manufacturerChecks, manufacturerCorrections,
    origin, pending, canDownload } = model;
  const bulkGroups = invoiceAuditBulkGroups(model.bulk, supplierMismatches, decisions).map(group => ({ ...group,
    actions: group.actions.map(action => ({ ...action, run: (reason: string) => {
      const outcome = action.run(reason);
      onDecisions(() => outcome.next);
      return { applied: outcome.applied, left: outcome.left };
    } })) }));
  const change = <K extends keyof InvoiceAuditDecisions>(key: K, next: (value: InvoiceAuditDecisions[K]) => InvoiceAuditDecisions[K]) =>
    onDecisions(current => ({ ...current, [key]: next(current[key]) }));
  const setDecision = (sourceRow: number, update: Partial<InvoiceQuantityDecision>) => change("quantityDecisions", current =>
    ({ ...current, [sourceRow]: { ...(current[sourceRow] ?? noDecision), ...update } }));
  const setQuantity = (key: string, value: string) => change("quantities", current => ({ ...current, [key]: value }));

  async function download() {
    if (!canDownload) return;
    setError(""); setReading(true);
    const messages = getMessages();
    try {
      const input = invoiceAuditCorrectionInput(model, decisions);
      const corrections = invoiceLineCorrections(draft.lines, input.parts, input.prices, input.weights, input.reference);
      const changedCells = invoiceChangedCells(corrections, draft.layout, draft.packingList);
      const written = await writeCorrectedInvoice(bytes, draft.layout, corrections, invoiceCorrectedTotals(corrections),
        invoiceAuditSheet(messages, { draft, model, decisions, corrections, changedCells, database, manufacturerList, importer, user,
          source: summary, ncmFlagCells: row => invoiceNcmFlagCells(draft.layout, row) },
        { number: value => formatNumber(value), percent: formatPercentChange, dateTime: formatUsDateTime }),
        messages.invoiceAudit.noteOriginal, draft.packingList, origin.corrected,
        { rows: input.ncmFlagRows, text: messages.invoiceAudit.ncmFlagCell });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([written], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      link.download = `${draft.fileName.replace(/\.xlsx$/iu, "")} - ${messages.invoiceAudit.fileSuffix}.xlsx`;
      link.click();
      URL.revokeObjectURL(link.href);
      onDownloaded?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : messages.common.unexpectedError); }
    finally { setReading(false); }
  }

  return <>
    {draft.warnings.map(warning => <p className="notice warning" key={warning}>{warning}</p>)}
    <InvoiceBulkDecisions key={draft.fileSha256} t={t.bulk} groups={bulkGroups} />
    <InvoiceConference draft={draft} divergences={divergences} decisions={{}} onDecision={() => undefined}
      valueParts={rows.flatMap(row => row.allocations.map(allocation => ({ quantity: allocation.quantity,
        invoicePrice: row.line.unitPrice, poPrice: allocation.item.unitPrice, poCurrency: allocation.item.currency })))}
      decisionReady={divergence => invoicePackingChoiceReady(divergence, decisions.packingChoices[divergence.key])}
      renderDecision={divergence => {
        const choice = decisions.packingChoices[divergence.key] ?? { source: null, reason: "" };
        const update = (patch: Partial<InvoicePackingChoice>) => change("packingChoices", current =>
          ({ ...current, [divergence.key]: { ...choice, ...patch } }));
        return <>
          <fieldset className="invoice-audit-choice"><legend>{t.packingChoice}</legend>
            <label><input type="radio" name={`packing-${divergence.key}`} checked={choice.source === "INVOICE"}
              onChange={() => update({ source: "INVOICE" })} />{t.keepInvoice}</label>
            {divergence.invoice && divergence.packing && <label><input type="radio" name={`packing-${divergence.key}`}
              checked={choice.source === "PACKING"} onChange={() => update({ source: "PACKING" })} />{t.usePacking}</label>}
          </fieldset>
          {divergence.fields.includes("quantity") && <p className="invoice-audit-note">{t.packingQuantityNote}</p>}
          <label className="invoice-audit-reason">{m.newRecord.conference.reason}<input required minLength={3} maxLength={1000}
            value={choice.reason} onChange={event => update({ reason: event.target.value })} /></label>
        </>;
      }} />
    {supplierMismatches.map(supplier => <div className="notice warning" key={supplier}>
      <p>{t.supplierMismatch(supplier, draft.exporterText.split(/\r?\n/u)[0])}</p>
      <label className="invoice-audit-confirm"><input type="checkbox" checked={Boolean(decisions.supplierConfirmed[supplier])}
        onChange={event => { const checked = event.target.checked; change("supplierConfirmed", current => ({ ...current, [supplier]: checked })); }} />
        {t.confirmSupplier(supplier)}</label>
    </div>)}
    {!database ? <p className="notice warning">{t.noDatabase}</p> : <CatalogAudit t={t} points={catalog.points}
      missing={catalog.missing} missingDecisions={decisions.missingDecisions} flagged={decisions.flaggedNcms}
      onMissing={(row, patch) => change("missingDecisions", current =>
        ({ ...current, [row]: { ...(current[row] ?? noDecision), ...patch } }))}
      onFlag={(row, flag) => change("flaggedNcms", current => ({ ...current, [row]: flag }))} />}
    <InvoiceManufacturerAudit t={t} hasList={Boolean(manufacturerList)} checks={manufacturerChecks}
      corrections={manufacturerCorrections} addressChoices={decisions.addressChoices} countryChoices={decisions.countryChoices}
      missingDecisions={decisions.manufacturerMissing} origin={origin} header={draft.countryOfOrigin}
      list={manufacturerList?.manufacturers ?? []}
      onAddress={(row, id) => onDecisions(current => ({ ...current, addressChoices: { ...current.addressChoices, [row]: id },
        countryChoices: withoutKey(current.countryChoices, row) }))}
      onPick={(row, entry) => onDecisions(current => ({ ...current,
        pickedManufacturers: { ...current.pickedManufacturers, [row]: entry },
        addressChoices: { ...current.addressChoices, [row]: invoiceManufacturerId(entry) },
        countryChoices: withoutKey(current.countryChoices, row) }))}
      onCountry={(row, patch) => change("countryChoices", current =>
        ({ ...current, [row]: { ...(current[row] ?? { source: null, reason: "" }), ...patch } }))}
      onMissing={(row, patch) => change("manufacturerMissing", current =>
        ({ ...current, [row]: { ...(current[row] ?? noDecision), ...patch } }))} />
    {model.unreadLines.length > 0 && <section className="notice" aria-label={t.poCellTitle}>
      <h3>{t.poCellTitle}</h3>
      <ul className="invoice-audit-list">{model.unreadLines.map(entry => {
        const row = entry.line.sourceRow;
        const kept = decisions.poCellKept[row] ?? noDecision;
        const setKept = (patch: Partial<InvoiceQuantityDecision>) => change("poCellKept", current =>
          ({ ...current, [row]: { ...(current[row] ?? noDecision), ...patch } }));
        const splitText = invoiceAuditSplitText(entry, value => formatNumber(value));
        return <li key={row} className={`notice ${invoicePoCellSettled(decisions, row) ? "success" : "error"}`}>
          <p>{t.poCellUnreadable(row, entry.line.lineNumber, entry.line.poCell)}</p>
          {decisions.splitAccepted[row] ? <>
            <p className="invoice-audit-note">{t.splitAccepted(splitText)}</p>
            <div className="button-row"><button className="button secondary" type="button"
              onClick={() => change("splitAccepted", current => ({ ...current, [row]: false }))}>{t.undoSplit}</button></div>
          </> : <>
            {entry.split.length > 0 ? <>
              <p>{t.poCellProposal(splitText)}</p>
              <div className="button-row"><button className="button secondary" type="button"
                onClick={() => change("splitAccepted", current => ({ ...current, [entry.line.sourceRow]: true }))}>{t.acceptSplit}</button></div>
            </> : <p className="invoice-audit-note">{t.poCellNoProposal}</p>}
            <label className="invoice-audit-confirm"><input type="checkbox" checked={kept.confirmed}
              onChange={event => setKept({ confirmed: event.target.checked })} />{t.keepWithoutDestination}</label>
            <label className="invoice-audit-reason">{t.reason}<input required minLength={3} maxLength={1000} value={kept.reason}
              onChange={event => setKept({ reason: event.target.value })} /></label>
          </>}
        </li>;
      })}</ul>
    </section>}
    <div className="totvs-import-table-wrap invoice-match-table-wrap"><table className="totvs-import-table invoice-match-table">
      <thead><tr><th>{t.column.line}</th><th>{t.column.product}</th><th>{t.column.quantity}</th><th>{t.column.destination}</th></tr></thead>
      <tbody>{rows.map(({ part, line, decision, allocations, points, issue, suggestions }) => {
        const pricePoint = part.key.endsWith(":0") ? pricePoints.get(part.sourceRow) : undefined;
        const unitPoint = part.key.endsWith(":0") ? unitPoints.get(part.sourceRow) : undefined;
        const choice = decisions.priceChoices[part.sourceRow];
        return <tr key={part.key}>
          <td>{part.sourceRow}<small>{t.invoicePo(part.sourcePoNumber)}</small></td>
          <td>{part.productCode}<small>{part.description}</small></td>
          <td><input aria-label={t.quantityAria(part.sourceRow)} inputMode="decimal" value={part.quantity}
            onChange={event => setQuantity(part.key, event.target.value.replace(",", "."))} />
            <small>{t.invoiceQuantity(`${formatNumber(part.invoiceQuantity)} ${line.unit}`.trim())}</small></td>
          <td>
            {part.poNumber !== part.sourcePoNumber && <div className="notice success invoice-po-changed" role="status">
              <p>{t.poChanged(part.sourcePoNumber, part.poNumber)}</p>
              <button className="button secondary" type="button" onClick={() => change("poChoices", current =>
                withoutKey(current, part.key))}>{t.keepInvoicePo(part.sourcePoNumber)}</button>
            </div>}
            {allocations.length > 0 && <ul className="invoice-key-items">{allocations.map(({ item, quantity }) =>
              <li key={item.id}>{t.takes(item.poNumber, item.lineNumber, formatNumber(quantity),
                item.unitPrice === null ? "—" : `${formatDecimal(item.unitPrice)} ${item.currency ?? ""}`.trim())}</li>)}</ul>}
            {issue && <div className="notice error" role="alert">
              <p>{issueText(t, issue, part.productCode)}</p>
              {issue.kind === "INSUFFICIENT_BALANCE" && <button className="button secondary" type="button"
                onClick={() => setQuantity(part.key, issue.available)}>
                {t.useBalance(formatNumber(issue.available))}</button>}
              {suggestions.length > 0 && <>
                <p><strong>{t.poSuggestionsTitle}</strong></p>
                <ul className="invoice-suggestions">{suggestions.map(suggestion => <li key={suggestion.poNumber}>
                  <span>{t.poSuggestion(suggestion.poNumber, `${formatNumber(suggestion.available)} ${line.unit}`.trim(),
                    suggestion.ipNumber, suggestion.sourceRows.join(", "))}</span>
                  <button className="button secondary" type="button"
                    onClick={() => change("poChoices", current => ({ ...current, [part.key]: suggestion.poNumber }))}>
                    {t.usePo(suggestion.poNumber)}</button>
                </li>)}</ul>
              </>}
            </div>}
            {(points.length > 0 || pricePoint || unitPoint) && <ul className="invoice-audit-list">
              {points.map(point => <li key={point.kind} className={`notice ${point.confirmed ? "success" : "error"}`}>
                <div className="invoice-audit-title"><strong>{m.newRecord.auditKind[point.kind]}</strong></div>
                <dl className="invoice-audit-values"><dt>{m.newRecord.auditInvoice}</dt><dd>{point.invoiceValue || "—"}</dd>
                  <dt>{t.followUpValue}</dt><dd>{point.poValue || (point.kind === "CODE" ? m.newRecord.codeNotInPo : "—")}</dd></dl>
                {point.kind === "CODE" && !point.confirmed && <>
                  <p className="invoice-audit-note">{t.codeNeedsZero}</p>
                  <div className="button-row"><button className="button secondary" type="button"
                    onClick={() => setQuantity(part.key, "0")}>{t.destineZero}</button></div>
                </>}
                {point === points[points.length - 1] && <>
                  <label className="invoice-audit-confirm"><input type="checkbox" checked={decision.confirmed}
                    onChange={event => setDecision(part.sourceRow, { confirmed: event.target.checked })} />{m.newRecord.confirmQuantity}</label>
                  <label className="invoice-audit-reason">{m.newRecord.quantityReason}<input required minLength={3} maxLength={1000}
                    value={decision.reason} onChange={event => setDecision(part.sourceRow, { reason: event.target.value })} /></label>
                </>}
              </li>)}
              {unitPoint && <li className={`notice ${decisions.unitConfirmed[part.sourceRow] ? "success" : "error"}`}>
                <div className="invoice-audit-title"><strong>{m.newRecord.auditKind.UNIT}</strong></div>
                <dl className="invoice-audit-values"><dt>{m.newRecord.auditInvoice}</dt><dd>{unitPoint.invoiceUnit}</dd>
                  <dt>{t.followUpValue}</dt><dd>{unitPoint.poUnits.join(" · ")}</dd></dl>
                <label className="invoice-audit-confirm"><input type="checkbox" checked={Boolean(decisions.unitConfirmed[part.sourceRow])}
                  onChange={event => { const checked = event.target.checked;
                    change("unitConfirmed", current => ({ ...current, [part.sourceRow]: checked })); }} />
                  {t.confirmUnit(unitPoint.invoiceUnit, unitPoint.poUnits.join(" · "))}</label>
              </li>}
              {pricePoint && <li className={`notice ${invoicePriceChoiceReady(pricePoint, choice) ? "success" : "error"}`}>
                <div className="invoice-audit-title"><strong>{m.newRecord.auditKind.PRICE}</strong></div>
                <dl className="invoice-audit-values"><dt>{m.newRecord.auditInvoice}</dt><dd>{`${formatDecimal(pricePoint.invoicePrice)} CNY`}</dd>
                  <dt>{t.followUpValue}</dt><dd>{pricePoint.poPrices.map(price => `${formatDecimal(price)} CNY`).join(" · ")}</dd>
                  {pricePoint.difference && <><dt>{m.newRecord.auditDifference}</dt><dd>{m.newRecord.priceDifference(
                    pricePoint.difference.percent === null ? null : formatPercentChange(pricePoint.difference.percent),
                    pricePoint.difference.withinTolerance, invoicePriceTolerancePercent)}</dd></>}</dl>
                {!pricePoint.correctable && <p className="invoice-audit-note">{t.priceSeveral}</p>}
                <fieldset className="invoice-audit-choice"><legend>{t.priceChoice}</legend>
                  <label><input type="radio" name={`price-${part.sourceRow}`} checked={choice === "ACCEPT"}
                    onChange={() => change("priceChoices", current => ({ ...current, [part.sourceRow]: "ACCEPT" }))} />{t.acceptPrice}</label>
                  {pricePoint.correctable && <label><input type="radio" name={`price-${part.sourceRow}`} checked={choice === "CORRECT"}
                    onChange={() => change("priceChoices", current => ({ ...current, [part.sourceRow]: "CORRECT" }))} />
                    {t.correctPrice(formatDecimal(pricePoint.poPrices[0]))}</label>}
                </fieldset>
              </li>}
            </ul>}
          </td>
        </tr>;
      })}</tbody>
    </table></div>
    {error && <p className="notice error" role="alert">{error}</p>}
    <p className={`notice ${pending ? "warning" : "success"}`} role="status">{pending ? t.pending(pending) : t.ready}</p>
    <div className="totvs-import-actions"><button className="button" type="button" disabled={!canDownload || reading}
      onClick={() => void download()}>{reading ? t.downloading : t.download}</button></div>
  </>;
}

function withoutKey<K extends string | number, V>(record: Readonly<Partial<Record<K, V>>>, key: K): Record<K, V> {
  const next = { ...record } as Record<K, V>;
  delete next[key];
  return next;
}

function issueText(t: Messages["invoiceAudit"], issue: NonNullable<ReturnType<typeof classifyInvoiceDestination>>, code: string): string {
  if (issue.kind === "INSUFFICIENT_BALANCE") return t.insufficient(formatNumber(issue.requested), formatNumber(issue.available));
  if (issue.kind === "ITEM_NOT_FOUND") return t.codeNotFound(code);
  if (issue.kind === "INVALID_QUANTITY") return t.invalidQuantity;
  if (issue.kind === "PO_NOT_ACTIVE") return t.platform.poNotActive;
  return t.poNotFound;
}

/**
 * NCM and description against the DATABASE, which rules without question (user decision, 2026-11-10): every
 * divergence is corrected in the file and only listed here. An NCM not found in the DATABASE (product out of it or
 * without NCM there) keeps the invoice NCM with a confirmation, or is flagged in the file (user decision, 2026-11-11).
 */
function CatalogAudit({ t, points, missing, missingDecisions, flagged: flaggedRows, onMissing, onFlag }: {
  t: Messages["invoiceAudit"]; points: readonly InvoiceCatalogPoint[]; missing: readonly InvoiceCatalogMissing[];
  missingDecisions: Readonly<Record<number, InvoiceQuantityDecision>>; flagged: Readonly<Partial<Record<number, boolean>>>;
  onMissing: (row: number, change: Partial<InvoiceQuantityDecision>) => void; onFlag: (row: number, flag: boolean) => void;
}) {
  const flagged = missing.filter(entry => flaggedRows[entry.sourceRow]);
  return <section className="notice invoice-catalog" aria-label={t.catalogTitle}>
    <h3>{t.catalogTitle}</h3>
    <p>{t.catalogSummary(points.filter(point => point.field === "ncm").length,
      points.filter(point => point.field === "description").length, missing.length)}</p>
    {points.length > 0 && <details><summary>{t.catalogDetails(points.length)}</summary>
      <div className="totvs-import-table-wrap"><table className="totvs-import-table invoice-catalog-table">
        <thead><tr><th scope="col">{t.catalogColumn.line}</th><th scope="col">{t.catalogColumn.field}</th>
          <th scope="col">{t.catalogColumn.invoice}</th><th scope="col">{t.catalogColumn.database}</th></tr></thead>
        <tbody>{points.map(point => <tr key={point.key}>
          <td>{point.sourceRow}<small>{t.lineProduct(point.lineNumber, point.productCode)}</small></td>
          <td>{t.catalogField[point.field]}{point.caseOnly && <small>{t.caseOnly}</small>}</td>
          <td>{point.invoiceValue || "—"}</td><td>{point.databaseValue}</td>
        </tr>)}</tbody>
      </table></div>
    </details>}
    {flagged.length > 0 && <p className="notice warning" role="status">{t.ncmFlagNotice}</p>}
    {missing.length > 0 && <ul className="invoice-audit-list">{missing.map(entry => {
      const decision = missingDecisions[entry.sourceRow] ?? noDecision;
      const isFlagged = Boolean(flaggedRows[entry.sourceRow]);
      return <li key={entry.sourceRow}
        className={`notice ${isFlagged || invoiceQuantityDecisionReady(decision) ? "success" : "error"}`}>
        <p>{entry.reason === "NO_NCM" ? t.noNcmInDatabase(entry.sourceRow, entry.lineNumber, entry.productCode)
          : t.notInDatabase(entry.sourceRow, entry.lineNumber, entry.productCode)}</p>
        {isFlagged ? <>
          <p className="invoice-audit-note">{t.ncmFlaggedNote}</p>
          <div className="button-row"><button className="button secondary" type="button"
            onClick={() => onFlag(entry.sourceRow, false)}>{t.undoFlagNcm}</button></div>
        </> : <>
          <label className="invoice-audit-confirm"><input type="checkbox" checked={decision.confirmed}
            onChange={event => onMissing(entry.sourceRow, { confirmed: event.target.checked })} />{t.confirmNotInDatabase}</label>
          <label className="invoice-audit-reason">{t.reason}<input required minLength={3} maxLength={1000} value={decision.reason}
            onChange={event => onMissing(entry.sourceRow, { reason: event.target.value })} /></label>
          <div className="button-row"><button className="button secondary" type="button"
            onClick={() => onFlag(entry.sourceRow, true)}>{t.flagNcm}</button></div>
        </>}
      </li>;
    })}</ul>}
  </section>;
}
