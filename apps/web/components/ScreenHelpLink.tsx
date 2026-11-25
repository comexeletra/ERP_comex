"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isOnboardingScreenKey, onboardingHelpForPath, onboardingHelpHref, type OnboardingHelpTopic } from "../lib/onboarding";
import { useI18n } from "./I18nProvider";

/**
 * "How to use this screen" in the page header: opens the onboarding guide on the walkthrough of the current screen.
 * `topic` comes from pages whose address does not tell what they show (the NCM view of Cadastros, for instance);
 * otherwise the address decides. Pages without a walkthrough show nothing.
 */
export default function ScreenHelpLink({ topic }: { topic?: OnboardingHelpTopic }) {
  const { m } = useI18n();
  const pathname = usePathname();
  const current = topic ?? onboardingHelpForPath(pathname);
  if (!current) return null;
  const name = isOnboardingScreenKey(current) ? m.sidebar.items[current] : m.onboarding.chapters[current];
  return <Link className="button secondary onboarding-help-link" href={onboardingHelpHref(current)}
    aria-label={m.onboarding.helpAria(name)}>
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5a2 2 0 0 1 2-2h5v17H6a2 2 0 0 0-2 2z" /><path d="M20 5a2 2 0 0 0-2-2h-5v17h5a2 2 0 0 1 2 2z" />
    </svg>
    <span>{m.onboarding.help}</span>
  </Link>;
}
