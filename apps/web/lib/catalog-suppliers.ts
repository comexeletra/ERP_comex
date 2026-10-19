export function createSupplierCatalogUrl(page: number, search: string): string {
  const query = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (search.trim()) query.set("search", search.trim());
  return `/api/v1/suppliers?${query}`;
}
