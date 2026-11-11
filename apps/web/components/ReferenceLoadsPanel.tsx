"use client";

import { type ChangeEvent, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { parseManufacturerListXlsx, parseProductDatabaseXlsx } from "../lib/audit-reference-xlsx";
import { formatUsDateTime } from "../lib/date-format";
import type { Messages } from "../lib/i18n/pt-BR";
import { manufacturerListPayload, productDatabasePayload, registrableNcms, type ManufacturerLoadSummary, type PendingNcm,
  type ProductLoadSummary, type ReferenceLoadKind, type ReferenceLoadMeta, type ReferenceLoadPayload,
  type ReferenceLoadPreview, type ReferenceLoadResult } from "../lib/reference-loads";
import FilePickerField from "./FilePickerField";
import { getMessages, useI18n } from "./I18nProvider";
import PageHeader from "./PageHeader";

const managerRoles = new Set(["Master", "Administrador"]); // i18n-ignore: role values from the API
const kinds: ReferenceLoadKind[] = ["PRODUCT_DATABASE", "MANUFACTURER_LIST"];
type Latest = Record<ReferenceLoadKind, ReferenceLoadMeta | null>;
type Draft = { payload: ReferenceLoadPayload; preview: ReferenceLoadPreview };

async function failure(response: Response): Promise<Error> {
  const body = await response.json().catch(() => ({})) as { detail?: string };
  return new Error(body.detail || getMessages().common.unexpectedError);
}
const message = (cause: unknown) => cause instanceof Error ? cause.message : getMessages().common.unexpectedError;

/**
 * Loads of the product DATABASE and of the manufacturer list (stage 1f, docs/PLANO_AUDITORIA_INVOICE_AVULSA.md):
 * the spreadsheet is read in the browser, the API previews what changes and saves the load on confirmation.
 */
export default function ReferenceLoadsPanel() {
  const { m } = useI18n();
  const t = m.referenceLoads;
  const [roles, setRoles] = useState<string[] | null>(null);
  const [latest, setLatest] = useState<Latest | null>(null);
  const [pendingNcms, setPendingNcms] = useState<PendingNcm[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<"" | "reading" | "saving" | "ncms">("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tick, setTick] = useState(0);
  const manager = roles ? roles.some(role => managerRoles.has(role)) : false;

  useEffect(() => {
    let active = true;
    apiFetch("/auth/me").then(async response => {
      if (!response.ok) throw await failure(response);
      const user = await response.json() as { roles: string[] };
      if (!active) return;
      setRoles(user.roles);
      if (!user.roles.some(role => managerRoles.has(role))) return;
      const [loads, ncms] = await Promise.all([apiFetch("/api/v1/reference-loads"),
        apiFetch("/api/v1/reference-loads/pending-ncms")]);
      if (!loads.ok) throw await failure(loads);
      if (!ncms.ok) throw await failure(ncms);
      const body = await loads.json() as { productDatabase: ReferenceLoadMeta | null; manufacturerList: ReferenceLoadMeta | null };
      const pending = await ncms.json() as { ncms: PendingNcm[] };
      if (!active) return;
      setLatest({ PRODUCT_DATABASE: body.productDatabase, MANUFACTURER_LIST: body.manufacturerList });
      setPendingNcms(pending.ncms);
    }).catch(cause => { if (active) setError(message(cause) || getMessages().referenceLoads.loadError); });
    return () => { active = false; };
  }, [tick]);

  async function select(kind: ReferenceLoadKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
    if (!file) return;
    setError(""); setNotice(""); setDraft(null); setBusy("reading");
    try {
      const payload = kind === "PRODUCT_DATABASE"
        ? productDatabasePayload(await parseProductDatabaseXlsx(file, getMessages()))
        : manufacturerListPayload(await parseManufacturerListXlsx(file, getMessages()));
      const response = await apiFetch("/api/v1/reference-loads/preview", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) throw await failure(response);
      setDraft({ payload, preview: await response.json() as ReferenceLoadPreview });
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(""); }
  }

  async function confirm() {
    if (!draft) return;
    setError(""); setNotice(""); setBusy("saving");
    try {
      const response = await apiFetch("/api/v1/reference-loads", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify(draft.payload) });
      if (!response.ok) throw await failure(response);
      const result = await response.json() as ReferenceLoadResult;
      const texts = getMessages().referenceLoads;
      setNotice(result.alreadyLoaded ? texts.alreadyLoaded : texts.saved(draft.payload.fileName));
      setDraft(null); setTick(current => current + 1);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(""); }
  }

  async function registerNcms() {
    const codes = registrableNcms(pendingNcms);
    setError(""); setNotice(""); setBusy("ncms");
    const texts = getMessages().referenceLoads;
    let registered = 0;
    const failures: string[] = [];
    for (const code of codes) {
      setProgress(texts.registeringNcm(code));
      try {
        const response = await apiFetch("/api/v1/ncms/import-official", { method: "POST",
          headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ code }) });
        if (response.ok) { registered += 1; continue; }
        const body = await response.json().catch(() => ({})) as { code?: string; detail?: string };
        if (body.code === "NCM_ALREADY_REGISTERED") continue; // i18n-ignore: API error code
        failures.push(texts.ncmFailed(code, body.detail || getMessages().common.unexpectedError));
      } catch (cause) { failures.push(texts.ncmFailed(code, message(cause))); }
    }
    setProgress(""); setBusy("");
    setNotice(texts.ncmsRegistered(registered));
    if (failures.length) setError(failures.join(" "));
    setTick(current => current + 1);
  }

  return <main className="shell">
    <PageHeader back={{ href: "/catalog", label: m.entityValues.allEntries }} eyebrow={m.sidebar.groups.management} title={t.title}>
      <p>{t.intro}</p>
    </PageHeader>
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {roles && !manager && <p className="notice warning">{t.noPermission}</p>}
    {manager && !latest && !error && <p role="status">{t.loading}</p>}
    {manager && latest && kinds.map(kind => {
      const load = latest[kind];
      const current = draft?.payload.kind === kind ? draft : null;
      return <section className="card reference-load" key={kind}>
        <h2>{t.kinds[kind].title}</h2>
        <p className="muted">{t.kinds[kind].help}</p>
        <p>{load ? t.latest(load.fileName, formatUsDateTime(load.loadedAt), load.loadedBy, load.rowCount) : t.noLoad}</p>
        <FilePickerField label={t.kinds[kind].file} fileName={current?.payload.fileName ?? null} chooseLabel={t.chooseFile}
          emptyLabel={t.noFileChosen} accept=".xlsx" disabled={Boolean(busy)} onSelect={event => void select(kind, event)} />
        {busy === "reading" && <p role="status">{t.reading}</p>}
        {current && <LoadPreview t={t} draft={current} busy={Boolean(busy)} onConfirm={() => void confirm()}
          onCancel={() => setDraft(null)} />}
        {kind === "PRODUCT_DATABASE" && <PendingNcms t={t} ncms={pendingNcms} busy={Boolean(busy)} progress={progress}
          onRegister={() => void registerNcms()} />}
      </section>;
    })}
  </main>;
}

