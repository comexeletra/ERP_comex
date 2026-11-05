"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch, readApiJson } from "../lib/api";
import { E2E_STAGE_CODES, e2eDateClass, e2eToday, formatE2eDate, type E2eResult, type E2eStageCode } from "../lib/e2e-analysis";
import { buildE2eFlow, DEFAULT_E2E_FLOW_CONFIG } from "../lib/e2e-flow";
import { formatNumber } from "../lib/format-number";
import { statusLabel } from "../lib/i18n/labels";
import { dateRangeValue, formatRelativeSpec, resolveDateRange, type DateRangeValue } from "../lib/date-range";
import { effectiveSelection } from "../lib/multi-select";
import { e2eOverviewFilterCount, e2eStatusColor, e2eSummaryQuery, emptyProductLineFilters, nextChartSelection,
  parseE2eStageFilter, parseProductLineFilters, productLineQuery, productLineStatuses, withE2eLists, withProductLineStatus,
  type E2eDeadlineStatus, type E2eDelayRange, type E2eStageFilter, type ProductLineFilters,
  type ProductLineStatus } from "../lib/purchase-order-lines";
import type { SearchableOption } from "../lib/searchable-options";
import { fetchRetryingTransient } from "../lib/transient-retry";
import E2eCollapsible from "./E2eCollapsible";
import { E2eFlowRail, Icon, useE2eStepper } from "./E2eFlowParts";
import DateRangeFilter from "./DateRangeFilter";
import { E2eModelDetails, E2eModelSummary } from "./E2eModelPanels";
import E2eOverviewCharts, { E2eOverviewMini, type E2eOverview, type E2eOverviewStatus } from "./E2eOverviewCharts";
import E2eTabs from "./E2eTabs";
import ExportColumnsDialog from "./ExportColumnsDialog";
import { getMessages, useI18n } from "./I18nProvider";
import { MultiSelectFilter } from "./MultiSelectFilter";
import PageHeader from "./PageHeader";
import { Tooltip } from "./Tooltip";
import { useDebouncedValue } from "./useDebouncedValue";
import { useProductLineExport } from "./useProductLineExport";

type E2eLine = {
  lineId: string; lineKind: "ALLOCATION" | "BALANCE"; quantity: string;
  purchaseOrder: { id: string; number: string; importer: string };
  item: { productCode: string; description: string; unit: string | null; necessityDate: string | null;
    scNumber: string | null; purpose: string | null; group: string | null };
  process: { id: string; ipNumber: string; transportMode?: string | null } | null;
  calculated: { status: string; e2e?: E2eResult | null };
};
type LinesPage = { page: number; pageSize: number; totalCount: number; lines: E2eLine[] };
type LinesEntry = { data?: LinesPage; error?: string };
type StageCount = { current: number; currentLate: number; reached: number; reachedLate: number };
type StageSummary = { totalCount: number; delivered: number; stages: Record<E2eStageCode, StageCount>; overview?: E2eOverview };
/** Values of the user's product lines for the filter form, from GET /api/v1/purchase-order-lines/filter-options. */
type FilterOptions = { groups: string[]; purposes: string[]; importers: string[]; purchaseOrders: string[]; ipNumbers: string[];
  products: { code: string; description: string | null }[] };
const pageSize = 50;
// Quiet time after the last filter or chart change before the table and the summary are requested.
const e2eFetchDelayMs = 250;
const stageSide = (code: E2eStageCode) => E2E_STAGE_CODES.indexOf(code) < 3 ? "side-br" : "side-cn";
const textOptions = (values: string[] | undefined): SearchableOption[] => (values ?? []).map(value => ({ value, label: value }));
/** The necessity filter fields of a period: its dates from today, and the relative period kept in the URL. */
function necessityFields(value: DateRangeValue, today: string): Pick<ProductLineFilters, "necessityFrom" | "necessityTo" | "necessityPeriod"> {
  const { from, to } = resolveDateRange(value, today);
  return { necessityFrom: from, necessityTo: to,
    necessityPeriod: value.kind === "relative" ? formatRelativeSpec(value.range, value.excludeOpen) : "" };
}
const necessityValue = (filters: ProductLineFilters) =>
  dateRangeValue(filters.necessityPeriod, filters.necessityFrom, filters.necessityTo);

