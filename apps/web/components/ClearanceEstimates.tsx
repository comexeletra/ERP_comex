"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch, readApiJson } from "../lib/api";
import { clearanceEstimatesQueryParams, clearancePeriods, clearanceRegistered, clearanceStatuses, emptyClearanceFilters,
  formatBrl, type ClearanceEstimates as ClearanceEstimatesData, type ClearanceFilters, type ClearancePeriod,
  type ClearanceRegistered, type ClearanceStatus } from "../lib/clearance-estimates";
import { formatE2eDate } from "../lib/e2e-analysis";
import { statusLabel } from "../lib/i18n/labels";
import { effectiveSelection } from "../lib/multi-select";
import { formatIps, postShipmentStatusColors } from "../lib/post-shipment-dashboard";
import type { SearchableOption } from "../lib/searchable-options";
import { fetchRetryingTransient } from "../lib/transient-retry";
import { getMessages, useI18n } from "./I18nProvider";
import { MultiSelectFilter } from "./MultiSelectFilter";
import { useDebouncedValue } from "./useDebouncedValue";

// Quiet time after the last filter click before the estimates are requested.
const fetchDelayMs = 250;
const textOptions = (values: string[] | undefined): SearchableOption[] => (values ?? []).map(value => ({ value, label: value }));
type Loaded = { query: string; data?: ClearanceEstimatesData; error?: string };
type ListKey = "analysts" | "importers" | "suppliers";

/**
 * The BI "Import Clearance Estimations" section of the post-shipment dashboard, from the post-shipment data of the IPs:
 * what is registered next week (Monday to Sunday) by the DUIMP date or, before the DUIMP, the ETA at the port, and the
 * taxes of the IP. It has its own filters; the period applies at once, the other fields wait for Apply.
 */
