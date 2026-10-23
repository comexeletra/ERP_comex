"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { formatUsDateTime } from "../../lib/date-format";
import { canWriteRequests } from "../../lib/request-permissions";
import { getMessages, useI18n } from "../../components/I18nProvider";
import PageHeader from "../../components/PageHeader";
import { SearchableSelect } from "../../components/SearchableSelect";
import { loadOperationalOptions, OperationalOption, OperationalOptionSelect } from "../../components/OperationalOptionSelect";

type RequestLine = { id: string; lineNumber: number; description: string; purposeText: string | null; costCenterText: string | null };
type ImportRequest = { id: string; requestNumber: string; importer: string; requesterReference: string;
  notes: string; status: string; version: string; itemCount: number; items?: RequestLine[]; createdAt: string };
type RequestPage = { page: number; pageSize: number; totalCount: number; items: ImportRequest[] };
type DraftLine = { description: string; purposeText: string; costCenterText: string };
const blankLine = (): DraftLine => ({ description: "", purposeText: "", costCenterText: "" });

export default function RequestsPage() {
  const { m } = useI18n();
  const t = m.requests;
  const [roles, setRoles] = useState<string[]>([]);
  const [importers, setImporters] = useState<Array<{ code: string }>>([]);
  const [requests, setRequests] = useState<ImportRequest[]>([]);
  const [options, setOptions] = useState<OperationalOption[]>([]);
  const [importer, setImporter] = useState("");
  const [requesterReference, setRequesterReference] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<"new" | "list">("new");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [identityResponse, importerResponse, requestResponse, optionValues] = await Promise.all([
        apiFetch("/auth/me"), apiFetch("/api/v1/importers", { cache: "no-store" }),
        apiFetch(`/api/v1/requests?page=${page}&pageSize=25`), loadOperationalOptions(),
      ]);
      if (!identityResponse.ok || !importerResponse.ok || !requestResponse.ok) {
        const response = !identityResponse.ok ? identityResponse : !importerResponse.ok ? importerResponse : requestResponse;
        const text = getMessages();
        throw new Error(response.status === 401 ? text.common.sessionExpired
          : response.status === 403 ? text.requests.noAccess : text.requests.loadFailed);
      }
      const identity = await identityResponse.json() as { roles: string[] };
      const importerData = await importerResponse.json() as { items: Array<{ code: string }> };
      const requestData = await requestResponse.json() as RequestPage;
      setRoles(identity.roles);
      setOptions(optionValues);
      setImporters(importerData.items); setRequests(requestData.items); setTotalCount(requestData.totalCount);
    } catch (cause) { setError(cause instanceof Error ? cause.message : getMessages().common.unexpectedError); }
    finally { setLoading(false); }
  }, [importer, page]);

  useEffect(() => { void load(); }, [load, reload]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/v1/requests", {
        method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ importer, requesterReference, reason, notes,
          items: lines.map(line => ({ description: line.description, purposeText: line.purposeText || null,
            costCenterText: line.costCenterText || null })) }),
      });
      const data = await response.json() as ImportRequest & { detail?: string };
      if (!response.ok) throw new Error(data.detail || t.registerFailed);
      setNotice(t.registered(data.requestNumber));
      setRequesterReference(""); setReason(""); setNotes(""); setLines([blankLine()]);
      setPage(1); setReload(value => value + 1); setView("list");
    } catch (cause) { setError(cause instanceof Error ? cause.message : m.common.unexpectedError); }
    finally { setSaving(false); }
  }

  return <main className="shell">
    <PageHeader eyebrow={m.sidebar.groups.management} title={t.title}><p>{t.intro}</p></PageHeader>
    {canWriteRequests(roles) && <nav className="tabs" aria-label={t.tabs}>
      <button type="button" className={view === "new" ? "tab active" : "tab"} aria-pressed={view === "new"} onClick={() => setView("new")}>{t.newTab}</button>
      <button type="button" className={view === "list" ? "tab active" : "tab"} aria-pressed={view === "list"} onClick={() => setView("list")}>{t.listTab}</button>
    </nav>}
    {error && <div className="notice error" role="alert">{error} <button className="button secondary" type="button" onClick={() => setReload(value => value + 1)}>{m.common.retry}</button></div>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {canWriteRequests(roles) && view === "new" ? <section className="card">
      <h2>{t.newTab}</h2>
      <details className="request-guidance"><summary>{t.howTo}</summary><p>{t.howToText}</p></details>
      <form className="stack-form request-form" onSubmit={submit}>
        <label>{t.importer}<SearchableSelect ariaLabel={t.importer} required value={importer} onChange={setImporter}
          options={importers.map(value => ({ value: value.code, label: value.code }))} /></label>
        <label>{t.requester}<OperationalOptionSelect required entity="requester" value={requesterReference}
          values={options} onChange={setRequesterReference} /></label>
        <label>{t.reason}<textarea required minLength={8} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <label>{t.notes}<textarea maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
        <h3>{t.items}</h3>
        {lines.map((line, index) => <fieldset className="request-line" key={index}>
          <legend>{t.item(index + 1)}</legend>
          <label>{t.description}<textarea required maxLength={1000} value={line.description}
            onChange={event => setLines(current => current.map((item, i) => i === index ? { ...item, description: event.target.value } : item))} /></label>
          <div className="catalog-controls">
            <label>{t.purpose}<OperationalOptionSelect entity="purpose" value={line.purposeText}
              values={options} onChange={purposeText => setLines(current => current.map((item, i) => i === index ? { ...item, purposeText } : item))} /></label>
            <label>{t.costCenter}<OperationalOptionSelect entity="cost_center" value={line.costCenterText}
              values={options} onChange={costCenterText => setLines(current => current.map((item, i) => i === index ? { ...item, costCenterText } : item))} /></label>
          </div>
          {lines.length > 1 && <button className="button secondary" type="button" aria-label={t.removeItemAria(index + 1)} onClick={() => setLines(current => current.filter((_, i) => i !== index))}>{t.removeItem}</button>}
        </fieldset>)}
        {lines.length < 100 && <button className="button secondary" type="button" onClick={() => setLines(current => [...current, blankLine()])}>{t.addItem}</button>}
        <button className="button" disabled={saving || !importer}>{saving ? t.registering : t.register}</button>
      </form>
    </section> : !canWriteRequests(roles) ? <p className="notice">{t.readOnly}</p> : null}
    {(view === "list" || !canWriteRequests(roles)) && <section className="card" aria-live="polite">
      <h2>{t.recent}</h2>
      {loading && <p role="status">{t.loading}</p>}
      {!loading && !error && requests.length === 0 && <p>{t.none}</p>}
      {!loading && !error && totalCount > 0 && <nav className="pagination" aria-label={t.pagination}>
        <span className="muted">{t.countPage(totalCount, page, Math.ceil(totalCount / 25))}</span>
        <button className="button secondary" type="button" disabled={page <= 1}
          onClick={() => setPage(value => Math.max(1, value - 1))}>{m.common.previous}</button>
        <button className="button secondary" type="button" disabled={page >= Math.ceil(totalCount / 25)}
          onClick={() => setPage(value => Math.min(Math.ceil(totalCount / 25), value + 1))}>{m.common.next}</button>
      </nav>}
      {!loading && requests.length > 0 && <div className="table-scroll"><table>
        <thead><tr><th>{t.number}</th><th>{t.importer}</th><th>{t.requesterShort}</th><th>{t.itemsShort}</th><th>{t.status}</th><th>{t.date}</th><th>{t.action}</th></tr></thead>
        <tbody>{requests.map(item => <tr key={item.id}><td><strong>{item.requestNumber}</strong></td><td>{item.importer}</td>
          <td>{item.requesterReference}</td><td>{item.itemCount}</td><td>{(t.statuses as Record<string, string>)[item.status] ?? item.status}</td>
          <td>{formatUsDateTime(item.createdAt)}</td><td><Link className="button" aria-label={t.openAria(item.requestNumber)} href={`/requests/${item.id}`}>{t.open}</Link></td></tr>)}</tbody>
      </table></div>}
    </section>}
  </main>;
}
