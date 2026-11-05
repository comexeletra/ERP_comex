/**
 * Filters and categories of the pre-shipment dashboard (the BI "Pré Embarque" metrics), sent to
 * GET /api/v1/reports/pre-shipment/summary and /lines. The API test checks that these lists match its own.
 */

/** Status of a product line, as calculated by the API (the same list as the product lines). */
export const preShipmentStatuses = ["A DISTRIBUIR", "AGUARDANDO PRODUÇÃO", "AGUARDANDO EMBARQUE",
  "AGUARDANDO CHEGADA", "DESEMBARAÇO", "ENTREGUE", "CANCELADO"] as const;
export type PreShipmentStatus = typeof preShipmentStatuses[number];

/** Colours of the statuses: those of the End to End status chart, and grey for the cancelled lines. */
export const preShipmentStatusColors: Record<PreShipmentStatus, string> = {
  "A DISTRIBUIR": "--color-chart-status-1", "AGUARDANDO PRODUÇÃO": "--color-chart-status-2",
  "AGUARDANDO EMBARQUE": "--color-chart-status-3", "AGUARDANDO CHEGADA": "--color-chart-status-4",
  DESEMBARAÇO: "--color-chart-status-5", ENTREGUE: "--color-chart-status-6", CANCELADO: "--color-chart-no-data",
};

/** Ranges of days since the PO was sent (BI "Aging days since PO"), in order. */
export const preShipmentAgingRanges = ["upTo45", "days45To60", "days60To90", "days90To120", "days120Plus"] as const;
export type PreShipmentAgingRange = typeof preShipmentAgingRanges[number];

/** The first range shares the green of "No prazo"; the others darken with the days, as the delay ranges. */
export const preShipmentAgingColors: Record<PreShipmentAgingRange, string> = {
  upTo45: "--color-chart-on-time", days45To60: "--color-chart-range-1", days60To90: "--color-chart-range-2",
  days90To120: "--color-chart-range-4", days120Plus: "--color-chart-range-6",
};

/**
 * Text fields match a part of the value; lists hold any of the values chosen (none is "Todos"). `status` and
 * `aging` are the chart selections. `necessityPeriod` keeps a relative period in the URL and is not sent.
 */
export type PreShipmentFilters = {
  status: PreShipmentStatus[]; aging: PreShipmentAgingRange[];
  priority: "" | "priority" | "normal"; direct: "" | "direct" | "notDirect";
  demand: string[]; requester: string[]; group: string[]; supplier: string[]; purpose: string[]; importers: string[];
  modes: string[];
  scNumber: string; ipNumber: string; purchaseOrder: string; productCode: string; productDescription: string;
  necessityFrom: string; necessityTo: string; necessityPeriod: string;
};

export const emptyPreShipmentFilters: PreShipmentFilters = { status: [], aging: [], priority: "", direct: "",
  demand: [], requester: [], group: [], supplier: [], purpose: [], importers: [], modes: [],
  scNumber: "", ipNumber: "", purchaseOrder: "", productCode: "", productDescription: "",
  necessityFrom: "", necessityTo: "", necessityPeriod: "" };

const listKeys = ["demand", "requester", "group", "supplier", "purpose", "importers", "modes"] as const;
const textKeys = ["scNumber", "ipNumber", "purchaseOrder", "productCode", "productDescription"] as const;
const isoDate = /^\d{4}-\d{2}-\d{2}$/u;
const cleanList = (values: readonly string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))];
const inOrder = <Key extends string>(keys: readonly Key[], values: readonly string[]): Key[] =>
  keys.filter(key => values.includes(key));

export function parsePreShipmentFilters(params: URLSearchParams): PreShipmentFilters {
  const date = (key: string) => { const value = params.get(key) ?? ""; return isoDate.test(value) ? value : ""; };
  const priority = params.get("priority");
  const direct = params.get("direct");
  const filters: PreShipmentFilters = { ...emptyPreShipmentFilters,
    status: inOrder(preShipmentStatuses, params.getAll("status")), aging: inOrder(preShipmentAgingRanges, params.getAll("aging")),
    priority: priority === "priority" || priority === "normal" ? priority : "",
    direct: direct === "direct" || direct === "notDirect" ? direct : "",
    necessityFrom: date("necessityFrom"), necessityTo: date("necessityTo"),
    necessityPeriod: (params.get("necessityPeriod") ?? "").slice(0, 24) };
  for (const key of listKeys) filters[key] = cleanList(params.getAll(key));
  for (const key of textKeys) filters[key] = (params.get(key) ?? "").slice(0, 200);
  return filters;
}

