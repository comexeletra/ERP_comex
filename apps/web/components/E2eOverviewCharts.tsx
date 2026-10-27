import type { ReactNode } from "react";
import { overviewShares, overviewTip, overviewTotal, rankedIndexes, type OverviewShare } from "../lib/e2e-overview-format";
import { statusLabel } from "../lib/i18n/labels";
import { pieSlices } from "../lib/pie-chart";
import { e2eDeadlineStatuses, e2eDelayRanges, productLineStatuses, type E2eDeadlineStatus,
  type E2eDelayRange } from "../lib/purchase-order-lines";
import type { Messages } from "../lib/i18n/pt-BR";
import { useI18n } from "./I18nProvider";
import { Tooltip } from "./Tooltip";

type OverviewPart = { quantity: string; lines: number };
export type E2eOverviewStatus = Exclude<(typeof productLineStatuses)[number], "CANCELADO">;
export type E2eOverview = {
  byStatus: Record<E2eOverviewStatus, OverviewPart>;
  byDeadline: Record<E2eDeadlineStatus, OverviewPart>;
  /** Absent in an API older than the delay range chart. */
  byDelayRange?: Record<E2eDelayRange, OverviewPart>;
};

type ChartEntry<Key extends string> = { key: Key; label: string; color: string; part: OverviewPart; share: OverviewShare };
const statusKeys = productLineStatuses.slice(0, -1) as readonly E2eOverviewStatus[];
const statusColors = ["--color-chart-status-1", "--color-chart-status-2", "--color-chart-status-3",
  "--color-chart-status-4", "--color-chart-status-5", "--color-chart-status-6"];
const deadlineColors: Record<E2eDeadlineStatus, string> = {
  onTime: "--color-chart-on-time", onLimit: "--color-chart-on-limit",
  late: "--color-chart-late", noData: "--color-chart-no-data",
};
const dimmed = (key: string, selected: string) => selected && key !== selected ? " is-dimmed" : "";

/** Card in the style of the model indicators: label, total in items and the selection reset. */
function OverviewCard({ title, total, selected, onClear, wide, children }: {
  title: string; total: string; selected: boolean; onClear: () => void; wide?: boolean; children: ReactNode;
}) {
  const { m } = useI18n();
  return <section className={wide ? "e2e-overview-card e2e-overview-card-wide" : "e2e-overview-card"}>
    <div className="e2e-overview-head">
      <div><span className="e2e-label">{title}</span><strong>{m.e2eLines.overview.totalItems(total)}</strong></div>
      {selected && <button type="button" className="e2e-overview-clear" onClick={onClear}>
        {m.e2eLines.overview.clearSelection}</button>}
    </div>
    {children}
  </section>;
}

/** Legend with quantity and share; each item filters by its category, the keyboard path of the chart. */
function Legend<Key extends string>({ entries, selected, onSelect, filterLabel, stacked }: {
  entries: ChartEntry<Key>[]; selected: string; onSelect: (key: Key) => void;
  filterLabel: (label: string) => string; stacked?: boolean;
}) {
  return <ul className={`e2e-chart-legend${stacked ? " e2e-chart-legend-stacked" : ""}`}>
    {entries.map(entry => <li key={entry.key}>
      <button type="button" className={`e2e-chart-legend-item${dimmed(entry.key, selected)}`}
        aria-pressed={entry.key === selected} onClick={() => onSelect(entry.key)}
        aria-label={`${filterLabel(entry.label)} (${entry.share.compact}, ${entry.share.percent})`}>
        <span className="e2e-chart-swatch" style={{ background: `var(${entry.color})` }} />
        <span className="e2e-chart-legend-name">{entry.label}</span>
        <strong>{entry.share.compact}</strong>
        <span className="e2e-chart-legend-share">{entry.share.percent}</span>
      </button>
    </li>)}
  </ul>;
}

