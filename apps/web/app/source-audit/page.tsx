"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "../../lib/api";
import { formatUsDate } from "../../lib/date-format";

type Sheet = "all" | "Pré Embarque" | "Pós Embarque";
type Gap = "all" | "without-ip" | "without-po" | "quality" | "any";
type Direction = "asc" | "desc";
type ColumnFilter = { text?: string; values?: string[]; exclude?: boolean };
type ColumnFilters = Record<string, ColumnFilter>;
type SortState = { column: string; direction: Direction } | null;
type SourceRow = {
  id: string; batchId: string; sourceSheetName: string; sourceRowNumber: number;
  importer: string; sourceValues: Record<string, string | null>; cellErrors: string[];
  poNumber: string | null; ipNumber: string | null;
  auditFlags: { withoutPurchaseOrder: boolean; withoutValidIp: boolean;
    cellErrors: number; anyGap: boolean };
};
type AuditResult = {
  page: number; pageSize: number; totalCount: number; rowsBeforeGapFilter: number;
  summary: { withoutPurchaseOrder: number; withoutValidIp: number; cellErrors: number; anyGap: number };
  columns: string[]; columnHeaders: Record<string, string>; items: SourceRow[];
};
type Importer = { code: string };
type ValueOption = { value: string; rowCount: number };
type ValueOptionsResult = { items: ValueOption[]; totalCount: number; hasMore: boolean };
type GridFilters = typeof emptyFilters;

const emptyFilters = { importer: "", search: "", gap: "all" as Gap };
const pageSizeOptions = [25, 50, 100];
const dateColumnsBySheet: Record<Exclude<Sheet, "all">, Set<string>> = {
  "Pré Embarque": new Set(["J", "O", "P", "Q", "AC", "AI", "AJ", "AN", "AO", "AQ", "AW", "AX"]),
  "Pós Embarque": new Set(["Q", "S", "U", "AC", "AD", "AG", "AL", "AM", "AN"]),
};
const sheetOptions: Array<{ value: Sheet; label: string }> = [
  { value: "all", label: "Todas as linhas" },
  { value: "Pré Embarque", label: "Pré Embarque" },
  { value: "Pós Embarque", label: "Pós Embarque" },
];
const gapOptions: Array<{ value: Gap; label: string }> = [
  { value: "all", label: "Todos os registros" },
  { value: "any", label: "Qualquer sinalizador" },
  { value: "without-ip", label: "Sem IP válido na origem" },
  { value: "without-po", label: "Sem PO na origem" },
  { value: "quality", label: "Célula com erro de cálculo" },
];

function readColumnFilters(raw: string | null): ColumnFilters {
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([column, value]) => {
      if (typeof value === "string") return [[column, { text: value }]];
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const filter = value as Partial<ColumnFilter>;
      return [[column, {
        ...(typeof filter.text === "string" ? { text: filter.text } : {}),
        ...(Array.isArray(filter.values) && filter.values.every(item => typeof item === "string") ? { values: filter.values } : {}),
        ...(typeof filter.exclude === "boolean" ? { exclude: filter.exclude } : {}),
      }]];
    }));
  } catch { return {}; }
}

function displayCell(sheetName: string, column: string, value: string | null): string {
  const raw = display(value);
  if (value == null) return raw;
  const dateColumns = dateColumnsBySheet[sheetName as Exclude<Sheet, "all">];
  return dateColumns?.has(column) ? formatUsDate(value) : raw;
}

function readLocation() {
  const params = new URLSearchParams(window.location.search);
  const requestedSheet = params.get("sheet");
  const requestedGap = params.get("gap");
  const sortColumn = params.get("sortColumn");
  const sortDirection = params.get("sortDirection");
  return {
    sheet: (sheetOptions.some(option => option.value === requestedSheet) ? requestedSheet : "Pré Embarque") as Sheet,
    filters: { importer: params.get("importer") ?? "", search: params.get("search") ?? "",
      gap: (gapOptions.some(option => option.value === requestedGap) ? requestedGap : "all") as Gap },
    columnFilters: readColumnFilters(params.get("filters")),
    sort: sortColumn && (sortDirection === "asc" || sortDirection === "desc")
      ? { column: sortColumn, direction: sortDirection } as SortState : null,
    page: Math.max(1, Number(params.get("page")) || 1),
    pageSize: pageSizeOptions.includes(Number(params.get("pageSize"))) ? Number(params.get("pageSize")) : 50,
  };
}

