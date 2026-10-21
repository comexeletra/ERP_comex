export const purchaseOrderLifecycleFilters = ["active", "cancelled", "closed", "deleted", "all"] as const;
export type PurchaseOrderLifecycleFilter = "" | typeof purchaseOrderLifecycleFilters[number];

export type PortfolioFilters = {
  number: string;
  importer: string;
  product: string;
  ipNumber: string;
  lifecycle: PurchaseOrderLifecycleFilter;
};

export function matchesPurchaseOrderNumber(number: string, search: string): boolean {
  const query = search.trim().toUpperCase();
  return query.length > 0 && number.toUpperCase().includes(query);
}

const filterKeys = ["number", "importer", "product", "ipNumber"] as const satisfies readonly (keyof PortfolioFilters)[];

export function portfolioFilterQuery(filters: Readonly<PortfolioFilters>): URLSearchParams {
  const query = new URLSearchParams();
  for (const key of filterKeys) {
    const value = filters[key].trim();
    if (value) query.set(key, value);
  }
  return query;
}

export function purchaseOrderListQuery(
  filters: Readonly<PortfolioFilters>,
  page: number,
  pageSize: number,
): URLSearchParams {
  const query = portfolioFilterQuery(filters);
  if (filters.lifecycle) query.set("lifecycle", filters.lifecycle);
  query.set("page", String(page));
  query.set("pageSize", String(pageSize));
  return query;
}
