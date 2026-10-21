"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { apiFetch, hasPoLifecycleSupport, readApiJson } from "../lib/api";
import { automaticAuditReason } from "../lib/audit";
import { purchaseOrderLifecycleActions, type PurchaseOrderLifecycleStatus } from "../lib/po-lifecycle";
import { SearchableSelect } from "./SearchableSelect";
import { blankPurchaseOrderItemFields, OperationalFieldDraft, OperationalFieldsEditor,
  purchaseOrderCommonItemFields, purchaseOrderSpecificFields, purchaseOrderItemFields,
  purchaseOrderItemFieldsPayload } from "./PurchaseOrderItemFields";
import { CatalogChoice, CatalogProductSelect, loadCatalogChoices, loadOperationalCatalog, OperationalOption, OperationalOptionSelect } from "./OperationalOptionSelect";
import { loadPurchaseRequests, purchaseRequestOperationalFields, PurchaseRequestChoice, PurchaseRequestSelect } from "./PurchaseRequestSelect";
import PurchaseOrderCalculatedFields from "./PurchaseOrderCalculatedFields";
import { formatUsDate } from "../lib/date-format";
import { formatNumber } from "../lib/format-number";
import { estimatedProductTotal, productPriceReferenceForCurrency, type ProductPriceReference } from "../lib/product-price-reference";
import { parseTotvsPoXlsx } from "../lib/totvs-po-xlsx";

type Item = { id: string; lineNumber: number; externalLineReference: string | null;
  productCode: string; description: string; orderedQuantity: string; unit: string | null;
  unitPrice: string | null; currency: string | null; sourceKind: string; sourceStatus: string | null;
  necessityDate: string | null; priority: string | null; demand: string | null; requester: string | null;
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
  quantity: string; notes: string; factoryShipDate: string | null; version: string };
type OperationalPo = { id: string; importer: string; number: string; supplierText: string | null;
  orderDate: string | null; notes: string; sourceKind: string; version: string;
  lifecycleStatus?: PurchaseOrderLifecycleStatus;
  lifecycleChangedAt: string | null; lifecycleChangedBy: string | null; lifecycleReason: string | null;
  purchaseRequestId: string | null;
  purchaseRequest: { id: string; importer: string; scNumber: string; supplierText: string | null; scDate: string | null; commercialPlanReceivedDate: string | null;
    requester: string; approvalDate: string | null } | null;
  items: Item[]; allocations: Allocation[] };
type FollowupItem = { id: string } & Record<string, unknown>;
type ProcessOption = { id: string; ipNumber: string; importer: string };
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
const reimportFieldLabels: Record<string, string> = { description: "Descrição", orderedQuantity: "Quantidade",
  unitPrice: "Preço unitário", currency: "Moeda" };

async function responseData<T>(response: Response): Promise<T> {
  return readApiJson<T>(response);
}
function formatItemQuantity(value: string) {
  return formatNumber(value);
}
function formatItemPrice(value: string | null, currency: string | null) {
  if (value == null) return "Não informado";
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
  if (!Array.isArray(followup.items)) throw new Error("A API não retornou os campos operacionais dos produtos.");
  return followup.items;
}

