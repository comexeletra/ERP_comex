import type { CSSProperties, ReactNode } from "react";
import { donutSegments } from "../lib/donut-chart";
import { formatCompact, formatPercent, largestIndex, overviewShares } from "../lib/e2e-overview-format";
import { statusLabel } from "../lib/i18n/labels";
import type { Messages } from "../lib/i18n/pt-BR";
import { formatProducts, preShipmentAgingColors, preShipmentAgingRanges, preShipmentStatusColors, preShipmentStatuses,
  type PreShipmentAgingRange, type PreShipmentPart, type PreShipmentStatus, type PreShipmentSummary } from "../lib/pre-shipment-dashboard";
import { additive, Counted, dimmed, InsightChip, Legend, Meter, tint, width, type ChartEntry } from "./E2eOverviewCharts";
import { useI18n } from "./I18nProvider";
import { Tooltip } from "./Tooltip";

type Entry<Key extends string> = ChartEntry<Key>;
type Select<Key extends string> = (key: Key, additive: boolean) => void;

/** Entries of a chart with their share of the products (`by: "products"`) or of the item quantity. */
function entriesOf<Key extends string>(keys: readonly Key[], parts: Record<Key, PreShipmentPart>, by: "products" | "quantity",
  locale: string, label: (key: Key) => string, color: (key: Key) => string): Entry<Key>[] {
  const shares = overviewShares(keys.map(key => by === "products" ? String(parts[key].products) : parts[key].quantity), locale);
  return keys.map((key, index) => ({ key, label: label(key), color: color(key), share: shares[index],
    part: { quantity: parts[key].quantity, lines: parts[key].products } }));
}

/** Card of the dashboard, in the style of the End to End overview: label, total, an insight and the selection reset. */
function DashboardCard({ title, total, selected, onClear, wide, insight, children }: {
  title: string; total: ReactNode; selected: boolean; onClear: () => void; wide?: boolean; insight?: ReactNode; children: ReactNode;
}) {
  const { m } = useI18n();
  return <section className={wide ? "e2e-overview-card e2e-overview-card-wide" : "e2e-overview-card"}>
    <div className="e2e-overview-head">
      <div className="e2e-overview-title"><span className="e2e-label">{title}</span><strong>{total}</strong></div>
      {(insight || selected) && <div className="e2e-overview-head-side">
        {insight}
        {selected && <button type="button" className="e2e-overview-clear" onClick={onClear}>{m.reports.dashboard.clearSelection}</button>}
      </div>}
    </div>
    {children}
  </section>;
}

/** Tooltip card of a mark: products, item quantity and share, and what a click (and Ctrl+click) does. */
function Tip({ entry, selected, locale, m }: { entry: Entry<string>; selected: readonly string[]; locale: string; m: Messages }) {
  const d = m.reports.dashboard;
  const quantity = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Number(entry.part.quantity));
  const rows: [string, string][] = [[d.tipProducts, formatProducts(entry.part.lines, locale)], [d.tipQuantity, quantity],
    [d.tipShare, entry.share.percent]];
  return <div className="e2e-chart-tip">
    <div className="e2e-chart-tip-name"><span className="e2e-chart-swatch" style={{ background: `var(${entry.color})` }} />{entry.label}</div>
    <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="e2e-chart-tip-hint">{selected.includes(entry.key) ? d.tipClear : d.tipFilter}</div>
    <div className="e2e-chart-tip-hint">{d.tipAdd}</div>
  </div>;
}

