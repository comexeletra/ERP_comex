"use client";

import type { ReactNode } from "react";
import type { ChinaInvoiceDraft } from "../lib/china-invoice-xlsx";
import { invoiceConferenceTotals, invoiceLineChecks, InvoicePackingDivergence, InvoiceQuantityDecision, invoiceQuantityDecisionReady,
  invoiceValueByPo } from "../lib/china-invoice-mapping";
import { formatDecimal, formatNumber, formatPercentChange } from "../lib/format-number";
import { useI18n } from "./I18nProvider";

type ValuePart = { quantity: string; invoicePrice: string; poPrice: string | null; poCurrency: string | null };

/** A signed difference with every decimal it has: a gap of 0,0001 kg must not read as 0,00. */
function signed(value: string): string {
  return value.startsWith("-") ? `−${formatDecimal(value.slice(1))}` : `+${formatDecimal(value)}`;
}

/**
 * Conference of the quantities, weights and totals of the invoice, shown to the analyst during the audit
 * (user decision, 2026-11-10). Nothing of it is saved in the IP; the INV × PKL divergences wait for the
 * analyst's confirmation and reason, which go with the invoice metadata.
 */
export default function InvoiceConference({ draft, valueParts, divergences, decisions, onDecision, decisionReady, renderDecision }: {
  draft: ChinaInvoiceDraft; valueParts: readonly ValuePart[]; divergences: readonly InvoicePackingDivergence[];
  decisions: Readonly<Record<string, InvoiceQuantityDecision>>;
  onDecision: (key: string, change: Partial<InvoiceQuantityDecision>) => void;
  /** The invoice audit page decides each divergence with its own controls (keep the INV or take the PKL). */
  decisionReady?: (divergence: InvoicePackingDivergence) => boolean;
  renderDecision?: (divergence: InvoicePackingDivergence) => ReactNode;
}) {
  const { m } = useI18n();
  const t = m.newRecord.conference;
  const packing = draft.packingList.status === "READ" ? draft.packingList : null;
  const totals = invoiceConferenceTotals(draft.lines, draft.declaredTotals, packing?.totals ?? null);
  const checks = invoiceLineChecks(draft.lines);
  const value = invoiceValueByPo(valueParts);
  const status = (shown: string | null, difference: string | null, matches: boolean | null) => shown === null
    ? <span className="badge badge-sm badge-danger">{t.notRead}</span>
    : <>{formatNumber(shown)}{" "}<span className={`badge badge-sm ${matches ? "badge-success" : "badge-danger"}`}>
      {matches ? t.matches : t.differs(signed(difference ?? "0"))}</span></>;
  return <section className="notice invoice-conference" aria-label={t.title}>
    <h3>{t.title}</h3>
    <p className="muted">{t.intro}</p>
    <div className="totvs-import-table-wrap"><table className="totvs-import-table invoice-conference-table">
      <thead><tr><th scope="col">{t.column.measure}</th><th scope="col">{t.column.lines}</th>
        <th scope="col">{t.column.declared}</th><th scope="col">{t.column.packing}</th></tr></thead>
      <tbody>{totals.map(row => <tr key={row.measure}>
        <th scope="row">{t.measure[row.measure]}</th><td>{formatNumber(row.lines)}</td>
        <td>{status(row.declared, row.declaredDifference, row.declaredMatches)}</td>
        <td>{row.measure === "amount" || !packing ? "—" : status(row.packing, row.packingDifference, row.packingMatches)}</td>
      </tr>)}</tbody>
    </table></div>
    <ul className="invoice-conference-checks">
      <li>{t.lineTotals(checks.lines - checks.totalFailures.length, checks.lines)}
        {checks.totalFailures.length > 0 && <> {t.failedRows(checks.totalFailures.join(", "))}</>}</li>
      <li>{t.lineWeights(checks.lines - checks.weightFailures.length, checks.lines)}
        {checks.weightFailures.length > 0 && <> {t.failedRows(checks.weightFailures.join(", "))}</>}</li>
      <li>{draft.packingList.status === "MISSING" ? t.packingMissing : draft.packingList.status === "UNREADABLE" ? t.packingUnreadable
        : <>{t.packing(packing?.packages ? formatDecimal(packing.packages) : "—", packing?.volumeCbm ? formatDecimal(packing.volumeCbm) : "—")}
          {divergences.length === 0 && <> {t.packingMatches(draft.lines.length)}</>}</>}</li>
      <li>{value.counted === 0 ? t.valueNone : t.value(formatNumber(value.invoiceValue), formatNumber(value.poValue),
        signed(value.difference), value.percent === null ? null : formatPercentChange(value.percent))}
        {value.excluded > 0 && <> {t.valueExcluded(value.excluded)}</>}</li>
    </ul>
    {divergences.length > 0 && <section className="invoice-audit" aria-label={t.divergencesTitle(divergences.length)}>
      <header className="invoice-audit-header"><strong>{t.divergencesTitle(divergences.length)}</strong></header>
      <ul className="invoice-audit-list">{divergences.map(divergence => {
        const decision = decisions[divergence.key] ?? { confirmed: false, reason: "" };
        const ready = decisionReady ? decisionReady(divergence) : invoiceQuantityDecisionReady(decision);
        return <li key={divergence.key} className={`notice ${ready ? "success" : "error"}`}>
          <div className="invoice-audit-title"><strong>{t.divergenceLine(divergence.lineNumber, divergence.invoiceRow, divergence.packingRow)}</strong>
            <span className={`badge badge-sm ${ready ? "badge-success" : "badge-danger"}`}>{ready ? t.confirmed : t.pending}</span></div>
          <table className="invoice-compare-table">
            <thead><tr><th scope="col">{t.divergenceColumn.field}</th><th scope="col">{t.divergenceColumn.invoice}</th>
              <th scope="col">{t.divergenceColumn.packing}</th></tr></thead>
            <tbody>{(["quantity", "netWeightKg", "grossWeightKg"] as const).map(field => <tr key={field}
              className={divergence.fields.includes(field) ? "invoice-compare-differs" : undefined}>
              <th scope="row">{t.field[field]}</th>
              <td>{divergence.invoice ? formatDecimal(divergence.invoice[field]) : t.onlyPacking}</td>
              <td>{divergence.packing ? formatDecimal(divergence.packing[field]) : t.onlyInvoice}</td>
            </tr>)}</tbody>
          </table>
          {renderDecision ? renderDecision(divergence) : <>
            <label className="invoice-audit-confirm"><input type="checkbox" checked={decision.confirmed}
              onChange={event => onDecision(divergence.key, { confirmed: event.target.checked })} />{t.confirm}</label>
            <label className="invoice-audit-reason">{t.reason}<input required minLength={3} maxLength={1000} value={decision.reason}
              onChange={event => onDecision(divergence.key, { reason: event.target.value })} /></label>
          </>}
        </li>;
      })}</ul>
    </section>}
  </section>;
}
