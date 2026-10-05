"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch, readApiJson } from "../lib/api";
import { blankPurchaseOrderItemFields, OperationalFieldDraft, OperationalFieldsEditor,
  purchaseOrderCommonItemFields, purchaseOrderSpecificItemFields, purchaseOrderItemFields,
  purchaseOrderItemFieldsPayload } from "./PurchaseOrderItemFields";
import { CatalogChoice, CatalogProductSelect, loadCatalogChoices, loadOperationalOptions, OperationalOption, OperationalOptionSelect } from "./OperationalOptionSelect";
import PurchaseOrderCalculatedFields from "./PurchaseOrderCalculatedFields";

type Item = { id: string; lineNumber: number; externalLineReference: string | null;
  productCode: string; description: string; orderedQuantity: string; unit: string;
  unitPrice: string | null; currency: string | null; sourceKind: string;
  necessityDate: string | null; priority: string | null; demand: string | null; requester: string | null;
  scNumber: string | null; scApprovalDate: string | null; purpose: string | null; productGroup: string | null;
  costCenter: string | null; draftPo: string | null; poApprovalDate: string | null; poSentDate: string | null;
  category: string | null; ncm: string | null; remarks: string | null; commercialPlanReceivedDate: string | null;
  mrpCompletedDate: string | null; targetMrpDays: number | null; targetOrderDays: number | null;
  targetShipmentDays: number | null; targetPortDays: number | null; targetTransitDays: number | null;
  targetCustomsDays: number | null; actualFactoryShipDate: string | null;
  allocatedQuantity: string; remainingQuantity: string };
type Allocation = { id: string; itemId: string; processId: string; ipNumber: string;
  quantity: string; notes: string; version: string };
type OperationalPo = { id: string; importer: string; number: string; supplierText: string | null;
  orderDate: string | null; notes: string; sourceKind: string; version: string;
  items: Item[]; allocations: Allocation[] };
type ProcessOption = { id: string; ipNumber: string; importer: string };
type ItemDraft = { externalLineReference: string; productCode: string; description: string;
  orderedQuantity: string; unit: string; unitPrice: string; currency: string; operational: OperationalFieldDraft };
const blankItem = (): ItemDraft => ({ externalLineReference: "", productCode: "", description: "",
  orderedQuantity: "", unit: "", unitPrice: "", currency: "", operational: blankPurchaseOrderItemFields() });
function operationalDraft(item: Item): OperationalFieldDraft {
  return Object.fromEntries(purchaseOrderItemFields.map(field => {
    const value = item[field.key as keyof Item];
    return [field.key, value == null ? "" : String(value)];
  }));
}
const poWriters = new Set(["Master", "Administrador", "Importação", "Compras"]);
const allocationWriters = new Set(["Master", "Administrador", "Importação"]);

async function responseData<T>(response: Response): Promise<T> {
  return readApiJson<T>(response);
}

