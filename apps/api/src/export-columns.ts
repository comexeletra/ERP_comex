import { z } from "zod";
import { E2E_STAGE_CODES, type E2eStageCode } from "./followup-calculations.js";
import type { PurchaseOrderExportRow } from "./purchase-order-exports.js";
import type { ShipmentLine, ShipmentLineFilters } from "./shipment-lines.js";

/**
 * Columns each export screen offers: the data columns of its table, in the table order. A column
 * added to, moved in or removed from one of those tables changes its catalog here in the same
 * commit, and in the web mirror (apps/web/lib/export-columns.ts); test/export-columns.test.mjs
 * compares the two. Headers come from the web in the viewer's language; these are the fallbacks.
 */
export const exportContexts = ["portfolio", "product-lines", "end-to-end"] as const;
export type ExportContext = (typeof exportContexts)[number];

type Cell = string | number | null;
type ColumnFilters = Pick<ShipmentLineFilters, "stage" | "view">;
export type ExportColumn<Row> = {
  key: string; header: string; width: number;
  /** Always exported: identifies the PO and the product of the line. */
  required?: true;
  /** Shown in the same table cell as this column, so it is exported with it and not chosen alone. */
  follows?: string;
  /** Only in the table in some states of the screen; the column follows the same condition. */
  available?: (filters: ColumnFilters) => boolean;
  value: (row: Row, filters: ColumnFilters) => Cell;
  /** True when the value is a forecast, shown in italics as on the screen. */
  forecast?: (row: Row) => boolean;
};
/** A chosen column with its header and its value bound to the export filters. */
export type ResolvedExportColumn<Row> = Omit<ExportColumn<Row>, "value"> & { value: (row: Row) => Cell };

