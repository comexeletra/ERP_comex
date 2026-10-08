"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { formatCount } from "../lib/format-count";

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

function StatusList({ items }: { items: MetricSet["statuses"] }) {
  const peak = Math.max(1, ...items.map(item => item.count));
  if (!items.length) return <p className="muted">Sem dados de status neste escopo.</p>;
  return <ul className="report-status-list">{items.map(item => <li key={item.status}>
    <div><span>{item.status}</span><strong>{formatCount(item.count)}</strong></div>
    <span className="report-status-track" aria-hidden="true"><span style={{ width: `${Math.max(2, item.count / peak * 100)}%` }} /></span>
  </li>)}</ul>;
}

export default function ReportsView({ scope }: { scope: ReportScope }) {
  const [summary, setSummary] = useState<ReportsSummary>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch(`/api/v1/reports/summary?scope=${scope}`, { signal: controller.signal })
      .then(async response => {
        if (response.status === 401) throw new Error("Sua sessão expirou. Entre novamente.");
        if (response.status === 403) throw new Error("Seu acesso não permite consultar estes relatórios.");
        if (!response.ok) throw new Error("Não foi possível carregar os indicadores dos relatórios.");
        return await response.json() as ReportsSummary;
      })
      .then(data => { if (!controller.signal.aborted) { setSummary(data); setError(""); } })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Erro inesperado.");
      });
    return () => controller.abort();
  }, [retry, scope]);

  return <main className="shell">
    <header className="page-header">
      <p className="eyebrow">ERP Comex · Indicadores</p>
      <h1>{scope === "pre" ? "Pré Embarque" : "Pós Embarque"}</h1>
      <p>Indicadores operacionais deste escopo. Os números respeitam as importadoras autorizadas para o seu usuário.</p>
      <Link className="text-link" href="/">← Carteira de POs</Link>
    </header>

    {error && <div className="notice error" role="alert"><p>{error}</p>
      <button className="button" onClick={() => { setError(""); setRetry(value => value + 1); }}>Tentar novamente</button></div>}

    {scope === "pre" && <section className="report-section" aria-labelledby="pre-report-title">
      <div className="report-section-heading"><div><p className="eyebrow">Etapa 1</p><h2 id="pre-report-title">Pré Embarque</h2>
        <p className="muted">Base operacional de POs, incluindo o histórico convertido e os novos registros.</p></div>
        <div className="report-actions"><Link className="button secondary" href={`/source-audit?sheet=${encodeURIComponent("Pré Embarque")}`}>Planilha histórica completa</Link>
          <Link className="button" href="/">Consultar POs operacionais</Link></div>
      </div>
      <div className="metric-grid report-metrics">
        <Metric label="POs no escopo" value={summary?.preShipment?.totalRecords} />
        <Metric label="Históricas operacionalizadas" value={summary?.preShipment?.historicalRecords} />
        <Metric label="Novas POs" value={summary?.preShipment?.newRecords} />
        <Metric label="Itens operacionais" value={summary?.preShipment?.operationalItems} />
        <Metric label="Itens vinculados a IP" value={summary?.preShipment?.allocatedItems} />
        <Metric label="Itens sem vínculo ativo" value={summary?.preShipment?.unallocatedItems} />
      </div>
      <section className="card report-status-card"><h3>Situação de identificação das POs</h3>
        <StatusList items={summary?.preShipment?.statuses ?? []} /></section>
    </section>}

    {scope === "post" && <section className="report-section" aria-labelledby="post-report-title">
      <div className="report-section-heading"><div><p className="eyebrow">Etapa 2</p><h2 id="post-report-title">Pós Embarque</h2>
        <p className="muted">Base operacional de IPs, com os dados históricos convertidos e os novos processos.</p></div>
        <div className="report-actions"><Link className="button secondary" href={`/source-audit?sheet=${encodeURIComponent("Pós Embarque")}`}>Planilha histórica completa</Link>
          <Link className="button" href="/processes">Consultar IPs operacionais</Link></div>
      </div>
      <div className="metric-grid report-metrics">
        <Metric label="IPs no escopo" value={summary?.postShipment?.totalRecords} />
        <Metric label="Históricos operacionalizados" value={summary?.postShipment?.historicalRecords} />
        <Metric label="Novos IPs" value={summary?.postShipment?.newRecords} />
        <Metric label="Processos abertos" value={summary?.postShipment?.openRecords} />
        <Metric label="Com chegada registrada" value={summary?.postShipment?.rowsWithArrival} />
        <Metric label="Com Duimp informada" value={summary?.postShipment?.rowsWithDuimp} />
        <Metric label="Com entrega registrada" value={summary?.postShipment?.rowsWithDelivery} />
        <Metric label="Com multa, armazenagem ou demurrage" value={summary?.postShipment?.rowsWithAdditionalCosts} />
      </div>
      <section className="card report-status-card"><h3>Status dos processos</h3>
        <StatusList items={summary?.postShipment?.statuses ?? []} /></section>
    </section>}
  </main>;
}
