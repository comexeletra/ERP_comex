"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { getMessages, useI18n } from "../components/I18nProvider";
import { apiFetch } from "../lib/api";
import { formatCount } from "../lib/format-count";
import { portfolioFilterQuery, purchaseOrderListQuery, purchaseOrderLifecycleFilters,
  type PortfolioFilters, type PurchaseOrderLifecycleFilter } from "../lib/portfolio-query";

type Filters = PortfolioFilters;
type PurchaseOrder = {
  id: string; number: string; importer: string; operationalItemCount: number;
  itemsWithIp: number; itemsWithoutIp: number; linkedProcessCount: number;
  unresolvedIssueCount: number; lifecycleStatus: "ACTIVE" | "CANCELLED" | "CLOSED" | "DELETED";
};
type PurchaseOrderPage = { page: number; pageSize: number; totalCount: number; items: PurchaseOrder[] };
type PortfolioSummary = { purchaseOrders: number; linkedProcesses: number; items: number;
  itemsWithIp: number; itemsWithoutIp: number;
  byImporter: Array<{ importer: string; purchaseOrders: number }> };
type PortfolioSummaryState = { query: string; value: PortfolioSummary };
type PortfolioSummaryFailure = { query: string; message: string };
type ExportJob = { id: string; jobType?: string; status: string; errorCode: string | null; createdAt: string;
  expiresAt: string | null; downloadPath: string | null };

const emptyFilters: Filters = { number: "", importer: "", product: "", ipNumber: "", lifecycle: "" };
const pageSize = 50;

function queryFor(filters: Filters, page: number, size = pageSize) {
  return purchaseOrderListQuery(filters, page, size);
}

