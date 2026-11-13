"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch, readApiJson } from "../lib/api";
import { dateRangeValue, formatRelativeSpec, resolveDateRange, type DateRangeValue } from "../lib/date-range";
import { e2eToday, formatE2eDate } from "../lib/e2e-analysis";
import { formatNumber } from "../lib/format-number";
import { statusLabel } from "../lib/i18n/labels";
import { effectiveSelection } from "../lib/multi-select";
import { formatProducts, parsePreShipmentFilters, preShipmentFilterBody, preShipmentFilterCount, preShipmentLinesQuery, preShipmentStatusColors,
  preShipmentStatuses, preShipmentSummaryQuery, preShipmentUrlQuery, emptyPreShipmentFilters, type PreShipmentAgingRange,
  type PreShipmentFilterOptions, type PreShipmentFilters, type PreShipmentLinesPage, type PreShipmentStatus,
  type PreShipmentSummary } from "../lib/pre-shipment-dashboard";
import { nextChartSelection } from "../lib/purchase-order-lines";
import type { SearchableOption } from "../lib/searchable-options";
import { fetchRetryingTransient } from "../lib/transient-retry";
import DateRangeFilter from "./DateRangeFilter";
import E2eCollapsible from "./E2eCollapsible";
import ExportColumnsDialog from "./ExportColumnsDialog";
import { getMessages, useI18n } from "./I18nProvider";
import { MultiSelectFilter } from "./MultiSelectFilter";
import PreShipmentCharts from "./PreShipmentCharts";
import { Tooltip } from "./Tooltip";
import { useDebouncedValue } from "./useDebouncedValue";
import { useExcelExport } from "./useProductLineExport";

const pageSize = 50;
// Quiet time after the last filter or chart click before the summary and the table are requested.
const fetchDelayMs = 250;
const textOptions = (values: string[] | undefined): SearchableOption[] => (values ?? []).map(value => ({ value, label: value }));
/** A result kept with the query it answers, so a newer query shows as loading without clearing the screen. */
type Loaded<T> = { query: string; data?: T; error?: string };

/** The necessity fields of a period: its dates from today, and the relative period kept in the URL. */
function necessityFields(value: DateRangeValue, today: string): Pick<PreShipmentFilters, "necessityFrom" | "necessityTo" | "necessityPeriod"> {
  const { from, to } = resolveDateRange(value, today);
  return { necessityFrom: from, necessityTo: to,
    necessityPeriod: value.kind === "relative" ? formatRelativeSpec(value.range, value.excludeOpen) : "" };
}
const necessityValue = (filters: PreShipmentFilters) =>
  dateRangeValue(filters.necessityPeriod, filters.necessityFrom, filters.necessityTo);

/** GET with the retries of a transient failure; the result is set only while the request is current. */
function useLoaded<T>(path: string, query: string): Loaded<T> | undefined {
  const [loaded, setLoaded] = useState<Loaded<T>>();
  useEffect(() => {
    const controller = new AbortController();
    fetchRetryingTransient(() => apiFetch(`${path}?${query}`, { signal: controller.signal }), controller.signal)
      .then(response => readApiJson<T>(response))
      .then(data => { if (!controller.signal.aborted) setLoaded({ query, data }); })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setLoaded({ query,
          error: reason instanceof Error ? reason.message : getMessages().reports.dashboard.loadFailed });
      });
    return () => controller.abort();
  }, [path, query]);
  return loaded;
}

/** Status as in the status charts: the swatch of its colour and the name. */
function LineStatus({ status }: { status: string }) {
  const { m } = useI18n();
  const color = preShipmentStatusColors[status as PreShipmentStatus];
  return <span className="e2e-status">
    {color && <span className="e2e-chart-swatch" style={{ background: `var(${color})` }} />}
    {statusLabel(m, status)}
  </span>;
}

/**
 * The pre-shipment dashboard (the BI "Pré Embarque" metrics): the filter form, the charts and the table of the
 * product lines. The form waits for Apply; the period and the chart clicks apply at once. The API is called once
 * the choices stop for a moment, and the last summary stays on screen while a new one loads.
 */
