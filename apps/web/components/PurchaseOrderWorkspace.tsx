"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

type HistoryLine = {
  id: string;
  sourceRowNumber: number;
  productCode: string | null;
  productDescription: string | null;
  quantity: string | null;
  historicalAmount: string | null;
  currency: string | null;
  necessityDate: string | null;
  legacyStatus: string | null;
  ipNumber: string | null;
  sourceSheetName: string;
  sourceValues: Record<string, unknown>;
};
type Process = {
  id: string;
  ipNumber: string;
  logisticsStatus: string | null;
  qualityStatus: string;
  linkSource: string;
  costs: { type: string; currency: string; amount: string; status: string }[];
};
type Overview = {
  id: string;
  number: string;
  importer: string;
  identityStatus: string;
  version: string;
  officialItemsKnown: boolean;
  balanceAvailable: boolean;
  historicalItemCount: number;
  unresolvedIssueCount: number;
  coverage: { historicalLines: number; linesWithIp: number; linesWithoutIp: number };
  processes: Process[];
};
type HistoryPage = { page: number; pageSize: number; totalCount: number; items: HistoryLine[] };

export default function PurchaseOrderWorkspace({ id }: { id: string }) {
  const [data, setData] = useState<Overview>();
  const [history, setHistory] = useState<HistoryPage>();
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setError(undefined);
    setData(undefined);
    const query = new URLSearchParams({ page: String(page), pageSize: "50" });
    Promise.all([
      apiFetch(`/api/v1/purchase-orders/${id}/overview`),
      apiFetch(`/api/v1/purchase-orders/${id}/history-items?${query}`),
    ])
      .then(async ([overviewResponse, historyResponse]) => {
        if (overviewResponse.status === 404 || historyResponse.status === 404) {
          throw new Error("PO não encontrada.");
        }
        if (!overviewResponse.ok || !historyResponse.ok) {
          throw new Error("Não foi possível carregar os dados da PO.");
        }
        setData(await overviewResponse.json() as Overview);
        setHistory(await historyResponse.json() as HistoryPage);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Erro inesperado."));
  }, [id, page]);

  if (!data || !history) return <main className="shell"><p>Carregando PO…</p>{error && <p className="notice error">{error}</p>}</main>;

  return (
    <main className="shell">
      <Link href="/" className="back">← Carteira de POs</Link>
      <header className="page-header">
        <p className="eyebrow">PO TOTVS · {data.importer}</p>
        <h1>{data.number}</h1>
        <p>{data.historicalItemCount} observações históricas; {data.processes.length} IPs vinculados. Identidade: {data.identityStatus}.</p>
      </header>
      {error && <p className="notice error">{error}</p>}

      <section className="metric-grid" aria-label="Cobertura histórica da PO">
        <Metric label="Observações históricas" value={data.coverage.historicalLines} />
        <Metric label="Com IP na origem" value={data.coverage.linesWithIp} />
        <Metric label="Sem IP na origem" value={data.coverage.linesWithoutIp} />
        <Metric label="Pendências abertas" value={data.unresolvedIssueCount} />
      </section>

      <section className="card">
        <h2>Dados ainda não disponíveis no modelo</h2>
        <p className="muted">Itens oficiais TOTVS: {data.officialItemsKnown ? "disponíveis" : "não confirmados"}. Saldo oficial: {data.balanceAvailable ? "disponível" : "não disponível"}. O schema atual não define fornecedor, estado comercial, invoice, documentos, marcos ou campos operacionais editáveis para a PO.</p>
      </section>

      <section className="card"><h2>Histórico da PO</h2><p className="muted">Observações importadas, com linhagem até a aba e a linha de origem. Não representam itens oficiais nem saldo.</p>
        <table><thead><tr><th>Linha</th><th>Produto</th><th>Qtd.</th><th>Valor histórico</th><th>Necessidade</th><th>Status de origem</th><th>IP de origem</th></tr></thead>
          <tbody>{history.items.map(line => <tr key={line.id}><td>{line.sourceRowNumber} · {line.sourceSheetName}</td><td><strong>{line.productCode ?? "—"}</strong><br />{line.productDescription}</td><td>{line.quantity ?? "—"}</td><td>{line.historicalAmount == null ? "—" : `${line.historicalAmount} ${line.currency ?? ""}`}</td><td>{line.necessityDate ?? "—"}</td><td>{line.legacyStatus ?? "—"}</td><td>{line.ipNumber ?? "Sem IP"}</td></tr>)}</tbody>
        </table>
        {history.totalCount > history.pageSize && <p className="pagination"><button className="button secondary" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Anterior</button><span>Página {page} de {Math.ceil(history.totalCount / history.pageSize)}</span><button className="button" disabled={page * history.pageSize >= history.totalCount} onClick={() => setPage(value => value + 1)}>Próxima</button></p>}
      </section>

      <section className="card"><h2>IPs vinculados e custos no grão do IP</h2><p className="muted">Custos históricos continuam atribuídos ao IP. Eles não são rateados nem totalizados como custo da PO.</p>
        {data.processes.length === 0 && <p>Nenhum IP vinculado disponível no escopo desta PO.</p>}
        {data.processes.map(process => <article className="process" key={process.id}><h3>{process.ipNumber} <span>{process.logisticsStatus ?? "Status logístico não informado"}</span></h3>
          <p className="muted">Qualidade do IP: {process.qualityStatus}. Vínculo: {process.linkSource}.</p>
          {process.costs.length > 0 ? <ul>{process.costs.map((cost, index) => <li key={`${cost.type}-${cost.currency}-${index}`}>{cost.type}: {cost.amount} {cost.currency} · {cost.status}</li>)}</ul> : <p>Nenhum custo histórico registrado.</p>}
        </article>)}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <section className="metric"><span>{label}</span><strong>{value}</strong></section>;
}
