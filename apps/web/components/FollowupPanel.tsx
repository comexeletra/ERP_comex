"use client";

import { FormEvent, Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, readApiJson } from "../lib/api";
import { automaticAuditReason } from "../lib/audit";
import { E2E_STAGE_CODES, type E2eResult } from "../lib/e2e-analysis";
import { formatNumber } from "../lib/format-number";
import { booleanOptions, displayValue, fieldLabel, statusLabel } from "../lib/i18n/labels";
import type { Messages } from "../lib/i18n/pt-BR";
import { IpCalculatedSummary as IpSummary, IpPostShipmentField, ipPostShipmentFields, newProcessDocumentKinds,
  productLineIpFields, withDateWarnings } from "../lib/ip-post-shipment-fields";
import { getMessages, useI18n } from "./I18nProvider";
import IpCalculatedSummary from "./IpCalculatedSummary";
import { itemShipmentSummary } from "../lib/purchase-order-lines";
import { loadOperationalOptions, OperationalOption, OperationalOptionSelect } from "./OperationalOptionSelect";
import { purchaseOrderItemFields } from "./PurchaseOrderItemFields";
import { calculatedTotal } from "./PurchaseOrderCalculatedFields";
import { SearchableSelect } from "./SearchableSelect";

type Field = IpPostShipmentField;
const processFields: Field[] = ipPostShipmentFields;
type DataRow = Record<string, string | number | boolean | null | undefined>;
type Document = { id: string; kind: "INVOICE" | "BL" | "NF"; number: string;
  purchaseOrderItemId: string | null; issueDate: string | null; homologationDate: string | null;
  quantity: string | null; unitPrice: string | null; amount: string | null; currencyCode: string | null;
  notes: string; status: string; version: string };
type Calculated = Record<string, string | number | boolean | null | string[] | Record<string, { targetDays: number | null; actualDays: number | null; delayDays: number | null }>>;
type Shipment = { allocationId: string; allocationVersion?: string; allocationNotes?: string;
  allocationQuantity: string; factoryShipDate?: string | null; legacyFactoryShipDate?: string | null; itemId: string;
  process: DataRow & { id: string; ipNumber: string; version: string };
  calculated: Calculated };
