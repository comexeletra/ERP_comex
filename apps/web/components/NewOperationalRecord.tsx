"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, isMissingApiRoute, readApiJson } from "../lib/api";
import { automaticAuditReason, emptyShippedChange, shippedChangeReady } from "../lib/audit";
import ShippedChangeConfirmation from "./ShippedChangeConfirmation";
import { deletedIpInvoiceBlockMessage } from "../lib/ip-lifecycle";
import { SearchableSelect } from "./SearchableSelect";
import {
  blankPurchaseOrderItemFields, OperationalFieldDraft, OperationalFieldsEditor,
  purchaseOrderCommonItemFields, purchaseOrderSpecificFields, purchaseOrderItemFieldsPayload,
} from "./PurchaseOrderItemFields";
import {
  CatalogChoice, CatalogProductSelect, loadCatalogChoices, loadOperationalCatalog, OperationalOption,
  OperationalOptionSelect,
} from "./OperationalOptionSelect";
import PurchaseOrderCalculatedFields from "./PurchaseOrderCalculatedFields";
import { loadPurchaseRequests, purchaseRequestOperationalFields, PurchaseRequestChoice, PurchaseRequestSelect } from "./PurchaseRequestSelect";
import { parseTotvsPoXlsx, TotvsPoProductRow } from "../lib/totvs-po-xlsx";
import { formatNumber } from "../lib/format-number";
import { estimatedProductTotal, productPriceReferenceForCurrency } from "../lib/product-price-reference";
import { formatUsDate } from "../lib/date-format";
import { ChinaInvoiceDraft, parseChinaInvoiceXlsx } from "../lib/china-invoice-xlsx";
import { clearInvoiceCommandKey, invoiceCommandKey } from "../lib/invoice-command-key";
import { persistSessionDraft } from "../lib/po-draft-storage";
import { purchaseOrderNumberBlockMessage } from "../lib/po-lifecycle";
import DeletedPurchaseOrderActions, { PurchaseOrderReplacePayload } from "./DeletedPurchaseOrderActions";
import { classifyTotvsPurchaseRequest, totvsPurchaseRequestPayload } from "../lib/totvs-purchase-request";
import { getMessages, useI18n } from "./I18nProvider";
import PageHeader from "./PageHeader";
import { classifyInvoiceDestination, invoiceAssignmentsFromLines, invoicePoCodeDiffers, invoicePoPriceDiffers, invoicePoUnitDiffers,
  invoiceSupplierMatchesExporter, suggestInvoicePoItem } from "../lib/china-invoice-mapping";

const poRoles = new Set(["Master", "Administrador", "Importação", "Compras"]);
const ipRoles = new Set(["Master", "Administrador", "Importação"]);

type PoItemDraft = {
  draftId: string;
  externalLineReference: string;
  productCode: string;
  description: string;
  orderedQuantity: string;
  unit: string;
  unitPrice: string;
  currency: string;
  operational: OperationalFieldDraft;
};

type PoDraft = {
  importer: string;
  number: string;
  supplier: string;
  notes: string;
  items: PoItemDraft[];
  commonItemFields: OperationalFieldDraft;
  purchaseRequestId: string;
  createdPoId: string;
};

const poDraftKey = "new-operational-record:po:v1";
const poCommandKey = "new-operational-record:po-command:v1";

type InvoiceItemCandidate = { id: string; lineNumber: number; productCode: string; description: string;
  unit: string; remainingQuantity: string; purchaseOrderId: string; poNumber: string;
  poStatus?: "ACTIVE" | "CANCELLED" | "CLOSED" | "DELETED";
  supplierEntryId: string | null; supplierText: string | null; supplierName: string | null; supplierCode: string | null;
  orderedQuantity: string; unitPrice: string | null; currency: string | null; poNcmCode: string | null;
  productId: string | null; productName: string | null; productNcmCode: string | null;
  manufacturer: string | null; manufacturerAddress: string | null; manufacturerCountry: string | null };
type InvoiceMatch = { key: string; sourceRow: number; sourcePoNumber: string; poNumber: string; quantity: string;
  productCode: string; description: string; itemId: string; candidates: InvoiceItemCandidate[];
  poExists: boolean; poId: string | null; poStatus: "ACTIVE" | "CANCELLED" | "CLOSED" | "DELETED" | null;
  updateProduct: boolean; updatePoItem: boolean; confirmCodeMismatch: boolean; confirmSupplierMismatch: boolean;
  confirmUnitMismatch: boolean; confirmPriceMismatch: boolean };
type InvoiceDuplicate = { id: string; ipNumber: string; recordStatus: string; version: string;
  logisticsStatus: string | null; lifecycleStatus: string; shipped?: boolean };
type InvoiceExistingProcess = { id: string; ipNumber: string; importer: string; recordStatus: string; version: string;
  purchaseOrders: Array<{ id: string; number: string }>;
  operationalAllocations: Array<{ id: string; poId: string; poNumber: string; productCode: string;
    quantity: string; unit: string }> };

type InvoiceImporterOption = { code: string; cnpj: string | null; shortName?: string | null };

function normalizeCnpj(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/gu, "");
}

function normalizeLookup(value: string | null | undefined): string {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/gu, "")
    .toLocaleUpperCase("pt-BR").replace(/[^A-Z0-9]+/gu, " ").trim().replace(/\s+/gu, " ");
}

function supplierMatchesExporter(candidate: InvoiceItemCandidate, exporter: string): boolean {
  return invoiceSupplierMatchesExporter([candidate.supplierText, candidate.supplierName, candidate.supplierCode], exporter);
}

function normalizePoNumber(value: string): string {
  return value.toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/gu, "").replace(/^PO/u, "");
}

async function forEachInBatches<T>(items: readonly T[], size: number, action: (item: T) => Promise<void>): Promise<void> {
  for (let offset = 0; offset < items.length; offset += size) {
    await Promise.all(items.slice(offset, offset + size).map(action));
  }
}

function blankPoItem(): PoItemDraft {
  return { draftId: globalThis.crypto.randomUUID(), externalLineReference: "", productCode: "", description: "", orderedQuantity: "",
    unit: "", unitPrice: "", currency: "", operational: blankPurchaseOrderItemFields() };
}

function hasPoItemData(items: unknown): boolean {
  return Array.isArray(items) && items.some(item => typeof item === "object" && item !== null
    && Object.entries(item).some(([key, value]) => key !== "draftId" && hasDraftValue(value)));
}

function hasDraftValue(value: unknown): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.some(hasDraftValue);
  if (typeof value === "object" && value !== null) return Object.values(value).some(hasDraftValue);
  return value !== null && value !== undefined && value !== false;
}

function isLegacyImporterOnlyDraft(draft: Partial<PoDraft>): boolean {
  return Boolean(draft.importer?.trim())
    && !hasDraftValue(draft.number)
    && !hasDraftValue(draft.supplier)
    && !hasDraftValue(draft.notes)
    && !hasDraftValue(draft.purchaseRequestId)
    && !hasDraftValue(draft.createdPoId)
    && !hasDraftValue(draft.commonItemFields)
    && Array.isArray(draft.items)
    && !hasPoItemData(draft.items);
}

async function readResponse<T>(response: Response): Promise<T> {
  return readApiJson<T>(response);
}
type InvoicePreflight = { ipNumbers: string[]; ipReferenceOtherImporter: boolean };
type PurchaseOrderPreflight = { importerAcceptsNewPurchaseOrders: boolean; sameImporterDuplicate: boolean;
  sameImporterDeleted?: boolean;
  sameImporterDeletedPurchaseOrder?: { id: string; version: string; replaceSupported: boolean } | null;
  otherImporterDuplicates: string[]; supplierFound: boolean; missingProducts: string[];
  missingUnits: string[]; missingCostCenters: string[] };
async function loadInvoicePreflight(importer: string, draft: ChinaInvoiceDraft): Promise<InvoicePreflight> {
  if (!importer || !draft.invoiceNumber.trim() || !draft.exporterText.trim()) {
    return { ipNumbers: [], ipReferenceOtherImporter: false };
  }
  const params = new URLSearchParams({ importer, ipNumber: draft.ipNumber.trim(),
    invoiceNumber: draft.invoiceNumber.trim(), exporterText: draft.exporterText.trim(),
    fileSha256: draft.fileSha256 });
  return readResponse<InvoicePreflight>(await apiFetch(
    `/api/v1/processes/invoice-duplicates?${params}`, { cache: "no-store" }));
}

async function loadPurchaseOrderPreflight(body: { importer: string; number: string; supplierCode: string;
  productCodes: string[]; units: string[]; costCenters: string[] }): Promise<PurchaseOrderPreflight | null> {
  const route = "/api/v1/purchase-orders/preflight";
  const response = await apiFetch(route, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body) });
  const error = response.status === 404 ? await response.clone().json().catch(() => null) as unknown : null;
  if (isMissingApiRoute(response.status, error, route)) return null;
  return readResponse<PurchaseOrderPreflight>(response);
}

