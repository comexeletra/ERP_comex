import type { E2eStageCode } from "./e2e-analysis";

/**
 * Status of a product line, as calculated by the API from the dates of its IP. The balance without IP is
 * AGUARDANDO PRODUÇÃO, as in the Follow Up and the BI; the IP filter tells it apart.
 */
export const productLineStatuses = ["AGUARDANDO PRODUÇÃO", "AGUARDANDO EMBARQUE",
  "AGUARDANDO CHEGADA", "DESEMBARAÇO", "ENTREGUE", "CANCELADO"] as const;
export type ProductLineStatus = typeof productLineStatuses[number];

/** Lines with an IP (the allocations) or only the balance without IP; "" is every line. */
export const productLineIpFilters = ["with", "without"] as const;
export type ProductLineIpFilter = "" | typeof productLineIpFilters[number];
export const parseIpFilter = (value: string | null): ProductLineIpFilter =>
  (productLineIpFilters as readonly string[]).includes(value ?? "") ? value as ProductLineIpFilter : "";

/**
 * Colours of the status chart, in the order of the statuses; CANCELADO stays out of the chart. Status 1 was the
 * balance without IP, now part of AGUARDANDO PRODUÇÃO: the other statuses keep their colours.
 */
export const e2eStatusColors = ["--color-chart-status-2", "--color-chart-status-3",
  "--color-chart-status-4", "--color-chart-status-5", "--color-chart-status-6"] as const;

export const e2eStatusColor = (status: string): string | undefined =>
  e2eStatusColors[productLineStatuses.indexOf(status as ProductLineStatus)];

/**
 * The text fields match a part of the value (the Linhas de produto screen). `status` and the lists hold any
 * of the values chosen on the End to End filter form, compared exactly by the API; empty is "Todas". The API
 * gets the necessity dates; `necessityPeriod` keeps a relative period (lib/date-range.ts) in the URL, so a link
 * keeps "this month" as the current month, and is never sent to the API.
 */
export type ProductLineFilters = {
  importer: string; purchaseOrder: string; ipNumber: string; product: string;
  status: ProductLineStatus[]; etaFrom: string; etaTo: string; situation: "open" | "all"; ip: ProductLineIpFilter;
  group: string[]; purpose: string[]; importers: string[]; purchaseOrders: string[]; ipNumbers: string[]; productCodes: string[];
  necessityFrom: string; necessityTo: string; necessityPeriod: string;
};

export const emptyProductLineFilters: ProductLineFilters = { importer: "", purchaseOrder: "", ipNumber: "", product: "",
  status: [], etaFrom: "", etaTo: "", situation: "open", ip: "", group: [], purpose: [], importers: [], purchaseOrders: [],
  ipNumbers: [], productCodes: [], necessityFrom: "", necessityTo: "", necessityPeriod: "" };

const textKeys = ["importer", "purchaseOrder", "ipNumber", "product"] as const;
const listKeys = ["group", "purpose", "importers", "purchaseOrders", "ipNumbers", "productCodes"] as const;
const dateKeys = ["etaFrom", "etaTo", "necessityFrom", "necessityTo"] as const;
const isoDate = /^\d{4}-\d{2}-\d{2}$/u;

/** Values trimmed, without the empty and the repeated ones. */
const cleanList = (values: readonly string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))];
/** Valid statuses in the order of the list. */
const statusList = (values: readonly string[]) => productLineStatuses.filter(status => values.includes(status));

export function parseProductLineFilters(params: URLSearchParams): ProductLineFilters {
  const date = (key: typeof dateKeys[number]) => { const value = params.get(key) ?? ""; return isoDate.test(value) ? value : ""; };
  const list = (key: typeof listKeys[number]) => cleanList(params.getAll(key));
  return {
    importer: params.get("importer") ?? "", purchaseOrder: params.get("purchaseOrder") ?? "",
    ipNumber: params.get("ipNumber") ?? "", product: params.get("product") ?? "",
    status: statusList(params.getAll("status")),
    etaFrom: date("etaFrom"), etaTo: date("etaTo"),
    situation: params.get("situation") === "all" ? "all" : "open", ip: parseIpFilter(params.get("ip")),
    group: list("group"), purpose: list("purpose"), importers: list("importers"), purchaseOrders: list("purchaseOrders"),
    ipNumbers: list("ipNumbers"), productCodes: list("productCodes"),
    necessityFrom: date("necessityFrom"), necessityTo: date("necessityTo"),
    // Checked and resolved to dates by the screen (lib/date-range.ts parseRelativeSpec).
    necessityPeriod: (params.get("necessityPeriod") ?? "").slice(0, 24),
  };
}

