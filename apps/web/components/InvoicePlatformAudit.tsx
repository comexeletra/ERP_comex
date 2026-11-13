"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch, readApiJson } from "../lib/api";
import type { ChinaInvoiceDraft } from "../lib/china-invoice-xlsx";
import { emptyInvoiceAuditDecisions, invoiceAuditPathReset, invoiceExporterAliasSuggestion, invoiceIpSearchText,
  invoicePlatformAuditSource, invoicePlatformRequests, invoiceSystemIp, type InvoiceAuditDecisions, type InvoiceAuditedFile,
  type InvoicePlatformCandidate, type InvoicePlatformItem, type InvoicePlatformPurchaseOrder } from "../lib/china-invoice-mapping";
import type { AuditReference } from "../lib/reference-loads";
import { formatUsDateTime } from "../lib/date-format";
import { getMessages, useI18n } from "./I18nProvider";
import InvoiceAuditReview, { type InvoiceAuditDownload } from "./InvoiceAuditReview";
import { createExporterAlias } from "./SupplierExporterAliases";

type Candidates = { systemIp: string; purchaseOrders: InvoicePlatformPurchaseOrder[];
  byProduct: { productCode: string; items: InvoicePlatformItem[] }[] };
export type InvoicePlatformAuditedFile = InvoiceAuditedFile<InvoicePlatformCandidate>;

/** The routes take at most 200 POs and 500 products per call; an invoice rarely needs more than one call of each. */
function chunks<T>(values: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

async function postJson<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  return readApiJson<T>(await apiFetch(path, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body), cache: "no-store", signal }));
}

/**
 * Audit of the invoice against the POs of the platform (user decisions, 2026-11-12), the review of the screen "Create IP
 * from the invoice": the rules, points and file of the audit page, with the balances of the system instead of the Follow Up.
 * Phase B2: the IP is saved with the audited invoice of the last download, which `onAudited` hands to the screen while it
 * is still the file of the current decisions (null otherwise). Compras audits and downloads without saving.
 */
