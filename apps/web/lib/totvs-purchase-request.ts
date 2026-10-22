export type TotvsPurchaseRequestChoice = {
  id: string;
  importer: string;
  scNumber: string;
  supplierText: string | null;
};

export type TotvsPurchaseRequestClassification =
  | { kind: "none" }
  | { kind: "missing"; scNumber: string }
  | { kind: "match"; request: TotvsPurchaseRequestChoice }
  | { kind: "supplier-mismatch"; request: TotvsPurchaseRequestChoice };

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleUpperCase("en-US");
}

export function classifyTotvsPurchaseRequest(options: {
  importer: string;
  scNumber: string;
  supplierCode: string;
  purchaseRequests: readonly TotvsPurchaseRequestChoice[];
}): TotvsPurchaseRequestClassification {
  const scNumber = options.scNumber.trim();
  const normalizedScNumber = normalize(scNumber);
  if (!normalizedScNumber) return { kind: "none" };

  const request = options.purchaseRequests.find(choice => choice.importer === options.importer
    && normalize(choice.scNumber) === normalizedScNumber);
  if (!request) return { kind: "missing", scNumber };

  return normalize(request.supplierText) === normalize(options.supplierCode)
    ? { kind: "match", request }
    : { kind: "supplier-mismatch", request };
}
