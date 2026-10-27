import type { Messages } from "./i18n/pt-BR";

/**
 * Columns each Excel export offers: the data columns of the screen table, in the table order, with
 * the table header as label. Mirror of apps/api/src/export-columns.ts (the API test compares them);
 * a column added to, moved in or removed from one of those tables changes both in the same commit.
 */
export type ExportContext = "portfolio" | "product-lines" | "end-to-end";
export type ExportColumnFilters = { stage?: string; view?: string };

// Modules of lib/ do not import values from each other (see AGENTS.md).
const stageCodes = ["T0", "T1", "T2", "T3", "T4", "T5"] as const;
export type ExportStageCode = (typeof stageCodes)[number];
export const exportStageMeasures = ["deadline", "actual", "target", "days", "delay"] as const;
export type ExportStageMeasure = (typeof exportStageMeasures)[number];

export type ExportColumnDef = {
  key: string;
  /** Header of the column in the table, also written in the file, in the viewer's language. */
  label: (m: Messages, filters: ExportColumnFilters) => string;
  /** Always exported: identifies the PO and the product. */
  required?: true;
  /** Shown in the same table cell as this column, so it is exported with it and not chosen alone. */
  follows?: string;
  /** Only in the table in the "reached" view of a stage, as the accumulated delay. */
  conditional?: true;
  /** End to End stage columns, chosen in a grid of stages and measures. */
  stage?: ExportStageCode; measure?: ExportStageMeasure;
  /** End to End totals, shown under the "Totais" header of the table. */
  total?: true;
};

const measureLabel = (m: Messages, measure: ExportStageMeasure) => m.e2eLines[measure];
const totalLabel = (m: Messages, measure: ExportStageMeasure) => `${m.e2eLines.totals} ${measureLabel(m, measure)}`;

export const exportColumnCatalog: Record<ExportContext, readonly ExportColumnDef[]> = {
  // app/page.tsx; the action column has no data.
  portfolio: [
    { key: "poNumber", label: m => m.portfolio.totvsPo, required: true },
    { key: "importer", label: m => m.processDirectory.importer },
    { key: "lifecycleStatus", label: m => m.calc.status },
    { key: "itemCount", label: m => m.portfolio.items },
    { key: "linkedProcessCount", label: () => "IPs" },
    { key: "itemsWithoutIp", label: m => m.portfolio.itemsWithoutIp },
    { key: "unresolvedIssueCount", label: m => m.portfolio.pending },
  ],
  // components/ProductLinesView.tsx; the product cell also shows the description.
  "product-lines": [
    { key: "poNumber", label: () => "PO", required: true },
    { key: "importer", label: m => m.followup.importer },
    { key: "product", label: m => m.followup.product, required: true },
    { key: "productDescription", label: m => m.e2eLines.description, follows: "product" },
    { key: "quantity", label: m => m.followup.quantity },
    { key: "ipNumber", label: () => "IP" },
    { key: "status", label: m => m.calc.status },
    { key: "etd", label: () => "ETD" },
    { key: "departure", label: m => m.followup.departure },
    { key: "blDate", label: m => m.fields.blDate },
    { key: "eta", label: () => "ETA" },
    { key: "arrival", label: m => m.followup.arrival },
    { key: "ete", label: () => "ETE" },
    { key: "delivery", label: m => m.followup.delivery },
    { key: "factoryShip", label: m => m.followup.factoryShip },
    { key: "invoice", label: m => m.postShipment.invoice },
  ],
  // components/E2eLinesView.tsx.
  "end-to-end": [
    { key: "necessity", label: m => m.e2eLines.necessity },
    { key: "poNumber", label: () => "PO", required: true },
    { key: "scNumber", label: m => m.e2eLines.sc },
    { key: "ipNumber", label: () => "IP" },
    { key: "status", label: m => m.calc.status },
    { key: "purpose", label: m => m.e2eLines.purpose },
    { key: "productCode", label: m => m.e2eLines.product, required: true },
    { key: "description", label: m => m.e2eLines.description },
    { key: "modal", label: m => m.e2eLines.modal },
    { key: "group", label: m => m.e2eLines.group },
    { key: "quantity", label: m => m.e2eLines.quantity },
    { key: "accumulatedDelay", label: (m, filters) => m.e2eLines.flow.accumulated(filters.stage ?? ""), conditional: true },
    ...stageCodes.flatMap(stage => exportStageMeasures.map((measure): ExportColumnDef => ({
      key: `${stage.toLowerCase()}${measure[0].toUpperCase()}${measure.slice(1)}`,
      label: m => `${stage} ${measureLabel(m, measure)}`, stage, measure,
    }))),
    { key: "totalTarget", label: m => totalLabel(m, "target"), total: true },
    { key: "totalActual", label: m => totalLabel(m, "actual"), total: true },
    { key: "totalDelay", label: m => totalLabel(m, "delay"), total: true },
    { key: "bottleneck", label: m => m.e2eLines.bottleneck },
    { key: "currentStatus", label: m => m.e2eLines.currentStatus },
    { key: "arrivalMonth", label: m => m.e2eLines.arrivalMonth },
  ],
};

