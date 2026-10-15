"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { automaticAuditReason } from "../../../lib/audit";

const entities = [
  ["importer", "Importadora"], ["incoterm", "Incoterm"], ["transport_mode", "Modal"], ["port_loading", "POL / porto de origem"],
  ["port_discharge", "POD / porto de destino"], ["currency", "Moeda"], ["category", "Categoria"],
  ["product_group", "Grupo de produto"], ["group", "Group"], ["purpose", "Finalidade"], ["demand", "Demanda"],
  ["logistics_status", "Status logístico"], ["customs_channel", "Canal aduaneiro"],
  ["container_type", "Tipo de container"], ["priority", "Prioridade"],
  ["unit_of_measure", "Unidade de medida"],
  ["requester", "Solicitante"], ["cost_center", "Centro de custo"], ["broker", "Despachante"],
  ["forwarder", "Agente de carga"],
] as const;
type Option = { entity: string; value: string };

export default function OperationalValuesPage() {
  const [options, setOptions] = useState<Option[]>([]);
  const [entity, setEntity] = useState<string>(entities[0][0]);
  const [value, setValue] = useState("");
  const [jsonValues, setJsonValues] = useState<string[]>([]);
  const [jsonFileName, setJsonFileName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const [valuesResponse, identityResponse] = await Promise.all([
      apiFetch("/api/v1/operational-values", { cache: "no-store" }), apiFetch("/auth/me"),
    ]);
    const values = await valuesResponse.json() as { items?: Option[]; detail?: string };
    const identity = await identityResponse.json() as { roles?: string[] };
    if (!valuesResponse.ok || !identityResponse.ok) throw new Error(values.detail || "Não foi possível carregar os cadastros.");
    setOptions(values.items ?? []);
    setCanWrite((identity.roles ?? []).some(role => ["Master", "Administrador", "Compras"].includes(role)));
  }, []);

  useEffect(() => { void load().catch(cause => setError(cause instanceof Error ? cause.message : "Erro ao carregar.")); }, [load]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/operational-values", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ entity, value, reason: automaticAuditReason }) });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "Não foi possível adicionar o valor.");
      setValue(""); await load(); setNotice("Valor adicionado ao cadastro e disponível nos seletores.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao adicionar valor."); }
    finally { setBusy(false); }
  }

  async function selectJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setJsonValues([]); setJsonFileName(""); setError(""); setNotice("");
    if (!file) return;
    if (file.size > 750_000) { setError("O arquivo deve ter no máximo 750 KB."); return; }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const values = Array.isArray(parsed) ? parsed
        : typeof parsed === "object" && parsed !== null && "values" in parsed
          ? (parsed as { values: unknown }).values : null;
      if (!Array.isArray(values) || values.length === 0 || values.length > 500
        || values.some(item => typeof item !== "string" || !item.trim())) {
        throw new Error("Use uma lista JSON de textos ou um objeto { \"values\": [\"valor\"] }, com 1 a 500 valores não vazios.");
      }
      setJsonValues(values.map(item => (item as string).trim()));
      setJsonFileName(file.name);
    } catch (cause) {
      setError(cause instanceof SyntaxError ? "O arquivo não contém um JSON válido." :
        cause instanceof Error ? cause.message : "Não foi possível ler o arquivo.");
    }
  }

  async function importJson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/operational-values/bulk", { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entity, values: jsonValues, reason: automaticAuditReason }) });
      let result: { createdCount?: number; skippedCount?: number; detail?: string };
      if (response.status === 404) {
        let createdCount = 0;
        let skippedCount = 0;
        for (const [index, item] of jsonValues.entries()) {
          const itemResponse = await apiFetch("/api/v1/operational-values", { method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ entity, value: item, reason: automaticAuditReason }) });
          const itemResult = await itemResponse.json() as { detail?: string };
          if (itemResponse.status === 409) {
            skippedCount += 1;
            continue;
          }
          if (!itemResponse.ok) {
            throw new Error(`${itemResult.detail || "Não foi possível importar os valores."} Importação interrompida após ${index} de ${jsonValues.length} valores.`);
          }
          createdCount += 1;
        }
        result = { createdCount, skippedCount };
      } else {
        result = await response.json() as { createdCount?: number; skippedCount?: number; detail?: string };
        if (!response.ok) throw new Error(result.detail || "Não foi possível importar os valores.");
      }
      setJsonValues([]); setJsonFileName("");
      if (fileInput.current) fileInput.current.value = "";
      await load();
      setNotice(`Importação concluída: ${result.createdCount ?? 0} adicionados; ${result.skippedCount ?? 0} já existiam e foram ignorados.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao importar valores."); }
    finally { setBusy(false); }
  }

  const visible = options.filter(option => option.entity === entity).sort((a, b) => a.value.localeCompare(b.value));
  return <main className="shell">
    <header className="page-header"><p className="eyebrow">ERP Comex</p><h1>Valores das entidades</h1>
      <p>Gerencie as opções usadas nos campos do sistema.</p>
      <Link className="text-link" href="/catalog">Todos os cadastros</Link></header>
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    <section className="card entity-values-card">
      <h2>Campo e opções</h2>
      <label>Campo<select value={entity} onChange={event => setEntity(event.target.value)}>
        {entities.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <h3>Valores cadastrados · {visible.length}</h3>
      {visible.length ? <ul className="entity-value-list">{visible.map(option => <li key={`${option.entity}:${option.value}`}>{option.value}</li>)}</ul> :
        <p className="muted">Ainda não há valores cadastrados para este campo.</p>}
    </section>
    {canWrite && <section className="card entity-value-form">
      <h2>Adicionar valor à entidade</h2>
      <form className="stack-form" onSubmit={add}>
        <label>Novo valor<input required maxLength={240} value={value} onChange={event => setValue(event.target.value)} /></label>
        <button className="button" disabled={busy || !value.trim()}>{busy ? "Salvando…" : "Adicionar valor"}</button>
      </form>
    </section>}
    {canWrite && <section className="card entity-value-form">
      <h2>Importar valores por JSON</h2>
      <p className="muted">Selecione um arquivo com uma lista de textos ou com a propriedade <code>values</code>. Máximo de 500 valores por importação.</p>
      <form className="stack-form" onSubmit={importJson}>
        <label>Arquivo JSON<input ref={fileInput} type="file" accept=".json,application/json" onChange={event => void selectJson(event)} /></label>
        <button className="button" disabled={busy || jsonValues.length === 0}>{busy ? "Importando…" : `Importar ${jsonValues.length || "valores"}`}</button>
      </form>
      {jsonFileName && <p className="muted" role="status">{jsonFileName}: {jsonValues.length} valores prontos para importar na entidade selecionada.</p>}
      <details><summary>Ver exemplo de JSON</summary><pre>{`[\n  "Valor 1",\n  "Valor 2"\n]`}</pre></details>
    </section>}
  </main>;
}
