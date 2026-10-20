export type SearchableOption = {
  value: string;
  label: string;
  searchText?: string;
  disabled?: boolean;
};

export function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
}

export function filterSearchableOptions<T extends SearchableOption>(options: T[], query: string): T[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return options;
  return options.filter(option => normalizeSearchText(`${option.label} ${option.value} ${option.searchText ?? ""}`)
    .includes(normalizedQuery));
}
