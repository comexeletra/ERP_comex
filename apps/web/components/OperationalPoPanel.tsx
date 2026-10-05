"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

type Item = { id: string; lineNumber: number; externalLineReference: string | null;
  productCode: string; description: string; orderedQuantity: string; unit: string;
  unitPrice: string | null; currency: string | null; sourceKind: string;
  allocatedQuantity: string; remainingQuantity: string };
type Allocation = { id: string; itemId: string; processId: string; ipNumber: string;
  quantity: string; notes: string; version: string };
type OperationalPo = { id: string; importer: string; number: string; supplierText: string | null;
  orderDate: string | null; notes: string; sourceKind: string; version: string;
  items: Item[]; allocations: Allocation[] };
type ProcessOption = { id: string; ipNumber: string; importer: string };
type ItemDraft = { externalLineReference: string; productCode: string; description: string;
  orderedQuantity: string; unit: string; unitPrice: string; currency: string };
const blankItem = (): ItemDraft => ({ externalLineReference: "", productCode: "", description: "",
  orderedQuantity: "", unit: "", unitPrice: "", currency: "" });
const poWriters = new Set(["Master", "Administrador", "Importação", "Compras"]);
const allocationWriters = new Set(["Master", "Administrador", "Importação"]);

async function responseData<T>(response: Response): Promise<T> {
  const data = await response.json() as T & { detail?: string };
  if (!response.ok) throw new Error(data.detail || "Não foi possível concluir a operação.");
  return data;
}

