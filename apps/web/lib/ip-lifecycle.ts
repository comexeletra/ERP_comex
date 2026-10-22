export type ProcessRecordStatus = "DRAFT" | "ACTIVE" | "CANCELLED" | "DELETED";
export type ProcessLifecycleStatus = "OPEN" | "CLOSED";
export type ProcessLifecycleAction = "close" | "cancel" | "delete" | "reopen" | "reactivate" | "restore";
export type ProcessDirectoryRecordStatus = "" | "active" | "draft" | "cancelled" | "deleted" | "all";
export type ProcessDirectoryFilters = {
  ipNumber: string;
  importer: string;
  logisticsStatus: string;
  qualityStatus: string;
  recordStatus: ProcessDirectoryRecordStatus;
};

export const emptyProcessDirectoryFilters: ProcessDirectoryFilters = {
  ipNumber: "", importer: "", logisticsStatus: "", qualityStatus: "", recordStatus: "",
};

const processDirectoryRecordStatuses = new Set<ProcessDirectoryRecordStatus>([
  "", "active", "draft", "cancelled", "deleted", "all",
]);

export function parseProcessDirectoryFilters(params: URLSearchParams): ProcessDirectoryFilters {
  const selectedStatus = params.get("recordStatus") ?? "";
  return {
    ipNumber: params.get("ipNumber") ?? "",
    importer: params.get("importer") ?? "",
    logisticsStatus: params.get("logisticsStatus") ?? "",
    qualityStatus: params.get("qualityStatus") ?? "",
    recordStatus: processDirectoryRecordStatuses.has(selectedStatus as ProcessDirectoryRecordStatus)
      ? selectedStatus as ProcessDirectoryRecordStatus : "",
  };
}

export function processDirectoryQuery(filters: ProcessDirectoryFilters, page: number): URLSearchParams {
  const params = new URLSearchParams({ page: String(page), pageSize: "50" });
  for (const key of Object.keys(emptyProcessDirectoryFilters) as (keyof ProcessDirectoryFilters)[]) {
    const value = filters[key].trim();
    if (value) params.set(key, value);
  }
  return params;
}

export function processLifecycleActions(
  recordStatus: unknown,
  lifecycleStatus: unknown,
  canWrite: boolean,
  canManageLifecycle: boolean,
): ProcessLifecycleAction[] {
  if (recordStatus === "DELETED") return canManageLifecycle ? ["restore"] : [];
  if (recordStatus === "CANCELLED" && lifecycleStatus === "OPEN") {
    return [...(canManageLifecycle ? ["reactivate" as const] : []), ...(canWrite ? ["delete" as const] : [])];
  }
  if (!canWrite) return [];
  if (recordStatus === "ACTIVE" && lifecycleStatus === "OPEN") return ["close", "cancel", "delete"];
  if (recordStatus === "ACTIVE" && lifecycleStatus === "CLOSED") return ["reopen"];
  if (recordStatus === "DRAFT" && lifecycleStatus === "OPEN") return ["cancel", "delete"];
  return [];
}

export function deletedIpInvoiceBlockMessage(recordStatus: unknown): string | null {
  return recordStatus === "DELETED"
    ? "Este IP foi excluído. Peça a restauração para um Master ou Administrador antes de revisar a invoice."
    : null;
}
