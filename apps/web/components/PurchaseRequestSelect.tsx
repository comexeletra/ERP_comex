"use client";

import { apiFetch, readApiJson } from "../lib/api";

export type PurchaseRequestChoice = {
  id: string;
  importer: string;
  scNumber: string;
  commercialPlanReceivedDate: string | null;
  requester: string;
  approvalDate: string | null;
  purchaseOrderCount?: number;
};

export async function loadPurchaseRequests(importer: string, signal?: AbortSignal): Promise<PurchaseRequestChoice[]> {
  if (!importer) return [];
  const query = new URLSearchParams({ importer });
  const response = await apiFetch(`/api/v1/purchase-requests?${query}`, { signal, cache: "no-store" });
  const result = await readApiJson<{ items: PurchaseRequestChoice[] }>(response);
  return result.items;
}

export function PurchaseRequestSelect({ importer, value, choices, onChange, disabled = false }:
  { importer: string; value: string; choices: PurchaseRequestChoice[]; onChange: (value: string) => void; disabled?: boolean }) {
  const selected = choices.find(choice => choice.id === value);
  return <div className="pcm-sc-selector">
    <label>SC vinculada<select disabled={disabled || !importer} value={value} onChange={event => onChange(event.target.value)}>
      <option value="">Sem SC vinculada</option>
      {choices.map(choice => <option key={choice.id} value={choice.id}>
        {choice.scNumber} · {choice.requester}
      </option>)}
    </select></label>
    {selected ? <p className="muted" aria-live="polite">
      Plano recebido: {selected.commercialPlanReceivedDate ?? "não informado"} ·
      Solicitante: {selected.requester} · Aprovação: {selected.approvalDate ?? "pendente"}
    </p> : choices.length === 0 && importer ?
      <p className="muted">Nenhuma SC cadastrada para esta importadora. O PCM pode cadastrá-la na seção PCM.</p> : null}
  </div>;
}
