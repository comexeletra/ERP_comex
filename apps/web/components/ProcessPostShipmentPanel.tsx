"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, hasIpLifecycleSupport, readApiJson } from "../lib/api";
import { automaticAuditReason } from "../lib/audit";
import { loadOperationalOptions, OperationalOption, OperationalOptionSelect } from "./OperationalOptionSelect";

type Value = string | number | boolean | null;
type Row = Record<string, Value>;
type Field = { key: string; label: string; type?: "date" | "number" | "money" | "boolean" | "select"; max?: number; entity?: string };
type Document = { id: string; kind: "INVOICE" | "BL" | "NF"; number: string; purchaseOrderItemId: string | null;
  issueDate: string | null; homologationDate: string | null; quantity: string | null; unitPrice: string | null;
  amount: string | null; currencyCode: string | null; notes: string; version: string };
type Allocation = { id: string; allocationQuantity: string; purchaseOrder: { id: string; number: string; importer: string };
  item: Row & { id: string; lineNumber: number; productCode: string; description: string; unit: string };
  calculated: Record<string, Value> };
type Event = { id: string; operation: string; occurredAt: string; reason: string | null; actorId: string };
type Data = { process: Row & { id: string; ipNumber: string; version: string; lifecycleStatus: "OPEN" | "CLOSED" };
  purchaseOrders: { id: string; number: string; importer: string; linkSource: string }[];
  allocations: Allocation[]; documents: Document[];
  invoiceTotals: { amounts: { currency: string; amount: string }[]; incompleteLines: number }; events: Event[] };
type LegacyProcess = Row & { id: string; ipNumber: string; purchaseOrders: Data["purchaseOrders"];
  operationalAllocations: { id: string; poId: string; poNumber: string; productCode: string; quantity: string; unit: string }[] };
type DocDraft = { kind: Document["kind"]; purchaseOrderItemId: string; number: string; issueDate: string;
  homologationDate: string; quantity: string; unitPrice: string; amount: string; currencyCode: string; notes: string };

const fields: Field[] = [
  { key: "logisticsStatus", label: "Status logístico", type: "select", entity: "logistics_status" },
  { key: "priority", label: "Prioridade do IP", max: 20 },
  { key: "ipTotvsDate", label: "Data do IP no TOTVS", type: "date" },
  { key: "actualPortDepartureDate", label: "Saída efetiva do porto de origem", type: "date" },
  { key: "transportMode", label: "Modal", type: "select", entity: "transport_mode" },
  { key: "incoterm", label: "Incoterm", type: "select", entity: "incoterm" },
  { key: "broker", label: "Despachante", max: 160 },
  { key: "portLoading", label: "Porto de origem", type: "select", entity: "port_loading" },
  { key: "portDischarge", label: "Porto de destino", type: "select", entity: "port_discharge" },
  { key: "etd", label: "ETD", type: "date" }, { key: "etaConfirmed", label: "ETA confirmada", type: "date" },
  { key: "arrivalDate", label: "Chegada efetiva", type: "date" }, { key: "duimpNumber", label: "DUIMP", max: 100 },
  { key: "duimpDate", label: "Registro da DUIMP", type: "date" },
  { key: "customsChannel", label: "Canal aduaneiro", type: "select", entity: "customs_channel" },
  { key: "clearanceDate", label: "Desembaraço", type: "date" }, { key: "eteConfirmed", label: "ETE confirmada", type: "date" },
  { key: "nfRequestDate", label: "Solicitação da NF", type: "date" }, { key: "deliveryDate", label: "Entrega efetiva", type: "date" },
  { key: "freightCurrency", label: "Moeda do frete", type: "select", entity: "currency" },
  { key: "freightCost", label: "Frete", type: "money" }, { key: "containerNumber", label: "Container", max: 120 },
  { key: "containerType", label: "Tipo de container", type: "select", entity: "container_type" },
  { key: "containerQuantity", label: "Quantidade de containers", type: "number" },
  { key: "forwarder", label: "Agente de carga", max: 160 },
  { key: "documentsOk", label: "Documentação conferida", type: "boolean" },
  { key: "storageDueOverride", label: "Vencimento confirmado da armazenagem", type: "date" },
  { key: "taxesPaidBrl", label: "Impostos pagos (R$)", type: "money" },
  { key: "fineBrl", label: "Multa (R$)", type: "money" }, { key: "storageBrl", label: "Armazenagem (R$)", type: "money" },
  { key: "demurrageBrl", label: "Demurrage (R$)", type: "money" },
  { key: "demurrageContainerQuantity", label: "Containers com demurrage", type: "number" },
];
const blankDoc = (): DocDraft => ({ kind: "INVOICE", purchaseOrderItemId: "", number: "", issueDate: "",
  homologationDate: "", quantity: "", unitPrice: "", amount: "", currencyCode: "", notes: "" });
