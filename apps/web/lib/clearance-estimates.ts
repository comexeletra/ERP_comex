/**
 * Filters and lines of the clearance estimates section of the post-shipment dashboard (the BI "Import Clearance
 * Estimations"), sent to GET /api/v1/reports/post-shipment/clearance-estimates. The API test checks that these lists
 * match its own.
 */

/** Status of the IP from its own dates, in the order of the flow (the same as the post-shipment dashboard). */
export const clearanceStatuses = ["AGUARDANDO PRODUÇÃO", "AGUARDANDO EMBARQUE", "AGUARDANDO CHEGADA",
  "DESEMBARAÇO", "ENTREGUE", "CANCELADO"] as const;
export type ClearanceStatus = typeof clearanceStatuses[number];
/** The BI period: the next week by the reference date (Monday to Sunday), or every IP of the section. */
export const clearancePeriods = ["nextWeek", "all"] as const;
export type ClearancePeriod = typeof clearancePeriods[number];
/** Registered: the IP has a DUIMP. */
export const clearanceRegistered = ["yes", "no"] as const;
export type ClearanceRegistered = typeof clearanceRegistered[number];

/** Lists hold any of the values chosen (none is "Todos"). */
export type ClearanceFilters = {
  ipNumber: string; analysts: string[]; importers: string[]; status: ClearanceStatus[]; suppliers: string[];
  registered: ClearanceRegistered[]; period: ClearancePeriod;
};

export const emptyClearanceFilters: ClearanceFilters = { ipNumber: "", analysts: [], importers: [], status: [],
  suppliers: [], registered: [], period: "all" };

/** Where the reference date came from: the DUIMP of a registered IP, or the ETA at the port before it. */
export type ClearanceReferenceSource = "duimp" | "eta";

export type ClearanceEstimateLine = {
  id: string; ipNumber: string; referenceDate: string | null; referenceSource: ClearanceReferenceSource | null;
  analysts: string[]; importer: string | null; status: ClearanceStatus; supplier: string | null; eta: string | null;
  registered: boolean; valueBrl: string | null;
};

export type ClearanceEstimates = {
  lines: ClearanceEstimateLine[]; totalBrl: string; nextWeek: { from: string; to: string };
  options: { analysts: string[]; importers: string[]; suppliers: string[] };
};

/** Query of the route; "all" and empty lists are the defaults and are not sent. */
export function clearanceEstimatesQueryParams(filters: ClearanceFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.ipNumber.trim()) params.set("ipNumber", filters.ipNumber.trim());
  for (const key of ["analysts", "importers", "status", "suppliers", "registered"] as const) {
    for (const value of filters[key]) if (value.trim()) params.append(key, value);
  }
  if (filters.period !== "all") params.set("period", filters.period);
  return params;
}

const moneyFormats = new Map<string, Intl.NumberFormat>();
/** Money in reais with two decimals ("R$ 834.389,97"); an empty value is a dash. */
export function formatBrl(value: string | null, locale: string): string {
  if (value === null || value === "") return "—";
  let format = moneyFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale, { style: "currency", currency: "BRL", minimumFractionDigits: 2,
      maximumFractionDigits: 2 });
    moneyFormats.set(locale, format);
  }
  return format.format(Number(value));
}
