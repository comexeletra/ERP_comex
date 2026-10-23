"use client";

import { formatNumber } from "../lib/format-number";
import { statusLabel } from "../lib/i18n/labels";
import { calculatedStatusLabel, IpCalculatedSummary as Summary, projectedDateLabel } from "../lib/ip-post-shipment-fields";
import { useI18n } from "./I18nProvider";

/** Status and projected dates of one IP; every product line in the IP shows the same values. */
export default function IpCalculatedSummary({ summary }: { summary?: Summary }) {
  const { m } = useI18n();
  const t = m.ipSummary;
  if (!summary) return null;
  return <dl className="followup-grid" aria-label={t.ariaLabel}>
    <div><dt>{t.status}</dt><dd>{calculatedStatusLabel(summary, m)}</dd></div>
    <div><dt>{t.informedStatus}</dt><dd>{summary.informedStatus ? statusLabel(m, summary.informedStatus) : "—"}</dd></div>
    <div><dt>{t.eta}</dt><dd>{projectedDateLabel(summary.eta, summary.etaSource, m)}</dd></div>
    <div><dt>{t.ete}</dt><dd>{projectedDateLabel(summary.ete, summary.eteSource, m)}</dd></div>
    <div><dt>{t.transitDays}</dt><dd>{summary.transitDays == null ? "—" : formatNumber(summary.transitDays)}</dd></div>
    <div><dt>{t.storageDue}</dt><dd>{summary.storageDueDate ?? "—"}</dd></div>
  </dl>;
}
