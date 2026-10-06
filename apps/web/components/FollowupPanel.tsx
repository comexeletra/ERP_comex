"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, readApiJson } from "../lib/api";
import { automaticAuditReason } from "../lib/audit";
import { loadOperationalOptions, OperationalOption, OperationalOptionSelect } from "./OperationalOptionSelect";

type Field = { key: string; label: string; type?: "date" | "number" | "money" | "boolean" | "select"; max?: number; entity?: string };
const processFields: Field[] = [
  { key: "logisticsStatus", label: "Status", type: "select", entity: "logistics_status" },
  { key: "priority", label: "Prioridade do IP", max: 20 },
  { key: "ipTotvsDate", label: "Data do IP no TOTVS", type: "date" },
  { key: "transportMode", label: "Modal (SEA, AIR...) ", type: "select", entity: "transport_mode" },
  { key: "incoterm", label: "Incoterm", type: "select", entity: "incoterm" }, { key: "broker", label: "Despachante", max: 160 },
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
type ProcessDetail = { process: DataRow & { id: string; ipNumber: string; version: string;
  lifecycleStatus?: "OPEN" | "CLOSED"; closedAt?: string | null; closeReason?: string | null };
  documents: Document[]; invoiceTotals: { amounts: { currency: string; amount: string }[]; incompleteLines: number } };
type EventRecord = { id: string; aggregateType: "PURCHASE_ORDER" | "IMPORT_PROCESS"; aggregateLabel: string;
  relatedLabel: string | null;
  entityType: string; operation: string; oldValue: unknown; newValue: unknown; actorId: string;
  occurredAt: string; reason: string | null };
type Followup = { id: string; importer: string; number: string; version: string;
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
    {field.type === "boolean" ? <select value={values[field.key] ?? ""} onChange={event => setValues({ ...values, [field.key]: event.target.value })}>
      <option value="">Não informado</option><option value="true">Sim</option><option value="false">Não</option></select> :
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
const eventEntityLabels: Record<string, string> = {
  PURCHASE_ORDER: "Dados da PO", PURCHASE_ORDER_ITEM: "Item da PO", PO_ITEM_ALLOCATION: "Distribuição PO–IP",
  IMPORT_PROCESS: "Dados logísticos do IP", PROCESS_DOCUMENT: "Documento do IP",
};
const eventOperationLabels: Record<string, string> = { CREATE: "cadastrado", UPDATE: "alterado", FOLLOWUP_UPDATE: "dados atualizados", CANCEL: "cancelado", CLOSE: "encerrado", REOPEN: "reaberto" };
function eventSnapshot(value: unknown) { return value == null ? "Sem valor anterior" : JSON.stringify(value, null, 2); }
function eventDate(value: string) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short",
  timeZone: "America/Sao_Paulo" }).format(new Date(value)); }
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
  const [docDrafts, setDocDrafts] = useState<Record<string, DocDraft>>({});
  const [editingDoc, setEditingDoc] = useState<Record<string, string>>({});
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
      if (controller.signal.aborted) return;
      setData(result); setRoles(identity.roles); setOptions(optionValues);
      setCompatibilityWarning(missingCollections.length
        ? `A API está desatualizada e não retornou: ${missingCollections.join(", ")}. Os dados principais foram carregados; solicite a atualização da API.`
        : "");
      setProcessDrafts(Object.fromEntries(result.processes.map(entry => [entry.process.id, draft(entry.process, processFields)])));
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
  return <section className="card operational-panel" aria-label="Acompanhamento da PO">
    <h2>Acompanhamento da PO</h2>
    <p className="muted">Prazos e alertas são calculados automaticamente após distribuir quantidades.</p>
    <details className="operational-help"><summary>Adicionar opções aos campos</summary><p>Fornecedores e produtos ficam em <Link className="text-link" href="/catalog">Cadastros</Link>; as demais opções ficam em <Link className="text-link" href="/catalog/values">Valores das entidades</Link>.</p></details>
    {loading && <p role="status">Carregando acompanhamento…</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {compatibilityWarning && <p className="notice" role="status">{compatibilityWarning}</p>}
    {!loading && data && <>
      <h3>Etapas por item e IP</h3>
      {data.shipments.length === 0 && <p>Distribua uma quantidade a um IP para acompanhar o embarque.</p>}
      {data.shipments.map(entry => {
        const item = data.items.find(row => row.id === entry.itemId);
        return <details key={entry.allocationId}><summary>{item?.productCode ?? "Item"} · IP {entry.process.ipNumber} · {entry.allocationQuantity} unidades · {value(entry.calculated.status)}</summary>
          <p><Link className="text-link" href={`/processes/${entry.process.id}`}>Abrir IP {entry.process.ipNumber}</Link></p>
          <h4>Marcos deste vínculo PO–IP</h4>
          <dl className="followup-grid shipment-milestones">
            {([["ETD", entry.process.etd], ["Saída efetiva", entry.process.actualPortDepartureDate], ["ETA", entry.calculated.eta], ["Arrival", entry.process.arrivalDate],
              ["DUIMP", entry.process.duimpDate], ["Desembaraço", entry.process.clearanceDate],
              ["Entrega", entry.process.deliveryDate]] as [string, unknown][]).map(([label, date]) =>
              <div key={String(label)}><dt>{label}</dt><dd>{value(date)}</dd></div>)}
            <div><dt>Quantidade alocada</dt><dd>{entry.allocationQuantity} {item?.unit ?? ""}</dd></div>
          </dl>
          <dl className="followup-grid">{calcLabels.map(([key, label]) => <div key={key}><dt>{label}</dt>
            <dd>{value(entry.calculated[key])}{key === "totalPrice" && entry.calculated[key] ? ` ${item?.currencyCode ?? ""}` : ""}</dd></div>)}</dl>
          <h4>Etapas T0 a T5</h4><dl className="followup-grid">{Object.entries(entry.calculated.stages as Record<string, { targetDays: number | null; actualDays: number | null; delayDays: number | null }>).map(([name, stage]) =>
            <div key={name}><dt>{name.toUpperCase()}</dt><dd>Meta {value(stage.targetDays)} · Real {value(stage.actualDays)} · Desvio {value(stage.delayDays)} dias</dd></div>)}</dl>
        </details>;
      })}
      <h3>Operações de Pós Embarque por IP</h3>
      <p className="muted">Documentos de pós-embarque são mantidos uma vez por IP.</p>
      {processes.map(entry => {
        const p = entry.process;
        const totals = entry.invoiceTotals.amounts.map(total => `${total.amount} ${total.currency}`).join(" · ") || "—";
        return <article className="followup-document" key={p.id}>
          <h4>IP {p.ipNumber} · {p.lifecycleStatus === "CLOSED" ? "encerrado" : "aberto"}</h4>
          <p>{entry.documents.length} documento(s) · Invoices: {totals}{entry.invoiceTotals.incompleteLines ? ` · ${entry.invoiceTotals.incompleteLines} incompleta(s)` : ""}</p>
          <Link className="button" href={`/processes/${p.id}`}>Abrir Pós Embarque do IP {p.ipNumber}</Link>
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
