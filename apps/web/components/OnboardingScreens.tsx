"use client";

import Image from "next/image";
import Link from "next/link";
import { useId, useState } from "react";
import { focusBadgePlacement, ONBOARDING_SCREENS, ONBOARDING_SHOT_SIZES, onboardingShotSrc, type OnboardingScreen,
  type OnboardingScreenKey } from "../lib/onboarding";
import { Icon, useE2eStepper } from "./E2eFlowParts";
import { useI18n } from "./I18nProvider";
import OnboardingVideo from "./OnboardingVideo";

const stepIntervalMs = 4500;
const badgeClass = {
  above: "onboarding-shot-badge",
  below: "onboarding-shot-badge is-below",
  inside: "onboarding-shot-badge is-inside",
} as const;

/** Chapter 3: one screen at a time, with what it is for, when to use it and a walkthrough over HML prints. */
export default function OnboardingScreens() {
  const { m } = useI18n();
  const t = m.onboarding.screens;
  const [selected, setSelected] = useState<OnboardingScreenKey>(ONBOARDING_SCREENS[0].key);
  const screen = ONBOARDING_SCREENS.find(item => item.key === selected) ?? ONBOARDING_SCREENS[0];
  return <>
    <h2 id="onboarding-screens">{t.heading}</h2>
    <p className="onboarding-lead">{t.lead}</p>
    <div className="onboarding-screens">
      <ul className="onboarding-screen-list" aria-label={t.listLabel}>
        {ONBOARDING_SCREENS.map(item => <li key={item.key}>
          <button type="button" aria-pressed={item.key === selected} onClick={() => setSelected(item.key)}
            className={item.key === selected ? "onboarding-screen-option is-current" : "onboarding-screen-option"}>
            <strong>{m.sidebar.items[item.key]}</strong>
            <span className="onboarding-stage-chips">
              <span className="sr-only">{t.stages}: </span>
              {item.stages.length > 0
                ? item.stages.map(stage => <span key={stage} className="badge badge-info badge-sm">{stage}</span>)
                : <span className="badge badge-info badge-sm">{t.everyStage}</span>}
            </span>
          </button>
        </li>)}
      </ul>
      {/* A new screen starts its walkthrough from the first step. */}
      <OnboardingScreenDetail key={screen.key} screen={screen} />
    </div>
  </>;
}

function OnboardingScreenDetail({ screen }: { screen: OnboardingScreen }) {
  const { m } = useI18n();
  const t = m.onboarding;
  const titleId = useId();
  const item = t.screens.items[screen.key];
  const name = m.sidebar.items[screen.key];
  const count = screen.steps.length;
  const stepper = useE2eStepper(count, stepIntervalMs, false);
  const current = stepper.current ?? 0;
  const step = screen.steps[current];
  const size = ONBOARDING_SHOT_SIZES[step.shot];
  const src = onboardingShotSrc(step.shot);

  return <article className="card onboarding-screen" aria-labelledby={titleId}>
    <div className="onboarding-screen-head">
      <h3 id={titleId}>{name}</h3>
      <Link className="button" href={screen.href}>{t.open(name)}</Link>
    </div>
    <p>{item.summary}</p>
    <p><strong>{t.screens.when}:</strong> {item.when}</p>

    <figure className="onboarding-figure">
      <a className="onboarding-shot" href={src} target="_blank" rel="noopener noreferrer">
        {/* Remounting on a new print replays the fade; the highlight slides between areas of the same print. */}
        <Image key={step.shot} className="onboarding-shot-image" src={src} width={size.width} height={size.height}
          alt={t.screens.figure(name, current + 1)} sizes="(max-width: 1100px) 100vw, 75vw" />
        <span className="onboarding-shot-focus" aria-hidden="true"
          style={{ left: `${step.box.x}%`, top: `${step.box.y}%`, width: `${step.box.w}%`, height: `${step.box.h}%` }}>
          <span className={badgeClass[focusBadgePlacement(step.box)]}>{current + 1}</span>
        </span>
        <span className="sr-only">{t.screens.enlarge}</span>
      </a>
      <figcaption aria-live="polite">
        <span className="onboarding-step-count">{t.screens.stepOf(current + 1, count)}</span>
        <span>{item.steps[current]}</span>
      </figcaption>
    </figure>

    <div className="onboarding-step-controls">
      <button type="button" className="e2e-icon-button" aria-label={t.screens.previousStep}
        onClick={() => stepper.goTo((current + count - 1) % count)}><Icon name="prev" size={18} /></button>
      <button type="button" className="button secondary" onClick={stepper.toggle}>
        <Icon name={stepper.playing ? "pause" : "play"} size={14} />
        <span>{stepper.playing ? t.screens.pause : t.screens.play}</span>
      </button>
      <button type="button" className="e2e-icon-button" aria-label={t.screens.nextStep}
        onClick={() => stepper.goTo((current + 1) % count)}><Icon name="next" size={18} /></button>
    </div>

    <h4 className="onboarding-steps-title">{t.screens.steps}</h4>
    <ol className="onboarding-steps">
      {item.steps.map((text, k) => <li key={text}>
        <button type="button" aria-pressed={k === current} onClick={() => stepper.goTo(k)}
          className={k === current ? "onboarding-step is-current" : "onboarding-step"}>
          <span className="onboarding-step-number">{k + 1}</span>
          <span>{text}</span>
        </button>
      </li>)}
    </ol>

    <OnboardingVideo slot={screen.key} />
  </article>;
}
