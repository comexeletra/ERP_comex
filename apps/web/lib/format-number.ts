const numberFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** A change in percent with its sign (−16,09%, +33,33%); below 0,01% it reads "< 0,01%". */
export function formatPercentChange(value: number): string {
  if (Math.abs(value) < 0.01) return `< ${numberFormatter.format(0.01)}%`;
  return `${value < 0 ? "−" : "+"}${numberFormatter.format(Math.abs(value))}%`;
}

export function formatNumber(value: unknown, fallback = "—"): string {
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value ? "Sim" : "Não";

  const original = String(value).trim();
  if (!original) return fallback;
  const normalized = original.includes(",")
    ? original.includes(".")
      ? original.lastIndexOf(",") > original.lastIndexOf(".")
        ? original.replace(/\./gu, "").replace(",", ".")
        : original.replace(/,/gu, "")
      : original.replace(",", ".")
    : original;
  const number = Number(normalized);
  return Number.isFinite(number) ? numberFormatter.format(number) : original;
}
