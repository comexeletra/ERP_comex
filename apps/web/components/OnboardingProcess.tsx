"use client";

import Link from "next/link";
import { buildE2eFlow, DEFAULT_E2E_FLOW_CONFIG } from "../lib/e2e-flow";
import { ONBOARDING_PROCESS_STEPS, ONBOARDING_SCREENS, ONBOARDING_STAGES } from "../lib/onboarding";
import { useI18n } from "./I18nProvider";
import OnboardingVideo from "./OnboardingVideo";
import OnboardingWalkthrough from "./OnboardingWalkthrough";

/**
 * Chapter 2: the T0–T5 flow as a walkthrough over HML prints, like the screens chapter. Each step shows where a
 * stage is recorded or followed; its owner and deadline come from the End to End model, so a new target there
 * reaches the guide by itself.
 */
export default function OnboardingProcess() {
  const { m } = useI18n();
  const t = m.onboarding;
  // Default scenario of the End to End screen: Não MTS, by sea.
  const model = buildE2eFlow(DEFAULT_E2E_FLOW_CONFIG, { mts: false, air: false }, m);
  const name = t.process.name;

  return <>
    <h2 id="onboarding-process">{t.process.heading}</h2>
    <p className="onboarding-lead">{t.process.lead}</p>
    <section className="card onboarding-screen" aria-label={name}>
      <OnboardingWalkthrough steps={ONBOARDING_PROCESS_STEPS} texts={t.process.steps} name={name}
        tag={k => {
          const stage = ONBOARDING_PROCESS_STEPS[k].stage;
          if (stage === null) return null;
          const phase = model.phases[ONBOARDING_STAGES.indexOf(stage)];
          return <span className="badge badge-info badge-sm">{phase.code} · {phase.owner} · {phase.lt}</span>;
        }}
        action={k => {
          const screen = ONBOARDING_SCREENS.find(item => item.key === ONBOARDING_PROCESS_STEPS[k].screen);
          return screen && <Link className="button onboarding-step-action" href={screen.href}>
            {t.open(m.sidebar.items[screen.key])}</Link>;
        }} />
    </section>
    <OnboardingVideo slot="process" />
  </>;
}
