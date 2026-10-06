"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import OperationalPoPanel from "./OperationalPoPanel";
import FollowupPanel from "./FollowupPanel";

type Process = {
  id: string;
  ipNumber: string;
  logisticsStatus: string | null;
  qualityStatus: string;
  linkSource: string;
  linkedPurchaseOrderCount: number;
  costs: { type: string; currency: string; amount: string; status: string }[];
};
type Overview = {
  id: string;
  number: string;
  importer: string;
  itemCount: number;
  processes: Process[];
};

function formatDecimal(value: string | null) {
  if (value == null) return "—";
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const whole = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fraction = match[3]?.replace(/0+$/, "");
  return `${match[1]}${whole}${fraction ? `,${fraction}` : ""}`;
}

export default function PurchaseOrderWorkspace({ id, returnPath }: { id: string; returnPath: string }) {
  const [data, setData] = useState<Overview>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [operationalRevision, setOperationalRevision] = useState(0);

  function refreshOverview() {
    void apiFetch(`/api/v1/purchase-orders/${id}/overview`)
      .then(async response => { if (response.ok) setData(await response.json() as Overview); })
      .catch(() => undefined);
  }

  useEffect(() => {
    const controller = new AbortController();
    setError(undefined);
    setLoading(true);
    apiFetch(`/api/v1/purchase-orders/${id}/overview`, { signal: controller.signal })
      .then(async overviewResponse => {
        if (overviewResponse.status === 401) throw new Error("Sua sessão expirou. Entre novamente.");
        if (overviewResponse.status === 403) throw new Error("Seu acesso não permite consultar esta PO.");
        if (overviewResponse.status === 404) {
          throw new Error("PO não encontrada ou fora do seu escopo de acesso.");
        }
        if (!overviewResponse.ok) {
          throw new Error("Não foi possível carregar os dados da PO.");
        }
        const overview = await overviewResponse.json() as Overview;
        if (!controller.signal.aborted) setData(overview);
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Erro inesperado."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, retry]);

  if (loading || error || !data) return <main className="shell">
    <Link href={returnPath} className="back">← Carteira de POs</Link>
    {loading && <p role="status">Carregando PO…</p>}
    {error && <div className="notice error" role="alert"><p>{error}</p><button className="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></div>}
  </main>;

  return (
    <main className="shell">
      <Link href={returnPath} className="back">← Carteira de POs</Link>
      <header className="page-header">
        <p className="eyebrow">PO TOTVS · {data.importer}</p>
        <h1>{data.number}</h1>
        <p>{data.itemCount} itens · {data.processes.length} IPs vinculados.</p>
      </header>

      <OperationalPoPanel id={id} onChanged={() => { refreshOverview(); setOperationalRevision(value => value + 1); }} />
      <FollowupPanel key={operationalRevision} id={id} />

      <section className="card"><h2>IPs vinculados</h2>
        {data.processes.length === 0 && <p>Nenhum IP vinculado disponível no escopo desta PO.</p>}
        {data.processes.map(process => <article className="process" key={process.id}><h3>{process.ipNumber} <span>{process.logisticsStatus ?? "Status logístico não informado"}</span></h3>
          <p className="muted">Qualidade do IP: {process.qualityStatus}. Vínculo: {process.linkSource}. POs visíveis vinculadas a este IP: {process.linkedPurchaseOrderCount}.</p>
          <Link className="text-link" href={`/processes/${process.id}`}>Abrir detalhe do IP →</Link>
          {process.costs.length > 0 && <details className="historical-costs"><summary>Custos históricos ({process.costs.length})</summary><ul>{process.costs.map((cost, index) => <li key={`${cost.type}-${cost.currency}-${index}`}>{cost.type}: {formatDecimal(cost.amount)} {cost.currency} · {cost.status}</li>)}</ul></details>}
        </article>)}
      </section>
    </main>
  );
}