export default function PortfolioPage() {
  const { m } = useI18n();
  const t = m.portfolio;
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [applied, setApplied] = useState<Filters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState<PurchaseOrderPage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [exportError, setExportError] = useState("");
  const [recentExports, setRecentExports] = useState<ExportJob[]>([]);
  const [summaryState, setSummaryState] = useState<PortfolioSummaryState>();
  const [summaryFailure, setSummaryFailure] = useState<PortfolioSummaryFailure>();
  const [roles, setRoles] = useState<string[]>([]);

  useEffect(() => {
    apiFetch("/auth/me").then(async response => {
      if (response.ok) setRoles((await response.json() as { roles: string[] }).roles);
    }).catch(() => undefined);
    apiFetch("/api/v1/exports").then(async response => {
      if (response.ok) setRecentExports((await response.json() as { items: ExportJob[] }).items);
    }).catch(() => undefined);
  }, []);
  const summaryQuery = portfolioFilterQuery(applied).toString();
  const summary = summaryState?.query === summaryQuery ? summaryState.value : undefined;
  const summaryError = summaryFailure?.query === summaryQuery ? summaryFailure.message : "";
  const summaryLoading = !ready || (!summary && !summaryError);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const requestedLifecycle = query.get("lifecycle");
    const filters: Filters = {
      number: query.get("number") ?? "", importer: query.get("importer") ?? "",
      product: query.get("product") ?? "", ipNumber: query.get("ipNumber") ?? "",
      lifecycle: requestedLifecycle && purchaseOrderLifecycleFilters.includes(
        requestedLifecycle as typeof purchaseOrderLifecycleFilters[number],
      ) ? requestedLifecycle as PurchaseOrderLifecycleFilter : "",
    };
    const requestedPage = Number(query.get("page"));
    setDraft(filters);
    setApplied(filters);
    setPage(Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    setResult(undefined);
    apiFetch(`/api/v1/purchase-orders?${queryFor(applied, page)}`, { signal: controller.signal })
      .then(async response => {
        const text = getMessages();
        if (response.status === 401) throw new Error(text.common.sessionExpired);
        if (response.status === 403) throw new Error(text.portfolio.forbidden);
        if (!response.ok) throw new Error(text.portfolio.loadFailed);
        return await response.json() as PurchaseOrderPage;
      })
      .then(data => { if (!controller.signal.aborted) setResult(data); })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : getMessages().common.unexpectedError);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [applied, page, ready, retry]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const query = portfolioFilterQuery(applied).toString();
    apiFetch(`/api/v1/purchase-orders/summary?${query}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(getMessages().portfolio.summaryFailed);
        return await response.json() as PortfolioSummary;
      })
      .then(data => {
        if (!controller.signal.aborted) {
          setSummaryState({ query, value: data });
          setSummaryFailure(current => current?.query === query ? undefined : current);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSummaryFailure({ query, message: getMessages().portfolio.summaryUnavailable });
        }
      });
    return () => controller.abort();
  }, [applied, ready, retry]);

  function navigate(filters: Filters, nextPage: number) {
    setApplied(filters);
    setPage(nextPage);
    window.history.replaceState(null, "", `/?${queryFor(filters, nextPage)}`);
  }
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate({ number: draft.number.trim(), importer: draft.importer.trim(),
      product: draft.product.trim(), ipNumber: draft.ipNumber.trim(), lifecycle: draft.lifecycle }, 1);
  }

  async function downloadExcel() {
    if (exporting || !result?.totalCount) return;
    setExporting(true); setExportError(""); setExportStatus(m.productLines.exportQueued);
    try {
      const created = await apiFetch("/api/v1/exports/purchase-orders", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          number: applied.number, importer: applied.importer,
          product: applied.product, ipNumber: applied.ipNumber,
        }),
      });
      if (!created.ok) {
        const body = await created.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? m.productLines.exportStartFailed);
      }
      const { id } = await created.json() as { id: string };
      setRecentExports(current => [{ id, status: "queued", errorCode: null,
        createdAt: new Date().toISOString(), expiresAt: null, downloadPath: null }, ...current].slice(0, 20));
      let complete = false;
      while (!complete) {
        await new Promise(resolve => window.setTimeout(resolve, 1500));
        const statusResponse = await apiFetch(`/api/v1/exports/${id}`);
        if (!statusResponse.ok) throw new Error(m.productLines.exportStatusFailed);
        const status = await statusResponse.json() as { status: string; errorCode?: string | null };
        setRecentExports(current => current.map(job => job.id === id
          ? { ...job, status: status.status, errorCode: status.errorCode ?? null,
            downloadPath: status.status === "completed" ? `/api/v1/exports/${id}/download` : null }
          : job));
        if (status.status === "failed") {
          throw new Error(status.errorCode === "EXPORT_TOO_LARGE" ? t.exportTooLarge : m.productLines.exportFailed);
        }
        if (status.status === "completed") complete = true;
        else setExportStatus(status.status === "running" ? m.productLines.exportRunning : m.productLines.exportWaiting);
      }
      setExportStatus(m.productLines.downloading);
      const file = await apiFetch(`/api/v1/exports/${id}/download`);
      if (!file.ok) throw new Error(m.productLines.fileExpired);
      const blob = await file.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `carteira-pos-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      apiFetch("/api/v1/exports").then(async response => {
        if (response.ok) setRecentExports((await response.json() as { items: ExportJob[] }).items);
      }).catch(() => undefined);
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : m.productLines.exportError);
    } finally { setExporting(false); setExportStatus(""); }
  }

  const totalPages = result ? Math.ceil(result.totalCount / pageSize) : 0;
  const returnPath = `/?${queryFor(applied, page)}`;
  const byImporter = Array.isArray(summary?.byImporter) ? summary.byImporter : [];
  return <main className="shell">
    <header className="page-header portfolio-header">
      <p className="eyebrow">ERP Comex</p><h1>{t.title}</h1>
      <p>{t.intro}</p>
      {roles.some(role => ["Master", "Administrador", "Importação", "Compras"].includes(role)) &&
        <p><Link className="button" href="/purchase-orders/new">{t.create}</Link></p>}
      <p><Link className="text-link" href="/reports/pre">{t.reports}</Link> · <Link className="text-link" href="/quality">{t.quality}</Link></p>
    </header>
    <section className="card">
      <form className="portfolio-filter" onSubmit={filter}>
        <label>{m.productLines.poNumber}<input value={draft.number} onChange={event => setDraft(value => ({ ...value, number: event.target.value }))} placeholder="18751" /></label>
        <label>{m.processDirectory.importer}<input value={draft.importer} onChange={event => setDraft(value => ({ ...value, importer: event.target.value }))} placeholder={t.importerPlaceholder} /></label>
        <label>{m.followup.product}<input value={draft.product} onChange={event => setDraft(value => ({ ...value, product: event.target.value }))} placeholder={m.productLines.productPlaceholder} /></label>
        <label>{t.linkedIp}<input value={draft.ipNumber} onChange={event => setDraft(value => ({ ...value, ipNumber: event.target.value }))} placeholder={t.ipPlaceholder} /></label>
        <label>{t.cycle}<select value={draft.lifecycle} onChange={event => setDraft(value => ({
          ...value, lifecycle: event.target.value as PurchaseOrderLifecycleFilter,
        }))}>
          <option value="">{t.cycleDefault}</option>
          <option value="active">{t.cycleActive}</option>
          <option value="cancelled">{t.cycleCancelled}</option>
          <option value="closed">{t.cycleClosed}</option>
          <option value="deleted">{t.cycleDeleted}</option>
          <option value="all">{t.cycleAll}</option>
        </select></label>
        <button className="button" type="submit">{m.productLines.apply}</button>
        <button className="button secondary" type="button" onClick={() => { setDraft(emptyFilters); navigate(emptyFilters, 1); }}>{m.processDirectory.clear}</button>
      </form>
      <p className="muted">{t.filterHelp}</p>
    </section>
    <section aria-label={t.overview} aria-live="polite">
      <div className="metric-grid">
        <div className="metric"><span>{t.posInScope}</span><strong>{summaryLoading ? "…" : formatCount(summary?.purchaseOrders)}</strong></div>
        <div className="metric"><span>{t.ipsOfPos}</span><strong>{summaryLoading ? "…" : formatCount(summary?.linkedProcesses)}</strong></div>
        <div className="metric"><span>{t.itemsInPos}</span><strong>{summaryLoading ? "…" : formatCount(summary?.items)}</strong></div>
        <div className="metric"><span>{t.itemsWithoutIp}</span><strong>{summaryLoading ? "…" : formatCount(summary?.itemsWithoutIp)}</strong></div>
      </div>
      {summary && <p className="muted">{t.summaryHelp}</p>}
      {summaryError && <p className="notice error" role="alert">{summaryError}</p>}
      {byImporter.length > 1 && <div className="card">
        <h2>{t.byImporter}</h2>
        <div className="table-scroll"><table><thead><tr><th>{m.processDirectory.importer}</th><th>POs</th></tr></thead>
          <tbody>{byImporter.map(item => <tr key={item.importer}><td>{item.importer}</td>
            <td>{formatCount(item.purchaseOrders)}</td></tr>)}</tbody></table></div>
      </div>}
    </section>
    <section className="card" aria-live="polite">
      {loading && <p role="status">{t.loading}</p>}
      {error && <div className="notice error" role="alert"><p>{error}</p><button className="button" onClick={() => setRetry(value => value + 1)}>{m.common.retry}</button></div>}
      {!loading && !error && result && <>
        <p>{t.found(result.totalCount)}{result.totalCount > 0 && m.processDirectory.pageSuffix(page, totalPages)}</p>
        {result.totalCount > 0 && <p><button className="button secondary" type="button" disabled={exporting}
          onClick={() => void downloadExcel()}>{exporting ? m.productLines.exporting : t.export}</button></p>}
        {exportStatus && <p className="muted" role="status">{exportStatus}</p>}
        {recentExports.length > 0 && <details className="historical-disclosure"><summary>{t.recentExports}</summary>
          <ul>{recentExports.slice(0, 5).map(job => <li key={job.id}>
            {new Date(job.createdAt).toLocaleString("pt-BR")} · {job.jobType === "purchase-order-lines-xlsx" ? t.byProduct : ""}
            {(t.jobStatus as Record<string, string>)[job.status] ?? job.status}
            {job.downloadPath && <> · <a className="text-link" href={job.downloadPath}>{t.downloadExcel}</a></>}
            {job.status === "failed" && job.errorCode === "EXPORT_TOO_LARGE" && t.jobTooLarge}
          </li>)}</ul>
        </details>}
        <p className="muted">{t.exportHelp}</p>
        {exportError && <p className="notice error" role="alert">{exportError}</p>}
        {result.items.length === 0 && result.totalCount > 0 ? <p>{m.productLines.outOfRange}<button className="button" onClick={() => navigate(applied, 1)}>{m.productLines.firstPage}</button></p> : null}
        {result.totalCount === 0 ? <p>{t.none}</p> : null}
        {result.items.length > 0 && <div className="table-scroll"><table>
          <thead><tr><th>{t.totvsPo}</th><th>{m.processDirectory.importer}</th><th>{m.calc.status}</th><th>{t.items}</th><th>IPs</th><th>{t.itemsWithoutIp}</th><th>{t.pending}</th><th>{m.poPanel.action}</th></tr></thead>
          <tbody>{result.items.map(order => <tr key={order.id}>
            <td><strong>{order.number}</strong></td><td>{order.importer}</td>
            <td>{t.status[order.lifecycleStatus] ?? t.status.ACTIVE}</td>
            <td>{order.operationalItemCount}</td><td>{order.linkedProcessCount}</td>
            <td>{order.itemsWithoutIp}</td><td>{order.unresolvedIssueCount}</td>
            <td><Link className="button" href={`/purchase-orders/${order.id}?return=${encodeURIComponent(returnPath)}`}>{t.open(order.number)}</Link></td>
          </tr>)}</tbody>
        </table></div>}
        {totalPages > 1 && <nav className="pagination" aria-label={t.pages}>
          <button className="button secondary" disabled={page <= 1} onClick={() => navigate(applied, page - 1)}>{m.common.previous}</button>
          <span>{m.common.pageOf(page, totalPages)}</span>
          <button className="button" disabled={page >= totalPages} onClick={() => navigate(applied, page + 1)}>{m.common.next}</button>
        </nav>}
      </>}
    </section>
  </main>;
}
