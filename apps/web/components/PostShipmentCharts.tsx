import type { CSSProperties, ReactNode } from "react";
import { donutSegments } from "../lib/donut-chart";
import { formatPercent, overviewShares } from "../lib/e2e-overview-format";
import { statusLabel } from "../lib/i18n/labels";
import type { Messages } from "../lib/i18n/pt-BR";
import { atLeastTone, atMostTone, changeTone, formatAverageDays, formatChange, formatContainers, formatIps, formatMonth,
  formatShareOf, formatWholeDays, lineLabelHeights, postShipmentChannelColors, postShipmentChannels, postShipmentFixedChannels,
  postShipmentPriorities, postShipmentPriorityColors, postShipmentStatusColors, postShipmentStatuses,
  type PostShipmentChannel, type PostShipmentMonth, type PostShipmentPriority, type PostShipmentStatus,
  type PostShipmentSummary, type PostShipmentTone } from "../lib/post-shipment-dashboard";
import { additive, Counted, dimmed, Legend, Meter, tint, width, type ChartEntry } from "./E2eOverviewCharts";
import { useI18n } from "./I18nProvider";
import { DashboardCard } from "./PreShipmentCharts";
import { Tooltip } from "./Tooltip";

type Entry<Key extends string> = ChartEntry<Key>;
type Select<Key extends string> = (key: Key, additive: boolean) => void;

/** Entries of a chart of IP counts, with their share of the IPs of the chart. */
function entriesOf<Key extends string>(keys: readonly Key[], counts: Record<Key, number>, locale: string,
  label: (key: Key) => string, color: (key: Key) => string): Entry<Key>[] {
  const shares = overviewShares(keys.map(key => String(counts[key])), locale);
  return keys.map((key, index) => ({ key, label: label(key), color: color(key), share: shares[index],
    part: { quantity: String(counts[key]), lines: counts[key] } }));
}

/** Tooltip card of a mark: IPs and share, and what a click (and Ctrl+click) does. */
function Tip({ entry, selected, locale, m }: { entry: Entry<string>; selected: readonly string[]; locale: string; m: Messages }) {
  const p = m.reports.postDashboard;
  return <div className="e2e-chart-tip">
    <div className="e2e-chart-tip-name"><span className="e2e-chart-swatch" style={{ background: `var(${entry.color})` }} />{entry.label}</div>
    <dl>
      <div><dt>{p.tipIps}</dt><dd>{formatIps(entry.part.lines, locale)}</dd></div>
      <div><dt>{p.tipShare}</dt><dd>{entry.share.percent}</dd></div>
    </dl>
    <div className="e2e-chart-tip-hint">{selected.includes(entry.key) ? p.tipClear : p.tipFilter}</div>
    <div className="e2e-chart-tip-hint">{p.tipAdd}</div>
  </div>;
}

/**
 * IPs by category as rows in order, each bar scaled to the largest one; each row filters by its category. The name
 * column is wider than in the End to End: the three waiting statuses only differ at the end of the name.
 */
function CountBars<Key extends string>({ entries, selected, onSelect }: {
  entries: Entry<Key>[]; selected: readonly string[]; onSelect: Select<Key>;
}) {
  const { m, locale } = useI18n();
  const p = m.reports.postDashboard;
  const max = Math.max(0, ...entries.map(entry => entry.share.value));
  return <ul className="e2e-range-bars is-wide-labels">
    {entries.map(entry => <li key={entry.key}>
      <Tooltip content={<Tip entry={entry} selected={selected} locale={locale} m={m} />} followCursor>
        <button type="button" className={`e2e-range-row${dimmed(entry.key, selected)}`} aria-pressed={selected.includes(entry.key)}
          style={tint(entry.color)} onClick={event => onSelect(entry.key, additive(event))}
          aria-label={`${p.filterBy(entry.label)} (${formatIps(entry.part.lines, locale)}, ${entry.share.percent})`}>
          <span className="e2e-range-label">{entry.label}</span>
          <span className="e2e-range-track">
            {entry.share.value > 0 && <span className="e2e-range-fill" style={width(max > 0 ? entry.share.value / max : 0)} />}
          </span>
          <strong><Counted value={entry.share.value} format={value => value > 0 ? formatIps(value, locale) : "—"} /></strong>
          <span className="e2e-chart-legend-share"><Counted value={entry.share.fraction} format={value => formatPercent(value, locale)} /></span>
        </button>
      </Tooltip>
    </li>)}
  </ul>;
}

