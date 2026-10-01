"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";

type Sheet = "all" | "Pré Embarque" | "Pós Embarque";
type Gap = "all" | "without-ip" | "without-po" | "quality" | "any";
type SourceRow = {
  id: string; batchId: string; sourceSheetName: string; sourceRowNumber: number;
  importer: string; sourceValues: Record<string, string | null>; cellErrors: string[];
  poNumber: string | null; ipNumber: string | null;
  auditFlags: { withoutPurchaseOrder: boolean; withoutValidIp: boolean;
    openQualityIssues: number; cellErrors: number; anyGap: boolean };
};
type AuditResult = {
  page: number; pageSize: number; totalCount: number; rowsBeforeGapFilter: number;
  summary: { withoutPurchaseOrder: number; withoutValidIp: number; withQualityIssues: number; anyGap: number };
  columns: string[]; columnHeaders: Record<string, string>; items: SourceRow[];
};
type Importer = { code: string };

const emptyFilters = { importer: "", search: "", gap: "all" as Gap };
const pageSizeOptions = [25, 50, 100];
const sheetOptions: Array<{ value: Sheet; label: string }> = [
  { value: "all", label: "Todas as linhas" },
  { value: "Pré Embarque", label: "Pré Embarque" },
  { value: "Pós Embarque", label: "Pós Embarque" },
];
const gapOptions: Array<{ value: Gap; label: string }> = [
  { value: "all", label: "Todos os registros" },
  { value: "any", label: "Qualquer gap" },
  { value: "without-ip", label: "Sem IP válido" },
  { value: "without-po", label: "Sem PO" },
  { value: "quality", label: "Com problema de qualidade" },
];

function readLocation() {
  const params = new URLSearchParams(window.location.search);
  let columnFilters: Record<string, string> = {};
  try { columnFilters = JSON.parse(params.get("filters") ?? "{}"); } catch { /* use empty filters */ }
  return {
    sheet: (sheetOptions.some(option => option.value === params.get("sheet")) ? params.get("sheet") : "Pré Embarque") as Sheet,
    filters: { importer: params.get("importer") ?? "", search: params.get("search") ?? "",
      gap: (gapOptions.some(option => option.value === params.get("gap")) ? params.get("gap") : "all") as Gap },
    columnFilters: columnFilters && typeof columnFilters === "object" && !Array.isArray(columnFilters) ? columnFilters : {},
    page: Math.max(1, Number(params.get("page")) || 1),
    pageSize: pageSizeOptions.includes(Number(params.get("pageSize"))) ? Number(params.get("pageSize")) : 50,
  };
}

function makeQuery(sheet: Sheet, filters: typeof emptyFilters, columnFilters: Record<string, string>, page: number, pageSize: number) {
  const params = new URLSearchParams({ sheet, page: String(page), pageSize: String(pageSize), gap: filters.gap });
  if (filters.importer) params.set("importer", filters.importer);
  if (filters.search) params.set("search", filters.search);
  const activeColumnFilters = Object.fromEntries(Object.entries(columnFilters).filter(([, value]) => value.trim()));
  if (Object.keys(activeColumnFilters).length) params.set("filters", JSON.stringify(activeColumnFilters));
  return params;
}