export default function InvoicePlatformAudit({ draft, bytes, importer, user, importerSwitch, canConfirm, canEditSuppliers,
  onAudited }: {
  draft: ChinaInvoiceDraft; bytes: ArrayBuffer; importer: string; user: string;
  importerSwitch?: { names: Readonly<Record<string, string>>; codes: readonly string[]; change: (code: string) => void };
  canConfirm: boolean; canEditSuppliers: boolean;
  onAudited?: (file: InvoicePlatformAuditedFile | null) => void;
}) {
  const { m } = useI18n();
  const t = m.invoiceAudit.platform;
  const [reference, setReference] = useState<AuditReference | null>(null);
  const [referenceFailed, setReferenceFailed] = useState(false);
  const [candidates, setCandidates] = useState<Candidates | null>(null);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [aliasBusy, setAliasBusy] = useState(false);
  const [aliasNotice, setAliasNotice] = useState("");
  const [decisions, setDecisions] = useState<InvoiceAuditDecisions>(emptyInvoiceAuditDecisions);
  const [downloaded, setDownloaded] = useState<{ decisions: InvoiceAuditDecisions; file: InvoiceAuditDownload<InvoicePlatformCandidate> } | null>(null);
  const requests = useMemo(() => invoicePlatformRequests(draft.lines), [draft.lines]);
  const ipNumber = draft.ipNumber.trim();

  useEffect(() => {
    const controller = new AbortController();
    apiFetch("/api/v1/reference-loads/audit-reference", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) { setReferenceFailed(true); return; }
        setReference(await response.json() as AuditReference);
      })
      .catch(() => { if (!controller.signal.aborted) setReferenceFailed(true); });
    return () => controller.abort();
  }, []);

  // One call per route and invoice (not per render): the lines and the IP do not change while the analyst decides, and
  // the screen mounts the subsection again (key) for another invoice or importer. "Read again" asks for them once more.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      // The IP under review is the one the system keeps, with or without the IPH prefix (user decision, 2026-11-12).
      const query = new URLSearchParams({ ipNumber: invoiceIpSearchText(ipNumber), importer, page: "1", pageSize: "200", recordStatus: "all" });
      const stored = ipNumber ? (await readApiJson<{ items: { ipNumber: string; recordStatus: string }[] }>(
        await apiFetch(`/api/v1/processes?${query}`, { cache: "no-store", signal: controller.signal }))).items : [];
      const systemIp = invoiceSystemIp(ipNumber, stored);
      const purchaseOrders: InvoicePlatformPurchaseOrder[] = [];
      for (const poNumbers of chunks(requests.poNumbers, 200)) {
        purchaseOrders.push(...(await postJson<{ purchaseOrders: InvoicePlatformPurchaseOrder[] }>(
          "/api/v1/purchase-orders/invoice-candidates/batch", { importer, revisingIpNumber: systemIp || undefined, poNumbers },
          controller.signal)).purchaseOrders);
      }
      const byProduct: Candidates["byProduct"] = [];
      for (const products of chunks(requests.products, 500)) {
        byProduct.push(...(await postJson<{ products: Candidates["byProduct"] }>(
          "/api/v1/purchase-orders/invoice-candidates/by-product", { importer, revisingIpNumber: systemIp || undefined, products },
          controller.signal)).products);
      }
      if (!controller.signal.aborted) setCandidates({ systemIp, purchaseOrders, byProduct });
    })().catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : getMessages().invoiceAudit.platform.failed);
    });
    return () => controller.abort();
  }, [importer, ipNumber, requests, reload]);

  const source = useMemo(() => candidates
    ? invoicePlatformAuditSource(candidates.purchaseOrders, candidates.byProduct, candidates.systemIp) : null, [candidates]);
  const referenceSettled = Boolean(reference) || referenceFailed;
  const database = reference?.productDatabase ?? null;
  const manufacturerList = reference?.manufacturerList ?? null;
  const current = Boolean(downloaded && downloaded.decisions === decisions);

  // The screen saves only the file of the current decisions (R4); any change after the download asks for a new one.
  useEffect(() => {
    onAudited?.(current && downloaded ? { ...downloaded.file, decisions: downloaded.decisions,
      references: { productDatabaseLoadId: database?.loadId ?? null, manufacturerListLoadId: manufacturerList?.loadId ?? null } } : null);
  }, [current, downloaded, database, manufacturerList, onAudited]);

  /** POs and balances read again: the content decisions stay, the path decisions are taken again (new download). */
  function readAgain() {
    setError(""); setCandidates(null); setDecisions(invoiceAuditPathReset); setReload(value => value + 1);
  }

  // A PO supplier that does not match the Exporter gets the Exporter name as an alias (supplier editors); its POs are read again.
  const aliasSuggestion = invoiceExporterAliasSuggestion(draft.exporterText);
  const supplierIds = useMemo(() => {
    const ids = new Map<string, string>();
    const items = [...(candidates?.purchaseOrders ?? []).flatMap(order => order.items),
      ...(candidates?.byProduct ?? []).flatMap(entry => entry.items)];
    for (const item of items) {
      const supplier = (item.supplierCode || item.supplierName || item.supplierText || "").trim().toLocaleUpperCase("en-US");
      if (supplier && item.supplierEntryId && !ids.has(supplier)) ids.set(supplier, item.supplierEntryId);
    }
    return ids;
  }, [candidates]);
  async function registerAlias(supplier: string) {
    const texts = getMessages().exporterAliases;
    const supplierId = supplierIds.get(supplier);
    if (!supplierId) return;
    setAliasBusy(true); setAliasNotice(""); setError("");
    try {
      await createExporterAlias(supplierId, aliasSuggestion);
      setAliasNotice(texts.invoiceCreated(aliasSuggestion, supplier));
      setCandidates(null); setReload(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : texts.saveFailed); }
    finally { setAliasBusy(false); }
  }

  // The subsection is inside the form that saves the IP: Enter in one of its fields must not save it.
  return <section className="invoice-platform-audit" aria-labelledby="invoice-platform-audit-title" onKeyDown={event => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
  }}>
    <h3 id="invoice-platform-audit-title">{t.title}</h3>
    <p className="muted">{canConfirm ? t.helpSave : t.help}</p>
    {!referenceSettled && <p role="status">{m.invoiceAudit.referenceLoading}</p>}
    {referenceFailed && <p className="notice error" role="alert">{m.invoiceAudit.referenceError}</p>}
    {database && <p className="muted">{m.invoiceAudit.databaseRead(database.fileName, database.products.length,
      formatUsDateTime(database.loadedAt), database.loadedBy)}</p>}
    {manufacturerList && <p className="muted">{m.invoiceAudit.manufacturerRead(manufacturerList.fileName,
      manufacturerList.manufacturers.length, formatUsDateTime(manufacturerList.loadedAt), manufacturerList.loadedBy)}</p>}
    {!candidates && !error && <p role="status">{t.loading}</p>}
    {candidates && candidates.systemIp.toLocaleUpperCase("en-US") !== ipNumber.toLocaleUpperCase("en-US")
      && <p className="muted">{t.systemIp(candidates.systemIp, ipNumber)}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {aliasNotice && <p className="notice success" role="status">{aliasNotice}</p>}
    <div className="button-row"><button className="button secondary" type="button" disabled={!candidates && !error}
      onClick={readAgain}>{t.readAgain}</button></div>
    {source && referenceSettled && <InvoiceAuditReview draft={draft} bytes={bytes} source={source}
      summary={{ kind: "platform", systemIp: candidates!.systemIp }}
      reference={reference} importer={importer} user={user} decisions={decisions} onDecisions={setDecisions}
      onDownloaded={file => setDownloaded({ decisions, file })} importerSwitch={importerSwitch}
      supplierAlias={canEditSuppliers && aliasSuggestion.replace(/[^A-Za-z0-9]/gu, "").length >= 8 ? { suggestion: aliasSuggestion,
        busy: aliasBusy, canRegister: supplier => supplierIds.has(supplier), register: supplier => void registerAlias(supplier) }
        : undefined} />}
    {downloaded && <p className={`notice ${current ? "success" : "warning"}`} role="status">
      {current ? canConfirm ? t.downloadedConfirm : t.downloaded : t.changedAfterDownload}</p>}
  </section>;
}
