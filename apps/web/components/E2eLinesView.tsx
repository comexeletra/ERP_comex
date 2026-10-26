"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch, readApiJson } from "../lib/api";
import { E2E_STAGE_CODES, formatE2eDate, type E2eResult } from "../lib/e2e-analysis";
import { formatNumber } from "../lib/format-number";
import { statusLabel } from "../lib/i18n/labels";
import { emptyProductLineFilters, parseProductLineFilters, productLineQuery, productLineStatuses,
  type ProductLineFilters } from "../lib/purchase-order-lines";
import E2eTabs from "./E2eTabs";
import { getMessages, useI18n } from "./I18nProvider";
import PageHeader from "./PageHeader";
import { useProductLineExport } from "./useProductLineExport";

type E2eLine = {
  lineId: string; lineKind: "ALLOCATION" | "BALANCE"; quantity: string;
  purchaseOrder: { id: string; number: string; importer: string };
  item: { productCode: string; description: string; unit: string | null; necessityDate: string | null;
    scNumber: string | null; purpose: string | null; group: string | null };
  process: { id: string; ipNumber: string; transportMode?: string | null } | null;
  calculated: { status: string; e2e?: E2eResult | null };
};
type LinesPage = { page: number; pageSize: number; totalCount: number; lines: E2eLine[] };
const pageSize = 50;

