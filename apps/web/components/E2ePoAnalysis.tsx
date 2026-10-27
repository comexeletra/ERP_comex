"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { analyzePurchaseOrderE2e, E2E_STAGE_CODES, e2eToday, formatE2eDate,
  type E2eAnalysisInput, type E2eIpAnalysis, type E2eStage } from "../lib/e2e-analysis";
import { statusLabel } from "../lib/i18n/labels";
import E2eTabs from "./E2eTabs";
import { getMessages, useI18n } from "./I18nProvider";
import PageHeader from "./PageHeader";
import { Tooltip } from "./Tooltip";

type PurchaseOrderFollowup = E2eAnalysisInput & { id: string; number: string; importer: string };

// Status calculated by the API → badge tone; the values stay in Portuguese.
const statusBadge: Record<string, string> = {
  "ENTREGUE": "badge badge-success", "DESEMBARAÇO": "badge badge-info", "AGUARDANDO CHEGADA": "badge badge-info", // i18n-ignore: API values
  "AGUARDANDO EMBARQUE": "badge badge-warning", "AGUARDANDO PRODUÇÃO": "badge badge-warning", // i18n-ignore: API values
};
const pct = (value: number) => `${value.toFixed(3)}%`;

/** End to End of one PO, aggregated by IP from the stages the API calculates for each product line. */
export default function E2ePoAnalysis({ id }: { id: string }) {
  const { m, locale } = useI18n();
  const t = m.e2eAnalysis;
  const [data, setData] = useState<PurchaseOrderFollowup>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch(`/api/v1/purchase-orders/${encodeURIComponent(id)}/followup`, { signal: controller.signal })
      .then(async response => {
        const text = getMessages();
        if (response.status === 401) throw new Error(text.common.sessionExpired);
        if (response.status === 403) throw new Error(text.e2eAnalysis.forbidden);
        if (response.status === 404) throw new Error(text.e2eAnalysis.notFound);
        if (!response.ok) throw new Error(text.e2eAnalysis.loadFailed);
        return await response.json() as PurchaseOrderFollowup;
      })
      .then(result => { if (!controller.signal.aborted) { setData(result); setError(""); } })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : getMessages().common.unexpectedError);
      });
    return () => controller.abort();
  }, [id, retry]);

  const analysis = useMemo(() => data ? analyzePurchaseOrderE2e(data, e2eToday()) : undefined, [data]);
  const date = (value: string | null | undefined) => formatE2eDate(value, locale);
  const back = { href: "/end-to-end/po", label: t.backToModel };

  if (error || !data || !analysis) return <main className="shell e2e-flow">
    <PageHeader back={back} title={t.title("…")} />
    {!error && <p role="status">{t.loading}</p>}
    {error && <div className="notice error" role="alert"><p>{error}</p>
      <button className="button" onClick={() => setRetry(value => value + 1)}>{m.common.retry}</button></div>}
  </main>;

  const { summary, timeline } = analysis;
  const missingDemandType = data.shipments.filter(shipment => shipment.calculated.e2e?.demandType === "unknown").length;
  const deviation = (value: number | null) => value === null ? t.noData : t.deviation(Math.round(value * 10) / 10);
  const cell = (stage: E2eStage) => <>
    <span className={stage.source === "forecast" ? "e2e-date is-forecast" : "e2e-date"}>
      {date(stage.actual)}{stage.source === "forecast" && <small> · {t.forecast}</small>}
    </span>
    <span className="e2e-date-planned">{t.planned(date(stage.deadline))}</span>
  </>;

  return <main className="shell e2e-flow">
    <PageHeader back={back} eyebrow={t.eyebrow(data.importer)} title={t.title(data.number)}
      actions={<Link className="button secondary" href={`/purchase-orders/${encodeURIComponent(data.id)}`}>{t.openPo}</Link>}>
      <p>{t.intro}</p>
    </PageHeader>
    <E2eTabs current="po" />

    {!analysis.necessityDate && <div className="notice warning"><p>{t.noNeed}</p></div>}
    {!analysis.ips.length && <div className="notice"><p>{t.noIps}</p></div>}
    {missingDemandType > 0 && <div className="notice warning"><p>{t.missingDemandType(missingDemandType)}</p></div>}
    {summary.unallocatedItems > 0 && <div className="notice"><p>{t.unallocated(summary.unallocatedItems)}</p></div>}

    <div className="e2e-kpis e2e-kpis-four">
      <div className="e2e-kpi"><span>{t.kpiNeed}</span><strong>{date(analysis.necessityDate)}</strong></div>
      <div className="e2e-kpi"><span>{t.kpiLeadTime}</span>
        <strong>{summary.leadTime === null ? t.noData : m.e2e.days(summary.leadTime)}</strong></div>
      <div className={`e2e-kpi ${summary.lateLines ? "is-late" : "is-ok"}`}><span>{t.kpiOnTime}</span>
        <strong>{t.onTime(summary.onTimeLines, summary.lines)}</strong></div>
      <div className={`e2e-kpi ${summary.worstSlack !== null && summary.worstSlack < 0 ? "is-late" : "is-ok"}`}><span>{t.kpiWorst}</span>
        <strong>{summary.worstIp && summary.worstSlack !== null && summary.worstSlack < 0 ? t.worst(summary.worstIp, -summary.worstSlack) : t.noDelay}</strong></div>
    </div>

    <section className="card e2e-stage-summary" aria-labelledby="e2e-stages-title">
      <div className="e2e-panel-heading"><h2 id="e2e-stages-title">{t.stagesTitle}</h2><span className="muted">{t.stagesHelp}</span></div>
      <ol className="e2e-stage-list">
        {E2E_STAGE_CODES.map((code, index) => {
          const value = summary.stageDeviation[code];
          return <li key={code} className={`${index < 3 ? "side-br" : "side-cn"}${code === summary.worstStage ? " is-current" : ""}`}>
            <span className="e2e-phase-code">{code}</span>
            <strong>{m.e2eLines.stageTitles[code].replace(`${code} · `, "")}</strong>
            <span className={`e2e-deviation${value !== null && value > 0 ? " is-late" : " is-ok"}`}>{deviation(value)}</span>
          </li>;
        })}
      </ol>
    </section>

    {analysis.ips.length > 0 && <section className="card e2e-gantt" aria-labelledby="e2e-gantt-title">
      <div className="e2e-panel-heading"><h2 id="e2e-gantt-title">{t.timelineTitle}</h2>
        <ul className="e2e-legend">
          <li><span className="e2e-legend-swatch e2e-gantt-planned" />{t.legendPlanned}</li>
          <li><span className="e2e-legend-swatch e2e-gantt-bar side-cn" />{t.legendActual}</li>
          <li><span className="e2e-legend-swatch e2e-gantt-bar side-cn is-forecast" />{t.legendForecast}</li>
          <li><span className="e2e-legend-swatch e2e-gantt-need" />{t.legendNeed} · {date(analysis.necessityDate)}</li>
          <li><span className="e2e-legend-swatch e2e-gantt-today" />{t.legendToday} · {date(timeline.today)}</li>
        </ul>
      </div>
      <ol className="e2e-gantt-rows">
        {analysis.ips.map(ip => <li key={ip.processId} className="e2e-gantt-row">
          <div className="e2e-gantt-label">
            <strong>{ip.ipNumber}</strong>
            <span className="e2e-label">{ip.air === null ? "—" : ip.air ? t.air : t.sea} · {t.demandKinds[ip.demandType]}</span>
          </div>
          <div className="e2e-gantt-track">
            {ip.plannedBar && <span className="e2e-gantt-planned" style={{ left: pct(ip.plannedBar.left), width: pct(ip.plannedBar.width) }} />}
            {ip.bars.map(bar => <Tooltip key={bar.code} content={m.e2eLines.stageTitles[bar.code]} followCursor>
              <span className={`e2e-gantt-bar ${bar.code === "T1" || bar.code === "T2" ? "side-br" : "side-cn"}${bar.source === "forecast" ? " is-forecast" : ""}`}
                style={{ left: pct(bar.left), width: pct(bar.width) }} />
            </Tooltip>)}
            {timeline.needPosition !== null && <span className="e2e-gantt-need" style={{ left: pct(timeline.needPosition) }} />}
            {timeline.todayPosition !== null && <span className="e2e-gantt-today" style={{ left: pct(timeline.todayPosition) }} />}
          </div>
          <SlackBadge ip={ip} />
        </li>)}
      </ol>
      <div className="e2e-ticks"><span style={{ left: "0%" }}>{date(timeline.start)}</span>
        <span className="is-ink" style={{ left: "100%", transform: "translateX(-100%)" }}>{date(timeline.end)}</span></div>
    </section>}

    {analysis.ips.length > 0 && <section className="card" aria-labelledby="e2e-table-title">
      <div className="e2e-panel-heading"><h2 id="e2e-table-title">{t.tableTitle}</h2></div>
      <div className="table-scroll"><table>
        <thead><tr><th>IP</th><th>{t.lines}</th><th>{t.demandType}</th><th>{t.mode}</th><th>{t.shipment}</th>
          <th>{t.arrival}</th><th>{t.delivery}</th><th>{t.slack}</th><th>{t.status}</th></tr></thead>
        <tbody>{analysis.ips.map(ip => <tr key={ip.processId}>
          <td><strong>{ip.ipNumber}</strong></td><td>{ip.lines}</td><td>{t.demandKinds[ip.demandType]}</td>
          <td>{ip.air === null ? "—" : ip.air ? t.air : t.sea}</td>
          <td>{cell(ip.e2e.stages.T3)}</td><td>{cell(ip.e2e.stages.T4)}</td><td>{cell(ip.e2e.stages.T5)}</td>
          <td><SlackBadge ip={ip} /></td>
          <td><span className={statusBadge[ip.status] ?? "badge"}>{statusLabel(m, ip.status)}</span>
            {ip.currentStage && <span className="e2e-label"> · {t.stageNow(ip.currentStage)}</span>}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}
  </main>;
}

function SlackBadge({ ip }: { ip: E2eIpAnalysis }) {
  const { m } = useI18n();
  if (ip.slack === null) return <span className="e2e-deviation">{m.e2eAnalysis.noData}</span>;
  return <span className={`e2e-deviation${ip.late ? " is-late" : " is-ok"}`}>
    {ip.late ? m.e2e.late(-ip.slack) : m.e2e.slackPositive(ip.slack)}
  </span>;
}
