"use client";

import { useEffect, useRef, useState } from "react";
import { getMessages, useI18n } from "../../../components/I18nProvider";
import { IcmsRatesPanel } from "../../../components/IcmsRatesPanel";
import { NcmRateDetail } from "../../../components/NcmRateDetail";
import PageHeader from "../../../components/PageHeader";
import { apiFetch } from "../../../lib/api";
import { createNcmRatesUrl, describeIiSource, describeIpi, formatNcmCode, formatRate, NCM_RATES_PAGE_SIZE,
  readNcmRateRefreshStart, type NcmRateList, type RateSourceVersion } from "../../../lib/ncm-rates";

type SourceStatus = { source: "GECEX_272" | "TIPI"; version: RateSourceVersion | null;
  lastAttemptAt: string | null; lastSuccessAt: string | null; lastError: string | null };
type RateStatus = { sources: SourceStatus[]; nextAutomaticAt: string | null;
  manualRefresh: { status: "running" | "succeeded" | "failed"; startedAt: string; completedAt: string | null;
    error: string | null } | null };

function formatDateTime(value: string | null, empty: string): string {
  return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short",
    timeZone: "America/Sao_Paulo" }).format(new Date(value)) : empty;
}

export default function NcmRatesPage() {
  const { m, locale } = useI18n();
  const t = m.ncmRates;
  const [search, setSearch] = useState("");
  const [chapter, setChapter] = useState("");
  const [date, setDate] = useState("");
  const [page, setPage] = useState(1);
  const [listState, setListState] = useState<{ key: string; list: NcmRateList | null; error: string }>(
    { key: "", list: null, error: "" });
  const [error, setError] = useState("");
  const [status, setStatus] = useState<RateStatus | null>(null);
  const [statusTick, setStatusTick] = useState(0);
  const [listTick, setListTick] = useState(0);
  const wasRunning = useRef(false);
  const [canManage, setCanManage] = useState(false);
  const [canManageIcms, setCanManageIcms] = useState(false);
  const [selected, setSelected] = useState<{ code: string; name: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    apiFetch("/auth/me", { signal: controller.signal })
      .then(response => response.ok ? response.json() as Promise<{ roles?: string[] }> : { roles: [] })
      .then(identity => { if (!controller.signal.aborted) {
        const roles = identity.roles ?? [];
        setCanManage(roles.some(role => ["Master", "Administrador", "Fiscal"].includes(role)));
        setCanManageIcms(roles.some(role => ["Master", "Administrador"].includes(role)));
      } })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const listUrl = createNcmRatesUrl({ search, chapter, date, page });
  const listKey = `${listUrl}#${listTick}`;
  useEffect(() => {
    const controller = new AbortController();
    apiFetch(listUrl, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => null) as NcmRateList & { detail?: string } | null;
        if (!response.ok || !body) throw new Error(body?.detail || getMessages().ncmRates.listFailed(response.status));
        return body;
      })
      .then(body => { if (!controller.signal.aborted) setListState({ key: listKey, list: body, error: "" }); },
        cause => { if (!controller.signal.aborted) setListState(current => ({ ...current, key: listKey,
          error: cause instanceof Error ? cause.message : getMessages().ncmRates.listFailed(0) })); });
    return () => controller.abort();
  }, [listUrl, listKey]);
  const list = listState.list;
  const loading = listState.key !== listKey;

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    apiFetch("/api/v1/ncm-rates/status", { cache: "no-store", signal: controller.signal })
      .then(response => response.ok ? response.json() as Promise<RateStatus> : null)
      .then(body => {
        if (controller.signal.aborted || !body) return;
        setStatus(body);
        const isRunning = body.manualRefresh?.status === "running";
        // When a refresh started on this page finishes, the table shows the new rates.
        if (wasRunning.current && !isRunning) setListTick(current => current + 1);
        wasRunning.current = isRunning;
        if (isRunning) timer = setTimeout(() => setStatusTick(current => current + 1), 5_000);
      })
      .catch(() => undefined);
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [statusTick]);

  async function refresh() {
    setRefreshing(true);
    setNotice("");
    setError("");
    try {
      const response = await apiFetch("/api/v1/ncm-rates/refresh", { method: "POST" });
      const started = await readNcmRateRefreshStart(response, getMessages());
      setNotice(started === "started" ? getMessages().ncmRates.refreshStarted : getMessages().ncmRates.refreshRunning);
      setStatusTick(current => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : getMessages().ncmRates.refreshNotConfirmed);
    } finally { setRefreshing(false); }
  }

  const totalPages = list ? Math.max(1, Math.ceil(list.total / NCM_RATES_PAGE_SIZE)) : 1;
  const running = refreshing || status?.manualRefresh?.status === "running";
  return <main className="shell">
    <PageHeader back={{ href: "/catalog", label: m.entityValues.allEntries }} eyebrow={m.sidebar.groups.management}
      title={t.title} actions={canManage && <button className="button secondary" type="button" disabled={running}
        onClick={() => void refresh()}>{running ? t.refreshRunning : t.refresh}</button>}>
      <p>{t.intro}</p>
    </PageHeader>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!loading && listState.error && <p className="notice error" role="alert">{listState.error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    <section className="card" aria-labelledby="ncm-rate-sources-title">
      <h2 id="ncm-rate-sources-title">{t.sourcesTitle}</h2>
      <p className="notice">{t.disclaimer}</p>
      {status && <ul className="ncm-rate-source-status">
        {status.sources.map(item => <li key={item.source}>
          <strong>{t.sources[item.source]}</strong>
          {item.version ? <span className="muted">{t.versionLine(item.version.sourceReference.slice(0, 200),
            formatDateTime(item.version.fetchedAt, t.never), formatDateTime(item.version.checkedAt, t.never))}</span>
            : <span className="muted">{t.sourceMissing(t.sources[item.source])}</span>}
          {item.lastError && <span className="notice warning">{t.lastError(item.lastError, formatDateTime(item.lastAttemptAt, t.never))}</span>}
        </li>)}
      </ul>}
      {status?.manualRefresh?.status === "failed" && status.manualRefresh.error
        && <p className="notice warning">{status.manualRefresh.error}</p>}
      {status?.nextAutomaticAt && <p className="muted">{t.nextAutomatic(formatDateTime(status.nextAutomaticAt, t.never))}</p>}
    </section>
    <IcmsRatesPanel canManage={canManageIcms} />
    <section className="card" aria-labelledby="ncm-rate-list-title">
      <h2 id="ncm-rate-list-title">{list ? t.listTitle(list.total, list.referenceDate.split("-").reverse().join("/")) : t.title}</h2>
      <div className="ncm-rate-filters">
        <label>{t.search}<input maxLength={120} value={search} placeholder={t.searchPlaceholder}
          onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
        <label>{t.chapter}<input inputMode="numeric" maxLength={2} pattern="[0-9]{2}" value={chapter}
          placeholder={t.chapterPlaceholder} onChange={event => { setChapter(event.target.value.replace(/\D/gu, "")); setPage(1); }} /></label>
        <label>{t.referenceDate}<input type="date" value={date}
          onChange={event => { setDate(event.target.value); setPage(1); }} /></label>
      </div>
      {selected && <section className="ncm-rate-selected" aria-label={t.detailTitle(formatNcmCode(selected.code))}>
        <div className="ncm-rate-selected-header">
          <h3>{t.detailTitle(formatNcmCode(selected.code))}</h3>
          <button className="button secondary" type="button" onClick={() => setSelected(null)}>{t.closeDetail}</button>
        </div>
        <p className="muted">{selected.name}</p>
        <NcmRateDetail code={selected.code} date={date} canManage={canManage} />
      </section>}
      {loading && !list ? <p role="status">{t.loadingList}</p> : list && list.items.length === 0
        ? <p className="muted">{t.noResults}</p> : list && <div className="table-scroll"><table>
          <thead><tr><th>{t.ncm}</th><th>{t.description}</th><th>{t.tec}</th><th>{t.appliedRate}</th><th>{t.iiSource}</th>
            <th>{t.ipiRate}</th><th>{t.pis}</th><th>{t.cofins}</th><th>{t.situation}</th><th>{t.actions}</th></tr></thead>
          <tbody>{list.items.map(item => <tr key={item.code}>
            <td className="ncm-rate-code">{formatNcmCode(item.code)}</td>
            <td className="ncm-rate-description">{item.name}</td>
            <td>{formatRate(item.ii.tec, locale)}{item.ii.tecMarker ? ` ${item.ii.tecMarker}` : ""}</td>
            <td><strong>{item.ii.status === "needs_review" ? t.needsReviewShort : formatRate(item.ii.applied, locale)}</strong></td>
            <td>{describeIiSource(item.ii.appliedSource, m)}</td>
            <td>{describeIpi(item.ipi, m, locale)}</td>
            <td>{formatRate(item.pisCofins.pis, locale)}</td>
            <td>{formatRate(item.pisCofins.cofins, locale)}</td>
            <td><span className="ncm-rate-badges">
              {item.ii.status === "needs_review" && <span className="badge badge-danger badge-sm">{t.needsReviewShort}</span>}
              {item.ii.conditionalCount > 0 && <span className="badge badge-warning badge-sm">{t.conditionalBadge(item.ii.conditionalCount)}</span>}
              {item.ipi.exCount > 0 && <span className="badge badge-info badge-sm">{t.ipiExBadge(item.ipi.exCount)}</span>}
              <span className={item.pisCofins.reviewed ? "badge badge-success badge-sm" : "badge badge-sm"}>
                {item.pisCofins.reviewed ? t.reviewed : t.generalRule}</span>
            </span></td>
            <td><button className="button secondary" type="button" aria-label={t.openDetailAria(formatNcmCode(item.code))}
              onClick={() => setSelected({ code: item.code, name: item.name })}>{t.openDetail}</button></td>
          </tr>)}</tbody>
        </table></div>}
      {list && list.total > NCM_RATES_PAGE_SIZE && <nav className="pagination" aria-label={t.pages}>
        <button className="button secondary" disabled={page <= 1} onClick={() => setPage(current => current - 1)}>{m.common.previous}</button>
        <span>{m.common.pageOf(page, totalPages)}</span>
        <button className="button" disabled={page >= totalPages} onClick={() => setPage(current => current + 1)}>{m.common.next}</button>
      </nav>}
    </section>
  </main>;
}
