"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { automaticAuditReason } from "../../lib/audit";
import { formatUsDate, formatUsDateTime, parseUsDate } from "../../lib/date-format";
import type { ProductPriceReference } from "../../lib/product-price-reference";
import { getMessages, useI18n } from "../../components/I18nProvider";
import { SearchableSelect } from "../../components/SearchableSelect";

type Resource = "products" | "ncms";
type Candidate = { rawCode: string; observationCount: number;
  sampleSourceRowId: string; sampleSheetName: string; sampleRowNumber: number; eligibleFormat: boolean };
type Entry = { id: string; importer: string | null; code: string; name: string; status: string;
  evidence: string; validFrom: string | null; validTo: string | null; version: string; provenance: string;
  referencePrices?: ProductPriceReference[]; latestTotvsDescription?: string | null };
type PriceHistoryEntry = ProductPriceReference & { id: string; purchaseOrderItemId: string; actor: string | null };
type PriceHistoryPage = { page: number; pageSize: number; totalCount: number; items: PriceHistoryEntry[] };
type AuditEvent = { id: string; operation: string; fieldName: string | null; oldValue: unknown;
  newValue: unknown; actor: string; occurredAt: string; reason: string | null };
type AuditPage = { page: number; pageSize: number; totalCount: number; items: AuditEvent[] };
type Page<T> = { page: number; totalCount: number; items: T[] };
const resources: Resource[] = ["products", "ncms"];

async function responseJson<T>(response: Response): Promise<T> {
  const t = getMessages();
  if (response.status === 401) throw new Error(t.common.sessionExpired);
  if (response.status === 403) throw new Error(t.catalog.forbidden);
  if (response.status === 404) throw new Error(t.catalog.notFound);
  if (response.status === 409) throw new Error(t.catalog.conflict);
  if (!response.ok) throw new Error(t.catalog.failed);
  return await response.json() as T;
}

