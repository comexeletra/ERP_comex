"use client";

import { apiFetch } from "../lib/api";

export type OperationalOption = { entity: string; value: string };

export function OperationalOptionSelect({ entity, value, values, onChange, required = false }:
  { entity: string; value: string; values: OperationalOption[]; onChange: (value: string) => void; required?: boolean }) {
  const options = values.filter(option => option.entity === entity);
  const hasCurrent = !value || options.some(option => option.value === value);
  return <select required={required} value={value} onChange={event => onChange(event.target.value)}>
    <option value="">Selecione</option>
    {!hasCurrent && <option value={value}>{value} (valor atual)</option>}
    {options.map(option => <option key={`${option.entity}:${option.value}`} value={option.value}>{option.value}</option>)}
  </select>;
}

export async function loadOperationalOptions(): Promise<OperationalOption[]> {
  const response = await apiFetch("/api/v1/operational-values");
  if (!response.ok) throw new Error("NÃ£o foi possÃ­vel carregar as opÃ§Ãµes dos campos.");
  return (await response.json() as { items: OperationalOption[] }).items;
}

export type CatalogChoice = { code: string; name: string; status?: string };
export async function loadCatalogChoices(kind: "products" | "suppliers", importer: string): Promise<CatalogChoice[]> {
  const query = new URLSearchParams({ importer });
  const response = await apiFetch(`/api/v1/${kind}/options?${query}`);
  if (!response.ok) throw new Error("NÃ£o foi possÃ­vel carregar o catÃ¡logo de produtos/fornecedores.");
  const result = await response.json() as { items: CatalogChoice[] };
  return result.items.filter(item => item.status === "ACTIVE" || item.status === "HISTORICAL_CANDIDATE");
}
