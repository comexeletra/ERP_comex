"use client";

import { buildE2eFlow, DEFAULT_E2E_FLOW_CONFIG, formatDayOffset } from "../lib/e2e-flow";
import { Arrow } from "./E2eFlowParts";
import { useI18n } from "./I18nProvider";

type E2eModel = ReturnType<typeof buildE2eFlow>;

/** Reference lead time, slack and horizon, with the two directions of the flow. */
export function E2eModelSummary({ flow, current }: { flow: E2eModel; current: number | null }) {
  const { m } = useI18n();
  const t = m.e2e;
  const side = current === null ? null : flow.phases[current].side;
  const [sc, po, prod, tr, clr] = flow.durations;
  return <>
    <div className="e2e-kpis">
      <div className="e2e-kpi"><span>{t.leadTime}</span><strong>{t.days(flow.total)}</strong></div>
      <div className={`e2e-kpi ${flow.slack >= 0 ? "is-ok" : "is-late"}`}>
        <span>{t.slackTitle}</span>
        <strong>{flow.slack > 0 ? t.slackPositive(flow.slack) : flow.slack === 0 ? t.slackZero : t.late(-flow.slack)}</strong>
      </div>
      <div className="e2e-kpi"><span>{t.horizon}</span><strong>{t.days(DEFAULT_E2E_FLOW_CONFIG.horizonte)}</strong></div>
    </div>

    <div className="e2e-grid6 e2e-directions">
      <div className={`e2e-direction side-br${side === "br" ? " is-on" : ""}`}>
        <strong>{t.brazil} <Arrow /> {t.china}</strong>
        <span className="e2e-label">{t.infoFlow(sc + po)}</span>
      </div>
      <div className={`e2e-direction side-cn${side === "cn" ? " is-on" : ""}`}>
        <strong>{t.china} <Arrow /> {t.brazil}</strong>
        <span className="e2e-label">{t.cargoFlow(prod + tr + clr)}</span>
      </div>
    </div>
  </>;
}

/** Horizon ruler, the selected phase and the milestones; with no phase selected nothing is reached. */
export function E2eModelDetails({ flow, current, mts, air }: {
  flow: E2eModel; current: number | null; mts: boolean; air: boolean;
}) {
  const { m } = useI18n();
  const t = m.e2e;
  const horizon = DEFAULT_E2E_FLOW_CONFIG.horizonte;
  const phase = current === null ? null : flow.phases[current];
  const reached = current ?? -1;

  return <>
    <section className="card e2e-ruler" aria-label={t.horizon}>
      <div className="e2e-panel-heading">
        <h2>{t.horizonTitle(flow.months)}</h2>
        <span className="muted">{t.horizonHelp(horizon)}</span>
      </div>
      <div className="e2e-bars">
        {flow.segments.map(segment => {
          const segmentSide = segment.phase <= 2 ? "br" : "cn";
          return <div key={segment.phase} style={{ width: `${segment.widthPct.toFixed(3)}%` }}
            className={`e2e-segment side-${segmentSide}${segment.phase === current ? " is-current" : ""}${segment.phase < reached ? " is-done" : ""}`}>
            {segment.label}
          </div>;
        })}
        <div className="e2e-segment is-slack" style={{ width: `${flow.slackPct.toFixed(3)}%` }}>{flow.slackLabel}</div>
        {flow.overflowLeft && <div className="e2e-overflow" style={{ left: flow.overflowLeft }}>+{-flow.slack}d</div>}
      </div>
      <div className="e2e-ticks">
        {flow.ticks.map(tick => <span key={tick.label} className={tick.tone ? `is-${tick.tone}` : undefined}
          style={{ left: tick.left, transform: tick.transform }}>{tick.label}</span>)}
      </div>
    </section>

    <div className="e2e-bottom">
      <section className="card e2e-detail" aria-label={t.activePhase}>
        {phase ? <>
          <div className="e2e-detail-side">
            <span className="e2e-label">{t.activePhase}</span>
            <span className={`badge e2e-pill side-${phase.side}`}>{phase.side === "br" ? t.brToCn : t.cnToBr}</span>
            <span className="e2e-detail-code">{phase.code}</span>
            <span className="e2e-label">{t.deadline}</span>
            <strong className="e2e-detail-lt">{phase.lt}</strong>
          </div>
          <div className="e2e-detail-main">
            <div className="e2e-panel-heading"><h2>{phase.title}</h2><span className="e2e-window">{phase.win}</span></div>
            <div className="e2e-from-to">
              <div><span className="e2e-label">{t.begin}</span><strong>{phase.dFrom}</strong></div>
              <Arrow w={28} h={16} />
              <div className="is-end"><span className="e2e-label">{t.end}</span><strong>{phase.dTo}</strong></div>
            </div>
            <div><span className="e2e-label">{t.ownerRule}</span><p className="e2e-rule">{phase.rule}</p></div>
            <ul className="e2e-docs" aria-label={t.documents}>{phase.docs.map(doc => <li key={doc}>{doc}</li>)}</ul>
          </div>
        </> : <p className="muted">{t.selectPhase}</p>}
      </section>

      <section className="card e2e-milestones" aria-label={t.milestonesTitle}>
        <div className="e2e-panel-heading">
          <h2>{t.milestonesTitle}</h2>
          <span className="e2e-label">{mts ? t.mts : t.notMts} · {air ? t.air : t.sea}</span>
        </div>
        <ul>
          {flow.milestones.map((milestone, k) => {
            const state = k <= reached ? " is-reached" : current !== null && k === current + 1 ? " is-target" : "";
            const final = k === flow.milestones.length - 1 ? (flow.slack >= 0 ? " is-final-ok" : " is-final-late") : "";
            return <li key={milestone.label} className={`side-${milestone.side}${state}${final}`}>
              <span className="e2e-milestone-dot" /><span className="e2e-label">M{k}</span>
              <span className="e2e-milestone-name">{milestone.label}</span>
              <span className="e2e-milestone-date">{formatDayOffset(milestone.offset)}</span>
            </li>;
          })}
        </ul>
      </section>
    </div>
  </>;
}
