"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, hasIpLifecycleSupport, readApiJson } from "../lib/api";
import { automaticAuditReason } from "../lib/audit";
import { formatNumber } from "../lib/format-number";
import { booleanOptions, displayValue, fieldLabel, statusLabel } from "../lib/i18n/labels";
import type { Messages } from "../lib/i18n/pt-BR";
import { IpCalculatedSummary as IpSummary, IpPostShipmentField, ipPostShipmentFields, newProcessDocumentKinds,
  withDateWarnings } from "../lib/ip-post-shipment-fields";
import { getMessages, useI18n } from "./I18nProvider";
import IpCalculatedSummary from "./IpCalculatedSummary";
import { loadOperationalOptions, OperationalOption, OperationalOptionSelect } from "./OperationalOptionSelect";
import { SearchableSelect } from "./SearchableSelect";

type Value = string | number | boolean | null;
type Row = Record<string, Value>;
type Field = IpPostShipmentField;
type Document = { id: string; kind: "INVOICE" | "BL" | "NF"; number: string; purchaseOrderItemId: string | null;
  issueDate: string | null; homologationDate: string | null; quantity: string | null; unitPrice: string | null;
  amount: string | null; currencyCode: string | null; notes: string; version: string };
type Allocation = { id: string; allocationQuantity: string; purchaseOrder: { id: string; number: string; importer: string };
  factoryShipDate: string | null;
  item: Row & { id: string; lineNumber: number; productCode: string; description: string; unit: string };
  calculated: Record<string, Value | string[]> };
type Event = { id: string; entityType: string; entityId: string; operation: string; oldValue: Record<string, Value> | null;
  newValue: Record<string, Value> | null; occurredAt: string; reason: string | null; actorId: string;
  purchaseOrderNumber?: string; productCode?: string; productDescription?: string; lineNumber?: number; unit?: string | null };
type Data = { process: Row & { id: string; ipNumber: string; version: string; lifecycleStatus: "OPEN" | "CLOSED"; recordStatus?: "DRAFT" | "ACTIVE" | "CANCELLED"; invoiceSupplierDivergence?: boolean };
  calculated?: IpSummary; openSourceConflicts?: number; dateWarnings?: string[];
  purchaseOrders: { id: string; number: string; importer: string; linkSource: string }[];
  allocations: Allocation[]; documents: Document[];
  invoiceTotals: { amounts: { currency: string; amount: string }[]; incompleteLines: number }; events: Event[] };
type LegacyProcess = Row & { id: string; ipNumber: string; purchaseOrders: Data["purchaseOrders"];
  operationalAllocations: { id: string; poId: string; poNumber: string; productCode: string; quantity: string; unit: string }[] };
type DocDraft = { kind: Document["kind"]; purchaseOrderItemId: string; number: string; issueDate: string;
  homologationDate: string; quantity: string; unitPrice: string; amount: string; currencyCode: string; notes: string };

const fields: Field[] = ipPostShipmentFields;
const documentKindLabels: Record<string, string> = { INVOICE: "Invoice", NF: "NF" };
const documentKindOptions = newProcessDocumentKinds.map(kind => ({ value: kind, label: documentKindLabels[kind] ?? kind }));
const blankDoc = (): DocDraft => ({ kind: "INVOICE", purchaseOrderItemId: "", number: "", issueDate: "",
  homologationDate: "", quantity: "", unitPrice: "", amount: "", currencyCode: "", notes: "" });
