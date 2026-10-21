export type PurchaseOrderLifecycleStatus = "ACTIVE" | "CLOSED" | "CANCELLED" | "DELETED";
export type PurchaseOrderLifecycleAction = "close" | "cancel" | "delete" | "reopen";

export function purchaseOrderLifecycleActions(status: unknown, canWrite: boolean): PurchaseOrderLifecycleAction[] {
  if (!canWrite) return [];
  if (status === "ACTIVE") return ["close", "cancel", "delete"];
  if (status === "CLOSED") return ["reopen", "delete"];
  if (status === "CANCELLED") return ["delete"];
  return [];
}
