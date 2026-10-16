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
  ["unit_of_measure", "Unidade de medida"], ["product", "Produto"], ["ncm", "NCM"],
  ["requester", "Solicitante"], ["cost_center", "Centro de custo"], ["broker", "Despachante"],
  ["forwarder", "Agente de carga"], ["supplier", "Fornecedor"],
] as const;
type Option = { id: string; entity: string; value: string };
type Supplier = { id: string; code: string; name: string; status: string };

export default function OperationalValuesPage() {
  const [options, setOptions] = useState<Option[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [suppliersLoading, setSuppliersLoading] = useState(false);
  const [supplierDraft, setSupplierDraft] = useState({ code: "", name: "", evidence: "" });
  const [entity, setEntity] = useState<string>(entities[0][0]);
  const [value, setValue] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editValue, setEditValue] = useState("");
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

  useEffect(() => {
    if (entity !== "supplier") { setSuppliers([]); return; }
    const controller = new AbortController();
    setSuppliersLoading(true);
    const query = new URLSearchParams({ page: "1", pageSize: "100" });
    apiFetch(`/api/v1/suppliers?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json() as { items?: Supplier[]; detail?: string };
        if (!response.ok) throw new Error(data.detail || "Não foi possível carregar os fornecedores.");
        if (!controller.signal.aborted) setSuppliers(data.items ?? []);
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Erro ao carregar fornecedores."); })
      .finally(() => { if (!controller.signal.aborted) setSuppliersLoading(false); });
    return () => controller.abort();
  }, [entity]);

  async function addSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/suppliers", { method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ code: supplierDraft.code,
          name: supplierDraft.name, evidence: supplierDraft.evidence, reason: automaticAuditReason }) });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "Não foi possível cadastrar o fornecedor.");
      setSupplierDraft({ code: "", name: "", evidence: "" });
      const query = new URLSearchParams({ page: "1", pageSize: "100" });
      const listResponse = await apiFetch(`/api/v1/suppliers?${query}`, { cache: "no-store" });
      const list = await listResponse.json() as { items?: Supplier[]; detail?: string };
      if (!listResponse.ok) throw new Error(list.detail || "Fornecedor salvo, mas não foi possível atualizar a lista.");
      setSuppliers(list.items ?? []);
      setNotice("Fornecedor cadastrado e disponível para associação às POs e aos IPs.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao cadastrar fornecedor."); }
    finally { setBusy(false); }
  }

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

  function startEditing(option: Option) {
    setEditingId(option.id);
    setEditValue(option.value);
    setError("");
    setNotice("");
  }

  function cancelEditing() {
    setEditingId("");
    setEditValue("");
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>, option: Option) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch(`/api/v1/operational-values/${option.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedValue: option.value, value: editValue, reason: automaticAuditReason }),
      });
      const result = await response.json() as { detail?: string; value?: string; unchanged?: boolean };
      if (!response.ok) throw new Error(result.detail || "Não foi possível editar o valor.");
      cancelEditing();
      await load();
      setNotice(result.unchanged ? "O valor não foi alterado." : "Valor atualizado nos seletores.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao editar valor."); }
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
  if (entity === "supplier") return <main className="shell">
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
      <p className="muted">Fornecedores são entidades globais, compartilhadas entre importadoras. O mesmo cadastro é usado nas POs e nos IPs.</p>
      <h3>Fornecedores cadastrados · {suppliers.length}</h3>
      {suppliersLoading ? <p role="status">Carregando fornecedores…</p> : suppliers.length ? <ul className="entity-value-list">
        {suppliers.map(supplier => <li key={supplier.id}><span>{supplier.code} · {supplier.name}</span><span className="muted">{supplier.status === "ACTIVE" ? "Ativo" : "Inativo"}</span></li>)}
      </ul> : <p className="muted">Ainda não há fornecedores cadastrados para esta importadora.</p>}
      {canWrite && <form className="stack-form" onSubmit={event => void addSupplier(event)}>
        <h3>Adicionar fornecedor</h3>
        <label>Código do fornecedor<input required maxLength={120} value={supplierDraft.code} onChange={event => setSupplierDraft(current => ({ ...current, code: event.target.value }))} /></label>
        <label>Nome do fornecedor<input required maxLength={240} value={supplierDraft.name} onChange={event => setSupplierDraft(current => ({ ...current, name: event.target.value }))} /></label>
        <label>Evidência da revisão<textarea required minLength={8} maxLength={2000} value={supplierDraft.evidence} onChange={event => setSupplierDraft(current => ({ ...current, evidence: event.target.value }))} placeholder="Documento, número, data e onde conferir" /></label>
        <button className="button" disabled={busy}>{busy ? "Salvando…" : "Adicionar fornecedor"}</button>
      </form>}
      <Link className="button secondary" href="/catalog">Gerenciar e editar fornecedores</Link>
    </section>
  </main>;
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
      {visible.length ? <ul className="entity-value-list">{visible.map(option => <li key={option.id}>
        {editingId === option.id ? <form className="entity-value-edit" onSubmit={event => void saveEdit(event, option)}>
          <label className="sr-only" htmlFor={`operational-value-${option.id}`}>Valor atualizado</label>
          <input id={`operational-value-${option.id}`} required maxLength={240} value={editValue}
            onChange={event => setEditValue(event.target.value)} />
          <button className="button entity-value-action" disabled={busy || !editValue.trim()}>
            {busy ? "Salvando…" : "Salvar"}
          </button>
          <button className="button secondary entity-value-action" type="button" disabled={busy} onClick={cancelEditing}>Cancelar</button>
        </form> : <>
          <span>{option.value}</span>
          <button className="button secondary entity-value-action" type="button" disabled={busy}
            aria-label={`Editar ${option.value}`} onClick={() => startEditing(option)}>Editar</button>
        </>}
      </li>)}</ul> :
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
        <label>Arquivo JSON<input className="file-upload-input" ref={fileInput} type="file" accept=".json,application/json" onChange={event => void selectJson(event)} /></label>
        <button className="button" disabled={busy || jsonValues.length === 0}>{busy ? "Importando…" : `Importar ${jsonValues.length || "valores"}`}</button>
      </form>
      {jsonFileName && <p className="muted" role="status">{jsonFileName}: {jsonValues.length} valores prontos para importar na entidade selecionada.</p>}
      <details><summary>Ver exemplo de JSON</summary><pre>{`[\n  "Valor 1",\n  "Valor 2"\n]`}</pre></details>
    </section>}
  </main>;
}