/** Ring of the priorities with its legend; the centre shows the IPs, and each arc and legend item filters. */
function PriorityDonut({ title, entries, total, selected, onSelect }: {
  title: string; entries: Entry<PostShipmentPriority>[]; total: number; selected: readonly string[];
  onSelect: Select<PostShipmentPriority>;
}) {
  const { m, locale } = useI18n();
  const p = m.reports.postDashboard;
  const segments = donutSegments(entries.map(entry => entry.share.value), { radius: 70, gap: 3 });
  return <div className="e2e-donut-layout">
    {segments.length
      ? <div className="e2e-donut">
        <svg viewBox="0 0 184 184" role="img" aria-label={title}>
          <g transform="rotate(-90 92 92)">
            <circle className="e2e-donut-track" cx="92" cy="92" r="70" />
            {segments.map(segment => {
              const entry = entries[segment.index];
              return <Tooltip key={entry.key} content={<Tip entry={entry} selected={selected} locale={locale} m={m} />} followCursor>
                <circle cx="92" cy="92" r="70" aria-hidden="true"
                  style={{ ...tint(entry.color), strokeDasharray: segment.dashArray, strokeDashoffset: segment.dashOffset }}
                  className={`e2e-donut-segment${dimmed(entry.key, selected)}`} onClick={event => onSelect(entry.key, additive(event))} />
              </Tooltip>;
            })}
          </g>
        </svg>
        <span className="e2e-donut-center pre-dashboard-center-neutral" aria-hidden="true">
          <strong><Counted value={total} format={value => formatIps(value, locale)} /></strong><span>{p.ips}</span></span>
      </div>
      : <p className="muted">{p.noIps}</p>}
    <Legend entries={entries} selected={selected} onSelect={onSelect} filterLabel={p.filterBy} locale={locale} />
  </div>;
}

const toneClass = (tone: PostShipmentTone | null) => tone === "good" ? " is-good" : tone === "bad" ? " is-bad" : "";
// The tile of a number against its target takes the colour of "No prazo" or "Atrasado", as the deadline charts.
const toneColor = (tone: PostShipmentTone | null) =>
  tone === "good" ? "--color-chart-on-time" : tone === "bad" ? "--color-chart-late" : "--color-chart-status-3";

/**
 * A number card of the BI, as a status tile of the pre-shipment dashboard: label, value and what it measures; a
 * value against its target is tinted green or red. Only the on water tile filters (the clearance type).
 */
function Kpi({ label, value, help, tone = null, index, pressed, onClick, children }: {
  label: string; value: ReactNode; help: string; tone?: PostShipmentTone | null; index: number; pressed?: boolean;
  onClick?: () => void; children?: ReactNode;
}) {
  const className = `e2e-status-step-tile${tone ? " is-top" : ""}${onClick ? "" : " is-static"}`;
  const body = <>
    <span className="e2e-status-step-label">{label}</span>
    <strong className="e2e-status-step-value">{value}</strong>
    {children}
    <span className="e2e-status-step-note">{help}</span>
  </>;
  return <li style={{ ...tint(toneColor(tone)), "--step-index": index } as CSSProperties}>{onClick
    ? <button type="button" className={className} aria-pressed={pressed} onClick={onClick}>{body}</button>
    : <div className={className}>{body}</div>}</li>;
}

// Height of the columns of a monthly chart and the least distance between two line labels (two lines of text).
const monthBarArea = 180;
const monthLineLabelGap = 30;

/** Values of a monthly chart: the value of each month and, for the lead time, its change against the month before. */
type MonthValue = { month: string; value: number | null; change?: number | null; tip: [string, string][] };

/**
 * Columns by month with the value over each column, the change against the month before (lead time) and the
 * dashed lines of the average and, for the DSA, of the target. Each column scales to the largest value or line.
 */
