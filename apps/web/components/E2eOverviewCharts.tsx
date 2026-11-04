import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { donutSegments } from "../lib/donut-chart";
import { delayRangeInsight, delayRangeRows, formatShare, largestIndex, overviewShares, overviewTip, overviewTotal,
  type OverviewShare } from "../lib/e2e-overview-format";
import { statusLabel } from "../lib/i18n/labels";
import { e2eDeadlineStatuses, e2eDelayRanges, e2eStatusColors, productLineStatuses, type E2eDeadlineStatus,
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
const deadlineColors: Record<E2eDeadlineStatus, string> = {
  onTime: "--color-chart-on-time", onLimit: "--color-chart-on-limit",
  late: "--color-chart-late", noData: "--color-chart-no-data",
};
// The early items share the green of "No prazo"; the late ranges darken with the delay.
const rangeColors: Record<E2eDelayRange, string> = {
  inAdvance: "--color-chart-on-time-strong", onTime: "--color-chart-on-time", upTo30: "--color-chart-range-1",
  days30To45: "--color-chart-range-2", days45To60: "--color-chart-range-3", days60To90: "--color-chart-range-4",
  days90To120: "--color-chart-range-5", days120Plus: "--color-chart-range-6", noData: "--color-chart-no-data",
};
// The colour of a category, read by the stylesheet as --chart-color.
const tint = (color: string) => ({ "--chart-color": `var(${color})` }) as CSSProperties;
const width = (fraction: number) => ({ width: `${(fraction * 100).toFixed(2)}%` });
// The selected categories of a chart: none (all), one or several.
const dimmed = (key: string, selected: readonly string[]) => selected.length && !selected.includes(key) ? " is-dimmed" : "";
// Ctrl+click (Cmd+click on a Mac) adds to the selection, as in Power BI.
const additive = (event: MouseEvent<Element>) => event.ctrlKey || event.metaKey;

/** Card in the style of the model indicators: label, total in items, an insight chip and the selection reset. */
function OverviewCard({ title, total, selected, onClear, wide, insight, children }: {
  title: string; total: string; selected: boolean; onClear: () => void; wide?: boolean; insight?: ReactNode; children: ReactNode;
}) {
  const { m } = useI18n();
  return <section className={wide ? "e2e-overview-card e2e-overview-card-wide" : "e2e-overview-card"}>
    <div className="e2e-overview-head">
      <div className="e2e-overview-title"><span className="e2e-label">{title}</span><strong>{m.e2eLines.overview.totalItems(total)}</strong></div>
      {(insight || selected) && <div className="e2e-overview-head-side">
        {insight}
        {selected && <button type="button" className="e2e-overview-clear" onClick={onClear}>
          {m.e2eLines.overview.clearSelection}</button>}
      </div>}
    </div>
    {children}
  </section>;
}

/** Chip of the card head with the fact worth reading first, such as the largest status. */
function InsightChip({ color, label, value, danger }: { color: string; label: string; value: string; danger?: boolean }) {
  return <span className={danger ? "e2e-overview-chip e2e-overview-chip-danger" : "e2e-overview-chip"} style={tint(color)}>
    <span className="e2e-overview-dot" aria-hidden="true" />
    <span>{label}: <strong>{value}</strong></span>
  </span>;
}

/** Thin bar of a share, under a status step and a legend item. */
function Meter({ fraction }: { fraction: number }) {
  return <span className="e2e-overview-meter" aria-hidden="true"><span className="e2e-overview-meter-fill" style={width(fraction)} /></span>;
}

/** Legend with quantity, share and meter; each item filters by its category, the keyboard path of the chart. */
function Legend<Key extends string>({ entries, selected, onSelect, filterLabel }: {
  entries: ChartEntry<Key>[]; selected: readonly string[]; onSelect: (key: Key, additive: boolean) => void;
  filterLabel: (label: string) => string;
}) {
  return <ul className="e2e-chart-legend">
    {entries.map(entry => <li key={entry.key}>
      <button type="button" className={`e2e-chart-legend-item${entry.share.value > 0 ? "" : " is-empty"}${dimmed(entry.key, selected)}`}
        style={tint(entry.color)} aria-pressed={selected.includes(entry.key)} onClick={event => onSelect(entry.key, additive(event))}
        aria-label={`${filterLabel(entry.label)} (${entry.share.compact}, ${entry.share.percent})`}>
        <span className="e2e-chart-swatch" />
        <span className="e2e-chart-legend-name">{entry.label}</span>
        <strong>{entry.share.compact}</strong>
        <span className="e2e-chart-legend-share">{entry.share.percent}</span>
        {entry.share.value > 0 && <span className="e2e-chart-legend-meter"><Meter fraction={entry.share.fraction} /></span>}
      </button>
    </li>)}
  </ul>;
}

/** Tooltip card of a chart mark: the category, its quantity, share and lines, and what a click (and Ctrl+click) does. */
function ChartTip({ entry, selected, locale, m }: {
  entry: ChartEntry<string>; selected: readonly string[]; locale: string; m: Messages;
}) {
  const tip = overviewTip(entry.share, entry.part.lines, selected.includes(entry.key), locale, m);
  return <div className="e2e-chart-tip">
    <div className="e2e-chart-tip-name"><span className="e2e-chart-swatch" style={{ background: `var(${entry.color})` }} />{entry.label}</div>
    <dl>{tip.rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="e2e-chart-tip-hint">{tip.hint}</div>
    <div className="e2e-chart-tip-hint">{m.e2eLines.overview.tipAdd}</div>
  </div>;
}

function entriesOf<Key extends string>(keys: readonly Key[], parts: Record<Key, OverviewPart>, locale: string,
  label: (key: Key) => string, color: (key: Key, index: number) => string): ChartEntry<Key>[] {
  const shares = overviewShares(keys.map(key => parts[key].quantity), locale);
  return keys.map((key, index) => ({ key, label: label(key), color: color(key, index), part: parts[key], share: shares[index] }));
}

/**
 * The statuses as the steps of the physical flow, never sorted by quantity: step number, quantity and share.
 * The largest one is highlighted, an empty one says so, and each step filters by its status.
 */
function StatusSteps({ entries, top, selected, onSelect, filterLabel }: {
  entries: ChartEntry<E2eOverviewStatus>[]; top: number; selected: readonly string[];
  onSelect: (key: E2eOverviewStatus, additive: boolean) => void; filterLabel: (label: string) => string;
}) {
  const { m } = useI18n();
  const o = m.e2eLines.overview;
  return <ol className="e2e-status-steps">
    {entries.map((entry, index) => <li key={entry.key} className="e2e-status-step" style={tint(entry.color)}>
      <span className="e2e-status-step-rail" aria-hidden="true">
        <span className="e2e-status-step-dot" />
        <span className="e2e-status-step-index">{o.step(index + 1)}</span>
        <span className="e2e-status-step-line" />
      </span>
      <button type="button" className={`e2e-status-step-tile${index === top ? " is-top" : ""}${dimmed(entry.key, selected)}`}
        aria-pressed={selected.includes(entry.key)} onClick={event => onSelect(entry.key, additive(event))}
        aria-label={`${filterLabel(entry.label)} (${entry.share.compact}, ${entry.share.percent})`}>
        <span className="e2e-status-step-label">{entry.label}</span>
        <strong className={entry.share.value > 0 ? "e2e-status-step-value" : "e2e-status-step-value is-empty"}>{entry.share.compact}</strong>
        {entry.share.value > 0
          ? <span className="e2e-status-step-share"><Meter fraction={entry.share.fraction} />
            <span className="e2e-chart-legend-share">{entry.share.percent}</span></span>
          : <span className="e2e-status-step-note">{o.noItems}</span>}
      </button>
    </li>)}
  </ol>;
}

/**
 * Item quantity by total delay range as rows in chronological order, grouped into no delay, late and no
 * information, each with a bar scaled to the largest range. Empty ranges are left out unless selected, and
 * each row filters by its range.
 */
function DelayRangeBars({ entries, selected, onSelect, filterLabel, locale, m }: {
  entries: ChartEntry<E2eDelayRange>[]; selected: readonly string[]; onSelect: (key: E2eDelayRange, additive: boolean) => void;
  filterLabel: (label: string) => string; locale: string; m: Messages;
}) {
  const o = m.e2eLines.overview;
  const values = Object.fromEntries(entries.map(entry => [entry.key, entry.share.value])) as Record<E2eDelayRange, number>;
  const max = Math.max(0, ...entries.map(entry => entry.share.value));
  return <div className="e2e-range-groups">
    {delayRangeRows(values, selected).map(group => <div key={group.key} className="e2e-range-group">
      <span className="e2e-label">{group.key === "late" && group.total > 0
        ? `${o.delayGroups.late} · ${formatShare(group.total, group.total, locale).compact}` : o.delayGroups[group.key]}</span>
      <ul className="e2e-range-bars">
        {group.ranges.map(key => {
          const entry = entries[e2eDelayRanges.indexOf(key)];
          return <li key={entry.key}>
            <Tooltip content={<ChartTip entry={entry} selected={selected} locale={locale} m={m} />} followCursor>
              <button type="button" className={`e2e-range-row${dimmed(entry.key, selected)}`} aria-pressed={selected.includes(entry.key)}
                style={tint(entry.color)} onClick={event => onSelect(entry.key, additive(event))}
                aria-label={`${filterLabel(entry.label)} (${entry.share.compact}, ${entry.share.percent})`}>
                <span className="e2e-range-label">{entry.label}</span>
                <span className="e2e-range-track">
                  {entry.share.value > 0 && <span className="e2e-range-fill" style={width(max > 0 ? entry.share.value / max : 0)} />}
                </span>
                <strong>{entry.share.compact}</strong>
                <span className="e2e-chart-legend-share">{entry.share.percent}</span>
              </button>
            </Tooltip>
          </li>;
        })}
      </ul>
    </div>)}
  </div>;
}

/** Picture of the status chart kept while the charts are collapsed: a mini bar and the total in items. */
export function E2eOverviewMini({ overview, locale }: { overview: E2eOverview; locale: string }) {
  const { m } = useI18n();
  const o = m.e2eLines.overview;
  const entries = entriesOf(statusKeys, overview.byStatus, locale, key => key, (_, index) => e2eStatusColors[index]);
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
 * Item quantities of the filtered lines by line status (distribution bar and flow steps), by total deadline
 * status (donut) and by total delay range (grouped bars). The charts cross-filter: clicking a category filters
 * the other charts, the stage cards and the table, while its own chart keeps every category; clicking it again
 * clears it.
 */
export default function E2eOverviewCharts({ overview, locale, selectedStatuses, selectedDeadlines, selectedDelayRanges,
  onStatusSelect, onStatusClear, onDeadlineSelect, onDeadlineClear, onDelayRangeSelect, onDelayRangeClear }: {
  overview: E2eOverview; locale: string;
  selectedStatuses: readonly string[]; selectedDeadlines: readonly string[]; selectedDelayRanges: readonly string[];
  onStatusSelect: (status: E2eOverviewStatus, additive: boolean) => void; onStatusClear: () => void;
  onDeadlineSelect: (deadline: E2eDeadlineStatus, additive: boolean) => void; onDeadlineClear: () => void;
  onDelayRangeSelect: (range: E2eDelayRange, additive: boolean) => void; onDelayRangeClear: () => void;
}) {
  const { m } = useI18n();
  const o = m.e2eLines.overview;
  const statusEntries = entriesOf(statusKeys, overview.byStatus, locale, key => statusLabel(m, key),
    (_, index) => e2eStatusColors[index]);
  const deadlineEntries = entriesOf(e2eDeadlineStatuses, overview.byDeadline, locale, key => o[key],
    key => deadlineColors[key]);
  const statusTotal = overviewTotal(statusKeys.map(key => overview.byStatus[key].quantity), locale);
  const deadlineTotal = overviewTotal(e2eDeadlineStatuses.map(key => overview.byDeadline[key].quantity), locale);
  const hasStatus = statusEntries.some(entry => entry.share.value > 0);
  const top = largestIndex(statusEntries.map(entry => entry.share.value));
  const largest = statusEntries[top];
  const segments = donutSegments(deadlineEntries.map(entry => entry.share.value), { radius: 70, gap: 3 });
  const onTime = deadlineEntries[e2eDeadlineStatuses.indexOf("onTime")];
  const byDelayRange = overview.byDelayRange;
  const rangeEntries = byDelayRange ? entriesOf(e2eDelayRanges, byDelayRange, locale, key => o.delayRanges[key],
    key => rangeColors[key]) : [];
  const rangeTotal = byDelayRange ? overviewTotal(e2eDelayRanges.map(key => byDelayRange[key].quantity), locale) : "";
  const insight = delayRangeInsight(Object.fromEntries(rangeEntries.map(entry => [entry.key, entry.share.value])) as
    Record<E2eDelayRange, number>);
  const over30 = formatShare(insight.over30, insight.total, locale);
  const upTo30 = formatShare(insight.upTo30, insight.late, locale);

  return <section className="e2e-overview" aria-label={o.label}>
    <OverviewCard title={o.statusTitle} total={statusTotal} selected={selectedStatuses.length > 0} wide onClear={onStatusClear}
      insight={largest && <InsightChip color={largest.color} label={o.largestShare} value={`${largest.label} · ${largest.share.percent}`} />}>
      {hasStatus
        ? <div className="e2e-distribution" role="img" aria-label={o.chartLabel(o.statusTitle, statusTotal)}>
          {statusEntries.filter(entry => entry.share.value > 0).map(entry =>
            <Tooltip key={entry.key} content={<ChartTip entry={entry} selected={selectedStatuses} locale={locale} m={m} />}
              followCursor>
              <div aria-hidden="true" className={`e2e-distribution-segment${dimmed(entry.key, selectedStatuses)}`}
                style={{ background: `var(${entry.color})`, flexGrow: entry.share.value }}
                onClick={event => onStatusSelect(entry.key, additive(event))} />
            </Tooltip>)}
        </div>
        : <p className="muted">{o.empty}</p>}
      <StatusSteps entries={statusEntries} top={top} selected={selectedStatuses} onSelect={onStatusSelect}
        filterLabel={o.filterByStatus} />
    </OverviewCard>
    <OverviewCard title={o.deadlineTitle} total={deadlineTotal} selected={selectedDeadlines.length > 0} onClear={onDeadlineClear}>
      <div className="e2e-donut-layout">
        {segments.length
          ? <div className="e2e-donut">
            <svg viewBox="0 0 184 184" role="img" aria-label={o.chartLabel(o.deadlineTitle, deadlineTotal)}>
              <g transform="rotate(-90 92 92)">
                <circle className="e2e-donut-track" cx="92" cy="92" r="70" />
                {segments.map(segment => {
                  const entry = deadlineEntries[segment.index];
                  return <Tooltip key={entry.key} content={<ChartTip entry={entry} selected={selectedDeadlines} locale={locale} m={m} />} followCursor>
                    <circle cx="92" cy="92" r="70" style={tint(entry.color)} strokeDasharray={segment.dashArray}
                      strokeDashoffset={segment.dashOffset} aria-hidden="true"
                      className={`e2e-donut-segment${dimmed(entry.key, selectedDeadlines)}`}
                      onClick={event => onDeadlineSelect(entry.key, additive(event))} />
                  </Tooltip>;
                })}
              </g>
            </svg>
            <span className="e2e-donut-center" aria-hidden="true"><strong>{onTime.share.percent}</strong><span>{o.onTimeCenter}</span></span>
          </div>
          : <p className="muted">{o.empty}</p>}
        <Legend entries={deadlineEntries} selected={selectedDeadlines} onSelect={onDeadlineSelect} filterLabel={o.filterByDeadline} />
      </div>
      {insight.late > 0 && <p className="e2e-overview-callout">
        <svg className="e2e-overview-callout-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
        <span><strong>{o.lateUpTo30Lead(upTo30.percent)}</strong>{" "}
          {o.lateUpTo30Rest(upTo30.compact, formatShare(insight.late, insight.late, locale).compact)}</span>
      </p>}
    </OverviewCard>
    {byDelayRange && <OverviewCard title={o.delayRangeTitle} total={rangeTotal} selected={selectedDelayRanges.length > 0}
      onClear={onDelayRangeClear}
      insight={insight.over30 > 0 && <InsightChip danger color="--color-chart-late" label={o.over30}
        value={`${over30.compact} · ${over30.percent}`} />}>
      {rangeEntries.some(entry => entry.share.value > 0) || selectedDelayRanges.length > 0
        ? <DelayRangeBars entries={rangeEntries} selected={selectedDelayRanges} onSelect={onDelayRangeSelect}
          filterLabel={o.filterByDelayRange} locale={locale} m={m} />
        : <p className="muted">{o.empty}</p>}
    </OverviewCard>}
  </section>;
}
