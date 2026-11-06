"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch, readApiJson } from "../lib/api";
import { dateRangeValue, formatRelativeSpec, resolveDateRange, type DateRangeValue } from "../lib/date-range";
import { e2eToday, formatE2eDate } from "../lib/e2e-analysis";
import { statusLabel } from "../lib/i18n/labels";
import { effectiveSelection } from "../lib/multi-select";
import { atMostTone, emptyPostShipmentFilters, formatContainers, formatIps, parsePostShipmentFilters, postShipmentFilterBody, postShipmentFilterCount,
  postShipmentLeadTimeTarget, postShipmentLinesQuery, postShipmentPriorities, postShipmentSlaTxtTarget, postShipmentStatusColors, postShipmentStatuses, postShipmentSummaryQuery,
  postShipmentUrlQuery, type PostShipmentChannel, type PostShipmentFilterOptions, type PostShipmentFilters,
  type PostShipmentLine, type PostShipmentLinesPage, type PostShipmentPriority, type PostShipmentStatus,
  type PostShipmentSummary } from "../lib/post-shipment-dashboard";
import { nextChartSelection } from "../lib/purchase-order-lines";
import type { SearchableOption } from "../lib/searchable-options";
import { fetchRetryingTransient } from "../lib/transient-retry";
import DateRangeFilter from "./DateRangeFilter";
import E2eCollapsible from "./E2eCollapsible";
import ExportColumnsDialog from "./ExportColumnsDialog";
import { getMessages, useI18n } from "./I18nProvider";
import { MultiSelectFilter } from "./MultiSelectFilter";
import PostShipmentCharts, { PostShipmentIndicators } from "./PostShipmentCharts";
import { Tooltip } from "./Tooltip";
import { useDebouncedValue } from "./useDebouncedValue";
import { useExcelExport } from "./useProductLineExport";

const pageSize = 50;
// Quiet time after the last filter or chart click before the summary and the table are requested.
const fetchDelayMs = 250;
const textOptions = (values: string[] | undefined): SearchableOption[] => (values ?? []).map(value => ({ value, label: value }));
/** A result kept with the query it answers, so a newer query shows as loading without clearing the screen. */
type Loaded<T> = { query: string; data?: T; error?: string };

/** The date fields of a period: its dates from today, and the relative period kept in the URL. */
function dateFields(value: DateRangeValue, today: string): Pick<PostShipmentFilters, "dateFrom" | "dateTo" | "datePeriod"> {
  const { from, to } = resolveDateRange(value, today);
  return { dateFrom: from, dateTo: to, datePeriod: value.kind === "relative" ? formatRelativeSpec(value.range, value.excludeOpen) : "" };
}
const dateValue = (filters: PostShipmentFilters) => dateRangeValue(filters.datePeriod, filters.dateFrom, filters.dateTo);

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
          error: reason instanceof Error ? reason.message : getMessages().reports.postDashboard.loadFailed });
      });
    return () => controller.abort();
  }, [path, query]);
  return loaded;
}

/** Status as in the status chart: the swatch of its colour and the name. */
function IpStatus({ status }: { status: PostShipmentStatus }) {
  const { m } = useI18n();
  return <span className="e2e-status">
    <span className="e2e-chart-swatch" style={{ background: `var(${postShipmentStatusColors[status]})` }} />
    {statusLabel(m, status)}
  </span>;
}

/** Days of a table cell in a badge: green within the target, red above it; a plain number without a target. */
function DaysBadge({ days, onTarget, tip }: { days: number | null; onTarget: boolean | null; tip: string }) {
  if (days === null) return <>—</>;
  if (onTarget === null) return <Tooltip content={tip}><span>{days}</span></Tooltip>;
  return <Tooltip content={tip}>
    <span className={onTarget ? "badge badge-success" : "badge badge-danger"}>{onTarget ? "✓" : "✕"} {days}</span>
  </Tooltip>;
}

