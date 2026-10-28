"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { formatCount } from "../lib/format-count";
import { identityStatusLabel, statusLabel } from "../lib/i18n/labels";
import { getMessages, useI18n } from "./I18nProvider";
import PageHeader from "./PageHeader";

// Sheet names of the historical spreadsheet, used as filter values in the source audit.
const preShipmentSheet = "Pré Embarque"; // i18n-ignore: data value
const postShipmentSheet = "Pós Embarque"; // i18n-ignore: data value

type MetricSet = {
  totalRecords: number; historicalRecords: number; newRecords: number;
  operationalItems?: number; allocatedItems?: number; unallocatedItems?: number; openRecords?: number;
  rowsWithArrival?: number; rowsWithDelivery?: number; rowsWithDuimp?: number;
  rowsWithAdditionalCosts?: number;
  statuses: Array<{ status: string; count: number }>;
};
type ReportsSummary = { preShipment?: MetricSet; postShipment?: MetricSet };
type ReportScope = "pre" | "post";

function Metric({ label, value }: { label: string; value: number | undefined }) {
  return <div className="metric"><span>{label}</span><strong>{value === undefined ? "…" : formatCount(value)}</strong></div>;
}

function StatusList({ items, label }: { items: MetricSet["statuses"]; label: (status: string) => string }) {
  const { m } = useI18n();
  const peak = Math.max(1, ...items.map(item => item.count));
  if (!items.length) return <p className="muted">{m.reports.noStatuses}</p>;
  return <ul className="report-status-list">{items.map(item => <li key={item.status}>
    <div><span>{label(item.status)}</span><strong>{formatCount(item.count)}</strong></div>
    <span className="report-status-track" aria-hidden="true"><span style={{ width: `${Math.max(2, item.count / peak * 100)}%` }} /></span>
  </li>)}</ul>;
}

export default function ReportsView({ scope }: { scope: ReportScope }) {
  const { m } = useI18n();
  const t = m.reports;
  const [summary, setSummary] = useState<ReportsSummary>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch(`/api/v1/reports/summary?scope=${scope}`, { signal: controller.signal })
      .then(async response => {
        const text = getMessages();
        if (response.status === 401) throw new Error(text.common.sessionExpired);
        if (response.status === 403) throw new Error(text.reports.forbidden);
        if (!response.ok) throw new Error(text.reports.loadFailed);
        return await response.json() as ReportsSummary;
      })
      .then(data => { if (!controller.signal.aborted) { setSummary(data); setError(""); } })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : getMessages().common.unexpectedError);
      });
    return () => controller.abort();
  }, [retry, scope]);

  return <main className="shell">
    <PageHeader eyebrow={t.eyebrow} title={scope === "pre" ? t.pre : t.post}><p>{t.intro}</p></PageHeader>
    <nav className="tabs" aria-label={t.scopeTabs}>
      <Link className={scope === "pre" ? "tab active" : "tab"} aria-current={scope === "pre" ? "page" : undefined} href="/reports/pre">{t.pre}</Link>
      <Link className={scope === "post" ? "tab active" : "tab"} aria-current={scope === "post" ? "page" : undefined} href="/reports/post">{t.post}</Link>
    </nav>

    {error && <div className="notice error" role="alert"><p>{error}</p>
      <button className="button" onClick={() => { setError(""); setRetry(value => value + 1); }}>{m.common.retry}</button></div>}

    {scope === "pre" && <section className="report-section" aria-labelledby="pre-report-title">
      <div className="report-section-heading"><div><p className="eyebrow">{t.step1}</p><h2 id="pre-report-title">{t.pre}</h2>
        <p className="muted">{t.preHelp}</p></div>
        <div className="report-actions"><Link className="button secondary" href={`/source-audit?sheet=${encodeURIComponent(preShipmentSheet)}`}>{t.fullSheet}</Link>
          <Link className="button" href="/">{t.operationalPos}</Link></div>
      </div>
      <div className="metric-grid">
        <Metric label={t.posInScope} value={summary?.preShipment?.totalRecords} />
        <Metric label={t.historicalPos} value={summary?.preShipment?.historicalRecords} />
        <Metric label={t.newPos} value={summary?.preShipment?.newRecords} />
        <Metric label={t.operationalItems} value={summary?.preShipment?.operationalItems} />
        <Metric label={t.allocatedItems} value={summary?.preShipment?.allocatedItems} />
        <Metric label={t.unallocatedItems} value={summary?.preShipment?.unallocatedItems} />
      </div>
      <section className="card report-status-card"><h3>{t.poIdentification}</h3>
        <StatusList items={summary?.preShipment?.statuses ?? []} label={status => identityStatusLabel(m, status)} /></section>
    </section>}

    {scope === "post" && <section className="report-section" aria-labelledby="post-report-title">
      <div className="report-section-heading"><div><p className="eyebrow">{t.step2}</p><h2 id="post-report-title">{t.post}</h2>
        <p className="muted">{t.postHelp}</p></div>
        <div className="report-actions"><Link className="button secondary" href={`/source-audit?sheet=${encodeURIComponent(postShipmentSheet)}`}>{t.fullSheet}</Link>
          <Link className="button" href="/processes">{t.operationalIps}</Link></div>
      </div>
      <div className="metric-grid">
        <Metric label={t.ipsInScope} value={summary?.postShipment?.totalRecords} />
        <Metric label={t.historicalIps} value={summary?.postShipment?.historicalRecords} />
        <Metric label={t.newIps} value={summary?.postShipment?.newRecords} />
        <Metric label={t.openProcesses} value={summary?.postShipment?.openRecords} />
        <Metric label={t.withArrival} value={summary?.postShipment?.rowsWithArrival} />
        <Metric label={t.withDuimp} value={summary?.postShipment?.rowsWithDuimp} />
        <Metric label={t.withDelivery} value={summary?.postShipment?.rowsWithDelivery} />
        <Metric label={t.withCosts} value={summary?.postShipment?.rowsWithAdditionalCosts} />
      </div>
      <section className="card report-status-card"><h3>{t.processStatuses}</h3>
        <StatusList items={summary?.postShipment?.statuses ?? []} label={status => statusLabel(m, status)} /></section>
    </section>}
  </main>;
}
