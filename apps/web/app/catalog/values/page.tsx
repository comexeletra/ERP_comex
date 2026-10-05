"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";

const entities = [
  ["importer", "Importadora"], ["incoterm", "Incoterm"], ["transport_mode", "Modal"], ["port_loading", "POL / porto de origem"],
  ["port_discharge", "POD / porto de destino"], ["currency", "Moeda"], ["category", "Categoria"],
  ["product_group", "Grupo de produto"], ["purpose", "Finalidade"], ["demand", "Demanda"],
  ["logistics_status", "Status logístico"], ["customs_channel", "Canal aduaneiro"],
  ["container_type", "Tipo de container"],
] as const;
type Option = { entity: string; value: string };

export default function OperationalValuesPage() {
  const [options, setOptions] = useState<Option[]>([]);
  const [entity, setEntity] = useState<string>(entities[0][0]);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const [valuesResponse, identityResponse] = await Promise.all([apiFetch("/api/v1/operational-values"), apiFetch("/auth/me")]);
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
        headers: { "content-type": "application/json" }, body: JSON.stringify({ entity, value, reason }) });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "Não foi possível adicionar o valor.");
      setValue(""); setReason(""); await load(); setNotice("Valor adicionado ao cadastro e disponível nos seletores.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao adicionar valor."); }
    finally { setBusy(false); }
  }

  const visible = options.filter(option => option.entity === entity).sort((a, b) => a.value.localeCompare(b.value));
  return <main className="shell">
    <header className="page-header"><p className="eyebrow">ERP Comex</p><h1>Valores das entidades</h1>
      <p>Cadastre aqui opções de Incoterm, portos, moedas, categorias e demais entidades. Os formulários usam estes valores em seletores, sem permitir texto livre.</p>
      <Link className="text-link" href="/catalog">← Cadastros de fornecedores e produtos</Link></header>
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    <section className="card">
      <h2>Entidade</h2>
      <label>Campo<select value={entity} onChange={event => setEntity(event.target.value)}>
        {entities.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      {entity === "importer" && <p className="muted">Após cadastrar uma nova importadora, atribua o escopo aos usuários em Administração antes de liberar o cadastro de POs e IPs.</p>}
      <h3>Valores cadastrados ({visible.length})</h3>
      {visible.length ? <ul className="entity-value-list">{visible.map(option => <li key={`${option.entity}:${option.value}`}>{option.value}</li>)}</ul> :
        <p className="muted">Ainda não há valores cadastrados para este campo.</p>}
    </section>
    {canWrite && <section className="card">
      <h2>Adicionar valor à entidade</h2>
      <form className="stack-form" onSubmit={add}>
        <label>Novo valor<input required maxLength={240} value={value} onChange={event => setValue(event.target.value)} /></label>
        <label>Justificativa<input required minLength={8} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <button className="button" disabled={busy || !value.trim() || reason.trim().length < 8}>{busy ? "Salvando…" : "Adicionar valor"}</button>
      </form>
    </section>}
  </main>;
}
