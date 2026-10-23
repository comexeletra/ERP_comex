"use client";

import { apiFetch, readApiJson } from "../lib/api";
import { useI18n } from "./I18nProvider";
import { SearchableSelect } from "./SearchableSelect";
export { purchaseRequestOperationalFields } from "../lib/purchase-request-fields";

export type PurchaseRequestChoice = {
  id: string;
  importer: string;
  scNumber: string;
  supplierEntryId?: string | null;
  supplierText: string | null;
  supplierName?: string | null;
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
  const { m } = useI18n();
  const t = m.purchaseRequestSelect;
  return <div className="pcm-sc-selector">
    <label>SC<SearchableSelect ariaLabel="SC" disabled={disabled} value={value} placeholder={t.none}
      searchPlaceholder={t.search} onChange={onChange}
      options={choices.map(choice => ({ value: choice.id, label: choice.scNumber,
        searchText: [choice.supplierText, choice.supplierName, choice.scDate, choice.requester].filter(Boolean).join(" ") }))} /></label>
    {choices.length === 0 && importer ?
      <p className="muted">{t.empty}</p> : null}
  </div>;
}
