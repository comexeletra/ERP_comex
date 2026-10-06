"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { formatUsDateTime } from "../lib/date-format";
import { purchaseOrdersCsv, type ExportPurchaseOrder } from "../lib/po-export";
import { portfolioFilterQuery, purchaseOrderListQuery, type PortfolioFilters } from "../lib/portfolio-query";

type Filters = PortfolioFilters;
type PurchaseOrder = ExportPurchaseOrder & {
  officialItemsKnown: boolean; historicalItemCount: number; operationalItemCount: number; linkedProcessCount: number;
  historicalItemsWithIp: number; historicalItemsWithoutIp: number;
  unresolvedIssueCount: number; balanceAvailable: boolean;
};
type PurchaseOrderPage = { page: number; pageSize: number; totalCount: number; items: PurchaseOrder[] };
type PortfolioSummary = { purchaseOrders: number; linkedProcesses: number; lines: number;
  linesWithoutIp: number; sourceSnapshotAt: string | null;
  byImporter: Array<{ importer: string; purchaseOrders: number }> };
type PortfolioSummaryState = { query: string; value: PortfolioSummary };
type PortfolioSummaryFailure = { query: string; message: string };
const emptyFilters: Filters = { number: "", importer: "", product: "", ipNumber: "" };
const pageSize = 50;

function queryFor(filters: Filters, page: number, size = pageSize) {
  return purchaseOrderListQuery(filters, page, size);
}

