"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { apiFetch, hasPoLifecycleSupport, readApiJson } from "../lib/api";
import { automaticAuditReason, emptyShippedChange, quantityChanged, shippedChangeFields, shippedChangeReady } from "../lib/audit";
import ShippedChangeConfirmation from "./ShippedChangeConfirmation";
import { purchaseOrderActorLabel, purchaseOrderLifecycleActions, type PurchaseOrderLifecycleStatus } from "../lib/po-lifecycle";
import { SearchableSelect } from "./SearchableSelect";
import { blankPurchaseOrderItemFields, OperationalFieldDraft, OperationalFieldsEditor,
  purchaseOrderCommonItemFields, purchaseOrderSpecificFields, purchaseOrderItemFields,
  purchaseOrderItemFieldsPayload } from "./PurchaseOrderItemFields";
import { CatalogChoice, CatalogProductSelect, loadCatalogChoices, loadOperationalCatalog, OperationalOption, OperationalOptionSelect } from "./OperationalOptionSelect";
import PurchaseOrderScLink from "./PurchaseOrderScLink";
import { lockedSharedFieldKeys, sharedFieldsSavedMessage } from "../lib/po-sc-link";
import { loadPurchaseRequests, purchaseRequestOperationalFields, PurchaseRequestChoice, PurchaseRequestSelect } from "./PurchaseRequestSelect";
import PurchaseOrderCalculatedFields from "./PurchaseOrderCalculatedFields";
import { formatUsDate, formatUsDateTime } from "../lib/date-format";
import { formatNumber } from "../lib/format-number";
import type { Messages } from "../lib/i18n/pt-BR";
import { useConfirmDialog } from "./ConfirmDialog";
import { getMessages, useI18n } from "./I18nProvider";
import { estimatedProductTotal, productPriceReferenceForCurrency, type ProductPriceReference } from "../lib/product-price-reference";
import { parseTotvsPoXlsx } from "../lib/totvs-po-xlsx";

type Item = { id: string; lineNumber: number; externalLineReference: string | null;
  productCode: string; description: string; orderedQuantity: string; unit: string | null;
  unitPrice: string | null; currency: string | null; sourceKind: string; sourceStatus: string | null;
  necessityDate: string | null; priority: string | null; demand: string | null; demandType: string | null; requester: string | null;
  scNumber: string | null; scApprovalDate: string | null; purpose: string | null; productGroup: string | null; group: string | null;
  costCenter: string | null; draftPo: string | null; poApprovalDate: string | null; poSentDate: string | null;
  category: string | null; ncm: string | null; remarks: string | null; commercialPlanReceivedDate: string | null;
  mrpCompletedDate: string | null; targetMrpDays: number | null; targetOrderDays: number | null;
  targetShipmentDays: number | null; targetPortDays: number | null; targetTransitDays: number | null;
  targetCustomsDays: number | null; actualFactoryShipDate: string | null;
  allocatedQuantity: string; remainingQuantity: string;
  referencePrices?: ProductPriceReference[]; priceReference?: ProductPriceReference | null;
  latestTotvsDescription?: string | null };
type Allocation = { id: string; itemId: string; processId: string; ipNumber: string;
  quantity: string; notes: string; factoryShipDate: string | null; version: string; processShipped?: boolean };
type OperationalPo = { id: string; importer: string; number: string; supplierText: string | null;
  orderDate: string | null; notes: string; sourceKind: string; version: string;
  lifecycleStatus?: PurchaseOrderLifecycleStatus;
  lifecycleChangedAt: string | null; lifecycleChangedBy: string | null; lifecycleReason: string | null;
  createdAt?: string | null; lastRestore?: { at: string; by: string; reason: string | null } | null;
  purchaseRequestId: string | null;
  purchaseRequest: { id: string; importer: string; scNumber: string; supplierText: string | null; scDate: string | null; commercialPlanReceivedDate: string | null;
    requester: string; approvalDate: string | null } | null;
  items: Item[]; allocations: Allocation[] };
type FollowupItem = { id: string } & Record<string, unknown>;
type ProcessOption = { id: string; ipNumber: string; importer: string; shipped?: boolean };
type ImporterChoice = { code: string; cnpj: string | null; shortName: string | null; acceptsNewPurchaseOrders: boolean };
type ReimportItem = { externalLineReference: string; productCode: string; description: string;
  orderedQuantity: string; unitPrice: string };
type ReimportPayload = { header: { number: string }; fileName: string; fileSha256: string;
  currency: string; items: ReimportItem[] };
type ReimportDifference = { externalLineReference: string; productCode: string;
  changes: Record<string, { before: string | null; after: string }> };
type ReimportPreview = { version: string; differences: ReimportDifference[]; missingReferences: string[];
  unknownReferences: string[]; cancelledReferences: string[];
  productCodeMismatches: Array<{ externalLineReference: string; current: string; incoming: string }>;
  canApply: boolean };
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
function formatItemQuantity(value: string) {
  return formatNumber(value);
}
function formatItemPrice(value: string | null, currency: string | null, m: Messages) {
  if (value == null) return m.common.notInformed;
  const formatted = formatNumber(value);
  return currency ? `${formatted} ${currency}` : formatted;
}

async function isLegacySharedFieldsEndpoint(response: Response): Promise<boolean> {
  if (response.status === 404) return true;
  if (response.status !== 400) return false;
  try {
    const problem = await response.clone().json() as { code?: unknown };
    return problem.code === "INVALID_ITEM";
  } catch {
    return false;
  }
}

async function missingRoute(response: Response, route: string): Promise<boolean> {
  if (response.status !== 404) return false;
  const body = await response.clone().json().catch(() => null) as { message?: string } | null;
  return body?.message === `Route ${route} not found`;
}

async function loadFollowupItems(poId: string, signal?: AbortSignal): Promise<FollowupItem[]> {
  const followup = await responseData<{ items: FollowupItem[] }>(await apiFetch(
    `/api/v1/purchase-orders/${poId}/followup`, { signal, cache: "no-store" }));
  if (!Array.isArray(followup.items)) throw new Error(getMessages().poPanel.noFollowupFields);
  return followup.items;
}

function combineOperationalItems(items: Item[], followupItems: FollowupItem[], supportsGroup: boolean): Item[] {
  const byId = new Map(followupItems.map(item => [item.id, item]));
  return items.map(item => {
    const followup = byId.get(item.id);
    if (!followup || purchaseOrderItemFields.some(field => (field.key !== "group" || supportsGroup)
      && !Object.prototype.hasOwnProperty.call(followup, field.key))) {
      throw new Error(getMessages().poPanel.missingFollowupFields);
    }
    const fields = Object.fromEntries(purchaseOrderItemFields.map(field => [field.key, followup[field.key] ?? ""]));
    return { ...item, ...fields };
  });
}

