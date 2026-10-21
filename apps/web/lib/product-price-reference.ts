export type ProductPriceReference = {
  currency: string;
  unitPrice: string;
  purchaseOrderNumber: string;
  observedAt: string;
};

export function productPriceReferenceForCurrency(references: ProductPriceReference[] | undefined,
  currency: string | null | undefined): ProductPriceReference | undefined {
  if (!currency) return undefined;
  const normalized = currency.trim().toLocaleUpperCase("en-US");
  return references?.find(reference => reference.currency.trim().toLocaleUpperCase("en-US") === normalized);
}

export function estimatedProductTotal(quantity: string, reference: ProductPriceReference | undefined): string | null {
  if (!reference) return null;
  const quantityValue = Number(quantity.replace(",", "."));
  const priceValue = Number(reference.unitPrice.replace(",", "."));
  if (!Number.isFinite(quantityValue) || !Number.isFinite(priceValue) || quantityValue < 0 || priceValue <= 0) return null;
  return String(quantityValue * priceValue);
}
