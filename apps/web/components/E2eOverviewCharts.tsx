import type { ReactNode } from "react";
import { overviewShares, overviewTotal, type OverviewShare } from "../lib/e2e-overview-format";
import { statusLabel } from "../lib/i18n/labels";
import { pieSlices } from "../lib/pie-chart";
import { e2eDeadlineStatuses, productLineStatuses, type E2eDeadlineStatus } from "../lib/purchase-order-lines";
import { useI18n } from "./I18nProvider";

type OverviewPart = { quantity: string; lines: number };
export type E2eOverviewStatus = Exclude<(typeof productLineStatuses)[number], "CANCELADO">;
export type E2eOverview = {
  byStatus: Record<E2eOverviewStatus, OverviewPart>;
  byDeadline: Record<E2eDeadlineStatus, OverviewPart>;
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
function OverviewCard({ title, total, selected, onClear, children }: {
  title: string; total: string; selected: boolean; onClear: () => void; children: ReactNode;
}) {
  const { m } = useI18n();
  return <section className="e2e-overview-card">
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

function entriesOf<Key extends string>(keys: readonly Key[], parts: Record<Key, OverviewPart>, locale: string,
  label: (key: Key) => string, color: (key: Key, index: number) => string): ChartEntry<Key>[] {
  const shares = overviewShares(keys.map(key => parts[key].quantity), locale);
  return keys.map((key, index) => ({ key, label: label(key), color: color(key, index), part: parts[key], share: shares[index] }));
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
    <span>{o.chartsHidden(total)}</span>
  </span>;
}

/**
 * Item quantities of the filtered lines by line status (distribution bar) and by total deadline
 * status (compact pie). The two cross-filter: clicking a category filters the other chart, the
 * stage cards and the table, while its own chart keeps every category; clicking it again clears it.
 */
export default function E2eOverviewCharts({ overview, locale, selectedStatus, selectedDeadline, onStatusSelect,
  onDeadlineSelect }: {
  overview: E2eOverview; locale: string; selectedStatus: string; selectedDeadline: string;
  onStatusSelect: (status: E2eOverviewStatus) => void; onDeadlineSelect: (deadline: E2eDeadlineStatus) => void;
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
  const sliceTitle = (entry: ChartEntry<string>) => o.sliceTitle(entry.share.full, entry.part.lines);

  return <section className="e2e-overview" aria-label={o.label}>
    <OverviewCard title={o.statusTitle} total={statusTotal} selected={selectedStatus !== ""}
      onClear={() => onStatusSelect(selectedStatus as E2eOverviewStatus)}>
      {hasStatus
        ? <div className="e2e-distribution" role="img" aria-label={o.chartLabel(o.statusTitle, statusTotal)}>
          {statusEntries.filter(entry => entry.share.value > 0).map(entry =>
            <div key={entry.key} aria-hidden="true" title={`${entry.label}: ${sliceTitle(entry)}`}
              className={`e2e-distribution-segment${dimmed(entry.key, selectedStatus)}`}
              style={{ background: `var(${entry.color})`, flexGrow: entry.share.value }}
              onClick={() => onStatusSelect(entry.key)} />)}
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
              return <path key={entry.key} d={slice.d} fill={`var(${entry.color})`} aria-hidden="true"
                className={dimmed(entry.key, selectedDeadline).trim() || undefined}
                onClick={() => onDeadlineSelect(entry.key)}><title>{`${entry.label}: ${sliceTitle(entry)}`}</title></path>;
            })}
          </svg>
          : <p className="muted">{o.empty}</p>}
        <Legend entries={deadlineEntries} selected={selectedDeadline} onSelect={onDeadlineSelect}
          filterLabel={o.filterByDeadline} stacked />
      </div>
    </OverviewCard>
  </section>;
}