export default function NewOperationalRecord({ kind, returnHref, reviewInvoiceId }: {
  kind: "po" | "ip"; returnHref?: string; reviewInvoiceId?: string }) {
  const router = useRouter();
  const { m } = useI18n();
  const t = m.newRecord;
  const [roles, setRoles] = useState<string[]>([]);
  const [importers, setImporters] = useState<string[]>([]);
  const [importerCnpjs, setImporterCnpjs] = useState<Record<string, string>>({});
  const [importerNames, setImporterNames] = useState<Record<string, string>>({});
  const [importer, setImporter] = useState("");
  const [purchaseRequestId, setPurchaseRequestId] = useState("");
  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequestChoice[]>([]);
  const [number, setNumber] = useState("");
  const [supplier, setSupplier] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<CatalogChoice[]>([]);
  const [products, setProducts] = useState<CatalogChoice[]>([]);
  const [options, setOptions] = useState<OperationalOption[]>([]);
  const [supportsGroup, setSupportsGroup] = useState(false);
  const [items, setItems] = useState<PoItemDraft[]>([blankPoItem()]);
  const [totvsFileName, setTotvsFileName] = useState("");
  const [totvsRows, setTotvsRows] = useState<TotvsPoProductRow[]>([]);
  const [totvsHeader, setTotvsHeader] = useState<{ number: string; importerCnpj: string; supplierCode: string;
    supplierName: string; scNumber: string } | null>(null);
  const [totvsSpreadsheetTotal, setTotvsSpreadsheetTotal] = useState("");
  const [totvsCalculatedTotal, setTotvsCalculatedTotal] = useState("");
  const [totvsCurrency, setTotvsCurrency] = useState("CNY");
  const [totvsImporterMatches, setTotvsImporterMatches] = useState<string[]>([]);
  const [totvsImportHash, setTotvsImportHash] = useState("");
  const [poPreflight, setPoPreflight] = useState<PurchaseOrderPreflight | null>(null);
  const [confirmDuplicateNumber, setConfirmDuplicateNumber] = useState(false);
  const [duplicateNumberJustification, setDuplicateNumberJustification] = useState("");
  const [totvsFileError, setTotvsFileError] = useState("");
  const [totvsParsing, setTotvsParsing] = useState(false);
  const [totvsApplied, setTotvsApplied] = useState(false);
  const [totvsItemEditing, setTotvsItemEditing] = useState<string | null>(null);
  const [newScRequester, setNewScRequester] = useState("");
  const [newScDate, setNewScDate] = useState("");
  const [newScApprovalDate, setNewScApprovalDate] = useState("");
  const [newScCommercialPlanReceivedDate, setNewScCommercialPlanReceivedDate] = useState("");
  const [draftStorageWarning, setDraftStorageWarning] = useState("");
  const [commonItemFields, setCommonItemFields] = useState<OperationalFieldDraft>(blankPurchaseOrderItemFields);
  const [createdPoId, setCreatedPoId] = useState("");
  const [invoiceDraft, setInvoiceDraft] = useState<ChinaInvoiceDraft | null>(null);
  const [invoiceMatches, setInvoiceMatches] = useState<InvoiceMatch[]>([]);
  const [invoiceDuplicate, setInvoiceDuplicate] = useState<InvoiceDuplicate | null>(null);
  const [duplicateInvoiceIps, setDuplicateInvoiceIps] = useState<string[]>([]);
  const [ipReferenceOtherImporter, setIpReferenceOtherImporter] = useState(false);
  const [confirmDuplicateInvoice, setConfirmDuplicateInvoice] = useState(false);
  const [shippedChange, setShippedChange] = useState(emptyShippedChange);
  const [invoiceExistingProcess, setInvoiceExistingProcess] = useState<InvoiceExistingProcess | null>(null);
  const [reviewTarget, setReviewTarget] = useState<InvoiceExistingProcess | null>(null);
  const [orphanPoDecisions, setOrphanPoDecisions] = useState<Record<string, "KEEP" | "REMOVE">>({});
  const [invoiceError, setInvoiceError] = useState("");
  const [confirmImporterCnpjMismatch, setConfirmImporterCnpjMismatch] = useState(false);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const specificItemFields = purchaseOrderSpecificFields(supportsGroup);

  useEffect(() => {
    if (kind !== "po") { setDraftReady(true); return; }
    try {
      const raw = sessionStorage.getItem(poDraftKey);
      if (raw) {
        const draft = JSON.parse(raw) as Partial<PoDraft>;
        if (Array.isArray(draft.items) && draft.items.length > 0) {
          // Older builds saved the first available importer as if the user had selected it.
          // Clear that stale value only when the rest of the PO draft is still empty.
          setImporter(isLegacyImporterOnlyDraft(draft) ? "" : typeof draft.importer === "string" ? draft.importer : "");
          setPurchaseRequestId(typeof draft.purchaseRequestId === "string" ? draft.purchaseRequestId : "");
          setNumber(typeof draft.number === "string" ? draft.number : "");
          setSupplier(typeof draft.supplier === "string" ? draft.supplier : "");
          setNotes(typeof draft.notes === "string" ? draft.notes : "");
          setItems(draft.items.map((item, index) => ({ ...item,
            draftId: typeof item.draftId === "string" && item.draftId ? item.draftId : `restored:${index}` })));
          setCommonItemFields(draft.commonItemFields ?? blankPurchaseOrderItemFields);
          setCreatedPoId(typeof draft.createdPoId === "string" ? draft.createdPoId : "");
        }
      }
    } catch {
      sessionStorage.removeItem(poDraftKey);
    } finally {
      setDraftReady(true);
    }
  }, [kind]);

  useEffect(() => {
    if (kind !== "po" || !draftReady) return;
    const draft: PoDraft = { importer, number, supplier, notes, items, commonItemFields, purchaseRequestId, createdPoId };
    const compact = { ...draft, items: items.map(item => ({ ...item, operational: blankPurchaseOrderItemFields() })) };
    try {
      setDraftStorageWarning(persistSessionDraft(sessionStorage, poDraftKey, draft, compact, getMessages()));
    } catch {
      setDraftStorageWarning(getMessages().poDraft.failed);
    }
  }, [kind, draftReady, importer, number, supplier, notes, items, commonItemFields, purchaseRequestId, createdPoId]);

  useEffect(() => {
    Promise.all([apiFetch("/auth/me"), apiFetch("/api/v1/importers", { cache: "no-store" }), loadOperationalCatalog()])
      .then(async ([identity, list, operationalCatalog]) => {
        if (!identity.ok || !list.ok) throw new Error(getMessages().newRecord.permissionsFailed);
        const user = await identity.json() as { roles: string[] };
        const data = await list.json() as { items: InvoiceImporterOption[] };
        const visibleImporters = data.items.filter(item => kind !== "po" || Boolean(item.cnpj));
        setRoles(user.roles);
        setOptions(operationalCatalog.items);
        setSupportsGroup(operationalCatalog.purchaseOrderGroup);
        setImporters(visibleImporters.map(item => item.code));
        setImporterCnpjs(Object.fromEntries(visibleImporters.filter(item => item.cnpj)
          .map(item => [item.code, normalizeCnpj(item.cnpj)])));
        setImporterNames(Object.fromEntries(visibleImporters.map(item => [item.code,
          item.shortName?.trim() || operationalCatalog.items.find(option => normalizeLookup(option.entity) === "IMPORTER"
            && option.value === item.code)?.shortName?.trim() || item.code])));
        if (kind === "po") setImporter(current => visibleImporters.some(item => item.code === current) ? current : "");
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : getMessages().common.unexpectedError))
      .finally(() => setLoading(false));
  }, [kind]);

  useEffect(() => {
    if (!reviewInvoiceId) return;
    apiFetch(`/api/v1/processes/${reviewInvoiceId}`, { cache: "no-store" })
      .then(response => readResponse<InvoiceExistingProcess>(response))
      .then(process => { setReviewTarget(process); setImporter(process.importer); setNumber(process.ipNumber); })
      .catch(cause => setError(cause instanceof Error ? cause.message : getMessages().newRecord.reviewOpenFailed));
  }, [reviewInvoiceId]);

  useEffect(() => {
    if (!importer) { setSuppliers([]); setProducts([]); return; }
    let active = true;
    setCatalogLoading(true);
    Promise.all([loadCatalogChoices("suppliers", importer), kind === "po" ? loadCatalogChoices("products", importer) : Promise.resolve([])])
      .then(([supplierItems, productItems]) => {
        if (!active) return;
        setSuppliers(supplierItems);
        setProducts(productItems);
      })
      .catch(cause => {
        if (active) setError(cause instanceof Error ? cause.message : getMessages().newRecord.catalogFailed);
      })
      .finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; };
  }, [importer, kind]);

  useEffect(() => {
    if (kind !== "po") { setPurchaseRequests([]); return; }
    const controller = new AbortController();
    loadPurchaseRequests("", controller.signal)
      .then(setPurchaseRequests)
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : getMessages().newRecord.scsFailed); });
    return () => controller.abort();
  }, [kind]);

  const allowed = roles.some(role => (kind === "po" ? poRoles : ipRoles).has(role));
  const invoiceHasUnconfirmedCodeMismatch = invoiceMatches.some(match => {
    const candidate = match.candidates.find(value => value.id === match.itemId);
    return Boolean(candidate && invoicePoCodeDiffers(match.productCode, candidate.productCode) && !match.confirmCodeMismatch);
  });
  const invoiceHasUnconfirmedSupplierMismatch = invoiceMatches.some(match => {
    const candidate = match.candidates.find(value => value.id === match.itemId);
    return Boolean(candidate && !supplierMatchesExporter(candidate, invoiceDraft?.exporterText ?? "")
      && !match.confirmSupplierMismatch);
  });
  const invoiceHasUnconfirmedUnitMismatch = invoiceMatches.some(match => {
    const candidate = match.candidates.find(value => value.id === match.itemId);
    const line = invoiceDraft?.lines.find(value => value.sourceRow === match.sourceRow);
    return Boolean(candidate && line && invoicePoUnitDiffers(line.unit, candidate.unit) && !match.confirmUnitMismatch);
  });
  const invoiceHasUnconfirmedPriceMismatch = invoiceMatches.some(match => {
    const candidate = match.candidates.find(value => value.id === match.itemId);
    const line = invoiceDraft?.lines.find(value => value.sourceRow === match.sourceRow);
    return Boolean(candidate && line && invoicePoPriceDiffers(line.unitPrice, candidate.unitPrice, candidate.currency)
      && !match.confirmPriceMismatch);
  });
  const selectedPurchaseRequest = purchaseRequests.find(choice => choice.id === purchaseRequestId);
  const totvsScClassification = totvsHeader && importer
    ? classifyTotvsPurchaseRequest({ importer, scNumber: totvsHeader.scNumber,
      supplierCode: totvsHeader.supplierCode, purchaseRequests })
    : { kind: "none" as const };
  const totvsScPayload = totvsPurchaseRequestPayload({ classification: totvsScClassification,
    selectedPurchaseRequestId: purchaseRequestId, newRequest: { requester: newScRequester, scDate: newScDate,
      approvalDate: newScApprovalDate, commercialPlanReceivedDate: newScCommercialPlanReceivedDate } }, m);
  const totvsSupplierOption = suppliers.find(item => normalizeLookup(item.code) === normalizeLookup(totvsHeader?.supplierCode));
  const totvsSupplierNameDiverges = Boolean(totvsHeader && totvsSupplierOption
    && normalizeLookup(totvsSupplierOption.name) !== normalizeLookup(totvsHeader.supplierName));
  const totvsImporterResolved = Boolean(importer && totvsImporterMatches.includes(importer));
  const totvsMissingProducts = !catalogLoading ? totvsRows.filter(row => !products.some(product =>
    normalizeLookup(product.code) === normalizeLookup(row.productCode) && product.status === "ACTIVE")) : [];
  const unitValues = new Set(options.filter(option => option.entity === "unit_of_measure").map(option => normalizeLookup(option.value)));
  const costCenterValues = new Set(options.filter(option => option.entity === "cost_center").map(option => normalizeLookup(option.value)));
  const totvsMissingUnits = options.length ? totvsRows.filter(row => !unitValues.has(normalizeLookup(row.unit))) : [];
  const totvsMissingCostCenters = options.length ? totvsRows.filter(row => !costCenterValues.has(normalizeLookup(row.costCenter))) : [];
  const totvsTotalIssues = totvsRows.filter(row => !row.totalWithinTolerance);
  const selectedScConflictsWithTotvs = Boolean(selectedPurchaseRequest && totvsHeader
    && (selectedPurchaseRequest.importer !== importer
      || normalizeLookup(selectedPurchaseRequest.supplierText) !== normalizeLookup(totvsHeader.supplierCode)));
  const totvsImportReady = Boolean(totvsHeader && totvsImporterResolved && totvsSupplierOption
    && normalizeLookup(supplier) === normalizeLookup(totvsHeader.supplierCode))
    && !catalogLoading && totvsTotalIssues.length === 0 && totvsMissingProducts.length === 0
    && totvsMissingUnits.length === 0 && totvsMissingCostCenters.length === 0 && !selectedScConflictsWithTotvs
    && totvsScClassification.kind !== "supplier-mismatch";
  const compactPoItems = totvsApplied || items.length > 50;
  const poPreflightHasCatalogIssues = Boolean(poPreflight && (!poPreflight.importerAcceptsNewPurchaseOrders
    || !poPreflight.supplierFound || poPreflight.missingProducts.length || poPreflight.missingUnits.length
    || poPreflight.missingCostCenters.length));
  const poDuplicateNeedsConfirmation = Boolean(poPreflight?.otherImporterDuplicates.length
    && (!confirmDuplicateNumber || duplicateNumberJustification.trim().length < 3));
  const poNumberBlockMessage = poPreflight ? purchaseOrderNumberBlockMessage(poPreflight, number, m) : null;
  const canManagePoLifecycle = roles.some(role => role === "Master" || role === "Administrador");
  const poReplacePayload: PurchaseOrderReplacePayload | null = totvsHeader && totvsRows.length && totvsImportHash ? {
    header: { number: totvsHeader.number, supplierCode: totvsHeader.supplierCode }, fileName: totvsFileName,
    fileSha256: totvsImportHash, currency: totvsCurrency,
    items: totvsRows.map(row => ({ externalLineReference: row.externalLineReference, productCode: row.productCode,
      description: row.description, orderedQuantity: row.orderedQuantity, unitPrice: row.unitPrice, unit: row.unit,
      costCenter: row.costCenter.trim() || null })),
  } : null;
  const poPreflightBlocksSave = Boolean(poNumberBlockMessage || poPreflightHasCatalogIssues || poDuplicateNeedsConfirmation);
  const allocatedPoIds = new Set(invoiceMatches.flatMap(match => {
    const candidate = match.candidates.find(value => value.id === match.itemId);
    return candidate ? [candidate.purchaseOrderId] : [];
  }));
  const orphanPos = invoiceExistingProcess?.purchaseOrders.filter(order => !allocatedPoIds.has(order.id)) ?? [];
  const destinationIssues = invoiceMatches.map(match => ({ match, issue: classifyInvoiceDestination(
    match.candidates, match.poExists, match.productCode, match.quantity, match.itemId, match.poStatus ?? "ACTIVE") }))
    .filter(entry => entry.issue !== null);
  const importerCnpjMismatch = Boolean(invoiceDraft && importer
    && (normalizeCnpj(invoiceDraft.importerCnpj).length !== 14
      || normalizeCnpj(importerCnpjs[importer]) !== normalizeCnpj(invoiceDraft.importerCnpj)));

  function updateItem(index: number, change: Partial<PoItemDraft>) {
    setPoPreflight(null);
    setItems(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...change } : item));
  }

  function updateProductCode(index: number, productCode: string) {
    const product = products.find(choice => normalizeLookup(choice.code) === normalizeLookup(productCode.trim()));
    const current = items[index];
    updateItem(index, { productCode, description: product
      ? product.latestTotvsDescription?.trim() || product.name : "",
    operational: { ...current.operational, ncm: product?.ncmCode ?? "" } });
  }

  async function selectTotvsProductFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setTotvsFileName(file.name); setTotvsRows([]); setTotvsHeader(null); setTotvsSpreadsheetTotal("");
    setTotvsCalculatedTotal(""); setTotvsImporterMatches([]); setTotvsImportHash("");
    setTotvsCurrency("CNY"); setTotvsFileError(""); setTotvsApplied(false); setTotvsParsing(true);
    setNewScRequester(""); setNewScDate(""); setNewScApprovalDate(""); setNewScCommercialPlanReceivedDate("");
    setPoPreflight(null); setConfirmDuplicateNumber(false); setDuplicateNumberJustification("");
    try {
      const result = await parseTotvsPoXlsx(file, m);
      const loadedPurchaseRequests = await loadPurchaseRequests("");
      setPurchaseRequests(loadedPurchaseRequests);
      setTotvsRows(result.rows); setTotvsHeader(result.header);
      setTotvsSpreadsheetTotal(result.spreadsheetTotal); setTotvsCalculatedTotal(result.calculatedTotal);
      setNumber(result.header.number); setSupplier(result.header.supplierCode); setPurchaseRequestId("");
      const cnpjMatches = importers.filter(code => importerCnpjs[code] === result.header.importerCnpj);
      setTotvsImporterMatches(cnpjMatches);
      const resolvedImporter = cnpjMatches.length === 1 ? cnpjMatches[0] : "";
      setImporter(resolvedImporter);
      const classification = classifyTotvsPurchaseRequest({ importer: resolvedImporter,
        scNumber: result.header.scNumber, supplierCode: result.header.supplierCode,
        purchaseRequests: loadedPurchaseRequests });
      if (classification.kind === "match") {
        setPurchaseRequestId(classification.request.id);
        setSupplier(classification.request.supplierText ?? result.header.supplierCode);
        setCommonItemFields(current => ({ ...current, ...purchaseRequestOperationalFields(classification.request) }));
      } else {
        setCommonItemFields(current => ({ ...current, scNumber: result.header.scNumber }));
      }
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      setTotvsImportHash(Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""));
    }
    catch (cause) { setTotvsFileError(cause instanceof Error ? cause.message : m.poPanel.readSheetFailed); }
    finally { setTotvsParsing(false); }
  }

  async function selectChinaInvoice(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
    if (!file) return;
    clearInvoiceCommandKey(sessionStorage);
    setInvoiceError(""); setInvoiceDraft(null); setInvoiceMatches([]); setInvoiceDuplicate(null);
    setDuplicateInvoiceIps([]); setConfirmDuplicateInvoice(false); setIpReferenceOtherImporter(false);
    setInvoiceExistingProcess(null); setOrphanPoDecisions({}); setInvoiceLoading(true);
    try {
      const draft = await parseChinaInvoiceXlsx(file, m);
      if (!draft.ipNumber.trim()) throw new Error(t.ipRefEmpty);
      if (reviewTarget && draft.ipNumber.trim().toLocaleUpperCase("en-US")
        !== reviewTarget.ipNumber.trim().toLocaleUpperCase("en-US")) {
        throw new Error(t.ipRefMustBe(reviewTarget.ipNumber));
      }
      setInvoiceDraft(draft);
      setNumber(draft.ipNumber.trim());
      setStatus("WAITING SHIPMENT");
      const cnpj = normalizeCnpj(draft.importerCnpj);
      const cnpjMatches = cnpj.length === 14 ? importers.filter(code => importerCnpjs[code] === cnpj) : [];
      const invoiceImporter = reviewTarget?.importer ?? (cnpjMatches.length === 1 ? cnpjMatches[0] : "");
      setImporter(invoiceImporter);
      setConfirmImporterCnpjMismatch(false);
      if (invoiceImporter) setSuppliers(await loadCatalogChoices("suppliers", invoiceImporter));
      const importerWarning = !cnpj || cnpj.length !== 14
        ? t.cnpjNotIdentified
        : cnpjMatches.length > 1 ? t.cnpjMultiple : cnpjMatches.length === 0 ? t.cnpjUnknown : "";
      const lineIssues = draft.lines.flatMap(line => line.issues.map(issue => t.lineIssue(line.sourceRow, issue)));
      if (lineIssues.length || draft.issues.length) { setInvoiceError([...draft.issues, ...lineIssues].join(" ")); return; }

      if (invoiceImporter) {
        const preflight = await loadInvoicePreflight(invoiceImporter, draft);
        setDuplicateInvoiceIps(preflight.ipNumbers);
        setIpReferenceOtherImporter(preflight.ipReferenceOtherImporter);
        const query = new URLSearchParams({ ipNumber: draft.ipNumber.trim(), importer: invoiceImporter,
          page: "1", pageSize: "200", recordStatus: "all" });
        const existing = await readResponse<{ items: Array<{ id: string; ipNumber: string; recordStatus: string; version: string;
          logisticsStatus: string | null; lifecycleStatus: string; shipped?: boolean }> }>(
          await apiFetch(`/api/v1/processes?${query}`, { cache: "no-store" }));
        const duplicate = existing.items.find(item => item.ipNumber.trim().toLocaleUpperCase("en-US")
          === draft.ipNumber.trim().toLocaleUpperCase("en-US"));
        if (reviewInvoiceId && duplicate?.id !== reviewInvoiceId) {
          throw new Error(t.reviewIpNotFound);
        }
        setInvoiceDuplicate(duplicate ?? null);
        const deletedMessage = deletedIpInvoiceBlockMessage(duplicate?.recordStatus, m);
        if (deletedMessage) {
          setInvoiceError(deletedMessage);
          return;
        }
        if (duplicate?.recordStatus === "CANCELLED" || duplicate?.lifecycleStatus === "CLOSED") {
          setInvoiceError(t.ipCancelledOrClosed);
          return;
        }
        setInvoiceExistingProcess(duplicate ? await readResponse<InvoiceExistingProcess>(
          await apiFetch(`/api/v1/processes/${duplicate.id}`, { cache: "no-store" })) : null);
      }

      const assignments = draft.lines.flatMap(line => line.poAssignments.map((assignment, index) => ({
        key: `${line.sourceRow}:${index}`, sourceRow: line.sourceRow, sourcePoNumber: assignment.poNumber,
        poNumber: assignment.poNumber, quantity: assignment.quantity, productCode: line.productCode,
        description: line.description,
      })));
      const candidateKey = (productCode: string, sourcePoNumber: string) =>
        `${normalizePoNumber(sourcePoNumber)}|${productCode.trim().toLocaleUpperCase("en-US")}`;
      const candidateRequests = new Map<string, { productCode: string; sourcePoNumber: string }>();
      for (const assignment of assignments) candidateRequests.set(candidateKey(assignment.productCode, assignment.sourcePoNumber), {
        productCode: assignment.productCode, sourcePoNumber: assignment.sourcePoNumber,
      });
      const candidatesByAssignment = new Map<string, { items: InvoiceItemCandidate[]; poExists: boolean;
        purchaseOrderId: string | null; poStatus: "ACTIVE" | "CANCELLED" | "CLOSED" | "DELETED" | null }>();
      if (invoiceImporter) await forEachInBatches([...candidateRequests], 8, async ([key, candidateRequest]) => {
        const params = new URLSearchParams({ importer: invoiceImporter, productCode: candidateRequest.productCode,
          sourcePoNumber: candidateRequest.sourcePoNumber,
          revisingIpNumber: draft.ipNumber.trim() });
        const result = await readResponse<{ items: InvoiceItemCandidate[]; poExists: boolean; purchaseOrderId: string | null;
          poStatus: "ACTIVE" | "CANCELLED" | "CLOSED" | "DELETED" | null }>(
          await apiFetch(`/api/v1/purchase-orders/invoice-candidates?${params}`, { cache: "no-store" }));
        candidatesByAssignment.set(key, result);
      });
      const matches = assignments.map(assignment => {
        const lookup = candidatesByAssignment.get(candidateKey(assignment.productCode, assignment.sourcePoNumber));
        const candidates = lookup?.items ?? [];
        const suggestion = suggestInvoicePoItem(candidates, assignment.productCode, assignment.quantity);
        return { ...assignment, candidates, poExists: lookup?.poExists ?? false,
          poId: lookup?.purchaseOrderId ?? null, poStatus: lookup?.poStatus ?? null,
          itemId: suggestion?.id ?? "", updateProduct: false,
          updatePoItem: false, confirmCodeMismatch: false, confirmSupplierMismatch: false,
          confirmUnitMismatch: false, confirmPriceMismatch: false };
      });
      setInvoiceMatches(matches);
      setInvoiceError(!invoiceImporter ? importerWarning : "");
    } catch (cause) { setInvoiceError(cause instanceof Error ? cause.message : t.invoiceFailed); }
    finally { setInvoiceLoading(false); }
  }

  async function revalidateInvoiceMatches() {
    if (!invoiceDraft) return;
    if (!importer) { setInvoiceError(t.selectImporterFirst); return; }
    setInvoiceLoading(true); setInvoiceError("");
    try {
      const duplicateQuery = new URLSearchParams({ ipNumber: invoiceDraft.ipNumber.trim(), importer,
        page: "1", pageSize: "200", recordStatus: "all" });
      const existing = await readResponse<{ items: Array<{ id: string; ipNumber: string; recordStatus: string; version: string;
        logisticsStatus: string | null; lifecycleStatus: string }> }>(
        await apiFetch(`/api/v1/processes?${duplicateQuery}`, { cache: "no-store" }));
      const duplicate = existing.items.find(item => item.ipNumber.trim().toLocaleUpperCase("en-US")
        === invoiceDraft.ipNumber.trim().toLocaleUpperCase("en-US"));
      if (reviewInvoiceId && duplicate?.id !== reviewInvoiceId) {
        throw new Error(t.reviewIpNotFound);
      }
      setInvoiceDuplicate(duplicate ?? null);
      const preflight = await loadInvoicePreflight(importer, invoiceDraft);
      setDuplicateInvoiceIps(preflight.ipNumbers);
      setIpReferenceOtherImporter(preflight.ipReferenceOtherImporter);
      setConfirmDuplicateInvoice(false);
      const deletedMessage = deletedIpInvoiceBlockMessage(duplicate?.recordStatus, m);
      if (deletedMessage) {
        setInvoiceError(deletedMessage);
        return;
      }
      if (duplicate?.recordStatus === "CANCELLED" || duplicate?.lifecycleStatus === "CLOSED") {
        setInvoiceError(t.ipCancelledOrClosed);
        return;
      }
      setInvoiceExistingProcess(duplicate ? await readResponse<InvoiceExistingProcess>(
        await apiFetch(`/api/v1/processes/${duplicate.id}`, { cache: "no-store" })) : null);
      const assignments = invoiceMatches.length > 0 ? invoiceMatches : invoiceAssignmentsFromLines(invoiceDraft.lines).map(match => ({
        ...match, candidates: [] as InvoiceItemCandidate[], poExists: false, poId: null as string | null, poStatus: null,
        itemId: "", updateProduct: false,
        updatePoItem: false, confirmCodeMismatch: false, confirmSupplierMismatch: false,
        confirmUnitMismatch: false, confirmPriceMismatch: false,
      }));
      const candidateKey = (productCode: string, sourcePoNumber: string) =>
        `${normalizePoNumber(sourcePoNumber)}|${productCode.trim().toLocaleUpperCase("en-US")}`;
      const requests = new Map<string, { productCode: string; sourcePoNumber: string }>();
      for (const match of assignments) requests.set(candidateKey(match.productCode, match.sourcePoNumber), {
        productCode: match.productCode, sourcePoNumber: match.sourcePoNumber,
      });
      const byAssignment = new Map<string, { items: InvoiceItemCandidate[]; poExists: boolean;
        purchaseOrderId: string | null; poStatus: "ACTIVE" | "CANCELLED" | "CLOSED" | "DELETED" | null }>();
      await forEachInBatches([...requests], 8, async ([key, candidateRequest]) => {
        const params = new URLSearchParams({ importer, productCode: candidateRequest.productCode,
          sourcePoNumber: candidateRequest.sourcePoNumber,
          revisingIpNumber: invoiceDraft.ipNumber.trim() });
        const result = await readResponse<{ items: InvoiceItemCandidate[]; poExists: boolean; purchaseOrderId: string | null;
          poStatus: "ACTIVE" | "CANCELLED" | "CLOSED" | "DELETED" | null }>(
          await apiFetch(`/api/v1/purchase-orders/invoice-candidates?${params}`, { cache: "no-store" }));
        byAssignment.set(key, result);
      });
      const refreshed = assignments.map(match => {
        const lookup = byAssignment.get(candidateKey(match.productCode, match.sourcePoNumber));
        const candidates = lookup?.items ?? [];
        const suggestion = suggestInvoicePoItem(candidates, match.productCode, match.quantity);
        const previous = candidates.find(item => item.id === match.itemId
          && normalizePoNumber(item.poNumber) === normalizePoNumber(match.sourcePoNumber)
          && Number(item.remainingQuantity) >= Number(match.quantity));
        const selected = previous ?? suggestion;
        return { ...match, candidates, poExists: lookup?.poExists ?? false,
          poId: lookup?.purchaseOrderId ?? null, poStatus: lookup?.poStatus ?? null,
          poNumber: selected?.poNumber ?? match.sourcePoNumber,
          itemId: selected?.id ?? "", confirmCodeMismatch: Boolean(previous && match.confirmCodeMismatch),
          confirmSupplierMismatch: Boolean(previous && match.confirmSupplierMismatch),
          confirmUnitMismatch: Boolean(previous && match.confirmUnitMismatch),
          confirmPriceMismatch: Boolean(previous && match.confirmPriceMismatch) };
      });
      setInvoiceMatches(refreshed);
    } catch (cause) { setInvoiceError(cause instanceof Error ? cause.message : t.revalidateFailed); }
    finally { setInvoiceLoading(false); }
  }

  function applyTotvsProducts(mode: "replace" | "append") {
    const imported = totvsRows.map(row => ({
      draftId: globalThis.crypto.randomUUID(),
      externalLineReference: row.externalLineReference,
      productCode: row.productCode,
      description: row.description,
      orderedQuantity: row.orderedQuantity,
      unit: row.unit,
      unitPrice: row.unitPrice,
      currency: totvsCurrency,
      operational: { ...blankPurchaseOrderItemFields(), costCenter: row.costCenter },
    }));
    const onlyBlankStarter = items.length === 1 && !items[0].externalLineReference && !items[0].productCode
      && !items[0].description && !items[0].orderedQuantity && !items[0].unit && !items[0].unitPrice
      && !items[0].currency && Object.values(items[0].operational).every(value => !value);
    const existing = mode === "append" && !onlyBlankStarter ? items : [];
    if (existing.length + imported.length > 500) {
      setTotvsFileError(t.maxProducts);
      return;
    }
    setItems(mode === "replace" ? imported : [...existing, ...imported]);
    setTotvsApplied(true);
    setTotvsItemEditing(null);
    setPoPreflight(null);
  }

  function selectPurchaseRequest(id: string) {
    setPoPreflight(null);
    setPurchaseRequestId(id);
    const selected = purchaseRequests.find(choice => choice.id === id);
    if (selected?.supplierText) setSupplier(selected.supplierText);
    if (selected) setImporter(selected.importer);
    setCommonItemFields(current => ({ ...current, ...purchaseRequestOperationalFields(selected),
      ...(!selected && totvsHeader ? { scNumber: totvsHeader.scNumber } : {}) }));
  }

  async function createPurchaseOrder(preflight: PurchaseOrderPreflight | null) {
    if (items.length === 0) throw new Error(t.addOneItem);
    if (totvsScPayload.blocker) throw new Error(totvsScPayload.blocker);
    const newPurchaseRequest = totvsScPayload.choice && "newPurchaseRequest" in totvsScPayload.choice
      ? totvsScPayload.choice.newPurchaseRequest : undefined;
    const requestFields = selectedPurchaseRequest ?? newPurchaseRequest;
    const effectiveCommonItemFields = requestFields
      ? { ...commonItemFields, ...purchaseRequestOperationalFields(requestFields) }
      : commonItemFields;
    if (preflight) {
      if (!preflight.importerAcceptsNewPurchaseOrders) {
        throw new Error(t.importerNeedsCnpj);
      }
      const numberBlockMessage = purchaseOrderNumberBlockMessage(preflight, number, m);
      if (numberBlockMessage) throw new Error(numberBlockMessage);
      if (!preflight.supplierFound) throw new Error(t.selectActiveSupplier);
      if (preflight.missingProducts.length) throw new Error(t.productsOutside(preflight.missingProducts.slice(0, 8).join(", ")));
      if (preflight.missingUnits.length) throw new Error(t.unitsOutside(preflight.missingUnits.slice(0, 8).join(", ")));
      if (preflight.missingCostCenters.length) throw new Error(t.costCentersOutside(preflight.missingCostCenters.slice(0, 8).join(", ")));
      if (preflight.otherImporterDuplicates.length && (!confirmDuplicateNumber || duplicateNumberJustification.trim().length < 3)) {
        throw new Error(t.confirmDuplicateNumber);
      }
    }
    if (totvsApplied) {
      if (!totvsHeader || !totvsImporterResolved) {
        throw new Error(t.resolveCnpj);
      }
      if (!totvsSupplierOption || normalizeLookup(supplier) !== normalizeLookup(totvsHeader.supplierCode)) {
        throw new Error(t.selectSheetSupplier);
      }
      if (totvsTotalIssues.length) throw new Error(t.fixTotals);
      if (totvsMissingProducts.length) throw new Error(t.fixProducts);
      if (totvsMissingUnits.length) throw new Error(t.fixUnits);
      if (totvsMissingCostCenters.length) throw new Error(t.fixCostCenters);
      if (selectedScConflictsWithTotvs) throw new Error(t.scConflict);
    }
    for (const [index, item] of items.entries()) {
      if (!item.productCode) throw new Error(t.selectItemProduct(index + 1));
      if (Boolean(item.unitPrice.trim()) !== Boolean(item.currency)) {
        throw new Error(t.priceAndCurrency(index + 1));
      }
    }

    const completeItems = items.map(item => ({
      base: { externalLineReference: item.externalLineReference || null,
        productCode: item.productCode, description: item.description,
        orderedQuantity: item.orderedQuantity.replace(",", "."), unit: item.unit,
        unitPrice: item.unitPrice ? item.unitPrice.replace(",", ".") : null,
        currency: item.currency ? item.currency.toUpperCase() : null, reason: automaticAuditReason },
      fields: {
        ...purchaseOrderItemFieldsPayload(item.operational, false, specificItemFields),
        ...purchaseOrderItemFieldsPayload(effectiveCommonItemFields, false, purchaseOrderCommonItemFields),
      },
    }));
    const completePayload = JSON.stringify({ header: { importer, number,
      purchaseRequestId: purchaseRequestId || null, ...(newPurchaseRequest ? { newPurchaseRequest } : {}),
      supplierText: supplier || null,
      ...(preflight ? { sourceFile: totvsApplied && totvsFileName && totvsImportHash
        ? { fileName: totvsFileName, fileSha256: totvsImportHash } : null } : {}),
      ...(preflight ? { confirmDuplicateNumber, duplicateNumberJustification: duplicateNumberJustification.trim() || undefined } : {}),
      orderDate: null, notes, reason: automaticAuditReason }, items: completeItems });
    let previousCommand: { payload: string; key: string } | null = null;
    try { previousCommand = JSON.parse(sessionStorage.getItem(poCommandKey) ?? "null"); } catch { /* Recria a chave. */ }
    const commandKey = previousCommand?.payload === completePayload && previousCommand.key
      ? previousCommand.key : crypto.randomUUID();
    sessionStorage.setItem(poCommandKey, JSON.stringify({ payload: completePayload, key: commandKey }));
    const complete = await apiFetch("/api/v1/purchase-orders/complete", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": commandKey },
      body: completePayload,
    });
    const completeError = complete.status === 404
      ? await complete.clone().json().catch(() => null) as unknown : null;
    const routeMissing = isMissingApiRoute(complete.status, completeError);
    if (!routeMissing) {
      const created = await readResponse<{ id: string; itemIds: string[]; purchaseRequestId: string | null }>(complete);
      setCreatedPoId(created.id);
      const followup = await readResponse<{ number: string; importer: string;
        items: ({ id: string } & Record<string, unknown>)[] }>(
        await apiFetch(`/api/v1/purchase-orders/${created.id}/followup`, { cache: "no-store" }));
      const savedHeader = await readResponse<{ supplierText: string | null; orderDate: string | null; notes: string;
        purchaseRequestId: string | null }>(
        await apiFetch(`/api/v1/purchase-orders/${created.id}/operational`, { cache: "no-store" }));
      if (!Array.isArray(created.itemIds) || created.itemIds.length !== completeItems.length ||
          !Array.isArray(followup.items) || followup.number !== number.trim() ||
          followup.importer !== importer.trim() || savedHeader.supplierText !== (supplier.trim() || null) ||
          !savedHeader.orderDate || savedHeader.notes !== notes.trim() ||
          savedHeader.purchaseRequestId !== (created.purchaseRequestId ?? null) ||
          completeItems.some((item, index) => {
            const saved = followup.items.find(row => row.id === created.itemIds[index]);
            return !saved || saved.lineNumber !== index + 1 ||
              saved.productCode !== item.base.productCode.trim() ||
              saved.description !== item.base.description.trim() || saved.unit !== item.base.unit.trim() ||
              (saved.externalLineReference ?? null) !== (item.base.externalLineReference?.trim() || null) ||
              Number(saved.orderedQuantity) !== Number(item.base.orderedQuantity) ||
              (saved.unitPrice === null ? null : Number(saved.unitPrice)) !==
                (item.base.unitPrice === null ? null : Number(item.base.unitPrice)) ||
              (saved.currencyCode ?? null) !== item.base.currency ||
              Object.entries(item.fields).some(([key, value]) => String(saved[key] ?? "") !== String(value ?? ""));
          })) {
        throw new Error(t.createdNotConfirmed);
      }
      setDraftReady(false);
      sessionStorage.removeItem(poDraftKey);
      sessionStorage.removeItem(poCommandKey);
      router.push(`/purchase-orders/${created.id}`);
      return;
    }

    if (newPurchaseRequest) {
      throw new Error(t.noScWithPo);
    }

    const header = await readResponse<{ id: string }>(await apiFetch("/api/v1/purchase-orders", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ importer, number, supplierText: supplier || null,
        orderDate: null, notes, purchaseRequestId: purchaseRequestId || null,
        ...(preflight ? { confirmDuplicateNumber, duplicateNumberJustification: duplicateNumberJustification.trim() || undefined } : {}),
        reason: automaticAuditReason }),
    }));
    setCreatedPoId(header.id);

    let saveStep = t.stepItems;
    let itemNumber = 0;
    const expectedItems = new Map<string, Record<string, string | number | null>>();
    try {
      for (const [index, item] of items.entries()) {
        itemNumber = index + 1;
        saveStep = t.stepItem(itemNumber);
        const createdItem = await readResponse<{ id: string }>(await apiFetch(`/api/v1/purchase-orders/${header.id}/items`, {
          method: "POST",
          headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ externalLineReference: item.externalLineReference || null,
            productCode: item.productCode, description: item.description,
            orderedQuantity: item.orderedQuantity.replace(",", "."), unit: item.unit,
            unitPrice: item.unitPrice ? item.unitPrice.replace(",", ".") : null,
            currency: item.currency ? item.currency.toUpperCase() : null, reason: automaticAuditReason }),
        }));

        const fields = {
          ...purchaseOrderItemFieldsPayload(item.operational, false, specificItemFields),
          ...purchaseOrderItemFieldsPayload(effectiveCommonItemFields, false, purchaseOrderCommonItemFields),
        };
        expectedItems.set(createdItem.id, fields);
        if (Object.keys(fields).length > 0) {
          saveStep = t.stepItemFields(itemNumber);
          const operationalPo = await readResponse<{ version: string }>(
            await apiFetch(`/api/v1/purchase-orders/${header.id}/operational`, { cache: "no-store" }));
          await readResponse(await apiFetch(`/api/v1/purchase-orders/${header.id}/items/${createdItem.id}/followup`, {
            method: "PATCH",
            headers: { "content-type": "application/json", "X-Record-Version": operationalPo.version },
            body: JSON.stringify({ fields, reason: automaticAuditReason }),
          }));
        }
      }
      saveStep = t.stepCheck;
      const followup = await readResponse<{ items: ({ id: string } & Record<string, unknown>)[] }>(
        await apiFetch(`/api/v1/purchase-orders/${header.id}/followup`, { cache: "no-store" }));
      if (!Array.isArray(followup.items)) throw new Error(t.noItemsForCheck);
      const savedItems = new Map(followup.items.map(item => [item.id, item]));
      if ([...expectedItems].some(([id, fields]) => {
        const saved = savedItems.get(id);
        return !saved || Object.entries(fields).some(([key, value]) =>
          String(saved[key] ?? "") !== String(value ?? ""));
      })) throw new Error(t.itemsNotReread);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : m.common.unexpectedError;
      setError(t.partialFailure(saveStep, detail));
      return;
    }
    setDraftReady(false);
    sessionStorage.removeItem(poDraftKey);
    sessionStorage.removeItem(poCommandKey);
    router.push(`/purchase-orders/${header.id}`);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (kind === "po") {
        const preflight = await loadPurchaseOrderPreflight({ importer, number: number.trim(), supplierCode: supplier.trim(),
          productCodes: [...new Set(items.map(item => item.productCode.trim()).filter(Boolean))],
          units: [...new Set(items.map(item => item.unit.trim()).filter(Boolean))],
          costCenters: [...new Set(items.map(item => item.operational.costCenter?.trim() ?? "").filter(Boolean))] });
        setPoPreflight(preflight);
        await createPurchaseOrder(preflight);
        return;
      }
      if (invoiceDraft) {
        const preflight = await loadInvoicePreflight(importer, invoiceDraft);
        const currentDuplicateIps = preflight.ipNumbers;
        setIpReferenceOtherImporter(preflight.ipReferenceOtherImporter);
        if (preflight.ipReferenceOtherImporter) {
          throw new Error(t.ipRefOtherImporter);
        }
        if (JSON.stringify([...currentDuplicateIps].sort()) !== JSON.stringify([...duplicateInvoiceIps].sort())) {
          setDuplicateInvoiceIps(currentDuplicateIps);
          setConfirmDuplicateInvoice(false);
          throw new Error(t.duplicateListChanged);
        }
        if (currentDuplicateIps.length && !confirmDuplicateInvoice) {
          throw new Error(t.confirmDuplicateInvoiceFirst);
        }
        const invoiceIpShipped = Boolean(invoiceDuplicate?.shipped);
        if (!shippedChangeReady(invoiceIpShipped, shippedChange)) {
          throw new Error(t.ipShippedConfirm);
        }
        const invoiceAllocationTotals = new Map<number, number>();
        for (const match of invoiceMatches) {
          invoiceAllocationTotals.set(match.sourceRow,
            (invoiceAllocationTotals.get(match.sourceRow) ?? 0) + Number(match.quantity));
        }
        const hasUnconfirmedCodeMismatch = invoiceMatches.some(match => {
          const candidate = match.candidates.find(value => value.id === match.itemId);
          return Boolean(candidate && invoicePoCodeDiffers(match.productCode, candidate.productCode) && !match.confirmCodeMismatch);
        });
        const hasUnconfirmedSupplierMismatch = invoiceMatches.some(match => {
          const candidate = match.candidates.find(value => value.id === match.itemId);
          return Boolean(candidate && !supplierMatchesExporter(candidate, invoiceDraft.exporterText)
            && !match.confirmSupplierMismatch);
        });
        if (invoiceMatches.length === 0 || invoiceMatches.some(match => !match.itemId || !Number(match.quantity)
          || Number(match.quantity) > Number(match.candidates.find(candidate => candidate.id === match.itemId)?.remainingQuantity ?? 0))
          || hasUnconfirmedCodeMismatch || hasUnconfirmedSupplierMismatch
          || invoiceHasUnconfirmedUnitMismatch || invoiceHasUnconfirmedPriceMismatch
          || orphanPos.some(order => !orphanPoDecisions[order.id])
          || (importerCnpjMismatch && !confirmImporterCnpjMismatch)
          || invoiceDraft.lines.some(line => Math.abs((invoiceAllocationTotals.get(line.sourceRow) ?? 0) - Number(line.quantity)) > 0.00000001))
          throw new Error(t.reviewAllLines);
        const productUpdates = new Map<string, Record<string, unknown>>();
        const poItemUpdates = new Map<string, Record<string, unknown>>();
        for (const match of invoiceMatches) {
          const line = invoiceDraft.lines.find(source => source.sourceRow === match.sourceRow);
          const candidate = match.candidates.find(value => value.id === match.itemId);
          if (!line || !candidate) continue;
          if (match.updateProduct && candidate.productId) productUpdates.set(candidate.productCode.toLocaleUpperCase("en-US"), {
            productCode: candidate.productCode, name: line.description, ncmCode: /^\d{8}$/u.test(line.ncm) ? line.ncm : null,
            manufacturer: line.manufacturer || null, manufacturerAddress: line.manufacturerAddress || null,
            manufacturerCountry: line.manufacturerCountry || null,
          });
          if (match.updatePoItem) poItemUpdates.set(match.itemId, { itemId: match.itemId,
            description: line.description, unitPrice: line.unitPrice, currency: "CNY",
            ncmCode: /^\d{8}$/u.test(line.ncm) ? line.ncm : null });
        }
        const payload = {
          confirmDuplicateInvoice: currentDuplicateIps.length > 0 && confirmDuplicateInvoice,
          ...(invoiceIpShipped ? { confirmShippedChange: true, shippedChangeReason: shippedChange.reason.trim() } : {}),
          orphanPoDecisions: orphanPos.map(order => ({ purchaseOrderId: order.id, action: orphanPoDecisions[order.id] })),
          process: { importer, supplierText: invoiceDraft.exporterText, ipNumber: invoiceDraft.ipNumber.trim(), logisticsStatus: null,
            priority: priority || null, notes, reason: automaticAuditReason },
          invoice: { fileName: invoiceDraft.fileName, number: invoiceDraft.invoiceNumber,
            issueDate: /^\d{4}-\d{2}-\d{2}$/u.test(invoiceDraft.invoiceDate) ? invoiceDraft.invoiceDate : null,
            amount: invoiceDraft.totalAmount, currency: "CNY", metadata: {
              fileSha256: invoiceDraft.fileSha256,
              invoiceDateText: invoiceDraft.invoiceDate, ipNumberFromInvoice: invoiceDraft.ipNumber,
              importerCnpj: invoiceDraft.importerCnpj,
              confirmImporterCnpjMismatch,
              importerText: invoiceDraft.importerText, exporterText: invoiceDraft.exporterText,
              headerPoNumber: invoiceDraft.headerPoNumber, originText: invoiceDraft.originText,
              destinationText: invoiceDraft.destinationText, incoterm: invoiceDraft.incoterm,
              countryOfOrigin: invoiceDraft.countryOfOrigin, countryOfAcquisition: invoiceDraft.countryOfAcquisition,
              countryOfPrecedence: invoiceDraft.countryOfPrecedence, paymentTerms: invoiceDraft.paymentTerms,
              totalQuantity: invoiceDraft.totalQuantity, totalNetWeightKg: invoiceDraft.totalNetWeightKg,
              totalGrossWeightKg: invoiceDraft.totalGrossWeightKg,
              lines: invoiceDraft.lines.map(line => ({ sourceRow: line.sourceRow, lineNumber: line.lineNumber,
                ncm: line.ncm, productCode: line.productCode, description: line.description,
                manufacturer: line.manufacturer, manufacturerAddress: line.manufacturerAddress,
                manufacturerCountry: line.manufacturerCountry, quantity: line.quantity, unit: line.unit,
                unitPrice: line.unitPrice, netWeightKg: line.netWeightKg, grossWeightKg: line.grossWeightKg,
                amount: line.amount, poCell: line.poCell })),
              assignments: invoiceMatches.map(match => {
                const candidate = match.candidates.find(value => value.id === match.itemId)!;
                return { sourceRow: match.sourceRow, sourcePoNumber: match.sourcePoNumber, poNumber: candidate.poNumber,
                  quantity: match.quantity, productCode: match.productCode, poProductCode: candidate.productCode,
                  confirmCodeMismatch: match.confirmCodeMismatch, confirmSupplierMismatch: match.confirmSupplierMismatch,
                  confirmUnitMismatch: match.confirmUnitMismatch, confirmPriceMismatch: match.confirmPriceMismatch,
                  poSupplierText: candidate.supplierText, poSupplierName: candidate.supplierName,
                  poSupplierCode: candidate.supplierCode,
                  itemId: match.itemId };
              }),
              catalogUpdates: { products: [...productUpdates.values()], poItems: [...poItemUpdates.values()] },
            } },
          allocations: invoiceMatches.map(match => ({ itemId: match.itemId, quantity: match.quantity,
            notes: `Invoice ${invoiceDraft.invoiceNumber || invoiceDraft.fileName}, linha ${match.sourceRow}` })),
        };
        const result = await readResponse<{ id: string; revision?: boolean }>(await apiFetch("/api/v1/processes/import-invoice", {
          method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": invoiceCommandKey(sessionStorage, payload),
            ...(invoiceDuplicate ? { "X-Record-Version": invoiceDuplicate.version } : {}) },
          body: JSON.stringify(payload),
        }));
        clearInvoiceCommandKey(sessionStorage);
        router.push(`/processes/${result.id}`);
        return;
      }
      const response = await apiFetch("/api/v1/processes", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ importer, supplierText: supplier || null, ipNumber: number, logisticsStatus: status || null,
          priority: priority || null, notes, reason: automaticAuditReason }),
      });
      const result = await readResponse<{ id: string }>(response);
      router.push(`/processes/${result.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : m.common.unexpectedError);
    } finally {
      setSaving(false);
    }
  }

  return <main className="shell">
    <PageHeader back={{ href: returnHref ?? (kind === "po" ? "/" : "/processes"), label: t.back }} eyebrow={t.eyebrow}
      title={kind === "po" ? t.titlePo : t.titleIp}>
      <p>{kind === "po" ? t.introPo : t.introIp}</p>
    </PageHeader>
    {loading && <p role="status">{t.loading}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {!loading && !allowed && <p className="notice warning">{kind === "po" ? t.notAllowedPo : t.notAllowedIp}</p>}
    {!loading && allowed && <form className="stack-form" onSubmit={submit}>
      {kind === "po" ? <>
        <section className="card po-entry-section">
          <h2>{t.orderData}</h2>
          <p className="muted">{t.orderHelp}</p>
          <div className="operational-fields po-header-fields">
            <PurchaseRequestSelect importer={importer} value={purchaseRequestId} choices={purchaseRequests} onChange={selectPurchaseRequest} />
            <label>{m.poPanel.importer}<SearchableSelect ariaLabel={m.poPanel.importer} required disabled={Boolean(purchaseRequestId || invoiceDraft)}
              value={importer} onChange={value => {
              setPoPreflight(null); setConfirmDuplicateNumber(false); setDuplicateNumberJustification("");
              setImporter(value); selectPurchaseRequest("");
            }} options={(totvsHeader && totvsImporterMatches.length > 1 ? totvsImporterMatches : importers)
              .map(value => ({ value, label: t.importerOption(importerNames[value] ?? value, importerCnpjs[value] ?? "") }))} />
              {purchaseRequestId ? <small className="po-field-hint">{t.importerFromSc}</small> : null}</label>
            <label>{m.poPanel.totvsNumber}<input required maxLength={80} value={number} onChange={event => {
              setPoPreflight(null); setConfirmDuplicateNumber(false); setDuplicateNumberJustification(""); setNumber(event.target.value);
            }} /></label>
            <label>{m.poPanel.supplier}<SearchableSelect ariaLabel={m.poPanel.supplier} required disabled={Boolean(purchaseRequestId)} value={supplier}
              onChange={value => { setPoPreflight(null); setSupplier(value); }} options={suppliers.map(item => ({ value: item.code, label: `${item.code} · ${item.name}` }))} />
              {purchaseRequestId ? <small className="po-field-hint">{m.poPanel.fromSc}</small> : null}</label>
            <label>{m.poPanel.poDate}<input type="text" value={t.poDateAuto} readOnly aria-readonly="true" /></label>
          </div>
          <label>{t.orderNotes}<textarea maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
          <h3>{t.sharedAll}</h3>
          <OperationalFieldsEditor fields={purchaseOrderCommonItemFields} values={commonItemFields}
            options={options} setValues={setCommonItemFields} />
        </section>

        <section className="card po-entry-section">
          <div className="po-entry-heading">
            <div><h2>{t.productsTitle}</h2><p className="muted">{t.productsHelp}</p></div>
            <button className="button secondary" type="button" onClick={() => setItems(current => [...current, blankPoItem()])}>{t.addProduct}</button>
          </div>
          <div className="totvs-po-import">
            <div><h3>{t.importTitle}</h3>
              <p className="muted">{t.importHelp}</p>
            </div>
            <label>{m.poPanel.excelFile}<input className="file-upload-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={totvsParsing || saving || Boolean(createdPoId)} onChange={event => void selectTotvsProductFile(event)} /></label>
            {totvsParsing && <p role="status">{t.readingSheet}</p>}
            {totvsFileError && <p className="notice error" role="alert">{totvsFileError}</p>}
            {draftStorageWarning && <p className="notice warning" role="status">{draftStorageWarning}</p>}
            {totvsRows.length > 0 && !totvsFileError && <>
              <div className="notice" role="status">
                <p>{t.validProducts(totvsFileName, totvsRows.length)}</p>
                <p>{t.sheetSummary(totvsHeader?.number || "—", totvsHeader?.importerCnpj || "—", importer || t.selectMatch)}</p>
                {totvsImporterMatches.length === 0 && <p role="alert">{t.cnpjNoImporter}</p>}
                {totvsImporterMatches.length > 1 && <p role="alert">{t.cnpjMultipleAbove}</p>}
                {totvsHeader && <p>{t.sheetSupplier(totvsHeader.supplierCode, totvsHeader.supplierName)}
                  {totvsSupplierOption ? t.catalogSupplier(totvsSupplierOption.name) : importer ? t.supplierNotInCatalog : ""}</p>}
                {totvsHeader && supplier && normalizeLookup(supplier) !== normalizeLookup(totvsHeader.supplierCode)
                  && <p role="alert">{t.selectSupplierCode(totvsHeader.supplierCode)}</p>}
                {totvsSupplierNameDiverges && <p>{t.checkCompanyName}</p>}
                {totvsHeader?.scNumber && <p>{t.scNumberLine(totvsHeader.scNumber)}
                  {totvsScClassification.kind === "match"
                    ? purchaseRequestId === totvsScClassification.request.id ? t.scLinkedAuto : t.scFoundUnlinked
                    : totvsScClassification.kind === "missing" ? t.scMissing : ""}</p>}
                {totvsScClassification.kind === "supplier-mismatch" && <p className="notice error" role="alert">
                  {t.scSupplierBlocked(totvsScClassification.request.scNumber, totvsScClassification.request.supplierText ?? m.scLink.supplierNotInformed)}
                </p>}
                {totvsScClassification.kind === "missing" && !purchaseRequestId && totvsImporterResolved && <div className="notice totvs-sc-create">
                  <h3>{t.createScTitle(totvsScClassification.scNumber)}</h3>
                  <p>{t.createScHelp}</p>
                  <div className="operational-fields">
                    <label>{m.poPanel.importer}<input readOnly aria-readonly="true" value={importer} /></label>
                    <label>{m.fields.scNumber}<input readOnly aria-readonly="true" value={totvsScClassification.scNumber} /></label>
                    <label>{m.poPanel.supplier}<input readOnly aria-readonly="true" value={totvsHeader?.supplierCode ?? ""} /></label>
                    <label>{m.fields.requester}<OperationalOptionSelect required entity="requester" value={newScRequester} values={options}
                      onChange={setNewScRequester} /></label>
                    <label>{m.fields.scDate}<input type="date" value={newScDate} onChange={event => setNewScDate(event.target.value)} /></label>
                    <label>{t.approvalDate}<input type="date" value={newScApprovalDate}
                      onChange={event => setNewScApprovalDate(event.target.value)} /></label>
                    <label>{t.commercialPlan}<input type="date" value={newScCommercialPlanReceivedDate}
                      onChange={event => setNewScCommercialPlanReceivedDate(event.target.value)} /></label>
                  </div>
                </div>}
                {selectedScConflictsWithTotvs && <p role="alert">{t.selectedScConflict}</p>}
                <p>{t.totals(totvsCurrency, formatNumber(totvsSpreadsheetTotal), formatNumber(totvsCalculatedTotal))}</p>
                <label>{t.poCurrency}<OperationalOptionSelect entity="currency" value={totvsCurrency} values={options}
                  onChange={setTotvsCurrency} required /></label>
              </div>
              <details className="totvs-import-details">
                <summary>{t.checkMapped(totvsRows.length)}</summary>
                <div className="totvs-import-table-wrap"><table className="totvs-import-table">
                  <thead><tr><th>{m.poPanel.item}</th><th>{m.poPanel.product}</th><th>{t.totvsDescription}</th><th>{t.quantity}</th><th>{t.unitShort}</th><th>{t.priceIn(totvsCurrency)}</th><th>{t.sheetTotal}</th><th>{t.reference}</th><th>{t.costCenterShort}</th><th>{t.pending}</th></tr></thead>
                  <tbody>{totvsRows.map(row => {
                    const product = products.find(choice => normalizeLookup(choice.code) === normalizeLookup(row.productCode));
                    const reference = productPriceReferenceForCurrency(product?.referencePrices, totvsCurrency);
                    const estimate = Number(row.unitPrice) === 0 ? estimatedProductTotal(row.orderedQuantity, reference) : null;
                    const catalogDescription = product?.latestTotvsDescription?.trim() || product?.name;
                    const pending = [
                      !row.totalWithinTolerance ? t.pendingTotal : "",
                      totvsMissingProducts.includes(row) ? t.pendingProduct : "",
                      totvsMissingUnits.includes(row) ? t.pendingUnit : "",
                      totvsMissingCostCenters.includes(row) ? t.pendingCostCenter : "",
                      catalogDescription && normalizeLookup(catalogDescription) !== normalizeLookup(row.description)
                        ? t.pendingDescription : "",
                      Number(row.unitPrice) === 0 && !reference ? m.poPanel.noRealPrice : "",
                    ].filter(Boolean).join(" ");
                    return <tr key={row.sourceRow}>
                    <td>{row.externalLineReference}</td><td>{row.productCode}</td><td>{row.description}</td>
                    <td>{formatNumber(row.orderedQuantity)}</td><td>{row.unit}</td><td>{formatNumber(row.unitPrice)} {totvsCurrency}</td>
                    <td>{formatNumber(row.spreadsheetLineTotal)} {totvsCurrency}</td>
                    <td>{Number(row.unitPrice) === 0 ? reference
                      ? <>{m.poPanel.referencePrice(formatNumber(reference.unitPrice), reference.currency, reference.purchaseOrderNumber, formatUsDate(reference.observedAt))}
                        {estimate !== null && m.poPanel.estimated(formatNumber(estimate), reference.currency)}</>
                      : t.noRealPriceShort : "—"}</td>
                    <td>{row.costCenter}</td><td>{pending || "—"}</td>
                    </tr>;
                  })}</tbody>
                </table></div>
              </details>
              <div className="totvs-import-actions">
                <button className="button" type="button" disabled={!totvsImportReady || totvsApplied || saving || Boolean(createdPoId)}
                  onClick={() => applyTotvsProducts("replace")}>{t.replaceItems}</button>
                <button className="button secondary" type="button" disabled={!totvsImportReady || totvsApplied || saving || Boolean(createdPoId)}
                  onClick={() => applyTotvsProducts("append")}>{t.appendItems}</button>
              </div>
              {totvsApplied && <p className="muted" role="status">{t.appliedNotice}</p>}
              {totvsApplied && !totvsImportReady && <p className="notice warning" role="status">{t.resolvePending}</p>}
            </>}
          </div>
          {catalogLoading && <p role="status">{t.loadingCatalog}</p>}
          {compactPoItems && <div className="totvs-import-table-wrap"><table className="totvs-import-table">
            <thead><tr><th>{m.poPanel.item}</th><th>{m.poPanel.product}</th><th>{m.poPanel.description}</th><th>{t.quantity}</th><th>{t.price}</th><th>{m.poPanel.totalValue}</th><th>{m.poPanel.action}</th></tr></thead>
            <tbody>{items.map((item, index) => <tr key={item.draftId}>
              <td>{item.externalLineReference || index + 1}</td><td>{item.productCode || "—"}</td><td>{item.description || "—"}</td>
              <td>{formatNumber(item.orderedQuantity)} {item.unit}</td><td>{formatNumber(item.unitPrice)} {item.currency}</td>
              <td>{formatNumber(String(Number(item.orderedQuantity.replace(",", ".")) * Number(item.unitPrice.replace(",", "."))))} {item.currency}</td>
              <td><button className="button secondary" type="button" onClick={() => setTotvsItemEditing(item.draftId)}>{m.poPanel.edit}</button></td>
            </tr>)}</tbody>
          </table></div>}
          {items.map((item, index) => {
            if (compactPoItems && item.draftId !== totvsItemEditing) return null;
            const product = products.find(choice => normalizeLookup(choice.code) === normalizeLookup(item.productCode));
            const reference = productPriceReferenceForCurrency(product?.referencePrices, item.currency);
            const estimate = estimatedProductTotal(item.orderedQuantity, reference);
            return <article className="po-entry-item" key={item.draftId}>
            <div className="po-entry-heading">
              <h3>{t.productNumber(index + 1)}</h3>
              {compactPoItems && <button className="button secondary" type="button" onClick={() => setTotvsItemEditing(null)}>{t.closeEdit}</button>}
              {items.length > 1 && <button className="button secondary" type="button"
                onClick={() => setItems(current => current.filter((_, itemIndex) => itemIndex !== index))}>{t.remove}</button>}
            </div>
            <div className="operational-fields">
              <label>{m.poPanel.totvsLine}<input maxLength={80} value={item.externalLineReference}
                onChange={event => updateItem(index, { externalLineReference: event.target.value })} /></label>
              <label>{m.poPanel.product}<CatalogProductSelect required value={item.productCode} fallbackName={item.description} products={products}
                onChange={product => updateProductCode(index, product?.code ?? "")} /></label>
              <label>{m.poPanel.productCode}<input value={item.productCode} onChange={event => updateProductCode(index, event.target.value)} /></label>
              <label>{m.poPanel.description}<input value={item.description} onChange={event => updateItem(index, { description: event.target.value })}
                placeholder={t.descriptionPlaceholder} /></label>
              <label>{m.poPanel.orderedQuantity}<input required inputMode="decimal" value={item.orderedQuantity}
                onChange={event => updateItem(index, { orderedQuantity: event.target.value })} placeholder={t.quantityPlaceholder} /></label>
              <label>{m.poPanel.unit}<OperationalOptionSelect required entity="unit_of_measure" value={item.unit} values={options}
                onChange={unit => updateItem(index, { unit })} /></label>
              <label>{m.poPanel.unitPrice}<input inputMode="decimal" value={item.unitPrice}
                onChange={event => updateItem(index, { unitPrice: event.target.value })} /></label>
              <label>{m.poPanel.priceCurrency}<OperationalOptionSelect entity="currency" value={item.currency} values={options}
                onChange={currency => updateItem(index, { currency })} /></label>
            </div>
            {reference && <p className="muted">{m.poPanel.referencePrice(formatNumber(reference.unitPrice), reference.currency,
              reference.purchaseOrderNumber, formatUsDate(reference.observedAt))}
              {estimate !== null && m.poPanel.estimated(formatNumber(estimate), reference.currency)}</p>}
            <h4>{t.productPlanning}</h4>
            <OperationalFieldsEditor fields={specificItemFields} values={item.operational} options={options}
              setValues={operational => updateItem(index, { operational })} />
            <PurchaseOrderCalculatedFields quantity={item.orderedQuantity} unitPrice={item.unitPrice} currency={item.currency} />
          </article>;
          })}
        </section>

        <section className="card po-entry-section">
          <h2>{t.confirmation}</h2>
          {createdPoId && <p className="notice error">{t.alreadyCreated}<Link className="text-link" href={`/purchase-orders/${createdPoId}`}>{t.openCreated}</Link>.</p>}
          {poNumberBlockMessage && <p className="notice error" role="alert">{poNumberBlockMessage}</p>}
          {poPreflight?.sameImporterDeletedPurchaseOrder && <DeletedPurchaseOrderActions
            purchaseOrder={poPreflight.sameImporterDeletedPurchaseOrder} canManageLifecycle={canManagePoLifecycle}
            replacePayload={poReplacePayload} purchaseRequest={totvsScPayload.choice}
            purchaseRequestBlocker={totvsScPayload.blocker} />}
          {poPreflight && (!poPreflight.importerAcceptsNewPurchaseOrders || !poPreflight.supplierFound
            || poPreflight.missingProducts.length > 0 || poPreflight.missingUnits.length > 0 || poPreflight.missingCostCenters.length > 0)
            && <p className="notice error" role="alert">{t.preflightIssues}</p>}
          {poPreflight && poPreflight.otherImporterDuplicates.length > 0 && <div className="notice warning">
            <p>{t.numberExists(number, poPreflight.otherImporterDuplicates.join(", "))}</p>
            <label><input type="checkbox" checked={confirmDuplicateNumber}
              onChange={event => setConfirmDuplicateNumber(event.target.checked)} />{t.confirmSameNumber}</label>
            <label>{t.justification}<input required minLength={3} maxLength={1000} value={duplicateNumberJustification}
              onChange={event => setDuplicateNumberJustification(event.target.value)} /></label>
          </div>}
          <button className="button" disabled={saving || !importer || Boolean(createdPoId)
            || (totvsApplied && !totvsImportReady) || poPreflightBlocksSave
            || totvsScPayload.blocker !== null}>
            {saving ? t.savingPo : t.savePo}
          </button>
        </section>
      </> : <section className="card ip-entry-section">
        <div className="totvs-po-import">
          <h2>{reviewInvoiceId ? t.reviewInvoice : t.importInvoice}</h2>
          <p className="muted">{t.invoiceHelp}</p>
          <label>{t.invoiceFile}<input className="file-upload-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={invoiceLoading || saving || Boolean(reviewInvoiceId && !reviewTarget)} onChange={event => void selectChinaInvoice(event)} /></label>
          {invoiceLoading && <p role="status">{t.readingInvoice}</p>}
          {invoiceDraft && <>
            <p className="notice invoice-summary" role="status">{t.invoiceSummary(invoiceDraft.fileName, invoiceDraft.lines.length, invoiceMatches.length, formatNumber(invoiceDraft.totalQuantity), formatNumber(invoiceDraft.totalAmount))}</p>
              <p className="muted invoice-importer">{t.invoiceImporter(invoiceDraft.importerCnpj || t.notIdentified, importer || t.noMatch)}</p>
            {invoiceDuplicate && <p className="notice warning" role="alert">
               {invoiceDuplicate.recordStatus === "DRAFT"
                 ? t.draftExists(invoiceDraft.ipNumber) : t.ipExists(invoiceDraft.ipNumber)}
            </p>}
            {invoiceDuplicate?.shipped && <ShippedChangeConfirmation value={shippedChange} onChange={setShippedChange} />}
            {duplicateInvoiceIps.length > 0 && <div className="notice error" role="alert">
              <p>{t.invoiceInIps(duplicateInvoiceIps.join(", "))}</p>
              <label><input type="checkbox" checked={confirmDuplicateInvoice}
                onChange={event => setConfirmDuplicateInvoice(event.target.checked)} />{t.confirmDuplicateInvoice}</label>
            </div>}
            {ipReferenceOtherImporter && <p className="notice error" role="alert">
              {t.ipRefOtherImporterCheck}
            </p>}
            {importerCnpjMismatch && <div className="notice error" role="alert">
              <p>{t.cnpjMismatch(invoiceDraft.importerCnpj || t.notIdentified, importer, importerCnpjs[importer] || t.notRegistered)}</p>
              <label><input type="checkbox" checked={confirmImporterCnpjMismatch}
                onChange={event => setConfirmImporterCnpjMismatch(event.target.checked)} />{t.confirmImporter}</label>
            </div>}
            <div className="operational-fields invoice-header-fields">
              <label>{t.invoiceNumber}<input required maxLength={120} value={invoiceDraft.invoiceNumber}
                onChange={event => { setDuplicateInvoiceIps([]); setConfirmDuplicateInvoice(false);
                  setInvoiceDraft(current => current ? { ...current, invoiceNumber: event.target.value } : current); }} /></label>
              <label>{t.invoiceDate}<input required type="date" value={/^\d{4}-\d{2}-\d{2}$/u.test(invoiceDraft.invoiceDate) ? invoiceDraft.invoiceDate : ""}
                onChange={event => setInvoiceDraft(current => current ? { ...current, invoiceDate: event.target.value } : current)} /></label>
              <label>{t.invoiceTotal}<input required inputMode="decimal" value={invoiceDraft.totalAmount}
                onChange={event => setInvoiceDraft(current => current ? { ...current, totalAmount: event.target.value.replace(",", ".") } : current)} /></label>
            </div>
            <p className="muted">{t.destinationHelp}</p>
            {invoiceDraft.warnings.map(warning => <p className="notice warning" key={warning}>{warning}</p>)}
            {destinationIssues.length > 0 && <div className="notice error" role="alert">
              <p>{t.inactivePos(destinationIssues.filter(entry => entry.issue?.kind === "PO_NOT_ACTIVE").length)}</p>
              <p>{t.destinationsNeedAction(destinationIssues.length)}</p>
              <p>{t.destinationCounts(destinationIssues.filter(entry => entry.issue?.kind === "PO_NOT_REGISTERED").length,
                destinationIssues.filter(entry => entry.issue?.kind === "ITEM_NOT_FOUND").length,
                destinationIssues.filter(entry => entry.issue?.kind === "INSUFFICIENT_BALANCE").length)}</p>
            </div>}
            <div className="totvs-import-actions"><button className="button secondary" type="button" disabled={invoiceLoading || !importer}
              onClick={() => void revalidateInvoiceMatches()}>{t.revalidate}</button></div>
            <div className="totvs-import-table-wrap invoice-match-table-wrap"><table className="totvs-import-table invoice-match-table">
              <thead><tr><th>{t.invLine}</th><th>{t.invProduct}</th><th>{t.destinedQuantity}</th><th>{t.poProduct}</th></tr></thead>
              <tbody>{invoiceMatches.map(match => {
                const sourceLine = invoiceDraft.lines.find(line => line.sourceRow === match.sourceRow);
                const rowParts = invoiceMatches.filter(item => item.sourceRow === match.sourceRow);
                const allocated = rowParts.reduce((total, item) => total + (Number(item.quantity) || 0), 0);
                const balanced = sourceLine ? Math.abs(allocated - Number(sourceLine.quantity)) <= 0.00000001 : false;
                const selectedCandidate = match.candidates.find(candidate => candidate.id === match.itemId);
                const codeMismatch = Boolean(selectedCandidate && invoicePoCodeDiffers(match.productCode, selectedCandidate.productCode));
                const unitMismatch = Boolean(selectedCandidate && sourceLine
                  && invoicePoUnitDiffers(sourceLine.unit, selectedCandidate.unit));
                const priceMismatch = Boolean(selectedCandidate && sourceLine
                  && invoicePoPriceDiffers(sourceLine.unitPrice, selectedCandidate.unitPrice, selectedCandidate.currency));
                const destinationIssue = classifyInvoiceDestination(match.candidates, match.poExists,
                  match.productCode, match.quantity, match.itemId, match.poStatus ?? "ACTIVE");
                return <tr key={match.key}>
                  <td>{match.sourceRow}<small>{t.invPo(match.sourcePoNumber || "?")}</small></td>
                  <td>{match.productCode}<small>{match.description}</small></td>
                  <td><input aria-label={t.destinedQuantityAria(match.sourceRow)} inputMode="decimal" value={match.quantity}
                    onChange={event => setInvoiceMatches(current => current.map(item => item.key === match.key
                      ? { ...item, quantity: event.target.value.replace(",", "."), itemId: "", updateProduct: false,
                        updatePoItem: false, confirmCodeMismatch: false, confirmSupplierMismatch: false,
                        confirmUnitMismatch: false, confirmPriceMismatch: false } : item))} />
                    <small>{formatNumber(String(allocated))} / {formatNumber(sourceLine?.quantity ?? "0")} {sourceLine?.unit}</small>
                    {!balanced && <small className="notice error">{t.sumDiffers}</small>}
                  </td>
                  <td><SearchableSelect ariaLabel={t.invoiceItemAria(match.sourceRow)} required value={match.itemId}
                    placeholder={t.selectPoItem} searchPlaceholder={t.searchPoItem}
                    onChange={selectedId => setInvoiceMatches(current => current.map(item => {
                      if (item.key !== match.key) return item;
                      const candidate = item.candidates.find(value => value.id === selectedId);
                      return { ...item, itemId: selectedId, poNumber: candidate?.poNumber ?? "",
                        updateProduct: false, updatePoItem: false, confirmCodeMismatch: false, confirmSupplierMismatch: false,
                        confirmUnitMismatch: false, confirmPriceMismatch: false };
                    }))} options={match.candidates.map(candidate => ({ value: candidate.id,
                      label: t.candidate(candidate.poNumber, candidate.productCode, candidate.lineNumber, `${formatNumber(candidate.remainingQuantity)} ${candidate.unit ?? ""}`),
                      searchText: candidate.description,
                      disabled: Number(candidate.remainingQuantity) < Number(match.quantity) }))} />
                    {destinationIssue && <div className="notice error" role="alert">
                      <p>{t.destinationIssue(match.sourceRow, match.sourcePoNumber, destinationIssue.kind === "PO_NOT_REGISTERED"
                        ? t.poNotRegistered : destinationIssue.kind === "ITEM_NOT_FOUND"
                          ? t.itemNotFound(match.productCode)
                          : destinationIssue.kind === "PO_NOT_ACTIVE"
                            ? t.poInactive(destinationIssue.status === "CLOSED" ? t.poStatusClosed : destinationIssue.status === "CANCELLED" ? t.poStatusCancelled : t.poStatusDeleted)
                            : t.insufficient(formatNumber(destinationIssue.requested), formatNumber(destinationIssue.available)))}</p>
                      {match.poId ? <Link href={`/purchase-orders/${match.poId}`} target="_blank" rel="noopener noreferrer">{t.openPoAdjust}</Link>
                        : <Link href="/purchase-orders/new" target="_blank" rel="noopener noreferrer">{t.createPoTab}</Link>}
                    </div>}
                    {selectedCandidate && <small>{selectedCandidate.description}</small>}
                    {codeMismatch && selectedCandidate && <div className="notice error" role="alert">
                      <p>{t.codeMismatch(match.productCode, selectedCandidate.productCode)}</p>
                      <label><input type="checkbox" checked={match.confirmCodeMismatch}
                        onChange={event => setInvoiceMatches(current => current.map(item => item.key === match.key
                          ? { ...item, confirmCodeMismatch: event.target.checked } : item))} />{t.confirmCode}</label>
                    </div>}
                    {selectedCandidate && !supplierMatchesExporter(selectedCandidate, invoiceDraft.exporterText) && <div className="notice error" role="alert">
                      <p>{t.supplierMismatch(selectedCandidate.poNumber, [selectedCandidate.supplierName, selectedCandidate.supplierText, selectedCandidate.supplierCode].filter(Boolean).join(" · ") || t.noSupplierRegistered, invoiceDraft.exporterText)}</p>
                      <label><input type="checkbox" checked={match.confirmSupplierMismatch}
                        onChange={event => setInvoiceMatches(current => current.map(item => item.key === match.key
                          ? { ...item, confirmSupplierMismatch: event.target.checked } : item))} />{t.confirmSupplier}</label>
                    </div>}
                    {unitMismatch && selectedCandidate && sourceLine && <div className="notice error" role="alert">
                      <p>{t.unitMismatch(sourceLine.unit, selectedCandidate.unit)}</p>
                      <label><input type="checkbox" checked={match.confirmUnitMismatch}
                        onChange={event => setInvoiceMatches(current => current.map(item => item.key === match.key
                          ? { ...item, confirmUnitMismatch: event.target.checked } : item))} />{t.confirmUnit}</label>
                    </div>}
                    {priceMismatch && selectedCandidate && sourceLine && <div className="notice error" role="alert">
                      <p>{t.priceMismatch(sourceLine.unitPrice, selectedCandidate.unitPrice ?? "—")}</p>
                      <label><input type="checkbox" checked={match.confirmPriceMismatch}
                        onChange={event => setInvoiceMatches(current => current.map(item => item.key === match.key
                          ? { ...item, confirmPriceMismatch: event.target.checked } : item))} />{t.confirmPrice}</label>
                    </div>}
                    {selectedCandidate && selectedCandidate.currency && selectedCandidate.currency !== "CNY"
                      && <p className="notice">{t.currencyManual(selectedCandidate.currency)}</p>}
                    {match.itemId && <details><summary>{t.compare}</summary>
                      {(() => {
                        const candidate = match.candidates.find(value => value.id === match.itemId);
                        return candidate ? <>
                          <p>{t.productRecord(candidate.productName ?? t.notRegistered, candidate.productNcmCode ?? "—", candidate.manufacturer ?? t.manufacturerNotRegistered)}</p>
                          <p>{t.invoiceRecord(sourceLine?.description ?? "", sourceLine?.ncm || "—", sourceLine?.manufacturer || t.manufacturerNotInformed)}</p>
                          <p>{t.poItemRecord(candidate.description, candidate.unit, candidate.poNcmCode ?? "—", candidate.unitPrice ?? "—", candidate.currency ?? "")}</p>
                          <p>{t.invoiceLineRecord(sourceLine?.unitPrice ?? "", sourceLine?.unit ?? "", sourceLine?.ncm || "—")}</p>
                        </> : null;
                      })()}
                    </details>}
                    {match.itemId && <div className="operational-fields">
                      <label><input type="checkbox" disabled={!match.candidates.find(candidate => candidate.id === match.itemId)?.productId}
                        checked={match.updateProduct} onChange={event => setInvoiceMatches(current => current.map(item => item.key === match.key
                          ? { ...item, updateProduct: event.target.checked } : item))} />{t.updateProduct}</label>
                      <label><input type="checkbox" checked={match.updatePoItem} onChange={event => setInvoiceMatches(current => current.map(item => item.key === match.key
                        ? { ...item, updatePoItem: event.target.checked } : item))} />{t.updatePoItem}</label>
                    </div>}
                  </td>
                </tr>;
              })}</tbody>
            </table></div>
            {invoiceExistingProcess && <section className="notice" aria-label={t.beforeAfterAria}>
              <h3>{t.beforeAfter}</h3>
              <p>{t.before(invoiceExistingProcess.operationalAllocations.length, invoiceExistingProcess.purchaseOrders.length)}</p>
              {invoiceExistingProcess.operationalAllocations.map(allocation =>
                <p key={allocation.id}>{t.beforeLine(allocation.poNumber, allocation.productCode, formatNumber(allocation.quantity), allocation.unit)}</p>)}
              <p>{t.after(invoiceMatches.length)}</p>
              {invoiceMatches.map(match => {
                const candidate = match.candidates.find(item => item.id === match.itemId);
                return <p key={match.key}>{t.afterLine(match.sourceRow, candidate?.poNumber ?? match.sourcePoNumber,
                  candidate?.productCode ?? t.pendingItem, formatNumber(match.quantity))}</p>;
              })}
              {orphanPos.map(order => <fieldset key={order.id}>
                <legend>{t.orphan(order.number)}</legend>
                <label><input type="radio" name={`orphan-${order.id}`} checked={orphanPoDecisions[order.id] === "KEEP"}
                  onChange={() => setOrphanPoDecisions(current => ({ ...current, [order.id]: "KEEP" }))} />{t.keepLink}</label>
                <label><input type="radio" name={`orphan-${order.id}`} checked={orphanPoDecisions[order.id] === "REMOVE"}
                  onChange={() => setOrphanPoDecisions(current => ({ ...current, [order.id]: "REMOVE" }))} />{t.removeLink}</label>
              </fieldset>)}
            </section>}
            <button className="button secondary" type="button" disabled={saving} onClick={() => {
              clearInvoiceCommandKey(sessionStorage);
              setInvoiceDraft(null); setInvoiceMatches([]); setInvoiceDuplicate(null);
              setDuplicateInvoiceIps([]); setConfirmDuplicateInvoice(false); setIpReferenceOtherImporter(false);
              setInvoiceExistingProcess(null); setOrphanPoDecisions({}); setInvoiceError("");
            }}>{t.removeInvoice}</button>
          </>}
          {invoiceError && <p className="notice error" role="alert">{invoiceError}</p>}
        </div>
        <div className="ip-entry-grid invoice-ip-fields">
        {invoiceDraft ? <label>{t.exporterSupplier}<input readOnly value={invoiceDraft.exporterText} /></label> :
          <label>{m.poPanel.supplier}<SearchableSelect ariaLabel={m.poPanel.supplier} required value={supplier} onChange={setSupplier}
            options={suppliers.map(item => ({ value: item.code, label: `${item.code} · ${item.name}` }))} /></label>}
        <label>{m.poPanel.importer}<SearchableSelect ariaLabel={m.poPanel.importer} required disabled={Boolean(reviewInvoiceId)} value={importer} onChange={value => {
          setImporter(value); setConfirmImporterCnpjMismatch(false); setInvoiceDuplicate(null); setInvoiceError("");
          setDuplicateInvoiceIps([]); setConfirmDuplicateInvoice(false); setIpReferenceOtherImporter(false);
          setInvoiceMatches(current => current.map(match => ({ ...match, itemId: "", candidates: [],
            updateProduct: false, updatePoItem: false, confirmCodeMismatch: false, confirmSupplierMismatch: false,
            confirmUnitMismatch: false, confirmPriceMismatch: false })));
        }} options={importers.map(value => ({ value, label: value }))} /></label>
        <label>{t.ipReference}<input required maxLength={80} readOnly={Boolean(invoiceDraft || reviewInvoiceId)}
          value={invoiceDraft?.ipNumber ?? number} onChange={event => setNumber(event.target.value)} /></label>
        {invoiceDraft ? <label>{t.logisticsStatus}<input readOnly value="WAITING SHIPMENT" /></label> :
          <label>{t.logisticsStatus}<OperationalOptionSelect entity="logistics_status" value={status} values={options} onChange={setStatus} /></label>}
        <label>{m.poPanel.priority}<OperationalOptionSelect entity="priority" value={priority} values={options}
          onChange={setPriority} /></label>
        <label>{m.poPanel.notes}<textarea maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
        </div>
        <button className="button" disabled={saving || invoiceLoading || !importer || Boolean(invoiceDraft && (invoiceError
          || invoiceMatches.some(match => !match.itemId || !Number(match.quantity)
            || Number(match.quantity) > Number(match.candidates.find(candidate => candidate.id === match.itemId)?.remainingQuantity ?? 0))
          || invoiceHasUnconfirmedCodeMismatch || invoiceHasUnconfirmedSupplierMismatch
          || invoiceHasUnconfirmedUnitMismatch || invoiceHasUnconfirmedPriceMismatch
          || ipReferenceOtherImporter || (duplicateInvoiceIps.length > 0 && !confirmDuplicateInvoice)
          || !shippedChangeReady(Boolean(invoiceDuplicate?.shipped), shippedChange)
          || orphanPos.some(order => !orphanPoDecisions[order.id])
          || (importerCnpjMismatch && !confirmImporterCnpjMismatch)
          || invoiceDraft.lines.some(line => Math.abs(invoiceMatches.filter(match => match.sourceRow === line.sourceRow)
            .reduce((total, match) => total + (Number(match.quantity) || 0), 0) - Number(line.quantity)) > 0.00000001)))}>
          {saving ? t.saving : invoiceDraft ? t.createIpWithInvoice : t.saveIp}</button>
      </section>}
    </form>}
  </main>;
}
