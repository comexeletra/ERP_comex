"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { formatUsDateTime } from "../../lib/date-format";
import { canResolveQuality } from "../../lib/quality-permissions";

type Review = { id: string; outcome: string; reviewer: string; notes: string; evidence: Record<string, unknown>; proposedPurchaseOrder?: string; proposedIpNumber?: string; recordedAt: string };
type QualityItem = { id: string; sourceRowId: string; code: string; severity: string; status: string; evidence: Record<string, unknown>; fieldName?: string; sheetName?: string; sourceRowNumber?: number; sourceValues: Record<string, unknown>; sourceColumnHeaders: Record<string, string>; latestReview?: Review; reviewHistory?: Review[] };
type QualityPageData = { page: number; pageSize: number; totalCount: number; openCount: number; resolvedCount: number; items: QualityItem[] };

export default function QualityPage() {
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
        if (!identityResponse.ok) throw new Error("Sua sess\u00e3o expirou. Entre novamente.");
        const identity = await identityResponse.json() as { roles: string[] };
        setRoles(identity.roles);
        if (!response.ok) {
          throw new Error(response.status === 403
            ? "Seu perfil n\u00e3o tem acesso \u00e0 fila de qualidade. Entre em contato com o administrador do sistema."
            : "N\u00e3o foi poss\u00edvel carregar a fila de qualidade.");
        }
        setData(await response.json() as QualityPageData);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Erro inesperado."));
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
      setError("Informe a evidência em formato JSON válido.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await apiFetch(`/api/v1/data-issues/${item.id}/resolve`, {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey ?? crypto.randomUUID() },
        body: JSON.stringify({ evidence, reason: fields.get("reason"), proposedPurchaseOrder: fields.get("proposedPurchaseOrder") || null, proposedIpNumber: fields.get("proposedIpNumber") || null })
      });
      if (!response.ok) { setError("A resolução não foi registrada. Confira evidência e justificativa e tente novamente."); return; }
      setReviewing(undefined); setIdempotencyKey(undefined); await load();
    } catch {
      setError("Não foi possível registrar a resolução. Tente novamente com a mesma operação.");
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="shell">
    <Link href="/" className="back">← Carteira de POs</Link>
    <header className="page-header"><p className="eyebrow">Histórico Excel · fila de revisão</p><h1>Qualidade dos dados</h1><p>Revise divergências da origem e registre decisões para validação operacional.</p></header>
    {error && <p className="notice error">{error}</p>}
    {roles && !canResolveQuality(roles) && <p className="notice">{"Seu perfil permite apenas consultar a fila. Para solicitar permiss\u00e3o para revisar pend\u00eancias, entre em contato com o administrador do sistema."}</p>}
    <section className="metric-grid quality-metrics" aria-label="Resumo da fila de qualidade"><Metric label="Pendências abertas" value={data?.openCount ?? "…"} /><Metric label="Pendências resolvidas" value={data?.resolvedCount ?? "…"} /><Metric label="Itens no filtro" value={data?.totalCount ?? "…"} /></section>
    <section className="card"><form className="quality-filter" onSubmit={applyFilter}><label>Status<select value={status} onChange={event => setStatus(event.target.value)}><option value="open">Abertas</option><option value="resolved">Resolvidas</option><option value="all">Todas</option></select></label><label>Código<input value={code} onChange={event => setCode(event.target.value)} placeholder="EXCEL_ERROR" /></label><button className="button" type="submit">Filtrar</button></form></section>
    {!data && !error && <p>Carregando fila…</p>}
    {data?.items.length === 0 && <section className="card"><p>Nenhuma pendência encontrada para este filtro.</p></section>}
    {data?.items.map(item => <details className="card quality-item" key={item.id}><summary className="quality-summary"><span><small>{item.sheetName ?? "Origem indisponível"} - linha {item.sourceRowNumber ?? "--"}</small><strong>{item.code}</strong></span><span className={`quality-status ${item.status}`}>{item.status}</span></summary><div className="quality-item-content">      <p>Severidade: <strong>{item.severity}</strong></p>{item.fieldName && <p className="muted">Campo de origem: <strong>{item.fieldName}</strong></p>}
      <details className="source-disclosure"><summary>Ver evidência original</summary><dl className="source-field-grid">{Object.entries(item.evidence).map(([name, value]) => <div className="source-field" key={name}><dt>{name}</dt><dd>{formatFieldValue(value)}</dd></div>)}</dl></details>
      <details className="source-disclosure"><summary>Ver valores preservados da origem</summary><dl className="source-field-grid">{Object.entries(item.sourceValues).map(([name, value]) => <div className="source-field" key={name}><dt>{item.sourceColumnHeaders?.[name] || "Campo sem cabeçalho"}<small>{name}{item.sourceRowNumber}</small></dt><dd>{formatFieldValue(value)}</dd></div>)}</dl></details>
      {(() => {
        const reviews = item.reviewHistory?.length ? item.reviewHistory : item.latestReview ? [item.latestReview] : [];
        return reviews.length > 0 && <section className="review-history"><h3>Histórico de revisões ({reviews.length})</h3><ol className="request-history-list">{reviews.map(review => <li key={review.id}>
          <strong>{review.outcome}</strong><span className="muted">{review.reviewer} · {formatUsDateTime(review.recordedAt)}</span>
          <p>{review.notes}</p><p className="muted">PO proposta: {review.proposedPurchaseOrder ?? "—"} · IP proposto: {review.proposedIpNumber ?? "—"}</p>
          <details><summary>Evidência registrada</summary><pre>{JSON.stringify(review.evidence, null, 2)}</pre></details>
        </li>)}</ol></section>;
      })()}
      {reviewing === item.id && canResolveQuality(roles ?? []) ? <form className="review-form" onSubmit={event => { event.preventDefault(); void submitReview(item, event.currentTarget); }}><label>Evidência da resolução (objeto JSON)<textarea name="evidence" required placeholder='{"referencia":"documento ou evidência conferida"}' /></label><label>Justificativa<textarea name="reason" required /></label><label>PO proposta (opcional)<input name="proposedPurchaseOrder" /></label><label>IP proposto (opcional)<input name="proposedIpNumber" /></label><div><button className="button" type="submit" disabled={submitting}>{submitting ? "Registrando…" : "Resolver pendência"}</button><button className="button secondary" type="button" disabled={submitting} onClick={() => { setReviewing(undefined); setIdempotencyKey(undefined); }}>Cancelar</button></div></form> : item.status === "OPEN" && canResolveQuality(roles ?? []) && <button className="button" type="button" onClick={() => { setReviewing(item.id); setIdempotencyKey(crypto.randomUUID()); }}>Revisar pendência</button>}
    </div></details>)}
  </main>;
}

function Metric({ label, value }: { label: string; value: number | string }) { return <section className="metric"><span>{label}</span><strong>{value}</strong></section>; }

function formatFieldValue(value: unknown): string {
  if (value == null) return "—";
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}
