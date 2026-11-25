"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { buildE2eFlow, DEFAULT_E2E_FLOW_CONFIG } from "../lib/e2e-flow";
import { ONBOARDING_STAGES, screensForStage } from "../lib/onboarding";
import { E2eFlowRail, Icon, useE2eStepper } from "./E2eFlowParts";
import { E2eModelDetails, E2eModelSummary } from "./E2eModelPanels";
import { useI18n } from "./I18nProvider";
import OnboardingVideo from "./OnboardingVideo";

/**
 * Chapter 2: the T0–T5 flow with the same model, cards and deadlines as the End to End screen, without the
 * product lines, plus the screens that follow the selected stage.
 */
export default function OnboardingProcess() {
  const { m } = useI18n();
  const t = m.onboarding;
  const e = m.e2e;
  const productId = useId();
  const modalId = useId();
  const [mts, setMts] = useState(false);
  const [air, setAir] = useState(false);
  const model = buildE2eFlow(DEFAULT_E2E_FLOW_CONFIG, { mts, air }, m);
  const count = model.phases.length;
  const stepper = useE2eStepper(count, DEFAULT_E2E_FLOW_CONFIG.intervaloMs, false);
  const current = stepper.current;
  const stage = current === null ? null : ONBOARDING_STAGES[current];

  return <>
    <h2 id="onboarding-process">{t.process.heading}</h2>
    <p className="onboarding-lead">{t.process.lead}</p>

    <div className="e2e-flow onboarding-process" data-side={current === null ? undefined : model.phases[current].side}>
      <section className="e2e-toolbar" aria-label={t.process.scenarioLabel}>
        <div className="e2e-group">
          <span className="e2e-label" id={productId}>{e.product}</span>
          <div className="e2e-segmented" role="group" aria-labelledby={productId}>
            <button type="button" aria-pressed={!mts} onClick={() => setMts(false)}>{e.notMtsOption(DEFAULT_E2E_FLOW_CONFIG.prodNaoMts)}</button>
            <button type="button" aria-pressed={mts} onClick={() => setMts(true)}>{e.mtsOption(DEFAULT_E2E_FLOW_CONFIG.prodMts)}</button>
          </div>
        </div>
        <div className="e2e-group">
          <span className="e2e-label" id={modalId}>{e.modal}</span>
          <div className="e2e-segmented" role="group" aria-labelledby={modalId}>
            <button type="button" aria-pressed={!air} onClick={() => setAir(false)}>{e.seaOption(DEFAULT_E2E_FLOW_CONFIG.maritimo)}</button>
            <button type="button" aria-pressed={air} onClick={() => setAir(true)}>{e.airOption(DEFAULT_E2E_FLOW_CONFIG.aereo)}</button>
          </div>
        </div>
        <div className="e2e-controls">
          {current !== null && <span className="e2e-counter" aria-live="polite">
            {e.phaseBefore}<b>{current + 1}</b>{e.phaseAfter(count)}</span>}
          <button type="button" className="e2e-icon-button" aria-label={e.previousPhase}
            onClick={() => stepper.goTo(((current ?? 0) + count - 1) % count)}><Icon name="prev" size={18} /></button>
          <button type="button" className="button e2e-play" aria-label={stepper.playing ? e.pauseAnimation : e.startAnimation}
            onClick={stepper.toggle}>
            <Icon name={stepper.playing ? "pause" : "play"} size={16} /><span>{stepper.playing ? e.pause : e.animate}</span>
          </button>
          <button type="button" className="e2e-icon-button" aria-label={e.nextPhase}
            onClick={() => stepper.goTo(current === null ? 0 : (current + 1) % count)}><Icon name="next" size={18} /></button>
        </div>
      </section>
      <p className="muted">{t.process.scenarioHelp}</p>

      <E2eModelSummary flow={model} current={current} />
      <E2eFlowRail phases={model.phases} current={current} />
      <div className="e2e-grid6 e2e-phases">
        {model.phases.map((phase, k) => {
          const status = current === null ? null : k === current ? e.statusCurrent : k < current ? e.statusDone : e.statusNext;
          return <button type="button" key={phase.code} onClick={() => stepper.goTo(k === current ? null : k)}
            aria-pressed={k === current}
            className={`e2e-phase side-${phase.side}${k === current ? " is-current" : ""}${current !== null && k < current ? " is-done" : ""}`}>
            <span className="e2e-phase-bar" />
            <span className="e2e-phase-top"><span className="e2e-phase-code">{phase.code}</span>
              {status && <span className="e2e-label">{status}</span>}</span>
            <span className="e2e-phase-head"><span className="e2e-phase-icon"><Icon name={phase.icon} /></span>
              <strong>{phase.name}</strong></span>
            <span className="e2e-phase-route">
              <span><span className="e2e-label">{e.from}</span><span>{phase.from}</span></span>
              <span><span className="e2e-label">{e.to}</span><span>{phase.to}</span></span>
            </span>
            <span className="e2e-phase-foot"><span className="e2e-label">{phase.owner}</span><b>{phase.lt}</b></span>
          </button>;
        })}
      </div>

      <section className="card onboarding-where" aria-live="polite">
        {stage ? <>
          <h3>{t.process.whereTitle(stage)}</h3>
          <ul className="onboarding-where-links">
            {screensForStage(stage).map(screen => <li key={screen.key}>
              <Link className="button secondary" href={screen.href}>{t.open(m.sidebar.items[screen.key])}</Link>
            </li>)}
          </ul>
        </> : <p className="muted">{t.process.whereHelp}</p>}
      </section>

      <E2eModelDetails flow={model} current={current} mts={mts} air={air} />
    </div>

    <OnboardingVideo slot="process" />
  </>;
}
