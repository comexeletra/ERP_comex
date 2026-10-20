"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch, readApiJson } from "../../lib/api";
import { automaticAuditReason } from "../../lib/audit";
import { PurchaseRequestChoice } from "../../components/PurchaseRequestSelect";
import { CatalogChoice, loadCatalogChoices, loadOperationalOptions, OperationalOption, OperationalOptionSelect } from "../../components/OperationalOptionSelect";
import { SearchableSelect } from "../../components/SearchableSelect";

type Importer = { code: string };
type PurchaseRequestHistory = {
  id: string;
  operation: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  actor: string;
  occurredAt: string;
  reason: string;
};

const historyFields = [
  ["supplierText", "Fornecedor"],
  ["importer", "Importadora"], ["scNumber", "Número da SC"], ["scDate", "Data da SC"],
  ["requester", "Solicitante"], ["commercialPlanReceivedDate", "Recebimento do plano comercial"],
  ["approvalDate", "Data de aprovação"],
] as const;

function historyChanges(event: PurchaseRequestHistory) {
  if (!event.oldValue) return ["SC cadastrada."];
  return historyFields.flatMap(([key, label]) => {
    const before = event.oldValue?.[key] ?? "—";
    const after = event.newValue?.[key] ?? "—";
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [`${label}: ${String(before)} → ${String(after)}`];
  });
}

function formatHistoryActor(actor: string) {
  const separator = actor.lastIndexOf("#");
  return (separator >= 0 ? actor.slice(separator + 1) : actor).trim() || actor;
}

