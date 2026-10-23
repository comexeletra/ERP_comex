"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch, readApiJson } from "../../lib/api";
import { automaticAuditReason } from "../../lib/audit";
import { PurchaseRequestChoice } from "../../components/PurchaseRequestSelect";
import { CatalogChoice, loadCatalogChoices, loadOperationalOptions, OperationalOption, OperationalOptionSelect } from "../../components/OperationalOptionSelect";
import ConfirmDialog from "../../components/ConfirmDialog";
import { getMessages, useI18n } from "../../components/I18nProvider";
import PageHeader from "../../components/PageHeader";
import { SearchableSelect } from "../../components/SearchableSelect";
import type { Messages } from "../../lib/i18n/pt-BR";

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

const historyFields = ["supplierText", "importer", "scNumber", "scDate", "requester", "commercialPlanReceivedDate",
  "approvalDate"] as const;

function historyChanges(event: PurchaseRequestHistory, m: Messages) {
  if (!event.oldValue) return [m.pcm.registeredEvent];
  return historyFields.flatMap(key => {
    const label = m.pcm.historyFields[key];
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
  const { m } = useI18n();
  const t = m.pcm;
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
  const [deletingItem, setDeletingItem] = useState<PurchaseRequestChoice | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
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
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : getMessages().pcm.loadFailed);
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
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : getMessages().pcm.listFailed); })
      .finally(() => { if (!controller.signal.aborted) setPurchaseRequestsLoading(false); });
    return () => controller.abort();
  }, [importerFilter]);

  useEffect(() => {
    const controller = new AbortController();
    setSuppliers([]);
    if (importer) loadCatalogChoices("suppliers", importer).then(values => {
      if (!controller.signal.aborted) setSuppliers(values);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : getMessages().pcm.suppliersFailed);
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
      setNotice(editingId ? t.updated(saved.scNumber) : t.created(saved.scNumber));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.saveFailed);
    } finally { setSaving(false); }
  }

  function startEditing(item: PurchaseRequestChoice) {
    setEditingId(item.id); setEditingVersion(item.version); setImporter(item.importer);
    setScNumber(item.scNumber); setSupplierText(item.supplierText ?? ""); setScDate(item.scDate ?? ""); setRequester(item.requester);
    setCommercialPlanReceivedDate(item.commercialPlanReceivedDate ?? ""); setApprovalDate(item.approvalDate ?? "");
    setEditReason(""); setError(""); setNotice(t.editing(item.scNumber));
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
      setError(cause instanceof Error ? cause.message : t.historyFailed);
    } finally { setHistoryLoading(false); }
  }

  async function deletePurchaseRequest() {
    if (!deletingItem || deleteReason.trim().length < 3) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const deleted = deletingItem;
      const response = await apiFetch(`/api/v1/purchase-requests/${deleted.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json", "If-Match": `"${deleted.version}"` },
        body: JSON.stringify({ reason: deleteReason.trim() }),
      });
      if (!response.ok) await readApiJson<never>(response);
      const query = new URLSearchParams();
      if (importerFilter) query.set("importer", importerFilter);
      const queryString = query.toString();
      const list = await readApiJson<{ items: PurchaseRequestChoice[] }>(
        await apiFetch(`/api/v1/purchase-requests${queryString ? `?${queryString}` : ""}`, { cache: "no-store" }));
      setItems(list.items);
      setDeletingItem(null); setDeleteReason("");
      setNotice(t.deleted(deleted.scNumber));
      setHistoryId(deleted.id); setHistoryLoading(true);
      try {
        const history = await readApiJson<{ items: PurchaseRequestHistory[] }>(
          await apiFetch(`/api/v1/purchase-requests/${deleted.id}/history`, { cache: "no-store" }));
        setHistoryItems(history.items);
      } catch {
        setHistoryItems([]);
      } finally {
        setHistoryLoading(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.deleteFailed);
    } finally { setSaving(false); }
  }

  return <main className="shell">
    <PageHeader eyebrow={t.eyebrow} title={t.title}><p>{t.intro}</p></PageHeader>
    {loading && <p role="status">{t.loading}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {!loading && !canManage && <p className="notice">{t.readOnly}</p>}
    {!loading && canManage && <section className="card">
      <h2>{editingId ? t.edit : t.create}</h2>
      <form className="stack-form" onSubmit={save}>
        <div className="operational-fields">
          <label>{t.historyFields.importer}<SearchableSelect ariaLabel={t.historyFields.importer} required value={importer} onChange={setImporter}
            options={importers.map(item => ({ value: item.code, label: item.code }))} /></label>
          <label>{t.historyFields.scNumber}<input required maxLength={80} value={scNumber} onChange={event => setScNumber(event.target.value)} /></label>
          <label>{t.historyFields.supplierText}<SearchableSelect ariaLabel={t.historyFields.supplierText} required value={supplierText} onChange={setSupplierText}
            options={suppliers.map(item => ({ value: item.code, label: `${item.code} · ${item.name}` }))} /></label>
          <label>{t.historyFields.scDate}<input type="date" value={scDate} onChange={event => setScDate(event.target.value)} /></label>
          <label>{m.fields.commercialPlanReceivedDate}<input type="date" value={commercialPlanReceivedDate}
            onChange={event => setCommercialPlanReceivedDate(event.target.value)} /></label>
          <label>{t.historyFields.requester}<OperationalOptionSelect required entity="requester" value={requester} values={options}
            onChange={setRequester} /></label>
          <label>{t.approvalDate}<input type="date" value={approvalDate} onChange={event => setApprovalDate(event.target.value)} /></label>
        </div>
        {editingId && <label>{t.changeReason}<textarea required minLength={3} maxLength={1000} value={editReason}
          onChange={event => setEditReason(event.target.value)} /></label>}
        <div className="button-row">
          <button className="button" disabled={saving || !importer || (Boolean(editingId) && editReason.trim().length < 3)}>{saving ? t.saving : editingId ? t.saveChanges : t.create}</button>
          {editingId && <button className="button secondary" type="button" disabled={saving} onClick={cancelEditing}>{t.cancelEdit}</button>}
        </div>
      </form>
    </section>}
    {!loading && <section className="card">
      <h2>{t.listTitle}</h2>
      <label className="sc-list-filter">{t.historyFields.importer}<SearchableSelect ariaLabel={t.filterAria} disabled={Boolean(editingId)}
        value={importerFilter} onChange={setImporterFilter} options={importers.map(item => ({ value: item.code, label: item.code }))} /></label>
      {purchaseRequestsLoading ? <p role="status">{t.loadingList}</p> : items.length === 0 ? <p>
        {importerFilter ? t.noneForImporter : t.none}
      </p> :
        <div className="table-scroll"><table><thead><tr>
          <th>{t.historyFields.scNumber}</th><th>{t.historyFields.supplierText}</th><th>{t.historyFields.scDate}</th><th>{t.historyFields.requester}</th><th>{t.planReceived}</th><th>{t.approval}</th><th>{t.linkedPos}</th><th>{m.poPanel.action}</th>
        </tr></thead><tbody>{items.map(item => <tr key={item.id}>
          <td>{item.scNumber}</td><td>{item.supplierName ? `${item.supplierText} · ${item.supplierName}` : item.supplierText}</td><td>{item.scDate ?? "—"}</td><td>{item.requester}</td><td>{item.commercialPlanReceivedDate ?? "—"}</td>
          <td>{item.approvalDate ?? t.pending}</td><td>{item.purchaseOrderCount ?? 0}</td>
          <td><div className="sc-action-buttons">
            {canManage && <button className="button secondary" type="button" onClick={() => startEditing(item)}>{t.editButton}</button>}
            <button className="button secondary" type="button" onClick={() => void toggleHistory(item)}>
              {historyId === item.id ? t.hideHistory : t.history}
            </button>
            {canManage && <button className="button secondary" type="button" disabled={saving}
              onClick={() => { setDeletingItem(item); setDeleteReason(""); setError(""); }}>
              {t.delete}
            </button>}
          </div></td>
        </tr>)}</tbody></table></div>}
      <ConfirmDialog open={deletingItem !== null} title={deletingItem ? t.deleteTitle(deletingItem.scNumber) : ""} danger busy={saving}
        confirmLabel={saving ? t.deleting : t.confirmDelete} cancelLabel={t.cancel} confirmDisabled={deleteReason.trim().length < 3}
        onConfirm={() => void deletePurchaseRequest()} onCancel={() => { setDeletingItem(null); setDeleteReason(""); }}>
        <p>{t.deleteHelp}</p>
        {error && <p className="notice error" role="alert">{error}</p>}
        <label>{t.deleteReason}<textarea required minLength={3} maxLength={1000} value={deleteReason}
          onChange={event => setDeleteReason(event.target.value)} /></label>
      </ConfirmDialog>
      {historyId && <section className="sc-history" aria-label={t.historyAria}>
        <h3>{t.historyTitle}</h3>
        {historyLoading && <p role="status">{t.historyLoading}</p>}
        {!historyLoading && historyItems.length === 0 && <p>{t.noEvents}</p>}
        {!historyLoading && historyItems.map(event => <article className="sc-history-event" key={event.id}>
          <p><strong>{event.operation === "CREATE" ? t.creationEvent : event.operation === "DELETE" ? t.deletedEvent : t.changedEvent}</strong> · {new Date(event.occurredAt).toLocaleString("pt-BR")}</p>
          <ul>{historyChanges(event, m).map(change => <li key={change}>{change}</li>)}</ul>
          <dl className="sc-history-meta">
            <div><dt>{m.postShipment.responsible}</dt><dd>{formatHistoryActor(event.actor)}</dd></div>
            <div><dt>{m.postShipment.reason}</dt><dd>{event.reason}</dd></div>
          </dl>
        </article>)}
      </section>}
    </section>}
  </main>;
}
