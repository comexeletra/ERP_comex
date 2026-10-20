export type InvoicePoItemCandidate = { id: string; productCode: string; remainingQuantity: string };
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
  return exact.length === 0 && enough.length === 1 ? enough[0] : undefined;
}

export function invoicePoCodeDiffers(invoiceProductCode: string, poProductCode: string): boolean {
  return invoiceProductCode.trim().toLocaleUpperCase("en-US")
    !== poProductCode.trim().toLocaleUpperCase("en-US");
}

export function invoiceSupplierMatchesExporter(
  supplierValues: readonly (string | null | undefined)[], exporter: string,
): boolean {
  const normalize = (value: string) => value.toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/gu, "");
  const normalizedExporter = normalize(exporter);
  return supplierValues.some(value => Boolean(value && normalize(value) === normalizedExporter));
}
