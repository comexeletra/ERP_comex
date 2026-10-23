"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { emptyProcessDirectoryFilters, parseProcessDirectoryFilters, processCalculatedStatuses, processDirectoryQuery,
  type ProcessDirectoryFilters, type ProcessDirectoryRecordStatus } from "../lib/ip-lifecycle";

type Process = { id: string; ipNumber: string; importer: string; logisticsStatus: string | null; calculatedStatus?: string; lifecycleStatus?: "OPEN" | "CLOSED"; recordStatus?: "DRAFT" | "ACTIVE" | "CANCELLED" | "DELETED"; qualityStatus: string; purchaseOrderCount: number; historicalLineCount: number; operationalAllocationCount: number; historicalCostCount: number };
type Page = { page: number; pageSize: number; totalCount: number; items: Process[] };
const empty = emptyProcessDirectoryFilters;
type Filters = ProcessDirectoryFilters;

export default function ProcessDirectory() {
  const [draft, setDraft] = useState<Filters>(empty);
  const [filters, setFilters] = useState<Filters>(empty);
  const [page, setPage] = useState(1);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<Page>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [compatibilityWarning, setCompatibilityWarning] = useState("");
  const [retry, setRetry] = useState(0);
  const [roles, setRoles] = useState<string[]>([]);

  useEffect(() => {
    apiFetch("/auth/me").then(async response => {
      if (response.ok) setRoles((await response.json() as { roles: string[] }).roles);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initial = parseProcessDirectoryFilters(params);
    const number = Number(params.get("page"));
    setDraft(initial); setFilters(initial); setPage(Number.isSafeInteger(number) && number > 0 ? number : 1); setReady(true);
  }, []);

  function query(nextFilters: Filters, nextPage: number) {
    return processDirectoryQuery(nextFilters, nextPage);
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
      .then(value => {
        if (!Array.isArray(value.items)) throw new Error("A API não retornou a lista de IPs.");
        if (!controller.signal.aborted) {
          setCompatibilityWarning(value.items.some(item =>
            (item.lifecycleStatus !== "OPEN" && item.lifecycleStatus !== "CLOSED") || !item.recordStatus)
            ? "A API dos IPs está desatualizada. O ciclo não pode ser conferido até sua atualização."
            : "");
          setData(value);
        }
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Erro inesperado."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, page, ready, retry]);

  function apply(event: FormEvent<HTMLFormElement>) { event.preventDefault(); navigate(draft, 1); }
  const pages = data ? Math.ceil(data.totalCount / 50) : 0;
  const returnPath = `/processes?${query(filters, page)}`;
  return <main className="shell">
    <Link className="back" href="/">← Carteira de POs</Link>
    <header className="page-header"><p className="eyebrow">Pós embarque</p><h1>IPs e quantidades vinculadas</h1><p>Preencha cada IP uma vez; seus dados aparecem nas linhas de todas as POs vinculadas.</p>
      {roles.some(role => ["Master", "Administrador", "Importação"].includes(role)) &&
        <p><Link className="button" href="/processes/new">Criar IP</Link></p>}
      <Link className="text-link" href="/reports/post">Indicadores de IPs</Link> · <Link className="text-link" href="/pending-import-items">Linhas sem IP →</Link> · <Link className="text-link" href="/unassigned-po-items">Linhas sem PO →</Link>
    </header>
    <section className="card"><form className="portfolio-filter" onSubmit={apply}>
      <label>IP<input value={draft.ipNumber} onChange={event => setDraft({ ...draft, ipNumber: event.target.value })} placeholder="NH-017/2025" /></label>
      <label>Importador<input value={draft.importer} onChange={event => setDraft({ ...draft, importer: event.target.value })} /></label>
      <label>Status<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as ProcessDirectoryFilters["status"] })}>
        <option value="">Todos</option>
        {processCalculatedStatuses.map(status => <option key={status} value={status}>{status}</option>)}
      </select></label>
      <label>Qualidade<input value={draft.qualityStatus} onChange={event => setDraft({ ...draft, qualityStatus: event.target.value })} /></label>
      <label>Situação do IP<select value={draft.recordStatus} onChange={event => setDraft({ ...draft, recordStatus: event.target.value as ProcessDirectoryRecordStatus })}>
        <option value="">Ativos, rascunhos e cancelados</option>
        <option value="active">Ativos</option><option value="draft">Rascunhos</option>
        <option value="cancelled">Cancelados</option><option value="deleted">Excluídos</option>
        <option value="all">Todos</option>
      </select></label>
      <button className="button">Filtrar</button><button type="button" className="button secondary" onClick={() => { setDraft(empty); navigate(empty, 1); }}>Limpar</button>
    </form></section>
    <section className="card" aria-live="polite">
      {loading && <p role="status">Carregando IPs…</p>}
      {error && <div className="notice error" role="alert"><p>{error}</p><button className="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></div>}
      {compatibilityWarning && <p className="notice" role="status">{compatibilityWarning}</p>}
      {!loading && !error && data && <><p>{data.totalCount} IPs encontrados{pages > 0 && ` · página ${page} de ${pages}`}</p>
        {data.items.length === 0 && <p>{data.totalCount ? "Página fora do intervalo." : "Nenhum IP encontrado."}</p>}
        {data.items.length > 0 && <div className="table-scroll"><table><thead><tr><th>IP</th><th>Registro</th><th>Importador</th><th>Status</th><th>Ciclo do IP</th><th>Qualidade</th><th>POs</th><th>Distribuições</th><th>Linhas de origem</th><th>Custos históricos</th><th></th></tr></thead><tbody>
          {data.items.map(item => <tr key={item.id}><td>{item.ipNumber}</td><td>{item.recordStatus === "DRAFT" ? "Rascunho" : item.recordStatus === "CANCELLED" ? "Cancelado" : item.recordStatus === "DELETED" ? "Excluído" : "Ativo"}</td><td>{item.importer}</td><td>{item.calculatedStatus ?? item.logisticsStatus ?? "Não informado"}</td><td>{item.lifecycleStatus === "CLOSED" ? "Encerrado" : item.lifecycleStatus === "OPEN" ? "Aberto" : "Indisponível"}</td><td>{item.qualityStatus}</td><td>{item.purchaseOrderCount}</td><td>{item.operationalAllocationCount}</td><td>{item.historicalLineCount}</td><td>{item.historicalCostCount}</td><td><Link className="button" aria-label={`Abrir IP ${item.ipNumber}`} href={`/processes/${item.id}?return=${encodeURIComponent(returnPath)}`}>Abrir IP</Link></td></tr>)}
        </tbody></table></div>}
        {pages > 1 && <nav className="pagination"><button className="button secondary" disabled={page <= 1} onClick={() => navigate(filters, page - 1)}>Anterior</button><span>Página {page} de {pages}</span><button className="button" disabled={page >= pages} onClick={() => navigate(filters, page + 1)}>Próxima</button></nav>}
      </>}
    </section>
  </main>;
}
