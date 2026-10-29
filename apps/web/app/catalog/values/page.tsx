"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { automaticAuditReason } from "../../../lib/audit";
import { createNcmCatalogUrl, createNcmPayload, readNcmRefreshStart, updateNcmPayload,
  type NcmDraft } from "../../../lib/catalog-ncms";
import { parseProductCatalogJson, type ProductCatalogImport } from "../../../lib/catalog-products-json";
import { filterImporterCatalog, sortImporterCatalog } from "../../../lib/catalog-importers";
import { createSupplierCatalogUrl } from "../../../lib/catalog-suppliers";
import { useConfirmDialog } from "../../../components/ConfirmDialog";
import SupplierExporterAliases from "../../../components/SupplierExporterAliases";
import PageHeader from "../../../components/PageHeader";
import { getMessages, useI18n } from "../../../components/I18nProvider";
import { SearchableSelect } from "../../../components/SearchableSelect";
import type { Messages } from "../../../lib/i18n/pt-BR";
import { describeNcmAttributeCondition, describeNcmCreationAct, describeNcmDomainOption,
  describeNcmFillType, type NcmCreationAct, type NcmDomainOption } from "../../../lib/catalog-ncm-attributes";
import { NcmTaxTreatments } from "./NcmTaxTreatments";
import { NcmRateDetail } from "../../../components/NcmRateDetail";

const entities = ["importer", "incoterm", "transport_mode", "port_loading", "port_discharge", "currency", "category",
  "product_group", "group", "purpose", "demand", "demand_type", "logistics_status", "customs_channel", "container_type", "priority",
  "unit_of_measure", "product", "ncm", "requester", "cost_center", "broker", "forwarder", "supplier",
] as const satisfies readonly (keyof Messages["entityValues"]["entities"])[];
type Option = { id: string; entity: string; code?: string | null; value: string; importCons?: string | null; cnpj?: string | null; shortName?: string | null };
type Supplier = { id: string; code: string; name: string; status: "ACTIVE" | "INACTIVE"; version: string };
type Product = { id: string; importer: string | null; code: string; name: string; status: string; version: string };
type OfficialNcmAttributeDefinition = {
  code: string; name: string; displayName: string; fillType: string | null; multivalued: boolean;
  startsOn: string | null; endsOn: string | null; objectives: string[]; organs: string[];
  domain?: NcmDomainOption[]; subattributes?: OfficialNcmAttributeDefinition[];
  conditionalAttributes: Array<{ required: boolean; condition: string | null; conditionRule?: unknown;
    startsOn?: string | null; endsOn?: string | null; attribute: OfficialNcmAttributeDefinition }>;
};
type OfficialNcmAttribute = OfficialNcmAttributeDefinition & { required: true };
type Ncm = { id: string; code: string; name: string; status: "ACTIVE" | "INACTIVE";
  evidence: string; validFrom: string | null; validTo: string | null; version: string;
  mandatoryImportAttributes?: OfficialNcmAttribute[]; creationAct?: NcmCreationAct | null; sourceUpdatedAt?: string | null;
  attributesSourceVersion?: string | null; officialDataSyncedAt?: string | null };
type OfficialNcmSearchResult = Omit<Ncm, "id" | "status" | "evidence" | "version"> & { alreadyRegistered: boolean };
type NcmSyncStatus = { lastAttemptAt: string | null; lastSuccessAt: string | null;
  lastSource: "SISCOMEX" | "MDIC_GECEX" | null; lastSiscomexSuccessAt: string | null;
  lastError: string | null; nextAttemptAt: string; retryMode: boolean;
  manualRefresh?: { status: "idle" | "running" | "succeeded" | "failed";
    startedAt: string | null; completedAt: string | null;
    result: { matchedCount: number; updatedCount: number; attributesUpdatedCount: number } | null };
  snapshot: { source: string; itemCount: number; syncedAt: string } | null;
  lastSiscomexSnapshot: { itemCount: number; syncedAt: string } | null };
const emptyNcmDraft: NcmDraft = { code: "", description: "", status: "ACTIVE", evidence: "", validFrom: "", validTo: "" };

function formatNcmDate(value: string | null) {
  if (!value) return null;
  const date = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  return date ? `${date[3]}/${date[2]}/${date[1]}` : value;
}

function formatNcmDateTime(value: string | null, m: Messages) {
  return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short",
    timeZone: "America/Sao_Paulo" }).format(new Date(value)) : m.entityValues.notRegisteredYet;
}

function NcmValidityDates({ validFrom, validTo }: { validFrom: string | null; validTo: string | null }) {
  const t = useI18n().m.entityValues;
  const start = formatNcmDate(validFrom);
  const end = formatNcmDate(validTo);
  return <small className="ncm-validity-dates">
    {t.validityDates(start ?? t.notInformed, end ?? t.notInformedOfficial)}
  </small>;
}

function NcmCreationAct({ act }: { act?: NcmCreationAct | null }) {
  const { m } = useI18n();
  const description = describeNcmCreationAct(act, m);
  return description ? <small className="ncm-creation-act">{description}</small> : null;
}

function NcmAttributeOptions({ options }: { options?: NcmDomainOption[] }) {
  const t = useI18n().m.entityValues;
  if (!options?.length) return null;
  const list = <ul className="ncm-domain-options">{options.map(option =>
    <li key={option.code}>{describeNcmDomainOption(option)}</li>)}</ul>;
  return options.length <= 6
    ? <div className="ncm-domain"><span>{t.acceptedOptions}</span>{list}</div>
    : <details className="ncm-domain"><summary>{t.viewOptions(options.length)}</summary>{list}</details>;
}

