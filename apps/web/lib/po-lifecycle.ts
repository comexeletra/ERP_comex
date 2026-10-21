export type PurchaseOrderLifecycleStatus = "ACTIVE" | "CLOSED" | "CANCELLED" | "DELETED";
export type PurchaseOrderLifecycleAction = "close" | "cancel" | "delete" | "reopen" | "reactivate" | "restore";

export function purchaseOrderLifecycleActions(
  status: unknown,
  canWrite: boolean,
  canManageLifecycle = false,
): PurchaseOrderLifecycleAction[] {
  if (!canWrite) return [];
  if (status === "ACTIVE") return ["close", "cancel", "delete"];
  if (status === "CLOSED") return ["reopen", "delete"];
  if (status === "CANCELLED") return canManageLifecycle ? ["reactivate", "delete"] : ["delete"];
  if (status === "DELETED") return canManageLifecycle ? ["restore"] : [];
  return [];
}

export function purchaseOrderNumberBlockMessage(
  preflight: { sameImporterDuplicate: boolean; sameImporterDeleted?: boolean },
  number: string,
): string | null {
  if (preflight.sameImporterDuplicate) return `Já existe uma PO ${number} nesta importadora.`;
  if (preflight.sameImporterDeleted) {
    return `A PO ${number} desta importadora foi excluída. Restaure-a pela carteira (filtro Excluídas) em vez de criar outra com o mesmo número.`;
  }
  return null;
}