export default function PreShipmentDashboard({ initialQuery }: { initialQuery: string }) {
  const { m, locale } = useI18n();
  const d = m.reports.dashboard;
  const c = d.columns;
  const today = e2eToday();
  const [initial] = useState(() => {
    const query = new URLSearchParams(initialQuery);
    const filters = parsePreShipmentFilters(query);
    const requestedPage = Number(query.get("page"));
    // A relative period from a link counts from today, not from the day the link was made.
    return { filters: { ...filters, ...necessityFields(necessityValue(filters), e2eToday()) },
      page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1 };
  });
  const [draft, setDraft] = useState(initial.filters);
  const [applied, setApplied] = useState(initial.filters);
  const [page, setPage] = useState(initial.page);
  const [options, setOptions] = useState<PreShipmentFilterOptions>();
  const { exporting, exportStatus, exportError, runExport } = useExcelExport("pre-embarque");
  const [choosingColumns, setChoosingColumns] = useState(false);
  const summaryQuery = useDebouncedValue(preShipmentSummaryQuery(applied).toString(), fetchDelayMs);
  const linesQuery = useDebouncedValue(preShipmentLinesQuery(applied, page, pageSize).toString(), fetchDelayMs);
  const summaryLoaded = useLoaded<PreShipmentSummary>("/api/v1/reports/pre-shipment/summary", summaryQuery);
  const linesLoaded = useLoaded<PreShipmentLinesPage>("/api/v1/reports/pre-shipment/lines", linesQuery);
  const summary = summaryLoaded?.data;
  const lines = linesLoaded?.query === linesQuery ? linesLoaded : undefined;

  // The options do not depend on the filters: loaded once. Without them the fields keep only the chosen values.
  useEffect(() => {
    const controller = new AbortController();
    apiFetch("/api/v1/reports/pre-shipment/filter-options", { signal: controller.signal })
      .then(response => readApiJson<PreShipmentFilterOptions>(response))
      .then(data => { if (!controller.signal.aborted) setOptions(data); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  function apply(filters: PreShipmentFilters, nextPage = 1) {
    setApplied(filters); setPage(nextPage);
    const query = preShipmentUrlQuery(filters, nextPage).toString();
    window.history.replaceState(null, "", `/reports/pre${query ? `?${query}` : ""}`);
  }
  // Every value of a list checked is the same as none, so the URL and the API stay short.
  function effective(filters: PreShipmentFilters): PreShipmentFilters {
    return { ...filters, status: effectiveSelection(filters.status, preShipmentStatuses) as PreShipmentStatus[],
      demand: effectiveSelection(filters.demand, options?.demands ?? []),
      requester: effectiveSelection(filters.requester, options?.requesters ?? []),
      group: effectiveSelection(filters.group, options?.groups ?? []),
      supplier: effectiveSelection(filters.supplier, options?.suppliers ?? []),
      purpose: effectiveSelection(filters.purpose, options?.purposes ?? []),
      importers: effectiveSelection(filters.importers, options?.importers ?? []),
      modes: effectiveSelection(filters.modes, options?.modes ?? []) };
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const filters = effective(draft);
    setDraft(filters); apply(filters);
  }
  function clear() { setDraft(emptyPreShipmentFilters); apply(emptyPreShipmentFilters); }
  // The period picker has its own Apply, so its choice applies at once, keeping the other fields being edited.
  function applyNecessity(value: DateRangeValue) {
    const fields = necessityFields(value, today);
    setDraft({ ...draft, ...fields }); apply({ ...applied, ...fields });
  }
  // Chart clicks as in Power BI: a click keeps one category, Ctrl+click adds or removes it.
  function selectStatus(status: PreShipmentStatus, additive: boolean) {
    const next = { ...applied, status: nextChartSelection(applied.status, status, additive) };
    setDraft({ ...draft, status: next.status }); apply(next);
  }
  function selectAging(range: PreShipmentAgingRange, additive: boolean) {
    apply({ ...applied, aging: nextChartSelection(applied.aging, range, additive) });
  }
  function clearStatus() { setDraft({ ...draft, status: [] }); apply({ ...applied, status: [] }); }

  const date = (value: string | null) => formatE2eDate(value, locale);
  const all = d.allOption;
  const p = m.productLines;
  const statusOptions: SearchableOption[] = preShipmentStatuses.map(status => ({ value: status, label: statusLabel(m, status) }));
  const list = (key: "demand" | "requester" | "group" | "supplier" | "purpose" | "importers" | "modes", label: string,
    values: string[] | undefined) => <label>{label}<MultiSelectFilter ariaLabel={label} allLabel={all} values={draft[key]}
    options={textOptions(values)} onChange={next => setDraft({ ...draft, [key]: next })} /></label>;
  const text = (key: "purchaseOrder" | "scNumber" | "ipNumber" | "productCode" | "productDescription", label: string) =>
    <label>{label}<input value={draft[key]} placeholder={d.searchPlaceholder} maxLength={200}
      onChange={event => setDraft({ ...draft, [key]: event.target.value })} /></label>;
  const totalPages = lines?.data ? Math.ceil(lines.data.totalCount / pageSize) : 0;

  return <>
    <E2eCollapsible title={d.filtersLabel} storageKey="erp-comex-pre-dashboard-filters-collapsed" icon="filter"
      activeCount={preShipmentFilterCount({ ...applied, status: [], aging: [] })}>
      <form className="portfolio-filter product-lines-filter e2e-overview-filters" aria-label={d.filtersLabel} onSubmit={submit}>
        {text("purchaseOrder", d.purchaseOrder)}
        {text("scNumber", d.scNumber)}
        {text("ipNumber", d.ipNumber)}
        {text("productCode", d.productCode)}
        {text("productDescription", d.productDescription)}
        {list("importers", d.importer, options?.importers)}
        <label>{d.status}<MultiSelectFilter ariaLabel={d.status} allLabel={all} values={draft.status} options={statusOptions}
          onChange={next => setDraft({ ...draft, status: next as PreShipmentStatus[] })} /></label>
        {list("demand", d.demand, options?.demands)}
        <label>{d.priority}<select value={draft.priority}
          onChange={event => setDraft({ ...draft, priority: event.target.value as PreShipmentFilters["priority"] })}>
          <option value="">{all}</option>
          <option value="priority">{d.priorityOption}</option>
          <option value="normal">{d.normalOption}</option>
        </select></label>
        {list("modes", d.mode, options?.modes)}
        {list("requester", d.requester, options?.requesters)}
        <label>{d.direct}<select value={draft.direct}
          onChange={event => setDraft({ ...draft, direct: event.target.value as PreShipmentFilters["direct"] })}>
          <option value="">{all}</option>
          <option value="direct">{d.directOption}</option>
          <option value="notDirect">{d.notDirectOption}</option>
        </select></label>
        <label>{p.ipFilter}<select value={draft.ip}
          onChange={event => setDraft({ ...draft, ip: event.target.value as PreShipmentFilters["ip"] })}>
          <option value="">{all}</option>
          <option value="with">{p.withIp}</option>
          <option value="without">{p.withoutIp}</option>
        </select></label>
        {list("group", d.group, options?.groups)}
        {list("supplier", d.supplier, options?.suppliers)}
        {list("purpose", d.purpose, options?.purposes)}
        <label>{d.necessity}<DateRangeFilter ariaLabel={d.necessity} today={today} value={necessityValue(draft)}
          onApply={applyNecessity} /></label>
        <div className="button-row product-lines-filter-actions"><button className="button" type="submit">{d.apply}</button>
          <button className="button secondary" type="button" onClick={clear}>{d.clear}</button></div>
      </form>
    </E2eCollapsible>

    {summaryLoaded?.error && <p className="notice error" role="alert">{summaryLoaded.error}</p>}
    {!summary && !summaryLoaded?.error && <p role="status">{d.loading}</p>}
    {summary && <PreShipmentCharts summary={summary} selectedStatuses={applied.status} selectedAging={applied.aging}
      onStatusSelect={selectStatus} onStatusClear={clearStatus}
      onAgingSelect={selectAging} onAgingClear={() => apply({ ...applied, aging: [] })} />}

    <section className="card pre-dashboard-table" aria-live="polite">
      <h2>{d.tableTitle}</h2>
      {!lines && <p role="status">{d.tableLoading}</p>}
      {lines?.error && <p className="notice error" role="alert">{lines.error}</p>}
      {lines?.data && <>
        <p>{d.found(formatProducts(lines.data.totalCount, locale))}
          {lines.data.totalCount > 0 && m.processDirectory.pageSuffix(page, totalPages)}</p>
        {/* The export writes the lines of the table: the applied filters and the chart selections. */}
        {lines.data.totalCount > 0 && <p><button className="button secondary" type="button" disabled={exporting}
          onClick={() => setChoosingColumns(true)}>{exporting ? m.productLines.exporting : d.export}</button></p>}
        {choosingColumns && <ExportColumnsDialog context="pre-shipment" onCancel={() => setChoosingColumns(false)}
          onExport={columns => { setChoosingColumns(false);
            void runExport("/api/v1/exports/pre-shipment", { ...preShipmentFilterBody(applied), ...columns }); }} />}
        {exportStatus && <p className="muted" role="status">{exportStatus}</p>}
        {exportError && <p className="notice error" role="alert">{exportError}</p>}
        {lines.data.totalCount === 0 && <p>{d.none}</p>}
        {lines.data.lines.length > 0 && <div className="table-scroll"><table>
          <thead><tr>
            <th>{c.necessity}</th><th>{c.mode}</th><th>{c.status}</th><th>{c.requester}</th><th>{c.sc}</th><th>{c.po}</th>
            <th>{c.ip}</th><th>{c.etd}</th><th>{c.eta}</th><th>{c.ete}</th><th>{c.productCode}</th><th>{c.description}</th>
            <th>{c.quantity}</th><th>{c.supplier}</th><th>{c.importer}</th><th>{c.purpose}</th><th>{c.poSentDate}</th>
          </tr></thead>
          <tbody>{lines.data.lines.map(line => <tr key={`${line.lineKind}-${line.lineId}`}>
            <td>{date(line.necessityDate)}</td>
            <td>{line.mode ?? "—"}</td>
            <td><LineStatus status={line.status} /></td>
            <td>{line.requester ?? "—"}</td>
            <td>{line.scNumber ?? "—"}</td>
            <td><Link className="text-link" href={`/purchase-orders/${line.purchaseOrder.id}`}>{line.purchaseOrder.number}</Link></td>
            <td>{line.process ? <Link className="text-link" href={`/processes/${line.process.id}`}>{line.process.ipNumber}</Link>
              : <span className="po-ip-pending">{d.noIp}</span>}</td>
            <td>{date(line.etd)}</td><td>{date(line.eta)}</td><td>{date(line.ete)}</td>
            <td><strong>{line.productCode}</strong></td>
            <td><Tooltip content={line.description}><span className="product-lines-description">{line.description}</span></Tooltip></td>
            <td>{formatNumber(line.quantity)} {line.unit ?? ""}</td>
            <td>{line.supplier ?? "—"}</td><td>{line.importer}</td><td>{line.purpose ?? "—"}</td>
            <td>{date(line.poSentDate)}</td>
          </tr>)}</tbody>
        </table></div>}
        {totalPages > 1 && <nav className="pagination" aria-label={d.pages}>
          <button className="button secondary" disabled={page <= 1} onClick={() => apply(applied, page - 1)}>{m.common.previous}</button>
          <span>{m.common.pageOf(page, totalPages)}</span>
          <button className="button" disabled={page >= totalPages} onClick={() => apply(applied, page + 1)}>{m.common.next}</button>
        </nav>}
      </>}
    </section>
  </>;
}
