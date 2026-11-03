"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { formatUsDateTime } from "../../lib/date-format";
import { canResolveQuality } from "../../lib/quality-permissions";
import { qualityEvidenceFields, qualityIssueText, qualityOutcomeLabel, qualityResolutionPayload, qualitySeverityLabel,
  qualityStatusLabel } from "../../lib/quality-issues";
import { getMessages, useI18n } from "../../components/I18nProvider";
import PageHeader from "../../components/PageHeader";
import { SearchableSelect } from "../../components/SearchableSelect";

type Review = { id: string; outcome: string; reviewer: string; notes: string; evidence: Record<string, unknown>; proposedPurchaseOrder?: string; proposedIpNumber?: string; recordedAt: string };
type QualityLinks = { purchaseOrderId?: string; processId?: string };
type QualityItem = { id: string; sourceRowId: string; code: string; severity: string; status: string; evidence: Record<string, unknown>; fieldName?: string; sheetName?: string; sourceRowNumber?: number; sourceValues: Record<string, unknown>; sourceColumnHeaders: Record<string, string>; links?: QualityLinks; latestReview?: Review; reviewHistory?: Review[] };
type QualityPageData = { page: number; pageSize: number; totalCount: number; openCount: number; resolvedCount: number; countsByCode?: Array<{ code: string; count: number }>; items: QualityItem[] };