export default function CatalogPage() {
  const { m } = useI18n();
  const t = m.catalog;
  const labels = t.resources;
  const [resource, setResource] = useState<Resource>("products");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [registered, setRegistered] = useState<Page<Entry>>();
  const [candidates, setCandidates] = useState<Page<Candidate>>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [draft, setDraft] = useState({ code: "", name: "", evidence: "", validFrom: "" });
  const [editing, setEditing] = useState<Entry>();
  const [historyEntry, setHistoryEntry] = useState<Entry>();
  const [history, setHistory] = useState<AuditPage>();
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const historyRequest = useRef(0);
  const priceHistoryRequest = useRef(0);
  const [priceHistoryEntry, setPriceHistoryEntry] = useState<Entry>();
  const [priceHistory, setPriceHistory] = useState<PriceHistoryPage>();
  const [priceHistoryLoading, setPriceHistoryLoading] = useState(false);
  const [priceHistoryError, setPriceHistoryError] = useState("");
  const [editDraft, setEditDraft] = useState({ name: "", status: "ACTIVE", evidence: "" });

  useEffect(() => {
    apiFetch("/auth/me").then(responseJson<{ roles: string[] }>)
      .then(data => setRoles(data.roles)).catch(() => undefined);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(undefined); setRegistered(undefined); setCandidates(undefined);
    const query = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (search) query.set("search", search);
    Promise.all([
      apiFetch("/api/v1/" + resource + "?" + query, { signal: controller.signal }).then(responseJson<Page<Entry>>),
      apiFetch("/api/v1/" + resource + "/candidates?" + query, { signal: controller.signal }).then(responseJson<Page<Candidate>>),
    ]).then(([entries, source]) => { if (!controller.signal.aborted) { setRegistered(entries); setCandidates(source); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : getMessages().catalog.loadFailed); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [resource, search, page, refresh]);

  function chooseResource(next: Resource) { historyRequest.current += 1; priceHistoryRequest.current += 1; setHistoryLoading(false); setPriceHistoryLoading(false); setResource(next); setPage(1); setDraft({ code: "", name: "", evidence: "", validFrom: "" }); setEditing(undefined); setHistoryEntry(undefined); setHistory(undefined); setPriceHistoryEntry(undefined); setPriceHistory(undefined); }
  function chooseCandidate(candidate: Candidate) {
    setDraft({ code: candidate.rawCode, name: "",
      evidence: t.candidateEvidence(candidate.sampleSheetName, candidate.sampleRowNumber),
      validFrom: "" });
    document.getElementById("catalog-create")?.scrollIntoView({ behavior: "smooth" });
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(undefined); setMessage(undefined);
    const validFrom = resource === "ncms" ? parseUsDate(draft.validFrom) : null;
    if (resource === "ncms" && !validFrom) {
      setError(t.invalidDate); setSaving(false); return;
    }
    try {
      const response = await apiFetch(`/api/v1/${resource}`, { method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(resource === "products" ? { code: draft.code, name: draft.name }
          : { code: draft.code, name: draft.name, evidence: draft.evidence, reason: automaticAuditReason, validFrom }) });
      await responseJson<Entry>(response);
      setDraft({ code: "", name: "", evidence: "", validFrom: "" });
      setMessage(t.registered);
      setPage(1); setRefresh(value => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t.saveFailed); }
    finally { setSaving(false); }
  }
  function startEdit(entry: Entry) {
    setEditing(entry); setEditDraft({ name: entry.name, status: entry.status, evidence: entry.evidence });
  }
  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return;
    setSaving(true); setError(undefined); setMessage(undefined);
    try {
      const response = await apiFetch(`/api/v1/${resource}/${editing.id}`, { method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Record-Version": editing.version },
        body: JSON.stringify({ ...editDraft, reason: automaticAuditReason }) });
      await responseJson<Entry>(response);
      setEditing(undefined); setMessage(t.updated); setRefresh(value => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t.updateFailed); }
    finally { setSaving(false); }
  }
  async function loadHistory(entry: Entry, nextPage = 1) {
    const requestId = ++historyRequest.current;
    setHistoryEntry(entry); setHistoryLoading(true); setHistoryError("");
    try {
      const query = new URLSearchParams({ page: String(nextPage), pageSize: "25" });
      const response = await apiFetch(`/api/v1/${resource}/${entry.id}/history?${query}`);
      const data = await responseJson<AuditPage>(response);
      if (historyRequest.current === requestId) setHistory(data);
    } catch (reason) {
      if (historyRequest.current === requestId) {
        setHistory(undefined);
        setHistoryError(reason instanceof Error ? reason.message : t.historyFailed);
      }
    } finally { if (historyRequest.current === requestId) setHistoryLoading(false); }
  }

  async function loadPriceHistory(entry: Entry, nextPage = 1) {
    const requestId = ++priceHistoryRequest.current;
    setPriceHistoryEntry(entry); setPriceHistoryLoading(true); setPriceHistoryError("");
    try {
      const query = new URLSearchParams({ page: String(nextPage), pageSize: "25" });
      const response = await apiFetch(`/api/v1/products/${entry.id}/price-history?${query}`);
      const data = await responseJson<PriceHistoryPage>(response);
      if (priceHistoryRequest.current === requestId) setPriceHistory(data);
    } catch (reason) {
      if (priceHistoryRequest.current === requestId) {
        setPriceHistory(undefined);
        setPriceHistoryError(reason instanceof Error ? reason.message : t.priceHistoryFailed);
      }
    } finally { if (priceHistoryRequest.current === requestId) setPriceHistoryLoading(false); }
  }

  const canWrite = roles.includes("Master") || roles.includes("Administrador")
    || roles.includes(resource === "ncms" ? "Fiscal" : "Compras");
  const canRegisterPo = roles.some(role => ["Master", "Administrador", "Importação", "Compras"].includes(role));
  const canRegisterIp = roles.some(role => ["Master", "Administrador", "Importação"].includes(role));
  return <main className="shell">
    <header className="page-header"><p className="eyebrow">ERP Comex</p><h1>{t.title}</h1>
      <div className="catalog-links"><Link className="text-link" href="/">{m.common.backToPortfolio}</Link></div></header>
    <section className="card" aria-labelledby="registration-options-title">
      <h2 id="registration-options-title">{t.newEntry}</h2>
      <nav className="catalog-links" aria-label={t.entryTypes}>
        <Link className="button secondary" href={canWrite ? "#catalog-create" : "#catalog-controls"}>{t.productsAndNcm}</Link>
        <Link className="button secondary" href="/catalog/values">{t.entityValues}</Link>
        {canRegisterPo && <Link className="button secondary" href="/purchase-orders/new">{t.registerPo}</Link>}
        {canRegisterIp && <Link className="button secondary" href="/processes/new?from=catalog">{t.registerIp}</Link>}
      </nav>
    </section>
    <section className="card catalog-controls" id="catalog-controls">
      <div role="group" aria-label={t.entryType}>{resources.map(key =>
        <button type="button" key={key} className={`button ${resource === key ? "" : "secondary"}`} onClick={() => chooseResource(key)}>{labels[key]}</button>)}</div>
      <label>{t.search}<input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
    </section>
    {error && <div className="notice error" role="alert">{error} <button className="button" type="button" onClick={() => setRefresh(value => value + 1)}>{m.common.retry}</button></div>}
    {message && <p className="notice" role="status">{message}</p>}
    {loading && <p role="status">{t.loading}</p>}
    {!loading && !error && <>
      <section className="card"><h2>{t.registeredTitle(labels[resource])}</h2>
        <p className="muted">{t.records(registered?.totalCount ?? 0)}</p>
        {registered?.items.length === 0 && <p>{t.none}</p>}
        {!!registered?.items.length && <div className="table-scroll"><table className="catalog-entry-table"><thead><tr><th>{t.code}</th><th>{t.name}</th>{resource === "products" && <th>{t.referencePrice}</th>}<th>{t.status}</th><th>{t.validity}</th><th>{t.version}</th><th>{m.poPanel.action}</th></tr></thead><tbody>
          {registered.items.map(entry => <tr key={entry.id}><td>{entry.code}</td><td className="catalog-entry-name">{entry.name}</td>
            {resource === "products" && <td>{entry.referencePrices?.length
              ? entry.referencePrices.map(reference => `${formatNumber(reference.unitPrice)} ${reference.currency}`).join(" · ")
              : <span className="muted">{t.noReference}</span>}</td>}
            <td>{entry.status === "ACTIVE" ? t.active : t.inactive}</td>
            <td>{formatUsDate(entry.validFrom) || "—"}{entry.validTo ? t.validTo(formatUsDate(entry.validTo)) : ""}</td><td>{entry.version}</td>
            <td><button className="button secondary" type="button" aria-label={t.historyAria(labels[resource].toLowerCase(), entry.code)} disabled={historyLoading} onClick={() => void loadHistory(entry)}>{t.history}</button>
              {resource === "products" && <button className="button secondary" type="button" aria-label={t.pricesAria(entry.code)} disabled={priceHistoryLoading} onClick={() => void loadPriceHistory(entry)}>{t.prices}</button>}
              {canWrite && <button className="button secondary" type="button" aria-label={t.editAria(labels[resource].toLowerCase(), entry.code)} onClick={() => startEdit(entry)}>{t.edit}</button>}</td></tr>)}
        </tbody></table></div>}
      </section>
      {priceHistoryEntry && <section className="card request-history" aria-label={t.priceHistoryAria(priceHistoryEntry.code)}>
        <div className="quality-heading"><h2>{t.pricesTitle(priceHistoryEntry.code, priceHistoryEntry.name)}</h2>
          <button className="button secondary" type="button" onClick={() => { priceHistoryRequest.current += 1; setPriceHistoryLoading(false); setPriceHistoryEntry(undefined); setPriceHistory(undefined); }}>{t.close}</button></div>
        {priceHistoryError && <p className="notice error" role="alert">{priceHistoryError}</p>}
        {priceHistoryLoading && <p role="status">{t.priceHistoryLoading}</p>}
        {!priceHistoryLoading && priceHistory && <>
          {priceHistory.items.length === 0 && <p className="muted">{t.noPrices}</p>}
          {!!priceHistory.items.length && <div className="table-scroll"><table><thead><tr><th>{t.unitPrice}</th><th>{t.currency}</th><th>PO</th><th>{t.date}</th><th>{t.actor}</th></tr></thead><tbody>
            {priceHistory.items.map(item => <tr key={item.id}><td>{formatNumber(item.unitPrice)}</td><td>{item.currency}</td>
              <td>{item.purchaseOrderNumber}</td><td>{formatUsDateTime(item.observedAt)}</td><td>{item.actor ?? t.system}</td></tr>)}
          </tbody></table></div>}
          {priceHistory.totalCount > priceHistory.pageSize && <nav className="pagination" aria-label={t.priceHistoryPages}>
            <button className="button secondary" disabled={priceHistory.page <= 1} onClick={() => void loadPriceHistory(priceHistoryEntry, priceHistory.page - 1)}>{m.common.previous}</button>
            <span>{m.common.pageOf(priceHistory.page, Math.ceil(priceHistory.totalCount / priceHistory.pageSize))}</span>
            <button className="button" disabled={priceHistory.page * priceHistory.pageSize >= priceHistory.totalCount} onClick={() => void loadPriceHistory(priceHistoryEntry, priceHistory.page + 1)}>{m.common.next}</button>
          </nav>}
        </>}
      </section>}
      {historyEntry && <section className="card request-history" aria-label={t.historyEntryAria(historyEntry.code)}>
        <div className="quality-heading"><h2>{t.historyTitle(historyEntry.code, historyEntry.name)}</h2>
          <button className="button secondary" type="button" onClick={() => { historyRequest.current += 1; setHistoryLoading(false); setHistoryEntry(undefined); setHistory(undefined); }}>{t.close}</button></div>
        {historyError && <p className="notice error" role="alert">{historyError}</p>}
        {historyLoading && <p role="status">{t.historyLoading}</p>}
        {!historyLoading && history && <>
          {history.items.length === 0 && <p className="muted">{t.noHistory}</p>}
          <ol className="request-history-list">{history.items.map(event => <li key={event.id}>
            <strong>{event.fieldName ?? event.operation}</strong>
            <span className="muted">{event.actor} · {formatUsDateTime(event.occurredAt)}</span>
            <p>{t.beforeAfter(formatAuditValue(event.oldValue), formatAuditValue(event.newValue))}</p>
          </li>)}</ol>
          {history.totalCount > history.pageSize && <nav className="pagination" aria-label={t.historyPages}>
            <button className="button secondary" disabled={history.page <= 1} onClick={() => void loadHistory(historyEntry, history.page - 1)}>{m.common.previous}</button>
            <span>{m.common.pageOf(history.page, Math.ceil(history.totalCount / history.pageSize))}</span>
            <button className="button" disabled={history.page * history.pageSize >= history.totalCount} onClick={() => void loadHistory(historyEntry, history.page + 1)}>{m.common.next}</button>
          </nav>}
        </>}
      </section>}
      <details className="card catalog-candidates"><summary>{t.candidates} <span>{candidates?.totalCount ?? 0}</span></summary><p className="muted">{t.candidatesFound(candidates?.totalCount ?? 0)}</p>
        {candidates?.items.length === 0 && <p>{t.noCandidates}</p>}
        {!!candidates?.items.length && <div className="table-scroll"><table><thead><tr><th>{t.literalValue}</th><th>{t.observations}</th><th>{t.source}</th><th>{m.poPanel.action}</th></tr></thead><tbody>
          {candidates.items.map((value, index) => <tr key={`${value.rawCode}-${index}`}><td>{value.rawCode}</td><td>{value.observationCount}</td><td>{t.sourceRow(value.sampleSheetName, value.sampleRowNumber)}</td>
            <td>{value.eligibleFormat ? canWrite && <button className="button secondary" type="button" onClick={() => chooseCandidate(value)}>{t.prepareReview}</button> : t.invalidFormat}</td></tr>)}
        </tbody></table></div>}
      </details>
      <nav className="pagination" aria-label={t.pages}><button className="button secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{m.common.previous}</button><span>{t.page(page)}</span><button className="button" disabled={Math.max(registered?.totalCount ?? 0, candidates?.totalCount ?? 0) <= page * 25} onClick={() => setPage(page + 1)}>{m.common.next}</button></nav>
    </>}
    {canWrite && <section className="card" id="catalog-create"><h2>{t.register(labels[resource].toLowerCase())}</h2>
      <p className="muted">{t.registerHelp}</p>
      <form className="stack-form" onSubmit={event => void create(event)}>
        <label>{resource === "products" ? t.productCode : t.ncmCode}<input required maxLength={resource === "products" ? 120 : 8} pattern={resource === "ncms" ? "[0-9]{8}" : undefined} value={draft.code} onChange={event => setDraft(value => ({ ...value, code: event.target.value }))} /></label>
        <label>{resource === "products" ? t.productDescription : t.ncmDescription}<input required maxLength={2000} value={draft.name} onChange={event => setDraft(value => ({ ...value, name: event.target.value }))} /></label>
        {resource === "ncms" && <label>{t.validFrom}<input required type="text" inputMode="numeric" maxLength={10} pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}" placeholder="MM/DD/YYYY" value={draft.validFrom} onChange={event => setDraft(value => ({ ...value, validFrom: event.target.value }))} /></label>}
        {resource === "ncms" && <label>{t.reviewEvidence}<textarea required minLength={8} maxLength={2000} value={draft.evidence} onChange={event => setDraft(value => ({ ...value, evidence: event.target.value }))} placeholder={t.evidencePlaceholder} /></label>}
        <button className="button" disabled={saving} type="submit">{saving ? t.saving : t.registerEntry}</button>
      </form>
    </section>}
    {editing && <section className="card"><h2>{t.editTitle(editing.code)}</h2><p className="muted">{t.editHelp(editing.version)}</p>
      <form className="stack-form" onSubmit={event => void saveEdit(event)}>
        <label>{t.name}<input required maxLength={2000} value={editDraft.name} onChange={event => setEditDraft(value => ({ ...value, name: event.target.value }))} /></label>
        <label>{t.status}<SearchableSelect ariaLabel={t.status} placeholder="" value={editDraft.status}
          onChange={status => setEditDraft(value => ({ ...value, status }))}
          options={[{ value: "ACTIVE", label: t.active }, { value: "INACTIVE", label: t.inactive }]} /></label>
        {resource === "ncms" && <label>{t.evidence}<textarea required minLength={8} value={editDraft.evidence} onChange={event => setEditDraft(value => ({ ...value, evidence: event.target.value }))} /></label>}
        <div><button className="button" disabled={saving} type="submit">{t.saveChange}</button><button className="button secondary" type="button" onClick={() => setEditing(undefined)}>{t.cancel}</button></div>
      </form></section>}
  </main>;
}

function formatAuditValue(value: unknown): string {
  if (value == null) return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function formatNumber(value: string): string {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 8 }).format(number) : value;
}
