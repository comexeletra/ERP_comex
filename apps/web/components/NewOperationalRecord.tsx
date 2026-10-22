"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, isMissingApiRoute, readApiJson } from "../lib/api";
import { automaticAuditReason } from "../lib/audit";
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
  logisticsStatus: string | null; lifecycleStatus: string };
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
      setDraftStorageWarning(persistSessionDraft(sessionStorage, poDraftKey, draft, compact));
    } catch {
      setDraftStorageWarning("Não foi possível guardar o rascunho neste navegador.");
    }
  }, [kind, draftReady, importer, number, supplier, notes, items, commonItemFields, purchaseRequestId, createdPoId]);

  useEffect(() => {
    Promise.all([apiFetch("/auth/me"), apiFetch("/api/v1/importers", { cache: "no-store" }), loadOperationalCatalog()])
      .then(async ([identity, list, operationalCatalog]) => {
        if (!identity.ok || !list.ok) throw new Error("Não foi possível consultar suas permissões e importadoras.");
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
      .catch(cause => setError(cause instanceof Error ? cause.message : "Erro inesperado."))
      .finally(() => setLoading(false));
  }, [kind]);

  useEffect(() => {
    if (!reviewInvoiceId) return;
    apiFetch(`/api/v1/processes/${reviewInvoiceId}`, { cache: "no-store" })
      .then(response => readResponse<InvoiceExistingProcess>(response))
      .then(process => { setReviewTarget(process); setImporter(process.importer); setNumber(process.ipNumber); })
      .catch(cause => setError(cause instanceof Error ? cause.message : "Não foi possível abrir o IP para revisão."));
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
        if (active) setError(cause instanceof Error ? cause.message : "Erro ao carregar produtos e fornecedores.");
      })
      .finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; };
  }, [importer, kind]);

  useEffect(() => {
    if (kind !== "po") { setPurchaseRequests([]); return; }
    const controller = new AbortController();
    loadPurchaseRequests("", controller.signal)
      .then(setPurchaseRequests)
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Erro ao carregar SCs."); });
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
      approvalDate: newScApprovalDate, commercialPlanReceivedDate: newScCommercialPlanReceivedDate } });
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
  const poNumberBlockMessage = poPreflight ? purchaseOrderNumberBlockMessage(poPreflight, number) : null;
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
      const result = await parseTotvsPoXlsx(file);
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
    catch (cause) { setTotvsFileError(cause instanceof Error ? cause.message : "Não foi possível ler a planilha."); }
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
      const draft = await parseChinaInvoiceXlsx(file);
      if (!draft.ipNumber.trim()) throw new Error("IP REF vazio no cabeçalho da aba INV.");
      if (reviewTarget && draft.ipNumber.trim().toLocaleUpperCase("en-US")
        !== reviewTarget.ipNumber.trim().toLocaleUpperCase("en-US")) {
        throw new Error(`O IP REF da invoice deve ser ${reviewTarget.ipNumber} nesta revisão.`);
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
        ? "O CNPJ do importador não foi identificado. Selecione manualmente a importadora e confirme a divergência."
        : cnpjMatches.length > 1
          ? "O CNPJ corresponde a mais de uma importadora. Selecione manualmente a correta."
          : cnpjMatches.length === 0
            ? "O CNPJ não corresponde a uma importadora cadastrada. Selecione manualmente e confirme a divergência."
            : "";
      const lineIssues = draft.lines.flatMap(line => line.issues.map(issue => `Linha ${line.sourceRow}: ${issue}`));
      if (lineIssues.length || draft.issues.length) { setInvoiceError([...draft.issues, ...lineIssues].join(" ")); return; }

      if (invoiceImporter) {
        const preflight = await loadInvoicePreflight(invoiceImporter, draft);
        setDuplicateInvoiceIps(preflight.ipNumbers);
        setIpReferenceOtherImporter(preflight.ipReferenceOtherImporter);
        const query = new URLSearchParams({ ipNumber: draft.ipNumber.trim(), importer: invoiceImporter,
          page: "1", pageSize: "200", recordStatus: "all" });
        const existing = await readResponse<{ items: Array<{ id: string; ipNumber: string; recordStatus: string; version: string;
          logisticsStatus: string | null; lifecycleStatus: string }> }>(
          await apiFetch(`/api/v1/processes?${query}`, { cache: "no-store" }));
        const duplicate = existing.items.find(item => item.ipNumber.trim().toLocaleUpperCase("en-US")
          === draft.ipNumber.trim().toLocaleUpperCase("en-US"));
        if (reviewInvoiceId && duplicate?.id !== reviewInvoiceId) {
          throw new Error("O IP selecionado para revisão não foi encontrado nesta importadora.");
        }
        setInvoiceDuplicate(duplicate ?? null);
        const deletedMessage = deletedIpInvoiceBlockMessage(duplicate?.recordStatus);
        if (deletedMessage) {
          setInvoiceError(deletedMessage);
          return;
        }
        if (duplicate?.recordStatus === "CANCELLED" || duplicate?.lifecycleStatus === "CLOSED") {
          setInvoiceError("Este IP está cancelado ou encerrado. Reabra-o ou use o IP REF correto.");
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
    } catch (cause) { setInvoiceError(cause instanceof Error ? cause.message : "Não foi possível processar a invoice."); }
    finally { setInvoiceLoading(false); }
  }

  async function revalidateInvoiceMatches() {
    if (!invoiceDraft) return;
    if (!importer) { setInvoiceError("Selecione uma importadora antes de carregar as POs."); return; }
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
        throw new Error("O IP selecionado para revisão não foi encontrado nesta importadora.");
      }
      setInvoiceDuplicate(duplicate ?? null);
      const preflight = await loadInvoicePreflight(importer, invoiceDraft);
      setDuplicateInvoiceIps(preflight.ipNumbers);
      setIpReferenceOtherImporter(preflight.ipReferenceOtherImporter);
      setConfirmDuplicateInvoice(false);
      const deletedMessage = deletedIpInvoiceBlockMessage(duplicate?.recordStatus);
      if (deletedMessage) {
        setInvoiceError(deletedMessage);
        return;
      }
      if (duplicate?.recordStatus === "CANCELLED" || duplicate?.lifecycleStatus === "CLOSED") {
        setInvoiceError("Este IP está cancelado ou encerrado. Reabra-o ou use o IP REF correto.");
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
    } catch (cause) { setInvoiceError(cause instanceof Error ? cause.message : "Não foi possível revalidar as distribuições da invoice."); }
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
      setTotvsFileError("A PO pode ter até 500 produtos. Substitua os itens atuais ou reduza a planilha.");
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
    if (items.length === 0) throw new Error("Adicione ao menos um item à PO.");
    if (totvsScPayload.blocker) throw new Error(totvsScPayload.blocker);
    const newPurchaseRequest = totvsScPayload.choice && "newPurchaseRequest" in totvsScPayload.choice
      ? totvsScPayload.choice.newPurchaseRequest : undefined;
    const requestFields = selectedPurchaseRequest ?? newPurchaseRequest;
    const effectiveCommonItemFields = requestFields
      ? { ...commonItemFields, ...purchaseRequestOperationalFields(requestFields) }
      : commonItemFields;
    if (preflight) {
      if (!preflight.importerAcceptsNewPurchaseOrders) {
        throw new Error("A API aceita novas POs somente para importadoras cadastradas com CNPJ.");
      }
      const numberBlockMessage = purchaseOrderNumberBlockMessage(preflight, number);
      if (numberBlockMessage) throw new Error(numberBlockMessage);
      if (!preflight.supplierFound) throw new Error("Selecione um código de fornecedor ativo do catálogo global.");
      if (preflight.missingProducts.length) throw new Error(`Produtos fora do catálogo global: ${preflight.missingProducts.slice(0, 8).join(", ")}.`);
      if (preflight.missingUnits.length) throw new Error(`Unidades fora dos valores operacionais: ${preflight.missingUnits.slice(0, 8).join(", ")}.`);
      if (preflight.missingCostCenters.length) throw new Error(`Centros de custo fora dos valores operacionais: ${preflight.missingCostCenters.slice(0, 8).join(", ")}.`);
      if (preflight.otherImporterDuplicates.length && (!confirmDuplicateNumber || duplicateNumberJustification.trim().length < 3)) {
        throw new Error("Confirme a duplicidade em outra importadora e informe uma justificativa.");
      }
    }
    if (totvsApplied) {
      if (!totvsHeader || !totvsImporterResolved) {
        throw new Error("Resolva o CNPJ da empresa da planilha antes de salvar a PO.");
      }
      if (!totvsSupplierOption || normalizeLookup(supplier) !== normalizeLookup(totvsHeader.supplierCode)) {
        throw new Error("Selecione o fornecedor Codigo da planilha no catálogo global.");
      }
      if (totvsTotalIssues.length) throw new Error("Corrija as linhas cujo preço calculado não confere com Valor Total em até 0,01 na moeda da PO.");
      if (totvsMissingProducts.length) throw new Error("Corrija os produtos da planilha que não estão ativos no catálogo global.");
      if (totvsMissingUnits.length) throw new Error("Corrija as unidades da planilha que não existem nos valores operacionais.");
      if (totvsMissingCostCenters.length) throw new Error("Corrija os centros de custo da planilha que não existem nos valores operacionais.");
      if (selectedScConflictsWithTotvs) throw new Error("A SC vinculada tem importadora ou fornecedor diferente dos informados na planilha.");
    }
    for (const [index, item] of items.entries()) {
      if (!item.productCode) throw new Error(`Selecione o produto do item ${index + 1}.`);
      if (Boolean(item.unitPrice.trim()) !== Boolean(item.currency)) {
        throw new Error(`No item ${index + 1}, preencha preço e moeda juntos ou deixe os dois vazios.`);
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
        throw new Error("A PO foi criada, mas a releitura não confirmou todos os produtos e campos. Abra a PO para conferir.");
      }
      setDraftReady(false);
      sessionStorage.removeItem(poDraftKey);
      sessionStorage.removeItem(poCommandKey);
      router.push(`/purchase-orders/${created.id}`);
      return;
    }

    if (newPurchaseRequest) {
      throw new Error("A API ainda não oferece criação de SC junto com a PO. Tente novamente após a atualização da API de homologação.");
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

    let saveStep = "itens da PO";
    let itemNumber = 0;
    const expectedItems = new Map<string, Record<string, string | number | null>>();
    try {
      for (const [index, item] of items.entries()) {
        itemNumber = index + 1;
        saveStep = `item ${itemNumber}`;
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
          saveStep = `dados operacionais do item ${itemNumber}`;
          const operationalPo = await readResponse<{ version: string }>(
            await apiFetch(`/api/v1/purchase-orders/${header.id}/operational`, { cache: "no-store" }));
          await readResponse(await apiFetch(`/api/v1/purchase-orders/${header.id}/items/${createdItem.id}/followup`, {
            method: "PATCH",
            headers: { "content-type": "application/json", "X-Record-Version": operationalPo.version },
            body: JSON.stringify({ fields, reason: automaticAuditReason }),
          }));
        }
      }
      saveStep = "conferência dos itens da PO";
      const followup = await readResponse<{ items: ({ id: string } & Record<string, unknown>)[] }>(
        await apiFetch(`/api/v1/purchase-orders/${header.id}/followup`, { cache: "no-store" }));
      if (!Array.isArray(followup.items)) throw new Error("A API não retornou os itens da PO para conferência.");
      const savedItems = new Map(followup.items.map(item => [item.id, item]));
      if ([...expectedItems].some(([id, fields]) => {
        const saved = savedItems.get(id);
        return !saved || Object.entries(fields).some(([key, value]) =>
          String(saved[key] ?? "") !== String(value ?? ""));
      })) throw new Error("Os itens ou campos operacionais não apareceram na releitura da PO.");
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "Erro inesperado.";
      setError(`A PO foi criada, mas houve falha ao salvar ${saveStep}. Os dados preenchidos ficaram guardados nesta aba. ${detail}`);
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
          throw new Error("O IP REF da invoice já pertence a outra importadora.");
        }
        if (JSON.stringify([...currentDuplicateIps].sort()) !== JSON.stringify([...duplicateInvoiceIps].sort())) {
          setDuplicateInvoiceIps(currentDuplicateIps);
          setConfirmDuplicateInvoice(false);
          throw new Error("A lista de IPs com esta invoice mudou. Revise a duplicidade e confirme novamente.");
        }
        if (currentDuplicateIps.length && !confirmDuplicateInvoice) {
          throw new Error("Confirme a invoice duplicada antes de continuar.");
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
          throw new Error("Revise e selecione o item de PO para todas as linhas da invoice.");
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
          orphanPoDecisions: orphanPos.map(order => ({ purchaseOrderId: order.id, action: orphanPoDecisions[order.id] })),
          process: { importer, supplierText: invoiceDraft.exporterText, ipNumber: invoiceDraft.ipNumber.trim(), logisticsStatus: "WAITING SHIPMENT",
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
      setError(cause instanceof Error ? cause.message : "Erro inesperado.");
    } finally {
      setSaving(false);
    }
  }

  return <main className="shell">
    <Link className="back" href={returnHref ?? (kind === "po" ? "/" : "/processes")}>← Voltar</Link>
    <header className="page-header">
      <p className="eyebrow">Registro operacional</p>
      <h1>{kind === "po" ? "Cadastrar PO do TOTVS" : "Criar IP"}</h1>
      <p>{kind === "po"
        ? "Preencha os dados do pedido e de cada produto nesta tela. Datas, prazos e indicadores são calculados automaticamente quando houver informações suficientes."
        : "Cadastre o processo de importação. Ele poderá receber itens de várias POs da mesma importadora."}</p>
    </header>
    {loading && <p role="status">Carregando seus dados…</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {!loading && !allowed && <p className="notice">Seu perfil não permite criar {kind === "po" ? "POs" : "IPs"}.</p>}
    {!loading && allowed && <form className="stack-form" onSubmit={submit}>
      {kind === "po" ? <>
        <section className="card po-entry-section">
          <h2>Dados do pedido</h2>
          <p className="muted">Informe a importadora e os dados que identificam a PO no TOTVS.</p>
          <div className="operational-fields po-header-fields">
            <PurchaseRequestSelect importer={importer} value={purchaseRequestId} choices={purchaseRequests} onChange={selectPurchaseRequest} />
            <label>Importadora<SearchableSelect ariaLabel="Importadora" required disabled={Boolean(purchaseRequestId || invoiceDraft)}
              value={importer} onChange={value => {
              setPoPreflight(null); setConfirmDuplicateNumber(false); setDuplicateNumberJustification("");
              setImporter(value); selectPurchaseRequest("");
            }} options={(totvsHeader && totvsImporterMatches.length > 1 ? totvsImporterMatches : importers)
              .map(value => ({ value, label: `${importerNames[value] ?? value} · CNPJ ${importerCnpjs[value] ?? ""}` }))} />
              {purchaseRequestId ? <small className="po-field-hint">Definida pela SC vinculada.</small> : null}</label>
            <label>Número da PO no TOTVS<input required maxLength={80} value={number} onChange={event => {
              setPoPreflight(null); setConfirmDuplicateNumber(false); setDuplicateNumberJustification(""); setNumber(event.target.value);
            }} /></label>
            <label>Fornecedor<SearchableSelect ariaLabel="Fornecedor" required disabled={Boolean(purchaseRequestId)} value={supplier}
              onChange={value => { setPoPreflight(null); setSupplier(value); }} options={suppliers.map(item => ({ value: item.code, label: `${item.code} · ${item.name}` }))} />
              {purchaseRequestId ? <small className="po-field-hint">Preenchido pela SC vinculada.</small> : null}</label>
            <label>Data da PO<input type="text" value="Automática ao salvar" readOnly aria-readonly="true" /></label>
          </div>
          <label>Observações do pedido<textarea maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
          <h3>Dados compartilhados por todos os produtos</h3>
          <OperationalFieldsEditor fields={purchaseOrderCommonItemFields} values={commonItemFields}
            options={options} setValues={setCommonItemFields} />
        </section>

        <section className="card po-entry-section">
          <div className="po-entry-heading">
            <div><h2>Produtos e quantidades</h2><p className="muted">Adicione uma linha para cada produto da PO.</p></div>
            <button className="button secondary" type="button" onClick={() => setItems(current => [...current, blankPoItem()])}>Adicionar produto</button>
          </div>
          <div className="totvs-po-import">
            <div><h3>Importar produtos de planilha TOTVS</h3>
              <p className="muted">Lê o cabeçalho e os itens do export TOTVS Pedido de Compras. O preço vem de Valor Total ÷ Quantidade.</p>
            </div>
            <label>Arquivo Excel (.xlsx)<input className="file-upload-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={totvsParsing || saving || Boolean(createdPoId)} onChange={event => void selectTotvsProductFile(event)} /></label>
            {totvsParsing && <p role="status">Lendo a planilha…</p>}
            {totvsFileError && <p className="notice error" role="alert">{totvsFileError}</p>}
            {draftStorageWarning && <p className="notice" role="status">{draftStorageWarning}</p>}
            {totvsRows.length > 0 && !totvsFileError && <>
              <div className="notice" role="status">
                <p>{totvsFileName}: {totvsRows.length} produtos válidos.</p>
                <p>PO {totvsHeader?.number || "—"} · CNPJ {totvsHeader?.importerCnpj || "—"} · Importadora {importer || "selecione uma correspondência"}</p>
                {totvsImporterMatches.length === 0 && <p role="alert">O CNPJ da planilha não corresponde a uma importadora cadastrada com CNPJ.</p>}
                {totvsImporterMatches.length > 1 && <p role="alert">O CNPJ corresponde a mais de uma importadora. Selecione a correta acima.</p>}
                {totvsHeader && <p>Fornecedor {totvsHeader.supplierCode} · {totvsHeader.supplierName}
                  {totvsSupplierOption ? ` · Catálogo: ${totvsSupplierOption.name}` : importer ? " · Fornecedor não encontrado no catálogo global" : ""}</p>}
                {totvsHeader && supplier && normalizeLookup(supplier) !== normalizeLookup(totvsHeader.supplierCode)
                  && <p role="alert">Selecione o código {totvsHeader.supplierCode} do fornecedor informado na planilha.</p>}
                {totvsSupplierNameDiverges && <p>Confira a razão social: ela difere do nome do fornecedor no catálogo.</p>}
                {totvsHeader?.scNumber && <p>Nro.SC {totvsHeader.scNumber}
                  {totvsScClassification.kind === "match"
                    ? purchaseRequestId === totvsScClassification.request.id
                      ? " · SC existente vinculada automaticamente. Você pode removê-la no seletor de SC."
                      : " · SC existente encontrada; o vínculo foi removido no seletor de SC."
                    : totvsScClassification.kind === "missing"
                      ? " · SC não cadastrada para esta importadora e fornecedor."
                      : ""}</p>}
                {totvsScClassification.kind === "supplier-mismatch" && <p className="notice error" role="alert">
                  A SC {totvsScClassification.request.scNumber} já existe para o fornecedor {totvsScClassification.request.supplierText ?? "não informado"}.
                  O salvamento da PO está bloqueado.
                </p>}
                {totvsScClassification.kind === "missing" && !purchaseRequestId && totvsImporterResolved && <div className="notice totvs-sc-create">
                  <h3>Criar SC {totvsScClassification.scNumber} junto com a PO</h3>
                  <p>Importadora, número e fornecedor vêm da planilha TOTVS.</p>
                  <div className="operational-fields">
                    <label>Importadora<input readOnly aria-readonly="true" value={importer} /></label>
                    <label>Número da SC<input readOnly aria-readonly="true" value={totvsScClassification.scNumber} /></label>
                    <label>Fornecedor<input readOnly aria-readonly="true" value={totvsHeader?.supplierCode ?? ""} /></label>
                    <label>Solicitante<OperationalOptionSelect required entity="requester" value={newScRequester} values={options}
                      onChange={setNewScRequester} /></label>
                    <label>Data da SC<input type="date" value={newScDate} onChange={event => setNewScDate(event.target.value)} /></label>
                    <label>Data de aprovação<input type="date" value={newScApprovalDate}
                      onChange={event => setNewScApprovalDate(event.target.value)} /></label>
                    <label>Recebimento do plano comercial<input type="date" value={newScCommercialPlanReceivedDate}
                      onChange={event => setNewScCommercialPlanReceivedDate(event.target.value)} /></label>
                  </div>
                </div>}
                {selectedScConflictsWithTotvs && <p role="alert">A SC selecionada tem importadora ou fornecedor diferente dos informados na planilha.</p>}
                <p>Totais {totvsCurrency}: planilha {formatNumber(totvsSpreadsheetTotal)} · calculado {formatNumber(totvsCalculatedTotal)}</p>
                <label>Moeda da PO<OperationalOptionSelect entity="currency" value={totvsCurrency} values={options}
                  onChange={setTotvsCurrency} required /></label>
              </div>
              <details className="totvs-import-details">
                <summary>Conferir os {totvsRows.length} produtos mapeados</summary>
                <div className="totvs-import-table-wrap"><table className="totvs-import-table">
                  <thead><tr><th>Item</th><th>Produto</th><th>Descrição TOTVS</th><th>Quantidade</th><th>UM</th><th>Preço {totvsCurrency}</th><th>Valor Total</th><th>Referência / estimativa</th><th>CC</th><th>Pendência</th></tr></thead>
                  <tbody>{totvsRows.map(row => {
                    const product = products.find(choice => normalizeLookup(choice.code) === normalizeLookup(row.productCode));
                    const reference = productPriceReferenceForCurrency(product?.referencePrices, totvsCurrency);
                    const estimate = Number(row.unitPrice) === 0 ? estimatedProductTotal(row.orderedQuantity, reference) : null;
                    const catalogDescription = product?.latestTotvsDescription?.trim() || product?.name;
                    const pending = [
                      !row.totalWithinTolerance ? "Preço calculado difere do Valor Total em mais de 0,01." : "",
                      totvsMissingProducts.includes(row) ? "Produto fora do catálogo global ativo." : "",
                      totvsMissingUnits.includes(row) ? "UM fora dos valores operacionais." : "",
                      totvsMissingCostCenters.includes(row) ? "CC fora dos valores operacionais." : "",
                      catalogDescription && normalizeLookup(catalogDescription) !== normalizeLookup(row.description)
                        ? "Descrição TOTVS difere da descrição disponível no catálogo; confira." : "",
                      Number(row.unitPrice) === 0 && !reference ? "Sem preço real conhecido nesta moeda." : "",
                    ].filter(Boolean).join(" ");
                    return <tr key={row.sourceRow}>
                    <td>{row.externalLineReference}</td><td>{row.productCode}</td><td>{row.description}</td>
                    <td>{formatNumber(row.orderedQuantity)}</td><td>{row.unit}</td><td>{formatNumber(row.unitPrice)} {totvsCurrency}</td>
                    <td>{formatNumber(row.spreadsheetLineTotal)} {totvsCurrency}</td>
                    <td>{Number(row.unitPrice) === 0 ? reference
                      ? <>Preço de referência: {formatNumber(reference.unitPrice)} {reference.currency} (PO {reference.purchaseOrderNumber}, {formatUsDate(reference.observedAt)})
                        {estimate !== null && <> · Valor estimado: {formatNumber(estimate)} {reference.currency}</>}</>
                      : "Sem preço real conhecido" : "—"}</td>
                    <td>{row.costCenter}</td><td>{pending || "—"}</td>
                    </tr>;
                  })}</tbody>
                </table></div>
              </details>
              <div className="totvs-import-actions">
                <button className="button" type="button" disabled={!totvsImportReady || totvsApplied || saving || Boolean(createdPoId)}
                  onClick={() => applyTotvsProducts("replace")}>Substituir itens atuais</button>
                <button className="button secondary" type="button" disabled={!totvsImportReady || totvsApplied || saving || Boolean(createdPoId)}
                  onClick={() => applyTotvsProducts("append")}>Adicionar ao formulário</button>
              </div>
              {totvsApplied && <p className="muted" role="status">Os produtos foram preenchidos no formulário; confira os itens antes de salvar a PO.</p>}
              {totvsApplied && !totvsImportReady && <p className="notice" role="status">Resolva as pendências da planilha antes de salvar a PO.</p>}
            </>}
          </div>
          {catalogLoading && <p role="status">Carregando produtos e fornecedores…</p>}
          {compactPoItems && <div className="totvs-import-table-wrap"><table className="totvs-import-table">
            <thead><tr><th>Item</th><th>Produto</th><th>Descrição</th><th>Quantidade</th><th>Preço</th><th>Valor total</th><th>Ação</th></tr></thead>
            <tbody>{items.map((item, index) => <tr key={item.draftId}>
              <td>{item.externalLineReference || index + 1}</td><td>{item.productCode || "—"}</td><td>{item.description || "—"}</td>
              <td>{formatNumber(item.orderedQuantity)} {item.unit}</td><td>{formatNumber(item.unitPrice)} {item.currency}</td>
              <td>{formatNumber(String(Number(item.orderedQuantity.replace(",", ".")) * Number(item.unitPrice.replace(",", "."))))} {item.currency}</td>
              <td><button className="button secondary" type="button" onClick={() => setTotvsItemEditing(item.draftId)}>Editar</button></td>
            </tr>)}</tbody>
          </table></div>}
          {items.map((item, index) => {
            if (compactPoItems && item.draftId !== totvsItemEditing) return null;
            const product = products.find(choice => normalizeLookup(choice.code) === normalizeLookup(item.productCode));
            const reference = productPriceReferenceForCurrency(product?.referencePrices, item.currency);
            const estimate = estimatedProductTotal(item.orderedQuantity, reference);
            return <article className="po-entry-item" key={item.draftId}>
            <div className="po-entry-heading">
              <h3>Produto {index + 1}</h3>
              {compactPoItems && <button className="button secondary" type="button" onClick={() => setTotvsItemEditing(null)}>Fechar edição</button>}
              {items.length > 1 && <button className="button secondary" type="button"
                onClick={() => setItems(current => current.filter((_, itemIndex) => itemIndex !== index))}>Remover</button>}
            </div>
            <div className="operational-fields">
              <label>Linha no TOTVS<input maxLength={80} value={item.externalLineReference}
                onChange={event => updateItem(index, { externalLineReference: event.target.value })} /></label>
              <label>Produto<CatalogProductSelect required value={item.productCode} fallbackName={item.description} products={products}
                onChange={product => updateProductCode(index, product?.code ?? "")} /></label>
              <label>Código do produto<input value={item.productCode} onChange={event => updateProductCode(index, event.target.value)} /></label>
              <label>Descrição<input value={item.description} onChange={event => updateItem(index, { description: event.target.value })}
                placeholder="Sugerida pelo catálogo e editável" /></label>
              <label>Quantidade pedida<input required inputMode="decimal" value={item.orderedQuantity}
                onChange={event => updateItem(index, { orderedQuantity: event.target.value })} placeholder="Ex.: 100 ou 100,5" /></label>
              <label>Unidade<OperationalOptionSelect required entity="unit_of_measure" value={item.unit} values={options}
                onChange={unit => updateItem(index, { unit })} /></label>
              <label>Preço unitário<input inputMode="decimal" value={item.unitPrice}
                onChange={event => updateItem(index, { unitPrice: event.target.value })} /></label>
              <label>Moeda do preço<OperationalOptionSelect entity="currency" value={item.currency} values={options}
                onChange={currency => updateItem(index, { currency })} /></label>
            </div>
            {reference && <p className="muted">Preço de referência: {formatNumber(reference.unitPrice)} {reference.currency}
              (PO {reference.purchaseOrderNumber}, {formatUsDate(reference.observedAt)})
              {estimate !== null && <> · Valor estimado: {formatNumber(estimate)} {reference.currency}</>}</p>}
            <h4>Planejamento e acompanhamento deste produto</h4>
            <OperationalFieldsEditor fields={specificItemFields} values={item.operational} options={options}
              setValues={operational => updateItem(index, { operational })} />
            <PurchaseOrderCalculatedFields quantity={item.orderedQuantity} unitPrice={item.unitPrice} currency={item.currency} />
          </article>;
          })}
        </section>

        <section className="card po-entry-section">
          <h2>Confirmação</h2>
          {createdPoId && <p className="notice error">A PO já foi criada. <Link className="text-link" href={`/purchase-orders/${createdPoId}`}>Abrir a PO e continuar o preenchimento</Link>.</p>}
          {poNumberBlockMessage && <p className="notice error" role="alert">{poNumberBlockMessage}</p>}
          {poPreflight?.sameImporterDeletedPurchaseOrder && <DeletedPurchaseOrderActions
            purchaseOrder={poPreflight.sameImporterDeletedPurchaseOrder} canManageLifecycle={canManagePoLifecycle}
            replacePayload={poReplacePayload} purchaseRequest={totvsScPayload.choice}
            purchaseRequestBlocker={totvsScPayload.blocker} />}
          {poPreflight && (!poPreflight.importerAcceptsNewPurchaseOrders || !poPreflight.supplierFound
            || poPreflight.missingProducts.length > 0 || poPreflight.missingUnits.length > 0 || poPreflight.missingCostCenters.length > 0)
            && <p className="notice error" role="alert">A pré-validação encontrou pendências no CNPJ, fornecedor, produto, UM ou centro de custo. Corrija os itens e tente novamente.</p>}
          {poPreflight && poPreflight.otherImporterDuplicates.length > 0 && <div className="notice">
            <p>O número {number} já existe nas importadoras: {poPreflight.otherImporterDuplicates.join(", ")}.</p>
            <label><input type="checkbox" checked={confirmDuplicateNumber}
              onChange={event => setConfirmDuplicateNumber(event.target.checked)} />Confirmo a criação desta PO com o mesmo número.</label>
            <label>Justificativa<input required minLength={3} maxLength={1000} value={duplicateNumberJustification}
              onChange={event => setDuplicateNumberJustification(event.target.value)} /></label>
          </div>}
          <button className="button" disabled={saving || !importer || Boolean(createdPoId)
            || (totvsApplied && !totvsImportReady) || poPreflightBlocksSave
            || totvsScPayload.blocker !== null}>
            {saving ? "Salvando pedido e produtos…" : "Salvar PO e produtos"}
          </button>
        </section>
      </> : <section className="card ip-entry-section">
        <div className="totvs-po-import">
          <h2>{reviewInvoiceId ? "Revisar invoice" : "Importar invoice da China"}</h2>
          <p className="muted">Use a aba INV. O sistema confere as POs da importadora, relaciona os itens pelo código e distribui as quantidades antes de criar o IP.</p>
          <label>Invoice (.xlsx)<input className="file-upload-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={invoiceLoading || saving || Boolean(reviewInvoiceId && !reviewTarget)} onChange={event => void selectChinaInvoice(event)} /></label>
          {invoiceLoading && <p role="status">Lendo INV e conferindo as POs cadastradas, sem limitar pela idade do pedido…</p>}
          {invoiceDraft && <>
            <p className="notice invoice-summary" role="status">{invoiceDraft.fileName}: {invoiceDraft.lines.length} linhas, {invoiceMatches.length} destinos, {formatNumber(invoiceDraft.totalQuantity)} unidades, {formatNumber(invoiceDraft.totalAmount)} CNY.</p>
              <p className="muted invoice-importer">CNPJ do importador: {invoiceDraft.importerCnpj || "não identificado"} → {importer || "sem correspondência no cadastro"}.</p>
            {invoiceDuplicate && <p className="notice" role="alert">
               {invoiceDuplicate.recordStatus === "DRAFT"
                 ? `O IP REF ${invoiceDraft.ipNumber} já existe como rascunho. Esta carga preencherá esse cadastro e aplicará as distribuições revisadas.`
                 : `O IP REF ${invoiceDraft.ipNumber} já existe. Ao confirmar, será criada uma revisão e as distribuições ativas anteriores serão substituídas.`}
            </p>}
            {duplicateInvoiceIps.length > 0 && <div className="notice error" role="alert">
              <p>Esta invoice já está associada aos IPs ativos: {duplicateInvoiceIps.join(", ")}.</p>
              <label><input type="checkbox" checked={confirmDuplicateInvoice}
                onChange={event => setConfirmDuplicateInvoice(event.target.checked)} />Confirmo a duplicidade desta invoice.</label>
            </div>}
            {ipReferenceOtherImporter && <p className="notice error" role="alert">
              O IP REF da invoice já pertence a outra importadora. Confira o número antes de continuar.
            </p>}
            {importerCnpjMismatch && <div className="notice error" role="alert">
              <p>O CNPJ da invoice ({invoiceDraft.importerCnpj || "não identificado"}) diverge do CNPJ cadastrado para {importer} ({importerCnpjs[importer] || "não cadastrado"}).</p>
              <label><input type="checkbox" checked={confirmImporterCnpjMismatch}
                onChange={event => setConfirmImporterCnpjMismatch(event.target.checked)} />Confirmo a importadora selecionada apesar da divergencia de CNPJ.</label>
            </div>}
            <div className="operational-fields invoice-header-fields">
              <label>Número da invoice<input required maxLength={120} value={invoiceDraft.invoiceNumber}
                onChange={event => { setDuplicateInvoiceIps([]); setConfirmDuplicateInvoice(false);
                  setInvoiceDraft(current => current ? { ...current, invoiceNumber: event.target.value } : current); }} /></label>
              <label>Data da invoice<input required type="date" value={/^\d{4}-\d{2}-\d{2}$/u.test(invoiceDraft.invoiceDate) ? invoiceDraft.invoiceDate : ""}
                onChange={event => setInvoiceDraft(current => current ? { ...current, invoiceDate: event.target.value } : current)} /></label>
              <label>Total da invoice (CNY)<input required inputMode="decimal" value={invoiceDraft.totalAmount}
                onChange={event => setInvoiceDraft(current => current ? { ...current, totalAmount: event.target.value.replace(",", ".") } : current)} /></label>
            </div>
            <p className="muted">A PO informada em cada linha da INV determina o destino. O sistema sugere o produto cadastrado nessa PO; divergências de código exigem confirmação e podem ser ajustadas manualmente dentro da própria PO. A quantidade original da PO permanece registrada.</p>
            {invoiceDraft.warnings.map(warning => <p className="notice" key={warning}>{warning}</p>)}
            {destinationIssues.length > 0 && <div className="notice error" role="alert">
              <p>{destinationIssues.filter(entry => entry.issue?.kind === "PO_NOT_ACTIVE").length} PO(s) inativa(s).</p>
              <p>{destinationIssues.length} destino(s) da invoice precisam de ação antes de gravar:</p>
              <p>{destinationIssues.filter(entry => entry.issue?.kind === "PO_NOT_REGISTERED").length} PO(s) não cadastrada(s),
                {" "}{destinationIssues.filter(entry => entry.issue?.kind === "ITEM_NOT_FOUND").length} item(ns) não encontrado(s),
                {" "}{destinationIssues.filter(entry => entry.issue?.kind === "INSUFFICIENT_BALANCE").length} saldo(s) insuficiente(s).</p>
            </div>}
            <div className="totvs-import-actions"><button className="button secondary" type="button" disabled={invoiceLoading || !importer}
              onClick={() => void revalidateInvoiceMatches()}>Revalidar POs e saldos</button></div>
            <div className="totvs-import-table-wrap invoice-match-table-wrap"><table className="totvs-import-table invoice-match-table">
              <thead><tr><th>Linha / PO da INV</th><th>Produto da INV</th><th>Quantidade destinada</th><th>Produto cadastrado na PO indicada</th></tr></thead>
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
                  <td>{match.sourceRow}<small>INV: PO {match.sourcePoNumber || "?"}</small></td>
                  <td>{match.productCode}<small>{match.description}</small></td>
                  <td><input aria-label={`Quantidade destinada da linha ${match.sourceRow}`} inputMode="decimal" value={match.quantity}
                    onChange={event => setInvoiceMatches(current => current.map(item => item.key === match.key
                      ? { ...item, quantity: event.target.value.replace(",", "."), itemId: "", updateProduct: false,
                        updatePoItem: false, confirmCodeMismatch: false, confirmSupplierMismatch: false,
                        confirmUnitMismatch: false, confirmPriceMismatch: false } : item))} />
                    <small>{formatNumber(String(allocated))} / {formatNumber(sourceLine?.quantity ?? "0")} {sourceLine?.unit}</small>
                    {!balanced && <small className="notice error">A soma distribuída difere da quantidade da invoice.</small>}
                  </td>
                  <td><SearchableSelect ariaLabel={`Item da invoice ${match.sourceRow}`} required value={match.itemId}
                    placeholder="Selecione PO e item" searchPlaceholder="Buscar PO, código ou item"
                    onChange={selectedId => setInvoiceMatches(current => current.map(item => {
                      if (item.key !== match.key) return item;
                      const candidate = item.candidates.find(value => value.id === selectedId);
                      return { ...item, itemId: selectedId, poNumber: candidate?.poNumber ?? "",
                        updateProduct: false, updatePoItem: false, confirmCodeMismatch: false, confirmSupplierMismatch: false,
                        confirmUnitMismatch: false, confirmPriceMismatch: false };
                    }))} options={match.candidates.map(candidate => ({ value: candidate.id,
                      label: `PO ${candidate.poNumber} | ${candidate.productCode} | linha ${candidate.lineNumber} | saldo ${formatNumber(candidate.remainingQuantity)} ${candidate.unit ?? ""}`,
                      searchText: candidate.description,
                      disabled: Number(candidate.remainingQuantity) < Number(match.quantity) }))} />
                    {destinationIssue && <div className="notice error" role="alert">
                      <p>Linha {match.sourceRow}, PO {match.sourcePoNumber}: {destinationIssue.kind === "PO_NOT_REGISTERED"
                        ? "PO não cadastrada." : destinationIssue.kind === "ITEM_NOT_FOUND"
                          ? `Item/produto ${match.productCode} não encontrado na PO.`
                          : destinationIssue.kind === "PO_NOT_ACTIVE"
                            ? `PO ${destinationIssue.status === "CLOSED" ? "encerrada" : destinationIssue.status === "CANCELLED" ? "cancelada" : "excluída"}; não pode receber a invoice.`
                            : `Saldo insuficiente: quantidade pedida ${formatNumber(destinationIssue.requested)}, disponível ${formatNumber(destinationIssue.available)}.`}</p>
                      {match.poId ? <Link href={`/purchase-orders/${match.poId}`} target="_blank" rel="noopener noreferrer">Abrir PO para ajustar</Link>
                        : <Link href="/purchase-orders/new" target="_blank" rel="noopener noreferrer">Cadastrar PO em nova aba</Link>}
                    </div>}
                    {selectedCandidate && <small>{selectedCandidate.description}</small>}
                    {codeMismatch && selectedCandidate && <div className="notice error" role="alert">
                      <p>Código divergente: invoice {match.productCode}; produto da PO {selectedCandidate.productCode}. A distribuição usará o produto da PO indicada e manterá o código original da invoice.</p>
                      <label><input type="checkbox" checked={match.confirmCodeMismatch}
                        onChange={event => setInvoiceMatches(current => current.map(item => item.key === match.key
                          ? { ...item, confirmCodeMismatch: event.target.checked } : item))} />Confirmo esta divergencia e aprovo a distribuicao.</label>
                    </div>}
                    {selectedCandidate && !supplierMatchesExporter(selectedCandidate, invoiceDraft.exporterText) && <div className="notice error" role="alert">
                      <p>Fornecedor divergente: PO {selectedCandidate.poNumber} — {[selectedCandidate.supplierName, selectedCandidate.supplierText, selectedCandidate.supplierCode].filter(Boolean).join(" · ") || "sem fornecedor cadastrado"}; Exporter da invoice — {invoiceDraft.exporterText}. Os dois valores serão preservados.</p>
                      <label><input type="checkbox" checked={match.confirmSupplierMismatch}
                        onChange={event => setInvoiceMatches(current => current.map(item => item.key === match.key
                          ? { ...item, confirmSupplierMismatch: event.target.checked } : item))} />Confirmo a divergencia de fornecedor e aprovo a distribuicao.</label>
                    </div>}
                    {unitMismatch && selectedCandidate && sourceLine && <div className="notice error" role="alert">
                      <p>Unidade divergente: invoice {sourceLine.unit}; item da PO {selectedCandidate.unit}.</p>
                      <label><input type="checkbox" checked={match.confirmUnitMismatch}
                        onChange={event => setInvoiceMatches(current => current.map(item => item.key === match.key
                          ? { ...item, confirmUnitMismatch: event.target.checked } : item))} />Confirmo a divergência de unidade deste destino.</label>
                    </div>}
                    {priceMismatch && selectedCandidate && sourceLine && <div className="notice error" role="alert">
                      <p>Preço divergente: invoice {sourceLine.unitPrice} CNY; item da PO {selectedCandidate.unitPrice} CNY.</p>
                      <label><input type="checkbox" checked={match.confirmPriceMismatch}
                        onChange={event => setInvoiceMatches(current => current.map(item => item.key === match.key
                          ? { ...item, confirmPriceMismatch: event.target.checked } : item))} />Confirmo a divergência de preço deste destino.</label>
                    </div>}
                    {selectedCandidate && selectedCandidate.currency && selectedCandidate.currency !== "CNY"
                      && <p className="notice">Preço da PO em {selectedCandidate.currency}: a comparação com CNY requer análise manual.</p>}
                    {match.itemId && <details><summary>Comparar invoice e cadastros</summary>
                      {(() => {
                        const candidate = match.candidates.find(value => value.id === match.itemId);
                        return candidate ? <>
                          <p>Cadastro do produto: {candidate.productName ?? "não cadastrado"} | NCM {candidate.productNcmCode ?? "—"} | {candidate.manufacturer ?? "fabricante não cadastrado"}</p>
                          <p>Invoice: {sourceLine?.description} | NCM {sourceLine?.ncm || "—"} | {sourceLine?.manufacturer || "fabricante não informado"}</p>
                          <p>Item da PO: {candidate.description} | unidade {candidate.unit} | NCM {candidate.poNcmCode ?? "—"} | {candidate.unitPrice ?? "—"} {candidate.currency ?? ""}</p>
                          <p>Linha da invoice: {sourceLine?.unitPrice} CNY por {sourceLine?.unit} | NCM {sourceLine?.ncm || "—"}</p>
                        </> : null;
                      })()}
                    </details>}
                    {match.itemId && <div className="operational-fields">
                      <label><input type="checkbox" disabled={!match.candidates.find(candidate => candidate.id === match.itemId)?.productId}
                        checked={match.updateProduct} onChange={event => setInvoiceMatches(current => current.map(item => item.key === match.key
                          ? { ...item, updateProduct: event.target.checked } : item))} />Atualizar cadastro do produto</label>
                      <label><input type="checkbox" checked={match.updatePoItem} onChange={event => setInvoiceMatches(current => current.map(item => item.key === match.key
                        ? { ...item, updatePoItem: event.target.checked } : item))} />Atualizar este item da PO</label>
                    </div>}
                  </td>
                </tr>;
              })}</tbody>
            </table></div>
            {invoiceExistingProcess && <section className="notice" aria-label="Resumo antes e depois da invoice">
              <h3>Resumo antes × depois</h3>
              <p>Antes: {invoiceExistingProcess.operationalAllocations.length} distribuições ativas em {invoiceExistingProcess.purchaseOrders.length} POs vinculadas.</p>
              {invoiceExistingProcess.operationalAllocations.map(allocation =>
                <p key={allocation.id}>Antes · PO {allocation.poNumber} · {allocation.productCode} · {formatNumber(allocation.quantity)} {allocation.unit}</p>)}
              <p>Depois: {invoiceMatches.length} destinos da invoice.</p>
              {invoiceMatches.map(match => {
                const candidate = match.candidates.find(item => item.id === match.itemId);
                return <p key={match.key}>Depois · linha {match.sourceRow} · PO {candidate?.poNumber ?? match.sourcePoNumber}
                  · {candidate?.productCode ?? "item pendente"} · {formatNumber(match.quantity)}</p>;
              })}
              {orphanPos.map(order => <fieldset key={order.id}>
                <legend>PO {order.number} ficará sem alocação nesta invoice</legend>
                <label><input type="radio" name={`orphan-${order.id}`} checked={orphanPoDecisions[order.id] === "KEEP"}
                  onChange={() => setOrphanPoDecisions(current => ({ ...current, [order.id]: "KEEP" }))} />Manter vínculo sem alocação</label>
                <label><input type="radio" name={`orphan-${order.id}`} checked={orphanPoDecisions[order.id] === "REMOVE"}
                  onChange={() => setOrphanPoDecisions(current => ({ ...current, [order.id]: "REMOVE" }))} />Remover vínculo</label>
              </fieldset>)}
            </section>}
            <button className="button secondary" type="button" disabled={saving} onClick={() => {
              clearInvoiceCommandKey(sessionStorage);
              setInvoiceDraft(null); setInvoiceMatches([]); setInvoiceDuplicate(null);
              setDuplicateInvoiceIps([]); setConfirmDuplicateInvoice(false); setIpReferenceOtherImporter(false);
              setInvoiceExistingProcess(null); setOrphanPoDecisions({}); setInvoiceError("");
            }}>Remover invoice e continuar manualmente</button>
          </>}
          {invoiceError && <p className="notice error" role="alert">{invoiceError}</p>}
        </div>
        <div className="ip-entry-grid invoice-ip-fields">
        {invoiceDraft ? <label>Fornecedor (Exporter da invoice)<input readOnly value={invoiceDraft.exporterText} /></label> :
          <label>Supplier<SearchableSelect ariaLabel="Fornecedor" required value={supplier} onChange={setSupplier}
            options={suppliers.map(item => ({ value: item.code, label: `${item.code} · ${item.name}` }))} /></label>}
        <label>Importadora<SearchableSelect ariaLabel="Importadora" required disabled={Boolean(reviewInvoiceId)} value={importer} onChange={value => {
          setImporter(value); setConfirmImporterCnpjMismatch(false); setInvoiceDuplicate(null); setInvoiceError("");
          setDuplicateInvoiceIps([]); setConfirmDuplicateInvoice(false); setIpReferenceOtherImporter(false);
          setInvoiceMatches(current => current.map(match => ({ ...match, itemId: "", candidates: [],
            updateProduct: false, updatePoItem: false, confirmCodeMismatch: false, confirmSupplierMismatch: false,
            confirmUnitMismatch: false, confirmPriceMismatch: false })));
        }} options={importers.map(value => ({ value, label: value }))} /></label>
        <label>IP Reference<input required maxLength={80} readOnly={Boolean(invoiceDraft || reviewInvoiceId)}
          value={invoiceDraft?.ipNumber ?? number} onChange={event => setNumber(event.target.value)} /></label>
        {invoiceDraft ? <label>Logistics status<input readOnly value="WAITING SHIPMENT" /></label> :
          <label>Logistics status<OperationalOptionSelect entity="logistics_status" value={status} values={options} onChange={setStatus} /></label>}
        <label>Prioridade<OperationalOptionSelect entity="priority" value={priority} values={options}
          onChange={setPriority} /></label>
        <label>Observações<textarea maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
        </div>
        <button className="button" disabled={saving || invoiceLoading || !importer || Boolean(invoiceDraft && (invoiceError
          || invoiceMatches.some(match => !match.itemId || !Number(match.quantity)
            || Number(match.quantity) > Number(match.candidates.find(candidate => candidate.id === match.itemId)?.remainingQuantity ?? 0))
          || invoiceHasUnconfirmedCodeMismatch || invoiceHasUnconfirmedSupplierMismatch
          || invoiceHasUnconfirmedUnitMismatch || invoiceHasUnconfirmedPriceMismatch
          || ipReferenceOtherImporter || (duplicateInvoiceIps.length > 0 && !confirmDuplicateInvoice)
          || orphanPos.some(order => !orphanPoDecisions[order.id])
          || (importerCnpjMismatch && !confirmImporterCnpjMismatch)
          || invoiceDraft.lines.some(line => Math.abs(invoiceMatches.filter(match => match.sourceRow === line.sourceRow)
            .reduce((total, match) => total + (Number(match.quantity) || 0), 0) - Number(line.quantity)) > 0.00000001)))}>
          {saving ? "Salvando…" : invoiceDraft ? "Criar IP, distribuir POs e registrar invoice" : "Salvar IP"}</button>
      </section>}
    </form>}
  </main>;
}
