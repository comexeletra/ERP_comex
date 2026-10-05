"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "../lib/api";

type Field = { key: string; label: string; type?: "date" | "number" | "money" | "boolean"; max?: number };
const itemFields: Field[] = [
  { key: "necessityDate", label: "Data de necessidade", type: "date" },
  { key: "priority", label: "Prioridade", max: 20 }, { key: "demand", label: "Demanda", max: 160 },
  { key: "requester", label: "Solicitante", max: 160 }, { key: "scNumber", label: "SC TOTVS", max: 80 },
  { key: "scApprovalDate", label: "Aprovação da SC", type: "date" },
  { key: "purpose", label: "Finalidade", max: 160 }, { key: "costCenter", label: "Centro de custo", max: 80 },
  { key: "draftPo", label: "Draft PO", max: 80 }, { key: "poApprovalDate", label: "Aprovação da PO", type: "date" },
  { key: "poSentDate", label: "Envio da PO", type: "date" }, { key: "category", label: "Categoria", max: 120 },
  { key: "ncm", label: "NCM", max: 16 }, { key: "remarks", label: "Observações do item", max: 4000 },
  { key: "commercialPlanReceivedDate", label: "Plano comercial recebido", type: "date" },
  { key: "mrpCompletedDate", label: "MRP concluído", type: "date" },
  { key: "targetMrpDays", label: "Meta T0 MRP (dias)", type: "number" },
  { key: "targetOrderDays", label: "Meta T1 pedido (dias)", type: "number" },
  { key: "targetShipmentDays", label: "Meta T2 embarque (dias)", type: "number" },
  { key: "targetPortDays", label: "Meta T3 porto (dias)", type: "number" },
  { key: "targetTransitDays", label: "Meta T4 trânsito (dias)", type: "number" },
  { key: "targetCustomsDays", label: "Meta T5 desembaraço (dias)", type: "number" },
  { key: "actualFactoryShipDate", label: "Saída da fábrica", type: "date" },
  { key: "actualPortDepartureDate", label: "Saída do porto de origem", type: "date" },
];
const processFields: Field[] = [
  { key: "priority", label: "Prioridade do IP", max: 20 },
  { key: "ipTotvsDate", label: "Data do IP no TOTVS", type: "date" },
  { key: "transportMode", label: "Modal (SEA, AIR...) ", max: 40 },
  { key: "incoterm", label: "Incoterm", max: 20 }, { key: "broker", label: "Despachante", max: 160 },
  { key: "portLoading", label: "POL / origem", max: 160 }, { key: "portDischarge", label: "POD / destino", max: 160 },
  { key: "etd", label: "ETD", type: "date" }, { key: "etaConfirmed", label: "ETA confirmada", type: "date" },
  { key: "arrivalDate", label: "Chegada efetiva", type: "date" },
  { key: "duimpNumber", label: "DUIMP", max: 100 }, { key: "duimpDate", label: "Registro da DUIMP", type: "date" },
  { key: "customsChannel", label: "Canal", max: 80 }, { key: "clearanceDate", label: "Desembaraço", type: "date" },
  { key: "eteConfirmed", label: "ETE confirmada", type: "date" },
  { key: "nfRequestDate", label: "Solicitação da NF", type: "date" },
  { key: "deliveryDate", label: "Entrega efetiva", type: "date" },
  { key: "freightCurrency", label: "Moeda do frete", max: 3 }, { key: "freightCost", label: "Frete", type: "money" },
  { key: "containerNumber", label: "Container", max: 120 }, { key: "containerType", label: "Tipo do container", max: 80 },
  { key: "containerQuantity", label: "Qtd. containers", type: "number" },
  { key: "forwarder", label: "Agente de carga", max: 160 },
  { key: "documentsOk", label: "Documentação conferida", type: "boolean" },
  { key: "storageDueOverride", label: "Vencimento armazenagem confirmado", type: "date" },
  { key: "taxesPaidBrl", label: "Impostos pagos (R$)", type: "money" },
  { key: "fineBrl", label: "Multa (R$)", type: "money" },
  { key: "storageBrl", label: "Armazenagem (R$)", type: "money" },
  { key: "demurrageBrl", label: "Demurrage (R$)", type: "money" },
  { key: "demurrageContainerQuantity", label: "Qtd. containers com demurrage", type: "number" },
];
type DataRow = Record<string, string | number | boolean | null | undefined>;
type Document = { id: string; kind: "INVOICE" | "BL" | "NF"; number: string;
  purchaseOrderItemId: string | null; issueDate: string | null; homologationDate: string | null;
  quantity: string | null; unitPrice: string | null; amount: string | null; currencyCode: string | null;
  notes: string; status: string; version: string };
