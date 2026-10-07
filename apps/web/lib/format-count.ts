export function formatCount(value: unknown): string {
  if (typeof value !== "number" && typeof value !== "string") return "—";
  if (typeof value === "string" && !value.trim()) return "—";
  const count = Number(value);
  return Number.isFinite(count) ? count.toLocaleString("pt-BR") : "—";
}
