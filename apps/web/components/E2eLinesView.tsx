"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch, readApiJson } from "../lib/api";
import { E2E_STAGE_CODES, formatE2eDate, type E2eResult, type E2eStageCode } from "../lib/e2e-analysis";
import { buildE2eFlow, DEFAULT_E2E_FLOW_CONFIG } from "../lib/e2e-flow";
import { formatNumber } from "../lib/format-number";
import { statusLabel } from "../lib/i18n/labels";
import { activeProductLineFilterCount, e2eSummaryQuery, emptyProductLineFilters, parseE2eStageFilter, parseProductLineFilters, productLineQuery,
  productLineStatuses, type E2eDeadlineStatus, type E2eStageFilter, type ProductLineFilters } from "../lib/purchase-order-lines";
import E2eCollapsible from "./E2eCollapsible";
import { E2eFlowRail, Icon, useE2eStepper } from "./E2eFlowParts";
import { E2eModelDetails, E2eModelSummary } from "./E2eModelPanels";
import E2eOverviewCharts, { type E2eOverview, type E2eOverviewStatus } from "./E2eOverviewCharts";
import E2eTabs from "./E2eTabs";
import { getMessages, useI18n } from "./I18nProvider";
import PageHeader from "./PageHeader";
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
const pageSize = 50;
const stageSide = (code: E2eStageCode) => E2E_STAGE_CODES.indexOf(code) < 3 ? "side-br" : "side-cn";

/**
 * The End to End screen: the reference model of the six stages above the spreadsheet with one row
 * per PO product line and IP, T0–T5 and the totals. Selecting a stage (or letting the animation run)
 * shows it on the model and keeps only the lines now in it, or, in the accumulated view, those that
 * already completed it. The MTS and transport toggles change only the model.
 */
