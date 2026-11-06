/**
 * Filters, categories and formats of the post-shipment dashboard (the BI "Pós Embarque" metrics, one line per IP),
 * sent to GET /api/v1/reports/post-shipment/summary and /lines. The API test checks that these lists match its own.
 */

/** Status of the IP from its own dates, in the order of the flow. */
export const postShipmentStatuses = ["AGUARDANDO PRODUÇÃO", "AGUARDANDO EMBARQUE", "AGUARDANDO CHEGADA",
  "DESEMBARAÇO", "ENTREGUE", "CANCELADO"] as const;
export type PostShipmentStatus = typeof postShipmentStatuses[number];

/** The colours of the same statuses in the End to End and pre-shipment charts, grey for the cancelled IPs. */
export const postShipmentStatusColors: Record<PostShipmentStatus, string> = {
  "AGUARDANDO PRODUÇÃO": "--color-chart-status-2", "AGUARDANDO EMBARQUE": "--color-chart-status-3",
  "AGUARDANDO CHEGADA": "--color-chart-status-4", DESEMBARAÇO: "--color-chart-status-5", ENTREGUE: "--color-chart-status-6",
  CANCELADO: "--color-chart-no-data",
};

/** Customs channel of the IP; `other` is a value outside the known ones and `none` an empty channel. */
export const postShipmentChannels = ["green", "yellow", "red", "gray", "other", "none"] as const;
export type PostShipmentChannel = typeof postShipmentChannels[number];
export const postShipmentChannelColors: Record<PostShipmentChannel, string> = {
  green: "--color-chart-on-time", yellow: "--color-chart-on-limit", red: "--color-chart-late",
  gray: "--color-chart-no-data", other: "--color-chart-status-1", none: "--color-chart-status-3",
};
/** Channels shown even without IPs; gray and other only appear when an IP has them. */
export const postShipmentFixedChannels: readonly PostShipmentChannel[] = ["green", "yellow", "red", "none"];

export const postShipmentPriorities = ["priority", "normal"] as const;
export type PostShipmentPriority = typeof postShipmentPriorities[number];
export const postShipmentPriorityColors: Record<PostShipmentPriority, string> = {
  priority: "--color-chart-late", normal: "--color-chart-status-6",
};

export const postShipmentClearanceTypes = ["onWater", "normal"] as const;
export type PostShipmentClearanceType = typeof postShipmentClearanceTypes[number];

/**
 * Lists hold any of the values chosen (none is "Todos"); `status`, `channel`, `priority` and `clearance` are also
 * the chart selections. The date is the reference date (delivery, or today without it); `datePeriod` keeps a
 * relative period in the URL and is not sent.
 */
export type PostShipmentFilters = {
  status: PostShipmentStatus[]; channel: PostShipmentChannel[]; priority: PostShipmentPriority[];
  clearance: PostShipmentClearanceType[]; importers: string[]; modes: string[]; ipNumber: string;
  dateFrom: string; dateTo: string; datePeriod: string;
};

export const emptyPostShipmentFilters: PostShipmentFilters = { status: [], channel: [], priority: [], clearance: [],
  importers: [], modes: [], ipNumber: "", dateFrom: "", dateTo: "", datePeriod: "" };

const listKeys = ["importers", "modes"] as const;
const isoDate = /^\d{4}-\d{2}-\d{2}$/u;
const cleanList = (values: readonly string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))];
const inOrder = <Key extends string>(keys: readonly Key[], values: readonly string[]): Key[] =>
  keys.filter(key => values.includes(key));

export function parsePostShipmentFilters(params: URLSearchParams): PostShipmentFilters {
  const date = (key: string) => { const value = params.get(key) ?? ""; return isoDate.test(value) ? value : ""; };
  const filters: PostShipmentFilters = { ...emptyPostShipmentFilters,
    status: inOrder(postShipmentStatuses, params.getAll("status")), channel: inOrder(postShipmentChannels, params.getAll("channel")),
    priority: inOrder(postShipmentPriorities, params.getAll("priority")),
    clearance: inOrder(postShipmentClearanceTypes, params.getAll("clearance")),
    ipNumber: (params.get("ipNumber") ?? "").slice(0, 80),
    dateFrom: date("dateFrom"), dateTo: date("dateTo"), datePeriod: (params.get("datePeriod") ?? "").slice(0, 24) };
  for (const key of listKeys) filters[key] = cleanList(params.getAll(key));
  return filters;
}