/** Status as in the legend of the status chart: the swatch of its colour and the name. */
function E2eStatus({ status }: { status: string }) {
  const { m } = useI18n();
  const color = e2eStatusColor(status);
  return <span className="e2e-status">
    {color && <span className="e2e-chart-swatch" style={{ background: `var(${color})` }} />}
    {statusLabel(m, status)}
  </span>;
}

/**
 * The End to End screen: the reference model of the six stages above the spreadsheet with one row
 * per PO product line and IP, T0–T5 and the totals. Selecting a stage (or letting the animation run)
 * shows it on the model and keeps only the lines now in it, or, in the accumulated view, those that
 * already completed it. The product and transport toggles filter the lines, the cards and the charts, and
 * set the scenario of the model; the charts show the lines of the table.
 */
export default function E2eLinesView({ initialQuery }: { initialQuery: string }) {
  const { m, locale } = useI18n();
  const t = m.e2eLines;
  const flow = t.flow;
  const [initial] = useState(() => {
    const query = new URLSearchParams(initialQuery);
    const requestedPage = Number(query.get("page"));
    const stage = parseE2eStageFilter(query);
    const filters = withE2eLists(parseProductLineFilters(query));
    // A relative necessity period from a link counts from today, not from the day the link was made.
    return { filters: { ...filters, ...necessityFields(necessityValue(filters), e2eToday()) }, stage,
      page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1 };
  });
  const [draft, setDraft] = useState<ProductLineFilters>(initial.filters);
  const [applied, setApplied] = useState<ProductLineFilters>(initial.filters);
  const stepper = useE2eStepper(E2E_STAGE_CODES.length, DEFAULT_E2E_FLOW_CONFIG.intervaloMs, false,
    initial.stage.stage ? E2E_STAGE_CODES.indexOf(initial.stage.stage) : null);
  const current = stepper.current;
  const [view, setView] = useState(initial.stage.view);
  const [late, setLate] = useState(initial.stage.late);
  const [deadline, setDeadline] = useState(initial.stage.deadline);
  const [delayRange, setDelayRange] = useState(initial.stage.delayRange);
  // The product and transport toggles filter the lines; "All" keeps the default scenario of the model.
  const [demandType, setDemandType] = useState(initial.stage.demandType);
  const [modal, setModal] = useState(initial.stage.modal);
  const mts = demandType === "mts";
  const air = modal === "air";
  const model = buildE2eFlow(DEFAULT_E2E_FLOW_CONFIG, { mts, air }, m);
  const stage: E2eStageFilter = { stage: current === null ? "" : E2E_STAGE_CODES[current], view, late, deadline,
    delayRange, demandType, modal };
  // The page belongs to one stage filter: a new stage (also from the animation) starts on page 1.
  const stageKey = `${stage.stage}|${view}|${late}|${deadline.join(",")}|${delayRange.join(",")}|${demandType}|${modal}`;
  const [paging, setPaging] = useState({ key: stageKey, page: initial.page });
  const page = paging.key === stageKey ? paging.page : 1;
  // Each stage loaded stays while the filters do not change, so the animation does not reload it.
  const [cache, setCache] = useState<Record<string, LinesEntry>>({});
  // The same for the summaries: the charts follow the stage, and the animation does not reload them.
  const [summaries, setSummaries] = useState<Record<string, { data?: StageSummary; error?: string }>>({});
  const [lastSummary, setLastSummary] = useState<StageSummary>();
  const today = e2eToday();
  const [filterOptions, setFilterOptions] = useState<FilterOptions>();
  const { exporting, exportStatus, exportError, downloadExcel } = useProductLineExport("end-to-end");
  const [choosingColumns, setChoosingColumns] = useState(false);
  const query = productLineQuery(applied, page, pageSize, stage).toString();
  const summaryQuery = e2eSummaryQuery(applied, stage).toString();
  // Each chart click, Ctrl+click or filter applies at once on screen, but the API is only called once the
  // choices stop for a moment: a burst of clicks becomes one table and one summary request.
  const settledQuery = useDebouncedValue(query, e2eFetchDelayMs);
  const settledSummaryQuery = useDebouncedValue(summaryQuery, e2eFetchDelayMs);
  // Only loaded data counts as cached: a failure is shown, and asking for the same filters again tries again.
  const cached = cache[settledQuery]?.data !== undefined;
  const summaryCached = summaries[settledSummaryQuery]?.data !== undefined;

  useEffect(() => {
    if (cached) return undefined;
    const controller = new AbortController();
    fetchRetryingTransient(() => apiFetch(`/api/v1/purchase-order-lines?${settledQuery}`, { signal: controller.signal }),
      controller.signal)
      .then(result => readApiJson<LinesPage>(result))
      .then(data => { if (!controller.signal.aborted) setCache(entries => ({ ...entries, [settledQuery]: { data } })); })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setCache(entries => ({ ...entries,
          [settledQuery]: { error: reason instanceof Error ? reason.message : getMessages().common.unexpectedError } }));
      });
    return () => controller.abort();
  }, [settledQuery, cached]);

  useEffect(() => {
    if (summaryCached) return undefined;
    const controller = new AbortController();
    fetchRetryingTransient(() => apiFetch(`/api/v1/purchase-order-lines/e2e-stages?${settledSummaryQuery}`,
      { signal: controller.signal }), controller.signal)
      .then(result => readApiJson<StageSummary>(result))
      .then(data => {
        if (!controller.signal.aborted) {
          setSummaries(entries => ({ ...entries, [settledSummaryQuery]: { data } })); setLastSummary(data);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setSummaries(entries => ({ ...entries,
          [settledSummaryQuery]: { error: getMessages().e2eLines.flow.summaryFailed } }));
      });
    return () => controller.abort();
  }, [settledSummaryQuery, summaryCached]);

  // The options do not depend on the filters: loaded once. Without them the fields keep only the chosen value.
  useEffect(() => {
    const controller = new AbortController();
    apiFetch("/api/v1/purchase-order-lines/filter-options", { signal: controller.signal })
      .then(result => readApiJson<FilterOptions>(result))
      .then(data => { if (!controller.signal.aborted) setFilterOptions(data); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const entry = cache[query];
  const result = entry?.data;
  const error = entry?.error ?? "";
  const summaryEntry = summaries[summaryQuery];
  // While a new stage loads, the last summary stays on screen instead of emptying the cards and charts.
  const counts = summaryEntry ? summaryEntry.data : lastSummary;
  const summaryError = summaryEntry?.error;

  function syncUrl(filters: ProductLineFilters, nextStage: E2eStageFilter, nextPage: number) {
    const url = productLineQuery(filters, nextPage, pageSize, nextStage);
    if (filters.necessityPeriod) url.set("necessityPeriod", filters.necessityPeriod);
    window.history.replaceState(null, "", `/end-to-end?${url}`);
  }
  function applyFilters(filters: ProductLineFilters, nextStage = stage) {
    setApplied(filters); setCache({}); setSummaries({});
    setPaging({ key: stageKey, page: 1 }); syncUrl(filters, nextStage, 1);
  }
  // Every value of a list checked is the same as none, so the URL and the API stay short.
  function effectiveFilters(filters: ProductLineFilters): ProductLineFilters {
    const o = filterOptions;
    return { ...filters, status: effectiveSelection(filters.status, productLineStatuses) as ProductLineStatus[],
      group: effectiveSelection(filters.group, o?.groups ?? []), purpose: effectiveSelection(filters.purpose, o?.purposes ?? []),
      importers: effectiveSelection(filters.importers, o?.importers ?? []),
      purchaseOrders: effectiveSelection(filters.purchaseOrders, o?.purchaseOrders ?? []),
      ipNumbers: effectiveSelection(filters.ipNumbers, o?.ipNumbers ?? []),
      productCodes: effectiveSelection(filters.productCodes, (o?.products ?? []).map(product => product.code)) };
  }
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const filters = effectiveFilters(draft);
    setDraft(filters); applyFilters(filters);
  }
  // The overview charts cross-filter. On the status chart a click keeps only that status (clicking the only
  // one selected clears it) and Ctrl+click adds or removes it, as in Power BI.
  function filterByStatus(status: E2eOverviewStatus, additive: boolean) {
    const filters = withProductLineStatus(applied, nextChartSelection(applied.status, status, additive));
    setDraft(filters); applyFilters(filters);
  }
  function clearStatus() {
    const filters = withProductLineStatus(applied, []);
    setDraft(filters); applyFilters(filters);
  }
  // The current stage of the filter form is the stage of the cards and the animation, in the current view.
  function selectCurrentStage(code: "" | E2eStageCode) {
    const k = code ? E2E_STAGE_CODES.indexOf(code) : null;
    stepper.goTo(k); setView("current");
    syncUrl(applied, { ...stage, stage: code, view: "current" }, 1);
  }
  // The period picker has its own Apply, so its choice applies at once, keeping the other fields being edited.
  function applyNecessity(value: DateRangeValue) {
    const fields = necessityFields(value, today);
    setDraft({ ...draft, ...fields }); applyFilters({ ...applied, ...fields });
  }
  function clearFilters() {
    setDraft(emptyProductLineFilters); setDeadline([]); setDelayRange([]);
    stepper.goTo(null); setDemandType("");
    applyFilters(emptyProductLineFilters, { ...stage, stage: "", deadline: [], delayRange: [], demandType: "" });
  }
  // The deadline and delay range charts select like the status chart: a click keeps one, Ctrl+click adds or removes.
  function changeDeadline(next: E2eDeadlineStatus[]) {
    setDeadline(next); syncUrl(applied, { ...stage, deadline: next }, 1);
  }
  function selectDeadline(selected: E2eDeadlineStatus, additive: boolean) {
    changeDeadline(nextChartSelection(deadline, selected, additive));
  }
  function changeDemandType(next: E2eStageFilter["demandType"]) {
    setDemandType(next); syncUrl(applied, { ...stage, demandType: next }, 1);
  }
  function changeModal(next: E2eStageFilter["modal"]) {
    setModal(next); syncUrl(applied, { ...stage, modal: next }, 1);
  }
  function changeDelayRange(next: E2eDelayRange[]) {
    setDelayRange(next); syncUrl(applied, { ...stage, delayRange: next }, 1);
  }
  function selectDelayRange(selected: E2eDelayRange, additive: boolean) {
    changeDelayRange(nextChartSelection(delayRange, selected, additive));
  }
  function select(k: number | null) {
    stepper.goTo(k);
    syncUrl(applied, { ...stage, stage: k === null ? "" : E2E_STAGE_CODES[k] }, 1);
  }
  function changeView(next: E2eStageFilter["view"]) { setView(next); syncUrl(applied, { ...stage, view: next }, 1); }
  function toggleLate() { setLate(!late); syncUrl(applied, { ...stage, late: !late }, 1); }
  function goToPage(next: number) { setPaging({ key: stageKey, page: next }); syncUrl(applied, stage, next); }

  const date = (value: string | null | undefined) => formatE2eDate(value, locale);
  const days = (value: number | null | undefined) => value === null || value === undefined ? "—" : String(value);
  const delay = (value: number | null | undefined) => value === null || value === undefined ? <span>—</span>
    : <span className={`e2e-deviation${value > 0 ? " is-late" : " is-ok"}`}>{value > 0 ? `+${value}` : value}</span>;
  const modalLabel = (line: E2eLine) => line.calculated.e2e?.air === true ? m.e2eAnalysis.air
    : line.calculated.e2e?.air === false ? m.e2eAnalysis.sea : line.process?.transportMode ?? "—";
  const selected = (code: E2eStageCode) => code === stage.stage ? " is-selected" : "";
  const accumulatedStage = view === "reached" && stage.stage ? stage.stage : null;
  const totalPages = result ? Math.ceil(result.totalCount / pageSize) : 0;
  const p = m.productLines;
  const e = m.e2e;
  const f = t.overview.filters;
  const all = m.processDirectory.all;
  const productOptions: SearchableOption[] = (filterOptions?.products ?? []).map(product => ({ value: product.code,
    label: product.description ? `${product.code} · ${product.description}` : product.code }));
  const statusOptions: SearchableOption[] = productLineStatuses.map(status => ({ value: status, label: statusLabel(m, status) }));

  return <main className="shell e2e-flow" data-side={current === null ? undefined : model.phases[current].side}>
    <PageHeader eyebrow={t.eyebrow} title={t.title}><p>{t.intro}</p></PageHeader>
    <E2eTabs current="model" />

    <section className="e2e-toolbar" aria-label={flow.label}>
      <div className="e2e-group">
        <span className="e2e-label" id="e2e-product-label">{e.product}</span>
        <div className="e2e-segmented" role="group" aria-labelledby="e2e-product-label">
          <button type="button" aria-pressed={demandType === ""} onClick={() => changeDemandType("")}>{e.allOption}</button>
          <button type="button" aria-pressed={demandType === "notMts"} onClick={() => changeDemandType("notMts")}>
            {e.notMtsOption(DEFAULT_E2E_FLOW_CONFIG.prodNaoMts)}</button>
          <button type="button" aria-pressed={mts} onClick={() => changeDemandType("mts")}>{e.mtsOption(DEFAULT_E2E_FLOW_CONFIG.prodMts)}</button>
        </div>
      </div>
      <div className="e2e-group">
        <span className="e2e-label" id="e2e-modal-label">{e.modal}</span>
        <div className="e2e-segmented" role="group" aria-labelledby="e2e-modal-label">
          <button type="button" aria-pressed={modal === ""} onClick={() => changeModal("")}>{e.allOption}</button>
          <button type="button" aria-pressed={modal === "sea"} onClick={() => changeModal("sea")}>{e.seaOption(DEFAULT_E2E_FLOW_CONFIG.maritimo)}</button>
          <button type="button" aria-pressed={air} onClick={() => changeModal("air")}>{e.airOption(DEFAULT_E2E_FLOW_CONFIG.aereo)}</button>
        </div>
      </div>
      <div className="e2e-group">
        <span className="e2e-label" id="e2e-view-label">{flow.view}</span>
        <div className="e2e-segmented" role="group" aria-labelledby="e2e-view-label">
          <button type="button" aria-pressed={view === "current"} onClick={() => changeView("current")}>{flow.viewCurrent}</button>
          <button type="button" aria-pressed={view === "reached"} onClick={() => changeView("reached")}>{flow.viewReached}</button>
        </div>
        <div className="e2e-segmented">
          <button type="button" aria-pressed={late} onClick={toggleLate}>{flow.lateOnly}</button>
        </div>
      </div>
      <div className="e2e-controls">
        <button type="button" className="button secondary" disabled={current === null} onClick={() => select(null)}>{flow.allStages}</button>
        {current !== null && <span className="e2e-counter" aria-live="polite">
          {e.phaseBefore}<b>{current + 1}</b>{e.phaseAfter(E2E_STAGE_CODES.length)}</span>}
        <button type="button" className="e2e-icon-button" aria-label={e.previousPhase}
          onClick={() => select(((current ?? 0) + E2E_STAGE_CODES.length - 1) % E2E_STAGE_CODES.length)}><Icon name="prev" size={18} /></button>
        <button type="button" className="button e2e-play" aria-label={stepper.playing ? e.pauseAnimation : e.startAnimation}
          onClick={stepper.toggle}>
          <Icon name={stepper.playing ? "pause" : "play"} size={16} /><span>{stepper.playing ? e.pause : e.animate}</span>
        </button>
        <button type="button" className="e2e-icon-button" aria-label={e.nextPhase}
          onClick={() => select(current === null ? 0 : (current + 1) % E2E_STAGE_CODES.length)}><Icon name="next" size={18} /></button>
      </div>
    </section>
    <p className="muted">{view === "current" ? flow.currentHelp : flow.reachedHelp}
      {counts && counts.delivered > 0 && <> · {flow.delivered(counts.delivered)}</>}</p>
    {summaryError && <p className="notice error" role="alert">{summaryError}</p>}

    <E2eModelSummary flow={model} current={current} />
    <E2eFlowRail phases={model.phases} current={current} />
    <div className="e2e-grid6 e2e-phases">
      {model.phases.map((phase, k) => {
        const count = counts?.stages[E2E_STAGE_CODES[k]];
        const total = count ? (view === "current" ? count.current : count.reached) : null;
        const lateCount = count ? (view === "current" ? count.currentLate : count.reachedLate) : null;
        const status = current === null ? null : k === current ? e.statusCurrent : k < current ? e.statusDone : e.statusNext;
        return <button type="button" key={phase.code} onClick={() => select(k === current ? null : k)}
          aria-pressed={k === current}
          className={`e2e-phase side-${phase.side}${k === current ? " is-current" : ""}${current !== null && k < current ? " is-done" : ""}`}>
          <span className="e2e-phase-bar" />
          <span className="e2e-phase-top"><span className="e2e-phase-code">{phase.code}</span>
            {status && <span className="e2e-label">{status}</span>}</span>
          <span className="e2e-phase-head"><span className="e2e-phase-icon"><Icon name={phase.icon} /></span>
            <strong>{phase.name}</strong></span>
          <span className="e2e-phase-route">
            <span><span className="e2e-label">{e.from}</span><span>{phase.from}</span></span>
            <span><span className="e2e-label">{e.to}</span><span>{phase.to}</span></span>
          </span>
          <span className="e2e-phase-foot"><span className="e2e-label">{phase.owner}</span><b>{phase.lt}</b></span>
          <span className="e2e-stage-count">
            <span className="e2e-label">{total === null ? "—" : view === "current" ? flow.inStage(total) : flow.passed(total)}</span>
            {lateCount !== null && <span className={`e2e-deviation${lateCount > 0 ? " is-late" : " is-ok"}`}>
              {lateCount > 0 ? flow.late(lateCount) : flow.noneLate}</span>}
          </span>
        </button>;
      })}
    </div>
    <E2eModelDetails flow={model} current={current} mts={mts} air={air} />

    <E2eCollapsible title={t.overview.label} storageKey="erp-comex-e2e-charts-collapsed" icon="chart"
      activeCount={e2eOverviewFilterCount(applied, stage)}
      collapsedSummary={counts?.overview ? <E2eOverviewMini overview={counts.overview} locale={locale} /> : undefined}>
      {/* One filter form for the table and the charts. The current stage and the demand type are the stage
          cards and the toolbar, so they apply at once; the other fields wait for Apply. */}
      <form className="portfolio-filter product-lines-filter e2e-overview-filters" aria-label={f.label} onSubmit={filter}>
        <label>{p.poNumber}<MultiSelectFilter ariaLabel={p.poNumber} allLabel={all} values={draft.purchaseOrders}
          options={textOptions(filterOptions?.purchaseOrders)}
          onChange={values => setDraft({ ...draft, purchaseOrders: values })} /></label>
        <label>{m.processDirectory.importer}<MultiSelectFilter ariaLabel={m.processDirectory.importer} allLabel={all}
          values={draft.importers} options={textOptions(filterOptions?.importers)}
          onChange={values => setDraft({ ...draft, importers: values })} /></label>
        <label>{m.followup.product}<MultiSelectFilter ariaLabel={m.followup.product} allLabel={all}
          searchPlaceholder={p.productPlaceholder} values={draft.productCodes} options={productOptions}
          onChange={values => setDraft({ ...draft, productCodes: values })} /></label>
        <label>IP<MultiSelectFilter ariaLabel="IP" allLabel={all} values={draft.ipNumbers}
          options={textOptions(filterOptions?.ipNumbers)} onChange={values => setDraft({ ...draft, ipNumbers: values })} /></label>
        <label>{m.calc.status}<MultiSelectFilter ariaLabel={m.calc.status} allLabel={all} values={draft.status}
          options={statusOptions}
          onChange={values => setDraft(withProductLineStatus(draft, values as ProductLineStatus[]))} /></label>
        <label>{f.currentStage}<select value={stage.stage} onChange={event => selectCurrentStage(event.target.value as "" | E2eStageCode)}>
          <option value="">{all}</option>
          {E2E_STAGE_CODES.map(code => <option key={code} value={code}>{t.stageTitles[code]}</option>)}
        </select></label>
        <label>{f.demandType}<select value={demandType}
          onChange={event => changeDemandType(event.target.value as E2eStageFilter["demandType"])}>
          <option value="">{all}</option>
          <option value="mts">{f.mts}</option>
          <option value="notMts">{f.notMts}</option>
        </select></label>
        <label>{p.situation}<select value={draft.situation} onChange={event => setDraft({ ...draft, situation: event.target.value as ProductLineFilters["situation"] })}>
          <option value="open">{p.open}</option>
          <option value="all">{p.all}</option>
        </select></label>
        <label>{f.group}<MultiSelectFilter ariaLabel={f.group} allLabel={all} values={draft.group}
          options={textOptions(filterOptions?.groups)} onChange={values => setDraft({ ...draft, group: values })} /></label>
        <label>{f.purpose}<MultiSelectFilter ariaLabel={f.purpose} allLabel={all} values={draft.purpose}
          options={textOptions(filterOptions?.purposes)} onChange={values => setDraft({ ...draft, purpose: values })} /></label>
        <label>{p.etaFrom}<input type="date" value={draft.etaFrom} onChange={event => setDraft({ ...draft, etaFrom: event.target.value })} /></label>
        <label>{p.etaTo}<input type="date" value={draft.etaTo} onChange={event => setDraft({ ...draft, etaTo: event.target.value })} /></label>
        <label>{f.necessity}<DateRangeFilter ariaLabel={f.necessity} today={today} value={necessityValue(draft)}
          onApply={applyNecessity} /></label>
        <div className="button-row product-lines-filter-actions"><button className="button" type="submit">{p.apply}</button>
          <button className="button secondary" type="button" onClick={clearFilters}>{m.processDirectory.clear}</button></div>
      </form>
      {!counts && !summaryError && <p role="status">{t.overview.loading}</p>}
      {counts?.overview && <E2eOverviewCharts overview={counts.overview} locale={locale} selectedStatuses={applied.status}
        onStatusSelect={filterByStatus} onStatusClear={clearStatus}
        selectedDeadlines={deadline} onDeadlineSelect={selectDeadline} onDeadlineClear={() => changeDeadline([])}
        selectedDelayRanges={delayRange} onDelayRangeSelect={selectDelayRange} onDelayRangeClear={() => changeDelayRange([])} />}
    </E2eCollapsible>
    <section className="card" aria-live="polite">
      {!entry && <p role="status">{p.loading}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {result && <>
        <p>{p.found(result.totalCount)}{result.totalCount > 0 && m.processDirectory.pageSuffix(page, totalPages)}</p>
        {result.totalCount > 0 && <p><button className="button secondary" type="button" disabled={exporting}
          onClick={() => setChoosingColumns(true)}>{exporting ? p.exporting : t.export}</button></p>}
        {choosingColumns && <ExportColumnsDialog context="end-to-end" filters={{ stage: stage.stage, view }}
          onCancel={() => setChoosingColumns(false)}
          onExport={columns => { setChoosingColumns(false); void downloadExcel(applied, stage, columns); }} />}
        {exportStatus && <p className="muted" role="status">{exportStatus}</p>}
        {exportError && <p className="notice error" role="alert">{exportError}</p>}
        {result.totalCount === 0 && <p>{p.none}</p>}
        {result.lines.length > 0 && <div className="table-scroll"><table className="e2e-lines-table">
          <thead>
            <tr>
              <th rowSpan={2}>{t.necessity}</th><th rowSpan={2}>PO</th><th rowSpan={2}>{t.sc}</th><th rowSpan={2}>IP</th>
              <th rowSpan={2}>{m.calc.status}</th><th rowSpan={2}>{t.purpose}</th><th rowSpan={2}>{t.product}</th>
              <th rowSpan={2}>{t.description}</th><th rowSpan={2}>{t.modal}</th><th rowSpan={2}>{t.group}</th><th rowSpan={2}>{t.quantity}</th>
              {accumulatedStage && <th rowSpan={2} className={`e2e-stage-head ${stageSide(accumulatedStage)} is-selected`}>
                {flow.accumulated(accumulatedStage)}</th>}
              {E2E_STAGE_CODES.map((code, index) => <th key={code} colSpan={5} scope="colgroup" data-stage={code}
                className={`e2e-stage-head ${index < 3 ? "side-br" : "side-cn"}${selected(code)}`}>{t.stageTitles[code]}</th>)}
              <th colSpan={3} scope="colgroup" className="e2e-stage-head">{t.totals}</th>
              <th rowSpan={2}>{t.bottleneck}</th><th rowSpan={2}>{t.currentStatus}</th><th rowSpan={2}>{t.arrivalMonth}</th>
            </tr>
            <tr>
              {E2E_STAGE_CODES.map(code => [t.deadline, t.actual, t.target, t.days, t.delay].map(label =>
                <th key={`${code}-${label}`} scope="col" data-stage={code}>{label}</th>))}
              <th scope="col">{t.target}</th><th scope="col">{t.actual}</th><th scope="col">{t.delay}</th>
            </tr>
          </thead>
          <tbody>{result.lines.map(line => {
            const e2e = line.calculated.e2e;
            return <tr key={`${line.lineKind}-${line.lineId}`}>
              <td>{date(line.item.necessityDate)}</td>
              <td><Link className="text-link" href={`/end-to-end/po?id=${encodeURIComponent(line.purchaseOrder.id)}`}>{line.purchaseOrder.number}</Link></td>
              <td>{line.item.scNumber ?? "—"}</td>
              <td>{line.process ? <Link className="text-link" href={`/processes/${line.process.id}`}>{line.process.ipNumber}</Link>
                : <span className="po-ip-pending">{m.followup.noIp}</span>}</td>
              <td>{statusLabel(m, line.calculated.status)}</td>
              <td>{line.item.purpose ?? "—"}</td>
              <td><strong>{line.item.productCode}</strong></td>
              <td><Tooltip content={line.item.description}><span className="product-lines-description">{line.item.description}</span></Tooltip></td>
              <td>{modalLabel(line)}</td><td>{line.item.group ?? "—"}</td>
              <td>{formatNumber(line.quantity)} {line.item.unit ?? ""}</td>
              {accumulatedStage && <td className={`${stageSide(accumulatedStage)} is-selected`}>
                {delay(e2e?.stages[accumulatedStage].accumulatedDelayDays)}</td>}
              {E2E_STAGE_CODES.map((code, index) => {
                const stageData = e2e?.stages[code];
                const cell = code === stage.stage ? `${index < 3 ? "side-br" : "side-cn"} is-selected` : undefined;
                return [
                  <td key={`${code}-deadline`} data-stage={code} className={cell}>{date(stageData?.deadline)}</td>,
                  <td key={`${code}-actual`} data-stage={code} className={cell}><Tooltip content={stageData?.source === "forecast" ? t.forecast : undefined}>
                    <span className={e2eDateClass(stageData)}>{date(stageData?.actual)}</span></Tooltip></td>,
                  <td key={`${code}-target`} data-stage={code} className={cell}>{days(stageData?.targetDays)}</td>,
                  <td key={`${code}-days`} data-stage={code} className={cell}>{days(stageData?.actualDays)}</td>,
                  <td key={`${code}-delay`} data-stage={code} className={cell}>{delay(stageData?.delayDays)}</td>,
                ];
              })}
              <td>{days(e2e?.totalTargetDays)}</td><td>{days(e2e?.totalActualDays)}</td><td>{delay(e2e?.totalDelayDays)}</td>
              <td>{e2e?.bottleneck ?? "—"}</td>
              <td>{e2e ? <E2eStatus status={e2e.currentStatus} /> : "—"}</td>
              <td>{e2e?.arrivalYearMonth ?? "—"}</td>
            </tr>;
          })}</tbody>
        </table></div>}
        {totalPages > 1 && <nav className="pagination" aria-label={p.pages}>
          <button className="button secondary" disabled={page <= 1} onClick={() => goToPage(page - 1)}>{m.common.previous}</button>
          <span>{m.common.pageOf(page, totalPages)}</span>
          <button className="button" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>{m.common.next}</button>
        </nav>}
      </>}
    </section>
  </main>;
}