async function verifySavedItemFields(poId: string, expectedByItem: Map<string, Record<string, string | number | null>>) {
  const savedItems = new Map((await loadFollowupItems(poId)).map(item => [item.id, item]));
  const notSaved = [...expectedByItem].some(([itemId, fields]) => {
    const saved = savedItems.get(itemId);
    return !saved || Object.entries(fields).some(([key, expected]) =>
      String(saved[key] ?? "") !== String(expected ?? ""));
  });
  if (notSaved) throw new Error(getMessages().poPanel.fieldsNotReread);
}

async function verifySavedItem(poId: string, itemId: string,
  base: { externalLineReference: string | null; productCode: string; description: string;
    orderedQuantity: string; unit: string; unitPrice: string | null; currency: string | null },
  fields: Record<string, string | number | null>) {
  const saved = (await loadFollowupItems(poId)).find(item => item.id === itemId);
  if (!saved || saved.productCode !== base.productCode.trim() ||
    saved.description !== base.description.trim() || saved.unit !== base.unit.trim() ||
    (saved.externalLineReference ?? null) !== (base.externalLineReference?.trim() || null) ||
    Number(saved.orderedQuantity) !== Number(base.orderedQuantity) ||
    (saved.unitPrice === null ? null : Number(saved.unitPrice)) !==
      (base.unitPrice === null ? null : Number(base.unitPrice)) ||
    (saved.currencyCode ?? null) !== base.currency ||
    Object.entries(fields).some(([key, value]) => String(saved[key] ?? "") !== String(value ?? ""))) {
    throw new Error(getMessages().poPanel.itemNotReread);
  }
}

