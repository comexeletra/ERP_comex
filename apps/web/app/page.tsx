"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { formatCount } from "../lib/format-count";
import { portfolioFilterQuery, purchaseOrderListQuery, type PortfolioFilters } from "../lib/portfolio-query";

type Filters = PortfolioFilters;
type PurchaseOrder = {
  id: string; number: string; importer: string; operationalItemCount: number;
  itemsWithIp: number; itemsWithoutIp: number; linkedProcessCount: number;
  unresolvedIssueCount: number;
};
type PurchaseOrderPage = { page: number; pageSize: number; totalCount: number; items: PurchaseOrder[] };
type PortfolioSummary = { purchaseOrders: number; linkedProcesses: number; items: number;
  itemsWithIp: number; itemsWithoutIp: number;
  byImporter: Array<{ importer: string; purchaseOrders: number }> };
type PortfolioSummaryState = { query: string; value: PortfolioSummary };
type PortfolioSummaryFailure = { query: string; message: string };
type ExportJob = { id: string; status: string; errorCode: string | null; createdAt: string;
  expiresAt: string | null; downloadPath: string | null };

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
  const [exportStatus, setExportStatus] = useState("");
  const [exportError, setExportError] = useState("");
  const [recentExports, setRecentExports] = useState<ExportJob[]>([]);
  const [summaryState, setSummaryState] = useState<PortfolioSummaryState>();
  const [summaryFailure, setSummaryFailure] = useState<PortfolioSummaryFailure>();
  const [roles, setRoles] = useState<string[]>([]);

  useEffect(() => {
    apiFetch("/auth/me").then(async response => {
      if (response.ok) setRoles((await response.json() as { roles: string[] }).roles);
    }).catch(() => undefined);
    apiFetch("/api/v1/exports").then(async response => {
      if (response.ok) setRecentExports((await response.json() as { items: ExportJob[] }).items);
    }).catch(() => undefined);
  }, []);
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
    setExporting(true); setExportError(""); setExportStatus("Enviando exportação para a fila…");
    try {
      const created = await apiFetch("/api/v1/exports/purchase-orders", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          number: applied.number, importer: applied.importer,
          product: applied.product, ipNumber: applied.ipNumber,
        }),
      });
      if (!created.ok) {
        const body = await created.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? "Não foi possível iniciar a exportação.");
      }
      const { id } = await created.json() as { id: string };
      setRecentExports(current => [{ id, status: "queued", errorCode: null,
        createdAt: new Date().toISOString(), expiresAt: null, downloadPath: null }, ...current].slice(0, 20));
      let complete = false;
      while (!complete) {
        await new Promise(resolve => window.setTimeout(resolve, 1500));
        const statusResponse = await apiFetch(`/api/v1/exports/${id}`);
        if (!statusResponse.ok) throw new Error("Não foi possível consultar o andamento da exportação.");
        const status = await statusResponse.json() as { status: string; errorCode?: string | null };
        setRecentExports(current => current.map(job => job.id === id
          ? { ...job, status: status.status, errorCode: status.errorCode ?? null,
            downloadPath: status.status === "completed" ? `/api/v1/exports/${id}/download` : null }
          : job));
        if (status.status === "failed") {
          throw new Error(status.errorCode === "EXPORT_TOO_LARGE"
            ? "A exportação suporta até 5.000 POs. Refine os filtros e tente novamente."
            : "A exportação falhou. Tente novamente mais tarde.");
        }
        if (status.status === "completed") complete = true;
        else setExportStatus(status.status === "running" ? "Gerando CSV em segundo plano…" : "Aguardando processamento…");
      }
      setExportStatus("Baixando arquivo…");
      const file = await apiFetch(`/api/v1/exports/${id}/download`);
      if (!file.ok) throw new Error("O arquivo expirou ou não está mais disponível. Gere uma nova exportação.");
      const blob = await file.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `carteira-pos-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      apiFetch("/api/v1/exports").then(async response => {
        if (response.ok) setRecentExports((await response.json() as { items: ExportJob[] }).items);
      }).catch(() => undefined);
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : "Erro inesperado na exportação.");
    } finally { setExporting(false); setExportStatus(""); }
  }

  const totalPages = result ? Math.ceil(result.totalCount / pageSize) : 0;
  const returnPath = `/?${queryFor(applied, page)}`;
  const byImporter = Array.isArray(summary?.byImporter) ? summary.byImporter : [];
  return <main className="shell">
    <header className="page-header portfolio-header">
      <p className="eyebrow">ERP Comex</p><h1>Carteira de POs TOTVS</h1>
      <p>Pré embarque: cadastre a PO e distribua as quantidades aos IPs. O pós embarque é preenchido uma vez por IP e aparece nas linhas vinculadas.</p>
      {roles.some(role => ["Master", "Administrador", "Importação", "Compras"].includes(role)) &&
        <p><Link className="button" href="/purchase-orders/new">Cadastrar PO</Link></p>}
      <p><Link className="text-link" href="/reports/pre">Indicadores de POs</Link> · <Link className="text-link" href="/quality">Revisar qualidade</Link></p>
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
      <p className="muted">Busque pelo código ou pela descrição do item. Consulte as quantidades e os saldos dentro de cada PO.</p>
    </section>
    <section aria-label="Visão da carteira" aria-live="polite">
      <div className="metric-grid">
        <div className="metric"><span>POs no recorte</span><strong>{summaryLoading ? "…" : formatCount(summary?.purchaseOrders)}</strong></div>
        <div className="metric"><span>IPs das POs encontradas</span><strong>{summaryLoading ? "…" : formatCount(summary?.linkedProcesses)}</strong></div>
        <div className="metric"><span>Itens nas POs</span><strong>{summaryLoading ? "…" : formatCount(summary?.items)}</strong></div>
        <div className="metric"><span>Itens sem IP</span><strong>{summaryLoading ? "…" : formatCount(summary?.itemsWithoutIp)}</strong></div>
      </div>
      {summary && <p className="muted">Itens e quantidades registrados para as POs deste recorte.</p>}
      {summaryError && <p className="notice error" role="alert">{summaryError}</p>}
      {byImporter.length > 1 && <div className="card">
        <h2>POs por importador</h2>
        <div className="table-scroll"><table><thead><tr><th>Importador</th><th>POs</th></tr></thead>
          <tbody>{byImporter.map(item => <tr key={item.importer}><td>{item.importer}</td>
            <td>{formatCount(item.purchaseOrders)}</td></tr>)}</tbody></table></div>
      </div>}
    </section>
    <section className="card" aria-live="polite">
      {loading && <p role="status">Carregando carteira…</p>}
      {error && <div className="notice error" role="alert"><p>{error}</p><button className="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></div>}
      {!loading && !error && result && <>
        <p>{result.totalCount} POs encontradas{result.totalCount > 0 && ` · página ${page} de ${totalPages}`}</p>
        {result.totalCount > 0 && <p><button className="button secondary" type="button" disabled={exporting}
          onClick={() => void downloadCsv()}>{exporting ? "Processando exportação…" : "Exportar carteira filtrada (CSV)"}</button></p>}
        {exportStatus && <p className="muted" role="status">{exportStatus}</p>}
        {recentExports.length > 0 && <details className="historical-disclosure"><summary>Exportações recentes</summary>
          <ul>{recentExports.slice(0, 5).map(job => <li key={job.id}>
            {new Date(job.createdAt).toLocaleString("pt-BR")} · {job.status === "queued" ? "na fila"
              : job.status === "running" ? "em processamento" : job.status === "completed" ? "concluída"
                : job.status === "failed" ? "falhou" : job.status}
            {job.downloadPath && <> · <a className="text-link" href={job.downloadPath}>Baixar CSV</a></>}
            {job.status === "failed" && job.errorCode === "EXPORT_TOO_LARGE" && " · limite de 5.000 POs"}
          </li>)}</ul>
        </details>}
        <p className="muted">O CSV contém campos e contagens da carteira visíveis no seu escopo; não inclui saldo nem valores monetários.</p>
        {exportError && <p className="notice error" role="alert">{exportError}</p>}
        {result.items.length === 0 && result.totalCount > 0 ? <p>Esta página está fora do intervalo. <button className="button" onClick={() => navigate(applied, 1)}>Ir para a primeira página</button></p> : null}
        {result.totalCount === 0 ? <p>Nenhuma PO encontrada. Revise os filtros ou limpe a busca.</p> : null}
        {result.items.length > 0 && <div className="table-scroll"><table>
          <thead><tr><th>PO TOTVS</th><th>Importador</th><th>Itens</th><th>IPs</th><th>Itens sem IP</th><th>Pendências</th><th>Ação</th></tr></thead>
          <tbody>{result.items.map(order => <tr key={order.id}>
            <td><strong>{order.number}</strong></td><td>{order.importer}</td>
            <td>{order.operationalItemCount}</td><td>{order.linkedProcessCount}</td>
            <td>{order.itemsWithoutIp}</td><td>{order.unresolvedIssueCount}</td>
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
