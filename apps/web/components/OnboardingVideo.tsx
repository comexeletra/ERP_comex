"use client";

import { onboardingVideoUrl, type OnboardingVideoSlot } from "../lib/onboarding";
import { Icon } from "./E2eFlowParts";
import { useI18n } from "./I18nProvider";

/** Place for a video recorded by the team: a link when it exists, otherwise a note that it is being recorded. */
export default function OnboardingVideo({ slot }: { slot: OnboardingVideoSlot }) {
  const { m } = useI18n();
  const t = m.onboarding.video;
  const url = onboardingVideoUrl(slot);
  return <aside className="onboarding-video" aria-label={t.title}>
    <span className="onboarding-video-icon"><Icon name="play" size={18} /></span>
    {url ? <p>
      <a className="button secondary" href={url} target="_blank" rel="noopener noreferrer">{t.watch}</a>
      <span className="muted"> {t.newTab}</span>
    </p> : <p><strong>{t.pending}</strong><span className="muted"> {t.pendingHelp}</span></p>}
  </aside>;
}