type Texts = Messages["referenceLoads"];

function LoadPreview({ t, draft, busy, onConfirm, onCancel }: { t: Texts; draft: Draft; busy: boolean;
  onConfirm: () => void; onCancel: () => void }) {
  const { preview } = draft;
  const refused = preview.refused;
  return <div className="reference-load-preview">
    <h3>{t.previewTitle}</h3>
    {preview.sameAsLatest && <p className="notice">{t.sameAsLatest}</p>}
    {refused.length > 0 && <div className="notice error" role="alert">
      <p>{t.refused(refused.length)}</p>
      <ul>{refused.slice(0, 50).map(row => <li key={`${row.sourceRow}-${row.reason}`}>
        {t.refusedRow(row.sourceRow, t.refusedReason[row.reason])}</li>)}</ul>
    </div>}
    {preview.kind === "PRODUCT_DATABASE"
      ? <ProductPreview t={t} summary={preview.summary as ProductLoadSummary} ncms={preview.ncms} />
      : <ManufacturerPreview t={t} summary={preview.summary as ManufacturerLoadSummary} />}
    <div className="button-row">
      <button className="button" type="button" disabled={busy || refused.length > 0} onClick={onConfirm}>
        {busy ? t.saving : t.confirm}</button>
      <button className="button secondary" type="button" disabled={busy} onClick={onCancel}>{t.cancel}</button>
    </div>
  </div>;
}

