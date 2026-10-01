"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { formatUsDateTime } from "../../../lib/date-format";

type RequestDetail = { id: string; requestNumber: string; importer: string; sourceKind: string;
  requesterReference: string; reason: string; notes: string; status: string; version: string;
  createdAt: string; items: Array<{ id: string; lineNumber: number; description: string;
    purposeText: string | null; costCenterText: string | null; sourceKind: string }> };

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [request, setRequest] = useState<RequestDetail>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    apiFetch(`/api/v1/requests/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async response => {
        if (response.status === 401) throw new Error("Sua sessão expirou. Entre novamente.");
        if (response.status === 403) throw new Error("Seu perfil não pode consultar esta solicitação.");
        if (response.status === 404) throw new Error("Solicitação não encontrada no seu escopo.");
        if (!response.ok) throw new Error("Não foi possível carregar a solicitação.");
        return await response.json() as RequestDetail;
      })
      .then(data => { if (!controller.signal.aborted) setRequest(data); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Erro inesperado."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id]);

  return <main className="shell">
    <header className="page-header"><p className="eyebrow">ERP Comex · Solicitações</p>
      <h1>{request?.requestNumber ?? "Detalhe da solicitação"}</h1>
      <Link className="text-link" href="/requests">← Voltar às solicitações</Link>
    </header>
    <section className="card" aria-live="polite">
      {loading && <p role="status">Carregando solicitação…</p>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {request && <>
        <dl className="field-list">
          <dt>Importador</dt><dd>{request.importer}</dd>
          <dt>Origem</dt><dd>{request.sourceKind}</dd>
          <dt>Solicitante</dt><dd>{request.requesterReference}</dd>
          <dt>Status</dt><dd>{request.status}</dd>
          <dt>Versão</dt><dd>{request.version}</dd>
          <dt>Motivo</dt><dd>{request.reason}</dd>
          {request.notes && <><dt>Observações</dt><dd>{request.notes}</dd></>}
          <dt>Criada em</dt><dd>{formatUsDateTime(request.createdAt)}</dd>
        </dl>
        <h2>Itens solicitados</h2>
        {request.items.map(item => <article className="request-line" key={item.id}>
          <h3>Item {item.lineNumber}</h3><p>{item.description}</p>
          <p className="muted">Origem: {item.sourceKind}</p>
          {item.purposeText && <p><strong>Finalidade informada:</strong> {item.purposeText}</p>}
          {item.costCenterText && <p><strong>Centro de custo informado:</strong> {item.costCenterText}</p>}
        </article>)}
      </>}
    </section>
  </main>;
}
