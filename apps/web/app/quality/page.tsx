"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { formatUsDateTime } from "../../lib/date-format";

type Review = { id: string; outcome: string; reviewer: string; notes: string; evidence: Record<string, unknown>; proposedPurchaseOrder?: string; proposedIpNumber?: string; recordedAt: string };
type QualityItem = { id: string; sourceRowId: string; code: string; severity: string; status: string; evidence: Record<string, unknown>; fieldName?: string; sheetName?: string; sourceRowNumber?: number; sourceValues: Record<string, unknown>; sourceColumnHeaders: Record<string, string>; latestReview?: Review };
type QualityPageData = { page: number; pageSize: number; totalCount: number; openCount: number; resolvedCount: number; items: QualityItem[] };

export default function QualityPage() {
  const [data, setData] = useState<QualityPageData>();
  const [status, setStatus] = useState("open");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [reviewing, setReviewing] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>();

  const load = () => {
    setError(undefined);
    const query = new URLSearchParams({ status, pageSize: "50" });
    if (code.trim()) query.set("code", code.trim());
    return apiFetch(`/api/v1/data-issues?${query}`)
      .then(async response => {
        if (!response.ok) throw new Error("Não foi possível carregar a fila de qualidade.");
        setData(await response.json() as QualityPageData);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Erro inesperado."));
  };

  useEffect(() => { void load(); }, [status]);
  function applyFilter(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void load(); }
  async function submitReview(item: QualityItem, form: HTMLFormElement) {
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
    <header className="page-header"><p className="eyebrow">Histórico Excel · fila de revisão</p><h1>Qualidade dos dados</h1><p>As decisões não alteram a planilha nem a carga bruta. Propostas de PO ou IP ficam registradas como revisão e exigem confirmação operacional posterior.</p></header>
    {error && <p className="notice error">{error}</p>}
    <section className="metric-grid" aria-label="Resumo da fila de qualidade"><Metric label="Pendências abertas" value={data?.openCount ?? "…"} /><Metric label="Pendências resolvidas" value={data?.resolvedCount ?? "…"} /><Metric label="Itens no filtro" value={data?.totalCount ?? "…"} /><Metric label="Linhas por página" value={data?.pageSize ?? 50} /></section>
    <section className="card"><form className="quality-filter" onSubmit={applyFilter}><label>Status<select value={status} onChange={event => setStatus(event.target.value)}><option value="open">Abertas</option><option value="resolved">Resolvidas</option><option value="all">Todas</option></select></label><label>Código<input value={code} onChange={event => setCode(event.target.value)} placeholder="EXCEL_ERROR" /></label><button className="button" type="submit">Filtrar</button></form></section>
    {!data && !error && <p>Carregando fila…</p>}
    {data?.items.length === 0 && <section className="card"><p>Nenhuma pendência encontrada para este filtro.</p></section>}
    {data?.items.map(item => <article className="card quality-item" key={item.id}>
      <div className="quality-heading"><div><p className="eyebrow">{item.sheetName ?? "Origem indisponível"} · linha {item.sourceRowNumber ?? "—"}</p><h2>{item.code}</h2></div><span className={`quality-status ${item.status}`}>{item.status}</span></div>
      <p>Severidade: <strong>{item.severity}</strong></p>{item.fieldName && <p className="muted">Campo de origem: <strong>{item.fieldName}</strong></p>}
      <details className="source-disclosure"><summary>Ver evidência original</summary><dl className="source-field-grid">{Object.entries(item.evidence).map(([name, value]) => <div className="source-field" key={name}><dt>{name}</dt><dd>{formatFieldValue(value)}</dd></div>)}</dl></details>
      <details className="source-disclosure"><summary>Ver valores preservados da origem</summary><dl className="source-field-grid">{Object.entries(item.sourceValues).map(([name, value]) => <div className="source-field" key={name}><dt>{item.sourceColumnHeaders?.[name] || "Campo sem cabeçalho"}<small>{name}{item.sourceRowNumber}</small></dt><dd>{formatFieldValue(value)}</dd></div>)}</dl></details>
      {item.latestReview && <section className="review-history"><h3>Última revisão</h3><p><strong>{item.latestReview.outcome}</strong> por {item.latestReview.reviewer} em {formatUsDateTime(item.latestReview.recordedAt)}</p><p>{item.latestReview.notes}</p><p className="muted">PO proposta: {item.latestReview.proposedPurchaseOrder ?? "—"} · IP proposto: {item.latestReview.proposedIpNumber ?? "—"}</p></section>}
      {reviewing === item.id ? <form className="review-form" onSubmit={event => { event.preventDefault(); void submitReview(item, event.currentTarget); }}><label>Evidência da resolução (objeto JSON)<textarea name="evidence" required placeholder='{"referencia":"documento ou evidência conferida"}' /></label><label>Justificativa<textarea name="reason" required /></label><label>PO proposta (opcional)<input name="proposedPurchaseOrder" /></label><label>IP proposto (opcional)<input name="proposedIpNumber" /></label><div><button className="button" type="submit" disabled={submitting}>{submitting ? "Registrando…" : "Resolver pendência"}</button><button className="button secondary" type="button" disabled={submitting} onClick={() => { setReviewing(undefined); setIdempotencyKey(undefined); }}>Cancelar</button></div></form> : item.status === "OPEN" && <button className="button" type="button" onClick={() => { setReviewing(item.id); setIdempotencyKey(crypto.randomUUID()); }}>Revisar pendência</button>}
    </article>)}
  </main>;
}

function Metric({ label, value }: { label: string; value: number | string }) { return <section className="metric"><span>{label}</span><strong>{value}</strong></section>; }

function formatFieldValue(value: unknown): string {
  if (value == null) return "—";
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}
