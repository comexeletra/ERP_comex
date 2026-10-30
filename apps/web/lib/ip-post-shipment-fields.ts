import type { FieldLabelKey } from "./i18n/labels";
import type { Messages } from "./i18n/pt-BR";

export type IpPostShipmentField = {
  key: string;
  /** Dictionary key of the label when it differs from `key`. */
  labelKey?: FieldLabelKey;
  type?: "date" | "number" | "money" | "boolean" | "select";
  max?: number;
  entity?: string;
  /** Costs belong to the whole shipment; repeating them on each product would duplicate them. */
  ipOnly?: boolean;
};

// The API accepts exactly these keys in PATCH /processes/:id/followup.
export const ipPostShipmentFields: IpPostShipmentField[] = [
  { key: "logisticsStatus", type: "select", entity: "logistics_status" },
  { key: "priority", labelKey: "ipPriority", type: "select", entity: "priority" },
  { key: "ipTotvsDate", type: "date" },
  { key: "transportMode", type: "select", entity: "transport_mode" },
  { key: "incoterm", type: "select", entity: "incoterm" },
  { key: "broker", type: "select", entity: "broker" },
  { key: "portLoading", type: "select", entity: "port_loading" },
  { key: "portDischarge", type: "select", entity: "port_discharge" },
  { key: "etd", type: "date" },
  { key: "actualPortDepartureDate", type: "date" },
  { key: "blNumber", max: 120 },
  { key: "blDate", type: "date" },
  { key: "etaConfirmed", type: "date" },
  { key: "arrivalDate", type: "date" },
  { key: "duimpNumber", max: 100 },
  { key: "duimpDate", type: "date" },
  { key: "customsChannel", type: "select", entity: "customs_channel" },
  { key: "clearanceDate", type: "date" },
  { key: "eteConfirmed", type: "date" },
  { key: "nfRequestDate", type: "date" },
  { key: "deliveryDate", type: "date" },
  { key: "freightCurrency", type: "select", entity: "currency", ipOnly: true },
  { key: "freightCost", type: "money", ipOnly: true },
  { key: "containerNumber", max: 120 },
  { key: "containerType", type: "select", entity: "container_type" },
  { key: "containerQuantity", type: "number", ipOnly: true },
  { key: "forwarder", type: "select", entity: "forwarder" },
  { key: "documentsOkDate", type: "date" },
  { key: "storageDueOverride", type: "date" },
  { key: "taxesPaidBrl", type: "money", ipOnly: true },
  { key: "fineBrl", type: "money", ipOnly: true },
  { key: "storageBrl", type: "money", ipOnly: true },
  { key: "demurrageBrl", type: "money", ipOnly: true },
  { key: "demurrageContainerQuantity", type: "number", ipOnly: true },
];

/** IP fields repeated on each product line of the IP. */
export const productLineIpFields = ipPostShipmentFields.filter(field => !field.ipOnly);

/** BL is typed on the IP; legacy BL documents remain only as history. */
export const newProcessDocumentKinds = ["INVOICE", "NF"];

/** Status and projected dates the API calculates for the IP itself. */
export type IpCalculatedSummary = {
  status: string;
  statusSource: "calculated" | "informed";
  informedStatus: string | null;
  eta: string | null;
  etaSource: "confirmed" | "calculated" | null;
  ete: string | null;
  eteSource: "confirmed" | "calculated" | null;
  transitDays: number | null;
  storageDueDate: string | null;
};

export function calculatedStatusLabel(summary: Pick<IpCalculatedSummary, "status" | "statusSource">, m: Messages): string {
  const source = summary.statusSource === "informed" ? m.ipSummary.informedInIp : m.ipSummary.calculatedFromDates;
  const status = (m.statuses as Record<string, string>)[summary.status] ?? summary.status;
  return `${status} · ${source}`;
}

export function projectedDateLabel(value: string | null, source: IpCalculatedSummary["etaSource"], m: Messages): string {
  if (!value) return "—";
  return `${value} · ${source === "confirmed" ? m.ipSummary.confirmed : m.ipSummary.calculated}`;
}

/** Appends the date warnings returned by PATCH /processes/:id/followup to the success message. */
export function withDateWarnings(message: string, result: unknown, m: Messages): string {
  const warnings = result && typeof result === "object" && Array.isArray((result as { warnings?: unknown }).warnings)
    ? (result as { warnings: unknown[] }).warnings.filter((warning): warning is string => typeof warning === "string") : [];
  return warnings.length ? m.ipSummary.checkDates(message, warnings.join("; ")) : message;
}