const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
const decimal = (value: unknown): number | null => {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
type LineE2e = {
  air?: boolean | null; totalTargetDays?: number | null; totalActualDays?: number | null; totalDelayDays?: number | null;
  bottleneck?: string | null; currentStatus?: string | null; arrivalYearMonth?: string | null;
  stages?: Partial<Record<E2eStageCode, { deadline: string | null; actual: string | null; source: string | null;
    targetDays: number | null; actualDays: number | null; delayDays: number | null; accumulatedDelayDays: number | null }>>;
};
const e2e = (line: ShipmentLine) => (line.calculated as { e2e?: LineE2e | null }).e2e ?? null;
const e2eStage = (line: ShipmentLine, code: E2eStageCode) => e2e(line)?.stages?.[code] ?? null;

// Values of the PO lifecycle in Portuguese, as the other values the API writes in the file.
const lifecycleLabels: Record<string, string> = {
  ACTIVE: "Ativa", CLOSED: "Encerrada", CANCELLED: "Cancelada", DELETED: "Excluída",
};

// Carteira de POs (app/page.tsx); the "Abrir" action column has no data.
const portfolioColumns: ExportColumn<PurchaseOrderExportRow>[] = [
  { key: "poNumber", header: "PO TOTVS", width: 22, required: true, value: row => row.number },
  { key: "importer", header: "Importador", width: 34, value: row => row.importer },
  { key: "lifecycleStatus", header: "Status", width: 14,
    value: row => lifecycleLabels[row.lifecycleStatus] ?? row.lifecycleStatus },
  { key: "itemCount", header: "Itens", width: 12, value: row => row.itemCount },
  { key: "linkedProcessCount", header: "IPs", width: 12, value: row => row.linkedProcessCount },
  { key: "itemsWithoutIp", header: "Itens sem IP", width: 16, value: row => row.itemsWithoutIp },
  { key: "unresolvedIssueCount", header: "Pendências", width: 16, value: row => row.unresolvedIssueCount },
];

type LineColumn = ExportColumn<ShipmentLine>;
const line = (key: string, header: string, value: LineColumn["value"], width = Math.max(12, header.length + 4),
  extra: Partial<LineColumn> = {}): LineColumn => ({ key, header, width, value, ...extra });

// Carteira por produto (components/ProductLinesView.tsx); the product cell also shows the description.
const productLineColumns: LineColumn[] = [
  line("poNumber", "PO", row => text(row.purchaseOrder.number), 18, { required: true }),
  line("importer", "Importador", row => text(row.purchaseOrder.importer), 30),
  line("product", "Produto", row => text(row.item.productCode), 18, { required: true }),
  line("productDescription", "Descrição", row => text(row.item.description), 40, { follows: "product" }),
  line("quantity", "Quantidade", row => decimal(row.quantity)),
  line("ipNumber", "IP", row => text(row.process?.ipNumber), 16),
  line("status", "Status", row => text(row.calculated.status), 22),
  line("etd", "ETD", row => text(row.process?.etd)),
  line("departure", "Departure", row => text(row.process?.actualPortDepartureDate)),
  line("blDate", "BL date", row => text(row.process?.blDate)),
  line("eta", "ETA", row => text(row.calculated.eta)),
  line("arrival", "Chegada", row => text(row.process?.arrivalDate)),
  line("ete", "ETE", row => text(row.calculated.ete)),
  line("delivery", "Entrega", row => text(row.process?.deliveryDate)),
  line("factoryShip", "Saída da fábrica", row => text(row.factoryShipDate)),
  line("invoice", "Invoice", row => Array.isArray(row.calculated.invoiceNumbers) && row.calculated.invoiceNumbers.length
    ? row.calculated.invoiceNumbers.join(", ") : null, 20),
];

const stageMeasures = [
  ["Deadline", "Prazo", (line: ShipmentLine, code: E2eStageCode) => text(e2eStage(line, code)?.deadline)],
  ["Actual", "Real", (line: ShipmentLine, code: E2eStageCode) => text(e2eStage(line, code)?.actual)],
  ["Target", "Meta", (line: ShipmentLine, code: E2eStageCode) => decimal(e2eStage(line, code)?.targetDays)],
  ["Days", "Dias", (line: ShipmentLine, code: E2eStageCode) => decimal(e2eStage(line, code)?.actualDays)],
  ["Delay", "Atraso", (line: ShipmentLine, code: E2eStageCode) => decimal(e2eStage(line, code)?.delayDays)],
] as const;

// End to End (components/E2eLinesView.tsx). The accumulated delay column exists only in the
// "reached" view of a stage; the modal follows modalLabel() of the screen.
const endToEndColumns: LineColumn[] = [
  line("necessity", "Necessidade", row => text(row.item.necessityDate)),
  line("poNumber", "PO", row => text(row.purchaseOrder.number), 18, { required: true }),
  line("scNumber", "SC", row => text(row.item.scNumber)),
  line("ipNumber", "IP", row => text(row.process?.ipNumber), 16),
  line("status", "Status", row => text(row.calculated.status), 22),
  line("purpose", "Finalidade", row => text(row.item.purpose), 18),
  line("productCode", "Produto", row => text(row.item.productCode), 18, { required: true }),
  line("description", "Descrição", row => text(row.item.description), 40),
  line("modal", "Modal", row => {
    const air = e2e(row)?.air;
    return air === true ? "Aéreo" : air === false ? "Marítimo" : text(row.process?.transportMode);
  }),
  line("group", "Group", row => text(row.item.group)),
  line("quantity", "Qtd.", row => decimal(row.quantity)),
  line("accumulatedDelay", "Atraso acumulado", (row, filters) =>
    filters.stage ? decimal(e2eStage(row, filters.stage)?.accumulatedDelayDays) : null, 22,
  { available: filters => filters.view === "reached" && filters.stage !== undefined }),
  ...E2E_STAGE_CODES.flatMap(code => stageMeasures.map(([measure, header, value]) =>
    line(`${code.toLowerCase()}${measure}`, `${code} ${header}`, row => value(row, code), 14,
      measure === "Actual" ? { forecast: row => e2eStage(row, code)?.source === "forecast" } : {}))),
  line("totalTarget", "Totais Meta", row => decimal(e2e(row)?.totalTargetDays)),
  line("totalActual", "Totais Real", row => decimal(e2e(row)?.totalActualDays)),
  line("totalDelay", "Totais Atraso", row => decimal(e2e(row)?.totalDelayDays)),
  line("bottleneck", "Gargalo", row => text(e2e(row)?.bottleneck)),
  line("currentStatus", "Status atual", row => text(e2e(row)?.currentStatus), 22),
  line("arrivalMonth", "Chegada BR", row => text(e2e(row)?.arrivalYearMonth)),
];

type ContextRow = { portfolio: PurchaseOrderExportRow; "product-lines": ShipmentLine; "end-to-end": ShipmentLine };
export const exportColumnCatalogs: { [C in ExportContext]: ExportColumn<ContextRow[C]>[] } = {
  portfolio: portfolioColumns, "product-lines": productLineColumns, "end-to-end": endToEndColumns,
};

/** Columns chosen on the screen, each with its header in the viewer's language. */
export const exportColumnsSchema = z.array(z.object({
  key: z.string().min(1).max(60),
  header: z.string().trim().min(1).max(80).regex(/^[^\p{Cc}]+$/u),
}).strict()).min(1).max(100);
export type ExportColumnChoice = z.infer<typeof exportColumnsSchema>[number];

/**
 * The columns written for a choice: duplicates removed, required columns added with their
 * default header, columns unavailable for the filters dropped, in the table order.
 * Null when a key is not a column of the context.
 */
export function resolveExportColumns<C extends ExportContext>(context: C, choices: readonly ExportColumnChoice[],
  filters: ColumnFilters): ResolvedExportColumn<ContextRow[C]>[] | null {
  const catalog: ExportColumn<ContextRow[C]>[] = exportColumnCatalogs[context];
  if (choices.length === 0 || choices.length > catalog.length) return null;
  const headers = new Map<string, string>();
  for (const choice of choices) {
    if (!catalog.some(column => column.key === choice.key)) return null;
    if (!headers.has(choice.key)) headers.set(choice.key, choice.header);
  }
  const chosen = (column: ExportColumn<ContextRow[C]>): boolean => column.follows
    ? chosen(catalog.find(parent => parent.key === column.follows)!)
    : column.required === true || headers.has(column.key);
  return catalog.filter(column => chosen(column) && (column.available?.(filters) ?? true))
    .map(column => ({ ...column, header: headers.get(column.key) ?? column.header,
      value: (row: ContextRow[C]) => column.value(row, filters) }));
}
