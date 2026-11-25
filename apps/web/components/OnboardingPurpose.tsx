"use client";

import { useI18n } from "./I18nProvider";
import OnboardingVideo from "./OnboardingVideo";

const columns = ["sources", "platform", "people"] as const;
const benefits = ["single", "traceable", "early"] as const;
const glossary = ["sc", "po", "item", "ip", "invoice", "duimp", "demand", "need"] as const;

/** Chapter 1: what the platform is for, how information flows through it and the terms used everywhere. */
export default function OnboardingPurpose() {
  const { m } = useI18n();
  const t = m.onboarding.purpose;
  return <>
    <h2 id="onboarding-purpose">{t.heading}</h2>
    <p className="onboarding-lead">{t.lead}</p>

    <figure className="card onboarding-flow">
      <div className="onboarding-flow-columns" role="list" aria-label={t.flowLabel}>
        {columns.map((column, k) => <div key={column} role="listitem" className="onboarding-flow-column"
          style={{ animationDelay: `${k * 160}ms` }}>
          <h3>{t.columns[column].title}</h3>
          <ul>{Object.values(t.columns[column].items).map(item => <li key={item}>{item}</li>)}</ul>
        </div>)}
      </div>
      <figcaption className="muted">{t.flowCaption}</figcaption>
    </figure>

    <h3 className="onboarding-subheading">{t.benefitsTitle}</h3>
    <div className="onboarding-benefits">
      {benefits.map(benefit => <article key={benefit} className="card onboarding-benefit">
        <h4>{t.benefits[benefit].title}</h4>
        <p>{t.benefits[benefit].text}</p>
      </article>)}
    </div>

    <h3 className="onboarding-subheading">{t.glossaryTitle}</h3>
    <dl className="onboarding-glossary">
      {glossary.map(term => <div key={term}>
        <dt>{t.glossary[term].term}</dt>
        <dd>{t.glossary[term].text}</dd>
      </div>)}
    </dl>

    <OnboardingVideo slot="purpose" />
  </>;
}
