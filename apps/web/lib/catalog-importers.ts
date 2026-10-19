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
