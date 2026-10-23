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

/** Filters sent to GET /api/v1/purchase-order-lines and to the product line export. */
export function productLineFilterBody(filters: ProductLineFilters): Record<string, string> {
  const body: Record<string, string> = { situation: filters.situation };
  for (const key of textKeys) if (filters[key].trim()) body[key] = filters[key].trim();
  if (filters.status) body.status = filters.status;
  if (filters.etaFrom) body.etaFrom = filters.etaFrom;
  if (filters.etaTo) body.etaTo = filters.etaTo;
  return body;
}

export function productLineQuery(filters: ProductLineFilters, page: number, pageSize: number): URLSearchParams {
  const query = new URLSearchParams(productLineFilterBody(filters));
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
