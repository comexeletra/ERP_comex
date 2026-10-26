"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch, readApiJson } from "../lib/api";
import { formatNumber } from "../lib/format-number";
import { statusLabel } from "../lib/i18n/labels";
import { getMessages, useI18n } from "./I18nProvider";
import { useProductLineExport } from "./useProductLineExport";
import PageHeader from "./PageHeader";
import { emptyProductLineFilters, parseProductLineFilters, productLineQuery,
  productLineStatuses, type ProductLineFilters } from "../lib/purchase-order-lines";

type Value = string | number | boolean | null | undefined;
type ProductLine = {
  lineId: string; lineKind: "ALLOCATION" | "BALANCE"; quantity: string; factoryShipDate: string | null;
  purchaseOrder: { id: string; number: string; importer: string; supplierText: string | null };
  item: { id: string; productCode: string; description: string; unit: string | null };
  process: (Record<string, Value> & { id: string; ipNumber: string }) | null;
  calculated: Record<string, Value | string[]> & { status: string };
};
type LinesPage = { page: number; pageSize: number; totalCount: number; lines: ProductLine[] };
const pageSize = 50;

function show(value: Value | string[]): string {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return value == null || value === "" ? "—" : String(value);
}

/** Every PO product line with the shipment data of its IP: the system view of the Pré Embarque sheet. */
export default function ProductLinesView({ initialQuery }: { initialQuery: string }) {
  const { m } = useI18n();
  const t = m.productLines;
  const [initial] = useState(() => {
    const query = new URLSearchParams(initialQuery);
    const requestedPage = Number(query.get("page"));
    return { filters: parseProductLineFilters(query),
      page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1 };
  });
  const [draft, setDraft] = useState<ProductLineFilters>(initial.filters);
  const [applied, setApplied] = useState<ProductLineFilters>(initial.filters);
  const [page, setPage] = useState(initial.page);
  const [response, setResponse] = useState<{ query: string; data?: LinesPage; error?: string }>();
  const { exporting, exportStatus, exportError, downloadExcel } = useProductLineExport("carteira-por-produto");
  const query = productLineQuery(applied, page, pageSize).toString();

  useEffect(() => {
    const controller = new AbortController();
    apiFetch(`/api/v1/purchase-order-lines?${query}`, { signal: controller.signal })
      .then(result => readApiJson<LinesPage>(result))
      .then(data => { if (!controller.signal.aborted) setResponse({ query, data }); })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setResponse({ query, error: reason instanceof Error ? reason.message : getMessages().common.unexpectedError });
      });
    return () => controller.abort();
  }, [query]);
  const current = response?.query === query ? response : undefined;
  const loading = !current;
  const result = current?.data;
  const error = current?.error ?? "";

  function navigate(filters: ProductLineFilters, nextPage: number) {
    setApplied(filters); setPage(nextPage);
    window.history.replaceState(null, "", `/purchase-orders/lines?${productLineQuery(filters, nextPage, pageSize)}`);
  }
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate(draft, 1);
  }

  const totalPages = result ? Math.ceil(result.totalCount / pageSize) : 0;
  return <main className="shell">
    <PageHeader className="portfolio-header" eyebrow={m.sidebar.groups.operation} title={t.title}><p>{t.intro}</p></PageHeader>
    <section className="card">
      <form className="portfolio-filter product-lines-filter" onSubmit={filter}>
        <label>{t.poNumber}<input value={draft.purchaseOrder} onChange={event => setDraft({ ...draft, purchaseOrder: event.target.value })} /></label>
        <label>{m.processDirectory.importer}<input value={draft.importer} onChange={event => setDraft({ ...draft, importer: event.target.value })} /></label>
        <label>{m.followup.product}<input value={draft.product} onChange={event => setDraft({ ...draft, product: event.target.value })} placeholder={t.productPlaceholder} /></label>
        <label>IP<input value={draft.ipNumber} onChange={event => setDraft({ ...draft, ipNumber: event.target.value })} /></label>
        <label>{m.calc.status}<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as ProductLineFilters["status"] })}>
          <option value="">{m.processDirectory.all}</option>
          {productLineStatuses.map(status => <option key={status} value={status}>{statusLabel(m, status)}</option>)}
        </select></label>
        <label>{t.etaFrom}<input type="date" value={draft.etaFrom} onChange={event => setDraft({ ...draft, etaFrom: event.target.value })} /></label>
        <label>{t.etaTo}<input type="date" value={draft.etaTo} onChange={event => setDraft({ ...draft, etaTo: event.target.value })} /></label>
        <label>{t.situation}<select value={draft.situation} onChange={event => setDraft({ ...draft, situation: event.target.value as ProductLineFilters["situation"] })}>
          <option value="open">{t.open}</option>
          <option value="all">{t.all}</option>
        </select></label>
        <div className="button-row product-lines-filter-actions"><button className="button" type="submit">{t.apply}</button>
          <button className="button secondary" type="button" onClick={() => { setDraft(emptyProductLineFilters); navigate(emptyProductLineFilters, 1); }}>{m.processDirectory.clear}</button></div>
      </form>
    </section>
    <section className="card" aria-live="polite">
      {loading && <p role="status">{t.loading}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {!loading && !error && result && <>
        <p>{t.found(result.totalCount)}{result.totalCount > 0 && m.processDirectory.pageSuffix(page, totalPages)}</p>
        {result.totalCount > 0 && <p><button className="button secondary" type="button" disabled={exporting}
          onClick={() => void downloadExcel(applied)}>{exporting ? t.exporting : t.export}</button></p>}
        {exportStatus && <p className="muted" role="status">{exportStatus}</p>}
        {exportError && <p className="notice error" role="alert">{exportError}</p>}
        {result.lines.length === 0 && result.totalCount > 0 && <p>{t.outOfRange}<button className="button" onClick={() => navigate(applied, 1)}>{t.firstPage}</button></p>}
        {result.totalCount === 0 && <p>{t.none}</p>}
        {result.lines.length > 0 && <div className="table-scroll"><table className="product-lines-table"><thead><tr>
          <th>PO</th><th>{m.followup.importer}</th><th>{m.followup.product}</th><th>{m.followup.quantity}</th><th>IP</th><th>{m.calc.status}</th><th>ETD</th><th>{m.followup.departure}</th>
          <th>{m.fields.blDate}</th><th>ETA</th><th>{m.followup.arrival}</th><th>ETE</th><th>{m.followup.delivery}</th><th>{m.followup.factoryShip}</th><th>{m.postShipment.invoice}</th>
        </tr></thead><tbody>{result.lines.map(line => <tr key={`${line.lineKind}-${line.lineId}`}>
          <td><Link className="text-link" href={`/purchase-orders/${line.purchaseOrder.id}`}>{line.purchaseOrder.number}</Link></td>
          <td><span className="product-lines-importer" title={line.purchaseOrder.importer}>{line.purchaseOrder.importer}</span></td>
          <td><strong>{line.item.productCode}</strong>
            <small className="product-lines-description" title={line.item.description}>{line.item.description}</small></td>
          <td>{formatNumber(line.quantity)} {line.item.unit ?? ""}</td>
          <td>{line.process ? <Link className="text-link" href={`/processes/${line.process.id}`}>{line.process.ipNumber}</Link>
            : <span className="po-ip-pending">{m.followup.noIp}</span>}</td>
          <td>{statusLabel(m, line.calculated.status)}</td>
          <td>{show(line.process?.etd)}</td><td>{show(line.process?.actualPortDepartureDate)}</td>
          <td>{show(line.process?.blDate)}</td><td>{show(line.calculated.eta)}</td>
          <td>{show(line.process?.arrivalDate)}</td><td>{show(line.calculated.ete)}</td>
          <td>{show(line.process?.deliveryDate)}</td><td>{show(line.factoryShipDate)}</td>
          <td>{show(line.calculated.invoiceNumbers)}</td>
        </tr>)}</tbody></table></div>}
        {totalPages > 1 && <nav className="pagination" aria-label={t.pages}>
          <button className="button secondary" disabled={page <= 1} onClick={() => navigate(applied, page - 1)}>{m.common.previous}</button>
          <span>{m.common.pageOf(page, totalPages)}</span>
          <button className="button" disabled={page >= totalPages} onClick={() => navigate(applied, page + 1)}>{m.common.next}</button>
        </nav>}
      </>}
    </section>
  </main>;
}
