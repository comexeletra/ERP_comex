"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

type Process = { id: string; ipNumber: string; importer: string; logisticsStatus: string | null; qualityStatus: string; purchaseOrderCount: number; historicalLineCount: number; operationalAllocationCount: number; historicalCostCount: number };
type Page = { page: number; pageSize: number; totalCount: number; items: Process[] };
const empty = { ipNumber: "", importer: "", logisticsStatus: "", qualityStatus: "" };
type Filters = typeof empty;

export default function ProcessDirectory() {
  const [draft, setDraft] = useState<Filters>(empty);
  const [filters, setFilters] = useState<Filters>(empty);
  const [page, setPage] = useState(1);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<Page>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [roles, setRoles] = useState<string[]>([]);

  useEffect(() => {
    apiFetch("/auth/me").then(async response => {
      if (response.ok) setRoles((await response.json() as { roles: string[] }).roles);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initial = { ipNumber: params.get("ipNumber") ?? "", importer: params.get("importer") ?? "", logisticsStatus: params.get("logisticsStatus") ?? "", qualityStatus: params.get("qualityStatus") ?? "" };
    const number = Number(params.get("page"));
    setDraft(initial); setFilters(initial); setPage(Number.isSafeInteger(number) && number > 0 ? number : 1); setReady(true);
  }, []);

  function query(nextFilters: Filters, nextPage: number) {
    const params = new URLSearchParams({ page: String(nextPage), pageSize: "50" });
    for (const key of Object.keys(empty) as (keyof Filters)[]) if (nextFilters[key].trim()) params.set(key, nextFilters[key].trim());
    return params;
  }
  function navigate(nextFilters: Filters, nextPage: number) {
    setFilters(nextFilters); setPage(nextPage);
    window.history.replaceState(null, "", `/processes?${query(nextFilters, nextPage)}`);
  }
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController(); setLoading(true); setError(undefined); setData(undefined);
    apiFetch(`/api/v1/processes?${query(filters, page)}`, { signal: controller.signal })
      .then(async response => {
        if (response.status === 401) throw new Error("Sua sessão expirou. Entre novamente.");
        if (response.status === 403) throw new Error("Seu acesso não permite consultar IPs.");
        if (!response.ok) throw new Error("Não foi possível carregar os IPs.");
        return response.json() as Promise<Page>;
      })
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Erro inesperado."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, page, ready, retry]);

  function apply(event: FormEvent<HTMLFormElement>) { event.preventDefault(); navigate(draft, 1); }
  const pages = data ? Math.ceil(data.totalCount / 50) : 0;
  const returnPath = `/processes?${query(filters, page)}`;
  return <main className="shell">
    <Link className="back" href="/">← Carteira de POs</Link>
    <header className="page-header"><p className="eyebrow">Execução logística</p><h1>Processos de importação</h1><p>IPs históricos e operacionais, com POs relacionadas e custos históricos no próprio IP.</p>
      {roles.some(role => ["Master", "Administrador", "Importação"].includes(role)) &&
        <p><Link className="button" href="/processes/new">Criar IP</Link></p>}
      <Link className="text-link" href="/pending-import-items">Linhas sem IP →</Link> · <Link className="text-link" href="/unassigned-po-items">Linhas sem PO →</Link>
    </header>
    <section className="card"><form className="portfolio-filter" onSubmit={apply}>
      <label>IP<input value={draft.ipNumber} onChange={event => setDraft({ ...draft, ipNumber: event.target.value })} placeholder="NH-017/2025" /></label>
      <label>Importador<input value={draft.importer} onChange={event => setDraft({ ...draft, importer: event.target.value })} /></label>
      <label>Status logístico<input value={draft.logisticsStatus} onChange={event => setDraft({ ...draft, logisticsStatus: event.target.value })} /></label>
      <label>Qualidade<input value={draft.qualityStatus} onChange={event => setDraft({ ...draft, qualityStatus: event.target.value })} /></label>
      <button className="button">Filtrar</button><button type="button" className="button secondary" onClick={() => { setDraft(empty); navigate(empty, 1); }}>Limpar</button>
    </form></section>
    <section className="card" aria-live="polite">
      {loading && <p role="status">Carregando IPs…</p>}
      {error && <div className="notice error" role="alert"><p>{error}</p><button className="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></div>}
      {!loading && !error && data && <><p>{data.totalCount} IPs encontrados{pages > 0 && ` · página ${page} de ${pages}`}</p>
        {data.items.length === 0 && <p>{data.totalCount ? "Página fora do intervalo." : "Nenhum IP encontrado."}</p>}
        {data.items.length > 0 && <div className="table-scroll"><table><thead><tr><th>IP</th><th>Importador</th><th>Status logístico</th><th>Qualidade</th><th>POs</th><th>Distribuições</th><th>Linhas de origem</th><th>Custos históricos</th><th></th></tr></thead><tbody>
          {data.items.map(item => <tr key={item.id}><td>{item.ipNumber}</td><td>{item.importer}</td><td>{item.logisticsStatus ?? "Não informado"}</td><td>{item.qualityStatus}</td><td>{item.purchaseOrderCount}</td><td>{item.operationalAllocationCount}</td><td>{item.historicalLineCount}</td><td>{item.historicalCostCount}</td><td><Link className="button" aria-label={`Abrir IP ${item.ipNumber}`} href={`/processes/${item.id}?return=${encodeURIComponent(returnPath)}`}>Abrir IP</Link></td></tr>)}
        </tbody></table></div>}
        {pages > 1 && <nav className="pagination"><button className="button secondary" disabled={page <= 1} onClick={() => navigate(filters, page - 1)}>Anterior</button><span>Página {page} de {pages}</span><button className="button" disabled={page >= pages} onClick={() => navigate(filters, page + 1)}>Próxima</button></nav>}
      </>}
    </section>
  </main>;
}
