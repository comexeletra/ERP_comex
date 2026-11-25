"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ONBOARDING_STEP_TARGETS, ONBOARDING_TOPIC_STEPS, type OnboardingStepTarget,
  type OnboardingTopic as Topic } from "../lib/onboarding";
import { useI18n } from "./I18nProvider";
import OnboardingVideo from "./OnboardingVideo";
import OnboardingWalkthrough from "./OnboardingWalkthrough";

/**
 * Chapters 4 and 5, Cadastros and NCM: a walkthrough over HML prints, like the process chapter, then the questions
 * whose answer surprises. Each step opens the screen of its print. The NCM notice is a warning, because the rates
 * shown on those screens are references, not the tax due.
 */
export default function OnboardingTopic({ topic, fromHelp = false }: { topic: Topic; fromHelp?: boolean }) {
  const { m } = useI18n();
  const t = m.onboarding;
  const texts = t[topic];
  const steps = ONBOARDING_TOPIC_STEPS[topic];
  const walkthroughRef = useRef<HTMLElement>(null);
  useEffect(() => {
    // Coming from a screen's help link, the walkthrough is what the viewer asked for: bring it into view.
    if (fromHelp) walkthroughRef.current?.scrollIntoView({ block: "start" });
  }, [fromHelp]);
  const names: Record<OnboardingStepTarget, string> = {
    catalog: m.sidebar.items.catalog,
    entityValues: m.catalog.entityValues,
    ncmRates: m.catalog.ncmRates,
    invoiceAudit: m.sidebar.items.invoiceAudit,
  };

  return <>
    <h2 id={`onboarding-${topic}`}>{texts.heading}</h2>
    <p className="onboarding-lead">{texts.lead}</p>
    <p className={topic === "ncm" ? "notice warning" : "notice"}>{texts.notice}</p>
    <section className="card onboarding-screen" aria-label={texts.name} ref={walkthroughRef}>
      <OnboardingWalkthrough steps={steps} texts={texts.steps} name={texts.name}
        action={k => {
          const target = steps[k].target;
          return <Link className="button onboarding-step-action" href={ONBOARDING_STEP_TARGETS[target]}>
            {t.open(names[target])}</Link>;
        }} />
    </section>
    <h3 className="onboarding-subheading">{texts.faqTitle}</h3>
    <div className="onboarding-faq">
      {texts.faq.map(item => <details key={item.question} className="onboarding-faq-item">
        <summary>{item.question}</summary>
        <p>{item.answer}</p>
      </details>)}
    </div>
    <OnboardingVideo slot={topic} />
  </>;
}
