export type ProcessRecordStatus = "DRAFT" | "ACTIVE" | "CANCELLED" | "DELETED";
export type ProcessLifecycleStatus = "OPEN" | "CLOSED";
export type ProcessLifecycleAction = "close" | "cancel" | "delete" | "reopen" | "reactivate" | "restore";
export type ProcessDirectoryRecordStatus = "" | "active" | "draft" | "cancelled" | "deleted" | "all";
/** Statuses the API calculates for an IP from its dates. */
export const processCalculatedStatuses = ["AGUARDANDO PRODUÇÃO", "AGUARDANDO EMBARQUE", "AGUARDANDO CHEGADA",
  "DESEMBARAÇO", "ENTREGUE", "CANCELADO"] as const;
export type ProcessDirectoryFilters = {
  ipNumber: string;
  importer: string;
  status: "" | typeof processCalculatedStatuses[number];
  qualityStatus: string;
  recordStatus: ProcessDirectoryRecordStatus;
};

export const emptyProcessDirectoryFilters: ProcessDirectoryFilters = {
  ipNumber: "", importer: "", status: "", qualityStatus: "", recordStatus: "",
};

const processDirectoryRecordStatuses = new Set<ProcessDirectoryRecordStatus>([
  "", "active", "draft", "cancelled", "deleted", "all",
]);

export function parseProcessDirectoryFilters(params: URLSearchParams): ProcessDirectoryFilters {
  const selectedStatus = params.get("recordStatus") ?? "";
  const calculatedStatus = params.get("status") ?? "";
  return {
    ipNumber: params.get("ipNumber") ?? "",
    importer: params.get("importer") ?? "",
    status: (processCalculatedStatuses as readonly string[]).includes(calculatedStatus)
      ? calculatedStatus as ProcessDirectoryFilters["status"] : "",
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