function NcmAttributeItem({ attribute, lookup, parent, condition, conditionRule,
  conditionStartsOn, conditionEndsOn, kind }: {
  attribute: OfficialNcmAttributeDefinition;
  lookup: ReadonlyMap<string, OfficialNcmAttributeDefinition>;
  parent?: OfficialNcmAttributeDefinition;
  condition?: string | null;
  conditionRule?: unknown;
  conditionStartsOn?: string | null;
  conditionEndsOn?: string | null;
  kind: "required" | "conditional" | "part";
}) {
  const { m } = useI18n();
  const t = m.entityValues;
  const fillHint = describeNcmFillType(attribute.fillType, m);
  const uses = attribute.objectives.map(value => {
    // Objective names come from Siscomex in Portuguese.
    if (/^produto$/iu.test(value)) return t.uses.product;
    if (/^duimp$/iu.test(value)) return t.uses.duimp;
    if (/^tratamento administrativo$/iu.test(value)) return t.uses.administrative;
    return value.toLocaleLowerCase("pt-BR");
  });
  return <li className="ncm-attribute-card">
    <strong>{attribute.displayName}</strong>
    <p className="ncm-attribute-rule">{kind === "conditional"
      ? describeNcmAttributeCondition(condition ?? null, m, parent, lookup)
      : kind === "part" ? t.partOfAbove : t.requiredForNcm}</p>
    {kind === "conditional" && (conditionStartsOn || conditionEndsOn) && <p>
      {conditionStartsOn && conditionEndsOn
        ? t.ruleBetween(formatNcmDate(conditionStartsOn) ?? "", formatNcmDate(conditionEndsOn) ?? "")
        : conditionStartsOn ? t.ruleSince(formatNcmDate(conditionStartsOn) ?? "")
          : t.ruleUntil(formatNcmDate(conditionEndsOn!) ?? "")}
    </p>}
    {fillHint && <p>{fillHint}{attribute.multivalued ? t.multivalued : ""}.</p>}
    {uses.length > 0 && <p>{t.usedIn(uses.join(", "))}</p>}
    {attribute.organs.length > 0 && <p>{t.organ(attribute.organs.join(", "))}</p>}
    <NcmAttributeOptions options={attribute.domain} />
    {!!attribute.subattributes?.length && <div className="ncm-subattributes"><span>{t.subattributes}</span>
      <ul>{attribute.subattributes.map(item => <NcmAttributeItem key={item.code} attribute={item} lookup={lookup}
        parent={attribute} kind="part" />)}</ul>
    </div>}
    {!!attribute.conditionalAttributes?.length && <div className="ncm-conditional-attributes"><span>{t.conditional}</span>
      <ul>{attribute.conditionalAttributes.map(item => <NcmAttributeItem key={`${item.attribute.code}-${item.condition}`}
        attribute={item.attribute} lookup={lookup} parent={attribute} kind="conditional"
        condition={item.condition} conditionRule={item.conditionRule}
        conditionStartsOn={item.startsOn} conditionEndsOn={item.endsOn} />)}</ul>
    </div>}
    <details className="ncm-attribute-technical"><summary>{t.technical}</summary>
      <p>{t.siscomexCode}<code>{attribute.code}</code>{attribute.fillType ? t.typeSuffix(attribute.fillType) : ""}</p>
      {condition && <p>{t.originalRule}<code>{condition}</code></p>}
      {conditionRule != null && <p>{t.structuredRule}<code>{JSON.stringify(conditionRule)}</code></p>}
    </details>
  </li>;
}

function NcmMandatoryAttributes({ attributes }: { attributes: OfficialNcmAttribute[] }) {
  const t = useI18n().m.entityValues;
  const lookup = new Map<string, OfficialNcmAttributeDefinition>();
  const addToLookup = (attribute: OfficialNcmAttributeDefinition) => {
    lookup.set(attribute.code, attribute);
    attribute.subattributes?.forEach(addToLookup);
    attribute.conditionalAttributes?.forEach(item => addToLookup(item.attribute));
  };
  attributes.forEach(addToLookup);
  return <details className="ncm-mandatory-attributes">
    <summary>{t.mandatoryTitle(attributes.length)}</summary>
    <p className="ncm-attribute-help">{t.mandatoryHelp}</p>
    {attributes.length ? <ul className="ncm-attribute-list">
      {attributes.map(attribute => <NcmAttributeItem key={attribute.code} attribute={attribute} lookup={lookup} kind="required" />)}
    </ul> : <p className="muted">{t.noMandatory}</p>}
  </details>;
}