function MonthlyColumns({ title, values, average, target, format }: {
  title: string; values: MonthValue[]; average: number | null; target?: number; format: (value: number | null) => string;
}) {
  const { m, locale } = useI18n();
  const p = m.reports.postDashboard;
  const max = Math.max(0, ...values.map(month => month.value ?? 0), average ?? 0, target ?? 0);
  // Bars and lines share the same area: the stylesheet places them by these fractions of its height.
  const fraction = (value: number | null) => (max > 0 && value !== null ? Math.max(0, value) / max : 0).toFixed(4);
  // The labels of the lines sit in a column of their own, right of the columns, apart from each other when the lines
  // are close; each one is moved from its line by `--label-shift`.
  const lines = [target ?? null, average].flatMap((value, index) => value === null ? []
    : [{ key: index === 0 ? "target" : "average", value, name: index === 0 ? p.target : p.average }]);
  const heights = lines.map(entry => Number(fraction(entry.value)) * monthBarArea);
  const labels = lineLabelHeights(heights, monthLineLabelGap);
  if (!values.some(month => month.value !== null)) return <p className="muted">{p.noMonths}</p>;
  return <div className="post-month-chart" role="img" aria-label={`${title}: ${values.map(month =>
    `${formatMonth(month.month, locale)} ${format(month.value)}`).join(", ")}`}>
    <div className="post-month-plot" style={{ "--bar-area": `${monthBarArea}px` } as CSSProperties}>
      {lines.map((entry, index) => <span key={entry.key}
        className={`post-month-line${entry.key === "target" ? " is-target" : ""}`}
        style={{ "--line-at": fraction(entry.value), "--label-shift": `${(labels[index] - heights[index]).toFixed(1)}px` } as CSSProperties}>
        <span><span>{entry.name}</span><span>{format(entry.value)}</span></span></span>)}
      <ol className="post-month-columns">
        {values.map((month, index) => <li key={month.month} style={{ "--step-index": index } as CSSProperties}>
          <Tooltip followCursor content={<div className="e2e-chart-tip">
            <div className="e2e-chart-tip-name">{formatMonth(month.month, locale)}</div>
            <dl>{month.tip.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          </div>}>
            <span className="post-month-column" style={{ "--bar-at": fraction(month.value) } as CSSProperties}>
              <span className="post-month-figures">
                <span className="post-month-value">{format(month.value)}</span>
                {month.change !== undefined && month.change !== null && <span
                  className={`post-month-change${toneClass(changeTone(month.change))}`}>{formatChange(month.change, locale)}</span>}
              </span>
              <span className="post-month-bar" style={tint("--color-chart-status-3")} />
            </span>
          </Tooltip>
          <span className="post-month-label">{formatMonth(month.month, locale)}</span>
        </li>)}
      </ol>
    </div>
  </div>;
}

/**
 * The BI number cards above the table: containers, IPs, on water (the tile filters the clearance type), DSA and the
 * LT Doc and SLA TXT averages, tinted against their targets.
 */
export function PostShipmentIndicators({ summary, onWaterSelected, onWaterToggle }: {
  summary: PostShipmentSummary; onWaterSelected: boolean; onWaterToggle: () => void;
}) {
  const { m, locale } = useI18n();
  const p = m.reports.postDashboard;
  const share = (value: number | null) => formatShareOf(value, locale);
  return <section className="e2e-overview post-dashboard-indicators" aria-label={p.indicatorsTitle}>
      <DashboardCard title={p.indicatorsTitle} wide selected={onWaterSelected} onClear={onWaterToggle}
        total={<Counted value={summary.totalIps} format={value => p.totalIps(formatIps(value, locale))} />}>
        <ul className="pre-dashboard-tiles">
          <Kpi index={0} label={p.containers} help={p.containersHelp}
            value={<Counted value={Number(summary.containers)} format={value => formatContainers(value, locale)} />} />
          <Kpi index={1} label={p.ips} help={p.ipsHelp}
            value={<Counted value={summary.totalIps} format={value => formatIps(value, locale)} />} />
          <Kpi index={2} label={p.onWater} help={p.onWaterHelp} pressed={onWaterSelected} onClick={onWaterToggle}
            value={<Counted value={summary.onWater} format={value => formatIps(value, locale)} />} />
          <Kpi index={3} label={p.dsa} help={p.dsaHelp} tone={atLeastTone(summary.dsa, summary.targets.dsa)}
            value={summary.dsa === null ? share(null) : <Counted value={summary.dsa} format={share} />}>
            {summary.dsa !== null && <span className="e2e-status-step-share"><Meter fraction={summary.dsa} /></span>}
          </Kpi>
          <Kpi index={4} label={p.avgLtDoc} help={p.avgLtDocHelp} tone={atMostTone(summary.avgLtDoc, summary.targets.avgLtDoc)}
            value={summary.avgLtDoc === null ? formatAverageDays(null, locale)
              : <Counted value={summary.avgLtDoc} format={value => formatAverageDays(value, locale)} />} />
          <Kpi index={5} label={p.avgSlaTxt} help={p.avgSlaTxtHelp}
            value={summary.avgSlaTxt === null ? formatAverageDays(null, locale)
              : <Counted value={summary.avgSlaTxt} format={value => formatAverageDays(value, locale)} />} />
        </ul>
      </DashboardCard>
    </section>;
}

/**
 * The BI post-shipment charts: the IPs by priority, status and channel (they cross-filter: a click filters the other
 * charts, the cards and the table, a chart keeps its own categories) and the monthly DSA and lead time, which always
 * show the whole history (they follow every filter but the date).
 */
export default function PostShipmentCharts({ summary, selected, onSelect, onClear }: {
  summary: PostShipmentSummary;
  selected: { status: readonly string[]; channel: readonly string[]; priority: readonly string[] };
  onSelect: { status: Select<PostShipmentStatus>; channel: Select<PostShipmentChannel>; priority: Select<PostShipmentPriority> };
  onClear: (chart: "status" | "channel" | "priority") => void;
}) {
  const { m, locale } = useI18n();
  const p = m.reports.postDashboard;
  const statuses = entriesOf(postShipmentStatuses, summary.byStatus, locale, status => statusLabel(m, status),
    status => postShipmentStatusColors[status]);
  const channelKeys = postShipmentChannels.filter(channel => postShipmentFixedChannels.includes(channel)
    || summary.byChannel[channel] > 0 || selected.channel.includes(channel));
  const channels = entriesOf(channelKeys, summary.byChannel, locale, channel => p.channels[channel],
    channel => postShipmentChannelColors[channel]);
  const priorities = entriesOf(postShipmentPriorities, summary.byPriority, locale, priority => p.priorities[priority],
    priority => postShipmentPriorityColors[priority]);
  const sum = (entries: Entry<string>[]) => entries.reduce((total, entry) => total + entry.share.value, 0);
  const ips = (value: number) => p.totalIps(formatIps(value, locale));
  const days = (value: number | null) => formatWholeDays(value, locale);
  const share = (value: number | null) => formatShareOf(value, locale);
  const dsaMonths: MonthValue[] = summary.months.map((month: PostShipmentMonth) => ({ month: month.month, value: month.dsa,
    tip: [[p.tipIps, formatIps(month.ips, locale)], [p.tipOnWater, formatIps(month.onWater, locale)], [p.tipDsa, share(month.dsa)]] }));
  const leadTimeMonths = (kind: "RealTime" | "Delivered"): MonthValue[] => summary.months.map(month => {
    const value = month[`leadTime${kind}`];
    const change = month[`leadTime${kind}Change`];
    return { month: month.month, value, change, tip: [[p.tipLeadTime, formatAverageDays(value, locale)],
      ...(change === null ? [] : [[p.tipChange, formatChange(change, locale)] as [string, string]])] };
  });

  return <section className="e2e-overview pre-dashboard" aria-label={p.label}>
      <DashboardCard title={p.priorityTitle} selected={selected.priority.length > 0} onClear={() => onClear("priority")}
        total={<Counted value={sum(priorities)} format={ips} />}>
        <PriorityDonut title={p.chartLabel(p.priorityTitle, ips(sum(priorities)))} entries={priorities} total={sum(priorities)}
          selected={selected.priority} onSelect={onSelect.priority} />
      </DashboardCard>
      <DashboardCard title={p.statusTitle} selected={selected.status.length > 0} onClear={() => onClear("status")}
        total={<Counted value={sum(statuses)} format={ips} />}>
        {sum(statuses) > 0 || selected.status.length > 0
          ? <CountBars entries={statuses} selected={selected.status} onSelect={onSelect.status} />
          : <p className="muted">{p.noIps}</p>}
      </DashboardCard>
      <DashboardCard title={p.channelTitle} selected={selected.channel.length > 0} onClear={() => onClear("channel")}
        total={<Counted value={sum(channels)} format={ips} />}>
        {sum(channels) > 0 || selected.channel.length > 0
          ? <CountBars entries={channels} selected={selected.channel} onSelect={onSelect.channel} />
          : <p className="muted">{p.noIps}</p>}
      </DashboardCard>
      <DashboardCard title={p.dsaMonthTitle} wide selected={false} onClear={() => undefined}
        total={share(summary.monthlyAverages.dsa)}>
        <p className="muted pre-dashboard-help">{p.monthHelp}</p>
        <MonthlyColumns title={p.dsaMonthTitle} values={dsaMonths} average={summary.monthlyAverages.dsa}
          target={summary.targets.dsa} format={share} />
      </DashboardCard>
      <DashboardCard title={p.leadTimeRealTitle} wide selected={false} onClear={() => undefined}
        total={formatAverageDays(summary.monthlyAverages.leadTimeRealTime, locale)}>
        <p className="muted pre-dashboard-help">{p.leadTimeHelp}</p>
        <MonthlyColumns title={p.leadTimeRealTitle} values={leadTimeMonths("RealTime")}
          average={summary.monthlyAverages.leadTimeRealTime} format={days} />
      </DashboardCard>
      <DashboardCard title={p.leadTimeDeliveredTitle} wide selected={false} onClear={() => undefined}
        total={formatAverageDays(summary.monthlyAverages.leadTimeDelivered, locale)}>
        <p className="muted pre-dashboard-help">{p.deliveredHelp}</p>
        <MonthlyColumns title={p.leadTimeDeliveredTitle} values={leadTimeMonths("Delivered")}
          average={summary.monthlyAverages.leadTimeDelivered} format={days} />
      </DashboardCard>
    </section>;
}