/** The End to End spreadsheet: one row per PO product line and IP with T0–T5 and the totals. */
export default function E2eLinesView({ initialQuery }: { initialQuery: string }) {
  const { m, locale } = useI18n();
  const t = m.e2eLines;
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
  const { exporting, exportStatus, exportError, downloadExcel } = useProductLineExport("end-to-end");
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
  const result = current?.data;
  const error = current?.error ?? "";

  function navigate(filters: ProductLineFilters, nextPage: number) {
    setApplied(filters); setPage(nextPage);
    window.history.replaceState(null, "", `/end-to-end?${productLineQuery(filters, nextPage, pageSize)}`);
  }
  function filter(event: FormEvent<HTMLFormElement>) { event.preventDefault(); navigate(draft, 1); }

  const date = (value: string | null | undefined) => formatE2eDate(value, locale);
  const days = (value: number | null | undefined) => value === null || value === undefined ? "—" : String(value);
  const delay = (value: number | null | undefined) => value === null || value === undefined ? <span>—</span>
    : <span className={`e2e-deviation${value > 0 ? " is-late" : " is-ok"}`}>{value > 0 ? `+${value}` : value}</span>;
  const modal = (line: E2eLine) => line.calculated.e2e?.air === true ? m.e2eAnalysis.air
    : line.calculated.e2e?.air === false ? m.e2eAnalysis.sea : line.process?.transportMode ?? "—";
  const totalPages = result ? Math.ceil(result.totalCount / pageSize) : 0;
  const p = m.productLines;

  return <main className="shell e2e-flow">
    <PageHeader eyebrow={t.eyebrow} title={t.title}><p>{t.intro}</p></PageHeader>
    <E2eTabs current="lines" />
    <section className="card">
      <form className="portfolio-filter product-lines-filter" onSubmit={filter}>
        <label>{p.poNumber}<input value={draft.purchaseOrder} onChange={event => setDraft({ ...draft, purchaseOrder: event.target.value })} /></label>
        <label>{m.processDirectory.importer}<input value={draft.importer} onChange={event => setDraft({ ...draft, importer: event.target.value })} /></label>
        <label>{m.followup.product}<input value={draft.product} onChange={event => setDraft({ ...draft, product: event.target.value })} placeholder={p.productPlaceholder} /></label>
        <label>IP<input value={draft.ipNumber} onChange={event => setDraft({ ...draft, ipNumber: event.target.value })} /></label>
        <label>{m.calc.status}<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as ProductLineFilters["status"] })}>
          <option value="">{m.processDirectory.all}</option>
          {productLineStatuses.map(status => <option key={status} value={status}>{statusLabel(m, status)}</option>)}
        </select></label>
        <label>{p.etaFrom}<input type="date" value={draft.etaFrom} onChange={event => setDraft({ ...draft, etaFrom: event.target.value })} /></label>
        <label>{p.etaTo}<input type="date" value={draft.etaTo} onChange={event => setDraft({ ...draft, etaTo: event.target.value })} /></label>
        <label>{p.situation}<select value={draft.situation} onChange={event => setDraft({ ...draft, situation: event.target.value as ProductLineFilters["situation"] })}>
          <option value="open">{p.open}</option>
          <option value="all">{p.all}</option>
        </select></label>
        <div className="button-row product-lines-filter-actions"><button className="button" type="submit">{p.apply}</button>
          <button className="button secondary" type="button" onClick={() => { setDraft(emptyProductLineFilters); navigate(emptyProductLineFilters, 1); }}>{m.processDirectory.clear}</button></div>
      </form>
    </section>
    <section className="card" aria-live="polite">
      {!current && <p role="status">{p.loading}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {result && <>
        <p>{p.found(result.totalCount)}{result.totalCount > 0 && m.processDirectory.pageSuffix(page, totalPages)}</p>
        {result.totalCount > 0 && <p><button className="button secondary" type="button" disabled={exporting}
          onClick={() => void downloadExcel(applied)}>{exporting ? p.exporting : t.export}</button></p>}
        {exportStatus && <p className="muted" role="status">{exportStatus}</p>}
        {exportError && <p className="notice error" role="alert">{exportError}</p>}
        {result.totalCount === 0 && <p>{p.none}</p>}
        {result.lines.length > 0 && <div className="table-scroll"><table className="e2e-lines-table">
          <thead>
            <tr>
              <th rowSpan={2}>{t.necessity}</th><th rowSpan={2}>PO</th><th rowSpan={2}>{t.sc}</th><th rowSpan={2}>IP</th>
              <th rowSpan={2}>{m.calc.status}</th><th rowSpan={2}>{t.purpose}</th><th rowSpan={2}>{t.product}</th>
              <th rowSpan={2}>{t.description}</th><th rowSpan={2}>{t.modal}</th><th rowSpan={2}>{t.group}</th><th rowSpan={2}>{t.quantity}</th>
              {E2E_STAGE_CODES.map((code, index) => <th key={code} colSpan={5} scope="colgroup"
                className={index < 3 ? "e2e-stage-head side-br" : "e2e-stage-head side-cn"}>{t.stageTitles[code]}</th>)}
              <th colSpan={3} scope="colgroup" className="e2e-stage-head">{t.totals}</th>
              <th rowSpan={2}>{t.bottleneck}</th><th rowSpan={2}>{t.currentStatus}</th><th rowSpan={2}>{t.arrivalMonth}</th>
            </tr>
            <tr>
              {E2E_STAGE_CODES.map(code => [t.deadline, t.actual, t.target, t.days, t.delay].map(label =>
                <th key={`${code}-${label}`} scope="col">{label}</th>))}
              <th scope="col">{t.target}</th><th scope="col">{t.actual}</th><th scope="col">{t.delay}</th>
            </tr>
          </thead>
          <tbody>{result.lines.map(line => {
            const e2e = line.calculated.e2e;
            return <tr key={`${line.lineKind}-${line.lineId}`}>
              <td>{date(line.item.necessityDate)}</td>
              <td><Link className="text-link" href={`/end-to-end/po?id=${encodeURIComponent(line.purchaseOrder.id)}`}>{line.purchaseOrder.number}</Link></td>
              <td>{line.item.scNumber ?? "—"}</td>
              <td>{line.process ? <Link className="text-link" href={`/processes/${line.process.id}`}>{line.process.ipNumber}</Link>
                : <span className="po-ip-pending">{m.followup.noIp}</span>}</td>
              <td>{statusLabel(m, line.calculated.status)}</td>
              <td>{line.item.purpose ?? "—"}</td>
              <td><strong>{line.item.productCode}</strong></td>
              <td><span className="product-lines-description" title={line.item.description}>{line.item.description}</span></td>
              <td>{modal(line)}</td><td>{line.item.group ?? "—"}</td>
              <td>{formatNumber(line.quantity)} {line.item.unit ?? ""}</td>
              {E2E_STAGE_CODES.map(code => {
                const stage = e2e?.stages[code];
                return [
                  <td key={`${code}-deadline`}>{date(stage?.deadline)}</td>,
                  <td key={`${code}-actual`}><span className={stage?.source === "forecast" ? "e2e-date is-forecast" : "e2e-date"}
                    title={stage?.source === "forecast" ? t.forecast : undefined}>{date(stage?.actual)}</span></td>,
                  <td key={`${code}-target`}>{days(stage?.targetDays)}</td>,
                  <td key={`${code}-days`}>{days(stage?.actualDays)}</td>,
                  <td key={`${code}-delay`}>{delay(stage?.delayDays)}</td>,
                ];
              })}
              <td>{days(e2e?.totalTargetDays)}</td><td>{days(e2e?.totalActualDays)}</td><td>{delay(e2e?.totalDelayDays)}</td>
              <td>{e2e?.bottleneck ?? "—"}</td>
              <td>{e2e ? statusLabel(m, e2e.currentStatus) : "—"}</td>
              <td>{e2e?.arrivalYearMonth ?? "—"}</td>
            </tr>;
          })}</tbody>
        </table></div>}
        {totalPages > 1 && <nav className="pagination" aria-label={p.pages}>
          <button className="button secondary" disabled={page <= 1} onClick={() => navigate(applied, page - 1)}>{m.common.previous}</button>
          <span>{m.common.pageOf(page, totalPages)}</span>
          <button className="button" disabled={page >= totalPages} onClick={() => navigate(applied, page + 1)}>{m.common.next}</button>
        </nav>}
      </>}
    </section>
  </main>;
}
