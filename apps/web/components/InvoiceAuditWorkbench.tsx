"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { parseChinaInvoiceXlsx, type ChinaInvoiceDraft } from "../lib/china-invoice-xlsx";
import { emptyInvoiceAuditDecisions, invoiceAssignmentsFromLines, invoiceAuditPathReset,
  type InvoiceAuditDecisions } from "../lib/china-invoice-mapping";
import { followUpAuditSource, followUpImporters, followUpSameIps, parseFollowUpXlsx,
  type FollowUpWorkbook } from "../lib/audit-reference-xlsx";
import type { AuditReference } from "../lib/reference-loads";
import { formatUsDateTime } from "../lib/date-format";
import { getMessages, useI18n } from "./I18nProvider";
import FilePickerField from "./FilePickerField";
import InvoiceAuditReview, { type InvoiceAuditDecisionsUpdate } from "./InvoiceAuditReview";
import PageHeader from "./PageHeader";

const allowedRoles = new Set(["Master", "Administrador", "Importação", "Compras"]); // i18n-ignore: role values from the API
type LoadedInvoice = { draft: ChinaInvoiceDraft; bytes: ArrayBuffer };

/**
 * Invoice audit against the Follow Up in use (user decision, 2026-11-10): the invoice and the Follow Up are read in
 * the browser, nothing is saved, and the result is the invoice file corrected with the decisions. The DATABASE and
 * the manufacturer list are the rows of their latest load, kept apart from the catalog (stage 1f, 2026-11-11). The
 * rules, the points and the file are those of the audit of the IP screen (`InvoiceAuditReview`, 2026-11-12).
 */
