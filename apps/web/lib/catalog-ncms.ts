export function createNcmCatalogUrl(page: number, search: string): string {
  const query = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (search.trim()) query.set("search", search.trim());
  return `/api/v1/ncms?${query.toString()}`;
}

export async function readNcmRefreshStart(response: Response): Promise<"started" | "running"> {
  const body = await response.json().catch(() => null) as { status?: unknown; detail?: unknown } | null;
  if (!response.ok) {
    throw new Error(typeof body?.detail === "string" ? body.detail
      : `A atualização não pôde ser iniciada (HTTP ${response.status}). Consulte o estado da sincronização e tente novamente.`);
  }
  if (response.status !== 202 || (body?.status !== "started" && body?.status !== "running")) {
    throw new Error("A API não confirmou o início da atualização. Consulte o estado da sincronização.");
  }
  return body.status;
}

export type NcmDraft = {
  code: string;
  description: string;
  status: "ACTIVE" | "INACTIVE";
  evidence: string;
  validFrom: string;
  validTo: string;
};

export function createNcmPayload(draft: NcmDraft, reason: string) {
  return {
    code: draft.code.trim(),
    name: draft.description.trim(),
    evidence: draft.evidence.trim(),
    reason,
    validFrom: draft.validFrom || null,
  };
}

export function updateNcmPayload(draft: NcmDraft, reason: string) {
  return {
    name: draft.description.trim(),
    status: draft.status,
    evidence: draft.evidence.trim(),
    validFrom: draft.validFrom || null,
    validTo: draft.validTo || null,
    reason,
  };
}
