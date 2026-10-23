import type { Messages } from "./i18n/pt-BR";

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

export type PurchaseRequestPayloadChoice =
  | { purchaseRequestId: string }
  | { newPurchaseRequest: { scNumber: string; requester: string; scDate: string | null; approvalDate: string | null;
    commercialPlanReceivedDate: string | null } };

export function totvsPurchaseRequestPayload(options: {
  classification: TotvsPurchaseRequestClassification;
  selectedPurchaseRequestId: string;
  newRequest: { requester: string; scDate: string; approvalDate: string; commercialPlanReceivedDate: string };
}, m: Messages): { choice: PurchaseRequestPayloadChoice | null; blocker: string | null } {
  const { classification, selectedPurchaseRequestId, newRequest } = options;
  if (classification.kind === "supplier-mismatch") {
    return { choice: null, blocker: m.scRequest.supplierExists(classification.request.scNumber,
      classification.request.supplierText ?? m.scLink.supplierNotInformed) };
  }
  if (selectedPurchaseRequestId) return { choice: { purchaseRequestId: selectedPurchaseRequestId }, blocker: null };
  if (classification.kind !== "missing") return { choice: null, blocker: null };
  const requester = newRequest.requester.trim();
  if (!requester) {
    return { choice: null, blocker: m.scRequest.requesterRequired(classification.scNumber) };
  }
  return { choice: { newPurchaseRequest: { scNumber: classification.scNumber, requester,
    scDate: newRequest.scDate || null, approvalDate: newRequest.approvalDate || null,
    commercialPlanReceivedDate: newRequest.commercialPlanReceivedDate || null } }, blocker: null };
}
