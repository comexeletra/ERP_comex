"use client";

import { apiFetch, readApiJson } from "../lib/api";
export { purchaseRequestOperationalFields } from "../lib/purchase-request-fields";

export type PurchaseRequestChoice = {
  id: string;
  importer: string;
  scNumber: string;
  scDate: string | null;
  commercialPlanReceivedDate: string | null;
  requester: string;
  approvalDate: string | null;
  version: string;
  purchaseOrderCount?: number;
};

export async function loadPurchaseRequests(importer: string, signal?: AbortSignal): Promise<PurchaseRequestChoice[]> {
  const query = new URLSearchParams();
  if (importer) query.set("importer", importer);
  const suffix = query.size ? `?${query}` : "";
  const response = await apiFetch(`/api/v1/purchase-requests${suffix}`, { signal, cache: "no-store" });
  const result = await readApiJson<{ items: PurchaseRequestChoice[] }>(response);
  return result.items;
}

export function PurchaseRequestSelect({ importer, value, choices, onChange, disabled = false }:
  { importer: string; value: string; choices: PurchaseRequestChoice[]; onChange: (value: string) => void; disabled?: boolean }) {
  const showImporter = !importer || choices.some(choice => choice.importer !== importer);
  return <div className="pcm-sc-selector">
    <label>SC vinculada<select disabled={disabled} value={value} onChange={event => onChange(event.target.value)}>
      <option value="">Sem SC vinculada</option>
      {choices.map(choice => <option key={choice.id} value={choice.id}>
        {showImporter ? `${choice.importer} · ` : ""}{choice.scNumber} · {choice.requester}
      </option>)}
    </select></label>
    {choices.length === 0 && importer ?
      <p className="muted">Nenhuma SC cadastrada para esta importadora. O PCM pode cadastrá-la na seção PCM.</p> : null}
  </div>;
}