export default function PortfolioPage() {
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [applied, setApplied] = useState<Filters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState<PurchaseOrderPage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [summaryState, setSummaryState] = useState<PortfolioSummaryState>();
  const [summaryFailure, setSummaryFailure] = useState<PortfolioSummaryFailure>();
  const summaryQuery = portfolioFilterQuery(applied).toString();
  const summary = summaryState?.query === summaryQuery ? summaryState.value : undefined;
  const summaryError = summaryFailure?.query === summaryQuery ? summaryFailure.message : "";
  const summaryLoading = !ready || (!summary && !summaryError);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const filters: Filters = {
      number: query.get("number") ?? "", importer: query.get("importer") ?? "",
      product: query.get("product") ?? "", ipNumber: query.get("ipNumber") ?? "",
    };
    const requestedPage = Number(query.get("page"));
    setDraft(filters);
    setApplied(filters);
    setPage(Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    setResult(undefined);
    apiFetch(`/api/v1/purchase-orders?${queryFor(applied, page)}`, { signal: controller.signal })
      .then(async response => {
        if (response.status === 401) throw new Error("Sua sessão expirou. Entre novamente.");
        if (response.status === 403) throw new Error("Seu acesso não permite consultar esta carteira.");
        if (!response.ok) throw new Error("Não foi possível carregar a carteira de POs.");
        return await response.json() as PurchaseOrderPage;
      })
      .then(data => { if (!controller.signal.aborted) setResult(data); })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Erro inesperado.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [applied, page, ready, retry]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const query = portfolioFilterQuery(applied).toString();
    apiFetch(`/api/v1/purchase-orders/summary?${query}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Não foi possível carregar os indicadores da carteira.");
        return await response.json() as PortfolioSummary;
      })
      .then(data => {
        if (!controller.signal.aborted) {
          setSummaryState({ query, value: data });
          setSummaryFailure(current => current?.query === query ? undefined : current);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSummaryFailure({ query, message: "Indicadores indisponíveis no momento." });
        }
      });
    return () => controller.abort();
  }, [applied, ready, retry]);

  function navigate(filters: Filters, nextPage: number) {
    setApplied(filters);
    setPage(nextPage);
    window.history.replaceState(null, "", `/?${queryFor(filters, nextPage)}`);
  }
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate({ number: draft.number.trim(), importer: draft.importer.trim(),
      product: draft.product.trim(), ipNumber: draft.ipNumber.trim() }, 1);
  }

  async function downloadCsv() {
    if (exporting || !result?.totalCount) return;
    setExporting(true); setExportError("");
    try {
      const rows: PurchaseOrder[] = [];
      const seen = new Set<string>();
      const expectedCount = result.totalCount;
      if (expectedCount > 5000) throw new Error("A exportação suporta até 5.000 POs por vez. Refine os filtros.");
      for (let nextPage = 1; nextPage <= Math.ceil(expectedCount / 200); nextPage++) {
        const response = await apiFetch(`/api/v1/purchase-orders?${queryFor(applied, nextPage, 200)}`);
        if (!response.ok) throw new Error("Não foi possível consultar todas as POs para exportação.");
        const data = await response.json() as PurchaseOrderPage;
        if (data.totalCount !== expectedCount || data.page !== nextPage || !Array.isArray(data.items)) {
          throw new Error("A carteira mudou durante a exportação. Tente novamente.");
        }
        for (const order of data.items) {
          if (seen.has(order.id)) throw new Error("A carteira mudou durante a exportação. Tente novamente.");
          seen.add(order.id); rows.push(order);
        }
      }
      if (rows.length !== expectedCount) throw new Error("A carteira mudou durante a exportação. Tente novamente.");
      const blob = new Blob(["\uFEFF", purchaseOrdersCsv(rows)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `carteira-pos-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : "Erro inesperado na exportação.");
    } finally { setExporting(false); }
  }

  const totalPages = result ? Math.ceil(result.totalCount / pageSize) : 0;
  const returnPath = `/?${queryFor(applied, page)}`;
  return <main className="shell">
    <header className="page-header portfolio-header">
      <p className="eyebrow">ERP Comex</p><h1>Carteira de POs TOTVS</h1>
      <p>Consulte cada PO, seus produtos, os IPs associados e as pendências em um só lugar.</p>
      <nav className="portfolio-shortcuts" aria-label="Atalhos da carteira">
        <section className="portfolio-shortcut-group"><h2>Dados</h2><div>
          <Link href="/source-audit">Planilha de origem</Link><Link href="/requests">Solicitações</Link><Link href="/catalog">Cadastros</Link>
        </div></section>
        <section className="portfolio-shortcut-group"><h2>Operação</h2><div>
          <Link href="/processes">Consultar IPs</Link>
        </div></section>
        <section className="portfolio-shortcut-group"><h2>Pendências</h2><div>
          <Link href="/pending-import-items">Linhas sem IP</Link><Link href="/unassigned-po-items">Linhas sem PO</Link><Link href="/quality">Revisar qualidade</Link>
        </div></section>
      </nav>
    </header>
    <section className="card">
      <form className="portfolio-filter" onSubmit={filter}>
        <label>Número da PO<input value={draft.number} onChange={event => setDraft(value => ({ ...value, number: event.target.value }))} placeholder="18751" /></label>
        <label>Importador<input value={draft.importer} onChange={event => setDraft(value => ({ ...value, importer: event.target.value }))} placeholder="Parte do nome" /></label>
        <label>Produto<input value={draft.product} onChange={event => setDraft(value => ({ ...value, product: event.target.value }))} placeholder="Código ou descrição" /></label>
        <label>IP vinculado<input value={draft.ipNumber} onChange={event => setDraft(value => ({ ...value, ipNumber: event.target.value }))} placeholder="Número do IP" /></label>
        <button className="button" type="submit">Aplicar filtros</button>
        <button className="button secondary" type="button" onClick={() => { setDraft(emptyFilters); navigate(emptyFilters, 1); }}>Limpar</button>
      </form>
      <p className="muted">A busca por produto usa o código ou a descrição das linhas históricas e dos itens cadastrados. O saldo operacional aparece dentro de cada PO.</p>
    </section>
    <section aria-label="Visão da carteira" aria-live="polite">
      <div className="metric-grid">
        <div className="metric"><span>POs no recorte</span><strong>{summaryLoading ? "…" : summary?.purchaseOrders.toLocaleString("pt-BR") ?? "—"}</strong></div>
        <div className="metric"><span>IPs das POs encontradas</span><strong>{summaryLoading ? "…" : summary?.linkedProcesses.toLocaleString("pt-BR") ?? "—"}</strong></div>
        <div className="metric"><span>Linhas da planilha</span><strong>{summaryLoading ? "…" : summary?.lines.toLocaleString("pt-BR") ?? "—"}</strong></div>
        <div className="metric"><span>Linhas sem IP</span><strong>{summaryLoading ? "…" : summary?.linesWithoutIp.toLocaleString("pt-BR") ?? "—"}</strong></div>
      </div>
      {summary && <p className="muted">Snapshot histórico registrado: {summary.sourceSnapshotAt
        ? formatUsDateTime(summary.sourceSnapshotAt) : "sem linhas de origem no recorte"}. Isso não representa atualização do TOTVS.</p>}
      {summaryError && <p className="notice error" role="alert">{summaryError}</p>}
      {summary && summary.byImporter.length > 1 && <div className="card">
        <h2>POs por importador</h2>
        <div className="table-scroll"><table><thead><tr><th>Importador</th><th>POs</th></tr></thead>
          <tbody>{summary.byImporter.map(item => <tr key={item.importer}><td>{item.importer}</td>
            <td>{item.purchaseOrders.toLocaleString("pt-BR")}</td></tr>)}</tbody></table></div>
      </div>}
    </section>
    <section className="card" aria-live="polite">
      {loading && <p role="status">Carregando carteira…</p>}
      {error && <div className="notice error" role="alert"><p>{error}</p><button className="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></div>}
      {!loading && !error && result && <>
        <p>{result.totalCount} POs encontradas{result.totalCount > 0 && ` · página ${page} de ${totalPages}`}</p>
        {result.totalCount > 0 && <p><button className="button secondary" type="button" disabled={exporting}
          onClick={() => void downloadCsv()}>{exporting ? "Preparando CSV…" : "Exportar carteira filtrada (CSV)"}</button></p>}
        <p className="muted">O CSV contém campos e contagens da carteira visíveis no seu escopo; não inclui saldo nem valores monetários.</p>
        {exportError && <p className="notice error" role="alert">{exportError}</p>}
        {result.items.length === 0 && result.totalCount > 0 ? <p>Esta página está fora do intervalo. <button className="button" onClick={() => navigate(applied, 1)}>Ir para a primeira página</button></p> : null}
        {result.totalCount === 0 ? <p>Nenhuma PO encontrada. Revise os filtros ou limpe a busca.</p> : null}
        {result.items.length > 0 && <div className="table-scroll"><table>
          <thead><tr><th>PO TOTVS</th><th>Importador</th><th>Itens da planilha</th><th>Itens operacionais</th><th>IPs</th><th>Linhas sem IP</th><th>Pendências</th><th>Ação</th></tr></thead>
          <tbody>{result.items.map(order => <tr key={order.id}>
            <td><strong>{order.number}</strong></td><td>{order.importer}</td>
            <td>{order.historicalItemCount}</td><td>{order.operationalItemCount}</td><td>{order.linkedProcessCount}</td>
            <td>{order.historicalItemsWithoutIp}</td><td>{order.unresolvedIssueCount}</td>
            <td><Link className="button" href={`/purchase-orders/${order.id}?return=${encodeURIComponent(returnPath)}`}>Abrir PO {order.number}</Link></td>
          </tr>)}</tbody>
        </table></div>}
        {totalPages > 1 && <nav className="pagination" aria-label="Páginas da carteira">
          <button className="button secondary" disabled={page <= 1} onClick={() => navigate(applied, page - 1)}>Anterior</button>
          <span>Página {page} de {totalPages}</span>
          <button className="button" disabled={page >= totalPages} onClick={() => navigate(applied, page + 1)}>Próxima</button>
        </nav>}
      </>}
    </section>
  </main>;
}
