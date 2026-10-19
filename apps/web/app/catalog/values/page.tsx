"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { automaticAuditReason } from "../../../lib/audit";
import { createNcmCatalogUrl, createNcmPayload, updateNcmPayload, type NcmDraft } from "../../../lib/catalog-ncms";
import { parseProductCatalogJson, type ProductCatalogImport } from "../../../lib/catalog-products-json";
import { createSupplierCatalogUrl } from "../../../lib/catalog-suppliers";

const entities = [
  ["importer", "Importadora"], ["incoterm", "Incoterm"], ["transport_mode", "Modal"], ["port_loading", "POL / porto de origem"],
  ["port_discharge", "POD / porto de destino"], ["currency", "Moeda"], ["category", "Categoria"],
  ["product_group", "Grupo de produto"], ["group", "Group"], ["purpose", "Finalidade"], ["demand", "Demanda"],
  ["logistics_status", "Status logístico"], ["customs_channel", "Canal aduaneiro"],
  ["container_type", "Tipo de container"], ["priority", "Prioridade"],
  ["unit_of_measure", "Unidade de medida"], ["product", "Produto"], ["ncm", "NCM"],
  ["requester", "Solicitante"], ["cost_center", "Centro de custo"], ["broker", "Despachante"],
  ["forwarder", "Agente de carga"], ["supplier", "Fornecedor"],
] as const;
type Option = { id: string; entity: string; code?: string | null; value: string };
type Supplier = { id: string; code: string; name: string; status: "ACTIVE" | "INACTIVE"; version: string };
type Product = { id: string; importer: string | null; code: string; name: string; status: string; version: string };
type OfficialNcmAttributeDefinition = {
  code: string; name: string; displayName: string; fillType: string | null; multivalued: boolean;
  startsOn: string | null; endsOn: string | null; objectives: string[]; organs: string[];
  conditionalAttributes: Array<{ required: boolean; condition: string | null; attribute: OfficialNcmAttributeDefinition }>;
};
type OfficialNcmAttribute = OfficialNcmAttributeDefinition & { required: true };
type Ncm = { id: string; code: string; name: string; status: "ACTIVE" | "INACTIVE";
  evidence: string; validFrom: string | null; validTo: string | null; version: string;
  mandatoryImportAttributes?: OfficialNcmAttribute[]; sourceUpdatedAt?: string | null;
  attributesSourceVersion?: string | null; officialDataSyncedAt?: string | null };
type OfficialNcmSearchResult = Omit<Ncm, "id" | "status" | "evidence" | "version"> & { alreadyRegistered: boolean };
type NcmSyncStatus = { lastAttemptAt: string | null; lastSuccessAt: string | null;
  lastSource: "SISCOMEX" | "MDIC_GECEX" | null; lastSiscomexSuccessAt: string | null;
  lastError: string | null; nextAttemptAt: string; retryMode: boolean;
  snapshot: { source: string; itemCount: number; syncedAt: string } | null;
  lastSiscomexSnapshot: { itemCount: number; syncedAt: string } | null };
const emptyNcmDraft: NcmDraft = { code: "", description: "", status: "ACTIVE", evidence: "", validFrom: "", validTo: "" };

function formatNcmDate(value: string | null) {
  if (!value) return null;
  const date = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  return date ? `${date[3]}/${date[2]}/${date[1]}` : value;
}

function formatNcmDateTime(value: string | null) {
  return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short",
    timeZone: "America/Sao_Paulo" }).format(new Date(value)) : "ainda não registrado";
}

function NcmValidityDates({ validFrom, validTo }: { validFrom: string | null; validTo: string | null }) {
  const start = formatNcmDate(validFrom);
  const end = formatNcmDate(validTo);
  return <small className="ncm-validity-dates">
    Início da vigência: {start ?? "não informado"} · Fim da vigência: {end ?? "não informado pela fonte oficial"}
  </small>;
}

function NcmConditionalAttributes({ attributes }: { attributes: OfficialNcmAttributeDefinition["conditionalAttributes"] }) {
  if (!attributes.length) return null;
  return <ul className="ncm-conditional-attributes">
    {attributes.map(item => <li key={`${item.attribute.code}-${item.condition}`}>
      <strong>{item.attribute.displayName}</strong> <code>{item.attribute.code}</code>
      <span>{item.condition ? `Obrigatório quando ${item.condition}` : "Obrigatório sob condição Siscomex"}</span>
      <NcmConditionalAttributes attributes={item.attribute.conditionalAttributes} />
    </li>)}
  </ul>;
}

function NcmMandatoryAttributes({ attributes }: { attributes: OfficialNcmAttribute[] }) {
  return <details className="ncm-mandatory-attributes">
    <summary>Atributos obrigatórios na importação · {attributes.length}</summary>
    {attributes.length ? <ul className="ncm-attribute-list">
      {attributes.map(attribute => <li key={attribute.code}>
        <strong>{attribute.displayName}</strong> <code>{attribute.code}</code>
        <span>{[attribute.fillType, ...attribute.objectives].filter(Boolean).join(" · ")}</span>
        {attribute.organs.length > 0 && <span>Órgão(s): {attribute.organs.join(", ")}</span>}
        <NcmConditionalAttributes attributes={attribute.conditionalAttributes} />
      </li>)}
    </ul> : <p className="muted">A fonte oficial não indica atributos obrigatórios para esta NCM.</p>}
  </details>;
}

