import OnboardingGuide from "../../components/OnboardingGuide";
import { onboardingScreenParam, parseOnboardingHelp } from "../../lib/onboarding";

/** `?tela=<key>` comes from the help link of a screen and opens the guide on its walkthrough or chapter. */
export default async function OnboardingPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const initialHelp = parseOnboardingHelp((await searchParams)[onboardingScreenParam]);
  // A help link from another screen remounts the guide, so it opens that screen even if the guide was already open.
  return <OnboardingGuide key={initialHelp ?? ""} initialHelp={initialHelp} />;
}
