"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ONBOARDING_STEP_TARGETS, onboardingTopicScreens, type OnboardingStepTarget,
  type OnboardingTopic as Topic, type OnboardingTopicScreen } from "../lib/onboarding";
import { useI18n } from "./I18nProvider";
import OnboardingVideo from "./OnboardingVideo";
import OnboardingWalkthrough from "./OnboardingWalkthrough";

/**
 * Chapters 4 and 5, Cadastros and NCM, laid out like chapter 3: the screens of the chapter on the side, with their
 * stages, and beside them what the chosen screen is for and its part of the walkthrough over HML prints; then the
 * questions whose answer surprises. The NCM notice is a warning, because the rates shown on those screens are
 * references, not the tax due.
 */
export default function OnboardingTopic({ topic, fromHelp = false }: { topic: Topic; fromHelp?: boolean }) {
  const { m } = useI18n();
  const t = m.onboarding;
  const texts = t[topic];
  const screens = onboardingTopicScreens(topic);
  const [selected, setSelected] = useState<OnboardingStepTarget>(screens[0].target);
  const screensRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Coming from a screen's help link, the walkthrough is what the viewer asked for: bring it into view.
    if (fromHelp) screensRef.current?.scrollIntoView({ block: "start" });
  }, [fromHelp]);
  const names: Record<OnboardingStepTarget, string> = {
    catalog: m.sidebar.items.catalog,
    entityValues: m.catalog.entityValues,
    ncmRates: m.catalog.ncmRates,
    invoiceAudit: m.sidebar.items.invoiceAudit,
  };
  const screen = screens.find(item => item.target === selected) ?? screens[0];

  return <>
    <h2 id={`onboarding-${topic}`}>{texts.heading}</h2>
    <p className="onboarding-lead">{texts.lead}</p>
    <p className={topic === "ncm" ? "notice warning" : "notice"}>{texts.notice}</p>
    <div className="onboarding-screens" ref={screensRef}>
      <ul className="onboarding-screen-list" aria-label={texts.name}>
        {screens.map(item => <li key={item.target}>
          <button type="button" aria-pressed={item.target === selected} onClick={() => setSelected(item.target)}
            className={item.target === selected ? "onboarding-screen-option is-current" : "onboarding-screen-option"}>
            <strong>{names[item.target]}</strong>
            <span className="onboarding-stage-chips">
              <span className="sr-only">{t.screens.stages}: </span>
              {item.stages.length > 0
                ? item.stages.map(stage => <span key={stage} className="badge badge-info badge-sm">{stage}</span>)
                : <span className="badge badge-info badge-sm">{t.screens.everyStage}</span>}
            </span>
          </button>
        </li>)}
      </ul>
      {/* A new screen starts its part of the walkthrough from the first step. */}
      <OnboardingTopicScreenDetail key={screen.target} topic={topic} screen={screen} name={names[screen.target]} />
    </div>
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

function OnboardingTopicScreenDetail({ topic, screen, name }: {
  topic: Topic; screen: OnboardingTopicScreen; name: string;
}) {
  const { m } = useI18n();
  const t = m.onboarding;
  const titleId = useId();
  const texts = t[topic];
  const item = (texts.screens as Partial<Record<OnboardingStepTarget, { summary: string; when: string }>>)[screen.target];
  const steps = texts.steps.slice(screen.first, screen.first + screen.steps.length);

  return <article className="card onboarding-screen" aria-labelledby={titleId}>
    <div className="onboarding-screen-head">
      <h3 id={titleId}>{name}</h3>
      <Link className="button" href={ONBOARDING_STEP_TARGETS[screen.target]}>{t.open(name)}</Link>
    </div>
    {item && <>
      <p>{item.summary}</p>
      <p><strong>{t.screens.when}:</strong> {item.when}</p>
    </>}
    <OnboardingWalkthrough steps={screen.steps} texts={steps} name={name} />
  </article>;
}
