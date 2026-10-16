const numberFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

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