/**
 * The filters with new statuses. A delivered or cancelled status among them shows every situation, as the API
 * applies it (lineSituation in shipment-lines.ts), so the form shows what the table lists.
 */
export function withProductLineStatus(filters: ProductLineFilters, status: readonly ProductLineStatus[]): ProductLineFilters {
  const closed = status.includes("ENTREGUE") || status.includes("CANCELADO");
  return { ...filters, status: statusList(status), situation: closed ? "all" : filters.situation };
}

/**
 * The End to End filters: the PO, importer, IP and product are lists there, so a text value from an older
 * link becomes one of their values instead of a filter the form does not show.
 */
export function withE2eLists(filters: ProductLineFilters): ProductLineFilters {
  const add = (list: readonly string[], text: string) => cleanList([...list, text]);
  return { ...filters, importer: "", purchaseOrder: "", ipNumber: "", product: "",
    importers: add(filters.importers, filters.importer), purchaseOrders: add(filters.purchaseOrders, filters.purchaseOrder),
    ipNumbers: add(filters.ipNumbers, filters.ipNumber), productCodes: add(filters.productCodes, filters.product) };
}

/**
 * Selection of a chart as in Power BI: a click keeps only its category (and clears it when it is the only one
 * selected); Ctrl+click (`additive`) adds or removes it.
 */
export function nextChartSelection<Key extends string>(selected: readonly Key[], key: Key, additive: boolean): Key[] {
  if (additive) return selected.includes(key) ? selected.filter(value => value !== key) : [...selected, key];
  return selected.length === 1 && selected[0] === key ? [] : [key];
}

/** End to End stages, in the order of the flow (the same codes as the API). */
export const e2eStageCodes = ["T0", "T1", "T2", "T3", "T4", "T5"] as const satisfies readonly E2eStageCode[];

/** Total End to End delay status of a line (Power BI in_time_late), in the API order. */
export const e2eDeadlineStatuses = ["onTime", "onLimit", "late", "noData"] as const;
export type E2eDeadlineStatus = typeof e2eDeadlineStatuses[number];

/** Ranges of the total End to End delay (Power BI "Faixa de atraso total"), in the API order. */
export const e2eDelayRanges = ["inAdvance", "onTime", "upTo30", "days30To45", "days45To60", "days60To90",
  "days90To120", "days120Plus", "noData"] as const;
export type E2eDelayRange = typeof e2eDelayRanges[number];

/**
 * End to End stage filter: the lines now in the stage (`current`) or those that already have its
 * actual date (`reached`); `late` keeps the late ones, as the API defines for each view.
 * `deadline` and `delayRange` are the total deadline statuses and delay ranges chosen on the overview charts
 * (none for all); `demandType` and `modal` the scenario of the toolbar ("" for all).
 */
export type E2eStageFilter = { stage: "" | E2eStageCode; view: "current" | "reached"; late: boolean;
  deadline: E2eDeadlineStatus[]; delayRange: E2eDelayRange[]; demandType: "" | "mts" | "notMts"; modal: "" | "sea" | "air" };
export const emptyE2eStageFilter: E2eStageFilter = { stage: "", view: "current", late: false, deadline: [], delayRange: [],
  demandType: "", modal: "" };

/** The valid categories of a chart among the values, in the order of the chart. */
const inChartOrder = <Key extends string>(keys: readonly Key[], values: readonly string[]): Key[] =>
  keys.filter(key => values.includes(key));

export function parseE2eStageFilter(params: URLSearchParams): E2eStageFilter {
  const stage = params.get("stage") ?? "";
  const demandType = params.get("demandType") ?? "";
  const modal = params.get("modal") ?? "";
  return {
    stage: (e2eStageCodes as readonly string[]).includes(stage) ? stage as E2eStageCode : "",
    view: params.get("view") === "reached" ? "reached" : "current", late: params.get("late") === "true",
    deadline: inChartOrder(e2eDeadlineStatuses, params.getAll("deadline")),
    delayRange: inChartOrder(e2eDelayRanges, params.getAll("delayRange")),
    demandType: demandType === "mts" || demandType === "notMts" ? demandType : "",
    modal: modal === "sea" || modal === "air" ? modal : "",
  };
}

