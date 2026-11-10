"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { parseChinaInvoiceXlsx, type ChinaInvoiceDraft } from "../lib/china-invoice-xlsx";
import { classifyInvoiceDestination, distributeInvoiceParts, invoiceAssignmentsFromLines, InvoiceAuditPoint, invoiceCodePoint,
  invoiceKeyItems, InvoiceLinePricePoint, invoiceLinePricePoint, InvoicePackingChoice, invoicePackingChoiceReady,
  invoicePackingChoiceWeights, invoicePackingDivergences, InvoicePriceChoice, invoicePriceChoiceReady, invoicePriceTolerancePercent,
  InvoiceQuantityDecision, invoiceQuantityPoint, invoiceSupplierMismatches } from "../lib/china-invoice-mapping";
import { followUpCandidates, followUpImporters, followUpSameIps, parseFollowUpXlsx, type FollowUpCandidate,
  type FollowUpWorkbook } from "../lib/follow-up-po-xlsx";
import { invoiceCorrectedTotals, invoiceLineCorrections, writeCorrectedInvoice } from "../lib/invoice-correction-xlsx";
import { formatDecimal, formatNumber, formatPercentChange } from "../lib/format-number";
import type { Messages } from "../lib/i18n/pt-BR";
import { getMessages, useI18n } from "./I18nProvider";
import InvoiceConference from "./InvoiceConference";
import PageHeader from "./PageHeader";

const allowedRoles = new Set(["Master", "Administrador", "Importação", "Compras"]); // i18n-ignore: role values from the API
const auditSheetName = "AUDITORIA"; // i18n-ignore: sheet name kept in Portuguese, like the INV and PKL sheets
const noDecision: InvoiceQuantityDecision = { confirmed: false, reason: "" };
type LoadedInvoice = { draft: ChinaInvoiceDraft; bytes: ArrayBuffer };

function columnLetter(index: number): string {
  let letters = "";
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) letters = String.fromCharCode(65 + (value - 1) % 26) + letters;
  return letters;
}

/**
 * Invoice audit against the Follow Up in use, with no table and no load (user decision, 2026-11-10): both files
 * are read in the browser, nothing is saved, and the result is the invoice file corrected with the decisions.
 */
