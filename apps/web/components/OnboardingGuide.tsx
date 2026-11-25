"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { productName } from "../lib/brand";
import { isOnboardingScreenKey, ONBOARDING_CHAPTERS, onboardingStorageKey, parseOnboardingProgress, visitChapter,
  writeOnboardingProgress, type OnboardingChapter, type OnboardingHelpTopic, type OnboardingProgress } from "../lib/onboarding";
import { useI18n } from "./I18nProvider";
import OnboardingProcess from "./OnboardingProcess";
import OnboardingPurpose from "./OnboardingPurpose";
import OnboardingScreens from "./OnboardingScreens";
import OnboardingTopic from "./OnboardingTopic";
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

/**
 * Onboarding guide: what the platform is for, the import process, the screens, Cadastros and NCM, one chapter at a
 * time.
 * `initialHelp` comes from the help link of a screen: it opens the screens chapter on that screen's walkthrough,
 * or the chapter it names.
 */
export default function OnboardingGuide({ initialHelp }: { initialHelp: OnboardingHelpTopic | null }) {
  const { m } = useI18n();
  const t = m.onboarding;
  // The server renders the first chapter; the browser then restores where the viewer stopped.
  const progress = parseOnboardingProgress(useSyncExternalStore(subscribe, storedProgress, () => ""));
  const initialScreen = initialHelp !== null && isOnboardingScreenKey(initialHelp) ? initialHelp : null;
  const helpChapter: OnboardingChapter | null = initialHelp === "catalog" || initialHelp === "ncm" ? initialHelp
    : initialScreen ? "screens" : null;
  // A help link shows its chapter from the first render until the viewer picks another chapter.
  const [followHelp, setFollowHelp] = useState(helpChapter !== null);
  const chapter = followHelp && helpChapter ? helpChapter : progress.chapter;
  useEffect(() => {
    // The stored progress lives in the browser: record the chapter the help link opened.
    if (helpChapter !== null) saveProgress(visitChapter(parseOnboardingProgress(storedProgress()), helpChapter));
  }, [helpChapter]);

  function open(next: OnboardingChapter) {
    setFollowHelp(false);
    saveProgress(visitChapter(progress, next));
    window.scrollTo({ top: 0 });
  }

  const index = ONBOARDING_CHAPTERS.indexOf(chapter);
  const previous = index > 0 ? ONBOARDING_CHAPTERS[index - 1] : null;
  const next = index < ONBOARDING_CHAPTERS.length - 1 ? ONBOARDING_CHAPTERS[index + 1] : null;

  return <main className="shell onboarding">
    <PageHeader eyebrow={t.eyebrow} title={t.title(productName)}
      actions={<span className="badge badge-info">{t.progress(progress.seen.length, ONBOARDING_CHAPTERS.length)}</span>}>
      <p>{t.intro}</p>
    </PageHeader>

    <nav className="tabs onboarding-chapters" aria-label={t.chaptersLabel}>
      {ONBOARDING_CHAPTERS.map((item, k) => {
        const active = item === chapter;
        const seen = active || progress.seen.includes(item);
        return <button key={item} type="button" className={active ? "tab active" : "tab"}
          aria-current={active ? "step" : undefined} onClick={() => open(item)}>
          <span className={seen ? "onboarding-chapter-number is-done" : "onboarding-chapter-number"}>{k + 1}</span>
          <span>{t.chapters[item]}</span>
          {seen && !active && <span className="sr-only">{t.seen}</span>}
        </button>;
      })}
    </nav>

    <section className="onboarding-chapter" aria-labelledby={`onboarding-${chapter}`}>
      <p className="eyebrow">{t.chapterNumber(index + 1)}</p>
      {chapter === "purpose" && <OnboardingPurpose />}
      {chapter === "process" && <OnboardingProcess />}
      {chapter === "screens" && <OnboardingScreens initialScreen={initialScreen} />}
      {(chapter === "catalog" || chapter === "ncm")
        && <OnboardingTopic key={chapter} topic={chapter} fromHelp={initialHelp === chapter} />}
    </section>

    <div className="onboarding-pager">
      {previous && <button type="button" className="button secondary" onClick={() => open(previous)}>
        {t.previous(t.chapters[previous])}</button>}
      {next ? <button type="button" className="button" onClick={() => open(next)}>{t.next(t.chapters[next])}</button>
        : <Link className="button" href="/">{t.finish}</Link>}
    </div>
  </main>;
}