type Calculated = Record<string, string | number | boolean | null | Record<string, { targetDays: number | null; actualDays: number | null; delayDays: number | null }>>;
type Shipment = { allocationId: string; allocationQuantity: string; itemId: string;
  process: DataRow & { id: string; ipNumber: string; version: string };
  calculated: Calculated };
type ProcessDetail = { process: DataRow & { id: string; ipNumber: string; version: string };
  documents: Document[]; invoiceTotals: { amounts: { currency: string; amount: string }[]; incompleteLines: number } };
type Followup = { id: string; importer: string; number: string; version: string;
  items: (DataRow & { id: string; productCode: string; lineNumber: number; orderedQuantity: string; unitPrice: string | null; currencyCode: string | null })[];
  processes: ProcessDetail[]; shipments: Shipment[] };
type Draft = Record<string, string>;
function draft(row: DataRow, fields: Field[]): Draft {
  return Object.fromEntries(fields.map(field => [field.key, row[field.key] == null ? "" : String(row[field.key])])) as Draft;
}
function payload(fields: Field[], values: Draft) {
  return Object.fromEntries(fields.map(field => {
    const value = values[field.key]?.trim() ?? "";
    return [field.key, value === "" ? null : field.type === "number" ? Number(value) :
      field.type === "boolean" ? value === "true" : field.key === "freightCurrency" ? value.toUpperCase() :
        field.type === "money" ? value.replace(",", ".") : value];
  }));
}
function FieldEditor({ fields, values, setValues }: { fields: Field[]; values: Draft; setValues: (value: Draft) => void }) {
  return <div className="operational-fields">{fields.map(field => <label key={field.key}>{field.label}
    {field.type === "boolean" ? <select value={values[field.key] ?? ""} onChange={event => setValues({ ...values, [field.key]: event.target.value })}>
      <option value="">Não informado</option><option value="true">Sim</option><option value="false">Não</option></select> :
      <input type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
        min={field.type === "number" ? 0 : undefined} maxLength={field.max}
        inputMode={field.type === "money" ? "decimal" : undefined}
        value={values[field.key] ?? ""} onChange={event => setValues({ ...values, [field.key]: event.target.value })} />}</label>)}</div>;
}
async function read<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { detail?: string };
  if (!response.ok) throw new Error(body.detail ?? "Não foi possível salvar.");
  return body;
}
function value(value: unknown): string { return value == null || value === "" ? "—" : typeof value === "boolean" ? value ? "Sim" : "Não" : String(value); }
const calcLabels: [string, string][] = [
  ["status", "Status"], ["alert", "Alerta"], ["ruptureRisk", "Risco de ruptura"],
  ["totalPrice", "Total do item (qtd. pedida × preço)"], ["eta", "ETA"], ["ete", "ETE"],
  ["transitDays", "Trânsito previsto (dias)"], ["storageDueDate", "Vencimento da armazenagem"],
  ["leadTimeDays", "Lead time total (dias)"], ["poApprovalDays", "SC até aprovação PO (dias)"],
  ["poAfterScDays", "SC até envio PO (dias)"], ["poOnTime", "PO até dia 8"],
  ["poDeviationDays", "Desvio do dia 10 (dias)"], ["factoryLeadDays", "PO até BL (dias)"],
  ["actualTransitDays", "Trânsito real (dias)"], ["clearanceDays", "Chegada até entrega (dias)"],
  ["commercialDeadline", "Prazo do plano comercial"], ["commercialDeviationDays", "Desvio plano comercial (dias)"],
  ["mrpTargetDate", "Meta MRP"], ["portTargetDate", "Meta saída do porto"],
  ["arrivalTargetDate", "Meta chegada Brasil"], ["deliveryTargetDate", "Meta entrega"],
  ["billDate", "BL emitido"], ["nfIssueDate", "NF emitida"], ["nfHomologationDate", "NF homologada"],
  ["invoiceQuantity", "Qtd. da Invoice no item/IP"],
  ["quantityMatchesInvoice", "Qtd. Invoice confere com o IP"],
  ["invoiceUnitPrice", "Preço da Invoice"], ["priceMatchesInvoice", "Preço da Invoice confere"],
  ["totalTargetDays", "Meta total (dias)"], ["totalActualDays", "Real total (dias)"],
  ["totalDelayDays", "Desvio total (dias)"], ["bottleneck", "Etapa com maior desvio"],
  ["arrivalYearMonth", "Mês da chegada"],
];
type DocDraft = { kind: "INVOICE" | "BL" | "NF"; purchaseOrderItemId: string; number: string;
  issueDate: string; homologationDate: string; quantity: string; unitPrice: string; amount: string; currencyCode: string; notes: string };