export default function InvoiceAuditWorkbench() {
  const { m } = useI18n();
  const t = m.invoiceAudit;
  const [identity, setIdentity] = useState<{ roles: string[]; name: string } | null>(null);
  const [invoice, setInvoice] = useState<LoadedInvoice | null>(null);
  const [followUp, setFollowUp] = useState<FollowUpWorkbook | null>(null);
  const [reading, setReading] = useState<"" | "invoice" | "followUp" | "download">("");
  const [error, setError] = useState("");
  const [importerChoice, setImporterChoice] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [quantityDecisions, setQuantityDecisions] = useState<Record<number, InvoiceQuantityDecision>>({});
  const [priceChoices, setPriceChoices] = useState<Record<number, InvoicePriceChoice>>({});
  const [supplierConfirmed, setSupplierConfirmed] = useState<Record<string, boolean>>({});
  const [packingChoices, setPackingChoices] = useState<Record<string, InvoicePackingChoice>>({});

  useEffect(() => {
    apiFetch("/auth/me").then(async response => {
      if (!response.ok) throw new Error(getMessages().common.unexpectedError);
      const user = await response.json() as { roles: string[]; user: { displayName: string | null } };
      setIdentity({ roles: user.roles, name: user.user.displayName ?? "" });
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : getMessages().common.unexpectedError));
  }, []);

  function resetDecisions() {
    setQuantities({}); setQuantityDecisions({}); setPriceChoices({}); setSupplierConfirmed({}); setPackingChoices({});
  }

  async function selectInvoice(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
    if (!file) return;
    setError(""); setReading("invoice"); setInvoice(null); resetDecisions();
    try { setInvoice({ draft: await parseChinaInvoiceXlsx(file, getMessages()), bytes: await file.arrayBuffer() }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : getMessages().common.unexpectedError); }
    finally { setReading(""); }
  }

  async function selectFollowUp(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
    if (!file) return;
    setError(""); setReading("followUp"); setFollowUp(null); setImporterChoice(""); resetDecisions();
    try { setFollowUp(await parseFollowUpXlsx(file, getMessages())); }
    catch (cause) { setError(cause instanceof Error ? cause.message : getMessages().common.unexpectedError); }
    finally { setReading(""); }
  }

  const draft = invoice?.draft ?? null;
  const baseParts = draft ? invoiceAssignmentsFromLines(draft.lines) : [];
  const importers = followUp ? followUpImporters(followUp.lines, baseParts.map(part => part.poNumber)) : [];
  const importer = importers.length === 1 ? importers[0] : importers.includes(importerChoice) ? importerChoice : "";
  const ready = Boolean(draft && followUp && importer);
  const parts = ready ? baseParts.map(part => {
    const { poExists, items } = followUpCandidates(followUp!.lines, importer, part.poNumber, draft!.ipNumber);
    return { ...part, invoiceQuantity: part.quantity, quantity: quantities[part.key] ?? part.quantity, poExists,
      keyItems: invoiceKeyItems(items, part.productCode) };
  }) : [];
  const distribution = distributeInvoiceParts(parts.map(part => ({ key: part.key, quantity: part.quantity, items: part.keyItems })));
  const rows = parts.map(part => {
    const line = draft!.lines.find(entry => entry.sourceRow === part.sourceRow)!;
    const decision = quantityDecisions[part.sourceRow] ?? noDecision;
    const partDistribution = distribution.get(part.key);
    const allocations = (partDistribution?.allocations ?? []).flatMap(allocation => {
      const item = part.keyItems.find(candidate => candidate.id === allocation.itemId);
      return item ? [{ item, quantity: allocation.quantity }] : [];
    });
    const points = [invoiceQuantityPoint(part.invoiceQuantity, part.quantity, line.unit, decision),
      invoiceCodePoint(part.productCode, !part.poExists || part.keyItems.length > 0, part.quantity, decision)]
      .filter((point): point is InvoiceAuditPoint => point !== null);
    return { part, line, decision, allocations, points,
      issue: classifyInvoiceDestination(part.keyItems, part.poExists, part.quantity, partDistribution) };
  });
  const allocatedItems = rows.flatMap(row => row.allocations.map(allocation => allocation.item));
  const pricePoints = new Map<number, InvoiceLinePricePoint>();
  for (const line of draft?.lines ?? []) {
    const items = rows.filter(row => row.part.sourceRow === line.sourceRow).flatMap(row => row.allocations.map(entry => entry.item));
    const point = invoiceLinePricePoint(line.unitPrice, items);
    if (point) pricePoints.set(line.sourceRow, point);
  }
  const supplierMismatches = draft ? invoiceSupplierMismatches(draft.exporterText, allocatedItems.map(item => item.supplier)) : [];
  const divergences = draft?.packingList.status === "READ" ? invoicePackingDivergences(draft.lines, draft.packingList.lines) : [];
  const pending = rows.filter(row => row.issue !== null).length
    + rows.reduce((total, row) => total + row.points.filter(point => point.confirmed === false).length, 0)
    + [...pricePoints].filter(([row, point]) => !invoicePriceChoiceReady(point, priceChoices[row])).length
    + supplierMismatches.filter(supplier => !supplierConfirmed[supplier]).length
    + divergences.filter(divergence => !invoicePackingChoiceReady(divergence, packingChoices[divergence.key])).length;
  const canDownload = ready && pending === 0 && rows.some(row => row.allocations.length > 0);
  const sameIps = ready ? followUpSameIps(followUp!.lines, draft!.ipNumber) : [];

  async function download() {
    if (!invoice || !followUp || !canDownload) return;
    setError(""); setReading("download");
    const messages = getMessages();
    try {
      const prices = Object.fromEntries([...pricePoints].filter(([row]) => priceChoices[row] === "CORRECT")
        .map(([row, point]) => [row, point.poPrices[0]]));
      const corrections = invoiceLineCorrections(invoice.draft.lines,
        rows.map(row => ({ sourceRow: row.part.sourceRow, poNumber: row.part.poNumber, quantity: row.part.quantity })),
        prices, invoicePackingChoiceWeights(divergences, packingChoices));
      const written = await writeCorrectedInvoice(invoice.bytes, invoice.draft.layout, corrections, invoiceCorrectedTotals(corrections),
        auditSheet(messages, { draft: invoice.draft, followUp, importer, sameIps, rows, pricePoints, priceChoices, supplierMismatches,
          divergences, packingChoices, corrections, user: identity?.name ?? "" }), messages.invoiceAudit.noteOriginal);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([written], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      link.download = `${invoice.draft.fileName.replace(/\.xlsx$/iu, "")} - ${messages.invoiceAudit.fileSuffix}.xlsx`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (cause) { setError(cause instanceof Error ? cause.message : messages.common.unexpectedError); }
    finally { setReading(""); }
  }

  const setDecision = (sourceRow: number, change: Partial<InvoiceQuantityDecision>) => setQuantityDecisions(current =>
    ({ ...current, [sourceRow]: { ...(current[sourceRow] ?? noDecision), ...change } }));
  const allowed = identity ? identity.roles.some(role => allowedRoles.has(role)) : false;

  return <main className="shell">
    <PageHeader eyebrow={t.eyebrow} title={t.title}><p>{t.description}</p></PageHeader>
    {error && <p className="notice error" role="alert">{error}</p>}
    {identity && !allowed && <p className="notice warning">{t.noPermission}</p>}
    {allowed && <section className="card invoice-audit-page">
      <div className="operational-fields invoice-audit-files">
        <label>{t.invoiceFile}<input type="file" accept=".xlsx" disabled={Boolean(reading)} onChange={event => void selectInvoice(event)} /></label>
        <label>{t.followUpFile}<input type="file" accept=".xlsx" disabled={Boolean(reading)} onChange={event => void selectFollowUp(event)} /></label>
      </div>
      {reading && reading !== "download" && <p role="status">{t.reading}</p>}
      {draft && <p className="notice invoice-summary" role="status">{t.invoiceRead(draft.fileName, draft.lines.length, draft.ipNumber)}</p>}
      {followUp && <p className="muted">{t.followUpRead(followUp.fileName, followUp.lines.length, followUp.cancelled)}</p>}
      {draft && followUp && importers.length === 0 && <p className="notice error" role="alert">{t.noImporter}</p>}
      {draft && followUp && importers.length > 1 && <label className="invoice-audit-importer">{t.importer}
        <select value={importer} onChange={event => { setImporterChoice(event.target.value); resetDecisions(); }}>
          <option value="">{t.chooseImporter}</option>
          {importers.map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>}
      {ready && <>
        <p className="muted">{t.importerShown(importer, draft!.importerCnpj || t.notIdentified)}</p>
        <p className="muted">{sameIps.length ? t.sameIps(sameIps.join(", ")) : t.noSameIp}</p>
        {draft!.warnings.map(warning => <p className="notice warning" key={warning}>{warning}</p>)}
        <InvoiceConference draft={draft!} divergences={divergences} decisions={{}} onDecision={() => undefined}
          valueParts={rows.flatMap(row => row.allocations.map(allocation => ({ quantity: allocation.quantity,
            invoicePrice: row.line.unitPrice, poPrice: allocation.item.unitPrice, poCurrency: allocation.item.currency })))}
          decisionReady={divergence => invoicePackingChoiceReady(divergence, packingChoices[divergence.key])}
          renderDecision={divergence => {
            const choice = packingChoices[divergence.key] ?? { source: null, reason: "" };
            const update = (change: Partial<InvoicePackingChoice>) => setPackingChoices(current =>
              ({ ...current, [divergence.key]: { ...choice, ...change } }));
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
          <p>{t.supplierMismatch(supplier, draft!.exporterText.split(/\r?\n/u)[0])}</p>
          <label className="invoice-audit-confirm"><input type="checkbox" checked={Boolean(supplierConfirmed[supplier])}
            onChange={event => setSupplierConfirmed(current => ({ ...current, [supplier]: event.target.checked }))} />
            {t.confirmSupplier(supplier)}</label>
        </div>)}
        <div className="totvs-import-table-wrap invoice-match-table-wrap"><table className="totvs-import-table invoice-match-table">
          <thead><tr><th>{t.column.line}</th><th>{t.column.product}</th><th>{t.column.quantity}</th><th>{t.column.destination}</th></tr></thead>
          <tbody>{rows.map(({ part, line, decision, allocations, points, issue }) => {
            const pricePoint = part.key.endsWith(":0") ? pricePoints.get(part.sourceRow) : undefined;
            const choice = priceChoices[part.sourceRow];
            return <tr key={part.key}>
              <td>{part.sourceRow}<small>{t.invoicePo(part.sourcePoNumber)}</small></td>
              <td>{part.productCode}<small>{part.description}</small></td>
              <td><input aria-label={t.quantityAria(part.sourceRow)} inputMode="decimal" value={part.quantity}
                onChange={event => setQuantities(current => ({ ...current, [part.key]: event.target.value.replace(",", ".") }))} />
                <small>{t.invoiceQuantity(`${formatNumber(part.invoiceQuantity)} ${line.unit}`.trim())}</small></td>
              <td>
                {allocations.length > 0 && <ul className="invoice-key-items">{allocations.map(({ item, quantity }) =>
                  <li key={item.id}>{t.takes(item.poNumber, item.lineNumber, formatNumber(quantity),
                    item.unitPrice === null ? "—" : `${formatDecimal(item.unitPrice)} ${item.currency ?? ""}`.trim())}</li>)}</ul>}
                {issue && <div className="notice error" role="alert">
                  <p>{issueText(t, issue, part.productCode)}</p>
                  {issue.kind === "INSUFFICIENT_BALANCE" && <button className="button secondary" type="button"
                    onClick={() => setQuantities(current => ({ ...current, [part.key]: issue.available }))}>
                    {t.useBalance(formatNumber(issue.available))}</button>}
                </div>}
                {(points.length > 0 || pricePoint) && <ul className="invoice-audit-list">
                  {points.map(point => <li key={point.kind} className={`notice ${point.confirmed ? "success" : "error"}`}>
                    <div className="invoice-audit-title"><strong>{m.newRecord.auditKind[point.kind]}</strong></div>
                    <dl className="invoice-audit-values"><dt>{m.newRecord.auditInvoice}</dt><dd>{point.invoiceValue || "—"}</dd>
                      <dt>{t.followUpValue}</dt><dd>{point.poValue || (point.kind === "CODE" ? m.newRecord.codeNotInPo : "—")}</dd></dl>
                    {point === points[points.length - 1] && <>
                      <label className="invoice-audit-confirm"><input type="checkbox" checked={decision.confirmed}
                        onChange={event => setDecision(part.sourceRow, { confirmed: event.target.checked })} />{m.newRecord.confirmQuantity}</label>
                      <label className="invoice-audit-reason">{m.newRecord.quantityReason}<input required minLength={3} maxLength={1000}
                        value={decision.reason} onChange={event => setDecision(part.sourceRow, { reason: event.target.value })} /></label>
                    </>}
                  </li>)}
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
                        onChange={() => setPriceChoices(current => ({ ...current, [part.sourceRow]: "ACCEPT" }))} />{t.acceptPrice}</label>
                      {pricePoint.correctable && <label><input type="radio" name={`price-${part.sourceRow}`} checked={choice === "CORRECT"}
                        onChange={() => setPriceChoices(current => ({ ...current, [part.sourceRow]: "CORRECT" }))} />
                        {t.correctPrice(formatDecimal(pricePoint.poPrices[0]))}</label>}
                    </fieldset>
                  </li>}
                </ul>}
              </td>
            </tr>;
          })}</tbody>
        </table></div>
        <p className={`notice ${pending ? "warning" : "success"}`} role="status">{pending ? t.pending(pending) : t.ready}</p>
        <div className="totvs-import-actions"><button className="button" type="button" disabled={!canDownload || Boolean(reading)}
          onClick={() => void download()}>{reading === "download" ? t.downloading : t.download}</button></div>
      </>}
    </section>}
  </main>;
}

function issueText(t: Messages["invoiceAudit"], issue: NonNullable<ReturnType<typeof classifyInvoiceDestination>>, code: string): string {
  if (issue.kind === "INSUFFICIENT_BALANCE") return t.insufficient(formatNumber(issue.requested), formatNumber(issue.available));
  if (issue.kind === "ITEM_NOT_FOUND") return t.codeNotFound(code);
  if (issue.kind === "INVALID_QUANTITY") return t.invalidQuantity;
  return t.poNotFound;
}

type AuditInput = {
  draft: ChinaInvoiceDraft; followUp: FollowUpWorkbook; importer: string; sameIps: string[]; user: string;
  rows: { part: { sourceRow: number; productCode: string; invoiceQuantity: string; quantity: string; poNumber: string };
    line: { lineNumber: string; unit: string }; decision: InvoiceQuantityDecision; points: InvoiceAuditPoint[];
    allocations: { item: FollowUpCandidate; quantity: string }[] }[];
  pricePoints: Map<number, InvoiceLinePricePoint>; priceChoices: Record<number, InvoicePriceChoice>;
  supplierMismatches: string[]; divergences: ReturnType<typeof invoicePackingDivergences>;
  packingChoices: Record<string, InvoicePackingChoice>; corrections: ReturnType<typeof invoiceLineCorrections>;
};

/** The AUDITORIA sheet: the files used and, per invoice line, each point with its decision and the changed cells. */
function auditSheet(m: Messages, input: AuditInput) {
  const s = m.invoiceAudit.sheet;
  const { draft } = input;
  const lineNumber = (row: number | null) => draft.lines.find(line => line.sourceRow === row)?.lineNumber ?? "";
  const columns = draft.layout.columns;
  const columnOf = { quantity: columns.quantity, poCell: columns.poCell, unitPrice: columns.unitPrice,
    netWeightKg: columns.netWeightKg, grossWeightKg: columns.grossWeightKg, amount: columns.amount };
  const cells = (row: number) => input.corrections.find(entry => entry.sourceRow === row)?.changed
    .map(field => `${columnLetter(columnOf[field])}${row}`).join(", ") ?? "";
  const rows: string[][] = [];
  for (const { part, line, decision, points, allocations } of input.rows) {
    rows.push([String(part.sourceRow), line.lineNumber, s.destination, `PO ${part.poNumber} · ${part.productCode}`,
      allocations.map(({ item, quantity }) => s.destinationValue(item.lineNumber, formatNumber(quantity))).join("; ") || "—",
      s.destined(formatNumber(part.quantity)), "", cells(part.sourceRow)]);
    for (const point of points) {
      rows.push([String(part.sourceRow), line.lineNumber, m.newRecord.auditKind[point.kind], point.invoiceValue, point.poValue || "—",
        s.confirmed, decision.reason.trim(), ""]);
    }
  }
  for (const [row, point] of input.pricePoints) {
    rows.push([String(row), lineNumber(row), m.newRecord.auditKind.PRICE, `${point.invoicePrice} CNY`,
      point.poPrices.map(price => `${price} CNY`).join(" · ") + (point.difference?.percent != null
        ? ` (${formatPercentChange(point.difference.percent)})` : ""),
      input.priceChoices[row] === "CORRECT" ? s.corrected : s.accepted, "", ""]);
  }
  for (const supplier of input.supplierMismatches) {
    rows.push(["—", "", m.newRecord.auditKind.SUPPLIER, draft.exporterText.split(/\r?\n/u)[0], supplier, s.confirmed, "", ""]);
  }
  for (const divergence of input.divergences) {
    const choice = input.packingChoices[divergence.key];
    const values = (side: typeof divergence.invoice) => side
      ? divergence.fields.map(field => `${m.newRecord.conference.field[field]} ${side[field]}`).join("; ") : "—";
    rows.push([divergence.invoiceRow === null ? "—" : String(divergence.invoiceRow), divergence.lineNumber, s.packing,
      values(divergence.invoice), values(divergence.packing), choice?.source === "PACKING" ? s.tookPacking : s.keptInvoice,
      choice?.reason.trim() ?? "", ""]);
  }
  for (const correction of input.corrections) {
    if (!correction.destined) rows.push([String(correction.sourceRow), lineNumber(correction.sourceRow), s.notDestined, "", "", s.keptAsCame, "", ""]);
    else if (correction.changed.includes("quantity")) {
      rows.push([String(correction.sourceRow), lineNumber(correction.sourceRow), s.notice, "", "", s.weightsNotRecalculated, "", ""]);
    }
  }
  rows.sort((left, right) => (Number(left[0]) || Number.MAX_SAFE_INTEGER) - (Number(right[0]) || Number.MAX_SAFE_INTEGER));
  return { sheetName: auditSheetName, columns: s.columns, rows, summary: [
    [s.invoice, `${draft.fileName} (SHA-256 ${draft.fileSha256})`], [s.followUp, `${input.followUp.fileName} (SHA-256 ${input.followUp.fileSha256})`],
    [s.ipRef, draft.ipNumber], [s.sameIps, input.sameIps.join(", ") || "—"], [s.importer, input.importer],
    [s.date, new Date().toISOString()], [s.user, input.user], [s.note, s.noteText],
  ] as [string, string][] };
}