function formatField(field: Field, value: Value | undefined, m: Messages) {
  return field.type === "number" || field.type === "money" ? formatNumber(value) : displayValue(m, value);
}
function processHistoryLabels(m: Messages): Record<string, string> {
  return { ...m.postShipment.processLabels, ...Object.fromEntries(fields.map(field => [field.key, fieldLabel(m, field)])) };
}
function camelCaseKey(key: string) { return key.replace(/_([a-z])/gu, (_, letter: string) => letter.toUpperCase()); }
function formatHistoryActor(actor: string) {
  const separator = actor.lastIndexOf("#");
  return (separator >= 0 ? actor.slice(separator + 1) : actor).trim() || actor;
}
function formatHistoryValue(key: string, value: Value | undefined, m: Messages) {
  if (value == null || value === "") return "—";
  const field = fields.find(candidate => candidate.key === key);
  if (field?.type === "number" || field?.type === "money" || key === "quantity" || key === "unitPrice" || key === "amount") {
    return formatNumber(value);
  }
  return displayValue(m, value);
}
function historyChanges(event: Event, m: Messages) {
  const t = m.postShipment;
  if (event.entityType === "PO_ITEM_ALLOCATION" && !event.oldValue) {
    const quantity = event.newValue?.quantity;
    return [quantity == null ? t.allocationCreated :
      t.allocationQuantity(`${formatHistoryValue("quantity", quantity, m)}${event.unit ? ` ${event.unit}` : ""}`)];
  }
  if (event.entityType === "PO_ITEM_ALLOCATION" && event.operation === "CANCEL") {
    const quantity = event.oldValue?.quantity;
    return [quantity == null ? t.allocationCancelled :
      t.allocationCancelledQuantity(`${formatHistoryValue("quantity", quantity, m)}${event.unit ? ` ${event.unit}` : ""}`)];
  }
  if (!event.oldValue) {
    if (event.entityType === "PROCESS_DOCUMENT") {
      const kind = event.newValue?.kind;
      const number = event.newValue?.number;
      return [t.documentRegistered(kind ? String(kind) : "", number ? String(number) : "")];
    }
    return [t.ipCreated];
  }

  const labels: Record<string, string> = event.entityType === "PROCESS_DOCUMENT" ? t.documentLabels
    : event.entityType === "PO_ITEM_ALLOCATION" ? t.allocationLabels : processHistoryLabels(m);
  const beforeValues = new Map(Object.entries(event.oldValue).map(([key, value]) => [camelCaseKey(key), value]));
  const changes = Object.entries(event.newValue ?? {}).flatMap(([rawKey, after]) => {
    const key = camelCaseKey(rawKey);
    if (["reason", "version", "updatedAt", "createdAt"].includes(key)) return [];
    const before = beforeValues.get(key);
    if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return [];
    const label = labels[key] ?? key.replace(/([A-Z])/gu, " $1").replace(/^./u, letter => letter.toUpperCase());
    return [`${label}: ${formatHistoryValue(key, before, m)} → ${formatHistoryValue(key, after, m)}`];
  });
  return changes.length ? changes : [t.noChanges];
}
function historyEntityLabel(event: Event, m: Messages) {
  const t = m.postShipment;
  if (event.entityType === "PO_ITEM_ALLOCATION") {
    return t.allocationEntity(event.purchaseOrderNumber ?? "—", event.productCode ?? t.productFallback)
      + (event.lineNumber ? t.itemSuffix(event.lineNumber) : "");
  }
  if (event.entityType !== "PROCESS_DOCUMENT") return t.ipData;
  const kind = event.newValue?.kind ?? event.oldValue?.kind;
  const number = event.newValue?.number ?? event.oldValue?.number;
  return t.documentEntity(kind ? String(kind) : "", number ? String(number) : "");
}
function toDraft(row: Row) { return Object.fromEntries(fields.map(field => [field.key, row[field.key] == null ? "" : String(row[field.key])])) as Record<string, string>; }
function makePayload(values: Record<string, string>) {
  return Object.fromEntries(fields.map(field => {
    const value = values[field.key]?.trim() ?? "";
    return [field.key, value === "" ? null : field.type === "number" ? Number(value) :
      field.type === "boolean" ? value === "true" : field.type === "money" ? value.replace(",", ".") : value];
  }));
}

