"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, isMissingApiRoute, readApiJson } from "../lib/api";
import { automaticAuditReason } from "../lib/audit";
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
import { ChinaInvoiceDraft, parseChinaInvoiceXlsx } from "../lib/china-invoice-xlsx";

const poRoles = new Set(["Master", "Administrador", "Importação", "Compras"]);
const ipRoles = new Set(["Master", "Administrador", "Importação"]);

type PoItemDraft = {
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
  unit: string; remainingQuantity: string };
type InvoiceMatch = { key: string; sourceRow: number; poNumber: string; quantity: string;
  productCode: string; description: string; itemId: string; candidates: InvoiceItemCandidate[] };

function blankPoItem(): PoItemDraft {
  return { externalLineReference: "", productCode: "", description: "", orderedQuantity: "",
    unit: "", unitPrice: "", currency: "", operational: blankPurchaseOrderItemFields() };
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
    && !hasDraftValue(draft.items);
}

async function readResponse<T>(response: Response): Promise<T> {
  return readApiJson<T>(response);
}

export default function NewOperationalRecord({ kind, returnHref }: { kind: "po" | "ip"; returnHref?: string }) {
  const router = useRouter();
  const [roles, setRoles] = useState<string[]>([]);
  const [importers, setImporters] = useState<string[]>([]);
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
  const [totvsFileError, setTotvsFileError] = useState("");
  const [totvsParsing, setTotvsParsing] = useState(false);
  const [totvsApplied, setTotvsApplied] = useState(false);
  const [commonItemFields, setCommonItemFields] = useState<OperationalFieldDraft>(blankPurchaseOrderItemFields);
  const [createdPoId, setCreatedPoId] = useState("");
  const [invoiceDraft, setInvoiceDraft] = useState<ChinaInvoiceDraft | null>(null);
  const [invoiceMatches, setInvoiceMatches] = useState<InvoiceMatch[]>([]);
  const [invoiceError, setInvoiceError] = useState("");
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
          setItems(draft.items);
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
    sessionStorage.setItem(poDraftKey, JSON.stringify(draft));
  }, [kind, draftReady, importer, number, supplier, notes, items, commonItemFields, purchaseRequestId, createdPoId]);

  useEffect(() => {
    Promise.all([apiFetch("/auth/me"), apiFetch("/api/v1/importers", { cache: "no-store" }), loadOperationalCatalog()])
      .then(async ([identity, list, operationalCatalog]) => {
        if (!identity.ok || !list.ok) throw new Error("Não foi possível consultar suas permissões e importadoras.");
        const user = await identity.json() as { roles: string[] };
        const data = await list.json() as { items: Array<{ code: string }> };
        setRoles(user.roles);
        setOptions(operationalCatalog.items);
        setSupportsGroup(operationalCatalog.purchaseOrderGroup);
        setImporters(data.items.map(item => item.code));
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : "Erro inesperado."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!importer || kind !== "po") { setSuppliers([]); setProducts([]); return; }
    let active = true;
    setCatalogLoading(true);
    Promise.all([loadCatalogChoices("suppliers", importer), loadCatalogChoices("products", importer)])
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

  function updateItem(index: number, change: Partial<PoItemDraft>) {
    setItems(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...change } : item));
  }

  async function selectTotvsProductFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setTotvsFileName(file.name); setTotvsRows([]); setTotvsFileError(""); setTotvsApplied(false); setTotvsParsing(true);
    try { setTotvsRows(await parseTotvsPoXlsx(file)); }
    catch (cause) { setTotvsFileError(cause instanceof Error ? cause.message : "Não foi possível ler a planilha."); }
    finally { setTotvsParsing(false); }
  }

  async function selectChinaInvoice(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
    if (!file) return;
    if (!importer) { setInvoiceError("Selecione a importadora do IP antes de carregar a invoice."); return; }
    setInvoiceError(""); setInvoiceDraft(null); setInvoiceMatches([]); setInvoiceLoading(true);
    try {
      const draft = await parseChinaInvoiceXlsx(file);
      setInvoiceDraft(draft);
      const lineIssues = draft.lines.flatMap(line => line.issues.map(issue => `Linha ${line.sourceRow}: ${issue}`));
      if (lineIssues.length) { setInvoiceError(lineIssues.join(" ")); return; }
      const normalized = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/gu, "").replace(/^PO/u, "");
      const assignments = draft.lines.flatMap(line => line.poAssignments.map((assignment, index) => ({
        key: `${line.sourceRow}:${index}`, sourceRow: line.sourceRow, poNumber: assignment.poNumber,
        quantity: assignment.quantity, productCode: line.productCode, description: line.description,
      })));
      const poByNumber = new Map<string, Promise<InvoiceItemCandidate[]>>();
      for (const assignment of assignments) {
        const key = normalized(assignment.poNumber);
        if (!poByNumber.has(key)) poByNumber.set(key, (async () => {
          const query = new URLSearchParams({ number: assignment.poNumber, importer, page: "1", pageSize: "200" });
          const response = await apiFetch(`/api/v1/purchase-orders?${query}`, { cache: "no-store" });
          const list = await readResponse<{ items: Array<{ id: string; number: string }> }>(response);
          const records = await Promise.all(list.items.filter(po => normalized(po.number) === key).map(async po => {
            const detail = await readResponse<{ items: InvoiceItemCandidate[] }>(await apiFetch(`/api/v1/purchase-orders/${po.id}/operational`, { cache: "no-store" }));
            return detail.items;
          }));
          return records.flat().filter(item => Number(item.remainingQuantity) > 0);
        })());
      }
      const matches = await Promise.all(assignments.map(async assignment => {
        const candidates = (await poByNumber.get(normalized(assignment.poNumber))!).filter(item => item.productCode === assignment.productCode);
        const qty = Number(assignment.quantity);
        const exact = candidates.filter(item => Number(item.remainingQuantity) >= qty);
        return { ...assignment, candidates, itemId: exact.length === 1 ? exact[0].id : "" };
      }));
      setInvoiceMatches(matches);
      if (matches.some(match => match.candidates.length === 0)) setInvoiceError("Há linhas sem correspondência de PO e código de produto. Confira o cadastro da PO antes de salvar.");
      else if (matches.some(match => !match.itemId)) setInvoiceError("Revise as linhas com mais de uma opção ou saldo insuficiente e selecione o item correto.");
    } catch (cause) { setInvoiceError(cause instanceof Error ? cause.message : "Não foi possível processar a invoice."); }
    finally { setInvoiceLoading(false); }
  }

  async function revalidateInvoiceMatches() {
    setInvoiceLoading(true); setInvoiceError("");
    try {
      const normalized = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/gu, "").replace(/^PO/u, "");
      const byPo = new Map<string, Promise<InvoiceItemCandidate[]>>();
      for (const match of invoiceMatches) {
        const key = normalized(match.poNumber);
        if (!byPo.has(key)) byPo.set(key, (async () => {
          const query = new URLSearchParams({ number: match.poNumber, importer, page: "1", pageSize: "200" });
          const list = await readResponse<{ items: Array<{ id: string; number: string }> }>(await apiFetch(`/api/v1/purchase-orders?${query}`, { cache: "no-store" }));
          const records = await Promise.all(list.items.filter(po => normalized(po.number) === key).map(async po => readResponse<{ items: InvoiceItemCandidate[] }>(
            await apiFetch(`/api/v1/purchase-orders/${po.id}/operational`, { cache: "no-store" }))));
          return records.flatMap(record => record.items).filter(item => Number(item.remainingQuantity) > 0);
        })());
      }
      const refreshed = await Promise.all(invoiceMatches.map(async match => {
        const candidates = (await byPo.get(normalized(match.poNumber))!).filter(item => item.productCode === match.productCode);
        const current = candidates.find(item => item.id === match.itemId && Number(item.remainingQuantity) >= Number(match.quantity));
        const enough = candidates.filter(item => Number(item.remainingQuantity) >= Number(match.quantity));
        return { ...match, candidates, itemId: current?.id ?? (enough.length === 1 ? enough[0].id : "") };
      }));
      setInvoiceMatches(refreshed);
      if (refreshed.some(match => !match.candidates.length)) setInvoiceError("Ainda há linhas sem correspondência para a PO e o código informados.");
      else if (refreshed.some(match => !match.itemId)) setInvoiceError("Selecione o item correto da PO em cada linha pendente.");
    } catch (cause) { setInvoiceError(cause instanceof Error ? cause.message : "Não foi possível conferir novamente as associações."); }
    finally { setInvoiceLoading(false); }
  }

  function applyTotvsProducts(mode: "replace" | "append") {
    const imported = totvsRows.map(row => ({
      externalLineReference: row.externalLineReference,
      productCode: row.productCode,
      description: row.description,
      orderedQuantity: row.orderedQuantity,
      unit: row.unit,
      unitPrice: row.unitPrice,
      currency: row.unitPrice ? "CNY" : "",
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
  }

  function selectPurchaseRequest(id: string) {
    setPurchaseRequestId(id);
    const selected = purchaseRequests.find(choice => choice.id === id);
    if (selected) setImporter(selected.importer);
    setCommonItemFields(current => ({ ...current, ...purchaseRequestOperationalFields(selected) }));
  }

  async function createPurchaseOrder() {
    if (items.length === 0) throw new Error("Adicione ao menos um item à PO.");
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
        ...purchaseOrderItemFieldsPayload(commonItemFields, false, purchaseOrderCommonItemFields),
      },
    }));
    const completePayload = JSON.stringify({ header: { importer, number, purchaseRequestId: purchaseRequestId || null, supplierText: supplier || null,
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
      const created = await readResponse<{ id: string; itemIds: string[] }>(complete);
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
          savedHeader.purchaseRequestId !== (purchaseRequestId || null) ||
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

    const header = await readResponse<{ id: string }>(await apiFetch("/api/v1/purchase-orders", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ importer, number, supplierText: supplier || null,
        orderDate: null, notes, purchaseRequestId: purchaseRequestId || null, reason: automaticAuditReason }),
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
          ...purchaseOrderItemFieldsPayload(commonItemFields, false, purchaseOrderCommonItemFields),
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
        await createPurchaseOrder();
        return;
      }
      if (invoiceDraft) {
        if (invoiceMatches.length === 0 || invoiceMatches.some(match => !match.itemId))
          throw new Error("Revise e selecione o item de PO para todas as linhas da invoice.");
        const payload = {
          process: { importer, ipNumber: number, logisticsStatus: status || null,
            priority: priority || null, notes, reason: automaticAuditReason },
          invoice: { fileName: invoiceDraft.fileName, number: invoiceDraft.invoiceNumber,
            issueDate: /^\d{4}-\d{2}-\d{2}$/u.test(invoiceDraft.invoiceDate) ? invoiceDraft.invoiceDate : null,
            amount: invoiceDraft.totalAmount, currency: "CNY", metadata: {
              invoiceDateText: invoiceDraft.invoiceDate, ipNumberFromInvoice: invoiceDraft.ipNumber,
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
              assignments: invoiceMatches.map(({ sourceRow, poNumber, quantity, productCode, itemId }) =>
                ({ sourceRow, poNumber, quantity, productCode, itemId })),
            } },
          allocations: invoiceMatches.map(match => ({ itemId: match.itemId, quantity: match.quantity,
            notes: `Invoice ${invoiceDraft.invoiceNumber || invoiceDraft.fileName}, linha ${match.sourceRow}` })),
        };
        const result = await readResponse<{ id: string }>(await apiFetch("/api/v1/processes/import-invoice", {
          method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify(payload),
        }));
        router.push(`/processes/${result.id}`);
        return;
      }
      const response = await apiFetch("/api/v1/processes", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ importer, ipNumber: number, logisticsStatus: status || null,
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
            <label>Importadora<select required disabled={Boolean(purchaseRequestId)} value={importer} onChange={event => {
              setImporter(event.target.value); selectPurchaseRequest("");
            }}>
              <option value="">Selecione</option>{importers.map(value => <option key={value} value={value}>{value}</option>)}
            </select>{purchaseRequestId ? <small className="po-field-hint">Definida pela SC vinculada.</small> : null}</label>
            <label>Número da PO no TOTVS<input required maxLength={80} value={number} onChange={event => setNumber(event.target.value)} /></label>
            <label>Fornecedor<select value={supplier} onChange={event => setSupplier(event.target.value)}>
              <option value="">Selecione</option>{suppliers.map(item => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}
            </select></label>
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
              <p className="muted">Lê linha, código, descrição, unidade, quantidade, preço em CNY e centro de custo. A SC já vinculada e os dados de cabeçalho não serão alterados.</p>
            </div>
            <label>Arquivo Excel (.xlsx)<input className="file-upload-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={totvsParsing || saving || Boolean(createdPoId)} onChange={event => void selectTotvsProductFile(event)} /></label>
            {totvsParsing && <p role="status">Lendo a planilha…</p>}
            {totvsFileError && <p className="notice error" role="alert">{totvsFileError}</p>}
            {totvsRows.length > 0 && !totvsFileError && <>
              <p className="notice" role="status">{totvsFileName}: {totvsRows.length} produtos válidos. Preços preenchidos serão registrados em CNY.</p>
              <details className="totvs-import-details">
                <summary>Conferir os {totvsRows.length} produtos mapeados</summary>
                <div className="totvs-import-table-wrap"><table className="totvs-import-table">
                  <thead><tr><th>Linha</th><th>Produto</th><th>Descrição</th><th>Quantidade</th><th>UM</th><th>Preço CNY</th><th>Centro de custo</th></tr></thead>
                  <tbody>{totvsRows.map((row, index) => <tr key={`${row.sourceRow}:${index}`}>
                    <td>{row.externalLineReference || "—"}</td><td>{row.productCode}</td><td>{row.description}</td>
                    <td>{formatNumber(row.orderedQuantity)}</td><td>{row.unit}</td><td>{row.unitPrice ? formatNumber(row.unitPrice) : "—"}</td><td>{row.costCenter || "—"}</td>
                  </tr>)}</tbody>
                </table></div>
              </details>
              <div className="totvs-import-actions">
                <button className="button" type="button" disabled={totvsApplied || saving || Boolean(createdPoId)}
                  onClick={() => applyTotvsProducts("replace")}>Substituir itens atuais</button>
                <button className="button secondary" type="button" disabled={totvsApplied || saving || Boolean(createdPoId)}
                  onClick={() => applyTotvsProducts("append")}>Adicionar ao formulário</button>
              </div>
              {totvsApplied && <p className="muted" role="status">Os produtos foram preenchidos no formulário; confira os itens antes de salvar a PO.</p>}
            </>}
          </div>
          {catalogLoading && <p role="status">Carregando produtos e fornecedores…</p>}
          {items.map((item, index) => <article className="po-entry-item" key={index}>
            <div className="po-entry-heading">
              <h3>Produto {index + 1}</h3>
              {items.length > 1 && <button className="button secondary" type="button"
                onClick={() => setItems(current => current.filter((_, itemIndex) => itemIndex !== index))}>Remover</button>}
            </div>
            <div className="operational-fields">
              <label>Linha no TOTVS<input maxLength={80} value={item.externalLineReference}
                onChange={event => updateItem(index, { externalLineReference: event.target.value })} /></label>
              <label>Produto<CatalogProductSelect required value={item.productCode} fallbackName={item.description} products={products}
                onChange={product => updateItem(index, { productCode: product?.code ?? "", description: product?.name ?? "" })} /></label>
              <label>Código do produto<input readOnly value={item.productCode} placeholder="Preenchido pelo produto selecionado" /></label>
              <label>Descrição<input readOnly value={item.description} placeholder="Preenchida pelo produto selecionado" /></label>
              <label>Quantidade pedida<input required inputMode="decimal" value={item.orderedQuantity}
                onChange={event => updateItem(index, { orderedQuantity: event.target.value })} placeholder="Ex.: 100 ou 100,5" /></label>
              <label>Unidade<OperationalOptionSelect required entity="unit_of_measure" value={item.unit} values={options}
                onChange={unit => updateItem(index, { unit })} /></label>
              <label>Preço unitário<input inputMode="decimal" value={item.unitPrice}
                onChange={event => updateItem(index, { unitPrice: event.target.value })} /></label>
              <label>Moeda do preço<OperationalOptionSelect entity="currency" value={item.currency} values={options}
                onChange={currency => updateItem(index, { currency })} /></label>
            </div>
            <h4>Planejamento e acompanhamento deste produto</h4>
            <OperationalFieldsEditor fields={specificItemFields} values={item.operational} options={options}
              setValues={operational => updateItem(index, { operational })} />
            <PurchaseOrderCalculatedFields quantity={item.orderedQuantity} unitPrice={item.unitPrice} currency={item.currency} />
          </article>)}
        </section>

        <section className="card po-entry-section">
          <h2>Confirmação</h2>
          {createdPoId && <p className="notice error">A PO já foi criada. <Link className="text-link" href={`/purchase-orders/${createdPoId}`}>Abrir a PO e continuar o preenchimento</Link>.</p>}
          <button className="button" disabled={saving || !importer || Boolean(createdPoId)}>
            {saving ? "Salvando pedido e produtos…" : "Salvar PO e produtos"}
          </button>
        </section>
      </> : <section className="card ip-entry-section">
        <div className="totvs-po-import">
          <h2>Importar invoice da China</h2>
          <p className="muted">Use a aba INV. O sistema confere as POs da importadora, relaciona os itens pelo código e distribui as quantidades antes de criar o IP.</p>
          <label>Invoice (.xlsx)<input className="file-upload-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={invoiceLoading || saving} onChange={event => void selectChinaInvoice(event)} /></label>
          {invoiceLoading && <p role="status">Lendo INV e conferindo as POs cadastradas, sem limitar pela idade do pedido…</p>}
          {invoiceDraft && <>
            <p className="notice" role="status">{invoiceDraft.fileName}: {invoiceDraft.lines.length} linhas, {invoiceMatches.length} associações, {formatNumber(invoiceDraft.totalQuantity)} unidades, {formatNumber(invoiceDraft.totalAmount)} CNY.</p>
            <div className="operational-fields">
              <label>Número da invoice<input required maxLength={120} value={invoiceDraft.invoiceNumber}
                onChange={event => setInvoiceDraft(current => current ? { ...current, invoiceNumber: event.target.value } : current)} /></label>
              <label>Data da invoice<input required type="date" value={/^\d{4}-\d{2}-\d{2}$/u.test(invoiceDraft.invoiceDate) ? invoiceDraft.invoiceDate : ""}
                onChange={event => setInvoiceDraft(current => current ? { ...current, invoiceDate: event.target.value } : current)} /></label>
              <label>Total da invoice (CNY)<input required inputMode="decimal" value={invoiceDraft.totalAmount}
                onChange={event => setInvoiceDraft(current => current ? { ...current, totalAmount: event.target.value.replace(",", ".") } : current)} /></label>
            </div>
            <p className="muted">Corrija PO, código ou quantidade nos campos da prévia e use “Revalidar associações” para carregar as linhas e saldos da PO atualizada.</p>
            {invoiceDraft.warnings.map(warning => <p className="notice" key={warning}>{warning}</p>)}
            <div className="totvs-import-actions"><button className="button secondary" type="button" disabled={invoiceLoading || !invoiceMatches.length}
              onClick={() => void revalidateInvoiceMatches()}>Revalidar associações</button></div>
            <div className="totvs-import-table-wrap"><table className="totvs-import-table">
              <thead><tr><th>Linha</th><th>PO</th><th>Produto</th><th>Quantidade</th><th>Item operacional</th></tr></thead>
              <tbody>{invoiceMatches.map(match => <tr key={match.key}>
                <td>{match.sourceRow}</td><td><input aria-label={`PO da linha ${match.sourceRow}`} value={match.poNumber}
                  onChange={event => setInvoiceMatches(current => current.map(item => item.key === match.key ? { ...item, poNumber: event.target.value, itemId: "" } : item))} /></td>
                <td><input aria-label={`Código do produto da linha ${match.sourceRow}`} value={match.productCode}
                  onChange={event => setInvoiceMatches(current => current.map(item => item.key === match.key ? { ...item, productCode: event.target.value, itemId: "" } : item))} />
                  <small>{match.description}</small></td>
                <td><input aria-label={`Quantidade da linha ${match.sourceRow}`} inputMode="decimal" value={match.quantity}
                  onChange={event => setInvoiceMatches(current => current.map(item => item.key === match.key ? { ...item, quantity: event.target.value.replace(",", "."), itemId: "" } : item))} /></td>
                <td><select required value={match.itemId} onChange={event => setInvoiceMatches(current => {
                  const next = current.map(item => item.key === match.key ? { ...item, itemId: event.target.value } : item);
                  if (next.every(item => item.itemId)) setInvoiceError("");
                  return next;
                })}>
                  <option value="">Selecione o item da PO</option>{match.candidates.map(candidate => <option key={candidate.id} value={candidate.id}>
                    Linha {candidate.lineNumber}: {candidate.productCode} · saldo {formatNumber(candidate.remainingQuantity)} {candidate.unit}
                  </option>)}
                </select></td>
              </tr>)}</tbody>
            </table></div>
            <button className="button secondary" type="button" disabled={saving} onClick={() => {
              setInvoiceDraft(null); setInvoiceMatches([]); setInvoiceError("");
            }}>Remover invoice e continuar manualmente</button>
          </>}
          {invoiceError && <p className="notice error" role="alert">{invoiceError}</p>}
        </div>
        <div className="ip-entry-grid">
        <label>Importadora<select required value={importer} onChange={event => setImporter(event.target.value)}>
          <option value="">Selecione</option>{importers.map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <label>Número do IP<input required maxLength={80} value={number} onChange={event => setNumber(event.target.value)} /></label>
        <label>Status logístico<OperationalOptionSelect entity="logistics_status" value={status} values={options} onChange={setStatus} /></label>
        <label>Prioridade<OperationalOptionSelect entity="priority" value={priority} values={options}
          onChange={setPriority} /></label>
        <label>Observações<textarea maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
        </div>
        <button className="button" disabled={saving || !importer || Boolean(invoiceDraft && (invoiceError || invoiceMatches.some(match => !match.itemId)))}>
          {saving ? "Salvando…" : invoiceDraft ? "Criar IP, distribuir POs e registrar invoice" : "Salvar IP"}</button>
      </section>}
    </form>}
  </main>;
}
