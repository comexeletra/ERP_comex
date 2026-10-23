"use client";

import Link from "next/link";
import { FormEvent, Fragment, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { useI18n } from "./I18nProvider";
import PageHeader from "./PageHeader";

type Item = { id: string; sourceSheetName: string; sourceRowNumber: number; sourceValues: Record<string, unknown>; sourceColumnHeaders: Record<string, string>; importer: string; sourcePoNumber: string | null; sourceIpNumber: string | null; purchaseOrderId: string | null; poNumber: string | null; processId: string | null; ipNumber: string | null; legacyStatus: string | null; reason: string; alsoWithoutPo: boolean; alsoWithoutIp: boolean };
type Page = { page: number; pageSize: number; totalCount: number; items: Item[] };

export default function LegacyQueue({ kind }: { kind: "pending-import-items" | "unassigned-po-items" }) {
  const withoutIp = kind === "pending-import-items";
  const { m, messages } = useI18n();
  const t = m.legacyQueue;
  const pw = m.processWorkspace;
  const [draft, setDraft] = useState({ reference: "", importer: "" });
  const [filters, setFilters] = useState(draft);
  const [page, setPage] = useState(1);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<Page>();
  const [expandedItemId, setExpandedItemId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initial = { reference: params.get(withoutIp ? "poNumber" : "ipNumber") ?? "", importer: params.get("importer") ?? "" };
    const number = Number(params.get("page"));
    setDraft(initial); setFilters(initial); setPage(Number.isSafeInteger(number) && number > 0 ? number : 1); setReady(true);
  }, [withoutIp]);
  function query(nextFilters: typeof draft, nextPage: number) {
    const params = new URLSearchParams({ page: String(nextPage), pageSize: "50" });
    if (nextFilters.reference.trim()) params.set(withoutIp ? "poNumber" : "ipNumber", nextFilters.reference.trim());
    if (nextFilters.importer.trim()) params.set("importer", nextFilters.importer.trim());
    return params;
  }
  function navigate(nextFilters: typeof draft, nextPage: number) {
    setFilters(nextFilters); setPage(nextPage);
    window.history.replaceState(null, "", `/${kind}?${query(nextFilters, nextPage)}`);
  }
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController(); setLoading(true); setError(undefined); setData(undefined);
    apiFetch(`/api/v1/${kind}?${query(filters, page)}`, { signal: controller.signal })
      .then(async response => {
        const text = messages();
        if (response.status === 401) throw new Error(text.common.sessionExpired);
        if (response.status === 403) throw new Error(text.legacyQueue.forbidden);
        if (!response.ok) throw new Error(text.legacyQueue.loadFailed);
        return response.json() as Promise<Page>;
      }).then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : messages().common.unexpectedError); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, filters, messages, page, ready, retry]);
  function apply(event: FormEvent<HTMLFormElement>) { event.preventDefault(); navigate(draft, 1); }
  const pages = data ? Math.ceil(data.totalCount / 50) : 0;
  return <main className="shell">
    <PageHeader eyebrow={t.eyebrow} title={withoutIp ? t.withoutIp : t.withoutPo}
      actions={<Link className="text-link" href={withoutIp ? "/unassigned-po-items" : "/pending-import-items"}>{withoutIp ? t.seeAlsoWithoutPo : t.seeAlsoWithoutIp}</Link>}>
      <p>{t.intro}</p>
    </PageHeader>
    <section className="card"><form className="quality-filter" onSubmit={apply}>
      <label>{withoutIp ? t.sourcePo : t.sourceIp}<input value={draft.reference} onChange={event => setDraft({ ...draft, reference: event.target.value })} /></label>
      <label>{m.processDirectory.importer}<input value={draft.importer} onChange={event => setDraft({ ...draft, importer: event.target.value })} /></label>
      <button className="button">{m.processDirectory.filter}</button>
    </form></section>
    <section className="card" aria-live="polite">
      {loading && <p role="status">{m.productLines.loading}</p>}
      {error && <div className="notice error" role="alert"><p>{error}</p><button className="button" onClick={() => setRetry(value => value + 1)}>{m.common.retry}</button></div>}
      {!loading && !error && data && <><p>{m.productLines.found(data.totalCount)}{pages > 0 && m.processDirectory.pageSuffix(page, pages)}</p>
        {data.items.length === 0 && <p>{data.totalCount ? m.processDirectory.outOfRange : t.none}</p>}
        {data.items.length > 0 && <div className="table-scroll"><table><thead><tr><th>{pw.source}</th><th>{m.processDirectory.importer}</th><th>PO</th><th>IP</th><th>{t.reason}</th><th>{pw.sourceStatus}</th><th>{pw.cells}</th></tr></thead><tbody>
          {data.items.map(item => <Fragment key={item.id}><tr><td>{item.sourceSheetName} · {item.sourceRowNumber}</td><td>{item.importer}</td><td>{item.purchaseOrderId ? <Link className="text-link" href={`/purchase-orders/${item.purchaseOrderId}`}>{item.poNumber}</Link> : item.sourcePoNumber || pw.noPo}</td><td>{item.processId ? <Link className="text-link" href={`/processes/${item.processId}`}>{item.ipNumber}</Link> : item.sourceIpNumber || m.followup.noIp}</td><td>{item.reason}{item.alsoWithoutPo && withoutIp ? t.alsoWithoutPo : ""}{item.alsoWithoutIp && !withoutIp ? t.alsoWithoutIp : ""}</td><td>{item.legacyStatus ?? "—"}</td><td><button type="button" className="source-expand-button" aria-label={pw.toggleFields(expandedItemId !== item.id, item.sourceRowNumber, item.sourceSheetName)} aria-expanded={expandedItemId === item.id} onClick={() => setExpandedItemId(current => current === item.id ? undefined : item.id)}>{expandedItemId === item.id ? pw.hideFields : pw.showFields}</button></td></tr>
            {expandedItemId === item.id && <tr className="source-detail-row"><td colSpan={7}><section className="source-detail-panel"><div className="source-detail-heading"><strong>{pw.preservedFields}</strong><span>{pw.sheetRow(item.sourceSheetName, item.sourceRowNumber)}</span></div><dl className="source-field-grid">{Object.entries(item.sourceValues ?? {}).map(([column, value]) => <div className="source-field" key={column}><dt>{item.sourceColumnHeaders?.[column] || pw.noHeader}<small>{column}{item.sourceRowNumber}</small></dt><dd>{value == null ? "—" : String(value)}</dd></div>)}</dl></section></td></tr>}</Fragment>)}
        </tbody></table></div>}
        {pages > 1 && <nav className="pagination"><button className="button secondary" disabled={page <= 1} onClick={() => navigate(filters, page - 1)}>{m.common.previous}</button><span>{m.common.pageOf(page, pages)}</span><button className="button" disabled={page >= pages} onClick={() => navigate(filters, page + 1)}>{m.common.next}</button></nav>}
      </>}
    </section>
  </main>;
}