function LineRow({ line }: { line: PostShipmentLine }) {
  const { m, locale } = useI18n();
  const p = m.reports.postDashboard;
  const date = (value: string | null) => formatE2eDate(value, locale);
  const ltDocTip = line.ltDocTarget === null ? p.ltDocNoTarget
    : line.ltDocOnTarget ? p.ltDocOnTarget(String(line.ltDocTarget)) : p.ltDocLate(String(line.ltDocTarget));
  const target = String(postShipmentLeadTimeTarget);
  const leadTimeTone = atMostTone(line.leadTime, postShipmentLeadTimeTarget);
  // SLA TXT: green up to 20 days, red above (the BI rule).
  const slaTarget = String(postShipmentSlaTxtTarget);
  const slaTxtTone = atMostTone(line.slaTxt, postShipmentSlaTxtTarget);
  return <tr>
    <td>{date(line.necessityDate)}</td>
    <td><Link className="text-link" href={`/processes/${line.id}`}>{line.ipNumber}</Link></td>
    <td>{line.priorityKey === "priority" ? <span className="badge badge-warning">{line.priority}</span> : p.priorities.normal}</td>
    <td>{line.incoterm ?? "—"}</td>
    <td>{line.mode ?? "—"}</td>
    <td><IpStatus status={line.status} /></td>
    <td>{date(line.duimpDate)}</td>
    <td>{date(line.documentsOkDate)}</td>
    <td>{date(line.arrivalDate)}</td>
    <td><DaysBadge days={line.ltDoc} onTarget={line.ltDocOnTarget} tip={ltDocTip} /></td>
    <td>{date(line.etd)}</td><td>{date(line.eta)}</td><td>{date(line.ete)}</td>
    <td>{date(line.deliveryDate)}</td>
    <td>{formatContainers(line.containerQuantity, locale)}</td>
    <td><DaysBadge days={line.leadTime} onTarget={leadTimeTone === null ? null : leadTimeTone === "good"}
      tip={leadTimeTone === "good" ? p.leadTimeOnTarget(target) : p.leadTimeLate(target)} /></td>
    <td>{p.clearanceTypes[line.clearanceType]}</td>
    <td><DaysBadge days={line.slaTxt} onTarget={slaTxtTone === null ? null : slaTxtTone === "good"}
      tip={slaTxtTone === "good" ? p.leadTimeOnTarget(slaTarget) : p.leadTimeLate(slaTarget)} /></td>
  </tr>;
}

/**
 * The post-shipment dashboard (the BI "Pós Embarque" metrics, one line per IP): the filter form, the number cards,
 * the table of the IPs and then the charts. The form waits for Apply; the period and the chart clicks apply at once. The API is
 * called once the choices stop for a moment, and the last summary stays on screen while a new one loads.
 */
