import { formatNumber } from "../lib/format-number";
import { calculatedStatusLabel, IpCalculatedSummary as Summary, projectedDateLabel } from "../lib/ip-post-shipment-fields";

/** Status and projected dates of one IP; every product line in the IP shows the same values. */
export default function IpCalculatedSummary({ summary }: { summary?: Summary }) {
  if (!summary) return null;
  return <dl className="followup-grid" aria-label="Situação calculada do IP">
    <div><dt>Status</dt><dd>{calculatedStatusLabel(summary)}</dd></div>
    <div><dt>Status informado</dt><dd>{summary.informedStatus ?? "—"}</dd></div>
    <div><dt>ETA</dt><dd>{projectedDateLabel(summary.eta, summary.etaSource)}</dd></div>
    <div><dt>ETE</dt><dd>{projectedDateLabel(summary.ete, summary.eteSource)}</dd></div>
    <div><dt>Trânsito previsto (dias)</dt><dd>{summary.transitDays == null ? "—" : formatNumber(summary.transitDays)}</dd></div>
    <div><dt>Vencimento da armazenagem</dt><dd>{summary.storageDueDate ?? "—"}</dd></div>
  </dl>;
}
