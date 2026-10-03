"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { formatUsDateTime } from "../../../lib/date-format";

type OutboxSummary = {
  counts: { published: number; deadLettered: number; leased: number;
    retryWaiting: number; ready: number; oldestUnpublishedAt: string | null };
  items: Array<{ id: string; eventType: string; aggregateType: string;
    occurredAt: string; attempts: number; status: string; nextAttemptAt: string | null }>;
};

const labels: Record<string, string> = {
  READY: "Pronto", RETRY_WAIT: "Aguardando tentativa", LEASED: "Em processamento",
  DEAD_LETTERED: "Falha definitiva",
};

export default function OutboxPage() {
  const [summary, setSummary] = useState<OutboxSummary>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch("/api/v1/admin/outbox", { signal: controller.signal })
      .then(async response => {
        if (response.status === 403) throw new Error("Somente Master pode consultar a fila.");
        if (!response.ok) throw new Error("Não foi possível carregar a fila.");
        return await response.json() as OutboxSummary;
      })
      .then(data => { if (!controller.signal.aborted) { setSummary(data); setError(""); } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Erro inesperado."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  return <main className="shell">
    <header className="page-header">
      <p className="eyebrow">ERP Comex · Administração</p>
      <h1>Fila de eventos</h1>
      <p>Monitor somente de leitura. Payloads e mensagens de erro não são exibidos.</p>
      <Link className="text-link" href="/admin/users">← Gerenciar acessos</Link>
    </header>
    <section className="card" aria-live="polite">
      <button className="button secondary" type="button" disabled={loading}
        onClick={() => { setLoading(true); setRevision(value => value + 1); }}>Atualizar</button>
      {loading && <p role="status">Carregando fila…</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {summary && <>
        <div className="metric-grid">
          <div className="metric"><span>Prontos</span><strong>{summary.counts.ready}</strong></div>
          <div className="metric"><span>Aguardando tentativa</span><strong>{summary.counts.retryWaiting}</strong></div>
          <div className="metric"><span>Em processamento</span><strong>{summary.counts.leased}</strong></div>
          <div className="metric"><span>Falha definitiva</span><strong>{summary.counts.deadLettered}</strong></div>
          <div className="metric"><span>Publicados</span><strong>{summary.counts.published}</strong></div>
        </div>
        <p className="muted">Evento não publicado mais antigo: {summary.counts.oldestUnpublishedAt
          ? formatUsDateTime(summary.counts.oldestUnpublishedAt) : "nenhum"}.</p>
        <p className="muted">Ainda não há consumidor operacional da outbox. Eventos prontos permanecem na fila até essa etapa ser implementada.</p>
        <h2>Até 50 eventos não publicados mais antigos</h2>
        {summary.items.length === 0 ? <p>Nenhum evento não publicado.</p>
          : <div className="table-scroll"><table>
            <thead><tr><th>Ocorrido em</th><th>Evento</th><th>Entidade</th><th>Status</th><th>Tentativas</th><th>Próxima tentativa</th></tr></thead>
            <tbody>{summary.items.map(item => <tr key={item.id}>
              <td>{formatUsDateTime(item.occurredAt)}</td><td>{item.eventType}</td>
              <td>{item.aggregateType}</td><td>{labels[item.status] ?? item.status}</td>
              <td>{item.attempts}</td><td>{item.nextAttemptAt ? formatUsDateTime(item.nextAttemptAt) : "—"}</td>
            </tr>)}</tbody>
          </table></div>}
      </>}
    </section>
  </main>;
}
