"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { formatUsDate } from "../lib/date-format";
import OperationalPoPanel from "./OperationalPoPanel";

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
  sourceColumnHeaders: Record<string, string>;
};
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

function formatDecimal(value: string | null) {
  if (value == null) return "—";
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const whole = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fraction = match[3]?.replace(/0+$/, "");
  return `${match[1]}${whole}${fraction ? `,${fraction}` : ""}`;
}

function formatDate(value: string | null) {
  return value == null ? "—" : formatUsDate(value);
}

export default function PurchaseOrderWorkspace({ id, returnPath }: { id: string; returnPath: string }) {
  const [data, setData] = useState<Overview>();
  const [history, setHistory] = useState<HistoryPage>();
  const [expandedHistoryId, setExpandedHistoryId] = useState<string>();
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  function refreshOverview() {
    void apiFetch(`/api/v1/purchase-orders/${id}/overview`)
      .then(async response => { if (response.ok) setData(await response.json() as Overview); })
      .catch(() => undefined);
  }

  useEffect(() => {
    const controller = new AbortController();
    setError(undefined);
    setLoading(true);
    setHistory(undefined);
    const query = new URLSearchParams({ page: String(page), pageSize: "50" });
    Promise.all([
      apiFetch(`/api/v1/purchase-orders/${id}/overview`, { signal: controller.signal }),
      apiFetch(`/api/v1/purchase-orders/${id}/history-items?${query}`, { signal: controller.signal }),
    ])
      .then(async ([overviewResponse, historyResponse]) => {
        if (overviewResponse.status === 401 || historyResponse.status === 401) throw new Error("Sua sessão expirou. Entre novamente.");
        if (overviewResponse.status === 403 || historyResponse.status === 403) throw new Error("Seu acesso não permite consultar esta PO.");
        if (overviewResponse.status === 404 || historyResponse.status === 404) {
          throw new Error("PO não encontrada ou fora do seu escopo de acesso.");
        }
        if (!overviewResponse.ok || !historyResponse.ok) {
          throw new Error("Não foi possível carregar os dados da PO.");
        }
        const overview = await overviewResponse.json() as Overview;
        const lines = await historyResponse.json() as HistoryPage;
        if (!controller.signal.aborted) { setData(overview); setHistory(lines); }
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Erro inesperado."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, page, retry]);

  if (loading || error || !data || !history) return <main className="shell">
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
        <p>{data.historicalItemCount} observações históricas; {data.processes.length} IPs vinculados. Identidade: {data.identityStatus}.</p>
      </header>

      <section className="metric-grid" aria-label="Cobertura histórica da PO">
        <Metric label="Observações históricas" value={data.coverage.historicalLines} />
        <Metric label="Com IP na origem" value={data.coverage.linesWithIp} />
        <Metric label="Sem IP na origem" value={data.coverage.linesWithoutIp} />
        <Metric label="Pendências abertas" value={data.unresolvedIssueCount} />
      </section>

      <OperationalPoPanel id={id} onChanged={refreshOverview} />

      <section className="card">
        <h2>Limites dos dados da origem</h2>
        <p className="muted">Itens oficiais integrados ao TOTVS: {data.officialItemsKnown ? "disponíveis" : "não confirmados"}. Saldo oficial integrado: {data.balanceAvailable ? "disponível" : "não disponível"}. O preenchimento operacional acima registra transcrições e distribuições feitas pelos analistas; não atualiza o TOTVS. Invoice, documentos e marcos operacionais ainda não estão disponíveis nesta PO.</p>
      </section>

      <section className="card"><h2>Histórico da PO</h2><p className="muted">Observações importadas, com linhagem até a aba e a linha de origem. Não representam itens oficiais nem saldo.</p>
        {history.items.length === 0 ? <p>Nenhuma observação nesta página.</p> : <div className="table-scroll"><table><thead><tr><th>Linha</th><th>Produto</th><th>Qtd.</th><th>Valor histórico</th><th>Necessidade</th><th>Status de origem</th><th>IP de origem</th><th>Campos da origem</th></tr></thead>
          <tbody>{history.items.map(line => <Fragment key={line.id}><tr><td>{line.sourceRowNumber} · {line.sourceSheetName}</td><td><strong>{line.productCode ?? "—"}</strong><br />{line.productDescription}</td><td>{formatDecimal(line.quantity)}</td><td>{line.historicalAmount == null ? "—" : `${formatDecimal(line.historicalAmount)} ${line.currency ?? ""}`}</td><td>{formatDate(line.necessityDate)}</td><td>{line.legacyStatus ?? "—"}</td><td>{line.ipNumber ?? "Sem IP"}</td><td><button type="button" className="source-expand-button" aria-label={`${expandedHistoryId === line.id ? "Ocultar" : "Ver"} campos da linha ${line.sourceRowNumber} da aba ${line.sourceSheetName}`} aria-expanded={expandedHistoryId === line.id} onClick={() => setExpandedHistoryId(current => current === line.id ? undefined : line.id)}>{expandedHistoryId === line.id ? "Ocultar campos" : "Ver campos"}</button></td></tr>
            {expandedHistoryId === line.id && <tr className="source-detail-row"><td colSpan={8}><section className="source-detail-panel"><div className="source-detail-heading"><strong>Campos preservados da origem</strong><span>Aba {line.sourceSheetName} · linha {line.sourceRowNumber}</span></div><dl className="source-field-grid">{Object.entries(line.sourceValues ?? {}).map(([column, value]) => <SourceCell key={column} column={column} row={line.sourceRowNumber} label={line.sourceColumnHeaders?.[column]} value={value} />)}</dl></section></td></tr>}</Fragment>)}</tbody>
        </table></div>}
        {history.totalCount > history.pageSize && <p className="pagination"><button className="button secondary" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Anterior</button><span>Página {page} de {Math.ceil(history.totalCount / history.pageSize)}</span><button className="button" disabled={page * history.pageSize >= history.totalCount} onClick={() => setPage(value => value + 1)}>Próxima</button></p>}
      </section>

      <section className="card"><h2>IPs vinculados e custos no grão do IP</h2><p className="muted">Custos históricos continuam atribuídos ao IP. Eles não são rateados nem totalizados como custo da PO.</p>
        {data.processes.length === 0 && <p>Nenhum IP vinculado disponível no escopo desta PO.</p>}
        {data.processes.map(process => <article className="process" key={process.id}><h3>{process.ipNumber} <span>{process.logisticsStatus ?? "Status logístico não informado"}</span></h3>
          <p className="muted">Qualidade do IP: {process.qualityStatus}. Vínculo: {process.linkSource}. POs visíveis vinculadas a este IP: {process.linkedPurchaseOrderCount}.</p>
          <Link className="text-link" href={`/processes/${process.id}`}>Abrir detalhe do IP →</Link>
          {process.costs.length > 0 ? <ul>{process.costs.map((cost, index) => <li key={`${cost.type}-${cost.currency}-${index}`}>{cost.type}: {formatDecimal(cost.amount)} {cost.currency} · {cost.status}</li>)}</ul> : <p>Nenhum custo histórico registrado.</p>}
        </article>)}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <section className="metric"><span>{label}</span><strong>{value}</strong></section>;
}

function SourceCell({ column, row, label, value }: { column: string; row: number; label?: string; value: unknown }) {
  const raw = value == null ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return <div className="source-field"><dt>{label || "Campo sem cabeçalho"}<small>{column}{row}</small></dt><dd>{value == null ? raw : formatUsDate(raw)}</dd></div>;
}
