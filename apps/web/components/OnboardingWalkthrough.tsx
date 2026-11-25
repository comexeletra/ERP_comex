"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { focusBadgePlacement, ONBOARDING_SHOT_SIZES, onboardingShotSrc, type OnboardingStep } from "../lib/onboarding";
import { Icon, useE2eStepper } from "./E2eFlowParts";
import { useI18n } from "./I18nProvider";

const stepIntervalMs = 4500;
const badgeClass = {
  above: "onboarding-shot-badge",
  below: "onboarding-shot-badge is-below",
  inside: "onboarding-shot-badge is-inside",
} as const;

/**
 * Step-by-step over HML prints, shared by the process and the screens chapters. The area of the current step stays
 * lit while the rest dims; the frame slides between areas of the same print and a new print fades in.
 * `name` describes the prints for screen readers, `tag` labels a step in the list (the stage, for instance) and
 * `action` adds a button beside the controls for the current step.
 */
export default function OnboardingWalkthrough({ steps, texts, name, tag, action }: {
  steps: readonly OnboardingStep[]; texts: readonly string[]; name: string;
  tag?: (index: number) => ReactNode; action?: (index: number) => ReactNode;
}) {
  const { m } = useI18n();
  const t = m.onboarding.screens;
  const count = steps.length;
  const stepper = useE2eStepper(count, stepIntervalMs, false);
  const current = stepper.current ?? 0;
  const step = steps[current];
  const size = ONBOARDING_SHOT_SIZES[step.shot];
  const src = onboardingShotSrc(step.shot);

  return <>
    <figure className="onboarding-figure">
      <a className="onboarding-shot" href={src} target="_blank" rel="noopener noreferrer">
        {/* Remounting on a new print replays the fade; the highlight slides between areas of the same print. */}
        <Image key={step.shot} className="onboarding-shot-image" src={src} width={size.width} height={size.height}
          alt={t.figure(name, current + 1)} sizes="(max-width: 1100px) 100vw, 75vw" />
        <span className="onboarding-shot-focus" aria-hidden="true"
          style={{ left: `${step.box.x}%`, top: `${step.box.y}%`, width: `${step.box.w}%`, height: `${step.box.h}%` }}>
          <span className={badgeClass[focusBadgePlacement(step.box)]}>{current + 1}</span>
        </span>
        <span className="sr-only">{t.enlarge}</span>
      </a>
      <figcaption aria-live="polite">
        <span className="onboarding-step-count">{t.stepOf(current + 1, count)}</span>
        <span>{texts[current]}</span>
      </figcaption>
    </figure>

    <div className="onboarding-step-controls">
      <button type="button" className="e2e-icon-button" aria-label={t.previousStep}
        onClick={() => stepper.goTo((current + count - 1) % count)}><Icon name="prev" size={18} /></button>
      <button type="button" className="button secondary" onClick={stepper.toggle}>
        <Icon name={stepper.playing ? "pause" : "play"} size={14} />
        <span>{stepper.playing ? t.pause : t.play}</span>
      </button>
      <button type="button" className="e2e-icon-button" aria-label={t.nextStep}
        onClick={() => stepper.goTo((current + 1) % count)}><Icon name="next" size={18} /></button>
      {action?.(current)}
    </div>

    <h4 className="onboarding-steps-title">{t.steps}</h4>
    <ol className="onboarding-steps">
      {texts.map((text, k) => <li key={text}>
        <button type="button" aria-pressed={k === current} onClick={() => stepper.goTo(k)}
          className={k === current ? "onboarding-step is-current" : "onboarding-step"}>
          <span className="onboarding-step-number">{k + 1}</span>
          <span className="onboarding-step-text">{tag?.(k)}<span>{text}</span></span>
        </button>
      </li>)}
    </ol>
  </>;
}
