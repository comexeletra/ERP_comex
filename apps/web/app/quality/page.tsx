"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { formatUsDateTime } from "../../lib/date-format";
import { canResolveQuality } from "../../lib/quality-permissions";
import { getMessages, useI18n } from "../../components/I18nProvider";
import PageHeader from "../../components/PageHeader";
import { SearchableSelect } from "../../components/SearchableSelect";

type Review = { id: string; outcome: string; reviewer: string; notes: string; evidence: Record<string, unknown>; proposedPurchaseOrder?: string; proposedIpNumber?: string; recordedAt: string };
type QualityItem = { id: string; sourceRowId: string; code: string; severity: string; status: string; evidence: Record<string, unknown>; fieldName?: string; sheetName?: string; sourceRowNumber?: number; sourceValues: Record<string, unknown>; sourceColumnHeaders: Record<string, string>; latestReview?: Review; reviewHistory?: Review[] };
type QualityPageData = { page: number; pageSize: number; totalCount: number; openCount: number; resolvedCount: number; items: QualityItem[] };

export default function QualityPage() {
  const { m } = useI18n();
  const t = m.quality;
  const [data, setData] = useState<QualityPageData>();
  const [roles, setRoles] = useState<string[]>();
  const [status, setStatus] = useState("open");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [reviewing, setReviewing] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>();

  const load = () => {
    setError(undefined);
    setRoles(undefined);
    const query = new URLSearchParams({ status, pageSize: "50" });
    if (code.trim()) query.set("code", code.trim());
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
  useEffect(() => { void load(); }, [status]);
  function applyFilter(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void load(); }
  async function submitReview(item: QualityItem, form: HTMLFormElement) {
    if (!canResolveQuality(roles ?? [])) return;
    const fields = new FormData(form);
    let evidence: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(String(fields.get("evidence") ?? ""));
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
      evidence = parsed as Record<string, unknown>;
    } catch {
      setError(t.invalidEvidence);
      return;
    }
    setSubmitting(true);
    try {
      const response = await apiFetch(`/api/v1/data-issues/${item.id}/resolve`, {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey ?? crypto.randomUUID() },
        body: JSON.stringify({ evidence, reason: fields.get("reason"), proposedPurchaseOrder: fields.get("proposedPurchaseOrder") || null, proposedIpNumber: fields.get("proposedIpNumber") || null })
      });
      if (!response.ok) { setError(t.notRecorded); return; }
      setReviewing(undefined); setIdempotencyKey(undefined); await load();
    } catch {
      setError(t.recordFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="shell">
    <PageHeader eyebrow={t.eyebrow} title={t.title}><p>{t.intro}</p></PageHeader>
    {error && <p className="notice error">{error}</p>}
    {roles && !canResolveQuality(roles) && <p className="notice">{t.readOnly}</p>}
    <section className="metric-grid" aria-label={t.summary}><Metric label={t.open} value={data?.openCount ?? "…"} /><Metric label={t.resolved} value={data?.resolvedCount ?? "…"} /><Metric label={t.inFilter} value={data?.totalCount ?? "…"} /></section>
    <section className="card"><form className="quality-filter" onSubmit={applyFilter}><label>{t.status}<SearchableSelect ariaLabel={t.status} placeholder="" value={status} onChange={setStatus}
      options={[{ value: "open", label: t.statusOpen }, { value: "resolved", label: t.statusResolved }, { value: "all", label: t.statusAll }]} /></label><label>{t.code}<input value={code} onChange={event => setCode(event.target.value)} placeholder="EXCEL_ERROR" /></label><button className="button" type="submit">{t.filter}</button></form></section>
    {!data && !error && <p role="status">{t.loading}</p>}
    {data?.items.length === 0 && <section className="card"><p>{t.none}</p></section>}
    {data?.items.map(item => <details className="card quality-item" key={item.id}><summary className="quality-summary"><span><small>{t.row(item.sheetName ?? t.sourceUnavailable, String(item.sourceRowNumber ?? "--"))}</small><strong>{item.code}</strong></span><span className={item.status === "RESOLVED" ? "badge badge-success" : "badge badge-warning"}>{item.status}</span></summary><div className="quality-item-content">      <p>{t.severity}<strong>{item.severity}</strong></p>{item.fieldName && <p className="muted">{t.sourceField}<strong>{item.fieldName}</strong></p>}
      <details className="source-disclosure"><summary>{t.originalEvidence}</summary><dl className="source-field-grid">{Object.entries(item.evidence).map(([name, value]) => <div className="source-field" key={name}><dt>{name}</dt><dd>{formatFieldValue(value)}</dd></div>)}</dl></details>
      <details className="source-disclosure"><summary>{t.preservedValues}</summary><dl className="source-field-grid">{Object.entries(item.sourceValues).map(([name, value]) => <div className="source-field" key={name}><dt>{item.sourceColumnHeaders?.[name] || m.processWorkspace.noHeader}<small>{name}{item.sourceRowNumber}</small></dt><dd>{formatFieldValue(value)}</dd></div>)}</dl></details>
      {(() => {
        const reviews = item.reviewHistory?.length ? item.reviewHistory : item.latestReview ? [item.latestReview] : [];
        return reviews.length > 0 && <section className="review-history"><h3>{t.reviewHistory(reviews.length)}</h3><ol className="request-history-list">{reviews.map(review => <li key={review.id}>
          <strong>{review.outcome}</strong><span className="muted">{review.reviewer} · {formatUsDateTime(review.recordedAt)}</span>
          <p>{review.notes}</p><p className="muted">{t.proposals(review.proposedPurchaseOrder ?? "—", review.proposedIpNumber ?? "—")}</p>
          <details><summary>{t.recordedEvidence}</summary><pre>{JSON.stringify(review.evidence, null, 2)}</pre></details>
        </li>)}</ol></section>;
      })()}
      {reviewing === item.id && canResolveQuality(roles ?? []) ? <form className="review-form" onSubmit={event => { event.preventDefault(); void submitReview(item, event.currentTarget); }}><label>{t.evidenceLabel}<textarea name="evidence" required placeholder={t.evidencePlaceholder} /></label><label>{t.justification}<textarea name="reason" required /></label><label>{t.proposedPo}<input name="proposedPurchaseOrder" /></label><label>{t.proposedIp}<input name="proposedIpNumber" /></label><div><button className="button" type="submit" disabled={submitting}>{submitting ? t.recording : t.resolve}</button><button className="button secondary" type="button" disabled={submitting} onClick={() => { setReviewing(undefined); setIdempotencyKey(undefined); }}>{t.cancel}</button></div></form> : item.status === "OPEN" && canResolveQuality(roles ?? []) && <button className="button" type="button" onClick={() => { setReviewing(item.id); setIdempotencyKey(crypto.randomUUID()); }}>{t.review}</button>}
    </div></details>)}
  </main>;
}

function Metric({ label, value }: { label: string; value: number | string }) { return <section className="metric"><span>{label}</span><strong>{value}</strong></section>; }

function formatFieldValue(value: unknown): string {
  if (value == null) return "—";
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}
