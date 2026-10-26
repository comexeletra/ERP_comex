"use client";

import { ReactNode, useEffect, useState } from "react";
import {
  buildE2eFlow, DEFAULT_E2E_FLOW_CONFIG, E2E_PHASE_COUNT, E2eFlowConfig, E2eIconName, formatDayOffset, railCenter,
} from "../lib/e2e-flow";
import type { Messages } from "../lib/i18n/pt-BR";
import E2ePoPicker from "./E2ePoPicker";
import { useI18n } from "./I18nProvider";
import PageHeader from "./PageHeader";

type IconName = E2eIconName | "pause" | "play" | "prev" | "next";

const icons: Record<IconName, ReactNode> = {
  plan: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 3h6v3H9z" /><path d="M9 12h6M9 16h4" /></>,
  cart: <><circle cx="9" cy="20" r="1.5" /><circle cx="17" cy="20" r="1.5" /><path d="M3 4h2l2.4 11h11l2-8H6.2" /></>,
  send: <><path d="M21 3L10 14" /><path d="M21 3l-7 18-4-7-7-4z" /></>,
  factory: <><path d="M3 21V10l6 4v-4l6 4V6l6 3v12z" /><path d="M3 21h18" /></>,
  ship: <><path d="M3 15h18l-2.5 5h-13z" /><path d="M6 15V9h12v6" /><path d="M12 9V4" /><path d="M9 6h6" /></>,
  plane: <path d="M2 13l8-2 4-7h2l-2 7 6 1 2-3h1.5l-1 4 1 4H22l-2-3-6 1 2 7h-2l-4-7-8-2z" />,
  truck: <><path d="M2 6h11v10H2z" /><path d="M13 9h4l4 4v3h-8" /><circle cx="6.5" cy="18" r="1.8" /><circle cx="17" cy="18" r="1.8" /></>,
  pause: <path d="M8 5v14M16 5v14" />,
  play: <path d="M7 4l13 8-13 8z" />,
  prev: <path d="M15 18l-6-6 6-6" />,
  next: <path d="M9 18l6-6-6-6" />,
};

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>;
}

function Arrow({ w = 34, h = 14 }: { w?: number; h?: number }) {
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" stroke="currentColor" strokeWidth="2.2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={`M2 ${h / 2}h${w - 6}M${w - 10} 2l6 ${h / 2 - 2}-6 ${h / 2 - 2}`} />
  </svg>;
}

function phaseStatus(k: number, current: number, m: Messages) {
  return k === current ? m.e2e.statusCurrent : k < current ? m.e2e.statusDone : m.e2e.statusNext;
}

export default function E2eFlowDemo({ config }: { config?: Partial<E2eFlowConfig> }) {
  const { m } = useI18n();
  const t = m.e2e;
  const cfg = { ...DEFAULT_E2E_FLOW_CONFIG, ...config };
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(cfg.autoplay);
  const [mts, setMts] = useState(false);
  const [air, setAir] = useState(false);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => setCurrent(value => (value + 1) % E2E_PHASE_COUNT), cfg.intervaloMs);
    return () => clearInterval(timer);
  }, [playing, cfg.intervaloMs]);

  function goTo(k: number) { setCurrent(k); setPlaying(false); }

  const flow = buildE2eFlow(cfg, { mts, air }, m);
  const phase = flow.phases[current];
  const side = phase.side;
  const [sc, po, prod, tr, clr] = flow.durations;

  return <main className="shell e2e-flow" data-side={side}>
    <PageHeader eyebrow={t.eyebrow} title={t.title}><p>{t.intro}</p></PageHeader>
    <E2ePoPicker />

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
          onClick={() => setPlaying(value => !value)}>
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

    <div className="e2e-rail" aria-hidden="true">
      <div className="e2e-rail-base" style={{ left: railCenter(0), right: `calc(100% - ${railCenter(5)})` }} />
      <div className="e2e-rail-progress" style={{ left: railCenter(0), width: `calc(${railCenter(current)} - ${railCenter(0)})` }} />
      <div className="e2e-grid6 e2e-rail-dots">
        {flow.phases.map((item, k) => <div key={item.code}>
          <span className={`e2e-rail-dot side-${item.side}${k <= current ? " is-reached" : ""}${k < current ? " is-done" : ""}`} />
        </div>)}
      </div>
      <div className="e2e-marker" style={{ left: railCenter(current) }}>
        <span className="e2e-marker-ring" />
        <span className="e2e-marker-disc"><Icon name={phase.icon} size={24} /></span>
      </div>
    </div>

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