export default function OperationalValuesPage() {
  const { m } = useI18n();
  const { confirm, dialog } = useConfirmDialog();
  const t = m.entityValues;
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
  const [ncmManualRunning, setNcmManualRunning] = useState(false);
  const [editingNcmId, setEditingNcmId] = useState("");
  const [ncmDraft, setNcmDraft] = useState<NcmDraft>(emptyNcmDraft);
  const [entity, setEntity] = useState<string>(entities[0]);
  const [value, setValue] = useState("");
  const [valueCode, setValueCode] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editCode, setEditCode] = useState("");
  const [importCons, setImportCons] = useState("");
  const [editImportCons, setEditImportCons] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [editCnpj, setEditCnpj] = useState("");
  const [shortName, setShortName] = useState("");
  const [editShortName, setEditShortName] = useState("");
  const [editValue, setEditValue] = useState("");
  const [importerSearch, setImporterSearch] = useState("");
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
    if (!valuesResponse.ok || !identityResponse.ok) throw new Error(values.detail || getMessages().entityValues.loadFailed);
    setOptions(values.items ?? []);
    setCanWrite((identity.roles ?? []).some(role => ["Master", "Administrador", "Compras"].includes(role)));
    setCanWriteNcm((identity.roles ?? []).some(role => ["Master", "Administrador", "Fiscal"].includes(role)));
  }, []);

  useEffect(() => { void load().catch(cause => setError(cause instanceof Error ? cause.message : getMessages().entityValues.loadError)); }, [load]);

  useEffect(() => {
    if (entity !== "supplier") return;
    const controller = new AbortController();
    setSuppliersLoading(true);
    apiFetch(createSupplierCatalogUrl(supplierPage, supplierSearch), { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json() as { items?: Supplier[]; totalCount?: number; detail?: string };
        if (!response.ok) throw new Error(data.detail || getMessages().entityValues.suppliersFailed);
        if (!controller.signal.aborted) {
          setSuppliers(data.items ?? []);
          setSupplierTotalCount(data.totalCount ?? 0);
        }
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : getMessages().entityValues.suppliersError); })
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
        if (!response.ok) throw new Error(data.detail || getMessages().entityValues.productsFailed);
        return { items: data.items ?? [], totalCount: data.totalCount ?? 0 };
      }).then(data => {
        if (!controller.signal.aborted) {
          setProducts(data.items);
          setProductTotalCount(data.totalCount);
        }
      }).catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : getMessages().entityValues.productsError);
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
        if (!response.ok) throw new Error(data.detail || getMessages().entityValues.ncmsFailed);
        return { items: data.items ?? [], totalCount: data.totalCount ?? 0 };
      }).then(data => {
        if (!controller.signal.aborted) {
          setNcms(data.items);
          setNcmTotalCount(data.totalCount);
        }
      }).catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : getMessages().entityValues.ncmsError);
      }).finally(() => { if (!controller.signal.aborted) setNcmLoading(false); });
    return () => controller.abort();
  }, [entity, ncmPage, ncmRefresh, ncmSearch]);

  useEffect(() => {
    if (entity !== "ncm") return;
    let active = true;
    const loadStatus = async () => {
      try {
        const response = await apiFetch("/api/v1/ncms/sync-status", { cache: "no-store" });
        if (response.ok && active) {
          const status = await response.json() as NcmSyncStatus;
          setNcmSyncStatus(status);
          if (status.manualRefresh?.status === "running") setNcmManualRunning(true);
          else if (ncmManualRunning) {
            setNcmManualRunning(false);
            if (status.manualRefresh?.status === "succeeded") {
              setNcmRefresh(current => current + 1);
              setNotice(getMessages().entityValues.ncmRefreshDone(status.manualRefresh.result?.matchedCount ?? 0,
                status.manualRefresh.result?.updatedCount ?? 0, status.manualRefresh.result?.attributesUpdatedCount ?? 0));
            } else {
              setError(status.lastError || getMessages().entityValues.ncmRefreshFailed);
            }
          }
        }
      } catch { /* The catalog remains usable if status is temporarily unavailable. */ }
    };
    void loadStatus();
    const interval = setInterval(() => { void loadStatus(); }, ncmManualRunning ? 5_000 : 60_000);
    return () => { active = false; clearInterval(interval); };
  }, [entity, ncmRefresh, ncmManualRunning]);

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
      if (!response.ok) throw new Error(result.detail || t.ncmUpdateFailed);
      cancelEditingNcm();
      setNcmRefresh(current => current + 1);
      setNotice(t.ncmUpdated);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.ncmUpdateError); }
    finally { setBusy(false); }
  }

  async function addNcm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/ncms", { method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(createNcmPayload(ncmDraft, automaticAuditReason)) });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || t.ncmCreateFailed);
      setNcmDraft(emptyNcmDraft);
      setNcmPage(1); setNcmSearch(""); setNcmRefresh(current => current + 1);
      setNotice(t.ncmCreated);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.ncmCreateError); }
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
      if (!response.ok) throw new Error(result.detail || t.officialSearchFailed);
      setOfficialNcmSearch(search);
      setOfficialNcmResults(result.items ?? []);
      setOfficialNcmTotalCount(result.totalCount ?? 0);
      setOfficialNcmSnapshotSyncedAt(result.snapshotSyncedAt ?? null);
      setOfficialNcmSource(result.source ?? null);
      setOfficialNcmSourceReference(result.sourceReference ?? null);
      setOfficialNcmPage(page);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.officialSearchError); }
    finally { setOfficialNcmSearchLoading(false); }
  }

  async function addOfficialNcm(code: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/ncms/import-official", { method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ code }) });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || t.officialAddFailed);
      setNcmPage(1); setNcmRefresh(current => current + 1);
      setNotice(t.officialAdded(code));
      await searchOfficialNcms(officialNcmPage, officialNcmSearch);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.officialAddError); }
    finally { setBusy(false); }
  }

  function prepareOfficialNcm(item: OfficialNcmSearchResult) {
    setNcmDraft({ code: item.code, description: item.name, status: "ACTIVE", validFrom: "", validTo: "",
      evidence: t.officialEvidence(officialNcmSourceReference ?? t.currentCatalog) });
    setNotice(t.officialPrepared);
    document.getElementById("ncm-manual-create")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function refreshRegisteredNcms() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/ncms/refresh-official", { method: "POST",
        headers: { "content-type": "application/json" }, body: "{}" });
      await readNcmRefreshStart(response, m);
      setNcmManualRunning(true);
      setNotice(t.refreshStarted);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.refreshError); }
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
      if (!response.ok) throw new Error(result.detail || t.productUpdateFailed);
      cancelEditingProduct();
      setProductRefresh(current => current + 1);
      setNotice(t.productUpdated);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.productUpdateError); }
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
      if (!response.ok) throw new Error(result.detail || t.supplierCreateFailed);
      setSupplierDraft({ code: "", name: "", evidence: "" });
      setSupplierSearch("");
      setSupplierPage(1);
      setSupplierRefresh(current => current + 1);
      setNotice(t.supplierCreated);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.supplierCreateError); }
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
      if (!response.ok) throw new Error(result.detail || t.supplierUpdateFailed);
      cancelEditingSupplier();
      setSupplierRefresh(current => current + 1);
      setNotice(t.supplierUpdated);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.supplierUpdateError); }
    finally { setBusy(false); }
  }

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/products", { method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ code: productDraft.code, name: productDraft.description }) });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || t.productCreateFailed);
      setProductDraft({ code: "", description: "" });
      setProductRefresh(current => current + 1);
      setNotice(t.productCreated);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.productCreateError); }
    finally { setBusy(false); }
  }

  async function selectProductJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setProductJson([]); setProductJsonFileName(""); setError(""); setNotice("");
    if (!file) return;
    if (file.size > 750_000) { setError(t.fileTooLarge); return; }
    try {
      setProductJson(parseProductCatalogJson(await file.text(), m));
      setProductJsonFileName(file.name);
    } catch (cause) {
      setError(cause instanceof SyntaxError ? t.invalidJson
        : cause instanceof Error ? cause.message : t.readFailed);
    }
  }

  async function importProductsJson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/products/bulk", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ items: productJson }) });
      const result = await response.json() as { createdCount?: number; skippedCount?: number; detail?: string };
      if (!response.ok) throw new Error(result.detail || t.productImportFailed);
      setProductJson([]); setProductJsonFileName("");
      if (productFileInput.current) productFileInput.current.value = "";
      setProductRefresh(current => current + 1);
      setNotice(t.productImportDone(result.createdCount ?? 0, result.skippedCount ?? 0));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.productImportError); }
    finally { setBusy(false); }
  }

  function chooseEntity(next: string) {
    setEntity(next);
    setError(""); setNotice(""); setEditingId("");
    setImporterSearch(""); setImportCons(""); setEditImportCons(""); setCnpj(""); setEditCnpj("");
    setShortName(""); setEditShortName("");
    setEditingProductId(""); setProductPage(1); setProductSearch("");
    setNcmPage(1); setNcmSearch("");
    setEditingNcmId(""); setNcmDraft(emptyNcmDraft);
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/operational-values", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ entity,
          ...(entity === "group" || entity === "importer" ? { code: valueCode } : {}),
          ...(entity === "importer" ? { importCons, cnpj, ...(shortName.trim() ? { shortName } : {}) } : {}),
          value, reason: automaticAuditReason }) });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || t.valueAddFailed);
      setValue(""); setValueCode(""); setImportCons(""); setCnpj(""); setShortName(""); await load(); setNotice(t.valueAdded);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.valueAddError); }
    finally { setBusy(false); }
  }

  function startEditing(option: Option) {
    setEditingId(option.id);
    setEditCode(option.code ?? "");
    setEditImportCons(option.importCons ?? "");
    setEditCnpj(option.cnpj ?? "");
    setEditShortName(option.shortName ?? "");
    setEditValue(option.value);
    setError("");
    setNotice("");
  }

  function cancelEditing() {
    setEditingId("");
    setEditCode("");
    setEditImportCons("");
    setEditCnpj("");
    setEditShortName("");
    setEditValue("");
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>, option: Option) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch(`/api/v1/operational-values/${option.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedValue: option.value,
          ...(entity === "group" ? { expectedCode: option.code ?? null, code: editCode } : {}),
          ...(entity === "importer" ? { expectedCode: option.code ?? null, code: editCode.trim() || null,
            expectedImportCons: option.importCons ?? null, importCons: editImportCons.trim() || null,
            expectedCnpj: option.cnpj ?? null, cnpj: editCnpj.trim() || null,
            expectedShortName: option.shortName ?? null, shortName: editShortName.trim() || null } : {}),
          value: editValue, reason: automaticAuditReason }),
      });
      const result = await response.json() as { detail?: string; value?: string; unchanged?: boolean };
      if (!response.ok) throw new Error(result.detail || t.valueEditFailed);
      cancelEditing();
      await load();
      setNotice(result.unchanged ? t.valueUnchanged : t.valueUpdated);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.valueEditError); }
    finally { setBusy(false); }
  }

  async function deleteOption(option: Option) {
    const label = `${(entity === "group" || entity === "importer") && option.code ? `${option.code} · ` : ""}${option.value}`;
    if (!(await confirm({ title: m.dialog.deleteTitle, message: t.confirmDelete(label, (t.entities as Record<string, string>)[entity] ?? t.entityFallback),
      confirmLabel: m.dialog.delete, danger: true }))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiFetch(`/api/v1/operational-values/${option.id}`, {
        method: "DELETE", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedValue: option.value,
          ...(entity === "group" ? { expectedCode: option.code ?? null } : {}),
          ...(entity === "importer" ? { expectedCode: option.code ?? null,
            expectedImportCons: option.importCons ?? null, expectedCnpj: option.cnpj ?? null,
            expectedShortName: option.shortName ?? null } : {}), reason: automaticAuditReason }),
      });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || t.valueDeleteFailed);
      if (editingId === option.id) cancelEditing();
      await load();
      setNotice(t.valueDeleted);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.valueDeleteError); }
    finally { setBusy(false); }
  }

  async function selectJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setJsonValues([]); setJsonFileName(""); setError(""); setNotice("");
    if (!file) return;
    if (file.size > 750_000) { setError(t.fileTooLarge); return; }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const values = Array.isArray(parsed) ? parsed
        : typeof parsed === "object" && parsed !== null && "values" in parsed
          ? (parsed as { values: unknown }).values : null;
      if (!Array.isArray(values) || values.length === 0 || values.length > 500
        || values.some(item => typeof item !== "string" || !item.trim())) {
        throw new Error(t.jsonValuesRule);
      }
      setJsonValues(values.map(item => (item as string).trim()));
      setJsonFileName(file.name);
    } catch (cause) {
      setError(cause instanceof SyntaxError ? t.invalidJson :
        cause instanceof Error ? cause.message : t.readFailed);
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
            throw new Error(t.importInterrupted(itemResult.detail || t.valuesImportFailed, index, jsonValues.length));
          }
          createdCount += 1;
        }
        result = { createdCount, skippedCount };
      } else {
        result = await response.json() as { createdCount?: number; skippedCount?: number; detail?: string };
        if (!response.ok) throw new Error(result.detail || t.valuesImportFailed);
      }
      setJsonValues([]); setJsonFileName("");
      if (fileInput.current) fileInput.current.value = "";
      await load();
      setNotice(t.valuesImportDone(result.createdCount ?? 0, result.skippedCount ?? 0));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.valuesImportError); }
    finally { setBusy(false); }
  }

  const entityOptions = options.filter(option => option.entity === entity);
  const visible = entity === "importer"
    ? sortImporterCatalog(filterImporterCatalog(entityOptions, importerSearch))
    : entityOptions.sort((a, b) => a.value.localeCompare(b.value));
  if (entity === "product") return <main className="shell">
    <PageHeader back={{ href: "/catalog", label: t.allEntries }} eyebrow={m.sidebar.groups.management} title={t.title}>
      <p>{t.intro}</p>
    </PageHeader>
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    <section className="card entity-values-card">
      <h2>{t.fieldAndOptions}</h2>
      <label>{t.field}<SearchableSelect ariaLabel={t.field} placeholder="" value={entity} onChange={chooseEntity}
        options={entities.map(key => ({ value: key, label: t.entities[key] }))} /></label>
      <p className="muted">{t.productsHelp}</p>
      <h3>{t.registeredProducts(productTotalCount)}</h3>
      <label className="product-catalog-search">{t.searchCodeDescription}
        <input maxLength={120} value={productSearch} onChange={event => { setProductSearch(event.target.value); setProductPage(1); }} />
      </label>
      {productsLoading ? <p role="status">{t.loadingProducts}</p> : products.length ? <ul className="product-catalog-list">
        {products.map(product => <li className="product-catalog-item" key={product.id}>
          {editingProductId === product.id ? <form className="product-catalog-edit" onSubmit={event => void saveProductEdit(event, product)}>
            <p className="product-catalog-code"><strong>{t.productCode}</strong><span>{product.code}</span></p>
            <label>{t.productDescription}<textarea required maxLength={2000} rows={4} value={editProductDraft.description}
              onChange={event => setEditProductDraft(current => ({ ...current, description: event.target.value }))} /></label>
            <label>{t.situation}<SearchableSelect ariaLabel={t.situation} placeholder="" value={editProductDraft.status}
              onChange={status => setEditProductDraft(current => ({ ...current, status }))}
              options={[{ value: "ACTIVE", label: m.catalog.active }, { value: "INACTIVE", label: m.catalog.inactive }]} /></label>
            <div className="product-catalog-actions">
              <button className="button" disabled={busy || !editProductDraft.description.trim()}>{busy ? t.saving : t.save}</button>
              <button className="button secondary" type="button" disabled={busy} onClick={cancelEditingProduct}>{t.cancel}</button>
            </div>
          </form> : <>
            <div className="product-catalog-description"><strong className="product-catalog-code">{product.code}</strong>
              <span>{product.name}</span></div>
            <div className="product-catalog-actions"><span className={product.status === "ACTIVE" ? "badge badge-success" : "badge badge-warning"}>
              {product.status === "ACTIVE" ? m.catalog.active : m.catalog.inactive}
            </span>
              {canWrite && <button className="button secondary entity-value-action" type="button" disabled={busy}
                aria-label={t.editProductAria(product.code)} onClick={() => startEditingProduct(product)}>{t.edit}</button>}
            </div>
          </>}
        </li>)}
      </ul> : <p className="muted">{productSearch.trim() ? t.noProductMatch : t.noProducts}</p>}
      {!productsLoading && productTotalCount > 25 && <nav className="pagination" aria-label={t.productPages}>
        <button className="button secondary" disabled={productPage <= 1} onClick={() => setProductPage(page => page - 1)}>{m.common.previous}</button>
        <span>{m.common.pageOf(productPage, Math.ceil(productTotalCount / 25))}</span>
        <button className="button" disabled={productPage * 25 >= productTotalCount} onClick={() => setProductPage(page => page + 1)}>{m.common.next}</button>
      </nav>}
      {canWrite && <form className="stack-form" onSubmit={event => void addProduct(event)}>
        <h3>{t.addProduct}</h3>
        <label>{t.productCode}<input required maxLength={120} value={productDraft.code} onChange={event => setProductDraft(current => ({ ...current, code: event.target.value }))} /></label>
        <label>{t.productDescription}<input required maxLength={2000} value={productDraft.description} onChange={event => setProductDraft(current => ({ ...current, description: event.target.value }))} /></label>
        <button className="button" disabled={busy}>{busy ? t.saving : t.addProduct}</button>
      </form>}
      {canWrite && <section className="entity-value-form">
        <h3>{t.importProductsTitle}</h3>
        <p className="muted">{t.importProductsHelp}</p>
        <form className="stack-form" onSubmit={event => void importProductsJson(event)}>
          <label>{t.jsonFile}<input className="file-upload-input" ref={productFileInput} type="file" accept=".json,application/json" onChange={event => void selectProductJson(event)} /></label>
          <button className="button" disabled={busy || productJson.length === 0}>{busy ? t.importing : t.importProducts(productJson.length)}</button>
        </form>
        {productJsonFileName && <p className="muted" role="status">{t.productsReady(productJsonFileName, productJson.length)}</p>}
        {!!productJson.length && <details><summary>{t.checkProducts}</summary><ul className="entity-value-list">
          {productJson.map((item, index) => <li key={item.code + "-" + index}><span><strong>{item.code}</strong> - {item.description}</span></li>)}
        </ul></details>}
        <details><summary>{t.jsonExample}</summary><pre>{t.productJsonExample}</pre></details>
      </section>}
    </section>
  </main>;
  if (entity === "ncm") return <main className="shell">
    <PageHeader back={{ href: "/catalog", label: t.allEntries }} eyebrow={m.sidebar.groups.management} title={t.title}>
      <p>{t.intro}</p>
    </PageHeader>
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    <section className="card entity-values-card">
      <h2>{t.fieldAndOptions}</h2>
      <label>{t.field}<SearchableSelect ariaLabel={t.field} placeholder="" value={entity} onChange={chooseEntity}
        options={entities.map(key => ({ value: key, label: t.entities[key] }))} /></label>
      <p className="muted">{t.ncmHelp}</p>
      <p className="muted">{t.ncmSearchHelp}</p>
      {canWriteNcm && <button className="button secondary ncm-refresh-button" type="button"
        disabled={busy || ncmManualRunning || ncmSyncStatus?.manualRefresh?.status === "running"}
        onClick={() => void refreshRegisteredNcms()}>{ncmManualRunning || ncmSyncStatus?.manualRefresh?.status === "running"
          ? t.refreshRunning : t.refreshNcms}</button>}
      {ncmSyncStatus && <div className="muted" role="status">
        <p>{t.searchCatalog(ncmSyncStatus.snapshot?.source === "SISCOMEX" ? t.siscomex : t.waitingSiscomex,
          ncmSyncStatus.snapshot ? t.snapshotDetails(ncmSyncStatus.snapshot.itemCount, formatNcmDateTime(ncmSyncStatus.snapshot.syncedAt, m)) : t.waitingFirst)}</p>
        <p>{t.attempts(formatNcmDateTime(ncmSyncStatus.lastAttemptAt, m), formatNcmDateTime(ncmSyncStatus.lastSiscomexSuccessAt, m))}</p>
        {ncmSyncStatus.manualRefresh?.status === "running" && <p>{t.manualRunning}</p>}
        {ncmSyncStatus.lastError && ncmSyncStatus.manualRefresh?.status !== "running" && <p>{t.currentSituation(ncmSyncStatus.lastError)}</p>}
        <p>{t.nextSync(formatNcmDateTime(ncmSyncStatus.nextAttemptAt, m))}</p>
      </div>}
      <h3>{t.registeredNcms(ncmTotalCount)}</h3>
      <label className="product-catalog-search">{t.searchCodeDescription}
        <input maxLength={120} value={ncmSearch} onChange={event => { setNcmSearch(event.target.value); setNcmPage(1); }} />
      </label>
      {ncmLoading ? <p role="status">{t.loadingNcms}</p> : ncms.length ? <ul className="product-catalog-list">
        {ncms.map(ncm => <li className="product-catalog-item" key={ncm.id}>
          {editingNcmId === ncm.id ? <form className="product-catalog-edit" onSubmit={event => void saveNcmEdit(event, ncm)}>
            <p className="product-catalog-code"><strong>{t.ncmCode}</strong><span>{ncm.code}</span></p>
            <label>{t.ncmDescription}<textarea required maxLength={2000} rows={3} value={ncmDraft.description}
              onChange={event => setNcmDraft(current => ({ ...current, description: event.target.value }))} /></label>
            <label>{t.situation}<SearchableSelect ariaLabel={t.situation} placeholder="" value={ncmDraft.status}
              onChange={status => setNcmDraft(current => ({ ...current, status: status as NcmDraft["status"] }))}
              options={[{ value: "ACTIVE", label: m.catalog.active }, { value: "INACTIVE", label: m.catalog.inactive }]} /></label>
            <div className="catalog-validity-fields">
              <label>{t.validFrom}<input type="date" required={ncmDraft.status === "ACTIVE"} value={ncmDraft.validFrom}
                onChange={event => setNcmDraft(current => ({ ...current, validFrom: event.target.value }))} /></label>
              <label>{t.validTo}<input type="date" min={ncmDraft.validFrom || undefined} value={ncmDraft.validTo}
                onChange={event => setNcmDraft(current => ({ ...current, validTo: event.target.value }))} /></label>
            </div>
            <label>{t.reviewEvidence}<textarea required minLength={8} maxLength={2000} rows={3} value={ncmDraft.evidence}
              onChange={event => setNcmDraft(current => ({ ...current, evidence: event.target.value }))}
              placeholder={t.evidencePlaceholder} /></label>
            <div className="product-catalog-actions">
              <button className="button" disabled={busy || !ncmDraft.description.trim() || ncmDraft.evidence.trim().length < 8}>{busy ? t.saving : t.save}</button>
              <button className="button secondary" type="button" disabled={busy} onClick={cancelEditingNcm}>{t.cancel}</button>
            </div>
          </form> : <>
            <div className="product-catalog-description"><strong className="product-catalog-code">{ncm.code}</strong>
              <span>{ncm.name}</span>
              <NcmValidityDates validFrom={ncm.validFrom} validTo={ncm.validTo} />
              <NcmCreationAct act={ncm.creationAct} />
            </div>
            <div className="product-catalog-actions"><span className={ncm.status === "ACTIVE" ? "badge badge-success" : "badge badge-warning"}>
              {ncm.status === "ACTIVE" ? m.catalog.active : m.catalog.inactive}
            </span>
              {canWriteNcm && <button className="button secondary entity-value-action" type="button" disabled={busy}
                aria-label={t.editNcmAria(ncm.code)} onClick={() => startEditingNcm(ncm)}>{t.edit}</button>}
            </div>
            <NcmMandatoryAttributes attributes={ncm.mandatoryImportAttributes ?? []} />
            <NcmTaxTreatments id={ncm.id} code={ncm.code} />
            <NcmRateDetail code={ncm.code} canManage={canWriteNcm} collapsible />
          </>}
        </li>)}
      </ul> : <p className="muted">{ncmSearch.trim() ? t.noNcmMatch : t.noNcms}</p>}
      {!ncmLoading && ncmTotalCount > 25 && <nav className="pagination" aria-label={t.ncmPages}>
        <button className="button secondary" disabled={ncmPage <= 1} onClick={() => setNcmPage(page => page - 1)}>{m.common.previous}</button>
        <span>{m.common.pageOf(ncmPage, Math.ceil(ncmTotalCount / 25))}</span>
        <button className="button" disabled={ncmPage * 25 >= ncmTotalCount} onClick={() => setNcmPage(page => page + 1)}>{m.common.next}</button>
      </nav>}
      <section className="ncm-official-search" aria-labelledby="ncm-official-search-title">
        <h3 id="ncm-official-search-title">{t.officialTitle}</h3>
        <p className="muted">{t.officialHelp}</p>
        <form className="ncm-official-search-form" onSubmit={event => { event.preventDefault(); void searchOfficialNcms(1); }}>
          <label>{t.officialLabel}
            <input maxLength={120} minLength={2} value={officialNcmSearchTerm}
              onChange={event => setOfficialNcmSearchTerm(event.target.value)} placeholder={t.officialPlaceholder} />
          </label>
          <button className="button" disabled={officialNcmSearchLoading || officialNcmSearchTerm.trim().length < 2}>
            {officialNcmSearchLoading ? t.searching : t.searchOfficial}
          </button>
        </form>
        {officialNcmSearchLoading && <p role="status">{t.consulting}</p>}
        {!officialNcmSearchLoading && officialNcmSearch && <>
          <p className="muted">{t.officialResults(officialNcmTotalCount, officialNcmSearch)}</p>
          <p className="muted">{t.source(officialNcmSourceReference ?? (officialNcmSource === "SISCOMEX" ? t.portalSiscomex : t.syncedCatalog))}</p>
          <p className="muted">{t.lastSync(officialNcmSnapshotSyncedAt
            ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short",
              timeZone: "America/Sao_Paulo" }).format(new Date(officialNcmSnapshotSyncedAt))
            : t.notRecorded)}</p>
          {officialNcmResults.length ? <ul className="product-catalog-list ncm-official-search-list">
            {officialNcmResults.map(item => <li className="product-catalog-item" key={item.code}>
              <div className="product-catalog-description"><strong className="product-catalog-code">{item.code}</strong>
                <span>{item.name}</span>
                <NcmValidityDates validFrom={item.validFrom} validTo={item.validTo} />
                <NcmCreationAct act={item.creationAct} />
              </div>
              <div className="product-catalog-actions">
                {item.alreadyRegistered
                  ? <span className="badge badge-success">{t.alreadyRegistered}</span>
                  : canWriteNcm && <button className="button entity-value-action" type="button" disabled={busy}
                    onClick={() => item.validFrom ? void addOfficialNcm(item.code) : prepareOfficialNcm(item)}>
                    {item.validFrom ? t.addToEntity : t.useOfficial}</button>}
              </div>
              {officialNcmSource === "SISCOMEX"
                ? <NcmMandatoryAttributes attributes={item.mandatoryImportAttributes ?? []} />
                : <p className="muted">{t.noAttributesSource}</p>}
            </li>)}
          </ul> : <p className="muted">{t.noOfficialMatch}</p>}
          {officialNcmTotalCount > 25 && <nav className="pagination" aria-label={t.officialPages}>
            <button className="button secondary" disabled={officialNcmPage <= 1} onClick={() => void searchOfficialNcms(officialNcmPage - 1, officialNcmSearch)}>{m.common.previous}</button>
            <span>{m.common.pageOf(officialNcmPage, Math.ceil(officialNcmTotalCount / 25))}</span>
            <button className="button" disabled={officialNcmPage * 25 >= officialNcmTotalCount}
              onClick={() => void searchOfficialNcms(officialNcmPage + 1, officialNcmSearch)}>{m.common.next}</button>
          </nav>}
        </>}
      </section>
      {canWriteNcm && <form id="ncm-manual-create" className="stack-form" onSubmit={event => void addNcm(event)}>
        <h3>{t.addNcm}</h3>
        <label>{t.ncmCode}<input required maxLength={8} pattern="[0-9]{8}" inputMode="numeric" value={ncmDraft.code}
          onChange={event => setNcmDraft(current => ({ ...current, code: event.target.value }))} /></label>
        <label>{t.ncmDescription}<textarea required maxLength={2000} rows={3} value={ncmDraft.description}
          onChange={event => setNcmDraft(current => ({ ...current, description: event.target.value }))} /></label>
        <label>{t.validFrom}<input required type="date" value={ncmDraft.validFrom}
          onChange={event => setNcmDraft(current => ({ ...current, validFrom: event.target.value }))} /></label>
        <label>{t.reviewEvidence}<textarea required minLength={8} maxLength={2000} rows={3} value={ncmDraft.evidence}
          onChange={event => setNcmDraft(current => ({ ...current, evidence: event.target.value }))}
          placeholder={t.evidencePlaceholder} /></label>
        <button className="button" disabled={busy}>{busy ? t.saving : t.addNcm}</button>
      </form>}
    </section>
  </main>;
  if (entity === "supplier") return <main className="shell">
    <PageHeader back={{ href: "/catalog", label: t.allEntries }} eyebrow={m.sidebar.groups.management} title={t.title}>
      <p>{t.intro}</p>
    </PageHeader>
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    <section className="card entity-values-card">
      <h2>{t.fieldAndOptions}</h2>
      <label>{t.field}<SearchableSelect ariaLabel={t.field} placeholder="" value={entity} onChange={chooseEntity}
        options={entities.map(key => ({ value: key, label: t.entities[key] }))} /></label>
      <p className="muted">{t.suppliersHelp}</p>
      <h3>{t.registeredSuppliers(supplierTotalCount)}</h3>
      <label className="supplier-search" htmlFor="supplier-search">{t.searchSupplier}
        <input id="supplier-search" type="search" value={supplierSearch}
          onChange={event => { setSupplierSearch(event.target.value); setSupplierPage(1); }}
          placeholder={t.supplierPlaceholder} />
      </label>
      {suppliersLoading ? <p role="status">{t.loadingSuppliers}</p> : suppliers.length ? <ul className="supplier-catalog-list">
        {suppliers.map(supplier => <li className="supplier-catalog-row" key={supplier.id}>
          {editingSupplierId === supplier.id ? <form className="supplier-edit-form" onSubmit={event => void saveSupplierEdit(event, supplier)}>
            <label>{t.protheusCode}<input required maxLength={120} value={supplierEditDraft.code}
              onChange={event => setSupplierEditDraft(current => ({ ...current, code: event.target.value }))} /></label>
            <label>{t.companyName}<input required maxLength={240} value={supplierEditDraft.name}
              onChange={event => setSupplierEditDraft(current => ({ ...current, name: event.target.value }))} /></label>
            <label>{t.status}<SearchableSelect ariaLabel={t.status} placeholder="" value={supplierEditDraft.status}
              onChange={status => setSupplierEditDraft(current => ({ ...current, status: status as "ACTIVE" | "INACTIVE" }))}
              options={[{ value: "ACTIVE", label: m.catalog.active }, { value: "INACTIVE", label: m.catalog.inactive }]} /></label>
            <div className="supplier-edit-actions">
              <button className="button entity-value-action" disabled={busy || !supplierEditDraft.code.trim() || !supplierEditDraft.name.trim()}>
                {busy ? t.saving : t.save}
              </button>
              <button className="button secondary entity-value-action" type="button" disabled={busy} onClick={cancelEditingSupplier}>{t.cancel}</button>
            </div>
          </form> : <>
            <div className="supplier-catalog-details"><strong>{supplier.code}</strong><span>{supplier.name}</span>
              <span className={supplier.status === "ACTIVE" ? "badge badge-success" : "badge badge-warning"}>
                {supplier.status === "ACTIVE" ? m.catalog.active : m.catalog.inactive}
              </span>
            </div>
            {canWrite && <button className="button secondary entity-value-action" type="button" disabled={busy}
              aria-label={t.editSupplierAria(supplier.code)} onClick={() => startEditingSupplier(supplier)}>{t.edit}</button>}
            <SupplierExporterAliases supplierId={supplier.id} supplierCode={supplier.code} canWrite={canWrite} />
          </>}
        </li>)}
      </ul> : <p className="muted">{supplierSearch.trim() ? t.noSupplierMatch : t.noSuppliers}</p>}
      {!suppliersLoading && supplierTotalCount > 25 && <nav className="pagination" aria-label={t.supplierPages}>
        <button className="button secondary" disabled={supplierPage <= 1} onClick={() => setSupplierPage(page => page - 1)}>{m.common.previous}</button>
        <span>{m.common.pageOf(supplierPage, Math.ceil(supplierTotalCount / 25))}</span>
        <button className="button" disabled={supplierPage * 25 >= supplierTotalCount} onClick={() => setSupplierPage(page => page + 1)}>{m.common.next}</button>
      </nav>}
      {canWrite && <form className="stack-form" onSubmit={event => void addSupplier(event)}>
        <h3>{t.addSupplier}</h3>
        <label>{t.supplierCode}<input required maxLength={120} value={supplierDraft.code} onChange={event => setSupplierDraft(current => ({ ...current, code: event.target.value }))} /></label>
        <label>{t.supplierName}<input required maxLength={240} value={supplierDraft.name} onChange={event => setSupplierDraft(current => ({ ...current, name: event.target.value }))} /></label>
        <label>{t.reviewEvidence}<textarea required minLength={8} maxLength={2000} value={supplierDraft.evidence} onChange={event => setSupplierDraft(current => ({ ...current, evidence: event.target.value }))} placeholder={t.evidencePlaceholder} /></label>
        <button className="button" disabled={busy}>{busy ? t.saving : t.addSupplier}</button>
      </form>}
    </section>
  </main>;
  return <main className="shell">
    <PageHeader back={{ href: "/catalog", label: t.allEntries }} eyebrow={m.sidebar.groups.management} title={t.title}>
      <p>{t.intro}</p>
    </PageHeader>
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    <section className="card entity-values-card">
      <h2>{t.fieldAndOptions}</h2>
      <label>{t.field}<SearchableSelect ariaLabel={t.field} placeholder="" value={entity} onChange={chooseEntity}
        options={entities.map(key => ({ value: key, label: t.entities[key] }))} /></label>
      <h3>{t.registeredValues(visible.length)}</h3>
      {entity === "importer" && <label>{t.searchImporter}<input type="search" value={importerSearch}
        onChange={event => setImporterSearch(event.target.value)} placeholder={t.importerPlaceholder} /></label>}
      {visible.length ? <ul className="entity-value-list">{visible.map(option => <li key={option.id}>
        {editingId === option.id ? <form className="entity-value-edit" onSubmit={event => void saveEdit(event, option)}>
          {(entity === "group" || entity === "importer") && <label htmlFor={`operational-code-${option.id}`}>
            {entity === "importer" ? t.importerCode : t.code}
            <input id={`operational-code-${option.id}`} required={entity === "group"} maxLength={120} value={editCode} onChange={event => setEditCode(event.target.value)} />
          </label>}
          {entity === "importer" && <>
            <label htmlFor={`operational-short-name-${option.id}`}>{t.shortName}
              <input id={`operational-short-name-${option.id}`} maxLength={240} value={editShortName}
                onChange={event => setEditShortName(event.target.value)} />
            </label>
            <label htmlFor={`operational-import-cons-${option.id}`}>{t.importCons}
              <input id={`operational-import-cons-${option.id}`} maxLength={40} value={editImportCons}
                onChange={event => setEditImportCons(event.target.value)} />
            </label>
            <label htmlFor={`operational-cnpj-${option.id}`}>{t.cnpj}
              <input id={`operational-cnpj-${option.id}`} maxLength={18} value={editCnpj} placeholder="00.000.000/0000-00"
                onChange={event => setEditCnpj(event.target.value)} />
            </label>
          </>}
          <label htmlFor={`operational-value-${option.id}`}>
            {entity === "importer" ? t.fullName : t.value}
            <input id={`operational-value-${option.id}`} required maxLength={240} value={editValue}
              onChange={event => setEditValue(event.target.value)} />
          </label>
          <button className="button entity-value-action" disabled={busy || !editValue.trim()}>
            {busy ? t.saving : t.save}
          </button>
          <button className="button secondary entity-value-action" type="button" disabled={busy} onClick={cancelEditing}>{t.cancel}</button>
        </form> : <>
          <span>
            {(entity === "group" || entity === "importer") && option.code ? <><strong>{option.code}</strong> · </> : null}
            {entity === "importer" ? <>
              <strong>{option.shortName || option.value}</strong>
              {option.shortName && option.shortName !== option.value ? <> · {option.value}</> : null}
              {(option.importCons || option.cnpj) && <small> · {option.importCons ?? ""} · {option.cnpj ?? ""}</small>}
            </> : option.value}
          </span>
          <button className="button secondary entity-value-action" type="button" disabled={busy}
            aria-label={t.editAria(option.value)} onClick={() => startEditing(option)}>{t.edit}</button>
          {canWrite && entity !== "importer" && <button className="button secondary entity-value-action" type="button" disabled={busy}
            aria-label={t.deleteAria(option.value)} onClick={() => void deleteOption(option)}>{t.delete}</button>}
        </>}
      </li>)}</ul> :
        <p className="muted">{t.noValues}</p>}
    </section>
    {canWrite && <section className="card entity-value-form">
      <h2>{t.addValueTitle}</h2>
      <form className="stack-form" onSubmit={add}>
        {(entity === "group" || entity === "importer") && <label>{t.code}<input required maxLength={120} value={valueCode} onChange={event => setValueCode(event.target.value)} /></label>}
        <label>{entity === "importer" ? t.fullName : t.newValue}<input required maxLength={240} value={value} onChange={event => setValue(event.target.value)} /></label>
        {entity === "importer" && <>
          <label>{t.shortNameOptional}<input maxLength={240} value={shortName} onChange={event => setShortName(event.target.value)} /></label>
          <label>{t.importCons}<input required maxLength={40} value={importCons} onChange={event => setImportCons(event.target.value)} /></label>
          <label>{t.cnpj}<input required maxLength={18} pattern="\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}" placeholder="00.000.000/0000-00"
            value={cnpj} onChange={event => setCnpj(event.target.value)} /></label>
        </>}
        <button className="button" disabled={busy || !value.trim()
          || (entity === "importer" && (!valueCode.trim() || !importCons.trim() || !cnpj.trim()))}>
          {busy ? t.saving : t.addValue}</button>
      </form>
    </section>}
    {canWrite && entity !== "group" && entity !== "importer" && <section className="card entity-value-form">
      <h2>{t.importValuesTitle}</h2>
      <p className="muted">{t.importValuesBefore}<code>values</code>{t.importValuesAfter}</p>
      <form className="stack-form" onSubmit={importJson}>
        <label>{t.jsonFile}<input className="file-upload-input" ref={fileInput} type="file" accept=".json,application/json" onChange={event => void selectJson(event)} /></label>
        <button className="button" disabled={busy || jsonValues.length === 0}>{busy ? t.importing : t.importValues(jsonValues.length)}</button>
      </form>
      {jsonFileName && <p className="muted" role="status">{t.valuesReady(jsonFileName, jsonValues.length)}</p>}
      <details><summary>{t.jsonExample}</summary><pre>{t.valuesJsonExample}</pre></details>
    </section>}
    {dialog}
  </main>;
}