function combineOperationalItems(items: Item[], followupItems: FollowupItem[], supportsGroup: boolean): Item[] {
  const byId = new Map(followupItems.map(item => [item.id, item]));
  return items.map(item => {
    const followup = byId.get(item.id);
    if (!followup || purchaseOrderItemFields.some(field => (field.key !== "group" || supportsGroup)
      && !Object.prototype.hasOwnProperty.call(followup, field.key))) {
      throw new Error("A API não retornou todos os campos operacionais dos produtos.");
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
  if (notSaved) throw new Error("A API confirmou a alteração, mas os campos não foram encontrados na releitura dos produtos.");
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
    throw new Error("A API confirmou a alteração, mas a releitura não encontrou todos os dados do produto.");
  }
}

export default function OperationalPoPanel({ id, onChanged }: { id: string; onChanged?: () => void }) {
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
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Erro inesperado."); })
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
  async function applyCommonFieldsToItems(fields: Record<string, string | number | null>) {
    if (!data) return;
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
          const detail = cause instanceof Error ? cause.message : "Erro inesperado.";
          throw new Error(`Falha no produto ${item.productCode}. ${completed} produto(s) anterior(es) podem ter sido salvos. Atualize a página e confira os itens antes de repetir. ${detail}`);
        }
      }
    } else {
      const saved = await responseData<{ updatedCount: number }>(batch);
      if (saved.updatedCount !== data.items.length) {
        throw new Error("A API atualizou uma quantidade inesperada de produtos. Recarregue a PO e confira os campos.");
      }
    }
    await verifySavedItemFields(id, new Map(data.items.map(item => [item.id, fields])));
  }
  async function save(action: () => Promise<unknown>, success: string) {
    setSaving(true); setError(""); setNotice("");
    try { await action(); setNotice(success); setReload(value => value + 1); onChanged?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Erro inesperado."); }
    finally { setSaving(false); }
  }
  async function changeLifecycle(action: "cancel" | "close" | "reopen" | "delete" | "reactivate" | "restore") {
    if (!data) return;
    if (action === "delete" && !window.confirm("Excluir esta PO da carteira ativa? Os dados e vínculos históricos serão preservados.")) return;
    const method = action === "delete" ? "DELETE" : "POST";
    const success = action === "cancel" ? "PO cancelada." : action === "close" ? "PO encerrada."
      : action === "reopen" ? "PO reaberta." : action === "reactivate" ? "PO reativada."
        : action === "restore" ? "PO restaurada." : "PO excluída da carteira ativa.";
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
      const result = await parseTotvsPoXlsx(file);
      const invalidTotals = result.rows.filter(row => !row.totalWithinTolerance);
      if (invalidTotals.length) {
        throw new Error(`O Valor Total difere do preço derivado em mais de 0,01 nos itens ${invalidTotals.slice(0, 8).map(row => row.externalLineReference).join(", ")}.`);
      }
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const fileSha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      setReimportPayload({ header: { number: result.header.number }, fileName: file.name, fileSha256,
        currency: "CNY", items: result.rows.map(row => ({ externalLineReference: row.externalLineReference,
          productCode: row.productCode, description: row.description, orderedQuantity: row.orderedQuantity,
          unitPrice: row.unitPrice })) });
      setReimportCurrency("CNY");
    } catch (cause) { setReimportFileError(cause instanceof Error ? cause.message : "Não foi possível ler a planilha."); }
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
        throw new Error("A API publicada ainda não oferece a prévia de reimportação desta PO.");
      }
      setReimportPreview(await responseData<ReimportPreview>(response));
    } catch (cause) { setReimportFileError(cause instanceof Error ? cause.message : "Não foi possível comparar a planilha."); }
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
        throw new Error("A API publicada ainda não oferece a reimportação transacional desta PO.");
      }
      const result = await responseData<{ updatedCount: number }>(response);
      setReimportPreview(undefined); setReimportPayload(undefined); setReimportFileName(""); setReimportReason("");
      return result.updatedCount;
    }, "Reimportação aplicada e auditada.");
  }
  async function removeItem(item: Item) {
    if (!data) return;
    const itemReason = itemRemovalReasons[item.id]?.trim() ?? "";
    if (itemReason.length < 3) { setError("Informe um motivo com pelo menos 3 caracteres para remover o item."); return; }
    await save(async () => {
      await send(`/api/v1/purchase-orders/${id}/items/${item.id}/remove`, "POST",
        { reason: itemReason }, data.version);
      setItemRemovalReasons(current => ({ ...current, [item.id]: "" }));
    }, "Item removido da PO; o histórico foi preservado.");
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
        if (await missingRoute(response, `PATCH:${route}`)) {
          await send(`/api/v1/purchase-orders/${id}`, "PATCH", header, data.version);
          await applyCommonFieldsToItems(fields);
        } else {
          const result = await responseData<{ updatedCount: number }>(response);
          if (result.updatedCount !== data.items.length) {
            throw new Error("A API atualizou uma quantidade inesperada de produtos. Recarregue a PO e confira os campos da SC.");
          }
          await verifySavedItemFields(id, new Map(data.items.map(item => [item.id, fields])));
        }
        setCommonFieldsTouched(new Set());
      } else {
        await send(`/api/v1/purchase-orders/${id}`, "PATCH", header, data.version);
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
          throw new Error(`Os dados básicos podem ter sido salvos; confira o produto antes de repetir. ${cause instanceof Error ? cause.message : "Erro inesperado."}`);
        }
      } else await responseData(result);
      await verifySavedItem(id, item.id, body, fields);
    }, "Item e campos operacionais atualizados.");
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
          throw new Error(`O produto básico pode ter sido criado; confira a PO antes de repetir. ${cause instanceof Error ? cause.message : "Erro inesperado."}`);
        }
      } else {
        created = await responseData<{ id: string }>(result);
      }
      await verifySavedItem(id, created.id, base, operational);
      setItemDraft(blankItem());
    }, "Item cadastrado.");
  }
  async function searchIps(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || searchingIps) return;
    const searchTerm = ipQuery.trim();
    if (!searchTerm) {
      setIpOptions([]);
      setProcessId("");
      setIpSearchMessage("Informe o número ou parte do IP para buscar.");
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
        setIpSearchMessage(`IP ${exactNumberMatches[0].ipNumber} encontrado e selecionado. Informe a quantidade e clique em “Distribuir quantidade” para criar o vínculo.`);
      } else {
        if (!matches.some(item => item.id === processId)) setProcessId("");
        setIpSearchMessage(matches.length === 0
          ? `Nenhum IP encontrado para a importadora ${data.importer}. Confira o número e se o IP foi cadastrado para a mesma importadora da PO.`
          : `${matches.length} IP(s) encontrado(s). Selecione um no campo IP, informe a quantidade e clique em “Distribuir quantidade” para criar o vínculo.`);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Erro inesperado.";
      setError(message);
      setIpSearchMessage(`Não foi possível buscar o IP: ${message}`);
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
    }, "IP cadastrado e selecionado. Para criar o vínculo com a PO, informe a quantidade e clique em Distribuir quantidade.");
  }
  async function saveAllocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (commonFieldsTouched.size) { setError("Salve primeiro os dados compartilhados da PO."); return; }
    if (!itemId || (!processId && !editingAllocation)) return;
    await save(async () => {
      const body = { quantity: allocationQuantity, notes: allocationNotes, reason: automaticAuditReason };
      await send(editingAllocation ? `/api/v1/purchase-orders/${id}/allocations/${editingAllocation.id}` :
        `/api/v1/purchase-orders/${id}/allocations`, editingAllocation ? "PATCH" : "POST",
      editingAllocation ? body : { ...body, itemId, processId }, editingAllocation?.version);
      setEditingAllocation(undefined); setAllocationQuantity(""); setAllocationNotes("");
    }, editingAllocation ? "Distribuição atualizada." : "Quantidade distribuída para o IP.");
  }
  async function cancelAllocation() {
    if (commonFieldsTouched.size) { setError("Salve primeiro os dados compartilhados da PO."); return; }
    if (!editingAllocation) return;
    await save(async () => {
      await send(`/api/v1/purchase-orders/${id}/allocations/${editingAllocation.id}`, "DELETE",
        { reason: automaticAuditReason }, editingAllocation.version);
      setEditingAllocation(undefined); setAllocationQuantity(""); setAllocationNotes("");
    }, "Distribuição cancelada; o saldo voltou ao item.");
  }

  const commonValuesDiffer = Boolean(data && data.items.length > 1 &&
    purchaseOrderCommonItemFields.some(field =>
      new Set(data.items.map(item => operationalDraft(item)[field.key] ?? "")).size > 1));
  return <section id="po-record" className="card operational-panel" aria-label="Registro operacional da PO">
    <h2>Itens da PO</h2>
    <p className="muted">Saldo por item: quantidade pedida menos quantidade distribuída aos IPs.</p>
    {loading && <p role="status">Carregando preenchimento…</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {!loading && data && <>
      {!lifecycleSupported && <p className="notice" role="status">Ciclo da PO indisponível nesta versão da API.</p>}
      {lifecycleSupported && data.lifecycleStatus !== "ACTIVE" && <p className="notice" role="status">
        {data.lifecycleStatus === "CLOSED" ? "PO encerrada: alterações e novas alocações estão bloqueadas. Reabra com um motivo para continuar."
          : data.lifecycleStatus === "CANCELLED" ? "PO cancelada: permanece disponível para consulta e histórico."
            : "PO excluída da carteira ativa: os dados e vínculos históricos permanecem disponíveis para consulta."}
        {data.lifecycleReason && <> Motivo: {data.lifecycleReason}</>}
      </p>}
      {lifecycleSupported && (lifecycleActions.length > 0 || data.lifecycleStatus === "DELETED") && <section className="card po-lifecycle-actions">
        <h3>Ciclo da PO</h3>
        {lifecycleActions.length > 0 && <label className="po-lifecycle-reason"><span>Motivo da ação</span><textarea required minLength={3} maxLength={1000} value={lifecycleReason}
          onChange={event => setLifecycleReason(event.target.value)} /></label>}
        {lifecycleActions.length > 0 && <div className="operational-actions">
          {lifecycleActions.includes("close") && <button className="button secondary" type="button" disabled={saving || !lifecycleReason.trim()}
            onClick={() => void changeLifecycle("close")}>Encerrar PO</button>}
          {lifecycleActions.includes("cancel") && <button className="button secondary" type="button" disabled={saving || !lifecycleReason.trim() || data.allocations.length > 0}
            onClick={() => void changeLifecycle("cancel")}>Cancelar PO</button>}
          {lifecycleActions.includes("delete") && <button className="button secondary" type="button" disabled={saving || !lifecycleReason.trim() || data.allocations.length > 0}
            onClick={() => void changeLifecycle("delete")}>Excluir da carteira</button>}
        {lifecycleActions.includes("reopen") && <button className="button" type="button" disabled={saving || !lifecycleReason.trim()}
          onClick={() => void changeLifecycle("reopen")}>Reabrir PO</button>}
          {lifecycleActions.includes("reactivate") && <button className="button" type="button" disabled={saving || !lifecycleReason.trim()}
            onClick={() => void changeLifecycle("reactivate")}>Reativar PO</button>}
          {lifecycleActions.includes("restore") && <button className="button" type="button" disabled={saving || !lifecycleReason.trim()}
            onClick={() => void changeLifecycle("restore")}>Restaurar PO</button>}
        </div>}
        {data.allocations.length > 0 && <p className="muted">Cancele ou encaminhe as distribuições ativas pelos IPs antes de cancelar ou excluir esta PO.</p>}
      </section>}
      {canEditPo && data.sourceKind === "MANUAL_TOTVS_REFERENCE" && <section className="card po-reimport" aria-label="Atualizar PO pela planilha TOTVS">
        <h3>Atualizar PO pela planilha TOTVS</h3>
        <p className="muted">Compare por Item. A aplicação atualiza somente descrição, quantidade, preço e moeda, em uma transação auditada.</p>
        <label>Arquivo Excel (.xlsx)<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={reimportLoading || saving} onChange={event => void selectReimportFile(event)} /></label>
        {reimportFileName && <p className="muted">{reimportFileName}</p>}
        <label>Moeda dos itens<OperationalOptionSelect entity="currency" value={reimportCurrency} values={options}
          onChange={currency => { setReimportCurrency(currency); setReimportPreview(undefined); }} /></label>
        {reimportFileError && <p className="notice error" role="alert">{reimportFileError}</p>}
        {reimportPayload && <button className="button secondary" type="button" disabled={reimportLoading || saving}
          onClick={() => void previewReimport()}>{reimportLoading ? "Comparando…" : "Conferir diferenças"}</button>}
        {reimportPreview && <>
          {reimportPreview.differences.length === 0 && reimportPreview.canApply
            ? <p className="notice" role="status">Nenhuma diferença encontrada. A PO não será alterada.</p>
            : <>
              {reimportPreview.missingReferences.length > 0 && <p className="notice error">Itens ausentes na planilha: {reimportPreview.missingReferences.join(", ")}</p>}
              {reimportPreview.unknownReferences.length > 0 && <p className="notice error">Itens sem correspondência nesta PO: {reimportPreview.unknownReferences.join(", ")}</p>}
              {reimportPreview.cancelledReferences.length > 0 && <p className="notice error">Itens já removidos: {reimportPreview.cancelledReferences.join(", ")}</p>}
              {reimportPreview.productCodeMismatches.length > 0 && <p className="notice error">Código do produto diferente para o item {reimportPreview.productCodeMismatches.map(value => value.externalLineReference).join(", ")}.</p>}
              {reimportPreview.differences.length > 0 && <div className="table-scroll"><table><thead><tr><th>Item</th><th>Produto</th><th>Campo</th><th>Atual</th><th>Planilha</th></tr></thead><tbody>
                {reimportPreview.differences.flatMap(difference => Object.entries(difference.changes).map(([field, values]) => <tr key={`${difference.externalLineReference}-${field}`}>
                  <td>{difference.externalLineReference}</td><td>{difference.productCode}</td><td>{reimportFieldLabels[field] ?? field}</td>
                  <td>{values.before ?? "—"}</td><td>{values.after}</td>
                </tr>))}
              </tbody></table></div>}
              {reimportPreview.canApply && reimportPreview.differences.length > 0 && <>
                <label>Motivo da reimportação<textarea required minLength={3} maxLength={1000} value={reimportReason}
                  onChange={event => setReimportReason(event.target.value)} /></label>
                <button className="button" type="button" disabled={saving || reimportLoading || reimportReason.trim().length < 3}
                  onClick={() => void applyReimport()}>Aplicar {reimportPreview.differences.length} diferença(s)</button>
              </>}
            </>}
        </>}
      </section>}
      {canEditPo && <details className="po-header-disclosure">
        <summary>Dados da PO</summary>
        <section className="po-entry-section">
          <form className="stack-form" onSubmit={saveHeader}>
            <label>Número da PO no TOTVS<input required maxLength={80} disabled={data.sourceKind !== "MANUAL_TOTVS_REFERENCE"}
              value={number} onChange={event => setNumber(event.target.value)} /></label>
            {canChangeImporter && <label>Importadora<SearchableSelect ariaLabel="Importadora" required value={importer}
              onChange={setImporter} options={importers.filter(option => option.acceptsNewPurchaseOrders || option.code === data.importer)
                .map(option => ({ value: option.code, label: `${option.shortName || option.code}${option.cnpj ? ` · ${option.cnpj}` : " · sem CNPJ"}` }))} />
              <small className="po-field-hint">A troca exige ausência de alocações ativas e uma importadora de destino com CNPJ.</small></label>}
            <label>Fornecedor<SearchableSelect ariaLabel="Fornecedor" required disabled={Boolean(purchaseRequestId)} value={supplier}
              onChange={setSupplier} options={suppliers.map(item => ({ value: item.code, label: `${item.code} · ${item.name}` }))} />
              {purchaseRequestId ? <small className="po-field-hint">Preenchido pela SC vinculada.</small> : null}</label>
            <label>Data da PO<input type="date" value={orderDate} readOnly aria-readonly="true" /></label>
            <PurchaseRequestSelect importer={data.importer} value={purchaseRequestId} choices={purchaseRequests}
              onChange={selectPurchaseRequest} />
            <label>Observações<textarea maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
            <button className="button" disabled={saving}>Salvar PO</button>
          </form>
        </section>
      </details>}
      <h3>Dados e saldo por item</h3>
      {canEditPo && <section className="po-entry-section po-common-fields">
        <h4>Dados compartilhados pelos produtos</h4>
        <p className="muted">Preencha uma vez para manter iguais nos produtos. A data da PO é compartilhada no cabeçalho.</p>
        {commonValuesDiffer && <p className="notice">Há valores diferentes entre produtos. Ao aplicar um campo, ele será padronizado em todos.</p>}
        <form className="stack-form" onSubmit={saveCommonFields}>
          <OperationalFieldsEditor fields={purchaseOrderCommonItemFields} values={commonOperationalDraft} options={options}
            setValues={values => purchaseOrderCommonItemFields.forEach(field => {
              const value = values[field.key] ?? "";
              if (value !== commonOperationalDraft[field.key]) updateCommonField(field.key, value);
            })} />
          <button className="button" disabled={saving || !data.items.length || !commonFieldsTouched.size}>
            Aplicar campos alterados a todos os produtos</button>
        </form>
      </section>}
      {data.items.length === 0 && <p>Nenhum item cadastrado para esta PO.</p>}
      {data.items.map(item => {
        const draft = itemDrafts[item.id] ?? blankItem();
        const setDraft = (change: Partial<ItemDraft>) => setItemDrafts(current => ({ ...current, [item.id]: { ...draft, ...change } }));
        const canceled = item.sourceStatus?.toUpperCase() === "CANCELLED" || item.sourceStatus?.toUpperCase() === "CANCELED";
        const itemAllocations = data.allocations.filter(allocation => allocation.itemId === item.id);
        const price = formatItemPrice(item.unitPrice, item.currency);
        const totalPrice = item.unitPrice == null ? "Não informado" : formatItemPrice(
          String(Number(item.orderedQuantity) * Number(item.unitPrice)), item.currency);
        const reference = item.priceReference ?? productPriceReferenceForCurrency(item.referencePrices, item.currency);
        const estimate = item.unitPrice !== null && Number(item.unitPrice) === 0
          ? estimatedProductTotal(item.orderedQuantity, reference) : null;
        return <details className="po-entry-item po-item-card" key={item.id}>
          <summary className="po-item-summary">
            <div className="po-item-heading">
              <span className="po-item-number">Item {item.lineNumber}</span>
              <strong className="po-item-code">{item.productCode}</strong>
              <span className={`po-item-status${canceled ? " is-canceled" : ""}`}>
                {canceled ? "Cancelado" : item.sourceStatus || "Ativo"}
              </span>
            </div>
            <p className="po-item-description">{item.description || "Descrição não informada"}</p>
            <div className="po-item-metrics" aria-label={`Resumo do item ${item.lineNumber}`}>
              <div><span>Quantidade pedida</span><strong>{formatItemQuantity(item.orderedQuantity)}{item.unit ? ` ${item.unit}` : ""}</strong></div>
              <div><span>Distribuída</span><strong>{formatItemQuantity(item.allocatedQuantity)}{item.unit ? ` ${item.unit}` : ""}</strong></div>
              <div className={canceled ? "is-muted" : "is-balance"}>
                <span>{canceled ? "Saldo bloqueado" : "Saldo disponível"}</span>
                <strong>{formatItemQuantity(canceled ? "0" : item.remainingQuantity)}{item.unit ? ` ${item.unit}` : ""}</strong>
              </div>
            </div>
            <div className="po-item-details">
              <div><span>Preço unitário</span><strong>{price}</strong></div>
              <div><span>Valor total</span><strong>{totalPrice}</strong></div>
              <div><span>Data de necessidade</span><strong>{formatUsDate(item.necessityDate) || "Não informada"}</strong></div>
            </div>
            {item.unitPrice !== null && Number(item.unitPrice) === 0 && <p className="muted">
              {reference ? <>Preço de referência: {formatNumber(reference.unitPrice)} {reference.currency}
                (PO {reference.purchaseOrderNumber}, {formatUsDate(reference.observedAt)})
                {estimate !== null && <> · Valor estimado: {formatNumber(estimate)} {reference.currency}</>}
              </> : "Sem preço real conhecido nesta moeda."}
            </p>}
            {itemAllocations.length > 0 && <div className="po-item-ip-summary">
              <span>Distribuição por IP</span>
              <div>{itemAllocations.map(allocation => <span className="po-item-ip-chip" key={allocation.id}>
                {allocation.ipNumber} · {formatItemQuantity(allocation.quantity)}{item.unit ? ` ${item.unit}` : ""}
              </span>)}</div>
            </div>}
            <span className="po-item-toggle" aria-hidden="true">⌄</span>
          </summary>
          {canEditPo && !canceled ? <form className="stack-form" data-item-id={item.id} onSubmit={saveItem}>
            <div className="operational-fields">
              <label>Linha no TOTVS<input maxLength={80} value={draft.externalLineReference} onChange={event => setDraft({ externalLineReference: event.target.value })} /></label>
              <label>Produto<CatalogProductSelect required value={draft.productCode} fallbackName={draft.description} products={products}
                onChange={product => setDraft({ productCode: product?.code ?? "",
                  description: product?.latestTotvsDescription?.trim() || product?.name || "",
                  operational: { ...draft.operational, ncm: product?.ncmCode ?? "" } })} /></label>
              <label>Código do produto<input value={draft.productCode} onChange={event => {
                const code = event.target.value;
                const product = products.find(option => option.code.trim().toLocaleUpperCase("en-US") === code.trim().toLocaleUpperCase("en-US"));
                setDraft({ productCode: code, description: product?.latestTotvsDescription?.trim() || product?.name || "",
                  operational: { ...draft.operational, ncm: product?.ncmCode ?? "" } });
              }} /></label>
              <label>Descrição<input value={draft.description} onChange={event => setDraft({ description: event.target.value })} /></label>
              <label>Quantidade pedida<input required inputMode="decimal" value={draft.orderedQuantity} onChange={event => setDraft({ orderedQuantity: event.target.value })} /></label>
              <label>Unidade<OperationalOptionSelect required entity="unit_of_measure" value={draft.unit} values={options}
                onChange={unit => setDraft({ unit })} /></label>
              <label>Preço unitário<input inputMode="decimal" value={draft.unitPrice} onChange={event => setDraft({ unitPrice: event.target.value })} /></label>
              <label>Moeda do preço<OperationalOptionSelect entity="currency" value={draft.currency} values={options} onChange={currency => setDraft({ currency })} /></label>
            </div>
            <h5>Planejamento e acompanhamento</h5>
            <OperationalFieldsEditor fields={specificItemFields} values={draft.operational} options={options}
              setValues={operational => setDraft({ operational })} />
            <PurchaseOrderCalculatedFields quantity={draft.orderedQuantity} unitPrice={draft.unitPrice} currency={draft.currency} />
            <button className="button" disabled={saving || commonFieldsTouched.size > 0}>Salvar todos os campos deste item</button>
          </form> : <p>{formatItemQuantity(item.orderedQuantity)}{item.unit ? ` ${item.unit}` : ""} · {item.description}</p>}
          {canEditPo && !canceled && <section className="po-item-removal" aria-label={`Remover item ${item.lineNumber}`}>
            {itemAllocations.length > 0
              ? <p className="muted">Cancele as alocações ativas deste item antes de removê-lo.</p>
              : <>
                <label>Motivo para remover o item<textarea required minLength={3} maxLength={1000}
                  value={itemRemovalReasons[item.id] ?? ""} onChange={event => setItemRemovalReasons(current => ({ ...current, [item.id]: event.target.value }))} /></label>
                <button className="button secondary" type="button" disabled={saving || (itemRemovalReasons[item.id]?.trim().length ?? 0) < 3}
                  onClick={() => void removeItem(item)}>Remover item</button>
              </>}
          </section>}
        </details>;
      })}
      {canEditPo && <details><summary>Adicionar item à PO</summary>
        <form className="stack-form" onSubmit={createItem}>
          <div className="operational-fields">
            <label>Linha no TOTVS<input maxLength={80} value={itemDraft.externalLineReference} onChange={event => setItemDraft({ ...itemDraft, externalLineReference: event.target.value })} /></label>
            <label>Produto<CatalogProductSelect required value={itemDraft.productCode} fallbackName={itemDraft.description} products={products}
              onChange={product => setItemDraft({ ...itemDraft, productCode: product?.code ?? "",
                description: product?.latestTotvsDescription?.trim() || product?.name || "",
                operational: { ...itemDraft.operational, ncm: product?.ncmCode ?? "" } })} /></label>
            <label>Código do produto<input value={itemDraft.productCode} onChange={event => {
              const code = event.target.value;
              const product = products.find(option => option.code.trim().toLocaleUpperCase("en-US") === code.trim().toLocaleUpperCase("en-US"));
              setItemDraft({ ...itemDraft, productCode: code, description: product?.latestTotvsDescription?.trim() || product?.name || "",
                operational: { ...itemDraft.operational, ncm: product?.ncmCode ?? "" } });
            }} /></label>
            <label>Descrição<input value={itemDraft.description} onChange={event => setItemDraft({ ...itemDraft, description: event.target.value })} /></label>
            <label>Quantidade pedida<input required inputMode="decimal" value={itemDraft.orderedQuantity} onChange={event => setItemDraft({ ...itemDraft, orderedQuantity: event.target.value })} /></label>
            <label>Unidade<OperationalOptionSelect required entity="unit_of_measure" value={itemDraft.unit} values={options}
              onChange={unit => setItemDraft({ ...itemDraft, unit })} /></label>
            <label>Preço unitário<input inputMode="decimal" value={itemDraft.unitPrice} onChange={event => setItemDraft({ ...itemDraft, unitPrice: event.target.value })} /></label>
            <label>Moeda do preço<OperationalOptionSelect entity="currency" value={itemDraft.currency} values={options} onChange={currency => setItemDraft({ ...itemDraft, currency })} /></label>
          </div>
            <OperationalFieldsEditor fields={specificItemFields} values={itemDraft.operational} options={options}
            setValues={operational => setItemDraft({ ...itemDraft, operational })} />
          <PurchaseOrderCalculatedFields quantity={itemDraft.orderedQuantity} unitPrice={itemDraft.unitPrice} currency={itemDraft.currency} />
          <button className="button" disabled={saving || (commonFieldsTouched.size > 0 && data.items.length > 0)}>Salvar item completo</button>
        </form>
      </details>}
      <h3 id="ip-distribution">Distribuição por IP</h3>
      <p className="muted">O saldo restante é calculado por item na PO, somando as quantidades distribuídas a todos os IPs vinculados.</p>
      {data.allocations.length === 0 ? <p>Nenhuma quantidade distribuída operacionalmente.</p> :
        <div className="table-scroll"><table><thead><tr><th>Item</th><th>IP</th><th>Quantidade neste IP</th><th>Quantidade pedida</th><th>Saldo restante na PO</th><th>Saída da fábrica</th><th>Ação</th></tr></thead>
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
              }}>Editar</button>}</td>
            </tr>;
          })}</tbody></table></div>}
      {canAllocate && data.items.length > 0 && <div className="operational-allocation">
        <h4>{editingAllocation ? `Editar distribuição para ${editingAllocation.ipNumber}` : "Distribuir item para um IP"}</h4>
        {!editingAllocation && <form className="operational-search" onSubmit={searchIps}>
          <label>Buscar IP<input value={ipQuery} onChange={event => {
            setIpQuery(event.target.value);
            setIpOptions([]); setProcessId(""); setIpSearchMessage("");
          }} placeholder="Número ou parte do IP" /></label>
          <button className="button secondary" type="submit" disabled={searchingIps || saving}>
            {searchingIps ? "Buscando…" : "Buscar IPs"}</button>
          <button className="button secondary" type="button" onClick={() => setCreatingIp(value => !value)}>
            {creatingIp ? "Fechar cadastro de IP" : "Cadastrar IP nesta PO"}</button>
        </form>}
        {ipSearchMessage && <p className="notice" role="status">{ipSearchMessage}</p>}
        {!editingAllocation && ipOptions.length > 0 && <label>IP encontrado<SearchableSelect ariaLabel="IP encontrado" required
          value={processId} placeholder="Selecione um IP" onChange={setProcessId}
          options={ipOptions.map(item => ({ value: item.id, label: item.ipNumber }))} /></label>}
        {!editingAllocation && creatingIp && <form className="stack-form inline-ip-form" onSubmit={createIp}>
          <h5>Novo IP · importadora {data.importer}</h5>
          <div className="operational-fields">
            <label>Número do IP<input required maxLength={80} value={newIpNumber}
              onChange={event => setNewIpNumber(event.target.value)} /></label>
            <label>Status logístico<OperationalOptionSelect entity="logistics_status" value={newIpStatus}
              values={options} onChange={setNewIpStatus} /></label>
            <label>Prioridade<OperationalOptionSelect entity="priority" value={newIpPriority} values={options}
              onChange={setNewIpPriority} /></label>
            <label>Observações<textarea maxLength={4000} value={newIpNotes}
              onChange={event => setNewIpNotes(event.target.value)} /></label>
          </div>
          <button className="button" disabled={saving || commonFieldsTouched.size > 0}>Cadastrar IP e selecionar</button>
        </form>}
        <form className="stack-form" onSubmit={saveAllocation}>
          <label>Item<SearchableSelect ariaLabel="Item" required value={itemId} disabled={Boolean(editingAllocation)}
            onChange={setItemId} options={data.items.map(item => {
              const cancelled = item.sourceStatus?.toUpperCase() === "CANCELLED" || item.sourceStatus?.toUpperCase() === "CANCELED";
              return { value: item.id, label: `${item.productCode} · item ${item.lineNumber} · ${cancelled ? "cancelado" : `saldo ${formatItemQuantity(item.remainingQuantity)}${item.unit ? ` ${item.unit}` : ""}`}`,
                searchText: item.description, disabled: cancelled };
            })} /></label>
          <label>Quantidade neste IP<input required inputMode="decimal" value={allocationQuantity}
            onChange={event => setAllocationQuantity(event.target.value)} placeholder="Ex.: 40" /></label>
          <label>Observações<textarea maxLength={2000} value={allocationNotes}
            onChange={event => setAllocationNotes(event.target.value)} /></label>
          <button className="button" disabled={saving || commonFieldsTouched.size > 0 || (!editingAllocation && !processId)}>
            {editingAllocation ? "Atualizar distribuição" : "Distribuir quantidade"}</button>
          {editingAllocation && <div className="operational-actions">
            <button className="button secondary" type="button" onClick={() => {
              setEditingAllocation(undefined); setAllocationQuantity(""); setAllocationNotes("");
            }}>Cancelar edição</button>
            <button className="button secondary" type="button" disabled={saving || commonFieldsTouched.size > 0}
              onClick={() => void cancelAllocation()}>Cancelar distribuição</button>
          </div>}
        </form>
      </div>}
    </>}
  </section>;
}
