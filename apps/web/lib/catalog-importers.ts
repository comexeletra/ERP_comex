export type ImporterCatalogSearchItem = {
  code?: string | null;
  value: string;
  importCons?: string | null;
  cnpj?: string | null;
  shortName?: string | null;
};

export function filterImporterCatalog<T extends ImporterCatalogSearchItem>(items: readonly T[], search: string): T[] {
  const term = search.trim().toLocaleLowerCase("pt-BR");
  if (!term) return [...items];
  return items.filter(item => [item.code, item.value, item.importCons, item.cnpj, item.shortName]
    .some(value => value?.toLocaleLowerCase("pt-BR").includes(term)));
}

export function sortImporterCatalog<T extends ImporterCatalogSearchItem>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => {
    const leftCode = left.code?.trim() || null;
    const rightCode = right.code?.trim() || null;

    if (leftCode && !rightCode) return -1;
    if (!leftCode && rightCode) return 1;
    if (leftCode && rightCode) {
      const codeOrder = leftCode.localeCompare(rightCode, "pt-BR", { numeric: true, sensitivity: "base" });
      if (codeOrder !== 0) return codeOrder;
    }

    return left.value.localeCompare(right.value, "pt-BR", { sensitivity: "base" });
  });
}
