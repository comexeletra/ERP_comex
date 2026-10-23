"use client";

import Link from "next/link";
import { FormEvent, Fragment, useEffect, useRef, useState } from "react";
import { apiFetch, isMissingApiRoute, readApiJson } from "../lib/api";
import { automaticAuditReason, emptyShippedChange, shippedChangeFields, shippedChangeReady } from "../lib/audit";
import ShippedChangeConfirmation from "./ShippedChangeConfirmation";
import { processLifecycleActions, type ProcessLifecycleAction } from "../lib/ip-lifecycle";
import { matchesPurchaseOrderNumber } from "../lib/portfolio-query";
import { formatNumber } from "../lib/format-number";
import { SearchableSelect } from "./SearchableSelect";
import ProcessPostShipmentPanel from "./ProcessPostShipmentPanel";
import { loadOperationalOptions, OperationalOption, OperationalOptionSelect } from "./OperationalOptionSelect";
import { useI18n } from "./I18nProvider";
import PageHeader from "./PageHeader";

// Exact API error text when the importer cannot be changed; the API answers in Portuguese.
const importerChangeRejected = "Revise o IP."; // i18n-ignore: API contract

type Cost = { id: string; type: string; currency: string; amount: string; status: string; sourceSheetName: string; sourceRowNumber: number; sourceColumn: string };
type Order = { id: string; number: string; importer: string; linkSource: string };
type PurchaseOrderChoice = { id: string; number: string; importer: string };
type CancellationDestination = { type: "IDLE" } | { type: "EXISTING"; processId: string } | { type: "NEW"; ipNumber: string };
type PurchaseOrderItemChoice = { id: string; lineNumber: number; productCode: string; description: string;
  orderedQuantity: string; remainingQuantity: string; unit: string | null; sourceStatus: string | null };
type OperationalAllocation = { id: string; poId: string; poNumber: string; productCode: string; quantity: string;
  unit: string; poItemRemainingQuantity?: string };
type Process = { id: string; ipNumber: string; importer: string; supplierEntryId?: string | null; supplierText: string | null; supplierName?: string | null; logisticsStatus: string | null;
  invoiceSupplierDivergence?: boolean; shipped?: boolean;
  qualityStatus: string; sourceKind: string; priority: string | null; notes: string;
  version: string; lifecycleStatus?: "OPEN" | "CLOSED"; recordStatus?: "DRAFT" | "ACTIVE" | "CANCELLED" | "DELETED";
  recordStatusBeforeDelete?: "DRAFT" | "ACTIVE" | "CANCELLED" | null; deletedAt?: string | null; deletedBy?: string | null; deleteReason?: string | null; closedAt: string | null;
  closedBy: string | null; closeReason: string | null;
  processDocumentCount?: number;
  purchaseOrders: Order[]; historicalCosts: Cost[];
  operationalAllocations: OperationalAllocation[] };
type Line = { id: string; sourceSheetName: string; sourceRowNumber: number; sourceValues: Record<string, unknown>; sourceColumnHeaders: Record<string, string>; purchaseOrderId: string | null; poNumber: string | null; productCode: string | null; productDescription: string | null; quantityFromSource: string | null; legacyStatus: string | null };
type LinePage = { page: number; pageSize: number; totalCount: number; items: Line[] };
type ImporterChoice = { code: string };

function quantityUnits(value: string): bigint | null {
  const match = /^(\d+)(?:[.,](\d{0,8}))?$/u.exec(value.trim());
  if (!match) return null;
  return BigInt(match[1]) * 100_000_000n + BigInt((match[2] ?? "").padEnd(8, "0") || "0");
}
function formatQuantityUnits(units: bigint) {
  const roundedHundredths = (units + 500_000n) / 1_000_000n;
  const whole = (roundedHundredths / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ".");
  const fraction = (roundedHundredths % 100n).toString().padStart(2, "0");
  return `${whole},${fraction}`;
}

