export const ICMS_STATES = ["CE", "AM", "PR"] as const;
export type IcmsState = typeof ICMS_STATES[number];
/** Window event sent after the ICMS panel saves, so the simulator on the same page reloads the importer states. */
export const ICMS_RATES_CHANGED = "icms-rates-changed";

export type EstimateLine = { base: string; rate: string | null; amount: string };
export type ImportEstimate = {
  ncm: string; uf: IcmsState; referenceDate: string; status: "complete" | "incomplete"; missing: string[];
  customsValue: string; expenses: { siscomexFee: string; afrmm: string; otherExpenses: string };
  ii: EstimateLine | null; ipi: (EstimateLine & { notTaxed: boolean }) | null; pis: EstimateLine | null; cofins: EstimateLine | null;
  icms: { sum: string; fullBase: string; baseReduction: string | null; taxableBase: string; rate: string; fcpRate: string;
    amount: string; deferral: string | null; deferred: string; due: string } | null;
  federalTotal: string | null; total: string | null; warnings: string[];
  iiSource: string | null; iiAct: string | null; pisCofinsLegalBasis: string | null; icmsLegalBasis: string | null;
  baseReductionLegalBasis: string | null; deferralLegalBasis: string | null;
};

/** Accepts "1.234,56", "1234,56" or "1234.56"; returns the API text with up to 2 decimals, or null. */
export function normalizeMoneyInput(value: string, decimals = 2): string | null {
  let text = value.trim().replace(/\s/gu, "");
  if (!text) return null;
  if (text.includes(",")) text = text.replace(/\./gu, "").replace(",", ".");
  const pattern = new RegExp(`^\\d{1,13}(?:\\.\\d{1,${decimals}})?$`, "u");
  if (!pattern.test(text)) return null;
  const [integer, fraction = ""] = text.split(".");
  return fraction ? `${BigInt(integer)}.${fraction}` : String(BigInt(integer));
}

/** Customs value in reais from FOB, freight and insurance in the foreign currency, rounded half up to cents. */
export function customsValueFromForeign(fob: string, freight: string, insurance: string, exchangeRate: string): string | null {
  const parts = [fob, freight || "0", insurance || "0"].map(value => normalizeMoneyInput(value));
  const rate = normalizeMoneyInput(exchangeRate, 6);
  if (parts.some(part => part === null) || rate === null) return null;
  const scaled = (value: string, places: number) => {
    const [integer, fraction = ""] = value.split(".");
    return BigInt(integer) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, "0") || "0");
  };
  const foreign = parts.reduce((sum, part) => sum + scaled(part!, 2), 0n);
  const product = foreign * scaled(rate, 6); // cents × 10^6
  const cents = (product * 2n + 1_000_000n) / 2_000_000n;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

export function createEstimateUrl(code: string, input: { uf: IcmsState; date: string; customsValue: string;
  siscomexFee: string; afrmm: string; otherExpenses: string }): string {
  const query = new URLSearchParams({ uf: input.uf, customsValue: input.customsValue,
    siscomexFee: input.siscomexFee || "0", afrmm: input.afrmm || "0", otherExpenses: input.otherExpenses || "0" });
  if (input.date) query.set("date", input.date);
  return `/api/v1/ncm-rates/${code}/estimate?${query.toString()}`;
}

export function formatMoney(value: string | null, locale: string): string {
  if (value === null || !/^\d+(?:\.\d+)?$/u.test(value)) return "—";
  return new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" }).format(Number(value));
}

/** State suggested for an importer; the user may still choose another one. */
export function stateForImporter(importer: string, importers: Array<{ importer: string; uf: string | null }>): IcmsState | null {
  const found = importers.find(item => item.importer === importer)?.uf;
  return found && (ICMS_STATES as readonly string[]).includes(found) ? found as IcmsState : null;
}
