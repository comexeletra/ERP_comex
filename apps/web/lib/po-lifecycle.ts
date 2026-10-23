import type { Messages } from "./i18n/pt-BR";

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
  m: Messages,
): string | null {
  if (preflight.sameImporterDuplicate) return m.poNumber.duplicate(number);
  if (preflight.sameImporterDeleted) return m.poNumber.deleted(number);
  return null;
}

export function deletedPurchaseOrderActions(canManageLifecycle: boolean, replaceSupported: boolean) {
  return { restore: canManageLifecycle, replace: canManageLifecycle && replaceSupported, needsManager: !canManageLifecycle };
}

export function purchaseOrderActorLabel(actor: string): string {
  const separator = actor.lastIndexOf("#");
  return (separator >= 0 ? actor.slice(separator + 1) : actor).trim() || actor;
}

export function replacePreviewHasChanges(preview: Record<"updated" | "added" | "removed" | "reactivated" | "productChanged",
  readonly unknown[]>): boolean {
  return [preview.updated, preview.added, preview.removed, preview.reactivated, preview.productChanged]
    .some(lines => lines.length > 0);
}