export default function ProcessWorkspace({ id, returnPath }: { id: string; returnPath: string }) {
  const { m, messages } = useI18n();
  const t = m.processWorkspace;
  const [process, setProcess] = useState<Process>();
  const [lines, setLines] = useState<LinePage>();
  const [expandedLineId, setExpandedLineId] = useState<string>();
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [compatibilityWarning, setCompatibilityWarning] = useState("");
  const [saveError, setSaveError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [roles, setRoles] = useState<string[]>([]);
  const [ipNumberDraft, setIpNumberDraft] = useState("");
  const [importerDraft, setImporterDraft] = useState("");
  const [logisticsStatusDraft, setLogisticsStatusDraft] = useState("");
  const [priorityDraft, setPriorityDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [importers, setImporters] = useState<ImporterChoice[]>([]);
  const [operationalOptions, setOperationalOptions] = useState<OperationalOption[]>([]);
  const [poQuery, setPoQuery] = useState("");
  const [poOptions, setPoOptions] = useState<PurchaseOrderChoice[]>([]);
  const [selectedPoId, setSelectedPoId] = useState("");
  const [poItems, setPoItems] = useState<PurchaseOrderItemChoice[]>([]);
  const [selectedPoItemId, setSelectedPoItemId] = useState("");
  const [allocationQuantity, setAllocationQuantity] = useState("");
  const [shippedChange, setShippedChange] = useState(emptyShippedChange);
  const [poSearchMessage, setPoSearchMessage] = useState("");
  const [searchingPos, setSearchingPos] = useState(false);
  const poSearchTimer = useRef<number | undefined>(undefined);
  const poSearchRequest = useRef(0);
  const [linkingPo, setLinkingPo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [lifecycleBusy, setLifecycleBusy] = useState<ProcessLifecycleAction | null>(null);
  const [cancellationRoutes, setCancellationRoutes] = useState<Record<string, CancellationDestination>>({});
  const [destinationIps, setDestinationIps] = useState<Array<{ id: string; ipNumber: string; recordStatus?: string }>>([]);
  const [notice, setNotice] = useState("");
  async function readSavedProcess(): Promise<Process> {
    const response = await apiFetch(`/api/v1/processes/${id}`, { cache: "no-store" });
    if (!response.ok) throw new Error(t.savedNotRead);
    return response.json() as Promise<Process>;
  }
  async function readPurchaseOrderState(poId: string) {
    const response = await apiFetch(`/api/v1/purchase-orders/${poId}/operational`, { cache: "no-store" });
    return readApiJson<{ items: PurchaseOrderItemChoice[]; allocations: { itemId: string; processId: string }[] }>(response);
  }
  async function choosePurchaseOrder(poId: string, searchRequestId?: number) {
    setSelectedPoId(poId); setSelectedPoItemId(""); setAllocationQuantity("");
    setPoItems([]); setSaveError(undefined); setPoSearchMessage("");
    if (!poId) return;
    setSearchingPos(true);
    try {
      const state = await readPurchaseOrderState(poId);
      if (searchRequestId !== undefined && searchRequestId !== poSearchRequest.current) return;
      const activeItemIdsForThisIp = new Set(state.allocations.filter(item => item.processId === id).map(item => item.itemId));
      const available = state.items.filter(item => (quantityUnits(item.remainingQuantity) ?? 0n) > 0n
        && !activeItemIdsForThisIp.has(item.id)
        && !["CANCELLED", "CANCELED"].includes(String(item.sourceStatus ?? "").toUpperCase()));
      setPoItems(available);
      setSelectedPoItemId(available[0]?.id ?? "");
      setPoSearchMessage(available.length ? t.itemsAvailable(available.length) : t.noItemsAvailable);
    } catch (cause) {
      if (searchRequestId === undefined || searchRequestId === poSearchRequest.current) {
        setSaveError(cause instanceof Error ? cause.message : t.poItemsFailed);
      }
    } finally {
      if (searchRequestId === undefined || searchRequestId === poSearchRequest.current) setSearchingPos(false);
    }
  }
  async function searchPurchaseOrders(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!process) return;
    const requestId = ++poSearchRequest.current;
    setSearchingPos(true); setSaveError(undefined); setPoSearchMessage("");
    try {
      const query = new URLSearchParams({ importer: process.importer, number: poQuery, pageSize: "200" });
      const response = await apiFetch(`/api/v1/purchase-orders?${query}`);
      const result = await readApiJson<{ items: PurchaseOrderChoice[] }>(response);
      if (requestId !== poSearchRequest.current) return;
      const matches = result.items.filter(order => order.importer === process.importer
        && matchesPurchaseOrderNumber(order.number, poQuery));
      setPoOptions(matches);
      const exactMatches = matches.filter(order => order.number.trim().toLocaleLowerCase()
        === poQuery.trim().toLocaleLowerCase());
      if (exactMatches.length === 1) {
        await choosePurchaseOrder(exactMatches[0].id, requestId);
        if (requestId !== poSearchRequest.current) return;
        setPoSearchMessage("");
      } else {
        if (!matches.some(order => order.id === selectedPoId)) {
          setSelectedPoId(""); setSelectedPoItemId(""); setPoItems([]);
        }
        setPoSearchMessage(matches.length === 0 ? t.noPoFound(process.importer) : "");
      }
    } catch (cause) {
      if (requestId === poSearchRequest.current) setSaveError(cause instanceof Error ? cause.message : t.poSearchFailed);
    } finally { if (requestId === poSearchRequest.current) setSearchingPos(false); }
  }
  async function distributeItemToProcess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!process || !selectedPoId || !selectedPoItemId) return;
    setLinkingPo(true); setSaveError(undefined); setPoSearchMessage("");
    try {
      const quantity = quantityUnits(allocationQuantity);
      const selectedItem = poItems.find(item => item.id === selectedPoItemId);
      const remaining = selectedItem ? quantityUnits(selectedItem.remainingQuantity) : null;
      if (quantity === null || quantity <= 0n || remaining === null || quantity > remaining) {
        throw new Error(t.invalidQuantity);
      }
      if (!shippedChangeReady(Boolean(process.shipped), shippedChange)) {
        throw new Error(t.confirmShipped);
      }
      const response = await apiFetch(`/api/v1/purchase-orders/${selectedPoId}/allocations`, { method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ itemId: selectedPoItemId, processId: id, quantity: allocationQuantity,
          notes: "", ...shippedChangeFields(Boolean(process.shipped), shippedChange) }) });
      await readApiJson<{ id: string }>(response);
      const [savedProcess, savedPo] = await Promise.all([readSavedProcess(), readPurchaseOrderState(selectedPoId)]);
      if (!savedProcess.purchaseOrders.some(order => order.id === selectedPoId)
        || !savedPo.allocations.some(allocation => allocation.itemId === selectedPoItemId && allocation.processId === id)) {
        throw new Error(t.allocationNotReread);
      }
      setProcess(savedProcess); setPoItems(savedPo.items.filter(item => (quantityUnits(item.remainingQuantity) ?? 0n) > 0n
        && !savedPo.allocations.some(allocation => allocation.itemId === item.id && allocation.processId === id)
        && !["CANCELLED", "CANCELED"].includes(String(item.sourceStatus ?? "").toUpperCase())));
      setAllocationQuantity(""); setShippedChange(emptyShippedChange);
      setSelectedPoItemId("");
      setPoSearchMessage(t.distributedSearch);
      setNotice(t.distributedNotice);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : t.distributeFailed);
    } finally { setLinkingPo(false); }
  }
  const selectedPoItem = poItems.find(item => item.id === selectedPoItemId);
  const remainingUnits = selectedPoItem ? quantityUnits(selectedPoItem.remainingQuantity) : null;
  const allocationUnits = quantityUnits(allocationQuantity);
  const remainingAfterAllocation = remainingUnits !== null && allocationUnits !== null
    && allocationUnits > 0n && allocationUnits <= remainingUnits
    ? formatQuantityUnits(remainingUnits - allocationUnits) : null;
  useEffect(() => {
    loadOperationalOptions().then(setOperationalOptions).catch(() => undefined);
    apiFetch("/api/v1/importers", { cache: "no-store" }).then(async response => {
      if (!response.ok) return;
      setImporters((await response.json() as { items: ImporterChoice[] }).items);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(undefined);
    Promise.all([
      apiFetch(`/api/v1/processes/${id}`, { signal: controller.signal }),
      apiFetch(`/api/v1/processes/${id}/items?page=${page}&pageSize=50`, { signal: controller.signal }),
      apiFetch("/auth/me", { signal: controller.signal }),
    ]).then(async ([detail, items, identity]) => {
      const text = messages();
      if (detail.status === 401 || items.status === 401 || identity.status === 401) throw new Error(text.common.sessionExpired);
      if (detail.status === 403 || items.status === 403) throw new Error(text.processWorkspace.forbidden);
      if (detail.status === 404 || items.status === 404) throw new Error(text.processWorkspace.notFound);
      if (!detail.ok || !items.ok || !identity.ok) throw new Error(text.processWorkspace.loadFailed);
      const [processValue, lineValue, user] = await Promise.all([detail.json() as Promise<Process>, items.json() as Promise<LinePage>, identity.json() as Promise<{ roles: string[] }>]);
      const destinationQuery = new URLSearchParams({ importer: processValue.importer, page: "1", pageSize: "200" });
      const destinationResponse = await apiFetch(`/api/v1/processes?${destinationQuery}`, { signal: controller.signal });
      const destinations = destinationResponse.ok
        ? (await destinationResponse.json() as { items: Array<{ id: string; ipNumber: string; importer: string;
          recordStatus?: string; lifecycleStatus?: string }> }).items
        : [];
      if (!controller.signal.aborted) {
        setCompatibilityWarning(processValue.lifecycleStatus === "OPEN" || processValue.lifecycleStatus === "CLOSED"
          ? "" : messages().processWorkspace.outdatedApi);
        setProcess(processValue); setLines(lineValue); setRoles(user.roles);
        setDestinationIps(destinations.filter(value => value.id !== processValue.id && value.importer === processValue.importer
          && value.lifecycleStatus !== "CLOSED" && value.recordStatus !== "CANCELLED"));
        setCancellationRoutes(Object.fromEntries(processValue.purchaseOrders.map(order => [order.id, { type: "IDLE" as const }])));
        setIpNumberDraft(processValue.ipNumber);
        setImporterDraft(processValue.importer);
        setLogisticsStatusDraft(processValue.logisticsStatus ?? "");
        setPriorityDraft(processValue.priority ?? "");
        setNotesDraft(processValue.notes);
      }
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : messages().common.unexpectedError); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, messages, page, retry]);

  async function saveProcess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!process) return;
    setSaving(true); setSaveError(undefined); setNotice("");
    try {
      const importerChanged = importerDraft !== process.importer;
      const response = await apiFetch(`/api/v1/processes/${id}`, { method: "PATCH",
        headers: { "content-type": "application/json", "X-Record-Version": process.version },
        body: JSON.stringify({ ipNumber: ipNumberDraft, ...(importerChanged ? { importer: importerDraft } : {}),
          logisticsStatus: logisticsStatusDraft || null, priority: priorityDraft || null,
          notes: notesDraft, reason: automaticAuditReason }) });
      const body = await response.json() as { detail?: string };
      if (!response.ok) {
        if (importerChanged && response.status === 400 && body.detail === importerChangeRejected) {
          throw new Error(t.importerChangeUnsupported);
        }
        throw new Error(body.detail || t.updateFailed);
      }
      const saved = await readSavedProcess();
      if (saved.ipNumber !== ipNumberDraft || saved.importer !== importerDraft
        || saved.logisticsStatus !== (logisticsStatusDraft || null) || saved.priority !== (priorityDraft || null)
        || saved.notes !== notesDraft) {
        throw new Error(t.updateNotReread);
      }
      setNotice(t.updated); setRetry(value => value + 1);
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : m.common.unexpectedError); }
    finally { setSaving(false); }
  }
  async function cancelProcess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!process) return;
    const reason = lifecycleReason.trim();
    if (reason.length < 3) { setSaveError(t.reasonRequired); return; }
    setCancelling(true); setSaveError(undefined); setNotice("");
    try {
      const purchaseOrders = process.purchaseOrders.map(order => {
        const destination = cancellationRoutes[order.id] ?? { type: "IDLE" as const };
        if (destination.type === "EXISTING") return { purchaseOrderId: order.id, destinationType: "EXISTING" as const, processId: destination.processId };
        if (destination.type === "NEW") return { purchaseOrderId: order.id, destinationType: "NEW" as const, ipNumber: destination.ipNumber.trim() };
        return { purchaseOrderId: order.id, destinationType: "IDLE" as const };
      });
      if (purchaseOrders.some(item => item.destinationType === "NEW" && !item.ipNumber)) throw new Error(t.newIpRefRequired);
      if (purchaseOrders.some(item => item.destinationType === "EXISTING" && !item.processId)) throw new Error(t.existingIpRequired);
      const response = await apiFetch("/api/v1/processes/" + id + "/cancel", { method: "POST",
        headers: { "content-type": "application/json", "X-Record-Version": process.version },
        body: JSON.stringify({ reason, purchaseOrders }) });
      const result = await readApiJson<{ status: string; createdDraftIps: number; releasedAllocations: number }>(response);
      if ((await readSavedProcess()).recordStatus !== "CANCELLED") throw new Error(t.notCancelled);
      const routeSummary = purchaseOrders.map(route => {
        const order = process.purchaseOrders.find(item => item.id === route.purchaseOrderId);
        const destination = route.destinationType === "IDLE" ? t.noLink
          : route.destinationType === "EXISTING" ? destinationIps.find(item => item.id === route.processId)?.ipNumber ?? t.existingIp
            : route.ipNumber;
        return t.route(order?.number ?? route.purchaseOrderId, destination);
      }).join("; ");
      setNotice(t.cancelled(result.releasedAllocations, result.createdDraftIps, routeSummary));
      setRetry(value => value + 1);
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : t.cancelFailed); }
    finally { setCancelling(false); }
  }
  async function changeLifecycleAction(action: Exclude<ProcessLifecycleAction, "cancel">) {
    if (!process) return;
    const reason = lifecycleReason.trim();
    if (reason.length < 3) { setSaveError(t.reasonRequired); return; }
    const pathSuffix = action === "delete" ? "" : "/" + action;
    const route = "/api/v1/processes/" + id + pathSuffix;
    const method = action === "delete" ? "DELETE" : "POST";
    setLifecycleBusy(action); setSaveError(undefined); setNotice("");
    try {
      const response = await apiFetch(route, { method,
        headers: { "content-type": "application/json", "X-Record-Version": process.version },
        body: JSON.stringify({ reason }) });
      const body = await response.clone().json().catch(() => null) as { detail?: string } | null;
      if (!response.ok) {
        if ((action === "delete" || action === "reactivate" || action === "restore")
          && isMissingApiRoute(response.status, body, route)) {
          const message = t.lifecycleUnavailable;
          setCompatibilityWarning(message);
          setSaveError(undefined);
          return;
        }
        throw new Error(body?.detail || t.lifecycleFailed);
      }
      const saved = await readSavedProcess();
      const valid = action === "close" ? saved.lifecycleStatus === "CLOSED"
        : action === "reopen" ? saved.lifecycleStatus === "OPEN"
          : action === "delete" ? saved.recordStatus === "DELETED"
            : action === "reactivate" ? saved.recordStatus === "ACTIVE" && saved.lifecycleStatus === "OPEN"
              && saved.logisticsStatus === null : saved.recordStatus !== "DELETED";
      if (!valid) throw new Error(t.lifecycleNotReread);
      setCompatibilityWarning("");
      setNotice(t.lifecycleDone[action]);
      setRetry(value => value + 1);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : m.common.unexpectedError);
    } finally { setLifecycleBusy(null); }
  }
  const canWrite = roles.some(role => ["Master", "Administrador", "Importação"].includes(role));
  const canManageLifecycle = roles.some(role => role === "Master" || role === "Administrador");
  const lifecycleActions = processLifecycleActions(process?.recordStatus, process?.lifecycleStatus,
    canWrite, canManageLifecycle);
  const deleteDisabled = Boolean(process && (process.operationalAllocations.length > 0
    || (process.processDocumentCount ?? 0) > 0 || process.purchaseOrders.length > 0));
  const lifecycleActionLabels: Record<ProcessLifecycleAction, string> = t.actions;
  const recordLabel = process?.recordStatus === "DELETED" || process?.recordStatus === "CANCELLED"
    || process?.recordStatus === "DRAFT" ? t.record[process.recordStatus] : t.record.ACTIVE;
  const cycleLabel = process?.lifecycleStatus === "CLOSED" || process?.lifecycleStatus === "OPEN"
    ? t.cycle[process.lifecycleStatus] : t.cycle.UNAVAILABLE;
  return <main className="shell">
    {(loading || error || !process || !lines) && <Link className="back" href={returnPath}>{t.back}</Link>}
    {loading && <p role="status">{t.loading}</p>}
    {error && <div className="notice error" role="alert"><p>{error}</p><button className="button" onClick={() => setRetry(value => value + 1)}>{m.common.retry}</button></div>}
    {!loading && !error && process && lines && <>
      <PageHeader back={{ href: returnPath, label: t.back }}
        eyebrow={t.eyebrow(process.importer, process.supplierName ? `${process.supplierText} · ${process.supplierName}` : process.supplierText ?? t.notInformed)}
        title={process.ipNumber}>
        <p>{t.summary(process.logisticsStatus ?? t.notInformed, process.lifecycleStatus === "CLOSED" ? t.cycleClosed : process.lifecycleStatus === "OPEN" ? t.cycleOpen : t.cycleUnavailable, process.qualityStatus, process.sourceKind)}</p>
      </PageHeader>
      {compatibilityWarning && <p className="notice warning" role="status">{compatibilityWarning}</p>}
      {process.recordStatus === "DRAFT" && <p className="notice" role="status">{t.draftNotice}</p>}
      {process.recordStatus === "CANCELLED" && <p className="notice warning" role="status">{t.cancelledNotice}</p>}
      {process.invoiceSupplierDivergence && <p className="notice warning" role="status">{t.exporterNotice}</p>}
      <section className="metric-grid"><Metric label={t.linkedPos} value={process.purchaseOrders.length} /><Metric label={t.historicalLines} value={lines.totalCount} /><Metric label={t.historicalCosts} value={process.historicalCosts.length} /></section>
      <section className="card"><h2>{t.cycleTitle}</h2>
        <p>{t.situation(recordLabel, cycleLabel)}</p>
        {process.recordStatus === "DELETED" && <p className="notice warning" role="status">{t.deletedNotice}</p>}
        {process.lifecycleStatus === "CLOSED" && <p className="notice">{t.closedOn(process.closedAt ? new Date(process.closedAt).toLocaleString("pt-BR") : t.dateUnavailable)}</p>}
        {((process.recordStatus === "CANCELLED" && !canManageLifecycle) || (process.recordStatus === "DELETED" && !canManageLifecycle))
          && <p className="notice" role="status">{t.askManager}</p>}
        {notice && <p className="notice success" role="status">{notice}</p>}
        {saveError && <p className="notice error" role="alert">{saveError}</p>}
        <label>{t.actionReason}<textarea required minLength={3} maxLength={1000} value={lifecycleReason}
          onChange={event => setLifecycleReason(event.target.value)} /></label>
        <div className="process-action-buttons">
          {lifecycleActions.filter(action => action !== "cancel").map(action =>
            <button key={action} className="button" type="button"
              disabled={lifecycleBusy !== null || lifecycleReason.trim().length < 3
                || (action === "delete" && deleteDisabled)}
              onClick={() => void changeLifecycleAction(action)}>
              {lifecycleBusy === action ? lifecycleActionLabels[action] + "…" : lifecycleActionLabels[action]}
            </button>)}
          {lifecycleActions.includes("cancel") && <details className="process-action">
          <summary className="process-action-trigger">{lifecycleActionLabels.cancel}</summary>
          <form className="stack-form" onSubmit={cancelProcess}>
            <p>{t.cancelHelp}</p>
            {process.purchaseOrders.length === 0 && <p>{t.noPos}</p>}
            {process.purchaseOrders.map(order => {
              const route = cancellationRoutes[order.id] ?? { type: "IDLE" as const };
              const quantities = process.operationalAllocations.filter(allocation => allocation.poId === order.id)
                .map(allocation => allocation.productCode + ": " + formatNumber(allocation.quantity) + " " + allocation.unit);
              return <div className="operational-fields" key={order.id}>
                <strong>PO {order.number}</strong>
                <small>{quantities.length ? t.allocatedQuantities(quantities.join("; ")) : t.noActiveQuantities}</small>
                <label>{t.destination}<SearchableSelect ariaLabel={t.destination} placeholder="" value={route.type}
                  onChange={type => setCancellationRoutes(current => ({
                    ...current, [order.id]: type === "EXISTING" ? { type: "EXISTING", processId: "" }
                      : type === "NEW" ? { type: "NEW", ipNumber: "" } : { type: "IDLE" },
                  }))} options={[{ value: "IDLE", label: t.keepUnlinked }, { value: "EXISTING", label: t.existingIp },
                    { value: "NEW", label: t.createDraft }]} /></label>
                {route.type === "EXISTING" && <label>{t.destinationIp}<SearchableSelect ariaLabel={t.destinationIp} required value={route.processId}
                  onChange={processId => setCancellationRoutes(current => ({ ...current, [order.id]: { type: "EXISTING", processId } }))}
                  options={destinationIps.map(target => ({ value: target.id,
                    label: `${target.ipNumber} · ${(t.record as Record<string, string>)[target.recordStatus ?? ""] ?? target.recordStatus ?? ""}` }))} /></label>}
                {route.type === "NEW" && <label>{t.newIpRef}<input required maxLength={80} value={route.ipNumber}
                  onChange={event => setCancellationRoutes(current => ({ ...current, [order.id]: { type: "NEW", ipNumber: event.target.value } }))} /></label>}
              </div>;
            })}
            <button className="button" disabled={cancelling || lifecycleBusy !== null || lifecycleReason.trim().length < 3}>
              {cancelling ? t.cancelling : t.actions.cancel}
            </button>
          </form>
        </details>}
        </div>
        {lifecycleActions.includes("delete") && deleteDisabled && <p className="notice" role="status">
          {t.deleteBlocked}
        </p>}
        {lifecycleActions.includes("delete") && lifecycleReason.trim().length < 3
          && <p className="muted">{t.reasonHint}</p>}
      </section>
      <section className="card"><h2>{t.operationalTitle}</h2>
        <p>{t.priorityNotes(process.priority ?? t.priorityNotInformed, process.notes || "—")}</p>
        {canWrite && process.recordStatus !== "DELETED" && process.lifecycleStatus === "OPEN"
          && (process.sourceKind === "CHINA_INVOICE" || process.recordStatus === "DRAFT")
          && <p><Link className="button secondary" href={`/processes/new?reviewInvoice=${encodeURIComponent(id)}`}>
            {process.recordStatus === "DRAFT" ? t.loadInvoice : t.reviewInvoice}</Link></p>}
        {canWrite && process.lifecycleStatus === "OPEN" && process.recordStatus === "ACTIVE" && <>
          <details className="process-action"><summary className="process-action-trigger">{t.edit}</summary><form className="stack-form" onSubmit={saveProcess}>
          <label>{m.poPanel.importer}<SearchableSelect ariaLabel={m.poPanel.importer} required disabled={process.sourceKind !== "MANUAL" || process.purchaseOrders.length > 0
            || process.operationalAllocations.length > 0 || process.historicalCosts.length > 0
            || (process.processDocumentCount ?? 0) > 0 || lines.totalCount > 0} value={importerDraft} onChange={setImporterDraft}
            options={importers.map(option => ({ value: option.code, label: option.code }))} /></label>
          <label>{m.poPanel.ipNumber}<input required maxLength={80} disabled={process.sourceKind !== "MANUAL"}
            value={ipNumberDraft} onChange={event => setIpNumberDraft(event.target.value)} /></label>
          <label>{m.poPanel.logisticsStatus}<OperationalOptionSelect entity="logistics_status" value={logisticsStatusDraft}
            values={operationalOptions} onChange={setLogisticsStatusDraft} /></label>
          <label>{m.poPanel.priority}<OperationalOptionSelect entity="priority" value={priorityDraft}
            values={operationalOptions} onChange={setPriorityDraft} /></label>
          <label>{m.poPanel.notes}<textarea maxLength={4000} value={notesDraft} onChange={event => setNotesDraft(event.target.value)} /></label>
          <button className="button" disabled={saving}>{saving ? m.newRecord.saving : m.newRecord.saveIp}</button>
          </form></details>
        </>}
      </section>
      <section className="card"><h2>{t.linkedTitle}</h2><p className="muted">{t.linkedHelp}</p>
        {process.purchaseOrders.length === 0 && <p>{t.noLinked}</p>}
        {process.purchaseOrders.map(order => <p key={order.id}><Link className="text-link" href={`/purchase-orders/${order.id}`}>PO {order.number} →</Link> · {order.importer} · {order.linkSource}</p>)}
        {canWrite && process.lifecycleStatus === "OPEN" && process.recordStatus === "ACTIVE" && <div className="operational-allocation">
          <div className="allocation-heading">
            <div><h3>{t.distributeTitle}</h3>
              <p>{t.distributeHelp}</p>
            </div>
          </div>
            {searchingPos && <p className="allocation-feedback" role="status">{t.searchingPo}</p>}
          {poSearchMessage && <p className="allocation-feedback" role="status">{poSearchMessage}</p>}

          <div className="allocation-step-title"><span>1</span><div><h4>{t.step1}</h4><p>{t.step1Help(process.importer)}</p></div></div>
          <form className="allocation-po-search" onSubmit={searchPurchaseOrders}>
            <div className="allocation-search-row">
              <label>{t.searchByNumber}<input value={poQuery} autoComplete="off" placeholder={t.numberPlaceholder}
                onChange={event => {
                  const value = event.target.value;
                  const form = event.currentTarget.form;
                  poSearchRequest.current += 1;
                  window.clearTimeout(poSearchTimer.current);
                  setPoQuery(value); setPoOptions([]); setPoSearchMessage(""); setSaveError(undefined);
                  setSelectedPoId(""); setSelectedPoItemId(""); setPoItems([]); setAllocationQuantity("");
                  setSearchingPos(false);
                  if (value.trim()) poSearchTimer.current = window.setTimeout(() => form?.requestSubmit(), 250);
                }} /></label>
              <button hidden className="button secondary" type="submit" disabled={searchingPos || !poQuery.trim()}>
                {searchingPos ? t.searching : t.searchPo}
              </button>
            </div>
            {poOptions.length > 0 && <div className="allocation-po-choices">
              <h5>{t.selectPo}</h5>
              <ul>{poOptions.map(order => <li key={order.id}>
                <button type="button" aria-pressed={selectedPoId === order.id}
                  className={selectedPoId === order.id ? "is-selected" : ""}
                  disabled={searchingPos} onClick={() => void choosePurchaseOrder(order.id)}>{order.number}</button>
              </li>)}</ul>
            </div>}
          </form>

          {selectedPoId && <form className="allocation-distribution" onSubmit={distributeItemToProcess}>
            <div className="allocation-step-title"><span>2</span><div><h4>{t.step2}</h4>
              <p>{t.step2Help}</p></div></div>
            <label>{t.poItem}<SearchableSelect ariaLabel={t.poItem} required value={selectedPoItemId}
              disabled={searchingPos || poItems.length === 0}
              placeholder={poItems.length ? t.selectItem : t.noItems}
              onChange={value => { setSelectedPoItemId(value); setAllocationQuantity(""); }}
              options={poItems.map(item => ({ value: item.id,
                label: t.itemOption(item.productCode, item.lineNumber, `${formatQuantityUnits(quantityUnits(item.remainingQuantity) ?? 0n)}${item.unit ? ` ${item.unit}` : ""}`),
                searchText: item.description }))} /></label>
            {selectedPoItem && <>
              <div className="allocation-balance" aria-live="polite">
                <div><span>{t.available}</span><strong>{formatQuantityUnits(remainingUnits ?? 0n)}{selectedPoItem.unit ? ` ${selectedPoItem.unit}` : ""}</strong></div>
                <p>{remainingAfterAllocation !== null
                  ? <>{t.remainingBefore}<strong>{remainingAfterAllocation}{selectedPoItem.unit ? ` ${selectedPoItem.unit}` : ""}</strong>{t.remainingAfter}</>
                  : t.enterQuantity}</p>
              </div>
              <div className="allocation-submit-row">
                <label>{t.quantityForIp}<input required inputMode="decimal" value={allocationQuantity}
                  onChange={event => setAllocationQuantity(event.target.value)} placeholder={m.poPanel.quantityPlaceholder} /></label>
                <button className="button" disabled={!selectedPoItemId || !allocationQuantity || searchingPos || linkingPo
                  || allocationUnits === null || allocationUnits <= 0n || remainingUnits === null || allocationUnits > remainingUnits}>
                  {linkingPo ? t.distributing : t.confirmDistribution}
                </button>
              </div>
              {selectedPoItem && allocationUnits !== null && remainingUnits !== null && allocationUnits > remainingUnits
                && <p className="notice error" role="alert">{t.exceeds}</p>}
              {process.shipped && <ShippedChangeConfirmation value={shippedChange} onChange={setShippedChange} />}
            </>}
          </form>}
        </div>}
      </section>
      <section className="card"><h2>{t.allocatedTitle}</h2>
        <p className="muted">{t.allocatedHelp}</p>
        {process.operationalAllocations.length === 0 ? <p>{m.poPanel.noAllocations}</p> :
          <div className="table-scroll"><table><thead><tr><th>PO</th><th>{m.poPanel.product}</th><th>{m.poPanel.quantityInIp}</th><th>{m.poPanel.remaining}</th></tr></thead><tbody>
            {process.operationalAllocations.map(item => <tr key={item.id}>
              <td><Link className="text-link" href={`/purchase-orders/${item.poId}`}>{item.poNumber}</Link></td>
              <td>{item.productCode}</td><td>{formatNumber(item.quantity)} {item.unit}</td>
              <td>{formatNumber(item.poItemRemainingQuantity)} {item.unit}</td>
            </tr>)}
          </tbody></table></div>}
      </section>
      <ProcessPostShipmentPanel id={id} />
      <details className="card historical-disclosure"><summary>{t.sourceTitle(lines.totalCount)}</summary>
        {lines.items.length === 0 && <p>{t.noLines}</p>}
        {lines.items.length > 0 && <div className="table-scroll"><table><thead><tr><th>{t.source}</th><th>PO</th><th>{t.sourceProduct}</th><th>{t.sourceQuantity}</th><th>{t.sourceStatus}</th><th>{t.cells}</th></tr></thead><tbody>
          {lines.items.map(line => <Fragment key={line.id}><tr><td>{line.sourceSheetName} · {line.sourceRowNumber}</td><td>{line.purchaseOrderId ? <Link className="text-link" href={`/purchase-orders/${line.purchaseOrderId}`}>{line.poNumber}</Link> : t.noPo}</td><td>{line.productCode ?? "—"}<br />{line.productDescription}</td><td>{formatNumber(line.quantityFromSource)}</td><td>{line.legacyStatus ?? "—"}</td><td><button type="button" className="source-expand-button" aria-label={t.toggleFields(expandedLineId !== line.id, line.sourceRowNumber, line.sourceSheetName)} aria-expanded={expandedLineId === line.id} onClick={() => setExpandedLineId(current => current === line.id ? undefined : line.id)}>{expandedLineId === line.id ? t.hideFields : t.showFields}</button></td></tr>
            {expandedLineId === line.id && <tr className="source-detail-row"><td colSpan={6}><section className="source-detail-panel"><div className="source-detail-heading"><strong>{t.preservedFields}</strong><span>{t.sheetRow(line.sourceSheetName, line.sourceRowNumber)}</span></div><dl className="source-field-grid">{Object.entries(line.sourceValues ?? {}).map(([column, value]) => <div className="source-field" key={column}><dt>{line.sourceColumnHeaders?.[column] || t.noHeader}<small>{column}{line.sourceRowNumber}</small></dt><dd>{value == null ? "—" : String(value)}</dd></div>)}</dl></section></td></tr>}</Fragment>)}
        </tbody></table></div>}
        {lines.totalCount > lines.pageSize && <nav className="pagination"><button className="button secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>{m.common.previous}</button><span>{m.common.pageOf(page, Math.ceil(lines.totalCount / lines.pageSize))}</span><button className="button" disabled={page * lines.pageSize >= lines.totalCount} onClick={() => setPage(value => value + 1)}>{m.common.next}</button></nav>}
      </details><details className="card historical-disclosure"><summary>{t.costsTitle(process.historicalCosts.length)}</summary>
        {process.historicalCosts.length === 0 && <p>{t.noCosts}</p>}
        {process.historicalCosts.length > 0 && <div className="table-scroll"><table><thead><tr><th>{t.type}</th><th>{t.amount}</th><th>{t.status}</th><th>{t.source}</th></tr></thead><tbody>{process.historicalCosts.map(cost => <tr key={cost.id}><td>{cost.type}</td><td>{formatNumber(cost.amount)} {cost.currency}</td><td>{cost.status}</td><td>{cost.sourceSheetName} · {cost.sourceColumn}{cost.sourceRowNumber}</td></tr>)}</tbody></table></div>}
      </details>
    </>}
  </main>;
}

function Metric({ label, value }: { label: string; value: number }) { return <section className="metric"><span>{label}</span><strong>{value}</strong></section>; }