export default function ClearanceEstimates() {
  const { m, locale } = useI18n();
  const t = m.reports.clearanceEstimates;
  const c = t.columns;
  // The section exists to show next week; "Todas" lists every IP with a registration date or taxes.
  const [draft, setDraft] = useState<ClearanceFilters>({ ...emptyClearanceFilters, period: "nextWeek" });
  const [applied, setApplied] = useState<ClearanceFilters>({ ...emptyClearanceFilters, period: "nextWeek" });
  const [loaded, setLoaded] = useState<Loaded>();
  // The options come with the estimates and do not depend on the filters, so the last ones stay while loading.
  const [options, setOptions] = useState<ClearanceEstimatesData["options"]>();
  const query = useDebouncedValue(clearanceEstimatesQueryParams(applied).toString(), fetchDelayMs);

  useEffect(() => {
    const controller = new AbortController();
    fetchRetryingTransient(() => apiFetch(`/api/v1/reports/post-shipment/clearance-estimates?${query}`,
      { signal: controller.signal }), controller.signal)
      .then(response => readApiJson<ClearanceEstimatesData>(response))
      .then(data => { if (!controller.signal.aborted) { setLoaded({ query, data }); setOptions(data.options); } })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setLoaded({ query,
          error: reason instanceof Error ? reason.message : getMessages().reports.clearanceEstimates.loadFailed });
      });
    return () => controller.abort();
  }, [query]);

  const current = loaded?.query === query ? loaded : undefined;
  const data = current?.data;
  const date = (value: string | null) => formatE2eDate(value, locale);
  // Every value of a list checked is the same as none, so the query stays short.
  function effective(filters: ClearanceFilters): ClearanceFilters {
    return { ...filters, status: effectiveSelection(filters.status, clearanceStatuses) as ClearanceStatus[],
      registered: effectiveSelection(filters.registered, clearanceRegistered) as ClearanceRegistered[],
      analysts: effectiveSelection(filters.analysts, options?.analysts ?? []),
      importers: effectiveSelection(filters.importers, options?.importers ?? []),
      suppliers: effectiveSelection(filters.suppliers, options?.suppliers ?? []) };
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const filters = effective(draft);
    setDraft(filters); setApplied(filters);
  }
  function clear() {
    const filters = { ...emptyClearanceFilters, period: applied.period };
    setDraft(filters); setApplied(filters);
  }
  function choosePeriod(period: ClearancePeriod) {
    setDraft({ ...draft, period }); setApplied({ ...applied, period });
  }

  const all = t.allOption;
  const list = (key: ListKey, label: string) =>
    <label>{label}<MultiSelectFilter ariaLabel={label} allLabel={all} values={draft[key]} options={textOptions(options?.[key])}
      onChange={next => setDraft({ ...draft, [key]: next })} /></label>;
  const statusOptions: SearchableOption[] = clearanceStatuses.map(status => ({ value: status, label: statusLabel(m, status) }));
  const registeredOptions: SearchableOption[] = clearanceRegistered.map(value => ({ value, label: t.registeredOptions[value] }));

  return <section className="card pre-dashboard-table" aria-label={t.title}>
    <h2>{t.title}</h2>
    <p className="muted pre-dashboard-help">{t.help}</p>
    <nav className="tabs" aria-label={t.period}>
      {clearancePeriods.map(period => <button key={period} type="button" aria-pressed={applied.period === period}
        className={`tab${applied.period === period ? " active" : ""}`} onClick={() => choosePeriod(period)}>
        {t.periods[period]}</button>)}
    </nav>
    <form className="portfolio-filter product-lines-filter e2e-overview-filters" aria-label={t.filtersLabel} onSubmit={submit}>
      <label>{t.ipNumber}<input value={draft.ipNumber} placeholder={t.searchPlaceholder} maxLength={80}
        onChange={event => setDraft({ ...draft, ipNumber: event.target.value })} /></label>
      {list("analysts", t.analyst)}
      {list("importers", t.importer)}
      <label>{t.status}<MultiSelectFilter ariaLabel={t.status} allLabel={all} values={draft.status} options={statusOptions}
        onChange={next => setDraft({ ...draft, status: next as ClearanceStatus[] })} /></label>
      {list("suppliers", t.supplier)}
      <label>{t.registered}<MultiSelectFilter ariaLabel={t.registered} allLabel={all} values={draft.registered}
        options={registeredOptions} onChange={next => setDraft({ ...draft, registered: next as ClearanceRegistered[] })} /></label>
      <div className="button-row product-lines-filter-actions"><button className="button" type="submit">{t.apply}</button>
        <button className="button secondary" type="button" onClick={clear}>{t.clear}</button></div>
    </form>

    <div aria-live="polite">
      {!current && <p role="status">{t.loading}</p>}
      {current?.error && <p className="notice error" role="alert">{current.error}</p>}
      {data && <>
        <p>{t.found(formatIps(data.lines.length, locale))}
          {applied.period === "nextWeek" && <span className="muted"> · {t.nextWeekRange(date(data.nextWeek.from),
            date(data.nextWeek.to))}</span>}</p>
        {data.lines.length === 0 ? <p>{t.none}</p> : <div className="table-scroll"><table>
          <thead><tr>
            <th>{c.ip}</th><th>{c.referenceDate}</th><th>{c.analyst}</th><th>{c.importer}</th><th>{c.status}</th>
            <th>{c.supplier}</th><th>{c.eta}</th><th>{c.registered}</th><th className="clearance-money">{c.value}</th>
          </tr></thead>
          <tbody>{data.lines.map(line => <tr key={line.id}>
            <td><Link className="text-link" href={`/processes/${line.id}`}>{line.ipNumber}</Link></td>
            <td>{date(line.referenceDate)}{line.referenceSource
              && <span className="muted"> · {t.referenceSources[line.referenceSource]}</span>}</td>
            <td>{line.analysts.length ? line.analysts.join(", ") : "—"}</td>
            <td>{line.importer ?? "—"}</td>
            <td><span className="e2e-status">
              <span className="e2e-chart-swatch" style={{ background: `var(${postShipmentStatusColors[line.status]})` }} />
              {statusLabel(m, line.status)}</span></td>
            <td>{line.supplier ?? "—"}</td>
            <td>{date(line.eta)}</td>
            <td><span className={line.registered ? "badge badge-success" : "badge badge-warning"}>
              {t.registeredOptions[line.registered ? "yes" : "no"]}</span></td>
            <td className="clearance-money">{formatBrl(line.valueBrl, locale)}</td>
          </tr>)}</tbody>
          <tfoot><tr className="clearance-total">
            <th scope="row" colSpan={8}>{t.total}</th>
            <td className="clearance-money">{formatBrl(data.totalBrl, locale)}</td>
          </tr></tfoot>
        </table></div>}
      </>}
    </div>
  </section>;
}