function format(value: Value | undefined) { return value == null || value === "" ? "—" : typeof value === "boolean" ? value ? "Sim" : "Não" : String(value); }
function toDraft(row: Row) { return Object.fromEntries(fields.map(field => [field.key, row[field.key] == null ? "" : String(row[field.key])])) as Record<string, string>; }
function makePayload(values: Record<string, string>) {
  return Object.fromEntries(fields.map(field => {
    const value = values[field.key]?.trim() ?? "";
    return [field.key, value === "" ? null : field.type === "number" ? Number(value) :
      field.type === "boolean" ? value === "true" : field.type === "money" ? value.replace(",", ".") : value];
  }));
}

export default function ProcessPostShipmentPanel({ id }: { id: string }) {
  const [data, setData] = useState<Data>(); const [roles, setRoles] = useState<string[]>([]);
  const [legacyProcess, setLegacyProcess] = useState<LegacyProcess>();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [docDraft, setDocDraft] = useState<DocDraft>(blankDoc()); const [editingDoc, setEditingDoc] = useState<string>();
  const [options, setOptions] = useState<OperationalOption[]>([]); const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [compatibilityWarning, setCompatibilityWarning] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(""); setData(undefined); setLegacyProcess(undefined);
    setCompatibilityWarning("");
    Promise.all([apiFetch(`/api/v1/processes/${id}`, { signal: controller.signal }),
      apiFetch("/auth/me", { signal: controller.signal }), loadOperationalOptions()]).then(async ([response, identity, optionValues]) => {
      const user = await readApiJson<{ roles: string[] }>(identity);
      const summary = await readApiJson<LegacyProcess>(response);
      if (!hasIpLifecycleSupport(summary)) {
        if (!controller.signal.aborted) {
          setLegacyProcess(summary); setData(undefined); setRoles(user.roles); setOptions(optionValues);
          setCompatibilityWarning("A API publicada ainda não tem todos os recursos de acompanhamento do IP. Os vínculos e as quantidades já cadastrados são exibidos abaixo; documentos e demais dados do pós embarque dependem da atualização da API.");
        }
        return;
      }
      const followupResponse = await apiFetch(`/api/v1/processes/${id}/followup`, { signal: controller.signal });
      const raw = await readApiJson<Partial<Data>>(followupResponse);
      if (!raw.process) throw new Error("A API retornou um formato antigo para o Pós Embarque. Atualize a API antes de continuar.");
      const missingCollections = ["purchaseOrders", "allocations", "documents", "events"]
        .filter(key => !Array.isArray(raw[key as keyof Data]));
      const body: Data = { ...raw, process: raw.process,
        purchaseOrders: Array.isArray(raw.purchaseOrders) ? raw.purchaseOrders : [],
        allocations: Array.isArray(raw.allocations) ? raw.allocations : [],
        documents: Array.isArray(raw.documents) ? raw.documents : [],
        events: Array.isArray(raw.events) ? raw.events : [],
        invoiceTotals: raw.invoiceTotals ?? { amounts: [], incompleteLines: 0 } } as Data;
      if (!controller.signal.aborted) {
        setData(body); setLegacyProcess(undefined); setRoles(user.roles); setOptions(optionValues); setDraft(toDraft(body.process));
        setCompatibilityWarning(missingCollections.length
          ? `A API está desatualizada e não retornou: ${missingCollections.join(", ")}. Os dados principais foram carregados; solicite a atualização da API.`
          : "");
      }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Erro inesperado."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, reload]);
  const canWrite = Boolean(data && data.process.lifecycleStatus === "OPEN" && roles.some(role => ["Master", "Administrador", "Importação"].includes(role)));
  async function send(path: string, method: string, body: unknown, version?: string) {
    const response = await apiFetch(path, { method, headers: { "content-type": "application/json",
      ...(version ? { "X-Record-Version": version } : { "Idempotency-Key": crypto.randomUUID() }) }, body: JSON.stringify(body) });
    await readApiJson<unknown>(response);
  }
  async function save(event: FormEvent<HTMLFormElement>, action: () => Promise<void>, success: string) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(success); setEditingDoc(undefined); setDocDraft(blankDoc()); setReload(value => value + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Erro inesperado."); }
    finally { setBusy(false); }
  }
  function documentBody(value: DocDraft) {
    return { kind: value.kind, purchaseOrderItemId: value.purchaseOrderItemId || null, number: value.number,
      issueDate: value.issueDate || null, homologationDate: value.kind === "NF" ? value.homologationDate || null : null,
      quantity: value.kind === "INVOICE" ? value.quantity.replace(",", ".") || null : null,
      unitPrice: value.kind === "INVOICE" ? value.unitPrice.replace(",", ".") || null : null,
      amount: value.kind === "INVOICE" ? value.amount.replace(",", ".") || null : null,
      currencyCode: value.kind === "INVOICE" ? value.currencyCode.toUpperCase() || null : null,
      notes: value.notes, reason: automaticAuditReason };
  }
  const currencyTotals = data?.invoiceTotals.amounts.map(item => `${item.amount} ${item.currency}`).join(" · ") || "—";
  return <section className="card operational-panel" aria-label="Pós Embarque do IP">
    <h2>Pós Embarque · operação do IP</h2>
    <p className="muted">Um registro por IP. Aqui ficam os dados da operação e os documentos do IP, reunindo todas as POs relacionadas.</p>
    {loading && <p role="status">Carregando Pós Embarque…</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {compatibilityWarning && <p className="notice" role="status">{compatibilityWarning}</p>}
    {!loading && legacyProcess && <>
      <h3>POs nesta operação</h3>
      {legacyProcess.purchaseOrders.length === 0 ? <p>Nenhuma PO vinculada ao IP.</p> :
        <ul>{legacyProcess.purchaseOrders.map(po => <li key={po.id}><Link className="text-link" href={`/purchase-orders/${po.id}`}>PO {po.number}</Link> · {po.importer}</li>)}</ul>}
      <h3>POs, itens e quantidades nesta operação</h3>
      {legacyProcess.operationalAllocations.length === 0 ? <p>Nenhuma quantidade distribuída operacionalmente. Para vincular uma PO, abra a PO e distribua a quantidade do item para este IP.</p> :
        <div className="table-scroll"><table><thead><tr><th>PO</th><th>Produto</th><th>Quantidade</th></tr></thead><tbody>
          {legacyProcess.operationalAllocations.map(item => <tr key={item.id}><td><Link className="text-link" href={`/purchase-orders/${item.poId}`}>{item.poNumber}</Link></td>
            <td>{item.productCode}</td><td>{item.quantity} {item.unit}</td></tr>)}
        </tbody></table></div>}
    </>}
    {!loading && data && <>
      <h3>POs nesta operação</h3>
      {data.purchaseOrders.length === 0 ? <p>Nenhuma PO vinculada ao IP.</p> :
        <ul>{data.purchaseOrders.map(po => <li key={po.id}><Link className="text-link" href={`/purchase-orders/${po.id}`}>PO {po.number}</Link> · {po.importer}</li>)}</ul>}
      <h3>Dados operacionais</h3>
      {canWrite ? <>
        <form className="stack-form" onSubmit={event => void save(event, async () => {
          await send(`/api/v1/processes/${id}/followup`, "PATCH", { fields: makePayload(draft), reason: automaticAuditReason }, data.process.version);
        }, "Dados do Pós Embarque atualizados.")}>
          <div className="operational-fields">{fields.map(field => <label key={field.key}>{field.label}
            {field.type === "boolean" ? <select value={draft[field.key] ?? ""} onChange={event => setDraft({ ...draft, [field.key]: event.target.value })}>
              <option value="">Não informado</option><option value="true">Sim</option><option value="false">Não</option></select> :
              field.type === "select" ? <OperationalOptionSelect entity={field.entity ?? ""} value={draft[field.key] ?? ""} values={options}
                onChange={value => setDraft({ ...draft, [field.key]: value })} /> :
                <input type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
                  min={field.type === "number" ? 0 : undefined} maxLength={field.max}
                  inputMode={field.type === "money" ? "decimal" : undefined} value={draft[field.key] ?? ""}
                  onChange={event => setDraft({ ...draft, [field.key]: event.target.value })} />}
          </label>)}</div>
          <button className="button" disabled={busy}>{busy ? "Salvando…" : "Salvar dados do IP"}</button>
        </form>
      </> : <dl className="followup-grid">{fields.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{format(data.process[field.key])}</dd></div>)}</dl>}
      <h3>POs, itens e quantidades nesta operação</h3>
      {data.allocations.length === 0 ? <p>Nenhum item operacional distribuído para este IP.</p> :
        <div className="table-scroll"><table><thead><tr><th>PO</th><th>Item</th><th>Pedido</th><th>Neste IP</th><th>Status calculado</th><th>Alerta</th></tr></thead><tbody>
          {data.allocations.map(allocation => <tr key={allocation.id}><td><Link className="text-link" href={`/purchase-orders/${allocation.purchaseOrder.id}`}>{allocation.purchaseOrder.number}</Link></td>
            <td>{allocation.item.productCode} · {allocation.item.description}</td>
            <td>{String(allocation.item.orderedQuantity)} {allocation.item.unit}</td><td>{allocation.allocationQuantity} {allocation.item.unit}</td>
            <td>{format(allocation.calculated.status)}</td><td>{format(allocation.calculated.alert)}</td></tr>)}
        </tbody></table></div>}
      <h3>Invoices, BLs e NFs deste IP</h3>
      <p>Total das Invoices: {currencyTotals}{data.invoiceTotals.incompleteLines ? ` · ${data.invoiceTotals.incompleteLines} linha(s) sem valor ou moeda` : ""}</p>
      {data.documents.map(document => <div className="followup-document" key={document.id}>
        <strong>{document.kind} {document.number}</strong> · {document.issueDate ?? "sem data"} · {document.purchaseOrderItemId
          ? data.allocations.find(item => item.item.id === document.purchaseOrderItemId)?.item.productCode ?? "Item relacionado a PO" : "IP geral"}
        {document.kind === "INVOICE" && <> · {document.quantity ?? "—"} × {document.unitPrice ?? "—"} · {document.amount ?? "valor calculado"} {document.currencyCode ?? ""}</>}
        {document.kind === "NF" && <> · Homologação {document.homologationDate ?? "—"}</>}
        {canWrite && <div className="operational-actions"><button type="button" className="button secondary" onClick={() => {
          setEditingDoc(document.id); setDocDraft({ kind: document.kind, purchaseOrderItemId: document.purchaseOrderItemId ?? "",
            number: document.number, issueDate: document.issueDate ?? "", homologationDate: document.homologationDate ?? "",
            quantity: document.quantity ?? "", unitPrice: document.unitPrice ?? "", amount: document.amount ?? "",
            currencyCode: document.currencyCode ?? "", notes: document.notes });
        }}>Editar</button><button type="button" className="button secondary" disabled={busy}
          onClick={() => void (async () => { setBusy(true); setError(""); try {
            await send(`/api/v1/processes/${id}/documents/${document.id}`, "DELETE", { reason: automaticAuditReason }, document.version);
            setNotice("Documento cancelado."); setReload(value => value + 1);
          } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro inesperado."); } finally { setBusy(false); } })()}>Cancelar</button></div>}
        {editingDoc === document.id && <form className="stack-form" onSubmit={event => void save(event, async () => {
          await send(`/api/v1/processes/${id}/documents/${document.id}`, "PATCH", { ...documentBody(docDraft), kind: undefined, purchaseOrderItemId: undefined }, document.version);
        }, "Documento atualizado.")}>
          <label>Número<input required maxLength={120} value={docDraft.number} onChange={event => setDocDraft({ ...docDraft, number: event.target.value })} /></label>
          <label>Emissão<input type="date" value={docDraft.issueDate} onChange={event => setDocDraft({ ...docDraft, issueDate: event.target.value })} /></label>
          {docDraft.kind === "NF" && <label>Homologação<input type="date" value={docDraft.homologationDate} onChange={event => setDocDraft({ ...docDraft, homologationDate: event.target.value })} /></label>}
          {docDraft.kind === "INVOICE" && <><label>Quantidade<input inputMode="decimal" value={docDraft.quantity} onChange={event => setDocDraft({ ...docDraft, quantity: event.target.value })} /></label>
            <label>Preço unitário<input inputMode="decimal" value={docDraft.unitPrice} onChange={event => setDocDraft({ ...docDraft, unitPrice: event.target.value })} /></label>
            <label>Valor informado<input inputMode="decimal" value={docDraft.amount} onChange={event => setDocDraft({ ...docDraft, amount: event.target.value })} /></label>
            <label>Moeda<OperationalOptionSelect entity="currency" value={docDraft.currencyCode} values={options} onChange={value => setDocDraft({ ...docDraft, currencyCode: value })} /></label></>}
          <label>Observações<textarea maxLength={4000} value={docDraft.notes} onChange={event => setDocDraft({ ...docDraft, notes: event.target.value })} /></label>
          <button className="button" disabled={busy}>Salvar documento</button>
        </form>}
      </div>)}
      {canWrite && <form className="stack-form" onSubmit={event => void save(event, async () => {
        await send(`/api/v1/processes/${id}/documents`, "POST", documentBody(docDraft));
      }, "Documento cadastrado.")}>
        <h4>{editingDoc ? "Edite o documento selecionado acima" : "Adicionar documento ao IP"}</h4>
        {!editingDoc && <><div className="operational-fields">
          <label>Tipo<select value={docDraft.kind} onChange={event => setDocDraft({ ...docDraft, kind: event.target.value as DocDraft["kind"] })}>
            <option value="INVOICE">Invoice</option><option value="BL">BL</option><option value="NF">NF</option></select></label>
          <label>Item relacionado<select value={docDraft.purchaseOrderItemId} onChange={event => setDocDraft({ ...docDraft, purchaseOrderItemId: event.target.value })}>
            <option value="">Documento geral do IP</option>{data.allocations.map(allocation => <option key={allocation.item.id} value={allocation.item.id}>
              PO {allocation.purchaseOrder.number} · {allocation.item.productCode} · linha {allocation.item.lineNumber}</option>)}</select></label>
          <label>Número<input required maxLength={120} value={docDraft.number} onChange={event => setDocDraft({ ...docDraft, number: event.target.value })} /></label>
          <label>Emissão<input type="date" value={docDraft.issueDate} onChange={event => setDocDraft({ ...docDraft, issueDate: event.target.value })} /></label>
          {docDraft.kind === "NF" && <label>Homologação<input type="date" value={docDraft.homologationDate} onChange={event => setDocDraft({ ...docDraft, homologationDate: event.target.value })} /></label>}
          {docDraft.kind === "INVOICE" && <><label>Quantidade<input inputMode="decimal" value={docDraft.quantity} onChange={event => setDocDraft({ ...docDraft, quantity: event.target.value })} /></label>
            <label>Preço unitário<input inputMode="decimal" value={docDraft.unitPrice} onChange={event => setDocDraft({ ...docDraft, unitPrice: event.target.value })} /></label>
            <label>Valor informado<input inputMode="decimal" value={docDraft.amount} onChange={event => setDocDraft({ ...docDraft, amount: event.target.value })} /></label>
            <label>Moeda<OperationalOptionSelect entity="currency" value={docDraft.currencyCode} values={options} onChange={value => setDocDraft({ ...docDraft, currencyCode: value })} /></label></>}
        </div><label>Observações<textarea maxLength={4000} value={docDraft.notes} onChange={event => setDocDraft({ ...docDraft, notes: event.target.value })} /></label></>}
        <button className="button" disabled={busy || Boolean(editingDoc)}>{busy ? "Salvando…" : "Adicionar documento"}</button>
      </form>}
      <h3>Histórico do IP</h3>
      {data.events.length === 0 ? <p>Nenhum evento operacional registrado.</p> : <ol>{data.events.map(event =>
        <li key={event.id}>{new Date(event.occurredAt).toLocaleString("pt-BR")} · {event.operation}{event.reason && event.reason !== automaticAuditReason ? ` · ${event.reason}` : ""}</li>)}</ol>}
    </>}
  </section>;
}