const available = (column: ExportColumnDef, filters: ExportColumnFilters) =>
  !column.conditional || (filters.view === "reached" && Boolean(filters.stage));

/** Columns the viewer chooses on the screen: the dependent ones go with their column. */
export function choosableColumns(context: ExportContext, filters: ExportColumnFilters): ExportColumnDef[] {
  return exportColumnCatalog[context].filter(column => !column.follows && available(column, filters));
}

/** The choice kept in the browser: every column, or the chosen keys. */
export type SavedExportColumns = { all: true } | { all: false; keys: string[] };

/** Keys selected when the dialog opens: the saved choice still in the catalog, with the required columns. */
export function initialSelection(context: ExportContext, saved: unknown): string[] {
  const catalog = exportColumnCatalog[context].filter(column => !column.follows);
  const choice = saved as Partial<{ all: unknown; keys: unknown }> | null;
  if (!choice || typeof choice !== "object" || choice.all !== false || !Array.isArray(choice.keys)) {
    return catalog.map(column => column.key);
  }
  const keys = new Set(choice.keys.filter((key): key is string => typeof key === "string"));
  return catalog.filter(column => column.required || keys.has(column.key)).map(column => column.key);
}

/** Selects or clears the given columns; the required ones stay selected. */
export function setColumns(context: ExportContext, selection: readonly string[], keys: readonly string[],
  selected: boolean): string[] {
  const next = new Set(selection);
  for (const key of keys) {
    if (selected) next.add(key);
    else next.delete(key);
  }
  return exportColumnCatalog[context].filter(column => !column.follows && (column.required || next.has(column.key)))
    .map(column => column.key);
}

/** What to keep in the browser: "all" lets columns added to the table later come selected. */
export function savedSelection(context: ExportContext, selection: readonly string[]): SavedExportColumns {
  const keys = new Set(selection);
  // The conditional column is out of the dialog in most views, so it does not break "all".
  return exportColumnCatalog[context].every(column => column.follows || column.conditional || keys.has(column.key))
    ? { all: true } : { all: false, keys: [...selection] };
}

/** Body sent to the export route: the context and the chosen columns with their headers, in the table order. */
export function columnsBody(context: ExportContext, selection: readonly string[], m: Messages,
  filters: ExportColumnFilters): { context: ExportContext; columns: { key: string; header: string }[] } {
  const keys = new Set(selection);
  const catalog = exportColumnCatalog[context];
  const chosen = (column: ExportColumnDef): boolean => column.follows
    ? chosen(catalog.find(parent => parent.key === column.follows)!)
    : column.required === true || keys.has(column.key);
  return { context, columns: catalog.filter(column => available(column, filters) && chosen(column))
    .map(column => ({ key: column.key, header: column.label(m, filters) })) };
}

/** Browser storage of the choice; null when the page has no window. */
export type ExportColumnStorage = Pick<Storage, "getItem" | "setItem">;
const storageKey = (context: ExportContext) => `erp-comex-export-columns:${context}`;

export function readSavedColumns(storage: ExportColumnStorage | null, context: ExportContext): unknown {
  try {
    const value = storage?.getItem(storageKey(context));
    return value ? JSON.parse(value) as unknown : null;
  } catch {
    return null;
  }
}

export function writeSavedColumns(storage: ExportColumnStorage | null, context: ExportContext,
  selection: readonly string[]): void {
  try {
    storage?.setItem(storageKey(context), JSON.stringify(savedSelection(context, selection)));
  } catch {
    // Private windows and blocked site data open the dialog with every column next time.
  }
}
