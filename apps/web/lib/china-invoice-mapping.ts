export type InvoicePoItemCandidate = { id: string; productCode: string; remainingQuantity: string };
export type InvoiceDestinationIssue = { kind: "PO_NOT_REGISTERED" } | { kind: "ITEM_NOT_FOUND" }
  | { kind: "INSUFFICIENT_BALANCE"; requested: string; available: string };

export function classifyInvoiceDestination(candidates: readonly InvoicePoItemCandidate[], poExists: boolean,
  invoiceProductCode: string, quantity: string, selectedItemId: string): InvoiceDestinationIssue | null {
  if (!poExists) return { kind: "PO_NOT_REGISTERED" };
  const exact = candidates.filter(item => !invoicePoCodeDiffers(item.productCode, invoiceProductCode));
  const selected = candidates.find(item => item.id === selectedItemId);
  if (selected && Number(selected.remainingQuantity) >= Number(quantity)) return null;
  if (selected) return { kind: "INSUFFICIENT_BALANCE", requested: quantity, available: selected.remainingQuantity };
  if (!exact.length) return { kind: "ITEM_NOT_FOUND" };
  const available = Math.max(...exact.map(item => Number(item.remainingQuantity)));
  if (available < Number(quantity)) return { kind: "INSUFFICIENT_BALANCE", requested: quantity, available: String(available) };
  return null;
}
export type InvoicePoAssignmentSource = {
  sourceRow: number;
  productCode: string;
  description: string;
  poAssignments: readonly { poNumber: string; quantity: string }[];
};

export function invoiceAssignmentsFromLines(lines: readonly InvoicePoAssignmentSource[]) {
  return lines.flatMap(line => line.poAssignments.map((assignment, index) => ({
    key: `${line.sourceRow}:${index}`, sourceRow: line.sourceRow, sourcePoNumber: assignment.poNumber,
    poNumber: assignment.poNumber, quantity: assignment.quantity, productCode: line.productCode,
    description: line.description,
  })));
}

export function suggestInvoicePoItem<T extends InvoicePoItemCandidate>(
  candidates: readonly T[], invoiceProductCode: string, invoiceQuantity: string,
): T | undefined {
  const enough = candidates.filter(candidate => Number(candidate.remainingQuantity) >= Number(invoiceQuantity));
  const exact = enough.filter(candidate => candidate.productCode.trim().toLocaleUpperCase("en-US")
    === invoiceProductCode.trim().toLocaleUpperCase("en-US"));
  if (exact.length === 1) return exact[0];
  return undefined;
}

export function invoicePoCodeDiffers(invoiceProductCode: string, poProductCode: string): boolean {
  return invoiceProductCode.trim().toLocaleUpperCase("en-US")
    !== poProductCode.trim().toLocaleUpperCase("en-US");
}

export function invoicePoUnitDiffers(invoiceUnit: string, poUnit: string): boolean {
  return invoiceUnit.trim().toLocaleUpperCase("en-US") !== poUnit.trim().toLocaleUpperCase("en-US");
}

export function invoicePoPriceDiffers(invoicePrice: string, poPrice: string | null, poCurrency: string | null): boolean {
  return poCurrency === "CNY" && poPrice !== null && Number.isFinite(Number(invoicePrice))
    && Number.isFinite(Number(poPrice)) && Math.abs(Number(invoicePrice) - Number(poPrice)) > 0.00000001;
}

export function invoiceSupplierMatchesExporter(
  supplierValues: readonly (string | null | undefined)[], exporter: string,
): boolean {
  const normalize = (value: string) => value.toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/gu, "");
  const normalizedExporter = normalize(exporter);
  return supplierValues.some(value => Boolean(value && normalize(value) === normalizedExporter));
}