export default function QualityPage() {
  const { m } = useI18n();
  const t = m.quality;
  const [data, setData] = useState<QualityPageData>();
  const [roles, setRoles] = useState<string[]>();
  const [status, setStatus] = useState("open");
  const [code, setCode] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string>();
  const [reviewing, setReviewing] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>();

  const load = () => {
    setError(undefined);
    setRoles(undefined);
    const query = new URLSearchParams({ status, pageSize: "50" });
    if (code) query.set("code", code);
    if (search.trim()) query.set("search", search.trim());
    return Promise.all([
      apiFetch("/auth/me"), apiFetch("/api/v1/data-issues?" + query.toString()),
    ])
      .then(async ([identityResponse, response]) => {
        if (!identityResponse.ok) throw new Error(getMessages().common.sessionExpired);
        const identity = await identityResponse.json() as { roles: string[] };
        setRoles(identity.roles);
        if (!response.ok) {
          throw new Error(response.status === 403 ? getMessages().quality.noAccess : getMessages().quality.loadFailed);
        }
        setData(await response.json() as QualityPageData);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : getMessages().common.unexpectedError));
  };
  useEffect(() => { void load(); }, [status, code]);
  function applyFilter(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void load(); }
  async function submitReview(item: QualityItem, form: HTMLFormElement) {
    if (!canResolveQuality(roles ?? [])) return;
    const fields = new FormData(form);
    setSubmitting(true);
    try {
      const response = await apiFetch(`/api/v1/data-issues/${item.id}/resolve`, {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey ?? crypto.randomUUID() },
        body: JSON.stringify(qualityResolutionPayload({ reference: String(fields.get("reference") ?? ""),
          reason: String(fields.get("reason") ?? ""), proposedPurchaseOrder: String(fields.get("proposedPurchaseOrder") ?? ""),
          proposedIpNumber: String(fields.get("proposedIpNumber") ?? "") })),
      });
      if (!response.ok) { setError(getMessages().quality.notRecorded); return; }
      setReviewing(undefined); setIdempotencyKey(undefined); await load();
    } catch {
      setError(getMessages().quality.recordFailed);
    } finally {
      setSubmitting(false);
    }
  }

  const counts = data?.countsByCode ?? [];
  return <main className="shell">
    <PageHeader eyebrow={t.eyebrow} title={t.title}><p>{t.intro}</p></PageHeader>
    {error && <p className="notice error">{error}</p>}
    {roles && !canResolveQuality(roles) && <p className="notice">{t.readOnly}</p>}
    <section className="metric-grid" aria-label={t.summary}><Metric label={t.open} value={data?.openCount ?? "…"} /><Metric label={t.resolved} value={data?.resolvedCount ?? "…"} /><Metric label={t.inFilter} value={data?.totalCount ?? "…"} /></section>
    {counts.length > 0 && <section className="card quality-type-summary" aria-label={t.byType}>
      <h2>{t.byType}</h2>
      <div>{counts.map(entry => <button type="button" className="quality-type-chip" key={entry.code} aria-pressed={code === entry.code}
        onClick={() => setCode(code === entry.code ? "" : entry.code)}>
        {t.typeCount(qualityIssueText(m, entry.code).title, entry.count)}</button>)}</div>
    </section>}
    <section className="card"><form className="quality-filter" onSubmit={applyFilter}>
      <label>{t.status}<SearchableSelect ariaLabel={t.status} placeholder="" value={status} onChange={setStatus}
        options={[{ value: "open", label: t.statusOpen }, { value: "resolved", label: t.statusResolved }, { value: "all", label: t.statusAll }]} /></label>
      <label>{t.type}<SearchableSelect ariaLabel={t.type} placeholder={t.allTypes} value={code} onChange={setCode}
        options={[{ value: "", label: t.allTypes }, ...counts.map(entry => ({ value: entry.code, label: qualityIssueText(m, entry.code).title }))]} /></label>
      <label>{t.search}<input value={search} maxLength={80} onChange={event => setSearch(event.target.value)} placeholder={t.searchPlaceholder} /></label>
      <button className="button" type="submit">{t.filter}</button>
    </form></section>
    {!data && !error && <p role="status">{t.loading}</p>}
    {data?.items.length === 0 && <section className="card"><p>{t.none}</p></section>}
    {data?.items.map(item => {
      const info = qualityIssueText(m, item.code);
      const fields = qualityEvidenceFields(m, item.evidence);
      const reviews = item.reviewHistory?.length ? item.reviewHistory : item.latestReview ? [item.latestReview] : [];
      return <details className="card quality-item" key={item.id}>
        <summary className="quality-summary"><span><small>{t.row(item.sheetName ?? t.sourceUnavailable, String(item.sourceRowNumber ?? "--"))}</small>
          <strong>{info.title}</strong>{fields.length > 0 && <small>{fields.slice(0, 3).map(field => `${field.label}: ${field.value}`).join(" · ")}</small>}</span>
          <span className={item.status === "RESOLVED" ? "badge badge-success" : "badge badge-warning"}>{qualityStatusLabel(m, item.status)}</span></summary>
        <div className="quality-item-content">
          <dl className="quality-explain">
            <div><dt>{t.meaning}</dt><dd>{info.meaning}</dd></div>
            {info.impact && <div><dt>{t.impact}</dt><dd>{info.impact}</dd></div>}
            {info.fix && <div><dt>{t.fix}</dt><dd>{info.fix}</dd></div>}
          </dl>
          {fields.length > 0 && <section><h3>{t.foundData}</h3><dl className="source-field-grid">{fields.map(field =>
            <div className="source-field" key={field.key}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl></section>}
          {(item.links?.purchaseOrderId || item.links?.processId) && <p className="quality-links">
            {item.links.purchaseOrderId && <Link className="button secondary" href={`/purchase-orders/${item.links.purchaseOrderId}`}>{t.openPo}</Link>}
            {item.links.processId && <Link className="button secondary" href={`/processes/${item.links.processId}`}>{t.openIp}</Link>}
          </p>}
          <details className="source-disclosure"><summary>{t.technicalDetails}</summary>
            <p className="muted">{t.technicalCode(item.code)} · {t.severity}{qualitySeverityLabel(m, item.severity)}{item.fieldName && <> · {t.sourceField}{item.fieldName}</>}</p>
            <pre>{JSON.stringify(item.evidence, null, 2)}</pre>
            <h3>{t.preservedValues}</h3>
            <dl className="source-field-grid">{Object.entries(item.sourceValues).map(([name, value]) => <div className="source-field" key={name}><dt>{item.sourceColumnHeaders?.[name] || m.processWorkspace.noHeader}<small>{name}{item.sourceRowNumber}</small></dt><dd>{formatFieldValue(value)}</dd></div>)}</dl>
          </details>
          {reviews.length > 0 && <section className="review-history"><h3>{t.reviewHistory(reviews.length)}</h3><ol className="request-history-list">{reviews.map(review => <li key={review.id}>
            <strong>{qualityOutcomeLabel(m, review.outcome)}</strong><span className="muted">{review.reviewer} · {formatUsDateTime(review.recordedAt)}</span>
            <p>{review.notes}</p><p className="muted">{t.proposals(review.proposedPurchaseOrder ?? "—", review.proposedIpNumber ?? "—")}</p>
            <details><summary>{t.recordedEvidence}</summary><pre>{JSON.stringify(review.evidence, null, 2)}</pre></details>
          </li>)}</ol></section>}
          {reviewing === item.id && canResolveQuality(roles ?? []) ? <form className="review-form" onSubmit={event => { event.preventDefault(); void submitReview(item, event.currentTarget); }}>
            <label>{t.reference}<input name="reference" required maxLength={500} placeholder={t.referencePlaceholder} /></label>
            <label>{t.justification}<textarea name="reason" required maxLength={2000} /></label>
            <label>{t.proposedPo}<input name="proposedPurchaseOrder" maxLength={80} /></label>
            <label>{t.proposedIp}<input name="proposedIpNumber" maxLength={80} /></label>
            <div><button className="button" type="submit" disabled={submitting}>{submitting ? t.recording : t.resolve}</button><button className="button secondary" type="button" disabled={submitting} onClick={() => { setReviewing(undefined); setIdempotencyKey(undefined); }}>{t.cancel}</button></div>
          </form> : item.status === "OPEN" && canResolveQuality(roles ?? []) && <button className="button" type="button" onClick={() => { setReviewing(item.id); setIdempotencyKey(crypto.randomUUID()); }}>{t.review}</button>}
        </div>
      </details>;
    })}
  </main>;
}

function Metric({ label, value }: { label: string; value: number | string }) { return <section className="metric"><span>{label}</span><strong>{value}</strong></section>; }

function formatFieldValue(value: unknown): string {
  if (value == null) return "—";
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}