export default function OperationalPoPanel({ id, onChanged }: { id: string; onChanged?: () => void }) {
  const { m } = useI18n();
  const { confirm, dialog } = useConfirmDialog();
  const t = m.poPanel;
  const [data, setData] = useState<OperationalPo>();
  const [roles, setRoles] = useState<string[]>([]);
  const [importer, setImporter] = useState("");
  const [importers, setImporters] = useState<ImporterChoice[]>([]);
  const [number, setNumber] = useState("");
  const [supplier, setSupplier] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [purchaseRequestId, setPurchaseRequestId] = useState("");
  const [notes, setNotes] = useState("");
  const [itemDraft, setItemDraft] = useState<ItemDraft>(blankItem);
  const [itemDrafts, setItemDrafts] = useState<Record<string, ItemDraft>>({});
  const [commonOperationalDraft, setCommonOperationalDraft] = useState<OperationalFieldDraft>(blankPurchaseOrderItemFields);
  const [commonFieldsTouched, setCommonFieldsTouched] = useState<Set<string>>(new Set());
  const [ipQuery, setIpQuery] = useState("");
  const [ipOptions, setIpOptions] = useState<ProcessOption[]>([]);
  const [ipSearchMessage, setIpSearchMessage] = useState("");
  const [searchingIps, setSearchingIps] = useState(false);
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
  const [shippedChange, setShippedChange] = useState(emptyShippedChange);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [reimportFileName, setReimportFileName] = useState("");
  const [reimportPayload, setReimportPayload] = useState<ReimportPayload>();
  const [reimportPreview, setReimportPreview] = useState<ReimportPreview>();
  const [reimportCurrency, setReimportCurrency] = useState("CNY");
  const [reimportReason, setReimportReason] = useState("");
  const [reimportLoading, setReimportLoading] = useState(false);
  const [reimportFileError, setReimportFileError] = useState("");
  const [itemRemovalReasons, setItemRemovalReasons] = useState<Record<string, string>>({});
  const [reload, setReload] = useState(0);
  const [products, setProducts] = useState<CatalogChoice[]>([]);
  const [suppliers, setSuppliers] = useState<CatalogChoice[]>([]);
  const [options, setOptions] = useState<OperationalOption[]>([]);
  const [supportsGroup, setSupportsGroup] = useState(false);
  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequestChoice[]>([]);
  const specificItemFields = purchaseOrderSpecificFields(supportsGroup);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    Promise.all([
      apiFetch(`/api/v1/purchase-orders/${id}/operational`, { signal: controller.signal, cache: "no-store" }),
      loadFollowupItems(id, controller.signal),
      apiFetch("/auth/me", { signal: controller.signal }),
      loadOperationalCatalog(),
      apiFetch("/api/v1/importers", { signal: controller.signal, cache: "no-store" }),
    ]).then(async ([poResponse, followupItems, identityResponse, operationalCatalog, importerResponse]) => {
      const operationalPo = await responseData<OperationalPo>(poResponse);
      const po = { ...operationalPo, items: combineOperationalItems(operationalPo.items, followupItems, operationalCatalog.purchaseOrderGroup) };
      const identity = await responseData<{ roles: string[] }>(identityResponse);
      const importerResult = await responseData<{ items: ImporterChoice[] }>(importerResponse);
      const [productChoices, supplierChoices] = await Promise.all([
        loadCatalogChoices("products", po.importer), loadCatalogChoices("suppliers", po.importer),
      ]);
      const requestChoices = identity.roles.some(role => poWriters.has(role))
        ? await loadPurchaseRequests(po.importer, controller.signal) : [];
      if (controller.signal.aborted) return;
      setData(po); setRoles(identity.roles); setOptions(operationalCatalog.items);
      setImporters(importerResult.items); setImporter(po.importer);
      setSupportsGroup(operationalCatalog.purchaseOrderGroup);
      setProducts(productChoices); setSuppliers(supplierChoices);
      setPurchaseRequests(requestChoices); setPurchaseRequestId(po.purchaseRequestId ?? "");
      setNumber(po.number);
      setSupplier(po.supplierText ?? ""); setOrderDate(po.orderDate ?? ""); setNotes(po.notes);
      const drafts = Object.fromEntries(po.items.map(item => [item.id, {
        externalLineReference: item.externalLineReference ?? "", productCode: item.productCode,
        description: item.description, orderedQuantity: item.orderedQuantity, unit: item.unit ?? "",
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
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : getMessages().common.unexpectedError); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, reload]);

  const canWritePo = roles.some(role => poWriters.has(role));
  const activePo = data?.lifecycleStatus === "ACTIVE";
  const canEditPo = canWritePo && activePo;
  const canAllocate = activePo && roles.some(role => allocationWriters.has(role));
  const lifecycleSupported = hasPoLifecycleSupport(data);
  const canManageLifecycle = roles.some(role => role === "Master" || role === "Administrador");
  const canChangeImporter = canEditPo && canManageLifecycle;
  const lifecycleActions = purchaseOrderLifecycleActions(data?.lifecycleStatus, canWritePo, canManageLifecycle);
  async function send(path: string, method: string, body: unknown, version?: string) {
    const response = await apiFetch(path, { method,
      headers: { "content-type": "application/json", ...(version ? { "X-Record-Version": version } :
        { "Idempotency-Key": crypto.randomUUID() }) }, body: JSON.stringify(body) });
    return responseData<{ id: string }>(response);
  }
  async function applyCommonFieldsToItems(fields: Record<string, string | number | null>): Promise<boolean> {
    if (!data) return false;
    let purchaseRequestUpdated = false;
    const current = await responseData<{ version: string }>(await apiFetch(
      `/api/v1/purchase-orders/${id}/operational`, { cache: "no-store" }));
    const batch = await apiFetch(`/api/v1/purchase-orders/${id}/items/followup`, {
      method: "PATCH", headers: { "content-type": "application/json", "X-Record-Version": current.version },
      body: JSON.stringify({ itemIds: data.items.map(item => item.id), fields, reason: automaticAuditReason }),
    });
    if (await isLegacySharedFieldsEndpoint(batch)) {
      // Older APIs route this URL as an item ID and return INVALID_ITEM instead of 404.
      let completed = 0;
      for (const item of data.items) {
        try {
          const latest = await responseData<{ version: string }>(await apiFetch(
            `/api/v1/purchase-orders/${id}/operational`, { cache: "no-store" }));
          await send(`/api/v1/purchase-orders/${id}/items/${item.id}/followup`, "PATCH",
            { fields, reason: automaticAuditReason }, latest.version);
          completed += 1;
        } catch (cause) {
          const detail = cause instanceof Error ? cause.message : m.common.unexpectedError;
          throw new Error(t.productFailed(item.productCode, completed, detail));
        }
      }
    } else {
      const saved = await responseData<{ updatedCount: number; purchaseRequestUpdated?: boolean }>(batch);
      if (saved.updatedCount !== data.items.length) {
        throw new Error(t.unexpectedCount);
      }
      purchaseRequestUpdated = saved.purchaseRequestUpdated === true;
    }
    await verifySavedItemFields(id, new Map(data.items.map(item => [item.id, fields])));
    return purchaseRequestUpdated;
  }
  async function save<T>(action: () => Promise<T>, success: string | ((result: T) => string)) {
    setSaving(true); setError(""); setNotice("");
    try { const result = await action(); setNotice(typeof success === "function" ? success(result) : success); setReload(value => value + 1); onChanged?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : m.common.unexpectedError); }
    finally { setSaving(false); }
  }
  async function changeLifecycle(action: "cancel" | "close" | "reopen" | "delete" | "reactivate" | "restore") {
    if (!data) return;
    if (action === "delete" && !(await confirm({ title: m.dialog.deleteTitle, message: t.confirmDelete, confirmLabel: m.dialog.delete, danger: true }))) return;
    const method = action === "delete" ? "DELETE" : "POST";
    const success = t.lifecycleDone[action];
    await save(async () => {
      const response = await apiFetch(`/api/v1/purchase-orders/${id}${action === "delete" ? "" : `/${action}`}`, {
        method, headers: { "content-type": "application/json", "X-Record-Version": data.version },
        body: JSON.stringify({ reason: lifecycleReason.trim() }),
      });
      await responseData<{ id: string; lifecycleStatus: OperationalPo["lifecycleStatus"]; version: string }>(response);
      setLifecycleReason("");
    }, success);
  }
  async function selectReimportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
    if (!file) return;
    setReimportFileName(file.name); setReimportPayload(undefined); setReimportPreview(undefined);
    setReimportFileError(""); setReimportReason(""); setReimportLoading(true);
    try {
      const result = await parseTotvsPoXlsx(file, m);
      const invalidTotals = result.rows.filter(row => !row.totalWithinTolerance);
      if (invalidTotals.length) {
        throw new Error(t.totalMismatch(invalidTotals.slice(0, 8).map(row => row.externalLineReference).join(", ")));
      }
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const fileSha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      setReimportPayload({ header: { number: result.header.number }, fileName: file.name, fileSha256,
        currency: "CNY", items: result.rows.map(row => ({ externalLineReference: row.externalLineReference,
          productCode: row.productCode, description: row.description, orderedQuantity: row.orderedQuantity,
          unitPrice: row.unitPrice })) });
      setReimportCurrency("CNY");
    } catch (cause) { setReimportFileError(cause instanceof Error ? cause.message : t.readSheetFailed); }
    finally { setReimportLoading(false); }
  }
  async function previewReimport() {
    if (!data || !reimportPayload || reimportLoading) return;
    const route = `/api/v1/purchase-orders/${id}/reimport/preview`;
    setReimportLoading(true); setReimportFileError(""); setReimportPreview(undefined);
    try {
      const response = await apiFetch(route, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...reimportPayload, currency: reimportCurrency }) });
      if (await missingRoute(response, `POST:${route}`)) {
        throw new Error(t.noReimportPreview);
      }
      setReimportPreview(await responseData<ReimportPreview>(response));
    } catch (cause) { setReimportFileError(cause instanceof Error ? cause.message : t.compareFailed); }
    finally { setReimportLoading(false); }
  }
  async function applyReimport() {
    if (!data || !reimportPayload || !reimportPreview?.canApply || !reimportReason.trim()) return;
    const route = `/api/v1/purchase-orders/${id}/reimport`;
    await save(async () => {
      const response = await apiFetch(route, { method: "POST",
        headers: { "content-type": "application/json", "X-Record-Version": reimportPreview.version },
        body: JSON.stringify({ ...reimportPayload, currency: reimportCurrency, reason: reimportReason.trim() }) });
      if (await missingRoute(response, `POST:${route}`)) {
        throw new Error(t.noReimport);
      }
      const result = await responseData<{ updatedCount: number }>(response);
      setReimportPreview(undefined); setReimportPayload(undefined); setReimportFileName(""); setReimportReason("");
      return result.updatedCount;
    }, t.reimportApplied);
  }
  async function removeItem(item: Item) {
    if (!data) return;
    const itemReason = itemRemovalReasons[item.id]?.trim() ?? "";
    if (itemReason.length < 3) { setError(t.removalReasonRequired); return; }
    await save(async () => {
      await send(`/api/v1/purchase-orders/${id}/items/${item.id}/remove`, "POST",
        { reason: itemReason }, data.version);
      setItemRemovalReasons(current => ({ ...current, [item.id]: "" }));
    }, t.itemRemoved);
  }
  async function saveHeader(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data) return;
    await save(async () => {
      const header = { number, supplierText: supplier || null, orderDate: orderDate || null, notes,
        purchaseRequestId: purchaseRequestId || null, reason: automaticAuditReason,
        ...(importer !== data.importer ? { importer } : {}) };
      if (commonFieldsTouched.size && data.items.length) {
        const fieldsToSave = purchaseOrderCommonItemFields.filter(field => commonFieldsTouched.has(field.key));
        const fields = purchaseOrderItemFieldsPayload(commonOperationalDraft, true, fieldsToSave);
        const route = `/api/v1/purchase-orders/${id}/complete`;
        const response = await apiFetch(route, { method: "PATCH",
          headers: { "content-type": "application/json", "X-Record-Version": data.version },
          body: JSON.stringify({ header, itemIds: data.items.map(item => item.id), fields }) });
        let purchaseRequestUpdated: boolean;
        if (await missingRoute(response, `PATCH:${route}`)) {
          await send(`/api/v1/purchase-orders/${id}`, "PATCH", header, data.version);
          purchaseRequestUpdated = await applyCommonFieldsToItems(fields);
        } else {
          const result = await responseData<{ updatedCount: number; purchaseRequestUpdated?: boolean }>(response);
          if (result.updatedCount !== data.items.length) {
            throw new Error(t.unexpectedCountSc);
          }
          await verifySavedItemFields(id, new Map(data.items.map(item => [item.id, fields])));
          purchaseRequestUpdated = result.purchaseRequestUpdated === true;
        }
        setCommonFieldsTouched(new Set());
        return purchaseRequestUpdated;
      } else {
        await send(`/api/v1/purchase-orders/${id}`, "PATCH", header, data.version);
        setCommonFieldsTouched(new Set());
        return false;
      }
    }, purchaseRequestUpdated => sharedFieldsSavedMessage(
      commonFieldsTouched.size ? t.poAndSharedUpdated : t.poUpdated,
      purchaseRequestUpdated, data.purchaseRequest?.scNumber ?? null, m));
  }
  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data) return;
    if (commonFieldsTouched.size) { setError(t.saveSharedFirst); return; }
    const item = data.items.find(row => row.id === event.currentTarget.dataset.itemId);
    if (!item) return;
    const draft = itemDrafts[item.id];
    if (!draft?.productCode) { setError(t.selectProduct); return; }
    const body = { externalLineReference: draft.externalLineReference || null,
      productCode: draft.productCode, description: draft.description,
      orderedQuantity: draft.orderedQuantity.replace(",", "."), unit: draft.unit,
      unitPrice: draft.unitPrice ? draft.unitPrice.replace(",", ".") : null,
      currency: draft.currency ? draft.currency.toUpperCase() : null, reason: automaticAuditReason };
    const fields = purchaseOrderItemFieldsPayload(draft.operational, true, specificItemFields);
    await save(async () => {
      const route = `/api/v1/purchase-orders/${id}/items/${item.id}/complete`;
      const result = await apiFetch(route, { method: "PATCH",
        headers: { "content-type": "application/json", "X-Record-Version": data.version },
        body: JSON.stringify({ base: body, fields }) });
      if (await missingRoute(result, `PATCH:${route}`)) {
        await send(`/api/v1/purchase-orders/${id}/items/${item.id}`, "PATCH", body, data.version);
        try {
          const latest = await responseData<{ version: string }>(await apiFetch(`/api/v1/purchase-orders/${id}/operational`, { cache: "no-store" }));
          await send(`/api/v1/purchase-orders/${id}/items/${item.id}/followup`, "PATCH",
            { fields, reason: automaticAuditReason }, latest.version);
        } catch (cause) {
          throw new Error(t.basicMaybeSaved(cause instanceof Error ? cause.message : m.common.unexpectedError));
        }
      } else await responseData(result);
      await verifySavedItem(id, item.id, body, fields);
    }, t.itemUpdated);
  }
  function updateCommonField(key: string, value: string) {
    setCommonOperationalDraft(current => ({ ...current, [key]: value }));
    setCommonFieldsTouched(current => new Set(current).add(key));
    setItemDrafts(current => Object.fromEntries(Object.entries(current).map(([rowId, draft]) =>
      [rowId, { ...draft, operational: { ...draft.operational, [key]: value } }])));
  }
  function selectPurchaseRequest(value: string) {
    setPurchaseRequestId(value);
    const selected = purchaseRequests.find(choice => choice.id === value);
    if (selected?.supplierText) setSupplier(selected.supplierText);
    for (const [key, fieldValue] of Object.entries(purchaseRequestOperationalFields(selected))) {
      updateCommonField(key, fieldValue);
    }
  }
  async function saveCommonFields(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data || !commonFieldsTouched.size) return;
    const fieldsToSave = purchaseOrderCommonItemFields.filter(field => commonFieldsTouched.has(field.key));
    const fields = purchaseOrderItemFieldsPayload(commonOperationalDraft, true, fieldsToSave);
    await save(async () => {
      const purchaseRequestUpdated = await applyCommonFieldsToItems(fields);
      setCommonFieldsTouched(new Set());
      return purchaseRequestUpdated;
    }, purchaseRequestUpdated => sharedFieldsSavedMessage(t.sharedApplied,
      purchaseRequestUpdated, data.purchaseRequest?.scNumber ?? null, m));
  }
  async function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data) return;
    if (commonFieldsTouched.size && data.items.length) { setError(t.saveSharedFirst); return; }
    const draft = itemDraft;
    if (!draft.productCode) { setError(t.selectNewProduct); return; }
    await save(async () => {
      const base = { externalLineReference: draft.externalLineReference || null, productCode: draft.productCode,
        description: draft.description, orderedQuantity: draft.orderedQuantity.replace(",", "."),
        unit: draft.unit, unitPrice: draft.unitPrice ? draft.unitPrice.replace(",", ".") : null,
        currency: draft.currency ? draft.currency.toUpperCase() : null, reason: automaticAuditReason };
      const operational = {
        ...purchaseOrderItemFieldsPayload(draft.operational, false, specificItemFields),
        ...purchaseOrderItemFieldsPayload(commonOperationalDraft, false, purchaseOrderCommonItemFields),
      };
      const route = `/api/v1/purchase-orders/${id}/items/complete`;
      const result = await apiFetch(route, { method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ base, fields: operational }) });
      let created: { id: string };
      if (await missingRoute(result, `POST:${route}`)) {
        created = await send(`/api/v1/purchase-orders/${id}/items`, "POST", base);
        try {
          if (Object.keys(operational).length > 0) {
            const latest = await responseData<{ version: string }>(await apiFetch(`/api/v1/purchase-orders/${id}/operational`, { cache: "no-store" }));
            await send(`/api/v1/purchase-orders/${id}/items/${created.id}/followup`, "PATCH",
              { fields: operational, reason: automaticAuditReason }, latest.version);
          }
        } catch (cause) {
          throw new Error(t.basicMaybeCreated(cause instanceof Error ? cause.message : m.common.unexpectedError));
        }
      } else {
        created = await responseData<{ id: string }>(result);
      }
      await verifySavedItem(id, created.id, base, operational);
      setItemDraft(blankItem());
    }, t.itemCreated);
  }
  async function searchIps(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || searchingIps) return;
    const searchTerm = ipQuery.trim();
    if (!searchTerm) {
      setIpOptions([]);
      setProcessId("");
      setIpSearchMessage(t.enterIp);
      return;
    }
    setSearchingIps(true);
    try {
      setError(""); setIpSearchMessage("");
      const query = new URLSearchParams({ importer: data.importer, ipNumber: searchTerm, pageSize: "100" });
      const response = await apiFetch(`/api/v1/processes?${query}`, { cache: "no-store" });
      const result = await responseData<{ items: ProcessOption[] }>(response);
      const normalize = (value: string) => value.trim().toLocaleLowerCase();
      const matches = result.items.filter(item => normalize(item.importer) === normalize(data.importer));
      setIpOptions(matches);
      const exactNumberMatches = matches.filter(item => item.ipNumber.trim().toLocaleLowerCase()
        === searchTerm.toLocaleLowerCase());
      if (exactNumberMatches.length === 1) {
        setProcessId(exactNumberMatches[0].id);
        setIpSearchMessage(t.ipFound(exactNumberMatches[0].ipNumber));
      } else {
        if (!matches.some(item => item.id === processId)) setProcessId("");
        setIpSearchMessage(matches.length === 0
          ? t.noIpFound(data.importer) : t.ipsFound(matches.length));
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : m.common.unexpectedError;
      setError(message);
      setIpSearchMessage(t.ipSearchFailed(message));
    } finally { setSearchingIps(false); }
  }
  async function createIp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data) return;
    await save(async () => {
      const created = await responseData<{ id: string; ipNumber: string }>(await apiFetch("/api/v1/processes", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ importer: data.importer, ipNumber: newIpNumber,
          logisticsStatus: newIpStatus || null, priority: newIpPriority || null, notes: newIpNotes, reason: automaticAuditReason }),
      }));
      setIpOptions(current => [...current.filter(option => option.id !== created.id),
        { id: created.id, ipNumber: created.ipNumber, importer: data.importer }]);
      setProcessId(created.id);
      setIpQuery(created.ipNumber);
      setNewIpNumber(""); setNewIpStatus(""); setNewIpPriority(""); setNewIpNotes("");
      setCreatingIp(false);
    }, t.ipCreated);
  }
  const allocationIpShipped = editingAllocation ? Boolean(editingAllocation.processShipped)
    : Boolean(ipOptions.find(option => option.id === processId)?.shipped);
  // Only a new allocation or a different quantity changes what is on board of a shipped IP.
  const allocationNeedsConfirmation = allocationIpShipped
    && (!editingAllocation || quantityChanged(editingAllocation.quantity, allocationQuantity));
  async function saveAllocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (commonFieldsTouched.size) { setError(t.saveSharedPoFirst); return; }
    if (!itemId || (!processId && !editingAllocation)) return;
    if (!shippedChangeReady(allocationNeedsConfirmation, shippedChange)) {
      setError(t.confirmShipped); return;
    }
    await save(async () => {
      const body = { quantity: allocationQuantity, notes: allocationNotes,
        ...shippedChangeFields(allocationNeedsConfirmation, shippedChange) };
      await send(editingAllocation ? `/api/v1/purchase-orders/${id}/allocations/${editingAllocation.id}` :
        `/api/v1/purchase-orders/${id}/allocations`, editingAllocation ? "PATCH" : "POST",
      editingAllocation ? body : { ...body, itemId, processId }, editingAllocation?.version);
      setEditingAllocation(undefined); setAllocationQuantity(""); setAllocationNotes(""); setShippedChange(emptyShippedChange);
    }, editingAllocation ? t.allocationUpdated : t.quantityAllocated);
  }
  async function cancelAllocation() {
    if (commonFieldsTouched.size) { setError(t.saveSharedPoFirst); return; }
    if (!editingAllocation) return;
    const shipped = Boolean(editingAllocation.processShipped);
    if (!shippedChangeReady(shipped, shippedChange)) {
      setError(t.confirmShippedCancel); return;
    }
    await save(async () => {
      await send(`/api/v1/purchase-orders/${id}/allocations/${editingAllocation.id}`, "DELETE",
        shippedChangeFields(shipped, shippedChange), editingAllocation.version);
      setEditingAllocation(undefined); setAllocationQuantity(""); setAllocationNotes(""); setShippedChange(emptyShippedChange);
    }, t.allocationCancelled);
  }

  const commonValuesDiffer = Boolean(data && data.items.length > 1 &&
    purchaseOrderCommonItemFields.some(field =>
      new Set(data.items.map(item => operationalDraft(item)[field.key] ?? "")).size > 1));
  return <section id="po-record" className="card operational-panel" aria-label={t.ariaLabel}>
    {dialog}
    <h2>{t.title}</h2>
    <p className="muted">{t.intro}</p>
    {loading && <p role="status">{t.loading}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {!loading && data && <>
      {(data.createdAt || data.lastRestore) && <p className="muted">
        {data.createdAt && <>{t.createdAt(formatUsDateTime(data.createdAt))}</>}
        {data.createdAt && data.lastRestore && " · "}
        {data.lastRestore && <>{t.restoredAt(formatUsDateTime(data.lastRestore.at), purchaseOrderActorLabel(data.lastRestore.by))}
          {data.lastRestore.reason && <> — {data.lastRestore.reason}</>}</>}
      </p>}
      {!lifecycleSupported && <p className="notice warning" role="status">{t.noLifecycle}</p>}
      {lifecycleSupported && data.lifecycleStatus !== "ACTIVE" && <p className="notice warning" role="status">
        {data.lifecycleStatus === "CLOSED" ? t.closedNotice
          : data.lifecycleStatus === "CANCELLED" ? t.cancelledNotice : t.deletedNotice}
        {data.lifecycleReason && t.reasonInline(data.lifecycleReason)}
      </p>}
      {lifecycleSupported && (lifecycleActions.length > 0 || data.lifecycleStatus === "DELETED") && <section className="card">
        <h3>{t.lifecycleTitle}</h3>
        {lifecycleActions.length > 0 && <label className="po-lifecycle-reason"><span>{t.actionReason}</span><textarea required minLength={3} maxLength={1000} value={lifecycleReason}
          onChange={event => setLifecycleReason(event.target.value)} /></label>}
        {lifecycleActions.length > 0 && <div className="operational-actions">
          {lifecycleActions.includes("close") && <button className="button secondary" type="button" disabled={saving || !lifecycleReason.trim()}
            onClick={() => void changeLifecycle("close")}>{t.close}</button>}
          {lifecycleActions.includes("cancel") && <button className="button secondary" type="button" disabled={saving || !lifecycleReason.trim() || data.allocations.length > 0}
            onClick={() => void changeLifecycle("cancel")}>{t.cancel}</button>}
          {lifecycleActions.includes("delete") && <button className="button secondary" type="button" disabled={saving || !lifecycleReason.trim() || data.allocations.length > 0}
            onClick={() => void changeLifecycle("delete")}>{t.delete}</button>}
        {lifecycleActions.includes("reopen") && <button className="button" type="button" disabled={saving || !lifecycleReason.trim()}
          onClick={() => void changeLifecycle("reopen")}>{t.reopen}</button>}
          {lifecycleActions.includes("reactivate") && <button className="button" type="button" disabled={saving || !lifecycleReason.trim()}
            onClick={() => void changeLifecycle("reactivate")}>{t.reactivate}</button>}
          {lifecycleActions.includes("restore") && <button className="button" type="button" disabled={saving || !lifecycleReason.trim()}
            onClick={() => void changeLifecycle("restore")}>{t.restore}</button>}
        </div>}
        {data.allocations.length > 0 && <p className="muted">{t.allocationsBlock}</p>}
      </section>}
      {canEditPo && data.sourceKind === "MANUAL_TOTVS_REFERENCE" && <section className="card" aria-label={t.reimportTitle}>
        <h3>{t.reimportTitle}</h3>
        <p className="muted">{t.reimportHelp}</p>
        <label>{t.excelFile}<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={reimportLoading || saving} onChange={event => void selectReimportFile(event)} /></label>
        {reimportFileName && <p className="muted">{reimportFileName}</p>}
        <label>{t.itemsCurrency}<OperationalOptionSelect entity="currency" value={reimportCurrency} values={options}
          onChange={currency => { setReimportCurrency(currency); setReimportPreview(undefined); }} /></label>
        {reimportFileError && <p className="notice error" role="alert">{reimportFileError}</p>}
        {reimportPayload && <button className="button secondary" type="button" disabled={reimportLoading || saving}
          onClick={() => void previewReimport()}>{reimportLoading ? t.comparing : t.checkDifferences}</button>}
        {reimportPreview && <>
          {reimportPreview.differences.length === 0 && reimportPreview.canApply
            ? <p className="notice" role="status">{t.noDifferences}</p>
            : <>
              {reimportPreview.missingReferences.length > 0 && <p className="notice error">{t.missingRefs(reimportPreview.missingReferences.join(", "))}</p>}
              {reimportPreview.unknownReferences.length > 0 && <p className="notice error">{t.unknownRefs(reimportPreview.unknownReferences.join(", "))}</p>}
              {reimportPreview.cancelledReferences.length > 0 && <p className="notice error">{t.cancelledRefs(reimportPreview.cancelledReferences.join(", "))}</p>}
              {reimportPreview.productCodeMismatches.length > 0 && <p className="notice error">{t.productMismatch(reimportPreview.productCodeMismatches.map(value => value.externalLineReference).join(", "))}</p>}
              {reimportPreview.differences.length > 0 && <div className="table-scroll"><table><thead><tr><th>{t.item}</th><th>{t.product}</th><th>{t.field}</th><th>{t.current}</th><th>{t.sheet}</th></tr></thead><tbody>
                {reimportPreview.differences.flatMap(difference => Object.entries(difference.changes).map(([field, values]) => <tr key={`${difference.externalLineReference}-${field}`}>
                  <td>{difference.externalLineReference}</td><td>{difference.productCode}</td><td>{(t.reimportFields as Record<string, string>)[field] ?? field}</td>
                  <td>{values.before ?? "—"}</td><td>{values.after}</td>
                </tr>))}
              </tbody></table></div>}
              {reimportPreview.canApply && reimportPreview.differences.length > 0 && <>
                <label>{t.reimportReason}<textarea required minLength={3} maxLength={1000} value={reimportReason}
                  onChange={event => setReimportReason(event.target.value)} /></label>
                <button className="button" type="button" disabled={saving || reimportLoading || reimportReason.trim().length < 3}
                  onClick={() => void applyReimport()}>{t.applyDifferences(reimportPreview.differences.length)}</button>
              </>}
            </>}
        </>}
      </section>}
      {canEditPo && !data.purchaseRequestId && <PurchaseOrderScLink importer={data.importer}
        supplierCode={data.supplierText} items={data.items} purchaseRequests={purchaseRequests} options={options}
        saving={saving} onCreate={body => save(() => send(`/api/v1/purchase-orders/${id}/purchase-request`, "POST",
          { ...body, reason: automaticAuditReason }, data.version), t.scLinked)} />}
      {canEditPo && <details className="po-header-disclosure">
        <summary>{t.poData}</summary>
        <section className="po-entry-section">
          <form className="stack-form" onSubmit={saveHeader}>
            <label>{t.totvsNumber}<input required maxLength={80} disabled={data.sourceKind !== "MANUAL_TOTVS_REFERENCE"}
              value={number} onChange={event => setNumber(event.target.value)} /></label>
            {canChangeImporter && <label>{t.importer}<SearchableSelect ariaLabel={t.importer} required value={importer}
              onChange={setImporter} options={importers.filter(option => option.acceptsNewPurchaseOrders || option.code === data.importer)
                .map(option => ({ value: option.code, label: `${option.shortName || option.code} · ${option.cnpj ?? t.noCnpj}` }))} />
              <small className="po-field-hint">{t.importerHint}</small></label>}
            <label>{t.supplier}<SearchableSelect ariaLabel={t.supplier} required disabled={Boolean(purchaseRequestId)} value={supplier}
              onChange={setSupplier} options={suppliers.map(item => ({ value: item.code, label: `${item.code} · ${item.name}` }))} />
              {purchaseRequestId ? <small className="po-field-hint">{t.fromSc}</small> : null}</label>
            <label>{t.poDate}<input type="date" value={orderDate} readOnly aria-readonly="true" /></label>
            <PurchaseRequestSelect importer={data.importer} value={purchaseRequestId} choices={purchaseRequests}
              onChange={selectPurchaseRequest} />
            <label>{t.notes}<textarea maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
            <button className="button" disabled={saving}>{t.savePo}</button>
          </form>
        </section>
      </details>}
      <h3>{t.itemsTitle}</h3>
      {canEditPo && <section className="po-entry-section">
        <h4>{t.sharedTitle}</h4>
        <p className="muted">{t.sharedHelp}</p>
        {data.purchaseRequestId && <p className="muted">{t.sharedWithSc(data.purchaseRequest?.scNumber ?? "")}</p>}
        {commonValuesDiffer && <p className="notice warning">{t.valuesDiffer}</p>}
        <form className="stack-form" onSubmit={saveCommonFields}>
          <OperationalFieldsEditor fields={purchaseOrderCommonItemFields} values={commonOperationalDraft} options={options}
            readOnlyKeys={lockedSharedFieldKeys(data.purchaseRequestId)}
            setValues={values => purchaseOrderCommonItemFields.forEach(field => {
              const value = values[field.key] ?? "";
              if (value !== commonOperationalDraft[field.key]) updateCommonField(field.key, value);
            })} />
          <button className="button" disabled={saving || !data.items.length || !commonFieldsTouched.size}>
            {t.applyShared}</button>
        </form>
      </section>}
      {data.items.length === 0 && <p>{t.noItems}</p>}
      {data.items.map(item => {
        const draft = itemDrafts[item.id] ?? blankItem();
        const setDraft = (change: Partial<ItemDraft>) => setItemDrafts(current => ({ ...current, [item.id]: { ...draft, ...change } }));
        const canceled = item.sourceStatus?.toUpperCase() === "CANCELLED" || item.sourceStatus?.toUpperCase() === "CANCELED";
        const itemAllocations = data.allocations.filter(allocation => allocation.itemId === item.id);
        const price = formatItemPrice(item.unitPrice, item.currency, m);
        const totalPrice = item.unitPrice == null ? m.common.notInformed : formatItemPrice(
          String(Number(item.orderedQuantity) * Number(item.unitPrice)), item.currency, m);
        const reference = item.priceReference ?? productPriceReferenceForCurrency(item.referencePrices, item.currency);
        const estimate = item.unitPrice !== null && Number(item.unitPrice) === 0
          ? estimatedProductTotal(item.orderedQuantity, reference) : null;
        return <details className="po-entry-item po-item-card" key={item.id}>
          <summary className="po-item-summary">
            <div className="po-item-heading">
              <span className="po-item-number">{t.itemNumber(item.lineNumber)}</span>
              <strong className="po-item-code">{item.productCode}</strong>
              <span className={canceled ? "badge badge-danger" : "badge badge-info"}>
                {canceled ? t.cancelled : item.sourceStatus || t.active}
              </span>
            </div>
            <p className="po-item-description">{item.description || t.noDescription}</p>
            <div className="po-item-metrics" aria-label={t.itemSummary(item.lineNumber)}>
              <div><span>{t.orderedQuantity}</span><strong>{formatItemQuantity(item.orderedQuantity)}{item.unit ? ` ${item.unit}` : ""}</strong></div>
              <div><span>{t.allocated}</span><strong>{formatItemQuantity(item.allocatedQuantity)}{item.unit ? ` ${item.unit}` : ""}</strong></div>
              <div className={canceled ? "is-muted" : "is-balance"}>
                <span>{canceled ? t.blockedBalance : t.availableBalance}</span>
                <strong>{formatItemQuantity(canceled ? "0" : item.remainingQuantity)}{item.unit ? ` ${item.unit}` : ""}</strong>
              </div>
            </div>
            <div className="po-item-details">
              <div><span>{t.unitPrice}</span><strong>{price}</strong></div>
              <div><span>{t.totalValue}</span><strong>{totalPrice}</strong></div>
              <div><span>{t.needDate}</span><strong>{formatUsDate(item.necessityDate) || t.notInformedFeminine}</strong></div>
            </div>
            {item.unitPrice !== null && Number(item.unitPrice) === 0 && <p className="muted">
              {reference ? <>{t.referencePrice(formatNumber(reference.unitPrice), reference.currency,
                reference.purchaseOrderNumber, formatUsDate(reference.observedAt))}
                {estimate !== null && t.estimated(formatNumber(estimate), reference.currency)}
              </> : t.noRealPrice}
            </p>}
            {itemAllocations.length > 0 && <div className="po-item-ip-summary">
              <span>{t.ipDistribution}</span>
              <div>{itemAllocations.map(allocation => <span className="po-item-ip-chip" key={allocation.id}>
                {allocation.ipNumber} · {formatItemQuantity(allocation.quantity)}{item.unit ? ` ${item.unit}` : ""}
              </span>)}</div>
            </div>}
          </summary>
          {canEditPo && !canceled ? <form className="stack-form" data-item-id={item.id} onSubmit={saveItem}>
            <div className="operational-fields">
              <label>{t.totvsLine}<input maxLength={80} value={draft.externalLineReference} onChange={event => setDraft({ externalLineReference: event.target.value })} /></label>
              <label>{t.product}<CatalogProductSelect required value={draft.productCode} fallbackName={draft.description} products={products}
                onChange={product => setDraft({ productCode: product?.code ?? "",
                  description: product?.latestTotvsDescription?.trim() || product?.name || "",
                  operational: { ...draft.operational, ncm: product?.ncmCode ?? "" } })} /></label>
              <label>{t.productCode}<input value={draft.productCode} onChange={event => {
                const code = event.target.value;
                const product = products.find(option => option.code.trim().toLocaleUpperCase("en-US") === code.trim().toLocaleUpperCase("en-US"));
                setDraft({ productCode: code, description: product?.latestTotvsDescription?.trim() || product?.name || "",
                  operational: { ...draft.operational, ncm: product?.ncmCode ?? "" } });
              }} /></label>
              <label>{t.description}<input value={draft.description} onChange={event => setDraft({ description: event.target.value })} /></label>
              <label>{t.orderedQuantity}<input required inputMode="decimal" value={draft.orderedQuantity} onChange={event => setDraft({ orderedQuantity: event.target.value })} /></label>
              <label>{t.unit}<OperationalOptionSelect required entity="unit_of_measure" value={draft.unit} values={options}
                onChange={unit => setDraft({ unit })} /></label>
              <label>{t.unitPrice}<input inputMode="decimal" value={draft.unitPrice} onChange={event => setDraft({ unitPrice: event.target.value })} /></label>
              <label>{t.priceCurrency}<OperationalOptionSelect entity="currency" value={draft.currency} values={options} onChange={currency => setDraft({ currency })} /></label>
            </div>
            <h5>{t.planning}</h5>
            <OperationalFieldsEditor fields={specificItemFields} values={draft.operational} options={options}
              setValues={operational => setDraft({ operational })} />
            <PurchaseOrderCalculatedFields quantity={draft.orderedQuantity} unitPrice={draft.unitPrice} currency={draft.currency} />
            <button className="button" disabled={saving || commonFieldsTouched.size > 0}>{t.saveItemFields}</button>
          </form> : <p>{formatItemQuantity(item.orderedQuantity)}{item.unit ? ` ${item.unit}` : ""} · {item.description}</p>}
          {canEditPo && !canceled && <section aria-label={t.removeItemAria(item.lineNumber)}>
            {itemAllocations.length > 0
              ? <p className="muted">{t.cancelAllocationsFirst}</p>
              : <>
                <label>{t.removalReason}<textarea required minLength={3} maxLength={1000}
                  value={itemRemovalReasons[item.id] ?? ""} onChange={event => setItemRemovalReasons(current => ({ ...current, [item.id]: event.target.value }))} /></label>
                <button className="button secondary" type="button" disabled={saving || (itemRemovalReasons[item.id]?.trim().length ?? 0) < 3}
                  onClick={() => void removeItem(item)}>{t.removeItem}</button>
              </>}
          </section>}
        </details>;
      })}
      {canEditPo && <details><summary>{t.addItem}</summary>
        <form className="stack-form" onSubmit={createItem}>
          <div className="operational-fields">
            <label>{t.totvsLine}<input maxLength={80} value={itemDraft.externalLineReference} onChange={event => setItemDraft({ ...itemDraft, externalLineReference: event.target.value })} /></label>
            <label>{t.product}<CatalogProductSelect required value={itemDraft.productCode} fallbackName={itemDraft.description} products={products}
              onChange={product => setItemDraft({ ...itemDraft, productCode: product?.code ?? "",
                description: product?.latestTotvsDescription?.trim() || product?.name || "",
                operational: { ...itemDraft.operational, ncm: product?.ncmCode ?? "" } })} /></label>
            <label>{t.productCode}<input value={itemDraft.productCode} onChange={event => {
              const code = event.target.value;
              const product = products.find(option => option.code.trim().toLocaleUpperCase("en-US") === code.trim().toLocaleUpperCase("en-US"));
              setItemDraft({ ...itemDraft, productCode: code, description: product?.latestTotvsDescription?.trim() || product?.name || "",
                operational: { ...itemDraft.operational, ncm: product?.ncmCode ?? "" } });
            }} /></label>
            <label>{t.description}<input value={itemDraft.description} onChange={event => setItemDraft({ ...itemDraft, description: event.target.value })} /></label>
            <label>{t.orderedQuantity}<input required inputMode="decimal" value={itemDraft.orderedQuantity} onChange={event => setItemDraft({ ...itemDraft, orderedQuantity: event.target.value })} /></label>
            <label>{t.unit}<OperationalOptionSelect required entity="unit_of_measure" value={itemDraft.unit} values={options}
              onChange={unit => setItemDraft({ ...itemDraft, unit })} /></label>
            <label>{t.unitPrice}<input inputMode="decimal" value={itemDraft.unitPrice} onChange={event => setItemDraft({ ...itemDraft, unitPrice: event.target.value })} /></label>
            <label>{t.priceCurrency}<OperationalOptionSelect entity="currency" value={itemDraft.currency} values={options} onChange={currency => setItemDraft({ ...itemDraft, currency })} /></label>
          </div>
            <OperationalFieldsEditor fields={specificItemFields} values={itemDraft.operational} options={options}
            setValues={operational => setItemDraft({ ...itemDraft, operational })} />
          <PurchaseOrderCalculatedFields quantity={itemDraft.orderedQuantity} unitPrice={itemDraft.unitPrice} currency={itemDraft.currency} />
          <button className="button" disabled={saving || (commonFieldsTouched.size > 0 && data.items.length > 0)}>{t.saveItem}</button>
        </form>
      </details>}
      <h3 id="ip-distribution">{t.ipDistribution}</h3>
      <p className="muted">{t.distributionHelp}</p>
      {data.allocations.length === 0 ? <p>{t.noAllocations}</p> :
        <div className="table-scroll"><table><thead><tr><th>{t.item}</th><th>IP</th><th>{t.quantityInIp}</th><th>{t.orderedQuantity}</th><th>{t.remaining}</th><th>{t.factoryShip}</th><th>{t.action}</th></tr></thead>
          <tbody>{data.allocations.map(allocation => {
            const item = data.items.find(row => row.id === allocation.itemId);
            return <tr key={allocation.id}>
              <td>{item?.productCode ?? "—"}</td>
              <td><Link className="text-link" href={`/processes/${allocation.processId}`}>{allocation.ipNumber}</Link></td>
              <td>{formatItemQuantity(allocation.quantity)} {item?.unit ?? ""}</td>
              <td>{item ? formatItemQuantity(item.orderedQuantity) : "—"}{item?.unit ? ` ${item.unit}` : ""}</td>
              <td>{item ? formatItemQuantity(item.remainingQuantity) : "—"}{item?.unit ? ` ${item.unit}` : ""}</td>
              <td>{allocation.factoryShipDate ?? "—"}</td>
              <td>{canAllocate && <button className="button secondary" type="button" onClick={() => {
                setEditingAllocation(allocation); setItemId(allocation.itemId); setProcessId(allocation.processId);
                setAllocationQuantity(allocation.quantity); setAllocationNotes(allocation.notes);
              }}>{t.edit}</button>}</td>
            </tr>;
          })}</tbody></table></div>}
      {canAllocate && data.items.length > 0 && <div className="operational-allocation">
        <h4>{editingAllocation ? t.editAllocation(editingAllocation.ipNumber) : t.allocateItem}</h4>
        {!editingAllocation && <form className="operational-search" onSubmit={searchIps}>
          <label>{t.searchIp}<input value={ipQuery} onChange={event => {
            setIpQuery(event.target.value);
            setIpOptions([]); setProcessId(""); setIpSearchMessage("");
          }} placeholder={t.ipPlaceholder} /></label>
          <button className="button secondary" type="submit" disabled={searchingIps || saving}>
            {searchingIps ? t.searching : t.searchIps}</button>
          <button className="button secondary" type="button" onClick={() => setCreatingIp(value => !value)}>
            {creatingIp ? t.closeIpForm : t.openIpForm}</button>
        </form>}
        {ipSearchMessage && <p className="notice" role="status">{ipSearchMessage}</p>}
        {!editingAllocation && ipOptions.length > 0 && <label>{t.foundIp}<SearchableSelect ariaLabel={t.foundIp} required
          value={processId} placeholder={t.selectIp} onChange={setProcessId}
          options={ipOptions.map(item => ({ value: item.id, label: item.ipNumber }))} /></label>}
        {!editingAllocation && creatingIp && <form className="stack-form inline-ip-form" onSubmit={createIp}>
          <h5>{t.newIp(data.importer)}</h5>
          <div className="operational-fields">
            <label>{t.ipNumber}<input required maxLength={80} value={newIpNumber}
              onChange={event => setNewIpNumber(event.target.value)} /></label>
            <label>{t.logisticsStatus}<OperationalOptionSelect entity="logistics_status" value={newIpStatus}
              values={options} onChange={setNewIpStatus} /></label>
            <label>{t.priority}<OperationalOptionSelect entity="priority" value={newIpPriority} values={options}
              onChange={setNewIpPriority} /></label>
            <label>{t.notes}<textarea maxLength={4000} value={newIpNotes}
              onChange={event => setNewIpNotes(event.target.value)} /></label>
          </div>
          <button className="button" disabled={saving || commonFieldsTouched.size > 0}>{t.createIp}</button>
        </form>}
        <form className="stack-form" onSubmit={saveAllocation}>
          <label>{t.item}<SearchableSelect ariaLabel={t.item} required value={itemId} disabled={Boolean(editingAllocation)}
            onChange={setItemId} options={data.items.map(item => {
              const cancelled = item.sourceStatus?.toUpperCase() === "CANCELLED" || item.sourceStatus?.toUpperCase() === "CANCELED";
              return { value: item.id, label: t.itemOption(item.productCode, item.lineNumber, cancelled ? t.itemCancelled
                : t.itemBalance(`${formatItemQuantity(item.remainingQuantity)}${item.unit ? ` ${item.unit}` : ""}`)),
                searchText: item.description, disabled: cancelled };
            })} /></label>
          <label>{t.quantityInIp}<input required inputMode="decimal" value={allocationQuantity}
            onChange={event => setAllocationQuantity(event.target.value)} placeholder={t.quantityPlaceholder} /></label>
          <label>{t.notes}<textarea maxLength={2000} value={allocationNotes}
            onChange={event => setAllocationNotes(event.target.value)} /></label>
          {allocationIpShipped && <ShippedChangeConfirmation value={shippedChange} onChange={setShippedChange} />}
          <button className="button" disabled={saving || commonFieldsTouched.size > 0 || (!editingAllocation && !processId)}>
            {editingAllocation ? t.updateAllocation : t.distribute}</button>
          {editingAllocation && <div className="operational-actions">
            <button className="button secondary" type="button" onClick={() => {
              setEditingAllocation(undefined); setAllocationQuantity(""); setAllocationNotes(""); setShippedChange(emptyShippedChange);
            }}>{t.cancelEdit}</button>
            <button className="button secondary" type="button" disabled={saving || commonFieldsTouched.size > 0}
              onClick={() => void cancelAllocation()}>{t.cancelAllocation}</button>
          </div>}
        </form>
      </div>}
    </>}
  </section>;
}