/**
 * The filters as the API reads them, empty values left out: the body of the Excel export (a list is an array),
 * and through filterParams the query of the summary and the table.
 */
export function preShipmentFilterBody(filters: PreShipmentFilters): Record<string, string | string[]> {
  const body: Record<string, string | string[]> = {};
  const status = inOrder(preShipmentStatuses, filters.status);
  const aging = inOrder(preShipmentAgingRanges, filters.aging);
  if (status.length) body.status = status;
  if (aging.length) body.aging = aging;
  if (filters.priority) body.priority = filters.priority;
  if (filters.direct) body.direct = filters.direct;
  for (const key of listKeys) { const values = cleanList(filters[key]); if (values.length) body[key] = values; }
  for (const key of textKeys) if (filters[key].trim()) body[key] = filters[key].trim();
  if (filters.necessityFrom) body.necessityFrom = filters.necessityFrom;
  if (filters.necessityTo) body.necessityTo = filters.necessityTo;
  return body;
}

/** The query string of the filters: a list repeats its key, once for each value. */
function filterParams(filters: PreShipmentFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(preShipmentFilterBody(filters))) {
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  return params;
}

export const preShipmentSummaryQuery = (filters: PreShipmentFilters): URLSearchParams => filterParams(filters);

export function preShipmentLinesQuery(filters: PreShipmentFilters, page: number, pageSize: number): URLSearchParams {
  const params = filterParams(filters);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return params;
}

/** The URL of the screen: the filters and the relative necessity period, so a link keeps "this month". */
export function preShipmentUrlQuery(filters: PreShipmentFilters, page: number): URLSearchParams {
  const params = filterParams(filters);
  if (filters.necessityPeriod) params.set("necessityPeriod", filters.necessityPeriod);
  if (page > 1) params.set("page", String(page));
  return params;
}

/** How many filters of the form are applied (the chart selections and the necessity period count once each). */
export function preShipmentFilterCount(filters: PreShipmentFilters): number {
  const params = filterParams(filters);
  const keys = new Set(params.keys());
  if (keys.has("necessityFrom") && keys.has("necessityTo")) keys.delete("necessityTo");
  return keys.size;
}

// Built once per language: a transition formats the counts of the charts on each frame.
const productFormats = new Map<string, Intl.NumberFormat>();
/** Whole count of products in the interface language ("7.695"); fractions of a transition are rounded. */
export function formatProducts(value: number, locale: string): string {
  let format = productFormats.get(locale);
  if (!format) { format = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }); productFormats.set(locale, format); }
  return format.format(Math.round(value));
}

export type PreShipmentPart = { products: number; quantity: string };
export type PreShipmentSummary = {
  totalProducts: number; totalQuantity: string;
  byStatus: Record<PreShipmentStatus, PreShipmentPart>;
  aging: Record<PreShipmentAgingRange, PreShipmentPart>;
  agingWithoutSentDate: PreShipmentPart;
};

export type PreShipmentLine = {
  lineId: string; lineKind: "ALLOCATION" | "BALANCE"; status: PreShipmentStatus; quantity: string; unit: string | null;
  necessityDate: string | null; mode: string | null; requester: string | null; scNumber: string | null;
  purchaseOrder: { id: string; number: string }; process: { id: string; ipNumber: string } | null;
  etd: string | null; eta: string | null; ete: string | null; productCode: string; description: string;
  supplier: string | null; importer: string; purpose: string | null; poSentDate: string | null;
  priority: string | null; demand: string | null; group: string | null;
};
export type PreShipmentLinesPage = { page: number; pageSize: number; totalCount: number; lines: PreShipmentLine[] };
export type PreShipmentFilterOptions = { demands: string[]; requesters: string[]; groups: string[]; suppliers: string[];
  purposes: string[]; importers: string[]; modes: string[] };