export default function InvoiceAuditWorkbench() {
  const { m } = useI18n();
  const t = m.invoiceAudit;
  const [identity, setIdentity] = useState<{ roles: string[]; name: string } | null>(null);
  const [invoice, setInvoice] = useState<LoadedInvoice | null>(null);
  const [followUp, setFollowUp] = useState<FollowUpWorkbook | null>(null);
  const [reference, setReference] = useState<AuditReference | null>(null);
  const [referenceFailed, setReferenceFailed] = useState(false);
  const [decisions, setDecisions] = useState<InvoiceAuditDecisions>(emptyInvoiceAuditDecisions);
  const [reading, setReading] = useState<"" | "invoice" | "followUp" | "download">("");
  const [error, setError] = useState("");
  const [importerChoice, setImporterChoice] = useState("");

  useEffect(() => {
    apiFetch("/auth/me").then(async response => {
      if (!response.ok) throw new Error(getMessages().common.unexpectedError);
      const user = await response.json() as { roles: string[]; user: { displayName: string | null } };
      setIdentity({ roles: user.roles, name: user.user.displayName ?? "" });
      if (!user.roles.some(role => allowedRoles.has(role))) return;
      const loaded = await apiFetch("/api/v1/reference-loads/audit-reference");
      if (!loaded.ok) { setReferenceFailed(true); return; }
      setReference(await loaded.json() as AuditReference);
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : getMessages().common.unexpectedError));
  }, []);
  const database = reference?.productDatabase ?? null;
  const manufacturerList = reference?.manufacturerList ?? null;

  async function selectInvoice(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
    if (!file) return;
    setError(""); setReading("invoice"); setInvoice(null); setDecisions(emptyInvoiceAuditDecisions);
    try { setInvoice({ draft: await parseChinaInvoiceXlsx(file, getMessages()), bytes: await file.arrayBuffer() }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : getMessages().common.unexpectedError); }
    finally { setReading(""); }
  }

  async function selectFollowUp(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
    if (!file) return;
    setError(""); setReading("followUp"); setFollowUp(null); setImporterChoice(""); setDecisions(invoiceAuditPathReset);
    try { setFollowUp(await parseFollowUpXlsx(file, getMessages())); }
    catch (cause) { setError(cause instanceof Error ? cause.message : getMessages().common.unexpectedError); }
    finally { setReading(""); }
  }

  const draft = invoice?.draft ?? null;
  const importers = useMemo(() => draft && followUp
    ? followUpImporters(followUp.lines, invoiceAssignmentsFromLines(draft.lines).map(part => part.poNumber)) : [], [draft, followUp]);
  const importer = importers.length === 1 ? importers[0] : importers.includes(importerChoice) ? importerChoice : "";
  const ready = Boolean(draft && followUp && importer);
  const source = useMemo(() => draft && followUp && importer ? followUpAuditSource(followUp.lines, importer, draft.ipNumber) : null,
    [draft, followUp, importer]);
  const sameIps = useMemo(() => draft && followUp && importer ? followUpSameIps(followUp.lines, draft.ipNumber) : [],
    [draft, followUp, importer]);
  const allowed = identity ? identity.roles.some(role => allowedRoles.has(role)) : false;
  const onDecisions: InvoiceAuditDecisionsUpdate = update => setDecisions(update);

  return <main className="shell">
    <PageHeader eyebrow={t.eyebrow} title={t.title}><p>{t.description}</p></PageHeader>
    {error && <p className="notice error" role="alert">{error}</p>}
    {identity && !allowed && <p className="notice warning">{t.noPermission}</p>}
    {allowed && <section className="card invoice-audit-page">
      <div className="operational-fields invoice-audit-files">
        {([[t.invoiceFile, draft?.fileName, selectInvoice], [t.followUpFile, followUp?.fileName, selectFollowUp]] as const)
          .map(([label, fileName, select]) => <FilePickerField key={label} label={label} fileName={fileName ?? null}
            chooseLabel={t.chooseFile} emptyLabel={t.noFileChosen} accept=".xlsx" disabled={Boolean(reading)}
            onSelect={event => void select(event)} />)}
      </div>
      {reading && reading !== "download" && <p role="status">{t.reading}</p>}
      {draft && <p className="notice invoice-summary" role="status">{t.invoiceRead(draft.fileName, draft.lines.length, draft.ipNumber)}</p>}
      {followUp && <p className="muted">{t.followUpRead(followUp.fileName, followUp.lines.length, followUp.cancelled)}</p>}
      {!reference && !referenceFailed && <p role="status">{t.referenceLoading}</p>}
      {referenceFailed && <p className="notice error" role="alert">{t.referenceError}</p>}
      {database && <p className="muted">{t.databaseRead(database.fileName, database.products.length,
        formatUsDateTime(database.loadedAt), database.loadedBy)}</p>}
      {manufacturerList && <p className="muted">{t.manufacturerRead(manufacturerList.fileName,
        manufacturerList.manufacturers.length, formatUsDateTime(manufacturerList.loadedAt), manufacturerList.loadedBy)}</p>}
      {draft && followUp && importers.length === 0 && <p className="notice error" role="alert">{t.noImporter}</p>}
      {draft && followUp && importers.length > 1 && <label className="invoice-audit-importer">{t.importer}
        <select value={importer} onChange={event => { setImporterChoice(event.target.value); setDecisions(invoiceAuditPathReset); }}>
          <option value="">{t.chooseImporter}</option>
          {importers.map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>}
      {ready && source && <>
        <p className="muted">{t.importerShown(importer, draft!.importerCnpj || t.notIdentified)}</p>
        <p className="muted">{sameIps.length ? t.sameIps(sameIps.join(", ")) : t.noSameIp}</p>
        <InvoiceAuditReview draft={draft!} bytes={invoice!.bytes} source={source} reference={reference} importer={importer}
          user={identity?.name ?? ""} decisions={decisions} onDecisions={onDecisions}
          onBusy={busy => setReading(busy ? "download" : "")}
          summary={{ kind: "followUp", fileName: followUp!.fileName, fileSha256: followUp!.fileSha256, sameIps }} />
      </>}
    </section>}
  </main>;
}