export function e2eStageFilterBody(filter: E2eStageFilter): Record<string, string | string[]> {
  const body: Record<string, string | string[]> = {};
  if (filter.stage) body.stage = filter.stage;
  if (filter.view === "reached") body.view = filter.view;
  if (filter.late) body.late = "true";
  if (filter.deadline.length) body.deadline = inChartOrder(e2eDeadlineStatuses, filter.deadline);
  if (filter.delayRange.length) body.delayRange = inChartOrder(e2eDelayRanges, filter.delayRange);
  if (filter.demandType) body.demandType = filter.demandType;
  if (filter.modal) body.modal = filter.modal;
  return body;
}

/** Filters sent to GET /api/v1/purchase-order-lines and to the product line export; a list is an array. */
export function productLineFilterBody(filters: ProductLineFilters, stage = emptyE2eStageFilter): Record<string, string | string[]> {
  const body: Record<string, string | string[]> = { situation: filters.situation };
  for (const key of textKeys) if (filters[key].trim()) body[key] = filters[key].trim();
  if (filters.status.length) body.status = statusList(filters.status);
  if (filters.ip) body.ip = filters.ip;
  for (const key of listKeys) {
    const values = cleanList(filters[key]);
    if (values.length) body[key] = values;
  }
  for (const key of dateKeys) if (filters[key]) body[key] = filters[key];
  return { ...body, ...e2eStageFilterBody(stage) };
}

/** The query string of the filters: a list repeats its key, once for each value. */
function filterSearchParams(body: Record<string, string | string[]>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  return params;
}

/**
 * Filters counted on the collapsed End to End summary panel: those of its filter form, the necessity
 * period as one, and the chart selections. The stage and the demand type are also on the toolbar, which shows them.
 */
export function e2eOverviewFilterCount(filters: ProductLineFilters, stage: E2eStageFilter): number {
  const bothNecessityBounds = filters.necessityFrom && filters.necessityTo ? 1 : 0;
  return activeProductLineFilterCount(filters) - bothNecessityBounds + (stage.deadline.length ? 1 : 0)
    + (stage.delayRange.length ? 1 : 0);
}

/** How many applied filters change the table, shown while the filter bar is collapsed. */
export function activeProductLineFilterCount(filters: ProductLineFilters): number {
  const body = productLineFilterBody(filters);
  return Object.keys(body).length - (body.situation === "open" ? 1 : 0);
}

/**
 * Filters sent to GET /api/v1/purchase-order-lines/e2e-stages: the same as the table, without the
 * page, so the charts show the lines of the table. The API keeps the stage cards for every stage.
 */
export function e2eSummaryQuery(filters: ProductLineFilters, stage: E2eStageFilter): URLSearchParams {
  return filterSearchParams(productLineFilterBody(filters, stage));
}

export function productLineQuery(filters: ProductLineFilters, page: number, pageSize: number,
  stage = emptyE2eStageFilter): URLSearchParams {
  const query = filterSearchParams(productLineFilterBody(filters, stage));
  query.set("page", String(page));
  query.set("pageSize", String(pageSize));
  return query;
}

// Quantities have up to 8 decimals; integer units avoid floating-point drift in sums.
function units(value: string | number | null | undefined): bigint {
  const match = /^(\d+)(?:[.,](\d{1,8}))?$/u.exec(String(value ?? "").trim());
  return match ? BigInt(match[1]) * 100_000_000n + BigInt((match[2] ?? "").padEnd(8, "0")) : 0n;
}
function quantityText(value: bigint): string {
  const fraction = String(value % 100_000_000n).padStart(8, "0").replace(/0+$/u, "");
  return `${value / 100_000_000n}${fraction ? `.${fraction}` : ""}`;
}

export type ItemShipment = { quantity: string; status: string; eta: string | null };

/** Where the ordered quantity of one PO item is: per shipment status, still without IP, and the next ETA. */
export function itemShipmentSummary(orderedQuantity: string, cancelledAtSource: boolean, shipments: ItemShipment[]) {
  const byStatus = new Map<string, bigint>();
  let allocated = 0n;
  for (const shipment of shipments) {
    const quantity = units(shipment.quantity);
    allocated += quantity;
    byStatus.set(shipment.status, (byStatus.get(shipment.status) ?? 0n) + quantity);
  }
  const remaining = units(orderedQuantity) - allocated;
  const nextEta = shipments.filter(shipment => !["ENTREGUE", "CANCELADO"].includes(shipment.status) && shipment.eta)
    .map(shipment => shipment.eta as string).sort()[0] ?? null;
  return {
    withoutIp: quantityText(cancelledAtSource || remaining < 0n ? 0n : remaining),
    byStatus: productLineStatuses.filter(status => byStatus.has(status))
      .map(status => ({ status, quantity: quantityText(byStatus.get(status)!) })),
    nextEta,
  };
}
