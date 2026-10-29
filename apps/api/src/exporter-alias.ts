// The Exporter field of a China invoice carries the supplier name followed by
// its address. A supplier keeps short aliases (its name as the exporter writes
// it), and the Exporter matches the supplier when it starts with one of them.
// The web mirror is invoiceSupplierMatchesExporter in apps/web/lib/china-invoice-mapping.ts.
export const minimumExporterAliasLength = 8;

/** Same value as normalized_alias in catalog.supplier_exporter_alias (M074). */
export function normalizeExporterText(value: string | null | undefined): string {
  return (value ?? "").replace(/[^A-Za-z0-9]/gu, "").toUpperCase();
}

export function exporterMatchesAlias(exporter: string, aliases: readonly string[]): boolean {
  const normalized = normalizeExporterText(exporter);
  return aliases.some(alias => {
    const prefix = normalizeExporterText(alias);
    return prefix.length >= minimumExporterAliasLength && normalized.startsWith(prefix);
  });
}
