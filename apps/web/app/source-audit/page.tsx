"use client";

import { FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "../../lib/api";
import { formatUsDate } from "../../lib/date-format";
import { formatCount } from "../../lib/format-count";
import { getMessages, useI18n } from "../../components/I18nProvider";
import PageHeader from "../../components/PageHeader";
import { SearchableSelect } from "../../components/SearchableSelect";
import type { Messages } from "../../lib/i18n/pt-BR";

// Sheet names of the historical spreadsheet, exchanged with the API as filter values.
const preSheet = "Pré Embarque"; // i18n-ignore: data value
const postSheet = "Pós Embarque"; // i18n-ignore: data value
type Sheet = "all" | typeof preSheet | typeof postSheet;
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
    cellErrors: number; dataIssues?: Array<{ code: string; fieldName: string | null;
      severity: string; evidence: Record<string, unknown> }>; anyGap: boolean };
};
type AuditResult = {
  page: number; pageSize: number; totalCount: number; rowsBeforeGapFilter: number;
  summary: { withoutPurchaseOrder: number; withoutValidIp: number; cellErrors: number; dataIssues: number; anyGap: number };
  columns: string[]; columnHeaders: Record<string, string>; items: SourceRow[];
};
type Importer = { code: string };
type ValueOption = { value: string; rowCount: number };
type ValueOptionsResult = { items: ValueOption[]; totalCount: number; hasMore: boolean };
type GridFilters = typeof emptyFilters;
type GridDrag = { pointerId: number; startX: number; scrollLeft: number };

const emptyFilters = { importer: "", search: "", gap: "all" as Gap };
const dateColumnsBySheet: Record<Exclude<Sheet, "all">, Set<string>> = {
  [preSheet]: new Set(["J", "O", "P", "Q", "AC", "AI", "AJ", "AN", "AO", "AQ", "AW", "AX"]),
  [postSheet]: new Set(["Q", "S", "U", "AC", "AD", "AG", "AL", "AM", "AN"]),
};
const sheetValues: Sheet[] = ["all", preSheet, postSheet];
const gapValues: Gap[] = ["all", "any", "without-ip", "without-po", "quality"];

function sheetLabel(sheet: Sheet, m: Messages) {
  return sheet === "all" ? m.sourceAudit.allRows : sheet === preSheet ? m.reports.pre : m.reports.post;
}

function describeIssue(issue: NonNullable<SourceRow["auditFlags"]["dataIssues"]>[number], m: Messages): string {
  const t = m.sourceAudit;
  const label = (t.issues as Record<string, string>)[issue.code] ?? issue.code.replaceAll("_", " ").toLocaleLowerCase();
  const field = issue.fieldName ? t.issueColumn(issue.fieldName) : "";
  const evidenceValue = issue.evidence.value ?? issue.evidence.amount;
  const value = evidenceValue == null ? "" : t.issueValue(display(evidenceValue));
  return `${label}${field}${value}`;
}

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
  const requestedPage = Number(params.get("page"));
  return {
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    sheet: (sheetValues.some(value => value === requestedSheet) ? requestedSheet : preSheet) as Sheet,
    filters: { importer: params.get("importer") ?? "", search: params.get("search") ?? "",
      gap: (gapValues.some(value => value === requestedGap) ? requestedGap : "all") as Gap },
    columnFilters: readColumnFilters(params.get("filters")),
    sort: sortColumn && (sortDirection === "asc" || sortDirection === "desc")
      ? { column: sortColumn, direction: sortDirection } as SortState : null,
  };
}

