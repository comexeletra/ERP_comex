"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ONBOARDING_NCM_STEPS, ONBOARDING_NCM_TARGETS, type OnboardingNcmTarget } from "../lib/onboarding";
import { useI18n } from "./I18nProvider";
import OnboardingVideo from "./OnboardingVideo";
import OnboardingWalkthrough from "./OnboardingWalkthrough";

/**
 * Chapter 4: the NCM cycle as a walkthrough over HML prints, like the process chapter, with the questions whose
 * answer surprises. Each step opens the screen of its print. The rates shown on those screens are references, not
 * the tax due, and the chapter says so before the walkthrough.
 */
export default function OnboardingNcm({ fromHelp = false }: { fromHelp?: boolean }) {
  const { m } = useI18n();
  const t = m.onboarding;
  const walkthroughRef = useRef<HTMLElement>(null);
  useEffect(() => {
    // Coming from a screen's help link, the walkthrough is what the viewer asked for: bring it into view.
    if (fromHelp) walkthroughRef.current?.scrollIntoView({ block: "start" });
  }, [fromHelp]);
  const names: Record<OnboardingNcmTarget, string> = {
    catalog: m.sidebar.items.catalog,
    entityValues: m.catalog.entityValues,
    ncmRates: m.catalog.ncmRates,
    invoiceAudit: m.sidebar.items.invoiceAudit,
  };

  return <>
    <h2 id="onboarding-ncm">{t.ncm.heading}</h2>
    <p className="onboarding-lead">{t.ncm.lead}</p>
    <p className="notice warning">{t.ncm.notice}</p>
    <section className="card onboarding-screen" aria-label={t.ncm.name} ref={walkthroughRef}>
      <OnboardingWalkthrough steps={ONBOARDING_NCM_STEPS} texts={t.ncm.steps} name={t.ncm.name}
        action={k => {
          const target = ONBOARDING_NCM_STEPS[k].target;
          return <Link className="button onboarding-step-action" href={ONBOARDING_NCM_TARGETS[target]}>
            {t.open(names[target])}</Link>;
        }} />
    </section>
    <h3 className="onboarding-subheading">{t.ncm.faqTitle}</h3>
    <div className="onboarding-faq">
      {t.ncm.faq.map(item => <details key={item.question} className="onboarding-faq-item">
        <summary>{item.question}</summary>
        <p>{item.answer}</p>
      </details>)}
    </div>
    <OnboardingVideo slot="ncm" />
  </>;
}
