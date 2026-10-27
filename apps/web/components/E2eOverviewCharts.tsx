import { useId, type KeyboardEvent } from "react";
import { formatNumber } from "../lib/format-number";
import { statusLabel } from "../lib/i18n/labels";
import { pieSlices } from "../lib/pie-chart";
import { productLineStatuses } from "../lib/purchase-order-lines";
import { useI18n } from "./I18nProvider";

type OverviewPart = { quantity: string; lines: number };
export type E2eOverviewStatus = Exclude<(typeof productLineStatuses)[number], "CANCELADO">;
type DeadlineStatus = "onTime" | "onLimit" | "late" | "noData";
export type E2eOverview = {
  byStatus: Record<E2eOverviewStatus, OverviewPart>;
  byDeadline: Record<DeadlineStatus, OverviewPart>;
};

type ChartEntry<Key extends string> = { key: Key; label: string; color: string; part: OverviewPart };
const statusColors = ["--color-chart-status-1", "--color-chart-status-2", "--color-chart-status-3",
  "--color-chart-status-4", "--color-chart-status-5", "--color-chart-status-6"];
const deadlineKeys: DeadlineStatus[] = ["onTime", "onLimit", "late", "noData"];
const deadlineColors: Record<DeadlineStatus, string> = {
  onTime: "--color-chart-on-time", onLimit: "--color-chart-on-limit",
  late: "--color-chart-late", noData: "--color-chart-no-data",
};

function PieCard<Key extends string>({ title, entries, locale, onStatusSelect, selectedStatus }: {
  title: string; entries: ChartEntry<Key>[]; locale: string;
  onStatusSelect?: (key: Key) => void; selectedStatus?: string;
}) {
  const { m } = useI18n();
  const titleId = useId();
  const values = entries.map(entry => Number(entry.part.quantity));
  const total = values.reduce((sum, value) => sum + value, 0);
  const slices = pieSlices(values, { centerX: 180, centerY: 126, radius: 78, labelRadius: 112 });
  const compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 2 });
  const percentage = (fraction: number) => new Intl.NumberFormat(locale, { style: "percent",
    minimumFractionDigits: fraction < .01 ? 3 : 0, maximumFractionDigits: fraction < .01 ? 3 : 0 }).format(fraction);
  const chartLabel = m.e2eLines.overview.chartLabel(title, formatNumber(String(total)));
  const activate = (event: KeyboardEvent<SVGGElement>, key: Key) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onStatusSelect?.(key); }
  };

  return <section className="card e2e-overview-card">
    <h2>{title}</h2>
    <ul className="e2e-chart-legend">
      {entries.map((entry, index) => {
        const fraction = total > 0 ? values[index] / total : 0;
        const content = <><span className="e2e-chart-swatch" style={{ background: `var(${entry.color})` }} />
          <span>{entry.label}</span><strong>{formatNumber(entry.part.quantity)}</strong><span>{percentage(fraction)}</span></>;
        return <li key={entry.key}>{onStatusSelect
          ? <button type="button" onClick={() => onStatusSelect(entry.key)} aria-pressed={selectedStatus === entry.key}
              aria-label={m.e2eLines.overview.filterByStatus(entry.label)}>{content}</button>
          : <span className="e2e-chart-legend-item">{content}</span>}</li>;
      })}
    </ul>
    {total === 0 ? <p className="muted">{m.e2eLines.overview.empty}</p>
      : <svg className="e2e-pie" viewBox="0 0 360 252" role="img" aria-labelledby={titleId}>
        <title id={titleId}>{chartLabel}</title>
        {slices.map(slice => {
          const entry = entries[slice.index];
          const content = m.e2eLines.overview.sliceTitle(formatNumber(entry.part.quantity), entry.part.lines);
          return <g key={entry.key} className={onStatusSelect ? "e2e-pie-action" : undefined}
            role={onStatusSelect ? "button" : undefined} tabIndex={onStatusSelect ? 0 : undefined}
            aria-label={onStatusSelect ? m.e2eLines.overview.filterByStatus(entry.label) : undefined}
            onClick={onStatusSelect ? () => onStatusSelect(entry.key) : undefined}
            onKeyDown={onStatusSelect ? event => activate(event, entry.key) : undefined}>
            <path d={slice.d} fill={`var(${entry.color})`}><title>{content}</title></path>
            {slice.guide && <line className="e2e-pie-guide" x1={slice.guide.start.x} y1={slice.guide.start.y}
              x2={slice.guide.end.x} y2={slice.guide.end.y} />}
            {slice.label && <text className="e2e-pie-label" x={slice.label.x} y={slice.label.y}
              textAnchor={slice.label.x < 180 ? "end" : "start"}>{compact.format(slice.value)} ({percentage(slice.fraction)})</text>}
          </g>;
        })}
      </svg>}
  </section>;
}

export default function E2eOverviewCharts({ overview, locale, selectedStatus, onStatusSelect }: {
  overview: E2eOverview; locale: string; selectedStatus: string; onStatusSelect: (status: E2eOverviewStatus) => void;
}) {
  const { m } = useI18n();
  const statusKeys = productLineStatuses.slice(0, -1) as readonly E2eOverviewStatus[];
  const statusEntries = statusKeys.map((key, index) => ({ key, label: statusLabel(m, key),
    color: statusColors[index], part: overview.byStatus[key] }));
  const deadlineEntries = deadlineKeys.map(key => ({ key, label: m.e2eLines.overview[key],
    color: deadlineColors[key], part: overview.byDeadline[key] }));
  return <section className="e2e-overview" aria-label={m.e2eLines.overview.label}>
    <PieCard title={m.e2eLines.overview.statusTitle} entries={statusEntries} locale={locale}
      selectedStatus={selectedStatus} onStatusSelect={onStatusSelect} />
    <PieCard title={m.e2eLines.overview.deadlineTitle} entries={deadlineEntries} locale={locale} />
  </section>;
}
