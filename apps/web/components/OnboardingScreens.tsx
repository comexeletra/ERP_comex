"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ONBOARDING_SCREENS, type OnboardingScreen, type OnboardingScreenKey } from "../lib/onboarding";
import { useI18n } from "./I18nProvider";
import OnboardingVideo from "./OnboardingVideo";
import OnboardingWalkthrough from "./OnboardingWalkthrough";

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

  return <article className="card onboarding-screen" aria-labelledby={titleId}>
    <div className="onboarding-screen-head">
      <h3 id={titleId}>{name}</h3>
      <Link className="button" href={screen.href}>{t.open(name)}</Link>
    </div>
    <p>{item.summary}</p>
    <p><strong>{t.screens.when}:</strong> {item.when}</p>
    <OnboardingWalkthrough steps={screen.steps} texts={item.steps} name={name} />
    <OnboardingVideo slot={screen.key} />
  </article>;
}
