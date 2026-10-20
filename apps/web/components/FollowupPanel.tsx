"use client";

import { FormEvent, Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, readApiJson } from "../lib/api";
import { automaticAuditReason } from "../lib/audit";
import { formatNumber } from "../lib/format-number";
import { loadOperationalOptions, OperationalOption, OperationalOptionSelect } from "./OperationalOptionSelect";
import { purchaseOrderItemFields } from "./PurchaseOrderItemFields";
import { calculatedTotal } from "./PurchaseOrderCalculatedFields";
import { SearchableSelect } from "./SearchableSelect";

type Field = { key: string; label: string; type?: "date" | "number" | "money" | "boolean" | "select"; max?: number; entity?: string };
const processFields: Field[] = [
  { key: "logisticsStatus", label: "Status", type: "select", entity: "logistics_status" },
  { key: "priority", label: "Prioridade do IP", type: "select", entity: "priority" },
  { key: "ipTotvsDate", label: "Data do IP no TOTVS", type: "date" },
  { key: "transportMode", label: "Modal (SEA, AIR...) ", type: "select", entity: "transport_mode" },
  { key: "incoterm", label: "Incoterm", type: "select", entity: "incoterm" },
  { key: "broker", label: "Despachante", type: "select", entity: "broker" },
  { key: "portLoading", label: "POL / origem", type: "select", entity: "port_loading" }, { key: "portDischarge", label: "POD / destino", type: "select", entity: "port_discharge" },
  { key: "etd", label: "ETD", type: "date" }, { key: "etaConfirmed", label: "ETA confirmada", type: "date" },
  { key: "arrivalDate", label: "Chegada efetiva", type: "date" },
  { key: "duimpNumber", label: "DUIMP", max: 100 }, { key: "duimpDate", label: "Registro da DUIMP", type: "date" },
  { key: "customsChannel", label: "Canal", type: "select", entity: "customs_channel" }, { key: "clearanceDate", label: "Desembaraço", type: "date" },
  { key: "eteConfirmed", label: "ETE confirmada", type: "date" },
  { key: "nfRequestDate", label: "Solicitação da NF", type: "date" },
  { key: "deliveryDate", label: "Entrega efetiva", type: "date" },
  { key: "freightCurrency", label: "Moeda do frete", type: "select", entity: "currency" }, { key: "freightCost", label: "Frete", type: "money" },
  { key: "containerNumber", label: "Container", max: 120 }, { key: "containerType", label: "Tipo do container", type: "select", entity: "container_type" },
  { key: "containerQuantity", label: "Qtd. containers", type: "number" },
  { key: "forwarder", label: "Agente de carga", type: "select", entity: "forwarder" },
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
type Shipment = { allocationId: string; allocationVersion?: string; allocationNotes?: string;
  allocationQuantity: string; factoryShipDate?: string | null; legacyFactoryShipDate?: string | null; itemId: string;
  process: DataRow & { id: string; ipNumber: string; version: string };
  calculated: Calculated };
type ProcessDetail = { process: DataRow & { id: string; ipNumber: string; version: string;
  lifecycleStatus?: "OPEN" | "CLOSED"; closedAt?: string | null; closeReason?: string | null };
  documents: Document[]; invoiceTotals: { amounts: { currency: string; amount: string }[]; incompleteLines: number } };
type EventRecord = { id: string; aggregateType: "PURCHASE_ORDER" | "IMPORT_PROCESS"; aggregateLabel: string;
  relatedLabel: string | null;
  entityType: string; operation: string; oldValue: unknown; newValue: unknown; actorId: string;
  occurredAt: string; reason: string | null };
type Followup = { id: string; importer: string; number: string; version: string;
  supplierText?: string | null; orderDate?: string | null;
  items: (DataRow & { id: string; productCode: string; lineNumber: number; orderedQuantity: string; unitPrice: string | null; currencyCode: string | null })[];
  processes: ProcessDetail[]; shipments: Shipment[]; events: EventRecord[] };
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
function FieldEditor({ fields, values, setValues, options }: { fields: Field[]; values: Draft; setValues: (value: Draft) => void; options: OperationalOption[] }) {
  return <div className="operational-fields">{fields.map(field => <label key={field.key}>{field.label}
    {field.type === "boolean" ? <SearchableSelect ariaLabel={field.label} placeholder="" value={values[field.key] ?? ""}
      onChange={value => setValues({ ...values, [field.key]: value })}
      options={[{ value: "", label: "Não informado" }, { value: "true", label: "Sim" }, { value: "false", label: "Não" }]} /> :
      field.type === "select" ? <OperationalOptionSelect entity={field.entity ?? ""} value={values[field.key] ?? ""} values={options}
        onChange={value => setValues({ ...values, [field.key]: value })} /> :
      <input type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
        min={field.type === "number" ? 0 : undefined} maxLength={field.max}
        inputMode={field.type === "money" ? "decimal" : undefined}
        value={values[field.key] ?? ""} onChange={event => setValues({ ...values, [field.key]: event.target.value })} />}</label>)}</div>;
}
async function read<T>(response: Response): Promise<T> {
  return readApiJson<T>(response);
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
const numericCalculatedFields = new Set(["totalPrice", "transitDays", "leadTimeDays", "poApprovalDays", "poAfterScDays",
  "poDeviationDays", "factoryLeadDays", "actualTransitDays", "clearanceDays", "invoiceQuantity", "invoiceUnitPrice",
  "totalTargetDays", "totalActualDays", "totalDelayDays", "commercialDeviationDays"]);
const eventEntityLabels: Record<string, string> = {
  PURCHASE_ORDER: "Dados da PO", PURCHASE_ORDER_ITEM: "Item da PO", PO_ITEM_ALLOCATION: "Distribuição PO–IP",
  IMPORT_PROCESS: "Dados logísticos do IP", PROCESS_DOCUMENT: "Documento do IP",
};
const eventOperationLabels: Record<string, string> = { CREATE: "cadastrado", UPDATE: "alterado", FOLLOWUP_UPDATE: "dados atualizados", CANCEL: "cancelado", CLOSE: "encerrado", REOPEN: "reaberto" };
function eventSnapshot(value: unknown) { return value == null ? "Sem valor anterior" : JSON.stringify(value, null, 2); }
function eventDate(value: string) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short",
  timeZone: "America/Sao_Paulo" }).format(new Date(value)); }
