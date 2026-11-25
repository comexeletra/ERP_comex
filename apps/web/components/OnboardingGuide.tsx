"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { productName } from "../lib/brand";
import { ONBOARDING_CHAPTERS, onboardingStorageKey, parseOnboardingProgress, visitChapter, writeOnboardingProgress,
  type OnboardingChapter, type OnboardingProgress } from "../lib/onboarding";
import { useI18n } from "./I18nProvider";
import OnboardingProcess from "./OnboardingProcess";
import OnboardingPurpose from "./OnboardingPurpose";
import OnboardingScreens from "./OnboardingScreens";
import PageHeader from "./PageHeader";

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
const browserStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
// The progress chosen in this page, kept even when the browser blocks the storage.
let pageProgress: string | null = null;
function storedProgress() {
  if (pageProgress !== null) return pageProgress;
  try {
    return browserStorage()?.getItem(onboardingStorageKey) ?? "";
  } catch {
    return "";
  }
}
function saveProgress(progress: OnboardingProgress) {
  pageProgress = JSON.stringify(progress);
  writeOnboardingProgress(browserStorage(), progress);
  listeners.forEach(listener => listener());
}

/** Onboarding guide: what the platform is for, the import process and the screens, one chapter at a time. */
export default function OnboardingGuide() {
  const { m } = useI18n();
  const t = m.onboarding;
  // The server renders the first chapter; the browser then restores where the viewer stopped.
  const progress = parseOnboardingProgress(useSyncExternalStore(subscribe, storedProgress, () => ""));

  function open(chapter: OnboardingChapter) {
    saveProgress(visitChapter(progress, chapter));
    window.scrollTo({ top: 0 });
  }

  const index = ONBOARDING_CHAPTERS.indexOf(progress.chapter);
  const previous = index > 0 ? ONBOARDING_CHAPTERS[index - 1] : null;
  const next = index < ONBOARDING_CHAPTERS.length - 1 ? ONBOARDING_CHAPTERS[index + 1] : null;

  return <main className="shell onboarding">
    <PageHeader eyebrow={t.eyebrow} title={t.title(productName)}
      actions={<span className="badge badge-info">{t.progress(progress.seen.length, ONBOARDING_CHAPTERS.length)}</span>}>
      <p>{t.intro}</p>
    </PageHeader>

    <nav className="tabs onboarding-chapters" aria-label={t.chaptersLabel}>
      {ONBOARDING_CHAPTERS.map((chapter, k) => {
        const active = chapter === progress.chapter;
        const seen = progress.seen.includes(chapter);
        return <button key={chapter} type="button" className={active ? "tab active" : "tab"}
          aria-current={active ? "step" : undefined} onClick={() => open(chapter)}>
          <span className={seen ? "onboarding-chapter-number is-done" : "onboarding-chapter-number"}>{k + 1}</span>
          <span>{t.chapters[chapter]}</span>
          {seen && !active && <span className="sr-only">{t.seen}</span>}
        </button>;
      })}
    </nav>

    <section className="onboarding-chapter" aria-labelledby={`onboarding-${progress.chapter}`}>
      <p className="eyebrow">{t.chapterNumber(index + 1)}</p>
      {progress.chapter === "purpose" && <OnboardingPurpose />}
      {progress.chapter === "process" && <OnboardingProcess />}
      {progress.chapter === "screens" && <OnboardingScreens />}
    </section>

    <div className="onboarding-pager">
      {previous && <button type="button" className="button secondary" onClick={() => open(previous)}>
        {t.previous(t.chapters[previous])}</button>}
      {next ? <button type="button" className="button" onClick={() => open(next)}>{t.next(t.chapters[next])}</button>
        : <Link className="button" href="/">{t.finish}</Link>}
    </div>
  </main>;
}
