// Units that name the same measure on invoices and POs, for every supplier and
// product. Kept already normalized; the web mirror in
// apps/web/lib/china-invoice-mapping.ts must list the same groups.
export const equivalentUnitGroups: readonly (readonly string[])[] = [
  ["UN", "UND", "UNID", "UNIDADE", "PC", "PCS", "PCE", "PECA", "PECAS", "UNIT", "UNITS", "EA"],
  ["KG", "KGS"],
  ["M", "MT", "MTS"],
];

/** Upper case without accents, dots or spaces, so "Pç." and "PC" compare equal. */
export function normalizeUnit(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/gu, "").toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/gu, "");
}

export function unitsDiffer(left: string, right: string): boolean {
  const a = normalizeUnit(left), b = normalizeUnit(right);
  if (a === b) return false;
  return !equivalentUnitGroups.some(group => group.includes(a) && group.includes(b));
}