function display(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function SourceAuditPage() {
  const [sheet, setSheet] = useState<Sheet>("Pré Embarque");
  const [draft, setDraft] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [draftColumnFilters, setDraftColumnFilters] = useState<Record<string, string>>({});
  const [appliedColumnFilters, setAppliedColumnFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [importers, setImporters] = useState<Importer[]>([]);
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState<AuditResult>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const state = readLocation();
    setSheet(state.sheet); setDraft(state.filters); setApplied(state.filters);
    setDraftColumnFilters(state.columnFilters); setAppliedColumnFilters(state.columnFilters);
    setPage(state.page); setPageSize(state.pageSize); setReady(true);
    apiFetch("/api/v1/importers").then(async response => {
      if (!response.ok) return;
      setImporters((await response.json() as { items: Importer[] }).items);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const query = makeQuery(sheet, applied, appliedColumnFilters, page, pageSize);
    setLoading(true); setError(undefined); setResult(undefined);
    apiFetch(`/api/v1/source-rows?${query}`, { signal: controller.signal })
      .then(async response => {
        if (response.status === 401) throw new Error("Sua sessão expirou. Entre novamente.");
        if (response.status === 403) throw new Error("Seu acesso não permite consultar estas linhas de origem.");
        if (!response.ok) throw new Error("Não foi possível carregar a tabela de auditoria.");
        return await response.json() as AuditResult;
      })
      .then(data => { if (!controller.signal.aborted) setResult(data); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Erro inesperado."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [sheet, applied, appliedColumnFilters, page, pageSize, ready, retry]);

  function updateUrl(nextSheet: Sheet, filters: typeof emptyFilters, columns: Record<string, string>, nextPage: number, size: number) {
    window.history.replaceState(null, "", `/source-audit?${makeQuery(nextSheet, filters, columns, nextPage, size)}`);
  }
  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextFilters = { importer: draft.importer, search: draft.search.trim(), gap: draft.gap };
    setApplied(nextFilters); setAppliedColumnFilters(draftColumnFilters); setPage(1);
    updateUrl(sheet, nextFilters, draftColumnFilters, 1, pageSize);
  }
  function changeSheet(nextSheet: Sheet) {
    setSheet(nextSheet); setPage(1);
    const nextColumns = {};
    setDraftColumnFilters(nextColumns); setAppliedColumnFilters(nextColumns);
    updateUrl(nextSheet, applied, nextColumns, 1, pageSize);
  }
  function clearFilters() {
    setDraft(emptyFilters); setApplied(emptyFilters); setDraftColumnFilters({}); setAppliedColumnFilters({});
    setPage(1); updateUrl(sheet, emptyFilters, {}, 1, pageSize);
  }
  function goToPage(nextPage: number) {
    setPage(nextPage); updateUrl(sheet, applied, appliedColumnFilters, nextPage, pageSize);
  }
  function changePageSize(size: number) {
    setPageSize(size); setPage(1); updateUrl(sheet, applied, appliedColumnFilters, 1, size);
  }

  const totalPages = result ? Math.ceil(result.totalCount / pageSize) : 0;
  const columns = result?.columns ?? [];
  const activeFilterCount = useMemo(() => Object.values(appliedColumnFilters).filter(Boolean).length, [appliedColumnFilters]);

  return <main className="shell source-audit-shell">
    <header className="page-header">
      <p className="eyebrow">ERP Comex · Auditoria de origem</p>
      <h1>Tabela completa para auditoria</h1>
      <p>Consulte os registros das planilhas de origem em formato tabular. Os valores permanecem como foram importados; os indicadores destacam possíveis gaps para revisão.</p>
      <Link className="text-link" href="/">← Carteira de POs</Link>
    </header>

    <section className="source-audit-tabs" role="tablist" aria-label="Planilha de origem">
      {sheetOptions.map(option => <button key={option.value} role="tab" aria-selected={sheet === option.value}
        className={sheet === option.value ? "source-tab active" : "source-tab"} onClick={() => changeSheet(option.value)}>
        {option.label}
      </button>)}
    </section>

    <section className="card source-audit-controls">
      <form className="source-audit-filter" onSubmit={applyFilters}>
        <label>Importador<select value={draft.importer} onChange={event => setDraft(value => ({ ...value, importer: event.target.value }))}>
          <option value="">Todos no meu escopo</option>{importers.map(importer => <option key={importer.code} value={importer.code}>{importer.code}</option>)}
        </select></label>
        <label>Busca geral<input value={draft.search} onChange={event => setDraft(value => ({ ...value, search: event.target.value }))} placeholder="Texto em qualquer coluna" /></label>
        <label>Auditoria de gaps<select value={draft.gap} onChange={event => setDraft(value => ({ ...value, gap: event.target.value as Gap }))}>
          {gapOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
        <button className="button" type="submit">Aplicar filtros</button>
        <button className="button secondary" type="button" onClick={clearFilters}>Limpar</button>
      </form>
      <p className="muted source-filter-hint">Os filtros nas colunas procuram o texto digitado e podem ser combinados entre si. {activeFilterCount} filtro(s) de coluna aplicado(s).</p>
    </section>

    <section className="metric-grid source-audit-metrics" aria-live="polite">
      <div className="metric"><span>Linhas no recorte</span><strong>{loading ? "…" : result?.totalCount.toLocaleString("pt-BR") ?? "—"}</strong></div>
      <div className="metric"><span>Sem PO na origem</span><strong>{loading ? "…" : result?.summary.withoutPurchaseOrder.toLocaleString("pt-BR") ?? "—"}</strong></div>
      <div className="metric"><span>Sem IP válido</span><strong>{loading ? "…" : result?.summary.withoutValidIp.toLocaleString("pt-BR") ?? "—"}</strong></div>
      <div className="metric"><span>Problemas de qualidade</span><strong>{loading ? "…" : result?.summary.withQualityIssues.toLocaleString("pt-BR") ?? "—"}</strong></div>
      <div className="metric"><span>Com qualquer gap</span><strong>{loading ? "…" : result?.summary.anyGap.toLocaleString("pt-BR") ?? "—"}</strong></div>
    </section>

    <section className="card source-audit-grid-card" aria-live="polite">
      {loading && <p role="status">Carregando linhas da planilha…</p>}
      {error && <div className="notice error" role="alert"><p>{error}</p><button className="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></div>}
      {!loading && !error && result && <>
        <div className="source-grid-toolbar">
          <p><strong>{result.totalCount.toLocaleString("pt-BR")}</strong> linha(s){result.rowsBeforeGapFilter !== result.totalCount ? ` · ${result.rowsBeforeGapFilter.toLocaleString("pt-BR")} antes do filtro de gaps` : ""}
            {totalPages > 0 && ` · página ${page} de ${totalPages}`}</p>
          <label>Linhas por página<select value={pageSize} onChange={event => changePageSize(Number(event.target.value))}>
            {pageSizeOptions.map(size => <option key={size} value={size}>{size}</option>)}
          </select></label>
        </div>
        {result.items.length === 0 ? <p>Nenhuma linha corresponde aos filtros atuais.</p> :
          <div className="source-grid-scroll" role="region" aria-label="Tabela completa da planilha" tabIndex={0}>
            <table className="source-grid">
              <thead>
                <tr className="source-grid-head">
                  <th className="source-pin source-pin-1" scope="col">Linha</th>
                  <th className="source-pin source-pin-2" scope="col">Planilha</th>
                  <th className="source-pin source-pin-3" scope="col">Gap de auditoria</th>
                  {columns.map(column => <th key={column} scope="col" title={`Coluna Excel ${column}: ${result.columnHeaders[column] ?? ""}`}>
                    <span className="source-excel-col">{column}</span>{result.columnHeaders[column] || "(sem cabeçalho)"}
                  </th>)}
                </tr>
                <tr className="source-grid-filters">
                  <th className="source-pin source-pin-1"><span className="sr-only">Sem filtro para linha</span></th>
                  <th className="source-pin source-pin-2"><span className="sr-only">Sem filtro para planilha</span></th>
                  <th className="source-pin source-pin-3"><span className="sr-only">Sem filtro para gaps</span></th>
                  {columns.map(column => <th key={column}>
                    <input aria-label={`Filtrar coluna ${column} ${result.columnHeaders[column] ?? ""}`} value={draftColumnFilters[column] ?? ""}
                      onChange={event => setDraftColumnFilters(current => ({ ...current, [column]: event.target.value }))}
                      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); setAppliedColumnFilters(draftColumnFilters); setPage(1); updateUrl(sheet, applied, draftColumnFilters, 1, pageSize); } }}
                      placeholder="Filtrar…" />
                  </th>)}
                </tr>
              </thead>
              <tbody>{result.items.map(row => <tr key={row.id} className={row.auditFlags.anyGap ? "source-row-has-gap" : ""}>
                <td className="source-pin source-pin-1 source-row-number" title={`Lote ${row.batchId} · linha ${row.sourceRowNumber}`}>{row.sourceRowNumber}</td>
                <td className="source-pin source-pin-2">{row.sourceSheetName}</td>
                <td className="source-pin source-pin-3"><div className="source-gap-tags">
                  {row.auditFlags.withoutPurchaseOrder && <span className="source-gap-tag">Sem PO</span>}
                  {row.auditFlags.withoutValidIp && <span className="source-gap-tag">Sem IP</span>}
                  {row.auditFlags.openQualityIssues > 0 && <span className="source-gap-tag">{row.auditFlags.openQualityIssues} pend.</span>}
                  {row.auditFlags.cellErrors > 0 && <span className="source-gap-tag">{row.auditFlags.cellErrors} erro(s)</span>}
                  {!row.auditFlags.anyGap && <span className="source-ok-tag">Sem gap</span>}
                </div></td>
                {columns.map(column => <td key={column} title={display(row.sourceValues[column])}>{display(row.sourceValues[column])}</td>)}
              </tr>)}</tbody>
            </table>
          </div>}
        {totalPages > 1 && <nav className="pagination" aria-label="Páginas da tabela de auditoria">
          <button className="button secondary" disabled={page <= 1} onClick={() => goToPage(page - 1)}>Anterior</button>
          <span>Página {page} de {totalPages}</span>
          <button className="button" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>Próxima</button>
        </nav>}
      </>}
    </section>
  </main>;
}
