// Import tax estimate for one NCM and one customs value. Money is kept in
// integer cents and percentages in units of 0.0001%, so no binary floating
// point reaches the result. Every tax is rounded to cents, half up.
const MONEY = /^\d{1,13}(?:\.\d{1,2})?$/u;
const RATE = /^\d{1,3}(?:\.\d{1,4})?$/u;
const WHOLE = 1_000_000n; // 100% in rate units

function cents(value: string, label: string): bigint {
  if (!MONEY.test(value)) throw new Error(`Informe um valor válido para ${label}.`);
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * 100n + BigInt(fraction.padEnd(2, "0"));
}
function units(value: string, label: string): bigint {
  if (!RATE.test(value) || Number(value) > 100) throw new Error(`Alíquota inválida para ${label}.`);
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * 10_000n + BigInt(fraction.padEnd(4, "0"));
}
function divide(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (2n * denominator);
}
function applyRate(amount: bigint, rate: bigint): bigint { return divide(amount * rate, WHOLE); }
function money(value: bigint): string { return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`; }
function percent(value: bigint): string { return String(Number(value) / 10_000); }

export type ImportEstimateInput = {
  customsValue: string; siscomexFee: string; afrmm: string; otherExpenses: string;
  ii: { rate: string | null; status: "ok" | "needs_review" | "missing" };
  ipi: { rate: string | null; notTaxed: boolean; status: "ok" | "missing" };
  pisCofins: { pis: string | null; cofins: string | null };
  /** Null when the state has no rate in force on the date. */
  icms: { rate: string; fcpRate: string; includeSiscomexFee: boolean; includeAfrmm: boolean;
    includeOtherExpenses: boolean } | null;
  benefits: { baseReduction: { percent: string; legalBasis: string } | null;
    deferral: { percent: string; legalBasis: string } | null };
};

export function estimateImportTaxes(input: ImportEstimateInput) {
  const value = cents(input.customsValue, "o valor aduaneiro");
  const expenses = { siscomexFee: cents(input.siscomexFee, "a Taxa Siscomex"), afrmm: cents(input.afrmm, "o AFRMM"),
    otherExpenses: cents(input.otherExpenses, "outras despesas") };
  if (input.icms && units(input.icms.rate, "ICMS") + units(input.icms.fcpRate, "FCP do ICMS") >= WHOLE) {
    throw new Error("Alíquota de ICMS e FCP deve ser menor que 100%.");
  }
  const missing: string[] = [];
  const iiRate = input.ii.status === "ok" && input.ii.rate !== null ? units(input.ii.rate, "II") : null;
  if (iiRate === null) missing.push("II");
  const ipiKnown = input.ipi.status === "ok" && (input.ipi.notTaxed || input.ipi.rate !== null);
  if (!ipiKnown) missing.push("IPI");
  const pisRate = input.pisCofins.pis === null ? null : units(input.pisCofins.pis, "PIS");
  const cofinsRate = input.pisCofins.cofins === null ? null : units(input.pisCofins.cofins, "COFINS");
  if (pisRate === null || cofinsRate === null) missing.push("PIS/COFINS");
  if (!input.icms) missing.push("ICMS");

  const ii = iiRate === null ? null : applyRate(value, iiRate);
  const ipiRate = ipiKnown && !input.ipi.notTaxed ? units(input.ipi.rate!, "IPI") : 0n;
  const ipi = ii === null || !ipiKnown ? null : applyRate(value + ii, ipiRate);
  const pis = pisRate === null ? null : applyRate(value, pisRate);
  const cofins = cofinsRate === null ? null : applyRate(value, cofinsRate);

  let icms = null;
  if (input.icms && ii !== null && ipi !== null && pis !== null && cofins !== null) {
    const sum = value + ii + ipi + pis + cofins + (input.icms.includeSiscomexFee ? expenses.siscomexFee : 0n)
      + (input.icms.includeAfrmm ? expenses.afrmm : 0n) + (input.icms.includeOtherExpenses ? expenses.otherExpenses : 0n);
    const rate = units(input.icms.rate, "ICMS") + units(input.icms.fcpRate, "FCP do ICMS");
    const fullBase = divide(sum * WHOLE, WHOLE - rate);
    const reduction = input.benefits.baseReduction ? units(input.benefits.baseReduction.percent, "redução de base") : null;
    const taxableBase = reduction === null ? fullBase : applyRate(fullBase, WHOLE - reduction);
    const amount = applyRate(taxableBase, rate);
    const deferral = input.benefits.deferral ? units(input.benefits.deferral.percent, "diferimento") : null;
    const deferred = deferral === null ? 0n : applyRate(amount, deferral);
    icms = { sum: money(sum), fullBase: money(fullBase), baseReduction: reduction === null ? null : percent(reduction),
      taxableBase: money(taxableBase), rate: input.icms.rate, fcpRate: input.icms.fcpRate, amount: money(amount),
      deferral: deferral === null ? null : percent(deferral), deferred: money(deferred), due: money(amount - deferred),
      dueCents: amount - deferred };
  }
  const federal = ii !== null && ipi !== null && pis !== null && cofins !== null ? ii + ipi + pis + cofins : null;
  const { dueCents, ...icmsResult } = icms ?? { dueCents: null };
  return {
    status: missing.length ? "incomplete" as const : "complete" as const, missing,
    customsValue: money(value),
    expenses: { siscomexFee: money(expenses.siscomexFee), afrmm: money(expenses.afrmm), otherExpenses: money(expenses.otherExpenses) },
    ii: ii === null ? null : { base: money(value), rate: input.ii.rate!, amount: money(ii) },
    ipi: ipi === null || ii === null ? null : { base: money(value + ii), rate: input.ipi.notTaxed ? null : input.ipi.rate,
      amount: money(ipi), notTaxed: input.ipi.notTaxed },
    pis: pis === null ? null : { base: money(value), rate: input.pisCofins.pis!, amount: money(pis) },
    cofins: cofins === null ? null : { base: money(value), rate: input.pisCofins.cofins!, amount: money(cofins) },
    icms: icms ? icmsResult : null,
    federalTotal: federal === null ? null : money(federal),
    total: federal === null || dueCents === null ? null : money(federal + dueCents),
  };
}
