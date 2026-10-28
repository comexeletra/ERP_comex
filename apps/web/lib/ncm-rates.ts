import type { Messages } from "./i18n/pt-BR";

export type IiSource = "TEC" | "ANEXO_II" | "ANEXO_III" | "ANEXO_IV" | "ANEXO_V" | "ANEXO_VI" | "ANEXO_VIII"
  | "ANEXO_IX" | "ANEXO_X" | null;
export type IiCondition = "applied" | "conflict" | "ex" | "quota" | "sector" | "future";
export type IiRate = { tec: string | null; tecMarker: "BK" | "BIT" | null; brazil: string | null;
  brazilBasis: string | null; applied: string | null; appliedSource: IiSource; appliedAct: string | null;
  status: "ok" | "needs_review" | "missing" };
export type IiException = { annex: string; ncm: string; exNumber: string | null; rate: string | null; quota: string | null;
  validFrom: string | null; validTo: string | null; act: string | null; description: string | null; condition: IiCondition };
export type IpiRow = { code: string; exNumber: string | null; description: string; rate: string | null; notTaxed: boolean };
export type PisCofinsRate = { pis: string | null; cofins: string | null; legalBasis: string | null;
  source: "GENERAL" | "EXCEPTION" | "MISSING"; reviewed: boolean; exceptionId: string | null };
export type PisCofinsException = { id: string; code: string; pisRate: string; cofinsRate: string; legalBasis: string;
  validFrom: string; validTo: string | null; version: string };
export type RateSourceVersion = { id: string; sourceReference: string; sourceUrl: string; sourceUpdatedAt: string | null;
  fetchedAt: string; checkedAt: string; itemCount: number };
export type NcmRateListItem = { code: string; name: string; validFrom: string; validTo: string | null;
  ii: IiRate & { conditionalCount: number };
  ipi: { rate: string | null; notTaxed: boolean; status: "ok" | "missing"; exCount: number };
  pisCofins: PisCofinsRate };
export type NcmRateList = { referenceDate: string; page: number; pageSize: number; total: number;
  sources: Array<{ source: "GECEX_272" | "TIPI"; version: RateSourceVersion | null }>; items: NcmRateListItem[] };
export type NcmRateDetail = { code: string; name: string; validFrom: string; validTo: string | null; referenceDate: string;
  ii: IiRate & { exceptions: IiException[] };
  ipi: { rate: string | null; notTaxed: boolean; status: "ok" | "missing"; exceptions: IpiRow[] };
  pisCofins: PisCofinsRate; pisCofinsExceptions: PisCofinsException[];
  sources: NcmRateList["sources"] };

export const NCM_RATES_PAGE_SIZE = 50;

export function createNcmRatesUrl(filters: { search: string; chapter: string; date: string; page: number }): string {
  const query = new URLSearchParams({ page: String(filters.page), pageSize: String(NCM_RATES_PAGE_SIZE) });
  if (filters.search.trim()) query.set("q", filters.search.trim());
  if (/^\d{2}$/u.test(filters.chapter)) query.set("chapter", filters.chapter);
  if (filters.date) query.set("date", filters.date);
  return `/api/v1/ncm-rates?${query.toString()}`;
}

export function formatNcmCode(code: string): string {
  return /^\d{8}$/u.test(code) ? `${code.slice(0, 4)}.${code.slice(4, 6)}.${code.slice(6)}` : code;
}

/** Percentages arrive as decimal text from the API; only the display uses the locale. */
export function formatRate(value: string | null, locale: string): string {
  if (value === null || !/^\d+(?:\.\d+)?$/u.test(value)) return "—";
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(Number(value))}%`;
}

export function describeIpi(ipi: { rate: string | null; notTaxed: boolean; status: string }, m: Messages, locale: string): string {
  if (ipi.notTaxed) return m.ncmRates.notTaxed;
  return ipi.status === "missing" ? m.ncmRates.missing : formatRate(ipi.rate, locale);
}

export function describeIiSource(source: IiSource, m: Messages): string {
  if (source === "TEC") return m.ncmRates.sourceTec;
  if (source === "ANEXO_II") return m.ncmRates.sourceAnnexII;
  return source ? m.ncmRates.sourceAnnex(source.replace("ANEXO_", "")) : m.ncmRates.missing;
}

/** Accepts "3,52" or "3.52"; returns the API text or null when the value is not a percentage from 0 to 100. */
export function normalizeRateInput(value: string): string | null {
  const text = value.trim().replace(",", ".");
  if (!/^\d{1,3}(?:\.\d{1,4})?$/u.test(text) || Number(text) > 100) return null;
  return String(Number(text));
}

export type PisCofinsDraft = { pisRate: string; cofinsRate: string; legalBasis: string; validFrom: string; validTo: string };

export function pisCofinsPayload(draft: PisCofinsDraft, reason: string) {
  const pisRate = normalizeRateInput(draft.pisRate), cofinsRate = normalizeRateInput(draft.cofinsRate);
  if (pisRate === null || cofinsRate === null || draft.legalBasis.trim().length < 3 || !draft.validFrom
    || (draft.validTo && draft.validTo < draft.validFrom)) return null;
  return { pisRate, cofinsRate, legalBasis: draft.legalBasis.trim(), validFrom: draft.validFrom,
    validTo: draft.validTo || null, reason };
}

export async function readNcmRateRefreshStart(response: Response, m: Messages): Promise<"started" | "running"> {
  const body = await response.json().catch(() => null) as { status?: unknown; detail?: unknown } | null;
  if (!response.ok) {
    throw new Error(typeof body?.detail === "string" ? body.detail : m.ncmRates.refreshNotStarted(response.status));
  }
  if (response.status !== 202 || (body?.status !== "started" && body?.status !== "running")) {
    throw new Error(m.ncmRates.refreshNotConfirmed);
  }
  return body.status;
}
