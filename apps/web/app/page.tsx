"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

type Filters = { number: string; importer: string; product: string; ipNumber: string };
type PurchaseOrder = {
  id: string; number: string; importer: string; identityStatus: string;
  officialItemsKnown: boolean; historicalItemCount: number; linkedProcessCount: number;
  historicalItemsWithIp: number; historicalItemsWithoutIp: number;
  unresolvedIssueCount: number; balanceAvailable: boolean;
};
type PurchaseOrderPage = { page: number; pageSize: number; totalCount: number; items: PurchaseOrder[] };
const emptyFilters: Filters = { number: "", importer: "", product: "", ipNumber: "" };
const pageSize = 50;

function queryFor(filters: Filters, page: number) {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  for (const key of Object.keys(emptyFilters) as (keyof Filters)[]) {
    if (filters[key].trim()) query.set(key, filters[key].trim());
  }
  return query;
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

  const totalPages = result ? Math.ceil(result.totalCount / pageSize) : 0;
  const returnPath = `/?${queryFor(applied, page)}`;
  return <main className="shell">
    <header className="page-header">
      <p className="eyebrow">ERP Comex</p><h1>Carteira de POs TOTVS</h1>
      <p>Uma linha por pedido. Abra a PO para consultar observações históricas, IPs vinculados e pendências.</p>
      <Link className="text-link" href="/quality">Revisar qualidade do histórico →</Link>
    </header>
    <section className="card">
      <form className="portfolio-filter" onSubmit={filter}>
        <label>Número da PO<input value={draft.number} onChange={event => setDraft(value => ({ ...value, number: event.target.value }))} placeholder="18751" /></label>
        <label>Importador<input value={draft.importer} onChange={event => setDraft(value => ({ ...value, importer: event.target.value }))} placeholder="Parte do nome" /></label>
        <label>Produto na origem<input value={draft.product} onChange={event => setDraft(value => ({ ...value, product: event.target.value }))} placeholder="Código ou descrição" /></label>
        <label>IP vinculado<input value={draft.ipNumber} onChange={event => setDraft(value => ({ ...value, ipNumber: event.target.value }))} placeholder="Número do IP" /></label>
        <button className="button" type="submit">Aplicar filtros</button>
        <button className="button secondary" type="button" onClick={() => { setDraft(emptyFilters); navigate(emptyFilters, 1); }}>Limpar</button>
      </form>
      <p className="muted">Produto pesquisa código ou descrição nas observações de origem. Fornecedor e saldo oficiais ainda não estão confirmados.</p>
    </section>
    <section className="card" aria-live="polite">
      {loading && <p role="status">Carregando carteira…</p>}
      {error && <div className="notice error" role="alert"><p>{error}</p><button className="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></div>}
      {!loading && !error && result && <>
        <p>{result.totalCount} POs encontradas{result.totalCount > 0 && ` · página ${page} de ${totalPages}`}</p>
        {result.items.length === 0 && result.totalCount > 0 ? <p>Esta página está fora do intervalo. <button className="button" onClick={() => navigate(applied, 1)}>Ir para a primeira página</button></p> : null}
        {result.totalCount === 0 ? <p>Nenhuma PO encontrada. Revise os filtros ou limpe a busca.</p> : null}
        {result.items.length > 0 && <div className="table-scroll"><table>
          <thead><tr><th>PO TOTVS</th><th>Importador</th><th>Observações históricas</th><th>IPs</th><th>Linhas sem IP</th><th>Pendências</th><th>Ação</th></tr></thead>
          <tbody>{result.items.map(order => <tr key={order.id}>
            <td><strong>{order.number}</strong></td><td>{order.importer}</td>
            <td>{order.historicalItemCount}</td><td>{order.linkedProcessCount}</td>
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