const blankDoc = (): DocDraft => ({ kind: "INVOICE", purchaseOrderItemId: "", number: "", issueDate: "",
  homologationDate: "", quantity: "", unitPrice: "", amount: "", currencyCode: "", notes: "" });

export default function FollowupPanel({ id }: { id: string }) {
  const [data, setData] = useState<Followup>(); const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [reload, setReload] = useState(0);
  const [itemDrafts, setItemDrafts] = useState<Record<string, Draft>>({});
  const [processDrafts, setProcessDrafts] = useState<Record<string, Draft>>({});
  const [docDrafts, setDocDrafts] = useState<Record<string, DocDraft>>({});
  const [editingDoc, setEditingDoc] = useState<Record<string, string>>({});
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([apiFetch(`/api/v1/purchase-orders/${id}/followup`, { signal: controller.signal }),
      apiFetch("/auth/me", { signal: controller.signal })]).then(async ([followup, me]) => {
      const result = await read<Followup>(followup); const identity = await read<{ roles: string[] }>(me);
      if (controller.signal.aborted) return;
      setData(result); setRoles(identity.roles);
      setItemDrafts(Object.fromEntries(result.items.map(item => [item.id, draft(item, itemFields)])));
      setProcessDrafts(Object.fromEntries(result.processes.map(entry => [entry.process.id, draft(entry.process, processFields)])));
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Erro inesperado."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, reload]);
  const canWriteItem = roles.some(role => ["Master", "Administrador", "Importação", "Compras"].includes(role));
  const canWriteProcess = roles.some(role => ["Master", "Administrador", "Importação"].includes(role));
  async function send(path: string, method: string, body: unknown, version?: string) {
    return read(await apiFetch(path, { method, headers: { "content-type": "application/json",
      ...(version ? { "If-Match": `"${version}"` } : { "Idempotency-Key": crypto.randomUUID() }) }, body: JSON.stringify(body) }));
  }
  async function save(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(success); setReason(""); setReload(value => value + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Erro inesperado."); }
    finally { setBusy(false); }
  }
  function saveItem(event: FormEvent<HTMLFormElement>, itemId: string) {
    event.preventDefault(); if (!data) return;
    void save(() => send(`/api/v1/purchase-orders/${id}/items/${itemId}/followup`, "PATCH",
      { fields: payload(itemFields, itemDrafts[itemId]), reason }, data.version), "Prazos e dados do item atualizados.");
  }
  function saveProcess(event: FormEvent<HTMLFormElement>, processId: string, version: string) {
    event.preventDefault();
    void save(() => send(`/api/v1/processes/${processId}/followup`, "PATCH",
      { fields: payload(processFields, processDrafts[processId]), reason }, version), "Dados do IP atualizados.");
  }
  function documentBody(d: DocDraft, editing: boolean) {
    const body = { number: d.number, issueDate: d.issueDate || null,
      homologationDate: d.kind === "NF" ? d.homologationDate || null : null,
      quantity: d.kind === "INVOICE" ? d.quantity.replace(",", ".") || null : null,
      unitPrice: d.kind === "INVOICE" ? d.unitPrice.replace(",", ".") || null : null,
      amount: d.kind === "INVOICE" ? d.amount.replace(",", ".") || null : null,
      currencyCode: d.kind === "INVOICE" ? d.currencyCode.toUpperCase() || null : null,
      notes: d.notes, reason };
    return editing ? body : { ...body, kind: d.kind, purchaseOrderItemId: d.purchaseOrderItemId || null };
  }
  function saveDoc(event: FormEvent<HTMLFormElement>, processId: string, documents: Document[]) {
    event.preventDefault(); const d = docDrafts[processId] ?? blankDoc(); const activeId = editingDoc[processId];
    const current = documents.find(document => document.id === activeId);
    void save(async () => {
      await send(activeId ? `/api/v1/processes/${processId}/documents/${activeId}` : `/api/v1/processes/${processId}/documents`,
        activeId ? "PATCH" : "POST", documentBody(d, Boolean(activeId)), current?.version);
      setEditingDoc(previous => ({ ...previous, [processId]: "" }));
      setDocDrafts(previous => ({ ...previous, [processId]: blankDoc() }));
    }, activeId ? "Documento atualizado." : "Documento cadastrado.");
  }
  const processes = data?.processes ?? [];
  return <section className="card operational-panel" aria-label="Acompanhamento da PO">
    <h2>Acompanhamento da PO</h2>
    <p className="muted">Preencha os dados de cada item e dos IPs vinculados. Prazos, valores, status e alertas são calculados automaticamente. Campos sem dados suficientes aparecem como —. Os valores históricos continuam separados.</p>
    {loading && <p role="status">Carregando acompanhamento…</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {!loading && data && <>
      {(canWriteItem || canWriteProcess) && <label className="operational-reason">Justificativa das alterações
        <input value={reason} onChange={event => setReason(event.target.value)} minLength={3} maxLength={1000} required
          placeholder="Ex.: dados conferidos no TOTVS e nos documentos" /></label>}
      <h3>Dados e metas por item</h3>
      {data.items.length === 0 && <p>Cadastre o primeiro item da PO no painel acima.</p>}
      {data.items.map(item => <details key={item.id}><summary>Linha {item.lineNumber} · {item.productCode} · {item.orderedQuantity} {item.currencyCode ?? ""}</summary>
        {canWriteItem ? <form className="stack-form" onSubmit={event => saveItem(event, item.id)}>
          <FieldEditor fields={itemFields} values={itemDrafts[item.id] ?? {}} setValues={values => setItemDrafts(previous => ({ ...previous, [item.id]: values }))} />
          <button className="button" disabled={busy || reason.trim().length < 3}>Salvar dados do item</button></form> :
          <dl className="followup-grid">{itemFields.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{value(item[field.key])}</dd></div>)}</dl>}
      </details>)}
      <h3>Embarques e cálculos por item/IP</h3>
      {data.shipments.length === 0 && <p>Distribua uma quantidade do item a um IP no painel acima para calcular o acompanhamento por item/embarque. IPs vinculados historicamente aparecem abaixo para preenchimento de seus dados gerais.</p>}
      {data.shipments.map(entry => {
        const item = data.items.find(row => row.id === entry.itemId);
        return <details key={entry.allocationId}><summary>{item?.productCode ?? "Item"} · IP {entry.process.ipNumber} · {entry.allocationQuantity} unidades · {value(entry.calculated.status)}</summary>
          <p><Link className="text-link" href={`/processes/${entry.process.id}`}>Abrir IP {entry.process.ipNumber}</Link></p>
          <dl className="followup-grid">{calcLabels.map(([key, label]) => <div key={key}><dt>{label}</dt>
            <dd>{value(entry.calculated[key])}{key === "totalPrice" && entry.calculated[key] ? ` ${item?.currencyCode ?? ""}` : ""}</dd></div>)}</dl>
          <h4>Etapas T0 a T5</h4><dl className="followup-grid">{Object.entries(entry.calculated.stages as Record<string, { targetDays: number | null; actualDays: number | null; delayDays: number | null }>).map(([name, stage]) =>
            <div key={name}><dt>{name.toUpperCase()}</dt><dd>Meta {value(stage.targetDays)} · Real {value(stage.actualDays)} · Desvio {value(stage.delayDays)} dias</dd></div>)}</dl>
        </details>;
      })}
      {processes.map(entry => {
        const p = entry.process; const d = docDrafts[p.id] ?? blankDoc(); const activeId = editingDoc[p.id];
        const availableItems = data.items.filter(item => data.shipments.some(link => link.process.id === p.id && link.itemId === item.id));
        return <details key={p.id}><summary>Dados do IP {p.ipNumber} e documentos</summary>
          <p className="muted">O IP pode atender várias POs. Alterações aqui aparecem para todas elas. Informe cada Invoice, BL ou NF separadamente.</p>
          {canWriteProcess ? <form className="stack-form" onSubmit={event => saveProcess(event, p.id, p.version)}>
            <FieldEditor fields={processFields} values={processDrafts[p.id] ?? {}} setValues={values => setProcessDrafts(previous => ({ ...previous, [p.id]: values }))} />
            <button className="button" disabled={busy || reason.trim().length < 3}>Salvar dados do IP</button></form> :
            <dl className="followup-grid">{processFields.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{value(p[field.key])}</dd></div>)}</dl>}
          <h4>Invoice, BL e NF</h4>
          <p>Valor das Invoices deste IP: {entry.invoiceTotals.amounts.length ? entry.invoiceTotals.amounts.map(total => `${total.amount} ${total.currency}`).join(" · ") : "—"}
            {entry.invoiceTotals.incompleteLines > 0 && ` · ${entry.invoiceTotals.incompleteLines} linha(s) sem valor/moeda`}</p>
          {entry.documents.length === 0 && <p>Nenhum documento cadastrado.</p>}
          {entry.documents.map(doc => <div className="followup-document" key={doc.id}>
            <strong>{doc.kind} {doc.number}</strong> · {doc.issueDate ?? "sem data"} · {doc.purchaseOrderItemId ? data.items.find(item => item.id === doc.purchaseOrderItemId)?.productCode ?? "Item de outra PO" : "IP geral"}
            {doc.kind === "INVOICE" && <> · {doc.quantity ?? "—"} × {doc.unitPrice ?? "—"} · Valor {doc.amount ?? "calculado se possível"} {doc.currencyCode ?? ""}</>}
            {doc.kind === "NF" && <> · Homologação {doc.homologationDate ?? "—"}</>}
            {canWriteProcess && <div className="operational-actions"><button className="button secondary" type="button" onClick={() => {
              setEditingDoc(previous => ({ ...previous, [p.id]: doc.id }));
              setDocDrafts(previous => ({ ...previous, [p.id]: { kind: doc.kind, purchaseOrderItemId: doc.purchaseOrderItemId ?? "",
                number: doc.number, issueDate: doc.issueDate ?? "", homologationDate: doc.homologationDate ?? "",
                quantity: doc.quantity ?? "", unitPrice: doc.unitPrice ?? "", amount: doc.amount ?? "", currencyCode: doc.currencyCode ?? "", notes: doc.notes } }));
            }}>Editar</button><button className="button secondary" type="button" disabled={busy || reason.trim().length < 3}
              onClick={() => void save(() => send(`/api/v1/processes/${p.id}/documents/${doc.id}`, "DELETE", { reason }, doc.version), "Documento cancelado.")}>Cancelar</button></div>}
          </div>)}
          {canWriteProcess && <form className="stack-form" onSubmit={event => saveDoc(event, p.id, entry.documents)}>
            <h4>{activeId ? "Editar documento" : "Adicionar documento"}</h4>
            <div className="operational-fields">
              <label>Tipo<select disabled={Boolean(activeId)} value={d.kind} onChange={event => setDocDrafts(previous => ({ ...previous, [p.id]: { ...d, kind: event.target.value as DocDraft["kind"] } }))}>
                <option value="INVOICE">Invoice</option><option value="BL">BL</option><option value="NF">NF</option></select></label>
              <label>Item da PO<select disabled={Boolean(activeId)} value={d.purchaseOrderItemId} onChange={event => setDocDrafts(previous => ({ ...previous, [p.id]: { ...d, purchaseOrderItemId: event.target.value } }))}>
                <option value="">Documento geral do IP</option>{availableItems.map(item => <option key={item.id} value={item.id}>{item.productCode} · linha {item.lineNumber}</option>)}</select></label>
              <label>Número<input required maxLength={120} value={d.number} onChange={event => setDocDrafts(previous => ({ ...previous, [p.id]: { ...d, number: event.target.value } }))} /></label>
              <label>Emissão<input type="date" value={d.issueDate} onChange={event => setDocDrafts(previous => ({ ...previous, [p.id]: { ...d, issueDate: event.target.value } }))} /></label>
              {d.kind === "NF" && <label>Homologação<input type="date" value={d.homologationDate} onChange={event => setDocDrafts(previous => ({ ...previous, [p.id]: { ...d, homologationDate: event.target.value } }))} /></label>}
              {d.kind === "INVOICE" && <><label>Quantidade<input inputMode="decimal" value={d.quantity} onChange={event => setDocDrafts(previous => ({ ...previous, [p.id]: { ...d, quantity: event.target.value } }))} /></label>
                <label>Preço unitário<input inputMode="decimal" value={d.unitPrice} onChange={event => setDocDrafts(previous => ({ ...previous, [p.id]: { ...d, unitPrice: event.target.value } }))} /></label>
                <label>Valor informado da Invoice<input inputMode="decimal" value={d.amount} onChange={event => setDocDrafts(previous => ({ ...previous, [p.id]: { ...d, amount: event.target.value } }))} /></label>
                <label>Moeda<input maxLength={3} value={d.currencyCode} onChange={event => setDocDrafts(previous => ({ ...previous, [p.id]: { ...d, currencyCode: event.target.value.toUpperCase() } }))} /></label></>}
            </div>
            <label>Observações<textarea maxLength={4000} value={d.notes} onChange={event => setDocDrafts(previous => ({ ...previous, [p.id]: { ...d, notes: event.target.value } }))} /></label>
            <button className="button" disabled={busy || reason.trim().length < 3}>{activeId ? "Salvar documento" : "Adicionar documento"}</button>
            {activeId && <button className="button secondary" type="button" onClick={() => {
              setEditingDoc(previous => ({ ...previous, [p.id]: "" })); setDocDrafts(previous => ({ ...previous, [p.id]: blankDoc() }));
            }}>Cancelar edição</button>}
          </form>}
        </details>;
      })}
    </>}
  </section>;
}
