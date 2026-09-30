"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

type Item = { id: string; sourceSheetName: string; sourceRowNumber: number; sourceValues: Record<string, unknown>; importer: string; sourcePoNumber: string | null; sourceIpNumber: string | null; purchaseOrderId: string | null; poNumber: string | null; processId: string | null; ipNumber: string | null; legacyStatus: string | null; reason: string; alsoWithoutPo: boolean; alsoWithoutIp: boolean };
type Page = { page: number; pageSize: number; totalCount: number; items: Item[] };

export default function LegacyQueue({ kind }: { kind: "pending-import-items" | "unassigned-po-items" }) {
  const withoutIp = kind === "pending-import-items";
  const [draft, setDraft] = useState({ reference: "", importer: "" });
  const [filters, setFilters] = useState(draft);
  const [page, setPage] = useState(1);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<Page>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initial = { reference: params.get(withoutIp ? "poNumber" : "ipNumber") ?? "", importer: params.get("importer") ?? "" };
    const number = Number(params.get("page"));
    setDraft(initial); setFilters(initial); setPage(Number.isSafeInteger(number) && number > 0 ? number : 1); setReady(true);
  }, [withoutIp]);
  function query(nextFilters: typeof draft, nextPage: number) {
    const params = new URLSearchParams({ page: String(nextPage), pageSize: "50" });
    if (nextFilters.reference.trim()) params.set(withoutIp ? "poNumber" : "ipNumber", nextFilters.reference.trim());
    if (nextFilters.importer.trim()) params.set("importer", nextFilters.importer.trim());
    return params;
  }
  function navigate(nextFilters: typeof draft, nextPage: number) {
    setFilters(nextFilters); setPage(nextPage);
    window.history.replaceState(null, "", `/${kind}?${query(nextFilters, nextPage)}`);
  }
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController(); setLoading(true); setError(undefined); setData(undefined);
    apiFetch(`/api/v1/${kind}?${query(filters, page)}`, { signal: controller.signal })
      .then(async response => {
        if (response.status === 401) throw new Error("Sua sessão expirou. Entre novamente.");
        if (response.status === 403) throw new Error("Seu acesso não permite consultar esta fila.");
        if (!response.ok) throw new Error("Não foi possível carregar a fila.");
        return response.json() as Promise<Page>;
      }).then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Erro inesperado."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, filters, page, ready, retry]);
  function apply(event: FormEvent<HTMLFormElement>) { event.preventDefault(); navigate(draft, 1); }
  const pages = data ? Math.ceil(data.totalCount / 50) : 0;
  return <main className="shell"><Link className="back" href="/">← Carteira de POs</Link>
    <header className="page-header"><p className="eyebrow">Histórico Excel · escopo por importador</p><h1>{withoutIp ? "Linhas sem IP" : "Linhas sem PO"}</h1>
      <p>Uma mesma linha de origem pode estar nas duas filas. O status histórico não define uma solicitação nova. A associação operacional aguarda regra aprovada.</p>
      <Link className="text-link" href={withoutIp ? "/unassigned-po-items" : "/pending-import-items"}>Ver também linhas {withoutIp ? "sem PO" : "sem IP"} →</Link>
    </header>
    <section className="card"><form className="quality-filter" onSubmit={apply}>
      <label>{withoutIp ? "PO na origem" : "IP na origem"}<input value={draft.reference} onChange={event => setDraft({ ...draft, reference: event.target.value })} /></label>
      <label>Importador<input value={draft.importer} onChange={event => setDraft({ ...draft, importer: event.target.value })} /></label>
      <button className="button">Filtrar</button>
    </form></section>
    <section className="card" aria-live="polite">
      {loading && <p role="status">Carregando linhas…</p>}
      {error && <div className="notice error" role="alert"><p>{error}</p><button className="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></div>}
      {!loading && !error && data && <><p>{data.totalCount} linhas encontradas{pages > 0 && ` · página ${page} de ${pages}`}</p>
        {data.items.length === 0 && <p>{data.totalCount ? "Página fora do intervalo." : "Nenhuma linha encontrada."}</p>}
        {data.items.length > 0 && <div className="table-scroll"><table><thead><tr><th>Origem</th><th>Importador</th><th>PO</th><th>IP</th><th>Motivo</th><th>Status de origem</th><th>Células</th></tr></thead><tbody>
          {data.items.map(item => <tr key={item.id}><td>{item.sourceSheetName} · {item.sourceRowNumber}</td><td>{item.importer}</td><td>{item.purchaseOrderId ? <Link className="text-link" href={`/purchase-orders/${item.purchaseOrderId}`}>{item.poNumber}</Link> : item.sourcePoNumber || "Sem PO"}</td><td>{item.processId ? <Link className="text-link" href={`/processes/${item.processId}`}>{item.ipNumber}</Link> : item.sourceIpNumber || "Sem IP"}</td><td>{item.reason}{item.alsoWithoutPo && withoutIp ? "; também sem PO" : ""}{item.alsoWithoutIp && !withoutIp ? "; também sem IP" : ""}</td><td>{item.legacyStatus ?? "—"}</td><td><details><summary>Ver células</summary><dl className="source-values">{Object.entries(item.sourceValues ?? {}).map(([column, value]) => <div key={column}><dt>{column}{item.sourceRowNumber}</dt><dd>{value == null ? "—" : String(value)}</dd></div>)}</dl></details></td></tr>)}
        </tbody></table></div>}
        {pages > 1 && <nav className="pagination"><button className="button secondary" disabled={page <= 1} onClick={() => navigate(filters, page - 1)}>Anterior</button><span>Página {page} de {pages}</span><button className="button" disabled={page >= pages} onClick={() => navigate(filters, page + 1)}>Próxima</button></nav>}
      </>}
    </section>
  </main>;
}