export default function ProcessPostShipmentPanel({ id }: { id: string }) {
  const { m } = useI18n();
  const t = m.postShipment;
  const format = (value: Value | undefined) => displayValue(m, value);
  const formatList = (value: Value | string[] | undefined) => Array.isArray(value) ? value.join(", ") || "—" : format(value);
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
          setCompatibilityWarning(getMessages().postShipment.legacyApi);
        }
        return;
      }
      const followupResponse = await apiFetch(`/api/v1/processes/${id}/followup`, { signal: controller.signal });
      const raw = await readApiJson<Partial<Data>>(followupResponse);
      if (!raw.process) throw new Error(getMessages().postShipment.oldFormat);
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
          ? getMessages().postShipment.outdated(missingCollections.join(", ")) : "");
      }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : getMessages().common.unexpectedError); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, reload]);
  const canWrite = Boolean(data && data.process.lifecycleStatus === "OPEN"
    && data.process.recordStatus !== "CANCELLED" && data.process.recordStatus !== "DRAFT"
    && roles.some(role => ["Master", "Administrador", "Importação"].includes(role)));
  async function send(path: string, method: string, body: unknown, version?: string) {
    const response = await apiFetch(path, { method, headers: { "content-type": "application/json",
      ...(version ? { "X-Record-Version": version } : { "Idempotency-Key": crypto.randomUUID() }) }, body: JSON.stringify(body) });
    return readApiJson<unknown>(response);
  }
  async function save(event: FormEvent<HTMLFormElement>, action: () => Promise<unknown>,
    success: string | ((result: unknown) => string)) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const result = await action();
      setNotice(typeof success === "string" ? success : success(result));
      setEditingDoc(undefined); setDocDraft(blankDoc()); setReload(value => value + 1);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : m.common.unexpectedError); }
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
  const currencyTotals = data?.invoiceTotals.amounts.map(item => `${formatNumber(item.amount)} ${item.currency}`).join(" · ") || "—";
  return <section className="card operational-panel" aria-label={t.ariaLabel}>
    <h2>{t.title}</h2>
    <p className="muted">{t.intro}</p>
    {loading && <p role="status">{t.loading}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {compatibilityWarning && <p className="notice warning" role="status">{compatibilityWarning}</p>}
    {!loading && legacyProcess && <>
      <h3>{t.posTitle}</h3>
      {legacyProcess.purchaseOrders.length === 0 ? <p>{t.noPos}</p> :
        <ul>{legacyProcess.purchaseOrders.map(po => <li key={po.id}><Link className="text-link" href={`/purchase-orders/${po.id}`}>PO {po.number}</Link> · {po.importer}</li>)}</ul>}
      <h3>{t.itemsTitle}</h3>
      {legacyProcess.operationalAllocations.length === 0 ? <p>{t.noLegacyAllocations}</p> :
        <div className="table-scroll"><table><thead><tr><th>PO</th><th>{m.followup.product}</th><th>{m.followup.quantity}</th></tr></thead><tbody>
          {legacyProcess.operationalAllocations.map(item => <tr key={item.id}><td><Link className="text-link" href={`/purchase-orders/${item.poId}`}>{item.poNumber}</Link></td>
            <td>{item.productCode}</td><td>{formatNumber(item.quantity)} {item.unit}</td></tr>)}
        </tbody></table></div>}
    </>}
    {!loading && data && <>
      {data.process.invoiceSupplierDivergence && <p className="notice warning" role="status">{t.exporterDivergence}</p>}
      <h3>{t.posTitle}</h3>
      {data.purchaseOrders.length === 0 ? <p>{t.noPos}</p> :
        <ul>{data.purchaseOrders.map(po => <li key={po.id}><Link className="text-link" href={`/purchase-orders/${po.id}`}>PO {po.number}</Link> · {po.importer}</li>)}</ul>}
      {(data.openSourceConflicts ?? 0) > 0 && <p className="notice warning" role="status">
        {t.sourceConflictsBefore(data.openSourceConflicts ?? 0)}<Link className="text-link" href="/quality">{t.sourceConflictsLink}</Link>
        {t.sourceConflictsAfter}</p>}
      {(data.dateWarnings?.length ?? 0) > 0 && <p className="notice warning" role="status">
        {t.checkDates(data.dateWarnings!.join("; "))}</p>}
      <h3>{t.calculatedTitle}</h3>
      <p className="muted">{t.calculatedHelp}</p>
      <IpCalculatedSummary summary={data.calculated} />
      <h3>{t.operationalData}</h3>
      {canWrite ? <>
        <form className="stack-form" onSubmit={event => void save(event, () =>
          send(`/api/v1/processes/${id}/followup`, "PATCH", { fields: makePayload(draft), reason: automaticAuditReason }, data.process.version),
        result => withDateWarnings(t.updated, result, m))}>
          <div className="operational-fields">{fields.map(field => <label key={field.key}>{fieldLabel(m, field)}
            {field.type === "boolean" ? <SearchableSelect ariaLabel={fieldLabel(m, field)} placeholder="" value={String(draft[field.key] ?? "")}
              onChange={value => setDraft({ ...draft, [field.key]: value })}
              options={booleanOptions(m)} /> :
              field.type === "select" ? <OperationalOptionSelect entity={field.entity ?? ""} value={draft[field.key] ?? ""} values={options}
                onChange={value => setDraft({ ...draft, [field.key]: value })} /> :
                <input type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
                  min={field.type === "number" ? 0 : undefined} maxLength={field.max}
                  inputMode={field.type === "money" ? "decimal" : undefined} value={draft[field.key] ?? ""}
                  onChange={event => setDraft({ ...draft, [field.key]: event.target.value })} />}
          </label>)}</div>
          <button className="button" disabled={busy}>{busy ? m.newRecord.saving : t.saveIp}</button>
        </form>
      </> : <dl className="followup-grid">{fields.map(field => <div key={field.key}><dt>{fieldLabel(m, field)}</dt><dd>{formatField(field, data.process[field.key], m)}</dd></div>)}</dl>}
      <h3>{t.itemsTitle}</h3>
      {data.allocations.length === 0 ? <p>{t.noAllocations}</p> :
        <div className="table-scroll"><table><thead><tr><th>PO</th><th>{t.item}</th><th>{t.ordered}</th><th>{t.inThisIp}</th><th>{m.followup.factoryShip}</th><th>{t.invoice}</th><th>{t.calculatedStatus}</th><th>{m.followup.alert}</th></tr></thead><tbody>
          {data.allocations.map(allocation => <tr key={allocation.id}><td><Link className="text-link" href={`/purchase-orders/${allocation.purchaseOrder.id}`}>{allocation.purchaseOrder.number}</Link></td>
            <td>{allocation.item.productCode} · {allocation.item.description}</td>
            <td>{formatNumber(allocation.item.orderedQuantity)} {allocation.item.unit}</td><td>{formatNumber(allocation.allocationQuantity)} {allocation.item.unit}</td>
            <td>{allocation.factoryShipDate ?? "—"}</td>
            <td>{formatList(allocation.calculated.invoiceNumbers)}</td>
            <td>{format(statusLabel(m, allocation.calculated.status) || null)}</td><td>{format(allocation.calculated.alert as Value)}</td></tr>)}
        </tbody></table></div>}
      <h3>{t.documentsTitle}</h3>
      <p>{t.invoiceTotals(currencyTotals, data.invoiceTotals.incompleteLines)}</p>
      {data.documents.map(document => <div className="followup-document" key={document.id}>
        <strong>{document.kind} {document.number}</strong> · {document.issueDate ?? t.noDate} · {document.purchaseOrderItemId
          ? data.allocations.find(item => item.item.id === document.purchaseOrderItemId)?.item.productCode ?? t.poItem : t.generalIp}
        {document.kind === "INVOICE" && <> · {formatNumber(document.quantity)} × {formatNumber(document.unitPrice)} · {formatNumber(document.amount, t.calculatedValue)} {document.currencyCode ?? ""}</>}
        {document.kind === "NF" && <> · {t.homologation(document.homologationDate ?? "—")}</>}
        {canWrite && <div className="operational-actions">{document.kind !== "BL" && <button type="button" className="button secondary" onClick={() => {
          setEditingDoc(document.id); setDocDraft({ kind: document.kind, purchaseOrderItemId: document.purchaseOrderItemId ?? "",
            number: document.number, issueDate: document.issueDate ?? "", homologationDate: document.homologationDate ?? "",
            quantity: document.quantity ?? "", unitPrice: document.unitPrice ?? "", amount: document.amount ?? "",
            currencyCode: document.currencyCode ?? "", notes: document.notes });
        }}>{t.edit}</button>}<button type="button" className="button secondary" disabled={busy}
          onClick={() => void (async () => { setBusy(true); setError(""); try {
            await send(`/api/v1/processes/${id}/documents/${document.id}`, "DELETE", { reason: automaticAuditReason }, document.version);
            setNotice(t.documentCancelled); setReload(value => value + 1);
          } catch (cause) { setError(cause instanceof Error ? cause.message : m.common.unexpectedError); } finally { setBusy(false); } })()}>{t.cancel}</button></div>}
        {editingDoc === document.id && <form className="stack-form" onSubmit={event => void save(event, async () => {
          await send(`/api/v1/processes/${id}/documents/${document.id}`, "PATCH", { ...documentBody(docDraft), kind: undefined, purchaseOrderItemId: undefined }, document.version);
        }, m.followup.documentUpdated)}>
          <label>{m.followup.number}<input required maxLength={120} value={docDraft.number} onChange={event => setDocDraft({ ...docDraft, number: event.target.value })} /></label>
          <label>{m.followup.issue}<input type="date" value={docDraft.issueDate} onChange={event => setDocDraft({ ...docDraft, issueDate: event.target.value })} /></label>
          {docDraft.kind === "NF" && <label>{m.followup.homologationLabel}<input type="date" value={docDraft.homologationDate} onChange={event => setDocDraft({ ...docDraft, homologationDate: event.target.value })} /></label>}
          {docDraft.kind === "INVOICE" && <><label>{m.followup.quantity}<input inputMode="decimal" value={docDraft.quantity} onChange={event => setDocDraft({ ...docDraft, quantity: event.target.value })} /></label>
            <label>{m.followup.unitPrice}<input inputMode="decimal" value={docDraft.unitPrice} onChange={event => setDocDraft({ ...docDraft, unitPrice: event.target.value })} /></label>
            <label>{t.informedValue}<input inputMode="decimal" value={docDraft.amount} onChange={event => setDocDraft({ ...docDraft, amount: event.target.value })} /></label>
            <label>{m.followup.currency}<OperationalOptionSelect entity="currency" value={docDraft.currencyCode} values={options} onChange={value => setDocDraft({ ...docDraft, currencyCode: value })} /></label></>}
          <label>{m.followup.notes}<textarea maxLength={4000} value={docDraft.notes} onChange={event => setDocDraft({ ...docDraft, notes: event.target.value })} /></label>
          <button className="button" disabled={busy}>{m.followup.saveDocument}</button>
        </form>}
      </div>)}
      {canWrite && <form className="stack-form" onSubmit={event => void save(event, async () => {
        await send(`/api/v1/processes/${id}/documents`, "POST", documentBody(docDraft));
      }, m.followup.documentCreated)}>
        <h4>{editingDoc ? t.editSelected : t.addToIp}</h4>
        {!editingDoc && <><div className="operational-fields">
          <label>{m.followup.type}<SearchableSelect ariaLabel={m.followup.documentType} placeholder="" value={docDraft.kind}
            onChange={kind => setDocDraft({ ...docDraft, kind: kind as DocDraft["kind"] })}
            options={documentKindOptions} /></label>
          <label>{m.followup.relatedItem}<SearchableSelect ariaLabel={m.followup.relatedItem} placeholder={m.followup.generalDocument}
            value={docDraft.purchaseOrderItemId} onChange={purchaseOrderItemId => setDocDraft({ ...docDraft, purchaseOrderItemId })}
            options={data.allocations.map(allocation => ({ value: allocation.item.id,
              label: t.itemOption(allocation.purchaseOrder.number, allocation.item.productCode, allocation.item.lineNumber),
              searchText: allocation.item.description }))} /></label>
          <label>{m.followup.number}<input required maxLength={120} value={docDraft.number} onChange={event => setDocDraft({ ...docDraft, number: event.target.value })} /></label>
          <label>{m.followup.issue}<input type="date" value={docDraft.issueDate} onChange={event => setDocDraft({ ...docDraft, issueDate: event.target.value })} /></label>
          {docDraft.kind === "NF" && <label>{m.followup.homologationLabel}<input type="date" value={docDraft.homologationDate} onChange={event => setDocDraft({ ...docDraft, homologationDate: event.target.value })} /></label>}
          {docDraft.kind === "INVOICE" && <><label>{m.followup.quantity}<input inputMode="decimal" value={docDraft.quantity} onChange={event => setDocDraft({ ...docDraft, quantity: event.target.value })} /></label>
            <label>{m.followup.unitPrice}<input inputMode="decimal" value={docDraft.unitPrice} onChange={event => setDocDraft({ ...docDraft, unitPrice: event.target.value })} /></label>
            <label>{t.informedValue}<input inputMode="decimal" value={docDraft.amount} onChange={event => setDocDraft({ ...docDraft, amount: event.target.value })} /></label>
            <label>{m.followup.currency}<OperationalOptionSelect entity="currency" value={docDraft.currencyCode} values={options} onChange={value => setDocDraft({ ...docDraft, currencyCode: value })} /></label></>}
        </div><label>{m.followup.notes}<textarea maxLength={4000} value={docDraft.notes} onChange={event => setDocDraft({ ...docDraft, notes: event.target.value })} /></label></>}
        <button className="button" disabled={busy || Boolean(editingDoc)}>{busy ? m.newRecord.saving : m.followup.addDocument}</button>
      </form>}
      <section className="ip-history" aria-label={t.historyTitle}>
        <h3>{t.historyTitle}</h3>
        {data.events.length === 0 ? <p>{t.noEvents}</p> : data.events.map(event =>
          <article className="ip-history-event" key={event.id}>
            <p><strong>{(t.operations as Record<string, string>)[event.operation] ?? event.operation}</strong> · {new Date(event.occurredAt).toLocaleString("pt-BR")}</p>
            <p className="ip-history-entity">{historyEntityLabel(event, m)}</p>
            {event.productDescription && <p className="ip-history-product-description">{event.productDescription}</p>}
            <ul>{historyChanges(event, m).map(change => <li key={change}>{change}</li>)}</ul>
            <dl className="ip-history-meta">
              <div><dt>{t.responsible}</dt><dd>{formatHistoryActor(event.actorId)}</dd></div>
              {event.reason && event.reason !== automaticAuditReason && <div><dt>{t.reason}</dt><dd>{event.reason}</dd></div>}
            </dl>
          </article>)}
      </section>
    </>}
  </section>;
}