/** One tile per status (the BI cards): products, share and meter; each tile filters by its status. */
function StatusTiles({ entries, selected, onSelect }: {
  entries: Entry<PreShipmentStatus>[]; selected: readonly string[]; onSelect: Select<PreShipmentStatus>;
}) {
  const { m, locale } = useI18n();
  const d = m.reports.dashboard;
  const top = largestIndex(entries.map(entry => entry.share.value));
  return <ul className="pre-dashboard-tiles">
    {entries.map((entry, index) => <li key={entry.key} style={{ ...tint(entry.color), "--step-index": index } as CSSProperties}>
      <Tooltip content={<Tip entry={entry} selected={selected} locale={locale} m={m} />}>
        <button type="button" className={`e2e-status-step-tile${index === top ? " is-top" : ""}${dimmed(entry.key, selected)}`}
          aria-pressed={selected.includes(entry.key)} onClick={event => onSelect(entry.key, additive(event))}
          aria-label={`${d.filterByStatus(entry.label)} (${formatProducts(entry.part.lines, locale)}, ${entry.share.percent})`}>
          <span className="e2e-status-step-label">{entry.label}</span>
          <strong className={entry.share.value > 0 ? "e2e-status-step-value" : "e2e-status-step-value is-empty"}>
            <Counted value={entry.share.value} format={value => formatProducts(value, locale)} /></strong>
          <span className="e2e-status-step-share"><Meter fraction={entry.share.fraction} />
            <span className="e2e-chart-legend-share"><Counted value={entry.share.fraction} format={value => formatPercent(value, locale)} /></span></span>
        </button>
      </Tooltip>
    </li>)}
  </ul>;
}

/** Ring of the statuses with its legend; the centre shows `center`, and each arc and legend item filters by its status. */
function StatusDonut({ title, entries, selected, onSelect, center, centerLabel, neutral }: {
  title: string; entries: Entry<PreShipmentStatus>[]; selected: readonly string[]; onSelect: Select<PreShipmentStatus>;
  center: ReactNode; centerLabel: string; neutral?: boolean;
}) {
  const { m, locale } = useI18n();
  const d = m.reports.dashboard;
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
        <span className={neutral ? "e2e-donut-center pre-dashboard-center-neutral" : "e2e-donut-center"} aria-hidden="true"><strong>{center}</strong><span>{centerLabel}</span></span>
      </div>
      : <p className="muted">{d.noProducts}</p>}
    <Legend entries={entries} selected={selected} onSelect={onSelect} filterLabel={d.filterByStatus} locale={locale} />
  </div>;
}

/** Products by aging range as rows in order, each bar scaled to the largest range; each row filters by its range. */
function AgingBars({ entries, selected, onSelect }: {
  entries: Entry<PreShipmentAgingRange>[]; selected: readonly string[]; onSelect: Select<PreShipmentAgingRange>;
}) {
  const { m, locale } = useI18n();
  const d = m.reports.dashboard;
  const max = Math.max(0, ...entries.map(entry => entry.share.value));
  return <ul className="e2e-range-bars">
    {entries.map(entry => <li key={entry.key}>
      <Tooltip content={<Tip entry={entry} selected={selected} locale={locale} m={m} />} followCursor>
        <button type="button" className={`e2e-range-row${dimmed(entry.key, selected)}`} aria-pressed={selected.includes(entry.key)}
          style={tint(entry.color)} onClick={event => onSelect(entry.key, additive(event))}
          aria-label={`${d.filterByAging(entry.label)} (${formatProducts(entry.part.lines, locale)}, ${entry.share.percent})`}>
          <span className="e2e-range-label">{entry.label}</span>
          <span className="e2e-range-track">
            {entry.share.value > 0 && <span className="e2e-range-fill" style={width(max > 0 ? entry.share.value / max : 0)} />}
          </span>
          <strong><Counted value={entry.share.value} format={value => value > 0 ? formatProducts(value, locale) : "—"} /></strong>
          <span className="e2e-chart-legend-share"><Counted value={entry.share.fraction} format={value => formatPercent(value, locale)} /></span>
        </button>
      </Tooltip>
    </li>)}
  </ul>;
}

/**
 * The BI pre-shipment metrics: one tile per status, the aging since the PO was sent, the share of the products by
 * status and the item quantity by status. The charts cross-filter: a click on a status filters the aging chart and
 * the table, a click on an aging range filters the status charts and the table; a chart keeps its own categories.
 */