/**
 * The filters as the API reads them, empty values left out: the body of the Excel export (a list is an array),
 * and through filterParams the query of the summary and the table.
 */
export function postShipmentFilterBody(filters: PostShipmentFilters): Record<string, string | string[]> {
  const body: Record<string, string | string[]> = {};
  const lists: [string, string[]][] = [["status", inOrder(postShipmentStatuses, filters.status)],
    ["channel", inOrder(postShipmentChannels, filters.channel)], ["priority", inOrder(postShipmentPriorities, filters.priority)],
    ["clearance", inOrder(postShipmentClearanceTypes, filters.clearance)],
    ...listKeys.map(key => [key, cleanList(filters[key])] as [string, string[]])];
  for (const [key, values] of lists) if (values.length) body[key] = values;
  if (filters.ipNumber.trim()) body.ipNumber = filters.ipNumber.trim();
  if (filters.dateFrom) body.dateFrom = filters.dateFrom;
  if (filters.dateTo) body.dateTo = filters.dateTo;
  return body;
}

/** The query string of the filters: a list repeats its key, once for each value. */
function filterParams(filters: PostShipmentFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(postShipmentFilterBody(filters))) {
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  return params;
}

export const postShipmentSummaryQuery = (filters: PostShipmentFilters): URLSearchParams => filterParams(filters);

export function postShipmentLinesQuery(filters: PostShipmentFilters, page: number, pageSize: number): URLSearchParams {
  const params = filterParams(filters);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return params;
}

/** The URL of the screen: the filters and the relative period, so a link keeps "this month". */
export function postShipmentUrlQuery(filters: PostShipmentFilters, page: number): URLSearchParams {
  const params = filterParams(filters);
  if (filters.datePeriod) params.set("datePeriod", filters.datePeriod);
  if (page > 1) params.set("page", String(page));
  return params;
}

/** How many filters of the form are applied (the period counts once). */
export function postShipmentFilterCount(filters: PostShipmentFilters): number {
  const keys = new Set(filterParams(filters).keys());
  if (keys.has("dateFrom") && keys.has("dateTo")) keys.delete("dateTo");
  return keys.size;
}

/** Targets of the BI, the same the API returns in the summary: LT Clearance up to 7 days and SLA TXT up to 20 are green. */
export const postShipmentLeadTimeTarget = 7;
export const postShipmentSlaTxtTarget = 20;

export type PostShipmentTone = "good" | "bad";
/** Green up to the target, red above it (LT DOC average and LT Clearance); null without a value. */
export const atMostTone = (value: number | null, target: number): PostShipmentTone | null =>
  value === null ? null : value <= target ? "good" : "bad";
/** Green from the target up (DSA ≥ 70%). */
export const atLeastTone = (value: number | null, target: number): PostShipmentTone | null =>
  value === null ? null : value >= target ? "good" : "bad";
/** A month change: a fall of the lead time is good, a rise is bad. */
export const changeTone = (value: number | null): PostShipmentTone | null =>
  value === null || value === 0 ? null : value < 0 ? "good" : "bad";

// Built once per language: a transition formats the numbers of the cards on each frame.
const formats = new Map<string, { whole: Intl.NumberFormat; average: Intl.NumberFormat; percent: Intl.NumberFormat;
  change: Intl.NumberFormat; containers: Intl.NumberFormat }>();
function formatsOf(locale: string) {
  let found = formats.get(locale);
  if (!found) {
    found = { whole: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
      average: new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      percent: new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      change: new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2,
        signDisplay: "exceptZero" }),
      containers: new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) };
    formats.set(locale, found);
  }
  return found;
}
const dash = "—";
/** Whole count of IPs ("222"); fractions of a transition are rounded. */
export const formatIps = (value: number, locale: string) => formatsOf(locale).whole.format(Math.round(value));
/** Average of days with two decimals, as the BI cards ("17,53"). */
export const formatAverageDays = (value: number | null, locale: string) =>
  value === null ? dash : formatsOf(locale).average.format(value);