/** Tooltip card of a chart mark: the category, its quantity, share and lines, and what a click does. */
function ChartTip({ entry, selected, locale, m }: { entry: ChartEntry<string>; selected: string; locale: string; m: Messages }) {
  const tip = overviewTip(entry.share, entry.part.lines, entry.key === selected, locale, m);
  return <div className="e2e-chart-tip">
    <div className="e2e-chart-tip-name"><span className="e2e-chart-swatch" style={{ background: `var(${entry.color})` }} />{entry.label}</div>
    <dl>{tip.rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="e2e-chart-tip-hint">{tip.hint}</div>
  </div>;
}

function entriesOf<Key extends string>(keys: readonly Key[], parts: Record<Key, OverviewPart>, locale: string,
  label: (key: Key) => string, color: (key: Key, index: number) => string): ChartEntry<Key>[] {
  const shares = overviewShares(keys.map(key => parts[key].quantity), locale);
  return keys.map((key, index) => ({ key, label: label(key), color: color(key, index), part: parts[key], share: shares[index] }));
}

/**
 * Item quantity by total delay range as rows in the style of the chart legends, each with a meter
 * scaled to the largest range; from the largest down, as in Power BI. Empty ranges are left out,
 * and each row filters by its range.
 */
function DelayRangeBars({ entries, selected, onSelect, filterLabel, locale, m }: {
  entries: ChartEntry<E2eDelayRange>[]; selected: string; onSelect: (key: E2eDelayRange) => void;
  filterLabel: (label: string) => string; locale: string; m: Messages;
}) {
  const values = entries.map(entry => entry.share.value);
  const max = Math.max(0, ...values);
  return <ul className="e2e-range-bars">
    {rankedIndexes(values, entries.findIndex(entry => entry.key === selected)).map(index => {
      const entry = entries[index];
      const ratio = max > 0 ? entry.share.value / max : 0;
      return <li key={entry.key}>
        <Tooltip content={<ChartTip entry={entry} selected={selected} locale={locale} m={m} />} followCursor>
          <button type="button" className={`e2e-range-row${dimmed(entry.key, selected)}`} aria-pressed={entry.key === selected}
            onClick={() => onSelect(entry.key)}
            aria-label={`${filterLabel(entry.label)} (${entry.share.compact}, ${entry.share.percent})`}>
            <span className="e2e-range-label">{entry.label}</span>
            <span className="e2e-range-track">
              <span className="e2e-range-fill" style={{ background: `var(${entry.color})`, width: `${ratio * 100}%` }} />
            </span>
            <strong>{entry.share.compact}</strong>
            <span className="e2e-chart-legend-share">{entry.share.percent}</span>
          </button>
        </Tooltip>
      </li>;
    })}
  </ul>;
}

/** Picture of the status chart kept while the charts are collapsed: a mini bar and the total in items. */
export function E2eOverviewMini({ overview, locale }: { overview: E2eOverview; locale: string }) {
  const { m } = useI18n();
  const o = m.e2eLines.overview;
  const entries = entriesOf(statusKeys, overview.byStatus, locale, key => key, (_, index) => statusColors[index]);
  const total = overviewTotal(statusKeys.map(key => overview.byStatus[key].quantity), locale);
  return <span className="e2e-overview-mini">
    <span className="e2e-distribution e2e-distribution-mini" aria-hidden="true">
      {entries.filter(entry => entry.share.value > 0).map(entry => <span key={entry.key} className="e2e-distribution-segment"
        style={{ background: `var(${entry.color})`, flexGrow: entry.share.value }} />)}
    </span>
    <span>{o.chartsHidden(overview.byDelayRange ? 3 : 2, total)}</span>
  </span>;
}

/**
 * Item quantities of the filtered lines by line status (distribution bar), by total deadline status
 * (compact pie) and by total delay range (bars). The charts cross-filter: clicking a category filters
 * the other charts, the stage cards and the table, while its own chart keeps every category; clicking
 * it again clears it.
 */
export default function E2eOverviewCharts({ overview, locale, selectedStatus, selectedDeadline, selectedDelayRange,
  onStatusSelect, onDeadlineSelect, onDelayRangeSelect }: {
  overview: E2eOverview; locale: string; selectedStatus: string; selectedDeadline: string; selectedDelayRange: string;
  onStatusSelect: (status: E2eOverviewStatus) => void; onDeadlineSelect: (deadline: E2eDeadlineStatus) => void;
  onDelayRangeSelect: (range: E2eDelayRange) => void;
}) {
  const { m } = useI18n();
  const o = m.e2eLines.overview;
  const statusEntries = entriesOf(statusKeys, overview.byStatus, locale, key => statusLabel(m, key),
    (_, index) => statusColors[index]);
  const deadlineEntries = entriesOf(e2eDeadlineStatuses, overview.byDeadline, locale, key => o[key],
    key => deadlineColors[key]);
  const statusTotal = overviewTotal(statusKeys.map(key => overview.byStatus[key].quantity), locale);
  const deadlineTotal = overviewTotal(e2eDeadlineStatuses.map(key => overview.byDeadline[key].quantity), locale);
  const hasStatus = statusEntries.some(entry => entry.share.value > 0);
  const slices = pieSlices(deadlineEntries.map(entry => entry.share.value), { centerX: 60, centerY: 60, radius: 56 });
  const byDelayRange = overview.byDelayRange;
  const rangeEntries = byDelayRange ? entriesOf(e2eDelayRanges, byDelayRange, locale, key => o.delayRanges[key],
    key => key === "noData" ? "--color-chart-no-data" : "--color-chart-range") : [];
  const rangeTotal = byDelayRange ? overviewTotal(e2eDelayRanges.map(key => byDelayRange[key].quantity), locale) : "";

  return <section className="e2e-overview" aria-label={o.label}>
    <OverviewCard title={o.statusTitle} total={statusTotal} selected={selectedStatus !== ""} wide
      onClear={() => onStatusSelect(selectedStatus as E2eOverviewStatus)}>
      {hasStatus
        ? <div className="e2e-distribution" role="img" aria-label={o.chartLabel(o.statusTitle, statusTotal)}>
          {statusEntries.filter(entry => entry.share.value > 0).map(entry =>
            <Tooltip key={entry.key} content={<ChartTip entry={entry} selected={selectedStatus} locale={locale} m={m} />} followCursor>
              <div aria-hidden="true" className={`e2e-distribution-segment${dimmed(entry.key, selectedStatus)}`}
                style={{ background: `var(${entry.color})`, flexGrow: entry.share.value }}
                onClick={() => onStatusSelect(entry.key)} />
            </Tooltip>)}
        </div>
        : <p className="muted">{o.empty}</p>}
      <Legend entries={statusEntries} selected={selectedStatus} onSelect={onStatusSelect} filterLabel={o.filterByStatus} />
    </OverviewCard>
    <OverviewCard title={o.deadlineTitle} total={deadlineTotal} selected={selectedDeadline !== ""}
      onClear={() => onDeadlineSelect(selectedDeadline as E2eDeadlineStatus)}>
      <div className="e2e-pie-layout">
        {slices.length
          ? <svg className="e2e-pie" viewBox="0 0 120 120" role="img" aria-label={o.chartLabel(o.deadlineTitle, deadlineTotal)}>
            {slices.map(slice => {
              const entry = deadlineEntries[slice.index];
              return <Tooltip key={entry.key} content={<ChartTip entry={entry} selected={selectedDeadline} locale={locale} m={m} />} followCursor>
                <path d={slice.d} fill={`var(${entry.color})`} aria-hidden="true"
                  className={dimmed(entry.key, selectedDeadline).trim() || undefined}
                  onClick={() => onDeadlineSelect(entry.key)} />
              </Tooltip>;
            })}
          </svg>
          : <p className="muted">{o.empty}</p>}
        <Legend entries={deadlineEntries} selected={selectedDeadline} onSelect={onDeadlineSelect}
          filterLabel={o.filterByDeadline} stacked />
      </div>
    </OverviewCard>
    {byDelayRange && <OverviewCard title={o.delayRangeTitle} total={rangeTotal} selected={selectedDelayRange !== ""}
      onClear={() => onDelayRangeSelect(selectedDelayRange as E2eDelayRange)}>
      {rangeEntries.some(entry => entry.share.value > 0) || selectedDelayRange
        ? <DelayRangeBars entries={rangeEntries} selected={selectedDelayRange} onSelect={onDelayRangeSelect}
          filterLabel={o.filterByDelayRange} locale={locale} m={m} />
        : <p className="muted">{o.empty}</p>}
    </OverviewCard>}
  </section>;
}
