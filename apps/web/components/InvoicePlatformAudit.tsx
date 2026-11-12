"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch, readApiJson } from "../lib/api";
import type { ChinaInvoiceDraft } from "../lib/china-invoice-xlsx";
import { emptyInvoiceAuditDecisions, invoicePlatformAuditSource, invoicePlatformRequests, type InvoiceAuditDecisions,
  type InvoicePlatformItem, type InvoicePlatformPurchaseOrder } from "../lib/china-invoice-mapping";
import type { AuditReference } from "../lib/reference-loads";
import { formatUsDateTime } from "../lib/date-format";
import { getMessages, useI18n } from "./I18nProvider";
import InvoiceAuditReview from "./InvoiceAuditReview";

type Candidates = { purchaseOrders: InvoicePlatformPurchaseOrder[]; byProduct: { productCode: string; items: InvoicePlatformItem[] }[] };

/** The routes take at most 200 POs and 500 products per call; an invoice rarely needs more than one call of each. */
function chunks<T>(values: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

async function postJson<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  return readApiJson<T>(await apiFetch(path, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body), cache: "no-store", signal }));
}

/**
 * Audit of the invoice against the POs of the platform (user decisions, 2026-11-12), a subsection of "Create IP from the
 * invoice": the rules, points and file of the audit page, with the balances of the system instead of the Follow Up. It
 * saves nothing: the analyst downloads the audited invoice and checks it. Until stage 6 the IP is still saved below.
 */
export default function InvoicePlatformAudit({ draft, bytes, importer, user }: {
  draft: ChinaInvoiceDraft; bytes: ArrayBuffer; importer: string; user: string;
}) {
  const { m } = useI18n();
  const t = m.invoiceAudit.platform;
  const [reference, setReference] = useState<AuditReference | null>(null);
  const [referenceFailed, setReferenceFailed] = useState(false);
  const [candidates, setCandidates] = useState<Candidates | null>(null);
  const [error, setError] = useState("");
  const [decisions, setDecisions] = useState<InvoiceAuditDecisions>(emptyInvoiceAuditDecisions);
  const [downloaded, setDownloaded] = useState<InvoiceAuditDecisions | null>(null);
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
  // the screen mounts the subsection again (key) for another invoice or importer.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const purchaseOrders: InvoicePlatformPurchaseOrder[] = [];
      for (const poNumbers of chunks(requests.poNumbers, 200)) {
        purchaseOrders.push(...(await postJson<{ purchaseOrders: InvoicePlatformPurchaseOrder[] }>(
          "/api/v1/purchase-orders/invoice-candidates/batch", { importer, revisingIpNumber: ipNumber || undefined, poNumbers },
          controller.signal)).purchaseOrders);
      }
      const byProduct: Candidates["byProduct"] = [];
      for (const products of chunks(requests.products, 500)) {
        byProduct.push(...(await postJson<{ products: Candidates["byProduct"] }>(
          "/api/v1/purchase-orders/invoice-candidates/by-product", { importer, revisingIpNumber: ipNumber || undefined, products },
          controller.signal)).products);
      }
      if (!controller.signal.aborted) setCandidates({ purchaseOrders, byProduct });
    })().catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : getMessages().invoiceAudit.platform.failed);
    });
    return () => controller.abort();
  }, [importer, ipNumber, requests]);

  const source = useMemo(() => candidates ? invoicePlatformAuditSource(candidates.purchaseOrders, candidates.byProduct, ipNumber) : null,
    [candidates, ipNumber]);
  const referenceSettled = Boolean(reference) || referenceFailed;
  const database = reference?.productDatabase ?? null;
  const manufacturerList = reference?.manufacturerList ?? null;

  return <section className="invoice-platform-audit" aria-labelledby="invoice-platform-audit-title">
    <h3 id="invoice-platform-audit-title">{t.title}</h3>
    <p className="muted">{t.help}</p>
    {!referenceSettled && <p role="status">{m.invoiceAudit.referenceLoading}</p>}
    {referenceFailed && <p className="notice error" role="alert">{m.invoiceAudit.referenceError}</p>}
    {database && <p className="muted">{m.invoiceAudit.databaseRead(database.fileName, database.products.length,
      formatUsDateTime(database.loadedAt), database.loadedBy)}</p>}
    {manufacturerList && <p className="muted">{m.invoiceAudit.manufacturerRead(manufacturerList.fileName,
      manufacturerList.manufacturers.length, formatUsDateTime(manufacturerList.loadedAt), manufacturerList.loadedBy)}</p>}
    {!candidates && !error && <p role="status">{t.loading}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {source && referenceSettled && <InvoiceAuditReview draft={draft} bytes={bytes} source={source} summary={{ kind: "platform" }}
      reference={reference} importer={importer} user={user} decisions={decisions} onDecisions={setDecisions}
      onDownloaded={() => setDownloaded(decisions)} />}
    {downloaded && <p className={`notice ${downloaded === decisions ? "success" : "warning"}`} role="status">
      {downloaded === decisions ? t.downloaded : t.changedAfterDownload}</p>}
  </section>;
}
