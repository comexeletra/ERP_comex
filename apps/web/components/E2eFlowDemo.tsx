"use client";

import { useState } from "react";
import { buildE2eFlow, DEFAULT_E2E_FLOW_CONFIG, E2E_PHASE_COUNT, E2eFlowConfig, formatDayOffset } from "../lib/e2e-flow";
import type { Messages } from "../lib/i18n/pt-BR";
import { Arrow, E2eFlowRail, Icon, useE2eStepper } from "./E2eFlowParts";
import E2eTabs from "./E2eTabs";
import { useI18n } from "./I18nProvider";
import PageHeader from "./PageHeader";

function phaseStatus(k: number, current: number, m: Messages) {
  return k === current ? m.e2e.statusCurrent : k < current ? m.e2e.statusDone : m.e2e.statusNext;
}

export default function E2eFlowDemo({ config }: { config?: Partial<E2eFlowConfig> }) {
  const { m } = useI18n();
  const t = m.e2e;
  const cfg = { ...DEFAULT_E2E_FLOW_CONFIG, ...config };
  const stepper = useE2eStepper(E2E_PHASE_COUNT, cfg.intervaloMs, cfg.autoplay);
  const { playing, goTo } = stepper;
  const current = stepper.current ?? 0;
  const [mts, setMts] = useState(false);
  const [air, setAir] = useState(false);

  const flow = buildE2eFlow(cfg, { mts, air }, m);
  const phase = flow.phases[current];
  const side = phase.side;
  const [sc, po, prod, tr, clr] = flow.durations;

  return <main className="shell e2e-flow" data-side={side}>
    <PageHeader eyebrow={t.eyebrow} title={t.title}><p>{t.intro}</p></PageHeader>
    <E2eTabs current="model" />

    <section className="e2e-toolbar" aria-label={t.toolbar}>
      <div className="e2e-group">
        <span className="e2e-label" id="e2e-product-label">{t.product}</span>
        <div className="e2e-segmented" role="group" aria-labelledby="e2e-product-label">
          <button type="button" aria-pressed={!mts} onClick={() => setMts(false)}>{t.notMtsOption(cfg.prodNaoMts)}</button>
          <button type="button" aria-pressed={mts} onClick={() => setMts(true)}>{t.mtsOption(cfg.prodMts)}</button>
        </div>
      </div>
      <div className="e2e-group">
        <span className="e2e-label" id="e2e-modal-label">{t.modal}</span>
        <div className="e2e-segmented" role="group" aria-labelledby="e2e-modal-label">
          <button type="button" aria-pressed={!air} onClick={() => setAir(false)}>{t.seaOption(cfg.maritimo)}</button>
          <button type="button" aria-pressed={air} onClick={() => setAir(true)}>{t.airOption(cfg.aereo)}</button>
        </div>
      </div>
      <div className="e2e-controls">
        <span className="e2e-counter" aria-live="polite">{t.phaseBefore}<b>{current + 1}</b>{t.phaseAfter(E2E_PHASE_COUNT)}</span>
        <button type="button" className="e2e-icon-button" aria-label={t.previousPhase}
          onClick={() => goTo((current + E2E_PHASE_COUNT - 1) % E2E_PHASE_COUNT)}><Icon name="prev" size={18} /></button>
        <button type="button" className="button e2e-play" aria-label={playing ? t.pauseAnimation : t.startAnimation}
          onClick={stepper.toggle}>
          <Icon name={playing ? "pause" : "play"} size={16} /><span>{playing ? t.pause : t.animate}</span>
        </button>
        <button type="button" className="e2e-icon-button" aria-label={t.nextPhase}
          onClick={() => goTo((current + 1) % E2E_PHASE_COUNT)}><Icon name="next" size={18} /></button>
      </div>
    </section>

    <div className="e2e-kpis">
      <div className="e2e-kpi"><span>{t.leadTime}</span><strong>{t.days(flow.total)}</strong></div>
      <div className={`e2e-kpi ${flow.slack >= 0 ? "is-ok" : "is-late"}`}>
        <span>{t.slackTitle}</span>
        <strong>{flow.slack > 0 ? t.slackPositive(flow.slack) : flow.slack === 0 ? t.slackZero : t.late(-flow.slack)}</strong>
      </div>
      <div className="e2e-kpi"><span>{t.horizon}</span><strong>{t.days(cfg.horizonte)}</strong></div>
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

    <E2eFlowRail phases={flow.phases} current={current} />

    <div className="e2e-grid6 e2e-phases">
      {flow.phases.map((item, k) => <button type="button" key={item.code} onClick={() => goTo(k)}
        aria-current={k === current ? "step" : undefined}
        className={`e2e-phase side-${item.side}${k === current ? " is-current" : ""}${k < current ? " is-done" : ""}`}>
        <span className="e2e-phase-bar" />
        <span className="e2e-phase-top"><span className="e2e-phase-code">{item.code}</span>
          <span className="e2e-label">{phaseStatus(k, current, m)}</span></span>
        <span className="e2e-phase-head"><span className="e2e-phase-icon"><Icon name={item.icon} /></span>
          <strong>{item.name}</strong></span>
        <span className="e2e-phase-route">
          <span><span className="e2e-label">{t.from}</span><span>{item.from}</span></span>
          <span><span className="e2e-label">{t.to}</span><span>{item.to}</span></span>
        </span>
        <span className="e2e-phase-foot"><span className="e2e-label">{item.owner}</span><b>{item.lt}</b></span>
      </button>)}
    </div>

    <section className="card e2e-ruler" aria-label={t.horizon}>
      <div className="e2e-panel-heading">
        <h2>{t.horizonTitle(flow.months)}</h2>
        <span className="muted">{t.horizonHelp(cfg.horizonte)}</span>
      </div>
      <div className="e2e-bars">
        {flow.segments.map(segment => {
          const segmentSide = segment.phase <= 2 ? "br" : "cn";
          return <div key={segment.phase} style={{ width: `${segment.widthPct.toFixed(3)}%` }}
            className={`e2e-segment side-${segmentSide}${segment.phase === current ? " is-current" : ""}${segment.phase < current ? " is-done" : ""}`}>
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
        <div className="e2e-detail-side">
          <span className="e2e-label">{t.activePhase}</span>
          <span className={`badge e2e-pill side-${side}`}>{side === "br" ? t.brToCn : t.cnToBr}</span>
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
      </section>

      <section className="card e2e-milestones" aria-label={t.milestonesTitle}>
        <div className="e2e-panel-heading">
          <h2>{t.milestonesTitle}</h2>
          <span className="e2e-label">{mts ? t.mts : t.notMts} · {air ? t.air : t.sea}</span>
        </div>
        <ul>
          {flow.milestones.map((milestone, k) => {
            const state = k <= current ? " is-reached" : k === current + 1 ? " is-target" : "";
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
  </main>;
}