export default function OperationalPoPanel({ id, onChanged }: { id: string; onChanged?: () => void }) {
  const [data, setData] = useState<OperationalPo>();
  const [roles, setRoles] = useState<string[]>([]);
  const [number, setNumber] = useState("");
  const [supplier, setSupplier] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [notes, setNotes] = useState("");
  const [itemDraft, setItemDraft] = useState<ItemDraft>(blankItem);
  const [itemDrafts, setItemDrafts] = useState<Record<string, ItemDraft>>({});
  const [commonOperationalDraft, setCommonOperationalDraft] = useState<OperationalFieldDraft>(blankPurchaseOrderItemFields);
  const [commonFieldsTouched, setCommonFieldsTouched] = useState<Set<string>>(new Set());
  const [ipQuery, setIpQuery] = useState("");
  const [ipOptions, setIpOptions] = useState<ProcessOption[]>([]);
  const [creatingIp, setCreatingIp] = useState(false);
  const [newIpNumber, setNewIpNumber] = useState("");
  const [newIpStatus, setNewIpStatus] = useState("");
  const [newIpPriority, setNewIpPriority] = useState("");
  const [newIpNotes, setNewIpNotes] = useState("");
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
  const [products, setProducts] = useState<CatalogChoice[]>([]);
  const [suppliers, setSuppliers] = useState<CatalogChoice[]>([]);
  const [options, setOptions] = useState<OperationalOption[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    Promise.all([
      apiFetch(`/api/v1/purchase-orders/${id}/operational`, { signal: controller.signal }),
      apiFetch("/auth/me", { signal: controller.signal }),
      loadOperationalOptions(),
    ]).then(async ([poResponse, identityResponse, optionValues]) => {
      const po = await responseData<OperationalPo>(poResponse);
      const identity = await responseData<{ roles: string[] }>(identityResponse);
      const [productChoices, supplierChoices] = await Promise.all([
        loadCatalogChoices("products", po.importer), loadCatalogChoices("suppliers", po.importer),
      ]);
      if (controller.signal.aborted) return;
      setData(po); setRoles(identity.roles); setOptions(optionValues);
      setProducts(productChoices); setSuppliers(supplierChoices);
      setNumber(po.number);
      setSupplier(po.supplierText ?? ""); setOrderDate(po.orderDate ?? ""); setNotes(po.notes);
      const drafts = Object.fromEntries(po.items.map(item => [item.id, {
        externalLineReference: item.externalLineReference ?? "", productCode: item.productCode,
        description: item.description, orderedQuantity: item.orderedQuantity, unit: item.unit,
        unitPrice: item.unitPrice ?? "", currency: item.currency ?? "", operational: operationalDraft(item),
      }]));
      setItemDrafts(drafts);
      const commonDraft = blankPurchaseOrderItemFields();
      for (const field of purchaseOrderCommonItemFields) {
        const values = po.items.map(item => operationalDraft(item)[field.key] ?? "");
        commonDraft[field.key] = values.length && values.every(value => value === values[0]) ? values[0] : "";
      }
      setCommonOperationalDraft(commonDraft);
      setCommonFieldsTouched(new Set());
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
  async function applyCommonFieldsToItems(fields: Record<string, string | number | null>) {
    if (!data) return;
    for (const item of data.items) {
      const current = await responseData<{ version: string }>(await apiFetch(`/api/v1/purchase-orders/${id}/operational`));
      await send(`/api/v1/purchase-orders/${id}/items/${item.id}/followup`, "PATCH",
        { fields, reason }, current.version);
    }
  }
  async function save(action: () => Promise<unknown>, success: string) {
    setSaving(true); setError(""); setNotice("");
    try { await action(); setNotice(success); setReason(""); setReload(value => value + 1); onChanged?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Erro inesperado."); }
    finally { setSaving(false); }
  }
  async function saveHeader(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data) return;
    await save(async () => {
      await send(`/api/v1/purchase-orders/${id}`, "PATCH",
        { number, supplierText: supplier || null, orderDate: orderDate || null, notes, reason }, data.version);
      if (commonFieldsTouched.size) {
        const fieldsToSave = purchaseOrderCommonItemFields.filter(field => commonFieldsTouched.has(field.key));
        await applyCommonFieldsToItems(purchaseOrderItemFieldsPayload(commonOperationalDraft, true, fieldsToSave));
        setCommonFieldsTouched(new Set());
      }
    }, commonFieldsTouched.size ? "PO e dados compartilhados atualizados." : "PO atualizada.");
  }
  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data) return;
    if (commonFieldsTouched.size) { setError("Salve primeiro os dados compartilhados para aplicá-los a todos os produtos."); return; }
    const item = data.items.find(row => row.id === event.currentTarget.dataset.itemId);
    if (!item) return;
    const draft = itemDrafts[item.id];
    if (!draft?.productCode) { setError("Selecione o produto deste item."); return; }
    const body = { externalLineReference: draft.externalLineReference || null,
      productCode: draft.productCode, description: draft.description,
      orderedQuantity: draft.orderedQuantity.replace(",", "."), unit: draft.unit,
      unitPrice: draft.unitPrice ? draft.unitPrice.replace(",", ".") : null,
      currency: draft.currency ? draft.currency.toUpperCase() : null, reason };
    await save(async () => {
      await send(`/api/v1/purchase-orders/${id}/items/${item.id}`, "PATCH", body, data.version);
      const latest = await responseData<{ version: string }>(await apiFetch(`/api/v1/purchase-orders/${id}/operational`));
      await send(`/api/v1/purchase-orders/${id}/items/${item.id}/followup`, "PATCH",
        { fields: purchaseOrderItemFieldsPayload(draft.operational, true, purchaseOrderSpecificItemFields), reason }, latest.version);
    }, "Item e campos operacionais atualizados.");
  }
  function updateCommonField(key: string, value: string) {
    setCommonOperationalDraft(current => ({ ...current, [key]: value }));
    setCommonFieldsTouched(current => new Set(current).add(key));
    setItemDrafts(current => Object.fromEntries(Object.entries(current).map(([rowId, draft]) =>
      [rowId, { ...draft, operational: { ...draft.operational, [key]: value } }])));
  }
  async function saveCommonFields(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data || !commonFieldsTouched.size) return;
    const fieldsToSave = purchaseOrderCommonItemFields.filter(field => commonFieldsTouched.has(field.key));
    const fields = purchaseOrderItemFieldsPayload(commonOperationalDraft, true, fieldsToSave);
    await save(async () => {
      await applyCommonFieldsToItems(fields);
      setCommonFieldsTouched(new Set());
    }, "Dados compartilhados aplicados a todos os produtos.");
  }
  async function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data) return;
    if (commonFieldsTouched.size && data.items.length) { setError("Salve primeiro os dados compartilhados para aplicá-los a todos os produtos."); return; }
    const draft = itemDraft;
    if (!draft.productCode) { setError("Selecione o produto do novo item."); return; }
    await save(async () => {
      const created = await send(`/api/v1/purchase-orders/${id}/items`, "POST", {
        externalLineReference: draft.externalLineReference || null, productCode: draft.productCode,
        description: draft.description, orderedQuantity: draft.orderedQuantity.replace(",", "."),
        unit: draft.unit, unitPrice: draft.unitPrice ? draft.unitPrice.replace(",", ".") : null,
        currency: draft.currency ? draft.currency.toUpperCase() : null, reason,
      });
      const operational = { ...draft.operational, ...commonOperationalDraft };
      if (Object.values(operational).some(value => value.trim())) {
        const latest = await responseData<{ version: string }>(await apiFetch(`/api/v1/purchase-orders/${id}/operational`));
        await send(`/api/v1/purchase-orders/${id}/items/${created.id}/followup`, "PATCH",
          { fields: purchaseOrderItemFieldsPayload(operational), reason }, latest.version);
      }
      setItemDraft(blankItem());
    }, "Item cadastrado.");
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
  async function createIp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data) return;
    await save(async () => {
      const created = await responseData<{ id: string; ipNumber: string }>(await apiFetch("/api/v1/processes", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ importer: data.importer, ipNumber: newIpNumber,
          logisticsStatus: newIpStatus || null, priority: newIpPriority || null, notes: newIpNotes, reason }),
      }));
      setIpOptions(current => [...current.filter(option => option.id !== created.id),
        { id: created.id, ipNumber: created.ipNumber, importer: data.importer }]);
      setProcessId(created.id);
      setIpQuery(created.ipNumber);
      setNewIpNumber(""); setNewIpStatus(""); setNewIpPriority(""); setNewIpNotes("");
      setCreatingIp(false);
    }, "IP cadastrado e selecionado para distribuição.");
  }
  async function saveAllocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (commonFieldsTouched.size) { setError("Salve primeiro os dados compartilhados da PO."); return; }
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
    if (commonFieldsTouched.size) { setError("Salve primeiro os dados compartilhados da PO."); return; }
    if (!editingAllocation || !reason.trim()) return;
    await save(async () => {
      await send(`/api/v1/purchase-orders/${id}/allocations/${editingAllocation.id}`, "DELETE",
        { reason }, editingAllocation.version);
      setEditingAllocation(undefined); setAllocationQuantity(""); setAllocationNotes("");
    }, "Distribuição cancelada; o saldo voltou ao item.");
  }

  const commonValuesDiffer = Boolean(data && data.items.length > 1 &&
    purchaseOrderCommonItemFields.some(field =>
      new Set(data.items.map(item => operationalDraft(item)[field.key] ?? "")).size > 1));
  return <section className="card operational-panel" aria-label="Registro operacional da PO">
    <h2>Preenchimento operacional da PO</h2>
    <p className="muted">Os itens abaixo são transcrições informadas pelos analistas. Quantidades do histórico da planilha não são convertidas automaticamente em quantidade pedida no TOTVS. O saldo mostrado é pedido informado menos quantidades distribuídas aos IPs.</p>
    {loading && <p role="status">Carregando preenchimento…</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {!loading && data && <>
      <p className="muted">Origem: {data.sourceKind} · versão {data.version}</p>
      <p className="muted">Cadastre fornecedores e produtos em <Link className="text-link" href="/catalog">Cadastros</Link> e os demais valores em <Link className="text-link" href="/catalog/values">Valores das entidades</Link>.</p>
      <dl className="operational-summary"><div><dt>Fornecedor informado</dt><dd>{data.supplierText ?? "—"}</dd></div>
        <div><dt>Data da PO</dt><dd>{data.orderDate ?? "—"}</dd></div><div><dt>Observações</dt><dd>{data.notes || "—"}</dd></div></dl>
      {(canWritePo || canAllocate) && <label className="operational-reason">Justificativa da alteração
        <input required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)}
          placeholder="Ex.: conferido no pedido do TOTVS" /></label>}
      {canWritePo && <section className="po-entry-section">
        <h3>Dados da PO</h3>
        <form className="stack-form" onSubmit={saveHeader}>
          <label>Número da PO no TOTVS<input required maxLength={80} disabled={data.sourceKind !== "MANUAL_TOTVS_REFERENCE"}
            value={number} onChange={event => setNumber(event.target.value)} /></label>
          <label>Fornecedor<select value={supplier} onChange={event => setSupplier(event.target.value)}>
            <option value="">Selecione</option>{!suppliers.some(item => item.code === supplier) && supplier && <option value={supplier}>{supplier} (valor atual)</option>}
            {suppliers.map(item => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}
          </select></label>
          <label>Data da PO<input type="date" value={orderDate} onChange={event => setOrderDate(event.target.value)} /></label>
          <label>Observações<textarea maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
          <button className="button" disabled={saving || reason.trim().length < 3}>Salvar PO</button>
        </form>
      </section>}
      <h3>Itens informados da PO</h3>
      {canWritePo && <section className="po-entry-section po-common-fields">
        <h4>Dados compartilhados pelos produtos</h4>
        <p className="muted">Preencha uma vez para manter iguais nos produtos. A data da PO é compartilhada no cabeçalho.</p>
        {commonValuesDiffer && <p className="notice">Há valores diferentes entre produtos. Ao aplicar um campo, ele será padronizado em todos.</p>}
        <form className="stack-form" onSubmit={saveCommonFields}>
          <OperationalFieldsEditor fields={purchaseOrderCommonItemFields} values={commonOperationalDraft} options={options}
            setValues={values => purchaseOrderCommonItemFields.forEach(field => {
              const value = values[field.key] ?? "";
              if (value !== commonOperationalDraft[field.key]) updateCommonField(field.key, value);
            })} />
          <button className="button" disabled={saving || !data.items.length || !commonFieldsTouched.size || reason.trim().length < 3}>
            Aplicar campos alterados a todos os produtos</button>
        </form>
      </section>}
      {data.items.length === 0 && <p>Nenhum item informado. Cadastre os itens do pedido para distribuir quantidades aos IPs.</p>}
      {data.items.map(item => {
        const draft = itemDrafts[item.id] ?? blankItem();
        const setDraft = (change: Partial<ItemDraft>) => setItemDrafts(current => ({ ...current, [item.id]: { ...draft, ...change } }));
        return <article className="po-entry-item" key={item.id}>
          <div className="po-entry-heading"><div><h4>Item {item.lineNumber} · {item.productCode}</h4>
            <p className="muted">Nos IPs: {item.allocatedQuantity} {item.unit} · A distribuir: {item.remainingQuantity} {item.unit}</p></div></div>
          {canWritePo ? <form className="stack-form" data-item-id={item.id} onSubmit={saveItem}>
            <div className="operational-fields">
              <label>Linha no TOTVS<input maxLength={80} value={draft.externalLineReference} onChange={event => setDraft({ externalLineReference: event.target.value })} /></label>
              <label>Produto<CatalogProductSelect required value={draft.productCode} fallbackName={draft.description} products={products}
                onChange={product => setDraft({ productCode: product?.code ?? "", description: product?.name ?? "" })} /></label>
              <label>Código do produto<input readOnly value={draft.productCode} /></label>
              <label>Descrição<input readOnly value={draft.description} /></label>
              <label>Quantidade pedida<input required inputMode="decimal" value={draft.orderedQuantity} onChange={event => setDraft({ orderedQuantity: event.target.value })} /></label>
              <label>Unidade<input required maxLength={32} value={draft.unit} onChange={event => setDraft({ unit: event.target.value })} /></label>
              <label>Preço unitário<input inputMode="decimal" value={draft.unitPrice} onChange={event => setDraft({ unitPrice: event.target.value })} /></label>
              <label>Moeda do preço<OperationalOptionSelect entity="currency" value={draft.currency} values={options} onChange={currency => setDraft({ currency })} /></label>
            </div>
            <h5>Planejamento e acompanhamento</h5>
            <OperationalFieldsEditor fields={purchaseOrderSpecificItemFields} values={draft.operational} options={options}
              setValues={operational => setDraft({ operational })} />
            <PurchaseOrderCalculatedFields quantity={draft.orderedQuantity} unitPrice={draft.unitPrice} currency={draft.currency} />
            <button className="button" disabled={saving || commonFieldsTouched.size > 0 || reason.trim().length < 3}>Salvar todos os campos deste item</button>
          </form> : <p>{item.orderedQuantity} {item.unit} · {item.description}</p>}
        </article>;
      })}
      {canWritePo && <details><summary>Adicionar item à PO</summary>
        <form className="stack-form" onSubmit={createItem}>
          <div className="operational-fields">
            <label>Linha no TOTVS<input maxLength={80} value={itemDraft.externalLineReference} onChange={event => setItemDraft({ ...itemDraft, externalLineReference: event.target.value })} /></label>
            <label>Produto<CatalogProductSelect required value={itemDraft.productCode} fallbackName={itemDraft.description} products={products}
              onChange={product => setItemDraft({ ...itemDraft, productCode: product?.code ?? "", description: product?.name ?? "" })} /></label>
            <label>Código do produto<input readOnly value={itemDraft.productCode} /></label>
            <label>Descrição<input readOnly value={itemDraft.description} /></label>
            <label>Quantidade pedida<input required inputMode="decimal" value={itemDraft.orderedQuantity} onChange={event => setItemDraft({ ...itemDraft, orderedQuantity: event.target.value })} /></label>
            <label>Unidade<input required maxLength={32} value={itemDraft.unit} onChange={event => setItemDraft({ ...itemDraft, unit: event.target.value })} /></label>
            <label>Preço unitário<input inputMode="decimal" value={itemDraft.unitPrice} onChange={event => setItemDraft({ ...itemDraft, unitPrice: event.target.value })} /></label>
            <label>Moeda do preço<OperationalOptionSelect entity="currency" value={itemDraft.currency} values={options} onChange={currency => setItemDraft({ ...itemDraft, currency })} /></label>
          </div>
          <OperationalFieldsEditor fields={purchaseOrderSpecificItemFields} values={itemDraft.operational} options={options}
            setValues={operational => setItemDraft({ ...itemDraft, operational })} />
          <PurchaseOrderCalculatedFields quantity={itemDraft.orderedQuantity} unitPrice={itemDraft.unitPrice} currency={itemDraft.currency} />
          <button className="button" disabled={saving || (commonFieldsTouched.size > 0 && data.items.length > 0) || reason.trim().length < 3}>Salvar item completo</button>
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
          <button className="button secondary" type="button" onClick={() => setCreatingIp(value => !value)}>
            {creatingIp ? "Fechar cadastro de IP" : "Cadastrar IP nesta PO"}</button>
        </form>}
        {!editingAllocation && creatingIp && <form className="stack-form inline-ip-form" onSubmit={createIp}>
          <h5>Novo IP · importadora {data.importer}</h5>
          <div className="operational-fields">
            <label>Número do IP<input required maxLength={80} value={newIpNumber}
              onChange={event => setNewIpNumber(event.target.value)} /></label>
            <label>Status logístico<OperationalOptionSelect entity="logistics_status" value={newIpStatus}
              values={options} onChange={setNewIpStatus} /></label>
            <label>Prioridade<input maxLength={20} value={newIpPriority}
              onChange={event => setNewIpPriority(event.target.value)} /></label>
            <label>Observações<textarea maxLength={4000} value={newIpNotes}
              onChange={event => setNewIpNotes(event.target.value)} /></label>
          </div>
          <button className="button" disabled={saving || commonFieldsTouched.size > 0 || reason.trim().length < 3}>Cadastrar IP e selecionar</button>
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
          <button className="button" disabled={saving || commonFieldsTouched.size > 0 || reason.trim().length < 3 || (!editingAllocation && !processId)}>
            {editingAllocation ? "Atualizar distribuição" : "Distribuir quantidade"}</button>
          {editingAllocation && <div className="operational-actions">
            <button className="button secondary" type="button" onClick={() => {
              setEditingAllocation(undefined); setAllocationQuantity(""); setAllocationNotes("");
            }}>Cancelar edição</button>
            <button className="button secondary" type="button" disabled={saving || commonFieldsTouched.size > 0 || reason.trim().length < 3}
              onClick={() => void cancelAllocation()}>Cancelar distribuição</button>
          </div>}
        </form>
      </div>}
    </>}
  </section>;
}