export default function PcmPage() {
  const [roles, setRoles] = useState<string[]>([]);
  const [importers, setImporters] = useState<Importer[]>([]);
  const [importer, setImporter] = useState("");
  const [importerFilter, setImporterFilter] = useState("");
  const [items, setItems] = useState<PurchaseRequestChoice[]>([]);
  const [purchaseRequestsLoading, setPurchaseRequestsLoading] = useState(true);
  const [options, setOptions] = useState<OperationalOption[]>([]);
  const [suppliers, setSuppliers] = useState<CatalogChoice[]>([]);
  const [supplierText, setSupplierText] = useState("");
  const [scNumber, setScNumber] = useState("");
  const [scDate, setScDate] = useState("");
  const [requester, setRequester] = useState("");
  const [commercialPlanReceivedDate, setCommercialPlanReceivedDate] = useState("");
  const [approvalDate, setApprovalDate] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingVersion, setEditingVersion] = useState("");
  const [editReason, setEditReason] = useState("");
  const [historyId, setHistoryId] = useState("");
  const [historyItems, setHistoryItems] = useState<PurchaseRequestHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canManage = roles.some(role => ["Master", "Administrador", "PCM"].includes(role));

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiFetch("/auth/me", { signal: controller.signal }),
      apiFetch("/api/v1/importers", { signal: controller.signal, cache: "no-store" }),
      loadOperationalOptions(),
    ]).then(async ([identityResponse, importersResponse, optionValues]) => {
      const identity = await readApiJson<{ roles: string[] }>(identityResponse);
      const result = await readApiJson<{ items: Importer[] }>(importersResponse);
      if (controller.signal.aborted) return;
      setRoles(identity.roles);
      setImporters(result.items);
      setOptions(optionValues);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível carregar os dados do PCM.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setPurchaseRequestsLoading(true);
    const query = importerFilter ? `?importer=${encodeURIComponent(importerFilter)}` : "";
    apiFetch(`/api/v1/purchase-requests${query}`, { signal: controller.signal, cache: "no-store" })
      .then(response => readApiJson<{ items: PurchaseRequestChoice[] }>(response))
      .then(result => { if (!controller.signal.aborted) setItems(result.items); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível consultar as SCs."); })
      .finally(() => { if (!controller.signal.aborted) setPurchaseRequestsLoading(false); });
    return () => controller.abort();
  }, [importerFilter]);

  useEffect(() => {
    const controller = new AbortController();
    setSuppliers([]);
    if (importer) loadCatalogChoices("suppliers", importer).then(values => {
      if (!controller.signal.aborted) setSuppliers(values);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível carregar os fornecedores.");
    });
    return () => controller.abort();
  }, [importer]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(""); setNotice("");
    try {
      const response = editingId
        ? await apiFetch(`/api/v1/purchase-requests/${editingId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json", "X-Record-Version": editingVersion },
          body: JSON.stringify({ importer, scNumber, supplierText, scDate: scDate || null, requester,
            commercialPlanReceivedDate: commercialPlanReceivedDate || null,
            approvalDate: approvalDate || null, reason: editReason }),
        })
        : await apiFetch("/api/v1/purchase-requests", {
          method: "POST",
          headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ importer, scNumber, supplierText, scDate: scDate || null, requester,
            commercialPlanReceivedDate: commercialPlanReceivedDate || null,
            approvalDate: approvalDate || null, reason: automaticAuditReason }),
        });
      const saved = await readApiJson<PurchaseRequestChoice>(response);
      setScNumber(""); setSupplierText(""); setScDate(""); setRequester(""); setCommercialPlanReceivedDate(""); setApprovalDate("");
      setEditingId(""); setEditingVersion(""); setEditReason("");
      const query = new URLSearchParams();
      if (importerFilter) query.set("importer", importerFilter);
      const queryString = query.toString();
      const list = await readApiJson<{ items: PurchaseRequestChoice[] }>(
        await apiFetch(`/api/v1/purchase-requests${queryString ? `?${queryString}` : ""}`, { cache: "no-store" }));
      setItems(list.items);
      setNotice(editingId
        ? `SC ${saved.scNumber} atualizada. Os campos compartilhados ainda ligados aos valores anteriores também foram atualizados nas POs.`
        : `SC ${saved.scNumber} cadastrada. Ela já pode ser vinculada às POs desta importadora.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a SC.");
    } finally { setSaving(false); }
  }

  function startEditing(item: PurchaseRequestChoice) {
    setEditingId(item.id); setEditingVersion(item.version); setImporter(item.importer);
    setScNumber(item.scNumber); setSupplierText(item.supplierText ?? ""); setScDate(item.scDate ?? ""); setRequester(item.requester);
    setCommercialPlanReceivedDate(item.commercialPlanReceivedDate ?? ""); setApprovalDate(item.approvalDate ?? "");
    setEditReason(""); setError(""); setNotice(`Editando a SC ${item.scNumber}.`);
  }

  function cancelEditing() {
    setEditingId(""); setEditingVersion(""); setEditReason("");
    setScNumber(""); setSupplierText(""); setScDate(""); setRequester(""); setCommercialPlanReceivedDate(""); setApprovalDate("");
    setNotice(""); setError("");
  }

  async function toggleHistory(item: PurchaseRequestChoice) {
    if (historyId === item.id) { setHistoryId(""); setHistoryItems([]); return; }
    setHistoryId(item.id); setHistoryItems([]); setHistoryLoading(true); setError("");
    try {
      const result = await readApiJson<{ items: PurchaseRequestHistory[] }>(
        await apiFetch(`/api/v1/purchase-requests/${item.id}/history`, { cache: "no-store" }));
      setHistoryItems(result.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível consultar o histórico da SC.");
    } finally { setHistoryLoading(false); }
  }

  return <main className="shell">
    <header className="page-header">
      <p className="eyebrow">PCM · Planejamento e Controle de Materiais</p>
      <h1>Solicitações de Compra</h1>
      <p>Cadastre a SC e os dados do plano comercial. Ao selecionar essa SC em uma PO, os dados serão exibidos em todas as POs vinculadas.</p>
    </header>
    {loading && <p role="status">Carregando o PCM…</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {!loading && !canManage && <p className="notice">Seu perfil pode consultar SCs, mas não pode cadastrá-las. Solicite o perfil PCM a um Master.</p>}
    {!loading && canManage && <section className="card">
      <h2>{editingId ? "Editar SC" : "Cadastrar SC"}</h2>
      <form className="stack-form" onSubmit={save}>
        <div className="operational-fields">
          <label>Importadora<SearchableSelect ariaLabel="Importadora" required value={importer} onChange={setImporter}
            options={importers.map(item => ({ value: item.code, label: item.code }))} /></label>
          <label>Número da SC<input required maxLength={80} value={scNumber} onChange={event => setScNumber(event.target.value)} /></label>
          <label>Fornecedor<SearchableSelect ariaLabel="Fornecedor" required value={supplierText} onChange={setSupplierText}
            options={suppliers.map(item => ({ value: item.code, label: `${item.code} · ${item.name}` }))} /></label>
          <label>Data da SC<input required type="date" value={scDate} onChange={event => setScDate(event.target.value)} /></label>
          <label>Data de recebimento do plano comercial<input type="date" value={commercialPlanReceivedDate}
            onChange={event => setCommercialPlanReceivedDate(event.target.value)} /></label>
          <label>Solicitante<OperationalOptionSelect required entity="requester" value={requester} values={options}
            onChange={setRequester} /></label>
          <label>Data de aprovação<input type="date" value={approvalDate} onChange={event => setApprovalDate(event.target.value)} /></label>
        </div>
        {editingId && <label>Motivo da alteração<textarea required minLength={3} maxLength={1000} value={editReason}
          onChange={event => setEditReason(event.target.value)} /></label>}
        <div className="button-row">
          <button className="button" disabled={saving || !importer || (Boolean(editingId) && editReason.trim().length < 3)}>{saving ? "Salvando SC…" : editingId ? "Salvar alterações" : "Cadastrar SC"}</button>
          {editingId && <button className="button secondary" type="button" disabled={saving} onClick={cancelEditing}>Cancelar edição</button>}
        </div>
      </form>
    </section>}
    {!loading && <section className="card">
      <h2>SCs cadastradas</h2>
      <label className="sc-list-filter">Importadora<SearchableSelect ariaLabel="Filtrar por importadora" disabled={Boolean(editingId)}
        value={importerFilter} onChange={setImporterFilter} options={importers.map(item => ({ value: item.code, label: item.code }))} /></label>
      {purchaseRequestsLoading ? <p role="status">Carregando SCs…</p> : items.length === 0 ? <p>
        {importerFilter ? "Nenhuma SC cadastrada para esta importadora." : "Nenhuma SC cadastrada."}
      </p> :
        <div className="table-scroll"><table><thead><tr>
          <th>Número da SC</th><th>Fornecedor</th><th>Data da SC</th><th>Solicitante</th><th>Plano comercial recebido</th><th>Aprovação</th><th>POs vinculadas</th><th>Ação</th>
        </tr></thead><tbody>{items.map(item => <tr key={item.id}>
          <td>{item.scNumber}</td><td>{item.supplierName ? `${item.supplierText} · ${item.supplierName}` : item.supplierText}</td><td>{item.scDate ?? "—"}</td><td>{item.requester}</td><td>{item.commercialPlanReceivedDate ?? "—"}</td>
          <td>{item.approvalDate ?? "Pendente"}</td><td>{item.purchaseOrderCount ?? 0}</td>
          <td><div className="sc-action-buttons">
            {canManage && <button className="button secondary" type="button" onClick={() => startEditing(item)}>Editar</button>}
            <button className="button secondary" type="button" onClick={() => void toggleHistory(item)}>
              {historyId === item.id ? "Ocultar histórico" : "Histórico"}
            </button>
          </div></td>
        </tr>)}</tbody></table></div>}
      {historyId && <section className="sc-history" aria-label="Histórico da SC">
        <h3>Histórico de alterações</h3>
        {historyLoading && <p role="status">Carregando histórico…</p>}
        {!historyLoading && historyItems.length === 0 && <p>Nenhum evento encontrado para esta SC.</p>}
        {!historyLoading && historyItems.map(event => <article className="sc-history-event" key={event.id}>
          <p><strong>{event.operation === "CREATE" ? "Cadastro" : "Alteração"}</strong> · {new Date(event.occurredAt).toLocaleString("pt-BR")}</p>
          <ul>{historyChanges(event).map(change => <li key={change}>{change}</li>)}</ul>
          <dl className="sc-history-meta">
            <div><dt>Responsável</dt><dd>{formatHistoryActor(event.actor)}</dd></div>
            <div><dt>Motivo</dt><dd>{event.reason}</dd></div>
          </dl>
        </article>)}
      </section>}
    </section>}
  </main>;
}
