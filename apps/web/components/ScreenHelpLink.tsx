"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { onboardingHelpHref, onboardingScreenForPath } from "../lib/onboarding";
import { useI18n } from "./I18nProvider";

/**
 * "How to use this screen" in the page header: opens the onboarding guide on the walkthrough of the current screen.
 * Pages without a walkthrough show nothing.
 */
export default function ScreenHelpLink() {
  const { m } = useI18n();
  const screen = onboardingScreenForPath(usePathname());
  if (!screen) return null;
  return <Link className="button secondary onboarding-help-link" href={onboardingHelpHref(screen)}
    aria-label={m.onboarding.helpAria(m.sidebar.items[screen])}>
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5a2 2 0 0 1 2-2h5v17H6a2 2 0 0 0-2 2z" /><path d="M20 5a2 2 0 0 0-2-2h-5v17h5a2 2 0 0 1 2 2z" />
    </svg>
    <span>{m.onboarding.help}</span>
  </Link>;
}