export default function E2eLinesView({ initialQuery }: { initialQuery: string }) {
  const { m, locale } = useI18n();
  const t = m.e2eLines;
  const flow = t.flow;
  const [initial] = useState(() => {
    const query = new URLSearchParams(initialQuery);
    const requestedPage = Number(query.get("page"));
    const stage = parseE2eStageFilter(query);
    return { filters: parseProductLineFilters(query), stage,
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
  const [mts, setMts] = useState(false);
  const [air, setAir] = useState(false);
  const model = buildE2eFlow(DEFAULT_E2E_FLOW_CONFIG, { mts, air }, m);
  const stage: E2eStageFilter = { stage: current === null ? "" : E2E_STAGE_CODES[current], view, late, deadline };
  // The page belongs to one stage filter: a new stage (also from the animation) starts on page 1.
  const stageKey = `${stage.stage}|${view}|${late}|${deadline}`;
  const [paging, setPaging] = useState({ key: stageKey, page: initial.page });
  const page = paging.key === stageKey ? paging.page : 1;
  // Each stage loaded stays while the filters do not change, so the animation does not reload it.
  const [cache, setCache] = useState<Record<string, LinesEntry>>({});
  const [summary, setSummary] = useState<{ query: string; data?: StageSummary; error?: string }>();
  const [refresh, setRefresh] = useState(0);
  const { exporting, exportStatus, exportError, downloadExcel } = useProductLineExport("end-to-end");
  const query = productLineQuery(applied, page, pageSize, stage).toString();
  const summaryQuery = e2eSummaryQuery(applied, deadline).toString();
  const cached = query in cache;

  useEffect(() => {
    if (cached) return undefined;
    const controller = new AbortController();
    apiFetch(`/api/v1/purchase-order-lines?${query}`, { signal: controller.signal })
      .then(result => readApiJson<LinesPage>(result))
      .then(data => { if (!controller.signal.aborted) setCache(entries => ({ ...entries, [query]: { data } })); })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setCache(entries => ({ ...entries,
          [query]: { error: reason instanceof Error ? reason.message : getMessages().common.unexpectedError } }));
      });
    return () => controller.abort();
  }, [query, cached]);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch(`/api/v1/purchase-order-lines/e2e-stages?${summaryQuery}`, { signal: controller.signal })
      .then(result => readApiJson<StageSummary>(result))
      .then(data => { if (!controller.signal.aborted) setSummary({ query: summaryQuery, data }); })
      .catch(() => {
        if (!controller.signal.aborted) setSummary({ query: summaryQuery, error: getMessages().e2eLines.flow.summaryFailed });
      });
    return () => controller.abort();
  }, [summaryQuery, refresh]);

  const entry = cache[query];
  const result = entry?.data;
  const error = entry?.error ?? "";
  const counts = summary?.query === summaryQuery ? summary.data : undefined;
  const summaryError = summary?.query === summaryQuery ? summary.error : undefined;

  function syncUrl(filters: ProductLineFilters, nextStage: E2eStageFilter, nextPage: number) {
    window.history.replaceState(null, "", `/end-to-end?${productLineQuery(filters, nextPage, pageSize, nextStage)}`);
  }
  function applyFilters(filters: ProductLineFilters, nextStage = stage) {
    setApplied(filters); setCache({}); setRefresh(value => value + 1);
    setPaging({ key: stageKey, page: 1 }); syncUrl(filters, nextStage, 1);
  }
  function filter(event: FormEvent<HTMLFormElement>) { event.preventDefault(); applyFilters(draft); }
  // The overview charts cross-filter; clicking the selected category again clears it.
  function filterByStatus(status: E2eOverviewStatus) {
    const filters: ProductLineFilters = { ...applied, status: applied.status === status ? "" : status };
    setDraft(filters); applyFilters(filters);
  }
  function selectDeadline(selected: E2eDeadlineStatus) {
    const next = deadline === selected ? "" : selected;
    setDeadline(next); syncUrl(applied, { ...stage, deadline: next }, 1);
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
  const modal = (line: E2eLine) => line.calculated.e2e?.air === true ? m.e2eAnalysis.air
    : line.calculated.e2e?.air === false ? m.e2eAnalysis.sea : line.process?.transportMode ?? "—";
  const selected = (code: E2eStageCode) => code === stage.stage ? " is-selected" : "";
  const accumulatedStage = view === "reached" && stage.stage ? stage.stage : null;
  const totalPages = result ? Math.ceil(result.totalCount / pageSize) : 0;
  const p = m.productLines;
  const e = m.e2e;

  return <main className="shell e2e-flow" data-side={current === null ? undefined : model.phases[current].side}>
    <PageHeader eyebrow={t.eyebrow} title={t.title}><p>{t.intro}</p></PageHeader>
    <E2eTabs current="model" />

    <section className="e2e-toolbar" aria-label={flow.label}>
      <div className="e2e-group">
        <span className="e2e-label" id="e2e-product-label">{e.product}</span>
        <div className="e2e-segmented" role="group" aria-labelledby="e2e-product-label">
          <button type="button" aria-pressed={!mts} onClick={() => setMts(false)}>{e.notMtsOption(DEFAULT_E2E_FLOW_CONFIG.prodNaoMts)}</button>
          <button type="button" aria-pressed={mts} onClick={() => setMts(true)}>{e.mtsOption(DEFAULT_E2E_FLOW_CONFIG.prodMts)}</button>
        </div>
      </div>
      <div className="e2e-group">
        <span className="e2e-label" id="e2e-modal-label">{e.modal}</span>
        <div className="e2e-segmented" role="group" aria-labelledby="e2e-modal-label">
          <button type="button" aria-pressed={!air} onClick={() => setAir(false)}>{e.seaOption(DEFAULT_E2E_FLOW_CONFIG.maritimo)}</button>
          <button type="button" aria-pressed={air} onClick={() => setAir(true)}>{e.airOption(DEFAULT_E2E_FLOW_CONFIG.aereo)}</button>
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

    {!summaryError && summary?.query !== summaryQuery && <p role="status">{t.overview.loading}</p>}
    {counts?.overview && <E2eCollapsible title={t.overview.label} storageKey="erp-comex-e2e-charts-collapsed"
      activeCount={(applied.status ? 1 : 0) + (deadline ? 1 : 0)}>
      <E2eOverviewCharts overview={counts.overview} locale={locale} selectedStatus={applied.status}
        selectedDeadline={deadline} onStatusSelect={filterByStatus} onDeadlineSelect={selectDeadline} />
    </E2eCollapsible>}

    <E2eCollapsible className="card" title={t.panels.filtersTitle} storageKey="erp-comex-e2e-filters-collapsed"
      activeCount={activeProductLineFilterCount(applied)}>
      <form className="portfolio-filter product-lines-filter" onSubmit={filter}>
        <label>{p.poNumber}<input value={draft.purchaseOrder} onChange={event => setDraft({ ...draft, purchaseOrder: event.target.value })} /></label>
        <label>{m.processDirectory.importer}<input value={draft.importer} onChange={event => setDraft({ ...draft, importer: event.target.value })} /></label>
        <label>{m.followup.product}<input value={draft.product} onChange={event => setDraft({ ...draft, product: event.target.value })} placeholder={p.productPlaceholder} /></label>
        <label>IP<input value={draft.ipNumber} onChange={event => setDraft({ ...draft, ipNumber: event.target.value })} /></label>
        <label>{m.calc.status}<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as ProductLineFilters["status"] })}>
          <option value="">{m.processDirectory.all}</option>
          {productLineStatuses.map(status => <option key={status} value={status}>{statusLabel(m, status)}</option>)}
        </select></label>
        <label>{p.etaFrom}<input type="date" value={draft.etaFrom} onChange={event => setDraft({ ...draft, etaFrom: event.target.value })} /></label>
        <label>{p.etaTo}<input type="date" value={draft.etaTo} onChange={event => setDraft({ ...draft, etaTo: event.target.value })} /></label>
        <label>{p.situation}<select value={draft.situation} onChange={event => setDraft({ ...draft, situation: event.target.value as ProductLineFilters["situation"] })}>
          <option value="open">{p.open}</option>
          <option value="all">{p.all}</option>
        </select></label>
        <div className="button-row product-lines-filter-actions"><button className="button" type="submit">{p.apply}</button>
          <button className="button secondary" type="button" onClick={() => {
            setDraft(emptyProductLineFilters); setDeadline(""); applyFilters(emptyProductLineFilters, { ...stage, deadline: "" });
          }}>{m.processDirectory.clear}</button></div>
      </form>
    </E2eCollapsible>
    <section className="card" aria-live="polite">
      {!entry && <p role="status">{p.loading}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {result && <>
        <p>{p.found(result.totalCount)}{result.totalCount > 0 && m.processDirectory.pageSuffix(page, totalPages)}</p>
        {result.totalCount > 0 && <p><button className="button secondary" type="button" disabled={exporting}
          onClick={() => void downloadExcel(applied, stage)}>{exporting ? p.exporting : t.export}</button></p>}
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
              {E2E_STAGE_CODES.map((code, index) => <th key={code} colSpan={5} scope="colgroup"
                className={`e2e-stage-head ${index < 3 ? "side-br" : "side-cn"}${selected(code)}`}>{t.stageTitles[code]}</th>)}
              <th colSpan={3} scope="colgroup" className="e2e-stage-head">{t.totals}</th>
              <th rowSpan={2}>{t.bottleneck}</th><th rowSpan={2}>{t.currentStatus}</th><th rowSpan={2}>{t.arrivalMonth}</th>
            </tr>
            <tr>
              {E2E_STAGE_CODES.map(code => [t.deadline, t.actual, t.target, t.days, t.delay].map(label =>
                <th key={`${code}-${label}`} scope="col">{label}</th>))}
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
              <td><span className="product-lines-description" title={line.item.description}>{line.item.description}</span></td>
              <td>{modal(line)}</td><td>{line.item.group ?? "—"}</td>
              <td>{formatNumber(line.quantity)} {line.item.unit ?? ""}</td>
              {accumulatedStage && <td className={`${stageSide(accumulatedStage)} is-selected`}>
                {delay(e2e?.stages[accumulatedStage].accumulatedDelayDays)}</td>}
              {E2E_STAGE_CODES.map((code, index) => {
                const stageData = e2e?.stages[code];
                const cell = code === stage.stage ? `${index < 3 ? "side-br" : "side-cn"} is-selected` : undefined;
                return [
                  <td key={`${code}-deadline`} className={cell}>{date(stageData?.deadline)}</td>,
                  <td key={`${code}-actual`} className={cell}><span className={stageData?.source === "forecast" ? "e2e-date is-forecast" : "e2e-date"}
                    title={stageData?.source === "forecast" ? t.forecast : undefined}>{date(stageData?.actual)}</span></td>,
                  <td key={`${code}-target`} className={cell}>{days(stageData?.targetDays)}</td>,
                  <td key={`${code}-days`} className={cell}>{days(stageData?.actualDays)}</td>,
                  <td key={`${code}-delay`} className={cell}>{delay(stageData?.delayDays)}</td>,
                ];
              })}
              <td>{days(e2e?.totalTargetDays)}</td><td>{days(e2e?.totalActualDays)}</td><td>{delay(e2e?.totalDelayDays)}</td>
              <td>{e2e?.bottleneck ?? "—"}</td>
              <td>{e2e ? statusLabel(m, e2e.currentStatus) : "—"}</td>
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