/** Whole days of a monthly bar ("27"). */
export const formatWholeDays = (value: number | null, locale: string) =>
  value === null ? dash : formatsOf(locale).whole.format(Math.round(value));
/** Share with two decimals, as the BI DSA ("17,57%"). */
export const formatShareOf = (value: number | null, locale: string) =>
  value === null ? dash : formatsOf(locale).percent.format(value);
/** Month change with its sign ("−17,89%"). */
export const formatChange = (value: number | null, locale: string) =>
  value === null ? "" : formatsOf(locale).change.format(value);
/** Containers with two decimals ("229,50"); a split container counts 0.5 in each IP. */
export const formatContainers = (value: string | number | null, locale: string) =>
  value === null || value === "" ? dash : formatsOf(locale).containers.format(Number(value));

/** Short month and year of a monthly bar, in the interface language ("jan./2026"). */
export function formatMonth(month: string, locale: string): string {
  const [year, value] = month.split("-").map(Number);
  const name = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, value - 1, 1)));
  return `${name}/${year}`;
}

/**
 * Heights, from the bottom of a monthly chart, of the labels of its dashed lines (average and target): each label is
 * centred on its line and, when two lines are closer than `gap`, both move apart by the same amount (moving up
 * together near the bottom), so the labels never overlap. Made for the two lines of a chart; returns the input order.
 */
export function lineLabelHeights(lines: readonly number[], gap: number): number[] {
  const order = lines.map((_, index) => index).sort((a, b) => lines[a] - lines[b]);
  const heights = [...lines];
  order.forEach((index, rank) => {
    if (rank > 0) heights[index] = Math.max(lines[index], heights[order[rank - 1]] + gap);
  });
  const moved = order.reduce((total, index) => total + heights[index] - lines[index], 0) / Math.max(1, order.length);
  const lowest = Math.min(0, ...order.map(index => heights[index] - moved));
  return heights.map(height => height - moved - lowest);
}

export type PostShipmentMonth = {
  month: string; ips: number; onWater: number; dsa: number | null;
  leadTimeRealTime: number | null; leadTimeDelivered: number | null;
  leadTimeRealTimeChange: number | null; leadTimeDeliveredChange: number | null;
};
export type PostShipmentSummary = {
  totalIps: number; containers: string; onWater: number; dsa: number | null; avgLtDoc: number | null;
  avgSlaTxt: number | null; byStatus: Record<PostShipmentStatus, number>; byChannel: Record<PostShipmentChannel, number>;
  byPriority: Record<PostShipmentPriority, number>; months: PostShipmentMonth[];
  monthlyAverages: { dsa: number | null; leadTimeRealTime: number | null; leadTimeDelivered: number | null };
  targets: { dsa: number; avgLtDoc: number; leadTime: number; slaTxt: number };
};
export type PostShipmentLine = {
  id: string; ipNumber: string; importer: string | null; necessityDate: string | null; priority: string | null;
  priorityKey: PostShipmentPriority; incoterm: string | null; mode: string | null; status: PostShipmentStatus;
  duimpDate: string | null; documentsOkDate: string | null; arrivalDate: string | null;
  ltDoc: number | null; ltDocTarget: number | null; ltDocOnTarget: boolean | null;
  etd: string | null; eta: string | null; ete: string | null; deliveryDate: string | null; containerQuantity: string | null;
  leadTime: number | null; clearanceType: PostShipmentClearanceType; txtDate: string | null; slaTxt: number | null;
  channel: string | null; channelKey: PostShipmentChannel; referenceDate: string;
};
export type PostShipmentLinesPage = { page: number; pageSize: number; totalCount: number; lines: PostShipmentLine[] };
export type PostShipmentFilterOptions = { modes: string[]; importers: string[] };