export default function OperationalPoPanel({ id, onChanged }: { id: string; onChanged?: () => void }) {
  const [data, setData] = useState<OperationalPo>();
  const [roles, setRoles] = useState<string[]>([]);
  const [number, setNumber] = useState("");
  const [supplier, setSupplier] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [notes, setNotes] = useState("");
  const [itemDraft, setItemDraft] = useState<ItemDraft>(blankItem);
  const [editingItem, setEditingItem] = useState<string>();
  const [ipQuery, setIpQuery] = useState("");
  const [ipOptions, setIpOptions] = useState<ProcessOption[]>([]);
  const [itemId, setItemId] = useState("");
  const [processId, setProcessId] = useState("");
  const [allocationQuantity, setAllocationQuantity] = useState("");
  const [allocationNotes, setAllocationNotes] = useState("");
  const [editingAllocation, setEditingAllocation] = useState<Allocation>();
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    Promise.all([
      apiFetch(`/api/v1/purchase-orders/${id}/operational`, { signal: controller.signal }),
      apiFetch("/auth/me", { signal: controller.signal }),
    ]).then(async ([poResponse, identityResponse]) => {
      const po = await responseData<OperationalPo>(poResponse);
      const identity = await responseData<{ roles: string[] }>(identityResponse);
      if (controller.signal.aborted) return;
      setData(po); setRoles(identity.roles);
      setNumber(po.number);
      setSupplier(po.supplierText ?? ""); setOrderDate(po.orderDate ?? ""); setNotes(po.notes);
      setItemId(current => po.items.some(item => item.id === current) ? current : po.items[0]?.id ?? "");
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Erro inesperado."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, reload]);

  const canWritePo = roles.some(role => poWriters.has(role));
  const canAllocate = roles.some(role => allocationWriters.has(role));
  async function send(path: string, method: string, body: unknown, version?: string) {
    const response = await apiFetch(path, { method,
      headers: { "content-type": "application/json", ...(version ? { "If-Match": `"${version}"` } :
        { "Idempotency-Key": crypto.randomUUID() }) }, body: JSON.stringify(body) });
    return responseData<{ id: string }>(response);
  }
  async function save(action: () => Promise<unknown>, success: string) {
    setSaving(true); setError(""); setNotice("");
    try { await action(); setNotice(success); setReason(""); setReload(value => value + 1); onChanged?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Erro inesperado."); }
    finally { setSaving(false); }
  }
  async function saveHeader(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data) return;
    await save(() => send(`/api/v1/purchase-orders/${id}`, "PATCH",
      { number, supplierText: supplier || null, orderDate: orderDate || null, notes, reason }, data.version), "PO atualizada.");
  }
  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data) return;
    const body = { externalLineReference: itemDraft.externalLineReference || null,
      productCode: itemDraft.productCode, description: itemDraft.description,
      orderedQuantity: itemDraft.orderedQuantity, unit: itemDraft.unit,
      unitPrice: itemDraft.unitPrice || null, currency: itemDraft.currency || null, reason };
    await save(async () => {
      await send(editingItem ? `/api/v1/purchase-orders/${id}/items/${editingItem}` :
        `/api/v1/purchase-orders/${id}/items`, editingItem ? "PATCH" : "POST", body,
      editingItem ? data.version : undefined);
      setEditingItem(undefined); setItemDraft(blankItem());
    }, editingItem ? "Item atualizado." : "Item cadastrado.");
  }
  async function searchIps(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data) return;
    try {
      const query = new URLSearchParams({ importer: data.importer, ipNumber: ipQuery, pageSize: "100" });
      const response = await apiFetch(`/api/v1/processes?${query}`);
      const result = await responseData<{ items: ProcessOption[] }>(response);
      setIpOptions(result.items.filter(item => item.importer === data.importer));
      if (!result.items.some(item => item.id === processId)) setProcessId("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro inesperado."); }
  }
  async function saveAllocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!itemId || (!processId && !editingAllocation)) return;
    await save(async () => {
      const body = { quantity: allocationQuantity, notes: allocationNotes, reason };
      await send(editingAllocation ? `/api/v1/purchase-orders/${id}/allocations/${editingAllocation.id}` :
        `/api/v1/purchase-orders/${id}/allocations`, editingAllocation ? "PATCH" : "POST",
      editingAllocation ? body : { ...body, itemId, processId }, editingAllocation?.version);
      setEditingAllocation(undefined); setAllocationQuantity(""); setAllocationNotes("");
    }, editingAllocation ? "Distribuição atualizada." : "Quantidade distribuída para o IP.");
  }
  async function cancelAllocation() {
    if (!editingAllocation || !reason.trim()) return;
    await save(async () => {
      await send(`/api/v1/purchase-orders/${id}/allocations/${editingAllocation.id}`, "DELETE",
        { reason }, editingAllocation.version);
      setEditingAllocation(undefined); setAllocationQuantity(""); setAllocationNotes("");
    }, "Distribuição cancelada; o saldo voltou ao item.");
  }

  return <section className="card operational-panel" aria-label="Registro operacional da PO">
    <h2>Preenchimento operacional da PO</h2>
    <p className="muted">Os itens abaixo são transcrições informadas pelos analistas. Quantidades do histórico da planilha não são convertidas automaticamente em quantidade pedida no TOTVS. O saldo mostrado é pedido informado menos quantidades distribuídas aos IPs.</p>
    {loading && <p role="status">Carregando preenchimento…</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {!loading && data && <>
      <p className="muted">Origem: {data.sourceKind} · versão {data.version}</p>
      <dl className="operational-summary"><div><dt>Fornecedor informado</dt><dd>{data.supplierText ?? "—"}</dd></div>
        <div><dt>Data da PO</dt><dd>{data.orderDate ?? "—"}</dd></div><div><dt>Observações</dt><dd>{data.notes || "—"}</dd></div></dl>
      {(canWritePo || canAllocate) && <label className="operational-reason">Justificativa da alteração
        <input required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)}
          placeholder="Ex.: conferido no pedido do TOTVS" /></label>}
      {canWritePo && <details><summary>Editar dados da PO</summary>
        <form className="stack-form" onSubmit={saveHeader}>
          <label>Número da PO no TOTVS<input required maxLength={80} disabled={data.sourceKind !== "MANUAL_TOTVS_REFERENCE"}
            value={number} onChange={event => setNumber(event.target.value)} /></label>
          <label>Fornecedor informado<input maxLength={240} value={supplier} onChange={event => setSupplier(event.target.value)} /></label>
          <label>Data da PO<input type="date" value={orderDate} onChange={event => setOrderDate(event.target.value)} /></label>
          <label>Observações<textarea maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
          <button className="button" disabled={saving || reason.trim().length < 3}>Salvar PO</button>
        </form>
      </details>}
      <h3>Itens informados da PO</h3>
      {data.items.length === 0 ? <p>Nenhum item informado. Cadastre os itens do pedido para distribuir quantidades aos IPs.</p> :
        <div className="table-scroll"><table><thead><tr><th>Linha</th><th>Produto</th><th>Pedido informado</th><th>Nos IPs</th><th>A distribuir</th><th>Ação</th></tr></thead>
          <tbody>{data.items.map(item => <tr key={item.id}><td>{item.externalLineReference ?? item.lineNumber}</td>
            <td><strong>{item.productCode}</strong><br />{item.description}</td>
            <td>{item.orderedQuantity} {item.unit}</td><td>{item.allocatedQuantity} {item.unit}</td>
            <td>{item.remainingQuantity} {item.unit}</td>
            <td>{canWritePo && <button className="button secondary" type="button" onClick={() => {
              setEditingItem(item.id); setItemDraft({ externalLineReference: item.externalLineReference ?? "",
                productCode: item.productCode, description: item.description, orderedQuantity: item.orderedQuantity,
                unit: item.unit, unitPrice: item.unitPrice ?? "", currency: item.currency ?? "" });
            }}>Editar</button>}</td></tr>)}</tbody></table></div>}
      {canWritePo && <details open={Boolean(editingItem)} key={editingItem ?? "new"}>
        <summary>{editingItem ? "Editar item" : "Adicionar item da PO"}</summary>
        <form className="stack-form" onSubmit={saveItem}>
          <label>Linha no TOTVS, se conhecida<input maxLength={80} value={itemDraft.externalLineReference}
            onChange={event => setItemDraft({ ...itemDraft, externalLineReference: event.target.value })} /></label>
          <label>Código do produto<input required maxLength={120} value={itemDraft.productCode}
            onChange={event => setItemDraft({ ...itemDraft, productCode: event.target.value })} /></label>
          <label>Descrição<input required maxLength={1000} value={itemDraft.description}
            onChange={event => setItemDraft({ ...itemDraft, description: event.target.value })} /></label>
          <div className="operational-fields">
            <label>Quantidade pedida<input required inputMode="decimal" value={itemDraft.orderedQuantity}
              onChange={event => setItemDraft({ ...itemDraft, orderedQuantity: event.target.value })} placeholder="100 ou 100,5" /></label>
            <label>Unidade<input required maxLength={32} value={itemDraft.unit}
              onChange={event => setItemDraft({ ...itemDraft, unit: event.target.value })} placeholder="PC" /></label>
            <label>Preço unitário, se conhecido<input inputMode="decimal" value={itemDraft.unitPrice}
              onChange={event => setItemDraft({ ...itemDraft, unitPrice: event.target.value })} /></label>
            <label>Moeda do preço<input maxLength={3} value={itemDraft.currency}
              onChange={event => setItemDraft({ ...itemDraft, currency: event.target.value.toUpperCase() })} placeholder="USD" /></label>
          </div>
          <button className="button" disabled={saving || reason.trim().length < 3}>Salvar item</button>
          {editingItem && <button className="button secondary" type="button" onClick={() => {
            setEditingItem(undefined); setItemDraft(blankItem()); }}>Cancelar edição</button>}
        </form>
      </details>}
      <h3>Distribuição por IP</h3>
      {data.allocations.length === 0 ? <p>Nenhuma quantidade distribuída operacionalmente.</p> :
        <div className="table-scroll"><table><thead><tr><th>Item</th><th>IP</th><th>Quantidade</th><th>Ação</th></tr></thead>
          <tbody>{data.allocations.map(allocation => <tr key={allocation.id}>
            <td>{data.items.find(item => item.id === allocation.itemId)?.productCode ?? "—"}</td>
            <td><Link className="text-link" href={`/processes/${allocation.processId}`}>{allocation.ipNumber}</Link></td>
            <td>{allocation.quantity} {data.items.find(item => item.id === allocation.itemId)?.unit ?? ""}</td>
            <td>{canAllocate && <button className="button secondary" type="button" onClick={() => {
              setEditingAllocation(allocation); setItemId(allocation.itemId); setProcessId(allocation.processId);
              setAllocationQuantity(allocation.quantity); setAllocationNotes(allocation.notes);
            }}>Editar</button>}</td></tr>)}</tbody></table></div>}
      {canAllocate && data.items.length > 0 && <div className="operational-allocation">
        <h4>{editingAllocation ? `Editar distribuição para ${editingAllocation.ipNumber}` : "Distribuir item para um IP"}</h4>
        {!editingAllocation && <form className="operational-search" onSubmit={searchIps}>
          <label>Buscar IP<input value={ipQuery} onChange={event => setIpQuery(event.target.value)} placeholder="Número ou parte do IP" /></label>
          <button className="button secondary">Buscar IPs</button>
          <Link className="text-link" href="/processes/new">Criar IP</Link>
        </form>}
        <form className="stack-form" onSubmit={saveAllocation}>
          <label>Item<select required value={itemId} disabled={Boolean(editingAllocation)} onChange={event => setItemId(event.target.value)}>
            {data.items.map(item => <option key={item.id} value={item.id}>{item.productCode} · linha {item.lineNumber} · saldo {item.remainingQuantity} {item.unit}</option>)}
          </select></label>
          {!editingAllocation && <label>IP<select required value={processId} onChange={event => setProcessId(event.target.value)}>
            <option value="">Busque e selecione um IP</option>{ipOptions.map(item => <option key={item.id} value={item.id}>{item.ipNumber}</option>)}
          </select></label>}
          <label>Quantidade neste IP<input required inputMode="decimal" value={allocationQuantity}
            onChange={event => setAllocationQuantity(event.target.value)} placeholder="Ex.: 40" /></label>
          <label>Observações<textarea maxLength={2000} value={allocationNotes}
            onChange={event => setAllocationNotes(event.target.value)} /></label>
          <button className="button" disabled={saving || reason.trim().length < 3 || (!editingAllocation && !processId)}>
            {editingAllocation ? "Atualizar distribuição" : "Distribuir quantidade"}</button>
          {editingAllocation && <div className="operational-actions">
            <button className="button secondary" type="button" onClick={() => {
              setEditingAllocation(undefined); setAllocationQuantity(""); setAllocationNotes("");
            }}>Cancelar edição</button>
            <button className="button secondary" type="button" disabled={saving || reason.trim().length < 3}
              onClick={() => void cancelAllocation()}>Cancelar distribuição</button>
          </div>}
        </form>
      </div>}
    </>}
  </section>;
}