type ProcessDetail = { process: DataRow & { id: string; ipNumber: string; version: string;
  lifecycleStatus?: "OPEN" | "CLOSED"; closedAt?: string | null; closeReason?: string | null };
  calculated?: IpSummary;
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
  const { m } = useI18n();
  return <div className="operational-fields">{fields.map(field => <label key={field.key}>{fieldLabel(m, field)}
    {field.type === "boolean" ? <SearchableSelect ariaLabel={fieldLabel(m, field)} placeholder="" value={values[field.key] ?? ""}
      onChange={value => setValues({ ...values, [field.key]: value })}
      options={booleanOptions(m)} /> :
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
/** Calculated indicators shown for each PO line, in display order. */
const calcKeys: (keyof Messages["calc"])[] = [
  "status", "alert", "ruptureRisk", "totalPrice", "eta", "ete", "transitDays", "storageDueDate", "leadTimeDays",
  "poApprovalDays", "poAfterScDays", "poOnTime", "poDeviationDays", "factoryLeadDays", "actualTransitDays", "clearanceDays",
  "billDate", "nfIssueDate", "nfHomologationDate", "billNumber", "invoiceNumbers", "nfNumber",
  "informedStatus", "invoiceQuantity", "quantityMatchesInvoice", "invoiceUnitPrice", "priceMatchesInvoice",
  "totalTargetDays", "totalActualDays", "totalDelayDays", "bottleneck", "arrivalYearMonth",
];
const numericCalculatedFields = new Set(["totalPrice", "transitDays", "leadTimeDays", "poApprovalDays", "poAfterScDays",
  "poDeviationDays", "factoryLeadDays", "actualTransitDays", "clearanceDays", "invoiceQuantity", "invoiceUnitPrice",
  "totalTargetDays", "totalActualDays", "totalDelayDays"]);
const e2eOf = (shipment: Shipment) => (shipment.calculated as { e2e?: E2eResult | null }).e2e ?? null;
function eventSnapshot(value: unknown, m: Messages) { return value == null ? m.events.noPrevious : JSON.stringify(value, null, 2); }
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
const documentKindLabels: Record<string, string> = { INVOICE: "Invoice", NF: "NF" };
const documentKindOptions = newProcessDocumentKinds.map(kind => ({ value: kind, label: documentKindLabels[kind] ?? kind }));

export default function FollowupPanel({ id }: { id: string }) {
  const { m } = useI18n();
  const t = m.followup;
  const value = (raw: unknown) => displayValue(m, raw);
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
        throw new Error(getMessages().followup.oldApiFormat);
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
      const text = getMessages().followup;
      setCompatibilityWarning([
        missingCollections.length ? text.missingCollections(missingCollections.join(", ")) : "",
        missingAllocationDates ? text.noAllocationDates : "",
      ].filter(Boolean).join(" "));
      setProcessDrafts(Object.fromEntries(result.processes.map(entry => [entry.process.id, draft(entry.process, processFields)])));
      setFactoryShipDrafts(Object.fromEntries(result.shipments.map(entry => [entry.allocationId, entry.factoryShipDate ?? ""])));
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : getMessages().common.unexpectedError); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, reload]);
  const canWriteProcess = roles.some(role => ["Master", "Administrador", "Importação"].includes(role));
  async function send(path: string, method: string, body: unknown, version?: string) {
    return read(await apiFetch(path, { method, headers: { "content-type": "application/json",
      ...(version ? { "X-Record-Version": version } : { "Idempotency-Key": crypto.randomUUID() }) }, body: JSON.stringify(body) }));
  }
  async function save(action: () => Promise<unknown>, success: string | ((result: unknown) => string)) {
    setBusy(true); setError(""); setNotice("");
    try { const result = await action(); setNotice(typeof success === "string" ? success : success(result)); setReload(value => value + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : m.common.unexpectedError); }
    finally { setBusy(false); }
  }
  function saveProcess(event: FormEvent<HTMLFormElement>, processId: string, version: string) {
    event.preventDefault();
    void save(() => send(`/api/v1/processes/${processId}/followup`, "PATCH",
      { fields: payload(processFields, processDrafts[processId]), reason: automaticAuditReason }, version),
    result => withDateWarnings(t.ipUpdated, result, m));
  }
  function saveFactoryShipDate(event: FormEvent<HTMLFormElement>, shipment: Shipment) {
    event.preventDefault();
    const factoryShipDate = factoryShipDrafts[shipment.allocationId] ?? "";
    void save(() => send(`/api/v1/purchase-orders/${id}/allocations/${shipment.allocationId}`, "PATCH",
      { factoryShipDate: factoryShipDate || null, reason: automaticAuditReason }, shipment.allocationVersion),
    t.factoryShipSaved);
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
    }, activeId ? t.documentUpdated : t.documentCreated);
  }
  const processes = data?.processes ?? [];
  return <section id="shipment-followup" className="card operational-panel" aria-label={t.title}>
    <h2>{t.title}</h2>
    <p className="muted">{t.intro}</p>
    <details className="operational-help"><summary>{t.addOptions}</summary><p>{t.optionsBefore}<Link className="text-link" href="/catalog">{t.optionsCatalog}</Link>{t.optionsMiddle}<Link className="text-link" href="/catalog/values">{t.optionsValues}</Link>{t.optionsAfter}</p></details>
    {loading && <p role="status">{t.loading}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {compatibilityWarning && <p className="notice warning" role="status">{compatibilityWarning}</p>}
    {!loading && data && <>
      {data.items.length > 0 && <>
        <h3>{t.itemSummary}</h3>
        <p className="muted">{t.itemSummaryHelp}</p>
        <div className="table-scroll"><table><thead><tr>
          <th>{t.product}</th><th>{t.ordered}</th><th>{t.toDistribute}</th><th>{t.byStatus}</th><th>{t.nextEta}</th>
        </tr></thead><tbody>{data.items.map(item => {
          const summary = itemShipmentSummary(item.orderedQuantity,
            /^(CANCELLED|CANCELED)$/i.test(String(item.sourceStatus ?? "")),
            data.shipments.filter(shipment => shipment.itemId === item.id).map(shipment => ({
              quantity: shipment.allocationQuantity, status: String(shipment.calculated.status ?? ""),
              eta: typeof shipment.calculated.eta === "string" ? shipment.calculated.eta : null })));
          return <tr key={item.id}>
            <td><strong>{item.productCode}</strong><small>{value(item.description)}</small></td>
            <td>{formatNumber(item.orderedQuantity)} {value(item.unit) === "—" ? "" : value(item.unit)}</td>
            <td>{formatNumber(summary.toDistribute)}</td>
            <td>{summary.byStatus.length ? summary.byStatus.map(entry => `${statusLabel(m, entry.status)}: ${formatNumber(entry.quantity)}`).join(" · ") : "—"}</td>
            <td>{value(summary.nextEta)}</td>
          </tr>;
        })}</tbody></table></div>
      </>}
      <h3>{t.linesTitle}</h3>
      <p className="muted">{t.linesHelp}</p>
      {data.items.length === 0 ? <p>{t.noItems}</p> :
        <div className="table-scroll po-ip-lines"><table><thead><tr>
          <th>PO</th><th>{t.product}</th><th>{t.ordered}</th><th>IP</th><th>{t.inThisIp}</th><th>{t.status}</th><th>ETD</th><th>{t.departure}</th><th>{m.fields.blDate}</th><th>ETA</th><th>{t.arrival}</th><th>ETE</th><th>{t.delivery}</th><th>{t.details}</th>
        </tr></thead><tbody>{shipmentLines(data).map(({ item, shipment }) => {
          const process = shipment && processes.find(entry => entry.process.id === shipment.process.id);
          const documents = process?.documents ?? [];
          const rowId = shipment?.allocationId ?? item.id;
          const detailsId = `po-ip-line-${rowId}`;
          const lineExpanded = expandedLine === rowId;
          return <Fragment key={rowId}><tr>
            <td><strong>{data.number}</strong><small>{data.supplierText || t.noSupplier}</small></td>
            <td><strong>{item.productCode}</strong><small>{value(item.description)}</small></td>
            <td>{formatNumber(item.orderedQuantity)} {value(item.unit) === "—" ? "" : value(item.unit)}</td>
            <td>{shipment ? <strong>{shipment.process.ipNumber}</strong> : <span className="po-ip-pending">{t.noIp}</span>}</td>
            <td>{shipment ? `${formatNumber(shipment.allocationQuantity)} ${item.unit ?? ""}` : "—"}</td>
            <td>{shipment ? value(statusLabel(m, shipment.calculated.status)) : /^(CANCELLED|CANCELED)$/i.test(String(item.sourceStatus ?? "")) ? t.lineCancelled : t.toDistribute}</td>
            <td>{shipment ? value(shipment.process.etd) : "—"}</td>
            <td>{shipment ? value(shipment.process.actualPortDepartureDate) : "—"}</td>
            <td>{shipment ? value(shipment.process.blDate) : "—"}</td>
            <td>{shipment ? value(shipment.calculated.eta) : "—"}</td>
            <td>{shipment ? value(shipment.process.arrivalDate) : "—"}</td>
            <td>{shipment ? value(shipment.calculated.ete) : "—"}</td>
            <td>{shipment ? value(shipment.process.deliveryDate) : "—"}</td>
            <td><button className="po-ip-line-toggle" type="button" aria-expanded={lineExpanded} aria-controls={detailsId}
              onClick={() => setExpandedLine(current => current === rowId ? "" : rowId)}>{lineExpanded ? t.hideLine : t.showLine}</button></td>
          </tr>{lineExpanded && <tr className="po-ip-line-detail"><td colSpan={14}><section id={detailsId} className="po-ip-line-detail-panel">
              <h4>{t.preShipmentPo(data.number)}</h4>
              <dl className="followup-grid">
                {([[t.importer, data.importer], [t.supplier, data.supplierText], [t.poDate, data.orderDate],
                  [t.product, item.productCode], [t.description, item.description], [t.orderedQuantity, formatNumber(item.orderedQuantity)],
                  [t.unitPrice, item.unitPrice ? formatNumber(item.unitPrice) : null], [t.totalValue, item.unitPrice ? calculatedTotal(item.orderedQuantity, item.unitPrice, m) : null],
                  [t.currency, item.currencyCode]] as [string, unknown][]).map(([label, fieldValue]) =>
                  <div key={label}><dt>{label}</dt><dd>{value(fieldValue)}</dd></div>)}
                {purchaseOrderItemFields.map(field => <div key={field.key}><dt>{fieldLabel(m, field)}</dt><dd>{field.type === "number" || field.type === "money" ? formatNumber(item[field.key]) : value(item[field.key])}</dd></div>)}
              </dl>
              {shipment ? <>
                <h4>{t.postShipmentIp(shipment.process.ipNumber)}</h4>
                <dl className="followup-grid">
                  <div><dt>{t.quantityInIp}</dt><dd>{formatNumber(shipment.allocationQuantity)} {item.unit ?? ""}</dd></div>
                  <div><dt>{t.factoryShip}</dt><dd>{value(shipment.factoryShipDate)}</dd></div>
                  <div><dt>{t.alert}</dt><dd>{value(shipment.calculated.alert)}</dd></div>
                  {productLineIpFields.map(field => <div key={field.key}><dt>{fieldLabel(m, field)}</dt><dd>{field.type === "number" || field.type === "money" ? formatNumber(shipment.process[field.key]) : value(shipment.process[field.key])}</dd></div>)}
                </dl>
                {shipment.legacyFactoryShipDate && <p className="notice">{t.legacyFactoryShip(value(shipment.legacyFactoryShipDate))}</p>}
                {canWriteProcess && typeof shipment.allocationVersion === "string" && <form className="shipment-date-form" onSubmit={event => saveFactoryShipDate(event, shipment)}>
                  <label>{t.factoryShipForIp}<input type="date" value={factoryShipDrafts[shipment.allocationId] ?? ""}
                    onChange={event => setFactoryShipDrafts(current => ({ ...current, [shipment.allocationId]: event.target.value }))} /></label>
                  <button className="button secondary" disabled={busy || (factoryShipDrafts[shipment.allocationId] ?? "") === (shipment.factoryShipDate ?? "")}>{t.saveDate}</button>
                </form>}
                <h4>{t.ipDocuments}</h4>
                {documents.length ? <ul>{documents.map(document => <li key={document.id}>{document.kind} {document.number} · {value(document.issueDate)}
                  {document.kind === "INVOICE" ? ` · ${formatNumber(document.quantity)} ${t.units} · ${formatNumber(document.amount)} ${document.currencyCode ?? ""}` : ""}
                  {document.kind === "NF" ? ` · ${t.homologation(value(document.homologationDate))}` : ""}</li>)}</ul> : <p>{t.noDocuments}</p>}
                <details><summary>{t.calculatedIndicators}</summary><dl className="followup-grid">{calcKeys.map(key =>
                  <div key={key}><dt>{m.calc[key]}</dt><dd>{numericCalculatedFields.has(key) ? formatNumber(shipment.calculated[key])
                    : key === "status" || key === "informedStatus" ? value(statusLabel(m, shipment.calculated[key])) : value(shipment.calculated[key])}</dd></div>)}</dl>
                  {e2eOf(shipment) && <dl className="followup-grid">{E2E_STAGE_CODES.map(code => {
                    const stage = e2eOf(shipment)!.stages[code];
                    return <div key={code}><dt>{m.e2eLines.stageTitles[code]}</dt><dd>{t.stage(code, value(stage.deadline),
                      `${value(stage.actual)}${stage.source === "forecast" ? ` (${m.e2eAnalysis.forecast})` : ""}`,
                      formatNumber(stage.targetDays), formatNumber(stage.actualDays), formatNumber(stage.delayDays))}</dd></div>;
                  })}</dl>}
                </details>
              </> : <p>{t.distributeFirst}</p>}
            </section></td></tr>}</Fragment>;
        })}</tbody></table></div>}
      <h3>{t.updateTitle}</h3>
      <p className="muted">{t.updateHelp}</p>
      {processes.map(entry => {
        const p = entry.process;
        const totals = entry.invoiceTotals.amounts.map(total => `${formatNumber(total.amount)} ${total.currency}`).join(" · ") || "—";
        const documentDraft = docDrafts[p.id] ?? blankDoc();
        const editable = canWriteProcess && p.lifecycleStatus !== "CLOSED";
        return <article className="followup-document" key={p.id}>
          <details><summary>{t.ipLine(p.ipNumber, p.lifecycleStatus === "CLOSED", entry.documents.length)}</summary>
            <p>{t.invoices(totals, entry.invoiceTotals.incompleteLines)}</p>
            <IpCalculatedSummary summary={entry.calculated} />
            {editable ? <form className="stack-form" onSubmit={event => saveProcess(event, p.id, p.version)}>
              <h4>{t.ipData}</h4>
              <FieldEditor fields={processFields} values={processDrafts[p.id] ?? {}}
                setValues={values => setProcessDrafts(current => ({ ...current, [p.id]: values }))} options={options} />
              <button className="button" disabled={busy}>{t.saveIp}</button>
            </form> : <dl className="followup-grid">{processFields.map(field =>
              <div key={field.key}><dt>{fieldLabel(m, field)}</dt><dd>{field.type === "number" || field.type === "money" ? formatNumber(p[field.key]) : value(p[field.key])}</dd></div>)}</dl>}
            <h4>{t.documentsTitle}</h4>
            {entry.documents.length === 0 && <p>{t.noDocuments}</p>}
            {entry.documents.map(document => <div className="followup-document" key={document.id}>
              <strong>{document.kind} {document.number}</strong> · {value(document.issueDate)}
              {document.kind === "INVOICE" && <> · {formatNumber(document.quantity)} {t.units} · {formatNumber(document.amount)} {document.currencyCode ?? ""}</>}
              {document.kind === "NF" && <> · {t.homologation(value(document.homologationDate))}</>}
              {editable && document.kind !== "BL" && <button className="button secondary" type="button" onClick={() => {
                setEditingDoc(current => ({ ...current, [p.id]: document.id }));
                setDocDrafts(current => ({ ...current, [p.id]: {
                  kind: document.kind, purchaseOrderItemId: document.purchaseOrderItemId ?? "",
                  number: document.number, issueDate: document.issueDate ?? "",
                  homologationDate: document.homologationDate ?? "", quantity: document.quantity ?? "",
                  unitPrice: document.unitPrice ?? "", amount: document.amount ?? "",
                  currencyCode: document.currencyCode ?? "", notes: document.notes,
                } }));
              }}>{t.editDocument}</button>}
            </div>)}
            {editable && <form className="stack-form" onSubmit={event => saveDoc(event, p.id, entry.documents)}>
              <h4>{editingDoc[p.id] ? t.editDocument : t.addDocument}</h4>
              {!editingDoc[p.id] && <div className="operational-fields">
                <label>{t.type}<SearchableSelect ariaLabel={t.documentType} placeholder="" value={documentDraft.kind}
                  onChange={kind => setDocDrafts(current => ({ ...current, [p.id]: { ...documentDraft, kind: kind as DocDraft["kind"] } }))}
                  options={documentKindOptions} /></label>
                <label>{t.relatedItem}<SearchableSelect ariaLabel={t.relatedItem} placeholder={t.generalDocument}
                  value={documentDraft.purchaseOrderItemId} onChange={purchaseOrderItemId => setDocDrafts(current => ({ ...current, [p.id]: { ...documentDraft, purchaseOrderItemId } }))}
                  options={data.shipments.filter(shipment => shipment.process.id === p.id).flatMap(shipment => {
                    const item = data.items.find(row => row.id === shipment.itemId);
                    return item ? [{ value: item.id, label: t.itemLine(item.productCode, item.lineNumber),
                      searchText: item.description == null ? "" : String(item.description) }] : [];
                  })} /></label>
              </div>}
              <div className="operational-fields">
                <label>{t.number}<input required maxLength={120} value={documentDraft.number} onChange={event => setDocDrafts(current => ({ ...current, [p.id]: { ...documentDraft, number: event.target.value } }))} /></label>
                <label>{t.issue}<input type="date" value={documentDraft.issueDate} onChange={event => setDocDrafts(current => ({ ...current, [p.id]: { ...documentDraft, issueDate: event.target.value } }))} /></label>
                {documentDraft.kind === "NF" && <label>{t.homologationLabel}<input type="date" value={documentDraft.homologationDate} onChange={event => setDocDrafts(current => ({ ...current, [p.id]: { ...documentDraft, homologationDate: event.target.value } }))} /></label>}
                {documentDraft.kind === "INVOICE" && <>
                  <label>{t.quantity}<input inputMode="decimal" value={documentDraft.quantity} onChange={event => setDocDrafts(current => ({ ...current, [p.id]: { ...documentDraft, quantity: event.target.value } }))} /></label>
                  <label>{t.unitPrice}<input inputMode="decimal" value={documentDraft.unitPrice} onChange={event => setDocDrafts(current => ({ ...current, [p.id]: { ...documentDraft, unitPrice: event.target.value } }))} /></label>
                  <label>{t.totalValue}<input inputMode="decimal" value={documentDraft.amount} onChange={event => setDocDrafts(current => ({ ...current, [p.id]: { ...documentDraft, amount: event.target.value } }))} /></label>
                  <label>{t.currency}<OperationalOptionSelect entity="currency" value={documentDraft.currencyCode} values={options}
                    onChange={currencyCode => setDocDrafts(current => ({ ...current, [p.id]: { ...documentDraft, currencyCode } }))} /></label>
                </>}
              </div>
              <label>{t.notes}<textarea maxLength={4000} value={documentDraft.notes} onChange={event => setDocDrafts(current => ({ ...current, [p.id]: { ...documentDraft, notes: event.target.value } }))} /></label>
              <div className="operational-actions"><button className="button" disabled={busy}>{editingDoc[p.id] ? t.saveDocument : t.addDocument}</button>
                {editingDoc[p.id] && <button className="button secondary" type="button" onClick={() => {
                  setEditingDoc(current => ({ ...current, [p.id]: "" }));
                  setDocDrafts(current => ({ ...current, [p.id]: blankDoc() }));
                }}>{t.cancelEdit}</button>}</div>
            </form>}
            <Link className="text-link" href={`/processes/${p.id}`}>{t.fullHistory}</Link>
          </details>
        </article>;
      })}
      <details className="operational-event-history"><summary>{m.events.history(data.events.length)}</summary>
        {data.events.length === 0 ? <p>{m.events.none}</p> : <ol className="operational-event-list">{data.events.map(event => <li key={event.id}>
          <div className="operational-event-heading"><time dateTime={event.occurredAt}>{eventDate(event.occurredAt)}</time>
            <strong>{event.aggregateType === "IMPORT_PROCESS" ? `IP ${event.aggregateLabel}` : `PO ${event.aggregateLabel}`}</strong>
            <span>{(m.events.entities as Record<string, string>)[event.entityType] ?? event.entityType} · {(m.events.operations as Record<string, string>)[event.operation] ?? event.operation}</span>
            {event.relatedLabel && <span>{event.relatedLabel}</span>}
          </div>
          {event.reason && event.reason !== automaticAuditReason && <p>{m.events.justification(event.reason)}</p>}
          <details><summary>{m.events.viewValues}</summary><div className="operational-event-values">
            <div><strong>{m.events.before}</strong><pre>{eventSnapshot(event.oldValue, m)}</pre></div>
            <div><strong>{m.events.after}</strong><pre>{eventSnapshot(event.newValue, m)}</pre></div>
          </div></details>
        </li>)}</ol>}
      </details>
    </>}
  </section>;
}
