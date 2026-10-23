"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PageHeader from "../../../components/PageHeader";
import { apiFetch } from "../../../lib/api";
import { getMessages, useI18n } from "../../../components/I18nProvider";
import { formatUsDateTime } from "../../../lib/date-format";

type OutboxSummary = {
  counts: { published: number; deadLettered: number; leased: number;
    retryWaiting: number; ready: number; oldestUnpublishedAt: string | null };
  items: Array<{ id: string; eventType: string; aggregateType: string;
    occurredAt: string; attempts: number; status: string; nextAttemptAt: string | null }>;
};

export default function OutboxPage() {
  const { m } = useI18n();
  const t = m.outbox;
  const [isMaster, setIsMaster] = useState<boolean | null>(null);
  const [accessError, setAccessError] = useState("");
  const [summary, setSummary] = useState<OutboxSummary>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    apiFetch("/auth/me")
      .then(async response => {
        if (!response.ok) throw new Error(getMessages().admin.accessCheckFailed);
        return await response.json() as { roles: string[] };
      })
      .then(identity => { if (active) setIsMaster(identity.roles.includes("Master")); })
      .catch(cause => {
        if (active) setAccessError(cause instanceof Error ? cause.message : getMessages().common.unexpectedError);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (isMaster !== true) return;
    const controller = new AbortController();
    setLoading(true);
    apiFetch("/api/v1/admin/outbox", { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(getMessages().outbox.loadFailed);
        return await response.json() as OutboxSummary;
      })
      .then(data => { if (!controller.signal.aborted) { setSummary(data); setError(""); } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : getMessages().common.unexpectedError); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [isMaster, revision]);

  if (isMaster === null) return <main className="shell">
    <p className={accessError ? "notice error" : "muted"} role={accessError ? "alert" : "status"}>
      {accessError || m.admin.checkingAccess}
    </p>
    {accessError && <Link className="text-link" href="/">{m.admin.backToPortfolio}</Link>}
  </main>;

  if (!isMaster) return <main className="shell">
    <PageHeader eyebrow={m.admin.eyebrow} title={t.title} />
    <p className="notice warning">{m.admin.masterOnly}</p>
  </main>;

  return <main className="shell">
    <PageHeader eyebrow={m.admin.eyebrow} title={t.title}><p>{t.intro}</p></PageHeader>
    <section className="card" aria-live="polite">
      <button className="button secondary" type="button" disabled={loading}
        onClick={() => { setLoading(true); setRevision(value => value + 1); }}>{t.refresh}</button>
      {loading && <p role="status">{t.loading}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {summary && <>
        <div className="metric-grid">
          <div className="metric"><span>{t.ready}</span><strong>{summary.counts.ready}</strong></div>
          <div className="metric"><span>{t.retryWaiting}</span><strong>{summary.counts.retryWaiting}</strong></div>
          <div className="metric"><span>{t.leased}</span><strong>{summary.counts.leased}</strong></div>
          <div className="metric"><span>{t.deadLettered}</span><strong>{summary.counts.deadLettered}</strong></div>
          <div className="metric"><span>{t.published}</span><strong>{summary.counts.published}</strong></div>
        </div>
        <p className="muted">{t.oldest(summary.counts.oldestUnpublishedAt
          ? formatUsDateTime(summary.counts.oldestUnpublishedAt) : t.noneOldest)}</p>
        <p className="muted">{t.noConsumer}</p>
        <h2>{t.listTitle}</h2>
        {summary.items.length === 0 ? <p>{t.empty}</p>
          : <div className="table-scroll"><table>
            <thead><tr><th>{t.occurredAt}</th><th>{t.event}</th><th>{t.entity}</th><th>{t.status}</th><th>{t.attempts}</th><th>{t.nextAttempt}</th></tr></thead>
            <tbody>{summary.items.map(item => <tr key={item.id}>
              <td>{formatUsDateTime(item.occurredAt)}</td><td>{item.eventType}</td>
              <td>{item.aggregateType}</td><td>{(t.statuses as Record<string, string>)[item.status] ?? item.status}</td>
              <td>{item.attempts}</td><td>{item.nextAttemptAt ? formatUsDateTime(item.nextAttemptAt) : "—"}</td>
            </tr>)}</tbody>
          </table></div>}
      </>}
    </section>
  </main>;
}