export default function PreShipmentCharts({ summary, selectedStatuses, selectedAging, onStatusSelect, onStatusClear,
  onAgingSelect, onAgingClear }: {
  summary: PreShipmentSummary; selectedStatuses: readonly string[]; selectedAging: readonly string[];
  onStatusSelect: Select<PreShipmentStatus>; onStatusClear: () => void;
  onAgingSelect: Select<PreShipmentAgingRange>; onAgingClear: () => void;
}) {
  const { m, locale } = useI18n();
  const d = m.reports.dashboard;
  const statusName = (status: PreShipmentStatus) => statusLabel(m, status);
  const statusColor = (status: PreShipmentStatus) => preShipmentStatusColors[status];
  const byProducts = entriesOf(preShipmentStatuses, summary.byStatus, "products", locale, statusName, statusColor);
  const byQuantity = entriesOf(preShipmentStatuses, summary.byStatus, "quantity", locale, statusName, statusColor);
  const aging = entriesOf(preShipmentAgingRanges, summary.aging, "products", locale, range => d.agingRanges[range],
    range => preShipmentAgingColors[range]);
  const sum = (entries: Entry<string>[]) => entries.reduce((total, entry) => total + entry.share.value, 0);
  const statusTotal = sum(byProducts);
  const quantityTotal = sum(byQuantity);
  const agingTotal = sum(aging);
  const largest = byProducts[largestIndex(byProducts.map(entry => entry.share.value))];
  const delivered = byProducts[preShipmentStatuses.indexOf("ENTREGUE")];
  const over120 = aging[preShipmentAgingRanges.indexOf("days120Plus")];
  const statusSelected = selectedStatuses.length > 0;
  const products = (value: number) => d.totalProducts(formatProducts(value, locale));

  return <section className="e2e-overview pre-dashboard" aria-label={d.label}>
    <DashboardCard title={d.productsTitle} wide selected={statusSelected} onClear={onStatusClear}
      total={<Counted value={summary.totalProducts} format={products} />}
      insight={largest && <InsightChip key={largest.key} color={largest.color} label={m.e2eLines.overview.largestShare}
        value={<>{largest.label} · <Counted value={largest.share.fraction} format={value => formatPercent(value, locale)} /></>} />}>
      <StatusTiles entries={byProducts} selected={selectedStatuses} onSelect={onStatusSelect} />
    </DashboardCard>
    <DashboardCard title={d.agingTitle} selected={selectedAging.length > 0} onClear={onAgingClear}
      total={<Counted value={agingTotal} format={products} />}
      insight={over120.share.value > 0 && <InsightChip danger color="--color-chart-late" label={d.over120}
        value={<><Counted value={over120.share.value} format={value => formatProducts(value, locale)} /> · <Counted
          value={over120.share.fraction} format={value => formatPercent(value, locale)} /></>} />}>
      <p className="muted pre-dashboard-help">{d.agingHelp}</p>
      {agingTotal > 0 || selectedAging.length > 0
        ? <AgingBars entries={aging} selected={selectedAging} onSelect={onAgingSelect} />
        : <p className="muted">{d.noProducts}</p>}
      {summary.agingWithoutSentDate.products > 0 && <p className="muted pre-dashboard-help">
        {d.agingWithoutSentDate(formatProducts(summary.agingWithoutSentDate.products, locale))}</p>}
    </DashboardCard>
    <DashboardCard title={d.statusShareTitle} selected={statusSelected} onClear={onStatusClear}
      total={<Counted value={statusTotal} format={products} />}>
      <StatusDonut title={d.chartLabel(d.statusShareTitle, products(statusTotal))} entries={byProducts}
        selected={selectedStatuses} onSelect={onStatusSelect} centerLabel={d.deliveredCenter}
        center={<Counted value={delivered.share.fraction} format={value => formatPercent(value, locale)} />} />
    </DashboardCard>
    <DashboardCard title={d.quantityTitle} selected={statusSelected} onClear={onStatusClear}
      total={<Counted value={quantityTotal} format={value => d.totalItems(formatCompact(value, locale))} />}>
      <StatusDonut title={d.chartLabel(d.quantityTitle, d.totalItems(formatCompact(quantityTotal, locale)))} entries={byQuantity}
        selected={selectedStatuses} onSelect={onStatusSelect} centerLabel={d.itemsCenter} neutral
        center={<Counted value={quantityTotal} format={value => formatCompact(value, locale)} />} />
    </DashboardCard>
  </section>;
}