function makeQuery(sheet: Sheet, filters: GridFilters, columnFilters: ColumnFilters, page: number, pageSize: number, sort: SortState) {
  const params = new URLSearchParams({ sheet, page: String(page), pageSize: String(pageSize), gap: filters.gap });
  if (filters.importer) params.set("importer", filters.importer);
  if (filters.search) params.set("search", filters.search);
  const activeColumnFilters = Object.fromEntries(Object.entries(columnFilters).filter(([, filter]) =>
    Boolean(filter.text?.trim()) || filter.values !== undefined));
  if (Object.keys(activeColumnFilters).length) params.set("filters", JSON.stringify(activeColumnFilters));
  if (sort) { params.set("sortColumn", sort.column); params.set("sortDirection", sort.direction); }
  return params;
}

function makeValueQuery(sheet: Sheet, filters: GridFilters, columnFilters: ColumnFilters, column: string, valueSearch: string) {
  const params = new URLSearchParams({ sheet, gap: filters.gap });
  if (filters.importer) params.set("importer", filters.importer);
  if (filters.search) params.set("search", filters.search);
  const activeColumnFilters = Object.fromEntries(Object.entries(columnFilters).filter(([, filter]) =>
    Boolean(filter.text?.trim()) || filter.values !== undefined));
  if (Object.keys(activeColumnFilters).length) params.set("filters", JSON.stringify(activeColumnFilters));
  params.set("column", column);
  if (valueSearch.trim()) params.set("valueSearch", valueSearch.trim());
  return params;
}