export default function PostShipmentDashboard({ initialQuery }: { initialQuery: string }) {
  const { m, locale } = useI18n();
  const p = m.reports.postDashboard;
  const c = p.columns;
  const today = e2eToday();
  const [initial] = useState(() => {
    const query = new URLSearchParams(initialQuery);
    const filters = parsePostShipmentFilters(query);
    const requestedPage = Number(query.get("page"));
    // A relative period from a link counts from today, not from the day the link was made.
    return { filters: { ...filters, ...dateFields(dateValue(filters), e2eToday()) },
      page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1 };
  });
  const [draft, setDraft] = useState(initial.filters);
  const [applied, setApplied] = useState(initial.filters);
  const [page, setPage] = useState(initial.page);
  const [options, setOptions] = useState<PostShipmentFilterOptions>();
  const { exporting, exportStatus, exportError, runExport } = useExcelExport("pos-embarque");
  const [choosingColumns, setChoosingColumns] = useState(false);
  const summaryQuery = useDebouncedValue(postShipmentSummaryQuery(applied).toString(), fetchDelayMs);
  const linesQuery = useDebouncedValue(postShipmentLinesQuery(applied, page, pageSize).toString(), fetchDelayMs);
  const summaryLoaded = useLoaded<PostShipmentSummary>("/api/v1/reports/post-shipment/summary", summaryQuery);
  const linesLoaded = useLoaded<PostShipmentLinesPage>("/api/v1/reports/post-shipment/lines", linesQuery);
  const summary = summaryLoaded?.data;
  const lines = linesLoaded?.query === linesQuery ? linesLoaded : undefined;

  // The options do not depend on the filters: loaded once. Without them the fields keep only the chosen values.
  useEffect(() => {
    const controller = new AbortController();
    apiFetch("/api/v1/reports/post-shipment/filter-options", { signal: controller.signal })
      .then(response => readApiJson<PostShipmentFilterOptions>(response))
      .then(data => { if (!controller.signal.aborted) setOptions(data); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  function apply(filters: PostShipmentFilters, nextPage = 1) {
    setApplied(filters); setPage(nextPage);
    const query = postShipmentUrlQuery(filters, nextPage).toString();
    window.history.replaceState(null, "", `/reports/post${query ? `?${query}` : ""}`);
  }
  // Every value of a list checked is the same as none, so the URL and the API stay short.
  function effective(filters: PostShipmentFilters): PostShipmentFilters {
    return { ...filters, status: effectiveSelection(filters.status, postShipmentStatuses) as PostShipmentStatus[],
      priority: effectiveSelection(filters.priority, postShipmentPriorities) as PostShipmentPriority[],
      importers: effectiveSelection(filters.importers, options?.importers ?? []),
      modes: effectiveSelection(filters.modes, options?.modes ?? []) };
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const filters = effective(draft);
    setDraft(filters); apply(filters);
  }
  function clear() { setDraft(emptyPostShipmentFilters); apply(emptyPostShipmentFilters); }
  // The period picker has its own Apply, so its choice applies at once, keeping the other fields being edited.
  function applyDate(value: DateRangeValue) {
    const fields = dateFields(value, today);
    setDraft({ ...draft, ...fields }); apply({ ...applied, ...fields });
  }
  // Chart clicks as in Power BI: a click keeps one category, Ctrl+click adds or removes it. Status and priority are
  // also fields of the form, so the form follows the click.
  function select<Key extends "status" | "channel" | "priority">(chart: Key, value: PostShipmentFilters[Key][number], additive: boolean) {
    const chosen = nextChartSelection(applied[chart] as string[], value, additive) as PostShipmentFilters[Key];
    setDraft({ ...draft, [chart]: chosen }); apply({ ...applied, [chart]: chosen });
  }
  function clearChart(chart: "status" | "channel" | "priority") {
    setDraft({ ...draft, [chart]: [] }); apply({ ...applied, [chart]: [] });
  }
  const onWaterSelected = applied.clearance.includes("onWater");
  function toggleOnWater() { apply({ ...applied, clearance: onWaterSelected ? [] : ["onWater"] }); }

  const all = p.allOption;
  const statusOptions: SearchableOption[] = postShipmentStatuses.map(status => ({ value: status, label: statusLabel(m, status) }));
  const priorityOptions: SearchableOption[] = postShipmentPriorities.map(priority => ({ value: priority, label: p.priorities[priority] }));
  const list = (key: "importers" | "modes", label: string, values: string[] | undefined) =>
    <label>{label}<MultiSelectFilter ariaLabel={label} allLabel={all} values={draft[key]} options={textOptions(values)}
      onChange={next => setDraft({ ...draft, [key]: next })} /></label>;
  const totalPages = lines?.data ? Math.ceil(lines.data.totalCount / pageSize) : 0;

  return <>
    <E2eCollapsible title={p.filtersLabel} storageKey="erp-comex-post-dashboard-filters-collapsed" icon="filter"
      activeCount={postShipmentFilterCount({ ...applied, channel: [], clearance: [] })}>
      <form className="portfolio-filter product-lines-filter e2e-overview-filters" aria-label={p.filtersLabel} onSubmit={submit}>
        <label>{p.ipNumber}<input value={draft.ipNumber} placeholder={p.searchPlaceholder} maxLength={80}
          onChange={event => setDraft({ ...draft, ipNumber: event.target.value })} /></label>
        {list("modes", p.mode, options?.modes)}
        {list("importers", p.importer, options?.importers)}
        <label>{p.status}<MultiSelectFilter ariaLabel={p.status} allLabel={all} values={draft.status} options={statusOptions}
          onChange={next => setDraft({ ...draft, status: next as PostShipmentStatus[] })} /></label>
        <label>{p.priority}<MultiSelectFilter ariaLabel={p.priority} allLabel={all} values={draft.priority} options={priorityOptions}
          onChange={next => setDraft({ ...draft, priority: next as PostShipmentPriority[] })} /></label>
        <label>{p.date}<DateRangeFilter ariaLabel={p.date} today={today} value={dateValue(draft)} onApply={applyDate} /></label>
        <div className="button-row product-lines-filter-actions"><button className="button" type="submit">{p.apply}</button>
          <button className="button secondary" type="button" onClick={clear}>{p.clear}</button></div>
      </form>
    </E2eCollapsible>

    {summaryLoaded?.error && <p className="notice error" role="alert">{summaryLoaded.error}</p>}
    {!summary && !summaryLoaded?.error && <p role="status">{p.loading}</p>}
    {summary && <PostShipmentIndicators summary={summary} onWaterSelected={onWaterSelected} onWaterToggle={toggleOnWater} />}

    <section className="card pre-dashboard-table" aria-live="polite">
      <h2>{p.tableTitle}</h2>
      {!lines && <p role="status">{p.tableLoading}</p>}
      {lines?.error && <p className="notice error" role="alert">{lines.error}</p>}
      {lines?.data && <>
        <p>{p.found(formatIps(lines.data.totalCount, locale))}
          {lines.data.totalCount > 0 && m.processDirectory.pageSuffix(page, totalPages)}</p>
        {/* The export writes the IPs of the table: the applied filters and the chart selections. */}
        {lines.data.totalCount > 0 && <p><button className="button secondary" type="button" disabled={exporting}
          onClick={() => setChoosingColumns(true)}>{exporting ? m.productLines.exporting : p.export}</button></p>}
        {choosingColumns && <ExportColumnsDialog context="post-shipment" onCancel={() => setChoosingColumns(false)}
          onExport={columns => { setChoosingColumns(false);
            void runExport("/api/v1/exports/post-shipment", { ...postShipmentFilterBody(applied), ...columns }); }} />}
        {exportStatus && <p className="muted" role="status">{exportStatus}</p>}
        {exportError && <p className="notice error" role="alert">{exportError}</p>}
        {lines.data.totalCount === 0 && <p>{p.none}</p>}
        {lines.data.lines.length > 0 && <div className="table-scroll"><table>
          <thead><tr>
            <th>{c.necessity}</th><th>{c.ip}</th><th>{c.priority}</th><th>{c.incoterm}</th><th>{c.mode}</th><th>{c.status}</th>
            <th>{c.duimpDate}</th><th>{c.documentsOk}</th><th>{c.arrival}</th><th>{c.ltDoc}</th><th>{c.etd}</th><th>{c.eta}</th>
            <th>{c.ete}</th><th>{c.delivery}</th><th>{c.containers}</th><th>{c.ltClearance}</th><th>{c.clearanceType}</th>
            <th>{c.slaTxt}</th>
          </tr></thead>
          <tbody>{lines.data.lines.map(line => <LineRow key={line.id} line={line} />)}</tbody>
        </table></div>}
        {totalPages > 1 && <nav className="pagination" aria-label={p.pages}>
          <button className="button secondary" disabled={page <= 1} onClick={() => apply(applied, page - 1)}>{m.common.previous}</button>
          <span>{m.common.pageOf(page, totalPages)}</span>
          <button className="button" disabled={page >= totalPages} onClick={() => apply(applied, page + 1)}>{m.common.next}</button>
        </nav>}
      </>}
    </section>

    {summary && <PostShipmentCharts summary={summary}
      selected={{ status: applied.status, channel: applied.channel, priority: applied.priority }}
      onSelect={{ status: (value, additive) => select("status", value, additive),
        channel: (value: PostShipmentChannel, additive) => select("channel", value, additive),
        priority: (value, additive) => select("priority", value, additive) }}
      onClear={clearChart} />}
  </>;
}