function makeQuery(sheet: Sheet, filters: GridFilters, columnFilters: ColumnFilters, sort: SortState, page = 1) {
  const params = new URLSearchParams({ sheet, page: String(page), pageSize: "50", gap: filters.gap });
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
  const { m } = useI18n();
  const t = m.sourceAudit;
  const [page, setPage] = useState(1);
  const [sheet, setSheet] = useState<Sheet>(preSheet);
  const [draft, setDraft] = useState<GridFilters>(emptyFilters);
  const [applied, setApplied] = useState<GridFilters>(emptyFilters);
  const [draftColumnFilters, setDraftColumnFilters] = useState<ColumnFilters>({});
  const [appliedColumnFilters, setAppliedColumnFilters] = useState<ColumnFilters>({});
  const [draftSort, setDraftSort] = useState<SortState>(null);
  const [sort, setSort] = useState<SortState>(null);
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
  const [draggingGrid, setDraggingGrid] = useState(false);
  const gridDrag = useRef<GridDrag | undefined>(undefined);
  const filterPopoverRef = useRef<HTMLElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const sheetTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const state = readLocation();
    setPage(state.page);
    setSheet(state.sheet); setDraft(state.filters); setApplied(state.filters);
    setDraftColumnFilters(state.columnFilters); setAppliedColumnFilters(state.columnFilters);
    setDraftSort(state.sort); setSort(state.sort);
    setReady(true);
    apiFetch("/api/v1/importers", { cache: "no-store" }).then(async response => {
      if (!response.ok) return;
      setImporters((await response.json() as { items: Importer[] }).items);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const query = makeQuery(sheet, applied, appliedColumnFilters, sort, page);
    setLoading(true); setError(undefined); setResult(undefined);
    apiFetch(`/api/v1/source-rows?${query}`, { signal: controller.signal })
      .then(async response => {
        const text = getMessages();
        if (response.status === 401) throw new Error(text.common.sessionExpired);
        if (response.status === 403) throw new Error(text.sourceAudit.forbidden);
        if (!response.ok) throw new Error(text.sourceAudit.loadFailed);
        return await response.json() as AuditResult;
      })
      .then(data => { if (!controller.signal.aborted) setResult(data); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : getMessages().common.unexpectedError); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [sheet, applied, appliedColumnFilters, sort, page, ready, retry]);

  useEffect(() => {
    if (!ready || !activeColumn) { setValueOptions(undefined); return; }
    const controller = new AbortController();
    setLoadingOptions(true); setOptionsError(undefined);
    const timeout = window.setTimeout(() => {
      const query = makeValueQuery(sheet, applied, appliedColumnFilters, activeColumn, valueSearch);
      apiFetch(`/api/v1/source-rows/column-values?${query}`, { signal: controller.signal })
        .then(async response => {
          if (response.status === 401) throw new Error(getMessages().common.sessionExpired);
          if (!response.ok) throw new Error(getMessages().sourceAudit.valuesFailed);
          return await response.json() as ValueOptionsResult;
        })
        .then(data => { if (!controller.signal.aborted) setValueOptions(data); })
        .catch((reason: unknown) => { if (!controller.signal.aborted) setOptionsError(reason instanceof Error ? reason.message : getMessages().common.unexpectedError); })
        .finally(() => { if (!controller.signal.aborted) setLoadingOptions(false); });
    }, 200);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [activeColumn, applied, appliedColumnFilters, ready, retry, sheet, valueSearch]);

  function closeColumnFilter(restoreFocus = true) {
    setActiveColumn(undefined);
    if (restoreFocus) filterTriggerRef.current?.focus();
  }

  useEffect(() => {
    if (!activeColumn) return;
    const closeOnScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && filterPopoverRef.current?.contains(target)) return;
      closeColumnFilter(false);
    };
    const closeOnResize = () => closeColumnFilter();
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", closeOnResize);
    return () => {
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [activeColumn]);

  function updateUrl(nextSheet: Sheet, filters: GridFilters, columns: ColumnFilters, nextSort: SortState, nextPage = 1) {
    window.history.replaceState(null, "", `/source-audit?${makeQuery(nextSheet, filters, columns, nextSort, nextPage)}`);
  }
  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextFilters = { importer: draft.importer, search: draft.search.trim(), gap: draft.gap };
    setPage(1);
    setApplied(nextFilters); setAppliedColumnFilters(draftColumnFilters); setSort(draftSort);
    updateUrl(sheet, nextFilters, draftColumnFilters, draftSort);
  }
  function changeSheet(nextSheet: Sheet) {
    const nextColumns: ColumnFilters = {};
    setSheet(nextSheet); setPage(1); setDraftColumnFilters(nextColumns); setAppliedColumnFilters(nextColumns);
    setDraftSort(null); setSort(null);
    updateUrl(nextSheet, applied, nextColumns, null);
  }
  function moveSheetTab(index: number, event: React.KeyboardEvent<HTMLButtonElement>) {
    let nextIndex: number;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % sheetValues.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + sheetValues.length) % sheetValues.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = sheetValues.length - 1;
    else return;
    event.preventDefault();
    sheetTabRefs.current[nextIndex]?.focus();
    changeSheet(sheetValues[nextIndex]);
  }
  function clearFilters() {
    setPage(1);
    setDraft(emptyFilters); setApplied(emptyFilters); setDraftColumnFilters({}); setAppliedColumnFilters({});
    setDraftSort(null); setSort(null);
    updateUrl(sheet, emptyFilters, {}, null);
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
    setPage(1);
    setAppliedColumnFilters(draftColumnFilters); setSort(nextSort);
    updateUrl(sheet, applied, draftColumnFilters, nextSort);
    setActiveColumn(undefined);
  }
  function changePage(nextPage: number) {
    setPage(nextPage);
    updateUrl(sheet, applied, appliedColumnFilters, sort, nextPage);
  }
  function clearColumnFilter(column: string) {
    setDraftColumnFilters(current => { const next = { ...current }; delete next[column]; return next; });
  }
  function startGridDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || event.button !== 0
      || !(event.target as HTMLElement).closest("table")
      || (event.target as HTMLElement).closest("button, a, input, select, textarea, [role=button]")) return;
    gridDrag.current = { pointerId: event.pointerId, startX: event.clientX,
      scrollLeft: event.currentTarget.scrollLeft };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveGridDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = gridDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = event.clientX - drag.startX;
    if (Math.abs(distance) > 4) {
      setDraggingGrid(true);
      event.preventDefault();
    }
    event.currentTarget.scrollLeft = drag.scrollLeft - distance;
  }
  function stopGridDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = gridDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    gridDrag.current = undefined;
    setDraggingGrid(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
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

  const columns = result?.columns ?? [];
  const activeFilterCount = useMemo(() => Object.values(appliedColumnFilters).filter(hasColumnFilter).length, [appliedColumnFilters]);
  const activeColumnFilter = activeColumn ? draftColumnFilters[activeColumn] : undefined;
  const options = valueOptions?.items ?? [];

  return <main className="shell shell-wide">
    <PageHeader eyebrow={t.eyebrow} title={t.title}>
      <p>{t.introSpaces}</p>
      <p>{t.introSpelling}</p>
      <p>{t.introValues}</p>
    </PageHeader>

    <section className="tabs" role="tablist" aria-label={t.sheetTabs}>
      {sheetValues.map((value, index) => <button key={value} ref={element => { sheetTabRefs.current[index] = element; }}
        id={`source-sheet-tab-${index}`} role="tab" aria-controls="source-audit-panel"
        aria-selected={sheet === value} tabIndex={sheet === value ? 0 : -1}
        className={sheet === value ? "tab active" : "tab"}
        onClick={() => changeSheet(value)} onKeyDown={event => moveSheetTab(index, event)}>
        {sheetLabel(value, m)}
      </button>)}
    </section>

    <div id="source-audit-panel" role="tabpanel"
      aria-labelledby={`source-sheet-tab-${Math.max(0, sheetValues.indexOf(sheet))}`} tabIndex={0}>
    <section className="card source-audit-controls">
      <form className="source-audit-filter" onSubmit={applyFilters}>
        <label>{m.processDirectory.importer}<SearchableSelect ariaLabel={m.processDirectory.importer} placeholder={t.allInScope} value={draft.importer}
          onChange={importer => setDraft(value => ({ ...value, importer }))}
          options={importers.map(importer => ({ value: importer.code, label: importer.code }))} /></label>
        <label>{t.search}<input value={draft.search} onChange={event => setDraft(value => ({ ...value, search: event.target.value }))} placeholder={t.searchPlaceholder} /></label>
        <label>{t.signals}<SearchableSelect ariaLabel={t.signals} placeholder="" value={draft.gap}
          onChange={gap => setDraft(value => ({ ...value, gap: gap as Gap }))}
          options={gapValues.map(value => ({ value, label: t.gaps[value] }))} /></label>
        <button className="button" type="submit">{m.productLines.apply}</button>
        <button className="button secondary" type="button" onClick={clearFilters}>{m.processDirectory.clear}</button>
      </form>
      <p className="muted source-filter-hint">{t.filterHint(activeFilterCount)}</p>
    </section>

    <section className="metric-grid" aria-live="polite">
      <div className="metric"><span>{t.rowsInScope}</span><strong>{loading ? "…" : formatCount(result?.totalCount)}</strong></div>
      <div className="metric"><span>{t.withoutPo}</span><strong>{loading ? "…" : formatCount(result?.summary?.withoutPurchaseOrder)}</strong></div>
      <div className="metric"><span>{t.withoutIp}</span><strong>{loading ? "…" : formatCount(result?.summary?.withoutValidIp)}</strong></div>
      <div className="metric"><span>{t.cellErrors}</span><strong>{loading ? "…" : formatCount(result?.summary?.cellErrors)}</strong></div>
      <div className="metric"><span>{t.dataIssues}</span><strong>{loading ? "…" : formatCount(result?.summary?.dataIssues)}</strong></div>
      <div className="metric"><span>{t.flagged}</span><strong>{loading ? "…" : formatCount(result?.summary?.anyGap)}</strong></div>
    </section>

    <section className="card source-audit-grid-card" aria-live="polite">
      {loading && <p role="status">{t.loading}</p>}
      {error && <div className="notice error" role="alert"><p>{error}</p><button className="button" onClick={() => setRetry(value => value + 1)}>{m.common.retry}</button></div>}
      {!loading && !error && result && <>
        <div className="source-grid-toolbar">
          <p>{t.showingBefore}<strong>{formatCount(result.items.length ? (result.page - 1) * result.pageSize + 1 : 0)}-{formatCount((result.page - 1) * result.pageSize + result.items.length)}</strong>{t.showingOf}<strong>{formatCount(result.totalCount)}</strong>{t.showingAfter}{result.rowsBeforeGapFilter !== result.totalCount ? t.beforeSignals(formatCount(result.rowsBeforeGapFilter)) : ""}</p>
        </div>
        {result.items.length === 0 ? <p>{t.none}</p> :
          <div className={draggingGrid ? "source-grid-scroll is-dragging" : "source-grid-scroll"}
            role="region" aria-label={t.gridAria}
            tabIndex={0} onPointerDown={startGridDrag} onPointerMove={moveGridDrag}
            onPointerUp={stopGridDrag} onPointerCancel={stopGridDrag}>
            <table className="source-grid">
              <thead>
                <tr className="source-grid-head">
                  <th className="source-pin source-pin-1" scope="col">{t.row}</th>
                  <th className="source-pin source-pin-2" scope="col">{t.sheet}</th>
                  <th className="source-pin source-pin-3" scope="col">{t.sourceSignals}</th>
                  {columns.map(column => <th key={column} scope="col" title={t.excelColumn(column, result.columnHeaders[column] ?? "")}>
                    <span className="source-excel-col">{column}</span>{result.columnHeaders[column] || t.noHeader}
                    {sort?.column === column && <span className="source-sort-indicator" aria-label={sort.direction === "asc" ? t.ascending : t.descending}>{sort.direction === "asc" ? " ▲" : " ▼"}</span>}
                  </th>)}
                </tr>
                <tr className="source-grid-filters">
                  <th className="source-pin source-pin-1"><span className="sr-only">{t.noRowFilter}</span></th>
                  <th className="source-pin source-pin-2"><span className="sr-only">{t.noSheetFilter}</span></th>
                  <th className="source-pin source-pin-3"><span className="sr-only">{t.noSignalFilter}</span></th>
                  {columns.map(column => <th key={column}>
                    <button type="button" className={hasColumnFilter(appliedColumnFilters[column]) ? "source-filter-trigger active" : "source-filter-trigger"}
                      aria-label={t.openFilter(column, result.columnHeaders[column] ?? "")}
                      aria-expanded={activeColumn === column} onClick={event => openColumnFilter(column, event)}>
                      <span aria-hidden="true">▼</span> {t.filter}{hasColumnFilter(appliedColumnFilters[column]) ? " ·" : ""}
                    </button>
                  </th>)}
                </tr>
              </thead>
              <tbody>{result.items.map(row => <tr key={row.id} className={row.auditFlags.anyGap ? "source-row-has-gap" : ""}>
                <td className="source-pin source-pin-1 source-row-number" title={t.batchRow(row.batchId, row.sourceRowNumber)}>{row.sourceRowNumber}</td>
                <td className="source-pin source-pin-2">{sheetValues.includes(row.sourceSheetName as Sheet) ? sheetLabel(row.sourceSheetName as Sheet, m) : row.sourceSheetName}</td>
                <td className="source-pin source-pin-3"><div className="source-gap-tags">
                  {row.auditFlags.withoutPurchaseOrder && <span className="badge badge-sm badge-warning">{t.withoutPoTag}</span>}
                  {row.auditFlags.withoutValidIp && <span className="badge badge-sm badge-warning">{t.withoutIp}</span>}
                  {row.auditFlags.cellErrors > 0 && <span className="badge badge-sm badge-warning">{t.calcErrors(row.auditFlags.cellErrors)}</span>}
                  {(row.auditFlags.dataIssues ?? []).map((issue, index) => <span key={`${issue.code}-${issue.fieldName}-${index}`}
                    className="badge badge-sm badge-warning" title={`${result.columnHeaders[issue.fieldName ?? ""] ?? ""} · ${JSON.stringify(issue.evidence)}`}>
                    {describeIssue(issue, m)}{result.columnHeaders[issue.fieldName ?? ""] ? ` (${result.columnHeaders[issue.fieldName ?? ""]})` : ""}
                  </span>)}
                  {!row.auditFlags.anyGap && <span className="badge badge-sm badge-success">{t.noFlag}</span>}
                </div></td>
                {columns.map(column => <td key={column} title={displayCell(row.sourceSheetName, column, row.sourceValues[column])}>{displayCell(row.sourceSheetName, column, row.sourceValues[column])}</td>)}
              </tr>)}</tbody>
            </table>
          </div>}
        {Math.ceil(result.totalCount / result.pageSize) > 1 && <nav className="pagination" aria-label={t.pages}>
          <button className="button secondary" type="button" disabled={result.page <= 1}
            onClick={() => changePage(result.page - 1)}>{m.common.previous}</button>
          <span>{m.common.pageOf(result.page, Math.ceil(result.totalCount / result.pageSize))}</span>
          <button className="button" type="button" disabled={result.page >= Math.ceil(result.totalCount / result.pageSize)}
            onClick={() => changePage(result.page + 1)}>{m.common.next}</button>
        </nav>}
      </>}
    </section>
    </div>

    {activeColumn && filterPosition && typeof document !== "undefined" && createPortal(<>
      <button className="source-filter-backdrop" aria-label={t.closeFilter} tabIndex={-1} onClick={() => closeColumnFilter()} />
      <section ref={filterPopoverRef} className="source-filter-popover" role="dialog" aria-modal="true"
        aria-label={t.columnFilter(activeColumn)} onKeyDown={handleFilterDialogKeyDown} style={filterPosition}>
        <div className="source-filter-title"><strong>{activeColumn} · {result?.columnHeaders[activeColumn]}</strong>
          <button type="button" className="source-filter-close" onClick={() => closeColumnFilter()} aria-label={t.close}>×</button>
        </div>
        <div className="source-sort-actions" role="group" aria-label={t.sortValues}>
          <button type="button" className={draftSort?.column === activeColumn && draftSort.direction === "asc" ? "selected" : ""}
            aria-pressed={draftSort?.column === activeColumn && draftSort.direction === "asc"}
            onClick={() => setDraftSort({ column: activeColumn, direction: "asc" })}>{t.sortAscending}</button>
          <button type="button" className={draftSort?.column === activeColumn && draftSort.direction === "desc" ? "selected" : ""}
            aria-pressed={draftSort?.column === activeColumn && draftSort.direction === "desc"}
            onClick={() => setDraftSort({ column: activeColumn, direction: "desc" })}>{t.sortDescending}</button>
        </div>
        <label className="source-filter-text-label">{t.textFilter}
          <input autoFocus value={activeColumnFilter?.text ?? ""}
            onChange={event => updateColumnFilter(activeColumn, current => ({ ...current, text: event.target.value }))}
            placeholder={t.textPlaceholder} />
        </label>
        <label className="source-filter-text-label">{t.findValues}
          <input value={valueSearch} onChange={event => setValueSearch(event.target.value)} placeholder={t.findPlaceholder} />
        </label>
        <div className="source-value-actions">
          <button type="button" onClick={() => updateColumnFilter(activeColumn, current => ({ text: current.text }))}>{t.selectAll}</button>
          <button type="button" onClick={() => updateColumnFilter(activeColumn, current => ({ ...current, values: [], exclude: false }))}>{t.unselectAll}</button>
        </div>
        <div className="source-value-list" aria-live="polite">
          {loadingOptions && <p role="status">{t.loadingValues}</p>}
          {optionsError && <p className="source-option-error" role="alert">{optionsError}</p>}
          {!loadingOptions && !optionsError && options.length === 0 && <p>{t.noValues}</p>}
          {!loadingOptions && !optionsError && options.map(option => {
            const checked = selectedOption(activeColumnFilter, option.value);
            const canAdd = checked || (activeColumnFilter?.values?.length ?? 0) < 100;
            return <label key={option.value || "__blank__"} className="source-value-option">
              <input type="checkbox" checked={checked} disabled={!canAdd}
                onChange={event => toggleOption(activeColumn, option.value, event.target.checked)} />
              <span>{option.value === "" ? t.blank : displayCell(result?.items[0]?.sourceSheetName ?? sheet, activeColumn, option.value)}</span>
              <small>{formatCount(option.rowCount)}</small>
            </label>;
          })}
          {valueOptions?.hasMore && <p className="source-option-hint">{t.moreValues}</p>}
          {!loadingOptions && activeColumnFilter?.values?.length === 100 && <p className="source-option-hint">{t.valueLimit}</p>}
        </div>
        <div className="source-filter-footer">
          <button type="button" className="button secondary" onClick={() => clearColumnFilter(activeColumn)}>{t.clearColumn}</button>
          <button type="button" className="button" onClick={applyColumnFilter}>{t.apply}</button>
        </div>
      </section>
    </>, document.body)}
  </main>;
}
