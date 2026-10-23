"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { statusLabel } from "../lib/i18n/labels";
import { useI18n } from "./I18nProvider";
import PageHeader from "./PageHeader";
import { emptyProcessDirectoryFilters, parseProcessDirectoryFilters, processCalculatedStatuses, processDirectoryQuery,
  type ProcessDirectoryFilters, type ProcessDirectoryRecordStatus } from "../lib/ip-lifecycle";

type Process = { id: string; ipNumber: string; importer: string; logisticsStatus: string | null; calculatedStatus?: string; lifecycleStatus?: "OPEN" | "CLOSED"; recordStatus?: "DRAFT" | "ACTIVE" | "CANCELLED" | "DELETED"; qualityStatus: string; purchaseOrderCount: number; historicalLineCount: number; operationalAllocationCount: number; historicalCostCount: number };
type Page = { page: number; pageSize: number; totalCount: number; items: Process[] };
const empty = emptyProcessDirectoryFilters;
type Filters = ProcessDirectoryFilters;

export default function ProcessDirectory() {
  const { m, messages } = useI18n();
  const t = m.processDirectory;
  const [draft, setDraft] = useState<Filters>(empty);
  const [filters, setFilters] = useState<Filters>(empty);
  const [page, setPage] = useState(1);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<Page>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [compatibilityWarning, setCompatibilityWarning] = useState("");
  const [retry, setRetry] = useState(0);
  const [roles, setRoles] = useState<string[]>([]);

  useEffect(() => {
    apiFetch("/auth/me").then(async response => {
      if (response.ok) setRoles((await response.json() as { roles: string[] }).roles);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initial = parseProcessDirectoryFilters(params);
    const number = Number(params.get("page"));
    setDraft(initial); setFilters(initial); setPage(Number.isSafeInteger(number) && number > 0 ? number : 1); setReady(true);
  }, []);

  function query(nextFilters: Filters, nextPage: number) {
    return processDirectoryQuery(nextFilters, nextPage);
  }
  function navigate(nextFilters: Filters, nextPage: number) {
    setFilters(nextFilters); setPage(nextPage);
    window.history.replaceState(null, "", `/processes?${query(nextFilters, nextPage)}`);
  }
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController(); setLoading(true); setError(undefined); setData(undefined);
    apiFetch(`/api/v1/processes?${query(filters, page)}`, { signal: controller.signal })
      .then(async response => {
        const text = messages();
        if (response.status === 401) throw new Error(text.common.sessionExpired);
        if (response.status === 403) throw new Error(text.processDirectory.forbidden);
        if (!response.ok) throw new Error(text.processDirectory.loadFailed);
        return response.json() as Promise<Page>;
      })
      .then(value => {
        if (!Array.isArray(value.items)) throw new Error(messages().processDirectory.noList);
        if (!controller.signal.aborted) {
          setCompatibilityWarning(value.items.some(item =>
            (item.lifecycleStatus !== "OPEN" && item.lifecycleStatus !== "CLOSED") || !item.recordStatus)
            ? messages().processDirectory.outdated : "");
          setData(value);
        }
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : messages().common.unexpectedError); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, messages, page, ready, retry]);

  function apply(event: FormEvent<HTMLFormElement>) { event.preventDefault(); navigate(draft, 1); }
  const pages = data ? Math.ceil(data.totalCount / 50) : 0;
  const returnPath = `/processes?${query(filters, page)}`;
  return <main className="shell">
    <PageHeader eyebrow={t.eyebrow} title={t.title}
      actions={roles.some(role => ["Master", "Administrador", "Importação"].includes(role))
        && <Link className="button" href="/processes/new">{t.create}</Link>}>
      <p>{t.intro}</p>
    </PageHeader>
    <section className="card"><form className="portfolio-filter" onSubmit={apply}>
      <label>IP<input value={draft.ipNumber} onChange={event => setDraft({ ...draft, ipNumber: event.target.value })} placeholder="NH-017/2025" /></label>
      <label>{t.importer}<input value={draft.importer} onChange={event => setDraft({ ...draft, importer: event.target.value })} /></label>
      <label>{m.calc.status}<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as ProcessDirectoryFilters["status"] })}>
        <option value="">{t.all}</option>
        {processCalculatedStatuses.map(status => <option key={status} value={status}>{statusLabel(m, status)}</option>)}
      </select></label>
      <label>{t.quality}<input value={draft.qualityStatus} onChange={event => setDraft({ ...draft, qualityStatus: event.target.value })} /></label>
      <label>{t.situation}<select value={draft.recordStatus} onChange={event => setDraft({ ...draft, recordStatus: event.target.value as ProcessDirectoryRecordStatus })}>
        <option value="">{t.defaultSituation}</option>
        <option value="active">{t.active}</option><option value="draft">{t.drafts}</option>
        <option value="cancelled">{t.cancelled}</option><option value="deleted">{t.deleted}</option>
        <option value="all">{t.all}</option>
      </select></label>
      <button className="button">{t.filter}</button><button type="button" className="button secondary" onClick={() => { setDraft(empty); navigate(empty, 1); }}>{t.clear}</button>
    </form></section>
    <section className="card" aria-live="polite">
      {loading && <p role="status">{t.loading}</p>}
      {error && <div className="notice error" role="alert"><p>{error}</p><button className="button" onClick={() => setRetry(value => value + 1)}>{m.common.retry}</button></div>}
      {compatibilityWarning && <p className="notice warning" role="status">{compatibilityWarning}</p>}
      {!loading && !error && data && <><p>{t.found(data.totalCount)}{pages > 0 && t.pageSuffix(page, pages)}</p>
        {data.items.length === 0 && <p>{data.totalCount ? t.outOfRange : t.none}</p>}
        {data.items.length > 0 && <div className="table-scroll"><table><thead><tr><th>IP</th><th>{t.record}</th><th>{t.importer}</th><th>{m.calc.status}</th><th>{t.cycle}</th><th>{t.quality}</th><th>POs</th><th>{t.allocations}</th><th>{t.sourceLines}</th><th>{t.historicalCosts}</th><th></th></tr></thead><tbody>
          {data.items.map(item => <tr key={item.id}><td>{item.ipNumber}</td><td>{item.recordStatus === "DRAFT" || item.recordStatus === "CANCELLED" || item.recordStatus === "DELETED" ? m.processWorkspace.record[item.recordStatus] : m.processWorkspace.record.ACTIVE}</td><td>{item.importer}</td><td>{item.calculatedStatus ? statusLabel(m, item.calculatedStatus) : item.logisticsStatus ?? m.common.notInformed}</td><td>{item.lifecycleStatus === "CLOSED" || item.lifecycleStatus === "OPEN" ? m.processWorkspace.cycle[item.lifecycleStatus] : m.processWorkspace.cycle.UNAVAILABLE}</td><td>{item.qualityStatus}</td><td>{item.purchaseOrderCount}</td><td>{item.operationalAllocationCount}</td><td>{item.historicalLineCount}</td><td>{item.historicalCostCount}</td><td><Link className="button" aria-label={t.openAria(item.ipNumber)} href={`/processes/${item.id}?return=${encodeURIComponent(returnPath)}`}>{t.open}</Link></td></tr>)}
        </tbody></table></div>}
        {pages > 1 && <nav className="pagination"><button className="button secondary" disabled={page <= 1} onClick={() => navigate(filters, page - 1)}>{m.common.previous}</button><span>{m.common.pageOf(page, pages)}</span><button className="button" disabled={page >= pages} onClick={() => navigate(filters, page + 1)}>{m.common.next}</button></nav>}
      </>}
    </section>
  </main>;
}