function ProductPreview({ t, summary, ncms }: { t: Texts; summary: ProductLoadSummary; ncms: PendingNcm[] }) {
  return <>
    <p>{t.productSummary(summary.rows, summary.updated, summary.descriptionChanged, summary.ncmFilled,
      summary.ncmChanged.length, summary.created, summary.unchanged)}</p>
    {summary.duplicated > 0 && <p className="muted">{t.duplicated(summary.duplicated)}</p>}
    {summary.createdCodes.length > 0 && <p className="muted">{t.createdCodes(summary.createdCodes.join(", "))}</p>}
    {summary.ncmChanged.length > 0 && <details>
      <summary>{t.ncmChangedTitle} ({summary.ncmChanged.length})</summary>
      <div className="table-scroll"><table>
        <thead><tr><th scope="col">{t.column.product}</th><th scope="col">{t.column.from}</th><th scope="col">{t.column.to}</th></tr></thead>
        <tbody>{summary.ncmChanged.map(row => <tr key={row.productCode}><td>{row.productCode}</td><td>{row.from}</td><td>{row.to}</td></tr>)}</tbody>
      </table></div>
    </details>}
    {ncms.length > 0 && <><NcmTable t={t} ncms={ncms} /><p className="muted">{t.ncmPreviewNote}</p></>}
  </>;
}

function ManufacturerPreview({ t, summary }: { t: Texts; summary: ManufacturerLoadSummary }) {
  return <>
    <p>{t.manufacturerSummary(summary.rows, summary.updated, summary.created, summary.unchanged, summary.withoutTotvsCode.length)}</p>
    {summary.createdCodes.length > 0 && <p className="muted">{t.createdCodes(summary.createdCodes.join(", "))}</p>}
    {summary.repeatedCodes.length > 0 && <p className="muted">{t.repeatedCodes(summary.repeatedCodes.map(row => row.code).join(", "))}</p>}
    {summary.ambiguousCodes.length > 0 && <p className="notice warning">{t.ambiguousCodes(summary.ambiguousCodes.join(", "))}</p>}
    {summary.withoutTotvsCode.length > 0 && <details>
      <summary>{t.withoutCodeTitle} ({summary.withoutTotvsCode.length})</summary>
      <div className="table-scroll"><table>
        <thead><tr><th scope="col">{t.column.row}</th><th scope="col">{t.column.code}</th><th scope="col">{t.column.name}</th></tr></thead>
        <tbody>{summary.withoutTotvsCode.map(row => <tr key={row.sourceRow}><td>{row.sourceRow}</td><td>{row.code || "—"}</td>
          <td>{row.name}</td></tr>)}</tbody>
      </table></div>
    </details>}
    {summary.nameDifferences.length > 0 && <details>
      <summary>{t.nameDifferencesTitle} ({summary.nameDifferences.length})</summary>
      <div className="table-scroll"><table>
        <thead><tr><th scope="col">{t.column.code}</th><th scope="col">{t.column.listName}</th>
          <th scope="col">{t.column.catalogName}</th></tr></thead>
        <tbody>{summary.nameDifferences.map(row => <tr key={row.code}><td>{row.code}</td><td>{row.listName}</td>
          <td>{row.catalogName}</td></tr>)}</tbody>
      </table></div>
    </details>}
  </>;
}

function NcmTable({ t, ncms }: { t: Texts; ncms: PendingNcm[] }) {
  return <div className="table-scroll"><table>
    <thead><tr><th scope="col">{t.column.ncm}</th><th scope="col">{t.column.status}</th>
      <th scope="col">{t.column.officialName}</th><th scope="col">{t.column.products}</th></tr></thead>
    <tbody>{ncms.map(ncm => <tr key={ncm.code}><td>{ncm.code}</td><td>{t.ncmStatus[ncm.status]}</td>
      <td>{ncm.officialName ?? "—"}</td><td>{ncm.products}</td></tr>)}</tbody>
  </table></div>;
}

function PendingNcms({ t, ncms, busy, progress, onRegister }: { t: Texts; ncms: PendingNcm[]; busy: boolean; progress: string;
  onRegister: () => void }) {
  const registrable = registrableNcms(ncms).length;
  return <div className="reference-load-preview">
    <h3>{t.ncmTitle}</h3>
    {ncms.length === 0 ? <p className="muted">{t.ncmNone}</p> : <>
      <NcmTable t={t} ncms={ncms} />
      {registrable > 0 && <div className="button-row">
        <button className="button" type="button" disabled={busy} onClick={onRegister}>{t.registerNcms(registrable)}</button>
      </div>}
      {progress && <p role="status">{progress}</p>}
    </>}
  </div>;
}