function display(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function hasColumnFilter(filter: ColumnFilter | undefined): boolean {
  return Boolean(filter?.text?.trim()) || filter?.values !== undefined;
}

function selectedOption(filter: ColumnFilter | undefined, value: string): boolean {
  if (filter?.values === undefined) return true;
  const found = filter.values.includes(value);
  return filter.exclude ? !found : found;
}

export default function SourceAuditPage() {
  const [sheet, setSheet] = useState<Sheet>("Pré Embarque");
  const [draft, setDraft] = useState<GridFilters>(emptyFilters);
  const [applied, setApplied] = useState<GridFilters>(emptyFilters);
  const [draftColumnFilters, setDraftColumnFilters] = useState<ColumnFilters>({});
  const [appliedColumnFilters, setAppliedColumnFilters] = useState<ColumnFilters>({});
  const [draftSort, setDraftSort] = useState<SortState>(null);
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [importers, setImporters] = useState<Importer[]>([]);
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState<AuditResult>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [activeColumn, setActiveColumn] = useState<string>();
  const [filterPosition, setFilterPosition] = useState<{ left: number; top: number }>();
  const [valueSearch, setValueSearch] = useState("");
  const [valueOptions, setValueOptions] = useState<ValueOptionsResult>();
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState<string>();
  const filterPopoverRef = useRef<HTMLElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const sheetTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const state = readLocation();
    setSheet(state.sheet); setDraft(state.filters); setApplied(state.filters);
    setDraftColumnFilters(state.columnFilters); setAppliedColumnFilters(state.columnFilters);
    setDraftSort(state.sort); setSort(state.sort);
    setPage(state.page); setPageSize(state.pageSize); setReady(true);
    apiFetch("/api/v1/importers").then(async response => {
      if (!response.ok) return;
      setImporters((await response.json() as { items: Importer[] }).items);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const query = makeQuery(sheet, applied, appliedColumnFilters, page, pageSize, sort);
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
  }, [sheet, applied, appliedColumnFilters, page, pageSize, sort, ready, retry]);

  useEffect(() => {
    if (!ready || !activeColumn) { setValueOptions(undefined); return; }
    const controller = new AbortController();
    setLoadingOptions(true); setOptionsError(undefined);
    const timeout = window.setTimeout(() => {
      const query = makeValueQuery(sheet, applied, appliedColumnFilters, activeColumn, valueSearch);
      apiFetch(`/api/v1/source-rows/column-values?${query}`, { signal: controller.signal })
        .then(async response => {
          if (response.status === 401) throw new Error("Sua sessão expirou. Entre novamente.");
          if (!response.ok) throw new Error("Não foi possível carregar os valores desta coluna.");
          return await response.json() as ValueOptionsResult;
        })
        .then(data => { if (!controller.signal.aborted) setValueOptions(data); })
        .catch((reason: unknown) => { if (!controller.signal.aborted) setOptionsError(reason instanceof Error ? reason.message : "Erro inesperado."); })
        .finally(() => { if (!controller.signal.aborted) setLoadingOptions(false); });
    }, 200);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [activeColumn, applied, appliedColumnFilters, ready, retry, sheet, valueSearch]);

  useEffect(() => {
    if (!activeColumn) return;
    const closeOnScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && filterPopoverRef.current?.contains(target)) return;
      closeColumnFilter();
    };
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", closeOnScroll);
    return () => {
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", closeOnScroll);
    };
  }, [activeColumn]);

  function updateUrl(nextSheet: Sheet, filters: GridFilters, columns: ColumnFilters, nextPage: number, size: number, nextSort: SortState) {
    window.history.replaceState(null, "", `/source-audit?${makeQuery(nextSheet, filters, columns, nextPage, size, nextSort)}`);
  }
  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextFilters = { importer: draft.importer, search: draft.search.trim(), gap: draft.gap };
    setApplied(nextFilters); setAppliedColumnFilters(draftColumnFilters); setSort(draftSort); setPage(1);
    updateUrl(sheet, nextFilters, draftColumnFilters, 1, pageSize, draftSort);
  }
  function changeSheet(nextSheet: Sheet) {
    const nextColumns: ColumnFilters = {};
    setSheet(nextSheet); setPage(1); setDraftColumnFilters(nextColumns); setAppliedColumnFilters(nextColumns);
    setDraftSort(null); setSort(null);
    updateUrl(nextSheet, applied, nextColumns, 1, pageSize, null);
  }
  function moveSheetTab(index: number, event: React.KeyboardEvent<HTMLButtonElement>) {
    let nextIndex: number;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % sheetOptions.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + sheetOptions.length) % sheetOptions.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = sheetOptions.length - 1;
    else return;
    event.preventDefault();
    sheetTabRefs.current[nextIndex]?.focus();
    changeSheet(sheetOptions[nextIndex].value);
  }
  function clearFilters() {
    setDraft(emptyFilters); setApplied(emptyFilters); setDraftColumnFilters({}); setAppliedColumnFilters({});
    setDraftSort(null); setSort(null); setPage(1);
    updateUrl(sheet, emptyFilters, {}, 1, pageSize, null);
  }
  function goToPage(nextPage: number) {
    setPage(nextPage); updateUrl(sheet, applied, appliedColumnFilters, nextPage, pageSize, sort);
  }
  function changePageSize(size: number) {
    setPageSize(size); setPage(1); updateUrl(sheet, applied, appliedColumnFilters, 1, size, sort);
  }
  function openColumnFilter(column: string, event: React.MouseEvent<HTMLButtonElement>) {
    filterTriggerRef.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 24);
    const height = Math.min(500, window.innerHeight - 24);
    const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12));
    const top = rect.bottom + height + 10 < window.innerHeight
      ? rect.bottom + 6 : Math.max(12, rect.top - height - 6);
    setFilterPosition({ left, top }); setValueSearch(""); setActiveColumn(column);
  }
  function closeColumnFilter() {
    setActiveColumn(undefined);
    filterTriggerRef.current?.focus();
  }
  function updateColumnFilter(column: string, update: (current: ColumnFilter) => ColumnFilter) {
    setDraftColumnFilters(current => {
      const next = { ...current };
      const changed = update(next[column] ?? {});
      if (!changed.text?.trim() && changed.values === undefined) delete next[column];
      else next[column] = changed;
      return next;
    });
  }
  function toggleOption(column: string, value: string, checked: boolean) {
    updateColumnFilter(column, current => {
      if (current.values === undefined) {
        return checked ? current : { ...current, values: [value], exclude: true };
      }
      const values = new Set(current.values);
      if (current.exclude) checked ? values.delete(value) : values.add(value);
      else checked ? values.add(value) : values.delete(value);
      return { ...current, values: [...values], exclude: current.exclude ?? false };
    });
  }
  function applyColumnFilter() {
    const nextSort = draftSort;
    setAppliedColumnFilters(draftColumnFilters); setSort(nextSort); setPage(1);
    updateUrl(sheet, applied, draftColumnFilters, 1, pageSize, nextSort);
    setActiveColumn(undefined);
  }
  function clearColumnFilter(column: string) {
    setDraftColumnFilters(current => { const next = { ...current }; delete next[column]; return next; });
  }
  function handleFilterDialogKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeColumnFilter();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = filterPopoverRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const totalPages = result ? Math.ceil(result.totalCount / pageSize) : 0;
  const columns = result?.columns ?? [];
  const activeFilterCount = useMemo(() => Object.values(appliedColumnFilters).filter(hasColumnFilter).length, [appliedColumnFilters]);
  const activeColumnFilter = activeColumn ? draftColumnFilters[activeColumn] : undefined;
  const options = valueOptions?.items ?? [];

  return <main className="shell source-audit-shell">
    <header className="page-header">
      <p className="eyebrow">ERP Comex · Auditoria de origem</p>
      <h1>Tabela completa para auditoria</h1>
      <p>Consulte os registros da planilha de origem. Os valores históricos são preservados como foram informados; os indicadores mostram o que está preenchido na origem. Somente células com erro de cálculo são sinalizadas como erro.</p>
      <Link className="text-link" href="/">← Carteira de POs</Link>
    </header>

    <section className="source-audit-tabs" role="tablist" aria-label="Planilha de origem">
      {sheetOptions.map((option, index) => <button key={option.value} ref={element => { sheetTabRefs.current[index] = element; }}
        id={`source-sheet-tab-${index}`} role="tab" aria-controls="source-audit-panel"
        aria-selected={sheet === option.value} tabIndex={sheet === option.value ? 0 : -1}
        className={sheet === option.value ? "source-tab active" : "source-tab"}
        onClick={() => changeSheet(option.value)} onKeyDown={event => moveSheetTab(index, event)}>
        {option.label}
      </button>)}
    </section>

    <div id="source-audit-panel" role="tabpanel"
      aria-labelledby={`source-sheet-tab-${Math.max(0, sheetOptions.findIndex(option => option.value === sheet))}`} tabIndex={0}>
    <section className="card source-audit-controls">
      <form className="source-audit-filter" onSubmit={applyFilters}>
        <label>Importador<select value={draft.importer} onChange={event => setDraft(value => ({ ...value, importer: event.target.value }))}>
          <option value="">Todos no meu escopo</option>{importers.map(importer => <option key={importer.code} value={importer.code}>{importer.code}</option>)}
        </select></label>
        <label>Busca geral<input value={draft.search} onChange={event => setDraft(value => ({ ...value, search: event.target.value }))} placeholder="Texto em qualquer coluna" /></label>
        <label>Sinais de auditoria<select value={draft.gap} onChange={event => setDraft(value => ({ ...value, gap: event.target.value as Gap }))}>
          {gapOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
        <button className="button" type="submit">Aplicar filtros</button>
        <button className="button secondary" type="button" onClick={clearFilters}>Limpar</button>
      </form>
      <p className="muted source-filter-hint">Clique no filtro de cada cabeçalho para escolher valores ou ordenar. O campo de texto filtra por trecho; {activeFilterCount} filtro(s) de coluna aplicado(s).</p>
    </section>

    <section className="metric-grid source-audit-metrics" aria-live="polite">
      <div className="metric"><span>Linhas no recorte</span><strong>{loading ? "…" : result?.totalCount.toLocaleString("pt-BR") ?? "—"}</strong></div>
      <div className="metric"><span>Sem PO informado na origem</span><strong>{loading ? "…" : result?.summary.withoutPurchaseOrder.toLocaleString("pt-BR") ?? "—"}</strong></div>
      <div className="metric"><span>Sem IP válido na origem</span><strong>{loading ? "…" : result?.summary.withoutValidIp.toLocaleString("pt-BR") ?? "—"}</strong></div>
      <div className="metric"><span>Células com erro de cálculo</span><strong>{loading ? "…" : result?.summary.cellErrors.toLocaleString("pt-BR") ?? "—"}</strong></div>
      <div className="metric"><span>Linhas com sinalizador</span><strong>{loading ? "…" : result?.summary.anyGap.toLocaleString("pt-BR") ?? "—"}</strong></div>
    </section>

    <section className="card source-audit-grid-card" aria-live="polite">
      {loading && <p role="status">Carregando linhas da planilha…</p>}
      {error && <div className="notice error" role="alert"><p>{error}</p><button className="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></div>}
      {!loading && !error && result && <>
        <div className="source-grid-toolbar">
          <p><strong>{result.totalCount.toLocaleString("pt-BR")}</strong> linha(s){result.rowsBeforeGapFilter !== result.totalCount ? ` · ${result.rowsBeforeGapFilter.toLocaleString("pt-BR")} antes dos sinais de auditoria` : ""}
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
                  <th className="source-pin source-pin-3" scope="col">Sinais da origem</th>
                  {columns.map(column => <th key={column} scope="col" title={`Coluna Excel ${column}: ${result.columnHeaders[column] ?? ""}`}>
                    <span className="source-excel-col">{column}</span>{result.columnHeaders[column] || "(sem cabeçalho)"}
                    {sort?.column === column && <span className="source-sort-indicator" aria-label={sort.direction === "asc" ? "Ordem crescente" : "Ordem decrescente"}>{sort.direction === "asc" ? " ▲" : " ▼"}</span>}
                  </th>)}
                </tr>
                <tr className="source-grid-filters">
                  <th className="source-pin source-pin-1"><span className="sr-only">Sem filtro para linha</span></th>
                  <th className="source-pin source-pin-2"><span className="sr-only">Sem filtro para planilha</span></th>
                  <th className="source-pin source-pin-3"><span className="sr-only">Sem filtro para sinais da origem</span></th>
                  {columns.map(column => <th key={column}>
                    <button type="button" className={hasColumnFilter(appliedColumnFilters[column]) ? "source-filter-trigger active" : "source-filter-trigger"}
                      aria-label={`Abrir filtro da coluna ${column} ${result.columnHeaders[column] ?? ""}`}
                      aria-expanded={activeColumn === column} onClick={event => openColumnFilter(column, event)}>
                      <span aria-hidden="true">▼</span> Filtro{hasColumnFilter(appliedColumnFilters[column]) ? " ·" : ""}
                    </button>
                  </th>)}
                </tr>
              </thead>
              <tbody>{result.items.map(row => <tr key={row.id} className={row.auditFlags.anyGap ? "source-row-has-gap" : ""}>
                <td className="source-pin source-pin-1 source-row-number" title={`Lote ${row.batchId} · linha ${row.sourceRowNumber}`}>{row.sourceRowNumber}</td>
                <td className="source-pin source-pin-2">{row.sourceSheetName}</td>
                <td className="source-pin source-pin-3"><div className="source-gap-tags">
                  {row.auditFlags.withoutPurchaseOrder && <span className="source-gap-tag">Sem PO na origem</span>}
                  {row.auditFlags.withoutValidIp && <span className="source-gap-tag">Sem IP válido na origem</span>}
                  {row.auditFlags.cellErrors > 0 && <span className="source-gap-tag">{row.auditFlags.cellErrors} erro(s) de cálculo</span>}
                  {!row.auditFlags.anyGap && <span className="source-ok-tag">Sem sinalizador</span>}
                </div></td>
                {columns.map(column => <td key={column} title={displayCell(row.sourceSheetName, column, row.sourceValues[column])}>{displayCell(row.sourceSheetName, column, row.sourceValues[column])}</td>)}
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
    </div>

    {activeColumn && filterPosition && typeof document !== "undefined" && createPortal(<>
      <button className="source-filter-backdrop" aria-label="Fechar filtro" tabIndex={-1} onClick={closeColumnFilter} />
      <section ref={filterPopoverRef} className="source-filter-popover" role="dialog" aria-modal="true"
        aria-label={`Filtro da coluna ${activeColumn}`} onKeyDown={handleFilterDialogKeyDown} style={filterPosition}>
        <div className="source-filter-title"><strong>{activeColumn} · {result?.columnHeaders[activeColumn]}</strong>
          <button type="button" className="source-filter-close" onClick={closeColumnFilter} aria-label="Fechar">×</button>
        </div>
        <div className="source-sort-actions" aria-label="Ordenar valores">
          <button type="button" className={draftSort?.column === activeColumn && draftSort.direction === "asc" ? "selected" : ""}
            onClick={() => setDraftSort({ column: activeColumn, direction: "asc" })}>↑ Ordem crescente</button>
          <button type="button" className={draftSort?.column === activeColumn && draftSort.direction === "desc" ? "selected" : ""}
            onClick={() => setDraftSort({ column: activeColumn, direction: "desc" })}>↓ Ordem decrescente</button>
        </div>
        <label className="source-filter-text-label">Filtrar por texto (contém)
          <input autoFocus value={activeColumnFilter?.text ?? ""}
            onChange={event => updateColumnFilter(activeColumn, current => ({ ...current, text: event.target.value }))}
            placeholder="Digite um valor ou trecho" />
        </label>
        <label className="source-filter-text-label">Localizar valores na lista
          <input value={valueSearch} onChange={event => setValueSearch(event.target.value)} placeholder="Pesquisar possibilidades…" />
        </label>
        <div className="source-value-actions">
          <button type="button" onClick={() => updateColumnFilter(activeColumn, current => ({ text: current.text }))}>Selecionar todos</button>
          <button type="button" onClick={() => updateColumnFilter(activeColumn, current => ({ ...current, values: [], exclude: false }))}>Desmarcar todos</button>
        </div>
        <div className="source-value-list" aria-live="polite">
          {loadingOptions && <p role="status">Carregando valores…</p>}
          {optionsError && <p className="source-option-error" role="alert">{optionsError}</p>}
          {!loadingOptions && !optionsError && options.length === 0 && <p>Nenhum valor encontrado.</p>}
          {!loadingOptions && !optionsError && options.map(option => {
            const checked = selectedOption(activeColumnFilter, option.value);
            const canAdd = checked || (activeColumnFilter?.values?.length ?? 0) < 100;
            return <label key={option.value || "__blank__"} className="source-value-option">
              <input type="checkbox" checked={checked} disabled={!canAdd}
                onChange={event => toggleOption(activeColumn, option.value, event.target.checked)} />
              <span>{option.value === "" ? "(em branco)" : displayCell(result?.items[0]?.sourceSheetName ?? sheet, activeColumn, option.value)}</span>
              <small>{option.rowCount ? option.rowCount.toLocaleString("pt-BR") : ""}</small>
            </label>;
          })}
          {valueOptions?.hasMore && <p className="source-option-hint">Há mais valores. Pesquise acima para localizar outros.</p>}
          {!loadingOptions && activeColumnFilter?.values?.length === 100 && <p className="source-option-hint">Limite de 100 valores por filtro. Use a busca textual para intervalos maiores.</p>}
        </div>
        <div className="source-filter-footer">
          <button type="button" className="button secondary" onClick={() => clearColumnFilter(activeColumn)}>Limpar coluna</button>
          <button type="button" className="button" onClick={applyColumnFilter}>Aplicar</button>
        </div>
      </section>
    </>, document.body)}
  </main>;
}
