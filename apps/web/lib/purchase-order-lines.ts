import type { E2eStageCode } from "./e2e-analysis";

/** Status of a product line, as calculated by the API from the dates of its IP. */
export const productLineStatuses = ["A DISTRIBUIR", "AGUARDANDO PRODUÇÃO", "AGUARDANDO EMBARQUE",
  "AGUARDANDO CHEGADA", "DESEMBARAÇO", "ENTREGUE", "CANCELADO"] as const;
export type ProductLineStatus = typeof productLineStatuses[number];

export type ProductLineFilters = {
  importer: string; purchaseOrder: string; ipNumber: string; product: string;
  status: "" | ProductLineStatus; etaFrom: string; etaTo: string; situation: "open" | "all";
};

export const emptyProductLineFilters: ProductLineFilters = { importer: "", purchaseOrder: "", ipNumber: "", product: "",
  status: "", etaFrom: "", etaTo: "", situation: "open" };

const textKeys = ["importer", "purchaseOrder", "ipNumber", "product"] as const;
const isoDate = /^\d{4}-\d{2}-\d{2}$/u;

export function parseProductLineFilters(params: URLSearchParams): ProductLineFilters {
  const status = params.get("status") ?? "";
  const etaFrom = params.get("etaFrom") ?? ""; const etaTo = params.get("etaTo") ?? "";
  return {
    importer: params.get("importer") ?? "", purchaseOrder: params.get("purchaseOrder") ?? "",
    ipNumber: params.get("ipNumber") ?? "", product: params.get("product") ?? "",
    status: (productLineStatuses as readonly string[]).includes(status) ? status as ProductLineStatus : "",
    etaFrom: isoDate.test(etaFrom) ? etaFrom : "", etaTo: isoDate.test(etaTo) ? etaTo : "",
    situation: params.get("situation") === "all" ? "all" : "open",
  };
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
 * `deadline` and `delayRange` are the total deadline status and delay range chosen on the overview charts.
 */
export type E2eStageFilter = { stage: "" | E2eStageCode; view: "current" | "reached"; late: boolean;
  deadline: "" | E2eDeadlineStatus; delayRange: "" | E2eDelayRange };
export const emptyE2eStageFilter: E2eStageFilter = { stage: "", view: "current", late: false, deadline: "", delayRange: "" };

export function parseE2eStageFilter(params: URLSearchParams): E2eStageFilter {
  const stage = params.get("stage") ?? "";
  const deadline = params.get("deadline") ?? "";
  const delayRange = params.get("delayRange") ?? "";
  return {
    stage: (e2eStageCodes as readonly string[]).includes(stage) ? stage as E2eStageCode : "",
    view: params.get("view") === "reached" ? "reached" : "current", late: params.get("late") === "true",
    deadline: (e2eDeadlineStatuses as readonly string[]).includes(deadline) ? deadline as E2eDeadlineStatus : "",
    delayRange: (e2eDelayRanges as readonly string[]).includes(delayRange) ? delayRange as E2eDelayRange : "",
  };
}

export function e2eStageFilterBody(filter: E2eStageFilter): Record<string, string> {
  const body: Record<string, string> = {};
  if (filter.stage) body.stage = filter.stage;
  if (filter.view === "reached") body.view = filter.view;
  if (filter.late) body.late = "true";
  if (filter.deadline) body.deadline = filter.deadline;
  if (filter.delayRange) body.delayRange = filter.delayRange;
  return body;
}

/** Filters sent to GET /api/v1/purchase-order-lines and to the product line export. */
export function productLineFilterBody(filters: ProductLineFilters, stage = emptyE2eStageFilter): Record<string, string> {
  const body: Record<string, string> = { situation: filters.situation };
  for (const key of textKeys) if (filters[key].trim()) body[key] = filters[key].trim();
  if (filters.status) body.status = filters.status;
  if (filters.etaFrom) body.etaFrom = filters.etaFrom;
  if (filters.etaTo) body.etaTo = filters.etaTo;
  return { ...body, ...e2eStageFilterBody(stage) };
}

/** How many applied filters change the table, shown while the filter bar is collapsed. */
export function activeProductLineFilterCount(filters: ProductLineFilters): number {
  const body = productLineFilterBody(filters);
  return Object.keys(body).length - (body.situation === "open" ? 1 : 0);
}

/**
 * Filters sent to GET /api/v1/purchase-order-lines/e2e-stages: the line filters and the deadline and
 * delay range chosen on the overview. The stage, the view and the late toggle filter only the table.
 */
export function e2eSummaryQuery(filters: ProductLineFilters, deadline: E2eStageFilter["deadline"],
  delayRange: E2eStageFilter["delayRange"] = ""): URLSearchParams {
  const query = new URLSearchParams(productLineFilterBody(filters));
  if (deadline) query.set("deadline", deadline);
  if (delayRange) query.set("delayRange", delayRange);
  return query;
}

export function productLineQuery(filters: ProductLineFilters, page: number, pageSize: number,
  stage = emptyE2eStageFilter): URLSearchParams {
  const query = new URLSearchParams(productLineFilterBody(filters, stage));
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

/** Where the ordered quantity of one PO item is: per shipment status, still to distribute, and the next ETA. */
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
    toDistribute: quantityText(cancelledAtSource || remaining < 0n ? 0n : remaining),
    byStatus: productLineStatuses.filter(status => byStatus.has(status))
      .map(status => ({ status, quantity: quantityText(byStatus.get(status)!) })),
    nextEta,
  };
}