export default function OperationalValuesPage() {
  const [options, setOptions] = useState<Option[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [suppliersLoading, setSuppliersLoading] = useState(false);
  const [supplierTotalCount, setSupplierTotalCount] = useState(0);
  const [supplierPage, setSupplierPage] = useState(1);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [editingSupplierId, setEditingSupplierId] = useState("");
  const [supplierEditDraft, setSupplierEditDraft] = useState({ code: "", name: "", status: "ACTIVE" as "ACTIVE" | "INACTIVE" });
  const [supplierDraft, setSupplierDraft] = useState({ code: "", name: "", evidence: "" });
  const [supplierRefresh, setSupplierRefresh] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productTotalCount, setProductTotalCount] = useState(0);
  const [productPage, setProductPage] = useState(1);
  const [productSearch, setProductSearch] = useState("");
  const [editingProductId, setEditingProductId] = useState("");
  const [editProductDraft, setEditProductDraft] = useState({ description: "", status: "ACTIVE" });
  const [productDraft, setProductDraft] = useState({ code: "", description: "" });
  const [productJson, setProductJson] = useState<ProductCatalogImport[]>([]);
  const [productJsonFileName, setProductJsonFileName] = useState("");
  const productFileInput = useRef<HTMLInputElement>(null);
  const [productRefresh, setProductRefresh] = useState(0);
  const [ncms, setNcms] = useState<Ncm[]>([]);
  const [ncmLoading, setNcmLoading] = useState(false);
  const [ncmTotalCount, setNcmTotalCount] = useState(0);
  const [ncmPage, setNcmPage] = useState(1);
  const [ncmSearch, setNcmSearch] = useState("");
  const [ncmRefresh, setNcmRefresh] = useState(0);
  const [officialNcmSearchTerm, setOfficialNcmSearchTerm] = useState("");
  const [officialNcmSearch, setOfficialNcmSearch] = useState("");
  const [officialNcmResults, setOfficialNcmResults] = useState<OfficialNcmSearchResult[]>([]);
  const [officialNcmTotalCount, setOfficialNcmTotalCount] = useState(0);
  const [officialNcmSnapshotSyncedAt, setOfficialNcmSnapshotSyncedAt] = useState<string | null>(null);
  const [officialNcmSource, setOfficialNcmSource] = useState<"SISCOMEX" | "MDIC_GECEX" | null>(null);
  const [officialNcmSourceReference, setOfficialNcmSourceReference] = useState<string | null>(null);
  const [officialNcmPage, setOfficialNcmPage] = useState(1);
  const [officialNcmSearchLoading, setOfficialNcmSearchLoading] = useState(false);
  const [ncmSyncStatus, setNcmSyncStatus] = useState<NcmSyncStatus | null>(null);
  const [editingNcmId, setEditingNcmId] = useState("");
  const [ncmDraft, setNcmDraft] = useState<NcmDraft>(emptyNcmDraft);
  const [entity, setEntity] = useState<string>(entities[0][0]);
  const [value, setValue] = useState("");
  const [valueCode, setValueCode] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editValue, setEditValue] = useState("");
  const [jsonValues, setJsonValues] = useState<string[]>([]);
  const [jsonFileName, setJsonFileName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  const [canWriteNcm, setCanWriteNcm] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const [valuesResponse, identityResponse] = await Promise.all([
      apiFetch("/api/v1/operational-values", { cache: "no-store" }), apiFetch("/auth/me"),
    ]);
    const values = await valuesResponse.json() as { items?: Option[]; detail?: string };
    const identity = await identityResponse.json() as { roles?: string[] };
    if (!valuesResponse.ok || !identityResponse.ok) throw new Error(values.detail || "Não foi possível carregar os cadastros.");
    setOptions(values.items ?? []);
    setCanWrite((identity.roles ?? []).some(role => ["Master", "Administrador", "Compras"].includes(role)));
    setCanWriteNcm((identity.roles ?? []).some(role => ["Master", "Administrador", "Fiscal"].includes(role)));
  }, []);

  useEffect(() => { void load().catch(cause => setError(cause instanceof Error ? cause.message : "Erro ao carregar.")); }, [load]);

  useEffect(() => {
    if (entity !== "supplier") return;
    const controller = new AbortController();
    setSuppliersLoading(true);
    apiFetch(createSupplierCatalogUrl(supplierPage, supplierSearch), { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json() as { items?: Supplier[]; totalCount?: number; detail?: string };
        if (!response.ok) throw new Error(data.detail || "Não foi possível carregar os fornecedores.");
        if (!controller.signal.aborted) {
          setSuppliers(data.items ?? []);
          setSupplierTotalCount(data.totalCount ?? 0);
        }
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Erro ao carregar fornecedores."); })
      .finally(() => { if (!controller.signal.aborted) setSuppliersLoading(false); });
    return () => controller.abort();
  }, [entity, supplierPage, supplierRefresh, supplierSearch]);

  useEffect(() => {
    if (entity !== "product") { setProducts([]); return; }
    const controller = new AbortController();
    setProductsLoading(true);
    const query = new URLSearchParams({ page: String(productPage), pageSize: "25" });
    if (productSearch.trim()) query.set("search", productSearch.trim());
    apiFetch("/api/v1/products?" + query, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json() as { items?: Product[]; totalCount?: number; detail?: string };
        if (!response.ok) throw new Error(data.detail || "N\u00e3o foi poss\u00edvel carregar os produtos.");
        return { items: data.items ?? [], totalCount: data.totalCount ?? 0 };
      }).then(data => {
        if (!controller.signal.aborted) {
          setProducts(data.items);
          setProductTotalCount(data.totalCount);
        }
      }).catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Erro ao carregar produtos.");
      }).finally(() => { if (!controller.signal.aborted) setProductsLoading(false); });
    return () => controller.abort();
  }, [entity, productPage, productRefresh, productSearch]);

  useEffect(() => {
    if (entity !== "ncm") { setNcms([]); setNcmTotalCount(0); return; }
    const controller = new AbortController();
    setNcmLoading(true);
    apiFetch(createNcmCatalogUrl(ncmPage, ncmSearch), { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json() as { items?: Ncm[]; totalCount?: number; detail?: string };
        if (!response.ok) throw new Error(data.detail || "Não foi possível carregar os NCMs.");
        return { items: data.items ?? [], totalCount: data.totalCount ?? 0 };
      }).then(data => {
        if (!controller.signal.aborted) {
          setNcms(data.items);
          setNcmTotalCount(data.totalCount);
        }
      }).catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Erro ao carregar NCMs.");
      }).finally(() => { if (!controller.signal.aborted) setNcmLoading(false); });
    return () => controller.abort();
  }, [entity, ncmPage, ncmRefresh, ncmSearch]);

  useEffect(() => {
    if (entity !== "ncm") return;
    let active = true;
    const loadStatus = async () => {
      try {
        const response = await apiFetch("/api/v1/ncms/sync-status", { cache: "no-store" });
        if (response.ok && active) setNcmSyncStatus(await response.json() as NcmSyncStatus);
      } catch { /* The catalog remains usable if status is temporarily unavailable. */ }
    };
    void loadStatus();
    const interval = setInterval(() => { void loadStatus(); }, 60_000);
    return () => { active = false; clearInterval(interval); };
  }, [entity, ncmRefresh]);

  function startEditingNcm(ncm: Ncm) {
    setEditingNcmId(ncm.id);
    setNcmDraft({ code: ncm.code, description: ncm.name, status: ncm.status, evidence: ncm.evidence,
      validFrom: ncm.validFrom ?? "", validTo: ncm.validTo ?? "" });
    setError("");
    setNotice("");
  }

  function cancelEditingNcm() {
    setEditingNcmId("");
    setNcmDraft(emptyNcmDraft);
  }

  async function saveNcmEdit(event: FormEvent<HTMLFormElement>, ncm: Ncm) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch(`/api/v1/ncms/${ncm.id}`, { method: "PATCH",
        headers: { "content-type": "application/json", "X-Record-Version": ncm.version },
        body: JSON.stringify(updateNcmPayload(ncmDraft, automaticAuditReason)) });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "Não foi possível atualizar o NCM.");
      cancelEditingNcm();
      setNcmRefresh(current => current + 1);
      setNotice("NCM atualizado com auditoria.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao atualizar NCM."); }
    finally { setBusy(false); }
  }

  async function addNcm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/ncms", { method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(createNcmPayload(ncmDraft, automaticAuditReason)) });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "Não foi possível cadastrar o NCM.");
      setNcmDraft(emptyNcmDraft);
      setNcmPage(1); setNcmSearch(""); setNcmRefresh(current => current + 1);
      setNotice("NCM cadastrado no catálogo fiscal global.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao cadastrar NCM."); }
    finally { setBusy(false); }
  }

  async function searchOfficialNcms(page = 1, term = officialNcmSearchTerm) {
    const search = term.trim();
    if (search.length < 2) {
      setOfficialNcmSearch(search);
      setOfficialNcmResults([]);
      setOfficialNcmTotalCount(0);
      setOfficialNcmPage(1);
      return;
    }
    setOfficialNcmSearchLoading(true); setError("");
    try {
      const query = new URLSearchParams({ search, page: String(page), pageSize: "25" });
      const response = await apiFetch(`/api/v1/ncms/official-search?${query}`, { cache: "no-store" });
      const result = await response.json() as { items?: OfficialNcmSearchResult[]; totalCount?: number;
        source?: "SISCOMEX" | "MDIC_GECEX"; sourceReference?: string;
        snapshotSyncedAt?: string | null; detail?: string };
      if (!response.ok) throw new Error(result.detail || "Não foi possível pesquisar no catálogo oficial.");
      setOfficialNcmSearch(search);
      setOfficialNcmResults(result.items ?? []);
      setOfficialNcmTotalCount(result.totalCount ?? 0);
      setOfficialNcmSnapshotSyncedAt(result.snapshotSyncedAt ?? null);
      setOfficialNcmSource(result.source ?? null);
      setOfficialNcmSourceReference(result.sourceReference ?? null);
      setOfficialNcmPage(page);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao consultar o catálogo oficial."); }
    finally { setOfficialNcmSearchLoading(false); }
  }

  async function addOfficialNcm(code: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/ncms/import-official", { method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ code }) });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "Não foi possível adicionar o NCM.");
      setNcmPage(1); setNcmRefresh(current => current + 1);
      setNotice(`NCM ${code} adicionado à entidade com a descrição e os atributos oficiais.`);
      await searchOfficialNcms(officialNcmPage, officialNcmSearch);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao adicionar o NCM."); }
    finally { setBusy(false); }
  }

  function prepareOfficialNcm(item: OfficialNcmSearchResult) {
    setNcmDraft({ code: item.code, description: item.name, status: "ACTIVE", validFrom: "", validTo: "",
      evidence: `Descrição oficial do MDIC, Anexo I da Resolução Gecex nº 272/2021 (${officialNcmSourceReference ?? "catálogo vigente"}). Informe a vigência individual e o ato legal correspondente.` });
    setNotice("Código e descrição oficial carregados. Informe a vigência e a evidência do ato legal para concluir o cadastro.");
    document.getElementById("ncm-manual-create")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function refreshRegisteredNcms() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/ncms/refresh-official", { method: "POST",
        headers: { "content-type": "application/json" }, body: "{}" });
      const result = await response.json() as { catalogSource?: "SISCOMEX" | "MDIC_GECEX";
        matchedCount?: number; updatedCount?: number; inactivatedCount?: number;
        attributesUpdatedCount?: number; preservedUnmatchedCount?: number; detail?: string };
      if (!response.ok) throw new Error(result.detail || "Não foi possível atualizar os NCMs cadastrados.");
      setNcmRefresh(current => current + 1);
      setNotice(result.catalogSource === "MDIC_GECEX"
        ? `O Siscomex está indisponível. A base vigente do MDIC permanece disponível para pesquisa; ${result.updatedCount ?? 0} cadastros foram conferidos e ${result.inactivatedCount ?? 0} códigos ausentes da lista completa foram inativados. O sistema tentará novamente consultar o Siscomex automaticamente.`
        : `${result.matchedCount ?? 0} NCMs cadastrados conferidos; ${result.updatedCount ?? 0} cadastros atualizados, ${result.inactivatedCount ?? 0} inativados pela vigência ou ausência na tabela oficial, e ${result.attributesUpdatedCount ?? 0} conjuntos de atributos atualizados.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao atualizar os NCMs."); }
    finally { setBusy(false); }
  }

  function startEditingProduct(product: Product) {
    setEditingProductId(product.id);
    setEditProductDraft({ description: product.name, status: product.status });
    setError("");
    setNotice("");
  }

  function cancelEditingProduct() {
    setEditingProductId("");
    setEditProductDraft({ description: "", status: "ACTIVE" });
  }

  async function saveProductEdit(event: FormEvent<HTMLFormElement>, product: Product) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch(`/api/v1/products/${product.id}`, { method: "PATCH",
        headers: { "content-type": "application/json", "X-Record-Version": product.version },
        body: JSON.stringify({ name: editProductDraft.description, status: editProductDraft.status,
          reason: automaticAuditReason }) });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "N\u00e3o foi poss\u00edvel atualizar o produto.");
      cancelEditingProduct();
      setProductRefresh(current => current + 1);
      setNotice("Produto atualizado com auditoria.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao atualizar produto."); }
    finally { setBusy(false); }
  }

  async function addSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/suppliers", { method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ code: supplierDraft.code,
          name: supplierDraft.name, evidence: supplierDraft.evidence, reason: automaticAuditReason }) });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "Não foi possível cadastrar o fornecedor.");
      setSupplierDraft({ code: "", name: "", evidence: "" });
      setSupplierSearch("");
      setSupplierPage(1);
      setSupplierRefresh(current => current + 1);
      setNotice("Fornecedor cadastrado e disponível para associação às POs e aos IPs.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao cadastrar fornecedor."); }
    finally { setBusy(false); }
  }

  function startEditingSupplier(supplier: Supplier) {
    setEditingSupplierId(supplier.id);
    setSupplierEditDraft({ code: supplier.code, name: supplier.name, status: supplier.status });
    setError("");
    setNotice("");
  }

  function cancelEditingSupplier() {
    setEditingSupplierId("");
    setSupplierEditDraft({ code: "", name: "", status: "ACTIVE" });
  }

  async function saveSupplierEdit(event: FormEvent<HTMLFormElement>, supplier: Supplier) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch(`/api/v1/suppliers/${supplier.id}`, { method: "PATCH",
        headers: { "content-type": "application/json", "X-Record-Version": supplier.version },
        body: JSON.stringify({ code: supplierEditDraft.code, name: supplierEditDraft.name,
          status: supplierEditDraft.status, reason: automaticAuditReason }) });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "Não foi possível atualizar o fornecedor.");
      cancelEditingSupplier();
      setSupplierRefresh(current => current + 1);
      setNotice("Fornecedor atualizado com auditoria.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao atualizar fornecedor."); }
    finally { setBusy(false); }
  }

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/products", { method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ code: productDraft.code, name: productDraft.description }) });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "N\u00e3o foi poss\u00edvel cadastrar o produto.");
      setProductDraft({ code: "", description: "" });
      setProductRefresh(current => current + 1);
      setNotice("Produto cadastrado com c\u00f3digo e descri\u00e7\u00e3o.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao cadastrar produto."); }
    finally { setBusy(false); }
  }

  async function selectProductJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setProductJson([]); setProductJsonFileName(""); setError(""); setNotice("");
    if (!file) return;
    if (file.size > 750_000) { setError("O arquivo deve ter no m\u00e1ximo 750 KB."); return; }
    try {
      setProductJson(parseProductCatalogJson(await file.text()));
      setProductJsonFileName(file.name);
    } catch (cause) {
      setError(cause instanceof SyntaxError ? "O arquivo n\u00e3o cont\u00e9m um JSON v\u00e1lido."
        : cause instanceof Error ? cause.message : "N\u00e3o foi poss\u00edvel ler o arquivo.");
    }
  }

  async function importProductsJson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/products/bulk", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ items: productJson }) });
      const result = await response.json() as { createdCount?: number; skippedCount?: number; detail?: string };
      if (!response.ok) throw new Error(result.detail || "N\u00e3o foi poss\u00edvel importar os produtos.");
      setProductJson([]); setProductJsonFileName("");
      if (productFileInput.current) productFileInput.current.value = "";
      setProductRefresh(current => current + 1);
      setNotice("Importacao concluida: " + (result.createdCount ?? 0) + " adicionados; "
        + (result.skippedCount ?? 0) + " codigos ja existentes foram ignorados.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao importar produtos."); }
    finally { setBusy(false); }
  }

  function chooseEntity(next: string) {
    setEntity(next);
    setError(""); setNotice(""); setEditingId("");
    setEditingProductId(""); setProductPage(1); setProductSearch("");
    setNcmPage(1); setNcmSearch("");
    setEditingNcmId(""); setNcmDraft(emptyNcmDraft);
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/operational-values", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ entity, ...(entity === "group" ? { code: valueCode } : {}), value, reason: automaticAuditReason }) });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "Não foi possível adicionar o valor.");
      setValue(""); setValueCode(""); await load(); setNotice("Valor adicionado ao cadastro e disponível nos seletores.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao adicionar valor."); }
    finally { setBusy(false); }
  }

  function startEditing(option: Option) {
    setEditingId(option.id);
    setEditCode(option.code ?? "");
    setEditValue(option.value);
    setError("");
    setNotice("");
  }

  function cancelEditing() {
    setEditingId("");
    setEditCode("");
    setEditValue("");
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>, option: Option) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch(`/api/v1/operational-values/${option.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedValue: option.value, ...(entity === "group" ? { expectedCode: option.code ?? null, code: editCode } : {}), value: editValue, reason: automaticAuditReason }),
      });
      const result = await response.json() as { detail?: string; value?: string; unchanged?: boolean };
      if (!response.ok) throw new Error(result.detail || "Não foi possível editar o valor.");
      cancelEditing();
      await load();
      setNotice(result.unchanged ? "O valor não foi alterado." : "Valor atualizado nos seletores.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao editar valor."); }
    finally { setBusy(false); }
  }

  async function deleteOption(option: Option) {
    const label = `${entity === "group" && option.code ? `${option.code} · ` : ""}${option.value}`;
    if (!window.confirm(`Excluir "${label}" das opções de ${entities.find(([key]) => key === entity)?.[1] ?? "entidade"}? Os valores já salvos em registros não serão apagados.`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch(`/api/v1/operational-values/${option.id}`, {
        method: "DELETE", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedValue: option.value,
          ...(entity === "group" ? { expectedCode: option.code ?? null } : {}), reason: automaticAuditReason }),
      });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "Não foi possível excluir o valor.");
      if (editingId === option.id) cancelEditing();
      await load();
      setNotice("Valor removido das opções da entidade. Os registros existentes foram preservados.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao excluir valor."); }
    finally { setBusy(false); }
  }

  async function selectJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setJsonValues([]); setJsonFileName(""); setError(""); setNotice("");
    if (!file) return;
    if (file.size > 750_000) { setError("O arquivo deve ter no máximo 750 KB."); return; }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const values = Array.isArray(parsed) ? parsed
        : typeof parsed === "object" && parsed !== null && "values" in parsed
          ? (parsed as { values: unknown }).values : null;
      if (!Array.isArray(values) || values.length === 0 || values.length > 500
        || values.some(item => typeof item !== "string" || !item.trim())) {
        throw new Error("Use uma lista JSON de textos ou um objeto { \"values\": [\"valor\"] }, com 1 a 500 valores não vazios.");
      }
      setJsonValues(values.map(item => (item as string).trim()));
      setJsonFileName(file.name);
    } catch (cause) {
      setError(cause instanceof SyntaxError ? "O arquivo não contém um JSON válido." :
        cause instanceof Error ? cause.message : "Não foi possível ler o arquivo.");
    }
  }

  async function importJson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/operational-values/bulk", { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entity, values: jsonValues, reason: automaticAuditReason }) });
      let result: { createdCount?: number; skippedCount?: number; detail?: string };
      if (response.status === 404) {
        let createdCount = 0;
        let skippedCount = 0;
        for (const [index, item] of jsonValues.entries()) {
          const itemResponse = await apiFetch("/api/v1/operational-values", { method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ entity, value: item, reason: automaticAuditReason }) });
          const itemResult = await itemResponse.json() as { detail?: string };
          if (itemResponse.status === 409) {
            skippedCount += 1;
            continue;
          }
          if (!itemResponse.ok) {
            throw new Error(`${itemResult.detail || "Não foi possível importar os valores."} Importação interrompida após ${index} de ${jsonValues.length} valores.`);
          }
          createdCount += 1;
        }
        result = { createdCount, skippedCount };
      } else {
        result = await response.json() as { createdCount?: number; skippedCount?: number; detail?: string };
        if (!response.ok) throw new Error(result.detail || "Não foi possível importar os valores.");
      }
      setJsonValues([]); setJsonFileName("");
      if (fileInput.current) fileInput.current.value = "";
      await load();
      setNotice(`Importação concluída: ${result.createdCount ?? 0} adicionados; ${result.skippedCount ?? 0} já existiam e foram ignorados.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao importar valores."); }
    finally { setBusy(false); }
  }

  const visible = options.filter(option => option.entity === entity).sort((a, b) => a.value.localeCompare(b.value));
  if (entity === "product") return <main className="shell">
    <header className="page-header"><p className="eyebrow">ERP Comex</p><h1>Valores das entidades</h1>
      <p>Gerencie as opções usadas nos campos do sistema.</p>
      <Link className="text-link" href="/catalog">Todos os cadastros</Link></header>
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    <section className="card entity-values-card">
      <h2>Campo e opções</h2>
      <label>Campo<select value={entity} onChange={event => chooseEntity(event.target.value)}>
        {entities.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <p className="muted">Cada produto é cadastrado com seu código e sua descrição.</p>
      <h3>Produtos cadastrados &middot; {productTotalCount}</h3>
      <label className="product-catalog-search">Pesquisar por c&oacute;digo ou descri&ccedil;&atilde;o
        <input maxLength={120} value={productSearch} onChange={event => { setProductSearch(event.target.value); setProductPage(1); }} />
      </label>
      {productsLoading ? <p role="status">Carregando produtos...</p> : products.length ? <ul className="product-catalog-list">
        {products.map(product => <li className="product-catalog-item" key={product.id}>
          {editingProductId === product.id ? <form className="product-catalog-edit" onSubmit={event => void saveProductEdit(event, product)}>
            <p className="product-catalog-code"><strong>C&oacute;digo do produto</strong><span>{product.code}</span></p>
            <label>Descri&ccedil;&atilde;o do produto<textarea required maxLength={2000} rows={4} value={editProductDraft.description}
              onChange={event => setEditProductDraft(current => ({ ...current, description: event.target.value }))} /></label>
            <label>Situa&ccedil;&atilde;o<select value={editProductDraft.status}
              onChange={event => setEditProductDraft(current => ({ ...current, status: event.target.value }))}>
              <option value="ACTIVE">Ativo</option><option value="INACTIVE">Inativo</option>
            </select></label>
            <div className="product-catalog-actions">
              <button className="button" disabled={busy || !editProductDraft.description.trim()}>{busy ? "Salvando..." : "Salvar"}</button>
              <button className="button secondary" type="button" disabled={busy} onClick={cancelEditingProduct}>Cancelar</button>
            </div>
          </form> : <>
            <div className="product-catalog-description"><strong className="product-catalog-code">{product.code}</strong>
              <span>{product.name}</span></div>
            <div className="product-catalog-actions"><span className={`product-catalog-status ${product.status === "ACTIVE" ? "active" : "inactive"}`}>
              {product.status === "ACTIVE" ? "Ativo" : "Inativo"}
            </span>
              {canWrite && <button className="button secondary entity-value-action" type="button" disabled={busy}
                aria-label={`Editar produto ${product.code}`} onClick={() => startEditingProduct(product)}>Editar</button>}
            </div>
          </>}
        </li>)}
      </ul> : <p className="muted">{productSearch.trim() ? "Nenhum produto corresponde \u00e0 pesquisa." : "Ainda n\u00e3o h\u00e1 produtos cadastrados."}</p>}
      {!productsLoading && productTotalCount > 25 && <nav className="pagination" aria-label="P&aacute;ginas dos produtos">
        <button className="button secondary" disabled={productPage <= 1} onClick={() => setProductPage(page => page - 1)}>Anterior</button>
        <span>P&aacute;gina {productPage} de {Math.ceil(productTotalCount / 25)}</span>
        <button className="button" disabled={productPage * 25 >= productTotalCount} onClick={() => setProductPage(page => page + 1)}>Pr&oacute;xima</button>
      </nav>}
      {canWrite && <form className="stack-form" onSubmit={event => void addProduct(event)}>
        <h3>Adicionar produto</h3>
        <label>Código do produto<input required maxLength={120} value={productDraft.code} onChange={event => setProductDraft(current => ({ ...current, code: event.target.value }))} /></label>
        <label>Descrição do produto<input required maxLength={2000} value={productDraft.description} onChange={event => setProductDraft(current => ({ ...current, description: event.target.value }))} /></label>
        <button className="button" disabled={busy}>{busy ? "Salvando…" : "Adicionar produto"}</button>
      </form>}
      {canWrite && <section className="entity-value-form">
        <h3>Importar produtos por JSON</h3>
        <p className="muted">Use uma lista com c&#243;digo e descri&#231;&#227;o. M&#225;ximo de 500 produtos por arquivo.</p>
        <form className="stack-form" onSubmit={event => void importProductsJson(event)}>
          <label>Arquivo JSON<input className="file-upload-input" ref={productFileInput} type="file" accept=".json,application/json" onChange={event => void selectProductJson(event)} /></label>
          <button className="button" disabled={busy || productJson.length === 0}>{busy ? "Importando..." : "Importar " + (productJson.length || "produtos")}</button>
        </form>
        {productJsonFileName && <p className="muted" role="status">{productJsonFileName}: {productJson.length} produtos prontos para importar.</p>}
        {!!productJson.length && <details><summary>Conferir produtos</summary><ul className="entity-value-list">
          {productJson.map((item, index) => <li key={item.code + "-" + index}><span><strong>{item.code}</strong> - {item.description}</span></li>)}
        </ul></details>}
        <details><summary>Ver exemplo de JSON</summary><pre>{'[\n  { "code": "PROD-001", "description": "Descricao do produto" },\n  { "code": "PROD-002", "description": "Outro produto" }\n]'}</pre></details>
      </section>}
    </section>
  </main>;
  if (entity === "ncm") return <main className="shell">
    <header className="page-header"><p className="eyebrow">ERP Comex</p><h1>Valores das entidades</h1>
      <p>Gerencie as opções usadas nos campos do sistema.</p>
      <Link className="text-link" href="/catalog">Todos os cadastros</Link></header>
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    <section className="card entity-values-card">
      <h2>Campo e opções</h2>
      <label>Campo<select value={entity} onChange={event => chooseEntity(event.target.value)}>
        {entities.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <p className="muted">NCMs são um catálogo fiscal global, sem vínculo com importadora.</p>
      <p className="muted">A pesquisa usa o último catálogo Siscomex sincronizado. Se uma nova consulta falhar, a cópia anterior permanece disponível e os NCMs cadastrados não são alterados.</p>
      {canWriteNcm && <button className="button secondary ncm-refresh-button" type="button" disabled={busy}
        onClick={() => void refreshRegisteredNcms()}>{busy ? "Atualizando..." : "Atualizar NCMs já cadastrados"}</button>}
      {ncmSyncStatus && <div className="muted" role="status">
        <p>Catálogo para pesquisa: {ncmSyncStatus.snapshot?.source === "SISCOMEX" ? "Siscomex" : "aguardando carga Siscomex"}
          {ncmSyncStatus.snapshot ? ` · ${ncmSyncStatus.snapshot.itemCount} códigos · carga ${formatNcmDateTime(ncmSyncStatus.snapshot.syncedAt)}` : " · aguardando primeira carga"}.</p>
        <p>Última tentativa: {formatNcmDateTime(ncmSyncStatus.lastAttemptAt)}. Último sucesso do Siscomex: {formatNcmDateTime(ncmSyncStatus.lastSiscomexSuccessAt)}.</p>
        {ncmSyncStatus.lastError && <p>Situação atual: {ncmSyncStatus.lastError}</p>}
        <p>Próxima sincronização programada: {formatNcmDateTime(ncmSyncStatus.nextAttemptAt)} (Brasília).</p>
      </div>}
      <h3>NCMs cadastrados &middot; {ncmTotalCount}</h3>
      <label className="product-catalog-search">Pesquisar por código ou descrição
        <input maxLength={120} value={ncmSearch} onChange={event => { setNcmSearch(event.target.value); setNcmPage(1); }} />
      </label>
      {ncmLoading ? <p role="status">Carregando NCMs...</p> : ncms.length ? <ul className="product-catalog-list">
        {ncms.map(ncm => <li className="product-catalog-item" key={ncm.id}>
          {editingNcmId === ncm.id ? <form className="product-catalog-edit" onSubmit={event => void saveNcmEdit(event, ncm)}>
            <p className="product-catalog-code"><strong>Código NCM</strong><span>{ncm.code}</span></p>
            <label>Descrição NCM<textarea required maxLength={2000} rows={3} value={ncmDraft.description}
              onChange={event => setNcmDraft(current => ({ ...current, description: event.target.value }))} /></label>
            <label>Situação<select value={ncmDraft.status}
              onChange={event => setNcmDraft(current => ({ ...current, status: event.target.value as NcmDraft["status"] }))}>
              <option value="ACTIVE">Ativo</option><option value="INACTIVE">Inativo</option>
            </select></label>
            <div className="catalog-validity-fields">
              <label>Início da vigência<input type="date" required={ncmDraft.status === "ACTIVE"} value={ncmDraft.validFrom}
                onChange={event => setNcmDraft(current => ({ ...current, validFrom: event.target.value }))} /></label>
              <label>Fim da vigência<input type="date" min={ncmDraft.validFrom || undefined} value={ncmDraft.validTo}
                onChange={event => setNcmDraft(current => ({ ...current, validTo: event.target.value }))} /></label>
            </div>
            <label>Evidência da revisão<textarea required minLength={8} maxLength={2000} rows={3} value={ncmDraft.evidence}
              onChange={event => setNcmDraft(current => ({ ...current, evidence: event.target.value }))}
              placeholder="Documento, número, data e onde conferir" /></label>
            <div className="product-catalog-actions">
              <button className="button" disabled={busy || !ncmDraft.description.trim() || ncmDraft.evidence.trim().length < 8}>{busy ? "Salvando..." : "Salvar"}</button>
              <button className="button secondary" type="button" disabled={busy} onClick={cancelEditingNcm}>Cancelar</button>
            </div>
          </form> : <>
            <div className="product-catalog-description"><strong className="product-catalog-code">{ncm.code}</strong>
              <span>{ncm.name}</span>
              <NcmValidityDates validFrom={ncm.validFrom} validTo={ncm.validTo} />
            </div>
            <div className="product-catalog-actions"><span className={`product-catalog-status ${ncm.status === "ACTIVE" ? "active" : "inactive"}`}>
              {ncm.status === "ACTIVE" ? "Ativo" : "Inativo"}
            </span>
              {canWriteNcm && <button className="button secondary entity-value-action" type="button" disabled={busy}
                aria-label={`Editar NCM ${ncm.code}`} onClick={() => startEditingNcm(ncm)}>Editar</button>}
            </div>
            <NcmMandatoryAttributes attributes={ncm.mandatoryImportAttributes ?? []} />
          </>}
        </li>)}
      </ul> : <p className="muted">{ncmSearch.trim() ? "Nenhum NCM corresponde à pesquisa." : "Ainda não há NCMs cadastrados."}</p>}
      {!ncmLoading && ncmTotalCount > 25 && <nav className="pagination" aria-label="Páginas dos NCMs">
        <button className="button secondary" disabled={ncmPage <= 1} onClick={() => setNcmPage(page => page - 1)}>Anterior</button>
        <span>Página {ncmPage} de {Math.ceil(ncmTotalCount / 25)}</span>
        <button className="button" disabled={ncmPage * 25 >= ncmTotalCount} onClick={() => setNcmPage(page => page + 1)}>Próxima</button>
      </nav>}
      <section className="ncm-official-search" aria-labelledby="ncm-official-search-title">
        <h3 id="ncm-official-search-title">Pesquisar NCMs oficiais</h3>
        <p className="muted">Pesquise pela descrição ou pelo código e adicione somente os NCMs usados pela entidade.</p>
        <form className="ncm-official-search-form" onSubmit={event => { event.preventDefault(); void searchOfficialNcms(1); }}>
          <label>Descrição ou código NCM
            <input maxLength={120} minLength={2} value={officialNcmSearchTerm}
              onChange={event => setOfficialNcmSearchTerm(event.target.value)} placeholder="Ex.: resistor ou 01012100" />
          </label>
          <button className="button" disabled={officialNcmSearchLoading || officialNcmSearchTerm.trim().length < 2}>
            {officialNcmSearchLoading ? "Pesquisando..." : "Pesquisar catálogo oficial"}
          </button>
        </form>
        {officialNcmSearchLoading && <p role="status">Consultando o catálogo oficial sincronizado...</p>}
        {!officialNcmSearchLoading && officialNcmSearch && <>
          <p className="muted">{officialNcmTotalCount} resultados oficiais para “{officialNcmSearch}”.</p>
          <p className="muted">Fonte: {officialNcmSourceReference ?? (officialNcmSource === "SISCOMEX" ? "Portal Único Siscomex / Classif" : "catálogo oficial sincronizado")}.</p>
          <p className="muted">Última sincronização: {officialNcmSnapshotSyncedAt
            ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short",
              timeZone: "America/Sao_Paulo" }).format(new Date(officialNcmSnapshotSyncedAt))
            : "não registrada"} (horário de Brasília).</p>
          {officialNcmResults.length ? <ul className="product-catalog-list ncm-official-search-list">
            {officialNcmResults.map(item => <li className="product-catalog-item" key={item.code}>
              <div className="product-catalog-description"><strong className="product-catalog-code">{item.code}</strong>
                <span>{item.name}</span>
                <NcmValidityDates validFrom={item.validFrom} validTo={item.validTo} />
              </div>
              <div className="product-catalog-actions">
                {item.alreadyRegistered
                  ? <span className="product-catalog-status active">Já cadastrado</span>
                  : canWriteNcm && <button className="button entity-value-action" type="button" disabled={busy}
                    onClick={() => item.validFrom ? void addOfficialNcm(item.code) : prepareOfficialNcm(item)}>
                    {item.validFrom ? "Adicionar à entidade" : "Usar dados oficiais"}</button>}
              </div>
              {officialNcmSource === "SISCOMEX"
                ? <NcmMandatoryAttributes attributes={item.mandatoryImportAttributes ?? []} />
                : <p className="muted">Esta fonte não inclui atributos obrigatórios de importação.</p>}
            </li>)}
          </ul> : <p className="muted">Nenhuma NCM vigente corresponde à pesquisa.</p>}
          {officialNcmTotalCount > 25 && <nav className="pagination" aria-label="Páginas da busca oficial de NCMs">
            <button className="button secondary" disabled={officialNcmPage <= 1} onClick={() => void searchOfficialNcms(officialNcmPage - 1, officialNcmSearch)}>Anterior</button>
            <span>Página {officialNcmPage} de {Math.ceil(officialNcmTotalCount / 25)}</span>
            <button className="button" disabled={officialNcmPage * 25 >= officialNcmTotalCount}
              onClick={() => void searchOfficialNcms(officialNcmPage + 1, officialNcmSearch)}>Próxima</button>
          </nav>}
        </>}
      </section>
      {canWriteNcm && <form id="ncm-manual-create" className="stack-form" onSubmit={event => void addNcm(event)}>
        <h3>Adicionar NCM</h3>
        <label>Código NCM<input required maxLength={8} pattern="[0-9]{8}" inputMode="numeric" value={ncmDraft.code}
          onChange={event => setNcmDraft(current => ({ ...current, code: event.target.value }))} /></label>
        <label>Descrição NCM<textarea required maxLength={2000} rows={3} value={ncmDraft.description}
          onChange={event => setNcmDraft(current => ({ ...current, description: event.target.value }))} /></label>
        <label>Início da vigência<input required type="date" value={ncmDraft.validFrom}
          onChange={event => setNcmDraft(current => ({ ...current, validFrom: event.target.value }))} /></label>
        <label>Evidência da revisão<textarea required minLength={8} maxLength={2000} rows={3} value={ncmDraft.evidence}
          onChange={event => setNcmDraft(current => ({ ...current, evidence: event.target.value }))}
          placeholder="Documento, número, data e onde conferir" /></label>
        <button className="button" disabled={busy}>{busy ? "Salvando..." : "Adicionar NCM"}</button>
      </form>}
    </section>
  </main>;
  if (entity === "supplier") return <main className="shell">
    <header className="page-header"><p className="eyebrow">ERP Comex</p><h1>Valores das entidades</h1>
      <p>Gerencie as opções usadas nos campos do sistema.</p>
      <Link className="text-link" href="/catalog">Todos os cadastros</Link></header>
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    <section className="card entity-values-card">
      <h2>Campo e opções</h2>
      <label>Campo<select value={entity} onChange={event => chooseEntity(event.target.value)}>
        {entities.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <p className="muted">Fornecedores são entidades globais, compartilhadas entre importadoras. O mesmo cadastro é usado nas POs e nos IPs.</p>
      <h3>Fornecedores cadastrados · {supplierTotalCount}</h3>
      <label className="supplier-search" htmlFor="supplier-search">Pesquisar por código ou razão social
        <input id="supplier-search" type="search" value={supplierSearch}
          onChange={event => { setSupplierSearch(event.target.value); setSupplierPage(1); }}
          placeholder="Digite o código Protheus ou parte do nome" />
      </label>
      {suppliersLoading ? <p role="status">Carregando fornecedores…</p> : suppliers.length ? <ul className="supplier-catalog-list">
        {suppliers.map(supplier => <li className="supplier-catalog-row" key={supplier.id}>
          {editingSupplierId === supplier.id ? <form className="supplier-edit-form" onSubmit={event => void saveSupplierEdit(event, supplier)}>
            <label>Código Protheus<input required maxLength={120} value={supplierEditDraft.code}
              onChange={event => setSupplierEditDraft(current => ({ ...current, code: event.target.value }))} /></label>
            <label>Razão social<input required maxLength={240} value={supplierEditDraft.name}
              onChange={event => setSupplierEditDraft(current => ({ ...current, name: event.target.value }))} /></label>
            <label>Status<select value={supplierEditDraft.status}
              onChange={event => setSupplierEditDraft(current => ({ ...current, status: event.target.value as "ACTIVE" | "INACTIVE" }))}>
              <option value="ACTIVE">Ativo</option><option value="INACTIVE">Inativo</option>
            </select></label>
            <div className="supplier-edit-actions">
              <button className="button entity-value-action" disabled={busy || !supplierEditDraft.code.trim() || !supplierEditDraft.name.trim()}>
                {busy ? "Salvando…" : "Salvar"}
              </button>
              <button className="button secondary entity-value-action" type="button" disabled={busy} onClick={cancelEditingSupplier}>Cancelar</button>
            </div>
          </form> : <>
            <div className="supplier-catalog-details"><strong>{supplier.code}</strong><span>{supplier.name}</span>
              <span className={`product-catalog-status ${supplier.status === "ACTIVE" ? "active" : "inactive"}`}>
                {supplier.status === "ACTIVE" ? "Ativo" : "Inativo"}
              </span>
            </div>
            {canWrite && <button className="button secondary entity-value-action" type="button" disabled={busy}
              aria-label={`Editar fornecedor ${supplier.code}`} onClick={() => startEditingSupplier(supplier)}>Editar</button>}
          </>}
        </li>)}
      </ul> : <p className="muted">{supplierSearch.trim()
        ? "Nenhum fornecedor corresponde à pesquisa."
        : "Ainda não há fornecedores cadastrados."}</p>}
      {!suppliersLoading && supplierTotalCount > 25 && <nav className="pagination" aria-label="Páginas dos fornecedores">
        <button className="button secondary" disabled={supplierPage <= 1} onClick={() => setSupplierPage(page => page - 1)}>Anterior</button>
        <span>Página {supplierPage} de {Math.ceil(supplierTotalCount / 25)}</span>
        <button className="button" disabled={supplierPage * 25 >= supplierTotalCount} onClick={() => setSupplierPage(page => page + 1)}>Próxima</button>
      </nav>}
      {canWrite && <form className="stack-form" onSubmit={event => void addSupplier(event)}>
        <h3>Adicionar fornecedor</h3>
        <label>Código do fornecedor<input required maxLength={120} value={supplierDraft.code} onChange={event => setSupplierDraft(current => ({ ...current, code: event.target.value }))} /></label>
        <label>Nome do fornecedor<input required maxLength={240} value={supplierDraft.name} onChange={event => setSupplierDraft(current => ({ ...current, name: event.target.value }))} /></label>
        <label>Evidência da revisão<textarea required minLength={8} maxLength={2000} value={supplierDraft.evidence} onChange={event => setSupplierDraft(current => ({ ...current, evidence: event.target.value }))} placeholder="Documento, número, data e onde conferir" /></label>
        <button className="button" disabled={busy}>{busy ? "Salvando…" : "Adicionar fornecedor"}</button>
      </form>}
    </section>
  </main>;
  return <main className="shell">
    <header className="page-header"><p className="eyebrow">ERP Comex</p><h1>Valores das entidades</h1>
      <p>Gerencie as opções usadas nos campos do sistema.</p>
      <Link className="text-link" href="/catalog">Todos os cadastros</Link></header>
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    <section className="card entity-values-card">
      <h2>Campo e opções</h2>
      <label>Campo<select value={entity} onChange={event => chooseEntity(event.target.value)}>
        {entities.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <h3>Valores cadastrados · {visible.length}</h3>
      {visible.length ? <ul className="entity-value-list">{visible.map(option => <li key={option.id}>
        {editingId === option.id ? <form className="entity-value-edit" onSubmit={event => void saveEdit(event, option)}>
          {entity === "group" && <><label className="sr-only" htmlFor={`operational-code-${option.id}`}>Código</label>
            <input id={`operational-code-${option.id}`} required maxLength={120} value={editCode} onChange={event => setEditCode(event.target.value)} /></>}
          <label className="sr-only" htmlFor={`operational-value-${option.id}`}>Valor atualizado</label>
          <input id={`operational-value-${option.id}`} required maxLength={240} value={editValue}
            onChange={event => setEditValue(event.target.value)} />
          <button className="button entity-value-action" disabled={busy || !editValue.trim()}>
            {busy ? "Salvando…" : "Salvar"}
          </button>
          <button className="button secondary entity-value-action" type="button" disabled={busy} onClick={cancelEditing}>Cancelar</button>
        </form> : <>
          <span>{entity === "group" && option.code ? <><strong>{option.code}</strong> · </> : null}{option.value}</span>
          <button className="button secondary entity-value-action" type="button" disabled={busy}
            aria-label={`Editar ${option.value}`} onClick={() => startEditing(option)}>Editar</button>
          {canWrite && <button className="button secondary entity-value-action" type="button" disabled={busy}
            aria-label={`Excluir ${option.value}`} onClick={() => void deleteOption(option)}>Excluir</button>}
        </>}
      </li>)}</ul> :
        <p className="muted">Ainda não há valores cadastrados para este campo.</p>}
    </section>
    {canWrite && <section className="card entity-value-form">
      <h2>Adicionar valor à entidade</h2>
      <form className="stack-form" onSubmit={add}>
        {entity === "group" && <label>Código<input required maxLength={120} value={valueCode} onChange={event => setValueCode(event.target.value)} /></label>}
        <label>Novo valor<input required maxLength={240} value={value} onChange={event => setValue(event.target.value)} /></label>
        <button className="button" disabled={busy || !value.trim()}>{busy ? "Salvando…" : "Adicionar valor"}</button>
      </form>
    </section>}
    {canWrite && entity !== "group" && <section className="card entity-value-form">
      <h2>Importar valores por JSON</h2>
      <p className="muted">Selecione um arquivo com uma lista de textos ou com a propriedade <code>values</code>. Máximo de 500 valores por importação.</p>
      <form className="stack-form" onSubmit={importJson}>
        <label>Arquivo JSON<input className="file-upload-input" ref={fileInput} type="file" accept=".json,application/json" onChange={event => void selectJson(event)} /></label>
        <button className="button" disabled={busy || jsonValues.length === 0}>{busy ? "Importando…" : `Importar ${jsonValues.length || "valores"}`}</button>
      </form>
      {jsonFileName && <p className="muted" role="status">{jsonFileName}: {jsonValues.length} valores prontos para importar na entidade selecionada.</p>}
      <details><summary>Ver exemplo de JSON</summary><pre>{`[\n  "Valor 1",\n  "Valor 2"\n]`}</pre></details>
    </section>}
  </main>;
}