function shipmentLines(data: Followup) {
  return data.items.flatMap<{ item: Followup["items"][number]; shipment: Shipment | null }>(item => {
    const allocations = data.shipments.filter(shipment => shipment.itemId === item.id);
    return allocations.length ? allocations.map(shipment => ({ item, shipment })) : [{ item, shipment: null }];
  });
}
type DocDraft = { kind: "INVOICE" | "BL" | "NF"; purchaseOrderItemId: string; number: string;
  issueDate: string; homologationDate: string; quantity: string; unitPrice: string; amount: string; currencyCode: string; notes: string };
const blankDoc = (): DocDraft => ({ kind: "INVOICE", purchaseOrderItemId: "", number: "", issueDate: "",
  homologationDate: "", quantity: "", unitPrice: "", amount: "", currencyCode: "", notes: "" });

export default function FollowupPanel({ id }: { id: string }) {
  const [data, setData] = useState<Followup>(); const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [compatibilityWarning, setCompatibilityWarning] = useState("");
  const [busy, setBusy] = useState(false); const [reload, setReload] = useState(0);
  const [processDrafts, setProcessDrafts] = useState<Record<string, Draft>>({});
  const [factoryShipDrafts, setFactoryShipDrafts] = useState<Record<string, string>>({});
  const [docDrafts, setDocDrafts] = useState<Record<string, DocDraft>>({});
  const [editingDoc, setEditingDoc] = useState<Record<string, string>>({});
  const [expandedLine, setExpandedLine] = useState("");
  const [options, setOptions] = useState<OperationalOption[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([apiFetch(`/api/v1/purchase-orders/${id}/followup`, { signal: controller.signal }),
      apiFetch("/auth/me", { signal: controller.signal }), loadOperationalOptions()]).then(async ([followup, me, optionValues]) => {
      const raw = await read<Partial<Followup>>(followup); const identity = await read<{ roles: string[] }>(me);
      if (!Array.isArray(raw.items) || !Array.isArray(raw.processes)) {
        throw new Error("A API retornou um formato antigo para o acompanhamento da PO. Atualize a API antes de continuar.");
      }
      const missingCollections = ["shipments", "events"].filter(key => !Array.isArray(raw[key as keyof Followup]));
      const processes = raw.processes.map(entry => ({ ...entry,
        documents: Array.isArray(entry.documents) ? entry.documents : [],
        invoiceTotals: entry.invoiceTotals ?? { amounts: [], incompleteLines: 0 } }));
      const result: Followup = { ...raw, items: raw.items, processes,
        shipments: Array.isArray(raw.shipments) ? raw.shipments : [],
        events: Array.isArray(raw.events) ? raw.events : [] } as Followup;
      const missingAllocationDates = result.shipments.length > 0 && result.shipments.some(entry =>
        typeof entry.allocationVersion !== "string" || !("factoryShipDate" in entry));
      if (controller.signal.aborted) return;
      setData(result); setRoles(identity.roles); setOptions(optionValues);
      setCompatibilityWarning([
        missingCollections.length
          ? `A API não retornou: ${missingCollections.join(", ")}.` : "",
        missingAllocationDates ? "A API ainda não suporta datas por divisão PO–IP; o campo ficará disponível após a atualização do serviço." : "",
      ].filter(Boolean).join(" "));
      setProcessDrafts(Object.fromEntries(result.processes.map(entry => [entry.process.id, draft(entry.process, processFields)])));
      setFactoryShipDrafts(Object.fromEntries(result.shipments.map(entry => [entry.allocationId, entry.factoryShipDate ?? ""])));
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Erro inesperado."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, reload]);
  const canWriteProcess = roles.some(role => ["Master", "Administrador", "Importação"].includes(role));
  async function send(path: string, method: string, body: unknown, version?: string) {
    return read(await apiFetch(path, { method, headers: { "content-type": "application/json",
      ...(version ? { "X-Record-Version": version } : { "Idempotency-Key": crypto.randomUUID() }) }, body: JSON.stringify(body) }));
  }
  async function save(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(success); setReload(value => value + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Erro inesperado."); }
    finally { setBusy(false); }
  }
  function saveProcess(event: FormEvent<HTMLFormElement>, processId: string, version: string) {
    event.preventDefault();
    void save(() => send(`/api/v1/processes/${processId}/followup`, "PATCH",
      { fields: payload(processFields, processDrafts[processId]), reason: automaticAuditReason }, version), "Dados do IP atualizados.");
  }
  function saveFactoryShipDate(event: FormEvent<HTMLFormElement>, shipment: Shipment) {
    event.preventDefault();
    const factoryShipDate = factoryShipDrafts[shipment.allocationId] ?? "";
    void save(() => send(`/api/v1/purchase-orders/${id}/allocations/${shipment.allocationId}`, "PATCH",
      { factoryShipDate: factoryShipDate || null, reason: automaticAuditReason }, shipment.allocationVersion),
    "Data de saída da fábrica atualizada para este IP.");
  }
  function documentBody(d: DocDraft, editing: boolean) {
    const body = { number: d.number, issueDate: d.issueDate || null,
      homologationDate: d.kind === "NF" ? d.homologationDate || null : null,
      quantity: d.kind === "INVOICE" ? d.quantity.replace(",", ".") || null : null,
      unitPrice: d.kind === "INVOICE" ? d.unitPrice.replace(",", ".") || null : null,
      amount: d.kind === "INVOICE" ? d.amount.replace(",", ".") || null : null,
      currencyCode: d.kind === "INVOICE" ? d.currencyCode.toUpperCase() || null : null,
      notes: d.notes, reason: automaticAuditReason };
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
  return <section id="shipment-followup" className="card operational-panel" aria-label="Acompanhamento da PO">
    <h2>Acompanhamento da PO</h2>
    <p className="muted">Prazos e alertas são calculados automaticamente após distribuir quantidades.</p>
    <details className="operational-help"><summary>Adicionar opções aos campos</summary><p>Fornecedores e produtos ficam em <Link className="text-link" href="/catalog">Cadastros</Link>; as demais opções ficam em <Link className="text-link" href="/catalog/values">Valores das entidades</Link>.</p></details>
    {loading && <p role="status">Carregando acompanhamento…</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {compatibilityWarning && <p className="notice" role="status">{compatibilityWarning}</p>}
    {!loading && data && <>
      <h3>Linhas da PO por IP</h3>
      <p className="muted">Cada distribuição gera uma linha. Os campos da PO vêm do pedido; os de pós embarque vêm do IP e aparecem em todas as linhas vinculadas a ele.</p>
      {data.items.length === 0 ? <p>Cadastre um item na PO para iniciar o acompanhamento.</p> :
        <div className="table-scroll po-ip-lines"><table><thead><tr>
          <th>PO</th><th>Produto</th><th>Qtd. pedida</th><th>IP</th><th>Qtd. neste IP</th><th>Status</th><th>ETA</th><th>Entrega</th><th>Detalhes</th>
        </tr></thead><tbody>{shipmentLines(data).map(({ item, shipment }) => {
          const process = shipment && processes.find(entry => entry.process.id === shipment.process.id);
          const documents = process?.documents ?? [];
          const rowId = shipment?.allocationId ?? item.id;
          const detailsId = `po-ip-line-${rowId}`;
          const lineExpanded = expandedLine === rowId;
          return <Fragment key={rowId}><tr>
            <td><strong>{data.number}</strong><small>{data.supplierText || "Fornecedor não informado"}</small></td>
            <td><strong>{item.productCode}</strong><small>{value(item.description)}</small></td>
            <td>{formatNumber(item.orderedQuantity)} {value(item.unit) === "—" ? "" : value(item.unit)}</td>
            <td>{shipment ? <strong>{shipment.process.ipNumber}</strong> : <span className="po-ip-pending">Sem IP</span>}</td>
            <td>{shipment ? `${formatNumber(shipment.allocationQuantity)} ${item.unit ?? ""}` : "—"}</td>
            <td>{shipment ? value(shipment.calculated.status) : /^(CANCELLED|CANCELED)$/i.test(String(item.sourceStatus ?? "")) ? "Cancelado" : "A distribuir"}</td>
            <td>{shipment ? value(shipment.calculated.eta) : "—"}</td>
            <td>{shipment ? value(shipment.process.deliveryDate) : "—"}</td>
            <td><button className="po-ip-line-toggle" type="button" aria-expanded={lineExpanded} aria-controls={detailsId}
              onClick={() => setExpandedLine(current => current === rowId ? "" : rowId)}>{lineExpanded ? "Ocultar linha" : "Ver linha"}</button></td>
          </tr>{lineExpanded && <tr className="po-ip-line-detail"><td colSpan={9}><section id={detailsId} className="po-ip-line-detail-panel">
              <h4>Pré embarque · PO {data.number}</h4>
              <dl className="followup-grid">
                {([["Importadora", data.importer], ["Fornecedor", data.supplierText], ["Data da PO", data.orderDate],
                  ["Produto", item.productCode], ["Descrição", item.description], ["Quantidade pedida", formatNumber(item.orderedQuantity)],
                  ["Preço unitário", item.unitPrice ? formatNumber(item.unitPrice) : null], ["Valor total", item.unitPrice ? calculatedTotal(item.orderedQuantity, item.unitPrice) : null],
                  ["Moeda", item.currencyCode]] as [string, unknown][]).map(([label, fieldValue]) =>
                  <div key={label}><dt>{label}</dt><dd>{value(fieldValue)}</dd></div>)}
                {purchaseOrderItemFields.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{field.type === "number" || field.type === "money" ? formatNumber(item[field.key]) : value(item[field.key])}</dd></div>)}
              </dl>
              {shipment ? <>
                <h4>Pós embarque · IP {shipment.process.ipNumber}</h4>
                <dl className="followup-grid">
                  <div><dt>Quantidade neste IP</dt><dd>{formatNumber(shipment.allocationQuantity)} {item.unit ?? ""}</dd></div>
                  <div><dt>Saída da fábrica</dt><dd>{value(shipment.factoryShipDate)}</dd></div>
                  <div><dt>Alerta</dt><dd>{value(shipment.calculated.alert)}</dd></div>
                  {processFields.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{field.type === "number" || field.type === "money" ? formatNumber(shipment.process[field.key]) : value(shipment.process[field.key])}</dd></div>)}
                </dl>
                {shipment.legacyFactoryShipDate && <p className="notice">Data antiga de saída da fábrica ({value(shipment.legacyFactoryShipDate)}) sem IP associado. Informe a data deste vínculo se necessário.</p>}
                {canWriteProcess && typeof shipment.allocationVersion === "string" && <form className="shipment-date-form" onSubmit={event => saveFactoryShipDate(event, shipment)}>
                  <label>Saída da fábrica deste IP<input type="date" value={factoryShipDrafts[shipment.allocationId] ?? ""}
                    onChange={event => setFactoryShipDrafts(current => ({ ...current, [shipment.allocationId]: event.target.value }))} /></label>
                  <button className="button secondary" disabled={busy || (factoryShipDrafts[shipment.allocationId] ?? "") === (shipment.factoryShipDate ?? "")}>Salvar data</button>
                </form>}
                <h4>Documentos do IP</h4>
                {documents.length ? <ul>{documents.map(document => <li key={document.id}>{document.kind} {document.number} · {value(document.issueDate)}
                  {document.kind === "INVOICE" ? ` · ${formatNumber(document.quantity)} un. · ${formatNumber(document.amount)} ${document.currencyCode ?? ""}` : ""}
                  {document.kind === "NF" ? ` · homologação ${value(document.homologationDate)}` : ""}</li>)}</ul> : <p>Nenhum documento registrado.</p>}
                <details><summary>Indicadores calculados</summary><dl className="followup-grid">{calcLabels.map(([key, label]) =>
                  <div key={key}><dt>{label}</dt><dd>{numericCalculatedFields.has(key) ? formatNumber(shipment.calculated[key]) : value(shipment.calculated[key])}</dd></div>)}</dl>
                  {shipment.calculated.stages && <dl className="followup-grid">{Object.entries(shipment.calculated.stages as Record<string, { targetDays: number | null; actualDays: number | null; delayDays: number | null }>).map(([name, stage]) =>
                    <div key={name}><dt>{name.toUpperCase()}</dt><dd>Meta {formatNumber(stage.targetDays)} · Real {formatNumber(stage.actualDays)} · Desvio {formatNumber(stage.delayDays)} dias</dd></div>)}</dl>}
                </details>
              </> : <p>Distribua uma quantidade deste item para um IP na seção acima.</p>}
            </section></td></tr>}</Fragment>;
        })}</tbody></table></div>}
      <h3>Atualizar pós embarque por IP</h3>
      <p className="muted">Preencha cada IP uma vez. As alterações serão exibidas em todas as linhas de PO ligadas a ele.</p>
      {processes.map(entry => {
        const p = entry.process;
        const totals = entry.invoiceTotals.amounts.map(total => `${formatNumber(total.amount)} ${total.currency}`).join(" · ") || "—";
        const documentDraft = docDrafts[p.id] ?? blankDoc();
        const editable = canWriteProcess && p.lifecycleStatus !== "CLOSED";
        return <article className="followup-document" key={p.id}>
          <details><summary>IP {p.ipNumber} · {p.lifecycleStatus === "CLOSED" ? "encerrado" : "aberto"} · {entry.documents.length} documento(s)</summary>
            <p>Invoices: {totals}{entry.invoiceTotals.incompleteLines ? ` · ${entry.invoiceTotals.incompleteLines} incompleta(s)` : ""}</p>
            {editable ? <form className="stack-form" onSubmit={event => saveProcess(event, p.id, p.version)}>
              <h4>Dados do IP</h4>
              <FieldEditor fields={processFields} values={processDrafts[p.id] ?? {}}
                setValues={values => setProcessDrafts(current => ({ ...current, [p.id]: values }))} options={options} />
              <button className="button" disabled={busy}>Salvar IP</button>
            </form> : <dl className="followup-grid">{processFields.map(field =>
              <div key={field.key}><dt>{field.label}</dt><dd>{field.type === "number" || field.type === "money" ? formatNumber(p[field.key]) : value(p[field.key])}</dd></div>)}</dl>}
            <h4>Invoices, BLs e NFs</h4>
            {entry.documents.length === 0 && <p>Nenhum documento registrado.</p>}
            {entry.documents.map(document => <div className="followup-document" key={document.id}>
              <strong>{document.kind} {document.number}</strong> · {value(document.issueDate)}
              {document.kind === "INVOICE" && <> · {formatNumber(document.quantity)} un. · {formatNumber(document.amount)} {document.currencyCode ?? ""}</>}
              {document.kind === "NF" && <> · homologação {value(document.homologationDate)}</>}
              {editable && <button className="button secondary" type="button" onClick={() => {
                setEditingDoc(current => ({ ...current, [p.id]: document.id }));
                setDocDrafts(current => ({ ...current, [p.id]: {
                  kind: document.kind, purchaseOrderItemId: document.purchaseOrderItemId ?? "",
                  number: document.number, issueDate: document.issueDate ?? "",
                  homologationDate: document.homologationDate ?? "", quantity: document.quantity ?? "",
                  unitPrice: document.unitPrice ?? "", amount: document.amount ?? "",
                  currencyCode: document.currencyCode ?? "", notes: document.notes,
                } }));
              }}>Editar documento</button>}
            </div>)}
            {editable && <form className="stack-form" onSubmit={event => saveDoc(event, p.id, entry.documents)}>
              <h4>{editingDoc[p.id] ? "Editar documento" : "Adicionar documento"}</h4>
              {!editingDoc[p.id] && <div className="operational-fields">
                <label>Tipo<SearchableSelect ariaLabel="Tipo do documento" placeholder="" value={documentDraft.kind}
                  onChange={kind => setDocDrafts(current => ({ ...current, [p.id]: { ...documentDraft, kind: kind as DocDraft["kind"] } }))}
                  options={[{ value: "INVOICE", label: "Invoice" }, { value: "BL", label: "BL" }, { value: "NF", label: "NF" }]} /></label>
                <label>Item relacionado<SearchableSelect ariaLabel="Item relacionado" placeholder="Documento geral do IP"
                  value={documentDraft.purchaseOrderItemId} onChange={purchaseOrderItemId => setDocDrafts(current => ({ ...current, [p.id]: { ...documentDraft, purchaseOrderItemId } }))}
                  options={data.shipments.filter(shipment => shipment.process.id === p.id).flatMap(shipment => {
                    const item = data.items.find(row => row.id === shipment.itemId);
                    return item ? [{ value: item.id, label: `${item.productCode} · linha ${item.lineNumber}`,
                      searchText: item.description == null ? "" : String(item.description) }] : [];
                  })} /></label>
              </div>}
              <div className="operational-fields">
                <label>Número<input required maxLength={120} value={documentDraft.number} onChange={event => setDocDrafts(current => ({ ...current, [p.id]: { ...documentDraft, number: event.target.value } }))} /></label>
                <label>Emissão<input type="date" value={documentDraft.issueDate} onChange={event => setDocDrafts(current => ({ ...current, [p.id]: { ...documentDraft, issueDate: event.target.value } }))} /></label>
                {documentDraft.kind === "NF" && <label>Homologação<input type="date" value={documentDraft.homologationDate} onChange={event => setDocDrafts(current => ({ ...current, [p.id]: { ...documentDraft, homologationDate: event.target.value } }))} /></label>}
                {documentDraft.kind === "INVOICE" && <>
                  <label>Quantidade<input inputMode="decimal" value={documentDraft.quantity} onChange={event => setDocDrafts(current => ({ ...current, [p.id]: { ...documentDraft, quantity: event.target.value } }))} /></label>
                  <label>Preço unitário<input inputMode="decimal" value={documentDraft.unitPrice} onChange={event => setDocDrafts(current => ({ ...current, [p.id]: { ...documentDraft, unitPrice: event.target.value } }))} /></label>
                  <label>Valor total<input inputMode="decimal" value={documentDraft.amount} onChange={event => setDocDrafts(current => ({ ...current, [p.id]: { ...documentDraft, amount: event.target.value } }))} /></label>
                  <label>Moeda<OperationalOptionSelect entity="currency" value={documentDraft.currencyCode} values={options}
                    onChange={currencyCode => setDocDrafts(current => ({ ...current, [p.id]: { ...documentDraft, currencyCode } }))} /></label>
                </>}
              </div>
              <label>Observações<textarea maxLength={4000} value={documentDraft.notes} onChange={event => setDocDrafts(current => ({ ...current, [p.id]: { ...documentDraft, notes: event.target.value } }))} /></label>
              <div className="operational-actions"><button className="button" disabled={busy}>{editingDoc[p.id] ? "Salvar documento" : "Adicionar documento"}</button>
                {editingDoc[p.id] && <button className="button secondary" type="button" onClick={() => {
                  setEditingDoc(current => ({ ...current, [p.id]: "" }));
                  setDocDrafts(current => ({ ...current, [p.id]: blankDoc() }));
                }}>Cancelar edição</button>}</div>
            </form>}
            <Link className="text-link" href={`/processes/${p.id}`}>Ver histórico completo do IP →</Link>
          </details>
        </article>;
      })}
      <details className="operational-event-history"><summary>Histórico de alterações ({data.events.length})</summary>
        {data.events.length === 0 ? <p>Nenhum evento registrado.</p> : <ol className="operational-event-list">{data.events.map(event => <li key={event.id}>
          <div className="operational-event-heading"><time dateTime={event.occurredAt}>{eventDate(event.occurredAt)}</time>
            <strong>{event.aggregateType === "IMPORT_PROCESS" ? `IP ${event.aggregateLabel}` : `PO ${event.aggregateLabel}`}</strong>
            <span>{eventEntityLabels[event.entityType] ?? event.entityType} · {eventOperationLabels[event.operation] ?? event.operation}</span>
            {event.relatedLabel && <span>{event.relatedLabel}</span>}
          </div>
          {event.reason && event.reason !== automaticAuditReason && <p>Justificativa: {event.reason}</p>}
          <details><summary>Ver valores registrados</summary><div className="operational-event-values">
            <div><strong>Antes</strong><pre>{eventSnapshot(event.oldValue)}</pre></div>
            <div><strong>Depois</strong><pre>{eventSnapshot(event.newValue)}</pre></div>
          </div></details>
        </li>)}</ol>}
      </details>
    </>}
  </section>;
}
